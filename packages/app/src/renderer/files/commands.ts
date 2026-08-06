import { useEffect } from 'react'

import { t } from '@sepia/core'

import { registerCommand } from '../commands/registry.ts'
import { api } from '../services/api.ts'

// 文件管理的命令面（架构 §4.9 / 170 §1.2）。
//
// **纪律 6：所有 UI 动作先注册命令再绑键，按钮也走 execute。** a 期还没有文件树，
// 所以这里只有命令、没有按钮——顺序是刻意的：命令先在，b 期的 UI 接上去就是一行
// `execute('files.rename', { to })`，不会出现"先写按钮再回头补命令"那种两套路径。
//
// 目标由调用方给（`execute(id, arg)`）。a 期没有输入 UI，也就刻意**不**在这里自绘
// 输入框或起原生对话框——起对话框要在桥上多开一项，而 170 §1.3 申报的暴露面恰好五项。

export interface FileCommandContext {
  /** 当前 page 的绝对路径；null 时四条命令都得体地什么都不做。 */
  page: string | null
  /** 文件动作产生了新路径（新建、改名、移动）时，让 shell 打开它。 */
  onOpen: (path: string) => void
  /** 当前 page 被移走/删掉后没有东西可打开时的收尾。 */
  onGone: () => void
}

function directoryOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

/** 目标可以是绝对路径，也可以只给个名字（在当前 page 旁边）。 */
function resolveTarget(base: string, target: string): string {
  return target.startsWith('/') ? target : `${directoryOf(base)}/${target}`
}

function argString(arg: unknown, key: string): string | null {
  if (typeof arg === 'string') return arg
  if (typeof arg === 'object' && arg !== null) {
    const value = (arg as Record<string, unknown>)[key]
    if (typeof value === 'string') return value
  }
  return null
}

export function useFileCommands(context: () => FileCommandContext): void {
  useEffect(() => {
    registerCommand({
      id: 'files.new',
      title: 'cmd.file.new',
      run: async (arg) => {
        const { page, onOpen } = context()
        // 没有当前 page 时不猜位置：那会把文件建到用户没预期的地方。
        // 「无 book 时新建到哪」是主页/onboarding 的事（b 期）。
        if (page === null) return
        const name = argString(arg, 'name') ?? `${t('app.untitled')}.md`
        const created = await api.createFile(resolveTarget(page, name))
        if (created.ok) onOpen(created.value)
      },
    })

    registerCommand({
      id: 'files.rename',
      title: 'cmd.file.rename',
      run: async (arg) => {
        const { page, onOpen } = context()
        const to = argString(arg, 'to')
        if (page === null || to === null) return
        const renamed = await api.renameFile(page, resolveTarget(page, to))
        if (renamed.ok) onOpen(renamed.value)
      },
    })

    registerCommand({
      id: 'files.move',
      title: 'cmd.file.move',
      run: async (arg) => {
        const { page, onOpen } = context()
        const directory = argString(arg, 'directory')
        if (page === null || directory === null) return
        const moved = await api.moveFile(page, directory)
        if (moved.ok) onOpen(moved.value)
      },
    })

    registerCommand({
      id: 'files.trash',
      title: 'cmd.file.trash',
      run: async (arg) => {
        const { page, onGone } = context()
        const target = argString(arg, 'path') ?? page
        if (target === null) return
        // 删除**没有自绘确认**（架构 §4.9）——回收站本身就是撤销通道，
        // 再加一层确认是把系统已经给的能力当不存在。
        const trashed = await api.trashFile(target)
        if (trashed.ok && target === page) onGone()
      },
    })
  }, [context])
}
