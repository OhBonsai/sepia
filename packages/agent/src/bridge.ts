// AgentBridge —— renderer 之外唯一的 agent 切面，五方法是换引擎的唯一切面（架构 §4.3）。
// 通路形态已裁（140 §1.8 风险 1）：跑在 **main**，renderer 经 preload 代理到这里；
// 端点与 token 不进 renderer。内部走 @opencode-ai/sdk，端点映射以锁定 tag（v1.18.13）
// 的 OpenAPI 为准；SSE 的协议规则（sse.ts）是我们自己的检查对象，不委托 sdk。

import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk'

import type { BookDirectory } from '@sepia/core'

import { SseParser, type EngineEvent } from './sse.ts'
import type { TaskType } from './tasks/index.ts'

export interface AgentBridgeOptions {
  /** 引擎地址，形如 `http://127.0.0.1:<port>`。 */
  baseUrl: string
  /** Basic Auth。鉴权凭据由 supervisor 经环境变量交给引擎，这里持有同一份。 */
  username: string
  password: string
  /** 测试注入。缺省用全局 fetch。 */
  fetch?: (request: Request) => ReturnType<typeof fetch>
}

/** 发送内容的最小面：Stage 3 只需要文本。file/agent part 等 Stage 4 再收。 */
export interface TextPartInput {
  type: 'text'
  text: string
}

export interface SendOptions {
  /**
   * 纪律 10（类型化）：**每请求显式带 directory**，类型上没有不带的调用方式。
   * `BookDirectory` 只能由 `asBookDirectory` 构造，裸 string 进不来。
   */
  directory: BookDirectory
  /** 模型指定。缺省用引擎侧默认。 */
  model?: { providerID: string; modelID: string }
  /**
   * 引擎侧 agent 指定，名字即任务类型（注册表 §4.3c 的四元组在引擎侧的化身）。
   * a4 真引擎实测：不指定就落到引擎默认的 build agent——完整 coding persona、
   * 技能表、agentic loop 全套。类型收成 `TaskType`，防止手滑传出注册表外的名字。
   */
  agent?: TaskType
}

export interface ThreadRef {
  id: string
}

export interface ModelInfo {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
}

export interface StreamOptions {
  /**
   * 纪律 10 的第五格（a4 真引擎实测补的账）：`/event` **是实例级的**，引擎按
   * `directory` 找实例，缺了就回落到 `process.cwd()`（vendor 的
   * `workspace-routing.ts:87`）。流订在 cwd 实例、session 活在 book 实例时，
   * 两边各说各话——renderer 整轮只收得到 `server.heartbeat`，浮层停在 generating。
   * 五方法里当初只有它漏了类型化 directory，也就只有它翻了车。
   */
  directory: BookDirectory
  signal?: AbortSignal
  /**
   * 连接建立（响应头到手、还没读第一个字节）时回调一次。
   * **send 必须等它**：a4 实测里引擎 3.2s 就跑完了一整轮，流要是晚一步订上，
   * 那一轮的事件就全落在订阅之前——什么都收不到，和没连一样。
   */
  onOpen?: () => void
  /** 每条事件回调一次；协议合并规则见 sse.ts 的 reduceThreadView。 */
  onEvent: (event: EngineEvent) => void
}

export class AgentBridge {
  private readonly client: OpencodeClient
  private readonly baseUrl: string
  private readonly authorization: string
  private readonly fetchImpl: (request: Request) => ReturnType<typeof fetch>

  constructor(options: AgentBridgeOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.authorization = `Basic ${btoa(`${options.username}:${options.password}`)}`
    this.fetchImpl = options.fetch ?? ((request: Request) => fetch(request))
    this.client = createOpencodeClient({
      baseUrl: this.baseUrl,
      headers: { authorization: this.authorization },
      fetch: this.fetchImpl,
    })
  }

  /** 开一条线程（引擎侧 session）。 */
  async openThread(options: { directory: BookDirectory; title?: string }): Promise<ThreadRef> {
    const result = await this.client.session.create({
      query: { directory: options.directory },
      body: options.title === undefined ? {} : { title: options.title },
      throwOnError: true,
    })
    return { id: result.data.id }
  }

  /**
   * 发一条消息，立即返回；生成过程经 `stream` 的事件流回来。
   * 走 `/session/{id}/prompt_async`——同步版会一直挂到生成结束，不适合流式消费。
   */
  async send(threadId: string, parts: TextPartInput[], options: SendOptions): Promise<void> {
    await this.client.session.promptAsync({
      path: { id: threadId },
      query: { directory: options.directory },
      body: {
        parts,
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.agent === undefined ? {} : { agent: options.agent }),
      },
      throwOnError: true,
    })
  }

  /**
   * 订阅引擎事件流（SSE，实例级 firehose——事件自带 sessionID，消费方自己分流）。
   * resolve 于流正常结束，reject 于连接错误。
   * 心跳与合并规则由消费方用 sse.ts 处理——这里只保证「事件一条不落地交出去」。
   */
  async stream(options: StreamOptions): Promise<void> {
    const url = new URL(`${this.baseUrl}/event`)
    url.searchParams.set('directory', options.directory)
    const request = new Request(url, {
      headers: { authorization: this.authorization, accept: 'text/event-stream' },
      signal: options.signal ?? null,
    })
    const response = await this.fetchImpl(request)
    if (!response.ok || response.body === null) {
      throw new Error(`engine event stream failed: ${response.status}`)
    }
    options.onOpen?.()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parser = new SseParser()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      for (const event of parser.feed(decoder.decode(value, { stream: true }))) {
        options.onEvent(event)
      }
    }
  }

  /** 打断当前生成。 */
  async interrupt(threadId: string, options: { directory: BookDirectory }): Promise<void> {
    await this.client.session.abort({
      path: { id: threadId },
      query: { directory: options.directory },
      throwOnError: true,
    })
  }

  /** 可用模型清单（来自注入配置的 provider 集合）。 */
  async listModels(): Promise<ModelInfo[]> {
    const result = await this.client.config.providers({ throwOnError: true })
    return result.data.providers.flatMap((provider) =>
      Object.values(provider.models).map((model) => ({
        providerID: provider.id,
        providerName: provider.name,
        modelID: model.id,
        modelName: model.name,
      })),
    )
  }
}
