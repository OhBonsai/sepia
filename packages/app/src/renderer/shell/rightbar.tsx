import { useCallback, useEffect, useRef } from 'react'

import { type CopyKey, type Rightbar as RightbarState, clampRightbar, t } from '@sepia/core'
import { Icon } from '@sepia/ui'

// 右侧区容器（190 P0）。**一个位置，三种占用者互斥**，语义在 core 的 `openRight`。
//
// 这一层只管三件事：画壳、× 关掉、中缝拖宽。里面装什么由调用方给 children——
// 容器认识"面板/编辑器/浏览器"的话，每加一种占用者就要改它一次。

/** 标题的文案键。**显式表而不是拼串**——拼出来的键绕过 `CopyKey` 检查（纪律 5）。 */
const TITLE: Record<NonNullable<RightbarState>['kind'], CopyKey> = {
  threads: 'rightbar.threads',
  links: 'rightbar.links',
  split: 'rightbar.split',
  browser: 'rightbar.browser',
}

export interface RightbarProps {
  state: NonNullable<RightbarState>
  width: number
  onWidth: (width: number) => void
  onClose: () => void
  children: React.ReactNode
}

export function Rightbar(props: RightbarProps): React.JSX.Element {
  const { state, width, onWidth, onClose, children } = props
  const dragging = useRef(false)

  const onMove = useCallback(
    (event: MouseEvent) => {
      if (!dragging.current) return
      // 从右边缘算：鼠标离右边界多远，右栏就多宽
      onWidth(clampRightbar(globalThis.innerWidth - event.clientX, globalThis.innerWidth))
    },
    [onWidth],
  )

  useEffect(() => {
    const stop = (): void => {
      dragging.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stop)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stop)
    }
  }, [onMove])

  return (
    <aside className="sepia-rightbar" data-sepia-rightbar={state.kind} style={{ width: `${String(width)}px` }}>
      {/* 中缝：**它自己是把手**，不额外画一根竖线——多一根线就多一道视觉噪声 */}
      <div
        className="sepia-rightbar-seam"
        data-sepia-rightbar-seam=""
        onMouseDown={(event) => {
          event.preventDefault()
          dragging.current = true
          document.body.style.cursor = 'col-resize'
        }}
      />
      <div className="sepia-rightbar-head">
        <span className="sepia-rightbar-title">{t(TITLE[state.kind])}</span>
        <button type="button" data-sepia-rightbar-close="" title={t('rightbar.close')} onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="sepia-rightbar-body">{children}</div>
    </aside>
  )
}
