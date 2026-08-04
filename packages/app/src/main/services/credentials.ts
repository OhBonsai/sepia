// 凭据由 Sepia 管控（架构 §4.1）：API key 类，safeStorage（OS 钥匙串背书的加密，
// 无原生依赖——140 §1.1 问题四对 keytar 的否决）加密后落 `~/.sepia/credentials.json`。
// fork 引擎时以 `provider.<id>.options.apiKey` 随内存配置注入；**引擎侧零落盘**。
//
// 首次无凭据时从用户 opencode 的凭据文件**只读导入一次**——这是取得方式，不是持续
// 共享；Sepia 永不写用户 opencode 的任何文件。OAuth 类 MVP 不做。

import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { safeStorage } from 'electron'

import { atomicWrite, readTextIfExists } from './fsio.ts'
import type { SepiaPaths } from './paths.ts'

export interface Credentials {
  version: 1
  /** provider id → API key。只有 api 类；oauth/wellknown 不进来。 */
  providers: Record<string, { apiKey: string }>
}

/**
 * 一次导入的产物：**密钥与定义分家**。
 * 密钥进 safeStorage 密文；定义（npm / baseURL / models，无秘密）进 `~/.sepia/config.json`。
 * 自定义 openai-compatible provider 光有密钥没有定义是用不了的，两者都要，但不能混存。
 */
export interface ImportedFromOpencode {
  credentials: Credentials
  /** 形状即 opencode config 的 `provider` 段，已剔除全部 `options.apiKey`。 */
  providerDefinitions: Record<string, unknown>
}

/** 磁盘信封：密文 base64 + 版本。不含任何明文字段。 */
interface Envelope {
  version: 1
  cipher: string
}

