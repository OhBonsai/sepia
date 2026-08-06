import { assembleContext, toUserMessage, type ContextBlock, type TaskType } from '@sepia/agent/tasks'
import { createMarkupRun, type MarkupRun, type MarkupTimeline } from '@sepia/core'

import { agent, type AgentEvent } from '../services/agent-bridge.ts'

// 一轮 markup 的链路控制（m0–m4；m5 在 editor 的落笔函数里）。
//
// **打点与链路同生**（纪律 22 / 150 §1.2）：六个点不是事后补的仪表，是这条链路
// 本身的骨架——每个 await 的两侧各是一个点。做成「先跑通、回头补打点」的话，
// 补的时候就得回来重新拆一遍这些 await，那时它一定拆得比现在潦草。

export interface MarkupRequest {
  /** 选区快照。它同时是 CAS 的 compare 那一半——两处必须是同一个字符串。 */
  selection: string
  /** 邻近正文块，由调用方按文档结构算好距离（组装器只认 distance）。 */
  nearby: ContextBlock[]
  /** 动词或用户手打的要求。**进 user message，不进 system prompt**（纪律 21）。 */
  instruction: string
  directory: string
  budgetTokens: number
  model?: { providerID: string; modelID: string }
}

export type MarkupPhase = 'idle' | 'sending' | 'streaming' | 'done' | 'aborted' | 'failed'

export interface MarkupProgress {
  phase: MarkupPhase
  /** 到此刻为止收到的全文。揭示进度由 core 的 reveal 决定，不在这里。 */
  received: string
  timeline: MarkupTimeline
  reason?: string
}

export interface MarkupHandle {
  /** 停止（Esc / 停止按钮）。透传 interrupt，并把本轮标记为 aborted。 */
  stop(): void
  /** 同线程追问：同一个 thread 再来一轮（F10）。 */
  followUp(instruction: string): void
  /**
   * 本轮的打点器。**落笔必须用它**，不能另起一个——
   * m5 起初就是在别处 `createMarkupRun()` 出来的，于是 m0–m4 在一条时间轴上、
   * m5 在另一条，两边都"齐"，合起来一个都不齐（DoD 四要的是六点在**同一条**上）。
   * 反向验证撞出来的：吞掉 m4 而 smoke 照绿，正是因为根本没人在看完整的那条。
   */
  run: Pick<MarkupRun, 'mark' | 'timeline'>
}

/** 事件里的 part（形状随事件而异，取不到就是 null）。 */
function partOf(event: AgentEvent): Record<string, unknown> | null {
  const part = event.properties?.['part']
  return typeof part === 'object' && part !== null ? (part as Record<string, unknown>) : null
}

/** 从引擎事件里抠出文本增量。协议规则 4：认不出的事件一律忽略，不炸流。 */
function textOf(event: AgentEvent): string | null {
  const properties = event.properties
  if (properties === undefined) return null
  const part = partOf(event)
  if (part !== null) {
    if (part['type'] === 'text' && typeof part['text'] === 'string') return part['text']
  }
  if (typeof properties['text'] === 'string') return properties['text']
  return null
}

/**
 * 跑一轮 markup。
 *
 * 返回 handle 而不是 Promise：这一轮**随时可能被打断**（Esc / 转向 / 引擎死），
 * 而 Promise 表达不了「还在跑但已经有中间结果了」。进度经 `onProgress` 推出去。
 */
