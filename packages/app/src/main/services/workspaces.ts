import type { IoResult, Workspace } from '@sepia/core'

import { atomicWrite, readTextIfExists } from './fsio.ts'
import type { SepiaPaths } from './paths.ts'

// 已知 book 列表（190 P2 / H1）。**是状态不是设置**（架构 §2.2 的分法），
// 所以它住 `~/.sepia/workspaces.json` 而不是 config.json——
// 用户不会手改它，而 config.json 是给人手改的。
//
// 解析容错与 session 同一条原则：**坏了就退成空，不许让应用起不来**。
// 一个读不出来的列表最多是主页少几行，而崩掉是纸没了。

interface WorkspacesFile {
  version: number
  books: { path: string; name: string }[]
}

export async function loadWorkspaces(paths: SepiaPaths): Promise<Workspace[]> {
  const read = await readTextIfExists(paths.workspaces)
  if (!read.ok || read.value === null) return []
  try {
    const parsed = JSON.parse(read.value) as Partial<WorkspacesFile>
    if (!Array.isArray(parsed.books)) return []
    return parsed.books
      .filter((it): it is { path: string; name: string } => typeof it?.path === 'string' && it.path !== '')
      .map((it) => ({ path: it.path, name: typeof it.name === 'string' && it.name !== '' ? it.name : it.path }))
  } catch {
    return []
  }
}

export async function saveWorkspaces(paths: SepiaPaths, books: Workspace[]): Promise<IoResult<void>> {
  return atomicWrite(paths.workspaces, JSON.stringify({ version: 1, books }, null, 2))
}
