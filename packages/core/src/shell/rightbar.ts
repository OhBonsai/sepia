// 右侧区的占用语义（190 P0，原型 features F13/F16/F17/F18）。
//
// **右侧区只有一个，三种占用者互斥**：面板（连接/对话）、@ 双屏的第二编辑器、内嵌浏览器。
// 后来者顶替前一个，× 关回单纸。原文写死的那句是「**永远只有两栏**，
// 再 ⌘ 点新引用则替换右栏，不裂变多窗口」——所以这不是"三个可以同时开的东西"，
// 是"一个位置，谁来了谁占"。
//
// 做成纯状态机而不是三个 boolean：三个 boolean 有八种组合，其中五种是非法的，
// 而非法状态一旦能被表示出来，迟早有一条路径把它表示出来。

/** 右侧区当前是谁。null = 关着，纸占满整扇窗。 */
export type Rightbar =
  | { kind: 'threads' }
  | { kind: 'links' }
  /** @ 双屏：右栏是一个**完整的第二编辑器**（可编辑、可 markup），不是只读预览。 */
  | { kind: 'split'; path: string }
  /** 内嵌浏览器（F18）。 */
  | { kind: 'browser'; url: string }
  | null

/**
 * 开一个占用者。**同类再开一次 = 关掉**（切换语义，与 ⌘⇧H 同一个手感）；
 * 不同类 = 顶替。
 *
 * 「同类」对 split/browser 的判据是**连目标一起看**：⌘点击另一篇引用应当
 * 换掉右栏内容而不是把右栏关掉——原文「再 ⌘ 点新引用则替换右栏」。
 */
export function openRight(current: Rightbar, next: NonNullable<Rightbar>): Rightbar {
  if (current === null) return next
  if (current.kind !== next.kind) return next
  if (next.kind === 'split') return current.kind === 'split' && current.path === next.path ? null : next
  if (next.kind === 'browser') return current.kind === 'browser' && current.url === next.url ? null : next
  return null
}

/** 中缝宽度的边界。**不许把任何一侧拖没**——两栏都在，才叫双屏。 */
export const RIGHTBAR_MIN_PX = 280
export const RIGHTBAR_MAX_RATIO = 0.68

export function clampRightbar(width: number, windowWidth: number): number {
  const max = Math.max(RIGHTBAR_MIN_PX, Math.round(windowWidth * RIGHTBAR_MAX_RATIO))
  return Math.min(Math.max(Math.round(width), RIGHTBAR_MIN_PX), max)
}
