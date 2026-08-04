// 引擎 sidecar —— utilityProcess 的入口（electron-vite main 的第二个 input）。
// 在子进程内 `import` 单文件 ESM 产物并 `Server.listen`（架构 §4.1）。
//
// 产物路径经 SEPIA_ENGINE_ENTRY 在 **fork 时**注入——与四个 XDG 根同理，
// 引擎在模块加载期就把路径算死了，所有环境都必须在 import 之前就位。
// 这里因此不 import 'electron'：utilityProcess 里只有 node 面孔 + process.parentPort。
//
// 鉴权：OPENCODE_SERVER_USERNAME / OPENCODE_SERVER_PASSWORD 环境变量，
// **不走 listen 参数**（server/auth.ts: credentials ?? Flag.OPENCODE_SERVER_PASSWORD）。

import { pathToFileURL } from 'node:url'

interface EngineServerModule {
  Server: {
    listen(options: { port: number; hostname: string }): Promise<{ stop(close?: boolean): void | Promise<void> }>
  }
}

type SidecarMessage =
  | { type: 'ready'; importMs: number; listenMs: number }
  | { type: 'stopped' }
  | { type: 'error'; message: string }

interface ParentPort {
  postMessage(message: SidecarMessage): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}

const maybePort = (process as unknown as { parentPort?: ParentPort }).parentPort
if (!maybePort) throw new Error('sidecar 只能被 utilityProcess.fork 启动')
const parentPort: ParentPort = maybePort

const entry = process.env['SEPIA_ENGINE_ENTRY']
const port = Number(process.env['SEPIA_ENGINE_PORT'])
const hostname = process.env['SEPIA_ENGINE_HOST'] ?? '127.0.0.1'

async function main(): Promise<void> {
  if (!entry || !Number.isInteger(port)) {
    throw new Error('SEPIA_ENGINE_ENTRY / SEPIA_ENGINE_PORT 未设——supervisor 的 fork 环境不完整')
  }
  const t0 = performance.now()
  const mod = (await import(pathToFileURL(entry).href)) as EngineServerModule
  const tImport = performance.now()
  const listener = await mod.Server.listen({ port, hostname })
  const tListen = performance.now()

  parentPort.postMessage({
    type: 'ready',
    importMs: Math.round(tImport - t0),
    listenMs: Math.round(tListen - tImport),
  })

  parentPort.on('message', (event) => {
    const data = event.data as { type?: string } | undefined
    if (data?.type !== 'stop') return
    void (async () => {
      try {
        await listener.stop()
      } finally {
        parentPort.postMessage({ type: 'stopped' })
        setImmediate(() => process.exit(0))
      }
    })()
  })
}

main().catch((error: unknown) => {
  parentPort.postMessage({
    type: 'error',
    message: error instanceof Error ? (error.stack ?? error.message) : String(error),
  })
  setImmediate(() => process.exit(1))
})
