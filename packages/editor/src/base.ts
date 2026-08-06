import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view'

import type { EditorView as EditorViewType } from '@codemirror/view'

import type { MarkupRun } from '@sepia/core'

import type { LineEnding } from './bytes.ts'
import type { SearchApi } from './extensions/search-types.ts'
import { markupHostExtension, markupHostPos, setMarkupHost } from './extensions/markup-host.ts'
import {
  badgeClick,
  badgeExtension,
  badgesHidden,
  setBadges,
  setBadgesHidden,
  type BadgeSpot,
} from './extensions/badges.ts'
import { applyMarkup, type ApplyMarkupRequest, type ApplyMarkupResult } from './markup.ts'

// 纯文本编辑所需的**最小**扩展集合。
//
// 本 stage 刻意不含：markdown 语言包、任何 decoration、任何 widget、语法高亮、
// 自动补全。装了 `@codemirror/lang-markdown` 就会想调高亮色，调色就撞主题变量表，
// 撞完就顺手做 A 类装饰——一条龙滑进 Stage 2（120 §1.2）。
//
// CM6 的主题写 `var(--sepia-*)`，与 @sepia/ui 的变量表**共享名字但不共享代码**——
// `editor ↮ ui` 是刻意不连线（T-20）。改名字要两边一起改，这是有意的摩擦。

const paperTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--sepia-paper)',
    color: 'var(--sepia-ink)',
  },
  '.cm-content': {
    caretColor: 'var(--sepia-caret)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '15px',
    lineHeight: '1.7',
    padding: '24px 0 40vh',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--sepia-paper)',
    color: 'var(--sepia-ink-muted)',
    border: 'none',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--sepia-caret)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--sepia-selection)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
})

export interface BaseExtensionOptions {
  /**
   * 文件原本的换行风格。**必须显式传**——不传就用 CM6 的默认行为，
   * 而默认行为会把 CRLF 规范化成 LF，直接违反不变量 2。见 bytes.ts 的长注释。
   */
  lineEnding?: LineEnding
  /** 文档变化时回调，用于脏标记。 */
  onChange?: (doc: string) => void
  /** 光标变化时回调，用于写回 session。滚动另走 MountOptions.onScroll——它属于 view，不属于 state。 */
  onSelectionChange?: (cursor: number) => void
}

export function baseExtensions(options: BaseExtensionOptions = {}): Extension[] {
  const listeners: Extension[] = []
  if (options.onChange || options.onSelectionChange) {
    listeners.push(
      EditorView.updateListener.of((update) => {
        // sliceDoc() 而不是 doc.toString()：后者恒用 LF 拼行（见 readDoc 的长注释）。
        // 这里若用 toString()，CRLF 文件每敲一个字、onChange 交出去的全文就已被
        // 规范化，⌘S 一存整个文件被改写——不变量 2 在采集端就破了。
        if (update.docChanged && options.onChange) options.onChange(update.state.sliceDoc())
        if (update.selectionSet && options.onSelectionChange) {
          options.onSelectionChange(update.state.selection.main.head)
        }
      }),
    )
  }

  return [
    // 这一行是不变量 2 的守卫，不是可选项。删了它 CRLF 文件会被静默改成 LF。
    EditorState.lineSeparator.of(options.lineEnding ?? '\n'),
    lineNumbers(),
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    paperTheme,
    ...listeners,
  ]
}

/** 供单测用：不起 DOM 也能构造出一个可编辑的 state。 */
export function createState(doc: string, options: BaseExtensionOptions = {}): EditorState {
  return EditorState.create({ doc, extensions: baseExtensions(options) })
}

