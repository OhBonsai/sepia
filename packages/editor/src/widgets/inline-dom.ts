import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { DecorationSet, WidgetType } from '@codemirror/view'

import { buildDecorations } from '../extensions/decorate.ts'
import { mathSyntax } from '../extensions/math-syntax.ts'
import type { InlineRenderer } from './render.ts'

// C 类 widget **内部**的行内渲染（150 §1.9 回流：设计留白的补丁）。
//
// 铁律一条：**不自写第二套行内规则**。这里唯一做的事是把 A 类装饰管线
// （`buildDecorations`）产出的 DecorationSet **物化成脱离 CM6 的 DOM**——
// 分类（哪个节点配哪个 class、哪些标记该藏）一个字节都不重新判断。
// 自写第二套的代价不是多写几行，是从此有两套会各自漂移的行内规则。
//
// 依赖方向：`markdown.ts`（总装）→ 本文件 → `decorate.ts` → `widgets/render.ts`。
// 反过来注入（decorate 直接 import 本文件）会成环，被结构 2 的 no-circular 挡下——
// 所以走 Facet 注入，与 `assetBase` 同一个套路。
//
// **块级不递归**（人裁的边界）：本文件只调 `buildDecorations`，**不调
// `buildBlockDecorations`**——而 Table / BlockMath / textdiagram 三个块级 widget
// 只由后者构造。于是"表格里不套表格"不是靠自觉遵守，是这条依赖本身就到不了那儿。

/**
 * 行内标记 → 语义元素。class 与纸面**完全同名**（同一份色板、同一套行为，
 * 纪律 3 的「不出现字面色值」在此自动成立），只是换了个更合适的标签名：
 * widget 的 DOM 是我们自己的，不必像 CM6 那样一律 span。
 */
const TAGS: Record<string, string> = {
  'cm-md-code': 'code',
  'cm-md-strong': 'strong',
  'cm-md-em': 'em',
  'cm-md-strike': 'del',
}

/**
 * 行内解析用的最小扩展集：markdown 语言 + 数学语法。
 *
 * **刻意不用 `markdownExtensions()`**：那一套带 `codeLanguages`（围栏代码块的
 * 惰性语言包，行内用不上）与 `import 'katex/dist/katex.min.css'`——后者会把
 * 150KB 的 css 拽进这条路径，正是 001 §4.7 要躲的。
 */
const INLINE_EXTENSIONS = [markdown({ base: markdownLanguage, extensions: [mathSyntax] })]

/**
 * 脱离 view 的 widget。CM6 的 `WidgetType.toDOM(view)` 签名要一个 EditorView，
 * 而这里根本没有 view——**我们自己的 widget（`SourceWidget` 的子类）全都不看那个参数**，
 * 所以在这条路径上它是可省的。窄成这个结构类型，比对着 `WidgetType` 硬转要诚实：
 * 它写明了「本文件只物化我们自己的 widget」这个前提。
 */
interface DetachedWidget {
  toDOM(): HTMLElement
}

interface Piece {
  from: number
  to: number
  /** mark：套一层元素；hide：整段不出现；widget：换成 widget 的 DOM */
  kind: 'mark' | 'hide' | 'widget'
  className: string | undefined
  widget: DetachedWidget | undefined
}

function pieces(set: DecorationSet, from: number, to: number): Piece[] {
  const out: Piece[] = []
  const iter = set.iter()
  while (iter.value !== null) {
    const spec = iter.value.spec as { class?: string; widget?: WidgetType & DetachedWidget }
    // 零长度的是 **line 装饰**（B 类的行首样式与缩进）——块级关注点，行内一律不要。
    // 这一条就是"不递归块级"在物化层的那一半。
    if (iter.from !== iter.to && iter.from >= from && iter.to <= to) {
      const widget = spec.widget
      const kind: Piece['kind'] = widget !== undefined ? 'widget' : iter.value.point ? 'hide' : 'mark'
      out.push({ from: iter.from, to: iter.to, kind, className: spec.class, widget })
    }
    iter.next()
  }
  // 外层在前：同起点时长的先来，套嵌套才套得对
  out.sort((a, b) => a.from - b.from || b.to - a.to)
  return out
}

