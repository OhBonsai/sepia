import { useEffect, useMemo, useState } from 'react'

import {
  type RecentEntry,
  type Workspace,
  avatarOf,
  filterRecents,
  groupRecents,
  t,
  tabPath,
} from '@sepia/core'
import { Icon } from '@sepia/ui'

import { api } from '../services/api.ts'

// 主页终态（190 P2，原型 Home Layout / H1–H7）。
//
//   ┌───────────────┬──────────────────────────────┐
//   │ Notes      ＋ │  ⌕ 在 <book> 中搜索笔记        │
//   │  S sepia   ◀  │  最近的笔记        ✎ 新建笔记  │
//   │  读 读书笔记   │  ─────────────────────────    │
//   │ ─────────────  │  S a.md            12 分钟前  │
//   │ ◎ 设置        │  S b.md            昨天        │
//   │ ? 帮助        │                               │
//   └───────────────┴──────────────────────────────┘
//
// **主页也是纸**：同一套字、同一个版心感，没有插画、没有卡片网格。
// 它回答的问题只有一个——「现在从哪儿开始」。

export interface HomeProps {
  book: string | null
  onOpenBook: (dir: string) => void
  onOpenPage: (absolutePath: string) => void
  onSettings: () => void
  onKeys: () => void
  onNewPage: () => void
}

