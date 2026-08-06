import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findBookRoot, pageContext } from '../../src/main/services/books.ts'
import { createPage, movePage, renamePage, trashPage } from '../../src/main/services/files.ts'

// 文件管理的服务层（170 §1.2）。这些函数改的是**用户的文件**，所以每条断言都对着
// 一种丢字节的方式：覆盖已有文件、改名吃掉目标、删除退化成 unlink。

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sepia-files-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

describe('新建', () => {
  it('没给扩展名就补 .md，内容为空', async () => {
    const created = await createPage(join(dir, 'note'))
    expect(created).toEqual({ ok: true, value: join(dir, 'note.md') })
    expect(await readFile(join(dir, 'note.md'), 'utf8')).toBe('')
  })

  it('**已存在即失败，绝不覆盖**——新建不该吃掉一个已有文件', async () => {
    const target = join(dir, 'have.md')
    await writeFile(target, 'PRECIOUS', 'utf8')
    expect(await createPage(target)).toEqual({ ok: false, reason: 'already exists' })
    expect(await readFile(target, 'utf8')).toBe('PRECIOUS')
  })

  it('相对路径不收（main 侧一律要绝对路径）', async () => {
    expect((await createPage('note.md')).ok).toBe(false)
  })
})

describe('重命名与移动', () => {
  it('改名后旧路径没了、新路径有原内容', async () => {
    const from = join(dir, 'a.md')
    await writeFile(from, 'BODY', 'utf8')
    const to = join(dir, 'b.md')
    expect(await renamePage(from, to)).toEqual({ ok: true, value: to })
    expect(await exists(from)).toBe(false)
    expect(await readFile(to, 'utf8')).toBe('BODY')
  })

  it('**目标已存在即失败**——rename 会静默吃掉目标文件，那就是丢字节', async () => {
    const from = join(dir, 'a.md')
    const to = join(dir, 'b.md')
    await writeFile(from, 'A', 'utf8')
    await writeFile(to, 'B-PRECIOUS', 'utf8')
    expect(await renamePage(from, to)).toEqual({ ok: false, reason: 'target exists' })
    expect(await readFile(to, 'utf8')).toBe('B-PRECIOUS')
    expect(await readFile(from, 'utf8')).toBe('A')
  })

  it('移动保留文件名，目标目录不存在时建出来', async () => {
    const from = join(dir, 'a.md')
    await writeFile(from, 'A', 'utf8')
    const into = join(dir, 'deep', 'nested')
    expect(await movePage(from, into)).toEqual({ ok: true, value: join(into, 'a.md') })
    expect(await readFile(join(into, 'a.md'), 'utf8')).toBe('A')
  })

  // **这里刻意没有「留自写记录」那条用例**：自写记录表是 L2 的接缝（只 claim 不 record），
  // 而删除/改名给不出它要的 path+mtime+size 三件套。这四个动作的回声由"谁在动手"那侧收尾，
  // 检查在 watcher.test.ts 的「自己改名当前 page → 旧路径的事件被丢掉」。见 files.ts 的长注释。
})

describe('删除', () => {
  it('**调的是回收站，而不是自己 unlink**：注入一个什么都不做的 trash，文件必须还在', async () => {
    const target = join(dir, 'gone.md')
    await writeFile(target, 'X', 'utf8')
    const trash = vi.fn(async () => undefined)

    expect(await trashPage(target, trash)).toEqual({ ok: true, value: undefined })
    expect(trash).toHaveBeenCalledWith(target)
    // 这条是本文件里最重要的一行：实现若偷偷 unlink 一下"保证删掉"，它就红。
    // 回收站是用户的撤销通道，unlink 不是（架构 §4.9）。
    expect(await exists(target), '实现自己删了文件——回收站语义被绕过了').toBe(true)
  })

  it('回收站失败照实报错，不改用 unlink 兜底', async () => {
    const target = join(dir, 'gone.md')
    await writeFile(target, 'X', 'utf8')
    const result = await trashPage(target, async () => {
      throw new Error('trash unavailable')
    })
    expect(result).toEqual({ ok: false, reason: 'trash unavailable' })
    expect(await exists(target)).toBe(true)
  })

  it('文件不存在时不假装成功', async () => {
    expect(await trashPage(join(dir, 'nope.md'), async () => undefined)).toEqual({
      ok: false,
      reason: 'not found',
    })
  })
})

describe('book 身份与游离判定（T-30）', () => {
  it('page 在 git repo 里 → 找到 book 根', async () => {
    await mkdir(join(dir, 'book', '.git'), { recursive: true })
    const page = join(dir, 'book', 'sub', 'page.md')
    await mkdir(join(dir, 'book', 'sub'), { recursive: true })
    await writeFile(page, '', 'utf8')
    expect(await findBookRoot(page)).toBe(join(dir, 'book'))
    expect(await pageContext(page)).toEqual({ page, book: join(dir, 'book'), detached: false })
  })

  it('`.git` 是文件（worktree / submodule）也算 book', async () => {
    await mkdir(join(dir, 'wt'), { recursive: true })
    await writeFile(join(dir, 'wt', '.git'), 'gitdir: /elsewhere\n', 'utf8')
    const page = join(dir, 'wt', 'page.md')
    await writeFile(page, '', 'utf8')
    expect(await findBookRoot(page)).toBe(join(dir, 'wt'))
  })

  it('不在任何 repo 里 → 游离 page（无 book，纸照常可写：T-30 / 不变量 1）', async () => {
    const page = join(dir, 'loose.md')
    await writeFile(page, '', 'utf8')
    expect(await findBookRoot(page)).toBeNull()
    expect(await pageContext(page)).toMatchObject({ detached: true, book: null })
  })
})
