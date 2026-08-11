import { describe, expect, it } from 'vitest'

import { ICON_PATHS, type IconName } from '../src/icons/paths.ts'

// Lucide 图标是 **vendored 资产**（拷贝不是依赖）。这几条守的是"拷进来的东西是完整的"。

const NAMES = Object.keys(ICON_PATHS) as IconName[]

describe('vendored 图标', () => {
  it('清单里那些都在（数量跟着 scripts/vendor-icons.mjs 的清单走）', () => {
    expect(NAMES).toHaveLength(26)
  })

  it('每条都是**非空的 SVG 内容**——抽取脚本切错位置会得到空串', () => {
    for (const name of NAMES) {
      expect(ICON_PATHS[name].length, `${name} 是空的`).toBeGreaterThan(10)
      expect(ICON_PATHS[name], `${name} 里没有图形元素`).toMatch(/<(path|circle|rect|line|polyline|polygon)/)
    }
  })

  it('**不带根标签**：size 与 stroke-width 由 <Icon> 统一给，不许各带各的', () => {
    for (const name of NAMES) {
      expect(ICON_PATHS[name], `${name} 把 <svg> 根标签也拷进来了`).not.toContain('<svg')
      expect(ICON_PATHS[name], `${name} 自带 stroke-width，会破坏统一`).not.toContain('stroke-width=')
    }
  })

  it('**不含单引号**——它们要被塞进单引号字符串里', () => {
    for (const name of NAMES) {
      expect(ICON_PATHS[name], `${name} 含单引号，生成的 TS 会语法错`).not.toContain("'")
    }
  })
})
