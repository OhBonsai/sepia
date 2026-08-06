// 库（文件树 / 最近 / `@` 匹配）的纯逻辑（170 §2.1 ②③④）。
// **不碰 fs、不碰 DOM**——扫描由 main 做，这里只管"扫回来的东西怎么算"。

/** 树上的一个条目。目录与文件用同一个形状——树只有这两种东西。 */
export interface TreeEntry {
  /** book 相对路径。根目录自己不在表里。 */
  path: string
  name: string
  kind: 'dir' | 'file'
  /** 目录深度，根下第一层是 0。降级时只留 0。 */
  depth: number
}

export interface TreeScan {
  entries: TreeEntry[]
  /**
   * **降级了没有**（6a 回流 1：监听有界）。
   * 超上限时只留第一层，并且告诉 UI「这不是全部」——
   * 悄悄截断比降级更糟：用户会以为文件真的只有这些。
   */
  degraded: boolean
  /** 扫到的总条目数（含被截掉的），给降级提示用。 */
  total: number
}

/**
 * 把扫回来的平表按上限裁一次。
 *
 * **上限是"有界"这条约定的唯一落点**（架构 §4.9 待补的那句）：没有它，
 * 一个几万文件的目录会把树、watcher、内存一起拖垮，而那正是 6a 回流 1
 * 记下来的事故形态。
 */
export function limitTree(entries: TreeEntry[], limit: number): TreeScan {
  if (entries.length <= limit) return { entries, degraded: false, total: entries.length }
  // 降级：**只留第一层**。留"前 N 个"是更糟的选择——用户看到的是一棵
  // 随机截断的树，而不是"这里太大了，只给你看顶层"。
  const top = entries.filter((entry) => entry.depth === 0)
  return { entries: top.slice(0, limit), degraded: true, total: entries.length }
}

// ── `@` 引用的匹配（§2.1 ④：只搜文件名 + 标题，零索引服务）──────────────────

export interface RefCandidate {
  /** book 相对路径，插链接时用它 */
  path: string
  name: string
  /** 首个 H1 或 frontmatter title。**后台异步补建**，没建好时是 undefined。 */
  title?: string
}

/** 匹配得分越大越靠前；0 = 不匹配。 */
function score(candidate: RefCandidate, query: string): number {
  const q = query.toLowerCase()
  if (q === '') return 1
  const name = candidate.name.toLowerCase()
  const title = (candidate.title ?? '').toLowerCase()
  // 前缀命中最强，其次子串，最后是"字符按序出现"的模糊命中。
  // **标题没建好时只按文件名算**——这条不是降级路径，是常态路径：
  // 索引是后台补的，而用户按下 `@` 的那一刻必须立刻有列表（§2.5 D2）。
  if (name.startsWith(q)) return 100
  if (title.startsWith(q)) return 90
  if (name.includes(q)) return 70
  if (title.includes(q)) return 60
  return subsequence(name, q) ? 30 : subsequence(title, q) ? 20 : 0
}

/** `q` 的字符按顺序出现在 `text` 里（不要求连续）。 */
function subsequence(text: string, q: string): boolean {
  let at = 0
  for (const ch of q) {
    at = text.indexOf(ch, at)
    if (at === -1) return false
    at += 1
  }
  return true
}

export function matchRefs(candidates: RefCandidate[], query: string, limit = 8): RefCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, value: score(candidate, query) }))
    .filter((it) => it.value > 0)
    .toSorted((a, b) => b.value - a.value || a.candidate.name.localeCompare(b.candidate.name))
    .slice(0, limit)
    .map((it) => it.candidate)
}

/**
 * 从正文里取标题：**首个 H1，其次 frontmatter 的 title**（§2.0 人裁 4）。
 * 两个都没有就返回 undefined——那时 `@` 只按文件名匹配，不编一个出来。
 */
export function titleOf(text: string): string | undefined {
  const lines = text.split(/\r?\n/)
  if (lines[0] === '---') {
    for (let i = 1; i < lines.length && i < 40; i++) {
      const line = lines[i] ?? ''
      if (line === '---') break
      const match = /^title:\s*(.+?)\s*$/.exec(line)
      if (match) return match[1]!.replace(/^['"]|['"]$/g, '')
    }
  }
  for (const line of lines) {
    const match = /^#\s+(.+?)\s*$/.exec(line)
    if (match) return match[1]
  }
  return undefined
}

// ── 最近打开（§2.1 ③）───────────────────────────────────────────────────

/** 打开一个 page：**置顶、去重、截断**。三件事一起做，少一件就会长歪。 */
export function pushRecent(recents: string[], page: string, limit: number): string[] {
  const next = [page, ...recents.filter((it) => it !== page)]
  return next.slice(0, Math.max(0, limit))
}
