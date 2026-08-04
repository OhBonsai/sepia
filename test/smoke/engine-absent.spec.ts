import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'

// Stage 3 的 DoD：**kill -9 引擎后纸全功能可写**；⌘K 给缺席提示；
// 冷启动同步路径仍无引擎。三条 smoke（140 §1.4 #7 #8 #9）都在这个文件里，
// 因为它们共用「起真应用 + 隔离 HOME + 读 stdout 诊断」这套装置。

// 这三条都要等真引擎起来（fork→ready 实测 2.3s），kill -9 那条还要走完
// 三次退避（0.5 + 2 + 5s）与三次重启。默认 60s 在有负载的机器上不够，
// 放宽是**对被测行为的诚实**，不是掩盖慢——退避时长本身就是被断言的对象。
test.setTimeout(240_000)

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]
const PAGE_BODY = '# 引擎缺席\n\n第二行。\n'

/** 引擎起来要装载 30MB 的单文件 ESM，实测 fork→ready 约 2.3s，留足余量。 */
const ENGINE_READY_TIMEOUT_MS = 45_000

interface EngineDiag {
  event: string
  pid?: number
  status?: string
  restarts?: number
  at?: number
  t3?: number
  code?: number
}

interface Harness {
  app: ElectronApplication
  home: string
  page: string
  diag: EngineDiag[]
  stdout: () => string
}

