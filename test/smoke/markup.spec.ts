import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 150 §1.4 #9 / #10 / #11：markup 全链、生成中编辑→落笔中止、interrupt。
//
// **引擎用桩，不用真模型**（001 §6：真 key 真模型手跑不进 CI）。桩打在
// `window.api.agent` 上——那是 renderer 看得见的全部 agent 面，桩住它就等于
// 桩住了整条下游，而 ⌘K 到落笔之间的一切（组装、揭示、diff、CAS、打点）
// 全都还是真代码在跑。

test.setTimeout(120_000)

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const FIRST = '第一段。'
const TARGET = '这里是要改的那一段。'
const THIRD = '第三段。'
const PAGE_BODY = `${FIRST}\n\n${TARGET}\n\n${THIRD}\n`
const REVISED = '这段已经被改写过了。'
const SLOW_REVISED = '慢慢地一个字一个字往外写的很长的一段回答，长到足够按下停止。'

interface Harness {
  app: ElectronApplication
  window: Page
  pagePath: string
}

async function launch(): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'sepia-markup-'))
  const pagePath = join(home, 'note.md')
  await writeFile(pagePath, PAGE_BODY, 'utf8')

  // 经 session.json 指定要打开的 page（与其它 smoke 同一套装置）。
  // 走 argv 也能开，但那条路还要过 queuePaths 的时序，测的东西就不纯了。
  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 1, page: pagePath, cursor: 0, scrollTop: 0 }),
    'utf8',
  )

  const app = await electron.launch({
    args: LAUNCH_ARGS,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  })
  const window = await app.firstWindow()
  await window.waitForSelector('.cm-content', { timeout: 30_000 })
  return { app, window, pagePath }
}

/**
 * 等真引擎就绪。
 *
 * **状态那条路不桩**：App 在挂载时就订阅了真的 `onStatusChange`，事后替换方法
 * 影响不到已经注册进去的回调。与其想办法伪造状态，不如让引擎真的起来——
 * 反正它本来就会起（engine-absent.spec 实测 fork→ready 约 2.3s），
 * 而这样测到的「⌘K 在引擎就绪时才开浮层」也是真的那一条路。
 */
async function waitForEngineReady(window: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        window.evaluate(async () =>
          (globalThis as unknown as { api: { agent: { status(): Promise<string> } } }).api.agent.status(),
        ),
      { timeout: 60_000, intervals: [250] },
    )
    .toBe('ready')
}

/**
 * 桩打在 **main 侧的 ipcMain handler** 上，不打在 renderer。
 *
 * 试过打 renderer，不行——`contextBridge.exposeInMainWorld` 交出去的对象是**冻结**的，
 * `window.api.agent.send = …` 静默失效（赋值不报错，但值没变），桩形同虚设。
 * 打在 handler 上反而更好：preload、IPC、renderer 侧封装**全都还是真的在跑**，
 * 被替换的只有「引擎会回什么」这一件事。
 */
async function stubEngine(app: ElectronApplication, options: { hang?: boolean } = {}): Promise<void> {
  await app.evaluate(async ({ ipcMain, BrowserWindow }, opts) => {
    for (const channel of ['agent/open-thread', 'agent/send', 'agent/interrupt']) {
      ipcMain.removeHandler(channel)
    }
    const push = (event: unknown): void => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agent/event', event)
    }
    ipcMain.handle('agent/open-thread', async () => ({ ok: true, value: { id: 'stub-thread' } }))
    ipcMain.handle('agent/interrupt', async () => {
      push({ type: 'stub.interrupted', properties: {} })
      ;(globalThis as unknown as { sepiaInterrupted: boolean }).sepiaInterrupted = true
      return { ok: true, value: undefined }
    })
    ipcMain.handle('agent/send', async () => {
      // 一个字一个字地推，逼真到能看出揭示是不是单调、批次是不是在工作
      const target = opts.revised
      let at = 0
      const tick = (): void => {
        at += 2
        push({ type: 'message.part.delta', properties: { part: { type: 'text', text: target.slice(0, at) } } })
        if (at < target.length) setTimeout(tick, 10)
        else if (!opts.hang) push({ type: 'message.completed', properties: {} })
      }
      setTimeout(tick, 10)
      return { ok: true, value: undefined }
    })
  }, { hang: options.hang ?? false, revised: options.hang === true ? SLOW_REVISED : REVISED })
}

async function interrupted(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(async () => (globalThis as unknown as { sepiaInterrupted?: boolean }).sepiaInterrupted === true)
}

/** 选中目标段落，然后 ⌘K。 */
async function selectAndSummon(window: Page, text: string): Promise<void> {
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
  }, text)
  await window.keyboard.press('Meta+k')
}

