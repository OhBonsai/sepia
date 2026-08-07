import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 190 P1 的其余几件：`/` 组件菜单（F4）、mermaid 真渲染（F5）。

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const launched: ElectronApplication[] = []
test.afterEach(async () => {
  await Promise.all(launched.splice(0).map((app) => app.close().catch(() => undefined)))
})

async function launch(body: string): Promise<{ win: Page; page: string }> {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'sepia-p1-'))
  const book = join(home, 'book')
  await mkdir(book, { recursive: true })
  const page = join(book, 'a.md')
  await writeFile(page, body, 'utf8')
  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 2, book, tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }], active: 0 }),
  )
  await writeFile(join(home, '.sepia', 'config.json'), JSON.stringify({ version: 1, autosaveDebounceMs: 200 }))
  const app = await electron.launch({
    args: LAUNCH_ARGS,
    env: { ...process.env, HOME: home, USERPROFILE: home, SEPIA_TEST_USER_DATA: join(home, 'ud') },
  })
  launched.push(app)
  const win = await app.firstWindow()
  await win.waitForSelector('.cm-content')
  await win.waitForTimeout(400)
  return { win, page }
}

test('F4 `/` 菜单：空行敲 `/` → 两项 → Enter 插入标准围栏', async () => {
  const { win, page } = await launch('第一行\n\n')
  await win.locator('.cm-line').last().click()
  await win.keyboard.type('/')

  const menu = win.locator('[data-sepia-slash]')
  await expect(menu, '空行敲 / 没有出菜单').toBeVisible({ timeout: 3_000 })
  // 两项（shader 按 D-27 移出 MVP）
  await expect(win.locator('.sepia-slash-item')).toHaveCount(2)

  await win.keyboard.press('Enter')
  // 插入的是**标准围栏**——菜单只省去手打，不引入私有语法
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 8_000 }).toContain('```textdiagram')
})

test('F4 **正文里的斜杠不弹菜单**：`and/or` 照常打字', async () => {
  const { win } = await launch('已经有字\n')
  await win.locator('.cm-line').first().click()
  await win.keyboard.press('Meta+ArrowRight')
  await win.keyboard.type('/')
  await win.waitForTimeout(500)
  await expect(win.locator('[data-sepia-slash]'), '行中间的斜杠也弹菜单了').toHaveCount(0)
})

test('F5 mermaid **真图**：失焦渲染出 svg，不是一个 pre 盒', async () => {
  const { win } = await launch('# 图\n\n```textdiagram\ngraph TD\n  A-->B\n```\n\n尾巴\n')
  // 光标不在图里 → 失焦渲染。mermaid 是惰性 chunk，给足时间
  await expect
    .poll(async () => win.evaluate(() => document.querySelectorAll('.sepia-textdiagram svg').length), {
      timeout: 20_000,
    })
    .toBe(1)

  // 画出来的要**有尺寸**——一个 0×0 的 svg 也是 svg
  const box = await win.evaluate(() => {
    const svg = document.querySelector('.sepia-textdiagram svg')
    if (svg === null) return null
    const rect = svg.getBoundingClientRect()
    return { w: Math.round(rect.width), h: Math.round(rect.height) }
  })
  expect(box!.w).toBeGreaterThan(20)
  expect(box!.h).toBeGreaterThan(20)
})

test('F5 图表语法写错 → **退回源码 + 一行错**，不崩不空白', async () => {
  const { win } = await launch('# 图\n\n```textdiagram\n这不是合法的图表语法 {{{\n```\n\n尾巴\n')
  await expect(win.locator('.sepia-textdiagram-error')).toBeVisible({ timeout: 20_000 })
  // 纸没坏：正文还在
  await expect(win.locator('.cm-content')).toContainText('尾巴')
})
