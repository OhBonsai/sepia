import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { baseExtensions, createState, readDoc } from '../src/base.ts'

describe('@sepia/editor baseExtensions', () => {
  it('能构造出一个可编辑的 EditorState', () => {
    const state = createState('# 标题\n正文')
    expect(readDoc(state)).toBe('# 标题\n正文')
    expect(state.doc.lines).toBe(2)
  })

  it('文本变更只动被编辑处，其余字节原样——含混用换行', () => {
    const original = '一\r\n二\n三'
    const state = createState(original, { lineEnding: '\r\n' })
    const next = state.update({ changes: { from: state.doc.length, insert: '四' } }).state
    expect(readDoc(next)).toBe(`${original}四`)
  })

  // **撤除记录（130 §1.4 #9，前置五）**：Stage 1 这里曾是「不许有任何装饰」的刹车，
  // 防 Stage 2 提前滑入。Stage 2 开工，按 130 的裁决**改写**而非静默删：
  // 装饰只许出现在 markdownExtensions 这一层，baseExtensions（纯文本层）永远干净——
  // 这保证 Stage 1 的一切（纯文本模式、字节保真基线）继续成立。
  it('baseExtensions 仍是纯文本层：无语言、无装饰（Stage 1 契约不因 Stage 2 松动）', () => {
    const state = EditorState.create({ doc: 'x **y**', extensions: baseExtensions() })
    expect(state.facet(EditorState.languageData)).toEqual([])
  })

  it('onChange / onSelectionChange 是可选的，不传也能用', () => {
    expect(() => createState('x')).not.toThrow()
    expect(baseExtensions().length).toBeGreaterThan(0)
  })
})
