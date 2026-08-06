import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  EMPTY_SESSION,
  type RefCandidate,
  closeTab,
  createAnchor,
  markupReport,
  openTab,
  tabPath,
  tabRelative,
  updateTab,
  type EngineStatus,
  type MarkupRun,
  type SessionState,
  type Thread,
  type ThreadView,
  t,
} from '@sepia/core'
import {
  type MountedEditor,
  type SearchApi,
  type TextFidelity,
  readFidelity,
  writeFidelity,
} from '@sepia/editor'
import { Loading, SearchPanel } from '@sepia/ui'

import { EditorHost } from '../editor/host.tsx'
import { useFiles } from '../files/index.ts'
import { markupConfig } from '../markup/config.ts'
import { nearbyBlocks } from '../markup/nearby.ts'

// 浮层**整体惰性加载**（纪律 12 / 150 §1.2 冷启动零增量）：
// 它连着 remend 与 Shiki，静态 import 会把它们全部拖进启动 bundle——
// Stage 2 的 KaTeX 教训原样适用。构建产物里它是独立 chunk，冷启动一个字节都不多。
const MarkupPanel = lazy(async () => ({ default: (await import('../markup/panel.tsx')).MarkupPanel }))
import { createAutosave, type Autosave } from '../services/autosave.ts'
import { FileTree } from '../library/tree.tsx'
import { Home } from '../library/home.tsx'
import { RefPicker, refLink } from '../library/refs.tsx'
import { createThreadStore, type ThreadStore } from '../threads/index.ts'
import { ThreadPanel } from '../threads/panel.tsx'
import { execute, registerCommand } from '../commands/registry.ts'
import { agent } from '../services/agent-bridge.ts'
import { api } from '../services/api.ts'

// Stage 1 的 shell：读上次的 page、挂 CM6、⌘S 保存。
// Stage 3 只加两样（W12，克制）：Agent 缺席的顶部细提示线 + ⌘K 的状态文案。
// 真浮层、路由、布局、多 Tab、主页与 onboarding 都归后面的 stage。

interface Page {
  path: string
  body: string
  fidelity: TextFidelity
  cursor: number
  scrollTop: number
}

type Status = 'loading' | 'empty' | 'ready'

/** session 写盘的静默窗口。光标与滚动都很密（滚动一次几十个事件），逐个原子写是自伤。 */
const SESSION_DEBOUNCE_MS = 500

/** ⌘K 状态文案停留时长。它是提示不是面板——自己消失，不用关。 */
const K_HINT_MS = 2_500

