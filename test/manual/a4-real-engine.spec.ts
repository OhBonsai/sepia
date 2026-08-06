import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

// Stage 4 §1.6a a4 的常驻复验装置——**真 key、真模型、真引擎，一个桩都不打**。
// 职责与判据见同目录 README。不进 CI（001 §6），靠 testDir 隔离而非自觉。
//
// 由来：2026-08-05 首次真模型全链跑，一次揪出四个 mock 抓不到的缺陷（150 §1.9 回流 4）——
// markup 落到 build agent、预热 session 绑错目录、隔离漏掉非 XDG 路径、`/event` 少带
// directory。**这四个的共同点是「桩以下」**，所以这个装置必须常驻。

const APP_ENTRY = 'packages/app/out/main/index.js'
const MODEL = 'aliyuntokenplan/qwen3.8-max'

const FIRST = '第一段。'
const TARGET = '这里是要改的那一段。'
const THIRD = '第三段。'
const PAGE_BODY = `${FIRST}\n\n${TARGET}\n\n${THIRD}\n`

/** 证据打印走 stdout：手跑装置的产出就是这份证据，但 `console` 在本仓库是禁的（lint）。 */
const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

test('a4 真引擎全链：⌘K → 只唤起改写 agent → diff → 落笔', async () => {
  // 没凭据是**环境缺条件，不是缺陷**——跳过，不红。
  const opencodeConfig = join(homedir(), '.config/opencode/opencode.json')
  test.skip(!existsSync(opencodeConfig), `需要 ${opencodeConfig}（真 key 的来源），本机没有则跳过`)

  const home = await mkdtemp(join(tmpdir(), 'sepia-a4-'))
  const pagePath = join(home, 'note.md')
  await writeFile(pagePath, PAGE_BODY, 'utf8')
  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 1, page: pagePath, cursor: 0, scrollTop: 0 }),
    'utf8',
  )

  await writeFile(join(home, '.sepia', 'config.json'), JSON.stringify({ version: 1, model: MODEL }), 'utf8')

  // 凭据怎么进来：**走架构 §4.1 那条一次性导入**——把父进程的 XDG 指回用户真实的
  // opencode 目录，`credentials.ts` 从那儿只读导入 key 与 provider 定义，密钥只在内存里，
  // **仓库一个字节不落**。引擎子进程沾不到这两个变量：`engineEnv()` 是从零搭的
  // （只有 PATH + 隔离变量），隔离照旧成立。
  //
  // **试过、不行的那条**：直接把 `~/.sepia/credentials.json` 复制进临时 HOME。
  // safeStorage 的密钥随 userData 目录（在 HOME 底下）走，换了 HOME 就解不开——
  // 实测报 `sepia-credentials: 密文解不开（钥匙串变更或文件损坏），本次以无凭据运行`，
  // 于是引擎起来了、prompt 也收了，但**一次模型调用都不会发生**（日志里连 stream 行都没有）。
  // 记在这儿，省得下次再试一遍。
  const app = await electron.launch({
    args: [APP_ENTRY],
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(homedir(), '.config'),
      XDG_DATA_HOME: join(homedir(), '.local/share'),
    },
  })
  const window = await app.firstWindow()
  await window.waitForSelector('.cm-content', { timeout: 30_000 })
  await expect
    .poll(
      async () =>
        window.evaluate(async () =>
          (globalThis as unknown as { api: { agent: { status(): Promise<string> } } }).api.agent.status(),
        ),
      { timeout: 60_000, intervals: [250] },
    )
    .toBe('ready')

  // 事件流留痕：part 的 type 是「动没动工具」最直接的证据——工具一旦被调起，
  // 流里就会出现 type=tool 的 part。permission 全 deny 生效与否在此见真章。
  await window.evaluate(() => {
    const g = globalThis as unknown as {
      api: { agent: { onEvent(cb: (e: unknown) => void): () => void } }
      sepiaPartTypes: string[]
    }
    g.sepiaPartTypes = []
    g.api.agent.onEvent((event) => {
      const part = (event as { properties?: { part?: { type?: string } } })?.properties?.part
      if (part?.type !== undefined) g.sepiaPartTypes.push(part.type)
    })
  })

  // 选中目标段落 → ⌘K → 点动词
  await window.evaluate((needle) => {
    const content = document.querySelector('.cm-content')
    if (content === null) throw new Error('no editor')
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode()) !== null) {
      const index = node.textContent?.indexOf(needle) ?? -1
      if (index === -1) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + needle.length)
      const selection = globalThis.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    throw new Error(`selection target not found: ${needle}`)
  }, TARGET)
  await window.keyboard.press('Meta+k')

  const panel = window.locator('.sepia-markup')
  await expect(panel).toBeVisible()
  await window.locator('.sepia-markup-verbs button', { hasText: '润色' }).click()
  await expect(panel).toHaveAttribute('data-sepia-markup', 'result', { timeout: 120_000 })

  await window.locator('.sepia-markup-actions button', { hasText: '落笔' }).click()
  await expect(panel).toHaveCount(0)

  const report = JSON.parse(
    (await window.locator('.sepia-shell').getAttribute('data-sepia-markup-report')) ?? '{}',
  ) as { complete: boolean; ordered: boolean; timeline: Record<string, number>; segments: Record<string, number> }
  const partTypes = await window.evaluate(
    () => (globalThis as unknown as { sepiaPartTypes: string[] }).sepiaPartTypes,
  )
  const log = await readFile(join(home, '.sepia/engine/data/opencode/log/opencode.log'), 'utf8')
  const fileAfter = await readFile(pagePath, 'utf8')
  const streamLines = log.split('\n').filter((line) => /message=stream/.test(line))
  // 「跑进 agentic loop 了没」：单发只会走到 step=1，step>1 才是又转了一圈
  const loopSteps = [...log.matchAll(/message=loop .*step=(\d+)/g)].map((m) => Number(m[1]))

  say('=== a4 真引擎证据 ===')
  say(`m0–m5：${JSON.stringify(report.timeline)}`)
  say(`分段：${JSON.stringify(report.segments)}（**不作判定**，性能实测见 150 §1.7 记债）`)
  say(`part types：${JSON.stringify([...new Set(partTypes)])}`)
  say(`loop steps：${JSON.stringify(loopSteps)}`)
  for (const line of streamLines) say(`  ${line.slice(0, 200)}`)
  say(`落笔后文件：${JSON.stringify(fileAfter)}`)
  say('=== 证据完 ===')

  // ── 判据一：只唤起改写 agent ──────────────────────────────────────────
  // `agent=title` 会另有一次（引擎拿 small model 给会话取名，不是 markup 这一发），
  // 所以判的是 rewrite 恰好一次 + build 一次都没有，**不是**「只有一条 stream 行」。
  expect(streamLines.filter((line) => /agent=rewrite/.test(line)).length, 'rewrite 不是恰好一发').toBe(1)
  expect(streamLines.some((line) => /agent=build/.test(line)), 'markup 落到了 build agent').toBe(false)

  // ── 判据二：没进 agentic loop、没动工具 ───────────────────────────────
  // **不判「日志里有没有 shell tool / ripgrep 字样」**：那是引擎起来时的工具注册与
  // 二进制预置，跟这一发用没用工具无关，拿它当判据必然误伤（150 §1.9 回流 7）。
  expect(loopSteps.filter((step) => step > 1), 'step>1 说明又转了一圈：进 agentic loop 了').toEqual([])
  expect(partTypes.includes('tool'), '动了工具——permission 全 deny 没生效').toBe(false)

  // ── 判据三：隔离没破、目录没跑偏 ──────────────────────────────────────
  expect(/\.claude|\.agents/.test(log), '引擎读到了 ~/.claude / ~/.agents').toBe(false)
  // macOS 的 /var 是 /private/var 的符号链接，引擎打的是解析后的真路径
  const realHome = await realpath(home)
  expect(log.includes(`directory=${realHome}`), `session 没绑在 book 目录（${realHome}）`).toBe(true)

  // ── 判据四：六点齐、顺序对；正文只动该动的那一段 ──────────────────────
  expect(Object.keys(report.timeline).toSorted()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5'])
  expect(report.complete).toBe(true)
  expect(report.ordered).toBe(true)
  expect(fileAfter.startsWith(`${FIRST}\n\n`), '首段被动过').toBe(true)
  expect(fileAfter.endsWith(`\n\n${THIRD}\n`), '尾段被动过').toBe(true)

  await app.close()
})
