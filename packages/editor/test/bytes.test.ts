import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { createState, readDoc } from '../src/base.ts'
import { BOM, detectLineEnding, readFidelity, writeFidelity } from '../src/bytes.ts'

// 不变量 2：未触及的字节逐字节保留，不做全文规范化。**无豁免。**
// 这一组用例守的是一个具体且真实的失败——CM6 默认会把 CRLF 改成 LF。

describe('换行风格检出', () => {
  it('LF / CRLF / CR / 无换行', () => {
    expect(detectLineEnding('a\nb')).toBe('\n')
    expect(detectLineEnding('a\r\nb')).toBe('\r\n')
    expect(detectLineEnding('a\rb')).toBe('\r')
    expect(detectLineEnding('只有一行')).toBe('\n')
  })

  it('取第一个出现的，不做多数投票——投票会让混用换行的文件被同化', () => {
    expect(detectLineEnding('a\r\nb\nc\nd')).toBe('\r\n')
    expect(detectLineEnding('a\nb\r\nc\r\nd')).toBe('\n')
  })
})

describe('BOM', () => {
  it('摘出来单独记着，不进文档正文', () => {
    const { fidelity, body } = readFidelity(`${BOM}# 标题`)
    expect(fidelity.bom).toBe(true)
    expect(body).toBe('# 标题')
    expect(writeFidelity(body, fidelity)).toBe(`${BOM}# 标题`)
  })

  it('没有 BOM 就不要凭空加一个', () => {
    const { fidelity, body } = readFidelity('# 标题')
    expect(fidelity.bom).toBe(false)
    expect(writeFidelity(body, fidelity)).toBe('# 标题')
  })
})

describe('过 CM6 一趟之后仍然逐字节一致', () => {
  const fixtures: Array<[string, string]> = [
    ['LF', 'a\nb\nc\n'],
    ['CRLF', 'a\r\nb\r\nc\r\n'],
    ['CR（老 Mac）', 'a\rb\rc\r'],
    ['无尾换行', 'a\nb'],
    ['CRLF 且无尾换行', 'a\r\nb'],
    ['混用换行', 'a\r\nb\nc\r\nd'],
    ['带 BOM 的 CRLF', `${BOM}# 标题\r\n正文\r\n`],
    ['非 ASCII 与 emoji', '中文 · 日本語 · 🌱\n第二行\n'],
    ['空文件', ''],
    ['只有换行', '\n\n\n'],
    ['超长行', `${'x'.repeat(20000)}\n`],
  ]

  for (const [name, original] of fixtures) {
    it(name, () => {
      const { fidelity, body } = readFidelity(original)
      const state = createState(body, { lineEnding: fidelity.lineEnding })
      const roundTripped = writeFidelity(readDoc(state), fidelity)
      expect(roundTripped).toBe(original)
    })
  }

  // 这两条是**反证**：记录 CM6 原生的两个默认各自有多危险，
  // 以及 baseExtensions / readDoc 分别堵的是哪一个。删掉它们，下次有人"简化"回去时就没人拦。
  it('反证一：CM6 不设 lineSeparator 时会把 CRLF 规范化成 LF', () => {
    const crlf = 'a\r\nb'
    const naked = EditorState.create({ doc: crlf })
    expect(naked.sliceDoc()).toBe('a\nb')
    // baseExtensions 恒设 lineSeparator，于是 '\r' 要么是分隔符的一半、要么是行内容，都不会被吞
    expect(readDoc(createState(crlf))).toBe(crlf)
    expect(readDoc(createState(crlf, { lineEnding: '\r\n' }))).toBe(crlf)
  })

  it('反证二：doc.toString() 恒用 LF 拼行，与 lineSeparator 无关', () => {
    const state = createState('a\r\nb', { lineEnding: '\r\n' })
    expect(state.doc.toString()).toBe('a\nb') // ← 错的，但看起来最自然
    expect(readDoc(state)).toBe('a\r\nb') // ← 对的，所以取全文只许走 readDoc
  })
})
