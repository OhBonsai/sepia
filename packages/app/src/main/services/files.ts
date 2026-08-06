import { mkdir, rename, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join } from 'node:path'

import type { IoResult } from '@sepia/core'

import { atomicWrite } from './fsio.ts'

// 文件管理（架构 §4.9）：新建 / 重命名 / 移动 / 删除。**UI 归 b 期**，本期只有服务层
// 与命令，所以这里的每个函数都得能被单测直接盯住——它们改的是用户的文件。
//
// 纪律 8：新建走 fsio 的 atomicWrite，不自己 writeFile。
//
// **纪律 17（自写不许惊动自己）在这里刻意不落地**，因为落地的方式会是错的：
// 「最近自写记录」那张表是 L2 的接缝，语义写明 **L3 只 claim、不 record**
// （`SavePipeline.selfWrites` 是只读口）。L3 往里写就成了两个人记一张表，
// 而它的判据是 path+mtime+size —— 删除与改名压根给不出这三件套（文件都不在了）。
//
// 那这四个动作的回声谁管？**「谁在动手」那一侧**：这些动作全部由 renderer 的命令发起，
// 成功后 renderer 立刻打开新路径（新建/改名/移动）或清空当前 page（删除），
// 于是 watcher 的 `currentPage` 在归并窗口（300ms）结束之前就已经改指或作废，
// 旧路径那条事实自然落地无声。**这条链有单测盯着**（watcher.test.ts 的
// 「自己改名当前 page → 旧路径的事件被丢掉」），不是靠时序碰运气。
//
// **删除走系统回收站**（`shell.trashItem`），不自绘确认对话框（架构 §4.9）。
// 但 `shell` 是 Electron 的东西，import 它就意味着这个文件再也不能被 vitest 直接跑——
// 而「删除有没有真的进回收站」恰恰是最该被盯住的一条。所以回收站函数**由调用方注入**
// （ipc 层把 `shell.trashItem` 传进来），单测得以断言「调的是 trash 而不是 unlink」。

/** 回收站动作。真身是 Electron 的 `shell.trashItem`，注入进来只为让本文件可单测。 */
export type TrashFn = (path: string) => Promise<void>

function guard(path: unknown, what: string): IoResult<string> {
  if (typeof path !== 'string' || !isAbsolute(path)) return { ok: false, reason: `${what} must be absolute` }
  return { ok: true, value: path }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * 新建 page。
 *
 * **已存在即失败**，不覆盖：新建这个动作在任何编辑器里都不该吃掉一个已有文件，
 * 而 `atomicWrite` 是无条件覆盖的（它的语义是"保存"）。这道判断就是两种语义的分界。
 */
export async function createPage(path: unknown, content = ''): Promise<IoResult<string>> {
  const target = guard(path, 'path')
  if (!target.ok) return target
  const full = extname(target.value) === '' ? `${target.value}.md` : target.value
  if (await exists(full)) return { ok: false, reason: 'already exists' }
  const written = await atomicWrite(full, content)
  if (!written.ok) return written
  return { ok: true, value: full }
}

/**
 * 重命名 / 移动——**同一个动作**（`rename`），只是目标目录是否相同。
 * 保持两个入口是因为命令面不同（重命名给名字、移动给目录），语义层没必要分叉。
 *
 * `rename` 本身在同一文件系统上是原子的，所以这里不需要 tmp 中转；
 * 但**必须挡住覆盖**：`rename` 会静默吃掉目标文件，那就是丢字节。
 */
export async function renamePage(from: unknown, to: unknown): Promise<IoResult<string>> {
  const source = guard(from, 'from')
  if (!source.ok) return source
  const target = guard(to, 'to')
  if (!target.ok) return target
  if (source.value === target.value) return { ok: true, value: target.value }
  if (await exists(target.value)) return { ok: false, reason: 'target exists' }
  try {
    await mkdir(dirname(target.value), { recursive: true })
    await rename(source.value, target.value)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true, value: target.value }
}

/** 移动到某个目录，文件名不变。 */
export async function movePage(from: unknown, toDirectory: unknown): Promise<IoResult<string>> {
  const source = guard(from, 'from')
  if (!source.ok) return source
  const dir = guard(toDirectory, 'directory')
  if (!dir.ok) return dir
  const name = source.value.slice(source.value.lastIndexOf('/') + 1)
  return renamePage(source.value, join(dir.value, name))
}

/**
 * 删除 = 进系统回收站。
 *
 * **不许退化成 unlink**：回收站是用户的撤销通道，unlink 不是（架构 §4.9 定的就是回收站）。
 * trashItem 失败时**照实报错**，不偷偷改用 unlink——那种"兜底"正是让字节永久消失的写法。
 */
export async function trashPage(path: unknown, trash: TrashFn): Promise<IoResult<void>> {
  const target = guard(path, 'path')
  if (!target.ok) return target
  if (!(await exists(target.value))) return { ok: false, reason: 'not found' }
  try {
    await trash(target.value)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true, value: undefined }
}