async function launch(): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'sepia-engine-smoke-'))
  const page = join(home, 'page.md')
  await writeFile(page, PAGE_BODY, 'utf8')
  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 1, page, cursor: 0, scrollTop: 0 }),
    'utf8',
  )

  const app = await electron.launch({
    args: LAUNCH_ARGS,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  })

  let stdout = ''
  const diag: EngineDiag[] = []
  app.process().stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stdout += text
    for (const line of text.split('\n')) {
      if (!line.startsWith('sepia-engine: ')) continue
      diag.push(JSON.parse(line.slice('sepia-engine: '.length)) as EngineDiag)
    }
  })

  return { app, home, page, diag, stdout: () => stdout }
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const hit = probe()
    if (hit !== undefined) return hit
    if (Date.now() > deadline) throw new Error(`等不到${what}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

test('kill -9 引擎后纸仍全功能可写，且出现缺席提示线', async () => {
  const harness = await launch()
  const window = await harness.app.firstWindow()
  await window.waitForSelector('.cm-content')

  const ready = await waitFor(
    () => harness.diag.find((it) => it.event === 'ready'),
    ENGINE_READY_TIMEOUT_MS,
    '引擎就绪',
  )
  expect(ready.pid, '引擎就绪必须报 pid，否则下面杀的是空气').toBeTruthy()

  // 见一个杀一个，直到退避额度烧完进缺席稳态（架构 §4.1）。
  // 轮询式而不是「杀一次等一轮」：重启是异步的，固定轮次会和退避定时器抢时序。
  // 预定破坏方式 ⑦：注释掉缺席稳态迁移 → 这里等不到 absent，必红。
  const killed = new Set<number>()
  await waitFor(
    () => {
      const absent = harness.diag.find((it) => it.status === 'absent')
      if (absent !== undefined) return absent
      const pid = harness.diag.filter((it) => it.event === 'ready').at(-1)?.pid
      if (pid !== undefined && !killed.has(pid)) {
        killed.add(pid)
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // 已经自己死了，正好
        }
      }
      return undefined
    },
    180_000,
    '缺席稳态（退避额度应当烧完）',
  )
  expect(killed.size, '缺席前应当真的杀过若干次，而不是引擎压根没起来').toBeGreaterThanOrEqual(1)

  // ——DoD 的那一句：纸全功能可写。
  await expect(window.locator('.sepia-agent-line')).toBeVisible()

  await window.click('.cm-content')
  await window.keyboard.type('引擎死了，这行字照样落下去。')
  await window.keyboard.press('ControlOrMeta+s')

  await expect
    .poll(async () => readFile(harness.page, 'utf8'), { timeout: 10_000 })
    .toContain('引擎死了，这行字照样落下去。')

  // ⌘K：缺席文案出现（W12——细提示，不是浮层）
  await window.keyboard.press('ControlOrMeta+k')
  await expect(window.locator('.sepia-agent-hint')).toBeVisible()
  await expect(window.locator('.sepia-agent-hint')).toContainText('缺席')

  await harness.app.close()
})

test('引擎全部路径落在 ~/.sepia/engine 下，隔离目录里没有凭据文件', async () => {
  const harness = await launch()
  await (await harness.app.firstWindow()).waitForSelector('.cm-content')
  await waitFor(() => harness.diag.find((it) => it.event === 'ready'), ENGINE_READY_TIMEOUT_MS, '引擎就绪')

  const engineHome = join(harness.home, '.sepia', 'engine')
  const { readdirSync, existsSync } = await import('node:fs')

  expect(existsSync(engineHome), '四个 XDG 根都该派生自 ~/.sepia/engine').toBe(true)

  // 判据一：四个 XDG 根各自派生出的 opencode 目录**都得在**。
  // 反向验证的教训：原来这里只查「HOME 下有没有 .config」，而 HOME 本身也被指进了
  // 隔离根，于是少设一个 XDG 根时引擎悄悄回落到 `engine/home/.config`——**仍在根内**，
  // 断言抓不到，检查空转。少一个根 → 这一条缺一个目录 → 必红（预定破坏方式 ⑨）。
  const missing = ['config', 'data', 'state', 'cache'].filter(
    (root) => !existsSync(join(engineHome, root, 'opencode')),
  )
  expect(missing, '四个 XDG 根必须都在 fork 时设定，缺一个引擎就会回落到 HOME 兜底').toEqual([])

  // 判据二：引擎不得回落到 HOME 兜底——`engine/home` 下出现 XDG 影子目录即回落。
  const fellBack = ['.config', '.local', '.cache'].filter((name) => existsSync(join(engineHome, 'home', name)))
  expect(fellBack, '出现这些目录说明某个 XDG 根没设上，引擎按 HOME 兜底算了路径').toEqual([])

  // 判据三：真正的逃逸——隔离根之外一个字节都不许有
  const escaped = ['.config', '.local', '.cache', 'Library'].filter((name) => existsSync(join(harness.home, name)))
  expect(escaped, '引擎不许在 ~/.sepia/engine 之外落文件（纪律 20 / 架构 §4.1）').toEqual([])

  // 引擎侧零落盘：隔离目录里不出现任何凭据文件
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (/auth|credential|token|\.key$/i.test(entry.name)) found.push(child)
    }
  }
  walk(engineHome)
  expect(found, '凭据只许以密文住在 ~/.sepia/credentials.json，引擎侧零落盘').toEqual([])

  await harness.app.close()
})

test('同步路径纯净：引擎 fork 发生在纸可写（t5）之后', async () => {
  const harness = await launch()
  await (await harness.app.firstWindow()).waitForSelector('.cm-content')

  const fork = await waitFor(() => harness.diag.find((it) => it.event === 'fork'), ENGINE_READY_TIMEOUT_MS, '引擎 fork')

  // 纪律 12 的机器判据。预定破坏方式 ⑧：把 fork 挪到窗口可见之前 → 这条必红。
  expect(fork.t3, 'fork 时 t3 必须已经打上——窗口都没可见就起引擎是纪律 12 违规').toBeGreaterThan(0)
  expect(fork.at, 'fork 必须晚于窗口可见').toBeGreaterThan(fork.t3!)

  // 更严的那一条：fork 也必须晚于 t5（可写）。判据与 DoD 同一个点——
  // 「纸不因引擎多等一毫秒」说的是可写，不是窗口出现。
  const perf = await waitFor(
    () => harness.stdout().split('\n').find((line) => line.startsWith('sepia-perf: {')),
    ENGINE_READY_TIMEOUT_MS,
    '打点报告',
  )
  const report = JSON.parse(perf.slice('sepia-perf: '.length)) as { timeline: Record<string, number> }
  expect(report.timeline['t5'], 't0–t5 必须攒齐').toBeGreaterThan(0)
  expect(fork.at, 'fork 必须晚于 t5（可写）——引擎的重负载不许和 CM6 就绪抢 CPU').toBeGreaterThan(
    Math.round(report.timeline['t5']!),
  )

  await harness.app.close()
})
