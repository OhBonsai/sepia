import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'

// Stage 1 的 DoD：**冷启动 <1s 打开上次 page 且可写；无白闪。**
// 这三条机器判定不了的部分留给人工清单，能判定的部分在这里。

const APP_ENTRY = 'packages/app/out/main/index.js'

// CI（Linux runner）上 electron 的 SUID sandbox 助手没有 setuid root，不带这个标志
// 根本起不来——Stage 0 的自启动 smoke 一直带着它，换 Playwright 时漏了。
// 本地不加：sandbox 该开着测。
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]
const PAGE_BODY = '# 冷启动\r\n\r\n第二行。\r\n'

async function launch(home: string): Promise<ElectronApplication> {
  return electron.launch({
    args: LAUNCH_ARGS,
    // HOME 指到临时目录，于是 `app.getPath('home')` 跟着走，
    // ~/.sepia 落在临时目录里——**不碰用户真实的 ~/.sepia**。
    env: { ...process.env, HOME: home, USERPROFILE: home },
  })
}

interface StartupReport {
  complete: boolean
  segments: {
    coldStartToWritable?: number
    processToWindowVisible?: number
    windowToCaretReady?: number
  }
  withinBudget: boolean | null
}

test('冷启动 → 可写，全部打点在预算内', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sepia-smoke-'))
  const page = join(home, 'page.md')
  await writeFile(page, PAGE_BODY, 'utf8')
  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 1, page, cursor: 3, scrollTop: 0 }),
    'utf8',
  )

  // 打点报告走 stdout：主进程是打包后的 CJS，`app.evaluate` 里做不了动态 import，
  // 而 stdout 这条通道本来就是为 smoke 设计的（perf.ts printReport），
  // 不必为了测试在桥上或全局上多挂一个东西。
  const app = await electron.launch({
    args: LAUNCH_ARGS,
    env: { ...process.env, HOME: home, USERPROFILE: home, SEPIA_SMOKE_EXIT: '1' },
  })

  let stdout = ''
  app.process().stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })

  await app.waitForEvent('close')

  const line = stdout.split('\n').find((it) => it.startsWith('sepia-perf: {'))
  expect(line, `没拿到打点报告，stdout 是：\n${stdout}`).toBeTruthy()

  const report = JSON.parse(line!.slice('sepia-perf: '.length)) as StartupReport
  expect(report.complete, 't0–t5 必须攒齐，否则测的不是冷启动').toBe(true)

  // 预算断言只在非 CI 生效。120 §1.7 的测法写明「换机器测就等于换了基线」——
  // 预算标定在本机基线（P50 440ms），而共享 runner 实测 4300ms（同一构建），
  // 硬断言只会把「runner 慢」误报成「启动坏了」。CI 上守两件事：t0–t5 攒齐
  //（启动链没断）+ 数字打印可见（下面这行，进 CI 日志留趋势）；预算回归由
  // 基线机器上的本地 smoke 与每个 stage 的 §1.7 冷测把关。
  process.stdout.write(`${line}\n`)
  if (!process.env['CI']) {
    expect(report.segments.coldStartToWritable).toBeLessThan(1000)
    expect(report.segments.processToWindowVisible).toBeLessThan(500)
    expect(report.segments.windowToCaretReady).toBeLessThan(500)
    expect(report.withinBudget).toBe(true)
  }
})

test('首帧主题已就位——无白闪的机器可判定部分（纪律 13）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sepia-smoke-'))
  const app = await launch(home)
  const window = await app.firstWindow()

  // 窗口的 backgroundColor 与 renderer 的纸面色必须由同一份真相派生。
  // 这里只断言"body 的背景不是透明/未初始化"——真正的"没闪一下"要靠人眼，
  // 它在 120 §1.6 的人工清单里，不假装机器能判。
  await window.waitForSelector('body')
  const background = await window.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(background).not.toBe('')
  expect(background).not.toBe('rgba(0, 0, 0, 0)')

  await app.close()
})
