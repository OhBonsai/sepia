// 自动写盘的**计时状态机**（架构 §4.2 写盘时间线）。纯逻辑：不碰 DOM、不碰 fs，
// 计时器注入。真正碰 DOM 的只有"什么时候 suspend/resume"，那部分留在 renderer。
//
// 挂起这件事不是可选项，是 §1.8 风险 1 探针的直接产物：**IME 组合中途，文档里装的是
// 拼音**（实测 `输入区nihao 尾`）。这一刻写盘，盘上就真的出现 `nihao`——它随后会被
// `你好` 覆盖，所以不是数据损坏，但那是用户从没打算保存的一个版本，且组合每敲一下
// 就写一次。

export interface AutosaveTimer {
  /** 文档变了。挂起中只记账不计时。 */
  bump(): void
  /** 挂起（IME 组合开始）：取消在飞的计时，此后 bump 只记账。 */
  suspend(): void
  /**
   * 解挂（组合结束 / 失焦）。挂起期间有过 bump 就重新起计时。
   *
   * **`blur` 也要调它**：组合中途切走窗口时 `compositionend` 未必来，只认它的话
   * 计时会永久挂起——那是"自动保存悄悄停了"，比写早了更糟。
   */
  resume(): void
  /** 取消并清账（⌘S 已经写过了、或换了 page）。 */
  cancel(): void
  /** 有待写的改动（在飞或挂起期间攒着的）。 */
  readonly pending: boolean
  readonly suspended: boolean
}

export interface AutosaveOptions {
  delayMs: number
  /** 计时到点要做的事。抛错不许冒泡到计时器里——调用方自己收。 */
  onFire: () => void
  /**
   * 计时器**必须注入**，没有默认值。
   *
   * 不是为了测试方便才这样——`core` 是叶子包，既不认 DOM 也不认 Node，
   * `setTimeout` 在这里根本不存在（typecheck 会当场报 TS2552）。包边界因此顺手
   * 把这条纯逻辑摁成了真的纯逻辑：计时归调用方，状态机只管状态。
   */
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

export function createAutosaveTimer(options: AutosaveOptions): AutosaveTimer {
  const { setTimer, clearTimer } = options
  let handle: unknown = null
  let pending = false
  let suspended = false

  const stop = (): void => {
    if (handle === null) return
    clearTimer(handle)
    handle = null
  }

  const schedule = (): void => {
    stop()
    handle = setTimer(() => {
      handle = null
      pending = false
      options.onFire()
    }, options.delayMs)
  }

  return {
    bump() {
      pending = true
      // 挂起中只记账：组合期间每敲一下都会 bump，重排计时也没用——反正不许写
      if (suspended) return
      schedule()
    },
    suspend() {
      suspended = true
      stop()
    },
    resume() {
      if (!suspended) return
      suspended = false
      // 挂起期间攒下的改动，解挂后按完整的 delay 再等一次——
      // 组合刚结束就立刻写，等于把"停止输入 800ms"这条语义偷偷改成"组合一结束就写"
      if (pending) schedule()
    },
    cancel() {
      stop()
      pending = false
    },
    get pending() {
      return pending
    },
    get suspended() {
      return suspended
    },
  }
}
