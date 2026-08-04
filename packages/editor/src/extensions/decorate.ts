import { syntaxTree } from '@codemirror/language'
import { Facet, RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'

import {
  BulletWidget,
  CheckboxWidget,
  HrWidget,
  ImageWidget,
  MathWidget,
  TableWidget,
  TextDiagramWidget,
} from '../widgets/render.ts'

// A/B/C/D 四类装饰的引擎。整个文件只做一件事：**把 state 翻译成显示**。
//
//   - buildDecorations 是**纯函数**（state + 可见区间 → DecorationSet），不碰 view——
//     所以它能被单测直接对拍（不起 DOM），这正是 001 §2.2 锚点算法同款设计。
//   - 字节纪律：这里只产出 Decoration，**任何路径都不 dispatch**。round-trip 二期
//     （130 §1.4 #1）拿全语法 fixture 守着；widget 侧的铁律写在 widgets/render.ts 头上。
//   - IME 冻结（T-17）：composition 活跃期间整套装饰**冻结不重算**，只随 changes 平移
//     ——见文件底部的 ViewPlugin。揭示逻辑跟着 selection 走，而 IME 组合期间 selection
//     一直在动，不冻结的话每敲一个音节装饰就重建一次，候选框必被打断。

/** 图片相对路径的解析基（page 所在目录）。null = 不解析，原样交给 img。 */
export const assetBase = Facet.define<string | null, string | null>({
  combine: (values) => values[0] ?? null,
})

/** 一档不许铺开的清单之外语言按纯文本呈现——这里没有语言清单，语言包由 language-data 惰性加载。 */

function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from)
}

function touchesLine(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  return touches(state, line.from, line.to)
}

interface Deco {
  from: number
  to: number
  deco: Decoration
}

const line = (cls: string, attrs?: Record<string, string>): Decoration =>
  Decoration.line(attrs ? { class: cls, attributes: attrs } : { class: cls })
const mark = (cls: string): Decoration => Decoration.mark({ class: cls })
const hide = Decoration.replace({})

const HEADING_RE = /^ATXHeading([1-6])$/

