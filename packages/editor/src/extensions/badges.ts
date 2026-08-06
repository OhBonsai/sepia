import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

// 徽章层（W8 / 160 §2.2）：**纸上留下痕迹**。
//
// 形态是裁死的：**直径 ≤8px 的小点，悬停微放大，不放数字、不放头像**。
// 它要表达的是"这里有过一次对话"的存在感，不是通知角标——数字与头像是
// 通知区的语言，一放上去纸就变成了收件箱。
//
// **为什么是行内 widget 而不是块级**（§2.8 风险 1）：markup 浮层是块级 widget，
// 它要"推开下文"；徽章恰恰相反——它绝不许改变正文的排版，只贴在段落右缘。
// 两者同为 widget 但不同族，各挂各的 StateField，互不抢位。

/** 一个徽章要挂的位置。`to` 是锚点区间的右端——徽章贴在那儿。 */
export interface BadgeSpot {
  id: string
  to: number
}

export const setBadges = StateEffect.define<BadgeSpot[]>()
/** ⌘⇧H 还白（W10）：全隐 ↔ 全显。**只切显示，不动数据**——线程一条不少。 */
export const setBadgesHidden = StateEffect.define<boolean>()

class BadgeWidget extends WidgetType {
  constructor(readonly id: string) {
    super()
  }

  override eq(other: BadgeWidget): boolean {
    return other.id === this.id
  }

  override toDOM(): HTMLElement {
    const dot = document.createElement('span')
    dot.className = 'sepia-badge'
    dot.dataset['sepiaBadge'] = this.id
    // 无文字、无数字、无头像——它整个就是一个点
    return dot
  }

  /** 点击要能打开线程，所以事件**不**交还给编辑器（与 C 类 widget 相反）。 */
  override ignoreEvent(): boolean {
    return true
  }
}

interface BadgeState {
  spots: BadgeSpot[]
  hidden: boolean
  decorations: DecorationSet
}

function build(spots: BadgeSpot[], hidden: boolean, docLength: number): DecorationSet {
  if (hidden) return Decoration.none
  const ranges: Range<Decoration>[] = []
  for (const spot of spots) {
    // 越界的直接跳过：文档可能刚被外部改短，重对齐还没跑到
    if (spot.to < 0 || spot.to > docLength) continue
    ranges.push(Decoration.widget({ widget: new BadgeWidget(spot.id), side: 1 }).range(spot.to))
  }
  // CM6 要求按位置有序
  ranges.sort((a, b) => a.from - b.from)
  return Decoration.set(ranges)
}

const badgeField = StateField.define<BadgeState>({
  create: () => ({ spots: [], hidden: false, decorations: Decoration.none }),
  update(value, tr) {
    let { spots, hidden } = value
    let touched = false
    for (const effect of tr.effects) {
      if (effect.is(setBadges)) {
        spots = effect.value
        touched = true
      }
      if (effect.is(setBadgesHidden)) {
        hidden = effect.value
        touched = true
      }
    }
    if (!touched && !tr.docChanged) return value
    // 文档变了但没收到新的 spots：**先按 changes 平移**，别让徽章在重对齐到达前
    // 停在旧偏移上（那一瞬间它会贴错段落）
    const moved = touched ? spots : spots.map((spot) => ({ ...spot, to: tr.changes.mapPos(spot.to) }))
    return { spots: moved, hidden, decorations: build(moved, hidden, tr.state.doc.length) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

export function badgeExtension(): Extension {
  return badgeField
}

/** 当前是否处于"全隐"。⌘⇧H 要来回切，得先知道现在在哪一边。 */
export function badgesHidden(view: EditorView): boolean {
  return view.state.field(badgeField).hidden
}
