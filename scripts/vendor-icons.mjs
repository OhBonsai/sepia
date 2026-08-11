#!/usr/bin/env bun
// 把 Lucide 的几个 SVG 抽进 `packages/ui/src/icons/paths.ts`（vendored 资产）。
//
// **不是构建步骤，是一次性的搬运工。** `check` 不跑它，CI 也不跑——
// 它的产物是提交进仓库的源码，跑它的时机只有一个：**要加/换图标的那一次**。
//
// 用法（lucide-static 是临时 devDependency，装上跑完就摘）：
//   bun add -d lucide-static@1.31.0
//   bun scripts/vendor-icons.mjs
//   bun remove lucide-static
//
// 为什么拷而不是引运行时依赖：190 附录 A-6——**依赖是永久的，能拷就不引**。
// 我们只用二十几个图标，而 lucide 有两千多个；引它换来的是"以后不用手动拷"，
// 付出的是一条永久的供应链边 + 打包体积 + 版本漂移。

import { readFileSync, writeFileSync } from 'node:fs'

const VERSION = '1.31.0'
const SOURCE = 'node_modules/lucide-static/icons'
const TARGET = 'packages/ui/src/icons/paths.ts'

/**
 * 清单。**加图标就往这儿加一行再重跑**——于是"多了哪个图标"永远出现在 diff 里，
 * 与 `bridge-snapshot.json` 让暴露面增长可见是同一个手法。
 *
 * **只列有调用点的**：留一个没人调用的导出，就是下一个"listModels 在桥上
 * 亮了四个 stage 没人接"。每次改这份清单都顺手确认一遍每个名字都有人用。
 *
 * ── 为什么是 26 个（任务描述写的是"22 个"，差异记在这儿免得再核一遍）──────
 *
 * 按替换清单逐行去重累计：
 *
 *   tabs         house, plus, x, activity                              → 新增 4（累计 4）
 *   papertop     table-properties, link, message-square                → 新增 3（累计 7）
 *   home         search, square-pen, settings-2, circle-help,
 *                panel-left-close（plus 与前面重复）                    → 新增 5（累计 12）
 *   设置九个导航  keyboard, pen-tool, file-text, bot, cpu, sparkle,
 *                plug, send（settings-2 与前面重复）                    → 新增 8（累计 20）
 *   rightbar     external-link（x 重复）                                → 新增 1（累计 21）
 *   search-panel chevron-up, chevron-down（x 重复）                     → 新增 2（累计 23）
 *   markup       rotate-cw                                             → 新增 1（累计 24）
 *   slash        workflow, image                                       → 新增 2（累计 26）
 *   树右键        folder, trash-2 —— **没有图标位，按"没有就不加"未采用**  → 0
 *
 * 也就是说"22"与清单自己列举的名字对不上；**清单是准的，数字是笔误**。
 * 要砍到 22 就必然有四个点名要用的图标没有实现——所以按清单走，不按那个数字走。
 */
const NAMES = [
  'house',
  'plus',
  'x',
  'activity',
  'table-properties',
  'link',
  'message-square',
  'search',
  'square-pen',
  'settings-2',
  'circle-help',
  'panel-left-close',
  'keyboard',
  'pen-tool',
  'file-text',
  'bot',
  'cpu',
  'sparkle',
  'plug',
  'send',
  'external-link',
  'chevron-up',
  'chevron-down',
  'rotate-cw',
  'workflow',
  'image',
]

/** 只取 `<svg>` 的内容：根标签上的属性由 `<Icon>` 统一给。 */
function inner(svg) {
  const open = svg.indexOf('>', svg.indexOf('<svg')) + 1
  const close = svg.lastIndexOf('</svg>')
  return svg
    .slice(open, close)
    .replaceAll(/\s+/g, ' ')
    .trim()
}

const entries = NAMES.map((name) => [name, inner(readFileSync(`${SOURCE}/${name}.svg`, 'utf8'))])

const head = `// Lucide 图标的**内嵌资产**（vendored）。
//
// 来源：\`lucide-static\` v${VERSION} ｜ 协议：**ISC**（见同目录 LICENSE）
// 上游：https://github.com/lucide-icons/lucide
//
// **为什么是拷贝而不是依赖**（190 附录 A-6：依赖是永久的，能拷就不引）：
// 我们只用 ${String(entries.length)} 个图标，而 lucide 有两千多个。引运行时依赖换来的是
// "以后加图标不用手动拷"，付出的是一条永久的供应链边 + 打包体积 + 版本漂移。
// 拷进来之后它就是我们仓库里的一段字符串——不会自己变，也不会在某天 breaking。
//
// **本文件由脚本生成**（\`scripts/vendor-icons.mjs\`），不要手改：
// 要加图标就把名字加进那个脚本的清单里重跑一次，diff 里看得见加了什么。
//
// 每条只存 \`<svg>\` 的**内容**，不存根标签——根标签上的 stroke-width / size 由
// \`<Icon>\` 统一给（图标要统一，就不能让每一份各带各的属性）。

/** 可用图标名。**字面量联合**——写错名字编译期就红（与纪律 5 同一个手法）。 */
export type IconName =
${entries.map(([name]) => `  | '${name}'`).join('\n')}

export const ICON_PATHS: Record<IconName, string> = {
${entries.map(([name, body]) => `  '${name}':\n    '${body}',`).join('\n')}
}
`

writeFileSync(TARGET, head)
console.log(`vendored ${String(entries.length)} icons → ${TARGET}`)
