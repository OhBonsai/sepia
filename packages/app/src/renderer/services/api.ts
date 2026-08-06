import type { FileNotice, IoResult, RefCandidate, ResolvedTheme, SessionState, Thread, TreeScan } from '@sepia/core'

// 纪律 1：**组件不得 import window.api**。整个 renderer 里只有这个文件碰它。
// lint 规则盯着 `renderer/` 下除本文件与 agent-bridge.ts 之外的所有位置。

interface Bridge {
  app: { platform: string; versions: Record<string, string> }
  file: {
    read(path: string): Promise<IoResult<string>>
    write(
      path: string,
      content: string,
      options?: { markupPair?: boolean },
    ): Promise<IoResult<{ commits: { before: string; after: string } | null }>>
  }
  dialog: { openMarkdown(): Promise<string | null>; openDirectory(): Promise<string | null> }
  library: {
    scan(dir: string): Promise<IoResult<TreeScan>>
    recents(dir: string, page?: string): Promise<IoResult<string[]>>
    titles(dir: string, items: RefCandidate[]): Promise<IoResult<RefCandidate[]>>
  }
  files: {
    create(path: string, content: string): Promise<IoResult<string>>
    rename(from: string, to: string): Promise<IoResult<string>>
    move(from: string, directory: string): Promise<IoResult<string>>
    trash(path: string): Promise<IoResult<void>>
    importImage(source: string, book: string): Promise<IoResult<string>>
    updateLinks(
      book: string,
      from: string,
      to: string,
      apply: boolean,
    ): Promise<IoResult<{ files: { page: string; count: number }[]; total: number }>>
    onExternalChange(cb: (notice: FileNotice) => void): () => void
  }
  threads: {
    load(directory: string): Promise<IoResult<Thread[]>>
    save(directory: string, threads: Thread[]): Promise<IoResult<void>>
  }
  git: {
    diff(directory: string, before: string, after: string, page: string): Promise<IoResult<string | null>>
  }
  session: { get(): Promise<SessionState>; set(state: SessionState): Promise<void> }
  theme: { get(): Promise<ResolvedTheme>; onChange(cb: (theme: ResolvedTheme) => void): () => void }
  perf: { mark(name: string): void }
}

// harness-exempt: 纪律 1 api.ts 是 window.api 之上的唯一封装，这里正是那个唯一出口
const bridge = (globalThis as unknown as { api: Bridge }).api

export const api = {
  readFile: (path: string) => bridge.file.read(path),
  writeFile: (path: string, content: string, options?: { markupPair?: boolean }) =>
    bridge.file.write(path, content, options),
  openMarkdown: () => bridge.dialog.openMarkdown(),
  openDirectory: () => bridge.dialog.openDirectory(),
  scanLibrary: (dir: string) => bridge.library.scan(dir),
  /** 传 page = 打开了它（置顶）；不传 = 纯读。 */
  libraryRecents: (dir: string, page?: string) => bridge.library.recents(dir, page),
  libraryTitles: (dir: string, items: RefCandidate[]) => bridge.library.titles(dir, items),
  createFile: (path: string, content = '') => bridge.files.create(path, content),
  renameFile: (from: string, to: string) => bridge.files.rename(from, to),
  moveFile: (from: string, directory: string) => bridge.files.move(from, directory),
  trashFile: (path: string) => bridge.files.trash(path),
  importImage: (source: string, book: string) => bridge.files.importImage(source, book),
  updateLinks: (book: string, from: string, to: string, apply: boolean) =>
    bridge.files.updateLinks(book, from, to, apply),
  onExternalChange: (cb: (notice: FileNotice) => void) => bridge.files.onExternalChange(cb),
  loadThreads: (directory: string) => bridge.threads.load(directory),
  saveThreads: (directory: string, threads: Thread[]) => bridge.threads.save(directory, threads),
  /** 徽章的 diff 从 git 取（D-08）。取不到是 `null`——那是"看不了对照"，不是错误。 */
  gitDiff: (directory: string, before: string, after: string, page: string) =>
    bridge.git.diff(directory, before, after, page),
  getSession: () => bridge.session.get(),
  setSession: (state: SessionState) => bridge.session.set(state),
  getTheme: () => bridge.theme.get(),
  onThemeChange: (cb: (theme: ResolvedTheme) => void) => bridge.theme.onChange(cb),
  perfMark: (name: 't4' | 't5') => bridge.perf.mark(name),
}
