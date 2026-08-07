import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 180 §1.4 #7：**happy-path 机器串联**——一条 spec 从冷启动一口气走到重开。
//
// 为什么要有它，而不是"前面那些 smoke 加起来就够了"：
// 每一条既有 smoke 都在自己搭的干净台子上验自己那一段，**段与段之间的缝没人站过**。
// 真人轮里那五处缺陷全都长在缝上（点最近打不开、图挤进标题行、`@` 浮层不跟光标……），
// 没有一处是某一段自己坏了。这条 spec 就是让机器也走一次那些缝。
//
// 它**不替代人工分镜走查**（evidence/180/checklist.md）：机器能证"链没断"，
// 证不了"这一路顺不顺手"。两栏各管各的。

test.setTimeout(180_000)

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const TARGET = '这一段等着被改写。'
const REVISED = '这一段已经改写过了。'

interface Harness {
  app: ElectronApplication
  window: Page
  home: string
  book: string
  page: string
}

async function boot(home: string, book: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: LAUNCH_ARGS,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      SEPIA_TEST_USER_DATA: join(home, 'electron-user-data'),
    },
  })
  const window = await app.firstWindow()
  await window.waitForSelector('.cm-content', { timeout: 30_000 })
  void book
  return { app, window }
}

async function launch(): Promise<Harness> {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'sepia-happy-'))
  const book = join(home, 'book')
  await mkdir(book, { recursive: true })
  const page = join(book, 'note.md')
  await writeFile(page, `# 一篇笔记\n\n${TARGET}\n\n结尾一段。\n`, 'utf8')
  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 2, book, tabs: [{ page: 'note.md', cursor: 0, scrollTop: 0 }], active: 0 }),
    'utf8',
  )
  await writeFile(
    join(home, '.sepia', 'config.json'),
    JSON.stringify({ version: 1, autosaveDebounceMs: 300 }),
    'utf8',
  )
  const { app, window } = await boot(home, book)
  return { app, window, home, book, page }
}

/** 与 markup.spec 同一套桩：打在 main 的 handler 上，preload/IPC/renderer 全是真的。 */
async function stubEngine(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ ipcMain, BrowserWindow }, revised) => {
    for (const channel of ['agent/open-thread', 'agent/send', 'agent/interrupt']) ipcMain.removeHandler(channel)
    const push = (event: unknown): void => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agent/event', event)
    }
    ipcMain.handle('agent/open-thread', async () => ({ ok: true, value: { id: 'happy-thread' } }))
    ipcMain.handle('agent/interrupt', async () => ({ ok: true, value: undefined }))
    ipcMain.handle('agent/send', async (_event, _threadId: unknown, parts: unknown) => {
      const sent = Array.isArray(parts) ? (parts[0] as { text?: string } | undefined)?.text : undefined
      // 回声照放——真引擎会这么干，桩不放就把"回声会不会被当成结果"假设掉了
      if (typeof sent === 'string') {
        push({ type: 'message.part.updated', properties: { part: { type: 'text', text: sent, messageID: 'msg_user' } } })
      }
      push({ type: 'message.part.updated', properties: { part: { type: 'step-start', messageID: 'msg_a' } } })
      push({
        type: 'message.part.updated',
        properties: { part: { type: 'text', text: revised, messageID: 'msg_a' } },
      })
      push({ type: 'message.completed', properties: {} })
      return { ok: true, value: undefined }
    })
  }, REVISED)
}

async function engineReady(window: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        window.evaluate(async () =>
          (globalThis as unknown as { api: { agent: { status(): Promise<string> } } }).api.agent.status(),
        ),
      { timeout: 60_000, intervals: [250] },
    )
    .toBe('ready')
}

async function selectAndSummon(window: Page, text: string): Promise<void> {
  await window.locator('.cm-content').click()
  await window.evaluate((needle) => {
    const walker = document.createTreeWalker(document.querySelector('.cm-content')!, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const index = (node.textContent ?? '').indexOf(needle)
      if (index !== -1) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + needle.length)
        const selection = globalThis.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        return
      }
      node = walker.nextNode()
    }
    throw new Error(`selection target not found: ${needle}`)
  }, text)
  await window.keyboard.press('Meta+k')
}

