import { realpath, stat } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'

import {
  ANCHOR_FILE_VERSION,
  BOOK_META_VERSION,
  bookId,
  type Anchor,
  type AnchorFile,
  type BookMeta,
  type IoResult,
} from '@sepia/core'

import { atomicWrite, readTextIfExists } from './fsio.ts'
import type { SepiaPaths } from './paths.ts'

// book 侧数据（T-34 / 160 §1.1 三）：`~/.sepia/books/<book-id>/{meta,anchors}.json`。
//
// **一个字节都不进 book**。锚点是 Sepia 的私产，不是笔记内容：
// 放进 book 就会被 git 追踪、被 clone 带走、在 diff 里刷屏，而它对另一台机器毫无意义。
// 纪律 20 的落点也在这儿——路径全部由 `paths.ts` 派生。

export interface BookStore {
  /** book 的私有目录（已按 realpath 散列）。 */
  dir: string
  readAnchors(): Promise<Anchor[]>
  writeAnchors(anchors: Anchor[]): Promise<IoResult<void>>
  /** 记下 book 的当前真实路径。b 期的「重新关联」靠它认出 book 被搬过。 */
  writeMeta(): Promise<IoResult<void>>
  readMeta(): Promise<BookMeta | null>
}

/**
 * 打开一个 book 的私有存储。
 *
 * `bookPath` **先解析成 realpath 再散列**——`/var` 与 `/private/var` 是同一个地方的
 * 两个名字，不归一化就会散出两个 book-id、两份锚点（与「最近自写记录」同一条要求）。
 */
export async function openBookStore(paths: SepiaPaths, bookPath: string): Promise<BookStore> {
  const real = await realpath(bookPath).catch(() => bookPath)
  const id = bookId(real)
  const dir = join(paths.home, 'books', id)
  const anchorsPath = join(dir, 'anchors.json')
  const metaPath = join(dir, 'meta.json')

  return {
    dir,

    async readAnchors() {
      const raw = await readTextIfExists(anchorsPath)
      if (!raw.ok || raw.value === null) return []
      try {
        const parsed = JSON.parse(raw.value) as AnchorFile
        // 形状不对就当没有——锚点读坏了顶多丢徽章，不该让 book 打不开（不变量 1 的精神）
        return Array.isArray(parsed.anchors) ? parsed.anchors : []
      } catch {
        return []
      }
    },

    async writeAnchors(anchors) {
      const file: AnchorFile = { version: ANCHOR_FILE_VERSION, anchors }
      return atomicWrite(anchorsPath, JSON.stringify(file, null, 2))
    },

    async writeMeta() {
      const meta: BookMeta = { version: BOOK_META_VERSION, path: real }
      return atomicWrite(metaPath, JSON.stringify(meta, null, 2))
    },

    async readMeta() {
      const raw = await readTextIfExists(metaPath)
      if (!raw.ok || raw.value === null) return null
      try {
        return JSON.parse(raw.value) as BookMeta
      } catch {
        return null
      }
    },
  }
}

// ── Stage 6a：book 身份的另一半——**一个 page 属于哪个 book，以及它是否游离**（T-30）──
//
// 与上面那半刻意同住一个文件、刻意不互相调用：上半是「这个 book 的私产存哪」（要 book-id），
// 下半是「这个 page 有没有 book」（只要根在哪）。Stage 6a 只需要下半，
// 而 b 期的文件树会同时用到两半。
//
// 判据是 `.git`：架构与 160 都把「book = git repo」当既有事实（一本 book = 文件夹 = git repo）。
// 于是「游离 page」= 不在任何 git repo 里的 .md，正好与 T-30 的降级语义对齐：
// 无 book 则无 git（无版本、无徽章）、无 `@` 引用，**纸本身完全可写**（不变量 1 同构）。

/** 找到包含该 page 的 book 根；不在任何 book 里返回 null（= 游离 page）。 */
export async function findBookRoot(pagePath: string): Promise<string | null> {
  const root = parse(pagePath).root
  let dir = dirname(pagePath)
  // 走到文件系统根就停。不设深度上限：路径本身有限，循环必然终止。
  for (;;) {
    if (await isRepo(dir)) return dir
    if (dir === root) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** `.git` 既可能是目录（常规 repo）也可能是文件（worktree / submodule）——两者都算。 */
async function isRepo(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

export interface PageContext {
  page: string
  /** book 根；null = 游离。 */
  book: string | null
  detached: boolean
}

export async function pageContext(pagePath: string): Promise<PageContext> {
  const book = await findBookRoot(pagePath)
  return { page: pagePath, book, detached: book === null }
}
