# Sepia · 技术架构论证记录

> **本文档是论证记录，不是架构文档。** 架构结论看 [`sepia-architecture.md`](./sepia-architecture.md)；这里保留的是每条 T-xx（T-01~T-22）的完整理由、曾考虑的方案、读码证据，以及 §16 的讨论与推翻记录、§17 的编辑器内核对比。需要知道「为什么不是另一种」时来查这份。
>
> 状态：讨论记录 v1.20（T-22；§16 讨论与推翻记录；§17 编辑器内核对比） ｜ 2026-08-03 ｜ 阶段：技术架构（产品细节 → 交互原型 → **技术架构** → ultra spec → 实施）
>
> 输入：[`sepia-mvp-happy-path.md`](./sepia-mvp-happy-path.md)（真理源）、[`sepia-mvp-decisions.md`](./sepia-mvp-decisions.md)（D-01~D-41）、[`sepia-prototype-features.md`](./sepia-prototype-features.md)（功能盘点）、[`sepia-settings.md`](./sepia-settings.md)（默认值来源）；外部实证：pinpin `specs/`+`docs/`（ADR-002/007/008、command-bus、四层测试金字塔、两篇 research）、opencode 仓库源码（2026-08 读码验证）。
>
> 本文档的技术决策用 **T-xx** 编号，与产品决策 D-xx 分开；凡修订既有 D-xx 的，条目内显式标注。产品层问题不在此重议。
>
> **术语（T-13，2026-08-03）**：笔记库改称 **book**（= 文件夹 = git repo = opencode project，替代 Obsidian 系的 vault 一词），单个笔记 = **page**。已立为 **D-38**，decisions 与全部产品文档、CLAUDE.md 均已清洗完毕。

---

## 0. 一句话架构

**一个 Electron 应用、三种进程**：main 管窗口/文件/git，utilityProcess 里跑 JS 级 import 进来的 opencode server（同一安装包，无外部依赖），renderer 是 React + CodeMirror 6 的纸。renderer 对 agent 只认 AgentBridge 五方法（D-15），对系统只认一个 preload 白名单。纸永远可写，agent 进程死活不影响写字（D-23）。

## 1. 技术栈总表

| 层 | 选择 | 备注 |
|---|---|---|
| 壳 | Electron（版本对齐 opencode desktop，当前 42.x） | D-03；Node 基线满足 opencode node 产物要求 |
| 构建 | **electron-vite**（main/preload/renderer 三段） | 对齐 opencode desktop，`virtual:opencode-server` 插件照搬 |
| UI | React 19 + Tailwind + shadcn/ui（CLI copy 进仓库） | 用户指定；注意 opencode desktop 渲染层是 Solid，UI 代码不可借 |
| 编辑器 | CodeMirror 6 | D-02，单坐标系 |
| 流式 markdown | Streamdown（单库引入） | T-04；用于 markup 浮层/线程回放，不引 AI Elements 整套 |
| 状态 | zustand（每 domain 一个 store） | T-07 |
| agent 引擎 | opencode，源码 vendor + build-node 产物内嵌 | T-01，修订 D-04 部署形态 |
| agent 客户端 | `@opencode-ai/sdk`（与 vendor 锁同 tag） | AgentBridge 内部实现用，见 §5 |
| git | 系统 git（execFile 封装 GitService） | T-05 |
| 配置 | 单一应用级 `config.json` | T-02，改判 D-22 的 TOML 部分 |
| 测试 | Vitest + Playwright `_electron` + 延迟 harness | T-08 |
| 打包/CI | electron-builder + GitHub Actions 三平台 matrix | T-09，Day-1 未签名产物 |
| 仓库 | 单包（非 monorepo）+ `vendor/opencode` submodule | T-06 |

## 2. 进程模型

```
┌─ Electron main ──────────────────────────────────────────┐
│ 窗口/菜单/托盘  ipc.ts(REST 风格 handlers)  GitService   │
│ ConfigService  AgentSupervisor(fork/健康/重启)           │
└───┬────────────────────────────┬─────────────────────────┘
    │ utilityProcess.fork        │ IPC (contextBridge 白名单)
┌───▼──────────────────┐   ┌────▼─────────────────────────┐
│ utilityProcess       │   │ renderer (React)             │
│ sidecar.js:          │   │  CM6 编辑器宿主 / markup 浮层 │
│  import opencode     │◄──┤  线程面板 / Home / 状态点     │
│  Server.listen(...)  │HTTP│  AgentBridge / api.ts        │
│  cwd = book         │+SSE│  command registry            │
└──────────────────────┘   └──────────────────────────────┘
```

- **main**：唯一碰 OS 的进程。窗口先行（§9）、文件 IO、git、配置、opencode 进程监督。不缓存应用状态（真理源=文件），sidecar 端口/进程句柄例外（pinpin daemon-ready 铁律 3）。
- **utilityProcess**：opencode server 宿主。崩溃不拖垮 main/renderer（承接 D-23 的进程级保证），退出由 AgentSupervisor 处理（T-12）。
- **renderer**：sandbox + contextIsolation（T-10）。对外只有两条腿：`AgentBridge`（HTTP+SSE 直连 127.0.0.1，不过 main 转发）和 `api.ts`（preload 白名单之上的唯一封装层）。**组件禁止直接 import `window.api` 或发 fetch**——lint 强制（pinpin services 抽象铁律）。

## 3. opencode 嵌入（T-01）

照抄 opencode desktop 的已验证做法（读码依据：`packages/desktop/src/main/{server,sidecar}.ts`、`electron.vite.config.ts`、`packages/opencode/script/build-node.ts`）：

**构建期**
1. `vendor/opencode` 为 git submodule，**锁 tag**（升级=显式换 tag + 跑回归）。**必须在 opencode monorepo 上下文内构建**：先在 submodule 根 `bun install`（workspace 依赖 + catalog + patches/ 补丁都在根上），再跑 build-node——不能把 `packages/opencode` 摘出来单独构建。
2. `bun script/build-node.ts` → 产出 `dist/node/node.js`（ESM 单文件，external 仅 `jsonc-parser` + `@lydell/node-pty`，wasm 随附）。注意其 `generate.ts` **构建时会 fetch `https://models.dev/api.json`**：Sepia 仓库 vendor 一份快照并设 `MODELS_DEV_API_JSON` 指向它，CI 免网络依赖、构建可复现（上游原生支持此 env）。
3. electron-vite main 段插件把 `virtual:opencode-server` resolve 到该产物，并照抄 desktop 的两个插件（`copy-server-assets` 搬 wasm、`node-pty-narrower` 收窄平台包）。**两类附属产物性质完全不同，见 §3.1**。

### 3.1 附属产物：wasm 与原生模块（实测清单）

读 `packages/opencode/dist/node/` 与 `packages/desktop/out/main/chunks/` 的真实产物，附属物只有两类：

| | 内容 | 跨平台风险 | 真实性质与做法 |
|---|---|---|---|
| **wasm ×4** | `photon_rs_bg`（图像处理 1.9MB）、`tree-sitter` 核心 + `tree-sitter-bash` + `tree-sitter-powershell`（共 ~2.5MB） | **没有**。wasm 与平台无关，三平台同一份字节 | 纯**构建管线的文件搬运**问题：`Bun.build` 把它们产出为内容哈希命名的旁置资产（`photon_rs_bg-bq08arze.wasm`），bundle 内按相对路径加载；electron-vite 重新打包 main 后必须把 `*.wasm` 复制进 `out/main/chunks/`——这就是 desktop `copy-server-assets` 插件干的事。**漏了不会启动报错，会在首次用到时才炸**（懒加载），所以要在核对清单里显式勾。另注：photon 走 `import … with { type: "file" }`（Bun 专有导入属性）且上游打了 patch，是「必须在 monorepo 上下文构建」的又一条硬理由 |
| **原生模块 ×2** | `@lydell/node-pty`（伪终端 N-API 插件）、`@parcel/watcher`（文件监听） | **有**。`.node` 二进制按 platform-arch 分发 | 业界成熟配方（VS Code 集成终端十余年同款）：平台包进 **optionalDependencies**（各包自带 `os`/`cpu` 字段，包管理器只装匹配宿主的）+ 打包器标 external + 构建器插件收窄到 `@lydell/node-pty-${platform}-${arch}` + **在目标平台的 runner 上构建**（这才是 CI matrix 的真正理由，不是 wasm）。electron-builder **自动**把 `*.node` 加进 asarUnpack，故 desktop 的 `electron-builder.config.ts` 里找不到相关配置。**但对 Sepia 这两个都可去掉，见下** |

**Sepia 的原生依赖数 = 0（T-18，读产物验证）**

