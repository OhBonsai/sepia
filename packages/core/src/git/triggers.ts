import type { CommitReason } from './trailer.ts'

// 三触发的**调度**（架构 §4.2）。a 期做两条：静默与定时；markup 成对那条只建 API，
// 由调用方直接调 GitService，不经这里。
//
// 纯状态机 + 注入计时器：竞态要能用假计时器逼出来（§1.5 #2），真等 5 分钟的测试没人会跑。

export interface CommitTriggers {
  /** 有一次写盘落地了。重排静默计时；定时那条按自己的节奏走。 */
  touch(): void
  /** 提交完成了（无论成没成）。两条计时都归零重来。 */
  settled(): void
  /** 停掉（换 book / 退出）。 */
  stop(): void
  readonly dirty: boolean
}

export interface CommitTriggerOptions {
  /** 静默阈值：停止写盘这么久就提交。 */
  idleMs: number
  /** 定时兜底：一直在写的话，也不能永远不提交。 */
  intervalMs: number
  onCommit: (reason: CommitReason) => void
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

export function createCommitTriggers(options: CommitTriggerOptions): CommitTriggers {
  const { setTimer, clearTimer } = options
  let idle: unknown = null
  let interval: unknown = null
  let dirty = false

  const clearIdle = (): void => {
    if (idle === null) return
    clearTimer(idle)
    idle = null
  }
  const stopInterval = (): void => {
    if (interval === null) return
    clearTimer(interval)
    interval = null
  }

  /**
   * 提交并让两条计时都归零。
   *
   * **两条计时同时到点时只许提交一次**——这正是 §1.5 #2 盯的竞态：
   * 先 fire 的那条会把另一条清掉，`dirty` 也随之落下，第二条就算漏网也提交不出东西。
   */
  const fire = (reason: CommitReason): void => {
    if (!dirty) return
    dirty = false
    clearIdle()
    stopInterval()
    options.onCommit(reason)
  }

  return {
    touch() {
      dirty = true
      // 静默：每次写盘都重排——它等的是"这一阵子写完了"
      clearIdle()
      idle = setTimer(() => {
        idle = null
        fire('save')
      }, options.idleMs)
      // 定时：**不重排**。重排的话，一直打字的人永远等不到兜底提交，
      // 而兜底存在的全部意义就是给这种人的。
      interval ??= setTimer(() => {
        interval = null
        fire('auto')
      }, options.intervalMs)
    },
    settled() {
      clearIdle()
      stopInterval()
    },
    stop() {
      clearIdle()
      stopInterval()
      dirty = false
    },
    get dirty() {
      return dirty
    },
  }
}
