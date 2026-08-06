import { describe, expect, it } from 'vitest'

import { decideExternalChange, reconcileKind, planConflictChoice} from '../src/files/index.ts'

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

// 自写回声的判据（`createSelfWriteLog`）是 L2 的接缝，单测在 core/test/self-write.test.ts。
// 本文件曾有一份桩的用例，合并后随桩一起删——两份判据不许并存。

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

// §2.5 #5：三选矩阵，以及**留存先于覆盖**那个顺序。
describe('有脏冲突的三选（b 期）', () => {
  it('用我的 → 正文是我的，**外部那版被留存**（它是即将失去的一方）', () => {
    expect(planConflictChoice('mine')).toEqual({ adopt: 'mine', preserve: 'theirs' })
  })

  it('用外部的 → 正文换成外部的，**先留我的**再覆盖', () => {
    // 这一条是三格里唯一会覆盖用户自己字节的，所以 preserve 必须是 mine
    expect(planConflictChoice('theirs')).toEqual({ adopt: 'theirs', preserve: 'mine' })
  })

  it('都留着 → 正文保持我的，外部那版另存', () => {
    expect(planConflictChoice('both')).toEqual({ adopt: 'mine', preserve: 'theirs' })
  })

  it('**每一格都留了一版**——三选里没有"两版都不留"的格子', () => {
    for (const choice of ['mine', 'theirs', 'both'] as const) {
      expect(planConflictChoice(choice).preserve, `${choice} 没留存任何一版`).not.toBeNull()
    }
  })

  it('留存的永远是**即将失去的那一版**，不是被采纳的那版', () => {
    for (const choice of ['mine', 'theirs', 'both'] as const) {
      const plan = planConflictChoice(choice)
      expect(plan.preserve, `${choice} 留存了被采纳的那版，等于什么都没留`).not.toBe(plan.adopt)
    }
  })
})
