import type { ContextBlock } from '@sepia/agent/tasks'
import type { AppConfig } from '@sepia/core'

// 把正文切成段、算出每段到选区的距离——**组装器只认 distance，怎么算在这里**
// （架构 §4.3c 的距离衰减链：选区 → 所在段 → 前后各 N 段 → 篇首）。
//
// 住在 renderer 而不是 agent：它要认 markdown 的段落形状，而 agent 包刻意不认文档结构。
// 这条分界的好处在于将来——换 CM6 的段落判定、加 frontmatter 识别，都不必动组装规则。

/** 篇首（标题与 frontmatter）的距离。给一个大数，让它排在邻近段之后、但仍进得去。 */
const HEAD_DISTANCE = 1_000

/**
 * `scope` 是配置项 `contextScope`（裁决 2.1，默认 `page`）在**行为上的唯一落点**。
 *
 * · `page` —— 取材链展开到覆盖整篇：所在段的前后各段全部进来，篇首另算一块。
 *   「默认整篇」说的是这个展开范围，**不是整篇必然进 prompt**——超预算时组装器
 *   仍然硬截断，离选区近的先进（架构 §4.3c）。
 * · `selection` —— **一块邻近都不取**，只发选区。想要最短 prompt / 最低 TTFT 的人用它。
 *
 * 写在这里而不是组装器里：组装器只认 `distance`，刻意不认文档结构，也就不该认
 * 「整篇还是只要选区」这种取材范围的事。
 */
export function nearbyBlocks(
  doc: string,
  range: { from: number; to: number },
  scope: AppConfig['contextScope'] = 'page',
): ContextBlock[] {
  if (scope === 'selection') return []

  const blocks: ContextBlock[] = []
  const paragraphs = splitParagraphs(doc)

  // 选区落在哪一段：用区间相交判断，而不是「起点在段内」——
  // 跨段选区的起点可能落在段间的空行上，那样会判成不属于任何一段。
  let anchor = paragraphs.findIndex((p) => range.from < p.end && range.to > p.start)
  if (anchor === -1) anchor = 0

  for (const [index, paragraph] of paragraphs.entries()) {
    if (index === anchor) continue
    blocks.push({
      kind: 'nearby',
      text: paragraph.text,
      distance: Math.abs(index - anchor),
    })
  }

  // 篇首单独进一块：它给模型全局定位（这是什么文章），与「邻近」是两种用途。
  const head = paragraphs[0]
  if (head !== undefined && anchor !== 0) {
    blocks.push({ kind: 'nearby', text: head.text, distance: HEAD_DISTANCE })
  }
  return blocks
}

interface Paragraph {
  text: string
  start: number
  end: number
}

/** 按空行切段。**保留偏移量**——距离要靠它算，切完丢了位置就对不上选区了。 */
function splitParagraphs(doc: string): Paragraph[] {
  const paragraphs: Paragraph[] = []
  const pattern = /\n[ \t]*\n/g
  let start = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(doc)) !== null) {
    const end = match.index
    if (doc.slice(start, end).trim() !== '') paragraphs.push({ text: doc.slice(start, end), start, end })
    start = pattern.lastIndex
  }
  if (doc.slice(start).trim() !== '') paragraphs.push({ text: doc.slice(start), start, end: doc.length })
  return paragraphs
}
