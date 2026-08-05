import { assembleContext, toUserMessage, type ContextBlock } from '@sepia/agent/tasks'
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

/** 从引擎事件里抠出文本增量。协议规则 4：认不出的事件一律忽略，不炸流。 */
function textOf(event: AgentEvent): string | null {
  const properties = event.properties
  if (properties === undefined) return null
  const part = properties['part']
  if (typeof part === 'object' && part !== null) {
    const record = part as Record<string, unknown>
    if (record['type'] === 'text' && typeof record['text'] === 'string') return record['text']
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

  const send = async (thread: string, message: string): Promise<void> => {
    run.mark('m1')
    const sent = await agent.send(thread, [{ type: 'text', text: message }], {
      directory: request.directory,
      ...(request.model === undefined ? {} : { model: request.model }),
    })
    if (!sent.ok) finish('failed', sent.reason)
  }

  void (async () => {
    detach = agent.onEvent((event) => {
      if (stopped) return
      // m2：首字节。**任何**一条事件都算——心跳也算，它证明连接是活的。
      run.mark('m2')
      const text = textOf(event)
      if (text !== null && text !== '') {
        run.mark('m3')
        phase = 'streaming'
        received = text
        emit()
      }
      if (event.type === 'message.completed' || event.type === 'session.idle') finish('done')
    })

    const opened = await agent.openThread(request.directory)
    if (!opened.ok) {
      finish('failed', opened.reason)
      return
    }
    threadId = opened.value.id
    await agent.stream()
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

