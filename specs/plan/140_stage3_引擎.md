---
stage: 3
title: 引擎
status: done          # 2026-08-05 关闭：1.6b 真人轮通过，2+3 已合并（人裁跳过仪式验证，被跳项记债于文末）
dod: kill -9 引擎后纸全功能可写；⌘K 给缺席提示；冷启动同步路径仍无引擎（纪律 12 打点复测）
checks_added: 9        # 类型 1（BookDirectory 负向断言）· bridge 不变量子条 1 · 专项脚本 2 · 单测 2 · smoke 3
checks_reverse_verified: 9   # 9/9，见 §1.5。其中 ① 与 ⑨ 首轮验出空转，已改到有效
exemptions: 8          # 1 → 8（+7）：agent-bridge 出口 1 · 引擎四个 XDG 根 4 · 凭据只读导入 2
disputes: 0
measured:
  cold_start_p50_ms: 未测    # 人裁 2026-08-05：本轮不做性能测量。单次对照（load≈5）：本 stage 768ms vs HEAD 基线 1049ms —— 无回归，但基线自身已达不到 120 记的 440ms（见 §1.7）
  engine_spawn_to_ready_ms: 2270   # fork→ready（import 1490 + listen 370 + 余量），真对话探针复测 3150
  kill9_to_absent_state_s: 34.5    # smoke 实测：连杀 → 三次退避（0.5+2+5s）→ 缺席稳态，含三次 fork→ready
  bundle_mb_delta: 34.7            # 单文件 ESM 30.5MB + 4 wasm 4.2MB（不含 sourcemap，未打进产物）
  check_full_s: 11.3               # lint 0.2 ｜ typecheck 8.1→0.2(缓存) ｜ deps 0.9 ｜ bridge 0.3 ｜ workspace 0.1 ｜ artifacts 0.1 ｜ patches 0.4 ｜ marks 0.2 ｜ test 1.7
  reverse_coverage: 1.0            # 9/9
  dead_checks: 0                   # 首轮 2 条（① BookDirectory、⑨ XDG 隔离），均已改到有效
---

# 140 · Stage 3：引擎

> 模板：003 §1 ｜ 上游：001 §7、002 §7、架构 §2.1 §4.1 §4.3 §5 ｜ 基线：120（Stage 1，已关闭）
> 原型对照：W12（Agent 缺席）——CLAUDE.md「交互原型」节

> **这个 stage 交付的是不变量 1 的后半句**：Agent 到场了，但**纸不因它多一毫秒等待、不因它死掉少一分功能**。
> 结束时引擎作为 sidecar 活在窗口后面：能拉起、能对话（AgentBridge 五方法通）、能被强杀而纸无感。
> **markup 的 UI（浮层/diff/落笔）一概不在**——那是 Stage 4。本 stage 的「能对话」只需在测试里可证。

---

## 1.1 前置

### 〇、并行声明（本项目首次双 stage 并行）

**基线是 Stage 1 的关闭状态，不是 Stage 2 的完成状态。** Stage 2（语法）此刻在另一 worktree 在飞。
并行成立的依据，逐条对过：

| 条件 | 本组合（2 ∥ 3）的情况 |
|---|---|
| 包不相交 | Stage 2 住 `editor`/`ui`/renderer；本 stage 住 `agent`/`app main`/`vendor`。`editor ↮ agent` 刻意不连线（001 §2.2），连 import 都碰不上 |
| 暴露面无重叠 | 130 已声明 Stage 2 不增 preload 暴露面；**本 stage 是唯一动桥的**（AgentBridge，见 §1.3） |
| 共享注册表仅追加 | `dep-graph.json` / `bridge-snapshot.json` / `package.json` catalog / `core/types`：两边只加不改，冲突可机械合并 |
| 人工 gate 错峰 | 本 stage 真人项极少（§1.6b 三条），排在 Stage 2 §1.6b 批量验收之外 |

**合并仪式（写死，合并者执行）**：先合 Stage 2 → 本分支 rebase → 合并后主干重跑
全量 `check` + **两个 stage 的全部 smoke** + 冷启动打点复测（纪律 12 是防"引擎爬上启动路径"
的守卫，合并后重测才算数）。

**§1.9 记回流**：003 需新增「stage 并行的准入条件 + 合并仪式」一节——本节四条件与仪式即草案。
规则不落 003，下一次并行就是凭感觉。

### 一、Stage 1 的 DoD 达成情况
已关闭（120，2026-08-04）：冷启动 P50 440ms / P90 450ms ✓、反向验证 14/14、
人工 9 通过 1 延后、dead_checks 0。本 stage 的打点断言直接继承其口径（t0–t5，架构 §4.7）。

