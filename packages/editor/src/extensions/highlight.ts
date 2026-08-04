import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// 语法高亮 → 主题变量的映射。**这里只有 var(--…)，一个字面色值都没有**（纪律 3）——
// 色值住在 @sepia/ui 的调色板里（Flexoki 映射，亮暗双版），本文件与它共享变量名、
// 不共享代码（editor ↮ ui，在语法色板上第二次受考验）。
//
// Stage 4 引入 Shiki 时，check:theme 对照的"同源真相"就是这组变量名。

export const sepiaHighlight = HighlightStyle.define([
  // markdown 结构
  { tag: t.heading, color: 'var(--sepia-ink)', fontWeight: '650' },
  { tag: t.processingInstruction, color: 'var(--sepia-syn-mark)' },
  { tag: t.labelName, color: 'var(--sepia-syn-mark)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '650' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--sepia-syn-link)' },
  { tag: t.url, color: 'var(--sepia-syn-link)' },
  { tag: t.monospace, color: 'var(--sepia-syn-code)' },
  { tag: t.quote, color: 'var(--sepia-ink-muted)' },
  { tag: t.contentSeparator, color: 'var(--sepia-syn-mark)' },
  { tag: t.special(t.content), color: 'var(--sepia-syn-math)' },

  // 代码高亮（围栏代码块经 language-data 惰性解析后打这些 tag）
  { tag: t.keyword, color: 'var(--sepia-syn-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--sepia-syn-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--sepia-syn-constant)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--sepia-syn-function)' },
  { tag: t.comment, color: 'var(--sepia-ink-muted)', fontStyle: 'italic' },
  { tag: [t.typeName, t.className], color: 'var(--sepia-syn-type)' },
  { tag: t.propertyName, color: 'var(--sepia-syn-property)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--sepia-syn-tag)' },
  { tag: t.attributeName, color: 'var(--sepia-syn-attribute)' },
  { tag: [t.operator, t.punctuation], color: 'var(--sepia-ink-muted)' },
  { tag: t.invalid, color: 'var(--sepia-danger)' },
])
