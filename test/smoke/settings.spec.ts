import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 190 P2/P3：主页终态与设置浮层。

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const launched: ElectronApplication[] = []
test.afterEach(async () => {
  await Promise.all(launched.splice(0).map((app) => app.close().catch(() => undefined)))
})

async function launch(tabs: unknown[] = []): Promise<{ win: Page; home: string; book: string }> {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'sepia-set-'))
  const book = join(home, 'book')
  await mkdir(book, { recursive: true })
  await writeFile(join(book, 'a.md'), '# 甲\n\n正文。\n', 'utf8')
  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(join(home, '.sepia', 'session.json'), JSON.stringify({ version: 2, book, tabs, active: 0 }))
  await writeFile(join(home, '.sepia', 'config.json'), JSON.stringify({ version: 1 }))
  const app = await electron.launch({
    args: LAUNCH_ARGS,
    env: { ...process.env, HOME: home, USERPROFILE: home, SEPIA_TEST_USER_DATA: join(home, 'ud') },
  })
  launched.push(app)
  const win = await app.firstWindow()
  await win.waitForSelector('.sepia-shell')
  await win.waitForTimeout(600)
  return { win, home, book }
}

test('P3 ⌘, 设置：四组导航都在，一级不可点（是标题不是路由）', async () => {
  const { win } = await launch()
  await win.keyboard.press('Meta+,')
  await expect(win.locator('[data-sepia-settings="open"]')).toBeVisible()

  for (const group of ['Desktop App', '书写', 'Agent', '输出']) {
    await expect(win.locator('.sepia-set-group-title', { hasText: group })).toHaveCount(1)
  }
  // 一级是 div 不是 button——**结构上就点不了**，不靠"没绑 onClick"
  const clickable = await win.evaluate(
    () => document.querySelector('.sepia-set-group-title')?.tagName ?? '',
  )
  expect(clickable, '一级分组标题成了按钮——它是标题不是路由（S2）').not.toBe('BUTTON')

  await win.keyboard.press('Escape')
  await expect(win.locator('[data-sepia-settings="open"]')).toHaveCount(0)
})

test('P3 **改一个设置真的落 config.json**（不是只改了界面）', async () => {
  const { win, home } = await launch()
  await win.keyboard.press('Meta+,')
  await expect(win.locator('[data-sepia-settings="open"]')).toBeVisible()

  await win.locator('[data-sepia-set-page="paper"]').click()
  await win.locator('[data-sepia-set-control="imageDirectory"]').fill('pics')
  await win.waitForTimeout(800)

  const raw = await readFile(join(home, '.sepia', 'config.json'), 'utf8')
  expect(JSON.parse(raw) as Record<string, unknown>, '设置改了界面却没落盘').toMatchObject({
    imageDirectory: 'pics',
  })
})

test('P3 **非法值走同一道容错闸**：设置页也塞不进越界的数字', async () => {
  const { win, home } = await launch()
  await win.keyboard.press('Meta+,')
  await win.locator('[data-sepia-set-page="pen"]').click()
  // 自动保存延迟填一个负数
  await win.locator('[data-sepia-set-control="autosaveDebounceMs"]').fill('-5')
  await win.waitForTimeout(800)

  const raw = JSON.parse(await readFile(join(home, '.sepia', 'config.json'), 'utf8')) as Record<string, unknown>
  expect(raw['autosaveDebounceMs'], '负数被写进了 config').not.toBe(-5)
})

test('P3 未接上子系统的项**照样列出来、置灰**（不藏不删）', async () => {
  const { win } = await launch()
  await win.keyboard.press('Meta+,')
  await win.locator('[data-sepia-set-page="general"]').click()
  const pending = win.locator('[data-sepia-set-item-pending="true"]')
  await expect(pending.first(), '「即将推出」的项被藏起来了——那会让人以为产品就这些功能').toBeVisible()
})

test('P2 主页：workspace 列表 + 相对时间分组 + ✎ 新建', async () => {
  const { win, book } = await launch()
  // 选过的 book 会进 workspaces；这里直接验列表容器与新建入口在
  await expect(win.locator('.sepia-home-side')).toBeVisible()
  await expect(win.locator('[data-sepia-home-action="new"]')).toBeVisible()
  await expect(win.locator('[data-sepia-home-search]')).toHaveAttribute('placeholder', new RegExp(book.split('/').pop()!))
})

test('P2 ⌂ 回主页：**有 tab 也能回**（主页是可以停留的地方，不只是空态）', async () => {
  const { win } = await launch([{ page: 'a.md', cursor: 0, scrollTop: 0 }])
  await expect(win.locator('.cm-content')).toBeVisible()
  await win.locator('[data-sepia-tab-home]').click()
  await expect(win.locator('.sepia-home')).toBeVisible()
  // tab 还在，没被关掉
  await expect(win.locator('.sepia-tab')).toHaveCount(1)
  // 点回去就回到纸
  await win.locator('.sepia-tab').first().click()
  await expect(win.locator('.cm-content')).toBeVisible()
})