### 二、继承的延后账，重问「现在有条件了吗」
| 账 | 本 stage 裁决 |
|---|---|
| `.dmg` + 打包产物重验 | **继续延后**（人裁 2026-08-04：先不管 release）。注意本 stage 的 `check:artifacts` 会让"产物可查"第一次成立，是未来收这条账的前置 |
| `.AppImage` / `.exe` 长期债 | 不动。但引擎产物是纯 JS + wasm（原生模块已归零，架构 §4.1），三平台打包管线只需复制文件——本 stage 顺手验证 CI 三平台构建仍绿即可 |
| `/harness` 看板 | **不做（人裁 2026-08-04，第二次推）**。继续挂在延后账上，下一 stage §1.1 再问。连续两次被推本身是个信号：若 Stage 4 再推，应改问「它到底要不要存在」而不是「这次做不做」——**2026-08-05 裁死：看板不做**，此账关闭（落 003 §3 头注） |

### 三、002 §7 排给本 stage 的四条，逐条对宿主
| 项 | 宿主 | 裁决 |
|---|---|---|
| 类型层第三条 `BookDirectory` | AgentBridge `send` 本 stage 出现 | **做**。每请求显式带 `directory`，类型上没有不带的调用方式（002 §2.1 模式）。**B.2 的元教训先问过**：send 是碰 directory 的唯一通道吗？是——组件只能经 AgentBridge（架构 §4.3 原则一），成立 |
| `check:artifacts` | vendor 构建产物本 stage 出现 | **做**：单文件 ESM + 四份 wasm 齐全、体积记录 |
| `check:patches` | patch 机制本 stage 建立 | **做**：`git apply --check` 硬失败不静默（架构 §4.1 原则二）。**即使首版零 patch 也要建**——它守的是"偏离上游必须可审计"这条路，路先修好 |
| `check:bridge` 不变量级子条单列 | 桥本 stage 第一次为 Agent 增长 | **做**：「preload 不得暴露绕过 CAS 或给 Agent 开写路径的通道」（110 §1.4 注①）升独立检查。**agent 域的方法列表必须恰好是五方法 + 状态订阅，多一个即红** |

### 四、凭据存储的实现选型（阻塞项，就地裁）
架构 §4.1 说"存系统钥匙串"。实现有两条路：`keytar`（原生模块——**违反 T-18 原生依赖归零**）
或 Electron 内建 `safeStorage`（OS 钥匙串背书的加密，无原生依赖）。
**裁决：`safeStorage`**，密文落 `~/.sepia/` 自有目录。与 T-18 一致，且 §1.9 回流请人在
架构 §4.1 把"系统钥匙串"细化为"safeStorage（钥匙串背书加密）"。
MVP 只做 API key 类；OAuth 类明确不做（架构 §4.1 已定）。

---

## 1.2 范围

### 做什么（001 §7 Stage 3 行）

**vendor 构建**
- [x] `vendor/opencode` submodule **锁最近一次 release tag**（人裁 2026-08-04）。起草时上游最新为
      `v1.18.13`（2026-08-04 发布）——实施首日以当日最新 release 为准锁定，**锁定后整个 stage 不动**（刹车表），实际 tag 号记回此处
      → **已锁定 `v1.18.13`**（commit `a105350812f05f914c768e468559dbd6bd508d8e`，release 发布于 2026-08-04T12:12:32Z，实施日 2026-08-04 复核仍为最新）
- [x] `scripts/build-engine.ts`：vendor 根 `bun install` → `build-node` → 产物（单文件 ESM + 4 wasm）复制到位
- [x] 挂 `predev` / `prebuild`（001 §1 的 [S3] 标注此刻兑现——Stage 1 刻意没挂，现在该挂了）
- [x] `vendor/` 排除在 workspace glob 外；构建期不依赖网络（submodule + lockfile）
- [x] ~~electron-vite `virtual:opencode-server` 指向产物~~ **改法已变**：产物**不经 rollup**。
      sidecar 在运行期 `import` `packages/app/engine/node.js`（路径经 `SEPIA_ENGINE_ENTRY` 在
      fork 时注入）。理由有二：① 30MB 的单文件 ESM 过一遍 rollup 只是白烧构建时间，且会改动字节，
      `check:artifacts` 就失去稳定的被检对象；② 四份 wasm 按 `import.meta.url` 的**相对路径**定位，
      必须与 bundle 同目录——虚拟模块塞进 out/main/chunks 反而要额外搬运。上游 desktop 用
      `virtual:` 是因为它把 sidecar 也打进同一个 bundle，我们的 sidecar 是独立 entry，不需要

**sidecar 生命周期**
- [x] `main/services/agent-supervisor.ts`：`utilityProcess.fork`，**窗口可见之后异步拉起**（纪律 12：同步路径上没有它）
- [x] 四个 XDG 根全部指向 `~/.sepia/engine/`，**fork 时设定**（模块加载期就把路径算死，事后改无效）
- [x] 配置经 `OPENCODE_CONFIG_CONTENT` 内存注入；隔离目录保持为空；book 内不落配置
- [x] 鉴权走环境变量，不走 listen 参数（实测：带 auth 200 / 不带 401）
- [x] 崩溃退避重启 ≤3 次 → 「Agent 缺席」稳态；就绪/缺席状态推给 renderer

