import { describe, expect, it } from 'vitest'

import {
  createMarkupRun,
  markupReport,
  MARKUP_BUDGET_MS,
  MARKUP_MARKS,
  MARKUP_MARK_MEANING,
  PERF_MARKS,
  type MarkupTimeline,
} from '../src/index.ts'

// 纪律 22（markup 全链埋 m0–m5，口径固定）的单测面。
// smoke 断言的是真链路上跑出来的时间轴，这里断言的是**判读口径本身**——
// 顺序错了、点少了、超预算了，`markupReport` 必须说得出来。

/** 假时钟：core 拿不到 performance，时钟本来就得由调用方传（见 marks.ts）。 */
function fakeClock(ticks: number[]): () => number {
  let index = 0
  return () => ticks[index++] ?? 0
}

describe('markup 打点 · 口径', () => {
  it('m0–m5 与启动 t0–t5 是两个命名空间，不共享任何名字', () => {
    // 150 §1.9 回流 2 的机器化：架构原文两处都叫 t0–t5，撞名就会混口径。
    const overlap = MARKUP_MARKS.filter((mark) => (PERF_MARKS as readonly string[]).includes(mark))
    expect(overlap).toEqual([])
  })

  it('六个点都有含义，没有占位空字符串', () => {
    for (const mark of MARKUP_MARKS) {
      expect(MARKUP_MARK_MEANING[mark].length).toBeGreaterThan(0)
    }
  })
})

describe('markup 打点 · 记录', () => {
  it('每个点只落一次，重复打点不覆盖', () => {
    const run = createMarkupRun(fakeClock([100, 200]))
    run.mark('m0')
    run.mark('m0')
    expect(run.timeline().m0).toBe(100)
  })

  it('timeline() 交出快照，之后再打点不影响已取走的那份', () => {
    const run = createMarkupRun(fakeClock([10, 20]))
    run.mark('m0')
    const taken = run.timeline()
    run.mark('m1')
    expect(taken.m1).toBeUndefined()
  })
})

const complete = (): MarkupTimeline => ({ m0: 0, m1: 20, m2: 300, m3: 800, m4: 6_000, m5: 6_100 })

describe('markup 打点 · 判读', () => {
  it('六点齐全、顺序正确、在预算内 → complete/ordered/withinBudget 全真', () => {
    const report = markupReport(complete())
    expect(report.complete).toBe(true)
    expect(report.ordered).toBe(true)
    expect(report.withinBudget).toBe(true)
    expect(report.segments.submitToDiff).toBe(6_000)
    expect(report.segments.apply).toBe(100)
  })

  it('吞掉任意一个点 → complete 为假，withinBudget 说不出话（null，不是 true）', () => {
    // §1.5 #9 的破坏方式就是"吞掉一个打点"。判读若拿半截时间轴报达标，
    // 那条 smoke 就永远抓不到它——所以这里逐个点都试一遍。
    for (const missing of MARKUP_MARKS) {
      const timeline = complete()
      delete timeline[missing]
      const report = markupReport(timeline)
      expect(report.complete).toBe(false)
      expect(report.withinBudget).toBeNull()
    }
  })

  it('顺序颠倒 → ordered 为假（链路接错了，比慢更严重）', () => {
    const report = markupReport({ ...complete(), m3: 5, m2: 900 })
    expect(report.ordered).toBe(false)
    expect(report.withinBudget).toBeNull()
  })

  it('全链超 15s（DoD 一）→ withinBudget 为假', () => {
    const over = MARKUP_BUDGET_MS.submitToDiff + 1
    const report = markupReport({ m0: 0, m1: 1, m2: 2, m3: 3, m4: over, m5: over + 10 })
    expect(report.complete).toBe(true)
    expect(report.ordered).toBe(true)
    expect(report.withinBudget).toBe(false)
  })

  it('落笔超 300ms → withinBudget 为假（m4→m5 也在账里，不是只看到 diff 为止）', () => {
    const timeline = complete()
    timeline.m5 = timeline.m4! + MARKUP_BUDGET_MS.apply + 1
    expect(markupReport(timeline).withinBudget).toBe(false)
  })
})
