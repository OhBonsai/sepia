import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import { baseExtensions } from '../src/base.ts'
import { markupHostExtension, setMarkupHost } from '../src/extensions/markup-host.ts'

// 浮层宿主（150 §1.8 风险 4）的 state 可判定部分。
//
// 「推开下文而非遮盖」是**布局**性质，单测里没有 DOM 布局，证不了——那部分归 smoke
// 的几何断言（选区行 top 不变、后一段 top 变大、浮层落在两者之间）。
// 这里守的是它的前提：装饰确实是**块级 widget**、位置在选区行尾、且随文档改动映射。

const DOC = '第一段。\n\n这里是要改的那一段。\n\n第三段。\n'

// 本包单测没有 DOM（也不该为这一条引 jsdom）。**state 层从不解引用这个节点**——
// 只有 view 层的 `toDOM` 会碰它，而那属于 smoke 的地盘。给个空壳正好把这件事说清楚：
// 装饰的位置、块级属性、随文档映射，全都与节点内容无关。
const fakeDom = {} as unknown as HTMLElement

function state(): EditorState {
  return EditorState.create({ doc: DOC, extensions: [baseExtensions(), markupHostExtension()] })
}

/** 从 state 里读出宿主装饰的区间与块级属性。 */
function hostRanges(current: EditorState): Array<{ from: number; block: boolean }> {
  const found: Array<{ from: number; block: boolean }> = []
  for (const set of current.facet(EditorView.decorations)) {
    if (typeof set === 'function') continue
    const cursor = set.iter()
    while (cursor.value !== null) {
      found.push({ from: cursor.from, block: cursor.value.spec.block === true })
      cursor.next()
    }
  }
  return found
}

describe('markup 浮层宿主', () => {
  it('默认没有宿主——不开 ⌘K 就不该有任何块级装饰', () => {
    expect(hostRanges(state())).toEqual([])
  })

  it('放置后是**块级** widget，且落在给定位置', () => {
    const pos = DOC.indexOf('这里是要改的那一段。') + '这里是要改的那一段。'.length
    const next = state().update({ effects: setMarkupHost.of({ pos, dom: fakeDom, height: 100 }) }).state
    expect(hostRanges(next)).toEqual([{ from: pos, block: true }])
  })

  it('文档在前面变长时宿主跟着移位，不会飘到别的段落去', () => {
    const pos = DOC.indexOf('这里是要改的那一段。') + '这里是要改的那一段。'.length
    let current = state().update({ effects: setMarkupHost.of({ pos, dom: fakeDom, height: 100 }) }).state
    current = current.update({ changes: { from: 0, insert: '开头插入的一句。' } }).state
    expect(hostRanges(current)).toEqual([{ from: pos + '开头插入的一句。'.length, block: true }])
  })

  it('收起后装饰清空', () => {
    let current = state().update({ effects: setMarkupHost.of({ pos: 5, dom: fakeDom, height: 100 }) }).state
    current = current.update({ effects: setMarkupHost.of(null) }).state
    expect(hostRanges(current)).toEqual([])
  })
})
