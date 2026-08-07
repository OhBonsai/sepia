import { type CopyKey, type KeyEntry, type KeyGroup, t } from '@sepia/core'

// 纪律 5：**registry 存 key 不存字符串**。强制手段是类型——`title: CopyKey`，
// 传「保存」这种字面串编译不过。
// 纪律 6：所有 UI 动作先注册命令再绑键，按钮也走 `execute`——一种契约，不是两种。

/**
 * 看板里"此刻能不能按"的判据来源（D-32 ⑤）。
 * **只放真的会改变可用性的状态**——每多一个字段，看板就多一处可能说谎的地方。
 */
export interface CommandContext {
  /** markup 浮层开着：正文类操作此刻按不了 */
  markupOpen: boolean
  /** 有没有打开的 page */
  hasPage: boolean
  /** 有没有 book（游离 page 时文件树/最近这些用不上） */
  hasBook: boolean
}

export interface Command {
  id: string
  title: CopyKey
  /** 看板里归哪一组（D-32 ②）。不填按 `file` 归——但**不该有不填的**，见 `entries()`。 */
  group?: KeyGroup
  /**
   * 此刻可不可用。不填 = 永远可用。
   * **它只影响看板的显示**，不是执行时的守卫——真正的守卫在命令体自己那里
   * （看板置灰了照样可以从别处触发，那是设计如此）。
   */
  when?: (context: CommandContext) => boolean
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

/**
 * 把 registry 摊成看板的行（T-03：**绑键 / 菜单 / ⌘/ 看板共用这一层**）。
 *
 * 不另写一张手写的快捷键表——手写的第二份**必然**与实际绑定漂移，
 * 而看板一旦说了假话就比没有看板更糟（"我明明按了它说的键"）。
 * 代价是没绑键的命令会以「未绑定」出现在看板里；那不是瑕疵，是**债看得见**：
 * `threads.panel` 至今没有键位这件事，从此每次按 ⌘/ 都会被看见一次。
 */
export function entries(context: CommandContext): KeyEntry[] {
  return all().map((command) => ({
    id: command.id,
    label: t(command.title),
    group: command.group ?? 'file',
    ...(command.key === undefined ? {} : { spec: command.key }),
    available: command.when === undefined ? true : command.when(context),
  }))
}