**凭据（§1.1 问题四已裁：safeStorage）**
- [x] `main/services/credentials.ts`：API key 加密落 `~/.sepia/credentials.json`，fork 时注入 `provider.<id>.options.apiKey`
- [x] **实施中长出来的一条（原计划没有）**：导入时**定义与密钥分家**。用户的自定义
      openai-compatible provider（`~/.config/opencode/opencode.json` 的 `provider` 段）光有密钥
      没有定义是用不了的，所以两样都得取；但定义是非秘密（npm / baseURL / models），密钥是秘密。
      定义进明文 `~/.sepia/config.json`，密钥进 safeStorage 密文，**只在 fork 的 env 里合流**。
      这正是 §1.3 表里「config.json 拟增 provider/model 字段」的兑现，且两个字段都真被读取
- [x] 引擎侧零落盘：隔离目录内不出现凭据文件（有检查，见 §1.5）
- [x] 首次无凭据时从用户 opencode 凭据文件**只读导入一次**；永不写用户 opencode 的任何文件

**AgentBridge 五方法**
- [x] `agent` 包：`openThread` / `send` / `stream` / `interrupt` / `listModels`，内部 `@opencode-ai/sdk`，端点以锁定 tag 的 OpenAPI 为准
- [x] `BookDirectory` 类型：`send` 的 `directory` 参数类型上必带
- [x] SSE：字符串字段增量拼接、其余整 part 替换、心跳区分"模型停了/连接死了"、未知事件忽略
- [x] renderer 侧最小消费面：**只到状态提示**——顶部细提示线（缺席时）+ ⌘K 唤起时的缺席文案（W12）。真浮层归 Stage 4

### 明确不做什么

**属于 Stage 4 的**（一件都不碰）：markup 浮层与家具、任务四元组、块式上下文、流式渲染 UI、
diff、落笔 CAS、system prompt 常量、类型层第四五条。

**最容易顺手带出、必须刹住的**：

| 会顺手带出的东西 | 为什么手会滑 | 刹车 |
|---|---|---|
| **⌘K 真浮层** | 缺席文案都显示了，输入框仿佛只差一步 | 本 stage ⌘K 只显示状态。浮层的形态、家具、上下文全是 Stage 4 的设计负载 |
| **在纸上测一轮真对话** | 五方法通了就想接进 UI 看看 | 对话可证性在**测试里**完成（§1.5 smoke 走 bridge 收流），不进 renderer UI |
| **OAuth 凭据** | API key 写完顺手就想支持登录 | 架构 §4.1 明确 MVP 不做 |
| **PTY / 文件监听补桩** | 上游功能看着就在那 | PTY 保持调用即抛错；watcher 归 Stage 6 |
| **升级 opencode tag** | 新 tag 有新功能 | 锁定 tag 整个 stage 不动；升 tag 是独立事件（patch 必重验） |
| **给引擎开写路径** | 调试时"让它自己改文件多方便" | **不变量 3/4。** check:bridge 不变量级子条就是防这个，红了别绕 |
| **`main/services/git.ts`** | commit 与引擎都在 main 侧，顺手想建 | GitService 归 Stage 5 |

---

## 1.3 代码结构与功能深度

| 包 | 本 stage 新增 | 深度 |
|---|---|---|
| `agent` | AgentBridge 五方法 + SSE 解析 + `BookDirectory`（首次有真实内容） | 只到"五方法可用、可测"。上下文组装（`context.ts`）归 Stage 4 |
| `app` | `main/engine/`（build 产物装配）、`main/services/{agent-supervisor,credentials}.ts`、renderer 状态提示线 | supervisor 只管生命周期；renderer 只到状态显示 |
| `core` | 引擎状态类型、`BookDirectory`、copy（缺席文案等） | — |
| `editor` / `ui` | **不动**（Stage 2 的地盘,并行纪律） | ui 若需提示线样式,变量用现有表,不新增组件库依赖 |
| 根 | `vendor/opencode` submodule、`scripts/build-engine.ts`、`scripts/check-{artifacts,patches}.mjs`、`patches/`（可为空） | — |

### 新增对外暴露面（预先声明，003 §1.3）

| 类别 | 内容 |
|---|---|
| **preload 白名单** | **已探定（§1.8 风险 1 → main 代理）**：增 `api.agent.*` **八项**——五方法透传（`openThread` / `send` / `stream` / `interrupt` / `listModels`）+ `status()` + `onStatusChange(cb)` + `onEvent(cb)`（stream 的 SSE 事件经 IPC 推送的订阅腿，与 `stream` 同属一条流式通道的收发两半）。**恰好这些，多一个 `check:bridge` 子条即红**。端点与 token 不进 renderer |
| **包依赖** | `@opencode-ai/sdk` → `agent`；submodule 不算依赖。**无新原生模块（T-18）** |
| **配置字段** | `config.json` 实增**两个**：`provider`（provider 定义，**无密钥**——npm / baseURL / models）与 `model`（`providerID/modelID`）。两个都由 `agent-supervisor` 真读（拼 `OPENCODE_CONFIG_CONTENT`），符合「只加本 stage 真正读取的」 |
| **环境变量** | Sepia 自身不新增。**引擎子进程 env 单列**：四个 XDG 根、`OPENCODE_CONFIG_CONTENT`、鉴权变量——只进子进程,不进 Sepia 环境,不落盘 |
| **磁盘** | `~/.sepia/engine/{config,data,state,cache,home}/`（四根 + HOME 兜底所指）、`~/.sepia/credentials.json`（safeStorage 密文信封，无任何明文字段） |
| **构建产物** | `packages/app/engine/`（.gitignore 内，5 个文件 34.7MB + 引擎侧 node_modules 两个 external）。打包走 `extraResources` 落在 **asar 之外**——sidecar 要在运行期 import 它，wasm 按相对路径定位，asar 内两件事都做不到 |

