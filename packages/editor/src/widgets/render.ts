import { WidgetType } from '@codemirror/view'

import { assetUrl } from '@sepia/core'

// KaTeX **惰性加载**（001 §4.7：renderer 入口 bundle 保持小，重组件按需）。
// 它有 ~280KB，放进同步路径直接把 t0→t3 从 316ms 顶到 630ms——冷启动 smoke 抓过。
// 模块到位前 widget 先显示源码文本，到位后原地替换成渲染态；替换只动 widget 自己的
// DOM，不产生任何 doc 事务（字节铁律不破）。
type Katex = typeof import('katex').default
let katexModule: Katex | null = null
let katexLoading: Promise<Katex> | null = null

function loadKatex(): Promise<Katex> {
  katexLoading ??= import('katex').then((mod) => {
    katexModule = mod.default
    return mod.default
  })
  return katexLoading
}

function renderMath(el: HTMLElement, body: string, display: boolean): void {
  const paint = (engine: Katex): void => {
    el.innerHTML = engine.renderToString(body, { throwOnError: false, displayMode: display })
  }
  if (katexModule) paint(katexModule)
  else {
    el.textContent = body
    void loadKatex().then((engine) => {
      if (el.isConnected) paint(engine)
    })
  }
}

// C 类块级 widget 的渲染器（L1：失焦渲染，光标进入变回源码——L1 为止，
// 点击单元格编辑那类 L2 交互明确不做，架构 §4.4b）。
//
// 三条铁律，每个 widget 都适用：
//   1. **toDOM 里绝不 dispatch**——装饰只改显示。widget 挂载产生 doc 变更事务
//      就是不变量 2 被破（130 §1.4 #2），smoke a2 端到端守着字节。
//   2. eq() 按源文本判等，源码没变就不重建 DOM——长文性能靠它。
//   3. ignoreEvent 返回 false：点击交还给编辑器 → 光标落进范围 → 揭示回源码。
//      这一下就是 L1 的全部交互。

abstract class SourceWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }

  override eq(other: SourceWidget): boolean {
    return other.constructor === this.constructor && other.source === this.source
  }

  override ignoreEvent(): boolean {
    return false
  }
}

export class MathWidget extends SourceWidget {
  constructor(
    source: string,
    readonly display: boolean,
  ) {
    super(source)
  }

  override eq(other: MathWidget): boolean {
    return super.eq(other) && other.display === this.display
  }

  override toDOM(): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = this.display ? 'sepia-math sepia-math-block' : 'sepia-math'
    // 去掉围栏：行内去 $…$，块级去 $$…$$
    const body = this.display
      ? this.source.replace(/^\$\$\s*/, '').replace(/\s*\$\$\s*$/, '')
      : this.source.replace(/^\$/, '').replace(/\$$/, '')
    renderMath(el, body, this.display)
    return el
  }
}

/**
 * C 类 widget **内部**的行内渲染器（150 §1.9 回流）。
 *
 * 类型定义在这里、实现在 `inline-dom.ts`，是被依赖方向逼出来的：实现要用
 * `buildDecorations`（在 decorate.ts），而 decorate.ts 要用本文件的 widget 类——
 * 实现若也住这儿就成环（结构 2 的 no-circular）。于是本文件只认这个**结构类型**，
 * 实现经 Facet 从总装层注入。
 */
export type InlineRenderer = (text: string) => DocumentFragment

function parseTableRow(line: string): string[] {
  const cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/)
  return cells.map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

export class TableWidget extends SourceWidget {
  constructor(
    source: string,
    /** 注入的行内渲染器。null = 退回 raw 文本（行内不渲染是缺憾，纸面出错才是事故）。 */
    readonly renderInline: InlineRenderer | null = null,
  ) {
    super(source)
  }

  override eq(other: TableWidget): boolean {
    // 渲染器换了人，画出来的东西就不一样——必须进判等，否则换了也不重建
    return super.eq(other) && other.renderInline === this.renderInline
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'sepia-table'
    const rows = this.source.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '')
    if (rows.length < 2) {
      wrap.textContent = this.source
      return wrap
    }

    const aligns = parseTableRow(rows[1]!).map((cell) => {
      const left = cell.startsWith(':')
      const right = cell.endsWith(':')
      if (left && right) return 'center'
      if (right) return 'right'
      return ''
    })

    const table = document.createElement('table')
    const make = (line: string, tag: 'th' | 'td'): HTMLTableRowElement => {
      const tr = document.createElement('tr')
      parseTableRow(line).forEach((cell, i) => {
        const el = document.createElement(tag)
        // 单元格内的**行内** markdown 复用 A 类装饰管线（150 §1.9 回流；走查暴露的
        // 缺陷：网格画了、单元格里 `code` 露反引号、**bold** 露星号）。
        //
        // **仍然绝不 innerHTML**：渲染器交出来的是 DOM 节点，不是 HTML 字符串——
        // D 类「任意 HTML 不渲染」的安全判断（架构 §4.4）在 widget 内同样成立，
        // 单元格里的 `<script>` 依旧只会是六个字符。
        if (this.renderInline === null) el.textContent = cell
        else el.appendChild(this.renderInline(cell))
        const align = aligns[i]
        if (align) el.style.textAlign = align
        tr.append(el)
      })
      return tr
    }
    const thead = document.createElement('thead')
    thead.append(make(rows[0]!, 'th'))
    const tbody = document.createElement('tbody')
    for (const row of rows.slice(2)) tbody.append(make(row, 'td'))
    table.append(thead, tbody)
    wrap.append(table)
    return wrap
  }
}

export class ImageWidget extends SourceWidget {
  constructor(
    source: string,
    readonly alt: string,
    readonly src: string,
    readonly assetBase: string | null,
  ) {
    super(source)
  }