- **node-pty**：`core/src/pty/pty.node.ts` 是顶层静态 import，`/pty` 路由组与 `httpapi/server.ts` 建 API 时静态引入它——server 启动即加载，与「D-13 工具全关、PTY 永不被调用」无关，靠"不调用"省不掉。**但**：它被 build-node 标为 external，在 32MB 的 `node.js` 里**只以一个裸 specifier 出现一次**（`import * as pty from "@lydell/node-pty";`）。因此 electron-vite 的 `resolveId` 把它指向一个"调用即抛错"的桩即可——与 desktop 的 `node-pty-narrower` 插件同一个钩子，只是换个目标。**配置层一行，无需改上游源码**。
- **@parcel/watcher**：上游本就是 `lazy()` + `try { require(计算出的平台包) } catch { return }`——**拿不到就返回 undefined 优雅降级**，且 Sepia 不设 `OPENCODE_EXPERIMENTAL_FILEWATCHER`。**不打进包即可，零工作量零风险**。

**收益**：产物变成纯 JS + wasm，`.node` 归零 → asarUnpack/ABI/平台包全套问题消失；CI matrix 从 4 个 runner 收缩到 **2 个**（一台 mac 出双 arch，一台 Linux 出 linux+win——注意 **dmg/公证仍是 mac-only**，不能真的一台机器出全部）。
**代价**：PTY 桩要在每次升级 vendor tag 时重验（上游若在启动路径上碰 PTY 会立刻抛错，属"响亮的失败"，可接受）。列入 §12.1 ⑥ 一并验（该项不阻塞 spec）。

**运行期**
1. main 的 AgentSupervisor：portpicker 找空闲端口 → 生成随机密码 → `utilityProcess.fork(sidecar.js, {cwd: bookRoot, env})`。
2. sidecar.js（与 desktop 同构，Sepia 版可更薄）：`const { Server } = await import("virtual:opencode-server")` → `Server.listen({ port, hostname: "127.0.0.1", cors: [renderer origin] })` → postMessage ready。**鉴权走 env 而非 listen 参数**（读码：auth 中间件读 `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME`，desktop 传给 listen 的同名参数实际被忽略；env 不设 = 无鉴权，fork 时必须注入）。
3. **renderer 必须用自定义特权 scheme 加载**（如 `sepia://renderer`，`protocol.registerSchemesAsPrivileged` + `protocol.handle` 伺服构建产物），并把该 origin 写进 `cors`——desktop 即 `oc://renderer` 模式。若图省事用 `loadFile`（file:// → Origin 为 `null`），跨到 127.0.0.1 的 fetch/SSE 会被 CORS 拒掉。这是照抄清单里最容易漏的一条。
4. 健康检查：轮询 health 端点，就绪后通知 renderer（F19 状态点由灰转实心）。整条链路异步，**永不阻塞白纸**（happy-path：sidecar ≤5s 后台）。
5. renderer 经 `api.agent.info()` 拿 `{port, password}`，AgentBridge 以 Basic Auth 直连。

**环境与边界（T-11）**
- **directory 显式传，cwd 兜底**：读码确认当前版本按 workspace 路由——每个请求的目标目录取 `?directory=` 查询参数或 `x-opencode-directory` 头，**缺省才落到 `process.cwd()`**，且 session 自带 directory。所以 fork 仍设 `cwd = book 根`（兜底正确），但 AgentBridge 每个请求/建 session **显式带 `directory = book`**，不赌默认值。项目级配置按该 directory 向上查找 merge——但 D-13 的 deny 层**不走文件，走 T-19 的内存注入**。
- `XDG_STATE_HOME = app userData`：opencode 的 session/状态数据隔离进 Sepia 自己的目录。徽章回放依赖 session 持久性（D-12），不能被用户自己的 opencode 清理/升级殃及。
- **全局配置不隔离**（不设 `OPENCODE_CONFIG_DIR`）：D-14/D-36 要求模型与凭据「随 opencode 现有配置导入」，共享 `~/.config/opencode` 正是实现方式。代价：用户全局配置异常可能影响 Sepia，MVP 接受（个人使用）。
- **引擎配置内存注入（T-19）**：fork 时设 `OPENCODE_CONFIG_CONTENT=<JSON 字符串>`，把 D-13 的 permission deny 等引擎配置直接喂进去，**book 里不放 `opencode.json`**。读码确认（`config/config.ts:468`）：该 env 被解析后以 `"local"` scope 合并，且**排在项目目录扫描之后**——即它**压过** book 内可能已存在的任何 `opencode.json`（`art/` 是真实老仓库，这点很实际）。另注 `config.ts:250`：三个 config flag 任一被设时，opencode 不再自动创建全局配置文件的空壳；但全局配置的**加载**不受影响（258–260 行无条件 merge），T-11 的「凭据随 opencode 现有配置导入」不受损。
- 「opencode 路径」「端口」两个 MVP 设置项**废止**：无外部二进制可指，端口自动分配。config.json 保留 `agent.port` 字段（默认 auto）作留口。

**崩溃与缺席（T-12）**
utilityProcess 退出 → AgentSupervisor 指数退避自动重启（1s/4s/10s，≤3 次）→ 仍失败则进入「Agent 缺席」稳态：F19 顶部细提示线，⌘K 显示缺席文案，写字/保存/commit 全功能不受影响。手动恢复入口 = 缺席提示上的重试。验收对应 happy-path 的 `kill -9` 用例。

**已知上游动向**：opencode desktop 另捆 `opencode2` CLI 走「v2 background service」方向。MVP 抄 v1 utilityProcess 方案；一切上游漂移被 AgentBridge（§5）挡在五方法之下。

## 4. 数据与 git

**book 布局**（承接 D-10/D-18/D-22，机器状态文件格式不变，仍 json/jsonl/md）：

```
<book>/                     # = git repo = opencode project (D-14)
  *.md                       # page（A2 文件即真相）
  <图片目录>/                # **不是固定结构**：由配置的图片路径模板决定，见下
  （无 opencode.json）        # T-19：改用 OPENCODE_CONFIG_CONTENT 内存注入，book 里不落引擎配置
  .sepia/
    threads/<page>.json      # 徽章锚点+sessionID (D-18)
    memory/                  # v2 (D-09)
~/.config/sepia/config.json  # T-02 应用级配置（book 外，不入 git）
```

- **图片目录不进架构层**：图片落盘路径是**配置项**（`sepia-settings.md` 已列为「图片粘贴路径模板」），架构只规定"由模板算出、写在 book 内、以标准 `![]()` 相对引用"（A2 文件即真相）。原稿在布局图里写死 `1mg/` 是错的——那是作者个人约定，属默认值层面的事，不该固化成结构。**默认值已裁定（2026-08-03，立为 D-40）：`assets/`**，仍可配置。无论选哪个，**读取侧一律按 md 里的实际相对路径解析，不依赖模板**——模板只管新图往哪写。
- **原子写**：`.sepia/` 下所有 json 一律 tmp 文件 + rename（pinpin session.md 同款）。
- **GitService（T-05）**：main 进程 execFile 系统 git 的薄封装，仅暴露 Sepia 需要的动词：`commit(message)`、`diffRange(from, to, file)`、`headHash()`、`log(file)`。三触发 commit（D-19：save 防抖 / 定时 / pre-markup+markup 成对）全部经它，threadId 进 commit message。git 缺席（罕见，主要是裸 Windows）→ 降级：保存照常，版本/徽章 diff 功能禁用并在 ⌘⇧I 浮层说明。isomorphic-git 列为将来免依赖的备选，接口按可替换设计。
- **锚点对齐**（D-18 的实现落点）：会话内编辑用 CM6 `changes.mapPos` 实时映射；打开文件时 `HEAD ≠ anchor.commit` → `git diff <anchor.commit> HEAD -- <file>` 解析 hunks 平移区间 → 失败退引文+前后文模糊匹配 → 再失败降级孤儿徽章（F13 置灰区）。此算法独立成纯函数模块，Vitest 重点覆盖。

## 5. AgentBridge（D-15 的具体化）

renderer 内唯一的 agent 切面。内部用 `@opencode-ai/sdk`（与 vendor 同 tag），**以锁定版本的 OpenAPI 为准**做端点映射（下表按当前读码，实施第一步核对）：

```ts
interface AgentBridge {
  // 徽章点开回放 / markup 唤起：无 threadId 则新建 session
  openThread(threadId?: SessionID): Promise<Thread>          // POST /session | GET /session/:id
  // 发送一轮 markup：显式携带上下文（D-31：选区±前后文 + @content，不靠 session 累积）
  send(threadId, parts, opts: { model: {providerID, modelID}, system }): Promise<void>  // prompt 异步端点
  // SSE 事件流（全局 /event 流按 sessionID 过滤路由，part-by-part upsert）
  stream(threadId, onEvent): Unsubscribe                      // GET /event (SSE)
  interrupt(threadId): Promise<void>                          // abort 端点
  listModels(): Promise<ModelInfo[]>                          // config/providers（D-36：拍平为模型列表+能力标签）
}
```

