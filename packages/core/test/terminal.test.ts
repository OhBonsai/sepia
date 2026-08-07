import { describe, expect, it, vi } from 'vitest'

import { RETRY_DELAYS_MS, retryWithBackoff, shouldInterceptClose } from '../src/save/terminal.ts'

// 180 §1.4 #1 / #2：重试退避、拦截判定。
// 两条都用假计时器——真等 1+3+9 秒的测试没人会跑第二遍。

/**
 * 手搓的假钟。**不是不想用 `vi.useFakeTimers()`**——core 的 tsconfig 里既没有 DOM
 * 也没有 Node 的 lib，`setTimeout` 这个名字在这个包里根本不存在（连测试也一样）。
 * 与 `autosave.test.ts` 同一套手法，那边的注释解释了为什么这是好事。
 *
 * `advance` 是 async 的：`attempt` 返回 Promise，下一次重试排在它的 `.then` 里，
 * 不把微任务放完就看不到第二次。
 */
function clock() {
  let now = 0
  let seq = 0
  const queue = new Map<number, { at: number; fn: () => void }>()
  const timers = {
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq
      queue.set(id, { at: now + ms, fn })
      return id
    },
    clearTimer: (handle: unknown) => queue.delete(handle as number),
  }
  const advance = async (ms: number): Promise<void> => {
    const target = now + ms
    for (;;) {
      const due = [...queue.entries()]
        .filter(([, item]) => item.at <= target)
        .toSorted((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      queue.delete(due[0])
      now = due[1].at
      due[1].fn()
      // 放掉 attempt 那条 Promise 链，下一次重试才排得进来
      await Promise.resolve()
      await Promise.resolve()
    }
    now = target
  }
  return { timers, advance }
}

describe('写盘失败的重试退避', () => {

  it('阶梯就是 1s / 3s / 9s，写死不可配（180 刹车条款）', () => {
    expect([...RETRY_DELAYS_MS]).toEqual([1_000, 3_000, 9_000])
  })

  it('**三次之后停**，不是无限重试', async () => {
    const { timers, advance } = clock()
    const attempt = vi.fn(async () => false)
    const onExhausted = vi.fn()
    retryWithBackoff({ attempt, onExhausted, ...timers })

    await advance(1_000)
    expect(attempt).toHaveBeenCalledTimes(1)
    await advance(3_000)
    expect(attempt).toHaveBeenCalledTimes(2)
    await advance(9_000)
    expect(attempt).toHaveBeenCalledTimes(3)

    // 再等多久都不该有第四次——无限重试会让一块坏盘把 CPU 烧到天亮
    await advance(60_000)
    expect(attempt, '第四次重试出现了——这是无限重试').toHaveBeenCalledTimes(3)
    expect(onExhausted).toHaveBeenCalledTimes(1)
  })

  it('**成功即止**：第二次写成功了就不再排第三次，也不报耗尽', async () => {
    const { timers, advance } = clock()
    let calls = 0
    const attempt = vi.fn(async () => {
      calls += 1
      return calls === 2
    })
    const onExhausted = vi.fn()
    retryWithBackoff({ attempt, onExhausted, ...timers })

    await advance(1_000 + 3_000)
    expect(attempt).toHaveBeenCalledTimes(2)
    await advance(60_000)
    expect(attempt, '成功之后还在重试').toHaveBeenCalledTimes(2)
    expect(onExhausted, '成功了却报了耗尽').not.toHaveBeenCalled()
  })

  it('取消之后一次都不再试（换 page / 手动保存成功时要用）', async () => {
    const { timers, advance } = clock()
    const attempt = vi.fn(async () => false)
    const onExhausted = vi.fn()
    const handle = retryWithBackoff({ attempt, onExhausted, ...timers })
    handle.cancel()
    await advance(60_000)
    expect(attempt).not.toHaveBeenCalled()
    expect(onExhausted).not.toHaveBeenCalled()
  })
})

describe('关窗拦截判定', () => {
  it('脏 + 写盘不可用 → 拦', () => {
    expect(shouldInterceptClose({ dirty: true, writeExhausted: true })).toBe(true)
  })

  // **这三条才是重点。** 误拦比漏拦严重得多：漏拦丢的是最后几个字（而且那时写盘
  // 本来就是坏的，拦住也存不进去）；误拦是每次退出都弹框，把架构 §4.9 里
  // "唯一的例外"变成日常噪音。检查 #2 的破坏方向因此瞄的是这一半。
  it('**只脏、写盘好好的 → 不拦**（自动写盘会处理，弹框纯属打扰）', () => {
    expect(shouldInterceptClose({ dirty: true, writeExhausted: false })).toBe(false)
  })

  it('**写盘坏了但没有脏字 → 不拦**（没有东西会丢）', () => {
    expect(shouldInterceptClose({ dirty: false, writeExhausted: true })).toBe(false)
  })

  it('**什么都没发生 → 不拦**', () => {
    expect(shouldInterceptClose({ dirty: false, writeExhausted: false })).toBe(false)
  })
})
