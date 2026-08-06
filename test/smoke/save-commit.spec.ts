import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 160 §1.5 #7–#10：写盘时间线与 commit 时间线的端到端。
//
// **不桩 git**：#7 要证的是"真的产生了一个带 trailer 的 commit"，桩掉 git 就等于
// 把要证的东西假设掉了（002 §6.2 的元规则）。

const run = promisify(execFile)
const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const BODY = '第一段。\n\n第二段。\n'
/** 静默 commit 的阈值调到 1.2s，定时兜底调到 90s——smoke 等不起默认的 8s/5min。 */
const IDLE_MS = 1_200

interface Harness {
  app: ElectronApplication
  win: Page
  book: string
  page: string
}

// 失败的用例也必须把应用关掉：**单实例锁**在 Sepia 是真的（T-29），
// 漏一个没关的实例，后面每一条 smoke 都会在启动时被顶掉（实测就是这么连红 4 条的）。
const launched: ElectronApplication[] = []
test.afterEach(async () => {
  await Promise.all(launched.splice(0).map((app) => app.close().catch(() => undefined)))
})

async function boot(options: { git?: boolean; readonly?: boolean } = {}): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'sepia-save-'))
  const book = join(home, 'book')
  await mkdir(book, { recursive: true })
  const page = join(book, 'note.md')
  await writeFile(page, BODY, 'utf8')

  if (options.git !== false) {
    await run('git', ['init', '-q', '-b', 'main'], { cwd: book })
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: book })
    await run('git', ['config', 'user.name', 'Sepia Test'], { cwd: book })
    await run('git', ['add', '-A'], { cwd: book })
    await run('git', ['commit', '-q', '-m', 'base'], { cwd: book })
  }

  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 1, page, cursor: 0, scrollTop: 0 }),
    'utf8',
  )
  // 自动写盘 400ms、静默 commit 1.2s：都远小于默认值，否则一条 smoke 要跑 5 分钟
  await writeFile(
    join(home, '.sepia', 'config.json'),
    JSON.stringify({ version: 1, autosaveDebounceMs: 400, commitIdleMs: IDLE_MS, commitIntervalMs: 90_000 }),
    'utf8',
  )
  if (options.readonly === true) await chmod(book, 0o555)

  const app = await electron.launch({
    args: LAUNCH_ARGS,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      // 单实例锁按 Electron 的 userData 定，而它**不跟 $HOME 走**（macOS 上 app.getPath
      // 无视 $HOME）。不隔离它，两条线并行跑 smoke 时后启动的应用会抢不到锁直接 quit，
      // 一扇窗都不开（170 §1.8 风险 5 实测）。其余五个 smoke 文件同此。
      SEPIA_TEST_USER_DATA: join(home, 'electron-user-data'),
    },
  })
  launched.push(app)
  const win = await app.firstWindow()
  await win.waitForSelector('.cm-content')
  await win.waitForTimeout(300)
  return { app, win, book, page }
}

async function type(win: Page, text: string): Promise<void> {
  await win.locator('.cm-content').click()
  await win.keyboard.press('End')
  await win.keyboard.type(text)
}

/**
 * 截图里有多少个「危险色」像素落在右下角区域。
 *
 * **为什么非得数像素**（真人轮的教训，160 §1.9 条目 7）：
 *   · `toBeVisible()` 只看盒子非空 + `visibility`——**被别的元素盖住它一概看不见**，
 *     警示点整个藏在编辑器底下时这条断言照样绿；
 *   · `elementFromPoint` 对 `pointer-events: none` 的元素恒返回它下面那层，
 *     加不加 z-index 都报"被盖住"，拿它当判据会把人带沟里（实测被带过一次）。
 * 解码交给 Chromium 自己（base64 → Image → canvas → getImageData），不引任何图像库。
 */
