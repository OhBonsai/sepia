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

/** 取走并清空待打开队列。Stage 1 的 page 打开流程从这里领活。 */
export function takePendingPaths(): string[] {
  return pending.splice(0, pending.length)
}
