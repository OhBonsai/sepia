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
  /** 已知 book 列表（190 P2 / H1 多 book）。**是状态不是设置**，与 session 同族。 */
  workspaces: string
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
    workspaces: join(home, 'workspaces.json'),
  }
}

/**
 * 引擎子进程的路径隔离（架构 §4.1）：四个 XDG 根与 HOME 全部指进 `~/.sepia/engine/`。
 *
 * 住在这里而不是 supervisor 里，是纪律 20 重述的直接后果——这几个名字**指向哪**
 * 才是纪律关心的事，而"指向 Sepia 自有根"只有在派生它们的地方才看得出来。
 * 放在调用点，检查就只能看见四个 XDG 字面量，然后逼出四条"这其实是合规"的豁免。
 *
 * **重定向管不住向上扫描**（a4 真引擎实测，Stage 3 补账）：引擎对非 git 目录把
 * worktree 判成 `/`，skill / 工程级配置 / AGENTS.md 的发现全部**从 book 目录一路
 * 向上走到根**——途经真实的 `~/`，`~/.claude/skills`、`~/.agents/skills` 就这样
 * 被读了进来（日志证据：duplicate skill dws 同时命中两处）。这条路不经 `$HOME`，
 * 环境变量重定向拦不到，只能用引擎自己的三个禁用开关整条关掉：
 *   · EXTERNAL_SKILLS —— `.claude`/`.agents` 技能扫描（全局 + 向上两条都关）
 *   · CLAUDE_CODE —— `CLAUDE.md` 注入 system prompt（同为 claude 兼容面）
 *   · PROJECT_CONFIG —— 工程级 opencode.json(c) / `.opencode/` / AGENTS.md 向上发现；
 *     不关它，book 或其任一祖先目录里的 opencode 配置能**覆盖**注入的 deny（工程级
 *     在合并序里晚于全局）
 * 架构 §4.1 的措辞是「与用户 opencode 配置完全无关」——这三个开关是它的另一半。
 */
export function engineIsolationEnv(paths: SepiaPaths): Record<string, string> {
  const root = paths.engineHome
  return {
    HOME: join(root, 'home'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_DATA_HOME: join(root, 'data'),
    XDG_STATE_HOME: join(root, 'state'),
    XDG_CACHE_HOME: join(root, 'cache'),
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  }
}
