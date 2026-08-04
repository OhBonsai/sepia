import { WidgetType } from '@codemirror/view'

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

function parseTableRow(line: string): string[] {
  const cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/)
  return cells.map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

export class TableWidget extends SourceWidget {
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
        // textContent 而不是 innerHTML：单元格内不渲染 HTML——D 类"任意 HTML 不渲染"
        // 的安全判断（架构 §4.4）在 widget 内同样成立。
        el.textContent = cell
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
      src = `file://${this.assetBase}/${src}`
    }
    img.src = src
    img.alt = this.alt
    // 加载失败退回 alt 文本框——dev 服务器下 file:// 子资源会被 Chromium 拒载，
    // 这是已知限制，真正的解法是自定义特权 scheme（001 §3.1，Stage 6 随文件域一起）。
    img.addEventListener('error', () => {
      wrap.classList.add('sepia-image-broken')
      wrap.textContent = this.alt || this.src
    })
    wrap.append(img)
    return wrap
  }
}

export class TextDiagramWidget extends SourceWidget {
  override toDOM(): HTMLElement {
    const pre = document.createElement('pre')
    pre.className = 'sepia-textdiagram'
    // 去掉围栏行，只显示图体
    pre.textContent = this.source
      .split(/\r\n|\r|\n/)
      .slice(1, -1)
      .join('\n')
    return pre
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
