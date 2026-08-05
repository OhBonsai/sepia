#!/usr/bin/env bun
// build-engine —— vendor/opencode → 引擎产物（单文件 ESM + 4 wasm），复制到
// packages/app/engine/（.gitignore 内）。挂在 @sepia/app 的 predev / prebuild 上
//（001 §1 的 [S3] 标注在此兑现）。
//
// 步骤：patch（git apply --check 硬失败，纪律 15 的阶梯）→ vendor 根 bun install
// （--frozen-lockfile，构建产物一步不出网；依赖安装靠 lockfile 钉死）→ build-node
// → 产物校验（恰好 1 ESM + 4 wasm）→ 复制到位 + 引擎侧 node_modules
// （jsonc-parser 真包 + PTY 抛错桩——build-node 的两个 external，探路记录见 140 §1.8 风险 2）。
//
// 幂等：manifest 记 vendor HEAD 与 patch 摘要，没变就整段跳过（predev 不该让 dev 变慢）。
// SEPIA_ENGINE_REBUILD=1 强制重建。

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT } from './lib/harness.mjs'

const VENDOR = join(ROOT, 'vendor/opencode')
const VENDOR_PKG = join(VENDOR, 'packages/opencode')
const DIST = join(VENDOR_PKG, 'dist/node')
const PATCHES = join(ROOT, 'patches')
const STUBS = join(ROOT, 'scripts/engine-stubs')
const TARGET = join(ROOT, 'packages/app/engine')
const MANIFEST = join(TARGET, 'manifest.json')
const WASM_COUNT = 4

function fail(message: string): never {
  console.error(`build-engine: ${message}`)
  process.exit(1)
}

