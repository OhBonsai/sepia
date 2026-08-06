import { execFile } from 'node:child_process'
import { isAbsolute, relative } from 'node:path'
import { promisify } from 'node:util'

import { commitMessage, type CommitReason } from '@sepia/core'

// GitService（架构 §4.2 commit 时间线）。**一条队列串行化一切 git 操作**——
// git 用 `.git/index.lock` 做互斥，两个 commit 撞上时后一个直接失败退出，
// 而我们的触发源有三个（静默、定时、markup 成对），撞车是必然不是可能。
//
// 三条形态决定：
//   1. **系统 git CLI 子进程**，不引 isomorphic-git（160 §1.1 三：零新依赖、无原生模块；
//      book 本来就是 git repo，用户自己的 git 才是真相）。
//   2. **commit message 固定，永不调模型**（架构 §4.2）——这些 commit 的读者是徽章与
//      还白链路，不是人类审阅者。
//   3. **失败不打扰**：commit 全异步，失败只留痕（⌘⇧I 的数据先落着，浮层 UI 归 Stage 7）。
//      纸的可写性与 git 无关——不变量 1 在这里同样成立。

const run = promisify(execFile)

/** git 子进程的超时。卡住的 git（比如等凭据输入）不许拖住队列。 */
const GIT_TIMEOUT_MS = 15_000

export interface GitEnv {
  /** 注入用（测试）。默认真的跑 `git`。 */
  exec?: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>
}

export interface CommitOutcome {
  ok: boolean
  /** 没东西可提交（内容没变）——**不是失败**，是最常见的正常结果。 */
  skipped?: boolean
  reason?: string
}

/**
 * git 调用的统一出口。
 *
 * `-c` 显式覆盖三处，把用户环境的差异挡在外面（§1.8 风险 2）：
 *   · `core.hooksPath=/dev/null` + `--no-verify`：**用户的 hook 不执行**——
 *     自动保存触发的 commit 去跑用户的 pre-commit（lint、测试、格式化）是灾难：
 *     慢、可能改文件、可能失败，而用户根本没主动提交。
 *   · `commit.gpgsign=false`：签名要密码，自动 commit 卡在那儿就等于挂死。
 *   · `core.quotepath=false`：中文路径不被转义成 \xxx，trailer 里存的才是真路径。
 */
function gitArgs(args: string[]): string[] {
  return [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.quotepath=false',
    ...args,
  ]
}

async function realExec(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const result = await run('git', gitArgs(args), {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    // 环境要干净：用户的 GIT_* 变量（比如 GIT_INDEX_FILE）能把我们的 commit 写到别处
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 8 * 1024 * 1024,
  })
  return { stdout: String(result.stdout), stderr: String(result.stderr) }
}

export interface GitService {
  /** 这个目录是不是一个能用的 git repo。结果缓存——每次 commit 都探一次是白花钱。 */
  available(): Promise<boolean>
  /** repo 根（`rev-parse --show-toplevel`）。不是 repo 时为 null。 */
  toplevel(): Promise<string | null>
  /**
   * 提交一次。内容没变则 `skipped`。**永远不抛**——失败收敛成 outcome。
   *
   * `page` 传**绝对路径**，内部换算成相对 repo 根的路径再写进 trailer——
   * 绝对路径写进 commit 会把用户的家目录名字留在 git 历史里，而且换台机器就对不上了。
   */
  commit(reason: CommitReason, options?: { page?: string }): Promise<CommitOutcome>
  /**
   * markup 成对提交的 API（a 期**只建不接**，160 §1.2）。
   * b 期把它接到落笔链上：落笔前 `premarkup`、落笔后 `markup`。
   */
  commitPair(before: CommitReason, after: CommitReason, options?: { page?: string }): Promise<CommitOutcome[]>
  /** 最近一次失败（⌘⇧I 留痕的数据面，Stage 7 才有 UI）。 */
  lastFailure(): { at: number; reason: string } | null
}

export function createGitService(root: string, env: GitEnv = {}): GitService {
  const exec = env.exec ?? realExec
  let availability: Promise<boolean> | null = null
  let topPromise: Promise<string | null> | null = null
  let failure: { at: number; reason: string } | null = null

  // **队列就是这个 promise 链**：每个操作接在前一个后面，天然串行，不需要锁。
  // 它同时也是 §1.5 #1 那条检查盯的东西（去掉它 → 并发 commit 撞 index.lock）。
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task)
    // 队列本身不许因为某次失败而断掉——吞掉结果，只保留"排队"这件事
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const probe = async (): Promise<boolean> => {
    try {
      const { stdout } = await exec(['rev-parse', '--is-inside-work-tree'], root)
      return stdout.trim() === 'true'
    } catch {
      // 没装 git / 不是 repo / 目录不存在——都是同一件事：**没有版本，只有纸**。
      // 这是优雅降级，不是错误，所以不记 failure（否则纸角会为一件正常的事常亮）。
      return false
    }
  }

  const probeTop = async (): Promise<string | null> => {
    try {
      const { stdout } = await exec(['rev-parse', '--show-toplevel'], root)
      const value = stdout.trim()
      return value === '' ? null : value
    } catch {
      return null
    }
  }

  return {
    available() {
      availability ??= probe()
      return availability
    },

    toplevel() {
      topPromise ??= probeTop()
      return topPromise
    },

    async commit(reason, options = {}) {
      if (!(await this.available())) return { ok: true, skipped: true, reason: 'not a git repo' }
      return enqueue(async () => {
        try {
          // 只提交 book 内的改动。`--` 之后不带 pathspec = 全部，含用户自己的改动——
          // 这是有意的：book 是用户的 repo，我们替他保存的是**这一刻的整篇纸面**。
          await exec(['add', '-A'], root)
          // 有没有东西可提交。**不看这一步就会产生空 commit**，一天下来几百个
          // （§1.5 #3 盯的正是它）。`--cached` 比 `git status` 便宜且没有输出解析问题。
          try {
            await exec(['diff', '--cached', '--quiet'], root)
            return { ok: true, skipped: true } // 退出码 0 = 无差异
          } catch {
            // 退出码 1 = 有差异，继续提交
          }
          // trailer 里的 page 走**相对 repo 根**的路径（绝对路径会把家目录名字留在
          // git 历史里，换台机器还对不上）。算不出根就退回原样，不因为一个 trailer 而不提交。
          // 只把**绝对路径**换算成相对；传进来就是相对的（单测那样）说明调用方已经
          // 表达了"相对 repo 根"，再 relative 一次会拿 cwd 去解析它，得到一串 `../../..`。
          const top = await this.toplevel()
          const page =
            options.page === undefined || !isAbsolute(options.page) || top === null
              ? options.page
              : relative(top, options.page) || options.page
          const message = commitMessage(reason, page === undefined ? {} : { page })
          await exec(['commit', '--no-verify', '--no-gpg-sign', '-m', message], root)
          return { ok: true }
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error)
          failure = { at: Date.now(), reason: text }
          return { ok: false, reason: text }
        }
      })
    },

    async commitPair(before, after, options = {}) {
      const first = await this.commit(before, options)
      const second = await this.commit(after, options)
      return [first, second]
    },

    lastFailure() {
      return failure
    },
  }
}
