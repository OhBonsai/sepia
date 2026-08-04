import { join } from 'node:path'

import { BrowserWindow, shell } from 'electron'

import { mark } from '../services/perf.ts'
import * as theme from '../services/theme.ts'
import * as registry from './registry.ts'

// 纪律 13：窗口带 backgroundColor，主题在首帧前就位，避免白闪。
// 背景色与 renderer 的变量表**由同一份真相派生**（services/theme.ts），
// Stage 0 那个写死在这里的二元判断已被替换。

export function createWindow(): BrowserWindow {
  const resolved = theme.resolved()

  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    show: false,
    backgroundColor: theme.backgroundColor(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // 首帧主题走 argv 同步传给 preload，**不走 IPC**——IPC 是异步的，
      // 天然晚于首帧，而纪律 13 要的就是"首帧之前"。
      additionalArguments: [`--sepia-theme=${resolved}`],
    },
  })
  mark('t2')

  registry.register(window)
  window.on('closed', () => registry.unregister(window.id))

  window.once('ready-to-show', () => {
    window.show()
    mark('t3')
  })

  // 外链一律交给系统浏览器，不在应用内开窗。
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) {
    void window.loadURL(devServer)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
