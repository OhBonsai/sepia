import { join } from 'node:path'

// 纪律 20：**Sepia 自有文件的落盘路径一律由本文件派生（`~/.sepia` 之下）。**
//
// 架构 §4.5 曾写成 `~/.config/sepia/config.json`，与 §2.2、§2.3 的目录树、T-25 与
// 纪律 20 四处冲突——而 `~/.config` 正是被点名禁止的 XDG 路径。已按 120 §1.1 问题七
// 裁定以 `~/.sepia/` 为准，§4.5 判为笔误（回流已记）。
//
// **本文件是 XDG 名字在产品代码里的唯一住址**（150 §1.4 条目 0 的重述）。同样的模式
// 已在纪律 3（色值只住 theme.css）与纪律 8（fs 写只住 fsio.ts）上用过：把危险符号
// 圈进一个文件，规则就退化成一句"别处不许出现"，不必再逐处判断意图。
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

/**
 * 引擎子进程的路径隔离（架构 §4.1）：四个 XDG 根与 HOME 全部指进 `~/.sepia/engine/`。
 *
 * 住在这里而不是 supervisor 里，是纪律 20 重述的直接后果——这几个名字**指向哪**
 * 才是纪律关心的事，而"指向 Sepia 自有根"只有在派生它们的地方才看得出来。
 * 放在调用点，检查就只能看见四个 XDG 字面量，然后逼出四条"这其实是合规"的豁免。
 */
export function engineIsolationEnv(paths: SepiaPaths): Record<string, string> {
  const root = paths.engineHome
  return {
    HOME: join(root, 'home'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_DATA_HOME: join(root, 'data'),
    XDG_STATE_HOME: join(root, 'state'),
    XDG_CACHE_HOME: join(root, 'cache'),
  }
}
