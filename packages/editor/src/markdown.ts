// KaTeX 的 css 跟着**本惰性 chunk**走（vite 对 async chunk 的 css 自动注入）。
// 放在 styles.css（首屏 @import）会让 150KB 的 css 解析 + 字体准备挡在首帧前——
// A.3 减肥方向 ① 的落地。
import 'katex/dist/katex.min.css'

import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import type { Extension } from '@codemirror/state'

import { clipboardExtension } from './extensions/clipboard.ts'
import { assetBase, decoratePlugin, inlineRenderer } from './extensions/decorate.ts'
import { sepiaHighlight } from './extensions/highlight.ts'
import { mathSyntax } from './extensions/math-syntax.ts'
import { searchApi, searchExtension } from './extensions/search.ts'
import { renderInline } from './widgets/inline-dom.ts'

export { searchApi }

// Stage 2 的总装：markdown 语言 + A/B/C/D 装饰 + 高亮 + 剪贴板 + 查找替换。
// baseExtensions（纯文本最小集）保持不动——两层分开，Stage 1 的一切照旧成立。
//
// 语言包经 @codemirror/language-data **惰性加载**：languages 只是描述表，
// 真正的语言模块在围栏代码块首次出现该语言时才动态 import（vite 自动分包）。
// 没有"装哪些"的白名单——惰性即是刹车，清单外的语言呈现为无高亮纯文本，不算缺陷。

export interface MarkdownOptions {
  /** 图片相对路径的解析基（page 所在目录）。不传则相对路径原样交给 img。 */
  assetBase?: string
}

export function markdownExtensions(options: MarkdownOptions = {}): Extension[] {
  return [
    markdown({
      base: markdownLanguage, // commonmark + GFM（表格/任务列表/删除线/自动链接）
      codeLanguages: languages,
      extensions: [mathSyntax],
    }),
    syntaxHighlighting(sepiaHighlight),
    assetBase.of(options.assetBase ?? null),
    // C 类 widget 内部的行内渲染器（150 §1.9 回流）。注入点在总装层，是依赖方向
    // 逼出来的——见 decorate.ts 上 `inlineRenderer` 的说明。
    inlineRenderer.of(renderInline),
    decoratePlugin(),
    clipboardExtension(),
    searchExtension(),
  ]
}
