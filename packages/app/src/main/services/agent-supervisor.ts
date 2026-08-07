// AgentSupervisor —— 引擎 sidecar 的生命周期（架构 §2.1、§4.1）。
// 只管起停、健康与退避；决策逻辑在 @sepia/core 的纯状态机里（可单测），
// 这里负责把决定翻译成 fork / kill / 定时器。
//
// 纪律 12：**同步路径上没有它**——window 可见（t3）之后才允许调 startEngine，
// smoke #8 以 stdout 的 fork 时间戳断言这一点。

import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'

import { app, utilityProcess, type UtilityProcess } from 'electron'

// **主入口只 import type**：值导入会把 @opencode-ai/sdk 的整张模块图拖上同步启动路径
// （纪律 12）。实测教训：值导入时 t0→t3 从 316ms 涨到 1089ms。真正的 AgentBridge
// 在引擎就绪后才动态 import——那时纸早已可写。
// `@sepia/agent/tasks` 是为此单开的纯任务层子入口（不碰 SDK、不碰网络），值导入无害。
import type { AgentBridge, EngineEvent } from '@sepia/agent'
import { TASKS, type TaskDefinition } from '@sepia/agent/tasks'
import {
  asBookDirectory,
  ENGINE_INITIAL,
  engineReduce,
  parseModel,
  type AppConfig,
  type BookDirectory,
  type EngineMachineState,
  type EngineStatus,
  tabPath,
} from '@sepia/core'

import type { Credentials } from './credentials.ts'
import { engineIsolationEnv, type SepiaPaths } from './paths.ts'
import { getTimeline } from './perf.ts'
import { loadSession } from './session-state.ts'

const SIDECAR_READY_TIMEOUT_MS = 60_000
const SIDECAR_STOP_TIMEOUT_MS = 6_000
const STREAM_RETRY_MS = 1_000
/** 等流连上的上限。等不到就放行——⌘K 不许卡在这里（不变量 1）。 */
const STREAM_OPEN_TIMEOUT_MS = 3_000

interface SupervisorState {
  machine: EngineMachineState
  child: UtilityProcess | null
  bridge: AgentBridge | null
  port: number
  password: string
  startedAt: number
  restartTimer: ReturnType<typeof setTimeout> | null
  /** 换代计数：旧 fork 的回调凭它自弃，避免僵尸回调改新状态。 */
  generation: number
  stopping: boolean
  paths: SepiaPaths | null
  credentials: Credentials | null
  config: AppConfig | null
}

const state: SupervisorState = {
  machine: ENGINE_INITIAL,
  child: null,
  bridge: null,
  port: 0,
  password: '',
  startedAt: 0,
  restartTimer: null,
  generation: 0,
  stopping: false,
  paths: null,
  credentials: null,
  config: null,
}

const statusListeners = new Set<(status: EngineStatus) => void>()
const eventListeners = new Set<(event: EngineEvent) => void>()

/** 诊断走 stdout（与 perf.ts 同一条通道）：smoke 靠它拿 pid 与 fork 时刻。 */
function diag(payload: Record<string, unknown>): void {
  process.stdout.write(`sepia-engine: ${JSON.stringify(payload)}\n`)
}

function setStatus(next: EngineMachineState): void {
  const changed = state.machine.status !== next.status
  state.machine = next
  if (!changed) return
  diag({ event: 'status', status: next.status, restarts: next.restarts })
  for (const listener of statusListeners) listener(next.status)
}

export function engineStatus(): EngineStatus {
  return state.machine.status
}

export function onEngineStatusChange(listener: (status: EngineStatus) => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

/** 引擎 SSE 事件的主进程扇出口。ipc 层订阅它并推给所有窗口。 */
export function onEngineEvent(listener: (event: EngineEvent) => void): () => void {
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}

/** 就绪时返回 bridge，缺席/启动中返回 null——调用方以此实现「Agent 可以缺席」。 */
export function engineBridge(): AgentBridge | null {
  return state.machine.status === 'ready' ? state.bridge : null
}

/** 引擎产物目录：dev/smoke 在 out/main 旁边，打包后在 resources 下。 */
function engineDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'engine') : join(__dirname, '../../engine')
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('拿不到空闲端口')))
        return
      }
      server.close(() => resolve(address.port))
    })
    server.on('error', reject)
  })
}

