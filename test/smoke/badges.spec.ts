import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 160 §2.5 #6–#10：徽章、还白、重对齐、三选。
//
// 引擎用桩（与 markup smoke 同一套：桩打在 ipcMain handler 上），**git 不桩**——
// 徽章的 diff 从 git 取（D-08），桩掉 git 就等于把要证的东西假设掉了。

const run = promisify(execFile)
const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const FIRST = '第一段。'
const TARGET = '这里是要改的那一段。'
const THIRD = '第三段。'
const BODY = `${FIRST}\n\n${TARGET}\n\n${THIRD}\n`
const REVISED = '这段已经被改写过了。'

const launched: ElectronApplication[] = []
test.afterEach(async () => {
  await Promise.all(launched.splice(0).map((app) => app.close().catch(() => undefined)))
})

interface Harness {
  app: ElectronApplication
  win: Page
  page: string
  book: string
}

async function boot(options: { autosaveMs?: number } = {}): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'sepia-badge-'))
  const book = join(home, 'book')
  await mkdir(book, { recursive: true })
  const page = join(book, 'note.md')
  await writeFile(page, BODY, 'utf8')
  await run('git', ['init', '-q', '-b', 'main'], { cwd: book })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: book })
  await run('git', ['config', 'user.name', 'Sepia Test'], { cwd: book })
  await run('git', ['add', '-A'], { cwd: book })
  await run('git', ['commit', '-q', '-m', 'base'], { cwd: book })

  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 1, page, cursor: 0, scrollTop: 0 }),
    'utf8',
  )
  await writeFile(
    join(home, '.sepia', 'config.json'),
    JSON.stringify({ version: 1, autosaveDebounceMs: options.autosaveMs ?? 300, commitIdleMs: 60_000 }),
    'utf8',
  )

  const app = await electron.launch({
    args: LAUNCH_ARGS,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      SEPIA_TEST_USER_DATA: join(home, 'electron-user-data'),
    },
  })
  launched.push(app)
  const win = await app.firstWindow()
  await win.waitForSelector('.cm-content')
  await win.waitForTimeout(300)
  return { app, win, page, book }
}

/** 引擎桩：与 markup smoke 同形（先回声、助手以 step-start 开场）。 */
async function stubEngine(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ ipcMain, BrowserWindow }, revised) => {
    for (const channel of ['agent/open-thread', 'agent/send', 'agent/interrupt']) ipcMain.removeHandler(channel)
    const push = (event: unknown): void => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agent/event', event)
    }
    ipcMain.handle('agent/open-thread', async () => ({ ok: true, value: { id: 'stub' } }))
    ipcMain.handle('agent/interrupt', async () => ({ ok: true, value: undefined }))
    ipcMain.handle('agent/send', async (_e, _t: unknown, parts: unknown) => {
      const sent = Array.isArray(parts) ? (parts[0] as { text?: string } | undefined)?.text : undefined
      if (typeof sent === 'string') {
        push({ type: 'message.part.updated', properties: { part: { type: 'text', text: sent, messageID: 'msg_user' } } })
      }
      push({ type: 'message.part.updated', properties: { part: { type: 'step-start', messageID: 'msg_a' } } })
      setTimeout(() => {
        push({ type: 'message.part.delta', properties: { part: { type: 'text', text: revised, messageID: 'msg_a' } } })
        push({ type: 'message.completed', properties: {} })
      }, 20)
      return { ok: true, value: undefined }
    })
  }, REVISED)
}

async function waitReady(win: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        win.evaluate(async () =>
          (globalThis as unknown as { api: { agent: { status(): Promise<string> } } }).api.agent.status(),
        ),
      { timeout: 60_000, intervals: [250] },
    )
    .toBe('ready')
}

/** 走一遍 ⌘K → 动词 → 落笔。返回落笔完成时刻。 */
async function runMarkup(win: Page): Promise<void> {
  await win.evaluate((needle) => {
    const content = document.querySelector('.cm-content')!
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode()) !== null) {
      const index = node.textContent?.indexOf(needle) ?? -1
      if (index === -1) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + needle.length)
      const selection = globalThis.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    throw new Error('selection target not found')
  }, TARGET)
  await win.keyboard.press('Meta+k')
  await win.locator('.sepia-markup-verbs button', { hasText: '润色' }).click()
  await expect(win.locator('.sepia-markup')).toHaveAttribute('data-sepia-markup', 'result', { timeout: 30_000 })
  await win.locator('.sepia-markup-actions button', { hasText: '落笔' }).click()
  await expect(win.locator('.sepia-markup')).toHaveCount(0)
}

/**
 * 面板在屏幕上是不是真的看得见（像素级，沿用 160 §1.9 条目 7 的手法）。
 * 属性在、盒子在，都不等于用户看得见——警示点那次就是这么绿着放行的。
 */