function run(cmd: string[], cwd: string, label: string, env?: Record<string, string>): void {
  const started = Date.now()
  const result = Bun.spawnSync(cmd, { cwd, stdout: 'inherit', stderr: 'inherit', env: env ? { ...process.env, ...env } : undefined })
  if (result.exitCode !== 0) fail(`${label} 失败（退出码 ${result.exitCode}）`)
  console.log(`build-engine: ${label} ✓ ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

if (!existsSync(join(VENDOR, 'package.json'))) {
  fail('vendor/opencode 不在——先跑 `git submodule update --init`（锁定 tag 见 140 §1.2）')
}

const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: VENDOR }).stdout.toString().trim()

// ── patch 阶梯（架构 §4.1 原则二）────────────────────────────────────────────
// 首版零 patch，但这条路必须先修好：apply --check 硬失败、不静默跳过。
const patchFiles = existsSync(PATCHES)
  ? readdirSync(PATCHES)
      .filter((name) => name.endsWith('.patch'))
      .toSorted()
  : []

for (const name of patchFiles) {
  const file = join(PATCHES, name)
  const applied = Bun.spawnSync(['git', 'apply', '--reverse', '--check', file], { cwd: VENDOR })
  if (applied.exitCode === 0) continue // 已应用过，幂等跳过
  const check = Bun.spawnSync(['git', 'apply', '--check', file], { cwd: VENDOR })
  if (check.exitCode !== 0) {
    fail(`patch 应用不上：patches/${name}\n${check.stderr.toString()}——升 tag 后 patch 必重验（140 §1.2 刹车表）`)
  }
  run(['git', 'apply', file], VENDOR, `apply patches/${name}`)
}

const patchDigest = createHash('sha256')
  .update(patchFiles.map((name) => `${name}\n${readFileSync(join(PATCHES, name), 'utf8')}`).join('\0'))
  .digest('hex')
  .slice(0, 16)

// ── 幂等短路 ────────────────────────────────────────────────────────────────
if (!process.env['SEPIA_ENGINE_REBUILD'] && existsSync(MANIFEST)) {
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    const complete = Object.keys(manifest.files ?? {}).every((name) => existsSync(join(TARGET, name)))
    if (manifest.commit === head && manifest.patchDigest === patchDigest && complete) {
      console.log(`build-engine: 产物已是 ${String(manifest.tag)}@${head.slice(0, 9)}，跳过（SEPIA_ENGINE_REBUILD=1 强制重建）`)
      process.exit(0)
    }
  } catch {
    // manifest 坏了就当没有，重建
  }
}

// ── vendor 安装与构建 ────────────────────────────────────────────────────────
// 构建期不出网（001 §4）：build-node 经 generate.ts 读模型目录，
// MODELS_DEV_API_JSON 指向仓库内快照——Stage 3 漏实现，150 §1.1 补上
// （本机无网时 build-node 直连 models.dev 失败，实测）。
// env 必须显式传：Bun 父进程改 process.env 不进 spawnSync 子进程（实测）。
const MODELS_SNAPSHOT = join(ROOT, 'scripts/models-dev-snapshot.json')
if (!existsSync(MODELS_SNAPSHOT)) fail('缺少 scripts/models-dev-snapshot.json（models.dev api.json 快照，构建期不出网的依赖）')

run(['bun', 'install', '--frozen-lockfile'], VENDOR, 'vendor bun install')
run(['bun', 'script/build-node.ts'], VENDOR_PKG, 'build-node', { MODELS_DEV_API_JSON: MODELS_SNAPSHOT })

// ── 产物校验：恰好一份 ESM + 四份 wasm ──────────────────────────────────────
if (!existsSync(join(DIST, 'node.js'))) fail('build-node 没有产出 dist/node/node.js')
const wasm = readdirSync(DIST).filter((name) => name.endsWith('.wasm'))
if (wasm.length !== WASM_COUNT) {
  fail(`wasm 应恰好 ${WASM_COUNT} 份，实得 ${wasm.length}：${wasm.join('、') || '（无）'}`)
}

// ── 复制到位 ────────────────────────────────────────────────────────────────
rmSync(TARGET, { recursive: true, force: true })
mkdirSync(TARGET, { recursive: true })

const files: Record<string, number> = {}
for (const name of ['node.js', ...wasm]) {
  cpSync(join(DIST, name), join(TARGET, name))
  files[name] = Bun.file(join(TARGET, name)).size
}

// node.js 是 ESM——没有这份 package.json，Node 会先按 CJS 解析再重来一遍（实测有告警与开销）
writeFileSync(join(TARGET, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`)

// 引擎侧 node_modules：build-node 的两个 external（140 §1.8 风险 2 的探路结论）。
// jsonc-parser 从**我们自己的** node_modules 解析——catalog 钉 3.3.1，与 vendor 锁同版；
// vendor 的隔离式 store（node_modules/.bun）对外不可解析，不从那边拿。
const jsoncSource = Bun.resolveSync('jsonc-parser/package.json', join(ROOT, 'packages/app')).replace(
  /\/package\.json$/,
  '',
)
cpSync(jsoncSource, join(TARGET, 'node_modules/jsonc-parser'), { recursive: true })
cpSync(join(STUBS, 'lydell-node-pty'), join(TARGET, 'node_modules/@lydell/node-pty'), { recursive: true })

// 原生模块归零（架构 §4.1）：整棵产物树里不许有 .node
const natives = new Bun.Glob('**/*.node').scanSync({ cwd: TARGET })
for (const hit of natives) fail(`产物树里出现原生模块：${hit}`)

const tag = Bun.spawnSync(['git', 'describe', '--tags', '--exact-match'], { cwd: VENDOR }).stdout.toString().trim() || head

writeFileSync(
  MANIFEST,
  `${JSON.stringify({ tag, commit: head, patchDigest, patches: patchFiles, builtAt: new Date().toISOString(), files }, null, 2)}\n`,
)

const totalMb = (Object.values(files).reduce((sum, bytes) => sum + bytes, 0) / 1024 / 1024).toFixed(1)
console.log(`build-engine: ${tag}@${head.slice(0, 9)} → packages/app/engine（${Object.keys(files).length} 个文件，${totalMb}MB）`)
