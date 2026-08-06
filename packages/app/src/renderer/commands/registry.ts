import { type CopyKey, t } from '@sepia/core'

// 纪律 5：**registry 存 key 不存字符串**。强制手段是类型——`title: CopyKey`，
// 传「保存」这种字面串编译不过。
// 纪律 6：所有 UI 动作先注册命令再绑键，按钮也走 `execute`——一种契约，不是两种。

export interface Command {
  id: string
  title: CopyKey
  /** CM6 风格的键位描述，如 `Mod-s`。没有键位的命令也合法（只从按钮触发）。 */
  key?: string
  /**
   * 命令体。**参数是可选的**（Stage 6a）：文件域的重命名/移动需要一个目标，
   * 而目标只有调用方知道——b 期的文件树 UI 会带着它走 `execute(id, arg)`，
   * a 期没有 UI，同一条命令由测试直接带参数调用。
   *
   * 刻意不做成必填、也不给命令加 schema：命令层是「一种契约，不是两种」（纪律 6），
   * 参数校验的真相在 main 的 services（那里才守着用户的文件）。
   */
  run: (arg?: unknown) => void | Promise<void>
}

const registry = new Map<string, Command>()

export function registerCommand(command: Command): void {
  registry.set(command.id, command)
}

export function execute(id: string, arg?: unknown): void | Promise<void> {
  const command = registry.get(id)
  if (!command) return
  return command.run(arg)
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
