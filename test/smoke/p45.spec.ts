import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 190 P4（▤ 属性表）与 P5（连接面板 / @ 双屏）。

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const launched: ElectronApplication[] = []
test.afterEach(async () => {
  await Promise.all(launched.splice(0).map((app) => app.close().catch(() => undefined)))
})

async function launch(body: string): Promise<{ win: Page; page: string; book: string }> {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'sepia-p45-'))
  const book = join(home, 'book')
  await mkdir(book, { recursive: true })
  const page = join(book, 'a.md')
  await writeFile(page, body, 'utf8')
  await writeFile(join(book, 'b.md'), '# 被引的那篇\n\n它的内容。\n', 'utf8')
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
  await win.waitForTimeout(500)
  return { win, page, book }
}

test('P4 ▤ 属性表：展开 → 改一格 → **frontmatter 字节真的变了，正文一个字没动**', async () => {
  const body = '---\ntitle: 旧标题\ndate: 2026-08-07\n---\n\n# 正文\n\n内容一段。\n'
  const { win, page } = await launch(body)
  await win.locator('[data-sepia-paper-icon="meta"]').click()
  await expect(win.locator('[data-sepia-meta]')).toBeVisible()

  await win.locator('[data-sepia-meta-value="title"]').click()
  await win.locator('[data-sepia-meta-input="title"]').fill('新标题')
  await win.keyboard.press('Enter')

  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 8_000 }).toContain('title: 新标题')
  const after = await readFile(page, 'utf8')
  // **正文逐字节原样**——属性表改的是 frontmatter，不是整篇
  expect(after.slice(after.indexOf('# 正文')), '改属性表动了正文').toBe(body.slice(body.indexOf('# 正文')))
  expect(after, '别的 frontmatter 行被改了').toContain('date: 2026-08-07')
})

test('P4 ▤ 再按一次收起，纸从正文开始', async () => {
  const { win } = await launch('---\ntitle: 甲\n---\n\n正文\n')
  await win.locator('[data-sepia-paper-icon="meta"]').click()
  await expect(win.locator('[data-sepia-meta]')).toBeVisible()
  await win.locator('[data-sepia-paper-icon="meta"]').click()
  await expect(win.locator('[data-sepia-meta]')).toHaveCount(0)
})

test('P5 🔗 连接面板：列出引用 + 位置标注；图片不算引用', async () => {
  const { win } = await launch('# 甲\n\n首段引 [乙](b.md)。\n\n末段引外链 [iq](https://example.com/a)，还有 ![图](assets/x.png)。\n')
  await win.locator('[data-sepia-paper-icon="links"]').click()
  await expect(win.locator('[data-sepia-linkspanel]')).toBeVisible()
  await expect(win.locator('.sepia-link-row')).toHaveCount(2)
  await expect(win.locator('[data-sepia-link-external="true"]')).toHaveCount(1)
  // 位置标注在
  await expect(win.locator('.sepia-link-where').first()).not.toBeEmpty()
})

test('P5 右侧区**三种占用者互斥**：开了连接再开对话，右栏只有一个', async () => {
  const { win } = await launch('# 甲\n\n引 [乙](b.md)。\n')
  await win.locator('[data-sepia-paper-icon="links"]').click()
  await expect(win.locator('[data-sepia-rightbar="links"]')).toBeVisible()
  await win.locator('[data-sepia-paper-icon="threads"]').click()
  await expect(win.locator('[data-sepia-rightbar="threads"]')).toBeVisible()
  await expect(win.locator('.sepia-rightbar'), '右栏出现了两个——它只有一个位置').toHaveCount(1)
})

test('P5 ⌘点击引用 → **右栏开第二编辑器**（不是只读预览）', async () => {
  const { win } = await launch('# 甲\n\n引 [乙](b.md)。\n')
  // 光标不在链接行上时链接才是渲染态
  await win.locator('.cm-line').first().click()
  await win.locator('.cm-md-link').first().click({ modifiers: ['Meta'] })
  await expect(win.locator('[data-sepia-rightbar="split"]')).toBeVisible({ timeout: 8_000 })
  // **是完整编辑器**：右栏里有第二个 .cm-content
  await expect(win.locator('.cm-content')).toHaveCount(2, { timeout: 8_000 })
})

test('P5 单击 book 内引用 → 当前 tab 跳转（不开右栏）', async () => {
  const { win } = await launch('# 甲\n\n引 [乙](b.md)。\n')
  await win.locator('.cm-line').first().click()
  await win.locator('.cm-md-link').first().click()
  await expect(win.locator('[data-sepia-tab="b.md"]')).toHaveCount(1, { timeout: 8_000 })
  await expect(win.locator('.sepia-rightbar')).toHaveCount(0)
})