/**
 * 注入引擎的内存配置（OPENCODE_CONFIG_CONTENT）。**不变量 4 双保险**：
 * 工具全关 + permission 全 deny——check:bridge 守 preload 一侧，这里守引擎一侧。
 */
function engineConfigContent(credentials: Credentials | null): string {
  // provider 定义（明文，来自 config.json）与密钥（密文，来自 credentials.json）在**这里**
  // 才合流，且只存在于将要 fork 的子进程的内存 env 里——两者在磁盘上始终分开。
  const definitions = state.config?.provider ?? {}
  const provider: Record<string, Record<string, unknown>> = {}
  for (const [id, definition] of Object.entries(definitions)) {
    provider[id] = { ...(definition as Record<string, unknown>) }
  }
  for (const [id, entry] of Object.entries(credentials?.providers ?? {})) {
    const existing = provider[id] ?? {}
    const options = { ...(existing['options'] as Record<string, unknown> | undefined) }
    options['apiKey'] = entry.apiKey
    provider[id] = { ...existing, options }
  }
  const model = parseModel(state.config?.model ?? null)
  // 任务注册表 → 引擎侧 agent（§4.3c 四元组的引擎化身，a4 缺陷 A 的根修）：
  // 名字即任务类型，prompt 用注册表里的常量（纪律 21——它因此天然是常量），
  // 权限全 deny——deny 掉 `skill` 还顺带把技能表从 system prompt 里摘掉。
  // **不用 `steps: 1` 兜底单发**：引擎在最后一步会注入「已达步数上限，请总结」
  // 的提示词，那段话会被模型当成要输出的内容——工具全 deny 后本来就只有一发。
  const agents = Object.fromEntries(
    // `as const` 的注册表把 model 收窄成 `null` 字面量；这里要按接口宽型来分支
    (Object.entries(TASKS) as Array<[string, TaskDefinition]>).map(([type, definition]) => [
      type,
      {
        mode: 'primary',
        prompt: definition.systemPrompt,
        permission: { '*': 'deny' },
        ...(definition.model === null
          ? {}
          : { model: `${definition.model.providerID}/${definition.model.modelID}` }),
      },
    ]),
  )
  return JSON.stringify({
    ...(model === null ? {} : { model: `${model.providerID}/${model.modelID}` }),
    permission: { edit: 'deny', bash: 'deny', webfetch: 'deny', doom_loop: 'deny', external_directory: 'deny' },
    tools: { write: false, edit: false, bash: false, patch: false, webfetch: false, task: false, todowrite: false },
    share: 'disabled',
    autoupdate: false,
    snapshot: false,
    agent: {
      ...agents,
      // 关掉引擎的**自动取标题**（150 债 5 / 150 §1.9 回流 9）：每轮 markup 除了改写那一发，
      // 引擎还会拿 small model 白跑一次给会话取标题——而 MVP 根本不显示会话标题。
      // `disable` 是引擎自己的开关：命中即 `delete agents['title']`，而取标题那段开头就是
      // `agents.get("title")` 取不到就 return（vendor `session/prompt.ts`）——**整段跳过，
      // 不是跑完丢掉**。`title` 是 native agent，只能这么关，不能靠不引用它。
      title: { disable: true },
    },
    // 双保险的另一半：就算某次 send 忘带 agent，缺省也落在注册表内，不落回 build。
    default_agent: 'rewrite' satisfies keyof typeof TASKS,
    ...(Object.keys(provider).length > 0 ? { provider } : {}),
  })
}

/**
 * 引擎子进程的隔离环境（架构 §4.1）。路径隔离部分由 `paths.ts` 的
 * `engineIsolationEnv` 派生——**fork 时设定**，引擎在模块加载期就把路径算死了，
 * 事后改无效。这些变量只进子进程，不进 Sepia 环境，不落盘（140 §1.3 暴露面表）。
 */