---

## 1.4 harness 增量

| # | 检查 | 守什么 | 阶梯层 | 硬度 |
|---|---|---|---|---|
| 1 | **`BookDirectory` 类型** | send 必带 directory（纪律 10 类型化） | 1 类型 | 纪律级 |
| 2 | **`check:bridge` 不变量级子条** | agent 域方法列表 == 五方法+状态订阅；**无任何给 Agent 的写路径**（110 §1.4 注①） | 4 专项脚本 | **不变量级（不变量 3/4，无豁免）** |
| 3 | `check:artifacts` | 产物齐全（ESM+4 wasm）、体积记录 | 4 专项脚本 | 纪律级 |
| 4 | `check:patches` | patch 可复现：`git apply --check` 硬失败 | 4 专项脚本 | 纪律级 |
| 5 | 单测 · SSE 解析 | 增量拼接/整 part 替换/心跳/未知事件忽略 四条协议规则 | 5 单测 | 纪律级 |
| 6 | 单测 · 退避状态机 | ≤3 次重启 → 缺席稳态；就绪↔缺席迁移 | 5 单测 | 纪律级 |
| 7 | **smoke · kill -9 后纸可写**（DoD） | 强杀引擎 → 写字/⌘S/重开全通；缺席提示出现 | 5 smoke | 纪律级 |
| 8 | **smoke · 同步路径纯净复测** | t0–t5 打点仍在预算内，引擎 fork 发生在 t3 之后（纪律 12） | 5 smoke | 纪律级 |
| 9 | smoke · 隔离与零落盘 | 引擎全部路径落在 `~/.sepia/engine/` 下；隔离目录无凭据文件 | 5 smoke | 纪律级 |
| 10 | `/harness` 看板 | 若 §1.1 裁"做"：003 §4.5 的债务面板 | — | — |

## 1.5 自动化验证

> 口径按 003 §3.2。破坏方式随检查预写（C.1 教训）。**全部九条都真跑过一遍破坏**
> （脚本：`scratchpad/verify-red.sh`，逐条改一处 → 跑对应检查 → 期望非零退出 → 从副本还原）。

| # | 检查 | 预定破坏方式 | 结果 |
|---|---|---|---|
| ① | `BookDirectory` | 类型放宽成 string / send 去掉参数 → typecheck 必红 | ✓（**首轮空转，已修**，见下） |
| ② | bridge 不变量子条 | preload 的 agent 域偷加一个 `writeFile` 方法 → 必红 | ✓ |
| ③ | `check:artifacts` | 删一份 wasm → 必红 | ✓ |
| ④ | `check:patches` | 注入一个 apply 不上的 patch → 必红（首版零 patch 也要用假 patch 验一次这条路） | ✓ |
| ⑤ | SSE 单测 | 把增量拼接改成整段替换 → 必红 | ✓ |
| ⑥ | 退避单测 | 去掉重启上限 → 必红 | ✓ |
| ⑦ | kill -9 smoke | 注释掉缺席稳态迁移 → 必红 | ✓ |
| ⑧ | 纯净复测 | 把 fork 挪到窗口可见之前 → 打点断言必红 | ✓ |
| ⑨ | 隔离 smoke | 少设一个 XDG 根 → 路径逃逸断言必红 | ✓（**首轮空转，已修**，见下） |

**反向验证覆盖率 1.0（9/9）。但首轮是 7/9——两条空转是这个 stage 最有价值的产出：**

**① 品牌类型守不住自己。** 把 `BookDirectory` 放宽成 `string` 之后 typecheck **全绿**。
原因很简单，回头看却不明显：生产路径上每一处 `directory` 都经 `asBookDirectory` 构造，
**没有任何一处拿裸 string 去撞这个类型**，于是放宽与否没有可观测差别。
修法是加一份**负向类型断言**（`packages/agent/test/book-directory.test-d.ts`）：用
`@ts-expect-error` 把「裸 string 必须编译不过」本身变成断言——类型一放宽，
那些 `@ts-expect-error` 就成了「无用的忽略」，tsc 立刻报错。
**元教训**：类型层的纪律（002 §2.1 那一族）默认是空转的，除非专门写反例。
Stage 4 的类型层第四五条上来就要带 `.test-d.ts`，不能等反向验证再发现。

