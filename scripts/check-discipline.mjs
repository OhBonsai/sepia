#!/usr/bin/env bun
// 源码文本级的纪律检查，作为 `bun run lint` 的第一步跑（所以它在 check 的最前面，
// 比 typecheck 更早给出带纪律号的失败信息）。
//
// 这里只放**不是 import 图问题**的纪律；包与包之间的边归 check:deps 管，
// 一条纪律只用一种手段（002 §6.1）。
//
//   结构 3 —— core / editor / agent / ui 的 src 不得 import 进程侧代码
//   纪律 1 —— renderer 组件不得碰 window.api / preload / electron
//   纪律 3 —— 组件与 CM6 扩展不得出现字面色值
//   纪律 8 —— `.sepia/` 下 json 一律原子写：services 之外不得直接调 fs 写接口
//   纪律 18 —— 日志不得整体转储 process.env
//   纪律 20 —— 应用自有文件只写 `~/.sepia`，不散落 XDG

import { isExempt, read, Report, stripComments, walk } from './lib/harness.mjs'

const report = new Report('discipline')

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http',
  'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
  'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib',
])

const SPECIFIER_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
]

function importsOf(lines) {
  const found = []
  lines.forEach((line, index) => {
    for (const pattern of SPECIFIER_PATTERNS) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(line)) !== null) {
        found.push({ specifier: match[1], line: index + 1, index })
      }
    }
  })
  return found
}

function sourcesIn(roots) {
  return roots.flatMap((root) => walk(root, ['.ts', '.tsx']))
}

/**
 * 只扫各包的 `src/`，跳过 `test/`。
 * 纪律 8 与纪律 20 守的是**产品代码**的行为：测试往临时目录写 fixture、
 * 或断言"我们不用 XDG 路径"，都是合法且必要的。002 §5.1 把这种情形列为
 * 「粒度太粗，无法表达合法例外」——正确解法是收窄规则，不是逼出一堆豁免。
 */
