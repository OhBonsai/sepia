import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { limitTree, pushRecent, titleOf, type IoResult, type RefCandidate, type TreeEntry, type TreeScan } from '@sepia/core'

import { atomicWrite, readTextIfExists } from './fsio.ts'
import { openBookStore } from './books.ts'
import type { SepiaPaths } from './paths.ts'

// 库的 main 侧（170 §2.1 ②③④）：扫盘、读写 recents、补标题。
// **判定全在 core**（上限/降级/匹配/置顶），这里只做 IO。

/** 不进树的目录：它们不是"用户的笔记"，列出来只会淹掉真正想找的东西。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.sepia', '.obsidian', '.vscode', '.idea', 'img'])

/**
 * 扫一个 book。**一次性、异步、不递归 watch**（纪律 12 + 6a 回流 1）：
 * 它在 t5 之后才被调用，绝不许出现在启动同步路径上——树再有用，也不能让纸晚一毫秒可写。
 */
export async function scanBook(root: string, limit: number): Promise<TreeScan> {
  const entries: TreeEntry[] = []

  const walk = async (dir: string, depth: number): Promise<void> => {
    // **提前收手**：已经超上限就不必再往下走了——降级本来也只留第一层，
    // 继续深挖只是白花 IO（几万文件的目录正是这条要防的场景）
    if (entries.length > limit * 4) return
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return // 读不动的目录（权限）跳过，不让整棵树失败
    }
    for (const name of names.toSorted()) {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
      const full = join(dir, name)
      let isDir: boolean
      try {
        isDir = (await stat(full)).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        entries.push({ path: relative(root, full), name, kind: 'dir', depth })
        await walk(full, depth + 1)
      } else if (name.endsWith('.md') || name.endsWith('.markdown')) {
        // 树只列 markdown：这是 markdown 笔记本，不是文件管理器
        entries.push({ path: relative(root, full), name, kind: 'file', depth })
      }
    }
  }

  await walk(root, 0)
  return limitTree(entries, limit)
}

/**
 * `@` 的候选表：文件名先给，**标题后台补**。
 *
 * 标题要读每个文件的头部，几百个文件就是几百次 IO——所以它绝不能挡在
 * "按下 `@` 到出列表"这条路上（§2.5 D2 < 100ms）。这里把两步分开：
 * 调用方先拿到只有文件名的候选，标题补好之后再刷新一次。
 */
export function candidatesFrom(scan: TreeScan): RefCandidate[] {
  return scan.entries
    .filter((entry) => entry.kind === 'file')
    .map((entry) => ({ path: entry.path, name: entry.name }))
}

/** 给候选补标题（首个 H1 或 frontmatter title）。读不动的跳过，不让一个文件毁掉整批。 */
export async function fillTitles(root: string, candidates: RefCandidate[]): Promise<RefCandidate[]> {
  const out: RefCandidate[] = []
  for (const candidate of candidates) {
    try {
      // 只读头部：标题不可能藏在第 500 行（读全文在大 book 上是几十 MB）
      const text = (await readFile(join(root, candidate.path), 'utf8')).slice(0, 2048)
      const title = titleOf(text)
      out.push(title === undefined ? candidate : { ...candidate, title })
    } catch {
      out.push(candidate)
    }
  }
  return out
}

interface RecentsFile {
  version: number
  pages: string[]
}

const RECENTS_VERSION = 1

/** 最近打开：住 `~/.sepia/books/<id>/recents.json`，**不进 book**（T-34 同理）。 */
export async function readRecents(paths: SepiaPaths, book: string): Promise<string[]> {
  const store = await openBookStore(paths, book)
  const raw = await readTextIfExists(join(store.dir, 'recents.json'))
  if (!raw.ok || raw.value === null) return []
  try {
    const parsed = JSON.parse(raw.value) as RecentsFile
    return Array.isArray(parsed.pages) ? parsed.pages.filter((it): it is string => typeof it === 'string') : []
  } catch {
    return []
  }
}

export async function touchRecent(
  paths: SepiaPaths,
  book: string,
  page: string,
  limit: number,
): Promise<IoResult<string[]>> {
  const store = await openBookStore(paths, book)
  const next = pushRecent(await readRecents(paths, book), page, limit)
  const file: RecentsFile = { version: RECENTS_VERSION, pages: next }
  const written = await atomicWrite(join(store.dir, 'recents.json'), JSON.stringify(file, null, 2))
  return written.ok ? { ok: true, value: next } : written
}
