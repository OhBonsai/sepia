import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// Stage 2 的 smoke 组（130 §1.4 #3–#8，§1.6a 的机器可判定部分）。
// 每条对应一个预定破坏方式（§1.5 反向验证表），证据截图落 specs/plan/evidence/130/。

const APP_ENTRY = 'packages/app/out/main/index.js'
const LAUNCH_ARGS = process.env['CI'] ? [APP_ENTRY, '--no-sandbox'] : [APP_ENTRY]
const EVIDENCE = 'specs/plan/evidence/130'

const FULL = [
  '# 一级标题',
  '',
  '正文 **加粗** *斜体* `代码` ~~删除~~ [链接](https://a.b) $E=mc^2$。',
  '',
  '> 引用行',
  '',
  '- 无序项',
  '- [x] 任务完成',
  '',
  '| 甲 | 乙 |',
  '| - | -: |',
  '| 1 | 2 |',
  '',
  '$$',
  'x^2+y^2=1',
  '$$',
  '',
  '```python',
  'def f():',
  '    return 1',
  '```',
  '',
  '```textdiagram',
  '[纸] --> [Agent]',
  '```',
  '',
  '---',
  '',
  '尾段。',
  '',
].join('\n')

async function boot(
  body: string,
  options: { cursor?: number } = {},
): Promise<{ app: ElectronApplication; win: Page; page: string; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'sepia-md-'))
  const page = join(home, 'doc.md')
  await writeFile(page, body, 'utf8')
  await mkdir(join(home, '.sepia'), { recursive: true })
  await writeFile(
    join(home, '.sepia', 'session.json'),
    JSON.stringify({ version: 1, page, cursor: options.cursor ?? 0, scrollTop: 0 }),
    'utf8',
  )
  const app = await electron.launch({
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
  const win = await app.firstWindow()
  await win.waitForSelector('.cm-content')
  await win.waitForTimeout(600)
  return { app, win, page, home }
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

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

test('④ 全语法渲染：A/B/C/D 每类可判定的 DOM 特征', async () => {
  const { app, win } = await boot(FULL, { cursor: FULL.length - 2 })
  const probe = await win.evaluate(() => ({
    h1: document.querySelectorAll('.cm-md-h1').length, // B
    strongMarkHidden: !document.querySelector('.cm-content')!.textContent!.includes('**'), // A 标记已藏
    katexInline: document.querySelectorAll('.sepia-math:not(.sepia-math-block) .katex').length, // A 行内公式
    quote: document.querySelectorAll('.cm-md-quote').length, // B
    bullet: document.querySelectorAll('.sepia-bullet').length, // B
    checkbox: document.querySelectorAll('.sepia-checkbox-on').length, // B
    table: document.querySelectorAll('.sepia-table table td').length, // C
    mathBlock: document.querySelectorAll('.sepia-math-block .katex').length, // C
    diagram: document.querySelectorAll('.sepia-textdiagram').length, // C
    hr: document.querySelectorAll('.sepia-hr').length, // B
    codeblock: document.querySelectorAll('.cm-md-codeblock').length, // D
  }))
  expect(probe.h1).toBeGreaterThan(0)
  expect(probe.strongMarkHidden).toBe(true)
  expect(probe.katexInline).toBe(1)
  expect(probe.quote).toBeGreaterThan(0)
  expect(probe.bullet).toBe(1)
  expect(probe.checkbox).toBe(1)
  expect(probe.table).toBe(2)
  expect(probe.mathBlock).toBe(1)
  expect(probe.diagram).toBe(1)
  expect(probe.hr).toBe(1)
  expect(probe.codeblock).toBeGreaterThan(2)
  await evidence(win, `${EVIDENCE}/a1-full-syntax.png`)
  await app.close()
})

// 走查暴露的 C 类缺陷（150 §1.9 回流）：表格画出了网格，单元格里的行内 markdown
// 却是 raw——`代码` 露反引号、**粗** 露星号。修法是复用 A 类装饰管线（不自写第二套）。
//
// 预定破坏：把 `TableWidget.toDOM` 的 `this.renderInline(cell)` 换回
// `el.textContent = cell`（或把 markdown.ts 里的 `inlineRenderer.of(...)` 摘掉）
// → 反引号/星号回到 DOM 文本里，`code`/`strong` 节点消失，本条必红。
test('④b C 类 widget 内的行内标记：表格单元格复用 A 类管线渲染', async () => {
  const doc = [
    '| 甲 | 乙 |',
    '| - | - |',
    '| `x` | **y** |',
    // 边界：单元格内**只做行内**。GFM 规定单元格里没有块级，所以这三个必须逐字呈现——
    // 裸解析（不套回表格）会把它们当成标题/引用/列表，井号大于号被藏、圆点 widget 被塞进来
    '| # 井 | - 列 |',
    '| > 引 | <script>x</script> |',
    '',
    '尾段。',
    '',
  ].join('\n')
  // 光标停在尾段——表格必须处于**失焦渲染**态，widget 才在
  const { app, win } = await boot(doc, { cursor: doc.length - 2 })
  const probe = await win.evaluate(() => {
    const table = document.querySelector('.sepia-table table')
    const text = table?.textContent ?? ''
    return {
      有表格: table !== null,
      code节点: table?.querySelectorAll('td code.cm-md-code').length ?? 0,
      strong节点: table?.querySelectorAll('td strong.cm-md-strong').length ?? 0,
      文本: text,
      // 语义节点里装的必须是**去掉标记之后**的内容
      code内容: table?.querySelector('td code')?.textContent ?? '',
      strong内容: table?.querySelector('td strong')?.textContent ?? '',
      单元格: [...(table?.querySelectorAll('td') ?? [])].map((td) => td.textContent),
      圆点: table?.querySelectorAll('.sepia-bullet').length ?? 0,
      脚本节点: table?.querySelectorAll('script').length ?? 0,
    }
  })
  expect(probe.有表格).toBe(true)
  // 一：对应的语义节点出现了，且带着与纸面同名的 class（同一份色板）
  expect(probe.code节点).toBe(1)
  expect(probe.strong节点).toBe(1)
  expect(probe.code内容).toBe('x')
  expect(probe.strong内容).toBe('y')
  // 二：字面标记不出现在渲染结果里——这一条才是走查看见的那个现象
  expect(probe.文本).not.toContain('`')
  expect(probe.文本).not.toContain('**')
  // 三：块级不递归（人裁的边界）——单元格里的 #、>、- 一律逐字，不当块级解释。
  // 破坏方式：把 inline-dom.ts 的合成表格外壳去掉、改成裸解析 → 井号大于号被藏、
  // 圆点 widget 出现，这三条必红。
  expect(probe.单元格).toEqual(['x', 'y', '# 井', '- 列', '> 引', '<script>x</script>'])
  expect(probe.圆点).toBe(0)
  // 四：D 类「任意 HTML 不渲染」在 widget 内同样成立——渲染器交出的是 DOM 节点，
  // 不是 HTML 字符串，所以 <script> 只可能是六个字符
  expect(probe.脚本节点).toBe(0)
  // 本条是 Stage 4 走查暴露的缺陷，证据跟着 150 走（不是 130 的那批）
  await evidence(win, 'specs/plan/evidence/150/table-inline.png')
  await app.close()
})

test('⑤ 揭示行为：光标进入标记露出、离开再隐藏', async () => {
  const { app, win } = await boot('前面 **加粗** 后面\n')
  const marks = (): Promise<boolean> =>
    win.evaluate(() => document.querySelector('.cm-content')!.textContent!.includes('**'))
  expect(await marks()).toBe(false) // 光标在 0，加粗在中段——标记藏着？0 触到 "前面"，不触加粗
  // 走进加粗范围
  for (let i = 0; i < 4; i++) await win.keyboard.press('ArrowRight')
  await win.waitForTimeout(200)
  expect(await marks()).toBe(true)
  await evidence(win, `${EVIDENCE}/a3-revealed.png`)
  // 走出去，再隐藏
  await win.keyboard.press(`${mod}+ArrowDown`) // 文档末尾
  await win.waitForTimeout(200)
  expect(await marks()).toBe(false)
  await app.close()
})

test('① round-trip 端到端：全语法 CRLF 文档编辑保存后无关字节逐一原样', async () => {
  const crlf = FULL.split('\n').join('\r\n')
  const { app, win, page } = await boot(crlf, { cursor: 0 })
  await win.keyboard.type('【EDIT】')
  await win.keyboard.press(`${mod}+s`)
  await expect.poll(async () => (await readFile(page, 'utf8')).includes('【EDIT】'), { timeout: 5000 }).toBe(true)
  const saved = await readFile(page, 'utf8')
  expect(saved).toBe(`【EDIT】${crlf}`) // 只有敲进去的字节是新的，其余逐字节原样
  await app.close()
})

test('③ composition 冻结：真组合管线（CDP）期间装饰零重算', async () => {
  // 冻结在 DOM 上常不可见（widget eq() 稳定时重建也不 churn），唯一诚实的判定量
  // 是**重算发生了没有**——decorate.ts 的 __sepiaDecorateBuilds 探针。
  // 合成 CompositionEvent 设不动 view.composing（§1.8 风险 4 实测应验），
  // 这里走 CDP Input.imeSetComposition——Chromium 的真组合管线，与真 IME 同路。
  const { app, win } = await boot('输入区 $E=mc^2$ 尾\n', { cursor: 3 })
  const builds = (): Promise<number> =>
    win.evaluate(() => (globalThis as { __sepiaDecorateBuilds?: number }).__sepiaDecorateBuilds ?? -1)
  const before = await builds()
  expect(before).toBeGreaterThan(0)

  const cdp = await win.context().newCDPSession(win)
  await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
  await win.waitForTimeout(150)
  await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 })
  await win.waitForTimeout(150)
  expect(await builds(), '组合期间文档两次变更，装饰不许重算——IME 冻结').toBe(before)

  // 提交并动一下光标：恢复重算。往左走——提交后光标停在 5，右移一格是 6，
  // 恰好是公式的 from 边界（触碰即揭示），会把"渲染态完好"的断言自己搞砸
  await cdp.send('Input.insertText', { text: '你好' })
  await win.keyboard.press('ArrowLeft')
  await win.waitForTimeout(250)
  expect(await builds(), '组合结束后重算恢复').toBeGreaterThan(before)
  // 公式毫发无损（光标在它左侧，仍是渲染态）
  expect(await win.evaluate(() => document.querySelectorAll('.katex').length)).toBe(1)
  const text = await win.evaluate(() => document.querySelector('.cm-content')!.textContent)
  expect(text).toContain('你好')
  await app.close()
})