function productionSources() {
  return walk('packages', ['.ts', '.tsx']).filter((file) => /^packages\/[^/]+\/src\//.test(file))
}

function load(file) {
  const raw = read(file)
  return { raw, lines: stripComments(raw).split('\n') }
}

// ── 结构 3：四个下层包不得 import 进程侧代码 ────────────────────────────────
// 包边界（package.json 不声明 electron）与 tsconfig 的 `types: []` 已是第一道墙，
// 这条负责在 typecheck 之前就报出带编号的原因。
{
  const ID = '结构 3'
  const TITLE = 'core / editor / agent / ui 不得 import 进程侧代码'
  const roots = ['packages/core/src', 'packages/editor/src', 'packages/agent/src', 'packages/ui/src']
  for (const file of sourcesIn(roots)) {
    const { lines } = load(file)
    for (const { specifier, line, index } of importsOf(lines)) {
      const bare = specifier.replace(/^node:/, '').split('/')[0]
      const isRuntime =
        specifier === 'electron' ||
        specifier.startsWith('electron/') ||
        specifier.startsWith('node:') ||
        NODE_BUILTINS.has(bare)
      if (!isRuntime) continue
      if (isExempt(lines, index, ID)) continue
      report.add(ID, TITLE, `${file}:${line}`, `import '${specifier}' —— 这些包要能脱离 Electron 单测`)
    }
  }
}

// ── 纪律 1：组件不得 import window.api、不得直接请求引擎 ────────────────────
{
  const ID = '纪律 1'
  const TITLE = '组件不得 import window.api、不得直接请求引擎'
  const ALLOWED = new Set([
    'packages/app/src/renderer/services/api.ts',
    'packages/app/src/renderer/services/agent-bridge.ts',
  ])
  for (const file of sourcesIn(['packages/app/src/renderer'])) {
    if (ALLOWED.has(file)) continue
    const { lines } = load(file)

    lines.forEach((line, index) => {
      if (!/\bwindow\s*\.\s*api\b/.test(line)) return
      if (isExempt(lines, index, ID)) return
      report.add(ID, TITLE, `${file}:${index + 1}`, '只经 services/api.ts 与 agent-bridge.ts')
    })

    for (const { specifier, line, index } of importsOf(lines)) {
      const bad =
        specifier === 'electron' ||
        /(^|\/)preload(\/|$)/.test(specifier) ||
        /(^|\/)main(\/|$)/.test(specifier)
      if (!bad) continue
      if (isExempt(lines, index, ID)) continue
      report.add(ID, TITLE, `${file}:${line}`, `import '${specifier}' —— renderer 不直连 main 侧`)
    }
  }
}

// ── 纪律 3：组件与 CM6 扩展不得出现字面色值 ──────────────────────────────────
// 调色板文件是**唯一**允许出现色值的地方，其余一律写 var(--…)。
// Stage 1 起连 .css 也扫——只放过那一个调色板文件。不扫 css 的话，
// 组件的样式表就成了色值的后门，而那正是最容易滑进去的地方。
{
  const ID = '纪律 3'
  const TITLE = '组件与 CM6 扩展不得出现字面色值'
  const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/
  const FUNCTIONAL = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/
  /** 色值的唯一住址。改这里就要同步改 @sepia/ui 的 vars.ts（那边只放名字）。 */
  const PALETTE = 'packages/ui/src/theme/theme.css'
  const roots = ['packages/ui/src', 'packages/editor/src', 'packages/app/src/renderer']
  const files = roots.flatMap((root) => walk(root, ['.ts', '.tsx', '.css']))
  for (const file of files) {
    if (file === PALETTE) continue
    const { lines } = load(file)
    lines.forEach((line, index) => {
      const hit = HEX.exec(line)?.[0] ?? FUNCTIONAL.exec(line)?.[0]
      if (!hit) return
      if (isExempt(lines, index, ID)) return
      report.add(ID, TITLE, `${file}:${index + 1}`, `${hit} —— 改用 var(--…)，色值只许住在 ${PALETTE}`)
    })
  }
}

// ── 纪律 8：`.sepia/` 下 json 一律 tmp + rename 原子写 ───────────────────────
// 强制方式是"堵死其它调用方式"：除了 fsio.ts，谁都不许直接碰 fs 的写接口。
{
  const ID = '纪律 8'
  const TITLE = 'services 之外不得直接调 fs 写接口'
  const ALLOWED = new Set(['packages/app/src/main/services/fsio.ts'])
  const WRITE = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|renameSync)\s*\(/
  for (const file of productionSources()) {
    if (ALLOWED.has(file)) continue
    const { lines } = load(file)

    // 前置门：**文件得真的 import 了 fs**，否则同名方法只是巧合。
    // 没有这道门，`api.writeFile(...)`（走桥、最终落到 fsio 的原子写）会被误判——
    // 而按 002 §5.1，误报最危险的后果不是烦人，是"AI 相信工具而不相信自己"，
    // 把本来正确的代码改坏，只为让红变绿。
    const touchesFs = importsOf(lines).some(({ specifier }) => /^(?:node:)?fs(?:\/promises)?$/.test(specifier))
    if (!touchesFs) continue

    lines.forEach((line, index) => {
      const hit = WRITE.exec(line)?.[0]
      if (!hit) return
      if (isExempt(lines, index, ID)) return
      report.add(ID, TITLE, `${file}:${index + 1}`, `${hit} —— 改用 services/fsio.ts 的 atomicWrite`)
    })
  }
}

// ── 纪律 20：应用自有文件只写 `~/.sepia`，不散落 XDG ─────────────────────────
// 架构 §4.5 曾把 config.json 写成 `~/.config/sepia/`，与 §2.2、§2.3、T-25 与本条冲突。
// 这条规则就是让那种写法**再也写不进来**（120 §1.1 问题七）。
{
  const ID = '纪律 20'
  const TITLE = '应用自有文件只写 ~/.sepia，不散落 XDG'
  const XDG =
    /(?:XDG_[A-Z_]+|\.config\/sepia|Library\/Application Support|AppData\/(?:Roaming|Local)|\.local\/share)/
  for (const file of productionSources()) {
    const { lines } = load(file)
    lines.forEach((line, index) => {
      const hit = XDG.exec(line)?.[0]
      if (!hit) return
      if (isExempt(lines, index, ID)) return
      report.add(ID, TITLE, `${file}:${index + 1}`, `${hit} —— 应用自有文件一律走 services/paths.ts`)
    })
  }
}

// ── 纪律 18：日志绝不记录凭据，尤其不得整体转储进程环境变量 ──────────────────
{
  const ID = '纪律 18'
  const TITLE = '日志不得整体转储 process.env'
  const DUMP = /(?:JSON\s*\.\s*stringify|console\s*\.\s*\w+|\blog\w*|\bdebug|\binspect)\s*\(\s*process\s*\.\s*env\s*[,)]/
  const files = [...sourcesIn(['packages']), ...walk('scripts', ['.mjs', '.ts'])]
  for (const file of files) {
    const { lines } = load(file)
    lines.forEach((line, index) => {
      if (!DUMP.test(line)) return
      if (isExempt(lines, index, ID)) return
      report.add(ID, TITLE, `${file}:${index + 1}`, '只取用到的单个 key，且不要打印它的值')
    })
  }
}

report.finish('discipline —— 结构 3 / 纪律 1 / 纪律 3 / 纪律 8 / 纪律 18 / 纪律 20')
