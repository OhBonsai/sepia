// 连接面板的纯逻辑（190 P5 / F17）。
//
// **只做"我引了谁"，不做"谁引了我"**（190 P5 明写；features 待定项 3）：
// 反向链接要全 book 索引，与 H3 全文搜索同属一个技术前提，而那条是 non-goals 的红线。
// 半个反向链接（只扫最近几篇）比没有更糟——它会让人以为"没有别人引用这篇"。

export interface LinkRef {
  /** 链接目标：book 内相对路径，或 http(s) 外链 */
  target: string
  /** 显示文字 */
  label: string
  /** 是不是外链 */
  external: boolean
  /** 在正文里的字符位置，点击时用来跳过去 */
  at: number
  /** **位置标注**：第 N 段 / 末段（F17 原文要求） */
  where: string
  /** 引用处的原文摘录 */
  excerpt: string
}

/** 段落切分：空行分段，与 markup 的 nearby 同一口径。 */
function paragraphAt(text: string, at: number): { index: number; total: number; body: string } {
  const paragraphs: { from: number; to: number }[] = []
  let start = 0
  const pattern = /\n\s*\n/g
  let match = pattern.exec(text)
  while (match !== null) {
    paragraphs.push({ from: start, to: match.index })
    start = match.index + match[0].length
    match = pattern.exec(text)
  }
  paragraphs.push({ from: start, to: text.length })
  const index = paragraphs.findIndex((p) => at >= p.from && at <= p.to)
  const found = paragraphs[Math.max(0, index)] ?? { from: 0, to: text.length }
  return { index: Math.max(0, index), total: paragraphs.length, body: text.slice(found.from, found.to) }
}

/** 摘录：以链接为中心截一段，两头留白。 */
function excerptAround(body: string, label: string): string {
  const trimmed = body.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= 60) return trimmed
  const at = trimmed.indexOf(label)
  const from = Math.max(0, at - 24)
  return `${from > 0 ? '…' : ''}${trimmed.slice(from, from + 60)}${from + 60 < trimmed.length ? '…' : ''}`
}

/**
 * 抽出本篇的全部引用（F17）。
 *
 * 顺序 = 出现顺序。**不去重**——同一篇被引三次是三个不同的位置，
 * 而这块面板回答的正是"在哪儿引的"。
 */
export function collectLinks(text: string): LinkRef[] {
  const out: LinkRef[] = []
  const pattern = /\[([^\]]*)\]\(([^)\s]+)\)/g
  let match = pattern.exec(text)
  while (match !== null) {
    const label = match[1] ?? ''
    const target = match[2] ?? ''
    // 图片不是引用（`![]()` 的前一个字符是 `!`）
    const isImage = match.index > 0 && text[match.index - 1] === '!'
    if (!isImage && target !== '') {
      const external = /^https?:\/\//i.test(target)
      const paragraph = paragraphAt(text, match.index)
      out.push({
        target,
        label,
        external,
        at: match.index,
        where:
          paragraph.index === paragraph.total - 1
            ? '末段'
            : paragraph.index === 0
              ? '首段'
              : `第 ${String(paragraph.index + 1)} 段`,
        excerpt: excerptAround(paragraph.body, label),
      })
    }
    match = pattern.exec(text)
  }
  return out
}
