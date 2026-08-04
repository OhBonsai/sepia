---
stage: 3
title: 引擎
status: planned   # 2026-08-04 起草。基线 = Stage 1 关闭；与 Stage 2 并行（见 §1.1 前置〇）
dod: kill -9 引擎后纸全功能可写；⌘K 给缺席提示；冷启动同步路径仍无引擎（纪律 12 打点复测）
checks_added:
checks_reverse_verified:
exemptions:
disputes:
measured:
  cold_start_p50_ms:          # 必须与 Stage 1 基线（440）同量级——引擎不许上同步路径
  engine_spawn_to_ready_ms:   # 窗口可见后异步拉起 → SSE 心跳就绪
  kill9_to_absent_state_s:    # 强杀 → 退避 ≤3 次 → 缺席稳态
  bundle_mb_delta:            # 引擎产物带来的包体积增量（单文件 ESM + 4 wasm）
  check_full_s:
  reverse_coverage:
  dead_checks:
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
| `/harness` 看板 | **不做（人裁 2026-08-04，第二次推）**。继续挂在延后账上，下一 stage §1.1 再问。连续两次被推本身是个信号：若 Stage 4 再推，应改问「它到底要不要存在」而不是「这次做不做」 |

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
- [ ] `vendor/opencode` submodule **锁最近一次 release tag**（人裁 2026-08-04）。起草时上游最新为
      `v1.18.13`（2026-08-04 发布）——实施首日以当日最新 release 为准锁定，**锁定后整个 stage 不动**（刹车表），实际 tag 号记回此处
- [ ] `scripts/build-engine.ts`：vendor 根 `bun install` → `build-node` → 产物（单文件 ESM + 4 wasm）复制到位
- [ ] 挂 `predev` / `prebuild`（001 §1 的 [S3] 标注此刻兑现——Stage 1 刻意没挂，现在该挂了）
- [ ] `vendor/` 排除在 workspace glob 外；构建期不依赖网络（submodule + lockfile）
- [ ] electron-vite `virtual:opencode-server` 指向产物

**sidecar 生命周期**
- [ ] `main/services/agent-supervisor.ts`：`utilityProcess.fork`，**窗口可见之后异步拉起**（纪律 12：同步路径上没有它）
- [ ] 四个 XDG 根全部指向 `~/.sepia/engine/`，**fork 时设定**（模块加载期就把路径算死，事后改无效）
- [ ] 配置经 `OPENCODE_CONFIG_CONTENT` 内存注入；隔离目录保持为空；book 内不落配置
- [ ] 鉴权走环境变量，不走 listen 参数
- [ ] 崩溃退避重启 ≤3 次 → 「Agent 缺席」稳态；就绪/缺席状态推给 renderer

**凭据（§1.1 问题四已裁：safeStorage）**
- [ ] `main/services/credentials.ts`：API key 加密落 `~/.sepia/`，fork 时注入 `provider.<id>.options.apiKey`
- [ ] 引擎侧零落盘：隔离目录内不出现凭据文件（有检查，见 §1.5）
- [ ] 首次无凭据时从用户 opencode 凭据文件**只读导入一次**；永不写用户 opencode 的任何文件

**AgentBridge 五方法**
- [ ] `agent` 包：`openThread` / `send` / `stream` / `interrupt` / `listModels`，内部 `@opencode-ai/sdk`，端点以锁定 tag 的 OpenAPI 为准
- [ ] `BookDirectory` 类型：`send` 的 `directory` 参数类型上必带
- [ ] SSE：字符串字段增量拼接、其余整 part 替换、心跳区分"模型停了/连接死了"、未知事件忽略
- [ ] renderer 侧最小消费面：**只到状态提示**——顶部细提示线（缺席时）+ ⌘K 唤起时的缺席文案（W12）。真浮层归 Stage 4

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
| **preload 白名单** | 拟增 `api.agent.*`：五方法透传 + `status()` + `onStatusChange(cb)`。**恰好这些，多一个 `check:bridge` 子条即红**。具体形态（方法直传 vs 端点+token 交 renderer）是 §1.8 风险 1,探完以 `bridge-snapshot.json` diff 为准并回填本表 |
| **包依赖** | `@opencode-ai/sdk` → `agent`；submodule 不算依赖。**无新原生模块（T-18）** |
| **配置字段** | `config.json` 拟增 provider/model 相关字段（最小集,实施定,只加本 stage 真正读取的——120 §1.1 问题五的纪律沿用） |
| **环境变量** | Sepia 自身不新增。**引擎子进程 env 单列**：四个 XDG 根、`OPENCODE_CONFIG_CONTENT`、鉴权变量——只进子进程,不进 Sepia 环境,不落盘 |
| **磁盘** | `~/.sepia/engine/`（四根所指）、`~/.sepia/` 下凭据密文文件（safeStorage） |

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

