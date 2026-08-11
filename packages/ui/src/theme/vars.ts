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
  /** 比纸面深一档的面：行内代码底、代码块底、表头 */
  surface: 'var(--sepia-surface)',
  /** 选区背景 */
  selection: 'var(--sepia-selection)',
  /** 光标 */
  caret: 'var(--sepia-caret)',
  /** 出错时的强调色 */
  danger: 'var(--sepia-danger)',
  /** 浮层背后的压暗层（⌘/ 看板）。**不是纯黑半透**——纸的暗层也该带纸的味道 */
  scrim: 'var(--sepia-scrim)',
  /** 角标/强调用的橙。Flexoki orange，与 synFunction 同值但语义不同——
      一个是"这是函数名"，一个是"这里有更新"，不该互相借用。 */
  orange: 'var(--sepia-orange)',

  // 语法色板（Flexoki accent 映射；Stage 4 check:theme 的同源真相）
  synMark: 'var(--sepia-syn-mark)',
  synLink: 'var(--sepia-syn-link)',
  synCode: 'var(--sepia-syn-code)',
  synMath: 'var(--sepia-syn-math)',
  synKeyword: 'var(--sepia-syn-keyword)',
  synString: 'var(--sepia-syn-string)',
  synConstant: 'var(--sepia-syn-constant)',
  synFunction: 'var(--sepia-syn-function)',
  synType: 'var(--sepia-syn-type)',
  synProperty: 'var(--sepia-syn-property)',
  synTag: 'var(--sepia-syn-tag)',
  synAttribute: 'var(--sepia-syn-attribute)',
} as const satisfies Record<string, ThemeVar>

export type ThemeVarName = keyof typeof themeVar
