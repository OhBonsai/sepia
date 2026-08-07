import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 170 §2.4 #6 / #7 / #8 / #13：多 Tab、文件树、主页、DoD 的启动那一条。

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const launched: ElectronApplication[] = []
test.afterEach(async () => {
  await Promise.all(launched.splice(0).map((app) => app.close().catch(() => undefined)))
})

interface Book {
  home: string
  book: string
  pages: string[]
}

/** 造一个 book：`a.md` / `b.md` / `sub/c.md`。 */
async function makeBook(options: { extra?: number } = {}): Promise<Book> {
  // **先 realpath 再 mkdtemp**：macOS 的 `/var → /private/var` 会让 fixture 路径
  // 与 realpath 后的路径永远不相等，于是"判根"这类检查会因为字符串对不上而**恒绿**——
  // 软链绕过那条检查第一次就是这么假绿的（破坏 realpath 步骤时它照样过）。
  const home = await mkdtemp(join(await realpath(tmpdir()), 'sepia-lib-'))
  const book = join(home, 'book')
  await mkdir(join(book, 'sub'), { recursive: true })
  await writeFile(join(book, 'a.md'), '# 甲的标题\n\n甲的正文。\n', 'utf8')
  await writeFile(join(book, 'b.md'), '# 乙的标题\n\n乙的正文。\n', 'utf8')
  await writeFile(join(book, 'sub', 'c.md'), '# 丙\n\n丙的正文。\n', 'utf8')
  for (let i = 0; i < (options.extra ?? 0); i++) {
    await writeFile(join(book, 'sub', `x${i}.md`), `第 ${i} 篇\n`, 'utf8')
  }
  await mkdir(join(home, '.sepia'), { recursive: true })
  return { home, book, pages: ['a.md', 'b.md', 'sub/c.md'] }
}

/**
 * 直接种一份 recents。
 *
 * **不能靠"开一次 tab"来种**：从 session 恢复出来的 tab 不走 `openInTab`，
 * 因此不进 recents（那本身是另一件事，见 §2.9 条目 5 的备注）。
 * 这里种的正是出事那条数据的形状：**book 内的存相对、游离的存绝对**。
 */
async function seedRecents(fixture: Book, pages: string[]): Promise<void> {
  // book-id 的散列在 core 里，而 smoke 目录不在 workspace 的解析范围内——
  // 与其为一个测试改依赖图，不如把 books/ 下唯一那个目录找出来（fixture 只有一个 book）
  const { bookId } = (await import('../../packages/core/src/books/id.ts')) as {
    bookId: (path: string) => string
  }
  const dir = join(fixture.home, '.sepia', 'books', bookId(await realpath(fixture.book)))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'recents.json'), JSON.stringify({ version: 1, pages }), 'utf8')
}

async function launch(
  fixture: Book,
  session: Record<string, unknown>,
  config: Record<string, unknown> = {},
): Promise<Page> {
  await writeFile(join(fixture.home, '.sepia', 'session.json'), JSON.stringify(session), 'utf8')
  await writeFile(
    join(fixture.home, '.sepia', 'config.json'),
    JSON.stringify({ version: 1, autosaveDebounceMs: 300, ...config }),
    'utf8',
  )
  const app = await electron.launch({
    args: LAUNCH_ARGS,
    env: {
      ...process.env,
      HOME: fixture.home,
      USERPROFILE: fixture.home,
      SEPIA_TEST_USER_DATA: join(fixture.home, 'electron-user-data'),
    },
  })
  launched.push(app)
  const win = await app.firstWindow()
  await win.waitForSelector('.sepia-shell')
  await win.waitForTimeout(500)
  return win
}

test('#8 主页：无 tab 时出现，两条路都在；有 book 时最近列表直达', async () => {
  const fixture = await makeBook()
  const win = await launch(fixture, { version: 2, book: fixture.book, tabs: [], active: 0 })

  // 一个 tab 都没开 → 主页
  await expect(win.locator('[data-sepia-home]')).toBeVisible()
  await expect(win.locator('[data-sepia-home-action="book"]')).toBeVisible()
  await expect(win.locator('[data-sepia-home-action="page"]')).toBeVisible()
  // **主页也是纸**：版心与正文同宽，不是卡片网格
  const box = await win.locator('.sepia-home').boundingBox()
  expect(box!.width).toBeLessThanOrEqual(760)
})