test('#9 markup 全链：⌘K → 动词 → 流式 → diff → 落笔 → 文件里读得到新字', async () => {
  const { app, window, pagePath } = await launch()
  await waitForEngineReady(window)
  await stubEngine(app)

  await selectAndSummon(window, TARGET)

  // 唤起阶段：一行输入 + 动词列（W6）
  const panel = window.locator('.sepia-markup')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-sepia-markup', 'compose')
  await expect(window.locator('.sepia-markup-verbs button')).not.toHaveCount(0)

  // 点动词 → 家具立刻换成生成中（不等首 token）
  await window.locator('.sepia-markup-verbs button', { hasText: '润色' }).click()
  await expect(panel).toHaveAttribute('data-sepia-markup', 'generating')

  // 出结果：diff 两侧都在
  await expect(panel).toHaveAttribute('data-sepia-markup', 'result', { timeout: 30_000 })
  await expect(window.locator('[data-sepia-diff="delete"]').first()).toBeVisible()
  await expect(window.locator('[data-sepia-diff="insert"]').first()).toBeVisible()

  // 落笔 → 浮层收起、文件里读得到新字，且未触及的段落逐字节原样
  await window.locator('.sepia-markup-actions button', { hasText: '落笔' }).click()
  await expect(panel).toHaveCount(0)
  await expect
    .poll(async () => readFile(pagePath, 'utf8'), { timeout: 15_000 })
    .toBe(`${FIRST}\n\n${REVISED}\n\n${THIRD}\n`)

  // 六点打点：**齐、且在同一条时间轴上、且顺序单调**（纪律 22 / DoD 四）。
  // 这段断言不是补充，是 #9 的一半——没有它，吞掉一个打点这条 smoke 照样绿
  // （首轮反向验证实测如此，正是它逼出了「m5 必须用同一个 run」那个修复）。
  const raw = await window.locator('.sepia-shell').getAttribute('data-sepia-markup-report')
  expect(raw).not.toBeNull()
  const report = JSON.parse(raw ?? '{}') as {
    complete: boolean
    ordered: boolean
    withinBudget: boolean | null
    timeline: Record<string, number>
  }
  expect(Object.keys(report.timeline).toSorted()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5'])
  expect(report.complete).toBe(true)
  expect(report.ordered).toBe(true)
  expect(report.withinBudget).toBe(true)

  await app.close()
})

test('#10 生成中编辑正文 → 落笔中止而非覆盖（DoD 二）', async () => {
  const { app, window, pagePath } = await launch()
  await waitForEngineReady(window)
  await stubEngine(app)

  await selectAndSummon(window, TARGET)
  await window.locator('.sepia-markup-verbs button', { hasText: '润色' }).click()
  await expect(window.locator('.sepia-markup')).toHaveAttribute('data-sepia-markup', 'result', {
    timeout: 30_000,
  })

  // 生成完、还没落笔——此时用户回到纸上改了**选区之内**的字
  await window.locator('.cm-content').click()
  await window.evaluate(() => {
    const content = document.querySelector('.cm-content')
    const walker = document.createTreeWalker(content!, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode()) !== null) {
      if (!node.textContent?.includes('要改的')) continue
      const range = document.createRange()
      range.setStart(node, node.textContent.indexOf('要改的'))
      range.setEnd(node, node.textContent.indexOf('要改的') + 3)
      const selection = globalThis.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
  })
  await window.keyboard.type('被用户改了')

  await window.locator('.sepia-markup-actions button', { hasText: '落笔' }).click()

  // CAS 挡住：提示可见，且纸上**没有**出现模型那句话
  await expect(window.locator('.sepia-error')).toBeVisible()
  await window.keyboard.press('Meta+s')
  await expect
    .poll(async () => readFile(pagePath, 'utf8'), { timeout: 15_000 })
    .not.toContain(REVISED)

  await app.close()
})

test('#11 interrupt：停止后流断、纸面不变', async () => {
  const { app, window, pagePath } = await launch()
  await waitForEngineReady(window)
  await stubEngine(app, { hang: true })

  await selectAndSummon(window, TARGET)
  await window.locator('.sepia-markup-verbs button', { hasText: '润色' }).click()
  await expect(window.locator('.sepia-markup')).toHaveAttribute('data-sepia-markup', 'generating')

  await window.locator('.sepia-markup-stream button', { hasText: '停止' }).click()

  // interrupt 透传到了桥
  await expect.poll(async () => interrupted(app)).toBe(true)

  // 纸面一个字节没动
  expect(await readFile(pagePath, 'utf8')).toBe(PAGE_BODY)

  await app.close()
})
