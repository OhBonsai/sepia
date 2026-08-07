import { useEffect } from 'react'

import { t } from '@sepia/core'

// ⌘⇧I 信息浮层（180 §1.2，D-30）。
//
// **纸面无声之事的家。** D-30 否掉了常驻底部状态栏——字数、保存状态这类信息是
// "偶尔查一次"的，不配占永久版面；但它们也不该无处可查。折中就是按需唤起的浮层。
//
// **只读，不放操作**（180 刹车条款）。放一个「立即保存」按钮看起来很顺手，
// 但那会让这块浮层从"看一眼"变成"要在这儿干活"，接着就会有人往里加第二个按钮。
//
// 数据**全部来自 renderer 已有的状态**——桥零增长（180 §1.3 的目标）。
// 这一点值得说清：字数、脏否、线程数、book 身份、engine 状态本来就都在 App 的
// state 里，commit 短 hash 是 `save()` 的返回值。没有一样需要新开一条查询。

export interface InfoOverlayProps {
  words: number
  savedAt: number | null
  /** 最近一次 commit 的短 hash；`failed` = 有过 commit 但失败了（架构 §4.2 的留痕） */
  commit: string | null
  commitFailed: boolean
  threads: number
  orphans: number
  book: string | null
  path: string | null
  agentReady: boolean
  onClose: () => void
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function clock(at: number | null): string {
  if (at === null) return t('info.saved.never')
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function InfoOverlay(props: InfoOverlayProps): React.JSX.Element {
  const { onClose } = props

  useEffect(() => {
    // **再按一次或打字即淡出**（D-30）：它是一瞥，不是一个要你去关的窗口。
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      // ⌘⇧I 自己那一下由 App 的键处理器切换，别在这儿重复消费
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.length === 1) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const rows: { key: string; label: string; value: string }[] = [
    { key: 'words', label: t('info.words'), value: String(props.words) },
    { key: 'saved', label: t('info.saved'), value: clock(props.savedAt) },
    {
      key: 'commit',
      label: t('info.commit'),
      // **commit 失败在这里第一次变得可见**（架构 §4.2：⌘⇧I 是它唯一的去处）。
      // 在此之前失败只进日志——用户完全无从知道版本没记上。
      value: props.commitFailed ? t('info.commit.failed') : (props.commit ?? t('info.commit.none')),
    },
    { key: 'threads', label: t('info.threads'), value: `${String(props.threads)} / ${String(props.orphans)}` },
    { key: 'book', label: t('info.book'), value: props.book ?? t('info.book.none') },
    { key: 'path', label: t('info.path'), value: props.path ?? '—' },
    {
      key: 'agent',
      label: t('info.agent'),
      value: props.agentReady ? t('info.agent.ready') : t('info.agent.absent'),
    },
  ]

  return (
    <div className="sepia-info" data-sepia-info="open">
      {rows.map((row) => (
        <div key={row.key} className="sepia-info-row" data-sepia-info-row={row.key}>
          <span className="sepia-info-label">{row.label}</span>
          <span className="sepia-info-value">{row.value}</span>
        </div>
      ))}
    </div>
  )
}
