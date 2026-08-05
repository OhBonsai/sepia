import { themeVar } from '@sepia/ui'

// Shiki 主题：**TextMate scope → 与 CM6 同一批 CSS 变量**（纪律 14）。
//
// 原计划是「Shiki 双主题输出，再比对两份色板」。实探（150 §1.8 风险 2）发现根本不用：
// Shiki 的 theme settings 里 `foreground` 接受**任意字符串**，直接写 `var(--sepia-*)`
// 就会原样吐进 token 的 color。于是——
//
//   · 这不是「两处代码同色」，是**两处代码用同一个变量**。色值仍然只住 theme.css 一处。
//   · 亮暗切换由 CSS 变量自己完成：**不需要双主题、不需要 .dark 选择器、不需要重新高亮**。
//   · 这里一个字面色值都没有，纪律 3 天然满足（不必打豁免、不必把文件挪出扫描范围）。
//
// 强制手段是**类型**：`foreground` 的类型是 `themeVar` 的值联合，写一个不存在的
// 变量名编译不过。`check:theme` 再守另一半——变量名在 theme.css 里真的有定义。

/** `themeVar` 的值联合。写 `var(--随便什么)` 赋不进来。 */
type SepiaVar = (typeof themeVar)[keyof typeof themeVar]

interface ScopeRule {
  /**
   * **逗号分隔的字符串，不是数组。** 实测：写成数组时 Shiki 的 scope 匹配整个失效，
   * 所有 token 退回全局默认色（探针 A/B 对照，§1.8 风险 2 记录）。
   */
  scope: string
  settings: { foreground: SepiaVar; fontStyle?: 'italic' }
}

/**
 * scope 表。对照 `@sepia/editor` 的 `sepiaHighlight`（lezer tag → 同名变量）——
 * 两边语法体系不同（TextMate vs lezer），不可能逐 token 对齐，**但用的是同一批名字**，
 * 这正是纪律 14 要的「同一份色板派生」。
 */
const SCOPES: ScopeRule[] = [
  { scope: 'comment, comment.line, comment.block', settings: { foreground: themeVar.inkMuted, fontStyle: 'italic' } },
  { scope: 'string, string.quoted, string.template', settings: { foreground: themeVar.synString } },
  { scope: 'constant.numeric, constant.language, constant.character', settings: { foreground: themeVar.synConstant } },
  { scope: 'keyword, keyword.control, storage, storage.type, storage.modifier', settings: { foreground: themeVar.synKeyword } },
  { scope: 'entity.name.function, support.function, meta.function-call', settings: { foreground: themeVar.synFunction } },
  { scope: 'entity.name.type, entity.name.class, support.type, support.class', settings: { foreground: themeVar.synType } },
  { scope: 'variable.other.property, meta.object-literal.key, support.variable', settings: { foreground: themeVar.synProperty } },
  { scope: 'entity.name.tag, punctuation.definition.tag', settings: { foreground: themeVar.synTag } },
  { scope: 'entity.other.attribute-name', settings: { foreground: themeVar.synAttribute } },
  { scope: 'markup.underline.link, markup.link', settings: { foreground: themeVar.synLink } },
  { scope: 'invalid, invalid.illegal', settings: { foreground: themeVar.danger } },
]

export const SEPIA_SHIKI_THEME = {
  name: 'sepia',
  type: 'light',
  colors: {
    'editor.foreground': themeVar.ink,
    'editor.background': themeVar.surface,
  },
  // 首条无 scope 的全局默认**不能有**：实测它会吞掉后面所有 scope 规则（探针 A）。
  settings: SCOPES,
} as const

/** 供 `check:theme` 与单测取用：本主题引用到的全部变量名。 */
export const SHIKI_THEME_VARS: readonly string[] = [
  ...new Set([
    ...SCOPES.map((rule) => rule.settings.foreground),
    SEPIA_SHIKI_THEME.colors['editor.foreground'],
    SEPIA_SHIKI_THEME.colors['editor.background'],
  ]),
]
