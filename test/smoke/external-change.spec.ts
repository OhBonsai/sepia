import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// Stage 6a 的 DoD（170）：**纸与外部世界的和平共处**。
// 六条检查对着六种出事方式，其中「有脏 → 先落盘」按不变量级心态对待——
// 它守的是"用户刚敲的字不许被外部覆盖"。
//
// 为什么这些必须在 smoke：判定的单测在 core、事件的单测在 app，
// 但**「整条链真的通了」只有真应用能回答**——桥没接、hook 没订阅、横条没渲染，
// 任何一节断开都是单测全绿而功能全废。

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const run = promisify(execFile)

const LINES = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行 —— 原始正文。`)
const BODY = `${LINES.join('\n')}\n`

async function seed(body = BODY, name = 'page.md'): Promise<{ home: string; page: string }> {
  const home = await mkdtemp(join(tmpdir(), 'sepia-6a-'))
  const page = join(home, name)
  await writeFile(page, body, 'utf8')
  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 1, page, cursor: 0, scrollTop: 0 }),
    'utf8',
  )
  return { home, page }
}

async function launch(
  home: string,
  extraEnv: Record<string, string> = {},
  args: string[] = LAUNCH_ARGS,
): Promise<ElectronApplication> {
  return electron.launch({
    args,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      // **单实例锁按 userData 定，而它不跟 HOME 走**（macOS 上 app.getPath 无视 $HOME）。
      // 不隔离它的话，另一条并行线的 smoke 一开着，这里的每次 launch 都抢不到锁、
      // 直接 quit——一扇窗都不开，报出来是 firstWindow 超时（170 §1.9 实测）。
      SEPIA_TEST_USER_DATA: join(home, 'electron-user-data'),
      ...extraEnv,
    },
  })
}

/** 等 CM6 就位，且 watcher 的初次扫描完成（挂载在 `file/read` 之后异步发生）。 */
async function ready(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow()
  await window.waitForSelector('.cm-content')
  // chokidar 的初次扫描本地实测 ~60ms。**不等就动文件的话事件压根不会来**——
  // 这个坑在 watcher 单测里踩过一次（那边的解法是 watchPage 里 await ready）。
  await window.waitForTimeout(1_200)
  return window
}

const docText = (window: Page): Promise<string> =>
  window.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')

/** 光标位置的可判读代理：敲一个记号，看它落在第几行。比读 DOM selection 稳。 */
async function markerLine(window: Page, marker: string): Promise<number> {
  await window.keyboard.type(marker)
  return window.evaluate((needle: string) => {
    const lines = [...document.querySelectorAll('.cm-line')]
    return lines.findIndex((line) => (line.textContent ?? '').includes(needle))
  }, marker)
}

test('检查 4 · 外部改（无脏）→ 自动重载，且光标不被打回文首', async () => {
  const { home, page } = await seed()
  const app = await launch(home)
  const window = await ready(app)

  // 把光标放到第 20 行（不是文首，否则这条用例测不出"保光标"）
  await window.locator('.cm-line').nth(19).click()

  // 外部（vim / VS Code 的位置）改写整篇
  await writeFile(page, BODY.replace(/原始正文/g, '外部改过的正文'), 'utf8')

  await expect.poll(() => docText(window), { timeout: 8_000 }).toContain('外部改过的正文')

  // 无脏重载是静默的——这种事不该弹横条打断写作（170 §1.2）
  expect(await window.locator('.sepia-conflict-line').count()).toBe(0)

  const line = await markerLine(window, '★')
  expect(line, '重载后光标回到了文首——"尽量保光标"没兑现').toBeGreaterThan(10)

  await app.close()
})

test('检查 5 · 外部改（有脏）→ 先落盘 + 横条，零字节丢失', async () => {
  const { home, page } = await seed()
  const app = await launch(home)
  const window = await ready(app)

  // 用户敲了字，还没保存
  await window.locator('.cm-line').first().click()
  await window.keyboard.type('【我刚敲的字】')
  expect(await docText(window)).toContain('【我刚敲的字】')

  // 就在这时外部改了同一个文件
  await writeFile(page, '外部把整篇换掉了\n', 'utf8')

  // 断言的是**磁盘**：用户的字必须已经落盘（架构 §4.9「先立即落盘」）
  await expect
    .poll(async () => (await readFile(page, 'utf8')).includes('【我刚敲的字】'), { timeout: 8_000 })
    .toBe(true)

  // 纸上的字一个没少，也没被外部版本顶掉
  const text = await docText(window)
  expect(text).toContain('【我刚敲的字】')
  expect(text, '有脏时被外部版本覆盖了——这正是不许发生的那件事').not.toContain('外部把整篇换掉了')

  // 横条必须出现且常驻：静默地"帮你存了"等于没告知
  const banner = window.locator('.sepia-conflict-line[data-sepia-conflict="saved"]')
  await expect(banner).toBeVisible()
  await window.waitForTimeout(1_500)
  await expect(banner, '涉及用户字节的横条不许自己溜走').toBeVisible()

  await app.close()
})

test('检查 6 · 自写不自扰：⌘S 之后零重载（撤销历史必须还在）', async () => {
  const { home } = await seed()
  const app = await launch(home)
  const window = await ready(app)

  await window.locator('.cm-line').first().click()
  await window.keyboard.type('【自己写的】')
  await window.keyboard.press('ControlOrMeta+s')
  await window.waitForTimeout(2_500)

  expect(await window.locator('.sepia-conflict-line').count()).toBe(0)
  expect(await docText(window)).toContain('【自己写的】')

  // **判据是撤销历史，不是横条**。第一版这条只断言"没有横条"，而回声抑制被拿掉时
  // 走的是「无脏 → 静默重载」那条路：没有横条，用例照样绿——**空转**（首轮 RV 抓到，
  // 170 §1.5 记为 dead check）。重载会重建 EditorView，撤销历史随之消失；
  // 所以「⌘Z 能把刚敲的字撤掉」才是"纸没有被自己重载过"的可判读证据。
  await window.keyboard.press('ControlOrMeta+z')
  await expect
    .poll(() => docText(window), { timeout: 3_000 })
    .not.toContain('【自己写的】')

  await app.close()
})

test('外部把文件改短、session 里的光标越界 → 仍可写不崩（光标夹取）', async () => {
  // 场景是真的：应用关着的时候外部把文件截短了，session.json 里的光标已越界。
  // CM6 的 `EditorState.create` 对越界 anchor 直接抛 RangeError——夹取不做就是白屏。
  const { home, page } = await seed()
  await writeFile(join(home, '.sepia', 'session.json'), JSON.stringify({ version: 1, page, cursor: 999_999, scrollTop: 0 }), 'utf8')

  const app = await launch(home)
  const window = await ready(app)

  expect(await docText(window)).toContain('原始正文')
  await window.keyboard.type('【越界之后照样能写】')
  expect(await docText(window)).toContain('【越界之后照样能写】')

  await app.close()
})

/**
 * 一次性卷：**为了能真的看见回收站里那个文件**。
 *
 * macOS 的回收站按卷定，而两条现成的路都走不通（本 stage 实测）：
 *   - 文件在临时目录（根卷）→ 进 `/.Trashes/<uid>`，root 所有，读不到；
 *   - 文件在真实 HOME → 进 `~/.Trash`，而 TCC 挡住测试进程读它
 *     （`ls ~/.Trash` = Operation not permitted），Electron 的 evaluate 上下文
 *     又没法 import fs 去替我们看。
 * 都验不了的话这条检查就退化成"原路径没了"——**unlink 也满足它，等于空转**。
 * 挂一个自己的卷，它的 `.Trashes/<uid>` 归当前用户、读得到，且完全不碰用户的回收站。
 */
async function scratchVolume(): Promise<{ dir: string; trash: string; dispose: () => Promise<void> } | null> {
  if (process.platform !== 'darwin') return null
  const name = `SepiaSmoke${Math.random().toString(36).slice(2, 8)}`
  const image = join(tmpdir(), `${name}.dmg`)
  try {
    await run('hdiutil', ['create', '-size', '16m', '-fs', 'HFS+', '-volname', name, '-quiet', image])
    await run('hdiutil', ['attach', image, '-quiet'])
  } catch {
    return null
  }
  const dir = `/Volumes/${name}`
  return {
    dir,
    trash: join(dir, '.Trashes', String(process.getuid?.() ?? 0)),
    dispose: async () => {
      await run('hdiutil', ['detach', dir, '-quiet']).catch(() => undefined)
      await rm(image, { force: true })
    },
  }
}

test('检查 7 · 删除进系统回收站，不是 unlink', async () => {
  const scratch = await scratchVolume()
  // **卸载必须在 finally 里**：用例红的时候（反向验证时它就该红）也得把卷卸掉，
  // 否则 /Volumes 下会积一串挂着的 SepiaSmokeXXXX——RV 第一轮就积了一个。
  try {
    await trashCase(scratch)
  } finally {
    await scratch?.dispose()
  }
})

async function trashCase(scratch: Awaited<ReturnType<typeof scratchVolume>>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'sepia-6a-trash-'))
  await mkdir(join(home, '.sepia'), { recursive: true })

  // 非 macOS（CI 的 Linux runner）：trashItem 走 XDG，落在**假 HOME** 之下，读得到
  const base = scratch?.dir ?? home
  const trashDir = scratch?.trash ?? join(home, '.local', 'share', 'Trash', 'files')
  const target = join(base, 'to-be-trashed.md')
  await writeFile(target, '要被删掉的纸\n', 'utf8')
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 1, page: target, cursor: 0, scrollTop: 0 }),
    'utf8',
  )

  const app = await launch(home)
  const window = await ready(app)

  // 走**真实的桥**（preload → ipc → services/files → shell.trashItem）。
  // 命令层（registry → api）由 renderer 单测盯，这里盯的是"字节真的进了回收站"。
  const result = await window.evaluate(
    async (path: string) =>
      (globalThis as unknown as { api: { files: { trash(p: string): Promise<unknown> } } }).api.files.trash(path),
    target,
  )
  expect(result).toEqual({ ok: true, value: undefined })

  await expect
    .poll(async () => (await readdir(trashDir).catch(() => [] as string[])).includes('to-be-trashed.md'), {
      timeout: 8_000,
    })
    .toBe(true)
  // 原路径同时必须空了——回收站里有、原处还在，那是复制不是删除
  expect(await readdir(base)).not.toContain('to-be-trashed.md')

  await app.close()
}

test('检查 8 · 游离 page：argv 打开非 book 的 .md → 可写可存', async () => {
  // 位置刻意不在任何 git repo 里（T-30 的降级语义）
  const home = await mkdtemp(join(tmpdir(), 'sepia-6a-loose-'))
  const loose = join(home, 'loose.md')
  await writeFile(loose, '游离的纸\n', 'utf8')

  const app = await launch(home, {}, [...LAUNCH_ARGS, loose])
  const window = await ready(app)

  expect(await docText(window), 'argv 传进来的 page 没被打开').toContain('游离的纸')

  await window.locator('.cm-line').first().click()
  await window.keyboard.type('【游离也能写】')
  await window.keyboard.press('ControlOrMeta+s')
  await expect
    .poll(async () => (await readFile(loose, 'utf8')).includes('【游离也能写】'), { timeout: 8_000 })
    .toBe(true)

  // 无 book 时不许自作主张造一个（纪律 11 的对偶）
  expect(await readdir(home)).not.toContain('.git')

  await app.close()
})

test('检查 9 · watcher 失效降级：focus 对账仍抓到外部变更', async () => {
  const { home, page } = await seed()
  // 模拟网络盘 / inotify 限额撞满：watcher 一上来就瞎，从此只剩 focus 对账
  const app = await launch(home, { SEPIA_WATCHER_FORCE_DEGRADE: '1' })
  const window = await ready(app)

  // 降级要一次性告知（架构 §4.9），否则用户不知道"从此靠切窗口校准"
  await expect(window.locator('.sepia-conflict-line[data-sepia-conflict="degraded"]')).toBeVisible()

  await writeFile(page, '降级期间被外部改过\n', 'utf8')
  await window.waitForTimeout(1_000)
  expect(await docText(window), '事件这条路本该是瞎的').not.toContain('降级期间被外部改过')

  await app.evaluate(({ BrowserWindow }) => {
    const [target] = BrowserWindow.getAllWindows()
    target?.blur()
    target?.focus()
  })

  await expect.poll(() => docText(window), { timeout: 8_000 }).toContain('降级期间被外部改过')

  await app.close()
})

test('外部删除当前 page → 横条 + 转游离态，内容留在纸上', async () => {
  const { home, page } = await seed()
  const app = await launch(home)
  const window = await ready(app)

  await unlink(page)

  await expect(window.locator('.sepia-conflict-line[data-sepia-conflict="removed"]')).toBeVisible({
    timeout: 8_000,
  })
  // 内容不许跟着文件一起消失——它是用户的字，⌘S 可另存回去
  expect(await docText(window)).toContain('原始正文')
  // 而且**不许出现"打不开这个文件"**：外部删除是一种状态，不是一次打开失败。
  // 首轮 RV 抓到的：把 detach 当 reload 处理时，重载会去读一个已经不在的文件、
  // 报 open 失败——横条与内容都还在，用例照样绿。加上这一条它才红（170 §1.5）。
  expect(await window.locator('.sepia-error').count(), 'detach 被当成重载了').toBe(0)

  await window.locator('.cm-line').first().click()
  await window.keyboard.press('ControlOrMeta+s')
  await expect
    .poll(async () => (await readFile(page, 'utf8').catch(() => '')).includes('原始正文'), { timeout: 8_000 })
    .toBe(true)

  await app.close()
})

test('外部把文件移走 = 删除：横条报 removed（unlink + add 的歧义不许误判成改动）', async () => {
  const { home, page } = await seed()
  const app = await launch(home)
  const window = await ready(app)

  await rename(page, join(home, 'moved-away.md'))

  await expect(window.locator('.sepia-conflict-line[data-sepia-conflict="removed"]')).toBeVisible({
    timeout: 8_000,
  })

  await app.close()
})
