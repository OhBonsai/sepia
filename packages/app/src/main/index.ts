// t0 必须是**这个文件里最早发生的事**——perf 模块在 import 时就落点。
// 放在 whenReady 里会漏掉 Electron 自身初始化的几十到上百毫秒，测出来系统性偏小。
import { mark, onComplete, printReport } from './services/perf.ts'

import { homedir } from 'node:os'

import { app, BrowserWindow } from 'electron'

import { markdownPathsFrom, peekPendingPaths, queuePaths } from './argv.ts'
import { broadcastAgent, broadcastFiles, broadcastTheme, registerIpc, stopSavePipeline } from './ipc/index.ts'
import { startEngine, stopEngine } from './services/agent-supervisor.ts'
import { loadConfig, saveConfig, type LoadedConfig } from './services/config.ts'
import { loadCredentials } from './services/credentials.ts'
import { sepiaPaths, type SepiaPaths } from './services/paths.ts'
import * as theme from './services/theme.ts'
import { configureWatcher, stopWatcher } from './services/watcher.ts'
import * as registry from './windows/registry.ts'
import { createWindow, setMarkupConfig } from './windows/create.ts'

// 001 §3.1 的启动序列。同步路径上**只允许**窗口、单文件与 CM6（纪律 12）——
// git / watcher / 引擎都不在这里，它们分别归 Stage 3 与 Stage 5/6。

const SMOKE_WINDOWS = Number(process.env['SEPIA_SMOKE_EXIT'] ?? '0')

/** 纸已可写但 t5 迟迟不来（空状态下 renderer 根本不发 t4/t5）时的兜底延时。 */
const ENGINE_START_FALLBACK_MS = 2_000

/**
 * 纪律 12：引擎异步拉起，同步路径上没有它。
 *
 * 触发点是 **t5（可写）之后**，不是 t3（窗口可见）。实测的教训：挂在 `show` 上时
 * fork 落在 t4/t5 之前几十毫秒，引擎 import 那 1.5s 的重负载正好和「读文件 + CM6 就绪」
 * 抢 CPU——纪律 12 的字面（fork 在 t3 后）守住了，§1.7 的实质（引擎不许让冷启动变慢）
 * 没守住。判据用「可写」，与 DoD 同一个 t5。
 *
 * 兜底定时器不可省：空状态（没有上次的 page）下 renderer 永远不发 t4/t5，
 * 没有它引擎就永远不起来——那是把「纸可写优先」写成了「Agent 永不到场」。
 */
function armEngine(window: BrowserWindow, paths: SepiaPaths, loaded: LoadedConfig): BrowserWindow {
  window.once('show', () => {
    let started = false
    const begin = (): void => {
      if (started) return
      started = true
      void (async () => {
        const { credentials, importedDefinitions } = await loadCredentials(paths)
        let config = loaded.config
        // 首次导入带回的 provider 定义落进 `~/.sepia/config.json`（明文、无密钥），
        // 密钥另走 safeStorage 密文——两者在磁盘上分开，只在 fork 的 env 里合流。
        if (importedDefinitions !== null && Object.keys(importedDefinitions).length > 0) {
          config = { ...config, provider: { ...importedDefinitions, ...config.provider } }
          await saveConfig(paths, { config, unknown: loaded.unknown })
        }
        startEngine(paths, credentials, config)
      })()
    }
    const fallback = setTimeout(begin, ENGINE_START_FALLBACK_MS)
    onComplete(() => {
      clearTimeout(fallback)
      // 让出一拍：t5 是 renderer 报上来的，此刻主进程正在处理那条 IPC
      setImmediate(begin)
    })
  })
  return window
}

/** smoke 最多等这么久。超时也要把已有的打点打出来——**没测到不等于测过了**。 */
const SMOKE_TIMEOUT_MS = 15_000

function finishSmoke(): void {
  printReport()
  app.quit()
}

function armSmoke(window: BrowserWindow): BrowserWindow {
  if (!SMOKE_WINDOWS) return window

  window.webContents.once('did-finish-load', () => {
    const pending = peekPendingPaths()
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
      const loaded = await loadConfig(paths)
      theme.setMode(loaded.config.theme)
      setMarkupConfig(loaded.config)

      registerIpc(paths, loaded.config)
      broadcastTheme()
      broadcastAgent()
      broadcastFiles()
      // 网络盘逃生舱（架构 §4.9）。watcher 本体的挂载在 renderer 打开 page 之后
      // （见 ipc 的 `file/read`）——它属于异步路径，纪律 12 不许它挡光标。
      configureWatcher({ usePolling: loaded.config.watcher.usePolling })

      queuePaths(markdownPathsFrom(process.argv, process.cwd()))
      armEngine(armSmoke(createWindow()), paths, loaded)

      app.on('before-quit', () => {
        // 不 await：礼貌收尾有 6s 超时兜底强杀（supervisor），quit 不许被引擎拖住
        void stopEngine()
        // 写盘管线的兜底计时也要停：不停的话，退出途中还可能再拨一次 commit，
        // 而那时窗口已经没了，git 子进程却还在跑（架构 §4.2：commit 与纸解耦，
        // 解耦的另一半是"纸没了它也该停"）。
        stopSavePipeline()
        void stopWatcher()
      })
    },
    (error: unknown) => {
      process.stderr.write(`sepia: failed to start — ${String(error)}\n`)
      app.exit(1)
    },
  )
}
