import { describe, expect, it } from 'vitest'

import { metaFields, parseFrontmatter, setMetaField } from '../src/markdown/frontmatter.ts'

// 190 P4 / F8：属性表 = frontmatter 字节。**没动的行逐字节原样**（不变量 2）。

const DOC = '---\ntitle: 甲\ndate: 2026-08-07\ntags: [a, b]\n---\n\n# 正文\n\n内容。\n'

describe('解析', () => {
  it('取出块内的行与正文起点', () => {
    const front = parseFrontmatter(DOC)
    expect(front.lines).toEqual(['title: 甲', 'date: 2026-08-07', 'tags: [a, b]'])
    expect(DOC.slice(front.bodyFrom)).toBe('\n# 正文\n\n内容。\n')
  })

  it('**只认文档最开头那一块**——中间的 `---` 是分隔线', () => {
    expect(parseFrontmatter('# 标题\n\n---\n\n正文\n').lines).toEqual([])
  })

  it('没有收尾的 `---` 不算 frontmatter（否则会把正文吃掉一大段）', () => {
    expect(parseFrontmatter('---\ntitle: 甲\n\n正文没有收尾\n').lines).toEqual([])
  })

  it('没有 frontmatter 时是干净的空', () => {
    const front = parseFrontmatter('# 只有正文\n')
    expect(front.range).toEqual({ from: 0, to: 0 })
    expect(front.bodyFrom).toBe(0)
  })
})

describe('字段切分', () => {
  it('切出键值', () => {
    expect(metaFields(parseFrontmatter(DOC)).map((f) => f.key)).toEqual(['title', 'date', 'tags'])
  })

  it('**不认识的行不返回**——注释、多行值、嵌套结构都留着不动', () => {
    const front = parseFrontmatter('---\n# 一条注释\ntitle: 甲\n  - 缩进的东西\n---\n正文\n')
    expect(metaFields(front).map((f) => f.key)).toEqual(['title'])
    expect(front.lines).toHaveLength(3)
  })
})

describe('写回', () => {
  it('改一个字段：**只有那一行变了**', () => {
    const next = setMetaField(DOC, 'title', '乙')
    expect(next).toBe(DOC.replace('title: 甲', 'title: 乙'))
  })

  it('**正文一个字节没动**', () => {
    const next = setMetaField(DOC, 'title', '乙')
    expect(next.slice(next.indexOf('# 正文'))).toBe(DOC.slice(DOC.indexOf('# 正文')))
  })

  it('键不存在就插在块尾，不重排已有的键', () => {
    const next = setMetaField(DOC, 'status', 'draft')
    expect(next).toContain('tags: [a, b]\nstatus: draft\n---')
    expect(next.indexOf('title')).toBeLessThan(next.indexOf('date'))
  })

  it('没有 frontmatter 时新建一块，正文原样接在后面', () => {
    const next = setMetaField('# 只有正文\n', 'title', '甲')
    expect(next).toBe('---\ntitle: 甲\n---\n# 只有正文\n')
  })

  it('**CRLF 文件用 CRLF 写回**——掺一个 LF 就是多出的一处改写', () => {
    const crlf = '---\r\ntitle: 甲\r\n---\r\n正文\r\n'
    expect(setMetaField(crlf, 'title', '乙')).toBe('---\r\ntitle: 乙\r\n---\r\n正文\r\n')
  })

  it('不认识的行在写回时原样保留', () => {
    const doc = '---\n# 注释\ntitle: 甲\n---\n正文\n'
    expect(setMetaField(doc, 'title', '乙')).toBe('---\n# 注释\ntitle: 乙\n---\n正文\n')
  })
})
