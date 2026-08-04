# 001 · Boot：代码结构与实施计划

> 状态：v1 ｜ 2026-08-03 ｜ 阶段：技术架构 → **plan** → ultra spec → 实施
>
> **配套**：[`002_boot_harness.md`](./002_boot_harness.md) —— 用类型、包边界、lint、脚本与测试把本文档的结构**变成机器可判定的约束**，并给出 `CLAUDE.md` 的写法。本文档说「应该长成什么样」，它说「怎么保证真长成那样」。
>
> **它决定什么**：代码怎么组织、依赖朝哪个方向、怎么建起来、怎么跑起来、按什么顺序做。
> **它不决定什么**：每个文件里写什么、函数签名、字段全集——那是 ultra spec。
>
> 上游：[`../design/sepia-architecture.md`](../design/sepia-architecture.md)（约束、形状、决策、纪律）。**本文档不重复架构结论，只把它落成代码骨架。**

---

## 1. 仓库结构

**多包：bun workspaces + catalog + turbo**（T-06，与 opencode 同一套，非 pnpm）。

```
sepia/
  package.json                   # workspaces: ["packages/*"] + catalog
  bunfig.toml
  turbo.json
  tsconfig.base.json
  scripts/
    build-engine.ts              # vendor 构建 + 产物搬运
    check-bridge.mjs             # preload 白名单守卫（CI）
    check-artifacts.ts           # 产物自检：wasm 齐全、零 .node
    models-dev-snapshot.json     # 构建期离线快照
  vendor/
    opencode/                    # submodule，锁 tag —— 不在任何 workspace glob 内
  packages/
    core/                        # 锚点、config、类型、文案 —— 外部依赖趋近于零
    editor/                      # CM6 扩展、widget、markdown 结构判定
    agent/                       # AgentBridge、任务注册表、上下文块
    ui/                          # 主题变量、组件 —— 叶子，零内部依赖
    app/                         # Electron 装配 + 领域组件（唯一 import electron 的包）
  specs/
```

每个包自带 `package.json`、`tsconfig.json` 与自己的测试；跨包依赖用 `workspace:*`，第三方版本走根 `catalog`。**`vendor/` 在 `packages/` 之外，天然不被 workspace 匹配**，其 `bun install` 只由 `scripts/build-engine.ts` 显式调用——首次搭建时须验证 bun 不会误走进 vendor 的嵌套 workspace。

---

## 2. 模块与依赖方向

### 2.1 包内目录

```
packages/app/src/main/
  index.ts                   # 生命周期、单实例锁、argv 分发
  windows/                   # 创建、窗口状态、多窗口注册表
  ipc/                       # handler 注册（REST 风格命名）
  services/
    config.ts                # ~/.sepia/config.json 读写与订阅
    session-state.ts         # ~/.sepia/session.json（tab / 光标 / 滚动）
    books.ts                 # book 身份、meta.json、threads 目录
    fsio.ts                  # 原子写、回收站删除
    git.ts                   # GitService：串行队列、三触发 commit
    watcher.ts               # chokidar + focus 对账 + 自写回声抑制
    keychain.ts              # 凭据
    theme.ts                 # 主题真相、nativeTheme、首帧注入
    agent-supervisor.ts      # 引擎 fork / 健康 / 退避重启
  engine/
    sidecar.ts               # utilityProcess 入口：import + Server.listen
    env.ts                   # XDG 四根隔离、鉴权、CONFIG_CONTENT 组装

packages/app/src/preload/
  index.ts                   # contextBridge 白名单——唯一出口

packages/app/src/renderer/
  shell/                       # 路由、布局、主题挂载、loading 态
  editor/
    host.tsx                 # CM6 宿主
    extensions/              # 揭示（A/B 类）、快捷键、剪贴板、IME 规则、查找替换
    widgets/                 # textdiagram / 图片 / 表格 / 公式（C 类）
  markup/                    # ⌘K 浮层、流式、diff、落笔
  threads/                   # 线程面板、徽章、还白
  home/                      # 主页、onboarding、最近的 page
  files/                     # 文件树、多 Tab、文件管理
  overlays/                  # ⌘⇧I 信息、⌘/ 看板
  commands/                  # registry + 集中注册
  services/
    api.ts                   # window.api 之上唯一封装
    agent-bridge.ts          # 五方法
    context.ts               # 块式上下文组装
    tasks.ts                 # 任务四元组注册表
  stores/                    # zustand，每 domain 一个

packages/core/src/
  types/                     # 跨进程契约类型
  copy/                      # 界面文案（main 与 renderer 双可达，T-21）
  anchor/                    # 锚点三级对齐的纯函数
  config/                    # 默认值与 merge
                             # 注意：markdown 结构判定不在这里——它要用 lezer，归 editor，
                             #      以保 core 的外部依赖趋近于零

packages/editor/src/         # CM6 扩展、widget、markdown 结构判定
packages/agent/src/          # AgentBridge、tasks、context
packages/ui/src/             # 主题变量、shadcn 组件（叶子，不知道领域）
```

