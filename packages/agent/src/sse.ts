// SSE 线协议与线程状态合并的**纯函数**——mock 单测不必起浏览器，也不必起引擎。
//
// 四条协议规则（架构 §4.3，140 §1.2）：
//   1. 只有字符串字段走增量拼接（`message.part.delta` 按 field 追加）
//   2. 其余一律整 part 替换（`message.part.updated` 带完整快照）
//   3. 心跳（`server.heartbeat`，10s 一拍）用于区分「模型停了」与「连接死了」
//   4. 未知事件类型一律忽略——引擎升级不该炸掉客户端

/** 引擎推来的一条事件。除 type 外的形状随事件而异，消费方各取所需。 */
export interface EngineEvent {
  type: string
  properties?: Record<string, unknown>
}

/**
 * 流式 SSE 解析器。喂字节切片，吐完整事件——事件可能跨 chunk，注释行（`: …`）
 * 与非 JSON 行按规则 4 静默丢弃。
 */
export class SseParser {
  private buffer = ''

  feed(chunk: string): EngineEvent[] {
    this.buffer += chunk
    const events: EngineEvent[] = []
    for (;;) {
      const cut = this.buffer.indexOf('\n\n')
      if (cut === -1) break
      const block = this.buffer.slice(0, cut)
      this.buffer = this.buffer.slice(cut + 2)
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      try {
        const parsed: unknown = JSON.parse(data)
        if (typeof parsed === 'object' && parsed !== null && typeof (parsed as EngineEvent).type === 'string') {
          events.push(parsed as EngineEvent)
        }
      } catch {
        // 规则 4：解析不了的一律忽略，不炸流
      }
    }
    return events
  }
}

/** 线程视图：按 partID 累积的 part 快照。真相在引擎，这里只是流式渲染用的影子。 */
export interface ThreadView {
  parts: Record<string, Record<string, unknown>>
  /** part 首次出现的顺序，渲染按它排 */
  order: string[]
}

export function emptyThreadView(): ThreadView {
  return { parts: {}, order: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把一条事件合并进线程视图。纯函数：进旧视图，出新视图（未涉及的引用原样复用）。
 */
export function reduceThreadView(view: ThreadView, event: EngineEvent): ThreadView {
  switch (event.type) {
    case 'message.part.updated': {
      // 规则 2：整 part 替换
      const part = event.properties?.['part']
      if (!isRecord(part) || typeof part['id'] !== 'string') return view
      const id = part['id']
      return {
        parts: { ...view.parts, [id]: part },
        order: view.order.includes(id) ? view.order : [...view.order, id],
      }
    }
    case 'message.part.delta': {
      // 规则 1：只有字符串字段走增量拼接
      const properties = event.properties
      if (!properties) return view
      const id = properties['partID']
      const field = properties['field']
      const delta = properties['delta']
      if (typeof id !== 'string' || typeof field !== 'string' || typeof delta !== 'string') return view
      const existing = view.parts[id]
      const previous = existing?.[field]
      // 目标字段若已有非字符串值，说明这不是字符串字段——不拼接，整条忽略
      if (previous !== undefined && typeof previous !== 'string') return view
      const next = { ...(existing ?? { id }), [field]: (typeof previous === 'string' ? previous : '') + delta }
      return {
        parts: { ...view.parts, [id]: next },
        order: view.order.includes(id) ? view.order : [...view.order, id],
      }
    }
    case 'message.part.removed': {
      const id = event.properties?.['partID']
      if (typeof id !== 'string' || !(id in view.parts)) return view
      const parts = { ...view.parts }
      delete parts[id]
      return { parts, order: view.order.filter((it) => it !== id) }
    }
    default:
      // 规则 4：未知事件一律忽略
      return view
  }
}

/** 引擎心跳间隔（server.heartbeat，引擎侧 10s 一拍）。 */
export const HEARTBEAT_INTERVAL_MS = 10_000

/** 超过这个倍数没收到任何事件（含心跳）判连接死。 */
export const HEARTBEAT_DEAD_FACTOR = 2.5

export type ConnectionHealth =
  /** 有心跳、有事件——一切正常 */
  | 'alive'
  /** 有心跳、无内容事件——**模型停了**（或本来就闲着），连接没问题 */
  | 'idle'
  /** 连心跳都没了——**连接死了**，该重连 */
  | 'dead'

/**
 * 规则 3：心跳区分「模型停了」与「连接死了」。
 * 两个时间戳都由消费方记录：任何事件到达都刷新 lastEventAt，
 * 非心跳事件到达才刷新 lastContentAt。
 */
export function connectionHealth(nowMs: number, lastEventAtMs: number, lastContentAtMs: number): ConnectionHealth {
  if (nowMs - lastEventAtMs > HEARTBEAT_INTERVAL_MS * HEARTBEAT_DEAD_FACTOR) return 'dead'
  if (nowMs - lastContentAtMs > HEARTBEAT_INTERVAL_MS) return 'idle'
  return 'alive'
}

export function isHeartbeat(event: EngineEvent): boolean {
  return event.type === 'server.heartbeat'
}