function log(message: string): void {
  process.stderr.write(`sepia-credentials: ${message}\n`)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export interface LoadedCredentials {
  credentials: Credentials | null
  /** 本次是首次导入时带回的 provider 定义——调用方负责写进 `~/.sepia/config.json`。 */
  importedDefinitions: Record<string, unknown> | null
}

/**
 * 读凭据。顺序：自有密文 → （首次）从用户 opencode 只读导入一次 → 没有就是没有。
 * 任何失败都降级为「无凭据」——凭据坏了不该让应用起不来（不变量 1 的姿态）。
 *
 * **无凭据可读时一次都不碰 safeStorage。** macOS 上 `isEncryptionAvailable()` 会去
 * 找钥匙串里的 "Electron Key"，找不到就弹**模态**系统对话框——那是一个挡在启动路径上、
 * 用户必须点掉才能继续写字的东西，正撞不变量 1（纸永远可写）。实施中实测到：HOME 被
 * 隔离（smoke / 新机器首次启动）时必现。所以先做纯文件判断，确有东西要解密/加密才唤起
 * 钥匙串——1.6b 的「首次凭据导入的系统授权对话框」也因此只在真有凭据要导入时出现。
 */
export async function loadCredentials(paths: SepiaPaths): Promise<LoadedCredentials> {
  const none: LoadedCredentials = { credentials: null, importedDefinitions: null }
  const hasOwn = await fileExists(paths.credentials)
  const importable = hasOwn ? null : await readOpencode()
  if (!hasOwn && importable === null) return none // 无凭据：不碰钥匙串，不弹任何东西

  if (!safeStorage.isEncryptionAvailable()) {
    // Linux CI 无钥匙串后端时的已知形态（140 §1.8 风险 4）：不落明文，本次以无凭据运行。
    log('safeStorage 不可用，本次以无凭据运行（不落明文）')
    return none
  }

  if (hasOwn) {
    const existing = await readTextIfExists(paths.credentials)
    if (!existing.ok) {
      log(`读取失败——${existing.reason}`)
      return none
    }
    try {
      const envelope = JSON.parse(existing.value ?? '') as Envelope
      const clear = safeStorage.decryptString(Buffer.from(envelope.cipher, 'base64'))
      return { credentials: JSON.parse(clear) as Credentials, importedDefinitions: null }
    } catch {
      log('密文解不开（钥匙串变更或文件损坏），本次以无凭据运行')
      return none
    }
  }

  const imported = importable!
  log(
    `已从用户 opencode 只读导入 ${Object.keys(imported.credentials.providers).length} 个 API key、` +
      `${Object.keys(imported.providerDefinitions).length} 个 provider 定义（此后归 Sepia 管）`,
  )
  await saveCredentials(paths, imported.credentials)
  return { credentials: imported.credentials, importedDefinitions: imported.providerDefinitions }
}

export async function saveCredentials(paths: SepiaPaths, credentials: Credentials): Promise<void> {
  const cipher = safeStorage.encryptString(JSON.stringify(credentials)).toString('base64')
  const envelope: Envelope = { version: 1, cipher }
  const written = await atomicWrite(paths.credentials, JSON.stringify(envelope))
  if (!written.ok) log(`写入失败——${written.reason}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 从用户 opencode **只读**读取两处（永不写回其中任何一个文件）：
 *   - `<XDG_DATA>/opencode/auth.json`：登录态的 api 类条目 → 密钥
 *   - `<XDG_CONFIG>/opencode/opencode.json`：自定义 provider 的定义与内联
 *     `options.apiKey` → 定义与密钥分家
 *
 * 路径取**用户环境**的 XDG 根（不是 Sepia 的隔离根）——引擎的路径隔离针对的是我们
 * fork 的子进程，这里读的恰恰是用户自己的 opencode 数据。
 */
async function readOpencode(): Promise<ImportedFromOpencode | null> {
  // harness-exempt: 纪律 20 读用户 opencode 自己的文件是架构 §4.1 明文规定的一次性导入，不是 Sepia 自有文件散落 XDG
  const dataRoot = process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local/share')
  // harness-exempt: 纪律 20 同上——用户 opencode 的配置目录，只读
  const configRoot = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config')

  const providers: Credentials['providers'] = {}
  const definitions: Record<string, unknown> = {}

  const authRaw = await readIfReadable(join(dataRoot, 'opencode', 'auth.json'))
  if (authRaw !== null) {
    try {
      const parsed = JSON.parse(authRaw) as Record<string, { type?: string; key?: string }>
      for (const [id, entry] of Object.entries(parsed)) {
        if (entry?.type === 'api' && typeof entry.key === 'string') providers[id] = { apiKey: entry.key }
      }
    } catch {
      log('用户 opencode 的 auth.json 解析失败，跳过')
    }
  }

  const configRaw = await readIfReadable(join(configRoot, 'opencode', 'opencode.json'))
  if (configRaw !== null) {
    try {
      // 用户手写的配置常带注释与尾逗号（opencode 自己也按 jsonc 读），所以走 jsonc。
      // 动态 import：jsonc-parser 不该出现在同步启动路径上（纪律 12）。
      const { parse: parseJsonc } = await import('jsonc-parser')
      const parsed = parseJsonc(configRaw, [], { allowTrailingComma: true }) as unknown
      const provider = isRecord(parsed) ? parsed['provider'] : undefined
      if (isRecord(provider)) {
        for (const [id, entry] of Object.entries(provider)) {
          if (!isRecord(entry)) continue
          if (!isRecord(entry['options'])) {
            definitions[id] = entry
            continue
          }
          const options: Record<string, unknown> = { ...entry['options'] }
          const apiKey = options['apiKey']
          if (typeof apiKey === 'string' && apiKey.length > 0) {
            providers[id] = { apiKey }
            delete options['apiKey'] // 定义里**绝不留密钥**——它只进密文
          }
          definitions[id] = { ...entry, options }
        }
      }
    } catch {
      log('用户 opencode 的 opencode.json 解析失败，跳过')
    }
  }

  if (Object.keys(providers).length === 0) return null
  return { credentials: { version: 1, providers }, providerDefinitions: definitions }
}

async function readIfReadable(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null // 没装过 opencode / 没这个文件——正常
  }
}
