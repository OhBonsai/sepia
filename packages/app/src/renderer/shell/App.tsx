import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { markupReport, type EngineStatus, type MarkupRun, type SessionState, t } from '@sepia/core'
import {
  type MountedEditor,
  type SearchApi,
  type TextFidelity,
  readFidelity,
  writeFidelity,
} from '@sepia/editor'
import { Loading, SearchPanel } from '@sepia/ui'

import { EditorHost } from '../editor/host.tsx'
import { markupConfig } from '../markup/config.ts'
import { nearbyBlocks } from '../markup/nearby.ts'

// 浮层**整体惰性加载**（纪律 12 / 150 §1.2 冷启动零增量）：
// 它连着 remend 与 Shiki，静态 import 会把它们全部拖进启动 bundle——
// Stage 2 的 KaTeX 教训原样适用。构建产物里它是独立 chunk，冷启动一个字节都不多。
const MarkupPanel = lazy(async () => ({ default: (await import('../markup/panel.tsx')).MarkupPanel }))
import { createAutosave, type Autosave } from '../services/autosave.ts'
import { registerCommand } from '../commands/registry.ts'
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

  // session 的最新值攒在 ref 里，到点一次写完——不随每个事件写盘（附录 D.3 第 2 条）。
  const sessionDraft = useRef({ cursor: 0, scrollTop: 0 })
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const schedulePersist = useCallback((path: string): void => {
    if (sessionTimer.current !== null) clearTimeout(sessionTimer.current)
    sessionTimer.current = setTimeout(() => {
      sessionTimer.current = null
      void api.setSession({
        version: 1,
        page: path,
        cursor: sessionDraft.current.cursor,
        scrollTop: sessionDraft.current.scrollTop,
      })
    }, SESSION_DEBOUNCE_MS)
  }, [])

  useEffect(
    () => () => {
      if (sessionTimer.current !== null) clearTimeout(sessionTimer.current)
    },
    [],
  )

  const open = useCallback(async (path: string, cursor = 0, scrollTop = 0): Promise<void> => {
    const read = await api.readFile(path)
    if (!read.ok) {
      setError(t('error.open.failed'))
      setStatus('empty')
      return
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
  }, [])

  const save = useCallback(async (): Promise<void> => {
    if (!page) return
    const content = writeFidelity(draft.current, page.fidelity)
    const written = await api.writeFile(page.path, content)
    // 失败必须可见，不许静默、不许假装成功（120 §1.3）。重试归 Stage 7。
    if (!written.ok) {
      setError(t('error.save.failed'))
      setSaveWarning(true)
      return
    }
    // 写成功了就把在飞的自动写盘作废——否则刚 ⌘S 完，防抖还会再写一遍同样的内容
    autosave.current?.cancel()
    setDirty(false)
    setError(null)
    setSaveWarning(false)
  }, [page])

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

  const pick = useCallback(async (): Promise<void> => {
    const chosen = await api.openMarkdown()
    if (chosen) await open(chosen)
  }, [open])

  // 启动：读 session → 打开上次的 page。同步路径上只有这一件事（纪律 12）。
  useEffect(() => {
    void (async () => {
      const session: SessionState = await api.getSession()
      if (session.page) await open(session.page, session.cursor, session.scrollTop)
      else setStatus('empty')
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
      draft.current = instance.read()
      setDirty(true)
      void save()
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
    registerCommand({ id: 'file.save', title: 'cmd.file.save', key: 'Mod-s', run: save })
    registerCommand({ id: 'file.open', title: 'cmd.file.open', key: 'Mod-o', run: pick })
    registerCommand({ id: 'edit.find', title: 'cmd.edit.find', key: 'Mod-f', run: () => openSearch('find') })
    registerCommand({
      id: 'edit.replace',
      title: 'cmd.edit.replace',
      key: 'Mod-Alt-f',
      run: () => openSearch('replace'),
    })
    registerCommand({ id: 'agent.summon', title: 'cmd.agent.summon', key: 'Mod-k', run: summon })
  }, [save, pick, openSearch, summon])

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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, pick, openSearch, summon])

  useEffect(() => {
    document.title = page ? `${dirty ? '• ' : ''}${page.path.split('/').pop()}` : t('app.name')
  }, [page, dirty])

  if (status === 'loading') return <Loading label={t('app.loading')} />

  return (
    <div className="sepia-shell" data-sepia-shell={status} data-sepia-markup-report={report ?? undefined}>
      {engine === 'absent' && (
        <div className="sepia-agent-line" data-sepia-agent="absent">
          {t('agent.absent.line')}
        </div>
      )}
      {kHint !== null && <div className="sepia-agent-hint">{kHint}</div>}
      {error !== null && <div className="sepia-error">{error}</div>}
      {saveWarning && <div className="sepia-save-warning" data-sepia-save-warning="on" title={t('error.save.failed')} />}
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
      {page === null ? (
        <div className="sepia-empty">
          <p>{t('empty.hint')}</p>
          <button type="button" onClick={() => void pick()}>
            {t('empty.open')}
          </button>
        </div>
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
          onChange={(next) => {
            draft.current = next
            setDirty(true)
            autosave.current?.bump()
          }}
          onCursorChange={(cursor) => {
            sessionDraft.current.cursor = cursor
            schedulePersist(page.path)
          }}
          onScrollChange={(scrollTop) => {
            sessionDraft.current.scrollTop = scrollTop
            schedulePersist(page.path)
          }}
          onReady={() => api.perfMark('t5')}
        />
      )}
    </div>
  )
}