- **opencode 自己没有这一层**（读码+文档确认）：其客户端 = OpenAPI 生成的全量 SDK（`@opencode-ai/sdk`）+ app 层一个大 switch 的 event-reducer（delta 累积 → store 最小 reconcile）+ part 渲染注册表。「收窄成五方法」是 Sepia 特有决策（D-15）——opencode 的 app 就是全功能客户端，无需收窄。AgentBridge 内部实现抄 event-reducer 的瘦身版协议要点：**只有字符串字段走 `message.part.delta` 增量拼接，其余 part 全量 `part.updated` 替换**；SSE 每 ~10s 心跳（区分「模型停了 vs 连接死了」）；未知事件类型一律忽略；tool 完成判定靠 `time.end` 存在与否不存布尔。
- 乐观更新：客户端预生成 messageID，提交即上屏（<50ms），SSE 增量 reconcile（pinpin/opencode desktop 同款，支撑「提交→首 token <3s」体感）。
- session 预热：sidecar 就绪时预建一个空 session（happy-path 性能策略）。
- opencode 是 session/message 的**单一真相源**：Sepia 不复制消息，`.sepia/threads/` 只存锚点+sessionID；孤儿（session 被删）不显示但保留。
- v3 换引擎（ACP/draft-001 变体 A/B）只重写此接口实现，编辑器一行不改。变体 B（远程 opencode）在本架构下=AgentBridge 换 baseURL，免费。

## 6. 渲染层

```
renderer/
  editor/        # CM6 宿主：揭示扩展(D-25)、快捷键(F2)、/菜单、@选择器、组件 widget、图片粘贴
  markup/        # ⌘K 浮层（D-29 三阶段家具）、diff 预览、落笔动作
  threads/       # 线程面板(F13)、徽章渲染与还白(F11/F12)
  home/          # 最近笔记(H4)、新建(H5)
  overlays/      # ⌘⇧I 信息浮层、⌘/ 看板、保存微反馈
  commands/      # T-03 registry：注册表 + 绑键 + 菜单/看板数据源
  services/      # AgentBridge、api.ts、config 客户端 —— 组件的唯一外部入口
  stores/        # zustand
```

- **command registry（T-03）**：pinpin command-bus 的瘦身版——只留 `registerCommand / executeCommand` + 集中注册（`commands/index.ts`）+ 执行事件流。快捷键绑定、菜单、**⌘/ 看板（F23）直接从 registry 生成**（含 when 上下文高亮）；将来 E2E 驱动与 MCP 暴露吃同一层。不做：命令面板 UI（Sepia 无此产品面）、undo 体系、schema 校验（进 MCP 时再补）。CM6 编辑器内部快捷键仍走 CM6 keymap，但动作体注册进 registry（一种契约）。
- **markup 浮层/线程回放 UI 手搓（T-04）**：形态特殊（原地浮层推开下文、家具分阶段、diff 落笔），通用 chat 组件不贴。流式 markdown 渲染引 Streamdown 单库；diff 展示基于 git diff 输出自渲染。
- **流式渲染方案（T-14，取自 opencode-chat spec/research 的收敛结论）**：业界三家独立收敛到同一结构——**remend 补全未闭合语法 + 只重解析活跃尾部块 + 已完成块冻结/块级 memo + 节点级 diff 跳过未变部分**（opencode desktop = remend+marked+morphdom；Streamdown = remend+块级 memo；opencode-chat GPU 版 = 块冻结）。Sepia 落地：① Streamdown 承担 remend/增量块/memo；② 揭示节奏学 opencode `PacedMarkdown`——**~24ms 批次、按词/标点边界 snap，无逐字补间**，CJK 分词用 `Intl.Segmenter`；③ 稳定性不变量：**冻结即定（已提交块语义永不翻转）、结构块绝不闪 raw 源（缓冲到可判定→骨架→填充）、揭示单调只增、节奏与 token 到达率解耦**；④ `prefers-reduced-motion` 命中→整块秒显；⑤ 测试加**切点 fuzz**（同一段 markdown 在每个字节边界切一刀喂入，断言最终渲染一致 = chunk-boundary independence）。感知依据（阅读科学）：回视占阅读 10–15%、冻结块给回视留稳定锚；逐字=退化 RSVP 更累，块揭示更可读——正好贴 Sepia「安静的纸」气质。节奏策略（边界停顿 0.2–0.3s 的「朗读档」等）在 config.json 留字段，MVP 只做匀速批次档。
- **CM6 揭示扩展 × IME 的硬规则（T-17）**：`decoration × composition` 是 CM6 上游反复出现的 bug 家族（`codemirror/dev#1396` view 6.28.2 致中文输入异常；`decoration.mark` 内含多个 `decoration.replace` 致 IME 选区不更新，Marijn 已修；`BlockWrapper` 在 composition 期渲染错误范围）。维护者划出的能力边界原话：**「如果 widget 真的在活动 composition 前方被增删或更新，编辑器无能为力——若强行纠正原生 DOM 选区，会直接中断 composition」**。Sepia 的揭示扩展恰恰是"光标移动即增删行内 decoration"，正落在这条边界上。因此定为实现规则而非待验证项：**监听 `compositionstart/compositionend`，composition 活跃期间冻结装饰更新（尤其禁止改动光标前方的 replace decoration / inline widget），composition 结束后再补揭示**；行内 widget 慎用 `contenteditable="false"`。120ms 淡入只作用于 CSS 不变更 DOM 结构。

### 6.1 主题系统（T-20）

设置清单里的外观项是**五个正交轴**：明暗（配色：跟随系统/亮/暗）、纸张底色、代码高亮主题、字体三项+字号+行高+行宽、界面缩放。它们要同时作用在**四套互不相通的渲染体系**上：

| 体系 | 管什么 | 主题机制 |
|---|---|---|
| Tailwind + shadcn/ui | 应用外壳：Home、面板、浮层、菜单 | 已经是 CSS 变量约定（`--background`/`--foreground`/…） |
| **CodeMirror 6** | **纸本身**：正文排版 + 语法揭示的高亮 | `EditorView.theme()` + `HighlightStyle.define()`，**JS 对象编译成 StyleModule，不是 CSS 文件** |
| Streamdown / Shiki | markup 浮层与线程回放里的流式 markdown、代码块 | Shiki 产出**内联色值**的 HTML |
| mermaid（textdiagram） | 组件块 | 自带 `themeVariables` |

**核心机制：CSS 自定义属性是唯一真相。** `<html data-appearance="light|dark" data-paper="...">` 上挂两组变量——shadcn 那组照搬，Sepia 再加一组纸的语义变量（`--paper-bg` / `--ink` / `--rule` / `--badge` / `--syn-*`）。四套体系全部**引用变量而非字面色值**：

- **CM6 主题写 `var(...)`**——`EditorView.theme({ "&": { backgroundColor: "var(--paper-bg)" } })`、`HighlightStyle.define([{ tag: t.heading, color: "var(--syn-heading)" }])`。CM6 的 theme 值就是普通 CSS 值，这条成立。**收益是换主题只换变量、不 reconfigure 扩展**——否则重建编辑器扩展会丢光标、选区与滚动位置，在"纸"上是不可接受的。
- **Shiki 是唯一的例外，也是唯一的坑**：它吐内联色值，吃不到变量。解法是用它的**双主题输出**（`themes: {light, dark}` → 产出 `--shiki-light`/`--shiki-dark`），或直接喂一个由 Sepia 色板生成的 theme 对象。要点是——**Shiki 与 CM6 是两套独立高亮器，必须由同一份 token 色板派生**，否则同一段代码在纸上和在 markup 浮层里长得不一样。
- mermaid 初始化时从 computed style 读同一组变量，映射进它的 `themeVariables`。

**明暗与启动闪白（绑 §9 的 <1s 预算）**：主题真相在 **main 进程**——启动时先从 config.json 读，`new BrowserWindow({ backgroundColor: <纸底色> })`，避免默认白底闪一下再变暗；「跟随系统」用 Electron `nativeTheme`（并设 `nativeTheme.themeSource`，让原生边框/标题栏跟着走），renderer 的 `matchMedia` 只作副渠道。**主题属性必须在首帧之前落到 `<html>`**——由自定义 scheme 的 `protocol.handle` 在 index.html 里注入，或一段内联同步 script，**不能等 React 挂载**。

**缩放**：`webContents.setZoomFactor`（主进程 API，opencode desktop 同款），走 preload 白名单 `api.window.setZoomFactor`（T-10）。它与 `--font-size` 是两个独立轴：缩放整窗口，字号只管正文。

