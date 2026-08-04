---
stage: 0
title: 骨架
status: in-progress
dod: 三平台包可下载、能开空窗口；turbo 能按包并行跑 typecheck 与测试
checks_added: 13
checks_reverse_verified: 11
exemptions: 0
disputes: 0
measured:
  check_full_s: 4.8
  check_fast_s: 3.0
  install_cold_s: 0.85
  build_three_s: 3.4
  bundle_mb_dmg_arm64: 115
  bundle_mb_dmg_x64: 117
  bundle_mb_appimage: 123
  bundle_mb_deb: 95.1
  bundle_mb_exe: 95.6
  reverse_coverage: 0.85
  dead_checks: 0
---

# 110 · Stage 0：骨架

> 模板：[`003_stage_playbook.md`](./003_stage_playbook.md) §1 ｜ 上游：[`001_boot.md`](./001_boot.md) §7、[`002_boot_harness.md`](./002_boot_harness.md) §7、[`../design/sepia-architecture.md`](../design/sepia-architecture.md)

> **写作时序说明（给下一个 session）**：本文档是**补写**的——仓库里已经存在一版 Stage 0 的实现（`packages/`、`scripts/`、`.github/workflows/`，见 commit `a2aabad` 及其后的四笔 CI 修复）。先把「本来应该怎么规划」写清楚，再拿它去对照实现。
>
> **对账已完成**，结果在文末〔附录 A〕。§1.5 / §1.7 / frontmatter 已按实况回填。
>
> **`status` 是 `in-progress` 而不是 `done`**：DoD 三条（三平台包可下载、能开空窗口、turbo 按包并行）**全部达成**，但对账揪出一条**确认空转的检查**（`check:deps` 实际侧，见 §1.5「空转的检查」）。它的处置权保留给人，未决之前这个 stage 不算收尾。

---

## 1.1 前置

### 上一 stage 的 DoD

Stage 0 是第一个 stage，没有上游 DoD 可贴。**改为贴地基条件**：

- [ ] `bun --version` ≥ 1.3，`git --version` 可用
- [ ] 仓库有 `origin` 远端，且 CI 能跑（公开仓库或已配好 runner）
- [ ] 架构文档 §1 约束、§5 纪律已定稿（v1，2026-08-03）

### 三个必须先裁的问题

#### 问题 1 · Stage 0 要不要接 vendor/opencode、要不要建 `build-engine.ts` 与 `check:artifacts`？

**结论：都不做。vendor 相关的一切推到 Stage 3。但 `vendor/` 的边界守卫必须现在就立。**

四条理由：

1. **不变量 1 的工程体现就是"前三个 stage 不依赖引擎"**（001 §7 结尾原话）。Stage 0 是地基，把最不稳定的外部依赖（架构 §8 第一条风险就是"上游 opencode server 正在大改"）塞进地基，等于让地基跟着上游抖。
2. **`check:artifacts` 现在抓不到任何东西**。它断言的是「`out/main/chunks/*.wasm` 四份齐全、产物内 `.node` 数量为零」——Stage 0 根本没有 wasm 也没有 native 模块，这条检查恒绿。002 §6.2 写死了：**抓不到真实违规的检查是净负担，它只会在无关改动时变红，训练人去忽略红色**。
3. **`build-engine.ts` 挂在 `predev` / `prebuild` 上**（001 §4）。一旦装上，Stage 0/1/2 每次 `bun run dev` 都要先过一遍 vendor 构建。Stage 1 的活是调「冷启动 < 1s」，那是个需要高频重启的活，前置一个几十秒的 vendor 构建会直接毁掉这个 stage 的迭代节奏。
4. **反过来有一件事必须现在做**：纪律 16「`vendor/` 排除在 workspace glob 之外」得**在 vendor 还不存在的时候就守住**。等它存在了再补，`bun.lock` 和 `node_modules` 可能已经被污染，那时是排查问题而不是预防问题。见问题 3。

**登记给 Stage 3 的入口条件**（不写在这里就会被忘掉）：vendor submodule 与锁定 tag 的选取、`scripts/build-engine.ts`、`scripts/models-dev-snapshot.json`、`check:artifacts`、架构 §6 核对清单的 ①②④⑤⑥。

#### 问题 2 · Stage 0 的 preload 暴露面近乎为空，`check:bridge` 的快照怎么办？

**结论：暴露一个最小但真实的只读面，快照逐项写死。不留空快照。**

具体是四项：`api.app.platform`、`api.app.versions.{chrome,electron,node}`。全部只读，**没有任何 IPC 通道、没有任何写能力、不构成任何架构承诺**，Stage 1 想删也没有代价。

为什么不用空快照（`surface: []`）配空 preload：

- 空快照能通过，但那意味着 `check:bridge` 的三条核心逻辑——**AST 定位 `exposeInMainWorld`、嵌套对象展平成点分路径、与快照做 diff**——在整个 Stage 0 里一次都没被真正执行过。等 Stage 3 第一次往桥上加真 API 时才发现解析器写错了，那时它不是守卫，是障碍；而 002 §5.1 已经点名这种情形：**"AI 倾向于相信工具而不相信自己"，它会把正确的代码改坏，只为让红变绿**。
- 002 §6.2 要求「新增检查必须能指出它抓到过什么」。要证明它抓得到，就得能做反向验证（往 preload 偷加一个 key → 必须 FAIL）。**反向验证需要一个非空的基线才有意义**——从空到非空和从四项到五项，走的不是同一条代码路径（前者可能撞上"找不到 exposeInMainWorld"的分支）。

快照落 `scripts/bridge-snapshot.json`，四项全列，**不许用通配或前缀匹配**——通配等于白名单失效。

#### 问题 3 · bun 会不会走进 `vendor/` 的嵌套 workspace？怎么实证而不是假设？

**结论：不假设。分三重实证，其中两重现在就能跑，第三重必须显式登记为 Stage 3 的入口条件。**

001 §1 原话就是「**首次搭建时须验证** bun 不会误走进 vendor 的嵌套 workspace」——它被点名要求实证，所以"vendor 在 packages/ 之外，天然不被匹配"这句话本身不算数，得跑出来。

| 重 | 手段 | 何时能跑 |
|---|---|---|
| 一 | **假想路径探测**：把 `vendor`、`vendor/opencode`、`vendor/opencode/package.json`、`vendor/opencode/packages/tui`、`vendor/anything/nested/deep/pkg` 逐条喂给 `package.json` 里的每一条 workspace glob，任一命中即 FAIL | **现在**（不依赖 vendor 存在） |
| 二 | **磁盘真实展开**：把每条 glob 在仓库根实际展开，断言结果集里没有 `vendor` 开头的路径；并断言 `packages/vendor` 不存在（挪进去就绕过了第一重） | **现在** |
| 三 | **真装一次**：vendor submodule 就位后跑一次干净的 `bun install`，断言 `bun pm ls` 的输出里不出现 vendor 内的包名，且 `bun.lock` 的 diff 不含 vendor 条目 | **Stage 3，做不了就是做不了** |

第一重是关键，因为它**在图还没长歪的时候就守住了**：它拦的不是"vendor 现在被匹配了"，而是"将来有人把 glob 改成 `*` 或 `vendor/*`"。第三重 Stage 0 客观做不到（没有 vendor 可装），**所以必须写进 Stage 3 的 DoD，而不是含糊地说"已经守住了"**——这正是 002 §5.1「长程任务的中间态」最容易出错的地方：把"这一步做不了"说成"这件事已经好了"。

### 架构 §8 未决清单的逐条裁决

| 未决项 | 裁决 |
|---|---|
| `AGENTS.md` 内容 | **不影响 Stage 0**（Stage 3 引擎接入时才需要） |
| markup system prompt 文案 | **不影响 Stage 0**（Stage 4） |
| 阅读模式的正文抽取实现 | **不影响 Stage 0**（外链只做系统浏览器打开，且那是 Stage 7） |
| 动词按语言分组 | **不影响 Stage 0** |
| 锚点模糊匹配的参数值 | **不影响 Stage 0**（Stage 5，且需真实文章标定） |
| 「上下文范围」默认值 | **不影响 Stage 0**（Stage 4） |
| `sepia-prototype-features.md` 补号 | **不影响 Stage 0 的代码**，但它是文档债，与本 stage 无先后关系 |