export interface MountOptions extends BaseExtensionOptions {
  doc: string
  /** 初始光标偏移。超出文档长度时自动夹到末尾。 */
  cursor: number
  /** 上次的滚动位置（像素）。失效（文件变短等）时由 scrollIntoView 兜底。 */
  scrollTop?: number
  /** 滚动变化时回调，用于写回 session。挂在 scrollDOM 上——滚动属于 view，不属于 state。 */
  onScroll?: (scrollTop: number) => void
  /**
   * Stage 2 起：markdown 语法层（A/B/C/D 装饰、高亮、剪贴板、查找替换）。
   * 由调用方经 `@sepia/editor/markdown` **异步加载后**传入——那个子入口刻意不在
   * 主入口静态可达，否则 1MB 的语法层会进 renderer 首屏 bundle，把 t0→t3 从
   * 316ms 顶到 650ms（001 §4.7：入口保持小，重组件按需；冷启动 smoke 抓过）。
   * 不传 = 纯文本编辑器，Stage 1 的一切照旧。
   */
  syntax?: Extension[]
  /** 查找替换驱动的工厂，与 syntax 同源（`@sepia/editor/markdown` 导出）——同为惰性层。 */
  searchFactory?: (view: EditorViewType) => SearchApi
  parent: HTMLElement
  /** 点中徽章（W8）。经 Facet 交给 widget——widget 在 state 里造，够不到 app 的回调。 */
  onBadgeClick?: (id: string) => void
}

export interface MountedEditor {
  /** 取全文。内部走 `readDoc`，调用方拿不到会规范化换行的那条路。 */
  read(): string
  focus(): void
  destroy(): void
  /** 查找替换的驱动接口。UI 是 app 侧的 React，经这里驱动 CM6（editor ↮ ui）。未装语法层时为 null。 */
  search: SearchApi | null
  /** 取一段区间的现值。浮层提交时用它取快照，落笔时那份快照就是 CAS 的 compare 那一半。 */
  slice(from: number, to: number): string
  /** 当前选区。⌘K 拿它决定改写哪一段。 */
  selection(): { from: number; to: number }
  /**
   * 落笔（纪律 9c / 19 / 22）。**这是 AI 产出进入正文的唯一途径**——
   * `MountedEditor` 刻意不交出 `EditorView`，正是为了让这句话在类型上为真：
   * 拿到 view 的人可以 `dispatch({ changes })` 绕过 CAS，拿不到就绕不过去。
   * `run` 必填：m5 与落笔同生，不许回头补。
   */
  applyMarkup(request: ApplyMarkupRequest, run: Pick<MarkupRun, 'mark'>): ApplyMarkupResult
  /**
   * 在选区所在行之后开一个块级 widget 宿主，返回容器节点供 React portal 挂入。
   * 后文由 CM6 自己排下去——**推开，不是遮盖**（W6 硬语义，150 §1.8 风险 4）。
   */
  openMarkupHost(): HTMLElement
  closeMarkupHost(): void
  /**
   * 挂徽章（W8）。传全量——徽章是**由线程按当前正文算出来的**，
   * 不是增量维护的状态（`placeThreads` 一次算清，这里照着画）。
   */
  showBadges(spots: BadgeSpot[]): void
  /** ⌘⇧H 还白（W10）：全隐 ↔ 全显来回切。返回切换后的「是否全隐」。 */
  toggleBadges(): boolean
}

/**
 * 挂载一个编辑器实例。
 *
 * **CM6 的类型与构造只出现在这个包里**——app 侧的宿主组件只管容器与生命周期。
 * 这不是洁癖：`app` 的 `package.json` 里没有 `@codemirror/*`，它想直接 import 也
 * 编译不过（结构 2 的编译期物理约束）。能力该沉到哪层，包边界会直接告诉你。
 */
/** 浮层宿主的尺寸观察者。一次只可能有一个浮层，模块级单例够用。 */
let markupHostResize: ResizeObserver | null = null

