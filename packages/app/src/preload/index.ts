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

// markup 的两个配置项走**与主题同一条路**：argv → 根节点属性，renderer 读属性。
// 刻意不在 `api` 上开 key——桥恰好八项是 150 §1.3 的申报值，而这两个值开机即定死
// （MVP 没有设置 UI，改 config.json 本来就要重启），够不上一个永久暴露面。
const markupParams = process.argv.find((arg) => arg.startsWith('--sepia-markup='))?.slice('--sepia-markup='.length)

if (markupParams !== undefined) {
  const apply = (): void => document.documentElement.setAttribute('data-sepia-markup', markupParams)
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
    /** `options.markupPair` = 用成对 commit 夹住这次写（5b 落笔链）。**不是新 key**。 */
    write: (path: string, content: string, options?: { markupPair?: boolean }) =>
      ipcRenderer.invoke('file/write', path, content, options),
  },
  dialog: {
    openMarkdown: () => ipcRenderer.invoke('dialog/open-markdown'),
    /** 选一个文件夹作 book（主页两条路之一，§2.1 ③）。 */
    openDirectory: () => ipcRenderer.invoke('dialog/open-directory'),
  },
  // files 域（Stage 6a，170 §1.3 申报值 = 恰好这五项）。
  // 四个动作 + 一个订阅：外部变更与 watcher 降级共用 `onExternalChange`，
  // 因为它们是同一件事的两种事实（纸与外部世界不同步了），分两个 key 只是把
  // 同一个消费者拆成两半。**这里没有 read/write**——读写仍走 `file.*`，
  // 文件管理不许成为第二条写正文的通道（不变量 3 的形态防线）。
  files: {
    create: (path: string, content: string) => ipcRenderer.invoke('files/create', path, content),
    rename: (from: string, to: string) => ipcRenderer.invoke('files/rename', from, to),
    move: (from: string, directory: string) => ipcRenderer.invoke('files/move', from, directory),
    trash: (path: string) => ipcRenderer.invoke('files/trash', path),
    /** 收一张图进 book（§2.1 ⑤）。只增不改。 */
    importImage: (name: string, bytes: Uint8Array, book: string) =>
      ipcRenderer.invoke('files/import-image', name, bytes, book),
    /** 更新链接（§2.1 ⑥）。`apply=false` 只查不改——**改不改由用户点那一下决定**。 */
    updateLinks: (book: string, from: string, to: string, apply: boolean) =>
      ipcRenderer.invoke('files/update-links', book, from, to, apply),
    onExternalChange: (callback: (notice: unknown) => void) => {
      const listener = (_event: unknown, notice: unknown): void => callback(notice)
      ipcRenderer.on('files/external-change', listener)
      return () => ipcRenderer.removeListener('files/external-change', listener)
    },
  },
  // threads 域（Stage 5b，160 §2.3 申报值 = 恰好这两项 + git.diff 一项）。
  // **没有 delete**：删除是 save 一份不含它的表——少一个通道少一处不变量。
  threads: {
    load: (directory: string) => ipcRenderer.invoke('threads/load', directory),
    save: (directory: string, threads: unknown[]) => ipcRenderer.invoke('threads/save', directory, threads),
  },
  // 徽章的 diff 从 git 取（D-08），renderer 不存第二份正文。**只读，没有写路径**。
  git: {
    diff: (directory: string, before: string, after: string, page: string) =>
      ipcRenderer.invoke('git/diff', directory, before, after, page),
  },
  // library 域（Stage 6b，170 §2.3 申报值）。**只读**：扫描、最近、标题补建，
  // 没有任何写路径——文件操作仍走 files 域（不变量 3 的形态防线）。
  library: {
    scan: (dir: string) => ipcRenderer.invoke('library/scan', dir),
    recents: (dir: string, page?: string) => ipcRenderer.invoke('library/recents', dir, page),
    titles: (dir: string, items: unknown[]) => ipcRenderer.invoke('library/titles', dir, items),
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
  // agent 域（Stage 3，140 §1.3）：五方法透传 + 状态订阅 + 事件订阅，**恰好这些**。
  // 通路形态已裁为 main 代理——端点与 token 不进 renderer；check:bridge 的不变量级
  // 子条（不变量 3/4）断言这个域恰好是这份清单、且不含任何写路径通道。
  agent: {
    openThread: (directory: string) => ipcRenderer.invoke('agent/open-thread', directory),
    send: (threadId: string, parts: unknown[], options: unknown) =>
      ipcRenderer.invoke('agent/send', threadId, parts, options),
    stream: (directory: string) => ipcRenderer.invoke('agent/stream', directory),
    interrupt: (threadId: string, directory: string) => ipcRenderer.invoke('agent/interrupt', threadId, directory),
    listModels: () => ipcRenderer.invoke('agent/list-models'),
    status: () => ipcRenderer.invoke('agent/status'),
    onStatusChange: (callback: (status: string) => void) => {
      const listener = (_event: unknown, next: string): void => callback(next)
      ipcRenderer.on('agent/status-changed', listener)
      return () => ipcRenderer.removeListener('agent/status-changed', listener)
    },
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, next: unknown): void => callback(next)
      ipcRenderer.on('agent/event', listener)
      return () => ipcRenderer.removeListener('agent/event', listener)
    },
  },
}

export type SepiaBridge = typeof api

contextBridge.exposeInMainWorld('api', api)