**⑨ 断言站错了位置。** 少设一个 XDG 根之后，引擎并没有逃出隔离根——它按 `HOME` 兜底
算路径，而 `HOME` 也被我们指进了 `~/.sepia/engine/home`，于是「逃逸」落在
`engine/home/.config`，**仍在根内**，原断言（查 `$HOME` 下有没有 `.config`）抓不到。
修法是换判据：四个 XDG 根各自派生的 `opencode` 目录**必须都在**（少一个即缺一个），
外加「`engine/home` 下不得出现 XDG 影子目录」（出现即回落）。
**元教训**：隔离做得越彻底，「逃逸」的表现就越隐蔽——断言要盯**正确形态齐不齐**，
而不只是盯「有没有跑到外面去」。

## 1.6 验证（两栏制,沿 130）

### 1.6a CC 代验（证据留档,人抽查）
| # | 项 | 方式 | 结果 |
|---|---|---|---|
| a1 | 构建产物齐全可起 | build-engine → check:artifacts → spawn → 就绪 | ✓ `v1.18.13@a105350` → 5 个文件 34.7MB；`check:artifacts` 绿；最小 spawn 探针 fork→ready 2.27s（import 1.49s + listen 0.37s） |
| a2 | kill -9 全链 | smoke#7 + 手工 kill 脚本 | ✓ smoke「kill -9 引擎后纸仍全功能可写」34.5s 通过：连杀 → 三次退避 → 缺席稳态 → 提示线出现 → 打字 → ⌘S → **文件里读得到那行字** |
| a3 | 退避与缺席态 | 连崩 3 次 → 提示线 | ✓ 同 a2（提示线由 smoke 断言 `.sepia-agent-line` 可见，不是截图） |
| a4 | 隔离与零落盘 | smoke#9 + 目录清单 | ✓ 四个 XDG 根派生的 `opencode/` 齐全；`engine/home` 无回落影子；隔离根外零文件；全树无 `auth|credential|token|.key` |
| a5 | 五方法真对话 | 走 bridge 发真请求收流 | ✓ **真 key 真模型**（用户 `~/.config/opencode/opencode.json` 的 provider，仅内存注入、不落仓库）：listModels 18 个、openThread、send 204、stream 收到 `message.part.delta` 并拼出回答、interrupt 200。首 token 500ms，全程 7.3s |
| a6 | 冷启动对比 | 10 次 P50/P90 vs Stage 1 | **未做（人裁 2026-08-05：机器负载过高）**，见 §1.7 |
| a7 | 单实例回归 | 二次启动开新窗口仍通 | ✓ 随 Stage 1 的 `write-save-reopen` smoke 一起绿（全量 `check` 的 test 步 + smoke 各跑过） |

### 1.6b 真人（压到最少）——**三条都未做，留给人**
- [ ] **首次凭据导入流程**：safeStorage 首次访问的系统授权对话框、导入确认的文案观感。
      **实施中发现一个必须由人复核的行为改动**：原实现一进来就调 `isEncryptionAvailable()`，
      macOS 上它会去找钥匙串里的 "Electron Key"，找不到就弹**模态**系统对话框——挡在启动路径上，
      用户不点掉就不能写字（正撞不变量 1，用户实测截图为证）。现改为**无凭据可读时一次都不碰
      safeStorage**（先做纯文件判断）。因此这条真人项的观察对象变了：要在**真有凭据可导入**的
      机器上看那个授权框，而不是在空 HOME 上
- [ ] **W12 走查**：缺席提示线 + ⌘K 缺席文案,对照原型的克制程度（细线,不弹窗）
- [ ] **kill -9 手感**：终端强杀,纸上连续打字,确认无一帧卡顿——体感项
- [ ] 抽查 1.6a 证据包（至少 2 条）

## 1.7 实测记录

预算：冷启动 t0–t5 **仍 <1s 且与 Stage 1 同量级**（引擎不在同步路径,理论零影响——测出影响即违反纪律 12）；
`engine_spawn_to_ready` 记基线无硬预算（首 token <3s 的预算属 Stage 4,但这段是它的组成部分,先有数）；
测法沿 120 §1.7（构建产物、P50/P90、`.app` 口径延后账不变）。

### 冷启动：**本轮不测（人裁 2026-08-05）**

机器此刻 load average 61（Stage 2 的 worktree 在跑自己的 Playwright smoke，本 stage 又在
反复构建引擎与打包）。在这种负载下测出来的数字既不能证明达标、也不能证明回归——120 §1.7
「换机器测就等于换了基线」，换负载同理。

**但过程中做过一次归因，结论要留下**：初测 t0→t5 约 1035ms（Stage 1 基线 440ms），
于是开了一个 HEAD 的 worktree 当**同机基线**交替测。两轮都指向同一结论——差异来自机器状态：

| 负载 | HEAD 基线（Stage 1 代码） | 本 stage |
|---|---|---|
| load ≈ 61（Stage 2 worktree 在跑 smoke） | 1769–3469ms | 830–1300ms |
| load ≈ 5（安静下来后，各跑一次 `cold-start.spec.ts`） | **1049ms**（超预算） | **768ms**（在预算内） |