export function mountEditor(options: MountOptions): MountedEditor {
  const { doc, cursor, scrollTop, onScroll, syntax, searchFactory, parent, onBadgeClick, ...rest } = options
  const state = EditorState.create({
    doc,
    selection: { anchor: Math.min(Math.max(cursor, 0), doc.length) },
    extensions: [
      baseExtensions(rest),
      markupHostExtension(),
      badgeExtension(),
      onBadgeClick === undefined ? [] : badgeClick.of(onBadgeClick),
      syntax ?? [],
    ],
  })
  const view = new EditorView({ state, parent })

  // 恢复顺序有意义：先落 scrollTop，再对 selection 补一次 scrollIntoView 兜底
  //（附录 D.3 第 3 条的裁决）。scrollTop 还原到位且光标在视口内时，
  // scrollIntoView 是 no-op；scrollTop 失效（文件变短、内容外部被改）时，
  // 它保证光标仍然可见——否则就是 D.2 那个「光标恢复了、视口没跟上」的重演。
  //
  // **必须等 CM6 的首次 measure 之后再做**：构造刚返回时内容高度还没估出来，
  // 这时设 scrollTop 会被浏览器夹回 0——smoke 实测抓到过（Received: 0）。
  // CM6 自己的 measure 也是 rAF 驱动且在构造时就已注册，所以我们的 rAF 排在它后面。
  requestAnimationFrame(() => {
    if (scrollTop !== undefined && scrollTop > 0) {
      view.scrollDOM.scrollTop = scrollTop
    }
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head) })
  })

  let detachScroll: (() => void) | undefined
  if (onScroll) {
    const scroller = view.scrollDOM
    const handler = (): void => onScroll(scroller.scrollTop)
    scroller.addEventListener('scroll', handler, { passive: true })
    detachScroll = () => scroller.removeEventListener('scroll', handler)
  }

  return {
    read: () => readDoc(view.state),
    focus: () => view.focus(),
    destroy: () => {
      detachScroll?.()
      view.destroy()
    },
    search: searchFactory?.(view) ?? null,
    slice: (from, to) => view.state.sliceDoc(from, to),
    selection: () => {
      const { from, to } = view.state.selection.main
      return { from, to }
    },
    applyMarkup: (request, run) => applyMarkup(view, request, run),
    // 徽章：传全量。徽章是由线程按当前正文**算出来的**，不是增量维护的状态——
    // 算一次画一次，比"哪条加了哪条删了"少一整类会漂的 bug。
    showBadges: (spots) => view.dispatch({ effects: setBadges.of(spots) }),
    toggleBadges: () => {
      const next = !badgesHidden(view)
      view.dispatch({ effects: setBadgesHidden.of(next) })
      return next
    },
    openMarkupHost: () => {
      // 容器由**这里**建、由 app 填。建在 editor 侧是因为它的生命周期跟着 widget 走，
      // 而不是跟着 React 的挂载走——收起时 CM6 把它移出文档流，节点本身还在，
      // React 那边卸载与否互不影响。
      const dom = document.createElement('div')
      dom.className = 'sepia-markup-host'
      const pos = markupHostPos(view)
      view.dispatch({ effects: setMarkupHost.of({ pos, dom, height: 0 }) })

      // **高度得实测后回填。** 容器交出去时是空的，React 之后才 portal 进内容，
      // 而 CM6 的高度图在插入当下就定了——不回填，gutter 会按 0 排，
      // 行号与被推开的正文错位（150 §1.8 风险 4 的收尾）。
      let measured = -1
      markupHostResize?.disconnect()
      markupHostResize = new ResizeObserver(() => {
        const height = dom.offsetHeight
        // 只在真变了才 dispatch：在 ResizeObserver 回调里再触发布局，很容易转成死循环
        if (height === measured || height === 0) return
        measured = height
        view.dispatch({ effects: setMarkupHost.of({ pos, dom, height }) })
      })
      markupHostResize.observe(dom)
      return dom
    },
    closeMarkupHost: () => {
      markupHostResize?.disconnect()
      markupHostResize = null
      view.dispatch({ effects: setMarkupHost.of(null) })
    },
  }
}

/**
 * **取全文只许走这里。**
 *
 * `state.doc.toString()` 看着是对的，但它**永远用 '\n' 拼行**——`Text.sliceString`
 * 的 `lineSep` 参数默认就是 '\n'，与 `lineSeparator` facet 无关。于是一个 CRLF 文件
 * 即使正确地按 '\r\n' 拆了行，`toString()` 也会把它交还成 LF，不变量 2 照样破。
 *
 * `state.sliceDoc()` 才用 `state.lineBreak`（即 facet 的值）。两者差一个字符，
 * 后果是用户的整个文件被静默改写——所以这里包一层，让调用方**没有写错的机会**。
 */
export function readDoc(state: EditorState): string {
  return state.sliceDoc()
}
