// renderer 侧的 agent 消费面。纪律 1：renderer 里只有 services/api.ts 与本文件
// 允许碰 window.api——组件只经这两个封装。
//
// Stage 3 的消费面**只到状态**（140 §1.2）：提示线 + ⌘K 缺席文案。
// 五方法在桥上已通（smoke/单测走它），但 renderer 侧的真消费者（浮层）归 Stage 4——
// 这里刻意不为它们做封装，免得「反正封装好了」诱着 UI 提前长出来。

import type { EngineStatus } from '@sepia/core'

interface AgentSurface {
  status(): Promise<EngineStatus>
  onStatusChange(callback: (status: EngineStatus) => void): () => void
}

// harness-exempt: 纪律 1 本文件是 window.api.agent 之上的唯一封装（与 api.ts 并列的第二个出口）
const bridge = (globalThis as unknown as { api: { agent: AgentSurface } }).api.agent

export const agent = {
  status: () => bridge.status(),
  onStatusChange: (callback: (status: EngineStatus) => void) => bridge.onStatusChange(callback),
}