**一条实现纪律**：组件与 CM6 扩展里**不许出现字面色值**（`#fff`、`text-gray-500`），只能用语义变量或映射到变量的 Tailwind token。可 lint 强制，与 T-10 的白名单守卫同一类。

**与 D-33 的边界**：本节只定**机制与变量层级**，不定具体色值、圆角、字体——那些按 D-33 等线框走查后单独定，届时只是往变量里填值，不动结构。

### 6.2 多语言（T-21）

设置清单里「界面语言」默认简体中文，即多语言是产品面已存在的项。**结论：机制进技术架构，实现进 ultra spec**——因为 i18n 的成本不在"支持多语言"，而在**事后把散落各处的字符串收回来**，与 T-20「不许字面色值」、pinpin daemon-ready「不许直连 invoke」是同一种便宜的前置纪律。

**技术架构要定的三条（现在定，因为它们约束别的结构）：**

1. **文案集中，组件不写字面串**。但**MVP 不引 i18n 库**——单人产品上 `t("markup.placeholder")` 的 key 抽象是过度工程。做法是一个 `copy/zh.ts` 常量对象，组件写 `copy.markup.placeholder`：可读性不输字面量，却已经拿到 90% 的 retrofit 收益。真要加第二语言时，这个模块变成两份 + 一个按 `config.app.language` 选择的 switch 即可，组件一行不改。
2. **文案必须 main / renderer 双可达**。原生菜单、对话框、托盘、应用名都在 main 进程构建（不是 React 能管的），所以 copy 模块要放在两个进程都能 import 的位置——这一条决定目录结构，事后再拆很烦。
3. **command registry 存 key 不存字符串**（直接约束 T-03）。⌘/ 看板由 registry 生成，命令的 `title` 就是用户可见文案；registry 若一开始存了中文字面串，将来看板、菜单、未来的 MCP 暴露就得各自再包一层。**这条不现在定，T-03 就会建错。**

**MVP 范围**：只发简体中文，`config.app.language` 字段留着（默认 `zh-CN`），不做语言切换 UI（设置 UI 本来就不做）。

**留给 ultra spec 的**：copy 模块的分组粒度、是否需要抽取/校验脚本、将来接 i18n 库时选谁。

**两类文案，两套规则（已裁定 2026-08-03，立为 D-41）**：**Agent 文案跟正文语言走，界面文案跟界面语言走**。分界线是——**动词属于文本域，家具属于应用域**。所以 ⌘K 浮层里会同时出现两种语言（情境动词跟正文、「应用/放弃/生成中」跟界面），这是有意的不是 bug。

落到实现是两件独立的事，价值差很多：

- **① system prompt 里加一句「输出与原文同语言」——最关键且免费，Day-1 就写。** 它让**结果**跟着正文，而与提示词本身用什么语言无关。不加这句的话，中文 system prompt 遇上英文原文，模型很可能回中文。
- **② 动词列表按语言分组**，由正文语言选取。语言检测用 **CJK 字符占比的启发式**（纯函数、无依赖、可单测）：选区太短则退到整页，仍判不出则退回界面语言。**MVP 处于潜伏态**（只发 zh-CN、作者写中文），只需把动词表建成「按语言分组」的形状、检测器留成纯函数，不必真的做第二套动词。

因此这两类文案**不进 `copy/` 模块**，归 Agent 配置，是与界面文案平行的另一条线。

## 7. config.json（T-02，改判 D-22）

- 位置 `~/.config/sepia/config.json`（Windows 走 `app.getPath('userData')`）。**改判范围仅限「人手改的配置用 TOML」这一条**；D-22 其余（jsonl 流水账、json 机器状态、md 记忆）不动。
- **schema 即 sepia-settings.md**：字段树镜像设置四个一级（`app / writing.pen / writing.paper / writing.companion / agent / output`），全量字段+默认值从设置清单文档生成一份 `defaults.ts` 常量。**文件只存与默认值的差异**，未识别字段容忍保留（向前兼容），带 `version` 字段。
- MVP 行为：启动读一次，ConfigService 提供 `get()/subscribe()`；改文件热生效（chokidar watch）作留口、可后置。设置 UI（S1~S5）不做——**改配置=改这个文件**，这就是「后续配置变更、功能变化的口子」：功能开关先进 defaults.ts + config.json 字段，UI 后到。
- 与 D-13 的边界：config.json 永不包含权限类字段（「设置无权限项」）。

## 8. 安全基线（T-10）

`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、CSP（`connect-src` 仅 self + `http://127.0.0.1:*`）；preload 只暴露 contextBridge 白名单（REST 风格命名：`api.file.read`、`api.git.commit`、`api.config.get`、`api.agent.info`、`api.shell.openExternal`…），**CI 守卫脚本 diff 白名单**（openwork `check-electron-bridge.mjs` 模式），白名单膨胀=PR 阻塞。opencode server 绑 127.0.0.1 + 随机密码 Basic Auth + CORS 限 renderer origin（`Server.listen` 原生支持）。外链处理见 T-16。

## 9. 启动序列（Aha #1 的实现纲领）

```
t0 进程启动
├─ 同步路径（预算 <1s）：创建窗口(<500ms) → 读上次纸一个文件 → CM6 就绪光标就位(<500ms)
└─ 异步路径（一律不挡光标）：AgentSupervisor 起 opencode(≤5s) ∥ git status ∥ 文件树索引 ∥ config watch
```

纪律（pinpin/VSCode 研究结论）：启动路径上除「窗口+单文件+CM6」外**不允许任何东西**；renderer 入口 bundle 保持小（Streamdown/diff 组件等按 route/交互懒加载）；`performance.mark` 从第一天就埋（t_window / t_paper / t_agent_ready），预算回归可断言（§11）。

## 10. 构建、CI 与发布（T-09）

**仓库**（T-06）：单包。`src/{main,preload,renderer}` + `vendor/opencode`(submodule) + `scripts/`(build-node、白名单守卫) + `specs/`。不引 monorepo/turbo，直到出现第二个 package 的真实需求。

**GitHub Actions（Day-1 就位）**：
- `ci.yml`：push/PR → lint(oxlint) + typecheck + Vitest + 白名单守卫。Ubuntu 单机，分钟级。
- `build.yml`：matrix（原生依赖归零后收缩为 `[macos(双 arch), ubuntu(linux+win)]`；dmg/公证 mac-only 故 mac runner 不可省） → checkout（含 submodule）→ 装 bun + node → build-node → electron-vite build → electron-builder（`dmg+zip / nsis / AppImage+deb`）→ 上传 artifacts。**main push = 自动覆盖发布 `alpha-latest` prerelease；tag = 正式 release**（pinpin 实战模式：path filter、concurrency cancel-in-progress、fail-fast: false、cache）。
- **Day-1 验收**：三平台产物可下载，空 book 冒烟通过（开窗、写字、保存、commit）。
- **不签名**：mac 侧 `xattr -cr` 放行，win 忽略 SmartScreen。签名/公证推迟到分发给他人（pinpin ADR-008 点名的最大隐性成本，也是 draft-001 触发条件）。**不做自动更新**：GH Releases 手动；config 的 `app.autoCheckUpdate` MVP 实现为「检查到新 release 就提示」或 no-op。

## 11. 测试策略（T-08）

pinpin 四层金字塔按单人产品瘦身为「两层半」：

| 层 | 工具 | 覆盖 | 时机 |
|---|---|---|---|
| 单元 | Vitest | 锚点三级对齐（重点）、config merge、GitService 解析、commands、AgentBridge（mock SSE：乐观更新/reconcile/abort） | 每 push |
| 集成 smoke | Playwright `_electron`（Electron 白送，pinpin 在 Tauri 求而不得） | 冷启动打点断言（t_paper<1s）、写字→保存→commit、`kill -9` opencode 后纸可写+缺席态、外部改文件后锚点重对齐/优雅降级 | 每 PR |
| 真 LLM | 脚本手跑（不进 CI） | markup 全链 <15s、diff 落笔、徽章回放 | 发布前/大改后 |

延迟 harness：`performance.mark` 打点 + smoke 断言硬指标（t1-t0<50ms 式，学 pinpin ADR-004）。IME、2 万字长文手感保持手测（验收清单已有）。

## 12. 先行验证（原「spike」）

> **spike** 是 XP 术语（spike solution）：为回答一个"讨论和读代码都答不了"的问题而做的限时探索性实验。中文按"先行验证/技术打样"理解。**滥用 spike 是有成本的**——把读文档就能定的事排成实验，等于用工期换心安。
>
> **准入判据（唯一）**：若结论是 B 而非 A，**ultra spec 的结构会不会不同**？会 → 先行验证；不会 → 实施期解决。
>
> **两轮复审的结果：原列 4 项，最终一项都不剩——没有阻塞 ultra spec 的先行验证。** 见 12.0 的证据链；本章因此整体降级为「Day-1 骨架的核对清单」。

