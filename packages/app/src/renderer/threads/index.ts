import { placeThreads, settleThread, type Thread, type ThreadView } from '@sepia/core'

import { api } from '../services/api.ts'

// 线程的 renderer 侧消费（160 §2.2）。**判定在 core、落盘在 main、这里只接线**——
// 与 6a 的外部变更消费端同一个分工。
//
// 这一层做四件事，而它们其实是同一件：**把线程按当前正文重新算一遍去向**。
//   · 打开文件时算一次
//   · 正文变了算一次（**撤销联动就在这里发生**：⌘Z 撤掉落笔 → 引文找不着 → 判孤儿）
//   · 6a 报来外部变更时算一次
//   · 落笔新增一条时算一次
// 四个入口一个算法，所以不存在"某条路径忘了重算"这种缺陷。

/** 重算的防抖：打字时每个键都重算是浪费，而人眼看不出 200ms 的差别。 */
const REALIGN_DEBOUNCE_MS = 200

export interface ThreadStore {
  /** 当前去向（徽章 + 孤儿）。 */
  view(): ThreadView
  /** 正文变了：重算。防抖。 */
  refresh(text: string): void
  /** 立刻重算，不防抖（打开文件、外部变更这种一次性时刻）。 */
  refreshNow(text: string): void
  /** 新增一条线程（落笔链路调用），随后落盘。 */
  add(thread: Thread, text: string): Promise<void>
  /**
   * 链回来了，把两点补上（**UI 先行的后半**）。
   * 补不上就一直是 null——那时徽章仍在，只是 diff 不可用。
   */
  settleCommits(id: string, commits: { before: string; after: string }, text: string): Promise<void>
  /** 拆掉。 */
  dispose(): void
}

export interface ThreadStoreOptions {
  /** book 目录（= page 所在目录，MVP 单 book）。 */
  directory: string
  /** 去向变了就通知——徽章层与面板都靠它。 */
  onChange: (view: ThreadView) => void
  fuzzyThreshold?: number
}

export function createThreadStore(options: ThreadStoreOptions): ThreadStore {
  let threads: Thread[] = []
  let current: ThreadView = { badges: [], orphans: [] }
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const anchorOptions = options.fuzzyThreshold === undefined ? {} : { fuzzyThreshold: options.fuzzyThreshold }

  const recompute = (text: string): void => {
    if (disposed) return
    current = placeThreads(threads, text, anchorOptions)
    // 对齐结果写回锚点偏移（**只更新偏移，不重新取引文**——引文一漂撤销联动就失灵）
    threads = threads.map((thread) => {
      const placement = current.badges.find((it) => it.thread.id === thread.id)
      return placement === undefined ? thread : settleThread(thread, placement)
    })
    options.onChange(current)
  }

  // 开局先把盘上的线程读进来，再按当前正文算一次。
  // 读失败一声不响：线程读不出来是少了徽章，不该让纸打不开（不变量 1 的精神）。
  const loaded = api.loadThreads(options.directory).then((result) => {
    if (disposed || !result.ok) return
    threads = result.value
  })

  return {
    view: () => current,

    refresh(text) {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        recompute(text)
      }, REALIGN_DEBOUNCE_MS)
    },

    refreshNow(text) {
      if (timer !== null) clearTimeout(timer)
      timer = null
      void loaded.then(() => recompute(text))
    },

    async add(thread, text) {
      threads = [...threads, thread]
      recompute(text)
      // 落盘失败不回滚内存：线程已经在纸上了，回滚等于让用户看着徽章消失
      await api.saveThreads(options.directory, threads)
    },

    async settleCommits(id, commits, text) {
      threads = threads.map((thread) => (thread.id === id ? { ...thread, commits } : thread))
      recompute(text)
      await api.saveThreads(options.directory, threads)
    },

    dispose() {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