`app` 负责「装配 + 领域」——把 `editor` 挂进 CM6 宿主、把 `agent` 接到 IPC 与浮层、把 `ui` 铺成界面，并承载知道领域概念的组件（徽章、线程条目）。**通用能力不许留在 `app`**：凡是不依赖 Electron 又能被独立测的逻辑，都该沉到下层包，否则包边界就白切了。

### 2.2 依赖方向（可 lint 强制）

**包级**（由 `package.json` 的依赖声明强制，比 lint 硬）：

```
core ──→ editor ─┐
  └───→ agent ───┼──→ app
        ui ──────┘
```

`core` 与 `ui` 都是叶子、`app` 是根、**层次线性无环**。上面是**层次图**：`app → core` 是一条真实且必需的边（本节「包内」要求 `main/services → core`、`renderer 组件 → core/copy`），图里没单独画是因为它被层次关系蕴含。

三条刻意为之的「不连线」：`editor ↮ ui`（CM6 主题写 `var(...)`，只共享变量名，T-20）；`editor ↮ agent`（widget 要用 AI 时，能力上提到 `app` 装配，**不在中间层横向连线**）；`ui ↮ core`（`ui` 是叶子、不知道领域，连 `core` 的类型与文案都不该知道）。

> **Stage 0 修订**：这张图现在有一份机器可读的副本 [`scripts/dep-graph.json`](../../scripts/dep-graph.json)，`check:deps` 从它派生规则，两头都查——包 `package.json` 的声明必须**恰好等于**边集，实际 import 图不得越界。**改图先改那份 json。** 上面补出的 `app → core` 与第三条不连线 `ui ↮ core`，都是 Stage 0 落地时为了让「不多一条，不少一条」可判定而显式化的。

**包内**（由 lint 强制）：

```
renderer/组件  →  renderer/services · stores · commands · core/copy
renderer/services  →  window.api（仅 api.ts）· core
main/services  →  core · Node/Electron
core  →  什么都不 import
```

四条硬约束，对应架构纪律 1–6：

1. **组件不得 import `window.api`，不得直接请求引擎**——只经 `api.ts` 与 `agent-bridge.ts`。
2. **`preload/index.ts` 是唯一的桥**，任何新增暴露面须过 CI 守卫。
3. **`core` 不 import 任何进程侧代码**——纯函数与类型，可被两侧与单测直接使用。
4. **renderer 与 main 之间没有直接 import**，只有 IPC 契约类型经 `core/types`。

**锚点算法**（`core/anchor/`）刻意做成纯函数：输入是 `{ 锚点记录, git diff 文本, 当前全文 }`，输出是 `{ 新区间 | 孤儿 }`。git diff 由 main 取、CM6 位置映射在 renderer 做，但**判定逻辑不依赖任何一侧**——这样它能被真实文章批量对拍，而不必起应用。

---

## 3. 进程与初始化

### 3.1 启动序列