async function panelVisiblePixels(win: Page): Promise<number> {
  const shot = (await win.screenshot()).toString('base64')
  const box = await win.locator('.sepia-threads').boundingBox()
  if (box === null) return 0
  return win.evaluate(
    async ({ data, rect }) => {
      const img = new Image()
      await new Promise((resolve, reject) => {
        img.addEventListener('load', resolve)
        img.addEventListener('error', reject)
        img.src = `data:image/png;base64,${data}`
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (ctx === null) return -1
      ctx.drawImage(img, 0, 0)
      // 截图是 CSS 像素的整数倍（HiDPI 下 2x），按比例换算面板那一块
      const scale = canvas.width / globalThis.innerWidth
      const px = ctx.getImageData(
        Math.round(rect.x * scale),
        Math.round(rect.y * scale),
        Math.max(1, Math.round(rect.width * scale)),
        Math.max(1, Math.round(rect.height * scale)),
      ).data
      // 面板底色是 paper、有边框——只要那一块**不是清一色**，它就画出来了
      const first = `${px[0]},${px[1]},${px[2]}`
      let different = 0
      for (let i = 4; i < px.length; i += 4) {
        if (`${px[i]},${px[i + 1]},${px[i + 2]}` !== first) different++
      }
      return different
    },
    { data: shot, rect: box },
  )
}

test('#6 落笔 → 徽章出现 → **点它** → 面板打开且停在这条线程上', async () => {
  const { app, win } = await boot()
  await waitReady(win)
  await stubEngine(app)
  await expect(win.locator('.sepia-badge'), '落笔之前纸上不该有徽章').toHaveCount(0)

  await runMarkup(win)
  // UI 先行：徽章不等 git 链回来
  await expect(win.locator('.sepia-badge')).toHaveCount(1, { timeout: 5_000 })
  await expect(win.locator('.sepia-threads'), '还没点，面板不该自己开').toHaveCount(0)

  // ── **真的点上去**（这条检查以前只数个数，描述却写着"点开看得到对话"）──────
  await win.locator('.sepia-badge').click()

  // 一：面板打开，且**在屏幕上真的看得见**（不是只有属性）
  await expect(win.locator('.sepia-threads')).toBeVisible({ timeout: 5_000 })
  expect(await panelVisiblePixels(win), '面板那一块是空白——属性在但没画出来').toBeGreaterThan(50)

  // 二：**停在这条线程上**，不是只把面板打开
  const badgeId = await win.locator('.sepia-badge').getAttribute('data-sepia-badge')
  expect(badgeId).toBeTruthy()
  const row = win.locator(`[data-sepia-thread="${badgeId}"]`)
  await expect(row, '面板里没有这条线程').toHaveCount(1)
  await expect(row, '面板开了，但这条没展开——点了一个具体的点却只得到一张列表').toHaveAttribute(
    'data-sepia-thread-open',
    'true',
  )

  // 三：里面**是这条线程的对话**（问了什么、答了什么）
  const turns = win.locator(`[data-sepia-thread-turns="${badgeId}"]`)
  await expect(turns).toBeVisible()
  await expect(turns.locator('[data-sepia-turn="user"]')).toContainText(TARGET)
  await expect(turns.locator('[data-sepia-turn="assistant"]')).toContainText(REVISED)

  await app.close()
})

test('#8b 徽章**在屏幕上真的看得见**（像素级，160 §1.9 条目 7 的手法）', async () => {
  const { app, win } = await boot()
  await waitReady(win)
  await stubEngine(app)
  await runMarkup(win)
  await expect(win.locator('.sepia-badge')).toHaveCount(1, { timeout: 5_000 })

  // 属性在、盒子在，都不等于用户看得见——警示点那次就是这么绿着放行的
  const box = await win.locator('.sepia-badge').boundingBox()
  expect(box, '徽章没有盒子').not.toBeNull()
  expect(box!.width, '直径要 ≤8px（W8 裁死的形态）').toBeLessThanOrEqual(8)
  expect(box!.width).toBeGreaterThan(0)

  const visible = await win.evaluate(async () => {
    const dot = document.querySelector('.sepia-badge')
    if (dot === null) return null
    const rect = dot.getBoundingClientRect()
    const style = globalThis.getComputedStyle(dot)
    return {
      inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      opaque: style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.opacity !== '0',
      visibility: style.visibility,
      // 徽章**没有数字、没有头像**——它整个就是一个点（W8）
      empty: (dot.textContent ?? '') === '' && dot.querySelectorAll('*').length === 0,
    }
  })
  expect(visible?.inViewport, '徽章跑到视口外了').toBe(true)
  expect(visible?.opaque).toBe(true)
  expect(visible?.visibility).toBe('visible')
  expect(visible?.empty, '徽章里出现了内容——W8 明文不放数字不放头像').toBe(true)
  await app.close()
})

test('#7 ⌘⇧H 还白：全隐 ↔ 全显来回切', async () => {
  const { app, win } = await boot()
  await waitReady(win)
  await stubEngine(app)
  await runMarkup(win)
  await expect(win.locator('.sepia-badge')).toHaveCount(1, { timeout: 5_000 })

  await win.keyboard.press('Meta+Shift+h')
  await expect(win.locator('.sepia-badge'), '全隐之后纸面该是白的').toHaveCount(0)
  await win.keyboard.press('Meta+Shift+h')
  await expect(win.locator('.sepia-badge'), '再按一次要全回来——来回切').toHaveCount(1)
  await app.close()
})

test('#3 撤销联动：⌘Z 徽章移出，⌘⇧Z 徽章回来（T-27，零 undo 钩子）', async () => {
  const { app, win, page } = await boot()
  await waitReady(win)
  await stubEngine(app)
  await runMarkup(win)
  await expect(win.locator('.sepia-badge')).toHaveCount(1, { timeout: 5_000 })

  // **先等落笔链落停再撤销**。不等的话测的就不是撤销联动了：落笔会触发写盘，
  // 写盘会惊动 watcher，watcher 那条路可能在撤销之后才把盘上的内容重载回来——
  // 于是徽章"又回来了"，而那与撤销毫无关系。这是测试的竞态，不是产品的。
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 15_000 }).toContain(REVISED)
  await win.waitForTimeout(1_200)

  // ⌘Z：正文回到改写前 → 引文找不着 → 判孤儿 → 徽章移出纸面
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+z')
  expect(
    await win.evaluate(() => document.querySelector('.cm-content')?.textContent ?? ''),
    '撤销本身没生效，后面的断言就没有意义',
  ).toContain(TARGET)
  await expect(win.locator('.sepia-badge'), '撤销之后徽章必须移出').toHaveCount(0, { timeout: 5_000 })

  // ⌘⇧Z：正文又变回改写后 → 徽章自然回来（**全程没有任何 undo 钩子**）
  await win.keyboard.press('Meta+Shift+z')
  expect(await win.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')).toContain(REVISED)
  await expect(win.locator('.sepia-badge'), '重做之后徽章该回来').toHaveCount(1, { timeout: 5_000 })
  await app.close()
})

test('#9 外部改文件 → 徽章重对齐（不停在旧位置）', async () => {
  const { app, win, page } = await boot()
  await waitReady(win)
  await stubEngine(app)
  await runMarkup(win)
  await expect(win.locator('.sepia-badge')).toHaveCount(1, { timeout: 5_000 })
  const before = (await win.locator('.sepia-badge').boundingBox())!

  // 外部在前面插一大段（无脏 → 重载）
  await win.waitForTimeout(800)
  const current = await readFile(page, 'utf8')
  await writeFile(page, `插入的开头。\n\n新的一段。\n\n${current}`, 'utf8')

  // 徽章还在（引文完好，只是挪了位），且**位置变了**——没停在旧偏移上
  await expect(win.locator('.sepia-badge')).toHaveCount(1, { timeout: 15_000 })
  await expect
    .poll(async () => (await win.locator('.sepia-badge').boundingBox())?.y ?? before.y, { timeout: 15_000 })
    .not.toBe(before.y)
  await app.close()
})

test('#10 三选：用外部的 → 正文换成外部那版，我的那版在 conflicts/ 里', async () => {
  // **自动写盘调到很长**：三选的前提是"有脏"，而 300ms 的防抖会在外部改动之前
  // 就把字存进去——那时 `decideExternalChange` 判的是无脏重载，静默走掉，
  // 一条横条都不会出（实测如此）。测有脏冲突就得先保证它真的脏着。
  const { app, win, page } = await boot({ autosaveMs: 60_000 })
  await waitReady(win)

  // 制造有脏冲突：先在纸上敲字（不保存），再从外部改文件
  await win.locator('.cm-content').click()
  await win.keyboard.press('End')
  await win.keyboard.type('我自己敲的字。')
  await win.waitForTimeout(100)
  await writeFile(page, `${BODY}\n外部写进来的一段。\n`, 'utf8')

  // 三选出现（a 期的"先落盘"没变：此刻我的字已经安全）
  const choices = win.locator('[data-sepia-conflict-choices="open"]')
  await expect(choices).toBeVisible({ timeout: 15_000 })
  await expect(win.locator('[data-sepia-conflict-choice="mine"]')).toBeVisible()
  await expect(win.locator('[data-sepia-conflict-choice="theirs"]')).toBeVisible()
  await expect(win.locator('[data-sepia-conflict-choice="both"]')).toBeVisible()

  await win.locator('[data-sepia-conflict-choice="theirs"]').click()

  // 正文换成外部那一版
  await expect
    .poll(async () => readFile(page, 'utf8'), { timeout: 15_000 })
    .toContain('外部写进来的一段。')

  // **外部那版在留存目录里**——它是通知发出之前就留下的那一份
  const { readdir } = await import('node:fs/promises')
  const home = page.slice(0, page.indexOf('/book/'))
  const books = join(home, '.sepia', 'books')
  const ids = await readdir(books).catch(() => [] as string[])
  const found: string[] = []
  for (const id of ids) {
    const names = await readdir(join(books, id, 'conflicts')).catch(() => [] as string[])
    found.push(...names)
  }
  expect(found.length, 'conflicts/ 里什么都没有——留存没发生，三选就是假的').toBeGreaterThan(0)
  await app.close()
})
