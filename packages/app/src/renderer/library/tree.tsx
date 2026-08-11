import { useEffect, useState } from 'react'

import { t, type TreeEntry, type TreeScan } from '@sepia/core'
import { Icon } from '@sepia/ui'

import { api } from '../services/api.ts'
import { execute } from '../commands/registry.ts'

// 文件树（170 §2.1 ②）：**可全收起的侧边栏**，一次性异步扫描，不递归 watch。
//
// 三条来自 6a 回流 1 的约束，全部落在这里：
//   1. **有界**——超上限就降级为只列第一层，并且**说出来**
//   2. **不递归 watch**——刷新走 focus 对账（6a 已有的那条路），不为树再开一套监听
//   3. **不进启动同步路径**——扫描在挂载之后异步跑，纸早就可写了（纪律 12）

export interface FileTreeProps {
  book: string
  /** 当前打开的 page（book 相对路径），用来高亮 */
  current: string | null
  onOpen: (relativePath: string) => void
}

export function FileTree(props: FileTreeProps): React.JSX.Element {
  const { book, current, onOpen } = props
  const [scan, setScan] = useState<TreeScan | null>(null)

  const refresh = (): void => {
    void api.scanLibrary(book).then((result) => {
      if (result.ok) setScan(result.value)
    })
  }

  useEffect(() => {
    refresh()
    // **刷新走 focus 对账**，不为树单开 watcher（6a 回流 1）：
    // 切回窗口时重扫一次，覆盖"在别处新建/删除了文件"这个绝大多数场景。
    const onFocus = (): void => refresh()
    globalThis.addEventListener('focus', onFocus)
    return () => globalThis.removeEventListener('focus', onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh 每次渲染都新建，挂它会变成无限重扫
  }, [book])

  if (scan === null) return <div className="sepia-tree" data-sepia-tree="loading" />

  const row = (entry: TreeEntry): React.JSX.Element => {
    const isCurrent = entry.kind === 'file' && entry.path === current
    return (
      <div
        key={entry.path}
        className="sepia-tree-row"
        data-sepia-tree-entry={entry.path}
        data-sepia-tree-kind={entry.kind}
        data-sepia-tree-current={isCurrent ? 'true' : 'false'}
        style={{ paddingLeft: `${8 + entry.depth * 12}px` }}
        onClick={() => {
          if (entry.kind === 'file') onOpen(entry.path)
        }}
        onContextMenu={(event) => {
          // 右键菜单接 6a 的四条文件命令。**不自绘菜单**——命令注册表已经是
          // 那四件事的唯一入口，再画一套 UI 就成了第二个入口（纪律 6 的精神）。
          event.preventDefault()
          if (entry.kind === 'file') void execute('files.trash', entry.path)
        }}
      >
        {entry.name}
      </div>
    )
  }

  return (
    <div className="sepia-tree" data-sepia-tree={scan.degraded ? 'degraded' : 'full'}>
      {/* 收起侧边栏。此前**只有 ⌘\ 一条路**——一个只能靠快捷键触达的功能，
          等于对不知道那个键的人不存在。走 `execute` 而不是自己 setState：
          按钮与键位是同一条路（纪律 6）。 */}
      <div className="sepia-tree-head">
        <button
          type="button"
          data-sepia-tree-collapse=""
          title={t('cmd.library.sidebar')}
          onClick={() => void execute('library.sidebar')}
        >
          <Icon name="panel-left-close" size={14} />
        </button>
      </div>
      {scan.degraded && (
        // **降级要说出来**：悄悄截断会让用户以为文件就这些
        <div className="sepia-tree-notice" data-sepia-tree-notice="degraded">
          {t('library.tree.degraded')}
        </div>
      )}
      {scan.entries.length === 0 && (
        // **空态要说人话**：真人轮里一个没有 .md 的 book 只显示两个哑目录行，
        // 看起来跟坏了一样（170 §2.9 条目 4）
        <div className="sepia-tree-notice" data-sepia-tree-notice="empty">
          {t('library.tree.empty')}
        </div>
      )}
      {scan.entries.map(row)}
    </div>
  )
}