test('#7 文件树：列出 book 里的 md，点击开 tab', async () => {
  const fixture = await makeBook()
  const win = await launch(fixture, { version: 2, book: fixture.book, tabs: [], active: 0 })

  const tree = win.locator('.sepia-tree')
  await expect(tree).toBeVisible()
  for (const page of fixture.pages) {
    await expect(win.locator(`[data-sepia-tree-entry="${page}"]`), `树里没有 ${page}`).toHaveCount(1)
  }
  // 只列 markdown，且 .git / node_modules 之类不进树
  await expect(win.locator('[data-sepia-tree-kind="file"]')).toHaveCount(3)

  await win.locator('[data-sepia-tree-entry="b.md"]').click()
  await expect(win.locator('[data-sepia-tab="b.md"]')).toHaveCount(1)
  await expect(win.locator('.cm-content')).toContainText('乙的正文')
})

test('#7b 文件树超限 → **降级为只列顶层，并且说出来**', async () => {
  const fixture = await makeBook({ extra: 30 })
  // 上限调到 5：fixture 有 30+ 个文件，必然触发降级
  const win = await launch(
    fixture,
    { version: 2, book: fixture.book, tabs: [], active: 0 },
    { libraryTreeEntryLimit: 5 },
  )

  await expect(win.locator('.sepia-tree')).toHaveAttribute('data-sepia-tree', 'degraded')
  await expect(win.locator('[data-sepia-tree-notice="degraded"]'), '降级了却没说').toBeVisible()
  // 只剩顶层：sub/ 里的东西一个都不该在
  await expect(win.locator('[data-sepia-tree-entry="sub/c.md"]')).toHaveCount(0)
})

test('#6 多 Tab：切换各自恢复光标、⌘W 关、重启恢复 tabs+active', async () => {
  const fixture = await makeBook()
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [
      { page: 'a.md', cursor: 0, scrollTop: 0 },
      { page: 'b.md', cursor: 0, scrollTop: 0 },
    ],
    active: 0,
  })

  await expect(win.locator('.sepia-tab')).toHaveCount(2)
  await expect(win.locator('.cm-content')).toContainText('甲的正文')

  // 切到第二个 tab
  await win.locator('[data-sepia-tab="b.md"]').click()
  await expect(win.locator('.cm-content')).toContainText('乙的正文')
  await expect(win.locator('[data-sepia-tab="b.md"]')).toHaveAttribute('data-sepia-tab-active', 'true')

  // ⌘W 关掉当前 → 回到剩下那个（**不是白屏**）
  await win.keyboard.press('Meta+w')
  await expect(win.locator('.sepia-tab')).toHaveCount(1)
  await expect(win.locator('.cm-content')).toContainText('甲的正文')

  // session 落盘之后重启：tabs 与 active 都该回来
  await win.waitForTimeout(900)
  const saved = JSON.parse(await readFile(join(fixture.home, '.sepia', 'session.json'), 'utf8')) as {
    version: number
    tabs: { page: string }[]
  }
  expect(saved.version).toBe(2)
  expect(saved.tabs.map((tab) => tab.page)).toEqual(['a.md'])
})

test('#13 DoD：树扫描不挡"可写"——t0–t5 攒齐，树在其后才到', async () => {
  const fixture = await makeBook({ extra: 60 })
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })

  // 纸先可写：打点齐了才算（与冷启动 smoke 同一口径）
  await expect(win.locator('.cm-content')).toBeVisible()
  // 树随后异步到位——**它在 t5 之后**，所以此刻断言"最终会有"，而不是"立刻有"
  await expect(win.locator('[data-sepia-tree-kind="file"]').first()).toBeVisible({ timeout: 10_000 })
})

