import { describe, expect, it } from 'vitest'

import { type ThemeVar, themeVar } from '../src/theme/vars.ts'

describe('@sepia/ui 主题变量', () => {
  it('每个 token 都是 var(--…) 形状', () => {
    for (const value of Object.values(themeVar)) {
      expect(value).toMatch(/^var\(--[a-z-]+\)$/)
    }
  })

  it('字面色值在类型上就赋不进来', () => {
    // @ts-expect-error 纪律 3：色值只许出现在调色板 css 里
    const bad: ThemeVar = '#fff'
    expect(typeof bad).toBe('string')
  })

  it('vars.ts 本身不含任何色值——它只放名字', async () => {
    const source = await import('../src/theme/vars.ts')
    for (const value of Object.values(source.themeVar)) {
      expect(value).not.toMatch(/#[0-9a-f]{3,8}/i)
    }
  })
})