test('⑥ 剪贴板：复制双格式，粘贴智能转换，⌘⇧V 逃生舱', async () => {
  const { app, win } = await boot('**加粗文本** 与 [链接](https://a.b)\n\n尾\n')
  // 全选复制
  await win.keyboard.press(`${mod}+a`)
  await win.keyboard.press(`${mod}+c`)
  await win.waitForTimeout(300)
  const clip = await app.evaluate(({ clipboard }) => ({
    text: clipboard.readText(),
    html: clipboard.readHTML(),
  }))
  expect(clip.text).toContain('**加粗文本**') // plain = md 源码
  expect(clip.html).toContain('<strong>') // html = 渲染态
  expect(clip.html).toContain('href="https://a.b"')

  // 粘贴转换：往剪贴板放 HTML，粘贴进来变 md
  await app.evaluate(({ clipboard }) => {
    clipboard.write({ text: 'plain fallback', html: '<h2>标题</h2><p><em>斜体</em>正文</p>' })
  })
  await win.keyboard.press(`${mod}+ArrowDown`)
  await win.keyboard.press(`${mod}+v`)
  await win.waitForTimeout(300)
  // 断言 DOM 特征而不是 textContent——粘进来的 "## 标题" 立即被装饰成 h2、标记隐藏，
  // textContent 里看不到 "##"。**这正是转换成功的证据**：HTML → md → 立即 live preview。
  const pasted = await win.evaluate(() => ({
    h2: document.querySelectorAll('.cm-md-h2').length,
    text: document.querySelector('.cm-content')!.textContent,
  }))
  expect(pasted.h2).toBeGreaterThan(0)
  expect(pasted.text).toContain('斜体正文')

  // ⌘⇧V：同一份剪贴板，纯文本原样进
  await win.keyboard.press(`${mod}+Shift+v`)
  await win.waitForTimeout(300)
  const afterPlain = await win.evaluate(() => document.querySelector('.cm-content')!.textContent)
  expect(afterPlain).toContain('plain fallback')
  await app.close()
})