**两个负载下本 stage 都不比基线慢**，所以「引擎让冷启动变慢」这件事没有发生。
但同样要写清楚：**基线自己就已经达不到 120 §1.7 记的 440ms** ——同一测法、同一台机器、
安静负载下也要 1049ms。这不是本 stage 造成的，但它意味着 **120 的 440ms 这个基线数字
在当前环境下不可复现**，`cold-start.spec.ts` 的本地断言因此会红。这笔账不属于本 stage
（人裁 2026-08-05：本轮不做性能测量），但下一个 stage 的 §1.1 必须问一句「基线到底是多少」，
否则这条 smoke 会长期红着、然后被当成噪音忽略——那才是真正危险的地方。

同时查了一件能脱离负载判定的事：`out/main/index.js` 的顶层 `require` 集合。
**这一查抓到一个真回归**（见下）。

### 抓到的真回归：SDK 爬上了同步启动路径

`agent-supervisor.ts` 里 `import { AgentBridge } from '@sepia/agent'` 是**值导入**，
经 `externalizeDepsPlugin` 变成 main bundle 顶层的 `require("@sepia/agent")`，
连带把 `@opencode-ai/sdk` 的整张模块图拉进**同步启动路径**——纪律 12 的字面违规。
改成 `import type` + 引擎就绪后 `await import('@sepia/agent')`；`jsonc-parser` 同理。
判据不用计时：**顶层 require 集合回到 Stage 1 的样子**（`@sepia/core`、`electron`、`node:*`），
这一条在任何负载下都成立。

### 引擎启动的时机：从 t3 之后改到 t5 之后

原实现挂在窗口 `show`（t3）后，实测 fork 落在 t4/t5 **之前**几十毫秒——纪律 12 的字面
（fork 在 t3 后）守住了，§1.7 的实质（引擎不许让冷启动变慢）没守住：引擎 import 那 1.5s
的重负载正好和「读文件 + CM6 就绪」抢 CPU。现改为 **t0–t5 攒齐之后**触发，并留 2s 兜底
定时器（空状态下 renderer 根本不发 t4/t5，没有兜底引擎就永远不起来）。
smoke#8 的断言也跟着从「fork 晚于 t3」加严到 **「fork 晚于 t5」**。

### 已测到的数（与负载无关或不敏感的）

| 指标 | 预算 | 实测 |
|---|---|---|
| `engine_spawn_to_ready` | 无硬预算（架构 §1.1：≤5s 后台） | **2.27s**（import 1.49 + listen 0.37）；真对话探针 3.15s |
| 首 token（a5 真对话，参考） | Stage 4 的预算是 <3s | **0.5s**（qwen3.7-plus，全程 7.3s） |
| kill -9 → 缺席稳态 | ≤3 次退避（0.5+2+5s）+ 三次 fork→ready | **34.5s**（smoke 全程） |
| 引擎产物体积 | 记录基线 | **34.7MB**（node.js 30.5 + 4 wasm 4.2），`.node` 零 |
| vendor 冷装 + 构建 | 无预算，定 CI 策略 | `bun install` 38.5s（冷、联网）｜`build-node` 4.7–16.4s |
| `bun run check` 全量 | <30s（002 §3） | **11.3s**（9 步，含新增 artifacts/patches 各 0.1/0.4s） |
| `harness-exempt` 总数 | 0（只增不减即腐化） | **8**（1 → 8，+7：见下） |
| `harness-dispute` 总数 | 0 | **0** |
| 反向验证覆盖率 | 1.0 | **1.0**（9/9，首轮 7/9） |
| 空转检查数 | 0 | **0**（首轮 2 条，均已改到有效） |

**豁免涨了 7 条，逐条交代**（这是本 stage 最该被人抽查的数字）：
`renderer/services/agent-bridge.ts` ×1（纪律 1——它是 `window.api.agent` 之上的唯一封装，
与 `api.ts` 并列的第二个出口）；`agent-supervisor.ts` ×4（纪律 20——四个 XDG 根，
它们**正是**「应用自有文件只写 ~/.sepia」的实现而非违反：全部指进 `~/.sepia/engine/`）；
`credentials.ts` ×2（纪律 20——读用户自己的 opencode 数据根与配置根，架构 §4.1 明文
规定的一次性只读导入）。**七条里没有一条是「先豁免、以后再说」**；若下个 stage 还想往
纪律 20 上加豁免，应先问这条规则是不是该按「Sepia 自有文件 vs 读别人的文件」重新表述。

### 顺手修掉的一个 harness 缺陷（与本 stage 无关，但由本 stage 暴露）

`check-discipline.mjs` 的所有 `isExempt` 调用传的都是**剥掉注释之后**的行，
而 `harness-exempt` 记号本身就住在注释里——**豁免机制此前从未真正生效**，
只是恰好没有真豁免对着真违规，所以一直没被发现。已改为违规匹配用剥后行、
豁免匹配用原始行。（另：记号里的编号要写全，`harness-exempt: 纪律 20` 才匹配得上
`纪律 20` 这个 ID，只写 `20` 不行。）