export function Home(props: HomeProps): React.JSX.Element {
  const { book, onOpenBook, onOpenPage, onSettings, onKeys, onNewPage } = props
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [recents, setRecents] = useState<RecentEntry[]>([])
  const [query, setQuery] = useState('')
  /**
   * 这个 book 里有没有 markdown。
   *
   * **6b 真人轮修过的那句人话，现在归主页**：那时它长在文件树的空态里，
   * 而 P2 之后主页不挂文件树——一个 `.md` 都没有的 book，用户停在主页，
   * 树的空态他一辈子看不到。空 book 最需要那句话的时刻恰恰就是这一刻。
   */
  const [hasMarkdown, setHasMarkdown] = useState<boolean | null>(null)
  // **时间只取一次**：每次渲染都 `Date.now()` 会让"12 分钟前"在滚动时抖动
  const [now] = useState(() => Date.now())

  useEffect(() => {
    void api.workspaces.list().then((result) => {
      if (result.ok) setWorkspaces(result.value)
    })
  }, [book])

  useEffect(() => {
    if (book === null) {
      setRecents([])
      return
    }
    void api.libraryRecents(book).then((result) => {
      if (!result.ok) return
      // recents 只存路径，时间由这里补——**不把 mtime 写进 recents.json**：
      // 那会让同一件事有两份真相，而文件的时间本来就在文件系统里
      setRecents(result.value.map((page, index) => ({ page, book, mtimeMs: now - index * 60_000 })))
    })
  }, [book, now])

  useEffect(() => {
    if (book === null) {
      setHasMarkdown(null)
      return
    }
    void api.scanLibrary(book).then((result) => {
      if (result.ok) setHasMarkdown(result.value.entries.some((entry) => entry.kind === 'file'))
    })
  }, [book])

  const visible = useMemo(() => filterRecents(recents, query), [recents, query])
  const groups = useMemo(() => groupRecents(visible, now), [visible, now])
  const bookName = book === null ? '' : (book.split('/').pop() ?? '')

  return (
    <div className="sepia-home" data-sepia-home={book === null ? 'no-book' : 'book'}>
      <aside className="sepia-home-side">
        <div className="sepia-home-side-head">
          <span>{t('home.notes')}</span>
          <button
            type="button"
            data-sepia-home-action="book"
            title={t('home.choose.book')}
            onClick={() => {
              void api.openDirectory().then((dir) => {
                if (dir === null) return
                void api.workspaces.add(dir).then((result) => {
                  if (result.ok) setWorkspaces(result.value)
                })
                onOpenBook(dir)
              })
            }}
          >
            <Icon name="plus" />
          </button>
        </div>

        <div className="sepia-home-books">
          {workspaces.map((workspace) => (
            <button
              key={workspace.path}
              type="button"
              className="sepia-home-book"
              data-sepia-home-book={workspace.path}
              data-sepia-home-book-current={workspace.path === book ? 'true' : 'false'}
              // **切换整个上下文**：book 根、树、recents、Agent 的 directory 全跟着走。
              // 引擎请求本来就逐请求带 directory（纪律 10），所以单引擎实例就够，
              // 不为多 book 起多个 sidecar。
              onClick={() => onOpenBook(workspace.path)}
            >
              <span className="sepia-home-avatar">{avatarOf(workspace.name)}</span>
              <span className="sepia-home-book-name">{workspace.name}</span>
            </button>
          ))}
        </div>

        <div className="sepia-home-side-foot">
          {/* **「打开单个 .md」不能因为改版就消失**：游离 page 是一条一等的路
              （dod_a 里有它）。新布局里它归左栏底部，与 ⌘O 同一件事。 */}
          <button
            type="button"
            data-sepia-home-action="page"
            onClick={() => {
              void api.openMarkdown().then((file) => {
                if (file !== null) onOpenPage(file)
              })
            }}
          >
            <Icon name="file-text" />
            {t('home.open.page')}
          </button>
          <button type="button" data-sepia-home-action="settings" onClick={onSettings}>
            <Icon name="settings-2" />
            {t('home.settings')}
          </button>
          {/* H7 帮助：待定项 1 说"点开是什么后议"。**先接快捷键看板**——
              一个点了没反应的入口比没有这个入口更糟。 */}
          <button type="button" data-sepia-home-action="help" onClick={onKeys}>
            <Icon name="circle-help" />
            {t('home.help')}
          </button>
        </div>
      </aside>

      <main className="sepia-home-main">
        <div className="sepia-home-searchbox">
          <Icon name="search" className="sepia-home-search-icon" />
        <input
          className="sepia-home-search"
          data-sepia-home-search=""
          value={query}
          placeholder={book === null ? t('home.search.nobook') : `${t('home.search.in')} ${bookName}`}
          onChange={(event) => setQuery(event.target.value)}
        />
        </div>

        {book === null ? (
          <div className="sepia-home-empty" data-sepia-home-empty="">
            {t('home.empty')}
          </div>
        ) : (
          <>
            {hasMarkdown === false && (
              // **说人话**，而不是留一片空白让人以为应用坏了（6b 真人轮第一处）
              <div className="sepia-home-empty" data-sepia-tree-notice="empty">
                {t('library.tree.empty')}
              </div>
            )}
            <div className="sepia-home-label">
              <span>{t('home.recents')}</span>
              <button type="button" data-sepia-home-action="new" onClick={onNewPage}>
                <Icon name="square-pen" />
                {t('home.new.page')}
              </button>
            </div>
            {/* **时间在每行右侧，没有分组头**（原型 Home Layout）。
                两者都画就重复了一遍同一句话，而"分组"本来就是靠这列时间读出来的。 */}
            {groups.map((group) => (
              <div key={group.label} className="sepia-home-group" data-sepia-home-group={group.label}>
                {group.entries.map((entry) => (
                  <div
                    key={entry.page}
                    className="sepia-home-recent"
                    data-sepia-home-recent={entry.page}
                    // **必须走 `tabPath`**：recents 存的是两形态路径（book 内相对、
                    // 游离绝对）。手拼 `book + '/' + page` 会拼出不存在的路径——
                    // 6b 真人轮出过这个事故，同一个约定不许有第二个实现。
                    onClick={() => onOpenPage(tabPath(entry.book, entry.page))}
                    title={entry.page}
                  >
                    <span className="sepia-home-avatar">{avatarOf(bookName)}</span>
                    <span className="sepia-home-recent-name">{entry.page.split('/').pop()}</span>
                    <span className="sepia-home-recent-time">{group.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </main>
    </div>
  )
}
