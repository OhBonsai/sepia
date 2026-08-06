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
  /**
   * 引擎 provider 的**定义**（Stage 3）：`npm` / `baseURL` / `models` 等非秘密字段，
   * 形状即 opencode config 的 `provider` 段，随 `OPENCODE_CONFIG_CONTENT` 注入。
   * **不含 apiKey**——密钥走 safeStorage 密文（`~/.sepia/credentials.json`），
   * fork 时才与定义合流。自定义 openai-compatible provider 光有密钥没有定义是用不了的，
   * 所以两者必须都在，但必须分开存。
   */
  provider: Record<string, unknown>
  /** 默认模型，形如 `providerID/modelID`。为 null 表示用引擎侧默认。 */
  model: string | null
  /**
   * markup 的上下文取材范围（150 §1.1 裁决 2.1，默认「整篇」）。
   * 「整篇」指**取材链默认展开到覆盖整篇**，不是整篇必然进 prompt——
   * 超 `contextBudgetTokens` 时仍然硬截断，离选区近的先进。
   */
  contextScope: 'selection' | 'page'
  /** 上下文预算硬上限（架构 §4.3c）。截断发生时离选区近的内容先进。 */
  contextBudgetTokens: number
  /** session 预热池大小（T-32）。引擎就绪时预建这么多个空 session。 */
  sessionPrewarm: number
  /** 停止输入多久自动写盘（架构 §4.2 写盘时间线）。⌘S 仍是即时的，不受它影响。 */
  autosaveDebounceMs: number
  /**
   * 静默多久提交一次（架构 §4.2 三触发之一）。**必须比 `autosaveDebounceMs` 大一个量级**——
   * 它等的是"这一阵子写完了"，不是"这一句写完了"。
   */
  commitIdleMs: number
  /** 定时兜底提交间隔。与静默取先到者。 */
  commitIntervalMs: number
  /** 锚点模糊匹配的相似度下限。调低即更容易误挂（架构 §4.2「宁可孤儿不误挂」）。 */
  anchorFuzzyThreshold: number
  /** 文件监听（Stage 6a）。只放真读的字段——见架构 §4.5 那句「不是建设清单」。 */
  watcher: {
    /**
     * 网络盘的逃生舱（架构 §4.9 / T-26）：`fs.watch` 在网络盘上事件常常不来，
     * 打开它改用轮询。默认关——轮询在本地盘上是纯粹的耗电。
     */
    usePolling: boolean
  }
}

/** 一个 tab 的位置状态。每个 tab 各记各的光标与滚动——切回来要回到原处。 */
export interface TabState {
  /**
   * page 路径。**book 内的存 book 相对路径，游离的存绝对路径**（170 §2.1 ①）：
   * 相对路径让 book 整体搬家之后 session 仍然成立，而游离 page 没有 book 可依。
   */
  page: string
  cursor: number
  scrollTop: number
}

/**
 * `~/.sepia/session.json`——是**状态**不是设置，与 config 分开（架构 §2.2）。
 *
 * **v2 直接是终态，不做迁移**（170 §2.0 人裁 1）：产品未发布，没有兼容负担；
 * 读到 v1 按"损坏"处理退空会话。多花的力气应该花在终态上，不是花在给不存在的
 * 用户做迁移上。
 */
export interface SessionState {
  version: number
  /** 当前 book 的绝对路径。null = 没有 book（全是游离 page，或空会话）。 */
  book: string | null
  /** 打开着的 tab。空数组 = 显示主页。 */
  tabs: TabState[]
  /** 当前 tab 的下标。tabs 为空时无意义（存 0）。 */
  active: number
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

/**
 * markup 全链打点。**命名空间与启动的 t0–t5 彻底分开**（150 §1.2）。
 *
 * 架构 §4.3b 与纪律 22 原文也把这条链叫 t0–t5，与 §4.7 的启动口径同名——两套口径
 * 同名，smoke 断言与趋势表必混。150 §1.9 回流 2 已请人改，本 stage 就地采用 m0–m5。
 */
export const MARKUP_MARKS = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'] as const
export type MarkupMark = (typeof MARKUP_MARKS)[number]

/** 每个点的含义。改这里就要同时改 150 §1.2 的打点行与预算表。 */
export const MARKUP_MARK_MEANING: Record<MarkupMark, string> = {
  m0: '提交（浮层发送，家具此刻就位，不等首 token）',
  m1: '请求发出（AgentBridge 把这一轮交给引擎）',
  m2: '首字节（SSE 连接上收到的第一个字节）',
  m3: '首 token（第一个文本增量到手，可上屏）',
  m4: '完成（流结束，diff 算完可展示）',
  m5: '落笔（正文 transaction 提交完成）',
}

export type MarkupTimeline = Partial<Record<MarkupMark, number>>

/** markup 预算（架构 §1.1 Aha #2 / 150 §1.7）。断言直接读它，别在测试里另抄数字。 */
export const MARKUP_BUDGET_MS = {
  /** m0 → m3 */
  submitToFirstToken: 3_000,
  /** m3 → m4 */
  firstTokenToDiff: 12_000,
  /** m0 → m4，DoD 一 */
  submitToDiff: 15_000,
  /** m4 → m5 */
  apply: 300,
} as const

/** 保存与打开的结果。失败必须可见，不许静默（120 §1.3 功能深度表）。 */
export type IoResult<T> = { ok: true; value: T } | { ok: false; reason: string }

declare const BOOK_DIRECTORY: unique symbol

/**
 * book 根目录的品牌类型（纪律 10 类型化，002 §2.1 模式）。
 * AgentBridge 的 `send` 只收它不收裸 string——**类型上没有不带 directory 的调用方式**。
 * 唯一的构造入口是 `asBookDirectory`，绝对路径以外进不来。
 */
export type BookDirectory = string & { readonly [BOOK_DIRECTORY]: true }

export function asBookDirectory(absolutePath: string): BookDirectory {
  // 不引 node:path——core 要能在 renderer 与单测里跑。POSIX 与 win32 的绝对路径都认。
  if (!/^(?:\/|[A-Za-z]:[\\/])/.test(absolutePath)) {
    throw new Error(`BookDirectory 必须是绝对路径：${absolutePath}`)
  }
  return absolutePath as BookDirectory
}