async function dangerPixelsBottomRight(win: Page): Promise<number> {
  const shot = (await win.screenshot()).toString('base64')
  return win.evaluate(async (data: string) => {
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.addEventListener('load', resolve)
      img.addEventListener('error', reject)
      img.src = `data:image/png;base64,${data}`
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (ctx === null) return -1
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let hits = 0
    for (let i = 0; i < px.length; i += 4) {
      // --sepia-danger 实测为 rgb(209,77,65)；容差 16 吃掉圆角抗锯齿
      if (Math.abs(px[i]! - 209) > 16 || Math.abs(px[i + 1]! - 77) > 16 || Math.abs(px[i + 2]! - 65) > 16) continue
      const index = i / 4
      if (index % canvas.width > canvas.width * 0.9 && Math.floor(index / canvas.width) > canvas.height * 0.9) hits++
    }
    return hits
  }, shot)
}

async function messages(book: string): Promise<string[]> {
  const { stdout } = await run('git', ['log', '--format=%B%x00'], { cwd: book })
  return stdout
    .split('\0')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

/**
 * 证据截图。**默认不写**——只有 `SEPIA_EVIDENCE=1` 时才落到 `specs/plan/evidence/`。
 *
 * 为什么要这道闸（5b 真人轮的旗子二）：这些 png 进了仓库，而 smoke 每跑一次就
 * 重截一次、字节必然不同。于是"跑一遍测试"这个只读动作会**静默改写别的 stage 的
 * 证据文件**，再被随手 `git add -A` 卷进无关的提交——本分支就把 Stage 2 的
 * `a1-full-syntax.png` 这么带进来过。
 * 证据是**留档**，该在人明确要留档时才产生；平时跑测试不该动它一个字节。
 */
async function evidence(win: Page, path: string): Promise<void> {
  if (process.env['SEPIA_EVIDENCE'] !== '1') return
  await win.screenshot({ path, fullPage: false })
}

test('#7 写字 → 800ms 自动落盘 → 静默 commit 产生且带 trailer', async () => {
  const { app, win, book, page } = await boot()
  await type(win, '自动保存的新字。')

  // 一、防抖到点就落盘——**没按 ⌘S**
  await expect
    .poll(async () => readFile(page, 'utf8'), { timeout: 10_000 })
    .toContain('自动保存的新字。')

  // 二、静默够久 → 出现一个 sepia: save，且 trailer 带 page
  await expect.poll(async () => (await messages(book)).length, { timeout: 20_000 }).toBeGreaterThan(1)
  const log = await messages(book)
  expect(log[0]).toContain('sepia: save')
  // trailer 里必须是**相对 repo 根**的路径——绝对路径会把用户的家目录名字留进 git 历史
  expect(log[0]).toContain('Sepia-Page: note.md')
  expect(log[0], '绝对路径进了 commit').not.toContain(book)

  // 三、**个位数 commit**：一次写作不该刷屏（DoD_a 的「个位数」）
  expect(log.length).toBeLessThan(10)

  await app.close()
})

test('#7b 没有新改动就不再产生 commit（不刷空 commit）', async () => {
  const { app, win, book } = await boot()
  await type(win, '一句话。')
  await expect.poll(async () => (await messages(book)).length, { timeout: 20_000 }).toBeGreaterThan(1)
  const after = (await messages(book)).length
  // 什么都不做，等过两个静默窗口
  await win.waitForTimeout(IDLE_MS * 2 + 1_000)
  expect(await messages(book), '没有新改动却又提交了 = 空 commit').toHaveLength(after)
  await app.close()
})

test('#8 写盘失败 → 纸角警示点**在屏幕上真的看得见**，恢复即消', async () => {
  const { app, win, book } = await boot({ readonly: true })
  // 亮起之前：右下角一个危险色像素都没有（基线，防止"本来就红"的假绿）
  expect(await dangerPixelsBottomRight(win), '还没失败，右下角就已经有红点了？').toBe(0)

  await type(win, '写不进去的字。')
  // 目录只读 → 原子写的 rename 失败 → 警示点亮起
  await expect(win.locator('[data-sepia-save-warning="on"]')).toBeVisible({ timeout: 10_000 })

  // **判据是像素**：属性在、盒子在，都不等于用户看得见（真人轮实测：点被编辑器
  // 整个盖住，属性断言照样绿）。预定破坏：CSS 去掉 z-index / width 改 0 /
  // 去掉 background —— 属性与盒子都还在，这一条必红。
  await expect
    .poll(async () => dangerPixelsBottomRight(win), { timeout: 10_000 })
    .toBeGreaterThan(20)
  // 证据留档：真人轮看到的那一幕，修好之后长什么样（160 §1.9 条目 7）
  await evidence(win, 'specs/plan/evidence/160/save-warning-visible.png')

  // 恢复权限后再写一次 → 点消失（"恢复即消"），且屏幕上也真的没了
  await chmod(book, 0o755)
  await type(win, '现在能写了。')
  await expect(win.locator('[data-sepia-save-warning="on"]')).toHaveCount(0, { timeout: 10_000 })
  await expect.poll(async () => dangerPixelsBottomRight(win), { timeout: 10_000 }).toBe(0)
  await app.close()
})

test('#9 IME 组合期间不写盘：盘上不出现拼音', async () => {
  const { app, win, page } = await boot()
  await win.locator('.cm-content').click()
  await win.keyboard.press('End')

  // CDP 真组合管线（合成 CompositionEvent 设不动 view.composing，130 §1.8 风险 4 实测）
  const cdp = await win.context().newCDPSession(win)
  await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 })
  // 等足两个防抖窗口——**挂起若没生效，这段时间足够写好几次**
  await win.waitForTimeout(1_500)

  const probe = await win.evaluate(
    () => (globalThis as unknown as { __sepiaAutosave?: { suspended: boolean } }).__sepiaAutosave,
  )
  expect(probe?.suspended, '组合期间计时必须处于挂起态').toBe(true)
  expect(await readFile(page, 'utf8'), '盘上出现了拼音——组合期间写盘了').not.toContain('nihao')

  // 提交组合 → 防抖恢复 → 最终文本才落盘
  await cdp.send('Input.insertText', { text: '你好' })
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 10_000 }).toContain('你好')
  await app.close()
})

