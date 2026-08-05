import { describe, expect, it } from 'vitest'

import { diffWords, type DiffSegment } from '../src/index.ts'

// 150 §1.4 #6（diff 纯函数：词级对照的已知真值）。
//
// 每个用例都跑一遍**往返不变式**——它比任何一条真值断言都重要：
// 真值断言只说明这个例子对，往返不变式说明 diff 没有凭空造字或吞字。
// diff 骗人的后果不是难看，是用户照着一段并不存在的「原文」决定要不要落笔。

function rebuild(segments: DiffSegment[], side: 'original' | 'revised'): string {
  const keep = side === 'original' ? 'delete' : 'insert'
  return segments
    .filter((segment) => segment.op === 'equal' || segment.op === keep)
    .map((segment) => segment.text)
    .join('')
}

function expectRoundTrip(original: string, revised: string): DiffSegment[] {
  const segments = diffWords(original, revised)
  expect(rebuild(segments, 'original')).toBe(original)
  expect(rebuild(segments, 'revised')).toBe(revised)
  return segments
}

/** 相邻同 op 必须已被合并——碎片化的 diff 读不了（§1.8 风险 5）。 */
function expectMerged(segments: DiffSegment[]): void {
  for (let i = 1; i < segments.length; i++) {
    expect(segments[i]?.op).not.toBe(segments[i - 1]?.op)
  }
  for (const segment of segments) expect(segment.text).not.toBe('')
}

describe('词级 diff · 边界', () => {
  it('两段完全相同 → 一段 equal', () => {
    const segments = expectRoundTrip('没有改动。', '没有改动。')
    expect(segments).toEqual([{ op: 'equal', text: '没有改动。' }])
  })

  it('原文为空 → 纯 insert', () => {
    const segments = expectRoundTrip('', '凭空写出来的一段。')
    expect(segments).toEqual([{ op: 'insert', text: '凭空写出来的一段。' }])
  })

  it('新文为空 → 纯 delete', () => {
    const segments = expectRoundTrip('要被删掉的一段。', '')
    expect(segments).toEqual([{ op: 'delete', text: '要被删掉的一段。' }])
  })

  it('两段都为空 → 空结果，不产出空文本段', () => {
    const segments = expectRoundTrip('', '')
    expect(segments).toEqual([])
  })
})

describe('词级 diff · 已知真值', () => {
  it('中文改一个词：只标那个词，前后原样 equal', () => {
    const segments = expectRoundTrip('今天天气很好。', '今天天气不错。')
    expectMerged(segments)
    expect(rebuild(segments, 'original')).toContain('很好')
    // 改动被局部化：开头「今天天气」必须是 equal，不能整段划掉
    expect(segments[0]).toEqual({ op: 'equal', text: '今天天气' })
    expect(segments.some((segment) => segment.op === 'delete' && segment.text.includes('很好'))).toBe(true)
    expect(segments.some((segment) => segment.op === 'insert' && segment.text.includes('不错'))).toBe(true)
  })

  it('西文按词切，不把单词劈成字母', () => {
    const segments = expectRoundTrip('the quick brown fox', 'the quick red fox')
    expectMerged(segments)
    expect(segments.some((segment) => segment.op === 'delete' && segment.text === 'brown')).toBe(true)
    expect(segments.some((segment) => segment.op === 'insert' && segment.text === 'red')).toBe(true)
    // 若按字母切，'brown'→'red' 会命中公共的 'r'，diff 会碎成 r/e/d 三段
    expect(segments.filter((segment) => segment.op === 'insert')).toHaveLength(1)
  })

  it('纯追加：原文整段是 equal，新增部分是一段 insert', () => {
    const segments = expectRoundTrip('第一句。', '第一句。第二句。')
    expectMerged(segments)
    expect(segments).toEqual([
      { op: 'equal', text: '第一句。' },
      { op: 'insert', text: '第二句。' },
    ])
  })

  it('中英混排：中文按字、西文成词，空白与标点一个不丢', () => {
    const segments = expectRoundTrip('用 CodeMirror 写的编辑器。', '用 CodeMirror 做的编辑器。')
    expectMerged(segments)
    expect(segments.some((segment) => segment.op === 'delete' && segment.text === '写')).toBe(true)
    expect(segments.some((segment) => segment.op === 'insert' && segment.text === '做')).toBe(true)
  })

  it('保留空白与换行——拼得回原文才算数', () => {
    expectRoundTrip('第一行\n\n  缩进行  \n', '第一行\n\n  缩进过的行  \n')
  })
})

describe('词级 diff · 碎片化兜底（§1.8 风险 5）', () => {
  it('几乎重写 → 整段划掉重写，而不是碎成一地彩纸屑', () => {
    const original = '春天来了，山上的花都开了，孩子们跑出去玩。'
    const revised = '据统计，本季度营收同比增长十七个百分点。'
    const segments = expectRoundTrip(original, revised)
    expect(segments).toEqual([
      { op: 'delete', text: original },
      { op: 'insert', text: revised },
    ])
  })

  it('小幅修改 → 仍然走词级对照，不被兜底吞掉', () => {
    const original = '这套方案的关键在于把上下文显式喂给模型，而不是靠会话累积。'
    const revised = '这套方案的关键在于把上下文显式交给模型，而不是靠会话累积。'
    const segments = expectRoundTrip(original, revised)
    expectMerged(segments)
    // 兜底若误触发，结果只会有 delete+insert 两段
    expect(segments.filter((segment) => segment.op === 'equal').length).toBeGreaterThan(0)
    expect(segments.length).toBeGreaterThan(2)
  })
})
