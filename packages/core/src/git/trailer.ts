// commit message 与 git trailer（架构 §4.2）。**固定 message，永不调模型**——
// 让模型给每次保存写 commit message，既慢又贵又不稳定，而这些 commit 的读者
// 是徽章与还白链路，不是人类审阅者。
//
// 纯逻辑住 core：格式与解析要能被单测直接对拍，不必起 git。

/** 三种触发对应三种固定 message（架构 §4.2 三触发）。 */
export const COMMIT_REASONS = {
  /** 静默：停止输入久于阈值 */
  save: 'sepia: save',
  /** 定时兜底 */
  auto: 'sepia: auto',
  /** markup 落笔前后成对（a 期只建 API，不接线） */
  premarkup: 'sepia: pre-markup',
  markup: 'sepia: markup',
} as const

export type CommitReason = keyof typeof COMMIT_REASONS

export interface CommitTrailers {
  /** 这次提交涉及的 page（相对 book 根的路径）。 */
  page?: string
  /** 关联的 markup 线程 id。**a 期恒空**——线程是 b 期才有的东西。 */
  thread?: string
}

const KEYS = { page: 'Sepia-Page', thread: 'Sepia-Thread' } as const

/**
 * 拼 commit message。
 *
 * trailer 与正文之间**必须空一行**，否则 `git interpret-trailers` 与我们自己的解析
 * 都会把它当成 message 正文的一部分。
 */
export function commitMessage(reason: CommitReason, trailers: CommitTrailers = {}): string {
  const lines: string[] = []
  if (trailers.page !== undefined) lines.push(`${KEYS.page}: ${encodeValue(trailers.page)}`)
  if (trailers.thread !== undefined) lines.push(`${KEYS.thread}: ${encodeValue(trailers.thread)}`)
  const subject = COMMIT_REASONS[reason]
  return lines.length === 0 ? subject : `${subject}\n\n${lines.join('\n')}`
}

/** 从 commit message 里取回 trailer。认不出的行一律忽略（与 SSE 规则 4 同一种保守）。 */
export function parseTrailers(message: string): CommitTrailers {
  const out: CommitTrailers = {}
  for (const line of message.split(/\r?\n/)) {
    const cut = line.indexOf(': ')
    if (cut === -1) continue
    const key = line.slice(0, cut)
    const value = decodeValue(line.slice(cut + 2))
    if (key === KEYS.page) out.page = value
    else if (key === KEYS.thread) out.thread = value
  }
  return out
}

export function parseReason(message: string): CommitReason | null {
  const subject = message.split(/\r?\n/, 1)[0] ?? ''
  for (const [reason, text] of Object.entries(COMMIT_REASONS)) {
    if (text === subject) return reason as CommitReason
  }
  return null
}

/**
 * 换行与回车会把一条 trailer 撑成两行，解析时后半截就成了野行——路径里真的可能有换行
 * （POSIX 只禁 `/` 与 `\0`）。转义掉，解析时还原；**这就是 #4「特殊字符 page 路径」
 * 那条检查要防的事故**。
 */
function encodeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
}

function decodeValue(value: string): string {
  return value.replace(/\\(.)/g, (_all, ch: string) => (ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch))
}
