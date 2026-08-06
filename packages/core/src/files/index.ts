import type { CopyKey } from '../copy/index.ts'

// 纸与外部世界的接缝（架构 §4.9）。**main 只报事实，怎么办由这里的纯函数裁**——
// 判定不碰 fs、不碰 Electron，于是「有脏时外部改了文件」这种场景可以在单测里穷举，
// 而不必去真文件系统上碰运气。它守的是不变量 2 最锋利的那一面：
// **用户刚敲的字优先级最高，绝不静默覆盖**。

/** 外部世界对当前 page 做了什么。两种，不多不少——「移动」在事件层已被折成 removed。 */
export type ExternalChangeKind = 'changed' | 'removed'

/**
 * 一条外部变更事实。
 *
 * `source` 只为留痕：日常靠 watcher 事件，切回窗口时靠 mtime/size 对账，
 * 两条路给出的事实完全同构（架构 §4.9「必须有对账兜底」）。诊断时要分得清是谁抓到的——
 * 只有 reconcile 抓到，说明 watcher 在这台机器上是瞎的。
 */
export interface ExternalChange {
  type: 'external-change'
  path: string
  kind: ExternalChangeKind
  source: 'watcher' | 'reconcile'
}

/** watcher 整体失效（限额撞满、网络盘），已降级为「仅 focus 对账」。一次性告知。 */
export interface WatcherDegraded {
  type: 'watcher-degraded'
  reason: string
}

/** main → renderer 推的文件域通知。一个通道两种事实，桥上只占一个 key。 */
export type FileNotice = ExternalChange | WatcherDegraded

/**
 * 三种去向：
 * - `reload`   无未落盘改动，重载并尽量保住光标
 * - `save`     **有未落盘改动：先立即落盘**，再横条告知（架构 §4.9 原文的顺序，不许调换）
 * - `detach`   文件已不在原处，转游离态——内容留在编辑器里，可另存
 */
export type ConflictAction = 'reload' | 'save' | 'detach'

export interface ConflictDecision {
  action: ConflictAction
  /** 横条要说的话；`null` = 不出横条（无脏重载是静默的，纸不该为这种事被打断）。 */
  notice: CopyKey | null
  /** 横条是否常驻。涉及用户字节的事不许自己溜走；降级告知那种一次性提示可以。 */
  sticky: boolean
}

/**
 * 脏 × 外部改 × 删除的完整矩阵。**只有四格**，所以它值得被穷举断言：
 * 把「有脏 + changed」错判成 `reload`，就是那个会吞掉用户刚敲的字的场景。
 */
export function decideExternalChange(input: { kind: ExternalChangeKind; dirty: boolean }): ConflictDecision {
  if (input.kind === 'removed') {
    // 删除时**不写回**：写回等于把用户没要求的文件复活。内容留在编辑器里，
    // ⌘S 就是「另存」——路径没变，atomicWrite 会把它重新建出来。
    return { action: 'detach', notice: 'conflict.removed', sticky: true }
  }
  if (input.dirty) return { action: 'save', notice: 'conflict.saved', sticky: true }
  return { action: 'reload', notice: null, sticky: false }
}

// **自写回声的判据不在这里**：它是 L2 定的共享接缝 `core/fs/self-write.ts`
// （`createSelfWriteLog`，指纹 = path + mtime + size，claim 消费型，两侧 realpath）。
// 本文件一度有一份自己的 `isSelfWrite`——那是 L2 未合并期的桩，合并后**必须删掉**：
// 两份判据并存就等于两张表各挡一半回声，而漏挡的表现是"保存一次自我重载一次"。
// 一条纪律一种手段（002 §6.1）。

/** 一个文件的身份印记。对账只比这两个数——比内容要读全文，切窗口时太贵。 */
export interface FileStamp {
  mtimeMs: number
  size: number
}

/**
 * focus 对账：拿上次记下的印记与此刻的实况比。
 * `known === null` 表示我们没有印记可比（还没读过这个 page），此时**不许报变更**——
 * 无印记就报，等于每次切回窗口都重载一遍。
 */
export function reconcileKind(known: FileStamp | null, current: FileStamp | null): ExternalChangeKind | null {
  if (known === null) return null
  if (current === null) return 'removed'
  return current.mtimeMs === known.mtimeMs && current.size === known.size ? null : 'changed'
}
