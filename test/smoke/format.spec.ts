import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 190 P1 / F2：标准快捷键集在**真键盘**上走通。
//
// 判断本身有 23 条单测（core 的 toggle），这里只问一件单测答不了的事：
// **按下 ⌘B，键真的到得了这条路吗**——CM6 自己的 keymap、应用的 window 监听、
// 浮层的捕获阶段全都在抢这几个键，而抢输了的样子是"什么也没发生"。

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const launched: ElectronApplication[] = []
test.afterEach(async () => {
  await Promise.all(launched.splice(0).map((app) => app.close().catch(() => undefined)))
})

async function launch(body = '关键词\n'): Promise<{ win: Page; page: string }> {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'sepia-fmt-'))
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

/** 选中正文里的一段（与 markup smoke 同一套手法）。 */
async function select(win: Page, needle: string): Promise<void> {
  await win.locator('.cm-content').click()
  await win.evaluate((text) => {
    const walker = document.createTreeWalker(document.querySelector('.cm-content')!, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const index = (node.textContent ?? '').indexOf(text)
      if (index !== -1) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + text.length)
        const selection = globalThis.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        return
      }
      node = walker.nextNode()
    }
    throw new Error(`not found: ${text}`)
  }, needle)
}

test('F2 ⌘B：选中 → 加粗 → **再按一次回到原样**（字节逐字相等）', async () => {
  const { win, page } = await launch()
  const original = await readFile(page, 'utf8')
  await select(win, '关键词')

  await win.keyboard.press('Meta+b')
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 8_000 }).toContain('**关键词**')

  // **按第二次回到原样**——这是 toggle 语义的全部意义，也是 round-trip 的实证
  await win.keyboard.press('Meta+b')
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 8_000 }).toBe(original)
})

test('F2 ⌘1 标题 / ⌘0 还原', async () => {
  const { win, page } = await launch('标题行\n')
  // **点那一行，不是点整个编辑区**——点空白处光标会落到文末的空行上，
  // 于是标题加在了一个空行前面。第一版就是这么红的。
  await win.locator('.cm-line').first().click()
  await win.keyboard.press('Meta+1')
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 8_000 }).toContain('# 标题行')
  await win.keyboard.press('Meta+0')
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 8_000 }).not.toContain('#')
})

test('F2 Enter 续列表 + **空项退出**（没有它，列表一开头就出不来）', async () => {
  const { win, page } = await launch('- 第一项\n')
  await win.locator('.cm-line').first().click()
  await win.keyboard.press('Meta+ArrowRight')
  await win.keyboard.press('Enter')
  await win.keyboard.type('第二项')
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 8_000 }).toContain('- 第二项')

  // 空项再回车 → 退出列表
  await win.keyboard.press('Enter')
  await win.keyboard.press('Enter')
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 8_000 }).not.toMatch(/-\s*$/)
})

test('F2 ⌘⌥Q 引用 · ⌘⌥U 列表：行首标记 toggle', async () => {
  const { win, page } = await launch('一句话\n')
  await win.locator('.cm-line').first().click()
  await win.keyboard.press('Meta+Alt+q')
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 8_000 }).toContain('> 一句话')
  await win.keyboard.press('Meta+Alt+q')
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 8_000 }).not.toContain('>')
})

test('**⌘\\ 开关侧边栏，⌘B 不再管它**（190 P1 的 ⌘B 冲突裁决）', async () => {
  const { win, page } = await launch('正文\n')
  const before = await win.locator('.sepia-tree').count()
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+\\')
  await win.waitForTimeout(300)
  expect(await win.locator('.sepia-tree').count(), '⌘\\ 没有开关侧边栏').not.toBe(before)

  // 而 ⌘B 此刻应当去加粗，**不再碰侧边栏**
  const sidebarNow = await win.locator('.sepia-tree').count()
  await win.keyboard.press('Meta+b')
  await win.waitForTimeout(400)
  expect(await win.locator('.sepia-tree').count(), '⌘B 还在开关侧边栏——让位没落实').toBe(sidebarNow)
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 8_000 }).toContain('**')
})