## 1.8 风险与未知
| # | 风险 | 先探/边做边探 |
|---|---|---|
| 1 | **renderer↔engine 的通路形态**：五方法经 IPC 转 main 代理,还是把端点+token 交给 renderer 直连 localhost | **已探定（2026-08-04）：main 代理**。实测（Electron 43,10k 事件 ~140B 全速灌注）：renderer 直连 64ms,main 逐事件 `webContents.send` 转发 193ms → 每事件开销 ≈0.013ms,对 <200 事件/s 的真实 token 流可忽略。另两条理由：token 与端点不进 renderer（暴露面最小）;renderer 现经 `loadFile` 加载（Origin 为 null）,直连须先建自定义 scheme + CORS 放通,是本 stage 本可不背的暴露面。**代价记入 §1.9 回流**：架构 §2.1 图与 §4.3「AgentBridge 直连 127.0.0.1」表述需订正为 main 代理形态 |
| 2 | `utilityProcess` 内 `import` 单文件 ESM + wasm 路径解析（尤其打包后 asar 内外） | **已探（2026-08-04）**：最小 spawn 实验通过——`utilityProcess.fork` 内原地 `import` 产物成功,fork→ready 2.27s（import 1.49s + listen 0.37s）,环境变量 Basic 鉴权生效（带 auth 200 / 不带 401）。两个前置：产物旁必须可解析 `jsonc-parser`（真包,vendor 锁 3.3.1）与 `@lydell/node-pty`（build-node 的两个 external;后者用调用即抛错的桩,引擎启动不触碰它）。wasm 以 `./<名>-<hash>.wasm` 相对 `import.meta.url` 定位,必须与最终 bundle 同目录。asar 内外的差异随 `.dmg` 延后账一起验（§1.1 问题二） |
| 3 | vendor `bun install` 的耗时与网络面（构建期不依赖网络怎么保证——lockfile + 离线镜像?） | **已探（2026-08-04）**：冷装 4693 包 38.5s（联网）;`build-node` 4.7s。CI 策略：缓存 bun 全局 cache（key = vendor/opencode/bun.lock）+ `bun install --frozen-lockfile`,温缓存下不出网;「构建期不依赖网络」的准确边界是**产物构建（build-node）不出网**,依赖安装靠 lockfile 钉死 + 缓存兜底 |
| 4 | safeStorage 在 Linux CI（无钥匙串后端）的行为 | 边做边探;CI 上密文回退明文警告是已知 Electron 行为,测试注入假凭据绕开 |
| 5 | 锁定 tag 的 OpenAPI 与 SDK 版本錯位 | 边做边探;端点映射以 tag 的 OpenAPI 为准（架构 §4.3） |
| 6 | 并行合并时 `bun.lock` 冲突 | 已知代价:合并仪式里重跑 `bun install` 再全量 check,以 lockfile 再生成代替手工合 |

## 1.9 回流
| # | 指向 | 问题 | 建议 |
|---|---|---|---|
| 1 | **003** | 无 stage 并行的规则 | 新增「并行准入四条件 + 合并仪式」,§1.1 前置〇为草案 |
| 2 | **架构 §4.1** | "存系统钥匙串"未指定实现,keytar 会违反 T-18 | 细化为"safeStorage(钥匙串背书加密),密文落 ~/.sepia"。**再加一句**：无凭据可读时不得触碰 safeStorage——macOS 上 `isEncryptionAvailable()` 会弹模态钥匙串对话框，挡在启动路径上即违反不变量 1（本 stage 实测踩到） |
| 3 | **架构 §2.1 图 + §4.3** | 两处都写「renderer 经 AgentBridge **直连** 127.0.0.1（HTTP+SSE）」，与 §1.8 风险 1 探明的结论冲突 | 订正为 **main 代理**：AgentBridge 跑在 main，renderer 经 preload 的 `api.agent.*` 到达；端点与 token 不进 renderer。实测代价可忽略（10k 事件全速灌注：直连 64ms vs 代理 193ms ≈ 每事件 0.013ms），换来的是暴露面最小 + 不必为 CORS 建自定义 scheme。§4.6 那句「CSP 限制 connect-src 为 self 与本地引擎」也应跟着改——renderer 根本不连引擎 |
| 4 | **002 §2.1（类型层纪律）** | 品牌类型**默认是空转的**：生产代码全经构造函数，放宽类型没有可观测差别，typecheck 照绿（本 stage 反向验证实测） | 类型层纪律一律配一份 `.test-d.ts` 负向断言（`@ts-expect-error` 把「裸值必须编译不过」变成断言）。**Stage 4 的类型层第四五条上来就要带**，不能等反向验证再发现 |
| 5 | **002 §5.1 / check-discipline** | `isExempt` 传的是剥注释后的行，而记号住在注释里——**豁免机制此前从未生效** | 已随本 stage 修（违规匹配用剥后行、豁免匹配用原始行）。同时应在 002 §5.2 写明记号里编号要写全（`纪律 20` 而非 `20`） |
| 6 | **架构 §4.1（偏离阶梯）** | `virtual:opencode-server` 被写成实现方式，但它是上游 desktop 的形态，不适合我们 | 改成「产物由构建脚本复制到位，运行期由 sidecar `import` 绝对路径」——理由见 §1.2。**这属于「配置层能解决就别动源码」阶梯的第二级（构建脚本层）**，零 patch 达成 |
| 7 | **架构 §1.1 / 纪律 12** | 「引擎不挡 UI」的判据此前只到「不在同步路径」，实测发现 fork 落在 t3 之后、t5 之前照样抢 CPU | 判据加严为 **「引擎在 t5（可写）之后才起」**，并写明空状态要有兜底定时器（renderer 不发 t4/t5 时引擎不能永远不起） |
| 8 | 003 §3.2 | 「破坏方式随检查预写」还不够——本 stage 两条预写好的破坏方式**自己也是错的**（① 破坏了但检查不红、⑨ 破坏了但断言站错位置） | 加一句口径：反向验证跑出「破坏后仍绿」时，**先改检查、再重跑**，并把这条记进 §1.5；`dead_checks` 应记「首轮空转数」而不只是「收尾空转数」 |
| 9 | 001 §7 / 打包 | 引擎产物必须落在 asar **之外**（sidecar 运行期 import + wasm 相对路径定位），已用 `extraResources` 落地，磁盘上验过 | 打包产物的**运行期**验证未做：本机打包后的 `.app` 不吐 stdout，拿不到 `sepia-engine` 诊断行。归入 §1.1「.dmg + 打包产物重验」那笔延后账，收账时一并验引擎能否从 `Resources/engine` 起来 |

