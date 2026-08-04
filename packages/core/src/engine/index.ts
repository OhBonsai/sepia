// 引擎生命周期的**纯逻辑**：状态类型 + 崩溃退避状态机。
// 住在 core 是因为 CLAUDE.md 的下沉纪律——不依赖 Electron 又能独立测的逻辑不许留在 app。
// supervisor（app/main）只负责把这里的决定翻译成 fork / kill / 定时器。

/**
 * 推给 renderer 的引擎状态（跨进程契约）。
 * `starting` 覆盖首次拉起与退避重启中——renderer 的提示线只在 `absent` 出现，
 * 瞬时重启不闪条（W12：细线，不弹窗，克制）。
 */
export type EngineStatus = 'starting' | 'ready' | 'absent'

/** 退避策略。数字进类型不进散落的常量，测试与实现共用一份。 */
export interface EngineBackoffPolicy {
  /** 连续异常退出至多重启这么多次，再挂就进缺席稳态（架构 §4.1：≤3）。 */
  maxRestarts: number
  /** 第 n 次重启前等待的毫秒数；越界取最后一项。 */
  delaysMs: readonly number[]
  /** 存活超过这个时长算「稳定过」，计数清零——防止偶发崩溃在几天后累积成缺席。 */
  stableMs: number
}

export const ENGINE_BACKOFF: EngineBackoffPolicy = {
  maxRestarts: 3,
  delaysMs: [500, 2_000, 5_000],
  stableMs: 30_000,
}

export type EngineEvent =
  | { type: 'spawn' }
  | { type: 'ready' }
  /** 异常退出（含 spawn 失败——uptimeMs 记 0）。用户主动 stop 不进状态机。 */
  | { type: 'exit'; uptimeMs: number }

export interface EngineMachineState {
  status: EngineStatus
  /** 当前连续异常退出的次数（稳定存活会清零）。 */
  restarts: number
}

export const ENGINE_INITIAL: EngineMachineState = { status: 'starting', restarts: 0 }

export type EngineDecision =
  /** 安排一次重启：delayMs 后再 fork。 */
  | { kind: 'restart'; delayMs: number }
  /** 放弃：进入缺席稳态，不再自动重启。 */
  | { kind: 'give-up' }
  | { kind: 'none' }

/**
 * 纯 reducer：事件进，新状态 + 决定出。
 * 不碰定时器、不碰进程——那是 supervisor 的事，所以这里能穷举单测（§1.4 #6）。
 */
export function engineReduce(
  state: EngineMachineState,
  event: EngineEvent,
  policy: EngineBackoffPolicy = ENGINE_BACKOFF,
): { state: EngineMachineState; decision: EngineDecision } {
  switch (event.type) {
    case 'spawn':
      return { state: { ...state, status: 'starting' }, decision: { kind: 'none' } }
    case 'ready':
      // 就绪不清零计数：ready 后立刻再崩的循环也必须在 maxRestarts 次内收敛到缺席。
      // 清零只认「稳定存活」（见 exit 分支）——否则「起来一秒就死」永远到不了稳态。
      return { state: { ...state, status: 'ready' }, decision: { kind: 'none' } }
    case 'exit': {
      const restarts = event.uptimeMs >= policy.stableMs ? 0 : state.restarts
      if (restarts >= policy.maxRestarts) {
        return { state: { status: 'absent', restarts }, decision: { kind: 'give-up' } }
      }
      const delayMs = policy.delaysMs[Math.min(restarts, policy.delaysMs.length - 1)] ?? 0
      return {
        state: { status: 'starting', restarts: restarts + 1 },
        decision: { kind: 'restart', delayMs },
      }
    }
  }
}
