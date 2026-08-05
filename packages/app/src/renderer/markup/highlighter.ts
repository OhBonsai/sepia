import type { ThemedToken } from 'shiki/core'

import { SEPIA_SHIKI_THEME } from './shiki-theme.ts'

// 代码高亮。**整个模块惰性加载**（纪律 12 / 150 §1.2 冷启动零增量）：
// Shiki 与语言包加起来不小，而它们只在浮层里出现过代码块时才用得上。
// 静态 import 会把它们拖上启动同步路径——Stage 2 的 KaTeX 教训原样适用。
//
// 用 `shiki/core` 的细粒度入口而不是主入口：主入口会把全部语言/主题的
// chunk 索引一起拖进来。这里只装真正用得到的几种语言。

type Highlighter = Awaited<ReturnType<typeof import('shiki/core')['createHighlighterCore']>>

/** MVP 装这几种。加语言 = 加一行 import——加之前先问值不值得那几十 KB。 */
const LANGS = ['typescript', 'javascript', 'json', 'bash', 'python', 'css', 'html'] as const
export type CodeLang = (typeof LANGS)[number]

let pending: Promise<Highlighter> | null = null

/** 单例：整个 renderer 只建一个 highlighter，重复调用复用同一个 Promise。 */
async function ensureHighlighter(): Promise<Highlighter> {
  pending ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, ...langs] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('@shikijs/langs/typescript'),
      import('@shikijs/langs/javascript'),
      import('@shikijs/langs/json'),
      import('@shikijs/langs/bash'),
      import('@shikijs/langs/python'),
      import('@shikijs/langs/css'),
      import('@shikijs/langs/html'),
    ])
    return createHighlighterCore({
      themes: [SEPIA_SHIKI_THEME as never],
      langs: langs.map((mod) => (mod as { default: unknown }).default) as never,
      // forgiving：流式代码块天然是残缺的（`function f(` 还没写完），
      // 严格模式会在半截语法上抛异常，把整条流带崩。
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
  })()
  return pending
}

export function isSupportedLang(lang: string): lang is CodeLang {
  return (LANGS as readonly string[]).includes(lang)
}

/**
 * 把一段代码切成带色 token。**返回 token 而不是 HTML**：
 * `<pre>` 的 fg/bg 不吃主题里的 `var(...)`（实测，§1.8 风险 2 记录），
 * 自己渲染外壳才能做到一个字面色值都不出现（纪律 3）。
 *
 * 高亮失败一律返回 null，由调用方退回纯文本——代码块显示得朴素一点，
 * 远好过整个浮层崩掉（不变量 1 的精神：Agent 那条链路可以降级，纸不受影响）。
 */
export async function highlight(code: string, lang: string): Promise<ThemedToken[][] | null> {
  if (!isSupportedLang(lang)) return null
  try {
    const highlighter = await ensureHighlighter()
    return highlighter.codeToTokens(code, { lang, theme: 'sepia' }).tokens
  } catch {
    return null
  }
}
