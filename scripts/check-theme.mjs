#!/usr/bin/env bun
// check:theme —— 纪律 14：**Shiki 与 CM6 的高亮由同一份色板派生。**
//
// 原计划（002 §2.4 / 150 §1.4 #8）是「比对两份生成结果的色值」。Stage 4 的 spike
// 把这条检查变简单了：Shiki 的 theme settings 接受任意字符串，于是两边都直接写
// `var(--sepia-*)`——**不是「两处代码同色」，是两处代码用同一个变量**。
// 于是要守的东西从「色值相等」降为「名字都真实存在」，更强也更便宜：
// 名字对不上是编译期就该红的事，不必等运行期生成两份 HTML 再 diff。
//
// 三道：
//   A. CM6 高亮里的每个 var 名，都在 @sepia/ui 的 themeVar 表里
//   B. Shiki 主题里的每个 var 名，都在 themeVar 表里
//   C. themeVar 表里的每个名字，theme.css 亮暗两套都真的定义了
//
// C 是最容易被忽略、后果最静默的一道：用了一个没定义的变量，CSS 不会报错，
// 颜色会静静地继承成别的东西——看起来"只是有点淡"。

import { read, Report } from './lib/harness.mjs'

const report = new Report('theme')

const VARS_FILE = 'packages/ui/src/theme/vars.ts'
const PALETTE_FILE = 'packages/ui/src/theme/theme.css'
const CM6_FILE = 'packages/editor/src/extensions/highlight.ts'
const SHIKI_FILE = 'packages/app/src/renderer/markup/shiki-theme.ts'
/**
 * renderer 的样式表。**Stage 7 补进来的**：在此之前这条检查只看 CM6 与 Shiki
 * 两个文件，于是 `index.css` 里写一个不存在的 `var(--sepia-scrim)` 一路绿到底——
 * CSS 不报错，颜色静静地变成透明。正是本文件开头说的「C 是最静默的一道」，
 * 而它自己漏掉了最大的那个 CSS 文件。
 */
const SHELL_CSS = 'packages/app/src/renderer/index.css'

/** 取出文本里所有 `var(--x)` 的名字。 */
function varNames(source) {
  return [...source.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((match) => match[1])
}

const varsSource = read(VARS_FILE)

/**
 * `themeVar` 的 key → var 名。
 *
 * 两种引用形态都要认：CM6 那边直接写 `'var(--sepia-syn-keyword)'` 字面串
 *（CM6 的 API 收的就是字符串），Shiki 这边写 `themeVar.synKeyword`（类型上被
 * `SepiaVar` 约束住，写错名字编译不过）。**形态不同不代表其中一种不用查**——
 * 查不到就等于这条检查对那个文件空转，而空转的检查比没有检查更坏。
 */
const KEY_TO_VAR = new Map(
  [...varsSource.matchAll(/(\w+)\s*:\s*'var\(\s*(--[\w-]+)\s*\)'/g)].map((match) => [match[1], match[2]]),
)

function referencedVars(source) {
  const names = varNames(source)
  for (const match of source.matchAll(/themeVar\.(\w+)/g)) {
    const resolved = KEY_TO_VAR.get(match[1])
    names.push(resolved ?? `themeVar.${match[1]}（表里没有这个 key）`)
  }
  return names
}

const declared = new Set(varNames(varsSource))
if (declared.size === 0) {
  report.add('纪律 14', 'themeVar 表为空', VARS_FILE, '这条检查靠它当真相，空表意味着检查在空转')
}

for (const [file, label] of [
  [CM6_FILE, 'CM6 高亮'],
  [SHIKI_FILE, 'Shiki 主题'],
  [SHELL_CSS, 'shell 样式表'],
]) {
  const used = new Set(referencedVars(read(file)))
  for (const name of used) {
    if (declared.has(name)) continue
    report.add('纪律 14', `${label}用了 themeVar 表里没有的变量`, file, `${name} —— 色板的唯一真相是 ${VARS_FILE}`)
  }
  if (used.size === 0) {
    report.add('纪律 14', `${label}一个主题变量都没用到`, file, '不是它不需要颜色，是这条检查找错了地方')
  }
}

// C：themeVar 里的名字，theme.css 亮暗两套都要定义。
const palette = read(PALETTE_FILE)
const defined = new Set([...palette.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]))
for (const name of declared) {
  if (defined.has(name)) continue
  report.add('纪律 14', 'themeVar 声明了 theme.css 没定义的变量', PALETTE_FILE, `${name} —— 用它的地方会静默继承成别的颜色`)
}

// D：设置 schema 里的图标名，必须在 vendored 的图标表里真实存在。
//
// 形状与上面三道**完全一样**：一个文件里写名字、另一个文件里定义它。
// 之所以需要机器守，是因为 `SettingPage.icon` 只能是 `string`——core 是叶子包、
// 不许碰 React，也就够不到 `IconName` 那个联合类型（结构 3）。渲染处那句
// `as IconName` 是这条边上唯一的断言，名字写错的后果是**图标静默消失**，
// 而不是编译期报错。这一道就是替那句断言把关的。
const ICONS_FILE = 'packages/ui/src/icons/paths.ts'
const SCHEMA_FILE = 'packages/core/src/config/schema.ts'
const iconNames = new Set([...read(ICONS_FILE).matchAll(/^ {2}'([\w-]+)':$/gm)].map((match) => match[1]))
const usedIcons = [...read(SCHEMA_FILE).matchAll(/icon:\s*'([\w-]+)'/g)].map((match) => match[1])
for (const name of usedIcons) {
  if (iconNames.has(name)) continue
  report.add('纪律 14', '设置 schema 用了不存在的图标名', SCHEMA_FILE, `${name} —— 图标会静默消失，不会报错`)
}
if (usedIcons.length === 0) {
  report.add('纪律 14', 'schema 里一个图标名都没扫到', SCHEMA_FILE, '不是它不需要图标，是这条检查找错了地方')
}

report.note(
  `themeVar ${declared.size} 个 ｜ theme.css 定义 ${defined.size} 个 ｜ 图标 ${iconNames.size} 个 / schema 用 ${usedIcons.length} 处`,
)
report.finish('theme —— 色板同源 + 图标名真实存在（纪律 14）')
