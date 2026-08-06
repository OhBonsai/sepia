import { describe, expect, it } from 'vitest'

import { createCommitTriggers } from '../src/git/triggers.ts'
import type { CommitReason } from '../src/git/trailer.ts'

// §1.5 #2：三触发时序。**假计时器**——真等 5 分钟的测试没人会跑，
// 而竞态（静默与定时同时到点）只有把时间捏在手里才逼得出来。

/** 极小的假计时器：按到期时间排队，`advance` 推进虚拟时钟。 */
function fakeTimers() {
  let now = 0
  let seq = 0
  const queue = new Map<number, { at: number; fn: () => void }>()
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq
      queue.set(id, { at: now + ms, fn })
      return id
    },
    clearTimer: (handle: unknown) => queue.delete(handle as number),
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = [...queue.entries()]
          .filter(([, item]) => item.at <= target)
          .toSorted((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        queue.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = target
    },
  }
}

function harness(options: { idleMs?: number; intervalMs?: number } = {}) {
  const timers = fakeTimers()
  const commits: CommitReason[] = []
  const triggers = createCommitTriggers({
    idleMs: options.idleMs ?? 8_000,
    intervalMs: options.intervalMs ?? 300_000,
    onCommit: (reason) => commits.push(reason),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  return { timers, commits, triggers }
}

describe('commit 三触发', () => {
  it('静默到点提交一次，message 是 sepia: save', () => {
    const { timers, commits, triggers } = harness({ idleMs: 8_000 })
    triggers.touch()
    timers.advance(7_999)
    expect(commits, '还没到静默阈值').toEqual([])
    timers.advance(1)
    expect(commits).toEqual(['save'])
  })

  it('**一直在写就永远不静默提交**——静默等的是"这一阵子写完了"', () => {
    const { timers, commits, triggers } = harness({ idleMs: 8_000, intervalMs: 300_000 })
    for (let i = 0; i < 20; i++) {
      triggers.touch()
      timers.advance(5_000) // 每 5s 写一次，永远够不到 8s 静默
    }
    expect(commits).toEqual([])
  })

  it('但定时兜底会在这种人身上到点——否则他一整天都不会有 commit', () => {
    const { timers, commits, triggers } = harness({ idleMs: 8_000, intervalMs: 30_000 })
    for (let i = 0; i < 10; i++) {
      triggers.touch()
      timers.advance(5_000)
    }
    expect(commits).toEqual(['auto'])
  })

  it('**两条同时到点只许提交一次**（§1.8 风险 4 的竞态）', () => {
    // 阈值设成一样，让两条计时在同一刻到期
    const { timers, commits, triggers } = harness({ idleMs: 10_000, intervalMs: 10_000 })
    triggers.touch()
    timers.advance(10_000)
    expect(commits, '两条都 fire 的话这里会是两条').toHaveLength(1)
  })

  it('提交完 settled 之后没有新改动 → 不会再提交（不产生空 commit）', () => {
    const { timers, commits, triggers } = harness({ idleMs: 1_000, intervalMs: 5_000 })
    triggers.touch()
    timers.advance(1_000)
    expect(commits).toEqual(['save'])
    triggers.settled()
    timers.advance(60_000)
    expect(commits, '没有新的 touch，就没有第二次提交').toEqual(['save'])
  })

  it('stop 之后计时不再到点', () => {
    const { timers, commits, triggers } = harness({ idleMs: 1_000 })
    triggers.touch()
    triggers.stop()
    timers.advance(60_000)
    expect(commits).toEqual([])
    expect(triggers.dirty).toBe(false)
  })
})
