import { describe, expect, it } from 'vitest'

import {
  advanceReveal,
  isBoundary,
  revealAtOnce,
  snapBack,
  REVEAL_BATCH_MS,
  REVEAL_INITIAL,
  type RevealState,
} from '../src/index.ts'

// 150 §1.4 #7（流式不变量：单调只增、冻结判定、批次边界）。
//
// 002 §1 的层级修正说清楚了这一层该测什么：**state 可判定的性质**。
// 「看起来舒不舒服」证不了，归 1.6b 真人走查；「有没有回退」证得了，归这里。

/** 把一次完整的流跑完，返回每一批的 revealed 序列。 */
function runStream(chunks: string[], frozenAtEnd = true): number[] {
  let state: RevealState = REVEAL_INITIAL
  let received = ''
  const trail: number[] = []
  for (const chunk of chunks) {
    received += chunk
    // 一个 chunk 可能要好几批才揭完——批次由时钟驱动，不由到达驱动
    for (let i = 0; i < 100 && state.revealed < received.length; i++) {
      const next = advanceReveal(state, received, false)
      if (next.revealed === state.revealed) break
      state = next
      trail.push(state.revealed)
    }
  }
  if (frozenAtEnd) {
    state = advanceReveal(state, received, true)
    trail.push(state.revealed)
  }
  return trail
}

describe('流式揭示 · 单调只增', () => {
  it('整条流里 revealed 从不回退', () => {
    const trail = runStream(['这是第一', '段流式文本，', '接着又来了一些内容。'])
    for (let i = 1; i < trail.length; i++) {
      expect(trail[i]!).toBeGreaterThanOrEqual(trail[i - 1]!)
    }
  })

  it('已揭示的位置是地板：下一批只能从它继续，不能从头再算', () => {
    // **这条是区分「有没有单调保护」的那条**（首轮反向验证的教训）：
    // 前几条断言在把 floor 改成 0 之后照样绿——因为它们都从 revealed=0 起步，
    // 看不出「重新从头算」和「从已揭示处继续」的差别。这里让 state 先走远，
    // 再看下一批是不是退回批次长度那一点点。
    const text = '这是一段足够长的流式文本，长到一个批次远远揭不完它的全部内容。'
    const state: RevealState = { revealed: 20, frozen: false }
    const next = advanceReveal(state, text, false)
    expect(next.revealed).toBeGreaterThanOrEqual(20)
  })

  it('上游把 received 发短了也不吞字（防御性，不该发生）', () => {
    const state: RevealState = { revealed: 10, frozen: false }
    const next = advanceReveal(state, '短', false)
    expect(next.revealed).toBeLessThanOrEqual('短'.length)
  })
})

describe('流式揭示 · 冻结即定', () => {
  it('冻结时一次性揭示到底', () => {
    const next = advanceReveal(REVEAL_INITIAL, '很长的一段文字'.repeat(10), true)
    expect(next.frozen).toBe(true)
    expect(next.revealed).toBe('很长的一段文字'.repeat(10).length)
  })

  it('冻结后再推进也不变（定了就是定了）', () => {
    const text = '定稿内容。'
    const frozen = advanceReveal(REVEAL_INITIAL, text, true)
    expect(advanceReveal(frozen, text, true)).toEqual(frozen)
  })

  it('reduced-motion 整块秒显，等价于直接冻结', () => {
    const text = '整块秒显的内容。'
    expect(revealAtOnce(text)).toEqual({ revealed: text.length, frozen: true })
  })
})

describe('流式揭示 · 批次与边界', () => {
  it('节奏与到达率解耦：一次收到一大段也按批次推进，不一步到位', () => {
    const huge = '这是一次性到达的很长的一段文字，足够长到必须分好几批。'
    const first = advanceReveal(REVEAL_INITIAL, huge, false)
    expect(first.revealed).toBeGreaterThan(0)
    expect(first.revealed).toBeLessThan(huge.length)
  })

  it('西文不在单词中间断开', () => {
    const text = 'internationalization and localization'
    let state = REVEAL_INITIAL
    for (let i = 0; i < 10; i++) {
      state = advanceReveal(state, text, false)
      const cut = text.slice(0, state.revealed)
      // 断点要么在词尾，要么整段还没到词尾——不能出现「半个词 + 后面还有字母」
      if (state.revealed < text.length) {
        expect(isBoundary(text, state.revealed)).toBe(true)
      }
      expect(text.startsWith(cut)).toBe(true)
    }
  })

  it('中文每个字都是边界（没有词间空格，逐字揭示是对的）', () => {
    const text = '中文逐字揭示'
    for (let i = 1; i < text.length; i++) expect(isBoundary(text, i)).toBe(true)
  })

  it('长词跨批次时整词一次给出，不切成两半', () => {
    // 'internationalization'（20 字符）比一个批次长。切一半再补全是最扎眼的抖动，
    // 所以宁可超批次也要整词给出——这条是实施中被单测逼出来的（初版切在第 12 字符）。
    const text = 'internationalization and localization'
    const first = advanceReveal(REVEAL_INITIAL, text, false)
    expect(text.slice(0, first.revealed)).toBe('internationalization')
  })

  it('末尾是没写完的长词 → 本批不推进，等下一批（不揭半个词）', () => {
    const text = 'a'.repeat(200)
    expect(advanceReveal(REVEAL_INITIAL, text, false).revealed).toBe(0)
  })

  it('等待不会卡死：后续字节带来断点就继续，流结束则一次揭到底', () => {
    const pending = 'a'.repeat(200)
    const stalled = advanceReveal(REVEAL_INITIAL, pending, false)
    expect(stalled.revealed).toBe(0)
    // 断点到了 → 继续推进
    expect(advanceReveal(stalled, `${pending} 后续`, false).revealed).toBeGreaterThan(0)
    // 流结束 → 一次到底
    expect(advanceReveal(stalled, pending, true).revealed).toBe(pending.length)
  })

  it('snapBack 找不到断点时退回 floor，绝不退到 floor 以下（破单调性）', () => {
    expect(snapBack('aaaa bbbb', 7, 5)).toBe(5)
    expect(snapBack('aaaa bbbb', 7, 0)).toBe(5)
  })

  it('批次常量是 24ms（§1.2 写死的节奏，改它要一起改 plan）', () => {
    expect(REVEAL_BATCH_MS).toBe(24)
  })
})
