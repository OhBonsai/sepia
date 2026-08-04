import { isAbsolute } from 'node:path'

import { BrowserWindow, dialog, ipcMain } from 'electron'

import type { IoResult, PerfMark, SessionState } from '@sepia/core'

import { loadSession, saveSession } from '../services/session-state.ts'
import { atomicWrite, readText } from '../services/fsio.ts'
import { mark, printReport, report } from '../services/perf.ts'
import * as theme from '../services/theme.ts'
import type { SepiaPaths } from '../services/paths.ts'

// IPC handler 注册。REST 风格命名：`<域>/<动作>`。
// 每一条都对应 preload 白名单里的一项——**桥上没有的东西，这里也不该有**。

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
