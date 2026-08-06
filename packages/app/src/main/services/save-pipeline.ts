import { realpath, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  createCommitTriggers,
  createSelfWriteLog,
  type AppConfig,
  type CommitReason,
  type CommitTriggers,
  type IoResult,
  type SelfWriteLog,
} from '@sepia/core'

import { atomicWrite } from './fsio.ts'
import { createGitService, type GitService } from './git.ts'

// 写盘管线（架构 §4.2）：**顺序恒为 写盘 → commit**，中间夹一次自写登记。
//
// 三件事在这里汇合，且只在这里：
//   1. 原子写（纪律 8，仍然只走 fsio）
//   2. **自写登记**——L3 的回声抑制靠它分辨"这次变更是我们自己写的"（共享接缝）
//   3. commit 触发——renderer 完全不知道 git 存在（160 §1.1 三：写盘的宿主在 renderer，
//      commit 的宿主在 main，两者不共享一条调用栈）

export interface SavePipeline {
  /** 写一个 page。成功后登记自写并拨动 commit 触发。 */
  write(path: string, content: string): Promise<IoResult<void>>
  /** L3 的消费口（共享接缝）。**只读**：L3 只 claim，不 record。 */
  readonly selfWrites: SelfWriteLog
  /** 当前 book 的 GitService（没有 book 时为 null）。 */
  gitFor(path: string): GitService
  stop(): void
}

export function createSavePipeline(config: AppConfig): SavePipeline {
  const selfWrites = createSelfWriteLog()
  // 一个 book 一个 GitService 与一组触发器。MVP 锁单 book，但按 root 分表几乎不要钱，
  // 且省得 Stage 6 多 book 时回来重构这一层。
  interface Entry {
    git: GitService
    triggers: CommitTriggers
    /** 最近写过的 page（绝对路径），进 trailer。 */
    lastPage: string | null
  }
  const services = new Map<string, Entry>()

  const forRoot = (root: string): Entry => {
    const existing = services.get(root)
    if (existing) return existing
    const git = createGitService(root)
    const triggers = createCommitTriggers({
      idleMs: config.commitIdleMs,
      intervalMs: config.commitIntervalMs,
      setTimer: (fn, ms) => {
        const handle = setTimeout(fn, ms)
        // 5 分钟的兜底计时不该拖住 quit——unref 之后它不再算作"进程还有事要做"
        handle.unref?.()
        return handle
      },
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      onCommit: (reason: CommitReason) => {
        // 回表里取当前条目：`lastPage` 一直在变，闭包捕获的话捕到的是建表那一刻的空值。
        const current = services.get(root)
        // **完全异步、失败不打扰**（架构 §4.2）：commit 的成败与纸无关，
        // 这里连 await 都不做——写盘那条路径不许因为 git 慢而变慢。
        void git
          .commit(reason, current?.lastPage === undefined || current.lastPage === null ? {} : { page: current.lastPage })
          .finally(() => current?.triggers.settled())
      },
    })
    // 最近写过的那个 page 进 commit 的 trailer。**记绝对路径**——
    // 换算成相对 repo 根的路径是 GitService 的事（它才知道根在哪）。
    const entry: Entry = { git, triggers, lastPage: null }
    services.set(root, entry)
    return entry
  }

  return {
    selfWrites,

    async write(path, content) {
      const written = await atomicWrite(path, content)
      if (!written.ok) return written

      // **登记自写：realpath + 写完之后的 stat**。两者都不能省——
      // realpath 是因为 macOS 的 /var 与 /private/var 是同一个地方的两个名字
      // （watcher 报哪一个不由我们决定）；stat 要在写之后取，因为要判等的是
      // "盘上现在这个版本"。登记失败不影响写盘成功，最多漏挡一次回声。
      try {
        const real = await realpath(path)
        const info = await stat(real)
        selfWrites.record({ path: real, mtimeMs: info.mtimeMs, size: info.size })
        const entry = forRoot(dirname(real))
        entry.lastPage = real
        entry.triggers.touch()
      } catch {
        // 文件刚写完就没了（用户同时删掉了）——写盘这件事本身仍然是成功的
      }
      return written
    },

    gitFor(path) {
      return forRoot(dirname(path)).git
    },

    stop() {
      for (const { triggers } of services.values()) triggers.stop()
      services.clear()
    },
  }
}
