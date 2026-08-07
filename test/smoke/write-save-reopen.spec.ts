import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

// 「写字 → 保存 → 重开」全链（120 §1.5 smoke 表的最后一条，附录 D.3 第 5 条）。
// 一条用例同时压住三件事：
//   1. 滚动位置的采集与恢复（附录 D.1 的三处断链，修复后的端到端证据）
//   2. ⌘S 保存落盘
//   3. **CRLF 不被规范化**（不变量 2）——base.ts 的 onChange 曾走 doc.toString()，
//      CRLF 文件敲一个字保存就整篇变 LF；单测够不到 updateListener（要真 EditorView），
//      所以这条只能在这里守。

const APP_ENTRY = 'packages/app/out/main/index.js'

// CI（Linux runner）上 electron 的 SUID sandbox 助手没有 setuid root，不带这个标志
// 根本起不来——Stage 0 的自启动 smoke 一直带着它，换 Playwright 时漏了。
// 本地不加：sandbox 该开着测。
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

/** 200 行 CRLF 文本，长到必然出现滚动条。 */
const LINES = Array.from({ length: 200 }, (_, i) => `第 ${i + 1} 行 —— 用来撑出滚动条的正文内容。`)
const BODY = `${LINES.join('\r\n')}\r\n`

test('写字→保存→重开：滚动还原、内容落盘、CRLF 逐字节保真', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sepia-smoke-'))
  const page = join(home, 'page.md')
  await writeFile(page, BODY, 'utf8')

  // 光标落在第 150 行行首附近，滚动位置与之大致相配
  const cursor = BODY.indexOf('第 150 行')
  await mkdir(join(home, '.sepia'), { recursive: true })
  const seedSession = { version: 2, book: null, tabs: [{ page, cursor, scrollTop: 2400 }], active: 0 }
  await writeFile(join(home, '.sepia', 'session.json'), JSON.stringify(seedSession), 'utf8')

  // ── 第一程：恢复滚动 → 敲字 → 保存 ────────────────────────────────────────
  const first = await electron.launch({
    args: LAUNCH_ARGS,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      // 单实例锁按 Electron 的 userData 定，而它**不跟 $HOME 走**（macOS 上 app.getPath
      // 无视 $HOME）。不隔离它，另一条并行线的 smoke 一开着，这里每次 launch 都抢不到锁、
      // 直接 quit——一扇窗都不开，报出来是「Target page has been closed」。170 §1.9 实测。
      SEPIA_TEST_USER_DATA: join(home, 'electron-user-data'),
    },
  })
  const window = await first.firstWindow()
  await window.waitForSelector('.cm-content')

  // 恢复发生在 CM6 首次 measure 之后（rAF），所以轮询而不是单次读。
  // 精确值受行高/字体影响，断言"确实滚下去了"而不是死数字。
  await expect
    .poll(() => window.evaluate(() => document.querySelector('.cm-scroller')?.scrollTop ?? -1), {
      timeout: 3000,
    })
    .toBeGreaterThan(500)

  await window.keyboard.type('【SMOKE-MARKER】')
  // macOS 上是 Meta+S，Linux CI（xvfb）上是 Control+S——渲染层监听的是 metaKey||ctrlKey
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')

  // 保存是异步的：轮询磁盘直到 marker 出现
  await expect.poll(async () => (await readFile(page, 'utf8')).includes('【SMOKE-MARKER】'), {
    timeout: 5000,
  }).toBe(true)

  const saved = await readFile(page, 'utf8')
  // 不变量 2：换行仍然全部是 CRLF——没有一个孤立的 \n
  expect(/(?<!\r)\n/.test(saved), '保存后出现了孤立 \\n——CRLF 被规范化了，不变量 2 破').toBe(false)
  // 等 session 的 debounce 落盘（500ms + 余量）再关
  await window.waitForTimeout(900)
  await first.close()

  // ── 第二程：重开，内容与滚动都在 ─────────────────────────────────────────
  const second = await electron.launch({
    args: LAUNCH_ARGS,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      // 单实例锁按 Electron 的 userData 定，而它**不跟 $HOME 走**（macOS 上 app.getPath
      // 无视 $HOME）。不隔离它，另一条并行线的 smoke 一开着，这里每次 launch 都抢不到锁、
      // 直接 quit——一扇窗都不开，报出来是「Target page has been closed」。170 §1.9 实测。
      SEPIA_TEST_USER_DATA: join(home, 'electron-user-data'),
    },
  })
  const reopened = await second.firstWindow()
  await reopened.waitForSelector('.cm-content')

  await expect
    .poll(() => reopened.evaluate(() => document.querySelector('.cm-scroller')?.scrollTop ?? -1), {
      timeout: 3000,
    })
    .toBeGreaterThan(500)

  const hasMarker = await reopened.evaluate(() =>
    Boolean(document.querySelector('.cm-content')?.textContent?.includes('【SMOKE-MARKER】')),
  )
  expect(hasMarker, '重开后看不到上次写的字').toBe(true)

  await second.close()
})
