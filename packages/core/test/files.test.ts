import { describe, expect, it } from 'vitest'

import {
  SELF_WRITE_TTL_MS,
  decideExternalChange,
  isSelfWrite,
  reconcileKind,
  type SelfWriteRecord,
} from '../src/files/index.ts'

// 170 §1.4 检查 1：脏 × 外部改 × 删除的四格矩阵。
// 破坏方式（预写）：把「有脏 + changed」判成 reload —— 那正是覆盖用户字节的那个场景。

describe('冲突判定矩阵（架构 §4.9）', () => {
  it('无脏 + 外部改 → 重载，且不出横条（这种事不该打断写作）', () => {
    expect(decideExternalChange({ kind: 'changed', dirty: false })).toEqual({
      action: 'reload',
      notice: null,
      sticky: false,
    })
  })

  it('**有脏 + 外部改 → 先落盘再告知**，绝不重载（重载就是吞掉用户刚敲的字）', () => {
    const decision = decideExternalChange({ kind: 'changed', dirty: true })
    expect(decision.action).toBe('save')
    // 这两条不是凑数：action 一旦被改成 reload，上面那条就红；
    // 而横条若不 sticky，用户可能根本没看见「外部那版没被载入」。
    expect(decision.action).not.toBe('reload')
    expect(decision).toEqual({ action: 'save', notice: 'conflict.saved', sticky: true })
  })

  it('外部删除 → 转游离态并常驻告知，无论脏不脏都不写回', () => {
    for (const dirty of [true, false]) {
      expect(decideExternalChange({ kind: 'removed', dirty })).toEqual({
        action: 'detach',
        notice: 'conflict.removed',
        sticky: true,
      })
    }
  })

  it('四格穷举：矩阵没有第五种去向，也没有一格是 undefined', () => {
    const cells = [
      { kind: 'changed', dirty: false },
      { kind: 'changed', dirty: true },
      { kind: 'removed', dirty: false },
      { kind: 'removed', dirty: true },
    ] as const
    const actions = cells.map((cell) => decideExternalChange(cell).action)
    expect(actions).toEqual(['reload', 'save', 'detach', 'detach'])
  })
})

const record = (over: Partial<SelfWriteRecord> = {}): SelfWriteRecord => ({
  path: '/book/page.md',
  mtimeMs: 1_000,
  atMs: 10_000,
  ...over,
})

describe('自写回声的判定（纪律 17 的纯函数半边）', () => {
  it('路径与 mtime 都对上、且在 TTL 内 → 是自写回声', () => {
    expect(isSelfWrite([record()], { path: '/book/page.md', mtimeMs: 1_000 }, 10_500)).toBe(true)
  })

  it('mtime 不同 → 不是回声（同一个文件真被外部改了）', () => {
    expect(isSelfWrite([record()], { path: '/book/page.md', mtimeMs: 1_001 }, 10_500)).toBe(false)
  })

  it('路径不同 → 不是回声', () => {
    expect(isSelfWrite([record()], { path: '/book/other.md', mtimeMs: 1_000 }, 10_500)).toBe(false)
  })

  it('超过 TTL → 记录失效，必须重新当成外部变更', () => {
    expect(isSelfWrite([record()], { path: '/book/page.md', mtimeMs: 1_000 }, 10_000 + SELF_WRITE_TTL_MS + 1)).toBe(
      false,
    )
  })

  it('自己删的也算自写（mtime 双方都是 null）', () => {
    expect(isSelfWrite([record({ mtimeMs: null })], { path: '/book/page.md', mtimeMs: null }, 10_100)).toBe(true)
  })
})

describe('focus 对账（架构 §4.9 的兜底半边）', () => {
  it('没有印记时不许报变更——否则每次切回窗口都重载一遍', () => {
    expect(reconcileKind(null, { mtimeMs: 1, size: 2 })).toBeNull()
  })

  it('印记一致 → 无事发生', () => {
    expect(reconcileKind({ mtimeMs: 5, size: 9 }, { mtimeMs: 5, size: 9 })).toBeNull()
  })

  it('mtime 变了 → changed（大小可能一模一样：改一个字的等长替换）', () => {
    expect(reconcileKind({ mtimeMs: 5, size: 9 }, { mtimeMs: 6, size: 9 })).toBe('changed')
  })

  it('大小变了 → changed（mtime 相同也算：秒级精度的文件系统上真会发生）', () => {
    expect(reconcileKind({ mtimeMs: 5, size: 9 }, { mtimeMs: 5, size: 10 })).toBe('changed')
  })

  it('文件不在了 → removed', () => {
    expect(reconcileKind({ mtimeMs: 5, size: 9 }, null)).toBe('removed')
  })
})