  override eq(other: ImageWidget): boolean {
    return super.eq(other) && other.assetBase === this.assetBase
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'sepia-image'
    const img = document.createElement('img')
    let src = this.src
    if (this.assetBase !== null && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('/')) {
      // **走 `sepia-asset://` 而不是 `file://`**（人裁 2026-08-06）：dev 态 renderer 由
      // `loadURL(http://localhost)` 加载，Chromium 一律拒绝 http 源加载 file:// 子资源，
      // 于是开发时永远看不到预览。特权 scheme 两种加载方式下都成立，
      // 而且 main 侧的处理器只放行已登记根之内的文件——比 file:// 更窄。
      src = assetUrl(`${this.assetBase}/${src}`)
    }
    img.src = src
    img.alt = this.alt
    // 加载失败退回 alt 文本框：路径打错、图被删、或落在可读根之外（403）。
    img.addEventListener('error', () => {
      wrap.classList.add('sepia-image-broken')
      wrap.textContent = this.alt || this.src
    })
    wrap.append(img)
    return wrap
  }
}

/**
 * mermaid **惰性加载**，与 KaTeX 同一条理由（001 §4.7 / 纪律 12）：
 * 它比 KaTeX 还大得多，放进同步路径会直接把冷启动顶穿。
 * 模块到位前 widget 先显示图体源码，到位后原地换成真图——
 * 替换只动 widget 自己的 DOM，**不产生任何 doc 事务**（字节铁律不破）。
 */
type Mermaid = typeof import('mermaid').default
let mermaidModule: Mermaid | null = null
let mermaidLoading: Promise<Mermaid> | null = null
let mermaidSeq = 0

function loadMermaid(): Promise<Mermaid> {
  mermaidLoading ??= import('mermaid').then((mod) => {
    const engine = mod.default
    // 主题从**计算样式**里读 `--sepia-*`（架构 §4.4：色板只有一份真相）。
    // 写死一套 mermaid 配色就等于第二份色板，切换亮暗时它不会跟着走。
    const style = getComputedStyle(document.documentElement)
    // **一个字面色值都不写**（纪律 3）：写兜底就等于在这儿藏了第二份色板，
    // 而它永远不会跟着主题走。取不到就不传，让 mermaid 用它自己的默认——
    // 取不到本身是 theme.css 出了问题，该在那儿修，不该在这儿补。
    const read = (name: string): string => style.getPropertyValue(name).trim()
    engine.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      fontFamily: 'inherit',
      theme: 'base',
      themeVariables: {
        background: read('--sepia-paper'),
        primaryColor: read('--sepia-surface'),
        primaryTextColor: read('--sepia-ink'),
        primaryBorderColor: read('--sepia-rule'),
        lineColor: read('--sepia-ink-muted'),
        textColor: read('--sepia-ink'),
        mainBkg: read('--sepia-surface'),
      },
    })
    mermaidModule = engine
    return engine
  })
  return mermaidLoading
}

export class TextDiagramWidget extends SourceWidget {
  override toDOM(): HTMLElement {
    // **围栏组件统一一张"皮"**（190 P7 校形，照原型的 shader 块壳）：
    //   头部行「语言 · 组件名」左 + 状态右 ｜ 主体 ｜ 底部状态细行
    // shader 实时块按 D-27 排除，这里只取它的壳——于是 textdiagram 与将来的
    // 别的组件长在同一张皮上，不必各画各的框。
    const wrap = document.createElement('div')
    wrap.className = 'sepia-block'
    const head = document.createElement('div')
    head.className = 'sepia-block-head'
    const kind = document.createElement('span')
    kind.className = 'sepia-block-kind'
    kind.textContent = 'textdiagram · 图表'
    const state = document.createElement('span')
    state.className = 'sepia-block-state'
    state.textContent = '失焦渲染'
    head.append(kind, state)
    wrap.append(head)

    const body = document.createElement('div')
    body.className = 'sepia-textdiagram'
    // 去掉围栏行，只留图体
    const source = this.source
      .split(/\r\n|\r|\n/)
      .slice(1, -1)
      .join('\n')
    // 先把源码放上——模块还在路上时，用户至少看得见自己写了什么
    const pre = document.createElement('pre')
    pre.textContent = source
    body.append(pre)
    wrap.append(body)

    const paint = (engine: Mermaid): void => {
      mermaidSeq += 1
      void engine
        .render(`sepia-mmd-${String(mermaidSeq)}`, source)
        .then(({ svg }) => {
          if (!body.isConnected) return
          body.innerHTML = svg
        })
        .catch((error: unknown) => {
          // **渲染失败不崩、也不装作没事**：退回源码 + 一行错，图表语法写错是常事
          if (!body.isConnected) return
          wrap.classList.add('sepia-block-broken')
          state.textContent = '语法有误'
          const note = document.createElement('div')
          note.className = 'sepia-textdiagram-error'
          note.textContent = error instanceof Error ? error.message : String(error)
          body.append(note)
        })
    }

    if (mermaidModule) paint(mermaidModule)
    else void loadMermaid().then(paint)
    return wrap
  }
}

export class HrWidget extends SourceWidget {
  override toDOM(): HTMLElement {
    const hr = document.createElement('hr')
    hr.className = 'sepia-hr'
    return hr
  }
}

export class BulletWidget extends SourceWidget {
  override toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'sepia-bullet'
    el.textContent = '•'
    return el
  }
}

export class CheckboxWidget extends SourceWidget {
  constructor(readonly checked: boolean) {
    super(checked ? 'x' : ' ')
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = `sepia-checkbox${this.checked ? ' sepia-checkbox-on' : ''}`
    el.textContent = this.checked ? '☑' : '☐'
    return el
  }
}
