import { realign, type Alignment, type Anchor, type AnchorOptions } from '../anchor/index.ts'

// 线程与徽章（架构 §4.6 / W8 / W11）。**纯函数**：不碰 fs、不碰 DOM、不认识 git。
//
// 一条线程 = 纸上发生过的一次对话。它有两半：
//   · **锚点**——它当时贴在哪段文字上（a 期建的那套，本期第一次有消费者）
//   · **对话**——问了什么、答了什么。**这一半永不因为对不上而丢**（T-27）
//
// 徽章与孤儿不是两种线程，是**同一批线程按当前正文算出来的两种去向**——
// 所以这里只有一个派生函数，没有两份状态。状态一分家，撤销联动就会立刻漂。

/** 一轮问答。落笔链路写，Agent 够不到（不变量 4）。 */
export interface ThreadTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface Thread {
  id: string
  /** 关联的锚点。线程与锚点一一对应——锚点是它在纸上的位置，线程是它的内容。 */
  anchor: Anchor
  /** 相对 book 根的 page 路径。跨 page 的线程各归各的 page。 */
  page: string
  createdAt: number
  turns: ThreadTurn[]
  /**
   * 成对 commit 的两个 sha（架构 §4.2 / D-08：**diff 从 git 取**，不存第二份正文）。
   * 链失败时是 null——**那时徽章仍在，只是 diff 不可用**。
   */
  commits: { before: string; after: string } | null
}

/** 线程在当前这一版正文上的去向。 */
export interface ThreadPlacement {
  thread: Thread
  /** 对得上 → 徽章挂在这个区间；对不上 → null，沉进置灰区 */
  alignment: Alignment
  /** 徽章挂哪儿。orphan 时为 null。 */
  range: { from: number; to: number } | null
  /** diff 能不能看（链成没成）。 */
  diffAvailable: boolean
}

export interface ThreadView {
  /** 纸上有徽章的（按位置排，面板列表跟着纸走） */
  badges: ThreadPlacement[]
  /** 置灰区：对不上正文的线程。**不消失**，只是暂时没地方挂 */
  orphans: ThreadPlacement[]
}

/**
 * 把线程按**当前正文**算出去向。
 *
 * 这一个函数同时实现了三件看起来不相干的事，因为它们本来就是一件事：
 *   1. 打开文件时对齐
 *   2. 外部改文件后重对齐（6a 的事件触发它）
 *   3. **撤销联动**（T-27）——⌘Z 撤掉落笔，引文就找不着了，这里自然判孤儿；
 *      ⌘⇧Z 恢复，自然又找回来。**不需要任何 undo 钩子**
 */
export function placeThreads(threads: Thread[], text: string, options: AnchorOptions = {}): ThreadView {
  const badges: ThreadPlacement[] = []
  const orphans: ThreadPlacement[] = []
  for (const thread of threads) {
    const alignment = realign(thread.anchor, text, options)
    const diffAvailable = thread.commits !== null
    if (alignment.kind === 'orphan') {
      orphans.push({ thread, alignment, range: null, diffAvailable })
      continue
    }
    badges.push({
      thread,
      alignment,
      range: { from: alignment.from, to: alignment.to },
      diffAvailable,
    })
  }
  // 徽章按位置排：面板里的顺序要跟纸上的顺序一致，否则"第三条"指的是哪条全靠猜
  badges.sort((a, b) => (a.range?.from ?? 0) - (b.range?.from ?? 0))
  // 孤儿按时间倒序：最近失联的最可能是用户正在找的那条
  orphans.sort((a, b) => b.thread.createdAt - a.thread.createdAt)
  return { badges, orphans }
}

/**
 * 对齐之后把锚点的位置**写回**线程（下次对齐从新位置起步）。
 *
 * 只更新偏移，**不重新取引文**：重新取材会让锚点慢慢漂成"当前文本"，
 * 而它记的本该是"当时那段文字"——漂完之后撤销联动就失灵了（§2.8 风险 4）。
 */
export function settleThread(thread: Thread, placement: ThreadPlacement): Thread {
  if (placement.range === null) return thread
  const { from, to } = placement.range
  if (thread.anchor.from === from && thread.anchor.to === to) return thread
  return { ...thread, anchor: { ...thread.anchor, from, to } }
}

/** 线程文件的形状（`~/.sepia/books/<id>/threads/<id>.json`，**不进 git**）。 */
export const THREAD_FILE_VERSION = 1

export interface ThreadFile {
  version: number
  thread: Thread
}

/**
 * 冲突留存的文件名（170 回流 3）：`<时间戳>-<原文件名>`。
 *
 * **留存必须发生在覆盖之前**——覆盖之后磁盘上就只剩我们自己的版本了，
 * 外部那一版再也拿不回来。§2.5 #5 盯的正是这个顺序。
 */
export function conflictFileName(pageName: string, at: number): string {
  const stamp = new Date(at).toISOString().replace(/[:.]/g, '-')
  return `${stamp}-${pageName}`
}
