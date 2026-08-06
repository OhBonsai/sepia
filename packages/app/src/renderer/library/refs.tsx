import { useEffect, useMemo, useState } from 'react'

import { matchRefs, type RefCandidate } from '@sepia/core'

// `@` 引用（170 §2.1 ④，人裁 4：**只搜文件名 + 标题，零索引服务**）。
//
// 这一层的全部难点是**即时**（§2.5 D2：按下到出列表 < 100ms）：
//   · 候选表用**文件树扫描的同一份内存清单**——不为 `@` 再扫一次盘
//   · 标题**后台异步补**；没补好时按纯文件名匹配，那不是降级路径，是常态路径
//   · 匹配是纯函数（core 的 `matchRefs`），没有 IO，所以"即时"是结构决定的，不是优化出来的

export interface RefPickerProps {
  candidates: RefCandidate[]
  query: string
  onPick: (candidate: RefCandidate) => void
  onClose: () => void
}

export function RefPicker(props: RefPickerProps): React.JSX.Element | null {
  const { candidates, query, onPick, onClose } = props
  const [index, setIndex] = useState(0)
  const matches = useMemo(() => matchRefs(candidates, query), [candidates, query])

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

  return (
    <div className="sepia-refs" data-sepia-refs={String(matches.length)}>
      {matches.map((candidate, at) => (
        <div
          key={candidate.path}
          className="sepia-ref"
          data-sepia-ref={candidate.path}
          data-sepia-ref-active={at === index ? 'true' : 'false'}
          onMouseDown={(event) => {
            // mousedown 而不是 click：click 之前编辑器会先失焦，插入点就没了
            event.preventDefault()
            onPick(candidate)
          }}
        >
          <span className="sepia-ref-title">{candidate.title ?? candidate.name}</span>
          {candidate.title !== undefined && <span className="sepia-ref-path">{candidate.name}</span>}
        </div>
      ))}
    </div>
  )
}

/**
 * 插入的是**标准 markdown 链接**（§2.0 预裁：不是 wiki 链接）。
 * 守 markdown 纯度：这份笔记在任何别的编辑器里打开都该是同一个意思。
 */
export function refLink(candidate: RefCandidate): string {
  return `[${candidate.title ?? candidate.name.replace(/\.mdx?$/, '')}](${candidate.path})`
}
