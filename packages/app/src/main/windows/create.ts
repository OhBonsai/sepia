import { join } from 'node:path'

import { BrowserWindow, nativeTheme, shell } from 'electron'

import * as registry from './registry'

// 纪律 13：窗口带 backgroundColor，主题在首帧前就位，避免白闪。
// Stage 1 会把这两个色值换成 theme service 的真相来源；此处是最小占位。
const BACKGROUND = { dark: '#1c1c1c', light: '#ffffff' } as const

export function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  registry.register(window)
  window.on('closed', () => registry.unregister(window.id))

  window.once('ready-to-show', () => window.show())

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