### 12.0 为什么最后连 ① 也不阻塞（证据链）

原本认定"submodule 上下文内构建出产物"是唯一阻塞项，理由是"跑不通就得退回外部二进制"。复核后这条不成立，三段证据：

1. **构建本身已被验证——产物就在本机硬盘上**。`packages/opencode/dist/node/` 下有 `node.js`（32.6MB）+ 四份 wasm，日期 2026-07-24；而 `dist` 在根与包两级 `.gitignore` 里、`git ls-files` 查无此文件——**它不是仓库带来的，是在这台 mac 上真跑 `build-node.ts` 产出的**。"能不能构建"这个问题，你自己早就回答过了。
2. **产物能在 Electron 里跑，由 opencode desktop 的生产版本背书**——同一个 `dist/node` 产物、同一个 `utilityProcess.fork` 路径、同一档 Electron 42.x。
3. **"submodule 上下文"不构成新变量**。git submodule 的工作区与普通 checkout 逐字节相同，在其根目录 `bun install` 的行为也相同。**不存在产生差异的机制**。

剩下的未知项全部属于「响亮地失败、就地可修」的管线问题：CI 里的可复现性（fresh clone、bun 版本钉死、`MODELS_DEV_API_JSON` 快照替代联网）、electron-vite 消费产物的插件配置。**没有一项会改变 ultra spec 的结构**——因此可以直接进 ultra spec，核对清单在搭骨架时逐条勾。

**一个具体的坑（配置层，写进 spec 即可）**：vendor 用 bun、Sepia 自己用另一套包管理器，两套 `node_modules` 并存。务必**把 `vendor/` 排除在 Sepia 的 workspace glob 之外**，vendor 的 `bun install` 只由构建脚本显式调用，绝不并入 Sepia 的安装流程。

### 12.1 Day-1 骨架核对清单（不阻塞，搭骨架时逐条勾）

**内嵌集成六点核对**。模式已被 opencode desktop 生产验证，此清单核的是 Sepia 的偏差项：

| # | 核对项 | 失败的后果 |
|---|---|---|
| ① | submodule 上下文内 bun install + build-node 出产物（含 models.dev 快照 env） | 见 12.0：本机已验证过一次。锁定 tag 后**重跑一次确认**即可（两分钟的命令，不是实验） |
| ② | utilityProcess fork + env 鉴权生效（T-01 运行期 2） | 换写法即可，不动结构。但漏了=服务器无鉴权裸奔，属"静默的错" |
| ③ | 自定义 scheme 伺服 React renderer + CORS 放通 | 同上；照抄清单里最易漏的一条 |
| ④ | 显式 `directory` 建 session + **`OPENCODE_CONFIG_CONTENT` 注入的 deny 生效**（T-19） | 同上。deny 未生效属安全性问题，必须实测而非假定 |
| ⑤ | SSE 事件流收到、delta 累积正确 | 同上 |
| ⑥ | **PTY 桩生效、产物里零 `.node`、wasm 四份已复制进 `out/main/chunks/`**（T-18/§3.1） | **不阻塞**：桩若失败只回退 T-18（重新带原生模块、CI matrix 回到 4 个 runner），T-01 不受影响；wasm 漏复制是运行时才炸的实现 bug，实施期可修 |

**结论**：六项**没有一项阻塞 ultra spec**。②–⑤ 的价值在于"漏了会**静默**出错"（裸奔的服务器、失效的 deny），所以必须显式勾而不能默认成立；①⑥ 则是"失败会响亮报错"的类型。整份清单不是抛弃式原型，**就是 Day-1 骨架本身**。

### 12.2 降级：读代码/读上游已给出答案，实施期落地即可

| 原列项 | 为什么不阻塞 | 已由知识/代码给出的结论 |
|---|---|---|
| CM6 揭示 × 中文 IME | 结论只影响一条实现规则与 D-25 的 120ms 淡入，**spec 结构不变** | 已从 CM6 上游 issue/维护者结论提炼出硬规则（§6 T-17）：composition 期间冻结装饰更新。实施期第一周在**纯 Vite 里 30 分钟**可验，不需 Electron |
| 锚点算法对拍 | 阶梯形状由 D-18 定死，数据只影响**参数标定**（前后文长度、相似度阈值、放弃转孤儿的时机），spec 结构不变 | 算法可直接写进 spec；参数进 `defaults.ts` 留可调字段，实施期拿 `art/` 真文标定 |
| GH Actions 三平台首跑 | 它是 Day-1 交付物，不是实验 | 配置照抄 desktop 的 `electron-builder.config.ts` |

### 12.3 现在就能读掉、不必实验的清单

写 ultra spec 前直接读源码定死，不要留成"待验证"：vendor 锁定 tag 的 OpenAPI/SDK 生成产物（端点名、参数、事件 payload 类型 —— §5 的映射表按它核对）；desktop 的 `electron-builder.config.ts` 三平台配置与 `scripts/utils.ts` 打包细节；CM6 `@codemirror/view` 的 composition 处理源码与 `decoration.replace` 的已知边界。

## 13. 决策表

