import { describe, expect, it } from 'vitest'

describe('@sepia/ui', () => {
  it('加载时不产生副作用，且导出面为空', async () => {
    const mod = await import('../src/index.ts')
    expect(Object.keys(mod)).toEqual([])
  })
})