test('#7 happy-path 串联：冷启动 → 写 → ⌘K 落笔 → 徽章 → 还白 → ⌘/ → ⌘⇧I → 重开还原', async () => {
  const { app, window, home, page } = await launch()

  // ── 一、冷启动：纸在、上次的 page 在、可写 ──────────────────────────
  await expect(window.locator('.cm-content')).toContainText('一篇笔记')
  const original = await readFile(page, 'utf8')

  // ── 二、写字 → 保存 → 微反馈 ────────────────────────────────────────
  await window.locator('.cm-content').click()
  await window.keyboard.press('Meta+ArrowDown')
  await window.keyboard.type('手写的一句。')
  await window.keyboard.press('Meta+s')
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 10_000 }).toContain('手写的一句。')
  // **未触及的字节逐字节保留**（不变量 2）——这是全链里最不能松的一条
  expect(await readFile(page, 'utf8'), '写新字时动了旧字').toContain(original.trimEnd())

  // ── 三、⌘K 全链：唤起 → 生成 → diff → 落笔 ──────────────────────────
  await engineReady(window)
  await stubEngine(app)
  await selectAndSummon(window, TARGET)
  const panel = window.locator('.sepia-markup')
  await expect(panel).toHaveAttribute('data-sepia-markup', 'compose')
  await window.locator('.sepia-markup-verbs button').first().click()
  await expect(panel).toHaveAttribute('data-sepia-markup', 'result', { timeout: 30_000 })
  await window.locator('.sepia-markup-actions button', { hasText: '落笔' }).click()
  await expect(panel).toHaveCount(0)
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 15_000 }).toContain(REVISED)
  // **AI 不抢笔**：落笔之后原来那段没了、手写那句还在（不变量 3 的行为面）
  expect(await readFile(page, 'utf8'), '落笔把手写的字冲掉了').toContain('手写的一句。')

  // ── 四、徽章：落笔留痕 ──────────────────────────────────────────────
  await expect(window.locator('.sepia-badge'), '落笔之后纸上没有徽章').toHaveCount(1, { timeout: 10_000 })

  // ── 五、⌘⇧H 还白 → 再按回来（**线程一条不少**）───────────────────────
  await window.keyboard.press('Meta+Shift+h')
  await expect(window.locator('.sepia-badge')).toHaveCount(0)
  await window.keyboard.press('Meta+Shift+h')
  await expect(window.locator('.sepia-badge'), '还白之后按回来，徽章少了').toHaveCount(1)

  // ── 六、⌘/ 看板与 ⌘⇧I 浮层：本 stage 的两块新家具在全链里也能开 ──────
  await window.keyboard.press('Meta+/')
  await expect(window.locator('[data-sepia-keys="open"]')).toBeVisible()
  await window.keyboard.press('Escape')
  await window.keyboard.press('Meta+Shift+I')
  await expect(window.locator('[data-sepia-info="open"]')).toBeVisible()
  await expect(window.locator('[data-sepia-info-row="threads"]')).toContainText('1')
  await window.keyboard.press('Escape')

  // ── 七、重开：tab、正文、徽章都回来 ─────────────────────────────────
  const before = await readFile(page, 'utf8')
  await window.waitForTimeout(900) // 等 session 落盘
  await app.close()

  const second = await boot(home, join(home, 'book'))
  await expect(second.window.locator('.cm-content')).toContainText(REVISED, { timeout: 20_000 })
  await expect(second.window.locator('.cm-content')).toContainText('手写的一句。')
  // 徽章是从 `.sepia/threads/` 重算出来的——重开之后还在，才叫"痕迹留下了"
  await expect(second.window.locator('.sepia-badge'), '重开之后徽章没了——痕迹没有真的落盘').toHaveCount(1, {
    timeout: 15_000,
  })
  expect(await readFile(page, 'utf8'), '重开这一下动了文件').toBe(before)
  await second.app.close()
})