架构 §8 **风险表**里真正落在本 stage 的只有一条：

| 风险 | 与 Stage 0 的关系 | 裁决 |
|---|---|---|
| **win / linux 无日常自用覆盖** | 缓解手段写的是「CI smoke 三平台跑，发布前手测清单」——**这条缓解手段本身就是 Stage 0 的 DoD** | **本 stage 依赖，必须裁**：Stage 0 的 CI 至少要出三平台产物并在 Linux 上跑通一次"开窗口再退出"的 smoke。macOS 是日常自用平台不必额外 smoke；**Windows 的运行时 smoke 本 stage 不做**（只保证能打出包），推到 Stage 1 有真界面时再补，否则 smoke 的断言只能是"进程没崩"，价值太低 |

其余风险（opencode 上游大改、PTY 桩、wasm 漏复制、CM6 与 IME、B 类块级排版、锚点误匹配、用户凭据）**均不影响 Stage 0**，分属 Stage 2/3/5。

---

## 1.2 范围

### 做什么

**包与工作区**

- [ ] `bun workspaces` + `catalog` + `turbo`，`workspaces.packages` 只含 `packages/*`
- [ ] 五个包立起来：`core` / `editor` / `agent` / `ui` / `app`，每包有 `package.json`、`tsconfig.json`、`src/index.ts`、`test/`
- [ ] 跨包依赖一律 `workspace:*`，第三方版本一律走根 `catalog`
- [ ] 包依赖声明**恰好等于** 001 §2.2 的图，不多一条不少一条
- [ ] `turbo` 能按包并行跑 `typecheck` 与 `test`，且遵守包间依赖顺序

**Electron 装配**

- [ ] `electron-vite` 三段配置（main / preload / renderer），三段都能构建出产物
- [ ] 能打开一个**空窗口**：带 `backgroundColor`、跟随系统深浅色、无白闪
- [ ] 单实例锁：抢不到锁的实例退出
- [ ] argv 转交：第二个实例把 argv 交给已运行实例，`.md` 路径进待打开队列
- [ ] macOS `open-file` 事件与 argv 走同一条队列
- [ ] 多窗口注册表：注册 / 注销 / 查找 / 计数，且**不依赖 Electron 运行时**（可单测）

**harness**（详见 §1.4）

- [ ] `bun run check:fast`（lint + typecheck）与 `bun run check`（全量）两级
- [ ] `check` 的最后一行只会是 `PASS` 或 `FAIL: <纪律号>（<纪律>）— <位置>`
- [ ] `check:deps`、`check:bridge`、`check:workspace`、`check:marks`
- [ ] 三种记号：`harness-exempt` 计数、`harness-dispute` 阻塞、`SEPIA_HARNESS_BYPASS` 留痕且 CI 恒忽略
- [ ] 仓库根 `CLAUDE.md` 初版，按 002 §4.2 骨架，含卡住协议与三种记号

**CI**

- [ ] `ci` workflow：push / PR 触发，跑 `bun run check`
- [ ] `ci` 里跑一次 Linux 上的"开窗口再退出"smoke
- [ ] `build` workflow：出三平台未签名安装包，可下载

### 明确不做什么

**属于 Stage 1 的**（一件都不碰）：

- CM6 宿主与任何编辑器行为
- 打开 / 保存单文件、原子写、`fsio.ts`
- `session.json`（tab / 光标 / 滚动）与 `config.json` 的读写与 merge
- 主题变量表、`theme.ts`、首帧注入、`nativeTheme` 订阅
- 启动 t0–t5 打点与打点断言
- 002 §2.1 的**类型层五条**（`CopyKey`、`BookDirectory`、system prompt 常量、`ThemeVar`、落笔 CAS）

**最容易顺手带出、必须刹住的**（按"手一滑就会做"的概率排序）：

| 会顺手带出的东西 | 为什么手会滑 | 刹车 |
|---|---|---|
| **主题系统** | 窗口一写 `backgroundColor` 就想接 `nativeTheme`，接了就想建 CSS 变量表 | Stage 0 只允许一个 `shouldUseDarkColors ? 深 : 浅` 的二元判断写死在 `windows/create.ts`，**不建 theme service、不建变量表** |
| **IPC handler** | preload 一建起来就想加第一个通道 | Stage 0 的桥上**零 IPC 通道**，只有只读环境事实 |
| **renderer shell** | React 挂上了就想搭路由、状态、布局 | Stage 0 的 shell 是一个不渲染任何内容的空 div |
| **Tailwind / shadcn** | `ui` 包一建就想装组件库 | Stage 0 的 `ui` 是空导出，**一个组件都不做**；样式只有一个让页面不闪白的最小 css |
| **zustand stores** | 建了 `renderer/` 就想按 domain 铺 store | 不建 `stores/` 目录 |
| **文件树 / 最近的 page** | 有窗口了就想放点东西进去 | Stage 6 |
| **`check:artifacts` / `check:theme` / `check:patches`** | harness 一动手就想把 002 §2.4 那张表做全 | 见问题 1 与 §1.4 |
| **图标、签名、公证、自动更新** | 打包一跑通就想"顺手美化一下" | 架构 §1.3 已列为非目标；Day-1 不签名 |
| **`/harness` 看板** | 003 §4.5 写着「期一：现在，与 Stage 0 一起」 | **本 stage 不做**，理由见 §1.9 第 3 条 |

---

## 1.3 代码结构与功能深度

### 落在哪些包

| 包 | Stage 0 新增 | 深度 |
|---|---|---|
| `core` | `src/index.ts`（空导出）、`test/` | **只到"包存在且能被 import"**。`types/` `copy/` `anchor/` `config/` 四个目录 Stage 0 一个都不建——空目录是噪音，等有内容再建 |
| `editor` | 同上 | 同上 |
| `agent` | 同上 | 同上 |
| `ui` | 同上 | 同上 |
| `app` | `electron.vite.config.ts`、`electron-builder.yml`、`src/main/{index,argv}.ts`、`src/main/windows/{create,registry}.ts`、`src/preload/index.ts`、`src/renderer/{index.html,index.css,main.tsx,shell/App.tsx}`、`test/main/` | 见下 |

`app` 内部**刻意不建**的目录：`main/ipc/`、`main/services/`、`main/engine/`、`renderer/editor/`、`renderer/markup/`、`renderer/threads/`、`renderer/home/`、`renderer/files/`、`renderer/overlays/`、`renderer/commands/`、`renderer/services/`、`renderer/stores/`。它们都在 001 §2.1 的终态结构里，但 Stage 0 一个都不需要。

### 与 001 §2.2 依赖图的逐条对照

| 边 | Stage 0 是否声明 | 说明 |
|---|---|---|
| `core → editor` | 是 | `editor` 的 `dependencies` 含 `@sepia/core` |
| `core → agent` | 是 | 同上 |
| `core → app` | 是 | 001 §2.2 的 ASCII 是层次图，这条边被层次蕴含且「包内」明确要求（`main/services → core`、`renderer 组件 → core/copy`）。**Stage 0 已回写 001 §2.2 显式登记** |
| `editor → app` | 是 | |
| `agent → app` | 是 | |
| `ui → app` | 是 | |
| `editor ↮ ui` | **刻意不连** | CM6 主题只写 `var(...)`，共享变量名不共享代码（T-20） |
| `editor ↮ agent` | **刻意不连** | widget 要用 AI 时能力上提到 `app` 装配 |
| `ui ↮ core` | **刻意不连** | `ui` 是叶子、不知道领域，连 `core` 的类型与文案都不该知道（001 §1、§2.1） |

这张图的**机器可读副本**落在 `scripts/dep-graph.json`，`check:deps` 从它派生规则。**改图先改那份 json**，改 json 会被 diff 看见（002 §2.2）。

### 功能深度的取舍（写死，不许加码）

