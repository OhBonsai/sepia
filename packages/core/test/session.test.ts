import { describe, expect, it } from 'vitest'

import {
  EMPTY_SESSION,
  SESSION_VERSION,
  closeTab,
  openTab,
  parseSession,
  serializeSession,
  tabPath,
  tabRelative,
  updateTab,
  withoutPage,
} from '../src/config/session.ts'

// 170 §2.4 #1：session v2 往返 + 容错。
// **四种开机场景都不许让应用起不来**——起不来就等于纸没了。

const TAB = { page: 'note.md', cursor: 12, scrollTop: 340 }

describe('session v2 解析', () => {
  it('往返：book + tabs + active 逐字段回得来', () => {
    const state = { version: SESSION_VERSION, book: '/Users/x/book', tabs: [TAB], active: 0 }
    expect(parseSession(serializeSession(state))).toEqual(state)
  })

  it.each([
    ['文件不存在', null],
    ['空文件', ''],
    ['只有空白', '   \n'],
    ['不是 JSON', '{ 这不是 json'],
    ['不是对象', '[1,2,3]'],
  ])('%s → 空会话（不抛、不炸）', (_name, text) => {
    expect(parseSession(text)).toEqual(EMPTY_SESSION)
  })

  it('**v1 按损坏处理，退空会话**——这是人裁（170 §2.0 条 1），不是漏了迁移', () => {
    const v1 = JSON.stringify({ version: 1, page: '/Users/x/note.md', cursor: 5, scrollTop: 10 })
    expect(parseSession(v1), 'v1 应当整份退空，而不是被半解析成 v2').toEqual(EMPTY_SESSION)
  })

  it('坏 tab 逐条丢弃，好的留下——一条坏记录不该埋掉整个会话', () => {
    const raw = JSON.stringify({
      version: 2,
      book: '/b',
      tabs: [TAB, { page: '' }, { cursor: 1 }, null, 'x', { page: 'ok.md' }],
      active: 0,
    })
    expect(parseSession(raw).tabs.map((tab) => tab.page)).toEqual(['note.md', 'ok.md'])
  })

  it('active 越界被夹回来——越界会让 UI 拿 undefined 去渲染', () => {
    const raw = JSON.stringify({ version: 2, book: null, tabs: [TAB], active: 9 })
    expect(parseSession(raw).active).toBe(0)
    expect(parseSession(JSON.stringify({ version: 2, book: null, tabs: [], active: 3 })).active).toBe(0)
  })

  it.each([
    ['绝对路径', '/Users/x/book', '/Users/x/book'],
    ['相对路径', 'book', null],
    ['不是字符串', 42, null],
  ])('book 只收绝对路径：%s', (_name, book, expected) => {
    expect(parseSession(JSON.stringify({ version: 2, book, tabs: [], active: 0 })).book).toBe(expected)
  })

  it('**tab 的 page 相对与绝对都收**：book 内存相对、游离存绝对（§2.1 ①）', () => {
    const raw = JSON.stringify({
      version: 2,
      book: '/b',
      tabs: [{ page: 'sub/note.md' }, { page: '/tmp/loose.md' }],
      active: 0,
    })
    expect(parseSession(raw).tabs.map((tab) => tab.page)).toEqual(['sub/note.md', '/tmp/loose.md'])
  })
})

describe('tab 操作', () => {
  const base = {
    version: SESSION_VERSION,
    book: '/b',
    tabs: [TAB, { page: 'b.md', cursor: 0, scrollTop: 0 }],
    active: 1,
  }

  it('**已开着就聚焦，不重复开**（四个入口共用这一处判断）', () => {
    const next = openTab(base, { page: 'note.md', cursor: 0, scrollTop: 0 })
    expect(next.tabs).toHaveLength(2)
    expect(next.active, '应当聚焦到已开的那个').toBe(0)
  })

  it('没开过就追加并聚焦到新的那个', () => {
    const next = openTab(base, { page: 'c.md', cursor: 0, scrollTop: 0 })
    expect(next.tabs.map((tab) => tab.page)).toEqual(['note.md', 'b.md', 'c.md'])
    expect(next.active).toBe(2)
  })

  it('关掉当前 tab：active 往前挪，不许指到空处', () => {
    const next = closeTab(base, 1)
    expect(next.tabs.map((tab) => tab.page)).toEqual(['note.md'])
    expect(next.active).toBe(0)
  })

  it('关掉前面的 tab：active 跟着减一，仍指着同一个文件', () => {
    const next = closeTab(base, 0)
    expect(next.tabs[next.active]?.page, '关掉前面那个之后，当前打开的还该是 b.md').toBe('b.md')
  })

  it('全关光 → tabs 空、active 0（主页那一档）', () => {
    expect(closeTab(closeTab(base, 0), 0)).toEqual({ ...base, tabs: [], active: 0 })
  })

  it('越界的 close 不动数据', () => {
    expect(closeTab(base, 9)).toEqual(base)
  })

  it('updateTab 只动那一个 tab 的光标与滚动', () => {
    const next = updateTab(base, 0, { cursor: 99, scrollTop: 5 })
    expect(next.tabs[0]).toEqual({ page: 'note.md', cursor: 99, scrollTop: 5 })
    expect(next.tabs[1], '别的 tab 不许被碰').toEqual(base.tabs[1])
  })

  it('withoutPage：page 没了就把那个 tab 摘掉，其余保住', () => {
    const next = withoutPage(base, 'note.md')
    expect(next.tabs.map((tab) => tab.page)).toEqual(['b.md'])
    expect(withoutPage(base, '不存在.md'), '没这个 page 就什么都不动').toEqual(base)
  })
})

// **收尾补做反向验证时补的一整块**：`tabPath` / `tabRelative` 原本**一条单测都没有**，
// 而真人轮"点最近打不开"正是它。破坏证据：把绝对路径直通那一行删掉，
// 21 条 session 单测**全绿**——真正拦住它的只有 smoke #8b。
// 单测这一层缺口不补，下一个手拼路径的地方还会犯同样的错。
describe('tab 路径两形态（book 内相对、游离绝对）', () => {
  it('book 内的相对路径接在 book 后面', () => {
    expect(tabPath('/Users/wp/book', 'a.md')).toBe('/Users/wp/book/a.md')
    expect(tabPath('/Users/wp/book/', 'sub/c.md')).toBe('/Users/wp/book/sub/c.md')
  })

  it('**游离 page 存的是绝对路径，必须原样直通**——接在 book 后面会拼出不存在的路径', () => {
    expect(tabPath('/Users/wp/book', '/tmp/loose.md')).toBe('/tmp/loose.md')
    expect(tabPath(null, '/tmp/loose.md')).toBe('/tmp/loose.md')
  })

  it('没有 book 时相对路径原样交出去（调用方自己决定怎么解）', () => {
    expect(tabPath(null, 'a.md')).toBe('a.md')
  })

  it('往返：book 内的绝对路径换算回相对，book 外的保持绝对', () => {
    expect(tabRelative('/Users/wp/book', '/Users/wp/book/sub/c.md')).toBe('sub/c.md')
    expect(tabRelative('/Users/wp/book', '/tmp/loose.md')).toBe('/tmp/loose.md')
    expect(tabPath('/Users/wp/book', tabRelative('/Users/wp/book', '/tmp/loose.md'))).toBe('/tmp/loose.md')
  })

  it('**同前缀的兄弟目录不算 book 内**——`/book-old/x.md` 不能被切成 `x.md`', () => {
    expect(tabRelative('/Users/wp/book', '/Users/wp/book-old/x.md')).toBe('/Users/wp/book-old/x.md')
  })
})
