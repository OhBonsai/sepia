import { isAbsolute } from 'node:path'

import { BrowserWindow, dialog, ipcMain } from 'electron'

import type { TextPartInput } from '@sepia/agent'
import { asBookDirectory, type BookDirectory, type IoResult, type PerfMark, type SessionState } from '@sepia/core'

import { loadSession, saveSession } from '../services/session-state.ts'
import { atomicWrite, readText } from '../services/fsio.ts'
import { mark, printReport, report } from '../services/perf.ts'
import * as supervisor from '../services/agent-supervisor.ts'
import * as theme from '../services/theme.ts'
import type { SepiaPaths } from '../services/paths.ts'

// IPC handler 注册。REST 风格命名：`<域>/<动作>`。
// 每一条都对应 preload 白名单里的一项——**桥上没有的东西，这里也不该有**。

const absent = { ok: false, reason: 'agent absent' } as const

function directoryOf(value: unknown): BookDirectory | null {
  if (typeof value !== 'string') return null
  try {
    return asBookDirectory(value)
  } catch {
    return null
  }
}

export function registerIpc(paths: SepiaPaths): void {
  ipcMain.handle('file/read', async (_event, path: unknown): Promise<IoResult<string>> => {
    if (typeof path !== 'string' || !isAbsolute(path)) {
      return { ok: false, reason: 'path must be absolute' }
    }
    return readText(path)
  })

  // **`file/write` 是 ⌘S 全文保存专用通道**（120 §1.3）。
  // 语义是"用户显式保存自己当前编辑的全文"。Stage 4 的落笔必须走**独立的区间写通道**
  // （只接受 `{range, expectedText}`，无无校验重载），并且在类型/模块边界上够不到这一条——
  // 否则 CAS 就从「唯一入口」退化成「其中一个入口」，不变量 3 失去机器保障。
  ipcMain.handle('file/write', async (_event, path: unknown, content: unknown): Promise<IoResult<void>> => {
    if (typeof path !== 'string' || !isAbsolute(path)) {
      return { ok: false, reason: 'path must be absolute' }
    }
    if (typeof content !== 'string') return { ok: false, reason: 'content must be a string' }
    return atomicWrite(path, content)
  })

  ipcMain.handle('dialog/open-markdown', async (event): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ['openFile'],
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        })
      : await dialog.showOpenDialog({ properties: ['openFile'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('session/get', async (): Promise<SessionState> => loadSession(paths))

  ipcMain.handle('session/set', async (_event, state: unknown): Promise<void> => {
    if (typeof state !== 'object' || state === null) return
    const written = await saveSession(paths, state as SessionState)
    // 失败至少要在 dev 终端可见（附录 D.3 第 4 条）。与「保存失败不静默」同一条纪律的
    // 精神——session 丢了不炸应用，但也不许假装写成功。UI 级提示等 Stage 7 的错误体系。
    if (!written.ok) process.stderr.write(`sepia: session write failed — ${written.reason}\n`)
  })

  ipcMain.handle('theme/get', () => theme.resolved())

  // ── agent 域：五方法的 main 代理（140 §1.8 风险 1 已裁——端点与 token 不进 renderer）──
  // 每一条都必须在引擎缺席时得体地失败：{ok:false}，不抛、不挂（不变量 1）。
  // **这里没有、也不许有任何写路径**——check:bridge 的不变量级子条盯着 preload 侧。

  ipcMain.handle('agent/open-thread', async (_event, directory: unknown): Promise<IoResult<{ id: string }>> => {
    const bridge = supervisor.engineBridge()
    const book = directoryOf(directory)
    if (bridge === null) return absent
    if (book === null) return { ok: false, reason: 'directory must be absolute' }
    // 预热池里有就直接拿（T-32）——这一步省下的正是 ⌘K 关键路径上的一次往返。
    // 池空了就现开一个：预热是优化，不是前置条件。
    const warm = supervisor.takeWarmThread()
    if (warm !== null) return { ok: true, value: { id: warm } }
    try {
      return { ok: true, value: await bridge.openThread({ directory: book }) }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(
    'agent/send',
    async (_event, threadId: unknown, parts: unknown, options: unknown): Promise<IoResult<void>> => {
      const bridge = supervisor.engineBridge()
      if (bridge === null) return absent
      const opts = (typeof options === 'object' && options !== null ? options : {}) as {
        directory?: unknown
        model?: { providerID: string; modelID: string }
      }
      const book = directoryOf(opts.directory)
      if (typeof threadId !== 'string' || book === null) return { ok: false, reason: 'bad request' }
      if (!Array.isArray(parts) || parts.some((it) => it?.type !== 'text' || typeof it?.text !== 'string')) {
        return { ok: false, reason: 'parts must be text parts' }
      }
      try {
        await bridge.send(threadId, parts as TextPartInput[], {
          directory: book,
          ...(opts.model === undefined ? {} : { model: opts.model }),
        })
        return { ok: true, value: undefined }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  // 事件流常开在 supervisor 里（就绪即订阅）；这条是显式的「确保在流」握手。
  ipcMain.handle('agent/stream', async (): Promise<IoResult<void>> => {
    return supervisor.engineBridge() === null ? absent : { ok: true, value: undefined }
  })

  ipcMain.handle('agent/interrupt', async (_event, threadId: unknown, directory: unknown): Promise<IoResult<void>> => {
    const bridge = supervisor.engineBridge()
    const book = directoryOf(directory)
    if (bridge === null) return absent
    if (typeof threadId !== 'string' || book === null) return { ok: false, reason: 'bad request' }
    try {
      await bridge.interrupt(threadId, { directory: book })
      return { ok: true, value: undefined }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('agent/list-models', async (): Promise<IoResult<unknown>> => {
    const bridge = supervisor.engineBridge()
    if (bridge === null) return absent
    try {
      return { ok: true, value: await bridge.listModels() }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('agent/status', () => supervisor.engineStatus())

  ipcMain.on('perf/mark', (_event, name: unknown) => {
    if (name !== 't4' && name !== 't5') return
    mark(name as PerfMark)
    // 攒齐 t0–t5 就把报告打到 stdout，供 smoke 读。
    if (report().complete && !process.env['SEPIA_SMOKE_EXIT']) printReport()
  })
}

/** 主题变化时推给所有窗口。renderer 侧只需换 `<html data-theme>`，不重建任何扩展。 */
export function broadcastTheme(): () => void {
  return theme.onChange((next) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.setBackgroundColor(theme.backgroundColor())
      window.webContents.send('theme/changed', next)
    }
  })
}

/** 引擎状态与 SSE 事件推给所有窗口（main 代理形态的「回程」半边）。 */
export function broadcastAgent(): () => void {
  const offStatus = supervisor.onEngineStatusChange((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('agent/status-changed', status)
    }
  })
  const offEvent = supervisor.onEngineEvent((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('agent/event', event)
    }
  })
  return () => {
    offStatus()
    offEvent()
  }
}
