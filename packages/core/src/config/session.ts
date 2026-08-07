import type { SessionState, TabState } from '../types/index.ts'

// `~/.sepia/session.json` 的默认值与容错解析。
//
// 这里的每一条容错都对应一种真实的开机场景：文件还没有（首次运行）、
// 文件是空的（上次写了一半）、不是合法 JSON（磁盘坏了或人手改坏了）、
// 字段类型不对（版本不认）。**四种都不许让应用起不来**——起不来就等于纸没了。

export const SESSION_VERSION = 2

export const EMPTY_SESSION: SessionState = {
  version: SESSION_VERSION,
  book: null,
  tabs: [],
  active: 0,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

function parseTab(raw: unknown): TabState | null {
  if (!isRecord(raw)) return null
  const page = raw['page']
  // 空字符串不是路径。绝对（游离）与相对（book 内）都收——**哪种由写入方决定**，
  // 这里只拒绝"根本不是路径"的东西。
  if (typeof page !== 'string' || page.trim() === '') return null
  return { page, cursor: nonNegativeInt(raw['cursor'], 0), scrollTop: nonNegativeInt(raw['scrollTop'], 0) }
}

/**
 * 从磁盘文本解析出会话状态。**永不抛异常**，最差退回 `EMPTY_SESSION`。
 *
 * **v1 按"损坏"处理，退空会话**——这是人裁（170 §2.0 条 1），不是缺陷：
 * 产品未发布，没有真实用户的 v1 文件需要照顾；把力气花在终态 schema 上，
 * 比花在给不存在的用户写迁移代码上划算。**读到 v1 的人只会丢掉"上次开着哪些 tab"**，
 * 一个字节的正文都不会少——session 是状态不是数据。
 *
 * @param text 文件内容；文件不存在时传 `null`
 */
export function parseSession(text: string | null): SessionState {
  if (text === null || text.trim() === '') return { ...EMPTY_SESSION }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ...EMPTY_SESSION }
  }
  if (!isRecord(raw)) return { ...EMPTY_SESSION }
  // 版本不是 2 就当损坏（含 v1）。见上：这是人裁的取舍，不是没想到迁移。
  if (raw['version'] !== SESSION_VERSION) return { ...EMPTY_SESSION }

  const book = raw['book']
  const rawTabs = raw['tabs']
  const tabs = Array.isArray(rawTabs) ? rawTabs.map(parseTab).filter((tab): tab is TabState => tab !== null) : []
  // active 必须落在 tabs 之内——越界会让 UI 拿 undefined 去渲染
  const active = Math.min(nonNegativeInt(raw['active'], 0), Math.max(0, tabs.length - 1))

  return {
    version: SESSION_VERSION,
    // book 只接受绝对路径：它是"哪个文件夹"，相对于谁都说不清
    book: typeof book === 'string' && book.startsWith('/') ? book : null,
    tabs,
    active,
  }
}

export function serializeSession(state: SessionState): string {
  return `${JSON.stringify({ ...state, version: SESSION_VERSION }, null, 2)}\n`
}

/**
 * tab 的 page → 绝对路径。**两个进程共用这一份**（main 要读盘、renderer 要请求读盘），
 * 各写一份的话，"book 内存相对、游离存绝对"这条约定迟早会在某一侧被理解成另一样。
 * 不引 `node:path`——core 是叶子包，这里只做字符串拼接（POSIX 与 win32 绝对路径都认）。
 */
export function tabPath(book: string | null, page: string): string {
  if (/^(?:\/|[A-Za-z]:[\\/])/.test(page)) return page
  if (book === null) return page
  return `${book.replace(/[\\/]+$/, '')}/${page}`
}

/** 反向：收得进 book 就存相对，收不进就存绝对。 */
export function tabRelative(book: string | null, absolute: string): string {
  if (book === null) return absolute
  const prefix = `${book.replace(/[\\/]+$/, '')}/`
  return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute
}

/** 关掉一个 tab。**active 跟着往前挪**，不许指到空处。 */
export function closeTab(state: SessionState, index: number): SessionState {
  if (index < 0 || index >= state.tabs.length) return state
  const tabs = state.tabs.filter((_tab, at) => at !== index)
  const active = tabs.length === 0 ? 0 : Math.min(state.active > index ? state.active - 1 : state.active, tabs.length - 1)
  return { ...state, tabs, active }
}

/**
 * 打开一个 page：**已经开着就聚焦过去，不重复开**（170 §2.1 ①）。
 * 四个入口（⌘O / 树 / `@` / argv）共用它，所以"重复打开"这件事只需在一处判断。
 */
export function openTab(state: SessionState, tab: TabState): SessionState {
  const existing = state.tabs.findIndex((it) => it.page === tab.page)
  if (existing !== -1) return { ...state, active: existing }
  return { ...state, tabs: [...state.tabs, tab], active: state.tabs.length }
}

/** 记下某个 tab 的光标与滚动（切走前调用，切回来才回得到原处）。 */
export function updateTab(state: SessionState, index: number, patch: Partial<Omit<TabState, 'page'>>): SessionState {
  const target = state.tabs[index]
  if (target === undefined) return state
  return {
    ...state,
    tabs: state.tabs.map((tab, at) => (at === index ? { ...tab, ...patch } : tab)),
  }
}

/** 上次那个 page 已被删除或移动时的降级：把它从 tabs 里摘掉，其余保住。 */
export function withoutPage(state: SessionState, page: string): SessionState {
  const index = state.tabs.findIndex((tab) => tab.page === page)
  return index === -1 ? state : closeTab(state, index)
}
