import { join } from 'node:path'

import { BrowserWindow, shell } from 'electron'

import { DEFAULT_CONFIG, type AppConfig } from '@sepia/core'

import { mark } from '../services/perf.ts'
import * as theme from '../services/theme.ts'
import * as registry from './registry.ts'

// 纪律 13：窗口带 backgroundColor，主题在首帧前就位，避免白闪。
// 背景色与 renderer 的变量表**由同一份真相派生**（services/theme.ts），
// Stage 0 那个写死在这里的二元判断已被替换。

// 与 `theme.setMode()` 同一个模式：启动时设一次，`createWindow` 从模块状态读——
// 而不是让每个调用点都去拿配置。重新激活（dock 点击、第二扇窗）那几条路径
// 手上没有 config，改成传参就得把它一路穿过去。
let markupConfig: Pick<AppConfig, 'contextScope' | 'contextBudgetTokens' | 'autosaveDebounceMs'> = DEFAULT_CONFIG

export function setMarkupConfig(config: AppConfig): void {
  markupConfig = config
}

/**
 * 渲染层要用的几个配置值，搭 argv 班车：`scope,budget,autosaveMs`。
 * 三个值仍不值得上 JSON，也仍**不值得在桥上开 key**——它们开机即定死
 * （MVP 没有设置 UI，改 config.json 本来就要重启），够不上一个永久暴露面。
 */
function markupParams(): string {
  const { contextScope, contextBudgetTokens, autosaveDebounceMs } = markupConfig
  return `${contextScope},${contextBudgetTokens},${autosaveDebounceMs}`
}

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
      //
      // markup 的两个配置项搭同一班车（Stage 4）。**刻意不为它们在桥上开一个 key**：
      // 150 §1.3 申报的是「preload 零新增」，而 renderer 要的只是两个开机就定死的数
      //（MVP 没有设置 UI，改 config.json 本来就要重启）。用既有通道 = 暴露面不增。
      additionalArguments: [`--sepia-theme=${resolved}`, `--sepia-markup=${markupParams()}`],
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
