import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { IoResult } from '@sepia/core'

// 纪律 8：`.sepia/` 下 json 一律 tmp + rename 原子写。
// **这是全仓库唯一被允许直接调 fs 写接口的地方**——lint 规则拦住其余所有位置。
//
// 为什么原子：断电或崩溃时，`writeFile` 会留下一个被截断的文件；而 rename 在同一
// 文件系统上是原子的，要么旧内容完好，要么新内容完整。session.json 被写坏的代价
// 是下次开机丢掉上次的 page——这正是 002 §2.5 把它列进"由测试强制"的原因。

export async function readText(path: string): Promise<IoResult<string>> {
  try {
    return { ok: true, value: await readFile(path, 'utf8') }
  } catch (error) {
    return { ok: false, reason: describe(error) }
  }
}

/** 文件不存在返回 null，其余错误照常报出——两者含义完全不同，不许混。 */
export async function readTextIfExists(path: string): Promise<IoResult<string | null>> {
  try {
    return { ok: true, value: await readFile(path, 'utf8') }
  } catch (error) {
    if (isNotFound(error)) return { ok: true, value: null }
    return { ok: false, reason: describe(error) }
  }
}

export async function atomicWrite(path: string, content: string): Promise<IoResult<void>> {
  const tmp = join(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`)
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, path)
    return { ok: true, value: undefined }
  } catch (error) {
    // 失败要把临时文件收干净，否则目录里会积一堆 .xxxx.tmp
    await unlink(tmp).catch(() => undefined)
    return { ok: false, reason: describe(error) }
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
