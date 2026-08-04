import type { BlockContext, InlineContext, Line, MarkdownConfig } from '@lezer/markdown'
import { tags } from '@lezer/highlight'

// 数学语法的 lezer-markdown 扩展。lang-markdown 的 GFM 不含数学，
// `$...$`（行内）与 `$$...$$`（块级）在这里补。**只管解析出节点**，
// 渲染（KaTeX）归 widgets/，揭示归 decorate.ts——解析层永远不知道显示层的存在。

const DOLLAR = 36

function parseInlineMath(cx: InlineContext, next: number, pos: number): number {
  if (next !== DOLLAR) return -1
  // `$$` 开头的交给块级；`$ ` 开头的多半是货币，不进
  const after = cx.char(pos + 1)
  if (after === DOLLAR || after === 32 /* space */ || after === -1) return -1

  for (let i = pos + 1; i < cx.end; i++) {
    const ch = cx.char(i)
    if (ch === 10 /* \n */) return -1
    if (ch !== DOLLAR) continue
    // 闭合 $ 前不许是空格（`$a $` 不算）；后面紧跟数字多半是 "$5 和 $10"
    if (cx.char(i - 1) === 32) return -1
    const following = cx.char(i + 1)
    if (following >= 48 && following <= 57) return -1
    return cx.addElement(
      cx.elt('InlineMath', pos, i + 1, [
        cx.elt('InlineMathMark', pos, pos + 1),
        cx.elt('InlineMathMark', i, i + 1),
      ]),
    )
  }
  return -1
}

function parseBlockMath(cx: BlockContext, line: Line): boolean {
  if (!line.text.startsWith('$$')) return false
  const start = cx.lineStart

  // 单行形态：$$ ... $$（首尾同一行）
  if (line.text.length > 4 && /\$\$\s*$/.test(line.text.slice(2))) {
    const end = start + line.text.length
    cx.nextLine()
    cx.addElement(cx.elt('BlockMath', start, end))
    return true
  }

  // 多行形态：读到以 $$ 结尾的行为止；没等到就吃到块末（未闭合按原样算数学块）
  let end = start + line.text.length
  while (cx.nextLine()) {
    end = cx.lineStart + line.text.length
    if (/\$\$\s*$/.test(line.text)) {
      cx.nextLine()
      break
    }
  }
  cx.addElement(cx.elt('BlockMath', start, end))
  return true
}

export const mathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: tags.special(tags.content) },
    { name: 'InlineMathMark', style: tags.processingInstruction },
    { name: 'BlockMath', block: true, style: tags.special(tags.content) },
  ],
  parseInline: [{ name: 'InlineMath', parse: parseInlineMath, before: 'Escape' }],
  parseBlock: [{ name: 'BlockMath', parse: parseBlockMath, before: 'FencedCode' }],
}