export function App(): React.JSX.Element {
  const [status, setStatus] = useState<Status>('loading')
  const [page, setPage] = useState<Page | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<EngineStatus>('starting')
  const [kHint, setKHint] = useState<string | null>(null)
  const kHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draft = useRef<string>('')
  // 纸角持久警示点（架构 §4.2 写盘失败的表现）：**恢复即消**，所以是状态不是一次性提示。
  // 与 `.sepia-error` 那条横幅并存：横幅说"这次没存上"，警示点说"现在还没存上"。
  const [saveWarning, setSaveWarning] = useState(false)
  const autosave = useRef<Autosave | null>(null)
  // Stage 5b：线程与徽章。**去向是算出来的**（core 的 placeThreads），这里只存算完的结果。
  const threadStore = useRef<ThreadStore | null>(null)
  const [threadView, setThreadView] = useState<ThreadView>({ badges: [], orphans: [] })
  const [panelOpen, setPanelOpen] = useState(false)
  /** 侧边栏（⌘B）。**可全收起**——收起时纸就是整扇窗（§2.1 ②）。 */
  const [sidebarOpen, setSidebarOpen] = useState(true)
  /**
   * `@` 引用（§2.1 ④）。候选表用**文件树扫描的同一份清单**——不为 `@` 再扫一次盘；
   * 标题后台补，补好之前按纯文件名匹配（**那是常态路径，不是降级**）。
   */
  const [refCandidates, setRefCandidates] = useState<RefCandidate[]>([])
  const [refState, setRefState] = useState<{ from: number; query: string } | null>(null)
  /**
   * 更新链接（§2.1 ⑥ / T-31）：重命名或移动之后的提示。
   * **用户主动点，不自动改**——自动改等于在用户没看见的地方动他的字。
   */
  const [linkPlan, setLinkPlan] = useState<{
    from: string
    to: string
    files: { page: string; count: number }[]
    total: number
    expanded: boolean
  } | null>(null)
  /** 点徽章进来的那条线程——面板要**定位到它**，不是只把面板打开（W11 两条路都要通）。 */
  const [focusThread, setFocusThread] = useState<string | null>(null)

  // markup 浮层（Stage 4）。range 与 snapshot 是 CAS 的两半，同生同灭。
  const editor = useRef<MountedEditor | null>(null)
  const [markup, setMarkup] = useState<
    { range: { from: number; to: number }; snapshot: string; host: HTMLElement } | null
  >(null)
  const [report, setReport] = useState<string | null>(null)

  // 查找替换：CM6 的驱动接口由 EditorHost 上抛，面板是 ui 的 dumb 组件，这里装配
  const searchApi = useRef<SearchApi | null>(null)
  const [searchOpen, setSearchOpen] = useState<false | 'find' | 'replace'>(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchReplace, setSearchReplace] = useState('')
  const [searchCount, setSearchCount] = useState(0)

  // 多 Tab（170 §2.1 ①）：**session 就是 tab 的真相源**，不另建一份 tabs state。
  // 两份状态一定会漂——而"漂"在这里的表现是"关了一个 tab，另一个的光标跑了"。
  const [session, setSession] = useState<SessionState>(EMPTY_SESSION)
  const sessionRef = useRef<SessionState>(EMPTY_SESSION)
  sessionRef.current = session

  // session 的最新值攒在 ref 里，到点一次写完——不随每个事件写盘（附录 D.3 第 2 条）。
  const sessionDraft = useRef({ cursor: 0, scrollTop: 0 })
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 把当前 tab 的光标与滚动并进 session。**切走 / 关闭 / 写盘前都要过这一步**。 */
  const withCurrentPosition = useCallback((state: SessionState): SessionState => {
    if (state.tabs.length === 0) return state
    return updateTab(state, state.active, {
      cursor: sessionDraft.current.cursor,
      scrollTop: sessionDraft.current.scrollTop,
    })
  }, [])

  const schedulePersist = useCallback((): void => {
    if (sessionTimer.current !== null) clearTimeout(sessionTimer.current)
    sessionTimer.current = setTimeout(() => {
      sessionTimer.current = null
      const next = withCurrentPosition(sessionRef.current)
      sessionRef.current = next
      void api.setSession(next)
    }, SESSION_DEBOUNCE_MS)
  }, [withCurrentPosition])

  useEffect(
    () => () => {
      if (sessionTimer.current !== null) clearTimeout(sessionTimer.current)
    },
    [],
  )

  const open = useCallback(async (path: string, cursor = 0, scrollTop = 0): Promise<boolean> => {
    const read = await api.readFile(path)
    if (!read.ok) {
      setError(t('error.open.failed'))
      setStatus('empty')
      return false
    }
    const { fidelity, body } = readFidelity(read.value)
    // t4：page 文件内容到手
    api.perfMark('t4')
    draft.current = body
    sessionDraft.current = { cursor, scrollTop }
    setPage({ path, body, fidelity, cursor, scrollTop })
    setDirty(false)
    setError(null)
    setStatus('ready')
    return true
  }, [])

  const save = useCallback(
    async (options: { markupPair?: boolean } = {}): Promise<{ before: string; after: string } | null> => {
    if (!page) return null
    const content = writeFidelity(draft.current, page.fidelity)
    const written = await api.writeFile(page.path, content, options)
    // 失败必须可见，不许静默、不许假装成功（120 §1.3）。重试归 Stage 7。
    if (!written.ok) {
      setError(t('error.save.failed'))
      setSaveWarning(true)
      return null
    }
    // 写成功了就把在飞的自动写盘作废——否则刚 ⌘S 完，防抖还会再写一遍同样的内容
    autosave.current?.cancel()
    setDirty(false)
    setError(null)
    setSaveWarning(false)
    return written.value.commits
  },
    [page],
  )

  // 自动写盘（架构 §4.2 写盘时间线）。挂在这里、逻辑在 `services/autosave.ts`——
  // 冻结令期间 App.tsx 只允许长出这一处接线（160 §1.1〇-2 的豁口）。
  useEffect(() => {
    if (!page) return undefined
    const instance = createAutosave({ delayMs: markupConfig().autosaveDebounceMs, save: () => void save() })
    autosave.current = instance
    return () => {
      instance.dispose()
      autosave.current = null
    }
  }, [page, save])

  // 线程仓：随 page 建、随 page 拆。**四个重算入口共用一个算法**——
  // 打开、正文变、外部变更、新增，都是"按当前正文重算一遍去向"。
  useEffect(() => {
    if (!page) return undefined
    const directory = page.path.slice(0, page.path.lastIndexOf('/'))
    const store = createThreadStore({
      directory,
      onChange: (view) => {
        setThreadView(view)
        // 徽章传全量：算一次画一次，比"哪条加了哪条删了"少一整类会漂的 bug
        editor.current?.showBadges(view.badges.map((it) => ({ id: it.thread.id, to: it.range?.to ?? 0 })))
      },
    })
    threadStore.current = store
    store.refreshNow(page.body)
    return () => {
      store.dispose()
      threadStore.current = null
      setThreadView({ badges: [], orphans: [] })
      setPanelOpen(false)
    }
  }, [page])

  /**
   * 打开一个 page：**开成 tab**（已开着就聚焦过去）。
   * ⌘O / 文件树 / `@` / argv 四个入口全走这一条——"重复打开"的判断只在 `openTab` 里一处。
   */
  const openInTab = useCallback(
    async (absolute: string): Promise<void> => {
      const current = withCurrentPosition(sessionRef.current)
      const relative = tabRelative(current.book, absolute)
      const next = openTab(current, { page: relative, cursor: 0, scrollTop: 0 })
      const tab = next.tabs[next.active]
      sessionRef.current = next
      setSession(next)
      const opened = await open(absolute, tab?.cursor ?? 0, tab?.scrollTop ?? 0)
      if (!opened) {
        // **打不开就把 tab 收回去**（真人轮实测）：留着一个开不出内容的 tab，
        // 用户看到的是"tab 在、纸是空的、红字挂着"——比什么都没发生更糟。
        // session 也不写盘，免得把这个坏 tab 带到下次启动。
        sessionRef.current = current
        setSession(current)
        return
      }
      void api.setSession(next)
      // 最近打开（§2.1 ③）：置顶+去重+截断在 core，这里只报"打开了它"。
      // **放在打开成功之后**——打不开的东西不该进"最近打开"
      if (next.book !== null) void api.libraryRecents(next.book, relative)
    },
    [open, withCurrentPosition],
  )

  /** 切到第 index 个 tab：**先把当前位置存住**，再把那个 tab 的位置还原回去。 */
  const switchTab = useCallback(
    async (index: number): Promise<void> => {
      const current = withCurrentPosition(sessionRef.current)
      const target = current.tabs[index]
      if (target === undefined || index === current.active) return
      const next = { ...current, active: index }
      sessionRef.current = next
      setSession(next)
      void api.setSession(next)
      await open(tabPath(next.book, target.page), target.cursor, target.scrollTop)
    },
    [open, withCurrentPosition],
  )

  /** 关掉一个 tab。全关光 → 回主页（不是白屏）。 */
  const closeTabAt = useCallback(
    async (index: number): Promise<void> => {
      const next = closeTab(withCurrentPosition(sessionRef.current), index)
      sessionRef.current = next
      setSession(next)
      void api.setSession(next)
      const target = next.tabs[next.active]
      if (target === undefined) {
        setPage(null)
        setStatus('empty')
        return
      }
      await open(tabPath(next.book, target.page), target.cursor, target.scrollTop)
    },
    [open, withCurrentPosition],
  )

  /** 选一个文件夹作 book（主页第一条路）。**只改 session.book**，不动 tabs。 */
  const chooseBook = useCallback((dir: string): void => {
    const next = { ...withCurrentPosition(sessionRef.current), book: dir }
    sessionRef.current = next
    setSession(next)
    void api.setSession(next)
  }, [withCurrentPosition])

  /** 重命名/移动之后查一遍引用。**只查不改**，查到了才出横条。 */
  const checkLinks = useCallback(async (from: string, to: string): Promise<void> => {
    const book = sessionRef.current.book
    if (book === null) return
    const plan = await api.updateLinks(book, from, to, false)
    if (!plan.ok || plan.value.total === 0) return
    setLinkPlan({ from, to, files: plan.value.files, total: plan.value.total, expanded: false })
  }, [])

  /**
   * 收图（§2.1 ⑤，架构 §4.9 落点表）：编辑区**只收图片**，拖别的一律无效。
   *
   * 插入走 `replaceGuarded`（零长度区间 = 纯插入），与 `@` 同一条 CAS 通道——
   * 仍然没有第二条写正文的路。
   */
  const dropImages = useCallback(
    async (paths: string[]): Promise<void> => {
      const book = sessionRef.current.book
      const instance = editor.current
      if (book === null || instance === null || paths.length === 0) return
      for (const source of paths) {
        const imported = await api.importImage(source, book)
        if (!imported.ok) continue
        const at = instance.selection().from
        instance.replaceGuarded({
          range: { from: at, to: at },
          expectedText: '',
          replacement: `![](${imported.value})`,
        })
      }
      draft.current = instance.read()
      setDirty(true)
      autosave.current?.bump()
    },
    [],
  )

  // 候选表随 book 建。**扫描在挂载后异步跑**（纪律 12），标题再异步补一轮。
  useEffect(() => {
    const book = session.book
    if (book === null) {
      setRefCandidates([])
      return
    }
    void (async () => {
      const scan = await api.scanLibrary(book)
      if (!scan.ok) return
      const files = scan.value.entries
        .filter((entry) => entry.kind === 'file')
        .map((entry) => ({ path: entry.path, name: entry.name }))
      setRefCandidates(files) // 先给文件名——`@` 此刻就能用
      const withTitles = await api.libraryTitles(book, files)
      if (withTitles.ok) setRefCandidates(withTitles.value) // 标题补好再刷一次
    })()
  }, [session.book])

  const pick = useCallback(async (): Promise<void> => {
    const chosen = await api.openMarkdown()
    if (chosen) await openInTab(chosen)
  }, [openInTab])

  // 启动：读 session → **恢复 tabs 与 active**（170 §2.1 ①）。
  // 同步路径上仍然只有这一件事（纪律 12）：文件树、@ 索引都在 t5 之后异步补。
  useEffect(() => {
    void (async () => {
      const restored: SessionState = await api.getSession()
      sessionRef.current = restored
      setSession(restored)
      const current = restored.tabs[restored.active]
      if (current === undefined) {
        setStatus('empty')
        return
      }
      await open(tabPath(restored.book, current.page), current.cursor, current.scrollTop)
    })()
  }, [open])

  // 查找替换：面板改 query → 立即写进 CM6（即时状态切换，无防抖——本地操作无 IO）
  const applySearch = useCallback((query: string, replace: string): void => {
    if (!searchApi.current) return
    const state = searchApi.current.set({ query, replace })
    setSearchCount(state.count)
  }, [])

  const openSearch = useCallback(
    (mode: 'find' | 'replace'): void => {
      setSearchOpen(mode)
      applySearch(searchQuery, searchReplace)
    },
    [applySearch, searchQuery, searchReplace],
  )

  const closeSearch = useCallback((): void => {
    setSearchOpen(false)
    if (searchApi.current) searchApi.current.set({ query: '' })
  }, [])

  // 引擎状态：初值 + 订阅。它只驱动提示线与 ⌘K 文案，纸的任何路径都不等它（不变量 1）。
  useEffect(() => {
    let alive = true
    void agent.status().then((next) => {
      if (alive) setEngine(next)
    })
    const off = agent.onStatusChange((next) => {
      if (alive) setEngine(next)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  // ⌘K：Stage 4 起唤起真浮层。缺席时仍走 Stage 3 的状态提示线——
  // **缺席不是错误态，是一条链路降级**：纸照常可写（不变量 1）。
  const summon = useCallback((): void => {
    if (engine !== 'ready') {
      if (kHintTimer.current !== null) clearTimeout(kHintTimer.current)
      setKHint(t(engine === 'absent' ? 'agent.k.absent' : 'agent.k.starting'))
      kHintTimer.current = setTimeout(() => {
        kHintTimer.current = null
        setKHint(null)
      }, K_HINT_MS)
      return
    }
    const instance = editor.current
    if (instance === null || page === null) return
    // 选区与快照**在这一刻一起取**：它们是 CAS 的两半，晚取一个就对不上了。
    const range = instance.selection()
    if (range.from === range.to) return
    // 宿主是 CM6 里的块级 widget——浮层进文档流，后文被推下去而不是被盖住（W6）
    setMarkup({ range, snapshot: instance.slice(range.from, range.to), host: instance.openMarkupHost() })
  }, [engine, page])

  /** 收起浮层：React 侧卸载 + CM6 侧把块级 widget 移出文档流，两边必须一起。 */
  const dismissMarkup = useCallback((): void => {
    editor.current?.closeMarkupHost()
    setMarkup(null)
  }, [])

  /** 落笔（纪律 9c / 19 / 22）。CAS 不通过就提示重来，纸一个字节不动。 */
  const applyMarkup = useCallback(
    (revised: string, run: Pick<MarkupRun, 'mark' | 'timeline'>): void => {
      const instance = editor.current
      if (instance === null || markup === null || page === null) return
      const result = instance.applyMarkup(
        { range: markup.range, expectedText: markup.snapshot, replacement: revised },
        run,
      )
      dismissMarkup()
      // 全链六点的判读结果挂到 shell 上——smoke 拿它断言「六点齐、顺序对、在预算内」。
      // 走 DOM 属性而不是 IPC，与启动打点走 stdout 同一个道理：不为测试在桥上加东西。
      setReport(JSON.stringify(markupReport(run.timeline())))
      if (!result.ok) {
        setError(t('markup.stale'))
        return
      }
      setError(null)
      // 落笔后**立即写盘**，不等 800ms 防抖（150 §1.2）——刚落的笔不该只活在内存里
      const next = instance.read()
      draft.current = next
      setDirty(true)

      // ── 徽章 UI 先行（§2.2：UI 先行 300ms，链后台）────────────────────
      // 线程此刻就建，`commits` 先留空：**对话是纸上真发生过的事**，
      // git 记没记上是另一回事。链回来了再补两点，补不上就是 diff 不可用。
      const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const from = markup.range.from
      const thread: Thread = {
        id,
        anchor: createAnchor(id, next, { from, to: from + revised.length }),
        page: page.path,
        createdAt: Date.now(),
        turns: [
          { role: 'user', text: markup.snapshot },
          { role: 'assistant', text: revised },
        ],
        commits: null,
      }
      void threadStore.current?.add(thread, next)

      // ── 链在后台：成对 commit 夹住这一次写 ────────────────────────────
      void save({ markupPair: true }).then((commits) => {
        if (commits !== null) void threadStore.current?.settleCommits(id, commits, next)
      })
    },
    [markup, page, save, dismissMarkup],
  )

  useEffect(
    () => () => {
      if (kHintTimer.current !== null) clearTimeout(kHintTimer.current)
    },
    [],
  )

  // 命令先注册再绑键，按钮也走 execute（纪律 6）
  useEffect(() => {
    // `save` 现在会交出成对 commit 的两点（5b），命令层不关心它——丢掉返回值即可
    registerCommand({ id: 'file.save', title: 'cmd.file.save', key: 'Mod-s', run: () => void save() })
    registerCommand({ id: 'file.open', title: 'cmd.file.open', key: 'Mod-o', run: pick })
    registerCommand({ id: 'edit.find', title: 'cmd.edit.find', key: 'Mod-f', run: () => openSearch('find') })
    registerCommand({
      id: 'edit.replace',
      title: 'cmd.edit.replace',
      key: 'Mod-Alt-f',
      run: () => openSearch('replace'),
    })
    registerCommand({ id: 'agent.summon', title: 'cmd.agent.summon', key: 'Mod-k', run: summon })
    // ⌘⇧H 还白（W10）：全隐 ↔ 全显。**只切显示，线程一条不少**
    registerCommand({
      id: 'threads.hide',
      title: 'cmd.threads.hide',
      key: 'Mod-Shift-h',
      run: () => void editor.current?.toggleBadges(),
    })
    registerCommand({
      id: 'library.sidebar',
      title: 'cmd.library.sidebar',
      key: 'Mod-b',
      run: () => setSidebarOpen((openNow) => !openNow),
    })
    // 多 Tab（170 §2.1 ①）。⌘W 关、⌘⇧[ ⌘⇧] 切——与浏览器同一套肌肉记忆
    registerCommand({
      id: 'tab.close',
      title: 'cmd.tab.close',
      key: 'Mod-w',
      run: () => void closeTabAt(sessionRef.current.active),
    })
    registerCommand({
      id: 'tab.prev',
      title: 'cmd.tab.prev',
      key: 'Mod-Shift-[',
      run: () => void switchTab(sessionRef.current.active - 1),
    })
    registerCommand({
      id: 'tab.next',
      title: 'cmd.tab.next',
      key: 'Mod-Shift-]',
      run: () => void switchTab(sessionRef.current.active + 1),
    })
    registerCommand({
      id: 'threads.panel',
      title: 'cmd.threads.panel',
      run: () => setPanelOpen((isOpen) => !isOpen),
    })
  }, [save, pick, openSearch, summon, closeTabAt, switchTab])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === 's') {
        event.preventDefault()
        void save()
      } else if (event.key === 'o') {
        event.preventDefault()
        void pick()
      } else if (event.key === 'f' && !event.altKey) {
        event.preventDefault()
        openSearch('find')
      } else if ((event.key === 'f' || event.key === 'ƒ') && event.altKey) {
        // macOS 上 ⌥F 产出 ƒ，两个都接
        event.preventDefault()
        openSearch('replace')
      } else if (event.key === 'k') {
        event.preventDefault()
        summon()
      } else if (event.key === 'Backspace') {
        // ⌘⌫ 移到回收站（§2.1 ②：**还 6a 债 A 的入口半**——此前这条命令没绑键，
        // 人工轮连入口都找不到）。删除没有自绘确认：回收站本身就是撤销通道
        event.preventDefault()
        void execute('files.trash')
      } else if (event.key === 'b') {
        event.preventDefault()
        setSidebarOpen((openNow) => !openNow)
      } else if (event.key === 'w') {
        event.preventDefault()
        void closeTabAt(sessionRef.current.active)
      } else if (event.shiftKey && (event.key === '{' || event.key === '[')) {
        event.preventDefault()
        void switchTab(sessionRef.current.active - 1)
      } else if (event.shiftKey && (event.key === '}' || event.key === ']')) {
        event.preventDefault()
        void switchTab(sessionRef.current.active + 1)
      } else if ((event.key === 'h' || event.key === 'H') && event.shiftKey) {
        // ⌘⇧H 还白（W10）
        event.preventDefault()
        editor.current?.toggleBadges()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, pick, openSearch, summon, closeTabAt, switchTab])

  useEffect(() => {
    document.title = page ? `${dirty ? '• ' : ''}${page.path.split('/').pop()}` : t('app.name')
  }, [page, dirty])

  // Stage 6a：纸与外部世界的接缝。冻结令下这是 renderer 唯一的新增接线——
  // 判定在 core、动手在 files/、UI 只有下面那一条横条（170 §1.1〇-2）。
  const conflict = useFiles({
    path: page?.path ?? null,
    dirty,
    // 6a 的冲突路径只要"存一次"，不要那两点
    save: async () => {
      await save()
    },
    reload: open,
    // 三选的"用外部的"：写回磁盘 + 走既有 open 重载。
    // **刻意不给 MountedEditor 加一个"整篇替换"方法**——那会在类型上开出第二条
    // 写正文的路，而不变量 3 的机器保证正是靠"拿不到 view 就绕不过 CAS"。
    // 这两步都是既有路径：写盘是 ⌘S 那条，重载是打开文件那条。
    adoptTheirs: (content: string) => {
      const target = page?.path
      if (target === undefined) return
      void (async () => {
        await api.writeFile(target, content)
        await open(target)
      })()
    },
    position: () => ({ cursor: editor.current?.selection().from ?? 0, scrollTop: sessionDraft.current.scrollTop }),
    onOpen: (next) => void open(next),
    onMoved: (from, to) => {
      const book = sessionRef.current.book
      if (book === null) return
      void checkLinks(tabRelative(book, from), tabRelative(book, to))
    },
    onGone: () => {
      // 用户自己删掉了当前 page（不是外部删除——那条走 detach，内容留在纸上）
      setPage(null)
      setStatus('empty')
    },
  })

  if (status === 'loading') return <Loading label={t('app.loading')} />

  return (
    <div className="sepia-shell" data-sepia-shell={status} data-sepia-markup-report={report ?? undefined}>
      {session.tabs.length > 0 && (
        <div className="sepia-tabs" data-sepia-tabs={String(session.tabs.length)}>
          {session.tabs.map((tab, index) => (
            <div
              key={tab.page}
              className="sepia-tab"
              data-sepia-tab={tab.page}
              data-sepia-tab-active={index === session.active ? 'true' : 'false'}
              onClick={() => void switchTab(index)}
            >
              {/* 只有文件名，没有图标——tab 条是一行细字，不是工具栏 */}
              <span className="sepia-tab-name">{tab.page.split('/').pop()}</span>
              <span
                className="sepia-tab-close"
                data-sepia-tab-close={tab.page}
                onClick={(event) => {
                  event.stopPropagation()
                  void closeTabAt(index)
                }}
              >
                ×
              </span>
            </div>
          ))}
        </div>
      )}
      {engine === 'absent' && (
        <div className="sepia-agent-line" data-sepia-agent="absent">
          {t('agent.absent.line')}
        </div>
      )}
      {kHint !== null && <div className="sepia-agent-hint">{kHint}</div>}
      {conflict !== null && (
        <div className="sepia-conflict-line" data-sepia-conflict={conflict.kind}>
          {conflict.text}
          {conflict.choices !== undefined && (
            <span className="sepia-conflict-choices" data-sepia-conflict-choices="open">
              {(['mine', 'theirs', 'both'] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  data-sepia-conflict-choice={choice}
                  onClick={() => conflict.choices?.choose(choice)}
                >
                  {t(`conflict.choice.${choice}`)}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
      {linkPlan !== null && (
        <div className="sepia-strip" data-sepia-links={String(linkPlan.total)}>
          {`${t('links.pending')} ${linkPlan.total}`}
          <span className="sepia-conflict-choices">
            <button
              type="button"
              data-sepia-links-expand="true"
              onClick={() => setLinkPlan({ ...linkPlan, expanded: !linkPlan.expanded })}
            >
              {t('links.list')}
            </button>
            <button
              type="button"
              data-sepia-links-apply="true"
              onClick={() => {
                const book = sessionRef.current.book
                if (book === null) return
                // 用户点了才改。改完与重命名进**同一个 commit**——
                // 静默 commit 的触发器会把这一批改动一起收走（架构 §4.2 的时间线）
                void api.updateLinks(book, linkPlan.from, linkPlan.to, true).then(() => setLinkPlan(null))
              }}
            >
              {t('links.apply')}
            </button>
          </span>
          {linkPlan.expanded && (
            /* **执行前先把清单摊开**：要改谁、改几处，看得见才敢点 */
            <div className="sepia-links-list" data-sepia-links-list="open">
              {linkPlan.files.map((file) => (
                <div key={file.page} data-sepia-links-file={file.page}>
                  {file.page} · {file.count}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {error !== null && <div className="sepia-error">{error}</div>}
      {saveWarning && <div className="sepia-save-warning" data-sepia-save-warning="on" title={t('error.save.failed')} />}
      {refState !== null && page !== null && (
        <RefPicker
          candidates={refCandidates}
          query={refState.query}
          onClose={() => setRefState(null)}
          onPick={(candidate) => {
            const instance = editor.current
            if (instance === null) return
            // **走 CAS 通道**：区间就是刚敲的那个 `@词`，对不上就不写
            instance.replaceGuarded({
              range: { from: refState.from, to: refState.from + refState.query.length + 1 },
              expectedText: `@${refState.query}`,
              replacement: refLink(candidate),
            })
            setRefState(null)
            draft.current = instance.read()
            setDirty(true)
            autosave.current?.bump()
          }}
        />
      )}
      {panelOpen && page !== null && (
        <ThreadPanel
          view={threadView}
          focusId={focusThread}
          directory={page.path.slice(0, page.path.lastIndexOf('/'))}
          page={page.path}
          onClose={() => {
            setPanelOpen(false)
            setFocusThread(null)
          }}
        />
      )}
      {markup !== null &&
        page !== null &&
        createPortal(
          <Suspense fallback={null}>
            <MarkupPanel
              selection={markup.snapshot}
              // 选中对象的类别：MVP 只认「文字」一种，其余四组动词的形状已在 agent 侧建好
              selectionKind="text"
              request={{
                selection: markup.snapshot,
                nearby: nearbyBlocks(draft.current, markup.range, markupConfig().contextScope),
                directory: page.path.slice(0, page.path.lastIndexOf('/')),
                budgetTokens: markupConfig().contextBudgetTokens,
              }}
              onApply={applyMarkup}
              onClose={dismissMarkup}
            />
          </Suspense>,
          markup.host,
        )}
      {searchOpen !== false && page !== null && (
        <SearchPanel
          copy={{
            searchPlaceholder: t('search.placeholder'),
            replacePlaceholder: t('search.replace.placeholder'),
            next: t('search.next'),
            previous: t('search.previous'),
            replaceOne: t('search.replace.one'),
            replaceAllLabel: t('search.replace.all'),
            close: t('search.close'),
            count: searchQuery === '' ? '' : searchCount === 0 ? t('search.count.none') : `${searchCount}`,
          }}
          query={searchQuery}
          replaceValue={searchReplace}
          showReplace={searchOpen === 'replace'}
          onQueryChange={(value) => {
            setSearchQuery(value)
            applySearch(value, searchReplace)
          }}
          onReplaceChange={(value) => {
            setSearchReplace(value)
            applySearch(searchQuery, value)
          }}
          onNext={() => searchApi.current?.next()}
          onPrevious={() => searchApi.current?.previous()}
          onReplaceOne={() => {
            searchApi.current?.replaceNext()
            applySearch(searchQuery, searchReplace)
          }}
          onReplaceAll={() => {
            searchApi.current?.replaceAll()
            applySearch(searchQuery, searchReplace)
          }}
          onClose={closeSearch}
        />
      )}
      {/* 侧边栏 + 纸：**收起时纸就是整扇窗**（⌘B，§2.1 ②） */}
      <div className="sepia-body" data-sepia-sidebar={sidebarOpen && session.book !== null ? 'open' : 'closed'}>
        {sidebarOpen && session.book !== null && (
          <FileTree
            book={session.book}
            current={session.tabs[session.active]?.page ?? null}
            onOpen={(relative) => void openInTab(tabPath(session.book, relative))}
          />
        )}
        <div
          className="sepia-paper-area"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            // **编辑区只收图片**（架构 §4.9 落点表）：拖 .md 进来归窗口空白那条路，
            // 拖别的一切无效——静默无效比"猜用户想干什么"好
            const images = [...event.dataTransfer.files].filter((file) => file.type.startsWith('image/'))
            if (images.length === 0) return
            event.preventDefault()
            void dropImages(images.map((file) => (file as File & { path: string }).path).filter(Boolean))
          }}
          onPaste={(event) => {
            const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
            if (images.length === 0) return
            event.preventDefault()
            void dropImages(images.map((file) => (file as File & { path: string }).path).filter(Boolean))
          }}
        >
      {page === null ? (
        <Home
          book={session.book}
          onOpenBook={chooseBook}
          onOpenPage={(absolute) => void openInTab(absolute)}
        />
      ) : (
        <EditorHost
          doc={page.body}
          lineEnding={page.fidelity.lineEnding}
          initialCursor={page.cursor}
          initialScrollTop={page.scrollTop}
          assetBase={page.path.slice(0, page.path.lastIndexOf('/'))}
          onSearchReady={(sapi) => {
            searchApi.current = sapi
          }}
          onEditorReady={(instance) => {
            editor.current = instance
          }}
          onBadgeClick={(id) => {
            // W11：点徽章与开面板是同一个面板的两条入口。点进来的这条要**直接展开**，
            // 否则用户点了一个具体的点，却只得到一张列表——那不叫"打开这条线程"。
            setFocusThread(id)
            setPanelOpen(true)
          }}
          onChange={(next) => {
            draft.current = next
            setDirty(true)
            autosave.current?.bump()
            // **撤销联动在这里发生**（T-27）：⌘Z 撤掉落笔，引文就找不着了，
            // 重算即判孤儿——徽章移出纸面、对话沉进置灰区；⌘⇧Z 自然回来。
            // 没有任何 undo 钩子，锚点机制本身就是它的实现。
            threadStore.current?.refresh(next)

            // `@` 侦测：光标前是不是正在敲一个 `@词`。**纯字符串判断，没有 IO**——
            // "即时"是结构决定的，不是优化出来的（§2.5 D2 <100ms）。
            const instance = editor.current
            if (instance === null) return
            const at = instance.selection().from
            const before = next.slice(Math.max(0, at - 40), at)
            const match = /@([^\s@[\]()]*)$/.exec(before)
            setRefState(match === null ? null : { from: at - match[0].length, query: match[1] ?? '' })
          }}
          onCursorChange={(cursor) => {
            sessionDraft.current.cursor = cursor
            schedulePersist()
          }}
          onScrollChange={(scrollTop) => {
            sessionDraft.current.scrollTop = scrollTop
            schedulePersist()
          }}
          onReady={() => api.perfMark('t5')}
        />
      )}
        </div>
      </div>
    </div>
  )
}