| 能力 | Stage 0 做到哪一档就停 |
|---|---|
| 窗口 | **能开、不闪白、跟随系统深浅色**。窗口状态记忆（位置 / 尺寸）不做 |
| 单实例 + argv | **锁生效 + 路径进队列**。队列的**消费者不做**（Stage 1 才有 page 可开） |
| 多窗口注册表 | **增删查数四个操作**。窗口间通信、焦点管理、per-window 状态不做 |
| preload | **四项只读环境事实**。零 IPC 通道 |
| renderer | **能挂上 React 并渲染一个空 div**。路由 / 布局 / 主题挂载 / loading 态不做 |
| 打包 | **三平台未签名安装包能出、能下载**。图标、签名、公证、自动更新、产物自检不做 |
| smoke | **Linux 上开窗口再退出**。Windows 运行时 smoke 不做（见 §1.1 风险裁决） |

### 新增的对外暴露面（预先声明）

003 §1.3 要求这一节**必须预先声明**，事后才发现就是架构侵蚀。Stage 0 三类都会新增：

| 类别 | 内容 |
|---|---|
| **preload 白名单** | 4 项：`api.app.platform`、`api.app.versions.{chrome,electron,node}`。全部只读，零 IPC 通道 |
| **包依赖** | 6 条内部边（见上表）；第三方走 catalog：electron / electron-vite / electron-builder / vite / @vitejs/plugin-react / @swc/core / react / react-dom / typescript / vitest / @types/* |
| **配置字段** | **零**。`~/.sepia/config.json` 是 Stage 1。但新增两个**环境变量**：`SEPIA_HARNESS_BYPASS`（002 §5.2 的第三种记号）与 `SEPIA_SMOKE_EXIT`（无人值守验收用，生产路径不生效） |

---

## 1.4 harness 增量

阶梯层次见 002 §1（1 类型 / 2 包边界 / 3 lint / 4 专项脚本 / 5 单测 / 6 人工），硬度见 002 §5.3。

| # | 检查 | 守什么 | 阶梯层 | 硬度 |
|---|---|---|---|---|
| 1 | **包依赖声明** | `core` 不声明 `electron` 就 import 不到——编译期物理约束 | **2 包边界** | 纪律级 |
| 2 | `tsconfig` 的 `types` 不含 `node` | `core`/`editor`/`agent`/`ui` 拿不到 node 全局类型，写 `process` 当场红 | **1 类型** | 纪律级 |
| 3 | `check:deps` · 声明侧 | 各包 `package.json` 的 `@sepia/*` 边**恰好等于** `dep-graph.json` | 4 专项脚本 | 纪律级 |
| 4 | `check:deps` · 实际侧 | 真实 import 图不越界（dependency-cruiser），含三条刻意不连线、无环、main ↮ renderer | 4 专项脚本 | 纪律级 |
| 5 | `check:bridge` | preload 暴露面与快照逐项一致（TS AST，不用正则） | 4 专项脚本 | 纪律级 **①** |
| 6 | `check:workspace` | `vendor/` 不被任何 workspace glob 匹配（假想路径 + 磁盘展开双重） | 4 专项脚本 | 纪律级 |
| 7 | `check:marks` | `harness-exempt` 计数；`harness-dispute` > 0 即红 | 4 专项脚本 | 纪律级 **②** |
| 8 | lint · 结构 3 | `core`/`editor`/`agent`/`ui` 的 `src` 不得 import `electron` 或 Node 内建 | 3 lint | 纪律级 |
| 9 | lint · 纪律 1 | renderer 组件不得碰 `window.api` / preload / electron | 3 lint | 纪律级 |
| 10 | lint · 纪律 3 | 组件与 CM6 扩展不得出现字面色值 | 3 lint | 纪律级 |
| 11 | lint · 纪律 18 | 日志不得整体转储 `process.env` | 3 lint | 纪律级 |
| 12 | `SEPIA_HARNESS_BYPASS` | 本地大字警告 + 落盘留痕；**CI 恒忽略此变量** | 4 专项脚本 | 约定级 |
| 13 | `CLAUDE.md` 初版 | 导航与前置约束，**不是检查**（002 §4.1）——不计入 `checks_added` | 6 人工 | 约定级 |
| 14 | **oxlint** | 通用正确性（`correctness`/`suspicious` 为 error、`perf` 为 warn，外加 `no-console`/`eqeqeq`/`no-var`/`prefer-const`）。不守某条具体纪律，但它是唯一能抓语法与低级错误的一层 | 3 lint | 约定级 |

**①** `check:bridge` 本体是纪律级；但**"preload 不得暴露任何绕过落笔 CAS 或给 Agent 开写路径的通道"这一子条是不变量级**（不变量 3、4）。Stage 0 桥上没有任何通道，所以这一子条现在无处可施；**Stage 3 桥上出现第一个引擎通道的当天，必须把它单列成一条不变量级检查**。写在这里免得那天忘了。

**②** `harness-dispute` 变红这件事本身是流程纪律，不是代码纪律——它的作用是把"我觉得这条纪律不对"从可自行处置变成必须升级到人（002 §5.2）。

### 相对 002 §7 的增减

002 §7 给 Stage 0 排的是：包边界、两级 `check`、`check:deps`、`check:bridge`、三种处置记号、`CLAUDE.md` 初版。**主张增三项、明确不增三项**：

**增 · `check:workspace`**（002 §2.4 有定义，§7 没排进 Stage 0）
理由：它守的纪律 16 有强烈的时间性——**必须在 `vendor/` 落地之前就位**。等 Stage 3 引 vendor 时再加，第一次 `bun install` 已经跑过了，那时是排查而不是预防。这是"晚一个 stage 就失效"的少数几条之一。

**增 · `check:marks`**（002 §5.2 定义了三种记号，但没说谁来统计）
理由：002 §6.3 把"豁免总数"称作**比任何单条检查都更能说明健康状况**的指标，003 §3.3 又把它列为债务面板的第一项。**没有统计者的指标等于不存在**。而 `harness-dispute` 若不阻塞，它和 `harness-exempt` 就没有实质区别，002 §5.2 那个"关键的第二种"就废了。

**增 · lint 四条**（结构 3 / 纪律 1 / 纪律 3 / 纪律 18；002 §7 把字面色值排在 Stage 2）
理由：**规则晚于用法就等于没有**。Stage 1 就要建主题变量表和第一批组件，字面色值的规则若排在 Stage 2，等它上线时已经有一整个 stage 的代码要回头改。结构 3 更直接——它是 `check` 里唯一能在 `typecheck` 之前给出带编号失败信息的手段（`lint` 是第一步），否则 `core` 里 import electron 只会得到一句 `Cannot find module 'electron'`，不指向任何纪律号。

**不增 · `check:artifacts`**：Stage 0 没有 wasm、没有 native 模块，恒绿。归 Stage 3。
**不增 · `check:patches`**：Stage 0 没有 `patches/opencode/`。归 Stage 3。
**不增 · `check:theme`**：Stage 0 没有色板、没有 Shiki、没有 CM6。归 Stage 2。

### 可以从 lint 升级到类型的（002 §2.1）

**Stage 0 一条都不做。** 002 §2.1 的五条（`CopyKey`、`BookDirectory`、system prompt 常量字面量联合、`ThemeVar`、落笔只接受 `{range, expectedText}`）全都需要 Stage 1+ 才存在的类型作为宿主——没有 `copy` 就没有 `CopyKey`，没有主题变量表就没有 `ThemeVar`。002 §7 也把它们排在 Stage 1，一致。

**留给 Stage 1 的一个二选一**：纪律 3（字面色值）在 Stage 0 由 lint 守。Stage 1 建主题变量表时若把它升级成 `ThemeVar` 类型，**必须同时删掉那条 lint 规则**——002 §6.1「一条纪律只用一种手段」，两头都留就是没人维护。

---

## 1.5 自动化验证

> 本节是**计划**。实测输出由后续 goal 回填，回填时同步更新 frontmatter 的 `checks_added` 与 `checks_reverse_verified`。

### 新增单测清单

| 包 | 用例 | 守什么 |
|---|---|---|
| `core` / `editor` / `agent` / `ui` | 各一条：模块可 import、无加载期副作用、导出面为空 | 证明工具链（workspace 链接 + `exports` 指向 `.ts` + vitest 解析）真的通了 |
| `app` | `markdownPathsFrom`：挑出 `.md`/`.mdx`、忽略 execPath 与开关、相对路径按**传入的 cwd** 解析、绝对路径原样 | argv 转交的纯函数部分。第二个实例的 cwd 不是当前进程的 cwd，这是最容易写错的一处 |
| `app` | 待打开队列：`take` 一次即清空 | 防同一路径被打开两次 |
| `app` | 多窗口注册表：登记 / 查找 / 注销后不出现在 `all()` / 同 id 重复登记不重复计数 | |

### 新增 smoke 清单

| smoke | 断言 | 跑在哪 |
|---|---|---|
| 开一个空窗口再退出 | 主进程打印 `window ready, registry=1` 且退出码 0 | 本地 + CI（Linux，`xvfb-run`） |
| 单实例锁 + argv 转交 | 第一个实例开窗后，第二个实例带 `.md` 启动 → 第二个静默退出、第一个 `registry` 由 1 变 2 且 `pending` 含该路径 | 本地（CI 暂不跑，见 §1.8） |

> Stage 0 的 smoke 用一个环境变量开关（`SEPIA_SMOKE_EXIT=N`：开满 N 个窗口后自退）而**不是 Playwright**。架构 §6 提到 Playwright `_electron`，那要等 Stage 1 有真界面、有可断言的 DOM 时再引——现在引进来，断言只能写"进程没崩"，不值一个依赖。**登记为 Stage 1 的决策点**。

### 新增检查的反向验证清单

002 §6.2：**抓不到真实违规的检查是净负担**。每条都要「故意违规 → 必须 FAIL → 撤销」并贴输出。

**九条计划内的，全部执行完毕，全部撤销，撤销后 `check` 恢复 `PASS`。**

- [x] ① `packages/core/src/index.ts` 里 `import 'electron'` → `check`
      `FAIL: 结构 3（core / editor / agent / ui 不得 import 进程侧代码）— packages/core/src/index.ts:8`
- [x] ② 组件里写 `color: '#fff'` → `check:fast`
      `FAIL: 纪律 3（组件与 CM6 扩展不得出现字面色值）— packages/app/src/renderer/shell/App.tsx:2`
- [x] ③ `packages/core/package.json` 里加一条 `@sepia/editor` → `check:deps`
      `FAIL: 结构 2（包依赖声明必须等于 001 §2.2 的图）— packages/core/package.json（dependencies.@sepia/editor）`
      **但跑全量 `check` 时 typecheck 先红，且不指纪律号**——见下「输出不指向纪律号的」第 1 条
- [x] ④ preload 里加一个 key 而不改快照 → `check`
      `FAIL: 纪律 2（preload 暴露面变更须经守卫比对）— packages/app/src/preload/index.ts（新增 api.app.arch）`
- [x] ⑤ `workspaces.packages` 改成 `["packages/*", "vendor/*"]` → `check`
      `FAIL: 纪律 16（vendor/ 不得被任何 workspace glob 匹配）— package.json（workspaces: "vendor/*"）`
      附带指出「这个 glob 会圈进 `vendor/opencode`」——**假想路径探测确实在工作**
- [x] ⑥ 写下 `// harness-dispute: 3 ...` → `check`
      `FAIL: harness-dispute（有人认为纪律本身有问题，AI 不得自行处置）— packages/core/src/index.ts:8`
- [x] ⑦ renderer 里 `import type { SepiaBridge } from '../../preload'` → `check:fast`
      `FAIL: 纪律 1（组件不得 import window.api、不得直接请求引擎）— packages/app/src/renderer/shell/App.tsx:1`
- [x] ⑧ `console.log(process.env)` → `check:fast`
      `FAIL: 纪律 18（日志不得整体转储 process.env）— packages/app/src/main/index.ts:63`
- [x] ⑨ `SEPIA_HARNESS_BYPASS=1 bun run check` → `BYPASS: 已跳过全部检查（记录于 .harness-bypass.log）`，留痕内容
      `2026-08-04T08:11:55.721Z	check	SEPIA_HARNESS_BYPASS=1`；
      `CI=1 SEPIA_HARNESS_BYPASS=1 bun run check` → 打印「CI 恒忽略该变量」后**照常全量跑到 `PASS`，且不留痕**

**三条计划外的补测**（九条都没碰到它们，而没被碰过的检查正是空转最可能藏身处）：

- [x] 补A · `packages/editor/src/index.ts` 里 `import '../../ui/src/index.ts'`（用相对路径横穿包边界）→ `check`
      **第一次跑：`PASS`，没有拦住** → 揪出空转，见下「空转的检查」
      **修复 `validate: true` 后重跑：**
      `FAIL: 结构 2（packages/editor 只许依赖 [core]）— packages/editor/src/index.ts → packages/ui/src/index.ts`（规则 `pkg-editor`）
- [x] 补B · `packages/core/src/index.ts` 里 `export const plat = process.platform`（不 import，只用全局）→ `check`
      拦住了，但**报错不指纪律号**——见下第 2 条。类型层守卫本身是活的：
      `error TS2591: Cannot find name 'process'. Do you need to install type definitions for node?`
- [x] 补D · `packages/agent/src/index.ts` 里 `import 'this-module-definitely-does-not-exist'` → `check`
      `FAIL: 结构 2（import 必须解析得到）— packages/agent/src/index.ts → this-module-definitely-does-not-exist`（规则 `not-to-unresolvable`）
      **补A 与补D 合起来才算数**：前者证明包边界规则在判，后者证明解析类规则在判。只验一条不足以说明 8 条规则都活了
- [ ] 补C · oxlint（§1.4 第 14 项）未做反向验证。**但它有真实战绩**：Stage 0 实施期间它抓到了 `scripts/check.mjs` 里一处未闭合的模板字符串（反引号开、单引号闭），那个文件当时还没被执行过。按 002 §6.2「新增检查必须能指出它抓到过什么」，这条已经自证，但**仍计入分母未验的一项**
- [ ] 包依赖声明的**包边界本身**（§1.4 第 1 项）未做反向验证。反向验证 ① 本想验它（`core` 里 `import 'electron'`），但 lint 的结构 3 在 `typecheck` 之前就拦住了，**编译期"import 不到"这层物理约束始终没被真正走过**。这是本次对账新发现的一处覆盖缺口

### `checks_added` 的口径

> **口径变过一次，别把覆盖率的下降读成退步。** 首次回填时 `checks_added` 用的是我临时列的 12 项；本次改为**以 §1.4 那张表为唯一分母**（14 行减去第 13 行 `CLAUDE.md`——它是导航不是检查）＝ **13**。分母变大了 1，同时新暴露出一项一直没验的（下表第 1 行），所以覆盖率从 0.92 降到 0.85。**期间没有任何一条检查变差，反而修好了一条空转的。**

| §1.4 # | 检查 | 反向验证 | 证据 |
|---|---|---|---|
| 1 | 包依赖声明（包边界本身） | **未验** | 见上，① 被 lint 抢先拦住，编译期"import 不到"这层没走过 |
| 2 | `tsconfig` 的 `types` 不含 `node` | ✓ | 补B，`TS2591` |
| 3 | `check:deps` 声明侧 | ✓ | ③ |
| 4 | `check:deps` 实际侧 | ✓ | 补A + 补D（两条，覆盖包边界类与解析类两种规则） |
| 5 | `check:bridge` | ✓ | ④ |
| 6 | `check:workspace` | ✓ | ⑤ |
| 7 | `check:marks` | ✓ | ⑥ |
| 8 | lint · 结构 3 | ✓ | ① |
| 9 | lint · 纪律 1 | ✓ | ⑦ |
| 10 | lint · 纪律 3 | ✓ | ② |
| 11 | lint · 纪律 18 | ✓ | ⑧ |
| 12 | `SEPIA_HARNESS_BYPASS` | ✓ | ⑨ |
| 14 | oxlint | **未验** | 有真实战绩自证，但没做过"故意违规"的反向验证 |

**11 / 13 ＝ 0.85。两项未验：第 1 项与第 14 项。**

### 空转的检查

> **状态：已修复并复验（2026-08-04）。** 修法是一行——`scripts/check-deps.mjs` 的 `cruise()` options 里加 `validate: true`。
> 复验证据见上面的补A 与补D：两条违规现在都能正确红，且报出规则名。
> 下面保留完整的排查记录，因为**失败模式比修法值钱**。

> 002 §6.2：**抓不到真实违规的检查是净负担——它只会在无关改动时变红，训练人去忽略红色。**
> 下面这条比"净负担"更糟：它不但抓不到，还每次都打印一行让人安心的话。

**`check:deps` 实际侧（dependency-cruiser 的全部 8 条规则）自写下来起就从未被求值过。**

| 项 | 内容 |
|---|---|
| 症状 | `editor` 用相对路径 `import '../../ui/src/index.ts'` 横穿到 `ui`，`check` 报 `PASS` |
| 排查 | dependency-cruiser **看得见**这条边（`packages/editor/src/index.ts → packages/ui/src/index.ts`，`resolved=true`），规则数也对（8 条），规则的 `from`/`to` 正则也对得上，但 `summary.violations.length === 0` |
| 根因 | `cruise()` 的 `options.validate` 默认 `false`。`types/options.d.mts:53` 原话：*"if true, will attempt to validate with the rules in ruleSet"*。`scripts/check-deps.mjs` 传了 `ruleSet` 却**没传 `validate: true`**，于是规则被静默忽略 |
| 实证 | 同一份配置、同一次违规，`validate:false → 违规数 0`；`validate:true → 违规数 1`，且正确报出 `pkg-editor : packages/editor/src/index.ts → packages/ui/src/index.ts` |
| 波及范围 | 8 条规则**全部**：`no-circular`、`pkg-core`、`pkg-editor`、`pkg-agent`、`pkg-ui`（含三条刻意不连线的守卫）、`main-not-to-renderer`、`renderer-not-to-main`（结构 4）、`not-to-unresolvable` |
| 为什么一直没被发现 | 三条反向验证都只碰到了**声明侧**（读 `package.json`），那部分是自己写的、工作正常。而 `check-deps.mjs` 每次还打印「实际侧：dependency-cruiser 扫过 21 个模块，8 条规则」——**这行话描述的是它跑过了，不是它判过了**，读起来却像后者 |
| 处置 | **已修复**：`cruise()` 的 options 加 `validate: true`，并在该处写下注释说明为什么它不是可选项。修完按要求重跑了补A 与补D 两条反向验证，两条都正确红——**没有用同样的方式再信一次** |
| 修复后的回归 | 打开规则后跑全量 `check`：**现有代码零违规，`PASS`**。也就是说这段时间里没有真的越界代码溜进来，空转期间只是没人守，不是守漏了 |

**教训值得单独记一笔**：这个 harness 的其余部分（discipline / bridge / workspace / marks）都是自己写的判定逻辑，反向验证一碰就现原形。唯一空转的这条，恰恰是**唯一一处把判定权交给第三方库**的地方——而它的失败模式是**静默通过**，不是报错。002 §1 的强制力阶梯该补一句：**用第三方库实现的检查，反向验证不是可选项**。

### 输出不指向纪律号的（违反 002 §3 第 3 条）

> 002 §3：**失败信息必须指向纪律编号，而不只是报错行**——`FAIL: 纪律 3（字面色值）— packages/app/src/x.tsx:12`，AI 才知道去读哪一条。

两处，都不是"检查失效"，是"报错层丢了编号"：

| # | 情形 | 实际最后一行 | 问题 |
|---|---|---|---|
| 1 | `core` 的 `package.json` 加 `@sepia/editor`（**恰好成环**）→ `bun run check` | `FAIL: 类型（typecheck）— 见上方输出，退出码 1` | turbo 先检测到 `@sepia/core ↔ @sepia/editor` 循环依赖并退出，`check:deps` 根本没机会跑。AI 看到这行会去调 typecheck，而不是去读**结构 2**。**范围有限**：换一条不成环的多余边（`core → ui`）就正常落到 `FAIL: 结构 2（…）— packages/core/package.json（dependencies.@sepia/ui）` |
| 2 | `core` 里用 `process` 全局 → `bun run check` | `FAIL: 纪律 lint（lint）— 见上方输出，退出码 1` | 守卫是活的（`core` 的 tsconfig `types` 不含 `node`，让 `TS2591` 生效），但**结构 3 的 lint 规则只扫 import 语句、不扫全局标识符**，所以它放行了；最后拦住的是 oxlint 的一条无关规则（`no-useless-empty-export`）与 typecheck，两者都不指纪律号 |

两条都保留给人裁决。可能的方向（不自行处置）：给 `check.mjs` 的 typecheck / lint 包装层加一张「错误码 → 纪律号」映射表（如 `TS2591` + 包名属 core/editor/agent/ui → 结构 3；turbo 的 `Cyclic dependency` → 结构 2）。

### `bun run check` 的最终输出

清 turbo 缓存后跑：

```
▸ lint       纪律 lint          ✓ 0.1s
▸ typecheck  类型               ✓ 2.8s
▸ deps       依赖图              ✓ 0.8s
  声明侧：5 个包，6 条边，3 条刻意不连线
  实际侧：dependency-cruiser 扫过 21 个模块，8 条规则      ← 这行是假的，见「空转的检查」
OK: deps —— 依赖图与 001 §2.2 一致
▸ bridge     preload 白名单      ✓ 0.2s
  暴露面 4 项：api.app.platform、api.app.versions.chrome、api.app.versions.electron、api.app.versions.node
OK: bridge —— 暴露面与快照一致（4 项）
▸ workspace  workspace 边界     ✓ 0.0s
  glob "packages/*" → 5 个工作区路径
  vendor/ 尚未引入（Stage 3）
OK: workspace —— vendor/ 在 workspace 之外
▸ marks      豁免记号             ✓ 0.0s
  harness-exempt 0 处 ｜ harness-dispute 0 处（扫了 26 个文件）
OK: marks —— exempt 0、dispute 0
▸ test       单测               ✓ 0.9s

lint 0.1s ｜ typecheck 2.8s ｜ deps 0.8s ｜ bridge 0.2s ｜ workspace 0.0s ｜ marks 0.0s ｜ test 0.9s
PASS
```

---

## 1.6 人工验证

机器判定不了的。每条是**具体动作 + 具体预期**。

- [ ] `bun run dev`，窗口出现后**目视确认没有白色闪一下**——在深色系统主题下最明显；把系统切成浅色再跑一次，同样不许闪
- [ ] 窗口出现时**空白但不是"坏掉"的空白**：右键 → 检查元素能看到 `<div data-sepia-shell="empty">`，Console 无红色报错
- [ ] DevTools Console 里敲 `window.api`，看到且只看到 `app.platform` 与 `app.versions` 三项；敲 `window.require`、`window.process` 均为 `undefined`（contextIsolation + sandbox 生效）
- [ ] 应用运行中，另开终端再启一个实例并带一个 `.md` 路径：**第二个终端立刻返回提示符**（进程退了），**第一个实例弹出第二个窗口**
- [ ] 关掉所有窗口：macOS 上应用**仍在 Dock 里**（不退出），点 Dock 图标能开回一个新窗口；Linux / Windows 上应用**应当退出**
- [ ] 从 CI 的 release 页面下载 `.dmg`，双击挂载、拖进 Applications、启动 → 能开出空窗口（**未签名，首次会被 Gatekeeper 拦，右键打开绕过**——这是预期行为，不是缺陷）
- [ ] 下载 `.AppImage`，`chmod +x` 后运行 → 能开出空窗口
- [ ] 下载 `.exe` 安装 → 能开出空窗口（**若手边没有 Windows 机器，明确记为"未验"，不许默认它成立**）
- [ ] 打开 `CLAUDE.md`，通读一遍，确认：不超过 150 行、每条纪律都注明了由谁强制、有正误对照、有卡住协议、有三种记号

---

## 1.7 实测记录

> **全部冷测**：每次测量前 `rm -rf .turbo node_modules/.cache/turbo`，避免 §1.8 风险 7 说的"缓存命中显示 0.1s"污染基线。测量机器：macOS 14.6 / Darwin 23.6.0，bun 1.3.14，node 22.22.1。**没有基线就没有回归。**

| 指标 | 预算 | 本 stage 实测（冷） | 上一 stage |
|---|---|---|---|
| `bun run check` 全量 | **< 30s**（002 §3） | **4.8s**（lint 0.1 ｜ typecheck 2.8 ｜ deps 0.8 ｜ bridge 0.2 ｜ workspace 0.0 ｜ marks 0.0 ｜ test 0.9） | — |
| `bun run check:fast` | 秒级（002 §5.4） | **3.0s**（lint 0.1 ｜ typecheck 2.8） | — |
| `bun install` 冷装 | 无硬预算，记录基线 | **0.85s** / 797 包（删 `node_modules` 重装，bun 全局缓存保留＝全新克隆场景） | — |
| `electron-vite build` 三段总耗时 | 无硬预算，记录基线 | **3.4s**（main 440ms ｜ preload 9ms ｜ renderer 659ms，其余为进程启动） | — |
| 安装包体积 · macOS dmg | 无硬预算，记录基线 | **arm64 115MB ｜ x64 117MB** | — |
| 安装包体积 · Linux AppImage / deb | 无硬预算，记录基线 | **AppImage 123MB ｜ deb 95.1MB** | — |
| 安装包体积 · Windows exe | 无硬预算，记录基线 | **95.6MB** | — |
| `harness-exempt` 总数 | **0**（起点即基线，只增不减就是腐化） | **0** | — |
| `harness-dispute` 总数 | **0**（> 0 表示有事等人裁） | **0** | — |
| 反向验证覆盖率 | **1.0**（`checks_reverse_verified / checks_added`） | **0.85**（11 / 13，见 §1.5「`checks_added` 的口径」） | — |
| **空转检查数** | **0** | **0**（曾为 1，已修复并复验） | — |

**离红线最近的是 `typecheck` 占 `check` 的比重**：2.8s / 4.8s ＝ **58%**，而此刻五个包的 `src` 加起来只有五个空导出文件。30s 预算目前用掉 16%，看着宽裕，但**增长几乎全部会落在 typecheck 与 test 上**——Stage 2 的 round-trip 要拿真实文章批量对拍，Stage 5 的锚点要标定参数。**下一个 stage 起，这一行的绝对值比百分比更值得盯。**

**两个已知会失真的地方**（记下来免得下次误读趋势）：`bun install` 的 0.85s 是全局缓存命中后的数字，CI 上首次装会明显更久；安装包体积取自 CI 产出的 release 资产（本地 `out/` 未打包只有 560K，两者不可比）。

> **冷启动 < 1s 不在本表**。那是 Stage 1 的指标——Stage 0 的窗口里没有 page 可开，测出来的数字没有可比性，写进来只会污染基线。

---

## 1.8 风险与未知

| # | 风险 / 未知 | 现在知道多少 | 先探还是边做边探，探到什么程度算够 |
|---|---|---|---|
| 1 | **bun 走进 `vendor/` 的嵌套 workspace** | 001 §1 断言"天然不被匹配"，但同一句话里要求实证。Stage 0 只能证到"glob 圈不到"，证不到"bun install 真的没走进去" | **边做边探，且明确留一半给 Stage 3**。第三重实证（真装一次）写进 Stage 3 DoD。**不许在 Stage 0 声称这条已经完全守住** |
| 2 | **ubuntu + wine 交叉出 Windows 包** | 001 §5 排的是"ubuntu 出 linux + win" | **先探**：这是 Stage 0 唯一一条"没干过、且失败时不可观测"的事——GitHub Actions 的日志匿名读不到。**探到"能出包"为止**；探不动就换原生 windows runner，别在 wine 上耗 CI 轮次 |
| 3 | **`exports` 直接指向 `.ts` 源码** | 内部包不做中间构建，由 bundler 直接吃源码。这条路 opencode 在走，但我们要同时喂给 tsc、vitest、vite、dependency-cruiser 四个消费者 | **边做边探**。四个消费者各跑通一次即算够；有任一个不认，就退到"内部包出 `dist` + `exports` 指向产物" |
| 4 | **electron-vite 5 + vite 7 的版本网** | electron-vite 5 的 peer 只到 vite 7，而 `@vitejs/plugin-react` 6 要求 vite 8 | **先探**（选版本时就得定）。锁定一组能同时装上的版本，写进 catalog 就算够 |
| 5 | **Windows 上的运行时行为完全没覆盖** | 手边没有 Windows 机器 | **不探**。Stage 0 只保证"能打出包"，运行时验证明确记为未验。风险登记在架构 §8「win/linux 无日常自用覆盖」名下，随 Stage 1 有真界面时再补 |
| 6 | **`check` 的 30s 预算随 stage 增长** | Stage 0 包小、测少，轻松达标；真正的压力在 Stage 2（round-trip 要拿真实文章批量对拍）与 Stage 5（锚点标定） | **不探，但现在就埋基线**。§1.7 记下 Stage 0 的数字，让后面每个 stage 都能看见自己涨了多少 |
| 7 | **turbo 缓存掩盖真实耗时** | `turbo` 全缓存命中时 typecheck / test 会显示 0.1s，看起来很快但不是冷启动真相 | **边做边探**。§1.7 的数字一律**清缓存后测**，并在记录里注明 |

---

## 1.9 回流

> 本 stage 阅读上游文档时发现的错漏、矛盾与说不通处。

**裁决结果（2026-08-04）：十条已全部裁决，九条采纳、一条驳回，上游文档已按裁决修订完毕。** 下表保留原始记录，裁决见此处：

| # | 裁决 | 落地 |
|---|---|---|
| 1 | **采纳** | 架构 §6 改称「引擎接入时」的核对清单，并加「归属」列：①②④⑤⑥ 归 Stage 3，③ 拆成「Stage 0 建立 scheme／Stage 3 验证 CORS」 |
| 2 | **已自行修复** | 002 §7 的 Stage 0 行在本 stage 实施中已补上 `check:workspace`。**另发现该表被一段引用块截断**（`Stage 3+` 行掉到引用块之后），一并修好 |
| 3 | **采纳，并改为硬条件** | 003 §4.5 期一时机由「现在，与 Stage 0 一起」改为「**至少两份 stage plan 已回填真实实测数字之后**」。推迟不等于搁置——给了条件就是排了期 |
| 4 | **采纳** | 002 §2.4 加「归属」与「进 check？」两列。`check:theme`→Stage 2、`check:artifacts`→Stage 3（只进 CI）、`check:patches`→Stage 3 且**不是 gate**，是 `check` 输出里的一行数字 |
| 5 | **采纳** | 架构头部死链改指 001，并补 002、003 |
| 6 | **驳回** | 003 §1.1 不改。「第一个 stage 没有上一 stage」在整个项目里只发生一次，且 110 已就地处理（贴地基条件）。为一次性情况给模板增重，后面每份 plan 都要读一句用不上的话 |
| 7 | **采纳** | 003 §3.2 明确 `measured` 是每 stage 自定义的开放字典，示例键仅供参考；债务面板按键名画趋势，缺键不补零 |
| 8 | **采纳** | 001 §6 测试表加「工具」列；smoke 明确为「Stage 0 自启动开关脚本 → Stage 1 起 Playwright `_electron`」，架构 §6 的测试范围段同步 |
| 9 | **采纳** | 001 §1 结构图每项加 `[Sn]` stage 标注，并在图下写明**这是终态结构、不要去建没标 `[S0]` 的项**，附 `build-engine.ts` 提前装上会毁掉 Stage 1 迭代节奏的理由 |
| 10 | **采纳后者** | 002 §5.3 增补：一条检查混两档硬度时，把不变量级子条**单列成独立检查**。理由是豁免语义——「豁免一半」无法表达，一旦允许 `harness-exempt` 就能绕过本该无豁免的子条 |

**原始记录如下。**

| # | 指向 | 问题 | 建议 |
|---|---|---|---|
| 1 | **架构文档 §6** vs **001 §7** | 架构 §6 把 ①–⑥ 六条核对项称作「**Day-1 骨架**搭起来时要逐条勾的清单」，但其中 ①②④⑤⑥ 全部依赖 vendor/opencode 与引擎——而 001 §7 把引擎排在 **Stage 3**。两处对「Day-1 骨架」的所指不是一个东西 | 架构 §6 改称「**引擎接入时**的核对清单」，并注明归 Stage 3；或在 001 §7 的 Stage 3 行里显式引用架构 §6 的 ①②④⑤⑥。**②到⑤都是"失败时静默"的项，错排 stage 的代价特别高** |
| 2 | **002 §3** vs **002 §7**（002 内部矛盾） | §3 把 `check` 的组成写成 `lint → typecheck → check:deps → check:bridge → **check:workspace** → test`，即 `check:workspace` 从一开始就在 `check` 里；但 §7 的落地顺序表里，Stage 0 那行**没有** `check:workspace` | 以 §3 为准，§7 的 Stage 0 行补上 `check:workspace`。理由见 §1.4——它有时间性，晚一个 stage 就失效 |
| 3 | **003 §4.5** vs **001 §7** | 003 §4.5 写「期一（只读看板 + 债务面板）：**现在，与 Stage 0 一起**」，但 001 §7 的 Stage 0 行里没有看板，验收条件里也没有 | 建议把看板**从 Stage 0 剥离**，单独排一个 `1xx` 编号的横向任务。理由：看板的输入是 stage plan 的 frontmatter，而 Stage 0 是**第一份** stage plan——此刻只有一份数据，看板显示不出任何趋势（豁免趋势、反向验证覆盖率、实测 vs 预算全是单点）。**至少要等两三个 stage 的数据落地，债务面板才有意义**；而 003 §3.5 又说它"总量控制在几百行"，晚做的代价很低 |
| 4 | **002 §2.4** 的六条脚本 | `check:patches` 与 `check:theme` 在 §2.4 有定义，但 §3 的 `check` 组成里**没有它们**，§7 的落地顺序表里也没有排期 | 明确它们的归属：`check:theme` → Stage 2（有色板时），`check:patches` → Stage 3（有 `patches/opencode/` 时）；并说明它们**进不进 `check`**——`check:patches` 按 §2.4 是"不阻塞、只让增长可见"，那它更像是 `check` 的一条输出行而不是一个 gate |
| 5 | **架构文档 头部第 9 行** | 「下游两份：`../plan/sepia-impl-plan.md`」——这个文件不存在，它已经变成 `001_boot.md` | 改成 `001_boot.md`，并补上 `002_boot_harness.md` 与 `003_stage_playbook.md` |
| 6 | **003 §1.1** | 模板第一条是「上一 stage 的 DoD 已达成（贴出验收输出）」，但 **Stage 0 没有上一个 stage** | 模板加一句：第一个 stage 此处改贴**地基条件**（工具链版本、远端与 CI 可用、上游文档定稿版本） |
| 7 | **003 §3.2 frontmatter schema** | `measured` 的示例键是 `cold_start_ms` / `bundle_mb`，但**冷启动是 Stage 1 才有的指标**。Stage 0 若照抄，会写下一个没有意义的数字 | 明确 `measured` 是**每 stage 自定义的开放字典**，示例仅供参考；债务面板按键名做趋势，缺键就不画那条线 |
| 8 | **架构 §6** vs **001 §6** vs **002** | 架构 §6 指定 smoke 用 Playwright `_electron`；001 §6 只说 smoke 放根 `test/smoke/`「起真应用」，没说工具；002 完全没提 | 明确 smoke 的工具与引入时机。建议：**Stage 0 不引 Playwright**（没有可断言的 DOM），Stage 1 有真界面时再引，并在 001 §6 的表里补上工具列 |
| 9 | **001 §1 仓库结构图** | 图里 `scripts/` 下同时列着 `build-engine.ts`、`check-bridge.mjs`、`check-artifacts.ts`、`models-dev-snapshot.json`，读起来像是 Stage 0 就该建齐，但其中三个是 Stage 3 的东西 | 图上标注这是**终态结构**，并给每项标一个 stage 号；否则每个新 session 读到这里都会想去把它建全 |
| 10 | **002 §5.3 硬度分档** 的判据 | 判据是「违反它会不会让用户丢字节或被 AI 抢笔」。按这条，`check:bridge` 本体算纪律级，但「preload 不得开出绕过 CAS / 写权限的通道」直指不变量 3、4，该算不变量级——**同一条检查里混着两档硬度**，§5.3 没有说这种情况怎么标 | 允许一条检查**按子规则分档**，或要求把不变量级的子条单列成独立检查。本 stage 采后者（见 §1.4 注 ①） |
| 11 | **002 §1 强制力阶梯** | 阶梯只按「何时被发现 / 能否绕过」排序，**没有区分"检查是自己写的"还是"判定权交给第三方库"**。本 stage 唯一空转的检查恰恰是唯一一处交给第三方库的（dependency-cruiser 少传 `validate: true`，静默通过），而自己写的四个脚本反向验证一碰就现原形 | 阶梯表补一列或补一句：**用第三方库实现的检查，反向验证不是可选项**——它的典型失败模式是静默通过，而不是报错 |
| 12 | **002 §6.2** 的措辞 | 原话是「新增检查必须能**指出它抓到过什么**」。`check-deps.mjs` 每次打印「实际侧：dependency-cruiser 扫过 21 个模块，8 条规则」——这句描述的是**跑过了**，读起来却像**判过了**，恰好掩盖了空转 | 建议把 §6.2 的要求收紧成：**检查的输出必须报告"判定了几条、命中几条"，而不是"扫了多少东西"**。前者空转时会显示 0 条判定，后者不会 |

---

## 附录 A · Stage 0 差异对账

> 2026-08-04 执行。方法：逐条拿本文档 §1.2 / §1.3 / §1.4 去对磁盘上的实现，不靠记忆。
> 判定四档：**符合** ｜ **不符** ｜ **计划外多出**（实现有、计划没写） ｜ **未验**（没条件验，明确记下）

### A.1 §1.2「做什么」

全部 19 项**均已实现**。逐条核对结果：包与工作区 5 项、Electron 装配 6 项、harness 5 项、CI 3 项，全部打勾。其中两项附注：

| 条目 | 附注 |
|---|---|
| `turbo` 按包并行且遵守依赖顺序 | 实测确认：`core` 先跑，`editor`/`agent`/`ui` 并行，`app` 最后 |
| macOS `open-file` 与 argv 走同一队列 | **代码在，行为未验**——需要真的双击 `.md` 或拖到 Dock 图标，本次没做。记为**未验** |

### A.2 §1.2「明确不做什么」

九行**逐条确认没有被顺手带出**：

| 计划刹住的东西 | 实况 | 判定 |
|---|---|---|
| 主题系统 | 只有 `windows/create.ts` 里一个 `nativeTheme.shouldUseDarkColors ? 深 : 浅`，无 theme service、无变量表 | 符合 |
| IPC handler | 全仓库零 `ipcMain` / `ipcRenderer`，preload 只有一次 `contextBridge.exposeInMainWorld` | 符合 |
| renderer shell | `App.tsx` 就是 `<div data-sepia-shell="empty" />` | 符合 |
| Tailwind / shadcn | 依赖清单里零命中 | 符合 |
| zustand stores | 零命中，无 `stores/` 目录 | 符合 |
| 文件树 / 最近的 page | 无 | 符合 |
| `check:artifacts` / `check:theme` / `check:patches` | 三个都不存在 | 符合 |
| 图标、签名、公证、自动更新 | 无图标文件；`mac.identity: null`；无 notarize / publish 配置 | 符合 |
| `/harness` 看板 | 不存在 | 符合 |

**没有任何一条被顺手带出。** 需要删的东西：无。

### A.3 §1.3 三张表

| # | 条目 | 计划 | 实况 | 判定 |
|---|---|---|---|---|
| 1 | 落包表 · `app` 行 | 列了 `electron.vite.config.ts`、`electron-builder.yml`、`main/`、`preload/`、`renderer/`、`test/main/` | 另有 `src/index.ts`、`tsconfig.node.json`、`tsconfig.web.json` | **计划外多出**。三个都是必需品（`src/index.ts` 是"每包都有"的要求，两份 tsconfig 是 node/web 双运行时拆分），是**计划漏写**而非实现越界。建议补进落包表 |
| 2 | 落包表 · 四个下层包 | `src/index.ts`（空导出）、`test/` | 完全一致，`src/` 下各只有一个文件 | 符合 |
| 3 | 依赖边表 · 6 条边 | `core→editor`、`core→agent`、`core→app`、`editor→app`、`agent→app`、`ui→app` | `dep-graph.json` 与五个 `package.json` 完全一致，全部 `workspace:*` | 符合 |
| 4 | 依赖边表 · 3 条刻意不连线 | `editor↮ui`、`editor↮agent`、`ui↮core` | `dep-graph.json` 三条齐全 | 符合（**但守卫是死的**，见 A.5） |
| 5 | 功能深度 · 窗口 | 能开 / 不闪白 / 跟随系统；不做窗口状态记忆 | 一致，无位置尺寸持久化 | 符合（"不闪白"属目视项，**未验**） |
| 6 | 功能深度 · 单实例 + argv | 锁生效 + 路径进队列；消费者不做 | 一致，`takePendingPaths()` 只被 smoke 钩子调用 | 符合 |
| 7 | 功能深度 · 多窗口注册表 | "增删查数四个操作" | 实际导出六个：`register` / `unregister` / `find` / `all` / `count` / `reset` | **计划外多出**。`all` 与 `reset` 超出"四个"。`reset` 是给单测清状态用的，已在注释里标明"生产路径不该调用" | 
| 8 | 功能深度 · preload | 四项只读、零 IPC | 一致 | 符合 |
| 9 | 功能深度 · renderer | 空 div | 一致 | 符合 |
| 10 | 功能深度 · 打包 | 三平台包能出；图标 / 签名 / 公证 / 自动更新 / 产物自检不做 | 三平台包已发布可下载；上述五项均无 | 符合 |
| 11 | 功能深度 · smoke | Linux 开窗口再退出；Windows 运行时 smoke 不做 | 一致，CI 里 `xvfb-run` 那步已绿 | 符合 |
| 12 | 暴露面 · preload 白名单 | 4 项 | 4 项，与快照一致 | 符合 |
| 13 | 暴露面 · 配置字段 | **零** | 应用配置字段确实为零；但 `packages/app/package.json` 新增了 `description` / `homepage` / `author`，`electron-builder.yml` 新增了 `executableName` / `artifactName` / `linux.maintainer` | **计划外多出**。全部是**打包元数据**，不是应用配置；由 Linux deb 打包硬性要求逼出来（见 commit `db2c800`）。建议在 §1.3 暴露面表里单列一类「打包元数据」，因为 `author.email` 会随安装包分发出去，性质上确实是对外暴露面 |
| 14 | build workflow 形态 | §1.2 只写"CI 出三平台产物" | 实况是**三台 runner**（macos / ubuntu / windows），而 001 §5 原写"ubuntu 出 linux + win" | **不符**，但**已在实施中修正并回写 001 §5**（commit `3b543da`）。原因：ubuntu + wine 出 nsis 失败且 CI 日志匿名不可读。留在这里备查 |

### A.4 §1.4 的 13 条检查

| # | 计划的检查 | 实况 | 判定 |
|---|---|---|---|
| 1 | 包依赖声明（层 2） | 五个 `package.json` 声明与图一致 | 符合 |
| 2 | `tsconfig` 的 `types` 不含 `node`（层 1） | `core` / `editor` / `agent` 是 `[]`；`ui` 是 `["react","react-dom"]`——都不含 `node` | **已消解**。原判定为「不符（形式）」，因为 §1.4 当时写的是字面 `types: []`，而 `ui` 要写 JSX 就得有 react 类型。**措辞已改成「不含 `node`」**，实现与计划一致 |
| 3 | `check:deps` 声明侧 | 存在且工作正常 | 符合 |
| 4 | `check:deps` 实际侧 | 曾**存在但从未被求值**；已加 `validate: true` 并复验 | **已修复**，见 §1.5「空转的检查」。修复后跑全量 `check` 为 `PASS`——空转期间没有真的越界代码溜进来 |
| 5 | `check:bridge` | 存在且工作正常 | 符合 |
| 6 | `check:workspace` | 存在且工作正常 | 符合 |
| 7 | `check:marks` | 存在且工作正常 | 符合 |
| 8 | lint · 结构 3 | 存在；**只扫 import 语句，不扫全局标识符** | 符合（有已知盲区，见 §1.5 第 2 条） |
| 9 | lint · 纪律 1 | 存在且工作正常 | 符合 |
| 10 | lint · 纪律 3 | 存在且工作正常 | 符合 |
| 11 | lint · 纪律 18 | 存在且工作正常 | 符合 |
| 12 | `SEPIA_HARNESS_BYPASS` | 本地留痕 + CI 忽略，两侧都实测 | 符合 |
| 13 | `CLAUDE.md` 初版 | 存在 | 符合（**内容未逐条走查**，§1.6 那条人工项本次未执行，记为未验） |
| 14 | **oxlint** | `.oxlintrc.json`：`correctness`/`suspicious` 为 error、`perf` 为 warn，外加 `no-console`/`eqeqeq`/`no-var`/`prefer-const`，并关掉 `unicorn/require-module-specifiers` | **已消解**。原为「计划外多出」，现已**补进 §1.4 作第 14 项**并计入 `checks_added` 分母。关掉的那条规则是对 `export {}` 这个 TS 惯用法的误判，已在配置里注明理由 |

### A.5 汇总

| 判定 | 条数 | 清单 |
|---|---|---|
| **不符 · 已消解** | **3** | ① `check:deps` 实际侧空转（**曾最严重**，已加 `validate: true` 并复验）② `ui` 的 `types` 与 §1.4 字面不符（措辞已改成「不含 `node`」）③ build workflow 形态（实施中已修正并回写 001 §5） |
| **不符 · 未处置** | **1** | 两处报错 FAIL 了但不指纪律号（③ 成环子情形、补B 的全局标识符）——保留给人裁 |
| **计划外多出 · 已消解** | **1** | oxlint 已补进 §1.4 作第 14 项并计入分母 |
| **计划外多出 · 未处置** | **3** | app 的三个文件（`src/index.ts` + 两份 tsconfig）、注册表的 `all`/`reset`、打包元数据——保留给人裁 |
| **未验** | **6** | macOS `open-file` 行为、"无白闪"目视、`CLAUDE.md` 走查、§1.6 人工清单整体、**包依赖声明的包边界本身**、**oxlint** |
| **符合** | 其余全部 | §1.2 做什么 19 项、明确不做 9 项、§1.3 大部分、§1.4 的 11 条 |

**曾经最严重的 A.4 #4 已修复。** 它不是"少做了一件事"，而是"做了一件事，它一直在报告自己有效，而它无效"——波及三条刻意不连线的守卫与结构 4（main ↮ renderer）。修完复验证明：打开规则后现有代码**零违规**，空转期间没有真的越界代码溜进来，只是没人守，不是守漏了。

**新暴露的覆盖缺口**：`checks_added` 改用 §1.4 表为分母后，第 1 项（包依赖声明的包边界本身）从未被反向验证过——反向验证 ① 本想验它，却被 lint 的结构 3 抢先拦住，编译期"import 不到"这层物理约束始终没走过。

**其余差异的处置权仍保留给人。** 本次只动了一处实现（`check-deps.mjs` 加 `validate: true`）与两处措辞。

