import { app, BrowserWindow } from 'electron'

import { markdownPathsFrom, queuePaths, takePendingPaths } from './argv'
import * as registry from './windows/registry'
import { createWindow } from './windows/create'

// harness：`SEPIA_SMOKE_EXIT=N` 时，每个窗口加载完就报一行状态，
// 攒够 N 个窗口自动退出。让「能开空窗口」「单实例锁 + argv 转交」这两条
// Stage 0 验收能在无人值守下跑（CI 里用它，见 .github/workflows/ci.yml）。
// 生产路径 N=0，整段不生效。
const SMOKE_WINDOWS = Number(process.env['SEPIA_SMOKE_EXIT'] ?? '0')

function armSmoke(window: BrowserWindow): BrowserWindow {
  if (!SMOKE_WINDOWS) return window
  window.webContents.once('did-finish-load', () => {
    const pending = takePendingPaths()
    process.stdout.write(
      `sepia: window ready, registry=${registry.count()}, pending=${JSON.stringify(pending)}\n`,
    )
    if (registry.count() >= SMOKE_WINDOWS) app.quit()
  })
  return window
}

// 001 §3.1 的启动序列，Stage 0 只立起同步路径那一段：
// 单实例锁 → 窗口。config / 主题 / 引擎 / git / watcher 都是后面 stage 的事，
// 且按纪律 12 一律不许挤进这条同步路径。

if (!app.requestSingleInstanceLock()) {
  // 抢不到锁：把 argv 交给已运行实例（Electron 走 IPC 送到 second-instance），自身退出。
  app.quit()
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    queuePaths(markdownPathsFrom(argv, workingDirectory))
    // 二次启动开新窗口，而不是聚焦旧窗口——单人多 page 并排看是常态。
    armSmoke(createWindow())
  })

  // macOS 双击 .md / 拖到图标：与 argv 是同一条入口，走同一个队列。
  app.on('open-file', (event, path) => {
    event.preventDefault()
    queuePaths([path])
    if (app.isReady() && registry.count() === 0) armSmoke(createWindow())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) armSmoke(createWindow())
  })

  app.whenReady().then(() => {
    queuePaths(markdownPathsFrom(process.argv, process.cwd()))
    armSmoke(createWindow())
  }, (error: unknown) => {
    process.stderr.write(`sepia: failed to start — ${String(error)}\n`)
    app.exit(1)
  })
}
