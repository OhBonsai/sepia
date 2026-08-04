// 查找替换面板。**dumb 组件**：不认识 CM6、不认识 CopyKey（ui ↮ core / editor ↮ ui），
// 文案与回调全部由 app 侧喂进来。
// 气质规则（130 风格裁决，借 opencode）：无阴影、4px 圆角、无渐变、即时状态切换——
// 层次全靠边框与底色，样式在 app 的 index.css 里、只用 --sepia-* 变量。

import { useEffect, useRef } from 'react'

export interface SearchPanelCopy {
  searchPlaceholder: string
  replacePlaceholder: string
  next: string
  previous: string
  replaceOne: string
  replaceAllLabel: string
  close: string
  /** 已经格式化好的命中数文案（"3 处" / "无结果"）。格式化归 app，ui 只显示。 */
  count: string
}

export interface SearchPanelProps {
  copy: SearchPanelCopy
  query: string
  replaceValue: string
  showReplace: boolean
  onQueryChange: (value: string) => void
  onReplaceChange: (value: string) => void
  onNext: () => void
  onPrevious: () => void
  onReplaceOne: () => void
  onReplaceAll: () => void
  onClose: () => void
}

export function SearchPanel(props: SearchPanelProps): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onClose()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) props.onPrevious()
      else props.onNext()
    }
  }

  return (
    <div className="sepia-search" role="search" onKeyDown={onKeyDown}>
      <div className="sepia-search-row">
        <input
          ref={input}
          className="sepia-search-input"
          value={props.query}
          placeholder={props.copy.searchPlaceholder}
          onChange={(event) => props.onQueryChange(event.target.value)}
        />
        <span className="sepia-search-count">{props.copy.count}</span>
        <button type="button" onClick={props.onPrevious} title={props.copy.previous}>
          ↑
        </button>
        <button type="button" onClick={props.onNext} title={props.copy.next}>
          ↓
        </button>
        <button type="button" onClick={props.onClose} title={props.copy.close}>
          ✕
        </button>
      </div>
      {props.showReplace && (
        <div className="sepia-search-row">
          <input
            className="sepia-search-input"
            value={props.replaceValue}
            placeholder={props.copy.replacePlaceholder}
            onChange={(event) => props.onReplaceChange(event.target.value)}
          />
          <button type="button" onClick={props.onReplaceOne}>
            {props.copy.replaceOne}
          </button>
          <button type="button" onClick={props.onReplaceAll}>
            {props.copy.replaceAllLabel}
          </button>
        </div>
      )}
    </div>
  )
}
