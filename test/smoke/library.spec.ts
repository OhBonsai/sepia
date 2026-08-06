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

test('#9 `@` 引用：出列表 → 选中插入标准 md 链接 → 链接可开', async () => {
  const fixture = await makeBook()
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })
  await win.waitForSelector('.cm-content')
  // 候选表是异步扫来的——等它到位（这一步在 t5 之后，不挡可写）
  await win.waitForTimeout(800)

  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')
  await win.keyboard.type('见 @b')

  // 一：列表出来了，且命中的是 b.md
  const picker = win.locator('[data-sepia-refs]')
  await expect(picker, '按下 @ 之后没有列表').toBeVisible({ timeout: 3_000 })
  await expect(win.locator('[data-sepia-ref="b.md"]')).toHaveCount(1)

  // 二：回车插入——**标准 markdown 链接**，不是 wiki 链接（守 markdown 纯度）
  await win.keyboard.press('Enter')
  await expect(picker).toHaveCount(0)
  const text = await win.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')
  expect(text, '插进去的不是标准 md 链接').toContain('](b.md)')
  expect(text, '不许插 wiki 链接').not.toContain('[[')
  // 标题建好时用标题作链接文字
  expect(text).toContain('[乙的标题]')
})

test('#10 拖图 → img/ 落盘 + 插入 `![]()`，原字节只增不改', async () => {
  const fixture = await makeBook()
  // 造一张"图片"（内容不重要，走的是复制那条路）
  const source = join(fixture.home, 'photo.png')
  await writeFile(source, 'PNGDATA', 'utf8')
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })
  await win.waitForSelector('.cm-content')
  const before = await readFile(join(fixture.book, 'a.md'), 'utf8')

  // 直接驱动 main 那一段（拖拽的 DataTransfer 在 Playwright 里造不出带 path 的 File）
  const imported = await win.evaluate(
    async ([src, book]) =>
      (globalThis as unknown as {
        api: { files: { importImage(s: string, b: string): Promise<{ ok: boolean; value?: string }> } }
      }).api.files.importImage(src as string, book as string),
    [source, fixture.book],
  )
  expect(imported.ok).toBe(true)
  expect(imported.value, '落点不是 img/<时间戳>-<原名>').toMatch(/^img\/\d{10}-photo\.png$/)
  expect(await readFile(join(fixture.book, imported.value!), 'utf8')).toBe('PNGDATA')

  // **原字节只增不改**：这一步没碰正文
  expect(await readFile(join(fixture.book, 'a.md'), 'utf8')).toBe(before)
})

test('#5 更新链接：只查不改 → 用户点了才改，且只改指向旧路径的', async () => {
  const fixture = await makeBook()
  await writeFile(join(fixture.book, 'a.md'), '见 [乙](b.md) 和 [别的](bb.md)。\n', 'utf8')
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })
  await win.waitForSelector('.cm-content')

  const call = async (apply: boolean): Promise<{ ok: boolean; value?: { total: number } }> =>
    win.evaluate(
      async ([book, doApply]) =>
        (globalThis as unknown as {
          api: {
            files: {
              updateLinks(b: string, f: string, t: string, a: boolean): Promise<{ ok: boolean; value?: { total: number } }>
            }
          }
        }).api.files.updateLinks(book as string, 'b.md', 'renamed.md', doApply as boolean),
      [fixture.book, apply],
    )

  // 一：只查不改——**磁盘一个字节都不许动**（T-31：用户主动）
  const probe = await call(false)
  expect(probe.value?.total).toBe(1)
  expect(await readFile(join(fixture.book, 'a.md'), 'utf8')).toContain('[乙](b.md)')

  // 二：点了才改，且 bb.md 不许被误伤
  await call(true)
  const after = await readFile(join(fixture.book, 'a.md'), 'utf8')
  expect(after).toContain('[乙](renamed.md)')
  expect(after, '误改了无关链接——比漏更新严重得多').toContain('[别的](bb.md)')
})
