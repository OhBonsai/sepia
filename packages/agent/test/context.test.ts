import { describe, expect, it } from 'vitest'

import {
  assembleContext,
  estimateTokens,
  toUserMessage,
  type ContextBlock,
} from '../src/tasks/context.ts'

// 150 §1.4 #5（上下文组装：衰减链顺序、预算硬截断、@content 块）。

function block(kind: ContextBlock['kind'], distance: number, text: string): ContextBlock {
  return { kind, text, distance }
}

const SELECTION = block('selection', 0, '这是被选中的那一段。')

describe('上下文组装 · 衰减链顺序', () => {
  it('选区永远第一，其余按距离由近及远', () => {
    const assembled = assembleContext(
      [block('nearby', 3, '远'), SELECTION, block('nearby', 1, '近'), block('nearby', 2, '中')],
      { budgetTokens: 1_000 },
    )
    expect(assembled.blocks.map((entry) => entry.text)).toEqual(['这是被选中的那一段。', '近', '中', '远'])
  })

  it('距离相同则保持调用方给的顺序（前后文的先后不该被打乱）', () => {
    const assembled = assembleContext(
      [SELECTION, block('nearby', 1, '前一段'), block('nearby', 1, '后一段')],
      { budgetTokens: 1_000 },
    )
    expect(assembled.blocks.slice(1).map((entry) => entry.text)).toEqual(['前一段', '后一段'])
  })
})

describe('上下文组装 · 预算硬截断', () => {
  it('超预算的远块被丢掉，truncated 为真', () => {
    const assembled = assembleContext(
      [SELECTION, block('nearby', 1, '一'.repeat(20)), block('nearby', 2, '二'.repeat(20))],
      { budgetTokens: estimateTokens(SELECTION.text) + 20 },
    )
    expect(assembled.truncated).toBe(true)
    expect(assembled.blocks.map((entry) => entry.kind)).toEqual(['selection', 'nearby'])
    expect(assembled.blocks[1]?.text.startsWith('一')).toBe(true)
  })

  it('装得下就不报截断', () => {
    const assembled = assembleContext([SELECTION, block('nearby', 1, '短')], { budgetTokens: 1_000 })
    expect(assembled.truncated).toBe(false)
    expect(assembled.blocks).toHaveLength(2)
  })

  it('选区自己超预算也照进——截掉它请求就没有主语了', () => {
    const long = block('selection', 0, '字'.repeat(500))
    const assembled = assembleContext([long, block('nearby', 1, '前后文')], { budgetTokens: 10 })
    expect(assembled.blocks[0]).toEqual(long)
    expect(assembled.estimatedTokens).toBeGreaterThan(10)
  })

  it('撞上一个长块不会连累它后面的短块（不是 break 是 continue）', () => {
    const assembled = assembleContext(
      [SELECTION, block('nearby', 1, '长'.repeat(200)), block('nearby', 2, '短')],
      { budgetTokens: estimateTokens(SELECTION.text) + 5 },
    )
    expect(assembled.truncated).toBe(true)
    expect(assembled.blocks.map((entry) => entry.text)).toContain('短')
  })

  it('没有邻近块时也能组装（空手 ⌘K 之外，文档只有一段的情形）', () => {
    const assembled = assembleContext([SELECTION], { budgetTokens: 1_000 })
    expect(assembled.blocks).toEqual([SELECTION])
    expect(assembled.truncated).toBe(false)
  })
})

describe('上下文组装 · @content 块', () => {
  it('at-content 与 nearby 一同参与衰减与截断', () => {
    const assembled = assembleContext(
      [SELECTION, block('at-content', 5, '被引用的别处内容'), block('nearby', 1, '邻近')],
      { budgetTokens: 1_000 },
    )
    expect(assembled.blocks.map((entry) => entry.kind)).toEqual(['selection', 'nearby', 'at-content'])
  })

  it('user message 里 @content 与前后文都标了「不要改写」，只有选区是要改的', () => {
    const assembled = assembleContext(
      [SELECTION, block('at-content', 5, '引用'), block('nearby', 1, '邻近')],
      { budgetTokens: 1_000 },
    )
    const message = toUserMessage(assembled, '润色')
    expect(message).toContain('要改写的原文')
    expect(message.match(/不要改写/g)).toHaveLength(2)
    // 选区放最后，紧挨着要求——离指令最近的内容最不容易被模型忽略
    expect(message.indexOf('要改写的原文')).toBeGreaterThan(message.indexOf('前后文'))
    expect(message).toContain('润色')
  })
})

describe('token 估算', () => {
  it('CJK 一字约一 token，西文约四字符一 token', () => {
    expect(estimateTokens('中文四个字')).toBe(5)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('')).toBe(0)
  })

  it('中英混排分开数，不会因为一侧长而整体偏', () => {
    expect(estimateTokens('中文abcd')).toBe(estimateTokens('中文') + estimateTokens('abcd'))
  })
})