| # | 决策 | 曾考虑 | 理由（2026-08-03 拍板） |
|---|---|---|---|
| T-01 | **opencode 内嵌 import**：vendor 源码 + build-node + utilityProcess 内 `import` + `Server.listen`。修订 D-04 的部署形态（「Sepia 只是客户端」不变，HTTP+SSE 不变）；「opencode 路径」设置废止 | 外部二进制 sidecar（D-04 原案）；先外部后内嵌 | opencode desktop 已验证此路（读码确认）：单安装包、版本锁定、装一个东西；代价=CI 装 bun + submodule，可接受。仍独立进程，崩溃隔离承接 D-23 |
| T-02 | **单一应用级 config.json**，schema 镜像设置清单、存差异、容忍未知字段。改判 D-22 的 TOML 条（其余不动） | 维持 TOML 三项；应用级+库级两层 JSON | 用户指定「一个 json 搞定」；设置全默认值时代 JSON 生态（schema/校验/生成）成本最低；库级覆盖等真实需求出现再加 |
| T-03 | **Day-1 瘦身 command registry**（register/execute+集中注册），快捷键/菜单/⌘/ 看板/未来 E2E&MCP 共用 | 直接绑键 | F2 有 20+ 键、F23 本质是命令清单只读视图；pinpin 论证三消费者共用一层避免三倍漂移；瘦身后成本极低 |
| T-04 | **markup/线程 UI 手搓 + Streamdown** | AI Elements 整套 | Sepia 对话面小且形态特殊（D-29 家具分阶段、原地浮层、diff 落笔），通用 chat 组件不贴；流式 md 解析是唯一值得借的轮子 |
| T-05 | **git = 系统 git**，GitService 薄封装、可替换、缺席降级 | isomorphic-git；libgit2 绑定 | 最简可靠；mac/linux 白给；降级路径清晰（保存照常，diff 类功能禁用）；接口留可替换口 |
| T-06 | **单包 + electron-vite + vendor submodule 锁 tag** | pnpm+turbo monorepo（pinpin 式） | 单人单 app，monorepo 无收益；electron-vite 对齐参考项目，`virtual:opencode-server` 插件直接照搬 |
| T-07 | **zustand**；服务端数据先手写，需要缓存语义再上 react-query | zustand+react-query 全家桶 | Sepia 服务端状态面小（models、session 回放），先不引缓存层 |
| T-08 | **测试两层半**：Vitest + Playwright `_electron` smoke + 真 LLM 手跑；延迟打点进断言 | pinpin 完整四层+nightly eval | 单人产品按体量瘦身；把 happy-path 硬指标变成可回归断言是继承的核心 |
| T-09 | **CI Day-1 三平台未签名产物**；alpha=main 自动 prerelease、stable=tag；无 electron-updater | 签名公证 Day-1；自动更新 | 未签名不挡个人使用；签名是最大隐性成本，推迟到分发（=draft-001 触发条件）；更新手动 |
| T-10 | **Electron 安全基线**：contextIsolation/sandbox/CSP/preload 白名单+CI 守卫；server 127.0.0.1+BasicAuth+CORS | — | pinpin ADR-008 D10 + openwork 守卫模式，成本低、事后补贵 |
| T-11 | ~~opencode 状态隔离、配置共享~~ **已改判 2026-08-03 → 引擎环境完全隔离**（四个 XDG 根全部指向 Sepia 自有目录；凭据首启只读导入一次）。原案与改判理由见本行末尾。原案：**状态隔离、配置共享**：`XDG_STATE_HOME`→userData；不设 `OPENCODE_CONFIG_DIR` | 全隔离（pinpin 做法） | 原理由：徽章依赖 session 持久性→状态必须归 Sepia；D-14/D-36 要求凭据「随 opencode 现有配置」→全局配置共享。**改判（用户 2026-08-03）**：「哪怕用户装了 opencode、配了一大堆东西，也不应污染 Sepia」。读码确认引擎的 config/data/state/cache 四个根全部由 XDG 环境变量在**模块加载期**算死（`core/src/global.ts`），故 fork 时设满四个即可完全隔离；凭据（`auth.json`）在 `XDG_DATA_HOME` 下，隔离后不再共享——用 **首启只读导入一次**兜底，既不重配也不写回用户文件。D-36 的「随现有配置导入」由此重新解释为**一次性导入而非持续共享**，需回写 D-36。**二次确认（用户 2026-08-03）**：「auth.json 存的是用户的 token 与凭证，本来就应该在 Sepia 管控」——即凭据归属本身就该是 Sepia，而非暂借 opencode 的。读码确认凭据分三型（`api` / `oauth` / `wellknown`），且 provider 解析时 `config.provider.<id>.options.apiKey` 优先于 auth store，因此：**API key 类可全程留在内存**（钥匙串 → 随 `OPENCODE_CONFIG_CONTENT` 注入 → 引擎侧零落盘）；**OAuth 类因需 refresh 与写回，只能落引擎的隔离目录**（仍是 Sepia 自有目录），MVP 不做。首启只读导入退为「获取途径」，与共享无关 |
| T-12 | **崩溃自动重启（退避 ≤3 次）→ 缺席稳态** | 崩了只提示 | D-23 的进程级兑现；缺席态已有产品设计（F19），重启失败有明确去处 |
| T-13 | **术语：book / page**（笔记库=book=git repo=opencode project；单篇=page） | vault（Obsidian 系用词） | 用户 2026-08-03 拍板「就这么简单」；建议回写 decisions（D-38）并同步产品文档 |
| T-14 | **流式渲染 = Streamdown（remend+块冻结+块级 memo）+ PacedMarkdown 式 24ms 词边界批次揭示 + 稳定性四不变量 + 切点 fuzz 测试** | 逐 token 直接上屏；逐字打字机；自写增量解析器 | opencode desktop / Streamdown / opencode-chat GPU 版三方独立收敛同一结构（opencode-chat spec/research 全套调研背书）；阅读科学支持块揭示优于逐字；React 复审确认（见 T-15） |
| T-15 | **UI 框架复审：维持 React**（Solid 落选） | Solid（opencode desktop 同款，细粒度响应式天然免流式重渲染风暴；可直接借 @opencode-ai/ui） | Solid 2026 生态仍数量级小于 React（shadcn 移植品 Solid UI ~1.3k star vs 原版；CM6 与框架无关，编辑器这个性能主战场不吃框架红利）；Streamdown/AI 生态是 React 系；Sepia 对话面小，流式重渲染用批次+memo 即可覆盖；AI 辅助开发下 React 语料密度优势真实存在 |
| T-16 | **外链：MVP 交系统浏览器（`shell.openExternal`）；v2 形态定为「阅读器优先、内嵌浏览器兜底」，不是笼统的"内嵌浏览器"** | MVP 直接上内嵌浏览器；只做内嵌浏览器 | **2026-08-03 二次修订**（首版理由"原生视图与浮层语汇冲突"权重给高了——原型把它放右栏固定列，rect 稳定、只需 resize 同步，冲突收窄为少数几个浮层让位，几行代码）。真正的分岔在**用什么装外链**，三条路：**A·iframe**（VS Code Simple Browser 同款——官方文档明说 webview "就是 VS Code 里的一个 iframe"）：DOM 原生、z-order 白送、最轻；**但 X-Frame-Options / CSP `frame-ancestors` 会拦掉相当一部分站点**，且跨域加载失败不触发 error 事件、`onload` 照常触发，**连"失败了"都难优雅检测**。VS Code/Cursor 用得好是因为**它们的用例是预览自己在开发的应用**（localhost，无 framing 限制）；Cursor Browser 官方定位更是 agent 自动化（"test applications, audit accessibility, convert designs into code"）——**都不是"作者点开正文里任意一条参考链接"这个用例**。**B·WebContentsView**：全覆盖，任何站点都能开；代价是原生视图不在 DOM 里、需同步 rect + 少数浮层让位。**C·阅读器模式（建议优先）**：main 进程 fetch → Readability 抽正文 → 用 Sepia 自己的排版渲染在右栏。**绕开 X-Frame-Options 与 CORS**（主进程发请求无同源限制）；更贴产品气质——作者点外链是要看**这篇文章说了什么**，不是要一个带广告和 cookie 横幅的浏览器；**且抽出的正文可直接 `@` 进 markup 上下文（D-31），这是 A/B 都给不了的**（iframe/原生视图里的内容对 Sepia 是黑盒）。代价：SPA 与付费墙抽不出，需 fallback 到系统浏览器。**已裁定（2026-08-03，立为 D-39）：选 C 阅读模式**（Chrome 阅读模式的形态）。MVP 仍只做 `shell.openExternal`，完整版形态定为阅读模式，抽取失败退回系统浏览器 |
| T-19 | **引擎配置走 `OPENCODE_CONFIG_CONTENT` 内存注入，book 内不落 `opencode.json`**。修订 D-13 的实现形态（两级权限模型不变，第二级从"book 根配置文件"改为"fork 时注入的配置内容"） | book 根放 `opencode.json`（D-13 原案） | 用户 2026-08-03 提出「不想让用户看到和 notes 无关的东西」。读码确认 env 机制存在且合并顺序有利（见 §3 环境与边界）。**三点收益**：①**book 只剩 notes 与图片**，文件夹本身就是白纸，符合产品哲学；②**安全性反而更强**——文件版的 deny 层是用户可见、可编辑、且进 git 的，误删误改会静默失效；env 版由 Sepia 在 fork 时注入，book 侧无法篡改；③**压过 book 内既有的 `opencode.json`**（`art/` 是数年真实仓库，很可能已有自己的配置），文件方案则要面对"合并进别人的文件"的难题。**代价**：配置在磁盘上不可见，排障时不能 `cat`——补偿是把生效配置显示在 ⌘⇧I 信息浮层（F21）。**边界**：若将来接 opencode 的组织账号，org 配置在合并链上排在 CONTENT 之后，个人使用无此路径 |
| T-20 | **主题系统 = CSS 自定义属性单一真相**：四套渲染体系（shadcn / CM6 / Shiki / mermaid）全部引用变量；主题真相在 main 进程、首帧前注入；Shiki 双主题输出兜底 | 各体系各配一套主题；换主题时 reconfigure CM6 扩展 | 补 §6 的缺口（原稿完全没写主题）。三个关键点：①**CM6 写 `var()` 才能做到换主题不 reconfigure**——重建扩展会丢光标/选区/滚动，在「纸」上不可接受；②**Shiki 与 CM6 是两套高亮器**，不由同一色板派生就会出现「同一段代码在纸上和在浮层里两个样」；③**主题必须在首帧前落到 `<html>` 且 BrowserWindow 带 backgroundColor**，否则白底闪一下再变暗，正好砸在 <1s 白纸秒开的观感上。只定机制不定色值（D-33 边界） |
| T-21 | **多语言：机制进架构、实现进 ultra spec**。三条纪律=文案集中到 `copy/` 常量模块（**不引 i18n 库**）、模块对 main/renderer 双可达、**command registry 存 key 不存字符串**。MVP 只发 zh-CN | 现在就上 i18n 库 + key 抽象；完全推到将来再说 | i18n 的成本在**事后收回散落的字符串**，不在支持多语言本身——与 T-20、pinpin daemon-ready 同型的便宜前置纪律。但对单人产品而言 `t("key")` 的抽象是过度工程，**常量对象拿到 90% 收益且可读性不损**。第三条尤其不能拖：⌘/ 看板由 registry 生成，registry 存了中文字面串则 T-03 直接建错。**已裁定（D-41）**：Agent 文案跟正文语言、界面文案跟界面语言（动词属文本域、家具属应用域），故 Agent 文案不进 copy 模块；system prompt 的「输出与原文同语言」Day-1 就写，动词分语言在 MVP 处于潜伏态 |
| T-23 | **WYSIWYG 走 widget 分治；不变量 2 的表述同时精确化** | 整篇换 WYSIWYG（AST 模型）；永远纯源码态 | 用户 2026-08-03 指出「WYSIWYG 后续肯定要追上，这种书写体验更好」。**先澄清一处我的表述错误**：原写「永不改写用户字节」，精确表述应为**「只重写用户当次编辑所触及的最小区间，未触及的字节逐字节保留」**——差别不是措辞，它决定了 WYSIWYG 这条路开不开。**能力判断**：WYSIWYG 的真实优势集中在**二维结构**（表格、公式、图表），而非一维散文——散文用源码态揭示已由 Obsidian 千万用户量级验证；纯文本编辑 md 表格才是公认痛点。**定稿路线**：不是「哪天整篇换 WYSIWYG」，而是**把 WYSIWYG 关进 widget**——散文源码态、二维结构在 widget 内所见即所得，编辑结果只序列化回自身那一段。**不需要新机制**：textdiagram 已是此模式（编辑时代码、失焦成图），表格只是反过来（平时是表、编辑时给二维编辑器）。**为什么不破坏 A2**：widget 内的改写是用户主动编辑的结果、落在自身区间内，而不是保存时对全文的偷偷规范化。**解锁顺序（用户 2026-08-03 追加裁定：表格与公式进 MVP）**：原写「MVP 表格按纯文本」，用户追问「纯文本是指看不到渲染出来的表格吗」——是，L0 意味着全程看着一堆竖线。据此拆出三层级：**L0 纯源码 / L1 失焦渲染 / L2 所见即所得编辑**，成本差一个量级。**L0→L1 的体验差距远大于 L1→L2**（只读渲染已解决「看不清结构」这个主要痛点），而 L1 边际成本很低——块 widget 机制因 textdiagram 与图片本来就要建。证据：用户自己的 specs 文档几乎每份都大量用表格。**定稿：表格与公式的 L1 进 MVP**，L2 依痛感排后续。**行内公式是唯一例外**：`$x$` 需行内 replace decoration，正落在 T-17 的考验场上，是 CM6 × 中文 IME 最该早验的用例；块级 `$$…$$` 无此问题 |
| T-22 | **写盘与 commit 是两条不同频的时间线；落笔是有条件的写入；上下文永不缓存** | commit 跟着写盘防抖走；落笔直接替换；把文章预先塞进 session 当上下文 | 用户 2026-08-03 三连问（commit 时机 / message 怎么定 / 本地编辑后模型上下文如何更新）挖出的欠缺。①**原稿照抄 D-19「三触发」，藏着一个会炸的默认理解**——若 `sepia: save` 与写盘共用 800ms 防抖，写一篇文章将产生几百个 commit。定稿：写盘 800ms 防抖（在关键路径上，用户随时 ⌘Q 不能丢字），commit 用远长的静默阈值或 5min 定时兜底、取先到者、内容无变化不 commit，一次写作应出个位数 commit。顺序恒为**写盘 → commit**（commit 的是磁盘内容）。②**message 的结构化信息走 git trailer**（`Sepia-Thread` / `Sepia-Page`）而非塞 subject——`git log --grep` 可查且 subject 保持可读，这是 D-19「git 侧与 sidecar 侧双向可查」的落点。**否决用模型生成 commit message**：它必须离线、引擎缺席、300ms 内完成，为漂亮的 message 违反不变量 1 不划算。③**落笔时序**：UI 先行（替换 + 徽章 <300ms），`写盘 → pre-markup → 写盘 → markup` 在后台按序跑；链失败则徽章仍在、仅 diff 不可用，与 git 缺席降级路径合并。配套纪律：**git 操作串行队列**，异步 + 多触发源不串行会撞 `index.lock`。④**「上下文如何更新」是伪问题**：模型从不持有文章副本，每轮当场从编辑器现值取（选区+前后文+显式 `@content`），**无缓存即无失效**——这是 D-31/D-12「显式喂、不靠 session 累积」白赚的收益。唯一例外是同线程追问（session 里躺着上轮的旧原文），故每轮重发当前快照并由 system prompt 声明「以本轮提供的原文为准」。⑤**由此暴露一个原先漏掉的正确性问题**：diff 针对「提交那一刻的文本」算出，而生成期间用户可继续写字，闭眼替换会覆盖用户刚写的内容——**这是对「AI 不抢笔」最严重的违反**。定稿：落笔前对目标区间做 compare-and-swap 校验，快照不匹配即中止并提示 |
| T-18 | **原生依赖归零（PTY 桩 + 不带 watcher）；偏离上游按成本阶梯选手段**（配置层 → 构建脚本 → patch → fork 分支）。~~不 patch 源码~~ **已软化 2026-08-03**：用户判定「最终肯定是要 patch 的」，patch 不作硬约束，改为可复现可审计的纪律 | git patch 改 submodule 源码；fork opencode 维护分支 | **配置层够用就别动源码**：node-pty 在 bundle 里只是一个裸 specifier，一行 `resolveId` 即可，patch 是杀鸡用牛刀。patch 的真实成本：①**位置/上下文敏感，每次升 tag 必烂**；②**削弱 T-01 的立身之本**——内嵌之所以敢做，是因为"这条路被 opencode desktop 生产验证过"，patch 越多跑的组合离被验证的组合越远；③调试与上游报 issue 都要先自证"未改动版是否复现"。**若将来确有配置层够不着的需求**（目标在 bundle 内部），纪律为：patch 文件放 Sepia 仓库 `patches/opencode/`，prebuild 里 `git apply --check` **硬失败不静默跳过**，绝不在 submodule 里直接改并提交（会丢/游离）；**非平凡 patch 超过 2–3 个即改用 fork 分支 + 每次 tag rebase**（git 三方合并比 patch 文件健壮）。**patch 数量当健康指标看**：持续增长说明内嵌方案在磨损，届时 draft-001 变体 A（自写 agent loop）反而更诚实 |
| T-17 | **揭示扩展硬规则：composition 活跃期间冻结装饰更新**（见 §6） | 不特殊处理，靠测试兜 | CM6 维护者划定的能力边界：活动 composition 前方增删 widget "编辑器无能为力"。这是规则不是风险，写进 spec 而非排成实验 |

