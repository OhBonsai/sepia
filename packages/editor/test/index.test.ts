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

  it('**本 stage 不许有任何装饰**——Stage 2 才做 A/B/C/D 四类', () => {
    // 装饰会通过 EditorView 的 decorations facet 生效。没有 view 时，
    // 至少可以断言扩展集里没有引入 markdown 语言（有语言就必有高亮装饰）。
    const state = EditorState.create({ doc: 'x', extensions: baseExtensions() })
    expect(state.facet(EditorState.languageData)).toEqual([])
  })

  it('onChange / onSelectionChange 是可选的，不传也能用', () => {
    expect(() => createState('x')).not.toThrow()
    expect(baseExtensions().length).toBeGreaterThan(0)
  })
})
