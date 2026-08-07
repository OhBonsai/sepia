import type { EditorState } from '@codemirror/state'

// 字节保真的三件小事。**不变量 2 的第一道防线，且它防的是 CM6 自己。**
//
// CM6 的 `EditorState.create` 默认按 /\r\n?|\n/ 拆行、再用 '\n' join 回去——
// 也就是说，**一个 CRLF 文件读进 CM6 再取出来就变成 LF 了**。这是全文规范化，
// 正是不变量 2 明令禁止的：「只重写用户当次编辑所触及的最小区间，未触及的字节
// 逐字节保留——不做全文规范化」。
//
// 解法是显式设 `EditorState.lineSeparator`。设了之后 CM6 只按该分隔符拆行，
// 其余字节原样留在行内容里，`doc.toString()` 就能还原——**连混用换行的文件也能还原**。

export type LineEnding = '\n' | '\r\n' | '\r'

export const BOM = '﻿'

/**
 * 检出文件的换行风格。**取第一个出现的**，不做统计投票——
 * 投票会让混用换行的文件被"多数派"同化，那还是规范化。
 */
export function detectLineEnding(text: string): LineEnding {
  const index = text.indexOf('\n')
  if (index === -1) return text.includes('\r') ? '\r' : '\n'
  return index > 0 && text[index - 1] === '\r' ? '\r\n' : '\n'
}

/**
 * 把 BOM 摘出来单独记着，别让它变成文档里可编辑的第一个字符。
 * 摘掉是为了编辑体验，**记着是为了写回时一个字节不少**。
 */
export function stripBom(text: string): { bom: boolean; body: string } {
  return text.startsWith(BOM) ? { bom: true, body: text.slice(BOM.length) } : { bom: false, body: text }
}

export function restoreBom(body: string, bom: boolean): string {
  return bom ? BOM + body : body
}

/** 打开文件时算一次，保存时原样用回去。 */
export interface TextFidelity {
  lineEnding: LineEnding
  bom: boolean
}

export function readFidelity(raw: string): { fidelity: TextFidelity; body: string } {
  const { bom, body } = stripBom(raw)
  return { fidelity: { lineEnding: detectLineEnding(body), bom }, body }
}

export function writeFidelity(body: string, fidelity: TextFidelity): string {
  return restoreBom(body, fidelity.bom)
}

/**
 * 取全文。**必须**走这里，不许 `state.doc.toString()`。
 *
 * `toString()` 看着是对的，但它**永远用 '\n' 拼行**——`Text.sliceString` 的 `lineSep`
 * 默认就是 '\n'，与 `lineSeparator` facet 无关。于是一个 CRLF 文件即使正确地按
 * '\r\n' 拆了行，`toString()` 也会把它交还成 LF，不变量 2 照样破。
 * `state.sliceDoc()` 才用 `state.lineBreak`（即 facet 的值）。
 *
 * **它住在 bytes.ts 而不是 base.ts**（190 P1 挪的）：F2 的格式命令要用它，
 * 而格式命令是 base 的下游——留在 base 里就成了 `base → format → base` 的环，
 * `check:deps` 的 no-circular 当场红。它本来就属于这个文件：守的是同一条不变量。
 */
export function readDoc(state: EditorState): string {
  return state.sliceDoc()
}
