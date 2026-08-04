// 跨进程契约类型。main 与 renderer 共用这一份，两侧之间没有直接 import（结构 4）。

/** 主题偏好。真相在 main（`main/services/theme.ts`），renderer 只消费。 */
export type ThemeMode = 'system' | 'light' | 'dark'

/** 解析后的实际主题——`system` 已被 `nativeTheme` 解开。 */
export type ResolvedTheme = 'light' | 'dark'

/**
 * `~/.sepia/config.json`。
 * **只放本 stage 真正读取的字段**（120 §1.1 问题五）：架构 §4.5 那句「字段树镜像
 * 设置清单的四个一级」说的是终态，不是每个 stage 的建设清单。提前铺满就会被迫
 * 替后面的 stage 裁默认值。
 */
export interface AppConfig {
  version: number
  theme: ThemeMode
}

/**
 * `~/.sepia/session.json`——是**状态**不是设置，与 config 分开（架构 §2.2）。
 * 本 stage 只记一个 page：**不建 tab 数组**，多 Tab 归 Stage 6。
 */
export interface SessionState {
  version: number
  /** 上次打开的 page 的绝对路径。为 null 表示没有上次。 */
  page: string | null
  /** 光标在文档中的偏移量（字符数，非字节）。 */
  cursor: number
  /** 编辑区滚动位置（像素）。 */
  scrollTop: number
}

/** 启动打点。口径见 120 §1.7，**六个点的定义不许在实施中改**。 */
export const PERF_MARKS = ['t0', 't1', 't2', 't3', 't4', 't5'] as const
export type PerfMark = (typeof PERF_MARKS)[number]

/** 每个点的含义，与 120 §1.7 的表一一对应。改这里就要同时改那张表。 */
export const PERF_MARK_MEANING: Record<PerfMark, string> = {
  t0: '进程启动（main 第一行可执行语句）',
  t1: 'app.whenReady 回调进入',
  t2: 'BrowserWindow 构造返回',
  t3: '窗口可见（ready-to-show 后 show）',
  t4: 'renderer 侧 page 文件内容到手',
  t5: 'CM6 就绪且光标落位——可写',
}

export type PerfTimeline = Partial<Record<PerfMark, number>>

/** 启动预算（架构 §1.1）。smoke 断言直接读它，别在测试里另抄一份数字。 */
export const STARTUP_BUDGET_MS = {
  /** t0 → t5，DoD */
  coldStartToWritable: 1000,
  /** t0 → t3 */
  processToWindowVisible: 500,
  /** t3 → t5 */
  windowToCaretReady: 500,
} as const

/** 保存与打开的结果。失败必须可见，不许静默（120 §1.3 功能深度表）。 */
export type IoResult<T> = { ok: true; value: T } | { ok: false; reason: string }
