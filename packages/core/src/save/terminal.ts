// 写盘失败的终态链（180 §1.2，架构 §4.9 后半）：重试退避 + 拦截关闭。
//
// 两件事都是纯判定，所以都在这儿：重试的时序用假计时器就能验，
// 拦截的判据是一个布尔函数——而它恰恰是**最不能写错**的一处（见下）。

/**
 * 退避阶梯。**写死不可配**（180 刹车条款）：可配的重试次数只会带来
 * "调大一点也许就好了"的错觉，而写盘失败真正需要的是让人知道、让人处置。
 */
export const RETRY_DELAYS_MS = [1_000, 3_000, 9_000] as const

export interface RetryHandle {
  /** 取消在飞的重试（保存成功、或换了 page 时调） */
  cancel: () => void
}

/**
 * 失败后按 1s/3s/9s 重试，**成功即止、三次即停**。
 *
 * `attempt` 返回 true 表示这次写成功了。三次都失败调 `onExhausted`——
 * 那是"持久警示点 + 横条"的触发点，也是拦截关闭的前提。
 */
export function retryWithBackoff(options: {
  attempt: () => Promise<boolean>
  onExhausted: () => void
  /** 计时器**必须注入**，与 `createAutosaveTimer` 同一条理由：core 里没有 `setTimeout`。 */
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}): RetryHandle {
  const { setTimer, clearTimer } = options
  let handle: unknown = null
  let cancelled = false

  const schedule = (index: number): void => {
    if (cancelled) return
    if (index >= RETRY_DELAYS_MS.length) {
      options.onExhausted()
      return
    }
    handle = setTimer(() => {
      void options.attempt().then((ok) => {
        if (cancelled) return
        if (ok) return // 成功即止：不再排下一次
        schedule(index + 1)
      })
    }, RETRY_DELAYS_MS[index]!)
  }

  schedule(0)
  return {
    cancel: () => {
      cancelled = true
      if (handle !== null) clearTimer(handle)
    },
  }
}

export interface CloseGuardState {
  /** 有没有没落盘的字 */
  dirty: boolean
  /** 写盘这条路是不是已经确认不可用（重试耗尽） */
  writeExhausted: boolean
}

/**
 * 关窗/⌘Q 要不要拦。
 *
 * **只有"脏 且 写盘不可用"才拦，其余一律放行**——架构 §4.9 把这条写成
 * ⌘Q 无对话框原则的**唯一例外**。
 *
 * 方向是不对称的，这一点必须记牢：**误拦比漏拦严重得多**。
 * 漏拦丢的是最后几个字（而且那时写盘本来就是坏的，拦住也存不进去）；
 * 误拦是每次退出都弹一个框问你确定吗——那是把唯一的例外变成日常噪音，
 * 整条"纸不打扰人"的气质就没了。所以检查 #2 的破坏方向瞄的是**其余不拦**那一半。
 */
export function shouldInterceptClose(state: CloseGuardState): boolean {
  return state.dirty && state.writeExhausted
}
