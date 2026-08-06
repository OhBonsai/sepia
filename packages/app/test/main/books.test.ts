import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { bookId, createAnchor } from '@sepia/core'
import { afterEach, describe, expect, it } from 'vitest'

import { openBookStore } from '../../src/main/services/books.ts'
import { sepiaPaths } from '../../src/main/services/paths.ts'

// 锚点与 book 元信息的落盘（T-34）。破坏方式瞄的是两个事故：
// **锚点混进 book**（会被 git 带走）与 **同一个 book 散成两份**（路径没归一化）。

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sepia-books-'))
  dirs.push(dir)
  return dir
}

describe('book 私有存储', () => {
  it('**一个字节都不进 book**：锚点落在 ~/.sepia/books/<id>/ 下', async () => {
    const home = await scratch()
    const book = await scratch()
    await writeFile(join(book, 'note.md'), '第一段。\n', 'utf8')

    const paths = sepiaPaths(home)
    const store = await openBookStore(paths, book)
    await store.writeAnchors([createAnchor('a1', '第一段。\n', { from: 0, to: 4 })])

    expect(store.dir.startsWith(join(home, '.sepia', 'books'))).toBe(true)
    // book 里除了 note.md 什么都不该多——锚点进了 book 就会被 git 追踪、被 clone 带走
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(book)).toEqual(['note.md'])
  })

  it('往返：写进去的锚点读得回来', async () => {
    const home = await scratch()
    const book = await scratch()
    const store = await openBookStore(sepiaPaths(home), book)
    const anchor = createAnchor('a1', '前文。要挂的那段。后文。', { from: 4, to: 11 })

    expect(await store.readAnchors(), '还没写过时是空表，不是报错').toEqual([])
    await store.writeAnchors([anchor])
    expect(await store.readAnchors()).toEqual([anchor])
  })

  it('锚点文件坏了 → 当作没有，不让 book 打不开', async () => {
    const home = await scratch()
    const book = await scratch()
    const store = await openBookStore(sepiaPaths(home), book)
    await store.writeAnchors([])
    await writeFile(join(store.dir, 'anchors.json'), '{ 这不是 json', 'utf8')
    expect(await store.readAnchors()).toEqual([])
  })

  it('**符号链接与真路径散到同一个 book-id**——否则同一本书会有两份锚点', async () => {
    const home = await scratch()
    const real = await scratch()
    const link = join(await scratch(), 'link-to-book')
    await symlink(real, link)

    const viaReal = await openBookStore(sepiaPaths(home), real)
    const viaLink = await openBookStore(sepiaPaths(home), link)
    expect(viaLink.dir).toBe(viaReal.dir)
  })

  it('meta 记的是 realpath，为 b 期的「重新关联」留线索', async () => {
    const home = await scratch()
    const book = await scratch()
    const store = await openBookStore(sepiaPaths(home), book)
    await store.writeMeta()
    const meta = await store.readMeta()
    expect(meta?.path).toBeTruthy()
    expect(JSON.parse(await readFile(join(store.dir, 'meta.json'), 'utf8'))).toEqual(meta)
  })

  it('book-id 稳定且随路径变化（路径变了 = 换了一本书，代价已在 T-34 记明）', () => {
    expect(bookId('/Users/x/book')).toBe(bookId('/Users/x/book'))
    expect(bookId('/Users/x/book')).toBe(bookId('/Users/x/book/'))
    expect(bookId('/Users/x/book')).not.toBe(bookId('/Users/x/other'))
  })
})