export function startMarkup(
  request: MarkupRequest,
  onProgress: (progress: MarkupProgress) => void,
): MarkupHandle {
  const run: MarkupRun = createMarkupRun(() => performance.now())
  let received = ''
  let phase: MarkupPhase = 'sending'
  let threadId: string | null = null
  let stopped = false
  let detach: (() => void) | null = null

  const emit = (reason?: string): void => {
    onProgress({ phase, received, timeline: run.timeline(), ...(reason === undefined ? {} : { reason }) })
  }

  const finish = (next: MarkupPhase, reason?: string): void => {
    if (phase === 'done' || phase === 'aborted' || phase === 'failed') return
    phase = next
    // m4 只在**正常完成**时打。中止和失败没有「完成」这件事，
    // 给它们补个 m4 会让 markupReport 把一次没跑完的链路算成达标。
    if (next === 'done') run.mark('m4')
    detach?.()
    detach = null
    emit(reason)
  }

  // m0：提交。**家具在这一刻就位**，不等首 token（D-29 / 架构 §4.3b 条目 6）。
  run.mark('m0')
  emit()

  const userMessage = toUserMessage(
    assembleContext([{ kind: 'selection', text: request.selection, distance: 0 }, ...request.nearby], {
      budgetTokens: request.budgetTokens,
    }),
    request.instruction,
  )

  // markup 链路 = 注册表的 rewrite 任务（MVP 唯一一条）。agent 名即任务类型——
  // 不带它，引擎会落到默认 build agent（完整 coding persona + 技能表 + agentic loop），
  // a4 真引擎实测就是这么翻的车。
  const TASK: TaskType = 'rewrite'

  const send = async (thread: string, message: string): Promise<void> => {
    run.mark('m1')
    const sent = await agent.send(thread, [{ type: 'text', text: message }], {
      directory: request.directory,
      agent: TASK,
      ...(request.model === undefined ? {} : { model: request.model }),
    })
    if (!sent.ok) finish('failed', sent.reason)
  }

  // 引擎会把**我们刚发出去的那条用户消息原样回播一遍**（`message.part.updated`，
  // `type=text`）——它是回声，不是生成结果。a4 真引擎实测的代价：模型一次都没答上来时
  // （比如凭据解不开），这条回声就成了"结果"，diff 里显示的是整段 prompt，
  // **落笔会把 prompt 写进正文**。两道闸，任缺一道都还会漏：
  //   ① 文本与发出去的那条**逐字相同** → 是回声。助手要撞上得把整段 prompt 一字不差复读。
  //   ② 助手那条消息由 `step-start` 开场；记下它的 messageID，此后只认这条消息的文本。
  // ②对桩无效（桩不发 step-start，也没有 messageID）——所以①不能省；
  // ①对"回声被截断成前缀"无效——所以②不能省。
  let assistantMessage: string | null = null
  const isEcho = (event: AgentEvent, text: string): boolean => {
    if (text === userMessage) return true
    const part = partOf(event)
    const id = part?.['messageID']
    return assistantMessage !== null && typeof id === 'string' && id !== assistantMessage
  }

  void (async () => {
    detach = agent.onEvent((event) => {
      if (stopped) return
      // m2：首字节。**任何**一条事件都算——心跳也算，它证明连接是活的。
      run.mark('m2')
      const part = partOf(event)
      if (part?.['type'] === 'step-start' && typeof part['messageID'] === 'string') {
        assistantMessage = part['messageID']
      }
      const text = textOf(event)
      if (text !== null && text !== '' && !isEcho(event, text)) {
        run.mark('m3')
        phase = 'streaming'
        received = text
        emit()
      }
      if (event.type === 'message.completed' || event.type === 'session.idle') {
        // **一个字都没收到，就不是"完成"**：模型没答上来（凭据坏了、provider 不通）时，
        // 引擎照样会把流收干净。判成 done 的话浮层会带着空结果进 result 阶段，
        // 而 result 阶段是有落笔按钮的——于是一次没有结果的生成，能把空串写进正文。
        // 判成 failed，浮层停在生成中并显示失败行，**落笔按钮根本不存在**。
        finish(received === '' ? 'failed' : 'done')
      }
    })

    const opened = await agent.openThread(request.directory)
    if (!opened.ok) {
      finish('failed', opened.reason)
      return
    }
    threadId = opened.value.id
    // 订流**必须带本轮的 book 目录**，且必须等它连上再 send（a4 实测）：
    // 引擎按 directory 分实例，订错实例收不到任何 message 事件；订晚了则整轮
    // 事件都落在订阅之前——两种情况浮层都会一直停在 generating。
    await agent.stream(request.directory)
    await send(threadId, userMessage)
  })()

  return {
    run,
    stop() {
      if (threadId !== null) void agent.interrupt(threadId, request.directory)
      stopped = true
      finish('aborted')
    },
    followUp(instruction) {
      if (threadId === null) return
      // 每轮重发当前选区快照 + system prompt 声明「以本轮原文为准」（T-22 / F10）。
      // 前后文首轮发、追问省略——架构 §4.3c 说它是可后置项，而省略它是免费的。
      received = ''
      phase = 'sending'
      emit()
      void send(
        threadId,
        `【要改写的原文】\n${request.selection}\n\n【要求】\n${instruction}`,
      )
    },
  }
}

