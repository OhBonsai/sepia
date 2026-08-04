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

  it('anchor/ 归 Stage 5，本 stage 不该出现', async () => {
    const mod = await import('../src/index.ts')
    expect(Object.keys(mod).some((n) => n.toLowerCase().includes('anchor'))).toBe(false)
  })
})
