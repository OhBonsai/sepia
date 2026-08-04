// PTY 桩：**调用即抛错**（架构 §4.1）。引擎 import 它不报错（否则起不来），
// 真去开终端才炸——Sepia 的 Agent 没有终端，这条路本就该关着。
// build-engine.ts 把本目录复制到引擎产物旁的 node_modules/@lydell/node-pty/。
function ptyAbsent() {
  throw new Error('PTY unavailable: Sepia ships the engine without a terminal (sepia-architecture §4.1)')
}

export function spawn() {
  ptyAbsent()
}

export function open() {
  ptyAbsent()
}

export default { spawn, open }
