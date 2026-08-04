import { nativeTheme } from 'electron'

import type { ResolvedTheme, ThemeMode } from '@sepia/core'

// **主题的真相在 main**（架构 §2.2），renderer 只消费。
//
// 纪律 13：主题首帧前注入，窗口带 backgroundColor。两者必须**由同一份真相派生**——
// Stage 0 那个写死在 create.ts 里的二元判断就是在这里被替换掉的。
//
// 背景色的字面值只在这一处出现，且必须与 @sepia/ui 的 theme.css 里
// `--sepia-paper` 的两个取值一致。它没法从 CSS 里读——窗口在任何 CSS 加载之前
// 就要有底色，否则先白一下再变暗，正砸在「白纸秒开」的观感上。

// Stage 2 起取值随 Flexoki 映射（130 风格裁决）：paper / black。
const PAPER = { light: '#fffcf0', dark: '#100f0f' } as const

let mode: ThemeMode = 'system'
const listeners = new Set<(theme: ResolvedTheme) => void>()

export function setMode(next: ThemeMode): void {
  mode = next
  // nativeTheme.themeSource 让 Electron 自己也跟着走，原生控件才不会与纸面打架
  nativeTheme.themeSource = next
  emit()
}

export function resolved(): ResolvedTheme {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

export function backgroundColor(): string {
  return PAPER[resolved()]
}

export function onChange(listener: (theme: ResolvedTheme) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(): void {
  const theme = resolved()
  for (const listener of listeners) listener(theme)
}

nativeTheme.on('updated', emit)
