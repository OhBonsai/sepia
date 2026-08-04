import { useCallback, useEffect, useRef, useState } from 'react'

import { type EngineStatus, type SessionState, t } from '@sepia/core'
import { type SearchApi, type TextFidelity, readFidelity, writeFidelity } from '@sepia/editor'
import { Loading, SearchPanel } from '@sepia/ui'

import { EditorHost } from '../editor/host.tsx'
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
      return
    }
    setDirty(false)
    setError(null)
  }, [page])

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

  // ⌘K：本 stage 只显示状态（140 §1.2 刹车表——浮层的形态归 Stage 4）。
  const summon = useCallback((): void => {
    if (kHintTimer.current !== null) clearTimeout(kHintTimer.current)
    setKHint(engine === 'ready' ? null : t(engine === 'absent' ? 'agent.k.absent' : 'agent.k.starting'))
    kHintTimer.current = setTimeout(() => {
      kHintTimer.current = null
      setKHint(null)
    }, K_HINT_MS)
  }, [engine])

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
    <div className="sepia-shell" data-sepia-shell={status}>
      {engine === 'absent' && (
        <div className="sepia-agent-line" data-sepia-agent="absent">
          {t('agent.absent.line')}
        </div>
      )}
      {kHint !== null && <div className="sepia-agent-hint">{kHint}</div>}
      {error !== null && <div className="sepia-error">{error}</div>}
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
          onChange={(next) => {
            draft.current = next
            setDirty(true)
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