---

## 1.10 收尾状态（2026-08-05）

**全量 `check` 最后一行：`PASS`**（9 步：lint · typecheck · deps · bridge · workspace · **artifacts** · **patches** · marks · test）。

**DoD 三条**：kill -9 后纸全功能可写 ✓（smoke 断言到「文件里读得到那行字」）｜
⌘K 给缺席提示 ✓（smoke 断言 `.sepia-agent-hint` 含「缺席」）｜
同步路径仍无引擎 ✓（判据加严为 fork 晚于 t5，且顶层 require 集合回到 Stage 1 的样子）。

**未做，明确留着**：1.6b 三条真人项；冷启动 P50/P90 实测（人裁：机器负载过高）；
打包产物的运行期验证（并入已有的打包延后账）。

**并行纪律遵守情况**：`editor` / `ui` 两个包一个字节未动。共享注册表只增不改
（`bridge-snapshot.json` 加 8 项、catalog 加 2 条、`core/types` 加类型）。
`dep-graph.json` **未改**——`agent → core`、`app → agent` 本就在图里，本 stage 没有新增跨包边。

---

## Stage 3 关闭（2026-08-05）

DoD 三条判定：**kill -9 后纸全功能可写**（§1.5 smoke ⑤——连杀三次退避到缺席稳态 34.5s，
纸全程可写）；**⌘K 给缺席提示**（§1.6a + W12 对照）；**同步路径仍无引擎**（§1.5 smoke ⑦，
判据加严为 fork 晚于 t5 且顶层 require 集合回到 Stage 1 的样子）。以上以 §1.5/§1.6a 已有
证据为据。**1.6b 三条真人项 + 抽查 2 条证据包已于 2026-08-05 人工通过。**

**合并记录**：2+3 于 2026-08-05 合并（merge commit 见 git）。**人裁：跳过合并仪式的全部
验证步骤，直接合并**——140 §1.1 前置〇原定的「合并后全量 check + 两 stage 全套 smoke +
冷启动打点复测」未执行，记债 ① 不执行。rebase 冲突四处：`bun.lock`（取侧后 bun install
重生成）、`140` 本文档（取 worktree 演进版）、`copy/index.ts` 与 `App.tsx`（Stage 2 查找 ×
Stage 3 引擎状态，正交增量做并集，五处手工缝合）。`CLAUDE.md` / `bridge-snapshot.json`
自动合并无冲突（后者 12+8=20 项，与不变量级子条白名单一致）。

### 遗留债（下一 stage §1.1 逐条重问）

| # | 债 | 何时还 |
|---|---|---|
| ① | **合并后集成验证未跑**（人裁跳过）：全量 check、三 stage 全套 smoke、装饰×引擎共存回归 | 首次 `bun run check` 或 CI 触发时自然补上，**红了按红处理** |
| ② | typecheck 增量化（130 债②，原定合并前，顺延） | Stage 4 前置重问 |
| ③ | 纪律 20 重述 + 摘四条 XDG 豁免（8→4）+ check-discipline 豁免修复的双向补验 | 顺延 |
| ④ | **基线重立**：120 的 440ms 已不可复现（HEAD 基线单次对照 1049ms），冷启动 smoke 在本机长期红为已知状态；`SEPIA_PERF_ASSERT` 校准与新基线登记顺延（原合并仪式第 6 步条款照抄：静机跑校准、数字回填、超线重开减肥） | 静机窗口出现时 |
| ⑤ | 打包运行期验证 | 并入 `.dmg` 延后账（§1.9 #9 已记） |