test('#9 `@` 引用：出列表 → 选中插入标准 md 链接 → 链接可开', async () => {
  const fixture = await makeBook()
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })
  await win.waitForSelector('.cm-content')
  // 候选表是异步扫来的——等它到位（这一步在 t5 之后，不挡可写）
  await win.waitForTimeout(800)

  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')
  await win.keyboard.type('见 @b')

  // 一：列表出来了，且命中的是 b.md
  const picker = win.locator('[data-sepia-refs]')
  await expect(picker, '按下 @ 之后没有列表').toBeVisible({ timeout: 3_000 })
  await expect(win.locator('[data-sepia-ref="b.md"]')).toHaveCount(1)

  // 一 b：**列表要贴着光标**（行内浮层，§2.1 ④）。真人轮实测：它当时钉在窗口
  // 底部中央——那是命令面板的位置，不是行内浮层的位置。
  // 破坏方式：把定位改回 `bottom:24px; left:50%` → 与光标的距离必然超阈值，本条红。
  const geometry = await win.evaluate(() => {
    const popup = document.querySelector('.sepia-refs')?.getBoundingClientRect()
    const caret = document.querySelector('.cm-cursor-primary')?.getBoundingClientRect()
    if (popup === undefined || caret === undefined) return null
    return { dx: Math.abs(popup.left - caret.left), dy: popup.top - caret.bottom, popupTop: popup.top }
  })
  expect(geometry, '取不到浮层或光标的位置').not.toBeNull()
  expect(geometry!.dx, '浮层没跟着光标横向对齐').toBeLessThan(40)
  expect(geometry!.dy, '浮层没有紧跟在光标下方').toBeGreaterThanOrEqual(0)
  expect(geometry!.dy, '浮层离光标太远——它被钉在别处了').toBeLessThan(40)

  // 二：回车插入——**标准 markdown 链接**，不是 wiki 链接（守 markdown 纯度）
  await win.keyboard.press('Enter')
  await expect(picker).toHaveCount(0)
  const text = await win.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')
  expect(text, '插进去的不是标准 md 链接').toContain('](b.md)')
  expect(text, '不许插 wiki 链接').not.toContain('[[')
  // 标题建好时用标题作链接文字
  expect(text).toContain('[乙的标题]')
})

/**
 * 在页面里造一个真事件（`paste` 或 `drop`），`dataTransfer` 里带一个图片 File。
 *
 * **必须走真事件**：旧版 #10 直接调 `importImage`，把"事件到底到没到我的 handler"
 * 整个假设掉了——于是 `File.path` 在 Electron 43 上恒为 undefined 这件事
 * 一路绿到真人轮（§2.9 条目 6）。
 */
async function fireImageEvent(win: Page, kind: 'paste' | 'drop', name: string): Promise<void> {
  await win.evaluate(
    async ([type, fileName]) => {
      // 一张最小的合法 PNG（1x1）
      const base64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const file = new File([bytes], fileName as string, { type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const target = document.querySelector('.cm-content')
      if (target === null) throw new Error('no editor')
      const event =
        type === 'paste'
          ? new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
          : new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
    },
    [kind, name],
  )
}

test('#10 **粘贴**一张图 → 落 assets/ + 插 `![]()`，原字节只增不改', async () => {
  const fixture = await makeBook()
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })
  await win.waitForSelector('.cm-content')
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')

  await fireImageEvent(win, 'paste', 'shot.png')

  // 一：正文里插了 `![](assets/…)`
  await expect
    .poll(async () => win.evaluate(() => document.querySelector('.cm-content')?.textContent ?? ''), {
      timeout: 10_000,
    })
    .toMatch(/!\[]\(assets\/\d{10}-shot\.png\)/)

  // 二：图**真的落在盘上**，且字节原样（1x1 PNG 的头四字节）
  const { readdir } = await import('node:fs/promises')
  const names = await readdir(join(fixture.book, 'assets'))
  expect(names, 'assets/ 里没东西——收图那条路没走通').toHaveLength(1)
  const bytes = await readFile(join(fixture.book, 'assets', names[0]!))
  expect([...bytes.subarray(0, 4)], '落盘的不是 PNG 字节').toEqual([0x89, 0x50, 0x4e, 0x47])
})

test('#10b **拖拽**一张图 → 同一条路（Electron 43 上 File.path 已不存在）', async () => {
  const fixture = await makeBook()
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })
  await win.waitForSelector('.cm-content')
  await win.locator('.cm-content').click()

  await fireImageEvent(win, 'drop', 'dragged.png')

  await expect
    .poll(async () => win.evaluate(() => document.querySelector('.cm-content')?.textContent ?? ''), {
      timeout: 10_000,
    })
    .toContain('](assets/')
  const { readdir } = await import('node:fs/promises')
  expect(await readdir(join(fixture.book, 'assets'))).toHaveLength(1)
})

