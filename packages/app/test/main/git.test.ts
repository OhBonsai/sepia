import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { parseReason, parseTrailers } from '@sepia/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createGitService } from '../../src/main/services/git.ts'

// §1.5 #1 / #3 / #6：串行队列、无变化不 commit、非 repo 降级。
//
// **在真 repo 里验，不用桩**：#1 要防的事故是 `.git/index.lock` 撞车，
// 而 index.lock 是 git 自己的行为——桩掉 git 就等于把要测的东西假设掉了（002 §6.2）。

const run = promisify(execFile)
const dirs: string[] = []

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sepia-git-'))
  dirs.push(dir)
  await run('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Sepia Test'], { cwd: dir })
  return dir
}

async function log(dir: string): Promise<string[]> {
  const { stdout } = await run('git', ['log', '--format=%B%x00'], { cwd: dir })
  return stdout
    .split('\0')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('GitService', () => {
  it('提交一次：message 固定、trailer 带 page', async () => {
    const dir = await repo()
    await writeFile(join(dir, 'note.md'), '第一段。\n', 'utf8')
    const git = createGitService(dir)
    expect(await git.available()).toBe(true)

    const outcome = await git.commit('save', { page: 'note.md' })
    expect(outcome.ok).toBe(true)
    expect(outcome.skipped).toBeUndefined()

    const messages = await log(dir)
    expect(messages).toHaveLength(1)
    expect(parseReason(messages[0]!)).toBe('save')
    expect(parseTrailers(messages[0]!).page).toBe('note.md')
  })

  it('**内容没变就不提交**——否则一天下来几百个空 commit', async () => {
    const dir = await repo()
    await writeFile(join(dir, 'note.md'), '第一段。\n', 'utf8')
    const git = createGitService(dir)
    await git.commit('save')
    const second = await git.commit('save')
    expect(second.skipped, '没有新改动，这次该被跳过').toBe(true)
    expect(await log(dir)).toHaveLength(1)
  })

  it('**并发发起的 commit 不撞 index.lock**（队列串行化）', async () => {
    const dir = await repo()
    const git = createGitService(dir)
    // 同时发起 8 次，每次都有真实改动——没有队列的话 git 会因为
    // `Unable to create '.git/index.lock': File exists` 成片失败
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, async (_unused, i) => {
        await writeFile(join(dir, `note-${i}.md`), `第 ${i} 段。\n`, 'utf8')
        return git.commit('save', { page: `note-${i}.md` })
      }),
    )
    const failed = outcomes.filter((outcome) => !outcome.ok)
    expect(failed.map((outcome) => outcome.reason), 'index.lock 撞车了').toEqual([])
    // 至少有一次真的提交了（其余可能因为前一次已把改动一并 add 而被跳过——
    // 这正是 `add -A` 的语义，不是缺陷）
    expect((await log(dir)).length).toBeGreaterThanOrEqual(1)
    expect(git.lastFailure()).toBeNull()
  })

  it('用户的 hook 不执行——自动保存不该去跑别人的 pre-commit', async () => {
    const dir = await repo()
    // 装一个必然失败的 pre-commit：跑到它 = commit 失败
    const hooks = join(dir, '.git', 'hooks')
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await writeFile(join(dir, 'note.md'), '第一段。\n', 'utf8')

    const outcome = await createGitService(dir).commit('save')
    expect(outcome.ok, 'hook 被执行了——自动保存会因为别人的 lint 失败而失败').toBe(true)
    expect(await log(dir)).toHaveLength(1)
  })

  it('非 git 目录 → 优雅降级：不报错、不留失败痕迹', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'sepia-plain-'))
    dirs.push(plain)
    await writeFile(join(plain, 'note.md'), '第一段。\n', 'utf8')

    const git = createGitService(plain)
    expect(await git.available()).toBe(false)
    const outcome = await git.commit('save')
    expect(outcome.ok, '没有版本只是少一半功能，不是错误').toBe(true)
    expect(outcome.skipped).toBe(true)
    // **不许留失败痕迹**：留了的话纸角警示点会为一件完全正常的事常亮
    expect(git.lastFailure()).toBeNull()
  })

  it('成对提交 API 可调（a 期只建不接）', async () => {
    const dir = await repo()
    await writeFile(join(dir, 'note.md'), '原文。\n', 'utf8')
    const git = createGitService(dir)
    await git.commit('save')

    await writeFile(join(dir, 'note.md'), '改写后的正文。\n', 'utf8')
    const { outcomes, commits } = await git.commitPair('premarkup', 'markup', { page: 'note.md' })
    expect(outcomes[0]?.ok).toBe(true)
    expect(outcomes[1]?.ok).toBe(true)
    // 后一次没有新改动 → 两点相同 → commits 为 null（b 期据此判 diff 不可用）
    expect(commits).toBeNull()
    const messages = await log(dir)
    // 前一次把改动提了，后一次没有新改动 → 被跳过。**成对的语义在 b 期接线时才完整**
    //（落笔前提一次、落笔后再提一次），这里只验 API 可调用且不炸。
    expect(parseReason(messages[0]!)).toBe('premarkup')
  })

  it('git 报错时收敛成 outcome 并留痕，不抛', async () => {
    const dir = await repo()
    await writeFile(join(dir, 'note.md'), '第一段。\n', 'utf8')
    // 没有 user.email 的 repo：commit 会失败
    await run('git', ['config', '--unset', 'user.email'], { cwd: dir })
    await run('git', ['config', '--unset', 'user.name'], { cwd: dir })
    const git = createGitService(dir, {
      exec: async (args, cwd) => {
        const result = await run('git', ['-c', 'user.useConfigOnly=true', ...args], {
          cwd,
          env: { ...process.env, GIT_AUTHOR_NAME: '', GIT_AUTHOR_EMAIL: '', EMAIL: '' },
        })
        return { stdout: String(result.stdout), stderr: String(result.stderr) }
      },
    })
    const outcome = await git.commit('save')
    expect(outcome.ok).toBe(false)
    expect(git.lastFailure()?.reason).toBeTruthy()
  })

  it('中文路径不被转义（core.quotepath=false）', async () => {
    const dir = await repo()
    await writeFile(join(dir, '笔记.md'), '第一段。\n', 'utf8')
    const git = createGitService(dir)
    await git.commit('save', { page: '笔记.md' })
    const messages = await log(dir)
    expect(parseTrailers(messages[0]!).page).toBe('笔记.md')
    expect(await readFile(join(dir, '笔记.md'), 'utf8')).toBe('第一段。\n')
  })
})

