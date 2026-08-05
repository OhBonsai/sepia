// AgentSupervisor —— 引擎 sidecar 的生命周期（架构 §2.1、§4.1）。
// 只管起停、健康与退避；决策逻辑在 @sepia/core 的纯状态机里（可单测），
// 这里负责把决定翻译成 fork / kill / 定时器。
//
// 纪律 12：**同步路径上没有它**——window 可见（t3）之后才允许调 startEngine，
// smoke #8 以 stdout 的 fork 时间戳断言这一点。

import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { app, utilityProcess, type UtilityProcess } from 'electron'

// **只 import type**：值导入会把 @opencode-ai/sdk 的整张模块图拖上同步启动路径
// （纪律 12）。实测教训：值导入时 t0→t3 从 316ms 涨到 1089ms。真正的 AgentBridge
// 在引擎就绪后才动态 import——那时纸早已可写。
import type { AgentBridge, EngineEvent } from '@sepia/agent'
import {
  asBookDirectory,
  ENGINE_INITIAL,
  engineReduce,
  parseModel,
  type AppConfig,
  type EngineMachineState,
  type EngineStatus,
} from '@sepia/core'

import type { Credentials } from './credentials.ts'
import { engineIsolationEnv, type SepiaPaths } from './paths.ts'
import { getTimeline } from './perf.ts'

const SIDECAR_READY_TIMEOUT_MS = 60_000
const SIDECAR_STOP_TIMEOUT_MS = 6_000
const STREAM_RETRY_MS = 1_000

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
  return JSON.stringify({
    ...(model === null ? {} : { model: `${model.providerID}/${model.modelID}` }),
    permission: { edit: 'deny', bash: 'deny', webfetch: 'deny', doom_loop: 'deny', external_directory: 'deny' },
    tools: { write: false, edit: false, bash: false, patch: false, webfetch: false, task: false, todowrite: false },
    share: 'disabled',
    autoupdate: false,
    snapshot: false,
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
    state.password = randomBytes(24).toString('hex')
    const timeline = getTimeline()
    diag({ event: 'fork', at: Math.round(performance.now()), t3: Math.round(timeline.t3 ?? -1) })
    child = utilityProcess.fork(join(__dirname, 'sidecar.js'), [], {
      stdio: 'pipe',
      serviceName: 'sepia-engine',
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
  void streamLoop(generation)
  void prewarmSessions(generation)
}

/**
 * session 预热（T-32 / 架构 §4.3b 条目 2）：引擎就绪时先建好空 session，
 * 把建 session 的那一次往返**从 ⌘K 的关键路径上摘掉**。
 *
 * 池大小是配置项（`sessionPrewarm`，MVP 取 1）。预热失败一声不响——
 * 它是优化不是功能，失败的代价只是慢一点，不该让引擎显得没就绪（不变量 1）。
 */
async function prewarmSessions(generation: number): Promise<void> {
  const size = state.config?.sessionPrewarm ?? 0
  const directory = state.paths === null ? null : asBookDirectory(state.paths.home)
  if (directory === null) return
  for (let i = 0; i < size; i++) {
    if (state.generation !== generation || state.bridge === null) return
    try {
      const thread = await state.bridge.openThread({ directory })
      warmThreads.push(thread.id)
    } catch {
      return
    }
  }
  diag({ event: 'prewarm', count: warmThreads.length })
}

/** 预热好的空 session。⌘K 优先取用，取空了就现开一个。 */
const warmThreads: string[] = []

export function takeWarmThread(): string | null {
  return warmThreads.shift() ?? null
}

/** 事件流常开：断了就重连（引擎还在的前提下）。事件扇出给 ipc 层。 */
async function streamLoop(generation: number): Promise<void> {
  for (;;) {
    if (state.generation !== generation || state.bridge === null || state.machine.status !== 'ready') return
    try {
      await state.bridge.stream({
        onEvent: (event) => {
          if (state.generation !== generation) return
          for (const listener of eventListeners) listener(event)
        },
      })
    } catch {
      // 连接断了。引擎进程死没死由 exit 事件裁——这里只管过一会儿重试
    }
    await new Promise((resolve) => setTimeout(resolve, STREAM_RETRY_MS))
  }
}

function handleExit(uptimeMs: number): void {
  state.child = null
  state.bridge = null
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
