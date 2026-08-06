import { useCallback } from 'react'

import { useFileCommands, type FileCommandContext } from './commands.ts'
import { useExternalChange, type ConflictBanner, type ExternalChangeOptions } from './external.ts'

// 文件域在 shell 上的**唯一接线点**。
//
// 冻结令（170 §1.1〇-2）要求 renderer 只多一处点状 UI，所以这一期文件域对 App.tsx 的
// 全部要求就是：一次 `useFiles(...)` 调用 + 一行横条渲染。外部变更的判定与动手、
// 四条文件命令的注册都在这个目录里，b 期长出文件树时也从这里接。

export type { ConflictBanner } from './external.ts'

export interface FilesOptions extends ExternalChangeOptions {
  /** 文件动作产生新路径时打开它（新建/改名/移动）。 */
  onOpen: (path: string) => void
  /** 当前 page 被删除后没有东西可打开。 */
  onGone: () => void
}

export function useFiles(options: FilesOptions): ConflictBanner | null {
  const { onOpen, onGone, ...external } = options
  const context = useCallback(
    (): FileCommandContext => ({ page: options.path, onOpen, onGone }),
    [options.path, onOpen, onGone],
  )
  useFileCommands(context)
  return useExternalChange(external)
}
