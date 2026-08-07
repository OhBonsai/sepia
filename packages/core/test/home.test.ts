import { describe, expect, it } from 'vitest'

import {
  addWorkspace,
  avatarOf,
  filterRecents,
  groupRecents,
  relativeTime,
  workspaceName,
} from '../src/library/home.ts'

// 190 P2：主页终态的纯逻辑。

describe('workspace', () => {
  it('默认名取目录名', () => {
    expect(workspaceName('/Users/wp/w/art/sepia')).toBe('sepia')
    expect(workspaceName('/Users/wp/w/art/sepia/')).toBe('sepia')
  })

  it('**中文头像取首字，不转写**——转写会让中文名挤成一堆看不出区别的拼音首字母', () => {
    expect(avatarOf('读书笔记')).toBe('读')
    expect(avatarOf('sepia')).toBe('S')
  })

  it('同一个目录只留一条，且新加的排最前（刚选的就是你要用的）', () => {
    const one = addWorkspace([], '/a')
    const two = addWorkspace(one, '/b')
    expect(two.map((entry) => entry.path)).toEqual(['/b', '/a'])
    const again = addWorkspace(two, '/a')
    expect(again.map((entry) => entry.path)).toEqual(['/a', '/b'])
    expect(again).toHaveLength(2)
  })
})

describe('相对时间（越久越粗粒度）', () => {
  const now = Date.UTC(2026, 7, 7, 12, 0, 0)
  const ago = (ms: number): number => now - ms

  it('分钟级', () => {
    expect(relativeTime(ago(12 * 60_000), now)).toBe('12 分钟前')
  })

  it('小时级', () => {
    expect(relativeTime(ago(5 * 3_600_000), now)).toBe('5 小时前')
  })

  it('昨天 / N 天前 / 上周', () => {
    expect(relativeTime(ago(30 * 3_600_000), now)).toBe('昨天')
    expect(relativeTime(ago(3 * 86_400_000), now)).toBe('3 天前')
    expect(relativeTime(ago(9 * 86_400_000), now)).toBe('上周')
  })

  it('**再久就给绝对日期**——去年那篇你只需要知道它是去年的', () => {
    expect(relativeTime(Date.UTC(2024, 10, 19), now)).toMatch(/^2024-11-19$/)
  })
})

describe('分组与过滤', () => {
  const now = Date.UTC(2026, 7, 7, 12, 0, 0)
  const entries = [
    { page: 'a.md', book: '/b', mtimeMs: now - 12 * 60_000 },
    { page: 'b.md', book: '/b', mtimeMs: now - 13 * 60_000 },
    { page: 'c.md', book: '/b', mtimeMs: now - 3 * 86_400_000 },
  ]

  it('相邻同组的合成一段，顺序不动', () => {
    const groups = groupRecents(entries, now)
    expect(groups.map((g) => g.label)).toEqual(['12 分钟前', '13 分钟前', '3 天前'])
  })

  it('**过滤只按文件名**——全文搜索是 non-goals 的红线', () => {
    expect(filterRecents(entries, 'a').map((entry) => entry.page)).toEqual(['a.md'])
    expect(filterRecents(entries, '')).toHaveLength(3)
  })
})