```
app.whenReady
├─ 单实例锁：抢不到 → 把 argv 交给已运行实例 → 自身退出
├─ 读 ~/.sepia/config.json（缺失则用默认值）
├─ 解析主题 → 创建 BrowserWindow（带 backgroundColor，避免白闪）
├─ 注册自定义特权 scheme，加载 renderer
│   └─ renderer：首帧前落主题属性 → loading 态 → 读上次 page → CM6 就绪、光标就位
└─ 异步并行（一律不挡光标）
    ├─ AgentSupervisor：portpicker → 生成密码 → fork sidecar → 健康检查 → 通知就绪
    ├─ GitService：git 可用性探测 + HEAD
    ├─ watcher：chokidar 挂载 + 首次对账
    └─ 文件树索引
```

同步路径上**只允许**：窗口、单文件、CM6。其余一律后置。

### 3.2 三种入口

| 入口 | 行为 |
|---|---|
| 正常启动 | 恢复 `session.json` 的上次 page 与光标 |
| 首次运行（无 config / 无 book） | 主页给两条路：选文件夹作为 book、打开一个 `.md` |
| argv / 双击 / 拖到图标带 `.md` | 直接打开该 page；不属于任何 book 则走游离模式 |

### 3.3 引擎子进程

`utilityProcess.fork(sidecar.js, { cwd: bookRoot, env })`，env 在 **fork 时**一次性设定（引擎在模块加载期即算死路径）：四个 XDG 根指向 `~/.sepia/engine/*`、`OPENCODE_SERVER_PASSWORD`、`OPENCODE_CONFIG_CONTENT`。sidecar 内 `import` 虚拟模块并 `Server.listen`，就绪后 postMessage。

---

## 4. 构建管线

```
predev / prebuild
└─ scripts/build-engine.ts
   ├─ git submodule 就位、tag 校验
   ├─ vendor/opencode 根：bun install（workspace + catalog + patches）
   ├─ MODELS_DEV_API_JSON=scripts/models-dev-snapshot.json  # 构建期不联网
   └─ bun script/build-node.ts → dist/node/{node.js, *.wasm}

electron-vite build
├─ main：resolveId 'virtual:opencode-server' → vendor 产物
│        resolveId '@lydell/node-pty' → 抛错桩（T-18）
│        writeBundle：复制 *.wasm → out/main/chunks/
├─ preload：cjs 单文件
└─ renderer：React + Tailwind

electron-builder
└─ mac(双 arch) / win(nsis) / linux(AppImage + deb)，Day-1 不签名
```

**产物自检**（每次构建后跑，失败即红）：`out/main/chunks/*.wasm` 四份齐全；产物内 `.node` 数量为零。

---

## 5. CI

| workflow | 触发 | 内容 |
|---|---|---|
| `ci` | push / PR | lint（oxlint）→ typecheck → Vitest → **preload 白名单守卫** → 产物自检 |
| `build` | push 默认分支 / tag | matrix：`macos`（双 arch）+ `ubuntu`（AppImage + deb）+ `windows`（nsis）；产出未签名安装包 |

默认分支 push 覆盖发 `alpha-latest` prerelease，tag 发正式 release。二者共用同一构建脚本。concurrency 取消同分支旧任务，`fail-fast: false`，缓存 bun 与 node_modules。

> **Stage 0 修订两处**，都是实测撞出来的：
>
> 1. **Windows 包改用原生 `windows-latest`，不再从 ubuntu + wine 交叉。** 原定「ubuntu 出 linux + win」实跑下来 AppImage 与 deb 都能出，只有 nsis 在 wine 下失败；而 Actions 日志匿名读不到，继续盲调 wine 只会反复烧 CI 轮次。多一台 runner 对公开仓库免费，换掉一整类不可观测的失败，划算。
> 2. **触发分支是 `master`（本仓库的默认分支），不是 `main`。** 首次 push 后 `build` 压根没被触发就是因为这个。

---

## 6. 测试布局