export function buildDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  base: string | null,
): DecorationSet {
  // 测试探针：冻结与否在 DOM 上常常不可见（widget eq() 稳定时重建也不churn），
  // 唯一诚实的可判定量是"重算发生了没有"。smoke ③ 靠它判 IME 冻结。
  const probe = globalThis as { __sepiaDecorateBuilds?: number }
  probe.__sepiaDecorateBuilds = (probe.__sepiaDecorateBuilds ?? 0) + 1

  const out: Deco[] = []
  const push = (from: number, to: number, deco: Decoration): void => {
    out.push({ from, to, deco })
  }
  const tree = syntaxTree(state)

  const enter = (node: SyntaxNodeRef): boolean | void => {
    const name = node.name
    const revealed = touches(state, node.from, node.to)

    // ── C 类块级（Table/BlockMath/textdiagram）不在这层——CM6 规定块级 replace
    //    只能来自 StateField，见下方 buildBlockDecorations。这里跳过其内部。──────
    if (name === 'Table' || name === 'BlockMath') {
      return revealed ? undefined : false
    }
    if (name === 'FencedCode') {
      const info = node.node.getChild('CodeInfo')
      const lang = info ? state.sliceDoc(info.from, info.to).trim() : ''
      if (lang === 'textdiagram') return revealed ? undefined : false
      // 其余围栏代码块归 D 类：不替换，逐行给底色，语言高亮由 language-data 惰性接管
      const first = state.doc.lineAt(node.from).number
      const last = state.doc.lineAt(node.to).number
      for (let n = first; n <= last; n++) {
        push(state.doc.line(n).from, state.doc.line(n).from, line('cm-md-codeblock'))
      }
      return
    }
    if (name === 'Image') {
      if (revealed) return
      const src = state.sliceDoc(node.from, node.to)
      const match = /^!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)[^)]*\)$/.exec(src)
      if (!match) return
      const url = match[2]!.replace(/^<|>$/g, '')
      push(node.from, node.to, Decoration.replace({ widget: new ImageWidget(src, match[1]!, url, base) }))
      return false
    }
    if (name === 'HorizontalRule') {
      if (revealed) return
      push(node.from, node.to, Decoration.replace({ widget: new HrWidget(''), block: false }))
      return false
    }

    // ── B 类：行首标记隐藏 + 视觉缩进，一个字节不动（纪律 7b）─────────────
    const heading = HEADING_RE.exec(name)
    if (heading) {
      const level = heading[1]!
      push(state.doc.lineAt(node.from).from, state.doc.lineAt(node.from).from, line(`cm-md-h cm-md-h${level}`))
      if (!revealed) {
        const markNode = node.node.getChild('HeaderMark')
        if (markNode) {
          const after = state.sliceDoc(markNode.to, markNode.to + 1)
          push(markNode.from, after === ' ' ? markNode.to + 1 : markNode.to, hide)
        }
      }
      return
    }
    if (name === 'Blockquote') {
      const first = state.doc.lineAt(node.from).number
      const last = state.doc.lineAt(node.to).number
      for (let n = first; n <= last; n++) {
        push(state.doc.line(n).from, state.doc.line(n).from, line('cm-md-quote'))
      }
      return
    }
    if (name === 'QuoteMark') {
      if (!touchesLine(state, node.from)) {
        const after = state.sliceDoc(node.to, node.to + 1)
        push(node.from, after === ' ' ? node.to + 1 : node.to, hide)
      }
      return
    }
    if (name === 'ListItem') {
      // 视觉悬挂缩进：标记宽度用 ch 顶出去，软换行的续行对齐到正文起点。
      // 前缀全是 ASCII（空格 + 标记 + 空格），ch 单位量得准；正文是不是 CJK 无所谓。
      // 降级预案（架构 §8）：这里若出问题，删掉这条 line 装饰即退到"只隐藏标记"。
      const lineObj = state.doc.lineAt(node.from)
      const prefix = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/.exec(lineObj.text)
      if (prefix) {
        const width = prefix[0].length
        push(
          lineObj.from,
          lineObj.from,
          line('cm-md-li', { style: `text-indent:-${width}ch;padding-left:${width}ch` }),
        )
      }
      return
    }
    if (name === 'ListMark') {
      const text = state.sliceDoc(node.from, node.to)
      if (/^[-*+]$/.test(text)) {
        // 任务项（'- [x]'）只显示 checkbox：圆点连同后面的空格一起藏掉，
        // 否则出现 "• ☑" 双标记——smoke ④ 抓出来的
        const isTask = /^ \[[ xX]\]/.test(state.sliceDoc(node.to, node.to + 4))
        if (!touchesLine(state, node.from)) {
          if (isTask) push(node.from, node.to + 1, hide)
          else push(node.from, node.to, Decoration.replace({ widget: new BulletWidget('') }))
        } else {
          push(node.from, node.to, mark('cm-md-listmark'))
        }
      } else {
        // 有序列表的编号保留可见（信息本身），只上样式——宽度变化（9.→10.）由
        // ListItem 的 ch 悬挂缩进吸收
        push(node.from, node.to, mark('cm-md-listmark'))
      }
      return
    }
    if (name === 'TaskMarker') {
      if (!touchesLine(state, node.from)) {
        const checked = /x/i.test(state.sliceDoc(node.from, node.to))
        push(node.from, node.to, Decoration.replace({ widget: new CheckboxWidget(checked) }))
      }
      return
    }

    // ── A 类：mark decoration + 光标区间判定，光标进入才露出标记 ──────────
    if (name === 'Emphasis' || name === 'StrongEmphasis' || name === 'Strikethrough') {
      const cls =
        name === 'Emphasis' ? 'cm-md-em' : name === 'StrongEmphasis' ? 'cm-md-strong' : 'cm-md-strike'
      push(node.from, node.to, mark(cls))
      if (!revealed) {
        for (const child of node.node.getChildren(
          name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark',
        )) {
          push(child.from, child.to, hide)
        }
      }
      return
    }
    if (name === 'InlineCode') {
      push(node.from, node.to, mark('cm-md-code'))
      if (!revealed) {
        for (const child of node.node.getChildren('CodeMark')) push(child.from, child.to, hide)
      }
      return
    }
    if (name === 'InlineMath') {
      if (!revealed) {
        push(node.from, node.to, Decoration.replace({ widget: new MathWidget(state.sliceDoc(node.from, node.to), false) }))
        return false
      }
      push(node.from, node.to, mark('cm-md-math-src'))
      return
    }
    if (name === 'Link') {
      push(node.from, node.to, mark('cm-md-link'))
      if (!revealed) {
        for (const child of node.node.getChildren('LinkMark')) push(child.from, child.to, hide)
        const url = node.node.getChild('URL')
        if (url) push(url.from, url.to, hide)
        const title = node.node.getChild('LinkTitle')
        if (title) push(title.from, title.to, hide)
      }
      return
    }
    if (name === 'Autolink') {
      push(node.from, node.to, mark('cm-md-link'))
      if (!revealed) {
        for (const child of node.node.getChildren('LinkMark')) push(child.from, child.to, hide)
      }
      return
    }
    if (name === 'Escape') {
      if (!revealed) push(node.from, node.from + 1, hide)
      return
    }
    if (name === 'HardBreak') {
      // 节点范围含换行符本身；只藏标记（尾双空格或反斜杠），换行留给排版
      if (!revealed) {
        const lineEnd = state.doc.lineAt(node.from).to
        if (node.from < lineEnd) push(node.from, Math.min(node.to, lineEnd), hide)
      }
      return
    }

    // ── D 类：按普通文本呈现，等宽 + 弱化（安全与排版歧义的诚实选择）────────
    if (name === 'HTMLBlock' || name === 'HTMLTag' || name === 'CodeBlock') {
      push(node.from, node.to, mark('cm-md-html'))
      return
    }
    return
  }

  for (const range of ranges) {
    tree.iterate({ from: range.from, to: range.to, enter })
  }

  // frontmatter：文档以 --- 开头时到下一个 --- 为止，弱化为元信息区。
  // lezer-markdown 不解析它，这里按行扫（只在第一屏，代价可忽略）。
  if (state.doc.lines > 1 && state.doc.line(1).text === '---') {
    for (let n = 2; n <= Math.min(state.doc.lines, 100); n++) {
      const l = state.doc.line(n)
      push(l.from, l.from, line('cm-md-frontmatter'))
      if (l.text === '---') break
    }
    push(state.doc.line(1).from, state.doc.line(1).from, line('cm-md-frontmatter'))
  }

  out.sort((a, b) => a.from - b.from || a.to - b.to)
  const builder = new RangeSetBuilder<Decoration>()
  let lastFrom = -1
  let lastTo = -1
  for (const item of out) {
    // RangeSetBuilder 要求有序；同位点的 line 装饰允许并列
    if (item.from < lastFrom || (item.from === lastFrom && item.to < lastTo)) continue
    try {
      builder.add(item.from, item.to, item.deco)
      lastFrom = item.from
      lastTo = item.to
    } catch {
      // 极端嵌套下的乱序条目宁可丢弃也不抛——装饰是显示层，显示层的失败不许波及纸
    }
  }
  return builder.finish()
}