test('⑦ 查找替换：⌘F 计数、替换后字节符合预期', async () => {
  const { app, win, page } = await boot('甲 乙 甲 丙 甲\n')
  await win.keyboard.press(`${mod}+f`)
  await win.waitForSelector('.sepia-search')
  await win.keyboard.type('甲')
  await win.waitForTimeout(300)
  const count = await win.evaluate(() => document.querySelector('.sepia-search-count')?.textContent)
  expect(count).toBe('3')
  await evidence(win, `${EVIDENCE}/a7-search.png`)
  // 关掉查找，开替换
  await win.keyboard.press('Escape')
  await win.keyboard.press(`${mod}+Alt+f`)
  await win.waitForSelector('.sepia-search')
  const inputs = win.locator('.sepia-search-input')
  await inputs.first().fill('甲')
  await inputs.nth(1).fill('X')
  await win.waitForTimeout(200)
  await win.locator('.sepia-search button', { hasText: '全部替换' }).click()
  await win.waitForTimeout(300)
  await win.keyboard.press('Escape')
  await win.keyboard.press(`${mod}+s`)
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 5000 }).toBe('X 乙 X 丙 X\n')
  await app.close()
})

test('⑧ 撤销链：编辑→撤销→重做，字节与装饰复原', async () => {
  const original = '# 标题\n\n$E=mc^2$\n'
  const { app, win, page } = await boot(original)
  const katex = (): Promise<number> => win.evaluate(() => document.querySelectorAll('.katex').length)
  expect(await katex()).toBe(1)
  await win.keyboard.type('新字')
  await win.waitForTimeout(200)
  await win.keyboard.press(`${mod}+z`)
  await win.waitForTimeout(200)
  await win.keyboard.press(`${mod}+s`)
  await expect.poll(async () => readFile(page, 'utf8'), { timeout: 5000 }).toBe(original)
  expect(await katex(), '撤销后装饰状态复原').toBe(1)
  // 重做
  await win.keyboard.press(`${mod}+Shift+z`)
  await win.waitForTimeout(200)
  const text = await win.evaluate(() => document.querySelector('.cm-content')!.textContent)
  expect(text).toContain('新字')
  await app.close()
})

