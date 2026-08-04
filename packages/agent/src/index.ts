// @sepia/agent —— AgentBridge、SSE 协议纯函数。
// 刻意不依赖 @sepia/editor（不在中间层横向连线）；不碰 DOM 与 node 专有接口，
// mock SSE 单测不必起浏览器（架构 §4.8）。
//
// 任务注册表与块式上下文（tasks/ context/）归 Stage 4。

export * from './bridge.ts'
export * from './sse.ts'
