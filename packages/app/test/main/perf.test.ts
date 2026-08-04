import { describe, expect, it } from 'vitest'

import { PERF_MARKS, PERF_MARK_MEANING, STARTUP_BUDGET_MS } from '@sepia/core'

import { getTimeline, mark, report } from '../../src/main/services/perf.ts'

// 纪律 12（启动同步路径只允许窗口、单文件与 CM6）的强制手段就是打点断言。
// 这里守的是打点本身的口径；预算是否达标由 smoke 在真启动里断言。

describe('启动打点', () => {
  it('t0 在模块加载时就已经落点——不是等到 whenReady', () => {
    expect(getTimeline().t0).toBeTypeOf('number')
  })

  it('每个点只打一次，重复打点不覆盖', () => {
    mark('t1')
    const first = getTimeline().t1
    mark('t1')
    expect(getTimeline().t1).toBe(first)
  })

  it('六个点都有明确的口径说明——纪律 22 要求口径固定', () => {
    for (const name of PERF_MARKS) {
      expect(PERF_MARK_MEANING[name]).toBeTruthy()
    }
    expect(PERF_MARKS).toEqual(['t0', 't1', 't2', 't3', 't4', 't5'])
  })

  it('没攒齐时 complete 为 false，且不谎报达标', () => {
    const partial = report()
    if (!partial.complete) expect(partial.withinBudget).toBeNull()
  })

  it('攒齐后按预算判定，且预算读自 core 而不是测试里另抄一份数字', () => {
    for (const name of PERF_MARKS) mark(name)
    const done = report()
    expect(done.complete).toBe(true)
    expect(done.segments.coldStartToWritable).toBeTypeOf('number')
    expect(STARTUP_BUDGET_MS.coldStartToWritable).toBe(1000)
    // 单测里这几个点几乎同时落，理应远在预算内
    expect(done.withinBudget).toBe(true)
  })
})