> 口径按 003 §3.2。破坏方式随检查预写（C.1 教训）：

| # | 检查 | 预定破坏方式 |
|---|---|---|
| ① | `BookDirectory` | 类型放宽成 string / send 去掉参数 → typecheck 必红 |
| ② | bridge 不变量子条 | preload 的 agent 域偷加一个 `writeFile` 方法 → 必红 |
| ③ | `check:artifacts` | 删一份 wasm → 必红 |
| ④ | `check:patches` | 注入一个 apply 不上的 patch → 必红（首版零 patch 也要用假 patch 验一次这条路） |
| ⑤ | SSE 单测 | 把增量拼接改成整段替换 → 必红 |
| ⑥ | 退避单测 | 去掉重启上限 → 必红 |
| ⑦ | kill -9 smoke | 注释掉缺席稳态迁移 → 必红 |
| ⑧ | 纯净复测 | 把 fork 挪到窗口可见之前 → 打点断言必红 |
| ⑨ | 隔离 smoke | 少设一个 XDG 根 → 路径逃逸断言必红 |

## 1.6 验证（两栏制,沿 130）

### 1.6a CC 代验（证据留档,人抽查）
| # | 项 | 方式 |
|---|---|---|
| a1 | 构建产物齐全可起 | build-engine → check:artifacts → spawn → 心跳就绪,输出留档 |
| a2 | kill -9 全链 | smoke#7 + 手工 kill 脚本各一遍,录屏/输出 |
| a3 | 退避与缺席态 | 连崩 3 次 → 提示线出现截图 |
| a4 | 隔离与零落盘 | smoke#9 + `find ~/.sepia/engine` 清单留档 |
| a5 | 五方法真对话 | 测试内走 bridge 发一轮真请求收流（需 key;无 key 则 mock server 走协议） |
| a6 | 冷启动对比 | 10 次冷启动 P50/P90 vs Stage 1 基线,引擎前后各测 |
| a7 | 单实例回归 | Stage 0 的二次启动开新窗口仍通 |

### 1.6b 真人（压到最少）
- [ ] **首次凭据导入流程**：safeStorage 首次访问的系统授权对话框、导入确认的文案观感——系统级交互,机器够不到
- [ ] **W12 走查**：缺席提示线 + ⌘K 缺席文案,对照原型的克制程度（细线,不弹窗）
- [ ] **kill -9 手感**：终端强杀,纸上连续打字,确认无一帧卡顿——体感项
- [ ] 抽查 1.6a 证据包（至少 2 条）

## 1.7 实测记录
预算：冷启动 t0–t5 **仍 <1s 且与 Stage 1 同量级**（引擎不在同步路径,理论零影响——测出影响即违反纪律 12）；
`engine_spawn_to_ready` 记基线无硬预算（首 token <3s 的预算属 Stage 4,但这段是它的组成部分,先有数）；
测法沿 120 §1.7（构建产物、P50/P90、`.app` 口径延后账不变）。

## 1.8 风险与未知
| # | 风险 | 先探/边做边探 |
|---|---|---|
| 1 | **renderer↔engine 的通路形态**：五方法经 IPC 转 main 代理,还是把端点+token 交给 renderer 直连 localhost | **先探,第一个探**。它决定 preload 形状(§1.3 表)与 token 暴露面。倾向 main 代理（token 不进 renderer）,但 SSE 经 IPC 转发的开销要实测 |
| 2 | `utilityProcess` 内 `import` 单文件 ESM + wasm 路径解析（尤其打包后 asar 内外） | 先探：最小 spawn 实验 |
| 3 | vendor `bun install` 的耗时与网络面（构建期不依赖网络怎么保证——lockfile + 离线镜像?） | 先探,定 CI 策略 |
| 4 | safeStorage 在 Linux CI（无钥匙串后端）的行为 | 边做边探;CI 上密文回退明文警告是已知 Electron 行为,测试注入假凭据绕开 |
| 5 | 锁定 tag 的 OpenAPI 与 SDK 版本錯位 | 边做边探;端点映射以 tag 的 OpenAPI 为准（架构 §4.3） |
| 6 | 并行合并时 `bun.lock` 冲突 | 已知代价:合并仪式里重跑 `bun install` 再全量 check,以 lockfile 再生成代替手工合 |

## 1.9 回流
| # | 指向 | 问题 | 建议 |
|---|---|---|---|
| 1 | **003** | 无 stage 并行的规则 | 新增「并行准入四条件 + 合并仪式」,§1.1 前置〇为草案 |
| 2 | **架构 §4.1** | "存系统钥匙串"未指定实现,keytar 会违反 T-18 | 细化为"safeStorage(钥匙串背书加密),密文落 ~/.sepia" |
| 3 | 【实施中发现的,照 120 格式补】 | | |
