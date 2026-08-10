import { useEffect, useState } from 'react'

import { type CopyKey, t } from '@sepia/core'

// F4 `/` 组件菜单（190 P1）。
//
// **空行触发、两项**（textdiagram / image；shader 按 D-27 移出 MVP）。
// 插入的是**标准围栏与标准图片引用**——菜单只是省去手打，不引入任何私有语法。
// 这一条是"文件即真相"在交互层的样子：菜单里选出来的东西，别的编辑器照样认。
//
// 与 `@` 选择器共用同一套形态（贴着光标、↑↓ 选、Enter 插、Esc 关），
// 因为它们在用户眼里是同一件事：行内敲一个符号，弹一列东西出来。

export interface SlashItem {
  id: 'textdiagram' | 'image'
  label: CopyKey
  /** 插入的文本；`|` 标记光标最终落点（插入后会被去掉）。 */
  insert: string
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'textdiagram', label: 'slash.textdiagram', insert: '```textdiagram\n|\n```\n' },
  { id: 'image', label: 'slash.image', insert: '![](|)' },
]

export interface SlashMenuProps {
  query: string
  anchor: { left: number; top: number; bottom: number } | null
  onPick: (item: SlashItem) => void
  onClose: () => void
}

export function SlashMenu(props: SlashMenuProps): React.JSX.Element | null {
  const { query, anchor, onPick, onClose } = props
  const [index, setIndex] = useState(0)
  const matches = SLASH_ITEMS.filter((item) => t(item.label).includes(query) || item.id.includes(query.toLowerCase()))

  useEffect(() => {
    setIndex(0)
  }, [query])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (matches.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setIndex((at) => (at + 1) % matches.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setIndex((at) => (at - 1 + matches.length) % matches.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const picked = matches[index]
        if (picked !== undefined) onPick(picked)
      }
    }
    // 捕获阶段：要抢在 CM6 之前拿到方向键与回车，否则光标会在正文里乱走
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [matches, index, onPick, onClose])

  if (matches.length === 0) return null

  const style =
    anchor === null
      ? { left: '24px', top: '24px' }
      : { left: `${String(Math.round(anchor.left))}px`, top: `${String(Math.round(anchor.bottom + 6))}px` }

  return (
    <div className="sepia-slash" data-sepia-slash={String(matches.length)} style={style}>
      {matches.map((item, at) => (
        <div
          key={item.id}
          className="sepia-slash-item"
          data-sepia-slash-item={item.id}
          data-sepia-slash-active={at === index ? 'true' : 'false'}
          onMouseDown={(event) => {
            // mousedown 而不是 click：click 之前编辑器会先失焦，插入点就没了
            event.preventDefault()
            onPick(item)
          }}
        >
          {t(item.label)}
        </div>
      ))}
    </div>
  )
}
