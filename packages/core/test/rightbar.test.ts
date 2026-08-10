import { describe, expect, it } from 'vitest'

import { RIGHTBAR_MIN_PX, clampRightbar, openRight } from '../src/shell/rightbar.ts'

// 190 P0：右侧区三种占用者互斥。

describe('右侧区占用', () => {
  it('关着的时候开谁就是谁', () => {
    expect(openRight(null, { kind: 'threads' })).toEqual({ kind: 'threads' })
  })

  it('**不同类是顶替，不是并列**——右侧区只有一个位置', () => {
    expect(openRight({ kind: 'threads' }, { kind: 'links' })).toEqual({ kind: 'links' })
    expect(openRight({ kind: 'links' }, { kind: 'browser', url: 'https://x' })).toEqual({
      kind: 'browser',
      url: 'https://x',
    })
  })

  it('同类再开一次 = 关掉（与 ⌘⇧H 同一个切换手感）', () => {
    expect(openRight({ kind: 'threads' }, { kind: 'threads' })).toBeNull()
  })

  it('**⌘点新引用是换内容，不是关掉**（原文：永远只有两栏，替换右栏）', () => {
    expect(openRight({ kind: 'split', path: 'a.md' }, { kind: 'split', path: 'b.md' })).toEqual({
      kind: 'split',
      path: 'b.md',
    })
    // 点的是同一篇才收起
    expect(openRight({ kind: 'split', path: 'a.md' }, { kind: 'split', path: 'a.md' })).toBeNull()
  })

  it('浏览器换网址同理', () => {
    expect(openRight({ kind: 'browser', url: 'https://a' }, { kind: 'browser', url: 'https://b' })).toEqual({
      kind: 'browser',
      url: 'https://b',
    })
  })
})

describe('中缝宽度', () => {
  it('**不许把任一侧拖没**：下限是硬的', () => {
    expect(clampRightbar(10, 1400)).toBe(RIGHTBAR_MIN_PX)
  })

  it('上限按窗口比例，不是固定值——小窗口上也得留下正文', () => {
    expect(clampRightbar(9999, 1000)).toBeLessThanOrEqual(680)
    expect(clampRightbar(9999, 1000)).toBeGreaterThanOrEqual(RIGHTBAR_MIN_PX)
  })

  it('窗口窄到连下限都放不下时，下限赢——宁可挤，不可消失', () => {
    expect(clampRightbar(300, 300)).toBe(RIGHTBAR_MIN_PX)
  })
})
