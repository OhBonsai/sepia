// 锚点对齐（架构 §4.2）。**纯函数，零依赖**——core 是叶子包，这里连 git 都不认识。
//
// 要解决的事：一段正文上挂过东西（b 期的徽章/线程），文件后来被改了，那东西还该挂在哪。
//
// **总原则：宁可孤儿不误挂**（架构 §4.2）。挂丢了，用户在面板的置灰区还能找回来；
// 挂错了，用户看到的是"这条对话属于这段文字"——而它其实属于别处，**那是在撒谎**。
// 所有阈值因此都往保守一侧调，判不准就判孤儿。

/** 一个锚点：它记住自己**当时**贴在哪段文字上，以及那段文字的前后文。 */
export interface Anchor {
  id: string
  /** 引文：锚点当时覆盖的正文，逐字。 */
  quote: string
  /** 引文之前的一小段（定位用，不参与判等）。 */
  before: string
  /** 引文之后的一小段。 */
  after: string
  /** 上次已知的偏移。 */
  from: number
  to: number
}

export type Alignment =
  /** 一级：老位置上原文未变 */
  | { kind: 'exact'; from: number; to: number }
  /** 二级：引文完好，只是整体挪了位置（增删发生在它前面） */
  | { kind: 'shifted'; from: number; to: number }
  /** 三级：引文本身也被改了，靠前后文 + 相似度找回来 */
  | { kind: 'fuzzy'; from: number; to: number; score: number }
  /** 四级：认不出来了。**这不是失败，是诚实** */
  | { kind: 'orphan' }

export interface AnchorOptions {
  /**
   * 模糊匹配的相似度下限（0–1，字符二元组 Dice 系数）。默认 0.75。
   * 调低 = 更容易误挂，**这正是 §1.5 #5 反证例要盯的方向**。
   */
  fuzzyThreshold?: number
  /**
   * 多处同文时，最佳候选要比次佳高出这么多前后文得分才算数（默认 0.15）。
   * 差距不够 = 分不清是哪一处 = 判孤儿。
   */
  ambiguityMargin?: number
}

const DEFAULTS = { fuzzyThreshold: 0.75, ambiguityMargin: 0.15 }

/** 字符二元组集合。中文按字，英文按字母——都不需要分词。 */
function bigrams(text: string): Map<string, number> {
  const out = new Map<string, number>()
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length < 2) {
    if (normalized.length === 1) out.set(normalized, 1)
    return out
  }
  for (let i = 0; i < normalized.length - 1; i++) {
    const gram = normalized.slice(i, i + 2)
    out.set(gram, (out.get(gram) ?? 0) + 1)
  }
  return out
}

/**
 * Dice 系数：2|A∩B| / (|A|+|B|)。
 * 选它不选编辑距离，是因为它对**局部改写**宽容、对**整段换掉**严厉——正是我们要的形状：
 * 改几个词还认得出，面目全非就该判孤儿。且它是 O(n)，长文里可以随便算。
 */
export function similarity(a: string, b: string): number {
  const ga = bigrams(a)
  const gb = bigrams(b)
  let total = 0
  let shared = 0
  for (const count of ga.values()) total += count
  for (const [gram, count] of gb) {
    total += count
    const inA = ga.get(gram)
    if (inA !== undefined) shared += Math.min(inA, count)
  }
  if (total === 0) return a === b ? 1 : 0
  return (2 * shared) / total
}

function occurrences(text: string, needle: string): number[] {
  if (needle === '') return []
  const out: number[] = []
  let at = text.indexOf(needle)
  while (at !== -1) {
    out.push(at)
    at = text.indexOf(needle, at + 1)
  }
  return out
}

/** 候选处的前后文与锚点记的前后文有多像。两侧都空时返回 0（没有信息，不是"完全匹配"）。 */
function contextScore(anchor: Anchor, text: string, from: number, to: number): number {
  const before = text.slice(Math.max(0, from - anchor.before.length), from)
  const after = text.slice(to, to + anchor.after.length)
  const scores: number[] = []
  if (anchor.before !== '') scores.push(similarity(anchor.before, before))
  if (anchor.after !== '') scores.push(similarity(anchor.after, after))
  if (scores.length === 0) return 0
  return scores.reduce((sum, value) => sum + value, 0) / scores.length
}

