import { type CopyKey, t } from '@sepia/core'

// 纪律 5：**registry 存 key 不存字符串**。强制手段是类型——`title: CopyKey`，
// 传「保存」这种字面串编译不过。
// 纪律 6：所有 UI 动作先注册命令再绑键，按钮也走 `execute`——一种契约，不是两种。

export interface Command {
  id: string
  title: CopyKey
  /** CM6 风格的键位描述，如 `Mod-s`。没有键位的命令也合法（只从按钮触发）。 */
  key?: string
  run: () => void | Promise<void>
}

const registry = new Map<string, Command>()

export function registerCommand(command: Command): void {
  registry.set(command.id, command)
}

export function execute(id: string): void | Promise<void> {
  const command = registry.get(id)
  if (!command) return
  return command.run()
}

export function all(): Command[] {
  return [...registry.values()]
}

/** 给界面用：把命令的 key 解析成人话。ui 包不认识 CopyKey，所以解析在 app 侧做。 */
export function label(command: Command): string {
  return t(command.title)
}

export function reset(): void {
  registry.clear()
}
