import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FileNotice } from '@sepia/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { atomicWrite } from '../../src/main/services/fsio.ts'
import { resetSelfWrites } from '../../src/main/services/self-writes.ts'
import {
  forceDegrade,
  onFileNotice,
  reconcile,
  refreshStamp,
  resetWatcher,
  watchPage,
  watcherStatus,
} from '../../src/main/services/watcher.ts'

// watcher 的单测**拿真文件系统跑**（170 §1.4 检查 2/6/9 的单测半边）。
//
// 为什么不 mock chokidar：这一层的全部风险都在"真实事件到底长什么样"——
// tmp+rename 是一条 change 还是一对 unlink+add、就地写会不会来两条。
// mock 掉这些，测的就只是我自己写的那个 if，而那正是 002 §1 第 5 层说的空转。
//
// 计时：事件经 chokidar（默认 atomic 窗口 100ms）+ 本模块归并窗口 120ms 才落地，
// 所以断言一律用「轮询到出现」或「等够窗口再断言没有」，不写死单次 sleep。

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 归并窗口 + chokidar 的 atomic 窗口 + 余量。断言「没有事件」时必须等够这个。 */
const SETTLE_MS = 700

let dir = ''
let page = ''
let notices: FileNotice[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sepia-watch-'))
  page = join(dir, 'page.md')
  await writeFile(page, 'original\n', 'utf8')
  notices = []
  resetSelfWrites()
  await resetWatcher()
  onFileNotice((notice) => notices.push(notice))
  await watchPage(page)
})

afterEach(async () => {
  await resetWatcher()
  await rm(dir, { recursive: true, force: true })
})

async function waitForNotice(timeoutMs = 4_000): Promise<FileNotice> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const first = notices[0]
    if (first !== undefined) return first
    await sleep(25)
  }
  throw new Error('等不到文件通知')
}

describe('外部变更', () => {
  it('外部就地改写 → 一条 changed（chokidar 有时抛两条 change，归并窗口要把它折成一条）', async () => {
    await writeFile(page, 'from vim\n', 'utf8')
    expect(await waitForNotice()).toEqual({
      type: 'external-change',
      path: page,
      kind: 'changed',
      source: 'watcher',
    })
    await sleep(SETTLE_MS)
    expect(notices).toHaveLength(1)
  })

  it('外部删除 → removed', async () => {
    await unlink(page)
    expect((await waitForNotice()).type === 'external-change' && notices[0]).toMatchObject({ kind: 'removed' })
  })

  it('删了又立刻建回来（40ms，落在 chokidar 自己的 atomic 窗口内）→ 折成 changed', async () => {
    await unlink(page)
    await sleep(40)
    await writeFile(page, 'recreated\n', 'utf8')
    const notice = await waitForNotice()
    expect(notice).toMatchObject({ kind: 'changed' })
  })

  it('**删了 150ms 后才建回来（超出 chokidar 的窗口）→ 仍必须折成 changed**', async () => {
    // 这条才是本模块归并窗口的存在理由。实测：chokidar 的 atomic 默认 100ms，
    // 超出就抛出一对 unlink + add；归并不到就会误报「文件被删除了」——
    // 而外部编辑器保存时"删了再建"的间隔恰恰常常落在 100–300ms。
    // 第一版窗口设 120ms，把整层归并拿掉照样全绿（首轮 RV 的 dead check 之二），
    // 因为 120ms 只多出 20ms 覆盖、什么也没接住。
    await unlink(page)
    await sleep(150)
    await writeFile(page, 'recreated later\n', 'utf8')
    const notice = await waitForNotice()
    expect(notice, '外部编辑器的删了又建被误报成删除').toMatchObject({ kind: 'changed' })
    await sleep(SETTLE_MS)
    expect(notices, '一次保存只许报一条').toHaveLength(1)
  })

  it('改别的 .md 不惊动当前 page（a 期只有一个消费者）', async () => {
    await writeFile(join(dir, 'other.md'), 'x\n', 'utf8')
    await sleep(SETTLE_MS)
    expect(notices).toEqual([])
  })
})

describe('纪律 17：自写回声抑制', () => {
  it('**走 atomicWrite 保存一次 → 零通知**（去掉 mtime 过滤这里必红：保存一次自我重载一次）', async () => {
    expect((await atomicWrite(page, 'saved by sepia\n')).ok).toBe(true)
    await sleep(SETTLE_MS)
    expect(notices).toEqual([])
  })

  it('自写之后紧跟一次真外部改动 → 照样报出来（抑制不许是"一直抑制"）', async () => {
    expect((await atomicWrite(page, 'saved by sepia\n')).ok).toBe(true)
    await sleep(SETTLE_MS)
    await writeFile(page, 'and then vim\n', 'utf8')
    expect(await waitForNotice()).toMatchObject({ kind: 'changed', source: 'watcher' })
  })
})

describe('focus 对账（架构 §4.9 的兜底半边）', () => {
  it('降级后 watcher 不再发事件，但对账仍抓到外部变更', async () => {
    forceDegrade('test')
    expect(watcherStatus().mode).toBe('reconcile-only')
    // 降级本身要一次性告知，好让用户知道从此靠切窗口校准
    expect(notices).toEqual([{ type: 'watcher-degraded', reason: 'test' }])
    notices = []

    await writeFile(page, 'changed while blind\n', 'utf8')
    await sleep(SETTLE_MS)
    expect(notices, 'watcher 已降级，事件不该再来').toEqual([])

    await reconcile()
    expect(notices).toEqual([
      { type: 'external-change', path: page, kind: 'changed', source: 'reconcile' },
    ])
  })

  it('自己保存后刷新印记 → 对账不把自己的保存报成外部变更', async () => {
    expect((await atomicWrite(page, 'mine\n')).ok).toBe(true)
    await refreshStamp(page)
    notices = []
    await reconcile()
    expect(notices).toEqual([])
  })

  it('文件被删掉 → 对账报 removed', async () => {
    forceDegrade('test')
    notices = []
    await unlink(page)
    await reconcile()
    expect(notices).toEqual([{ type: 'external-change', path: page, kind: 'removed', source: 'reconcile' }])
  })
})