function engineEnv(paths: SepiaPaths, credentials: Credentials | null): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    ...engineIsolationEnv(paths),
    OPENCODE_CONFIG_CONTENT: engineConfigContent(credentials),
    // 鉴权走环境变量，不走 listen 参数（架构 §4.1；server/auth.ts 的回退链）
    OPENCODE_SERVER_USERNAME: 'sepia',
    OPENCODE_SERVER_PASSWORD: state.password,
    SEPIA_ENGINE_ENTRY: join(engineDir(), 'node.js'),
    SEPIA_ENGINE_PORT: String(state.port),
    SEPIA_ENGINE_HOST: '127.0.0.1',
  }
}

/**
 * 窗口可见后调用（纪律 12）。幂等：已在跑就不动。
 * 引擎缺席（产物没建、起不来）永远不影响纸——这里所有失败都收敛到 absent 状态。
 */
export function startEngine(paths: SepiaPaths, credentials: Credentials | null, config: AppConfig): void {
  if (state.child !== null || state.restartTimer !== null) return
  state.paths = paths
  state.credentials = credentials
  state.config = config
  state.stopping = false
  void fork()
}

/** 当前配置里的默认模型（renderer 侧 Stage 4 才用得上；这里先让它可查）。 */
export function defaultModel(): { providerID: string; modelID: string } | null {
  return parseModel(state.config?.model ?? null)
}

async function fork(): Promise<void> {
  const generation = ++state.generation
  const paths = state.paths
  if (paths === null) return

  setStatus(engineReduce(state.machine, { type: 'spawn' }).state)

  let child: UtilityProcess
  try {
    state.port = await freePort()
    // smoke 注入口：隔离 smoke 要用已知凭据直接查引擎（如 /skill 探针断言）。
    // 只取这一个 key、不打印值（纪律 18）；未注入时照旧每次随机。
    state.password = process.env['SEPIA_ENGINE_PASSWORD'] ?? randomBytes(24).toString('hex')
    const timeline = getTimeline()
    diag({ event: 'fork', at: Math.round(performance.now()), t3: Math.round(timeline.t3 ?? -1) })
    // cwd 也要进隔离根（a4 实测）：/event 等不带 directory 的请求，引擎按**进程 cwd**
    // 兜底 bootstrap 一个 instance——不指定的话那就是 Sepia 的启动目录（dev 下是仓库），
    // 引擎的目光就越出了沙箱。目录得先在：fork 到不存在的 cwd 直接 spawn 失败。
    const cwd = join(paths.engineHome, 'home')
    await mkdir(cwd, { recursive: true })
    child = utilityProcess.fork(join(__dirname, 'sidecar.js'), [], {
      stdio: 'pipe',
      serviceName: 'sepia-engine',
      cwd,
      env: engineEnv(paths, state.credentials),
    })
  } catch (error) {
    diag({ event: 'spawn-failed', message: error instanceof Error ? error.message : String(error) })
    handleExit(0)
    return
  }

  state.child = child
  state.startedAt = performance.now()

  const readyTimer = setTimeout(() => {
    diag({ event: 'ready-timeout', ms: SIDECAR_READY_TIMEOUT_MS })
    child.kill()
  }, SIDECAR_READY_TIMEOUT_MS)

  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`sepia-engine[stderr]: ${chunk.toString('utf8')}`)
  })
  child.stdout?.on('data', () => {
    // 引擎自身的 stdout 不转发——里面可能有会话内容，日志纪律（纪律 18）从紧
  })

  child.on('message', (message: unknown) => {
    if (state.generation !== generation) return
    const data = message as { type?: string; importMs?: number; listenMs?: number; message?: string }
    if (data.type === 'ready') {
      clearTimeout(readyTimer)
      void onReady(generation, data.importMs ?? -1, data.listenMs ?? -1)
    } else if (data.type === 'error') {
      diag({ event: 'sidecar-error', message: data.message })
    }
  })

  child.once('exit', (code) => {
    clearTimeout(readyTimer)
    if (state.generation !== generation) return
    diag({ event: 'exit', code })
    handleExit(performance.now() - state.startedAt)
  })
}