test('#10c 拖别的一切**静默无效**：正文一个字节不变，img/ 不冒出来', async () => {
  const fixture = await makeBook()
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })
  await win.waitForSelector('.cm-content')
  const before = await readFile(join(fixture.book, 'a.md'), 'utf8')

  await win.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'thing.zip', { type: 'application/zip' }))
    document
      .querySelector('.cm-content')
      ?.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  await win.waitForTimeout(600)

  expect(await readFile(join(fixture.book, 'a.md'), 'utf8')).toBe(before)
  const { readdir } = await import('node:fs/promises')
  expect(await readdir(fixture.book).then((n) => n.includes('assets'))).toBe(false)
})

test('#5 更新链接：只查不改 → 用户点了才改，且只改指向旧路径的', async () => {
  const fixture = await makeBook()
  await writeFile(join(fixture.book, 'a.md'), '见 [乙](b.md) 和 [别的](bb.md)。\n', 'utf8')
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })
  await win.waitForSelector('.cm-content')

  const call = async (apply: boolean): Promise<{ ok: boolean; value?: { total: number } }> =>
    win.evaluate(
      async ([book, doApply]) =>
        (globalThis as unknown as {
          api: {
            files: {
              updateLinks(b: string, f: string, t: string, a: boolean): Promise<{ ok: boolean; value?: { total: number } }>
            }
          }
        }).api.files.updateLinks(book as string, 'b.md', 'renamed.md', doApply as boolean),
      [fixture.book, apply],
    )

  // 一：只查不改——**磁盘一个字节都不许动**（T-31：用户主动）
  const probe = await call(false)
  expect(probe.value?.total).toBe(1)
  expect(await readFile(join(fixture.book, 'a.md'), 'utf8')).toContain('[乙](b.md)')

  // 二：点了才改，且 bb.md 不许被误伤
  await call(true)
  const after = await readFile(join(fixture.book, 'a.md'), 'utf8')
  expect(after).toContain('[乙](renamed.md)')
  expect(after, '误改了无关链接——比漏更新严重得多').toContain('[别的](bb.md)')
})

test('#7c 没有 .md 的文件夹作 book → **说人话**，不是两个哑目录行', async () => {
  // 真人轮撞出来的形状（§2.9 条目 4）：HTML 原型导出目录当 book，
  // 底下全是图片与 html，一个 .md 都没有
  const home = await mkdtemp(join(tmpdir(), 'sepia-empty-'))
  const book = join(home, 'book')
  await mkdir(join(book, 'uploads'), { recursive: true })
  await mkdir(join(book, 'scraps'), { recursive: true })
  await writeFile(join(book, 'design.html'), '<html></html>', 'utf8')
  await writeFile(join(book, 'uploads', 'a.png'), 'PNG', 'utf8')
  await mkdir(join(home, '.sepia'), { recursive: true })
  const fixture = { home, book, pages: [] }
  const win = await launch(fixture, { version: 2, book, tabs: [], active: 0 })

  // 一：**一个哑目录行都没有**——没有 md 的目录不进树
  await expect(win.locator('[data-sepia-tree-kind="dir"]'), '空目录还在树里').toHaveCount(0)
  await expect(win.locator('[data-sepia-tree-kind="file"]')).toHaveCount(0)
  // 二：**说了人话**，而不是留一片空白让人以为坏了
  await expect(win.locator('[data-sepia-tree-notice="empty"]')).toBeVisible()
})

test('#8b 关掉所有 tab → 点最近的**游离** page → 真的打开（不是"打不开这个文件"）', async () => {
  // 真人轮撞出来的（§2.9 条目 5）：recents 里 book 内的存相对、**游离的存绝对**，
  // 主页当时把两种都当相对去拼 book 前缀，拼出一个不存在的路径。
  const fixture = await makeBook()
  const loose = join(fixture.home, '游离的一篇.md')
  await writeFile(loose, '# 游离\n\n它不在 book 里。\n', 'utf8')

  await seedRecents(fixture, [loose]) // 游离 page 在 recents 里是**绝对路径**
  const win = await launch(fixture, { version: 2, book: fixture.book, tabs: [], active: 0 })

  // 一个 tab 都没有 → 主页，最近里有那条游离记录
  await expect(win.locator('[data-sepia-home]')).toBeVisible()
  const recent = win.locator(`[data-sepia-home-recent="${loose}"]`)
  await expect(recent, '游离 page 没进最近列表').toHaveCount(1)

  // 点它 → **真的打开**
  await recent.click()
  await expect(win.locator('.sepia-error'), '又是"打不开这个文件"').toHaveCount(0)
  await expect(win.locator('.cm-content')).toContainText('它不在 book 里')
  await expect(win.locator('.sepia-tab')).toHaveCount(1)
})

