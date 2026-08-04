// 主题变量表。**CSS 自定义属性是唯一真相**（架构 §4.4）。
//
// 这里只放变量名，不放色值——色值全在 theme.css 里，那是调色板的唯一住址。
// CM6 的主题也写这些同名 `var(...)`，但 `editor ↮ ui` 是刻意不连线：
// 两侧共享的是**变量名**，不是代码。改名字要两边一起改，这是有意的摩擦。

/** 只有 `var(--…)` 形状的字符串能当色值用。写 `#fff` 赋不进来。 */
export type ThemeVar = `var(--${string})`

export const themeVar = {
  /** 纸面背景 */
  paper: 'var(--sepia-paper)',
  /** 正文墨色 */
  ink: 'var(--sepia-ink)',
  /** 弱化的墨色：占位符、次要信息 */
  inkMuted: 'var(--sepia-ink-muted)',
  /** 分隔线 */
  rule: 'var(--sepia-rule)',
  /** 选区背景 */
  selection: 'var(--sepia-selection)',
  /** 光标 */
  caret: 'var(--sepia-caret)',
  /** 出错时的强调色 */
  danger: 'var(--sepia-danger)',
} as const satisfies Record<string, ThemeVar>

export type ThemeVarName = keyof typeof themeVar
