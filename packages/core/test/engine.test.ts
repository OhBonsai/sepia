import { describe, expect, it } from 'vitest'

import {
  ENGINE_BACKOFF,
  ENGINE_INITIAL,
  engineReduce,
  type EngineEvent,
  type EngineMachineState,
} from '../src/engine/index.ts'

// 退避状态机（140 §1.4 #6）：≤3 次重启 → 缺席稳态；就绪↔缺席迁移；稳定存活清零。
// 预定破坏方式（§1.5 ⑥）：去掉重启上限 → 「收敛到缺席」的断言必红。

function drive(state: EngineMachineState, events: EngineEvent[]) {
  let decision
  for (const event of events) {
    ;({ state, decision } = engineReduce(state, event))
  }
  return { state, decision }
}

describe('engineReduce', () => {
  it('spawn → starting，ready → ready', () => {
    const spawned = engineReduce(ENGINE_INITIAL, { type: 'spawn' })
    expect(spawned.state.status).toBe('starting')
    const ready = engineReduce(spawned.state, { type: 'ready' })
    expect(ready.state.status).toBe('ready')
    expect(ready.decision.kind).toBe('none')
  })

  it('连续速崩：恰好重启 3 次，然后收敛到缺席稳态', () => {
    let state = ENGINE_INITIAL
    const delays: number[] = []
    for (let crash = 0; crash < ENGINE_BACKOFF.maxRestarts; crash++) {
      const { state: next, decision } = engineReduce(state, { type: 'exit', uptimeMs: 100 })
      expect(decision.kind).toBe('restart')
      if (decision.kind === 'restart') delays.push(decision.delayMs)
      expect(next.status).toBe('starting')
      state = engineReduce(next, { type: 'spawn' }).state
    }
    // 第 4 次崩溃：放弃，进入缺席稳态，不再重启
    const final = engineReduce(state, { type: 'exit', uptimeMs: 100 })
    expect(final.decision.kind).toBe('give-up')
    expect(final.state.status).toBe('absent')
    expect(delays).toEqual([...ENGINE_BACKOFF.delaysMs])
  })

  it('「起来一秒就死」的循环也必须收敛——ready 不清零计数', () => {
    let state = ENGINE_INITIAL
    let sawAbsent = false
    // 上限的两倍次「ready 后立刻崩」。若 ready 清零计数，这个循环永远到不了缺席。
    for (let round = 0; round < ENGINE_BACKOFF.maxRestarts * 2; round++) {
      state = engineReduce(state, { type: 'spawn' }).state
      state = engineReduce(state, { type: 'ready' }).state
      const { state: next, decision } = engineReduce(state, { type: 'exit', uptimeMs: 1_000 })
      state = next
      if (decision.kind === 'give-up') {
        sawAbsent = true
        break
      }
    }
    expect(sawAbsent, '重启必须有上限——无上限的退避就是无退避').toBe(true)
    expect(state.status).toBe('absent')
  })

  it('稳定存活后崩溃：计数清零，重新获得完整的退避额度', () => {
    // 先烧掉两次额度
    const burned = drive(ENGINE_INITIAL, [
      { type: 'exit', uptimeMs: 0 },
      { type: 'spawn' },
      { type: 'exit', uptimeMs: 0 },
      { type: 'spawn' },
      { type: 'ready' },
    ]).state
    expect(burned.restarts).toBe(2)
    // 稳定存活超过 stableMs 后再崩：从头算
    const { state, decision } = engineReduce(burned, { type: 'exit', uptimeMs: ENGINE_BACKOFF.stableMs + 1 })
    expect(decision.kind).toBe('restart')
    expect(state.restarts).toBe(1)
    if (decision.kind === 'restart') expect(decision.delayMs).toBe(ENGINE_BACKOFF.delaysMs[0])
  })

  it('缺席是稳态：give-up 之后没有任何自动重启的决定', () => {
    const absent: EngineMachineState = { status: 'absent', restarts: 3 }
    const again = engineReduce(absent, { type: 'exit', uptimeMs: 0 })
    expect(again.decision.kind).toBe('give-up')
    expect(again.state.status).toBe('absent')
  })
})
