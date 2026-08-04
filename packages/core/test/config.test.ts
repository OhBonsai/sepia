import { describe, expect, it } from 'vitest'

import { CONFIG_VERSION, DEFAULT_CONFIG, configToDisk, mergeConfig } from '../src/config/defaults.ts'

describe('config merge', () => {
  it('空文件 / 非对象 → 默认值', () => {
    for (const raw of [undefined, null, 42, 'x', []]) {
      expect(mergeConfig(raw).config).toEqual(DEFAULT_CONFIG)
    }
  })

  it('部分字段 → 其余取默认值', () => {
    expect(mergeConfig({ theme: 'dark' }).config).toEqual({ version: CONFIG_VERSION, theme: 'dark' })
  })

  it('非法 theme 值退回默认，而不是让应用带着坏值跑', () => {
    expect(mergeConfig({ theme: 'neon' }).config.theme).toBe('system')
    expect(mergeConfig({ theme: 7 }).config.theme).toBe('system')
  })

  it('未识别字段原样保留——读写往返不许丢用户手写的东西', () => {
    const { unknown } = mergeConfig({ theme: 'light', futureFlag: true, nested: { a: 1 } })
    expect(unknown).toEqual({ futureFlag: true, nested: { a: 1 } })
  })

  it('写回只落与默认值的差异，且带 version', () => {
    expect(configToDisk({ version: CONFIG_VERSION, theme: 'system' })).toEqual({ version: CONFIG_VERSION })
    expect(configToDisk({ version: CONFIG_VERSION, theme: 'dark' })).toEqual({
      version: CONFIG_VERSION,
      theme: 'dark',
    })
  })

  it('往返：未识别字段在写回时仍在', () => {
    const { config, unknown } = mergeConfig({ theme: 'dark', futureFlag: true })
    expect(configToDisk(config, unknown)).toEqual({ version: CONFIG_VERSION, theme: 'dark', futureFlag: true })
  })
})
