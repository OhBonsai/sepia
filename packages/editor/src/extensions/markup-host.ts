import { StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  lineNumberWidgetMarker,
  type DecorationSet,
} from '@codemirror/view'

// markup 浮层的**宿主**：在选区所在行之后插一个块级 widget，让 CM6 自己把后文排下去。
//
// **为什么非得是块级 widget，不能是 `position: absolute`**（150 §1.8 风险 4）：
// W6 的硬语义是「原地浮层，**推开下文，非遮盖**」。绝对定位贴到选区行看起来很像，
// 但它盖住的是下一段正文——恰好是那条语义点名不要的东西。真正让后文让位的只有
// 一种办法：让浮层成为文档流里的一个块，由 CM6 的排版自己算高度。
//
// **块级装饰只能来自 StateField**（架构 §4.4 结构硬约束①，Stage 2 实测得出）：
// ViewPlugin 提供块级 replace/widget 会直接 `RangeError`。所以装饰引擎分两层——
// 行内层随视口走 plugin，块级层走全文档 field，这里属于后者。
//
// DOM 的所有权**在 app**：widget 只负责把一个现成的容器节点放进文档流，
// React 经 portal 往里挂。理由是 `editor ↮ ui` 那条刻意不连线——CM6 这一侧
// 不认识 React，也不该认识。

/** 放置浮层宿主：给位置、容器节点与**当前高度**；`null` = 收起。 */
export const setMarkupHost = StateEffect.define<{
  pos: number
  dom: HTMLElement
  height: number
} | null>()

class MarkupHostWidget extends WidgetType {
  constructor(
    readonly dom: HTMLElement,
    readonly height: number,
  ) {
    super()
  }

  /**
   * 容器相同**且高度相同**才算同一个 widget。
   *
   * 只比 dom 不够：浮层从「一行输入」长到「diff + 三个按钮」时高度会变，
   * 而 CM6 认为 widget 没变就不会重建高度图——正文靠 DOM 重排看着是对的，
   * gutter 却还按旧高度排，行号与正文错开（实测：gutter 给了 16px，浮层高 117px）。
   * 把高度纳入身份，高度一变 CM6 就重新算。
   */
  override eq(other: MarkupHostWidget): boolean {
    return other.dom === this.dom && other.height === this.height
  }

  /**
   * **把高度直接告诉 CM6**，不让它自己去量。
   *
   * 自己量是量不准的：容器交出去的那一刻是空的，React 之后才 portal 进内容，
   * 而 CM6 的高度图在插入当下就定了。这个值由 `openMarkupHost` 侧的
   * ResizeObserver 实测后经 `setMarkupHost` 送进来，是真实高度不是估计。
   */
  override get estimatedHeight(): number {
    return this.height
  }

  override toDOM(): HTMLElement {
    return this.dom
  }

  /**
   * 浮层里的事件**不交给 CM6**。不挡的话，在输入框里打字会被编辑器当成对正文的编辑，
   * 按 Backspace 甚至会删到纸上的字——那是最直接的一种"抢笔"。
   */
  override ignoreEvent(): boolean {
    return true
  }

  /** DOM 归 app 所有（React 在里面），CM6 只是借用，销毁时别动它。 */
  override destroy(): void {
    // 有意为空
  }
}

const markupHostField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    // 先跟着文档改动映射位置：落笔会改字数，宿主不跟着走就会飘到别的段落去
    let next = decorations.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setMarkupHost)) continue
      const value = effect.value
      next =
        value === null
          ? Decoration.none
          : Decoration.set([
              Decoration.widget({
                widget: new MarkupHostWidget(value.dom, value.height),
                // block: 占整行、参与排版（这才有"推开下文"）；side 1: 落在该位置之后
                block: true,
                side: 1,
              }).range(value.pos),
            ])
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * 行号栏里与浮层对齐的占位。
 *
 * 高度不用自己设：CM6 会拿 `block.height` 去设 `.cm-gutterElement` 的高。
 * 这里只需要**存在**——没有 marker，gutter 压根不给块级 widget 生成元素，
 * 行号就会照原来的行高一路排下去，与被推开的正文错位。
 */
class HostGutterSpacer extends GutterMarker {
  override toDOM(): HTMLElement {
    return document.createElement('div')
  }
}

const hostGutterSpacer = new HostGutterSpacer()

export function markupHostExtension(): Extension {
  return [
    markupHostField,
    lineNumberWidgetMarker.of((_view, widget) =>
      widget instanceof MarkupHostWidget ? hostGutterSpacer : null,
    ),
  ]
}

/**
 * 浮层该插在哪：**选区所在行的行尾**。
 *
 * 用行尾而不是选区末尾，是为了让 widget 落在两行之间的块边界上——
 * 插在行中间的话 CM6 会把那一行劈成两截，选中的句子被浮层从中间截断。
 */
export function markupHostPos(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).to
}
