import type { SessionState } from '../types/index.ts'

// `~/.sepia/session.json` 的默认值与容错解析。
//
// 这里的每一条容错都对应一种真实的开机场景：文件还没有（首次运行）、
// 文件是空的（上次写了一半）、不是合法 JSON（磁盘坏了或人手改坏了）、
// 字段类型不对（版本迁移）。**四种都不许让应用起不来**——起不来就等于纸没了。

export const SESSION_VERSION = 1

export const EMPTY_SESSION: SessionState = {
  version: SESSION_VERSION,
  page: null,
  cursor: 0,
  scrollTop: 0,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

/**
 * 从磁盘文本解析出会话状态。**永不抛异常**，最差退回 `EMPTY_SESSION`。
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

  const page = raw['page']
  return {
    version: SESSION_VERSION,
    // 只接受绝对路径。相对路径没有 book 身份就无从解析，而 books.ts 归 Stage 6。
    page: typeof page === 'string' && page.startsWith('/') ? page : null,
    cursor: nonNegativeInt(raw['cursor'], 0),
    scrollTop: nonNegativeInt(raw['scrollTop'], 0),
  }
}

export function serializeSession(state: SessionState): string {
  return `${JSON.stringify({ ...state, version: SESSION_VERSION }, null, 2)}\n`
}

/** 上次的 page 已被删除或移动时的降级：丢掉路径与光标，保住其余。 */
export function withoutPage(state: SessionState): SessionState {
  return { ...state, page: null, cursor: 0, scrollTop: 0 }
}
