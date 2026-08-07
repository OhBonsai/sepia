import { describe, expect, it } from 'vitest'

import { collectLinks } from '../src/library/links.ts'

// 190 P5 / F17：连接面板——本篇引了谁，在哪儿引的。

const DOC = [
  '# 标题',
  '',
  '首段里提到 [甲](a.md) 这一篇。',
  '',
  '中间一段引了外链 [iq 的文章](https://iquilezles.org/x)。',
  '',
  '末段又引了一次 [甲](a.md)，还有一张图 ![图](assets/x.png)。',
  '',
].join('\n')

describe('抽取引用', () => {
  it('book 内与外链都收，并标出哪个是外链', () => {
    const links = collectLinks(DOC)
    expect(links.map((link) => link.target)).toEqual(['a.md', 'https://iquilezles.org/x', 'a.md'])
    expect(links.map((link) => link.external)).toEqual([false, true, false])
  })

  it('**图片不是引用**——`![]()` 不进这块面板', () => {
    expect(collectLinks(DOC).some((link) => link.target.endsWith('.png'))).toBe(false)
  })

  it('**不去重**：同一篇被引三次是三个位置，而这块面板回答的正是"在哪儿引的"', () => {
    expect(collectLinks(DOC).filter((link) => link.target === 'a.md')).toHaveLength(2)
  })

  it('位置标注：首段 / 第 N 段 / 末段（F17 原文要求）', () => {
    const links = collectLinks(DOC)
    expect(links[0]!.where).toBe('第 2 段')
    expect(links[2]!.where).toBe('末段')
  })

  it('带原文摘录，长段落两头省略', () => {
    const links = collectLinks(DOC)
    expect(links[0]!.excerpt).toContain('甲')
  })

  it('没有引用就是空，不硬凑', () => {
    expect(collectLinks('# 只有标题\n\n正文。\n')).toEqual([])
  })
})