test('a9 长文性能：2 万字全语法文档的输入与滚动', async () => {
  const para = '这是一段用来撑长文的正文，含 **加粗** 与 `代码`，再加一点 $x$ 公式。\n\n'
  const long = `# 长文\n\n${para.repeat(280)}` // ≈2 万字
  const { app, win } = await boot(long, { cursor: 10 })

  const typed = 20
  const start = Date.now()
  await win.keyboard.type('性能测试输入的一串字符五个'.repeat(2).slice(0, typed), { delay: 0 })
  const perChar = (Date.now() - start) / typed
  // 预算：首周标定。本机基线量得 perChar ≈ 10ms 级；上限给 60ms（CI runner 慢 4-8 倍）
  expect(perChar, `每字符输入耗时 ${perChar.toFixed(1)}ms`).toBeLessThan(60)

  const frames = await win.evaluate(async () => {
    const scroller = document.querySelector('.cm-scroller')!
    const deltas: number[] = []
    let last = performance.now()
    const tick = (): void => {
      const now = performance.now()
      deltas.push(now - last)
      last = now
      if (deltas.length < 40) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    for (let i = 0; i < 20; i++) {
      scroller.scrollTop += 800
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    deltas.sort((a, b) => a - b)
    return { p90: deltas[Math.floor(deltas.length * 0.9)] ?? 0 }
  })
  // 标定记录（130 §1.4 #8「实施首周标定后写死」）：静时实测 P90≈33-37ms，
  // 负载 6+ 时见过 46.5ms。写死 55ms——它抓的是"装饰把滚动拖垮"这个量级
  // （RV⑧ 塞 60ms 忙等时 P90 直接过百），不抓机器忙闲的 10ms 抖动。
  // 帧预算同属校准断言（见 cold-start.spec.ts 的注释）；每字符输入的 60ms
  // 上限余量巨大（实测 10.2ms），保持常开。
  if (!process.env['CI'] && process.env['SEPIA_PERF_ASSERT']) {
    expect(frames.p90, `滚动帧间隔 P90=${frames.p90.toFixed(1)}ms`).toBeLessThan(55)
  }
  process.stdout.write(`sepia-longdoc: perChar=${perChar.toFixed(1)}ms frameP90=${frames.p90.toFixed(1)}ms\n`)
  await app.close()
})

test('a11 只读目录回归：保存失败可见、不假装成功', async () => {
  const { app, win, page, home } = await boot('原文\n')
  await win.keyboard.type('改')
  await chmod(home, 0o555)
  try {
    await win.keyboard.press(`${mod}+s`)
    await win.waitForSelector('.sepia-error', { timeout: 5000 })
    const title = await win.title()
    expect(title.startsWith('• '), '脏标记必须还在').toBe(true)
    expect(await readFile(page, 'utf8')).toBe('原文\n')
  } finally {
    await chmod(home, 0o755)
  }
  await app.close()
})
