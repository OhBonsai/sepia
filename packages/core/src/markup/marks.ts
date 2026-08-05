import {
  MARKUP_BUDGET_MS,
  MARKUP_MARKS,
  type MarkupMark,
  type MarkupTimeline,
} from '../types/index.ts'

// markup 全链打点的记录与判读（纪律 22）。
//
// 与启动打点（app/main/services/perf.ts）有两处**刻意的形状差异**：
//
//   1. **不是模块级单例，是每轮一个实例。** 启动只发生一次，markup 一篇文章里能发生
//      几十次，还能并发（追问排队 / 转向）。做成单例，第二轮的 m0 就会被第一轮的
//      "每个点只打一次"挡掉，打出来的账全是第一轮的。
//   2. **顺序是被断言的性质，不是被假定的。** 六个点跨 renderer → main → 引擎 → 回来，
//      任一段吞掉一个点，时间轴仍然"看起来有数"。所以 `markupReport` 显式检查单调，
//      让"吞掉一个打点"变成红的（150 §1.5 #9 的破坏方式就是它）。

export interface MarkupRun {
  mark(name: MarkupMark): void
  timeline(): MarkupTimeline
}

/**
 * 时钟**必须由调用方传**，没有默认值。
 * core 的 tsconfig 是 `types: []`（结构 3：拿不到 node / dom 的全局类型），
 * `performance` 在这里压根不存在——这不是要绕开的障碍，是包边界在说对的话：
 * 谁知道自己跑在哪个环境，谁提供时钟。单测顺带拿到一个可控的假时钟。
 */
export function createMarkupRun(now: () => number): MarkupRun {
  const timeline: MarkupTimeline = {}
  return {
    mark(name) {
      if (timeline[name] !== undefined) return
      timeline[name] = now()
    },
    timeline: () => ({ ...timeline }),
  }
}

export interface MarkupSegments {
  submitToFirstToken: number | undefined
  firstTokenToDiff: number | undefined
  submitToDiff: number | undefined
  apply: number | undefined
}

export interface MarkupReport {
  timeline: MarkupTimeline
  /** 六点是否齐全。缺一个就不齐——**不允许"差不多齐"**（DoD 四）。 */
  complete: boolean
  /** 已落的点是否严格按 m0→m5 递增。乱序即链路接错了，比慢更严重。 */
  ordered: boolean
  segments: MarkupSegments
  /** 六点未齐时为 null——没数就说没数，不许拿半截时间轴报"达标"。 */
  withinBudget: boolean | null
}

export function markupReport(timeline: MarkupTimeline): MarkupReport {
  const complete = MARKUP_MARKS.every((name) => timeline[name] !== undefined)

  let previous = Number.NEGATIVE_INFINITY
  let ordered = true
  for (const name of MARKUP_MARKS) {
    const at = timeline[name]
    if (at === undefined) continue
    if (at < previous) ordered = false
    previous = at
  }

  const span = (from: MarkupMark, to: MarkupMark): number | undefined => {
    const a = timeline[from]
    const b = timeline[to]
    return a === undefined || b === undefined ? undefined : Math.round(b - a)
  }

  const segments: MarkupSegments = {
    submitToFirstToken: span('m0', 'm3'),
    firstTokenToDiff: span('m3', 'm4'),
    submitToDiff: span('m0', 'm4'),
    apply: span('m4', 'm5'),
  }

  const withinBudget =
    complete && ordered
      ? segments.submitToFirstToken! <= MARKUP_BUDGET_MS.submitToFirstToken &&
        segments.firstTokenToDiff! <= MARKUP_BUDGET_MS.firstTokenToDiff &&
        segments.submitToDiff! <= MARKUP_BUDGET_MS.submitToDiff &&
        segments.apply! <= MARKUP_BUDGET_MS.apply
      : null

  return { timeline: { ...timeline }, complete, ordered, segments, withinBudget }
}
