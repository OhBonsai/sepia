import { describe, expect, it } from 'vitest'

import { type CopyKey, copy, t } from '../src/copy/index.ts'

describe('copy 与 CopyKey', () => {
  it('取文案走 key', () => {
    expect(t('cmd.file.save')).toBe('保存')
  })

  it('传字面串在类型上就不通过——纪律 5 的强制手段是类型，不是 review', () => {
    // @ts-expect-error 「保存」是文案不是 key，registry 只收 key
    const bad: CopyKey = '保存'
    expect(typeof bad).toBe('string')
  })

  it('所有 key 都是点分 ASCII，与人类可读的文案在形状上就分得开', () => {
    for (const key of Object.keys(copy)) {
      expect(key).toMatch(/^[a-z][a-z0-9.]*$/)
    }
  })
})
