import type { EditorView } from '@codemirror/view'

import type { MarkupRun } from '@sepia/core'

import { applyMarkup, type ApplyMarkupRequest } from '../src/markup.ts'
import type { MountedEditor } from '../src/base.ts'

// 纪律 9c 的**类型层断言**（150 §1.4 #2，**不变量级**）。这个文件不跑，只被 tsc 检查。
//
// 守的性质是一句话：**没有不带 `expectedText` 的落笔方式。**
// 002 §2.1 把它列为"模式而非技巧"——把危险操作设计成没有不安全的调用方式，
// 不安全的路径不存在，就不用检查它有没有被走。
//
// 同一节的元教训要求先自问「这个类型是危险操作的唯一通道吗」。诚实的答案：
// **单靠这个签名不是**——`view.dispatch({ changes })` 随时能绕过去。它成立靠两道墙：
//   ① `MountedEditor` 不交出 `EditorView`（下面第二组断言在守它）
//   ② `app` 的 package.json 里没有 `@codemirror/*`，连类型都够不到（结构 2）
// 少任何一道，这条纪律就退回"靠自觉"。

declare const view: EditorView
declare const runtimeText: string
declare const run: MarkupRun

// ── 第一组：落笔签名本身 ────────────────────────────────────────────────────

// @ts-expect-error 反例一：缺 expectedText——CAS 的 compare 那一半没了，落笔成了无条件覆盖
applyMarkup(view, { range: { from: 0, to: 3 }, replacement: 'new' }, run)

// @ts-expect-error 反例二：位置参数式调用，绕开整体入参
applyMarkup(view, { from: 0, to: 3 }, 'old', 'new')

// @ts-expect-error 反例三：expectedText 传 undefined 顶替"我不校验"
applyMarkup(view, { range: { from: 0, to: 3 }, expectedText: undefined, replacement: 'new' }, run)

// @ts-expect-error 反例四：range 摊平成两个裸数字——区间必须是一个整体，不能半途被改一个端点
applyMarkup(view, { from: 0, to: 3, expectedText: 'old', replacement: 'new' }, run)

// 正例：三件齐全才落得下去
const request: ApplyMarkupRequest = {
  range: { from: 0, to: 3 },
  expectedText: runtimeText,
  replacement: 'new',
}
applyMarkup(view, request, run)

// @ts-expect-error 反例五：不带打点——纪律 22 要求 m5 与落笔同生，不许回头补
applyMarkup(view, request)

// 正例二：`EditorView` 结构上满足收窄后的 MarkupTarget，真实调用不受收窄影响
export function realViewStillFits(): void {
  applyMarkup(view, request, run)
}

// ── 第二组：MountedEditor 不得交出 view ─────────────────────────────────────
// 这组不是形式主义：给 MountedEditor 加一个 `view` 字段是最顺手的一次"方便"，
// 加完之后第一组的断言全都还绿，而不变量 3 已经没了。

declare const editor: MountedEditor

// @ts-expect-error MountedEditor 上没有 view——有了它，落笔就不再是唯一途径
void editor.view

// @ts-expect-error 同理：不许交出 state
void editor.state

// 正例：落笔只能经这个方法
export function applyThroughMountedEditor(): void {
  const result = editor.applyMarkup(request, run)
  // 结果必须被判读——ok: false 时纸面没动，上层要提示重来（DoD 二的可见面）
  if (!result.ok) void result.reason
}