test('#10 组合中途失焦：自动写盘不会从此静默停摆', async () => {
  const { app, win, page } = await boot()
  await win.locator('.cm-content').click()
  await win.keyboard.press('End')

  const cdp = await win.context().newCDPSession(win)
  await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 })
  // 组合中途切走窗口：compositionend 未必来，只有 blur。
  // **只认 compositionend 的话，计时从此永久挂起**——这条 smoke 盯的正是那个事故。
  await win.evaluate(() => globalThis.dispatchEvent(new Event('blur')))
  await win.waitForTimeout(300)
  const probe = await win.evaluate(
    () => (globalThis as unknown as { __sepiaAutosave?: { suspended: boolean } }).__sepiaAutosave,
  )
  expect(probe?.suspended, 'blur 之后必须已解挂').toBe(false)

  // 解挂之后照常打字，照常落盘
  await cdp.send('Input.insertText', { text: '你好' })
  await type(win, '失焦之后写的字。')
  await expect
    .poll(async () => readFile(page, 'utf8'), { timeout: 10_000 })
    .toContain('失焦之后写的字。')
  await app.close()
})

test('#6b 非 git 目录：照常写盘，零 git 调用、零警示', async () => {
  const { app, win, book, page } = await boot({ git: false })
  await type(win, '没有版本也照样写。')
  await expect
    .poll(async () => readFile(page, 'utf8'), { timeout: 10_000 })
    .toContain('没有版本也照样写。')
  // 不许自作主张 git init——book 是用户的目录
  expect(await readFile(join(book, '.git', 'HEAD'), 'utf8').catch(() => null)).toBeNull()
  await expect(win.locator('[data-sepia-save-warning="on"]')).toHaveCount(0)
  await app.close()
})
