import { contextBridge, ipcRenderer } from 'electron'

// 纪律 2：这是 renderer 与 main 之间唯一的桥。
// 这里每加一个 key，都要同步更新 scripts/bridge-snapshot.json，
// 否则 `bun run check:bridge` 会红——目的就是让暴露面的增长必须出现在 diff 里。

// 首帧主题：由 main 经 additionalArguments 同步传进来，**不走 IPC**。
// IPC 是异步的，天然晚于首帧；而纪律 13 要求主题在首帧之前就位。
// 这里只是"显式覆盖"那一档——跟随系统的默认值由 theme.css 的
// `@media (prefers-color-scheme)` 在首帧直接给出，连 JS 都不必等。
const initialTheme = process.argv.find((arg) => arg.startsWith('--sepia-theme='))?.slice('--sepia-theme='.length)

if (initialTheme === 'light' || initialTheme === 'dark') {
  const apply = (): void => document.documentElement.setAttribute('data-theme', initialTheme)
  if (document.documentElement) apply()
  else document.addEventListener('DOMContentLoaded', apply, { once: true })
}

const api = {
  app: {
    platform: process.platform,
    versions: {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
    },
  },
  file: {
    read: (path: string) => ipcRenderer.invoke('file/read', path),
    /** ⌘S 全文保存专用。Stage 4 的落笔走独立的区间写通道，不许复用这条。 */
    write: (path: string, content: string) => ipcRenderer.invoke('file/write', path, content),
  },
  dialog: {
    openMarkdown: () => ipcRenderer.invoke('dialog/open-markdown'),
  },
  session: {
    get: () => ipcRenderer.invoke('session/get'),
    set: (state: unknown) => ipcRenderer.invoke('session/set', state),
  },
  theme: {
    get: () => ipcRenderer.invoke('theme/get'),
    onChange: (callback: (theme: string) => void) => {
      const listener = (_event: unknown, next: string): void => callback(next)
      ipcRenderer.on('theme/changed', listener)
      return () => ipcRenderer.removeListener('theme/changed', listener)
    },
  },
  perf: {
    mark: (name: string) => ipcRenderer.send('perf/mark', name),
  },
}

export type SepiaBridge = typeof api

contextBridge.exposeInMainWorld('api', api)
