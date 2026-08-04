import { readFileSync } from 'node:fs'

// 依赖图的机器表达。规则**不是手写的**——它们从 scripts/dep-graph.json 派生，
// 那份 json 就是 001_boot.md §2.2 那张图的唯一副本。图变了就改 json，
// 改 json 就会在 diff 里看见（002 §2.2）。
const graph = JSON.parse(readFileSync(new URL('./scripts/dep-graph.json', import.meta.url), 'utf8'))

/** 规则名 → [纪律号, 纪律标题]，check-deps.mjs 靠它把违规翻译成带编号的失败信息。 */
export const RULE_CODES = {}

const forbidden = []

function rule(name, code, title, comment, from, to) {
  RULE_CODES[name] = [code, title]
  forbidden.push({ name, severity: 'error', comment, from, to })
  return name
}

rule(
  'no-circular',
  '结构 2',
  '依赖图必须层次线性无环',
  'core 与 ui 是叶子、app 是根，中间不许出现回边',
  { path: '^packages/' },
  { circular: true },
)

// 每个包一条：只许依赖 edges 里列出的包，其余一律禁止。
// 「两条刻意不连线」（editor ↮ ui、editor ↮ agent）不需要额外写——
// 它们本来就不在 edges 里，因此自动落进 denied。
for (const pkg of graph.packages) {
  const allowed = new Set(graph.edges[pkg] ?? [])
  const denied = graph.packages.filter((other) => other !== pkg && !allowed.has(other))
  if (denied.length === 0) continue

  const deliberate = graph.deliberateNonEdges
    .filter((edge) => edge.from === pkg)
    .map((edge) => `${edge.from} ↮ ${edge.to}：${edge.why}`)

  rule(
    `pkg-${pkg}`,
    '结构 2',
    `packages/${pkg} 只许依赖 [${[...allowed].join(', ') || '（无）'}]`,
    [`允许：${[...allowed].join(', ') || '（无）'}`, ...deliberate].join(' ｜ '),
    { path: `^packages/${pkg}/src/` },
    { path: `^packages/(${denied.join('|')})/` },
  )
}

rule(
  'main-not-to-renderer',
  '结构 4',
  'renderer 与 main 之间没有直接 import',
  '两侧只经 core/types 的 IPC 契约类型往来',
  { path: '^packages/app/src/(main|preload)/' },
  { path: '^packages/app/src/renderer/' },
)

rule(
  'renderer-not-to-main',
  '结构 4',
  'renderer 与 main 之间没有直接 import',
  'renderer → preload 由纪律 1 管（check-discipline），此处只管 main',
  { path: '^packages/app/src/renderer/' },
  { path: '^packages/app/src/main/' },
)

rule(
  'not-to-unresolvable',
  '结构 2',
  'import 必须解析得到',
  '解析不到通常意味着路径写错，或者跨包依赖没在 package.json 里声明',
  { path: '^packages/' },
  { couldNotResolve: true },
)

export default {
  forbidden,
  options: {
    doNotFollow: { path: '(^|/)node_modules(/|$)' },
    // `packages/app/engine` 是 vendor 的构建产物（build-engine.ts 复制到位的单文件 ESM），
    // 与 `vendor/` 同性质——不是我们的代码，它的 import 图归引擎自己（纪律 15、16）。
    // 它对产物齐全性的检查在 check:artifacts，不在这里。
    exclude: { path: '(^|/)(node_modules|out|dist|coverage|vendor|engine|\\.turbo)(/|$)' },
    // 连 `import type` 也算边——类型依赖同样是依赖。
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'],
      mainFields: ['module', 'main', 'types'],
    },
  },
}
