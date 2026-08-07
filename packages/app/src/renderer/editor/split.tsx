import { useEffect, useState } from 'react'

import { type TextFidelity, readFidelity } from '@sepia/editor'

import { api } from '../services/api.ts'
import { EditorHost } from './host.tsx'

// F16 @ 双屏的第二编辑器（190 P5）。
//
// **是完整编辑器，不是只读预览**（features F16 原文）：右栏里可以编辑、可以 ⌘K。
// 于是 EditorHost 必须能多实例——本期解禁（此前只有一处在用，不代表它只能有一处）。
//
// **双屏不改变 markup 上下文**（D-31）：⌘K 只带焦点编辑器的选区及其前后文，
// 右栏内容要用就显式 `@content`。隐式追加会让同一句指令在不同屏幕状态下
// 产生不同结果，而且用户不可预期地涨 token。

export interface SplitEditorProps {
  path: string
}

export function SplitEditor(props: SplitEditorProps): React.JSX.Element {
  const { path } = props
  const [doc, setDoc] = useState<{ body: string; fidelity: TextFidelity } | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setDoc(null)
    setError(false)
    void api.readFile(path).then((result) => {
      if (!result.ok) {
        setError(true)
        return
      }
      setDoc(readFidelity(result.value))
    })
  }, [path])

  if (error) return <div className="sepia-split-note">{path}</div>
  if (doc === null) return <div className="sepia-split-note" />

  return (
    <div className="sepia-split" data-sepia-split={path}>
      <EditorHost
        doc={doc.body}
        lineEnding={doc.fidelity.lineEnding}
        initialCursor={0}
        initialScrollTop={0}
        assetBase={path.slice(0, path.lastIndexOf('/'))}
        onSearchReady={() => undefined}
        onEditorReady={() => undefined}
        onChange={() => undefined}
        onCursorChange={() => undefined}
        onScrollChange={() => undefined}
        onReady={() => undefined}
      />
    </div>
  )
}
