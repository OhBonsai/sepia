// renderer 侧的 agent 消费面。纪律 1：renderer 里只有 services/api.ts 与本文件
// 允许碰 window.api——组件只经这两个封装。
//
// Stage 3 时这里只到状态（提示线 + ⌘K 缺席文案），并刻意不为五方法做封装，
// 免得「反正封装好了」诱着 UI 提前长出来。Stage 4 浮层落地，封装随之补齐——
// **桥上一项没加**（preload 恰好八项，140 §1.3 预声明的就是这一刻）。

import type { TaskType } from '@sepia/agent/tasks'
import type { EngineStatus, IoResult } from '@sepia/core'

/** 引擎推来的一条事件。形状随事件而异，消费方各取所需（协议规则 4：未知类型忽略）。 */
export interface AgentEvent {
  type: string
  properties?: Record<string, unknown>
}

export interface AgentModel {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
}

interface AgentSurface {
  status(): Promise<EngineStatus>
  onStatusChange(callback: (status: EngineStatus) => void): () => void
  openThread(directory: string): Promise<IoResult<{ id: string }>>
  send(
    threadId: string,
    parts: Array<{ type: 'text'; text: string }>,
    options: { directory: string; model?: { providerID: string; modelID: string }; agent?: TaskType },
  ): Promise<IoResult<void>>
  stream(directory: string): Promise<IoResult<void>>
  interrupt(threadId: string, directory: string): Promise<IoResult<void>>
  listModels(): Promise<IoResult<AgentModel[]>>
  onEvent(callback: (event: AgentEvent) => void): () => void
}

// harness-exempt: 纪律 1 本文件是 window.api.agent 之上的唯一封装（与 api.ts 并列的第二个出口）
const bridge = (globalThis as unknown as { api: { agent: AgentSurface } }).api.agent

export const agent = {
  status: () => bridge.status(),
  onStatusChange: (callback: (status: EngineStatus) => void) => bridge.onStatusChange(callback),
  openThread: (directory: string) => bridge.openThread(directory),
  send: (
    threadId: string,
    parts: Array<{ type: 'text'; text: string }>,
    options: { directory: string; model?: { providerID: string; modelID: string }; agent?: TaskType },
  ) => bridge.send(threadId, parts, options),
  stream: (directory: string) => bridge.stream(directory),
  interrupt: (threadId: string, directory: string) => bridge.interrupt(threadId, directory),
  listModels: () => bridge.listModels(),
  onEvent: (callback: (event: AgentEvent) => void) => bridge.onEvent(callback),
}
