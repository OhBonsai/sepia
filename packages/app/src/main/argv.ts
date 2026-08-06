import { isAbsolute, resolve } from 'node:path'

// argv 转交的纯函数部分：从一串命令行参数里挑出 .md 路径。
// 单实例锁抢不到时，第二个实例把自己的 argv 交给已运行实例，由这里解析。
// 「拿到路径之后做什么」是 Stage 1 的事（001 §3.2），此处只负责识别与排队。

const MARKDOWN = /\.mdx?$/i

/**
 * @param argv 原始 process.argv（含 execPath 与可能的 electron 开关）
 * @param cwd  该 argv 所属实例的工作目录——相对路径按它解析，不按当前进程的
 */
export function markdownPathsFrom(argv: readonly string[], cwd: string): string[] {
  const out: string[] = []
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue
    if (!MARKDOWN.test(arg)) continue
    out.push(isAbsolute(arg) ? arg : resolve(cwd, arg))
  }
  return out
}

const pending: string[] = []

export function queuePaths(paths: readonly string[]): void {
  pending.push(...paths)
}

/**
 * 取走队列里的下一个路径。**唯一的消费者是 `session/get`**（Stage 6a）——
 * renderer 启动时问一次 session，队列里的 page 在那里汇入。
 *
 * 一次只取一个：三入口都是「一个路径一扇窗」（T-29 的 VS Code 模型），
 * 一把取空会让第二个路径静默丢失。
 */
export function takeNextPendingPath(): string | null {
  return pending.shift() ?? null
}

/**
 * 看一眼队列但不消费。smoke 的日志行用它。
 * 曾经那行用的是 `take`：日志把队列吃掉，于是 argv 传进来的 page 永远打不开——
 * 而且只在开了 smoke 开关时才这样，正常启动看不出来。
 */
export function peekPendingPaths(): readonly string[] {
  return pending
}
