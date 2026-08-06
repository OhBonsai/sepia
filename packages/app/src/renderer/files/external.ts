import { useEffect, useRef, useState } from 'react'

import { type CopyKey, decideExternalChange, type FileNotice, t } from '@sepia/core'

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
}

export interface ExternalChangeOptions {
  /** 当前 page 的绝对路径；null = 空状态，此时没有任何东西要盯。 */
  path: string | null
  dirty: boolean
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
        if (decision.notice !== null) show(decision.notice, decision.sticky)
        else setBanner(null)
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
