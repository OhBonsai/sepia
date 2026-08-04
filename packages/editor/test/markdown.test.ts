import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { baseExtensions, readDoc } from '../src/base.ts'
import { BOM, readFidelity, writeFidelity } from '../src/bytes.ts'
import { buildBlockDecorations, buildDecorations } from '../src/extensions/decorate.ts'
import { markdownExtensions } from '../src/markdown.ts'

// Stage 2 语法层的 state 级单测。**不起 DOM**——buildDecorations 是纯函数
// （state + 区间 → DecorationSet），这正是把它设计成纯函数换来的东西。

function mdState(doc: string, options: { lineEnding?: '\n' | '\r\n' | '\r'; cursor?: number } = {}): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor: Math.min(options.cursor ?? 0, doc.length) },
    extensions: [baseExtensions({ lineEnding: options.lineEnding ?? '\n' }), markdownExtensions()],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

const FULL_SYNTAX = [
  '# 标题一',
  '',
  '正文有 **加粗**、*斜体*、`行内代码`、~~删除~~、[链接](https://a.b)、<https://auto.link>、',
  '行内公式 $e^{i\\pi}+1=0$ 与转义 \\* 号。',
  '',
  '> 引用第一行',
  '> 引用嵌套 **加粗**',
  '',
  '- 无序一',
  '- 无序二很长会软换行的一项内容',
  '  1. 有序嵌套',
  '  10. 宽度变化',
  '- [ ] 任务未完',
  '- [x] 任务已完',
  '',
  '| 列A | 列B |',
  '| --- | ---: |',
  '| 甲 | 1 |',
  '',
  '$$',
  '\\int_0^1 x^2 dx',
  '$$',
  '',
  '```python',
  'def f():',
  '    return 1',
  '```',
  '',
  '```textdiagram',
  '[a] --> [b]',
  '```',
  '',
  '---',
  '',
  '<div class="raw">HTML 块按源码呈现</div>',
  '',
  '![图](./pic.png)',
  '',
].join('\n')

describe('round-trip 二期：全装饰加载后字节逐一保真（不变量 2，无豁免）', () => {
  const fixtures: Array<[string, string]> = [
    ['全语法 LF', FULL_SYNTAX],
    ['全语法 CRLF', FULL_SYNTAX.split('\n').join('\r\n')],
    ['全语法 CR', FULL_SYNTAX.split('\n').join('\r')],
    ['带 BOM 的全语法', `${BOM}${FULL_SYNTAX}`],
    ['混用换行的列表', '- a\r\n- b\n- c\r\nd'],
    ['无尾换行的标题', '# 标题'],
    ['空文件', ''],
    ['只有围栏', '```\n```'],
    ['未闭合的块级公式', '$$\nx+1'],
    ['超长行内嵌语法', `前缀 ${'x'.repeat(10000)} **粗** $a$ 后缀\n`],
  ]

  for (const [name, original] of fixtures) {
    it(name, () => {
      const { fidelity, body } = readFidelity(original)
      const state = mdState(body, { lineEnding: fidelity.lineEnding })
      // 装饰构建走一遍全文档（模拟可见区间覆盖全文）……
      const decorations = buildDecorations(state, [{ from: 0, to: state.doc.length }], null)
      expect(decorations).toBeDefined()
      // ……然后取全文必须逐字节一致。装饰只许改显示。
      expect(writeFidelity(readDoc(state), fidelity)).toBe(original)
    })
  }
})

describe('数学语法解析', () => {
  const names = (doc: string, cursor = 0): string[] => {
    const state = mdState(doc, { cursor })
    const found: string[] = []
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name === 'InlineMath' || node.name === 'BlockMath') found.push(node.name)
      },
    })
    return found
  }

  it('$...$ 解析为 InlineMath', () => {
    expect(names('质能方程 $E=mc^2$ 在此')).toContain('InlineMath')
  })

  it('$5 和 $10 这种货币写法不解析', () => {
    expect(names('价格是 $5 和 $10 之间')).toEqual([])
  })

  it('$$...$$ 多行解析为 BlockMath', () => {
    expect(names('$$\nx^2\n$$')).toContain('BlockMath')
  })

  it('单行 $$x$$ 也是 BlockMath', () => {
    expect(names('$$x+1$$')).toContain('BlockMath')
  })
})

describe('揭示判定：光标进入才露出标记', () => {
  const countHidden = (doc: string, cursor: number): number => {
    const state = mdState(doc, { cursor })
    const decorations = buildDecorations(state, [{ from: 0, to: state.doc.length }], null)
    let hidden = 0
    const iter = decorations.iter()
    while (iter.value) {
      // replace 装饰（隐藏标记 / widget 替换）没有 class 属性
      const spec = (iter.value as unknown as { widget?: unknown }).widget
      if (spec !== undefined || iter.value.spec.class === undefined) hidden += 1
      iter.next()
    }
    return hidden
  }

  it('光标在加粗之外：标记被藏', () => {
    // 文档 "x **粗** y"，光标在 0（x 上）——两个 ** 都该被 replace
    expect(countHidden('x **粗** y\n\n后面一段', 0)).toBeGreaterThan(0)
  })

  it('光标在加粗之内：标记露出（隐藏数变少）', () => {
    const outside = countHidden('x **粗** y', 0)
    const inside = countHidden('x **粗** y', 5)
    expect(inside).toBeLessThan(outside)
  })

  it('光标在表格内：块级 widget 不替换（源码可编辑）——块级层单测', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |'
    const outsideDoc = `${table}\n\n尾巴`
    const count = (doc: string, cursor: number): number => {
      const state = mdState(doc, { cursor })
      let n = 0
      const iter = buildBlockDecorations(state).iter()
      while (iter.value) { n += 1; iter.next() }
      return n
    }
    // 光标在表格外：整块被 widget 替换（块级层恰一条）
    expect(count(outsideDoc, outsideDoc.length)).toBe(1)
    // 光标进表格：源码可编辑，块级层为空
    expect(count(table, 2)).toBe(0)
  })
})

describe('D 类：HTML 与缩进代码按源码呈现（不渲染）', () => {
  it('HTMLBlock 只有样式 mark，没有 replace', () => {
    const doc = '<div>\n<b>raw</b>\n</div>\n\n尾'
    const state = mdState(doc, { cursor: doc.length })
    const decorations = buildDecorations(state, [{ from: 0, to: state.doc.length }], null)
    let replaced = 0
    const iter = decorations.iter()
    while (iter.value) {
      if ((iter.value as unknown as { widget?: unknown }).widget) replaced += 1
      iter.next()
    }
    expect(replaced).toBe(0)
  })
})
