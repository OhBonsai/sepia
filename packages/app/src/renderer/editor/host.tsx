import { useEffect, useRef } from 'react'

import { type LineEnding, type MountedEditor, type SearchApi, mountEditor } from '@sepia/editor'

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
  /** page 所在目录：图片相对路径的解析基（Stage 2）。 */
  assetBase: string
  onChange: (doc: string) => void
  onCursorChange: (cursor: number) => void
  onScrollChange: (scrollTop: number) => void
  /** CM6 就绪且光标落位——t5，即"可写"。 */
  onReady: () => void
  /** 查找替换的驱动接口就绪时上抛（editor ↮ ui，UI 在 app 装配）。 */
  onSearchReady: (api: SearchApi) => void
  /**
   * 编辑器就绪时把 `MountedEditor` 上抛，供 ⌘K 取选区快照与落笔。
   * **上抛的是 MountedEditor，不是 EditorView**——后者一旦出手，
   * 谁都能 `dispatch({ changes })` 绕过 CAS，落笔就不再是唯一途径（纪律 9c）。
   */
  onEditorReady: (editor: MountedEditor) => void
}

export function EditorHost({
  doc,
  lineEnding,
  initialCursor,
  initialScrollTop,
  assetBase,
  onChange,
  onCursorChange,
  onScrollChange,
  onReady,
  onSearchReady,
  onEditorReady,
}: EditorHostProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<MountedEditor | null>(null)

  // 回调放进 ref：它们变化时不重建 EditorView——重建会丢光标、丢滚动、丢撤销历史。
  const handlers = useRef({ onChange, onCursorChange, onScrollChange, onReady, onSearchReady, onEditorReady })
  handlers.current = { onChange, onCursorChange, onScrollChange, onReady, onSearchReady, onEditorReady }

  useEffect(() => {
    let disposed = false
    let instance: MountedEditor | null = null

    // 语法层异步装载（001 §4.7）：markdown 层 ~1MB，静态 import 会挡首帧。
    // t5（可写）在装载完成后才落点——代价记在 t3→t5，那段预算还剩一半。
    void import('@sepia/editor/markdown').then(({ markdownExtensions, searchApi }) => {
      if (disposed || !container.current) return
      instance = mountEditor({
        doc,
        cursor: initialCursor,
        scrollTop: initialScrollTop,
        parent: container.current,
        lineEnding,
        syntax: markdownExtensions({ assetBase }),
        searchFactory: searchApi,
        onChange: (next) => handlers.current.onChange(next),
        onSelectionChange: (cursor) => handlers.current.onCursorChange(cursor),
        onScroll: (scrollTop) => handlers.current.onScrollChange(scrollTop),
      })
      editor.current = instance
      instance.focus()
      handlers.current.onReady()
      handlers.current.onEditorReady(instance)
      if (instance.search) handlers.current.onSearchReady(instance.search)
    })

    return () => {
      disposed = true
      instance?.destroy()
      editor.current = null
    }
    // doc / lineEnding 变化 = 换了文件，此时**应当**重建
  }, [doc, lineEnding, initialCursor, initialScrollTop, assetBase])

  return <div className="sepia-editor" ref={container} />
}