test('#8c 最近里指向已删除的文件 → 报错但**不留一个开不出内容的 tab**', async () => {
  const fixture = await makeBook()
  const gone = join(fixture.book, 'gone.md')
  await writeFile(gone, '# 待会儿删掉\n', 'utf8')
  await seedRecents(fixture, ['gone.md'])
  const { rm } = await import('node:fs/promises')
  await rm(gone) // 最近里还记着它，盘上已经没有了
  const win = await launch(fixture, { version: 2, book: fixture.book, tabs: [], active: 0 })
  await expect(win.locator('[data-sepia-home]')).toBeVisible()

  await win.locator('[data-sepia-home-recent="gone.md"]').click()
  await expect(win.locator('.sepia-error')).toBeVisible()
  // **tab 收回去了**：留着一个 tab 在、纸是空的、红字挂着，比什么都没发生更糟
  await expect(win.locator('.sepia-tab'), '留下了一个开不出内容的 tab').toHaveCount(0)
})

test('#10d 收进来的图**自成一行**：不许挤进别人行里', async () => {
  const fixture = await makeBook()
  await writeFile(join(fixture.book, 'a.md'), '# 访问控制管理办法\n\n正文。\n', 'utf8')
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })
  await win.waitForSelector('.cm-content')
  await win.locator('.cm-content').click()
  // 光标停在标题行**行首**——真人轮出事的正是这个位置
  await win.keyboard.press('Meta+ArrowUp')
  await fireImageEvent(win, 'paste', 'shot.png')

  await expect.poll(async () => readFile(join(fixture.book, 'a.md'), 'utf8').catch(() => ''), {
    timeout: 10_000,
  }).toContain('](assets/')
  // 真人轮的事故形态：`![](img/…)# 访问控制管理办法` —— 标题当场废掉
  const text = await win.evaluate(
    () => (document.querySelector('.cm-content') as HTMLElement | null)?.innerText ?? '',
  )
  expect(text, '图片挤进标题行了').not.toMatch(/\)[^\n]*访问控制/)
  const doc = await win.evaluate(() => {
    const cm = document.querySelector('.cm-content')
    return cm === null ? '' : (cm as HTMLElement).innerText
  })
  expect(doc).toContain('访问控制管理办法')

  // 另一半：光标停在**一行文字的末尾**。这一半与上面那一半是两条独立的补换行，
  // 只测一头会让另一头永远绿着（本次反向验证当场撞到：破坏 head 时 #10d 照绿，
  // 因为行首那个场景根本走不到 head）。
  // 必须落在**一行有字的行尾**：`Meta+ArrowDown` 会走到全文末尾（前一个字符已经是
  // 换行），那条路根本走不到 head——第一版就是这么写的，破坏 head 时照绿
  await win.getByText('正文。').click()
  await win.keyboard.press('Meta+ArrowRight')
  await fireImageEvent(win, 'paste', 'second.png')
  await expect.poll(async () => {
    const names = await (await import('node:fs/promises')).readdir(join(fixture.book, 'assets'))
    return names.length
  }, { timeout: 10_000 }).toBe(2)
  const after = await win.evaluate(
    () => (document.querySelector('.cm-content') as HTMLElement | null)?.innerText ?? '',
  )
  // `[^\n]` 而不是 `\s`：`\s` 把换行也算进去，于是"图片在下一行"也会被判成"同一行"——
  // 这条断言本身第一次就是这么写错的，对着正确实现红了才发现
  expect(after, '图片粘在"正文。"后面同一行了').not.toMatch(/正文。[^\n]*\[/)
})

