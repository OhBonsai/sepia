import type { EditorView } from '@codemirror/view'

import {
  type ToggleResult,
  indentLines,
  listContinuation,
  toggleCodeFence,
  toggleHeading,
  toggleInline,
  toggleLinePrefix,
  toggleLink,
} from '@sepia/core'

import { readDoc } from '../bytes.ts'

// F2 标准快捷键集的 CM6 接线（190 P1 / D-26）。
//
// **判断全在 core**（`markdown/toggle.ts`，23 条单测盯着），这里只做两件事：
// 把 doc 交出去、把 edits 落回来。分开的理由与别处一样——判断可以单测，
// 落盘要真编辑器；混在一起就只剩"起个编辑器测一切"这一条路，于是没人写测试。
//
// **字节改动走正常编辑事务**：不是 `replaceGuarded`（那是 AI 落笔的 CAS 通道，
// 不变量 3 管的是"AI 产出进正文"）。用户自己按 ⌘B 是用户在写字，
// 与敲键盘同一性质，走同一条路——它天然进 undo 历史，⌘Z 一下就回来。

/** 把 core 算出来的 edits 落到 view 上。 */
function dispatch(view: EditorView, result: ToggleResult): boolean {
  if (result.edits.length === 0) return true
  view.dispatch({
    changes: result.edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.insert })),
    selection: { anchor: result.selection.from, head: result.selection.to },
    scrollIntoView: true,
  })
  return true
}

function withSelection(view: EditorView, run: (text: string, from: number, to: number) => ToggleResult | null): boolean {
  const { from, to } = view.state.selection.main
  // `readDoc` 而不是 `doc.toString()`：后者恒用 '\n' 拼行，CRLF 文件会被静默规范化
  const result = run(readDoc(view.state), from, to)
  if (result === null) return false
  return dispatch(view, result)
}

export const formatCommands = {
  bold: (view: EditorView): boolean => withSelection(view, (text, from, to) => toggleInline(text, from, to, '**')),
  italic: (view: EditorView): boolean => withSelection(view, (text, from, to) => toggleInline(text, from, to, '*')),
  code: (view: EditorView): boolean => withSelection(view, (text, from, to) => toggleInline(text, from, to, '`')),
  strike: (view: EditorView): boolean => withSelection(view, (text, from, to) => toggleInline(text, from, to, '~~')),
  link: (view: EditorView): boolean => withSelection(view, (text, from, to) => toggleLink(text, from, to)),
  heading:
    (level: number) =>
    (view: EditorView): boolean =>
      withSelection(view, (text, from) => toggleHeading(text, from, level)),
  quote: (view: EditorView): boolean => withSelection(view, (text, from, to) => toggleLinePrefix(text, from, to, 'quote')),
  bullet: (view: EditorView): boolean =>
    withSelection(view, (text, from, to) => toggleLinePrefix(text, from, to, 'bullet')),
  ordered: (view: EditorView): boolean =>
    withSelection(view, (text, from, to) => toggleLinePrefix(text, from, to, 'ordered')),
  codeBlock: (view: EditorView): boolean => withSelection(view, (text, from, to) => toggleCodeFence(text, from, to)),
  /**
   * Enter：是列表就续行/退出，不是就 **返回 false 交回默认行为**。
   * 返回 true 会把普通换行也吃掉——那是最容易犯又最难查的一种"编辑器坏了"。
   */
  enter: (view: EditorView): boolean => withSelection(view, (text, from, to) => (from === to ? listContinuation(text, from) : null)),
  indent:
    (width: number, out: boolean) =>
    (view: EditorView): boolean =>
      withSelection(view, (text, from, to) => indentLines(text, from, to, width, out)),
}
