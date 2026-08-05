import { describe, expect, it } from 'vitest'

import { nearbyBlocks } from '../../src/renderer/markup/nearby.ts'

// `contextScope`（裁决 2.1）在行为上的唯一落点。
//
// 这条是**复盘时补的**：三个配置字段里，`contextScope` 一度只是"被搬运"——
// config → argv → 根节点属性 → markupConfig()，然后没有任何人拿它改变行为。
// §1.3 申报的是「三个字段全部本 stage 真读」，而"读出来存着"不叫读。

const DOC = ['第一段。', '第二段。', '这里是要改的那一段。', '第四段。', '第五段。'].join('\n\n')
const FROM = DOC.indexOf('这里是要改的那一段。')
const RANGE = { from: FROM, to: FROM + '这里是要改的那一段。'.length }

describe('取材范围 contextScope', () => {
  it('page（默认）：前后段都进来，且离选区近的 distance 更小', () => {
    const blocks = nearbyBlocks(DOC, RANGE, 'page')
    expect(blocks.length).toBeGreaterThan(0)
    const second = blocks.find((block) => block.text === '第二段。')
    const first = blocks.find((block) => block.text === '第一段。')
    expect(second?.distance).toBeLessThan(first?.distance ?? Number.POSITIVE_INFINITY)
  })

  it('selection：一块邻近都不取，只剩选区本身', () => {
    expect(nearbyBlocks(DOC, RANGE, 'selection')).toEqual([])
  })

  it('缺省即 page —— 默认值不许悄悄变成「只要选区」', () => {
    expect(nearbyBlocks(DOC, RANGE)).toEqual(nearbyBlocks(DOC, RANGE, 'page'))
  })

  it('选区所在段不会作为「邻近」重复进去一次', () => {
    const blocks = nearbyBlocks(DOC, RANGE, 'page')
    expect(blocks.some((block) => block.text === '这里是要改的那一段。')).toBe(false)
  })
})
