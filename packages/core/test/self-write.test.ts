import { describe, expect, it } from 'vitest'

import { createSelfWriteLog, type SelfWriteEntry } from '../src/fs/self-write.ts'

// 「最近自写记录」（L2/L3 共享接缝）的行为。破坏方式瞄的是**回声成环**那个事故场景
// （002 §6.2 的新元规则），不是"表能不能存进去"这种一般路径。

const A: SelfWriteEntry = { path: '/private/tmp/book/a.md', mtimeMs: 1000, size: 12 }
const B: SelfWriteEntry = { path: '/private/tmp/book/b.md', mtimeMs: 1000, size: 12 }

function clock(start = 0): { now: () => number; tick: (ms: number) => void } {
  let at = start
  return { now: () => at, tick: (ms) => (at += ms) }
}

describe('最近自写记录', () => {
  it('登记过的自写会被认领——回声就是这么挡住的', () => {
    const log = createSelfWriteLog()
    log.record(A)
    expect(log.claim(A)).toBe(true)
  })

  it('没登记过的变更认领不了——真外部改动必须穿过去', () => {
    const log = createSelfWriteLog()
    log.record(A)
    // 同路径但不是同一个版本（别人改的，mtime 变了）
    expect(log.claim({ ...A, mtimeMs: 2000 })).toBe(false)
    // 路径不同，一个字段都不该混
    expect(log.claim(B)).toBe(false)
  })

  it('认领是**消费型**：一条自写只挡一次回声', () => {
    const log = createSelfWriteLog()
    log.record(A)
    expect(log.claim(A)).toBe(true)
    // 第二次同指纹的变更不再是回声——留着不消费的话，一个恰好同指纹的真改动
    // 会被永久吞掉，那才是失明
    expect(log.claim(A)).toBe(false)
  })

  it('过期即失效：窗口外的同指纹变更按外部改动放行', () => {
    const time = clock()
    const log = createSelfWriteLog({ ttlMs: 5_000, now: time.now })
    log.record(A)
    time.tick(4_999)
    expect(log.claim(A), '窗口内还该挡').toBe(true)

    log.record(A)
    time.tick(5_000)
    expect(log.claim(A), '窗口外必须放行').toBe(false)
    expect(log.size).toBe(0)
  })

  it('环形表满了丢最旧的，不无界增长', () => {
    const log = createSelfWriteLog({ capacity: 3 })
    for (let i = 0; i < 5; i++) log.record({ ...A, mtimeMs: i })
    expect(log.size).toBe(3)
    // 最旧两条（0、1）已被挤掉
    expect(log.claim({ ...A, mtimeMs: 0 })).toBe(false)
    expect(log.claim({ ...A, mtimeMs: 1 })).toBe(false)
    // 最新三条还在
    expect(log.claim({ ...A, mtimeMs: 4 })).toBe(true)
  })

  it('三个字段任缺一个都不算同一次写——mtime 撞了还有 size 兜着', () => {
    const log = createSelfWriteLog()
    log.record(A)
    expect(log.claim({ ...A, size: 13 }), 'mtime 同但字节数变了：内容不一样，不是我们那次写').toBe(false)
    expect(log.claim(A)).toBe(true)
  })

  it('连写两次同一个文件，两次回声都挡得住', () => {
    const log = createSelfWriteLog()
    log.record({ ...A, mtimeMs: 1000 })
    log.record({ ...A, mtimeMs: 1001 })
    expect(log.claim({ ...A, mtimeMs: 1000 })).toBe(true)
    expect(log.claim({ ...A, mtimeMs: 1001 })).toBe(true)
  })
})
