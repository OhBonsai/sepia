import { access } from 'node:fs/promises'

import { type IoResult, type SessionState, parseSession, serializeSession, withoutPage } from '@sepia/core'

import { atomicWrite, readTextIfExists } from './fsio.ts'
import type { SepiaPaths } from './paths.ts'

// `~/.sepia/session.json`——是**状态**不是设置（架构 §2.2）。
// 解析与容错在 core，这里只碰磁盘，外加一件 core 做不了的事：确认 page 还在不在。

export async function loadSession(paths: SepiaPaths): Promise<SessionState> {
  const read = await readTextIfExists(paths.session)
  const state = parseSession(read.ok ? read.value : null)
  if (state.page === null) return state

  // 上次的 page 可能已被删除或移动。**优雅降级，而不是白屏**（120 §1.2）。
  try {
    await access(state.page)
    return state
  } catch {
    return withoutPage(state)
  }
}

/** 结果必须交还调用方——session 写失败要可见，吞掉它就是静默丢用户的位置（附录 D.3 第 4 条）。 */
export async function saveSession(paths: SepiaPaths, state: SessionState): Promise<IoResult<void>> {
  return atomicWrite(paths.session, serializeSession(state))
}
