import { PERF_MARKS, STARTUP_BUDGET_MS, type PerfMark, type PerfTimeline } from '@sepia/core'

// 启动打点。纪律 12（同步路径只允许窗口、单文件与 CM6）的强制手段就是它——
// 没有打点，"只允许"就只是一句愿望。
//
// t0 在**模块加载时**就取，不是在 whenReady 里：两者之间隔着 Electron 自身的
// 初始化，几十到上百毫秒，漏掉它测出来的数字会系统性偏小。

const timeline: PerfTimeline = {}

/** t0：进程启动。import 这个模块的那一刻就落点。 */
mark('t0')

const completionListeners = new Set<() => void>()

export function mark(name: PerfMark): void {
  // 每个点只打一次——重复打点会让"窗口可见"这种一次性事件被后来的重绘覆盖。
  if (timeline[name] !== undefined) return
  timeline[name] = performance.now()
  if (PERF_MARKS.every((it) => timeline[it] !== undefined)) {
    for (const listener of completionListeners) listener()
    completionListeners.clear()
  }
}

/**
 * t0–t5 攒齐时回调一次。
 * smoke 用它决定什么时候退出——**判据必须是"可写"（t5），不是"页面加载完"**。
 * 用 `did-finish-load` 当判据会在 renderer 读完文件、CM6 就绪之前就退，
 * 于是测出来的从来不是冷启动，而是"窗口出现"。
 */
export function onComplete(listener: () => void): void {
  if (PERF_MARKS.every((it) => timeline[it] !== undefined)) listener()
  else completionListeners.add(listener)
}

export function getTimeline(): PerfTimeline {
  return { ...timeline }
}

export interface StartupReport {
  timeline: PerfTimeline
  complete: boolean
  segments: {
    coldStartToWritable: number | undefined
    processToWindowVisible: number | undefined
    windowToCaretReady: number | undefined
  }
  withinBudget: boolean | null
}

export function report(): StartupReport {
  const complete = PERF_MARKS.every((name) => timeline[name] !== undefined)
  const span = (from: PerfMark, to: PerfMark): number | undefined => {
    const a = timeline[from]
    const b = timeline[to]
    return a === undefined || b === undefined ? undefined : Math.round(b - a)
  }

  const segments = {
    coldStartToWritable: span('t0', 't5'),
    processToWindowVisible: span('t0', 't3'),
    windowToCaretReady: span('t3', 't5'),
  }

  const withinBudget = complete
    ? segments.coldStartToWritable! <= STARTUP_BUDGET_MS.coldStartToWritable &&
      segments.processToWindowVisible! <= STARTUP_BUDGET_MS.processToWindowVisible &&
      segments.windowToCaretReady! <= STARTUP_BUDGET_MS.windowToCaretReady
    : null

  return { timeline: getTimeline(), complete, segments, withinBudget }
}

/**
 * 打一行机器可读的报告到 stdout，供 smoke 断言。
 * 走 stdout 而不是 IPC，是因为 Playwright 的 `_electron` 能直接读主进程输出，
 * 不必为了测试在桥上多开一个通道（纪律 2：桥上每多一项都是永久成本）。
 */
export function printReport(): void {
  process.stdout.write(`sepia-perf: ${JSON.stringify(report())}\n`)
}
