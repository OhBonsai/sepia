import { describe, expect, it } from 'vitest'

describe('@sepia/agent', () => {
  it('导出 AgentBridge 与 SSE 协议纯函数（Stage 3 起有真实内容）', async () => {
    const mod = await import('../src/index.ts')
    expect(Object.keys(mod)).toContain('AgentBridge')
    expect(Object.keys(mod)).toContain('SseParser')
    expect(Object.keys(mod)).toContain('reduceThreadView')
  })
})
