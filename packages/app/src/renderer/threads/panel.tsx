import { useEffect, useState } from 'react'

import { t, type ThreadPlacement, type ThreadView } from '@sepia/core'

import { api } from '../services/api.ts'

// 线程面板（W11）：本篇线程 + **孤儿置灰区**。
//
// 唤起式，不常驻——常驻布局归 6b。这里的克制不是省事：面板一常驻，纸就从
// "一张纸"变成"带侧栏的应用"，而那正是整个产品在躲的东西。
//
// 孤儿区的语义要说清楚：**它们不是垃圾桶，是"暂时对不上"**。
// 正文改回去，它们自己就回到纸上（撤销联动，T-27）。

interface ThreadPanelProps {
  view: ThreadView
  /** 从徽章点进来的那条：面板打开时**直接展开它**，而不是只显示列表。 */
  focusId?: string | null
  /** book 目录，取 diff 用。 */
  directory: string
  page: string
  onClose: () => void
}

function turnsPreview(placement: ThreadPlacement): string {
  const first = placement.thread.turns.find((turn) => turn.role === 'user')
  return first?.text ?? ''
}

export function ThreadPanel(props: ThreadPanelProps): React.JSX.Element {
  const { view, directory, page, focusId, onClose } = props
  const [openId, setOpenId] = useState<string | null>(focusId ?? null)
  const [diff, setDiff] = useState<string | null>(null)

  // 点另一个徽章时面板已经开着，focusId 变了要跟着换——不跟的话第二次点毫无反应
  useEffect(() => {
    if (focusId !== undefined && focusId !== null) setOpenId(focusId)
  }, [focusId])

  // Esc 关闭——与浮层同一个出口（一种契约，不是两种）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (openId === null) {
      setDiff(null)
      return
    }
    const placement = view.badges.find((it) => it.thread.id === openId)
    const commits = placement?.thread.commits ?? null
    if (commits === null) {
      // **链失败：徽章仍在，只是 diff 不可用**（§2.2）。对话是纸上真发生过的事，
      // git 没记上不改变这一点。
      setDiff(null)
      return
    }
    void api.gitDiff(directory, commits.before, commits.after, page).then((result) => {
      setDiff(result.ok ? result.value : null)
    })
  }, [openId, view, directory, page])

  const row = (placement: ThreadPlacement, orphan: boolean): React.JSX.Element => (
    <div
      key={placement.thread.id}
      className="sepia-thread"
      data-sepia-thread={placement.thread.id}
      data-sepia-thread-open={openId === placement.thread.id ? 'true' : 'false'}
      data-sepia-orphan={String(orphan)}
      onClick={() => setOpenId(orphan ? null : placement.thread.id)}
    >
      {turnsPreview(placement)}
      {openId === placement.thread.id && (
        <div className="sepia-thread-turns" data-sepia-thread-turns={placement.thread.id}>
          {placement.thread.turns.map((turn, index) => (
            <div key={`${turn.role}-${index}`} data-sepia-turn={turn.role}>
              {turn.text}
            </div>
          ))}
        </div>
      )}
      {openId === placement.thread.id && (
        <div className="sepia-thread-diff" data-sepia-thread-diff={placement.diffAvailable ? 'on' : 'off'}>
          {placement.diffAvailable ? (diff ?? t('threads.diff.loading')) : t('threads.diff.unavailable')}
        </div>
      )}
    </div>
  )

  return (
    <div className="sepia-threads" data-sepia-threads="open">
      <div className="sepia-threads-title">{t('threads.title')}</div>
      {view.badges.map((placement) => row(placement, false))}
      {view.orphans.length > 0 && (
        <>
          {/* 置灰区：**沉下去，不消失**。正文改回去它们自己会回来 */}
          <div className="sepia-threads-title" data-sepia-threads-orphans="title">
            {t('threads.orphans')}
          </div>
          {view.orphans.map((placement) => row(placement, true))}
        </>
      )}
    </div>
  )
}
