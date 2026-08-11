import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 170 §2.4 #12：**气质基线**（§2.1 〇）。
//
// 这一条守的是"这是一张纸，不是一个代码编辑器"。三件事都能被机器判死：
// 有没有行号槽、正文是不是等宽、版心有没有失控。
// **审美判断不在这里**（那是人工轮的事）——这里只钉住三条不许回退的底线。

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const launched: ElectronApplication[] = []
test.afterEach(async () => {
  await Promise.all(launched.splice(0).map((app) => app.close().catch(() => undefined)))
})

async function boot(theme?: 'dark' | 'light'): Promise<Page> {
  const home = await mkdtemp(join(tmpdir(), 'sepia-type-'))
  const page = join(home, 'note.md')
  await writeFile(page, '第一段中文正文。\n\n`行内代码`\n\n```js\nconst a = 1\n```\n', 'utf8')
  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 2, book: null, tabs: [{ page: page, cursor: 0, scrollTop: 0 }], active: 0 }),
    'utf8',
  )
  if (theme !== undefined) {
    await writeFile(join(home, '.sepia', 'config.json'), JSON.stringify({ version: 1, theme }), 'utf8')
  }
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
  await win.waitForTimeout(400)
  return win
}

test('#12 气质基线：无行号槽、正文非等宽、版心 ≤760', async () => {
  const win = await boot()

  // ── 一：没有行号槽 ────────────────────────────────────────────────────
  // 破坏方式：把 `lineNumbers()` 加回 baseExtensions → 必红。
  // 行号是代码编辑器的家具，它一在左边立着，这就不是一张纸了。
  expect(await win.locator('.cm-gutters').count(), '行号槽回来了').toBe(0)
  expect(await win.locator('.cm-lineNumbers').count()).toBe(0)

  // ── 二：正文**不是**等宽，而代码**是** ────────────────────────────────
  // 破坏方式：把 `.cm-content` 的 fontFamily 改回 ui-monospace → 必红。
  const fonts = await win.evaluate(() =>
    Object.fromEntries(
      (
        [
          ['body', '.cm-content'],
          ['code', '.cm-md-code'],
          ['block', '.cm-md-codeblock'],
        ] as const
      ).map(([key, selector]) => {
        const el = document.querySelector(selector)
        return [key, el === null ? '' : globalThis.getComputedStyle(el).fontFamily]
      }),
    ),
  )
  expect(fonts.body, '正文成了等宽——每一段都像代码清单').not.toMatch(/mono/i)
  expect(fonts.body, '正文栈没生效').toMatch(/PingFang|apple-system|Segoe/i)
  // **代码那一半必须还是等宽**：正文换栈时最容易顺手把它们一起换掉，
  // 而代码一旦不等宽，对齐与缩进全塌
  expect(fonts.code, '行内代码丢了等宽').toMatch(/mono/i)
  expect(fonts.block, '代码块丢了等宽').toMatch(/mono/i)

  // ── 三：版心 ≤760 且真的居中 ──────────────────────────────────────────
  // 破坏方式：去掉 maxWidth → 正文铺满整窗，必红。
  const layout = await win.evaluate(() => {
    const content = document.querySelector('.cm-content')
    if (content === null) return null
    const rect = content.getBoundingClientRect()
    const leftGap = rect.left
    const rightGap = globalThis.innerWidth - rect.right
    return { width: rect.width, leftGap, rightGap, viewport: globalThis.innerWidth }
  })
  expect(layout).not.toBeNull()
  expect(layout!.width, '版心失控——长行会一路铺到窗口边').toBeLessThanOrEqual(760)
  // 居中：两侧留白之差不超过 2px（窗口够宽时才有意义）
  if (layout!.viewport > 800) {
    expect(Math.abs(layout!.leftGap - layout!.rightGap), '版心没居中').toBeLessThanOrEqual(2)
  }
})

test('#12b 选区底色**在两套主题下都用我们的色板**（dark 下曾被 CM6 默认压掉）', async () => {
  for (const theme of ['dark', 'light'] as const) {
    const win = await boot(theme)
    await win.locator('.cm-line').first().click({ clickCount: 3 })
    await win.waitForTimeout(400)

    const probe = await win.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const layer = document.querySelector('.cm-selectionBackground')
      const content = document.querySelector('.cm-content')
      // 下面两个小函数**必须留在这个回调里**：它整个被序列化后在页面上下文执行，
      // 提到外层就传不进去了。lint 的 consistent-function-scoping 在这儿不适用。
      /** `#rrggbb` → `rgb(r, g, b)`，与 computed 值同形才比得了 */
      // eslint-disable-next-line unicorn/consistent-function-scoping -- 见上
      const toRgb = (hex: string): string => {
        const v = hex.trim().replace('#', '')
        return `rgb(${String(Number.parseInt(v.slice(0, 2), 16))}, ${String(
          Number.parseInt(v.slice(2, 4), 16),
        )}, ${String(Number.parseInt(v.slice(4, 6), 16))})`
      }
      // eslint-disable-next-line unicorn/consistent-function-scoping -- 同上：页面上下文
      const luminance = (rgb: string): number => {
        const [r = 0, g = 0, b = 0] = (/(\d+), (\d+), (\d+)/.exec(rgb) ?? []).slice(1).map(Number)
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      }
      return {
        expected: toRgb(root.getPropertyValue('--sepia-selection')),
        actual: layer === null ? null : getComputedStyle(layer).backgroundColor,
        contrast:
          layer === null || content === null
            ? 0
            : Math.abs(
                luminance(getComputedStyle(layer).backgroundColor) -
                  luminance(getComputedStyle(content).color),
              ),
      }
    })

    // 一：画出来的**就是色板里那一个值**。
    // 实测栽过：`--sepia-selection` 明明是对的，画出来却是 CM6 `drawSelection`
    // 自带的 `#d7d4f0`——它的选择器路径更长、特异性更高，一直压着我们的规则。
    // dark 下于是成了浅紫底 + 浅色字，选了什么根本看不清。
    expect(probe.actual, `${theme}：选区底色不是色板里那个值`).toBe(probe.expected)

    // 二：**选区与正文得分得开**（这条才是用户真正在意的）
    expect(probe.contrast, `${theme}：选区与正文的明度差太小，选了什么看不清`).toBeGreaterThan(0.25)
  }
})
