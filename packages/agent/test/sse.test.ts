import { describe, expect, it } from 'vitest'

import {
  connectionHealth,
  emptyThreadView,
  HEARTBEAT_INTERVAL_MS,
  isHeartbeat,
  reduceThreadView,
  SseParser,
  type EngineEvent,
} from '../src/sse.ts'

// SSE 协议四规则（140 §1.4 #5）：增量拼接 / 整 part 替换 / 心跳 / 未知事件忽略。
// 预定破坏方式（§1.5 ⑤）：把增量拼接改成整段替换 → 「拼接结果」断言必红。

function event(type: string, properties: Record<string, unknown>): EngineEvent {
  return { type, properties }
}

describe('SseParser', () => {
  it('事件跨 chunk 也解析完整', () => {
    const parser = new SseParser()
    const payload = '{"type":"message.part.delta","properties":{"partID":"p1","field":"text","delta":"你"}}'
    const first = parser.feed(`data: ${payload.slice(0, 20)}`)
    expect(first).toEqual([])
    const second = parser.feed(`${payload.slice(20)}\n\n`)
    expect(second).toHaveLength(1)
    expect(second[0]?.type).toBe('message.part.delta')
  })

  it('注释行（心跳注释）与非 JSON 行静默丢弃，不炸流', () => {
    const parser = new SseParser()
    const events = parser.feed(': heartbeat\n\ndata: not-json\n\ndata: {"type":"server.heartbeat"}\n\n')
    expect(events).toHaveLength(1)
    expect(isHeartbeat(events[0]!)).toBe(true)
  })

  it('一个块里多条 data 行拼成一个事件（SSE 规范）', () => {
    const parser = new SseParser()
    const events = parser.feed('data: {"type":\ndata: "x"}\n\n')
    expect(events).toEqual([{ type: 'x' }])
  })
})

describe('reduceThreadView —— 协议合并规则', () => {
  it('规则 1：message.part.delta 对字符串字段**增量拼接**', () => {
    let view = emptyThreadView()
    view = reduceThreadView(view, event('message.part.updated', { part: { id: 'p1', type: 'text', text: '你好' } }))
    view = reduceThreadView(view, event('message.part.delta', { partID: 'p1', field: 'text', delta: '，世' }))
    view = reduceThreadView(view, event('message.part.delta', { partID: 'p1', field: 'text', delta: '界' }))
    // 破坏方式 ⑤ 的靶子：改成整段替换的话这里只剩最后一个 delta
    expect(view.parts['p1']?.['text']).toBe('你好，世界')
  })

  it('规则 2：message.part.updated **整 part 替换**，不与旧值合并', () => {
    let view = emptyThreadView()
    view = reduceThreadView(
      view,
      event('message.part.updated', { part: { id: 'p1', type: 'text', text: '草稿', extra: 'x' } }),
    )
    view = reduceThreadView(view, event('message.part.updated', { part: { id: 'p1', type: 'text', text: '定稿' } }))
    expect(view.parts['p1']).toEqual({ id: 'p1', type: 'text', text: '定稿' })
    expect(view.parts['p1']?.['extra']).toBeUndefined()
  })

  it('规则 1 边界：目标字段是非字符串时不拼接（只有字符串字段走增量）', () => {
    let view = emptyThreadView()
    view = reduceThreadView(view, event('message.part.updated', { part: { id: 'p1', type: 'tool', state: { n: 1 } } }))
    const before = view.parts['p1']
    view = reduceThreadView(view, event('message.part.delta', { partID: 'p1', field: 'state', delta: 'x' }))
    expect(view.parts['p1']).toBe(before)
  })

  it('规则 4：未知事件类型一律忽略', () => {
    const view = emptyThreadView()
    const after = reduceThreadView(view, event('session.next.future-thing', { whatever: true }))
    expect(after).toBe(view)
  })

  it('message.part.removed 移除 part 并保持顺序', () => {
    let view = emptyThreadView()
    view = reduceThreadView(view, event('message.part.updated', { part: { id: 'a', type: 'text', text: '1' } }))
    view = reduceThreadView(view, event('message.part.updated', { part: { id: 'b', type: 'text', text: '2' } }))
    view = reduceThreadView(view, event('message.part.removed', { partID: 'a' }))
    expect(view.order).toEqual(['b'])
    expect(view.parts['a']).toBeUndefined()
  })
})

describe('connectionHealth —— 规则 3：心跳区分「模型停了」与「连接死了」', () => {
  it('刚收到内容：alive', () => {
    expect(connectionHealth(1_000, 1_000, 1_000)).toBe('alive')
  })

  it('心跳还在、内容停了：idle（模型停了，连接没死）', () => {
    const now = HEARTBEAT_INTERVAL_MS * 2
    expect(connectionHealth(now, now - 1_000, 0)).toBe('idle')
  })

  it('连心跳都没了：dead（连接死了，该重连）', () => {
    const now = HEARTBEAT_INTERVAL_MS * 3
    expect(connectionHealth(now, 0, 0)).toBe('dead')
  })
})
