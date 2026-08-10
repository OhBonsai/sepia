import { useState } from 'react'

import { type MetaField, metaFields, parseFrontmatter, t } from '@sepia/core'

// ▤ 属性表（190 P4 / F8）。**行内展开，不是右侧面板**——
// 它是这张纸最上面那几行，只是换了个画法；进右栏就成了"在别处改这张纸的字节"。
//
// **编辑属性表 = 编辑 frontmatter 字节**：改一格只重写那一行，别的行逐字节原样
//（解析与写回在 core，12 条单测盯着，其中一条专盯 CRLF）。

export interface MetaTableProps {
  text: string
  /** 改一个字段。上层负责走 CAS 通道落到正文上。 */
  onSet: (key: string, value: string) => void
}

/** 新建笔记时该有的四个字段（设置「新建笔记带 frontmatter」的那一组）。 */
const SUGGESTED = ['title', 'date', 'tags', 'status']

export function MetaTable(props: MetaTableProps): React.JSX.Element {
  const { text, onSet } = props
  const front = parseFrontmatter(text)
  const fields = metaFields(front)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const known = new Set(fields.map((field) => field.key))
  // 建议字段里还没有的，画成空行让人填——**不自动写进文件**：
  // 打开一张纸就悄悄给它加四行 frontmatter，是在用户没动手时改他的字节
  const rows: (MetaField | { key: string; value: string; index: -1 })[] = [
    ...fields,
    ...SUGGESTED.filter((key) => !known.has(key)).map((key) => ({ key, value: '', index: -1 as const })),
  ]

  const commit = (key: string): void => {
    setEditing(null)
    onSet(key, draft)
  }

  return (
    <div className="sepia-meta" data-sepia-meta={String(fields.length)}>
      {rows.map((row) => (
        <div key={row.key} className="sepia-meta-row" data-sepia-meta-row={row.key}>
          <span className="sepia-meta-key">{row.key}</span>
          {editing === row.key ? (
            <input
              className="sepia-meta-value"
              data-sepia-meta-input={row.key}
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => commit(row.key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commit(row.key)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(null)
                }
              }}
            />
          ) : (
            <span
              className="sepia-meta-value"
              data-sepia-meta-value={row.key}
              onClick={() => {
                setEditing(row.key)
                setDraft(row.value)
              }}
            >
              {row.value === '' ? <em className="sepia-meta-blank">{t('meta.blank')}</em> : row.value}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
