import type { IoResult, ResolvedTheme, SessionState } from '@sepia/core'

// 纪律 1：**组件不得 import window.api**。整个 renderer 里只有这个文件碰它。
// lint 规则盯着 `renderer/` 下除本文件与 agent-bridge.ts 之外的所有位置。

interface Bridge {
  app: { platform: string; versions: Record<string, string> }
  file: {
    read(path: string): Promise<IoResult<string>>
    write(path: string, content: string): Promise<IoResult<void>>
  }
  dialog: { openMarkdown(): Promise<string | null> }
  session: { get(): Promise<SessionState>; set(state: SessionState): Promise<void> }
  theme: { get(): Promise<ResolvedTheme>; onChange(cb: (theme: ResolvedTheme) => void): () => void }
  perf: { mark(name: string): void }
}

// harness-exempt: 1 api.ts 是 window.api 之上的唯一封装，这里正是那个唯一出口
const bridge = (globalThis as unknown as { api: Bridge }).api

export const api = {
  readFile: (path: string) => bridge.file.read(path),
  writeFile: (path: string, content: string) => bridge.file.write(path, content),
  openMarkdown: () => bridge.dialog.openMarkdown(),
  getSession: () => bridge.session.get(),
  setSession: (state: SessionState) => bridge.session.set(state),
  getTheme: () => bridge.theme.get(),
  onThemeChange: (cb: (theme: ResolvedTheme) => void) => bridge.theme.onChange(cb),
  perfMark: (name: 't4' | 't5') => bridge.perf.mark(name),
}