async function onReady(generation: number, importMs: number, listenMs: number): Promise<void> {
  const pid = state.child?.pid
  const { AgentBridge } = await import('@sepia/agent')
  if (state.generation !== generation) return
  state.bridge = new AgentBridge({
    baseUrl: `http://127.0.0.1:${state.port}`,
    username: 'sepia',
    password: state.password,
  })
  setStatus(engineReduce(state.machine, { type: 'ready' }).state)
  diag({
    event: 'ready',
    pid,
    port: state.port,
    importMs,
    listenMs,
    spawnToReadyMs: Math.round(performance.now() - state.startedAt),
  })
  void (async () => {
    // 流与预热**绑同一个 book 目录**——引擎按 directory 分实例，两者分家就等于
    // 在一个实例上开 session、在另一个实例上听事件（a4 实测正是这么哑掉的）。
    const directory = await sessionBookDirectory()
    if (directory === null) return
    if (state.generation !== generation) return
    await ensureStream(directory)
    await prewarmSessions(generation, directory)
  })()
}

/**
 * 上次那个 page 所在的 book 目录。冷启动没有上次 page 就返回 null——
 * 那时不预热、也不预订流，等 renderer 带着真目录来（⌘K 那一步必然会带）。
 */
async function sessionBookDirectory(): Promise<BookDirectory | null> {
  if (state.paths === null) return null
  const session = await loadSession(state.paths)
  // session v2（170 §2.1 ①）：**book 就是 book**，不必再从 page 反推目录。
  // 没有 book 时退回当前 tab 所在目录——游离 page 也该有个能跑 markup 的工作区。
  if (session.book !== null) return asBookDirectory(session.book)
  const current = session.tabs[session.active]
  if (current === undefined) return null
  return asBookDirectory(dirname(tabPath(session.book, current.page)))
}

/**
 * session 预热（T-32 / 架构 §4.3b 条目 2）：引擎就绪时先建好空 session，
 * 把建 session 的那一次往返**从 ⌘K 的关键路径上摘掉**。
 *
 * **预热必须绑 book 目录**（a4 缺陷 A 的根修）：引擎侧 session 在创建时就
 * 绑死了 directory，prompt 的 query 改不了它。此前预热在 `~/.sepia` 上开
 * session，⌘K 拿去用，整轮 markup 就跑在 `~/.sepia` 而不是 book 里——
 * 日志铁证：`created directory=/Users/wp/.sepia` + prompt 时
 * `booting location services directory=/Users/wp/.sepia`。
 * book 目录从 session.json 的上次 page 推出；冷启动没有上次 page 就不预热
 * （预热是优化不是功能，宁可少预热，不可预热错目录）。
 *
 * 池大小是配置项（`sessionPrewarm`，MVP 取 1）。预热失败一声不响——
 * 失败的代价只是慢一点，不该让引擎显得没就绪（不变量 1）。
 */
async function prewarmSessions(generation: number, directory: BookDirectory): Promise<void> {
  const size = state.config?.sessionPrewarm ?? 0
  for (let i = 0; i < size; i++) {
    if (state.generation !== generation || state.bridge === null) return
    try {
      const thread = await state.bridge.openThread({ directory })
      warmThreads.push({ id: thread.id, directory })
    } catch {
      return
    }
  }
  diag({ event: 'prewarm', count: warmThreads.length })
}

/** 预热好的空 session，**连同它绑死的目录**。⌘K 优先取用，取空了就现开一个。 */
const warmThreads: Array<{ id: string; directory: BookDirectory }> = []

/**
 * 只交出目录相符的预热 session——不相符的宁可不用（现开一个的代价是一次往返，
 * 用错目录的代价是整轮 markup 跑错工作区，a4 实测就是这么跑到 `~/.sepia` 去的）。
 */
