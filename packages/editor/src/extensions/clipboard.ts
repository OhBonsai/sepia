import { EditorView, keymap } from '@codemirror/view'
import { Prec, type Extension } from '@codemirror/state'
// 仅类型：编译期擦除，不进 bundle——运行时经下面的动态 import 惰性加载
import type TurndownService from 'turndown'

// 剪贴板双格式与智能粘贴（T-28）。
//
//   复制：text/plain 放 md 源码（给代码、终端、别的编辑器），
//         text/html 放渲染态（粘进公众号/Word 直接是富文本——发文场景的刚需）。
//   粘贴：剪贴板含 HTML → 转成 md 插入；只有纯文本 → 原样。
//         ⌘⇧V 是"粘贴为纯文本"的逃生舱。
//   **转换只产生新字节，不改写已有内容**——不触碰不变量 2。
//
// 全部经 DOM ClipboardEvent 在 renderer 内完成，**不走 Electron clipboard API**，
// 所以 preload 暴露面零增长（130 §1.4 的预先声明兑现）。

// marked / turndown **惰性预取**（001 §4.7）：扩展创建时（编辑器已挂载、不挡 t3）
// 开始异步加载。copy 事件要求同步写 clipboardData——预取没到位的极早期复制只带
// text/plain，一秒之内的窗口，可接受；paste 天然可异步，不受影响。
type Marked = typeof import('marked').marked
type Turndown = TurndownService
let markedModule: Marked | null = null
let turndownInstance: Turndown | null = null

function prefetchConverters(): void {
  if (!markedModule) {
    void import('marked').then((mod) => {
      markedModule = mod.marked
    })
  }
  if (!turndownInstance) {
    void import('turndown').then((mod) => {
      turndownInstance = new mod.default({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        emDelimiter: '*',
      })
    })
  }
}

async function toMarkdown(html: string): Promise<string> {
  if (!turndownInstance) {
    const mod = await import('turndown')
    turndownInstance ??= new mod.default({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
    })
  }
  return turndownInstance.turndown(html)
}

/** 取选区的 md 源码。必须走 sliceDoc（保换行风格），不许 doc.toString。 */
function selectedMarkdown(view: EditorView): string {
  const { state } = view
  return state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join(state.lineBreak)
}

function writeBoth(event: ClipboardEvent, md: string): void {
  if (!event.clipboardData) return
  event.preventDefault()
  event.clipboardData.setData('text/plain', md)
  if (markedModule) {
    event.clipboardData.setData('text/html', String(markedModule.parse(md, { async: false })))
  }
}

export function clipboardExtension(): Extension {
  prefetchConverters()
  return [
    Prec.high(
      keymap.of([
        {
          key: 'Mod-Shift-v',
          run: (view) => {
            // 逃生舱自己动手读剪贴板插入纯文本。不能走"标志位 + 放行系统 paste"：
            // ⌘⇧V 在 Chromium 里不派发 paste 事件（它是编辑命令不是粘贴键），
            // 标志位会永远等不到那个事件——smoke ⑥ 抓出来的。
            void navigator.clipboard.readText().then((text) => {
              if (text) view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true })
            })
            return true
          },
        },
      ]),
    ),
    EditorView.domEventHandlers({
      copy(event, view) {
        const md = selectedMarkdown(view)
        if (md) writeBoth(event, md)
      },
      cut(event, view) {
        const md = selectedMarkdown(view)
        if (!md) return
        writeBoth(event, md)
        view.dispatch(view.state.replaceSelection(''))
      },
      paste(event, view) {
        const data = event.clipboardData
        if (!data) return
        const html = data.getData('text/html')
        if (!html) return // 交给 CM6 默认粘贴（纯文本原样）

        // HTML → md 的转换可以异步：同步截住事件，转换完成再插入。
        event.preventDefault()
        void toMarkdown(html).then((md) => {
          view.dispatch(view.state.replaceSelection(md), { scrollIntoView: true })
        })
        return true
      },
    }),
  ]
}