## 14. 风险清单

| 风险 | 缓解 |
|---|---|
| opencode 上游漂移：读码可见 server 正在大改（control-plane / WorkspaceV2 / sync / mdns、v2 background service、effect 化） | vendor 锁 tag（选最近 desktop 发布对应的 tag，那是被生产验证过的组合）；AgentBridge 唯一切面；升级=显式动作+回归 |
| renderer origin/CORS：file:// 加载会被 server CORS 拒 | 自定义特权 scheme（§3 运行期 3），spike-1 ③ 验证 |
| 构建期网络依赖：generate.ts fetch models.dev | vendor api.json 快照 + `MODELS_DEV_API_JSON` env |
| 附属产物：wasm 漏复制（运行时才炸） | §3.1 清单显式勾选；原生模块已按 T-18 归零（PTY 桩 + 不带 watcher），`.node` 相关风险整类消失 |
| PTY 桩在升级 vendor tag 后失效 | 属"响亮的失败"（启动即抛错），spike-1 ⑥ 与每次升 tag 的回归都覆盖 |
| CM6 揭示 × IME | spike-2 最先做；不过关则收窄揭示范围保输入 |
| win/linux 无日常自用覆盖 | CI smoke 三平台跑；发布前手测清单 |
| 共享全局 opencode 配置被用户端改坏 | 缺席态兜底；⌘⇧I 显示引擎状态与错误摘要 |
| bun 成为构建依赖 | 仅 CI/开发机需要，产物不含；版本钉在 workflow |

## 15. MVP 范围对照

实现范围 = `sepia-prototype-features.md` §1a 非设置页全部（H4-H7、F1-F5、F7-F16、F19、F21-F23、G1-G5；F14 多 Tab 按已定口径进 MVP；F18 见 T-16：MVP 交系统浏览器、内嵌浏览器退回产品层裁决）；衰减项照 §1b（H1-H3、F6、F20、trace、记忆）；S1-S5 设置 UI 不做，全部默认值进 `defaults.ts`（来源 `sepia-settings.md`）。


## 16. 讨论与推翻记录（2026-08-03）

本节记录结论**变化的过程**——推理比结论更难重建，而重议往往起于忘了当初为什么否掉。

### 16.1 「改写用户字节」具体指什么

AST/schema 模型的序列化器会做的规范化，逐条都是真实会发生的：强调符 `_foo_` ↔ `*foo*`；列表标记 `-` `*` `+` 统一；有序列表重编号（很多人有意写 `1. 1. 1.` 让 diff 干净）；Setext 标题 `===` 转 ATX `#`；代码围栏 `~~~` 转反引号、围栏长度规整；缩进 tab / 空格与列表缩进宽度统一；行尾两空格的硬换行被改写；**软换行重排**（毁掉「一句一行」的写法）；连续空行压缩；引用式链接 `[a][ref]` 内联化；表格对齐空格重填；frontmatter 键序与引号风格；尾部空白与文件末换行。

