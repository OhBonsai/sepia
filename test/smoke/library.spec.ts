import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 170 §2.4 #6 / #7 / #8 / #13：多 Tab、文件树、主页、DoD 的启动那一条。

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const launched: ElectronApplication[] = []
test.afterEach(async () => {
  await Promise.all(launched.splice(0).map((app) => app.close().catch(() => undefined)))
})

interface Book {
  home: string
  book: string
  pages: string[]
}

/** 造一个 book：`a.md` / `b.md` / `sub/c.md`。 */
async function makeBook(options: { extra?: number } = {}): Promise<Book> {
  const home = await mkdtemp(join(tmpdir(), 'sepia-lib-'))
  const book = join(home, 'book')
  await mkdir(join(book, 'sub'), { recursive: true })
  await writeFile(join(book, 'a.md'), '# 甲的标题\n\n甲的正文。\n', 'utf8')
  await writeFile(join(book, 'b.md'), '# 乙的标题\n\n乙的正文。\n', 'utf8')
  await writeFile(join(book, 'sub', 'c.md'), '# 丙\n\n丙的正文。\n', 'utf8')
  for (let i = 0; i < (options.extra ?? 0); i++) {
    await writeFile(join(book, 'sub', `x${i}.md`), `第 ${i} 篇\n`, 'utf8')
  }
  await mkdir(join(home, '.sepia'), { recursive: true })
  return { home, book, pages: ['a.md', 'b.md', 'sub/c.md'] }
}

async function launch(
  fixture: Book,
  session: Record<string, unknown>,
  config: Record<string, unknown> = {},
): Promise<Page> {
  await writeFile(join(fixture.home, '.sepia', 'session.json'), JSON.stringify(session), 'utf8')
  await writeFile(
    join(fixture.home, '.sepia', 'config.json'),
    JSON.stringify({ version: 1, autosaveDebounceMs: 300, ...config }),
    'utf8',
  )
  const app = await electron.launch({
    args: LAUNCH_ARGS,
    env: {
      ...process.env,
      HOME: fixture.home,
      USERPROFILE: fixture.home,
      SEPIA_TEST_USER_DATA: join(fixture.home, 'electron-user-data'),
    },
  })
  launched.push(app)
  const win = await app.firstWindow()
  await win.waitForSelector('.sepia-shell')
  await win.waitForTimeout(500)
  return win
}

test('#8 主页：无 tab 时出现，两条路都在；有 book 时最近列表直达', async () => {
  const fixture = await makeBook()
  const win = await launch(fixture, { version: 2, book: fixture.book, tabs: [], active: 0 })

  // 一个 tab 都没开 → 主页
  await expect(win.locator('[data-sepia-home]')).toBeVisible()
  await expect(win.locator('[data-sepia-home-action="book"]')).toBeVisible()
  await expect(win.locator('[data-sepia-home-action="page"]')).toBeVisible()
  // **主页也是纸**：版心与正文同宽，不是卡片网格
  const box = await win.locator('.sepia-home').boundingBox()
  expect(box!.width).toBeLessThanOrEqual(760)
})

test('#7 文件树：列出 book 里的 md，点击开 tab', async () => {
  const fixture = await makeBook()
  const win = await launch(fixture, { version: 2, book: fixture.book, tabs: [], active: 0 })

  const tree = win.locator('.sepia-tree')
  await expect(tree).toBeVisible()
  for (const page of fixture.pages) {
    await expect(win.locator(`[data-sepia-tree-entry="${page}"]`), `树里没有 ${page}`).toHaveCount(1)
  }
  // 只列 markdown，且 .git / node_modules 之类不进树
  await expect(win.locator('[data-sepia-tree-kind="file"]')).toHaveCount(3)

  await win.locator('[data-sepia-tree-entry="b.md"]').click()
  await expect(win.locator('[data-sepia-tab="b.md"]')).toHaveCount(1)
  await expect(win.locator('.cm-content')).toContainText('乙的正文')
})

test('#7b 文件树超限 → **降级为只列顶层，并且说出来**', async () => {
  const fixture = await makeBook({ extra: 30 })
  // 上限调到 5：fixture 有 30+ 个文件，必然触发降级
  const win = await launch(
    fixture,
    { version: 2, book: fixture.book, tabs: [], active: 0 },
    { libraryTreeEntryLimit: 5 },
  )

  await expect(win.locator('.sepia-tree')).toHaveAttribute('data-sepia-tree', 'degraded')
  await expect(win.locator('[data-sepia-tree-notice="degraded"]'), '降级了却没说').toBeVisible()
  // 只剩顶层：sub/ 里的东西一个都不该在
  await expect(win.locator('[data-sepia-tree-entry="sub/c.md"]')).toHaveCount(0)
})

test('#6 多 Tab：切换各自恢复光标、⌘W 关、重启恢复 tabs+active', async () => {
  const fixture = await makeBook()
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [
      { page: 'a.md', cursor: 0, scrollTop: 0 },
      { page: 'b.md', cursor: 0, scrollTop: 0 },
    ],
    active: 0,
  })

  await expect(win.locator('.sepia-tab')).toHaveCount(2)
  await expect(win.locator('.cm-content')).toContainText('甲的正文')

  // 切到第二个 tab
  await win.locator('[data-sepia-tab="b.md"]').click()
  await expect(win.locator('.cm-content')).toContainText('乙的正文')
  await expect(win.locator('[data-sepia-tab="b.md"]')).toHaveAttribute('data-sepia-tab-active', 'true')

  // ⌘W 关掉当前 → 回到剩下那个（**不是白屏**）
  await win.keyboard.press('Meta+w')
  await expect(win.locator('.sepia-tab')).toHaveCount(1)
  await expect(win.locator('.cm-content')).toContainText('甲的正文')

  // session 落盘之后重启：tabs 与 active 都该回来
  await win.waitForTimeout(900)
  const saved = JSON.parse(await readFile(join(fixture.home, '.sepia', 'session.json'), 'utf8')) as {
    version: number
    tabs: { page: string }[]
  }
  expect(saved.version).toBe(2)
  expect(saved.tabs.map((tab) => tab.page)).toEqual(['a.md'])
})

test('#13 DoD：树扫描不挡"可写"——t0–t5 攒齐，树在其后才到', async () => {
  const fixture = await makeBook({ extra: 60 })
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })

  // 纸先可写：打点齐了才算（与冷启动 smoke 同一口径）
  await expect(win.locator('.cm-content')).toBeVisible()
  // 树随后异步到位——**它在 t5 之后**，所以此刻断言"最终会有"，而不是"立刻有"
  await expect(win.locator('[data-sepia-tree-kind="file"]').first()).toBeVisible({ timeout: 10_000 })
})