/**
 * 把锚点对到新文本上。
 *
 * **没有"二级要读 git diff hunk"这一步**：160 §1.2 原文写的是「git diff hunk 平移」，
 * 但引文完好时，直接在新文本里找它就得到同一个答案，且不必让 core 认识 git、
 * 不必为每次对齐跑一次子进程。真正需要 hunk 的场景（引文也被改了）由三级的
 * 前后文 + 相似度接手。**这是有意的简化，记在 160 §1.9。**
 */
export function realign(anchor: Anchor, text: string, options: AnchorOptions = {}): Alignment {
  const fuzzyThreshold = options.fuzzyThreshold ?? DEFAULTS.fuzzyThreshold
  const margin = options.ambiguityMargin ?? DEFAULTS.ambiguityMargin

  // 空引文锚不住任何东西——直接孤儿，别让它去 indexOf('') 匹配到处都是
  if (anchor.quote === '') return { kind: 'orphan' }

  // ── 一级：老位置原样 ────────────────────────────────────────────────
  if (text.slice(anchor.from, anchor.to) === anchor.quote) {
    return { kind: 'exact', from: anchor.from, to: anchor.to }
  }

  // ── 二级：引文完好，位置挪了 ────────────────────────────────────────
  const found = occurrences(text, anchor.quote)
  if (found.length === 1) {
    const from = found[0]!
    return { kind: 'shifted', from, to: from + anchor.quote.length }
  }
  if (found.length > 1) {
    // 多处同文（"第三段。" 这种短句在长文里很常见）。靠前后文分辨；
    // **分不清就判孤儿**——随便挑一个就是误挂。
    const ranked = found
      .map((from) => ({ from, score: contextScore(anchor, text, from, from + anchor.quote.length) }))
      .toSorted((a, b) => b.score - a.score)
    const best = ranked[0]!
    const second = ranked[1]!
    if (best.score - second.score < margin) return { kind: 'orphan' }
    return { kind: 'shifted', from: best.from, to: best.from + anchor.quote.length }
  }

  // ── 三级：引文也被改了，靠前后文圈出候选区间再比相似度 ──────────────
  const candidate = locateByContext(anchor, text)
  if (candidate === null) return { kind: 'orphan' }
  const score = similarity(anchor.quote, text.slice(candidate.from, candidate.to))
  if (score < fuzzyThreshold) return { kind: 'orphan' }
  return { kind: 'fuzzy', from: candidate.from, to: candidate.to, score }
}

/**
 * 用前后文圈出"引文应该在的那一段"。
 *
 * 两侧都在 → 夹出来的就是它；只有一侧在 → 从那一侧按原长度量出去；都不在 → 放弃。
 * **不做全文滑窗**：滑窗能找到"最像的一段"，但长文里总能找到一段比阈值像的东西，
 * 那正是误挂的来源。没有前后文佐证就不猜。
 */
function locateByContext(anchor: Anchor, text: string): { from: number; to: number } | null {
  const beforeAt = anchor.before === '' ? -1 : text.lastIndexOf(anchor.before)
  const afterAt = anchor.after === '' ? -1 : text.indexOf(anchor.after)

  if (beforeAt !== -1 && afterAt !== -1) {
    const from = beforeAt + anchor.before.length
    if (afterAt > from) return { from, to: afterAt }
    return null
  }
  if (beforeAt !== -1) {
    const from = beforeAt + anchor.before.length
    return { from, to: Math.min(text.length, from + anchor.quote.length) }
  }
  if (afterAt !== -1) {
    const to = afterAt
    return { from: Math.max(0, to - anchor.quote.length), to }
  }
  return null
}

/** 建锚点：从一段文本与一个区间取引文与前后文。前后文长度默认 40 字符。 */
export function createAnchor(
  id: string,
  text: string,
  range: { from: number; to: number },
  contextChars = 40,
): Anchor {
  return {
    id,
    quote: text.slice(range.from, range.to),
    before: text.slice(Math.max(0, range.from - contextChars), range.from),
    after: text.slice(range.to, range.to + contextChars),
    from: range.from,
    to: range.to,
  }
}

/** 锚点文件的形状（落 `~/.sepia/books/<book-id>/anchors.json`，**不进 git**，T-34）。 */
export interface AnchorFile {
  version: number
  anchors: Anchor[]
}

export const ANCHOR_FILE_VERSION = 1