export function takeWarmThread(directory: BookDirectory): string | null {
  const index = warmThreads.findIndex((thread) => thread.directory === directory)
  if (index === -1) return null
  const [taken] = warmThreads.splice(index, 1)
  return taken?.id ?? null
}

/**
 * 当前订着的那条流。**流是绑 book 目录的**（a4 实测的第三个缺陷）：`/event`
 * 按 directory 找引擎实例，缺了回落到 `process.cwd()`——流订在 cwd 实例、
 * session 活在 book 实例，两边各说各话，renderer 整轮只收得到心跳。
 */
let streamState: { directory: BookDirectory; abort: AbortController } | null = null

/**
 * 保证「订在 `directory` 上的那条流」正在跑，并**等到它真的连上**才返回。
 *
 * 等连上这件事不是洁癖：引擎快起来只要 3s 出头跑完一整轮，流晚一步订上，
 * 那一轮的事件就全落在订阅之前。等不到也不硬等——超时照样放行，
 * 宁可少收几条事件，不可把 ⌘K 卡在这里（不变量 1：Agent 可以缺席）。
 */
export async function ensureStream(directory: BookDirectory): Promise<void> {
  if (streamState !== null && streamState.directory === directory) return
  streamState?.abort.abort()
  const abort = new AbortController()
  streamState = { directory, abort }
  let openGate: (() => void) | null = null
  const connected = new Promise<void>((resolve) => {
    openGate = resolve
  })
  void streamLoop(state.generation, directory, abort.signal, () => openGate?.())
  await Promise.race([connected, new Promise((resolve) => setTimeout(resolve, STREAM_OPEN_TIMEOUT_MS))])
}

/** 事件流常开：断了就重连（引擎还在的前提下）。事件扇出给 ipc 层。 */
async function streamLoop(
  generation: number,
  directory: BookDirectory,
  signal: AbortSignal,
  onOpen: () => void,
): Promise<void> {
  for (;;) {
    if (signal.aborted) return
    if (state.generation !== generation || state.bridge === null || state.machine.status !== 'ready') return
    try {
      await state.bridge.stream({
        directory,
        signal,
        onOpen,
        onEvent: (event) => {
          if (state.generation !== generation || signal.aborted) return
          for (const listener of eventListeners) listener(event)
        },
      })
    } catch {
      // 连接断了。引擎进程死没死由 exit 事件裁——这里只管过一会儿重试
    }
    if (signal.aborted) return
    await new Promise((resolve) => setTimeout(resolve, STREAM_RETRY_MS))
  }
}

function handleExit(uptimeMs: number): void {
  state.child = null
  state.bridge = null
  // 流跟着引擎一起死：不清掉的话，重启后 ensureStream 看见「目录没变」就直接返回，
  // 于是新引擎上再没人订流——一条事件都不会再来。
  streamState?.abort.abort()
  streamState = null
  if (state.stopping) return

  const { state: next, decision } = engineReduce(state.machine, { type: 'exit', uptimeMs })
  setStatus(next)

  if (decision.kind === 'restart') {
    diag({ event: 'backoff', delayMs: decision.delayMs, restarts: next.restarts })
    state.restartTimer = setTimeout(() => {
      state.restartTimer = null
      void fork()
    }, decision.delayMs)
  } else if (decision.kind === 'give-up') {
    // 缺席稳态（架构 §4.1）：不再自动重启。写字、保存、commit 全不受影响。
    diag({ event: 'absent', restarts: next.restarts })
  }
}

/** 应用退出前的礼貌收尾。引擎死不掉就强杀——不许拖住 quit。 */
export async function stopEngine(): Promise<void> {
  state.stopping = true
  if (state.restartTimer !== null) {
    clearTimeout(state.restartTimer)
    state.restartTimer = null
  }
  const child = state.child
  if (child === null) return
  child.postMessage({ type: 'stop' })
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill()
      resolve()
    }, SIDECAR_STOP_TIMEOUT_MS)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
