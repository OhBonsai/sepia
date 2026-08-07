import { describe, expect, it } from 'vitest'

import { type KeyEntry, groupKeys, keyCaps, matchKeys } from '../src/keys/index.ts'

// 180 §1.4 #3 的单测那一半（"一屏放得下"只能在真窗口里量，归 smoke）。

const entries: KeyEntry[] = [
  { id: 'file.save', label: '保存', group: 'file', spec: 'Mod-s', available: true },
  { id: 'agent.summon', label: '召唤 Agent', group: 'agent', spec: 'Mod-k', available: true },
  { id: 'threads.hide', label: '还白', group: 'agent', spec: 'Mod-Shift-h', available: false },
  { id: 'threads.panel', label: '线程面板', group: 'agent', available: true },
]

describe('键帽', () => {
  it('Mod 在 mac 上是 ⌘，修饰键各有其符号', () => {
    expect(keyCaps('Mod-s')).toEqual(['⌘', 'S'])
    expect(keyCaps('Mod-Shift-h')).toEqual(['⌘', '⇧', 'H'])
    expect(keyCaps('Mod-Alt-f')).toEqual(['⌘', '⌥', 'F'])
  })

  it('**并排、不加「+」**（D-32 ③）——每个加号都在跟"一屏放下"作对', () => {
    expect(keyCaps('Mod-Shift-h').join('')).toBe('⌘⇧H')
  })

  it('非 mac 上 Mod 是 Ctrl', () => {
    expect(keyCaps('Mod-s', 'other')).toEqual(['Ctrl', 'S'])
  })

  it('特殊键给人话而不是代号', () => {
    expect(keyCaps('Escape')).toEqual(['Esc'])
    expect(keyCaps('Mod-Backspace')).toEqual(['⌘', '⌫'])
  })
})

describe('搜索过滤', () => {
  it('打功能名命中', () => {
    expect(matchKeys(entries, '保存')).toEqual(new Set(['file.save']))
  })

  it('**打键位也命中**——「B」要能找到 ⌘B（D-32 ④）', () => {
    expect(matchKeys(entries, 'k')).toEqual(new Set(['agent.summon']))
    expect(matchKeys(entries, '⌘⇧h')).toEqual(new Set(['threads.hide']))
  })

  it('空 query 全命中（看板打开时先看到全部）', () => {
    expect(matchKeys(entries, '').size).toBe(entries.length)
  })

  it('没绑键的命令照样能按名字搜到', () => {
    expect(matchKeys(entries, '线程')).toEqual(new Set(['threads.panel']))
  })

  it('**返回的是命中集合而不是过滤后的数组**——类型上就不给重排的机会（D-32 ④「只隐藏不重排」）', () => {
    const hit = matchKeys(entries, 'a')
    expect(hit).toBeInstanceOf(Set)
  })
})

describe('分组', () => {
  it('按五组顺序出，组内保持传入顺序', () => {
    const groups = groupKeys(entries)
    expect(groups.map((bucket) => bucket.group)).toEqual(['agent', 'file'])
    expect(groups[0]!.entries.map((entry) => entry.id)).toEqual(['agent.summon', 'threads.hide', 'threads.panel'])
  })

  it('空组不出现——看板里不留一个空标题', () => {
    expect(groupKeys(entries).some((bucket) => bucket.entries.length === 0)).toBe(false)
    expect(groupKeys([]).length).toBe(0)
  })
})
