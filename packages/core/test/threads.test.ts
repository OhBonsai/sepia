import { describe, expect, it } from 'vitest'

import { createAnchor } from '../src/anchor/index.ts'
import { conflictFileName, placeThreads, settleThread, type Thread } from '../src/threads/index.ts'

// §2.5 #1 / #3：线程↔锚点派生，以及**撤销联动**。
// 破坏方式瞄的是"唯一那道保护"——徽章与孤儿是同一个派生算出来的两种去向，
// 没有第二处状态兜底，所以派生错了就一定看得见。

const PAGE = '第一段。\n\n这里是要改的那一段。\n\n第三段。\n'
const REVISED = '第一段。\n\n这段已经被改写过了。\n\n第三段。\n'

function threadOn(text: string, quote: string, overrides: Partial<Thread> = {}): Thread {
  const from = text.indexOf(quote)
  return {
    id: 't1',
    anchor: createAnchor('a1', text, { from, to: from + quote.length }),
    page: 'note.md',
    createdAt: 1_000,
    turns: [
      { role: 'user', text: '润色' },
      { role: 'assistant', text: '这段已经被改写过了。' },
    ],
    commits: { before: 'aaa', after: 'bbb' },
    ...overrides,
  }
}

describe('线程与徽章的派生', () => {
  it('对得上 → 徽章，且区间落在引文上', () => {
    const thread = threadOn(REVISED, '这段已经被改写过了。')
    const view = placeThreads([thread], REVISED)
    expect(view.badges).toHaveLength(1)
    expect(view.orphans).toEqual([])
    const range = view.badges[0]!.range!
    expect(REVISED.slice(range.from, range.to)).toBe('这段已经被改写过了。')
  })

  it('对不上 → 孤儿，**且对话一个字都不丢**（T-27）', () => {
    const thread = threadOn(REVISED, '这段已经被改写过了。')
    const view = placeThreads([thread], '完全换了一篇文章，什么都对不上了。\n')
    expect(view.badges).toEqual([])
    expect(view.orphans).toHaveLength(1)
    expect(view.orphans[0]!.range).toBeNull()
    expect(view.orphans[0]!.thread.turns, '孤儿的对话必须原样保留').toHaveLength(2)
  })

  it('徽章按纸上的位置排，孤儿按时间倒序', () => {
    const a = threadOn(REVISED, '第三段。', { id: 'a', createdAt: 1 })
    const b = threadOn(REVISED, '第一段。', { id: 'b', createdAt: 2 })
    expect(placeThreads([a, b], REVISED).badges.map((p) => p.thread.id)).toEqual(['b', 'a'])

    const gone = '毫不相干的另一篇。\n'
    const view = placeThreads([a, b], gone)
    expect(view.orphans.map((p) => p.thread.id)).toEqual(['b', 'a'])
  })

  // ── 撤销联动（T-27）：**不靠任何 undo 钩子，靠锚点自己** ──────────────
  describe('撤销联动', () => {
    it('落笔 → 徽章在；⌘Z 撤回原文 → 徽章移出、进置灰区；⌘⇧Z → 徽章回来', () => {
      // 落笔之后，锚点的引文就是**改写后的那段文字**
      const thread = threadOn(REVISED, '这段已经被改写过了。')
      expect(placeThreads([thread], REVISED).badges, '落笔后徽章该在').toHaveLength(1)

      // ⌘Z：正文回到改写前——引文找不着了
      const undone = placeThreads([thread], PAGE)
      expect(undone.badges, '撤销之后徽章必须移出纸面').toEqual([])
      expect(undone.orphans, '而对话沉进置灰区，不消失').toHaveLength(1)

      // ⌘⇧Z：正文又变回改写后——引文自然找回来
      expect(placeThreads([thread], REVISED).badges, '重做之后徽章该回来').toHaveLength(1)
    })

    it('**引文不许随对齐漂移**：settle 只更新偏移，不重新取材', () => {
      // 前面插一段，位置变了但引文没变
      const thread = threadOn(REVISED, '这段已经被改写过了。')
      const shifted = `插入的开头。\n\n${REVISED}`
      const view = placeThreads([thread], shifted)
      expect(view.badges[0]!.alignment.kind).toBe('shifted')

      const settled = settleThread(thread, view.badges[0]!)
      expect(settled.anchor.from, '偏移要更新').not.toBe(thread.anchor.from)
      expect(settled.anchor.quote, '引文必须原样——漂了撤销联动就失灵').toBe(thread.anchor.quote)

      // 引文没漂，所以撤销联动仍然成立
      expect(placeThreads([settled], PAGE).badges).toEqual([])
    })
  })

  it('链失败（commits 为 null）→ **徽章仍在**，只是 diff 不可用', () => {
    const thread = threadOn(REVISED, '这段已经被改写过了。', { commits: null })
    const view = placeThreads([thread], REVISED)
    expect(view.badges, '链失败不该让徽章消失——对话是纸上真发生过的事').toHaveLength(1)
    expect(view.badges[0]!.diffAvailable).toBe(false)
  })

  it('链成功 → diff 可用', () => {
    expect(placeThreads([threadOn(REVISED, '这段已经被改写过了。')], REVISED).badges[0]!.diffAvailable).toBe(true)
  })
})

describe('冲突留存的文件名', () => {
  it('带时间戳且不含冒号（Windows 与 Finder 都不待见冒号）', () => {
    const name = conflictFileName('note.md', Date.UTC(2026, 7, 6, 12, 34, 56))
    expect(name).toContain('note.md')
    expect(name).not.toContain(':')
    expect(name.startsWith('2026-08-06')).toBe(true)
  })

  it('同一文件不同时刻不撞名', () => {
    expect(conflictFileName('a.md', 1)).not.toBe(conflictFileName('a.md', 2))
  })
})
