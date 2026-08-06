import { describe, expect, it } from 'vitest'

import { createAutosaveTimer } from '../src/save/autosave.ts'

// 自动写盘计时器。破坏方式瞄的是 §1.8 风险 1 的两个事故：
// **组合期间写盘**（盘上出现拼音）与 **组合中途失焦后再也不写**（自动保存静默停摆）。

function harness(delayMs = 800) {
  let now = 0
  let seq = 0
  const queue = new Map<number, { at: number; fn: () => void }>()
  const fired: number[] = []
  const timer = createAutosaveTimer({
    delayMs,
    onFire: () => fired.push(now),
    setTimer: (fn, ms) => {
      const id = ++seq
      queue.set(id, { at: now + ms, fn })
      return id
    },
    clearTimer: (handle) => queue.delete(handle as number),
  })
  const advance = (ms: number): void => {
    const target = now + ms
    for (;;) {
      const due = [...queue.entries()].filter(([, item]) => item.at <= target).toSorted((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      queue.delete(due[0])
      now = due[1].at
      due[1].fn()
    }
    now = target
  }
  return { timer, fired, advance }
}

describe('自动写盘计时器', () => {
  it('停止输入满 delay 才写，一次', () => {
    const { timer, fired, advance } = harness(800)
    timer.bump()
    advance(799)
    expect(fired).toEqual([])
    advance(1)
    expect(fired).toHaveLength(1)
  })

  it('连续打字不断重排——打字期间一次都不写', () => {
    const { timer, fired, advance } = harness(800)
    for (let i = 0; i < 20; i++) {
      timer.bump()
      advance(100)
    }
    expect(fired).toEqual([])
    advance(800)
    expect(fired).toHaveLength(1)
  })

  it('**组合期间不写盘**：suspend 之后无论敲多少下、等多久都不写', () => {
    const { timer, fired, advance } = harness(800)
    timer.bump()
    timer.suspend() // compositionstart
    for (let i = 0; i < 10; i++) {
      timer.bump() // 组合中每敲一下都会 bump
      advance(500)
    }
    expect(fired, '这一刻写下去，盘上就是拼音').toEqual([])
    expect(timer.suspended).toBe(true)
    expect(timer.pending).toBe(true)
  })

  it('组合结束后重新计时，然后才写', () => {
    const { timer, fired, advance } = harness(800)
    timer.bump()
    timer.suspend()
    advance(5_000)
    timer.resume() // compositionend
    expect(fired, '解挂那一刻不许立刻写——"停止输入 800ms"这条语义不能被偷偷改掉').toEqual([])
    advance(800)
    expect(fired).toHaveLength(1)
  })

  it('**组合中途失焦也要解挂**——否则自动保存从此静默停摆', () => {
    const { timer, fired, advance } = harness(800)
    timer.bump()
    timer.suspend() // 组合开始
    // 用户直接切走窗口：compositionend 可能永远不来，只有 blur
    timer.resume() // blur 走的是同一个解挂口
    advance(800)
    expect(fired, '失焦不解挂的话，这里永远是 0——那才是真正的事故').toHaveLength(1)
  })

  it('没有改动时解挂不会凭空写一次', () => {
    const { timer, fired, advance } = harness(800)
    timer.suspend()
    timer.resume()
    advance(5_000)
    expect(fired).toEqual([])
  })

  it('cancel 之后不再写（⌘S 已经存过了）', () => {
    const { timer, fired, advance } = harness(800)
    timer.bump()
    timer.cancel()
    advance(5_000)
    expect(fired).toEqual([])
    expect(timer.pending).toBe(false)
  })
})
