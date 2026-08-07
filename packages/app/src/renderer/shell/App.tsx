import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  EMPTY_SESSION,
  type RefCandidate,
  closeTab,
  DEFAULT_CONFIG,
  createAnchor,
  keyCaps,
  setMetaField,
  referencedPages,
  markupReport,
  openTab,
  tabPath,
  tabRelative,
  updateTab,
  type AppConfig,
  type CopyKey,
  type EngineStatus,
  type MarkupRun,
  type RetryHandle,
  type Rightbar as RightbarState,
  openRight,
  retryWithBackoff,
  shouldInterceptClose,
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
import type { ContextBlock } from '@sepia/agent/tasks'

import { entries as commandEntries, execute, registerCommand } from '../commands/registry.ts'
import { useFileCommands } from '../files/commands.ts'
import { Cheatsheet } from './cheatsheet.tsx'
import { InfoOverlay } from './info.tsx'
import { SlashMenu, type SlashItem } from '../editor/slash.tsx'
import { SplitEditor } from '../editor/split.tsx'
import { LinksPanel } from '../library/links.tsx'
import { Reader } from '../library/reader.tsx'
import { MetaTable } from './meta.tsx'
import { PaperTop } from './papertop.tsx'
import { Settings } from './settings.tsx'
import { StatusOverlay } from './status.tsx'
import { Rightbar } from './rightbar.tsx'
import { Tabs } from './tabs.tsx'
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
  /**
   * 保存成功的**一次性微反馈**（D-30）：纸角极轻一闪 600ms 后消失，无 toast 无文案。
   * 与警示点**同族同位**——成功淡、失败持久。这样"出事"与"没事"用的是同一处视线，
   * 不必再学第二个位置。
   */
  const [savePulse, setSavePulse] = useState(false)
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 重试耗尽 = 写盘这条路确认不可用。它是**拦截关闭的唯一前提**（架构 §4.9）。 */
  const [writeExhausted, setWriteExhausted] = useState(false)
  const retry = useRef<RetryHandle | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [commitInfo, setCommitInfo] = useState<{ hash: string | null; failed: boolean }>({
    hash: null,
    failed: false,
  })
  /**
   * 编辑器实例的世代号。**每挂上一个新实例就 +1。**
   *
   * 为什么需要它：editor 是 `useRef`，而 ref 的赋值**不会触发重渲染**，effect 也就
   * 看不见"实例到位了"这件事。而 markdown 层是动态 import 的，实例到位比父组件的
   * effect 晚得多——于是开机那一次 `editor.current?.showBadges(...)` 恒为 no-op，
   * 打开一篇有痕迹的 page 看不到任何徽章，要随便敲个字才冒出来。
   * happy-path 串联实测抓到的两处之一。
   */
  const [editorEpoch, setEditorEpoch] = useState(0)
  const [keysOpen, setKeysOpen] = useState(false)
  /** ⌘, 设置浮层（P3）。 */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 全量 config。设置页读它、改它；**改完立刻生效**，不必重启。 */
  const [appConfig, setAppConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [infoOpen, setInfoOpen] = useState(false)
  /** 拦截关闭的确认框（架构 §4.9 的**唯一例外**）。null = 没在拦。 */
  const [closeBlocked, setCloseBlocked] = useState(false)
  /** 用户已经选了「仍然退出」——下一次关闭放行，否则会拦住自己 */
  const allowClose = useRef(false)
  const guard = useRef({ dirty: false, writeExhausted: false })
  const autosave = useRef<Autosave | null>(null)
  // Stage 5b：线程与徽章。**去向是算出来的**（core 的 placeThreads），这里只存算完的结果。
  const threadStore = useRef<ThreadStore | null>(null)
  const [threadView, setThreadView] = useState<ThreadView>({ badges: [], orphans: [] })
  /**
   * 右侧区（190 P0）。**一个位置，三种占用者互斥**——语义在 core 的 `openRight`。
   * 原来的 `panelOpen` 是个 boolean，只能表达"对话面板开没开"；
   * 连接面板与 @ 双屏进来之后，三个 boolean 会有八种组合、其中五种非法。
   */
  const [rightbar, setRightbar] = useState<RightbarState>(null)
  const [rightWidth, setRightWidth] = useState(360)
  /** 用户点了 ⌂：有 tab 也停在主页。**主页是个可以停留的地方**，不只是空态。 */
  const [atHome, setAtHome] = useState(false)
  /** ▤ 属性表展开与否（P4 填内容）。 */
  const [metaOpen, setMetaOpen] = useState(false)
  /** ▤ 状态浮层（P6 填内容）。 */
  const [statusOpen, setStatusOpen] = useState(false)
  /** 侧边栏（⌘B）。**可全收起**——收起时纸就是整扇窗（§2.1 ②）。 */
  const [sidebarOpen, setSidebarOpen] = useState(true)
  /**
   * `@` 引用（§2.1 ④）。候选表用**文件树扫描的同一份清单**——不为 `@` 再扫一次盘；
   * 标题后台补，补好之前按纯文件名匹配（**那是常态路径，不是降级**）。
   */
  const [refCandidates, setRefCandidates] = useState<RefCandidate[]>([])
  /**
   * 正文里引用到的旧文内容（185 缺口 #4 / C4，分镜 9「这次 markup 的对话可带该文做
   * context」）。组装器从 Stage 4 起就认 `at-content` 块，**缺的一直是喂进去这一环**。
   *
   * 上限三篇：预算截断在组装器里本来就有，但读盘发生在它之前——
   * 一篇正文引了二十篇旧文时，读那二十个文件的代价是白付的。
   */
  const [refContents, setRefContents] = useState<ContextBlock[]>([])
  const [refState, setRefState] = useState<{
    from: number
    query: string
    anchor: { left: number; top: number; bottom: number } | null
  } | null>(null)
  /**
   * `/` 组件菜单（F4）。**只在空行触发**——正文里写 `and/or` 不该弹菜单出来。
   * 形态与 `@` 共用：贴光标、↑↓ 选、Enter 插、Esc 关。
   */
  const [slashState, setSlashState] = useState<{
    from: number
    query: string
    anchor: { left: number; top: number; bottom: number } | null
  } | null>(null)
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

  /**
   * 「一次写盘成功了」这件事的**唯一落点**。
   *
   * 有两个调用方（首次写、重试写成功），所以它必须是一个函数：两处各写一遍的话，
   * 迟早有一处忘了清 `writeExhausted`，于是写盘早就好了、关窗却还在拦——
   * 那正是"误拦"这个最不该犯的错。
   */
  const markSaved = useCallback((commits: { before: string; after: string } | null): void => {
    setDirty(false)
    setError(null)
    setSaveWarning(false)
    setWriteExhausted(false)
    setSavedAt(Date.now())
    // commit 成对留痕（5b）。`after` 为空 = commit 这一步失败了——
    // 写盘成功但版本没记上，这件事此前无处可见（架构 §4.2 指定 ⌘⇧I 是它的家）
    if (commits !== null) {
      setCommitInfo({ hash: commits.after === '' ? null : commits.after.slice(0, 7), failed: commits.after === '' })
    }
    // 微反馈：一闪即隐。**重复保存要重新计时**，不是叠一堆计时器
    if (pulseTimer.current !== null) clearTimeout(pulseTimer.current)
    setSavePulse(true)
    pulseTimer.current = setTimeout(() => setSavePulse(false), 600)
  }, [])

  const save = useCallback(
    async (options: { markupPair?: boolean } = {}): Promise<{ before: string; after: string } | null> => {
    if (!page) return null
    const content = writeFidelity(draft.current, page.fidelity)
    const written = await api.writeFile(page.path, content, options)
    // 失败必须可见，不许静默、不许假装成功（120 §1.3）。
    if (!written.ok) {
      setError(t('error.save.failed'))
      setSaveWarning(true)
      // **终态链的入口**（架构 §4.9 后半）：失败不是终点，先自己试三次。
      // 已经在重试就不再排一条——否则每次自动写盘都叠一条链，退避形同虚设。
      if (retry.current === null) {
        retry.current = retryWithBackoff({
          attempt: async () => {
            const again = await api.writeFile(page.path, writeFidelity(draft.current, page.fidelity), options)
            if (!again.ok) return false
            retry.current = null
            markSaved(again.value.commits)
            return true
          },
          onExhausted: () => {
            retry.current = null
            // 到这儿才允许拦截关闭。在此之前一律不拦——误拦比漏拦严重得多
            setWriteExhausted(true)
            setError(t('save.exhausted'))
          },
          setTimer: (fn, ms) => setTimeout(fn, ms),
          clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        })
        setError(t('save.retrying'))
      }
      return null
    }
    // 写成功了就把在飞的自动写盘作废——否则刚 ⌘S 完，防抖还会再写一遍同样的内容
    autosave.current?.cancel()
    markSaved(written.value.commits)
    return written.value.commits
  },
    [page, markSaved],
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

  /**
   * 画徽章。**是状态的函数，不是重算时的副作用。**
   *
   * 传全量（算一次画一次），比"哪条加了哪条删了"少一整类会漂的 bug；
   * 而挂在 effect 上又比挂在 `onChange` 里多守一条：**编辑器换了一个实例**
   * （换 page、重开）时它会自己重画，不依赖"恰好那一刻实例已经在了"。
   */
  useEffect(() => {
    editor.current?.showBadges(threadView.badges.map((it) => ({ id: it.thread.id, to: it.range?.to ?? 0 })))
  }, [threadView, editorEpoch])

  // 线程仓：随 page 建、随 page 拆。**四个重算入口共用一个算法**——
  // 打开、正文变、外部变更、新增，都是"按当前正文重算一遍去向"。
  useEffect(() => {
    if (!page) return undefined
    const directory = page.path.slice(0, page.path.lastIndexOf('/'))
    const store = createThreadStore({
      directory,
      // **只存状态，不在这儿画**。画法见下面那个 effect——
      // 原来是在这里直接 `editor.current?.showBadges(...)`，而开机那一次重算
      // **发生在编辑器挂上之前**，`?.` 把这一下静静吞掉了：打开一篇有痕迹的 page，
      // 徽章要等你随便敲一个字才冒出来。happy-path 串联实测抓到的。
      onChange: setThreadView,
    })
    threadStore.current = store
    store.refreshNow(page.body)
    return () => {
      store.dispose()
      threadStore.current = null
      setThreadView({ badges: [], orphans: [] })
      setRightbar(null)
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

  /**
   * 当前 page 路径的 ref。
   * 命令上下文是个**每次调用都现取**的函数（`context()`），挂 state 会让它一直
   * 停在注册那一刻的值——四条文件命令会永远对着第一张纸操作。
   */
  const pageRef = useRef<string | null>(null)
  useEffect(() => {
    pageRef.current = page?.path ?? null
  }, [page])

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
  const dropImages = useCallback(async (images: File[]): Promise<void> => {
    const book = sessionRef.current.book
    const instance = editor.current
    // 没有 book 就没有 `img/` 可落——游离 page 收图归后话（记债）
    if (book === null || instance === null || images.length === 0) return
    for (const file of images) {
      // **读字节，不读路径**：Electron ≥32 删了 `File.path`，而粘贴的截图
      // 在磁盘上根本没有文件——字节是这两条路唯一的共同语言
      const bytes = new Uint8Array(await file.arrayBuffer())
      const imported = await api.importImage(file.name || 'image.png', bytes, book)
      if (!imported.ok) continue
      const at = instance.selection().from
      // **图片必须自成一行**，两个理由缺一不可：
      //   1. 落在别人行中间会把那行的语义搅了——真人轮实测：光标在 `# 标题` 行首时
      //      插进去，正文变成 `![](img/…)# 访问控制管理办法`，标题当场废掉
      //   2. C 类块级 widget 只认独占一行的图片；夹在文字里渲不出预览（130 §C）
      // 换行用**这一页自己的换行符**，不是硬编码 '\n'——CRLF 文件掺一个 LF
      // 就是"未触及的字节"之外多出的一处改写（不变量 2 的精神）。
      const eol = page?.fidelity.lineEnding ?? '\n'
      const head = at === 0 || instance.slice(at - 1, at) === '\n' ? '' : eol
      const tailChar = instance.slice(at, at + 1)
      const tail = tailChar === '' || tailChar === '\n' || tailChar === '\r' ? '' : eol
      instance.replaceGuarded({
        range: { from: at, to: at },
        expectedText: '',
        replacement: `${head}![](${imported.value})${tail}`,
      })
    }
    draft.current = instance.read()
    setDirty(true)
    autosave.current?.bump()
    // `page` 必须进依赖：其余取值都走 ref，只有换行符来自 state——
    // 空依赖数组会让它永远停在第一张纸的换行符上
  }, [page])

  /**
   * 把正文里引用到的 page 读进来，备作 `@content`。
   * 随正文变（防抖跟着 threadStore 那一拍走），**不进启动同步路径**（纪律 12）。
   */
  useEffect(() => {
    const book = session.book
    if (page === null || book === null) {
      setRefContents([])
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        const targets = referencedPages(page.body).slice(0, 3)
        const blocks: ContextBlock[] = []
        for (const [index, target] of targets.entries()) {
          const read = await api.readFile(tabPath(book, target))
          if (read.ok) {
            // distance 从 10 起：**永远排在选区与邻近段落之后**——
            // 引用的旧文是佐料，不该把正文自己的上下文挤出预算
            blocks.push({ kind: 'at-content', text: read.value, distance: 10 + index })
          }
        }
        if (!cancelled) setRefContents(blocks)
      })()
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [page, session.book])

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

  /**
   * 拦截关闭（架构 §4.9：⌘Q 无对话框原则的**唯一例外**）。
   *
   * **走 `beforeunload` 而不是新开一条桥**：这条链本来就要在 renderer 判定
   * （脏与重试耗尽都是 renderer 的状态），而 `beforeunload` 的取消语义 Electron
   * 原生就支持——关窗、⌘Q、Dock 退出三条路最终都要关这扇窗，都会经过它。
   * 新开一个 `api.window.*` 只会让桥多一项，而换不到任何东西（180 §1.3 目标零增长）。
   *
   * **不弹系统对话框**：`beforeunload` 自带的那个框文案不可控、样式不属于这张纸。
   * 取消掉默认行为，自己画一个，明示"有多少字没落盘"。
   */
  useEffect(() => {
    guard.current = { dirty, writeExhausted }
  }, [dirty, writeExhausted])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (allowClose.current) return
      if (!shouldInterceptClose(guard.current)) return
      event.preventDefault()
      setCloseBlocked(true)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  /**
   * 四条文件命令（新建/改名/移动/删除）。
   *
   * **Stage 8 开工时发现它们从来没被注册过**：`files/commands.ts` 定义了
   * `useFileCommands`，而 renderer 里**没有任何地方 import 它**。于是 ⌘⌫ 与树右键
   * 都在调一个不存在的命令——`execute` 对未知 id 静默返回，所以一路无声。
   * 6b 人工轮第 6 项「⌘⌫ 删除 → 废纸篓里找到」当时判了通过，但按代码它不可能工作。
   * 现在补上注册，并加了 `check:commands` 守住这一类（execute 的 id 必须注册过）。
   */
  useFileCommands(
    useCallback(
      () => ({
        book: sessionRef.current.book,
        page: pageRef.current,
        onOpen: (path: string) => void openInTab(path),
        onGone: () => {
          setPage(null)
          setRightbar(null)
        },
        onMoved: (from: string, to: string) => void checkLinks(from, to),
      }),
      [openInTab, checkLinks],
    ),
  )

  useEffect(() => {
    void api.config.get().then((result) => {
      if (result.ok) setAppConfig(result.value)
    })
  }, [])

  // 命令先注册再绑键，按钮也走 execute（纪律 6）
  useEffect(() => {
    // `save` 现在会交出成对 commit 的两点（5b），命令层不关心它——丢掉返回值即可
    // `group` / `when` 是给 ⌘/ 看板用的（T-03：绑键 / 菜单 / 看板共用这一层）。
    // **它们只影响看板的显示**，不是执行守卫——置灰的命令从别处照样触发得了。
    const needsPage = (context: { hasPage: boolean }): boolean => context.hasPage
    const notInMarkup = (context: { markupOpen: boolean; hasPage: boolean }): boolean =>
      context.hasPage && !context.markupOpen
    registerCommand({
      id: 'file.save',
      title: 'cmd.file.save',
      key: 'Mod-s',
      group: 'file',
      when: needsPage,
      run: () => void save(),
    })
    registerCommand({ id: 'file.open', title: 'cmd.file.open', key: 'Mod-o', group: 'file', run: pick })
    registerCommand({
      id: 'edit.find',
      title: 'cmd.edit.find',
      key: 'Mod-f',
      group: 'block',
      when: notInMarkup,
      run: () => openSearch('find'),
    })
    registerCommand({
      id: 'edit.replace',
      title: 'cmd.edit.replace',
      key: 'Mod-Alt-f',
      group: 'block',
      when: notInMarkup,
      run: () => openSearch('replace'),
    })
    registerCommand({
      id: 'agent.summon',
      title: 'cmd.agent.summon',
      key: 'Mod-k',
      group: 'agent',
      when: needsPage,
      run: summon,
    })
    // ── F2 标准快捷键集（D-26）。键位在 CM6 的 keymap 里（那才抢得过它自己的表），
    // 这里注册命令是为了让 ⌘/ 看板与设置快捷键页有同一份数据源（T-03）。
    const fmt = (
      id: string,
      title: CopyKey,
      key: string,
      run: (instance: MountedEditor) => void,
    ): void => {
      registerCommand({
        id,
        title,
        key,
        group: 'inline',
        when: (context) => context.hasPage && !context.markupOpen,
        run: () => {
          const instance = editor.current
          if (instance !== null) run(instance)
        },
      })
    }
    fmt('format.bold', 'cmd.format.bold', 'Mod-b', (it) => it.format.bold())
    fmt('format.italic', 'cmd.format.italic', 'Mod-i', (it) => it.format.italic())
    fmt('format.code', 'cmd.format.code', 'Mod-e', (it) => it.format.code())
    fmt('format.link', 'cmd.format.link', 'Mod-Shift-k', (it) => it.format.link())
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      fmt(`format.h${String(level)}`, `cmd.format.h${String(level)}` as CopyKey, `Mod-${String(level)}`, (it) =>
        it.format.heading(level),
      )
    }
    fmt('format.body', 'cmd.format.body', 'Mod-0', (it) => it.format.heading(0))
    registerCommand({
      id: 'format.codeBlock',
      title: 'cmd.format.codeblock',
      key: 'Mod-Alt-c',
      group: 'block',
      when: (context) => context.hasPage && !context.markupOpen,
      run: () => editor.current?.format.codeBlock(),
    })
    registerCommand({
      id: 'format.quote',
      title: 'cmd.format.quote',
      key: 'Mod-Alt-q',
      group: 'block',
      when: (context) => context.hasPage && !context.markupOpen,
      run: () => editor.current?.format.quote(),
    })
    registerCommand({
      id: 'format.bullet',
      title: 'cmd.format.bullet',
      key: 'Mod-Alt-u',
      group: 'block',
      when: (context) => context.hasPage && !context.markupOpen,
      run: () => editor.current?.format.bullet(),
    })
    registerCommand({
      id: 'format.ordered',
      title: 'cmd.format.ordered',
      key: 'Mod-Alt-o',
      group: 'block',
      when: (context) => context.hasPage && !context.markupOpen,
      run: () => editor.current?.format.ordered(),
    })

    registerCommand({
      id: 'view.keys',
      title: 'cmd.keys.board',
      key: 'Mod-/',
      group: 'file',
      run: () => setKeysOpen((shown) => !shown),
    })
    registerCommand({
      id: 'view.settings',
      title: 'cmd.settings',
      key: 'Mod-,',
      group: 'file',
      run: () => setSettingsOpen((shown) => !shown),
    })
    registerCommand({
      id: 'view.status',
      title: 'cmd.status.panel',
      group: 'file',
      run: () => setStatusOpen((shown) => !shown),
    })
    registerCommand({
      id: 'view.info',
      title: 'cmd.info.panel',
      key: 'Mod-Shift-i',
      group: 'file',
      when: needsPage,
      run: () => setInfoOpen((shown) => !shown),
    })
    // ⌘⇧H 还白（W10）：全隐 ↔ 全显。**只切显示，线程一条不少**
    registerCommand({
      id: 'threads.hide',
      title: 'cmd.threads.hide',
      key: 'Mod-Shift-h',
      group: 'agent',
      when: needsPage,
      run: () => void editor.current?.toggleBadges(),
    })
    registerCommand({
      id: 'library.sidebar',
      title: 'cmd.library.sidebar',
      // **⌘B 让位给加粗**（190 P1 的 ⌘B 冲突裁决，见附录 A-1）：
      // 加粗是写作动作，一天按几十次；侧边栏是视图开关，一天按几次。
      // 侧边栏改 `⌘\`——Obsidian 用的就是它，肌肉记忆不是从零建。
      key: 'Mod-\\',
      group: 'file',
      run: () => setSidebarOpen((openNow) => !openNow),
    })
    // 多 Tab（170 §2.1 ①）。⌘W 关、⌘⇧[ ⌘⇧] 切——与浏览器同一套肌肉记忆
    registerCommand({
      id: 'tab.close',
      title: 'cmd.tab.close',
      key: 'Mod-w',
      group: 'file',
      when: needsPage,
      run: () => void closeTabAt(sessionRef.current.active),
    })
    registerCommand({
      id: 'tab.prev',
      title: 'cmd.tab.prev',
      key: 'Mod-Shift-[',
      group: 'file',
      run: () => void switchTab(sessionRef.current.active - 1),
    })
    registerCommand({
      id: 'tab.next',
      title: 'cmd.tab.next',
      key: 'Mod-Shift-]',
      group: 'file',
      run: () => void switchTab(sessionRef.current.active + 1),
    })
    registerCommand({
      id: 'threads.panel',
      title: 'cmd.threads.panel',
      // **没有 key**——这笔入口债（6b 记的）从此每次按 ⌘/ 都会以「未绑定」被看见一次
      group: 'agent',
      when: needsPage,
      run: () => setRightbar((now) => openRight(now, { kind: 'threads' })),
    })
  }, [save, pick, openSearch, summon, closeTabAt, switchTab])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === ',') {
        // ⌘, 设置（macOS 惯例，S1）
        event.preventDefault()
        void execute('view.settings')
      } else if (event.key === '/') {
        // ⌘/ 快捷键看板（D-32）。**只读**，不执行任何命令
        event.preventDefault()
        void execute('view.keys')
      } else if (event.key === 'I' && event.shiftKey) {
        // ⌘⇧I 信息浮层（D-30；⌘I 已归斜体，故用 ⌘⇧I）
        event.preventDefault()
        void execute('view.info')
      } else if (event.key === 's') {
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
      } else if (event.key === '\\') {
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
      <Tabs
        tabs={session.tabs.map((tab) => ({ page: tab.page, dirty: dirty && tab.page === session.tabs[session.active]?.page }))}
        active={session.active}
        atHome={atHome || page === null}
        onHome={() => setAtHome(true)}
        onSelect={(index) => {
          setAtHome(false)
          void switchTab(index)
        }}
        onClose={(index) => void closeTabAt(index)}
        onCreate={() => void execute('files.new')}
        onStatus={() => void execute('view.status')}
      />
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
      {/* 保存微反馈（D-30）：与警示点同位，成功淡、失败持久 */}
      {savePulse && <div className="sepia-save-pulse" data-sepia-save-pulse="on" />}
      {closeBlocked && (
        <div className="sepia-close-blocked" data-sepia-close-blocked="open">
          <div className="sepia-close-blocked-title">{t('close.blocked.title')}</div>
          <div className="sepia-close-blocked-body">
            {t('close.blocked.body')}
            {` (${String(draft.current.length)})`}
          </div>
          <div className="sepia-close-blocked-actions">
            <button
              type="button"
              data-sepia-close-blocked-action="quit"
              onClick={() => {
                allowClose.current = true
                setCloseBlocked(false)
                window.close()
              }}
            >
              {t('close.blocked.quit')}
            </button>
            <button
              type="button"
              data-sepia-close-blocked-action="cancel"
              onClick={() => setCloseBlocked(false)}
            >
              {t('close.blocked.cancel')}
            </button>
          </div>
        </div>
      )}
      {statusOpen && <StatusOverlay engine={engine} onClose={() => setStatusOpen(false)} />}
      {settingsOpen && (
        <Settings
          config={appConfig}
          keys={commandEntries({
            markupOpen: markup !== null,
            hasPage: page !== null,
            hasBook: session.book !== null,
          }).map((entry) => ({
            id: entry.id,
            label: entry.label,
            ...(entry.spec === undefined ? {} : { spec: keyCaps(entry.spec).join('') }),
          }))}
          onChange={(patch) => {
            // **先本地生效再落盘**：设置页里改一个数字要立刻看得见，
            // 等一次 IPC 往返会让开关有"迟滞感"
            setAppConfig((now) => ({ ...now, ...patch }))
            void api.config.set(patch).then((result) => {
              // 落盘后以 main 的结果为准——非法值会在那边被退回默认，本地要跟上
              if (result.ok) setAppConfig(result.value)
            })
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {keysOpen && (
        <Cheatsheet
          entries={commandEntries({ markupOpen: markup !== null, hasPage: page !== null, hasBook: session.book !== null })}
          onClose={() => setKeysOpen(false)}
        />
      )}
      {infoOpen && page !== null && (
        <InfoOverlay
          words={draft.current.length}
          savedAt={savedAt}
          commit={commitInfo.hash}
          commitFailed={commitInfo.failed}
          threads={threadView.badges.length}
          orphans={threadView.orphans.length}
          book={session.book}
          path={page.path}
          agentReady={engine === 'ready'}
          onClose={() => setInfoOpen(false)}
        />
      )}
      {slashState !== null && page !== null && (
        <SlashMenu
          query={slashState.query}
          anchor={slashState.anchor}
          onClose={() => setSlashState(null)}
          onPick={(item: SlashItem) => {
            const instance = editor.current
            if (instance === null) return
            const caret = item.insert.indexOf('|')
            const text = item.insert.replace('|', '')
            // **走 CAS 通道**：区间就是刚敲的那个 `/词`，对不上就不写
            instance.replaceGuarded({
              range: { from: slashState.from, to: slashState.from + slashState.query.length + 1 },
              expectedText: `/${slashState.query}`,
              replacement: text,
            })
            setSlashState(null)
            draft.current = instance.read()
            setDirty(true)
            autosave.current?.bump()
            void caret
          }}
        />
      )}
      {refState !== null && page !== null && (
        <RefPicker
          candidates={refCandidates}
          query={refState.query}
          anchor={refState.anchor}
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
                nearby: [
                  ...nearbyBlocks(draft.current, markup.range, markupConfig().contextScope),
                  ...refContents,
                ],
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
      <div
        className="sepia-body"
        data-sepia-sidebar={sidebarOpen && session.book !== null && page !== null && !atHome ? 'open' : 'closed'}
      >
        {/* **主页不挂文件树**：主页有它自己的左栏（workspace 列表），
            两个左栏并排是原型里没有的东西，也让"我在哪儿"多了一处要看。 */}
        {sidebarOpen && session.book !== null && page !== null && !atHome && (
          <FileTree
            book={session.book}
            current={session.tabs[session.active]?.page ?? null}
            onOpen={(relative) => void openInTab(tabPath(session.book, relative))}
          />
        )}
        <div
          className="sepia-paper-area"
          onClickCapture={(event) => {
            // 链接点击（F16 / F18 / D-39）。**在捕获阶段接**：CM6 自己也管点击，
            // 冒泡阶段轮到我们时光标已经被它挪走了。
            const target = event.target as HTMLElement | null
            if (target === null || target.closest('.cm-md-link') === null) return
            const instance = editor.current
            const book = sessionRef.current.book
            if (instance === null) return
            // 从点中的位置往回找这条链接的 `](目标)`
            const text = instance.read()
            const label = target.textContent ?? ''
            const at = label === '' ? -1 : text.indexOf(`[${label}](`)
            const url = at === -1 ? null : /\]\(([^)\s]+)\)/.exec(text.slice(at))?.[1] ?? null
            if (url === null) return
            event.preventDefault()
            event.stopPropagation()
            if (/^https?:\/\//i.test(url)) {
              // **外链默认进右栏阅读模式**（D-39）；按住 ⌘ 才交系统浏览器
              if (event.metaKey || appConfig.externalLinks === 'system') void api.openExternal(url)
              else setRightbar((now) => openRight(now, { kind: 'browser', url }))
              return
            }
            if (book === null) return
            const absolute = tabPath(book, url)
            // **⌘点击 = 右栏开第二编辑器**（F16）；单击 = 当前 tab 跳转
            if (event.metaKey) setRightbar((now) => openRight(now, { kind: 'split', path: absolute }))
            else void openInTab(absolute)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDropCapture={(event) => {
            // **捕获阶段**：CM6 自己也管 drop/paste，冒泡阶段轮到我们时它可能
            // 已经 preventDefault 了。图片这条路要抢在它前面（真人轮实测：拖进来毫无反应）
            const images = [...event.dataTransfer.files].filter((file) => file.type.startsWith('image/'))
            if (images.length === 0) return // 拖别的一切静默无效（架构 §4.9 落点表）
            event.preventDefault()
            event.stopPropagation()
            void dropImages(images)
          }}
          onPasteCapture={(event) => {
            const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
            if (images.length === 0) return // 粘文本仍走 CM6 自己那条（剪贴板智能转换，T-28）
            event.preventDefault()
            event.stopPropagation()
            void dropImages(images)
          }}
        >
      {page === null || atHome ? (
        <Home
          book={session.book}
          onOpenBook={(dir) => {
            setAtHome(false)
            chooseBook(dir)
          }}
          onOpenPage={(absolute) => {
            setAtHome(false)
            void openInTab(absolute)
          }}
          onSettings={() => setSettingsOpen(true)}
          onKeys={() => setKeysOpen(true)}
          onNewPage={() => void execute('files.new')}
        />
      ) : (
        <>
        <PaperTop
          name={page.path.split('/').pop() ?? ''}
          metaOpen={metaOpen}
          linksOpen={rightbar?.kind === 'links'}
          threadsOpen={rightbar?.kind === 'threads'}
          onMeta={() => setMetaOpen((now) => !now)}
          onLinks={() => setRightbar((now) => openRight(now, { kind: 'links' }))}
          onThreads={() => setRightbar((now) => openRight(now, { kind: 'threads' }))}
        />
        {metaOpen && (
          <MetaTable
            text={draft.current}
            onSet={(key, value) => {
              const instance = editor.current
              if (instance === null) return
              // **整篇替换但只有那一行变**：core 的 `setMetaField` 保证其余字节原样，
              // 这里走 CAS 通道（compare 的是当前全文）——中途被别处改过就不写
              const before = instance.read()
              const after = setMetaField(before, key, value)
              if (after === before) return
              instance.replaceGuarded({
                range: { from: 0, to: before.length },
                expectedText: before,
                replacement: after,
              })
              draft.current = instance.read()
              setDirty(true)
              autosave.current?.bump()
            }}
          />
        )}
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
            // **编辑器是异步挂上的**（markdown 层走动态 import），所以"实例到位"
            // 本身是一个会迟到的事件，必须能被 effect 观察到——见画徽章那个 effect。
            setEditorEpoch((epoch) => epoch + 1)
          }}
          onBadgeClick={(id) => {
            // W11：点徽章与开面板是同一个面板的两条入口。点进来的这条要**直接展开**，
            // 否则用户点了一个具体的点，却只得到一张列表——那不叫"打开这条线程"。
            setFocusThread(id)
            setRightbar({ kind: 'threads' })
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
            // `/` 侦测：**行首那个斜杠才算**（空行触发，F4）
            const lineStart = next.lastIndexOf('\n', Math.max(0, at - 1)) + 1
            const lineBefore = next.slice(lineStart, at)
            const slash = /^\/([^\s/]*)$/.exec(lineBefore)
            setSlashState(
              slash === null
                ? null
                : {
                    from: lineStart,
                    query: slash[1] ?? '',
                    anchor: instance.coordsAt(lineStart),
                  },
            )

            const match = /@([^\s@[\]()]*)$/.exec(before)
            setRefState(
              match === null
                ? null
                : {
                    from: at - match[0].length,
                    query: match[1] ?? '',
                    // 锚点取那个 `@` 的位置：列表从它下面长出来，跟着光标走
                    anchor: instance.coordsAt(at - match[0].length),
                  },
            )
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
        </>
      )}
        </div>
        {/* 右侧区：**一个位置，三种占用者互斥**（190 P0）。
            装什么由这里决定，容器自己不认识占用者的种类。 */}
        {rightbar !== null && page !== null && (
          <Rightbar
            state={rightbar}
            width={rightWidth}
            onWidth={setRightWidth}
            onClose={() => {
              setRightbar(null)
              setFocusThread(null)
            }}
          >
            {rightbar.kind === 'links' && (
              <LinksPanel
                text={draft.current}
                onOpenPage={(relative) => {
                  const book = sessionRef.current.book
                  if (book !== null) void openInTab(tabPath(book, relative))
                }}
                onOpenExternal={(url) => setRightbar({ kind: 'browser', url })}
              />
            )}
            {rightbar.kind === 'browser' && (
              <Reader url={rightbar.url} onOpenSystem={(url) => void api.openExternal(url)} />
            )}
            {rightbar.kind === 'split' && (
              // F16 @ 双屏：右栏是**完整的第二编辑器**，不是只读预览。
              // **永远只有两栏**——再 ⌘点新引用替换右栏内容（core 的 openRight 保证）
              <SplitEditor path={rightbar.path} />
            )}
            {rightbar.kind === 'threads' && (
              <ThreadPanel
                view={threadView}
                focusId={focusThread}
                directory={page.path.slice(0, page.path.lastIndexOf('/'))}
                page={page.path}
                onClose={() => {
                  setRightbar(null)
                  setFocusThread(null)
                }}
              />
            )}
          </Rightbar>
        )}
      </div>
    </div>
  )
}
