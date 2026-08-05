import { isolateHistory } from '@codemirror/commands'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'

import type { MarkupRun } from '@sepia/core'

// 落笔——**AI 产出进入正文的唯一途径**（不变量 3「AI 不抢笔」的落地点）。
//
// 三条纪律在这一个函数里交汇，缺一条这个函数就不成立：
//   纪律 9c —— 落笔前做 compare-and-swap 校验，快照不匹配即中止
//   纪律 19 —— 单 transaction 且隔离为独立 undo 单元
//   纪律 2  —— 不碰未触及的字节（改动严格限制在 range 内）
//
// **为什么 CAS 对着编辑器现值校验，而不是对着磁盘**（150 §1.9 回流 3）：
// diff 是针对"提交那一刻的文本"算出来的，而生成期间用户可以继续写字。对着编辑器
// 现值比对着磁盘的 TOCTOU 窗口更小——磁盘上的字可能比编辑器里的还旧（防抖没落盘）。
//
// **类型层第五条（150 §1.4 #2，不变量级）**：入参是一个整体，没有"不带 expectedText"
// 的重载。002 §2.1 的元教训要求先问一遍「这个类型是危险操作的唯一通道吗」——
// 答案是**只有配合 `MountedEditor` 不暴露 view 才成立**：拿到 `EditorView` 的人
// 随时可以 `view.dispatch({ changes })` 绕过去。所以 `base.ts` 的 `MountedEditor`
// 刻意只交出方法、不交出 view；而 `app` 的 package.json 里没有 `@codemirror/*`，
// 它连 `EditorView` 的类型都拿不到（结构 2 的编译期物理约束）。两道墙合起来，
// renderer 侧才真的**只有这一条路**能改正文。

export interface MarkupRange {
  from: number
  to: number
}

export interface ApplyMarkupRequest {
  /** 目标区间，提交那一刻的坐标。 */
  range: MarkupRange
  /**
   * 提交那一刻 `range` 里的文本快照。**这个字段没有默认值、不可省略**——
   * 它就是 CAS 的 compare 那一半，省了它落笔就成了无条件覆盖。
   */
  expectedText: string
  /** 要落进去的新文本。 */
  replacement: string
}

export type ApplyMarkupResult =
  | { ok: true; range: MarkupRange }
  /** 区间越界：文档在生成期间被大幅改短。与 stale 分开报，便于提示措辞不同。 */
  | { ok: false; reason: 'out-of-range'; actualText: null }
  /** 快照不匹配：用户在生成期间动过这段字。**不落笔**，把现值交回去让上层提示。 */
  | { ok: false; reason: 'stale'; actualText: string }

export type MarkupPlan =
  | { ok: true; range: MarkupRange; spec: TransactionSpec }
  | { ok: false; reason: 'out-of-range'; actualText: null }
  | { ok: false; reason: 'stale'; actualText: string }

/**
 * 读出 `range` 当前的文本。
 * 走 `sliceDoc` 而不是 `doc.toString().slice()`——后者恒用 LF 拼行，CRLF 文件上
 * 取出来的快照会与写进去的字节不一致，CAS 就会在无人改字时假报 stale（不变量 2）。
 */
function currentText(state: EditorState, range: MarkupRange): string | null {
  if (range.from < 0 || range.to < range.from || range.to > state.doc.length) return null
  return state.sliceDoc(range.from, range.to)
}

/**
 * CAS 判定 + transaction 构造，**全部在 state 上完成，不碰 view**。
 *
 * 拆出这一层不是分层洁癖，是可测性（002 §1 的层级修正）：本仓库单测里没有 DOM，
 * `EditorView` 起不来。判定若焊死在 `applyMarkup` 里，CAS 这条**不变量级**的检查
 * 就只能靠 e2e——而 e2e 跑得慢、写得晚，纪律 9c 会在很长一段时间里没人守。
 * 现在它是个纯函数：给个 state 就能问"这一笔落不落得下去"。
 */
export function markupPlan(state: EditorState, request: ApplyMarkupRequest): MarkupPlan {
  const { range, expectedText, replacement } = request

  const actual = currentText(state, range)
  if (actual === null) return { ok: false, reason: 'out-of-range', actualText: null }
  // 纪律 9c 的那一行。删了它，"生成期间编辑正文则落笔中止而非覆盖"（DoD 二）当场失效。
  if (actual !== expectedText) return { ok: false, reason: 'stale', actualText: actual }

  return {
    ok: true,
    range: { from: range.from, to: range.from + replacement.length },
    spec: markupTransaction(range, replacement),
  }
}

/**
 * 落笔需要的**全部**编辑器能力：读 state、发 transaction。
 *
 * 刻意收窄到这两件事，而不是收 `EditorView`（`EditorView` 结构上满足它，真调用照旧）。
 * 收窄换来的是「落笔只 dispatch 一次」这条**能在单测里被证伪**：本仓库单测无 DOM，
 * 起不了真 view；参数是整个 view 时，把一次 dispatch 拆成两次（纪律 19 最典型的
 * 破法）只能等 e2e 才抓得到。收窄之后，测试传个记账用的桩就能数出 dispatch 次数。
 */
export interface MarkupTarget {
  readonly state: EditorState
  dispatch(spec: TransactionSpec): void
}

/**
 * 落笔。**同步返回结果**——调用方据此决定是提示重来还是收起浮层。
 *
 * 成功时正文被改，且这次改动是一次可整体撤销的原子编辑（⌘Z 一次撤干净）。
 * 失败时**一个字节都不动**。
 */
export function applyMarkup(
  target: MarkupTarget,
  request: ApplyMarkupRequest,
  /**
   * m5 的落点。**必填，不是可选**（纪律 22：全链埋点，口径固定）。
   * 做成可选就等于允许"先把功能跑通、打点回头补"——而回头补的打点永远比链路晚一个
   * stage，`markupReport` 拿到的时间轴永远缺一格，DoD 四（六点齐）就永远差一口气。
   */
  run: Pick<MarkupRun, 'mark'>,
): ApplyMarkupResult {
  const plan = markupPlan(target.state, request)
  if (!plan.ok) return plan
  // **只 dispatch 这一次。** 拆成两次（先删后插）会变成两个 history event，
  // ⌘Z 要按两下才撤干净——纪律 19 就是这么破的。
  target.dispatch(plan.spec)
  // 在 dispatch **之后**打——m5 的定义是"正文 transaction 提交完成"，
  // 提前打就把落笔耗时算漏了；中止路径上一个字节没动，自然也不该有 m5。
  run.mark('m5')
  return { ok: true, range: plan.range }
}

/**
 * 落笔的 transaction。**单独导出是为了能被单测直接检查形状**——
 * "是不是一个 transaction"这件事，只有拿到 spec 才断言得了；
 * 在 view 上事后看文档内容，拆成两次 dispatch 也是同样的结果（002 §1 第 5 层的
 * "写一条恒真的断言"就是这么发生的）。
 */
export function markupTransaction(range: MarkupRange, replacement: string): TransactionSpec {
  const to = range.from + replacement.length
  return {
    // 单次改动，且只覆盖 range——range 之外一个字节不碰（不变量 2）。
    changes: { from: range.from, to: range.to, insert: replacement },
    selection: EditorSelection.single(to),
    // 纪律 19：`"full"` 让这次改动前后都不与相邻编辑合并成一个 history event。
    // 不加它，用户落笔前刚敲的字会和落笔并进同一个 undo 单元，⌘Z 一次撤掉两样东西。
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
  }
}