interface DecoratorValue {
  decorations: DecorationSet
}

export function decoratePlugin(): Extension {
  return [blockWidgetFieldRef(), ViewPlugin.define<DecoratorValue>(
    (view) => ({
      decorations: buildDecorations(view.state, view.visibleRanges, view.state.facet(assetBase)),
      update(this: DecoratorValue, update: ViewUpdate) {
        // **IME 冻结（T-17 / 架构 §4.4 原则一）**：composition 活跃期间不重算，
        // 只把既有装饰随文档变更平移——尤其保住光标前方的 replace decoration 与
        // inline widget 不被重建。composition 结束后的第一个 update 恢复重算。
        if (update.view.composing) {
          this.decorations = this.decorations.map(update.changes)
          return
        }
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.decorations = buildDecorations(
            update.state,
            update.view.visibleRanges,
            update.state.facet(assetBase),
          )
        }
      },
    }),
    { decorations: (value) => value.decorations },
  )]
}

// blockWidgetField 定义在文件末尾（StateField 依赖上面的构建器），用惰性引用避免
// TDZ——decoratePlugin 在模块加载时就被 markdownExtensions 引用。
function blockWidgetFieldRef(): Extension {
  return blockWidgetField
}

// ── 块级层：Table / BlockMath / textdiagram 的整块 replace ────────────────────
// CM6 规定：**块级装饰不许来自 ViewPlugin**（它们改变竖向布局，必须在 measure 前
// 就已知），所以这层单独走 StateField。块级元素稀少，全文扫的代价可接受。

export function buildBlockDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name
      if (name !== 'Table' && name !== 'BlockMath' && name !== 'FencedCode') return
      if (touches(state, node.from, node.to)) return false
      const src = state.sliceDoc(node.from, node.to)
      if (name === 'FencedCode') {
        const info = node.node.getChild('CodeInfo')
        const lang = info ? state.sliceDoc(info.from, info.to).trim() : ''
        if (lang !== 'textdiagram') return false
        builder.add(node.from, node.to, Decoration.replace({ widget: new TextDiagramWidget(src), block: true }))
        return false
      }
      const widget = name === 'Table' ? new TableWidget(src) : new MathWidget(src, true)
      builder.add(node.from, node.to, Decoration.replace({ widget, block: true }))
      return false
    },
  })
  return builder.finish()
}

export const blockWidgetField = StateField.define<DecorationSet>({
  create: (state) => buildBlockDecorations(state),
  update(value, tr) {
    // IME 冻结在这层同样成立：composition 事务只平移，不重算
    if (tr.isUserEvent('input.type.compose')) return value.map(tr.changes)
    if (!tr.docChanged && tr.selection === undefined && syntaxTree(tr.state) === syntaxTree(tr.startState)) {
      return value.map(tr.changes)
    }
    return buildBlockDecorations(tr.state)
  },
  provide: (field) => EditorView.decorations.from(field),
})
