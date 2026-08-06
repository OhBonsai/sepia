import { createAutosaveTimer, type AutosaveTimer } from '@sepia/core'

// 自动写盘的 renderer 侧接线（架构 §4.2）。**单开一个模块，不摊进 App.tsx**——
// 冻结令期间（160/170 §1.1〇-2）App.tsx 只多一行「挂上/拆掉」，别的都在这里。
//
// 这里只做两件 core 做不了的事：
//   1. 提供真计时器（core 是叶子包，不认 setTimeout）
//   2. **听组合事件**——挂起与解挂的时机来自 DOM，不来自状态机
//
// 组合那两个监听挂在 `document` 上，是 §1.8 风险 1 探针的结论：
// `compositionstart`/`compositionend` 会冒泡到 document，所以**不必碰 EditorHost**，
// 也不必拿 CM6 的 `view.composing`——冻结令因此不被触碰。

export interface Autosave {
  /** 文档变了（接 CM6 的 onChange）。 */
  bump(): void
  /** 拆掉：清计时 + 摘监听。换 page / 卸载时调。 */
  dispose(): void
  /** ⌘S 刚写过，在飞的自动写盘作废——否则会紧接着再写一次同样的内容。 */
  cancel(): void
  /** 诊断用（smoke 断言挂起是否真的生效）。 */
  readonly state: { pending: boolean; suspended: boolean }
}

export function createAutosave(options: { delayMs: number; save: () => void }): Autosave {
  // 诊断探针：smoke 要断言"组合期间确实挂起了"，而挂起在 DOM 上不可见——
  // 与 decorate.ts 的 `__sepiaDecorateBuilds` 同一种手法（唯一诚实的可判定量）。
  const probe = globalThis as unknown as { __sepiaAutosave?: { pending: boolean; suspended: boolean } }
  function publish(): void {
    probe.__sepiaAutosave = { pending: timer.pending, suspended: timer.suspended }
  }

  const timer: AutosaveTimer = createAutosaveTimer({
    delayMs: options.delayMs,
    onFire: options.save,
    setTimer: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimer: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  })

  // 探针要跟着组合状态走，否则 smoke 看到的永远是组合前那一帧（publish 定义在下面）
  const onCompositionStart = (): void => {
    timer.suspend()
    publish()
  }
  const onCompositionEnd = (): void => {
    timer.resume()
    publish()
  }
  // **`blur` 也要解挂**：组合中途切走窗口时 `compositionend` 未必来，只认它的话
  // 计时会永久挂起——那不是"晚点写"，是"自动保存从此静默停摆"，比写早了糟得多。
  // §1.5 #10 盯的正是这一条。
  const onBlur = (): void => {
    timer.resume()
    publish()
  }

  document.addEventListener('compositionstart', onCompositionStart)
  document.addEventListener('compositionend', onCompositionEnd)
  globalThis.addEventListener('blur', onBlur)

  publish()

  return {
    bump() {
      timer.bump()
      publish()
    },
    cancel() {
      timer.cancel()
      publish()
    },
    dispose() {
      timer.cancel()
      document.removeEventListener('compositionstart', onCompositionStart)
      document.removeEventListener('compositionend', onCompositionEnd)
      globalThis.removeEventListener('blur', onBlur)
      publish()
    },
    get state() {
      return { pending: timer.pending, suspended: timer.suspended }
    },
  }
}
