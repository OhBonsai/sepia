import { useEffect, useRef } from 'react'

import { type LineEnding, type MountedEditor, mountEditor } from '@sepia/editor'

// CM6 宿主。**只负责容器与生命周期**——CM6 的类型与构造全在 @sepia/editor 里
// （通用能力不许留在 app，001 §2.1）。app 的 package.json 里没有 `@codemirror/*`，
// 想在这里直接 import 也编译不过，这是结构 2 的编译期物理约束在兜底。

export interface EditorHostProps {
  /** 文档正文。BOM 已被摘掉，换行风格由 lineEnding 单独给。 */
  doc: string
  lineEnding: LineEnding
  initialCursor: number
  /** 上次的滚动位置。失效时由 editor 侧的 scrollIntoView 兜底（附录 D.3）。 */
  initialScrollTop: number
  onChange: (doc: string) => void
  onCursorChange: (cursor: number) => void
  onScrollChange: (scrollTop: number) => void
  /** CM6 就绪且光标落位——t5，即"可写"。 */
  onReady: () => void
}

export function EditorHost({
  doc,
  lineEnding,
  initialCursor,
  initialScrollTop,
  onChange,
  onCursorChange,
  onScrollChange,
  onReady,
}: EditorHostProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<MountedEditor | null>(null)

  // 回调放进 ref：它们变化时不重建 EditorView——重建会丢光标、丢滚动、丢撤销历史。
  const handlers = useRef({ onChange, onCursorChange, onScrollChange, onReady })
  handlers.current = { onChange, onCursorChange, onScrollChange, onReady }

  useEffect(() => {
    if (!container.current) return

    const instance = mountEditor({
      doc,
      cursor: initialCursor,
      scrollTop: initialScrollTop,
      parent: container.current,
      lineEnding,
      onChange: (next) => handlers.current.onChange(next),
      onSelectionChange: (cursor) => handlers.current.onCursorChange(cursor),
      onScroll: (scrollTop) => handlers.current.onScrollChange(scrollTop),
    })
    editor.current = instance
    instance.focus()
    handlers.current.onReady()

    return () => {
      instance.destroy()
      editor.current = null
    }
    // doc / lineEnding 变化 = 换了文件，此时**应当**重建
  }, [doc, lineEnding, initialCursor, initialScrollTop])

  return <div className="sepia-editor" ref={container} />
}
