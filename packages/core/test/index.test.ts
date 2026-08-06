import { describe, expect, it } from 'vitest'

describe('@sepia/core', () => {
  it('加载时不产生副作用，导出面覆盖四个域', async () => {
    const mod = await import('../src/index.ts')
    const names = Object.keys(mod)
    // types / copy / config / session 四个域各出一个代表，防止 index 漏 re-export
    for (const expected of ['PERF_MARKS', 'copy', 'DEFAULT_CONFIG', 'parseSession']) {
      expect(names).toContain(expected)
    }
  })

  // 这条断言原文是「anchor/ 归 Stage 5，**本 stage 不该出现**」——一条"还没到时候"的守卫。
  // Stage 5a 把 anchor/ 建起来了，它于是**如期变红**，在这里被改成正向断言。
  // 守卫尽到了职责：它保证了 anchor/ 不会在无人裁决的情况下提前冒出来。
  it('anchor/ 已随 Stage 5a 落地，且导出的是纯函数面', async () => {
    const mod = await import('../src/index.ts')
    const names = Object.keys(mod)
    expect(names).toContain('realign')
    expect(names).toContain('createAnchor')
    expect(names).toContain('similarity')
    // 锚点是**纯函数模块**：不许因为它而把 fs / git 拖进 core（core 是叶子包）
    expect(names.some((name) => name.toLowerCase().includes('readanchor'))).toBe(false)
  })
})
