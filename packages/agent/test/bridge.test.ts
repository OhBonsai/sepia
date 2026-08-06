import { describe, expect, it } from 'vitest'

import { asBookDirectory } from '@sepia/core'

import { AgentBridge, type EngineEvent } from '../src/index.ts'

// AgentBridge 五方法对锁定 tag（v1.18.13）端点的映射，mock fetch 走协议（1.6a a5 的
// 无 key 形态）。真 key 的真对话不进 CI（架构 §6），由 a5 手跑留档。

const BOOK = asBookDirectory('/tmp/book')

interface Recorded {
  url: URL
  method: string
  authorization: string | null
  body: unknown
}

function mockBridge(respond: (recorded: Recorded) => Response) {
  const calls: Recorded[] = []
  const bridge = new AgentBridge({
    baseUrl: 'http://127.0.0.1:1',
    username: 'sepia',
    password: 'secret',
    fetch: async (request: Request) => {
      const recorded: Recorded = {
        url: new URL(request.url),
        method: request.method,
        authorization: request.headers.get('authorization'),
        body: request.method === 'POST' ? await request.text() : null,
      }
      calls.push(recorded)
      return respond(recorded)
    },
  })
  return { bridge, calls }
}

const AUTH = `Basic ${btoa('sepia:secret')}`

describe('AgentBridge 五方法', () => {
  it('openThread → POST /session，带 directory 与 Basic 鉴权', async () => {
    const { bridge, calls } = mockBridge(() => Response.json({ id: 's_1' }))
    const thread = await bridge.openThread({ directory: BOOK })
    expect(thread.id).toBe('s_1')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url.pathname).toBe('/session')
    expect(calls[0]?.url.searchParams.get('directory')).toBe('/tmp/book')
    expect(calls[0]?.authorization).toBe(AUTH)
  })

  it('send → POST /session/{id}/prompt_async，parts / model / agent 原样入 body', async () => {
    const { bridge, calls } = mockBridge(() => Response.json({}))
    await bridge.send('s_1', [{ type: 'text', text: '改写这段' }], {
      directory: BOOK,
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-5' },
      agent: 'rewrite',
    })
    expect(calls[0]?.url.pathname).toBe('/session/s_1/prompt_async')
    expect(calls[0]?.url.searchParams.get('directory')).toBe('/tmp/book')
    const body = JSON.parse(String(calls[0]?.body))
    expect(body.parts).toEqual([{ type: 'text', text: '改写这段' }])
    expect(body.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-5' })
    // a4 实测缺陷：不带 agent 时引擎落到默认 build agent（完整 coding persona + 技能表）。
    // 这里断言 agent 逐字进 body——它是「markup 只唤起改写 agent」在协议层的那一半。
    expect(body.agent).toBe('rewrite')
  })

  it('send 不带 agent 时 body 里也不出现 agent 键（引擎侧才好落到 default_agent）', async () => {
    const { bridge, calls } = mockBridge(() => Response.json({}))
    await bridge.send('s_1', [{ type: 'text', text: 'x' }], { directory: BOOK })
    const body = JSON.parse(String(calls[0]?.body)) as Record<string, unknown>
    expect('agent' in body).toBe(false)
  })

  it('interrupt → POST /session/{id}/abort', async () => {
    const { bridge, calls } = mockBridge(() => Response.json(true))
    await bridge.interrupt('s_1', { directory: BOOK })
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url.pathname).toBe('/session/s_1/abort')
  })

  it('listModels → GET /config/providers，摊平成 provider × model', async () => {
    const { bridge, calls } = mockBridge(() =>
      Response.json({
        providers: [
          {
            id: 'anthropic',
            name: 'Anthropic',
            models: { m1: { id: 'm1', name: 'Model One' }, m2: { id: 'm2', name: 'Model Two' } },
          },
        ],
        default: { anthropic: 'm1' },
      }),
    )
    const models = await bridge.listModels()
    expect(calls[0]?.url.pathname).toBe('/config/providers')
    expect(models).toEqual([
      { providerID: 'anthropic', providerName: 'Anthropic', modelID: 'm1', modelName: 'Model One' },
      { providerID: 'anthropic', providerName: 'Anthropic', modelID: 'm2', modelName: 'Model Two' },
    ])
  })

  it('stream → GET /event，SSE 事件一条不落地交出去', async () => {
    const chunks = [
      'data: {"type":"server.connected"}\n\n',
      'data: {"type":"message.part.delta","properties":{"partID":"p1","field":"text","delta":"hi"}}\n\n',
      ': heartbeat\n\n',
      'data: {"type":"server.heartbeat"}\n\n',
    ]
    const { bridge, calls } = mockBridge(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder()
              for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
              controller.close()
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    const seen: EngineEvent[] = []
    await bridge.stream({ directory: BOOK, onEvent: (event) => seen.push(event) })
    expect(calls[0]?.url.pathname).toBe('/event')
    expect(seen.map((event) => event.type)).toEqual(['server.connected', 'message.part.delta', 'server.heartbeat'])
  })

  // a4 真引擎实测的第三个缺陷（与缺陷 A 同科：directory 没传到底）。
  // `/event` **是实例级而非全局级**的：引擎按 `directory` 找实例，缺了就
  // 回落到 `process.cwd()`（vendor workspace-routing.ts:87）。于是流订在了
  // cwd 那个实例上，session 却活在 book 实例里——renderer 整轮只收得到
  // `server.heartbeat`，一条 message 事件都等不到，浮层永远停在 generating。
  // 五方法里只有 stream 漏了纪律 10 的类型化 directory，这条补上那一格。
  it('stream → GET /event **必须带 directory**：缺了引擎会回落到 cwd 实例', async () => {
    const { bridge, calls } = mockBridge(
      () =>
        new Response(new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    await bridge.stream({ directory: BOOK, onEvent: () => {} })
    expect(calls[0]?.url.searchParams.get('directory')).toBe('/tmp/book')
  })
})
