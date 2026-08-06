import { useEffect, useRef, useState } from 'react'

import { type ConflictChoice, type CopyKey, decideExternalChange, type FileNotice, planConflictChoice, t } from '@sepia/core'

import { api } from '../services/api.ts'

// 外部变更的消费端（架构 §4.9 / 170 §1.2）。
//
// 为什么判定在 core、消费在这里：**只有 renderer 知道脏不脏、光标在哪**。
// main 报事实（`FileNotice`），core 裁去向（`decideExternalChange`，四格矩阵），
// 这里只负责按裁决动手——重载走既有 open 路径，落盘走既有 ⌘S 路径，
// 一条新的写通道都没有（不变量 3 的形态防线：写正文的路径不许因为一个新功能多一条）。
//
// shell 冻结令（170 §1.1〇-2）下 renderer 只许多一处点状 UI，就是这个横条。
// 所以判定、动手、文案全在本文件，App.tsx 只多一次 hook 调用与一行渲染。

/** 降级告知这类一次性提示自己消失；涉及用户字节的横条常驻（见 core 的 sticky）。 */
const TRANSIENT_NOTICE_MS = 10_000

export interface ConflictBanner {
  /** 给 smoke 与截图留档用的判读位：`saved` / `removed` / `degraded`。 */
  kind: 'saved' | 'removed' | 'degraded'
  text: string
  /**
   * 三选（Stage 5b，170 回流 3）。只在**有脏冲突且拿得到外部那一版**时出现——
   * 拿不到就降级回 a 期的一句话，因为没有外部版本的"三选"是假的三选。
   *
   * **横条出现时字已经安全了**（a 期的"先落盘"没有变）：三选是在"已经安全"之上
   * 给回旋，不是让用户在丢字的风险下做选择题。
   */
  choices?: { choose: (choice: ConflictChoice) => void }
}

export interface ExternalChangeOptions {
  /** 当前 page 的绝对路径；null = 空状态，此时没有任何东西要盯。 */
  path: string | null
  dirty: boolean
  /** 用外部那一版覆盖正文（三选的 `theirs`）。走既有 open 路径，不另开写通道。 */
  adoptTheirs?: (content: string) => void
  /** ⌘S 那条保存路径本身。有脏时**先落盘**用它，不另开通道。 */
  save: () => Promise<void>
  /** 打开 page 的既有路径。重载 = 用新光标重新 open 一次。 */
  reload: (path: string, cursor: number, scrollTop: number) => Promise<void>
  /** 此刻的光标与滚动。重载要用它们「尽量保住光标」（架构 §4.9）。 */
  position: () => { cursor: number; scrollTop: number }
}

const BANNER_KIND: Partial<Record<CopyKey, ConflictBanner['kind']>> = {
  'conflict.saved': 'saved',
  'conflict.removed': 'removed',
  'conflict.watcher.degraded': 'degraded',
}

export function useExternalChange(options: ExternalChangeOptions): ConflictBanner | null {
  const [banner, setBanner] = useState<ConflictBanner | null>(null)
  // 订阅只建一次（桥上的 listener 不该随每次渲染拆装），所以易变的入参走 ref。
  const latest = useRef(options)
  latest.current = options
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const show = (key: CopyKey, sticky: boolean): void => {
      if (timer.current !== null) clearTimeout(timer.current)
      setBanner({ kind: BANNER_KIND[key] ?? 'saved', text: t(key) })
      if (sticky) return
      timer.current = setTimeout(() => {
        timer.current = null
        setBanner(null)
      }, TRANSIENT_NOTICE_MS)
    }

    const off = api.onExternalChange((notice: FileNotice) => {
      const { path, dirty, save, reload, position } = latest.current
      if (notice.type === 'watcher-degraded') {
        show('conflict.watcher.degraded', false)
        return
      }
      // main 已经只报当前 page，这里再确认一次：换页与事件到达之间有一帧的空隙。
      if (path === null || notice.path !== path) return

      const decision = decideExternalChange({ kind: notice.kind, dirty })
      void (async () => {
        // 顺序就是架构 §4.9 的原文顺序：**先落盘，再告知**。
        // 反过来（先告知再落盘）在用户眼里没差别，但中间那一瞬间用户的字还只在内存里，
        // 而横条已经说"已经落盘"了——那是一句可能不成立的话。
        if (decision.action === 'save') await save()
        if (decision.action === 'reload') {
          const { cursor, scrollTop } = position()
          await reload(notice.path, cursor, scrollTop)
        }
        if (decision.notice !== null) {
          show(decision.notice, decision.sticky)
          // 三选：**外部那一版已经由 main 在发通知之前留存过了**，所以这里拿得到它。
          const theirs = notice.type === 'external-change' ? notice.theirs : undefined
          const adopt = latest.current.adoptTheirs
          if (decision.action === 'save' && theirs !== undefined && adopt !== undefined) {
            setBanner({
              kind: 'saved',
              text: t('conflict.choose'),
              choices: {
                choose: (choice) => {
                  const plan = planConflictChoice(choice)
                  // `preserve` 那一半已经办了（theirs 在通知前留存、mine 在磁盘上就是当前内容），
                  // 这里只剩"采纳谁"——**采纳前不需要再留存一次**，因为两版此刻都还在。
                  if (plan.adopt === 'theirs') adopt(theirs)
                  setBanner(null)
                },
              },
            })
          }
        } else setBanner(null)
      })()
    })

    return () => {
      off()
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])

  // 换 page 就把上一页的横条收掉——它说的是那个文件的事。
  useEffect(() => {
    setBanner(null)
  }, [options.path])

  return banner
}
