import { describe, expect, it } from 'vitest'

import { EMPTY_SESSION, parseSession, serializeSession, withoutPage } from '../src/config/session.ts'

describe('session.json 容错', () => {
  // 四种输入各对应一种真实的开机场景。四种都不许让应用起不来。
  it('文件不存在 → 空会话', () => {
    expect(parseSession(null)).toEqual(EMPTY_SESSION)
  })

  it('空文件（上次写了一半）→ 空会话', () => {
    expect(parseSession('')).toEqual(EMPTY_SESSION)
    expect(parseSession('   \n')).toEqual(EMPTY_SESSION)
  })

  it('非法 JSON → 空会话，不抛异常', () => {
    expect(() => parseSession('{ not json')).not.toThrow()
    expect(parseSession('{ not json')).toEqual(EMPTY_SESSION)
  })

  it('字段类型不对 → 逐字段退回默认值', () => {
    expect(parseSession(JSON.stringify({ page: 42, cursor: 'x', scrollTop: -5 }))).toEqual(EMPTY_SESSION)
  })

  it('相对路径不接受——没有 book 身份就无从解析（books.ts 归 Stage 6）', () => {
    expect(parseSession(JSON.stringify({ page: 'notes/a.md' })).page).toBeNull()
  })

  it('合法内容原样读出', () => {
    const text = JSON.stringify({ version: 1, page: '/tmp/a.md', cursor: 12, scrollTop: 300 })
    expect(parseSession(text)).toEqual({ version: 1, page: '/tmp/a.md', cursor: 12, scrollTop: 300 })
  })

  it('序列化再解析是等价的', () => {
    const state = { version: 1, page: '/tmp/b.md', cursor: 3, scrollTop: 0 }
    expect(parseSession(serializeSession(state))).toEqual(state)
  })

  it('page 失效时的降级只丢位置信息，不丢整份会话', () => {
    expect(withoutPage({ version: 1, page: '/gone.md', cursor: 9, scrollTop: 5 })).toEqual(EMPTY_SESSION)
  })
})