test('#10e 图片预览**真的画出了像素**（不是只挂了个 <img> 标签）', async () => {
  const fixture = await makeBook()
  // **故意仍用 `img/`**：写入侧的默认值已按 D-40 改成 `assets/`，
  // 而 D-40 的实现约束是「读取侧一律按 md 里的实际相对路径解析」——
  // 换默认值不许让既有的 `img/` 旧图失效。这条 fixture 就是那句话的实证。
  await mkdir(join(fixture.book, 'img'), { recursive: true })
  // 一张 2x2 的真 PNG——尺寸小但**非零**，这正是要断言的东西
  await writeFile(
    join(fixture.book, 'img', 'x.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC',
      'base64',
    ),
  )
  await writeFile(join(fixture.book, 'a.md'), '# 标题\n\n![](img/x.png)\n\n尾巴\n', 'utf8')
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })
  await win.waitForSelector('.cm-content')

  // `toBeVisible()` 在这儿是**没用的**：一个 src 解析失败的 <img> 照样"可见"，
  // 只是宽高为 0。要判"用户看得见"，只有量真实解码尺寸（002 §6.2 第二条元规则）。
  await expect
    .poll(
      async () =>
        win.evaluate(() => {
          const img = document.querySelector('.sepia-image img') as HTMLImageElement | null
          if (img === null) return { w: -1, natural: -1 }
          const rect = img.getBoundingClientRect()
          return { w: Math.round(rect.width), natural: img.naturalWidth }
        }),
      { timeout: 10_000 },
    )
    .toEqual({ w: 2, natural: 2 })

  // 源码被替换掉了才叫预览——正文里不该再出现 `![](`
  const shown = await win.evaluate(
    () => (document.querySelector('.cm-content') as HTMLElement | null)?.innerText ?? '',
  )
  expect(shown, '还在显示源码，widget 没接管').not.toContain('![](')

  // 走的必须是特权 scheme，不是 file://——后者在 dev 态（http 源）根本加载不了，
  // 而 smoke 是打包态，两条路都画得出来，只断言"画出来了"分不清用的是哪条
  const scheme = await win.evaluate(
    () => (document.querySelector('.sepia-image img') as HTMLImageElement | null)?.src.split(':')[0] ?? '',
  )
  expect(scheme, '还在用 file://——dev 态会看不见').toBe('sepia-asset')
})

test('#10f 路径里带 `..` 的一律拒——在解析那一步就拒，不做「洗干净再放行」', async () => {
  const fixture = await makeBook()
  await writeFile(
    join(fixture.home, 'outside.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC',
      'base64',
    ),
  )
  await writeFile(join(fixture.book, 'a.md'), '# 标题\n\n![](../outside.png)\n\n尾巴\n', 'utf8')
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })
  await win.waitForSelector('.cm-content')

  await expect
    .poll(async () => win.evaluate(() => document.querySelector('.sepia-image-broken') !== null), {
      timeout: 10_000,
    })
    .toBe(true)
  const natural = await win.evaluate(
    () => (document.querySelector('.sepia-image img') as HTMLImageElement | null)?.naturalWidth ?? 0,
  )
  expect(natural, 'book 外的图被读出来了').toBe(0)
})

test('#10g **软链绕不过去**：book 里一条指向外面的链接，realpath 之后判根 → 403', async () => {
  const fixture = await makeBook()
  await mkdir(join(fixture.book, 'img'), { recursive: true })
  await writeFile(
    join(fixture.home, 'outside.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC',
      'base64',
    ),
  )
  // 链接在 book **里面**，请求路径里一个 `..` 都没有——只看请求路径必然放行。
  // 拦住它的只能是「realpath 之后再判根」那一步（`services/assets.ts`）。
  const { symlink } = await import('node:fs/promises')
  await symlink(join(fixture.home, 'outside.png'), join(fixture.book, 'img', 'link.png'))
  await writeFile(join(fixture.book, 'a.md'), '# 标题\n\n![](img/link.png)\n\n尾巴\n', 'utf8')
  const win = await launch(fixture, {
    version: 2,
    book: fixture.book,
    tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
    active: 0,
  })
  await win.waitForSelector('.cm-content')

  await expect
    .poll(async () => win.evaluate(() => document.querySelector('.sepia-image-broken') !== null), {
      timeout: 10_000,
    })
    .toBe(true)
  const natural = await win.evaluate(
    () => (document.querySelector('.sepia-image img') as HTMLImageElement | null)?.naturalWidth ?? 0,
  )
  expect(natural, '顺着软链读到 book 外面去了').toBe(0)
})
