// t0 必须是**这个文件里最早发生的事**——perf 模块在 import 时就落点。
// 放在 whenReady 里会漏掉 Electron 自身初始化的几十到上百毫秒，测出来系统性偏小。
import { mark, onComplete, printReport } from './services/perf.ts'

import { homedir } from 'node:os'

import { app, BrowserWindow } from 'electron'

import { markdownPathsFrom, queuePaths, takePendingPaths } from './argv.ts'
import { broadcastTheme, registerIpc } from './ipc/index.ts'
import { loadConfig } from './services/config.ts'
import { sepiaPaths } from './services/paths.ts'
import * as theme from './services/theme.ts'
import * as registry from './windows/registry.ts'
import { createWindow } from './windows/create.ts'

// 001 §3.1 的启动序列。同步路径上**只允许**窗口、单文件与 CM6（纪律 12）——
// git / watcher / 引擎都不在这里，它们分别归 Stage 3 与 Stage 5/6。

const SMOKE_WINDOWS = Number(process.env['SEPIA_SMOKE_EXIT'] ?? '0')

/** smoke 最多等这么久。超时也要把已有的打点打出来——**没测到不等于测过了**。 */
const SMOKE_TIMEOUT_MS = 15_000

function finishSmoke(): void {
  printReport()
  app.quit()
}

function armSmoke(window: BrowserWindow): BrowserWindow {
  if (!SMOKE_WINDOWS) return window

  window.webContents.once('did-finish-load', () => {
    const pending = takePendingPaths()
    process.stdout.write(
      `sepia: window ready, registry=${registry.count()}, pending=${JSON.stringify(pending)}\n`,
    )
    if (registry.count() < SMOKE_WINDOWS) return

    // 判据是 t5「可写」，不是页面加载完。两者之间还隔着读文件与 CM6 就绪，
    // 而那正是 DoD 要测的那一段。
    const timer = setTimeout(() => {
      process.stdout.write('sepia-perf: timeout —— t0–t5 未攒齐\n')
      finishSmoke()
    }, SMOKE_TIMEOUT_MS)
    onComplete(() => {
      clearTimeout(timer)
      finishSmoke()
    })
  })
  return window
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    queuePaths(markdownPathsFrom(argv, workingDirectory))
    armSmoke(createWindow())
  })

  // macOS 双击 .md / 拖到图标。
  // **注意：当前没有注册为 .md 处理器**——`electron-builder.yml` 里没有
  // `fileAssociations`，所以系统不会给我们发这个事件，只有 `open -a Sepia x.md`
  // 这种显式指定能触发。`fileAssociations` 与游离 page（T-30）一并归 **Stage 6**，
  // 见 120 §1.1 问题二。handler 留着是因为它本身是对的，删了下次还得重写——
  // 但「代码在」不等于「功能在」。
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

  app.whenReady().then(
    async () => {
      mark('t1')
      // os.homedir() 而不是 app.getPath('home')：macOS 上后者**无视 $HOME**
      //（实测 HOME=/tmp/fake 时仍返回 /Users/wp），于是 smoke 的 HOME 隔离完全失效，
      // 测试一直在读写用户真实的 ~/.sepia——冷启动 smoke 曾因此绿得有水分。
      // os.homedir() 在 POSIX 上优先取 $HOME，正常启动两者等价。
      const paths = sepiaPaths(homedir())

      // 读 config 决定主题，然后才建窗口——窗口的 backgroundColor 要用它。
      const { config } = await loadConfig(paths)
      theme.setMode(config.theme)

      registerIpc(paths)
      broadcastTheme()

      queuePaths(markdownPathsFrom(process.argv, process.cwd()))
      armSmoke(createWindow())
    },
    (error: unknown) => {
      process.stderr.write(`sepia: failed to start — ${String(error)}\n`)
      app.exit(1)
    },
  )
}