function paint(parent: Node, text: string, offset: number, from: number, to: number, list: Piece[]): void {
  let pos = from
  while (pos < to) {
    const active = list.find((piece) => piece.from <= pos && piece.to > pos)
    if (active === undefined) {
      // 谁都不管的一段：到下一个装饰起点为止，原样是文本
      const next = list.find((piece) => piece.from > pos)
      const end = Math.min(next?.from ?? to, to)
      parent.appendChild(document.createTextNode(text.slice(pos - offset, end - offset)))
      pos = end
      continue
    }
    if (active.kind === 'hide') {
      // 标记本身（反引号、星号、波浪线……）——藏掉，正是失焦渲染该有的样子
      pos = active.to
      continue
    }
    if (active.kind === 'widget') {
      // 行内公式：直接用 A 类管线已经建好的那个 widget，KaTeX 惰性加载照旧
      parent.appendChild(active.widget!.toDOM())
      pos = active.to
      continue
    }
    const el = document.createElement(active.className === undefined ? 'span' : (TAGS[active.className] ?? 'span'))
    if (active.className !== undefined) el.className = active.className
    // 递归进内层：把自己从候选里去掉，否则 find 会原地打转
    paint(
      el,
      text,
      offset,
      Math.max(active.from, pos),
      active.to,
      list.filter((piece) => piece !== active),
    )
    parent.appendChild(el)
    pos = active.to
  }
}

/**
 * 解析时套的壳：把待渲染的文本放回一个**合成表格**的正文行里。
 *
 * 两件事都靠它办成，缺一不可：
 *
 * 1. **块级不递归**（人裁的边界）。裸解析一段 `# 井号` 会得到一个真标题——`#`
 *    被当标记藏掉，单元格里就凭空少了个字符（`> 引用`、`- 列表` 同理，后者还会
 *    塞进一个圆点 widget）。而 GFM 规定单元格内**只有行内**，把文本放回单元格里，
 *    这条规矩就由解析器自己执行了——我们一份白名单都不用维护，也就没有第二处
 *    会漂移的行内规则。实测：`# 井号` 从"藏掉井号"变成一条装饰都不产生。
 * 2. **标记要藏住**。`buildDecorations` 的揭示判定看光标：光标碰到的节点算"正在编辑"，
 *    标记就不藏——脱离 view 的 EditorState 光标默认在 0，文本从 0 开始的话第一个
 *    标记必然被判成揭示，反引号星号照样露出来（正是本轮要修的那个现象）。
 *    光标因此钉在**表头行**：Table 整体算揭示（于是装饰管线肯下降进表格），
 *    而正文那一行谁也没碰到（于是标记照藏）。
 */
const HEAD = '\n| h |\n| - |\n| '

/**
 * 把一段行内 markdown 渲染成脱离 CM6 的 DOM。
 *
 * 单元格文本里的 `|` 要**转义回去**再拼进合成表格，否则会把行拆成两格。
 * 转义出来的反斜杠由 A 类的 Escape 规则藏掉，渲染结果仍是一个干净的 `|`。
 */
export function renderInline(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  if (text === '') return fragment
  const doc = `${HEAD}${text.replace(/\|/g, '\\|')} |\n`
  const to = doc.length - 3 // 去掉行尾补的 ` |\n`
  const state = EditorState.create({ doc, selection: { anchor: 1 }, extensions: INLINE_EXTENSIONS })
  ensureSyntaxTree(state, doc.length, 1000)
  const set: DecorationSet = buildDecorations(state, [{ from: HEAD.length, to }], null)
  paint(fragment, doc, 0, HEAD.length, to, pieces(set, HEAD.length, to))
  return fragment
}

/** 类型对齐用：本模块的默认导出形态就是 `InlineRenderer`。 */
export const inlineRenderer: InlineRenderer = renderInline
