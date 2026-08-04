import { describe, expect, it } from 'vitest'

import { CONFIG_VERSION, DEFAULT_CONFIG, configToDisk, mergeConfig, parseModel } from '../src/config/defaults.ts'

describe('config merge', () => {
  it('空文件 / 非对象 → 默认值', () => {
    for (const raw of [undefined, null, 42, 'x', []]) {
      expect(mergeConfig(raw).config).toEqual(DEFAULT_CONFIG)
    }
  })

  it('部分字段 → 其余取默认值', () => {
    expect(mergeConfig({ theme: 'dark' }).config).toEqual({ ...DEFAULT_CONFIG, version: CONFIG_VERSION, theme: 'dark' })
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
    expect(configToDisk({ ...DEFAULT_CONFIG })).toEqual({ version: CONFIG_VERSION })
    expect(configToDisk({ ...DEFAULT_CONFIG, theme: 'dark' })).toEqual({
      version: CONFIG_VERSION,
      theme: 'dark',
    })
  })

  it('往返：未识别字段在写回时仍在', () => {
    const { config, unknown } = mergeConfig({ theme: 'dark', futureFlag: true })
    expect(configToDisk(config, unknown)).toEqual({ version: CONFIG_VERSION, theme: 'dark', futureFlag: true })
  })
})

// Stage 3 新增的两个字段：provider 定义（明文、无密钥）与默认模型。
// 只加**本 stage 真正读取**的字段（架构 §4.5），两者都由 agent-supervisor 读。
describe('config —— Stage 3 的 provider 与 model', () => {
  it('provider 定义原样保留（内部形状由引擎裁，我们不抄它的 schema）', () => {
    const definition = { aliyun: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://x/v1' } } }
    expect(mergeConfig({ provider: definition }).config.provider).toEqual(definition)
  })

  it('provider 不是对象时退回空——坏配置不该让引擎带着坏值起来', () => {
    expect(mergeConfig({ provider: 'nope' }).config.provider).toEqual({})
    expect(mergeConfig({ provider: [1, 2] }).config.provider).toEqual({})
  })

  it('model 必须是 providerID/modelID，形状不对退回 null 用引擎默认', () => {
    expect(mergeConfig({ model: 'aliyun/qwen3.7-max' }).config.model).toBe('aliyun/qwen3.7-max')
    expect(mergeConfig({ model: 'qwen3.7-max' }).config.model).toBeNull()
    expect(mergeConfig({ model: 42 }).config.model).toBeNull()
  })

  it('parseModel 只在两半都非空时才拆出来', () => {
    expect(parseModel('aliyun/qwen3.7-max')).toEqual({ providerID: 'aliyun', modelID: 'qwen3.7-max' })
    // 模型名里带斜杠是常见的（openrouter 风格），只切第一个
    expect(parseModel('openrouter/meta/llama')).toEqual({ providerID: 'openrouter', modelID: 'meta/llama' })
    for (const bad of [null, '', '/x', 'x/', 'x']) expect(parseModel(bad)).toBeNull()
  })

  it('写回：provider 为空、model 为 null 时都不落盘（只存与默认值的差异）', () => {
    expect(configToDisk({ ...DEFAULT_CONFIG })).toEqual({ version: CONFIG_VERSION })
    const withProvider = configToDisk({ ...DEFAULT_CONFIG, provider: { a: { npm: 'x' } }, model: 'a/b' })
    expect(withProvider).toEqual({ version: CONFIG_VERSION, provider: { a: { npm: 'x' } }, model: 'a/b' })
  })
})
