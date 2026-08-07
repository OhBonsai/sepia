import { useEffect, useState } from 'react'

import { t, tabPath } from '@sepia/core'

import { api } from '../services/api.ts'

// 主页（170 §2.1 ③，人裁 3 做完整版）。
//
// **主页也是纸**：同一张纸的版心、同一套字，没有插画、没有引导动画、没有卡片网格。
// 它出现的时机只有一个——一个 tab 都没开着。所以它要回答的问题也只有一个：
// 「现在从哪儿开始」。两条路 + 最近打开，够了。

export interface HomeProps {
  book: string | null
  onOpenBook: (dir: string) => void
  onOpenPage: (absolutePath: string) => void
}

export function Home(props: HomeProps): React.JSX.Element {
  const { book, onOpenBook, onOpenPage } = props
  const [recents, setRecents] = useState<string[]>([])

  useEffect(() => {
    if (book === null) {
      setRecents([])
      return
    }
    void api.libraryRecents(book).then((result) => {
      if (result.ok) setRecents(result.value)
    })
  }, [book])

  return (
    <div className="sepia-home" data-sepia-home={book === null ? 'no-book' : 'book'}>
      <div className="sepia-home-actions">
        <button
          type="button"
          data-sepia-home-action="book"
          onClick={() => {
            void api.openDirectory().then((dir) => {
              if (dir !== null) onOpenBook(dir)
            })
          }}
        >
          {t('home.choose.book')}
        </button>
        <button
          type="button"
          data-sepia-home-action="page"
          onClick={() => {
            void api.openMarkdown().then((file) => {
              if (file !== null) onOpenPage(file)
            })
          }}
        >
          {t('home.open.page')}
        </button>
      </div>

      {book !== null && recents.length > 0 && (
        <div className="sepia-home-recents" data-sepia-home-recents={String(recents.length)}>
          <div className="sepia-home-label">{t('home.recents')}</div>
          {recents.map((page) => (
            <div
              key={page}
              className="sepia-home-recent"
              data-sepia-home-recent={page}
              // **必须走 `tabPath`**：recents 里存的是 tab 那一套两形态路径——
              // book 内的是相对、**游离的是绝对**。手拼 `book + '/' + page` 会把绝对路径
              // 接在 book 后面，拼出一个不存在的路径（真人轮实测：点最近就"打不开这个文件"）。
              // core 里那句"两个进程共用一份换算口"就是为了防这个，我却在这儿又拼了一遍。
              onClick={() => onOpenPage(tabPath(book, page))}
              title={page}
            >
              {page.split('/').pop()}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