**对 Sepia 的具体伤害**（不是洁癖，是四条功能会坏）：

1. **git diff 爆炸**——改一个词，序列化器重排全文，diff 显示整篇都变了。这直接摧毁 D-08（版本靠 git）、D-18（徽章 diff）、D-19（成对 commit 夹出 diff）——徽章点开看到的将是噪音。
2. **锚点失准**——锚点靠字符区间加引文，全文重排后 hunk 平移完全失效。
3. **与现有管线冲突**——`art/` 是数年真实文章且发文走既有管线；一打开就全库重排等于灾难。验收清单要求「Sepia 写的 md 直接进现有 publish 管线，零清洗」。
4. **抹掉有意的写作习惯**——`1. 1. 1.`、一句一行，这些是为了 diff 干净而做的选择，不是随手。

**精确表述的修正**：不变量原写「永不改写用户字节」，正确说法是**「只重写用户当次编辑所触及的最小区间，未触及的字节逐字节保留」**。这不是措辞问题——它决定了 T-23 的 widget 内 WYSIWYG 这条路开不开。

### 16.2 五次推翻

| 项 | 变化 | 触发与教训 |
|---|---|---|
| 先行验证清单 | 4 项 → 1 项 → **0 项** | 用户追问「spike 中文含义是什么，哪些一定要验证」→ 逼出准入判据「结论若相反，下游要不要返工」；再问「业界没有实践吗」→ 发现构建产物就躺在本机硬盘上（`dist/` 被 gitignore 且未跟踪 = 本地真跑过），且 submodule 工作区与普通 checkout 逐字节相同、不构成新变量。**教训：把「我没亲眼见过」当成「需要验证」** |
| T-16 外链 | 系统浏览器（无理由）→ 三路菜单 → **阅读模式** | 首版理由是从产品文档继承来的对冲措辞（「MVP 可退回交给系统浏览器」），不是推导。用户指出 Electron 明明能做 → 查证后真实约束是 iframe 被 `X-Frame-Options` 拦且失败不可检测、原生视图与浮层语汇冲突；用户再指出原型放右栏 → 该冲突大幅缩小，真正的分岔改为「用什么装外链」，最终落到阅读模式（还白赚了正文可 `@` 进上下文）。**教训：继承来的对冲措辞不是结论** |
| T-11 引擎环境 | 状态隔离 + 配置共享 → **完全隔离** → 凭据归属澄清 | 用户要求「哪怕用户配了一大堆东西也不污染 Sepia」→ 读码确认四个 XDG 根在模块加载期算死，设满即可完全隔离；随即发现凭据（`auth.json`）在 `XDG_DATA_HOME` 下会一并隔离，与 D-36 冲突；用户裁定「token 本来就该在 Sepia 管控」→ 归属问题澄清，再查得 API key 类可全程留内存、OAuth 类才需落盘 |
| T-18 patch | 不 patch（硬约束）→ **成本阶梯** | 用户判定「最终肯定是要 patch 的」。原写法把手段写成了禁令；改为配置层 → 构建脚本 → patch → fork 分支的成本阶梯，并保留 patch 的可复现可审计纪律 |
| wasm / node-pty | 并置为「跨平台风险」→ **拆成两类** | 用户质疑「wasm 不是本来就跨平台吗」。属实——wasm 三平台同一份字节，真问题只是构建管线的文件搬运；只有原生模块才有平台分发问题，而它们后来还被归零了。**教训：两个性质不同的东西写成一句话，等于两条都没说清** |

### 16.3 我的错误模式（供后续会话自查）

1. **先写后核实**。鉴权走 env 不走 listen 参数、`opencode.json` 该内存注入、wasm 无跨平台问题、构建产物已存在——四条都是「按模式匹配断言，核实后发现不对」。正确顺序是读完再写一次。
2. **把「我没见过」当「需要验证」**。证据往往在上游的生产代码里，或就在本机硬盘上。
3. **继承别处的对冲措辞当结论**。技术文档里出现没有技术理由的降级，本身就是信号。
4. **判据发现得太晚**。准入判据到 §12 才想出来，本该统治全文。

### 16.4 文档体例的确立

本轮末尾拆成两份：`sepia-architecture.md`（结论与原则，写代码对着它）与本文档（论证、证据、推翻过程）。架构文档的骨架为：**约束 → 形状 → 决策（含重评触发条件）→ 逐域（每域挂实现纪律）→ 纪律总表 → 验证 → 边界 → 风险**。顺序按读者判断力的依赖关系排：约束先行，因为后面每条决策都要拿它当尺子；决策前置，因为它是主干而非附录；纪律汇总单列，因为那是实施期真正天天翻的一页。


## 17. 编辑器内核能力对比（D-02 的支撑材料）

对比轴不取通用功能表，只取 Sepia 的不变量与已定功能所要求的能力。

| 能力 | CodeMirror 6 | ProseMirror 系（TipTap / Milkdown） | Lexical | 块模型（BlockSuite / Protyle） |
|---|---|---|---|---|
| **字节保真**（A2） | ✅ 天然——编辑器内容**就是**文件 | ❌ 结构性做不到 | ❌ 同左 | ❌ 更远 |
| **坐标系数量**（D-18 锚点 / git diff） | **1**（字符偏移 = 文件偏移） | 2（文档位置 ↔ 文件偏移），需映射层且随序列化漂移 | 2 | 2 + 块 id |
| **元素级揭示**（D-25） | 可做，但**全靠自己写**（decoration + widget） | 可做，但在跟 WYSIWYG 的默认取向对着干 | 可做 | 与其块模型绑定 |
| **中文 IME** | ⚠️ decoration × composition 有已知边界（上游 issue 家族），须按规则规避 | ✅ **强项**，composition 处理是其老本行 | ✅ 投入较多 | 各家自理 |
| **2 万字不降速** | ✅ 视口渲染 + 行虚拟化，强项 | ⚠️ 整篇进 DOM，无内建虚拟化，大文档是已知弱点 | ⚠️ 好于 PM 但非虚拟化文本编辑器 | 块级懒渲染，通常可以 |
| **组件块 widget** | ✅ | ✅ NodeView 很强 | ✅ | ✅ |
| **表格编辑** | ❌ 纯文本编辑 md 表格，体验差 | ✅ 成熟 | ✅ | ✅ |
| **可借鉴实现** | Obsidian（形态一致）、atomic-editor、codemirror-live-markdown | Milkdown 本身就是 md live preview 形态 | md live-preview 成品较少 | 与自家后端强绑定 |

**决定性的一条不是"谁更强"，是"把哪一条当不变量"。** Sepia 把 A2（文件即真相、永不改写用户字节）立成不变量，这一条直接让 AST/schema 系全部出局——**不是它们弱，是它们的文档模型里没有地方存放「用户当初写的是 `_foo_` 而不是 `*foo*`」**。序列化规范化不是 bug，是模型选择的必然结果；要保真就得额外挂一层 source-map，那等于把 CM6 的单坐标系优势重新买回来一次。

**代价要认**：选 CM6 = 用字节保真与单坐标系，换掉了**表格编辑体验**（md 表格纯文本编辑很难受）与**开箱即用的 live preview**（CM6 只给装饰能力，live preview 得自己写，Obsidian 也是自己写的）；IME 上也是从 ProseMirror 的强项换到 CM6 的已知边界——这正是 T-17 那条硬规则存在的原因。

**混合方案不适用**：业界常见的「PM 做正文 + CM6 做代码块」（如 `prosemirror-codemirror-6`）解决的是「WYSIWYG 里怎么编辑代码」，而 Sepia 全篇都是源码态，不存在这个问题。

## 18. 下一步

1. **走查收敛**（进行中）：本轮已产出 T-13~T-19；剩余异议继续入 T-xx 修订
2. ~~回写 `sepia-mvp-decisions.md`~~ **已完成（2026-08-03）**：新增 D-38（术语 book/page）、D-39（F18 = 阅读模式）、D-40（图片目录默认 `assets/`）；D-04→T-01、D-13→T-19、D-22→T-02 三条修订指针已加；该文件内 vault 已清洗
3. ~~术语清洗~~ **已完成（2026-08-03）**：happy-path / non-goals / settings / prototype-features / feature-v2 / CLAUDE.md 全部清洗；library 语义的「库」（音效库/素材库/编码库/文献库）与原型示例名  按原样保留
4. **ultra spec 可直接开写**：§12 复审后**已无阻塞性先行验证**（证据链见 §12.0）；§12.1 的六点降级为 Day-1 骨架核对清单，§12.3 的读码清单在写 spec 时同步做掉
5. **ultra spec**：目录/文件级实施蓝图 + stage 拆解（进 `specs/plan/`）→ 回 Claude Code 实施
