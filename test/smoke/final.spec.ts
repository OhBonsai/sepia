import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// 180 §1.4 #3–#6：⌘/ 看板、⌘⇧I 信息浮层、保存微反馈、写盘失败的终态链。
//
// 四条都只能在真应用里问——它们全是"接线通没通"的问题，而接线断掉的样子
// 恰恰是单测全绿（组件自己没错，只是没人把它挂上去）。

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]

const launched: ElectronApplication[] = []
test.afterEach(async () => {
  await Promise.all(launched.splice(0).map((app) => app.close().catch(() => undefined)))
})

interface Fixture {
  home: string
  book: string
  page: string
}

async function seed(): Promise<Fixture> {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'sepia-final-'))
  const book = join(home, 'book')
  await mkdir(book, { recursive: true })
  const page = join(book, 'a.md')
  await writeFile(page, '# 标题\n\n正文一行。\n', 'utf8')
  await mkdir(join(home, '.sepia'), { recursive: true })
  return { home, book, page }
}

async function launch(fixture: Fixture): Promise<Page> {
  await writeFile(
    join(fixture.home, '.sepia', 'session.json'),
    JSON.stringify({
      version: 2,
      book: fixture.book,
      tabs: [{ page: 'a.md', cursor: 0, scrollTop: 0 }],
      active: 0,
    }),
    'utf8',
  )
  await writeFile(
    join(fixture.home, '.sepia', 'config.json'),
    JSON.stringify({ version: 1, autosaveDebounceMs: 300 }),
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
  await win.waitForSelector('.cm-content')
  await win.waitForTimeout(400)
  return win
}

// ── #3 ⌘/ 快捷键看板（D-32 / F23）──────────────────────────────────────

test('#3 ⌘/ 看板：出得来、**一屏放得下**、Esc 关', async () => {
  const win = await launch(await seed())
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+/')

  const board = win.locator('[data-sepia-keys="open"]')
  await expect(board).toBeVisible()

  // **一屏放得下、不出滚动条**（D-32 ①）。滚动条出现即信号：快捷键太多该砍功能。
  // 量的是内容高度与可视高度——`overflow: hidden` 会让滚动条本身看不见，
  // 只断言"没有滚动条"是测不出溢出的。
  const fits = await win.evaluate(() => {
    const panel = document.querySelector('.sepia-keys') as HTMLElement | null
    const cols = document.querySelector('.sepia-keys-columns') as HTMLElement | null
    if (panel === null || cols === null) return null
    return {
      panelOverflow: panel.scrollHeight - panel.clientHeight,
      colsOverflow: cols.scrollHeight - cols.clientHeight,
      withinViewport: panel.getBoundingClientRect().bottom <= globalThis.innerHeight,
    }
  })
  expect(fits, '看板没渲染出来').not.toBeNull()
  expect(fits!.colsOverflow, '看板内容溢出了一屏——按 D-32 ① 这是"该砍功能"的信号').toBeLessThanOrEqual(1)
  expect(fits!.panelOverflow).toBeLessThanOrEqual(1)
  expect(fits!.withinViewport, '看板底边掉出了视口').toBe(true)

  await win.keyboard.press('Escape')
  await expect(board).toHaveCount(0)
})

test('#3b 搜索**只隐藏不重排**：命中的一行位置一个像素都不动', async () => {
  const win = await launch(await seed())
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+/')
  await expect(win.locator('[data-sepia-keys="open"]')).toBeVisible()

  const before = await win.evaluate(() => {
    const row = document.querySelector('[data-sepia-keys-row="file.save"]')
    return row === null ? null : row.getBoundingClientRect().top
  })
  expect(before).not.toBeNull()

  await win.locator('[data-sepia-keys-search]').fill('保存')
  await win.waitForTimeout(150)

  // 一：命中的还在，且**位置没变**（filter 后重渲染会让它跳到第一行）
  const after = await win.evaluate(() => {
    const row = document.querySelector('[data-sepia-keys-row="file.save"]') as HTMLElement | null
    return row === null ? null : { top: row.getBoundingClientRect().top, hidden: row.hidden }
  })
  expect(after!.hidden, '命中的行被藏了').toBe(false)
  expect(after!.top, '搜索之后位置变了——这是重排，D-32 ④ 要的是只隐藏').toBeCloseTo(before!, 0)

  // 二：没命中的藏起来了
  const otherHidden = await win.evaluate(
    () => (document.querySelector('[data-sepia-keys-row="tab.next"]') as HTMLElement | null)?.hidden,
  )
  expect(otherHidden, '没命中的行还露着').toBe(true)
})

test('#3c 搜键位也命中：打「k」找得到 ⌘K', async () => {
  const win = await launch(await seed())
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+/')
  await win.locator('[data-sepia-keys-search]').fill('k')
  await win.waitForTimeout(150)
  const summonHidden = await win.evaluate(
    () => (document.querySelector('[data-sepia-keys-row="agent.summon"]') as HTMLElement | null)?.hidden,
  )
  expect(summonHidden, '打 k 没找到 ⌘K').toBe(false)
})

test('#3d **只读**：⌘/ 本身不动正文，看板里回车也不执行任何命令', async () => {
  const fixture = await seed()
  const win = await launch(fixture)
  const original = await readFile(fixture.page, 'utf8')
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+/')
  await win.waitForTimeout(700)

  // **⌘/ 自己就差点是个写操作**：CM6 的 defaultKeymap 把 Mod-/ 绑给了 toggleComment，
  // 按一下就在正文里插一对 `<!--  -->`——一个只读看板的快捷键改写了用户的字。
  // 实测抓到的，修在 editor 的 keymap 里（APP_OWNED_KEYS）。
  expect(await readFile(fixture.page, 'utf8'), '⌘/ 动了正文——CM6 抢在前面把这行注释掉了').toBe(original)
  await win.locator('[data-sepia-keys-search]').fill('保存')
  await win.waitForTimeout(150)

  const before = await readFile(fixture.page, 'utf8')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(500)

  // 看板仍在（回车没有"执行并关闭"），文件没被动过
  await expect(win.locator('[data-sepia-keys="open"]'), '回车把看板关了——它开始像命令面板了').toBeVisible()
  expect(await readFile(fixture.page, 'utf8'), '回车执行了命令——看板必须是只读的').toBe(before)
})

test('#3e 上下文置灰：没有 page 时需要 page 的命令是灰的', async () => {
  const fixture = await seed()
  // 一个 tab 都不开 → 主页态，`file.save` / `agent.summon` 此刻按不了
  await writeFile(
    join(fixture.home, '.sepia', 'session.json'),
    JSON.stringify({ version: 2, book: fixture.book, tabs: [], active: 0 }),
    'utf8',
  )
  await writeFile(
    join(fixture.home, '.sepia', 'config.json'),
    JSON.stringify({ version: 1, autosaveDebounceMs: 300 }),
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
  await win.keyboard.press('Meta+/')
  await expect(win.locator('[data-sepia-keys="open"]')).toBeVisible()

  await expect(
    win.locator('[data-sepia-keys-row="file.save"]'),
    '没有 page 却把"保存"画成可用',
  ).toHaveAttribute('data-sepia-keys-available', 'false')
  // 不需要 page 的照常高亮——**置灰不能恒真**，否则这条检查等于没测
  await expect(win.locator('[data-sepia-keys-row="file.open"]')).toHaveAttribute(
    'data-sepia-keys-available',
    'true',
  )
})

// ── #4 ⌘⇧I 信息浮层（D-30）────────────────────────────────────────────

test('#4 ⌘⇧I：字数/保存/commit/线程/book/路径/Agent 七行都在', async () => {
  const fixture = await seed()
  const win = await launch(fixture)
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+Shift+I')

  const panel = win.locator('[data-sepia-info="open"]')
  await expect(panel).toBeVisible()
  for (const row of ['words', 'saved', 'commit', 'threads', 'book', 'path', 'agent']) {
    await expect(win.locator(`[data-sepia-info-row="${row}"]`), `缺了 ${row} 这一行`).toHaveCount(1)
  }
  // 路径那行要真的是这张纸的路径，不是占位符
  await expect(win.locator('[data-sepia-info-row="path"]')).toContainText('a.md')
})

test('#4b commit 失败在 ⌘⇧I 里看得见（架构 §4.2 指定这里是它唯一的家）', async () => {
  const fixture = await seed()
  // book 不是 git 仓库 → 保存成功但没有 commit。这正是"写盘成功、版本没记上"
  const win = await launch(fixture)
  await win.locator('.cm-content').click()
  await win.keyboard.type('改一个字')
  await win.keyboard.press('Meta+s')
  await win.waitForTimeout(800)
  await win.keyboard.press('Meta+Shift+I')

  await expect(win.locator('[data-sepia-info="open"]')).toBeVisible()
  // 不是 git 仓库时既不该报 commit 成功、也不该假装有 hash
  const commit = await win.locator('[data-sepia-info-row="commit"]').innerText()
  expect(commit, 'commit 那行编了一个 hash 出来').not.toMatch(/[0-9a-f]{7}/)
})

// ── #5 保存微反馈（D-30）──────────────────────────────────────────────

test('#5 保存成功 → 纸角一闪 → **600ms 后真的没了**（像素级）', async () => {
  const fixture = await seed()
  const win = await launch(fixture)
  await win.locator('.cm-content').click()
  await win.keyboard.type('一些字')
  await win.keyboard.press('Meta+s')

  // 一：出现了。**不能只断言元素在**——一个透明的点也"在"。量真实不透明度。
  await expect
    .poll(
      async () =>
        win.evaluate(() => {
          const dot = document.querySelector('[data-sepia-save-pulse="on"]')
          if (dot === null) return -1
          return Number(getComputedStyle(dot).opacity)
        }),
      { timeout: 3_000 },
    )
    .toBeGreaterThan(0)

  // 二：600ms 之后消失。**它是一次性微反馈，常亮就成了第二个警示点**
  await expect
    .poll(async () => win.evaluate(() => document.querySelector('[data-sepia-save-pulse="on"]') !== null), {
      timeout: 3_000,
    })
    .toBe(false)
})

// ── #6 写盘失败的终态链（架构 §4.9 后半）────────────────────────────────

test('#6 终态链：写不进去 → 重试 → 耗尽 → 关窗被拦 → 恢复权限后拦截消失', async () => {
  const fixture = await seed()
  const win = await launch(fixture)
  await win.locator('.cm-content').click()

  // 把整个 book 目录设成只读：tmp+rename 写不进去（不是改文件权限——
  // 原子写是往目录里建临时文件，只改文件位不会失败）
  await chmod(fixture.book, 0o555)
  try {
    await win.keyboard.type('写不进去的字')
    await win.keyboard.press('Meta+s')

    // 一：失败立刻可见（警示点 + 横条），不是静默
    await expect(win.locator('[data-sepia-save-warning="on"]')).toBeVisible({ timeout: 5_000 })

    // 二：三次退避（1+3+9s）之后进入耗尽态。给足余量
    await expect
      .poll(async () => win.evaluate(() => document.querySelector('.sepia-error')?.textContent ?? ''), {
        timeout: 25_000,
      })
      .toContain('存不进磁盘')

    // 三：**此刻关窗要被拦**——架构 §4.9 里唯一的例外
    await win.evaluate(() => {
      globalThis.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    })
    await expect(
      win.locator('[data-sepia-close-blocked="open"]'),
      '写盘已确认不可用且有脏字，关窗却没拦',
    ).toBeVisible({ timeout: 5_000 })

    // 取消 → 回到写作，不退出
    await win.locator('[data-sepia-close-blocked-action="cancel"]').click()
    await expect(win.locator('[data-sepia-close-blocked="open"]')).toHaveCount(0)
  } finally {
    await chmod(fixture.book, 0o755)
  }

  // 四：权限恢复 + 保存成功 → 警示点与拦截**一起消失**（"恢复即消"）
  await win.keyboard.press('Meta+s')
  await expect(win.locator('[data-sepia-save-warning="on"]')).toHaveCount(0, { timeout: 10_000 })
  await win.evaluate(() => {
    globalThis.dispatchEvent(new Event('beforeunload', { cancelable: true }))
  })
  await win.waitForTimeout(400)
  await expect(
    win.locator('[data-sepia-close-blocked="open"]'),
    '写盘已经好了，关窗还在拦——这就是"误拦"',
  ).toHaveCount(0)
})

test('#6b **其余退出一律不拦**：没脏字时关窗零对话框', async () => {
  const win = await launch(await seed())
  await win.evaluate(() => {
    globalThis.dispatchEvent(new Event('beforeunload', { cancelable: true }))
  })
  await win.waitForTimeout(400)
  await expect(
    win.locator('[data-sepia-close-blocked="open"]'),
    '干净状态下关窗被拦了——⌘Q 无对话框原则破了',
  ).toHaveCount(0)
})

test('#6c 只是脏、写盘好好的 → 也不拦（自动写盘会处理，弹框纯属打扰）', async () => {
  const win = await launch(await seed())
  await win.locator('.cm-content').click()
  await win.keyboard.type('还没保存的字')
  await win.evaluate(() => {
    globalThis.dispatchEvent(new Event('beforeunload', { cancelable: true }))
  })
  await win.waitForTimeout(400)
  await expect(win.locator('[data-sepia-close-blocked="open"]'), '只是脏就拦——这是误拦').toHaveCount(0)
})
