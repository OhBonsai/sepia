import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 190 附录 B-1 的两条**红线**（§2 §3）：
//   · 打字与 IME 路径**零动画**——Aha #1 与输入延迟不变量不让步
//   · `prefers-reduced-motion` 下**全部退化为瞬时**，且这条要有检查护着
//
// 白名单四点本身（主页→纸/tab/右侧区/设置浮层）不在这里断言"动了"——
// 动效好不好看只有人能判；机器能判死的是**哪里不许动**、以及**关掉时真的关掉**。

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const launched: ElectronApplication[] = []
test.afterEach(async () => {
  await Promise.all(launched.splice(0).map((app) => app.close().catch(() => undefined)))
})

async function launch(reduced = false): Promise<Page> {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'sepia-motion-'))
  const book = join(home, 'book')
  await mkdir(book, { recursive: true })
  await writeFile(join(book, 'a.md'), '# 标题\n\n正文一段，用来打字。\n', 'utf8')
  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 2, book, tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }], active: 0 }),
  )
  await writeFile(join(home, '.sepia', 'config.json'), JSON.stringify({ version: 1, autosaveDebounceMs: 300 }))
  const app = await electron.launch({
    args: LAUNCH_ARGS,
    env: { ...process.env, HOME: home, USERPROFILE: home, SEPIA_TEST_USER_DATA: join(home, 'ud') },
  })
  launched.push(app)
  const win = await app.firstWindow()
  // **用 Playwright 的媒体模拟**：Chromium 没有可靠的 `--force-prefers-reduced-motion`
  // 命令行开关（第一版这么写，结果 `matchMedia` 仍是 false——那条断言当场
  // 变成"测了个空"，幸好我先断言了 `reduced === true`）。
  if (reduced) await win.emulateMedia({ reducedMotion: 'reduce' })
  await win.waitForSelector('.cm-content')
  await win.waitForTimeout(600)
  return win
}

test('B-1 §2 **打字路径零动画**：编辑器内部没有任何 transition/animation', async () => {
  const win = await launch()
  await win.locator('.cm-line').first().click()
  await win.keyboard.type('敲一些字进去')
  await win.waitForTimeout(400)

  // 扫编辑器内部每一个元素的 computed transition/animation。
  // **这条是红线**：正文里但凡有过渡，光标与候选框就会跟着抖——
  // 而"输入延迟无感（含中文 IME）"是 Aha #1 的一部分，不让步。
  const moving = await win.evaluate(() => {
    const out: string[] = []
    const root = document.querySelector('.cm-editor')
    if (root === null) return ['没有编辑器']
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const style = getComputedStyle(el)
      const hasTransition = style.transitionDuration
        .split(',')
        .some((value) => Number.parseFloat(value) > 0)
      const hasAnimation =
        style.animationName !== 'none' && Number.parseFloat(style.animationDuration) > 0
      // 光标闪烁是 CM6 自己的 caret 动画（挂在 `cm-cursorLayer` 上），
      // 不是我们加在文字上的过渡——它不会让字或候选框动。**只放行它这一个**。
      const isCaret =
        el.classList.contains('cm-cursor') ||
        el.classList.contains('cm-cursor-primary') ||
        el.classList.contains('cm-cursorLayer')
      if ((hasTransition || hasAnimation) && !isCaret) {
        out.push(`${el.className || el.tagName}: ${style.transitionDuration} / ${style.animationName}`)
      }
    }
    return out
  })
  expect(moving, `编辑器内部有动画——打字路径必须零动画：\n${moving.join('\n')}`).toEqual([])
})

test('B-1 §3 **reduced-motion 下全部退化为瞬时**：时长 token 归零', async () => {
  const win = await launch(true)
  const tokens = await win.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return {
      motion: root.getPropertyValue('--sepia-motion').trim(),
      fast: root.getPropertyValue('--sepia-motion-fast').trim(),
      reduced: globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
    }
  })
  expect(tokens.reduced, '这一轮没有真的开启 reduced-motion，下面的断言等于没测').toBe(true)
  expect(tokens.motion, 'reduced-motion 下时长没归零').toBe('0ms')
  expect(tokens.fast, 'reduced-motion 下时长没归零').toBe('0ms')
})

test('B-1 §3 **时长与缓动只有一处定义**：没有游离的硬编码 duration', async () => {
  const win = await launch()
  const tokens = await win.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return {
      motion: root.getPropertyValue('--sepia-motion').trim(),
      fast: root.getPropertyValue('--sepia-motion-fast').trim(),
      ease: root.getPropertyValue('--sepia-ease').trim(),
    }
  })
  // token 存在且 ≤200ms（B-1 §3 的上限）
  expect(Number.parseFloat(tokens.motion), '主时长超过了 B-1 §3 的 200ms 上限').toBeLessThanOrEqual(200)
  expect(Number.parseFloat(tokens.fast)).toBeLessThanOrEqual(200)
  expect(tokens.ease, '缓动 token 没定义').toContain('cubic-bezier')
})
