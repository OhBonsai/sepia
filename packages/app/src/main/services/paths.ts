import { join } from 'node:path'

// 纪律 20：**应用自有文件只写 `~/.sepia`，不散落 XDG。**
//
// 架构 §4.5 曾写成 `~/.config/sepia/config.json`，与 §2.2、§2.3 的目录树、T-25 与
// 纪律 20 四处冲突——而 `~/.config` 正是被点名禁止的 XDG 路径。已按 120 §1.1 问题七
// 裁定以 `~/.sepia/` 为准，§4.5 判为笔误（回流已记）。
//
// 刻意做成"传 home 进来"而不是直接读 `os.homedir()`：这样单测能指到临时目录，
// 不必往真实的 `~/.sepia` 里写东西，也不必为此新增一个环境变量。

export interface SepiaPaths {
  home: string
  config: string
  session: string
  logs: string
  /** 引擎的隔离根：四个 XDG 根全部指到它下面（架构 §4.1），引擎全部路径由此派生。 */
  engineHome: string
  /** API key 密文（safeStorage 加密后的信封 json）。引擎侧零落盘，密文只在这里。 */
  credentials: string
}

export function sepiaPaths(userHome: string): SepiaPaths {
  const home = join(userHome, '.sepia')
  return {
    home,
    config: join(home, 'config.json'),
    session: join(home, 'session.json'),
    logs: join(home, 'logs'),
    engineHome: join(home, 'engine'),
    credentials: join(home, 'credentials.json'),
  }
}