// §2.5 #4 的机器面：成对提交要能交出**可用的两点**，徽章的 diff 从那儿取（D-08）。
describe('成对提交与 diff（b 期）', () => {
  it('落笔前后各一次 → 两点不同，且 diff 里读得到改写后的字', async () => {
    const dir = await repo()
    const page = join(dir, 'note.md')
    await writeFile(page, '原文。\n', 'utf8')
    const git = createGitService(dir)
    await git.commit('save', { page })

    // 落笔前提一次 → 改正文 → 落笔后提一次（b 期落笔链的形状）
    const first = await git.commit('premarkup', { page })
    expect(first.skipped, '没有新改动，前一次该被跳过').toBe(true)
    await writeFile(page, '改写后的正文。\n', 'utf8')
    const after = await git.commit('markup', { page })
    expect(after.ok).toBe(true)

    const head = await git.head()
    expect(head).toBeTruthy()
    const diff = await git.diff(`${head}~1`, head!, page)
    expect(diff, 'diff 取不到就等于徽章点开是空的').toBeTruthy()
    expect(diff).toContain('改写后的正文。')
  })

  it('两点相同（中间没提交出东西）→ commits 为 null，b 期据此判 diff 不可用', async () => {
    const dir = await repo()
    await writeFile(join(dir, 'note.md'), '原文。\n', 'utf8')
    const git = createGitService(dir)
    await git.commit('save')
    expect((await git.commitPair('premarkup', 'markup')).commits).toBeNull()
  })

  it('非 git 目录：diff 与 head 都返回 null，且不留失败痕迹', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'sepia-plain-'))
    dirs.push(plain)
    const git = createGitService(plain)
    expect(await git.diff('a', 'b', 'x.md')).toBeNull()
    expect(await git.head()).toBeNull()
    expect(git.lastFailure(), 'diff 取不到不是"保存出问题了"').toBeNull()
  })
})
