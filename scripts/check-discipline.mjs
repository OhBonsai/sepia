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
//   纪律 18 —— 日志不得整体转储 process.env

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
// 主题变量表（Stage 1 起住在 @sepia/ui/theme 的 css 里）是唯一允许出现色值的地方，
// 所以本规则只扫 .ts / .tsx，不扫 .css。
{
  const ID = '纪律 3'
  const TITLE = '组件与 CM6 扩展不得出现字面色值'
  const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/
  const FUNCTIONAL = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/
  const roots = ['packages/ui/src', 'packages/editor/src', 'packages/app/src/renderer']
  for (const file of sourcesIn(roots)) {
    const { lines } = load(file)
    lines.forEach((line, index) => {
      const hit = HEX.exec(line)?.[0] ?? FUNCTIONAL.exec(line)?.[0]
      if (!hit) return
      if (isExempt(lines, index, ID)) return
      report.add(ID, TITLE, `${file}:${index + 1}`, `${hit} —— 改用 var(--…) 主题变量`)
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

report.finish('discipline —— 结构 3 / 纪律 1 / 纪律 3 / 纪律 18')
