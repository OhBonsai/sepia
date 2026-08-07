// 主页终态的纯逻辑（190 P2，原型 Home Layout / H1–H5）。
//
// 三件事：workspace 列表的形状、最近笔记的**相对时间分组**、字母头像。
// 都是"给定数据怎么呈现"，与 fs 无关，所以住在 core。

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export interface Workspace {
  /** book 根目录的绝对路径。**它就是身份**——同一个目录只该有一条。 */
  path: string
  /** 显示名。默认取目录名，用户改名归后话。 */
  name: string
}

/**
 * 字母头像（H1）：取名字第一个字。
 *
 * 待定项 2 说「生成规则（首字/自定义/emoji）衰减前不用管」——**取首字**。
 * 中文取首字、英文取首字母大写；两者都不做转写：`读书笔记` 的头像是「读」而不是 D，
 * 转写会让中文名的头像挤成一堆看不出区别的拼音首字母。
 */
export function avatarOf(name: string): string {
  const first = [...name.trim()][0] ?? '?'
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}

/** 从路径推一个默认名：目录名。 */
export function workspaceName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() ?? trimmed
}

/**
 * 加一个 workspace。**同一个目录只留一条**，且新加的排最前——
 * 刚选的那个就是你现在要用的。
 */
export function addWorkspace(list: Workspace[], path: string): Workspace[] {
  const rest = list.filter((it) => it.path !== path)
  return [{ path, name: workspaceName(path) }, ...rest]
}

/**
 * 最近笔记的**相对时间分组**（H4：越久越粗粒度）。
 *
 * 12 分钟前 → 昨天 → 3 天前 → 上周 → 绝对日期。
 * 粒度随时间变粗是有道理的：刚才写的那篇你要精确到分钟才认得出是哪一次，
 * 而去年那篇你只需要知道它是去年的。
 */
export function relativeTime(at: number, now: number): string {
  const diff = Math.max(0, now - at)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${String(Math.floor(diff / minute))} 分钟前`
  if (diff < day) return `${String(Math.floor(diff / hour))} 小时前`
  if (diff < 2 * day) return '昨天'
  if (diff < 7 * day) return `${String(Math.floor(diff / day))} 天前`
  if (diff < 14 * day) return '上周'
  const d = new Date(at)
  return `${String(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export interface RecentEntry {
  /** book 相对路径，或游离 page 的绝对路径（与 tab 同一套两形态） */
  page: string
  /** 所属 book 根，用来画字母角标 */
  book: string
  mtimeMs: number
}

/** 按相对时间分组，组内保持传入顺序（调用方已按新到旧排好）。 */
export function groupRecents(entries: RecentEntry[], now: number): { label: string; entries: RecentEntry[] }[] {
  const out: { label: string; entries: RecentEntry[] }[] = []
  for (const entry of entries) {
    const label = relativeTime(entry.mtimeMs, now)
    const last = out.at(-1)
    if (last !== undefined && last.label === label) last.entries.push(entry)
    else out.push({ label, entries: [entry] })
  }
  return out
}

/**
 * 主页搜索（H3）：**文件名 + 标题过滤，不是全文搜索**。
 *
 * non-goals 的红线是「book 级全文搜索不做」。这里复用 `@` 的候选与匹配口径，
 * 于是两处的"搜得到什么"永远一致——各写一套的话，用户会发现同一个词
 * 在 `@` 里搜得到、在主页搜不到，而那种不一致比功能少更伤。
 */
export function filterRecents(entries: RecentEntry[], query: string): RecentEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return entries
  return entries.filter((entry) => entry.page.toLowerCase().includes(q))
}