| 层 | 位置 | 覆盖 |
|---|---|---|
| 纯函数单测 | `packages/core/test/` | **锚点三级对齐**（重点，拿真实文章对拍）、config merge、默认值 |
| 编辑器单测 | `packages/editor/test/` | md 结构判定、A/B/C 类装饰、**composition 冻结**、剪贴板双格式、round-trip |
| Agent 单测 | `packages/agent/test/` | AgentBridge（mock SSE：乐观更新 / 增量拼接 / abort）、上下文组装、任务注册表 |
| 服务单测 | `packages/app/test/main/` | GitService 队列与 commit 触发、原子写、watcher 回声抑制、config 迁移 |
| app 单测 | `packages/app/test/` | command registry、落笔 CAS、领域组件 |
| smoke | 根 `test/smoke/`（跨包，起真应用） | 冷启动打点断言、写字→保存→commit、强杀引擎后纸可写、外部改文件后重对齐或降级、单实例二次启动开新窗口 |
| 真 LLM | 根 `test/manual/` | markup 全链 <15s、diff 落笔、徽章回放。**手跑，不进 CI** |

**测试跟着包走**（turbo 按包并行跑），只有需要起真应用的 smoke 与真 LLM 用例留在根目录。`core` / `editor` / `agent` 三包的测试**都不需要 Electron**——这正是切包换来的东西。

**round-trip 单测是不变量 2 的守卫**：一批真实 md 读入再写出，断言字节完全一致。

---

## 7. Stage 拆解

每个 stage 有可判定的验收，且尽量对齐 happy-path 的验收清单。**顺序原则：纸先于 Agent**（不变量 1）。

| Stage | 内容 | 验收 |
|---|---|---|
| **0 骨架** | **五个包与依赖图立起来**（core/editor/agent/ui/app）、bun workspaces + catalog + turbo、electron-vite 三段、单实例 + 多窗口、preload 白名单 + CI 守卫、CI 出三平台产物 | 三平台包可下载、能开空窗口；**turbo 能按包并行跑 typecheck 与测试** |
| **1 纸** | CM6 宿主、打开 / 保存单文件、原子写、`session.json`、主题变量与首帧注入、启动打点 | **冷启动 <1s 打开上次 page 且可写**；无白闪 |
| **2 语法** | A/B/C/D 四类装饰全覆盖、四类块 widget + 行内公式、IME 冻结规则、剪贴板、查找替换、撤销 | 全语法 live preview；**IME 组合输入不被打断**；round-trip 单测通过 |
| **3 引擎** | vendor 构建、sidecar、隔离 env、凭据注入、AgentBridge 五方法、SSE、退避重启与缺席态 | **`kill -9` 后纸全功能可写**，⌘K 给缺席提示 |
| **4 markup** | ⌘K 浮层与分阶段家具、任务四元组、块式上下文、流式渲染、diff、落笔 CAS | **全链 <15s**；生成期间编辑正文则落笔中止而非覆盖 |
| **5 版本与徽章** | GitService 队列、三触发 commit、锚点三级对齐、徽章与线程面板、⌘⇧H 还白 | 外部改文件后**重对齐成功或优雅降级孤儿** |
| **6 库与文件** | 文件树、最近的 page、多 Tab、文件管理、watcher 与冲突、`@` 引用与双屏、游离 page、更新链接命令 | **整个 `art/` 作 book 启动仍 <1s**，`@` 搜索即时 |
| **7 收尾** | ⌘⇧I 信息浮层、⌘/ 看板、保存微反馈、错误提示与重试、跑完整验收清单 | happy-path 验收清单全绿 |

**Stage 0–2 完全不依赖引擎**——这是不变量 1 的工程体现：前三个 stage 结束时，Sepia 已经是一个可用的 markdown 编辑器。

---

## 8. 待 ultra spec 展开

`config.json` 字段全集与 `defaults.ts` ｜ AgentBridge 与 IPC 的最终类型签名 ｜ 每个 CM6 扩展的实现细节 ｜ widget 的渲染与序列化 ｜ 任务注册表条目 ｜ 组件树与 props ｜ 命令清单 ｜ 测试用例逐条 ｜ 主题变量的完整命名表。
