---
stage: 6
title: 库与文件
status: done          # a 期 2026-08-06 完成并合并（人工轮：两项通过、两项记债、一项随轮已看）。b 期入口条件见 §2，未开工
dod_a: 外部改文件（无脏）→ 重载且尽量保光标；（有脏）→ 先落盘 + 横条提示；自写不自扰；删除进回收站；`open -a Sepia x.md` 游离打开可写；watcher 失效时 focus 对账仍工作
dod_b: 整个 art/ 作 book 启动仍 <1s；@ 搜索即时（b 期入口后回填细化）
checks_added: 20                # 集成后：#2 删（判据归 L2），#21 新增，净数不变
checks_reverse_verified: 20
dead_checks: 3         # 首轮破坏后仍绿：检查 15 旧判据、检查 4 的归并层（窗口 120ms）、检查 19 对 detach 破坏不敏感（三处已改，见 §1.5）。**集成收尾留的那个计数问询已裁：维持 3，理由见 §1.5 末**
exemptions: 4          # 继承 150 收尾值，本期零新增
disputes: 0
measured:
  cold_start_ms: 559           # t0→t5 五连跑 542/559/561/554/561（P50 559），预算 1000
  process_to_window_ms: 385    # t0→t3，预算 500
  watcher_mount_ms: 79         # page 所在目录、非递归
  external_change_notice_ms: 133
  external_remove_notice_ms: 240   # 归并窗口 120→300ms 后约 400
  self_write_ms: 4             # atomicWrite + 印记刷新
  reconcile_ms: 0              # 一次 focus 对账（<1ms）
  watch_art_recursive_ms: 87600    # 反例：整棵 art/ 递归监听，rss 1.3GB / 4138 次 EMFILE
  watch_art_depth2_ms: 564         # 同一棵树 depth:2，1479 项 / 58MB / 零错误
  events_per_write: 1              # 真管线 tmp+rename 连写 20 轮，每轮恰好一个 watcher 事件
---

# 170 · Stage 6：库与文件（a 期：watcher + 对账 + 冲突 + 文件操作）

> 模板：003 §1 ｜ 上游：001 §7、架构 §4.9 §5、T-26/T-30/T-31 ｜ 基线：150（Stage 4，已关闭）
> 原型对照：文件树/主页/@（W9）全归 **b 期**；a 期无原型对照面（机制层 + 两处点状 UI）

> **a 期交付的是纸与外部世界的和平共处**：外面改了文件，纸知道；纸写了文件，watcher 不自扰；
> 冲突时**用户刚敲的字优先级最高、绝不静默覆盖**（架构 §4.9）。
> **文件树、最近的 page、多 Tab、主页、@ 引用一概不在**——那是 b 期。

---

## 1.1 前置

### 〇、并行声明（L3 线；与 160 §1.1〇 同文）

L1（Stage 4）已合并关闭，master 即基线。本 a 期为 **L3**，与 **L2（Stage 5a，160）** 同期在飞。
规则：

1. **合并顺序：L2 先合，L3 rebase**——保存管线是回声抑制的上游。
2. **shell 冻结令继续**：不碰 `App.tsx` / `EditorHost` / session schema / renderer editor 区。
   renderer 侧只允许**冲突提示横条**一处点状 UI（复用 Stage 3 提示线模式；完整选择 UI 归 b 期）。
3. **唯一共享接缝——已定型（2026-08-06，L2 定，两份 plan 同文）**：
   `@sepia/core` 的 `createSelfWriteLog()`（`core/src/fs/self-write.ts`，**纯逻辑、无 fs、无 Electron**）。
   L2 的写盘管线在**写成功之后** `record`，L3 的回声抑制在 watcher 事件到达时 `claim`。

   ```ts
   interface SelfWriteEntry {
     path: string      // 绝对路径，**必须 realpath**（见下）
     mtimeMs: number   // 写完后 stat 到的
     size: number      // 写完后的字节数
   }
   interface SelfWriteLog {
     record(entry: SelfWriteEntry): void      // 写盘成功后登记（失败的写不登记：盘上没变化，就不会有回声）
     claim(entry: SelfWriteEntry): boolean    // 是自写吗？**命中即消费**
     readonly size: number                    // 在册条数（诊断/测试用）
   }
   createSelfWriteLog(options?: { capacity?: number; ttlMs?: number; now?: () => number }): SelfWriteLog
   // 默认 capacity 64、ttlMs 5000、now = Date.now
   ```

   四条语义是**接缝的实质**，两侧都按它写才对得齐：

   - **`claim` 是消费型，不是纯查询**。一条自写只挡一次回声。不消费的话，一个恰好同指纹的
     真外部改动会被永久吞掉；消费掉，最坏只误吞一次。取舍同锚点的「宁可孤儿不误挂」。
   - **`path` 两侧都要 realpath**。macOS 的 `/var` 是 `/private/var` 的符号链接，同一个文件
     两侧拿到的字符串能完全不同——Stage 4 的 a4 装置就在这上面栽过一次。
   - **指纹是 path + mtime + size，不是内容哈希**。哈希要为每次保存把内容再读一遍算一遍；
     漏网场景（窗口内、同路径、mtime 与字节数同时撞上的**真**外部改动）少到可忽略，
     且消费型语义把代价封顶在"误吞一次"。
   - **过期即放行**（默认 5s）。回声是毫秒级到的；更晚的同指纹变更更可能是真改动。

   **状态（2026-08-06 集成收尾后）：接缝已换实体，桩已删。** L3 侧的落地形态：

   - 取法 `savePipeline()?.selfWrites`，**注入**给 watcher（`configureWatcher({ selfWrites })`，
     装配点在 `main/index.ts`）。刻意不在 watcher 里 `import '../ipc/index.ts'`——
     ipc 已经 import watcher（`file/read` 挂监听、`file/write` 刷印记），反向 import 成环，
     `check:deps` 的 `no-circular` 当场红。
   - 四条语义逐条照做：**claim 消费型**（挡完顺手把印记推平）、**两侧 realpath**
     （renderer 给的是 `/var/...`，L2 登记的是 `/private/var/...`）、**指纹补齐 size**、
     过期即放行（用 L2 的默认 5s）。
   - **L3 只 claim，不 record。** 于是 `services/files.ts` 的四个动作（新建/改名/移动/删除）
     不往表里写——删除与改名压根给不出 path+mtime+size 三件套。它们的回声由「谁在动手」
     那一侧收尾：renderer 成功后立刻改指或清空 page，watcher 的 `currentPage` 在归并窗口
     结束前就变了，旧路径那条事实落地无声（**有单测盯这条链**，不靠时序碰运气）。
   - **消费型语义的前提已实证**：真管线 tmp+rename 连写 20 次，watcher 侧**每次恰好一个事件**
     （20/20，见 §1.5 集成一节）。一次写落成两个事件的话，第一个被 claim 挡住、第二个就会
     漏成"外部改动"——那正是消费型语义唯一的失效方式。
4. 共享注册表仅追加；`bun.lock` 冲突以重新 `bun install` 为准。

### 一、Stage 4 的 DoD 达成情况
已关闭（150，2026-08-06）。本期赖以开工的存量：Stage 3 提示线模式（横条复用）、
`open-file` handler（Stage 0 就在、120 §1.1 问题二划到本 stage——**此刻兑现**）。

### 二、继承债逐条重问
150 债 1–4、130 债①：均不动（归属见 160 §1.1 二）。本期无顺手债。

### 三、设计点（计划自带答案，人审一并裁）
| 点 | 答案 | 依据 |
|---|---|---|
| watcher 选型 | **chokidar v4**（无原生模块、`atomic` 选项归并 tmp+rename）；`usePolling` 进 config 作网络盘逃生舱 | T-26 / 架构 §4.9 |
| **watcher 范围（实施期改判，2026-08-06）** | 计划原文「监听当前 book」→ 实测否掉，改为**当前 page 所在目录、非递归**（`depth: 0`）。理由是硬数字：真实 `art/`（8.3G / 4455 目录）递归监听 ready **87.6s**、rss **1.3GB**、**4138 次 EMFILE**；同树 `depth:2` 则 564ms / 58MB / 零错误。a 期没有 book 全树事件的消费者（文件树、最近列表都在 b 期），而 DoD 只要「当前 page 的外部变更看得见」。**b 期做文件树时必须带 entry 上限 + 降级**，不许直接放开 depth（回流 §1.9-1） | §1.8 风险 2 实测 |
| **横条的「打开 Finder 定位」（实施期改判）** | **推到 b 期**，与三选 UI 同批。理由：a 期有脏冲突的处置是"先落盘"，此刻 Finder 里那个文件已经是**用户自己那一版**，定位过去看不到外部内容，按钮名不副实；而它要在桥上多开一项（`reveal`），与 §1.3 申报的「恰好五项」相抵。a 期横条只报事实 | 本表「冲突策略」行 |
| 对账兜底 | 窗口 focus 时按 mtime/size 快速比对；watcher 整体失效 → 降级"仅 focus 对账"，写作不受影响 | 架构 §4.9（**必须有对账兜底**） |
| 冲突策略 | 无未落盘改动 → 重载 + 尽量保光标；有 → **先立即落盘**，横条提示"外部已修改"（保留我的/用外部的/看 diff 三选归 b 期，a 期横条只报事实 + 打开 Finder 定位） | 架构 §4.9（绝不静默覆盖） |
| 回声抑制 | 「路径 + 刚写入 mtime」过滤（消费 L2 接缝）；git 操作的自写同样过滤 | 架构 §4.9 |
| 删除 | 走系统回收站（`shell.trashItem`），不做自绘确认 | 架构 §4.9 |
| 重命名后更新链接 | **命令留形状不实现**（要改别的文件字节，T-31 用户主动发起 + 列清单 + 同 commit）——依赖 b 期 UI，整体归 b | T-31 |
| fileAssociations | `electron-builder.yml` 补 `ext:[md,markdown], role:Editor`；`open-file`/argv/拖图标三入口统一走游离 page 通道（T-30：无 book 则降级——无 git 无 @，纸完全可写）。**双击行为的人工验证依赖打包，挂 .dmg 债一并验**，本期先验 `open -a` 与 argv 两入口 | 120 §1.1 问题二（三者同期的承诺此处兑现） |

## 1.2 范围（a 期做什么）

**watcher 与对账**
- [x] chokidar v4 监听 **当前 page 所在目录、非递归**（范围改判见 §1.1 三）；`atomic:true`；120→**300ms** 归并窗口
- [x] focus 对账：mtime/size 比对（`core/files` 的 `reconcileKind`）；watcher 失效自动降级仅对账，横条一次性告知
- [x] 回声抑制：自写不触发重载（`atomicWrite` 漏斗上留痕 + `core` 的 `isSelfWrite` 判据）；接缝见 §1.1〇-3。
      **git 操作的自写**：本期无 GitService（L2 在建），其写盘只要走 `fsio` 就自动落在同一张表里；rebase 后由全量 smoke 复验（§1.8 风险 4）

**冲突处理（a 期最小面）**
- [x] 无脏 → 重载 + 保光标（光标夹取在 `editor/base.ts` 的 `mountEditor` 里已有，**刻意不再造第二个**——见 §1.5 检查 3 的处置）
- [x] 有脏 → **先落盘**（复用既有 ⌘S 通道 `api.file.write`；L2 的 800ms 防抖合并后自动同源），再横条提示
- [x] 外部删除当前 page → 横条 + 转游离态（内容保留在编辑器，⌘S 可另存回去）

**文件管理（服务层 + 命令，UI 归 b 期）**
- [x] `main/services/files.ts`：新建 / 重命名 / 移动 / 删除（回收站）；四条都经 command registry 注册（`renderer/files/commands.ts`）
- [x] 桥增 `api.files.*` 四项 + `api.files.onExternalChange(cb)` 一项 = **恰好五项**（见 §1.3）
- [x] `command registry` 的 `run` 收可选参数（`execute(id, arg)`）——重命名/移动的目标只有调用方知道，b 期 UI 接上去就是一行

**入口三通道（120 问题二收尾）**
- [x] `fileAssociations` 补齐（`md/markdown`、`role: Editor`）；`open-file` handler 接通；argv 与二次启动转交同通道
- [x] 三入口在 `session/get` 汇合（**桥零增长**：renderer 启动本来就问一次 session）；一个路径一扇窗（T-29）
- [x] 游离 page 降级语义：`books.ts` 按 `.git` 上溯判 book 根，无 book → 无 git/无 @，纸全功能可写（不变量 1 同构）

**明确不做（刹车）**：文件树/最近列表/多 Tab/主页/@ 选择器/双屏（b 期）；冲突三选完整 UI（b 期）；
重命名更新链接实现（b 期，T-31）；多 book；watcher 于 `~/.sepia`（只看 book）；
**改 App.tsx / EditorHost / session schema（冻结令）**。

## 1.3 结构与暴露面
| 包 | 新增 |
|---|---|
| `app` main | `services/{watcher,files,books}.ts`（books 仅单 book 身份读取，配合 T-34） |
| `app` renderer | 冲突横条（点状 UI）、外部变更事件消费（重载走既有 open 路径） |
| `core` | 冲突判定纯函数（脏 × 外部改矩阵）、文件事件类型 |

**桥（预先声明）**：拟增 **5 项**——`api.files.{create,rename,move,trash}` + `api.files.onExternalChange(cb)`。
恰好这些，快照 diff 为准。**依赖**：`chokidar@4` → app（唯一新增，无原生模块 T-18）。
**配置**：`watcher.usePolling`、对账/归并阈值——只加真读的。

## 1.4 harness 增量（20 条，硬度分档；集成后 #2 删、#5 加严、#21 新增）

**硬度**：检查 5（有脏先落盘）按**不变量级心态**对待——它守的是"用户刚敲的字不许被覆盖"
（不变量 2 的锋面）。其余为纪律级。本期**零新增豁免、零 dispute**。

| # | 检查 | 层 | 位置 |
|---|---|---|---|
| 1 | 冲突判定矩阵（脏 × changed/removed 四格穷举） | core 单测 | `core/test/files.test.ts` |
| 2 | ~~回声抑制判据~~ → **集成后删**：判据是 L2 的 `createSelfWriteLog`（`core/test/self-write.test.ts` 7 条），本期不许再有第二份 | — | — |
| 3 | focus 对账比对（mtime/size/不在了/无印记） | core 单测 | 同上 |
| 4 | watcher 真事件：就地改一条、删了又建折成 changed（**含超出 chokidar 窗口的 150ms 例**） | app 单测（真 fs） | `app/test/main/watcher.test.ts` |
| 5 | **回声抑制（真接缝）**：走真写盘管线保存 → 零通知；claim 消费型（挡完表里为空）；连写 20 次零漏；随后真外部改仍报 | app 单测（真 fs + 真管线） | 同上 |
| 6 | 降级：切 `reconcile-only` + 一次性告知 + 对账仍抓到 | app 单测 | 同上 |
| 7 | 新建**已存在即失败**（不覆盖） | app 单测 | `app/test/main/files.test.ts` |
| 8 | 删除**必经回收站**：注入空 trash，文件必须还在；trash 失败不改用 unlink | app 单测 | 同上 |
| 9 | 改名/移动：目标已存在即失败；两端留自写记录 | app 单测 | 同上 |
| 10 | 游离判定：repo 内/`.git` 是文件/不在 repo | app 单测 | 同上 |
| 11 | 文件命令路由（四条 × 参数解析 × 无 page 时不动手） | renderer 单测 | `app/test/renderer/file-commands.test.ts` |
| 12 | argv 队列：一次取一个、peek 不消费（**改判定的老检查**） | app 单测 | `app/test/main/argv.test.ts` |
| 21 | **自己动手改的文件不惊动自己**：自己改名当前 page → 重新指向后旧路径的事件落地无声（`files.ts` 不 record 的前提） | app 单测 | `app/test/main/watcher.test.ts` |
| 13 | smoke · 外部改（无脏）→ 重载、静默、**光标不回文首** | smoke | `test/smoke/external-change.spec.ts` |
| 14 | **smoke · 外部改（有脏）→ 先落盘 + 常驻横条，零字节丢失** | smoke | 同上 |
| 15 | smoke · 自写不自扰：⌘S 后**撤销历史仍在** | smoke | 同上 |
| 16 | smoke · 删除进回收站（一次性卷上验 `.Trashes/<uid>`） | smoke | 同上 |
| 17 | smoke · 游离 page：argv 打开非 book 的 .md → 可写可存、不造 `.git` | smoke | 同上 |
| 18 | smoke · watcher 失效降级 → focus 对账仍抓到 | smoke | 同上 |
| 19 | smoke · 外部删除 → 横条 removed + 内容留在纸上 + **不报"打不开"** | smoke | 同上 |
| 20 | smoke · 外部移走 → removed（unlink+add 的歧义不许误判成改动）；光标越界仍可写 | smoke | 同上 |

## 1.5 自动化验证与反向验证（20/20 全做，首轮 3 条空转）

每条都跑了「故意违规 → 必须 FAIL → 撤销」。**首轮三条破坏后仍绿**，按 003 §1.5 先改检查再重跑：

| 首轮空转 | 为什么绿 | 怎么改的 |
|---|---|---|
| **检查 15**（自写不自扰，旧判据"无横条"） | 回声抑制拿掉后走的是「无脏 → **静默**重载」那条路：没有横条，用例照样绿 | 判据换成**撤销历史**——重载会重建 `EditorView`，历史随之消失，所以「⌘S 后 ⌘Z 还能撤掉刚敲的字」才是"没被自己重载过"的证据。改后单机制破坏仍绿（自写不自扰在生产上有**两道**保护：回声过滤 + 印记未变守卫），**双机制破坏必红**——记录在案：这是纵深防御，不是空转 |
| **检查 4 的归并层**（窗口 120ms） | 100ms 内的 `unlink+add` 本来就由 chokidar 的 `atomic` 折好，多出的 20ms 什么也没接住 | 窗口放到 **300ms**（严格宽于 chokidar 的 atomic），并补「删了 **150ms** 后才建回来仍须折成 changed」——那才是这一层的存在理由（外部编辑器保存的删了再建常落在 100–300ms，归并不到就误报"文件被删除了"） |
| **检查 19**（外部删除） | 把 `detach` 当 `reload` 处理时，重载去读一个已不在的文件 → 报 open 失败，但横条与内容都还在 → 绿 | 加断言**不许出现"打不开这个文件"**：外部删除是一种状态，不是一次打开失败 |

**RV 一览**（破坏 → 结果）：矩阵判 reload→红 ｜ 回声判据恒 false→红 ｜ 对账恒 null→红 ｜
归并层拿掉→红（改后）｜ watcher 回声过滤拿掉→红 ｜ 不切降级模式→红 ｜ 新建可覆盖→红 ｜
trash 换 unlink→红（单测 + smoke 各一次）｜ 改名不查目标→红 ｜ rename 命令猜目标→红 ｜
peek 也消费→红 ｜ 重载传光标 0→红 ｜ 不先落盘→红 ｜ 双保护同拆→红 ｜ session/get 取了不用→红 ｜
focus 不对账→红 ｜ `mountEditor` 的夹取拿掉→红 ｜ 归并把删除当改动→红 ｜ detach 当 reload→红（加固后）｜
`findBookRoot` 谁都算 book→红。

**检查 3（计划原文「单测 · 光标保持夹取」）的处置**：夹取**已经在** `editor/base.ts:155`
（`mountEditor` 对越界 anchor 做 `Math.min/max`，Stage 1 就有）。在 core 再写一个夹取函数
是"用覆盖面更小的手段换掉更大的"，而且破坏它不会有任何可观测差别（第二道夹取兜住）——
那就是 002 §2.1 元教训的翻版。于是拆成两条**打在真实路径上**的检查：检查 13（保光标）与
检查 20 后半（session 光标越界 999999 → 仍可写不崩），后者的破坏对象正是 `mountEditor` 那行。

### 集成收尾（2026-08-06，rebase 到含 Stage 5a 的 master 之后）

**一次 atomicWrite = 恰好一个 watcher 事件——实证 20/20。** 真写盘管线（`pipeline.write`
→ tmp + rename）连写 20 轮，每轮之间等够归并窗口，watcher 侧数到的事件数逐轮都是 1
（`perRound: [1×20]`, `notExactlyOne: 0`）。这条不是好奇心：**claim 是消费型**，
一次写只登记一条记录、只挡一次回声，若一次写落成两个事件，第二个必漏成"外部改动"。
数出来是 1，消费型语义才站得住。

**接缝换实体后的五条 RV**（都对着"接缝没对齐"的具体形态）：

| 破坏 | 结果 |
|---|---|
| `claim` 恒 false（接缝断开） | 单测 3 条红 |
| claim 少给 `size`（指纹三件套缺一） | 单测 3 条红 |
| claim 不做 realpath（`/var` vs `/private/var`） | **单测 3 条红**；smoke 检查 6 仍绿——见下 |
| `settle` 不看 `currentPage` | 单测 2 条红（含 #21 自己改名那条） |
| `files.ts` 改回自己 record | 不做：接缝语义写明 L3 只 claim；该由 #21 那条链守 |

**又一次「破坏后仍绿」，与 §1.5 上表同因，不另计 dead check**：claim 不做 realpath 时
smoke 检查 6 照样绿，因为生产路径上还有第二道——`file/write` 之后 ipc 会 `refreshStamp`，
印记未变的守卫把漏下来的事件挡住了。**单测层没有那道兜底**（不经 ipc），所以它红。
判词与 RV7 同：这是纵深防御而非空转，**敏感的那一层是单测**；smoke 只在两道全拆时才红。
计数上保持 `dead_checks: 3`（本期真正改过判据的三条），不为同一现象重复计数——
若人审认为该按 L2 的口径逐次计，改成 4 并在此处加一行即可。

> **已裁（2026-08-06 收尾复核）：维持 3。** 与 L2 那条 `dead_check`（smoke #8）不是同一件事，
> 两者的分界线是**破坏之后产品到底坏没坏**：
> · L2 #8：破坏之后警示点**真的看不见了**，而检查照绿——检查测的不是它命名的那件事，是空转；
> · 本条：破坏之后回声抑制**在生产路径上仍然成立**（`refreshStamp` 那道兜住了），
>   smoke 绿是**如实反映**，而隔离了那道兜底的单测如期红。这是纵深防御，不是空转。
> 判据因此定死为一句话：**破坏后仍绿，先问"产品坏了吗"——坏了才是 dead check，
> 没坏就是冗余，该记的是"哪一层才是敏感层"。** 这条判据补进 §1.9 条目 7 的教训里。

**`bun run check` 最终输出**：
```
lint 0.4s ｜ typecheck 7.8s ｜ deps 1.6s ｜ bridge 0.4s ｜ workspace 0.1s ｜ theme 0.1s ｜ artifacts 0.1s ｜ patches 0.4s ｜ marks 0.3s ｜ test 7.8s
PASS
```
**smoke**：`bunx playwright test` → **29 passed**（既有 19 + 本期 10），零 flaky（连跑两轮）。

## 1.6 验证（两栏）
**CC 代验**：§1.4 全部 20 条 + 上面的 RV 记录 + `bun run check` PASS + 29 条 smoke 全绿。
横条的三种形态（saved / removed / degraded）由 smoke 按 `data-sepia-conflict` 断言，
**截图留档未做**（留人工验证时顺手，见下）。

**真人（压到最少）——2026-08-06 人工轮，人裁：两项通过、两项记债、一项随轮已看**：
- [x] ① 用 vim 与 VS Code 各改一次当前 page：**无脏 ✓**（重载 + 光标体感）、
      **有脏 ✓**（字零丢失、横条如期出现）——DoD_a 前两条的体感面就此坐实
- [ ] ② 走一次 `files.trash` 命令，在 Finder 的回收站里把那个文件找出来
      → **本轮不验，记债 A**（见下）
- [ ] ③ `open -a Sepia /tmp/x.md` 游离打开写几个字并保存 → **本轮不验，记债 B**（见下）
- [ ] ④ **双击 .md 打开**——依赖打包（未打包的应用不在 LaunchServices 里）→ **并入债 B**，挂 `.dmg` 债一并验
- [x] ⑤ 抽证据包 2 条——**随 ①② 那一轮已看**

### 本轮记债的两项，以及为什么现在验不了

**债 A：`files.trash` 现在没有任何人能触达它。** 命令注册了，但**没绑键**（⌘/ 命令面板归
Stage 7、文件树 UI 归 6b），所以人工走查连入口都找不到。机器侧也只到"进了某个卷的
`.Trashes/<uid>`"——`~/.Trash` 读不了（macOS TCC，实测 `Operation not permitted`），
而且 smoke 用的是**一次性卷**，那个卷跟用户的废纸篓根本不是一回事。
于是「废纸篓里看得见」这句**人机都没验过**，它现在是一句纯粹的断言。
**b 期一绑键或一做 UI，第一个人工项就是它。**

**债 B：游离打开的人工走查。** dev 下的等价通道是 `bunx electron . x.md`（走 argv 第二实例
那条路，机器侧 smoke 已覆盖）；双击那半本来就要打包才验得了（LaunchServices 不认未打包的
应用）。两半合并挂到 `.dmg` 债上一起验——分开验会验两次同一件事的两个侧面。

## 1.7 实测记录

| 指标 | 预算 | 本 stage 实测 | 上一 stage（150） |
|---|---|---|---|
| 冷启动 t0→t5 | < 1s | **559ms**（五连跑 542/559/561/554/561） | 523ms |
| t0→t3 窗口可见 | < 500ms | 385ms | — |
| t3→t5 可写 | < 500ms | 173ms | — |
| watcher 挂载（page 目录、非递归） | — | **79ms**（异步路径，不挡光标） | — |
| 外部改 → 通知 | — | 133ms | — |
| 外部删 → 通知 | — | 240ms（归并窗口 300ms 后约 400ms） | — |
| 自写一次（`atomicWrite` + 印记） | — | 4ms | — |
| 一次 focus 对账 | — | < 1ms | — |
| **反例**：整棵 `art/` 递归监听 | — | **87.6s / rss 1.3GB / 4138 次 EMFILE** | — |
| 同树 `depth:2` | — | 564ms / 1479 项 / 58MB / 零错误 | — |
| **一次写 = 几个 watcher 事件** | 恰好 1 | **1（20/20 轮）** | — |
| 依赖新增 | — | `chokidar@4.0.3`（+2 包，零原生模块） | — |

冷启动 +36ms 相对 150 的 523ms：在机器忙时（并行线在跑 smoke）单次曾测到 743ms，
静一点的连跑稳定在 542–561ms。**这一段仍算噪音**——150 债 3「冷启动基线重立」未清，
且 6a 没有往同步路径上加任何东西（watcher 挂载在 `file/read` 之后异步发生）。

## 1.8 风险（探测结果）
| # | 风险 | 探法与**结论** |
|---|---|---|
| 1 | chokidar v4 + `atomic` 对我们 tmp+rename 的真实归并行为 | **已先探（最小脚本，chokidar 4.0.3 / macOS 14 / APFS）**：`atomic:true` 下 tmp+rename = **一次 change**；vim 式 backup+write = 一次 change；就地写有时**两条** change。**关掉 atomic 更糟：tmp+rename 变成零事件**（rename 覆盖已监听文件在 mac 上不报）——所以 `atomic:true` 不是优化而是必需。另有硬边界：**监听单个文件路径完全收不到事件**（六种写法全零），监听对象只能是目录 |
| 2 | 大 book 的 watch 成本 | **已探，且改判了范围**（§1.1 三）：递归监听真实 `art/` = 87.6s / 1.3GB / **4138 次 EMFILE**（chokidar v4 无 fsevents，每目录一个 `fs.watch`）。**这不是 Linux 专属的长期债，mac 上当场就炸**。a 期收到「page 所在目录、非递归」= 79ms。b 期的文件树必须带上限 + 降级（回流 1） |
| 3 | 外部删除 vs 移动的事件歧义（unlink+add） | 已探：真移动 = `add:新` + `unlink:旧`（**顺序还不固定**，atomic 开关会换顺序）；unlink→重建 ≤100ms 由 chokidar 折成 change，**>100ms 则是一对**。因此自建归并窗口必须 **>100ms**（定 300ms），否则是装饰——首轮 RV 正是这么抓到的（§1.5） |
| 4 | L2 接缝的桩与实体差异 | **已消（2026-08-06 集成收尾）**。差异有三处，逐条对上：桩的指纹是 `{path, mtimeMs, atMs}` → 实体要 `{path, mtimeMs, size}`（**补 size**）；桩不管符号链接 → 实体要求**两侧 realpath**；桩是"查询型"过滤 → 实体是**消费型 claim**（于是多出「一次写必须恰好一个事件」这条前提，已实证 20/20）。桩连同 `fsio` 里那次 record 一并删除——**登记点只剩写盘管线一个**。core 里那份重复判据同删。集成证据：全量 check PASS + smoke 35/35，其中「保存一次不自我重载」在真接缝下绿 |
| 5 | **新发现：并行线之间抢单实例锁** | 已解。Electron 的 `userData` 在 macOS 上**无视 `$HOME`**，单实例锁按它定——L2/L3 同时跑 smoke 时后启动的应用直接 `app.quit()`，一扇窗都不开，报出来像"应用起不来"（实际是 T-29 在正确工作）。加 `SEPIA_TEST_USER_DATA` 隔离，五个既有 smoke 文件一并接上；此后 L2 在跑的同时本地 29 条 smoke 全绿 |

## 1.9 回流

1. **架构 §4.9 / T-26 要补一句范围与上限**：「用 chokidar v4 监听 book」在真实 book 尺度上
   不成立（数字见 §1.7）。终态应写成「监听有界：默认只盯当前 page 所在目录，文件树按需扩展且
   带 entry 上限，超限自动降级为仅 focus 对账」。**b 期做文件树前必须先落这条**。
2. **`usePolling` 逃生舱在 v4 仍然有效**（`fs.watchFile` 那条路径还在），设计点无需改判——
   已在 `config.watcher.usePolling` 落地，本期真读。
3. **b 期的「用外部的」需要外部版本的留存**：a 期有脏冲突按架构 §4.9 先落盘，外部那一版
   **在磁盘上就被覆盖了**。b 期要给三选，就必须在覆盖前把外部内容留一份（`~/.sepia/books/<id>/conflicts/`
   之类）。这条不在 a 期范围内，但**不写下来 b 期会以为三选是纯 UI 工作**。
4. **`command registry` 的 `run` 已可带参数**（`execute(id, arg)`，纯追加）。b 期接文件树 UI 时
   直接用，不要另造一条"带参数的命令"通道。
5. **smoke 的并行隔离已成既有设施**：`SEPIA_TEST_USER_DATA`。新写 smoke 一律带上，
   否则两条线并行时会互相踩（§1.8 风险 5）。
6. **smoke 的单实例锁隔离已铺满六个文件**（含 L2 新加的 `save-commit.spec.ts`）。
   这不是洁癖：不隔离时两条线并行跑 smoke，后启动的应用抢不到锁直接 quit，
   一扇窗都不开，报出来是「Target page has been closed」——像应用坏了，实则 T-29 正常工作。
7. **002 §1 的层级表可补一例**：本期首轮三条空转全部是「同一性质被上游另一道保护兜住」，
   而不是断言写错。教训是——**破坏方式要瞄"这道保护是唯一的那道"**，若不是唯一的，
   就得把上下游一起破坏，或把判据换到只有这道保护能兑现的可观测量（撤销历史那条）。

---

## §2 · b 期（库 UI）——入口条件与范围预留

**入口条件：5a 与本 a 期均合并进主干，且 5b 先行完成**（5b/6b 都动 renderer shell，串行，5b 先）。
范围预告：文件树（可全收起侧边）、最近的 page、多 Tab（session schema 扩展——冻结令
在此正式解除）、主页/onboarding（无 book 两条路）、`@` 引用选择器与双屏（W9）、
冲突三选完整 UI、重命名更新链接命令（T-31 全流程）、拖拽按落点分工表（架构 §4.9）。
**dod_b 的「整个 art/ 作 book 启动仍 <1s」是继基线重立之后冷启动预算的下一次真实考验。**

---

## Stage 6a 完成（2026-08-06）

**dod_a 六条判定：**

| DoD | 判定 | 据什么 |
|---|---|---|
| 外部改（无脏）→ 重载且尽量保光标 | **达成** | smoke + 人工轮 ①（vim / VS Code 各改一次，光标体感确认） |
| 外部改（有脏）→ 先落盘 + 横条提示 | **达成** | smoke 断言 `data-sepia-conflict`；人工轮 ①**字零丢失**、横条措辞确认 |
| 自写不自扰 | **达成** | 接缝换实体后实测「一次 atomicWrite = 恰好一个 watcher 事件」20/20 |
| 删除进回收站 | **机器达成，人工未验** | 机器只到「进了某个卷的 `.Trashes/<uid>`」；**记债 A** |
| 游离打开可写 | **机器达成，人工未验** | argv 第二实例通道 smoke 覆盖；**记债 B** |
| watcher 失效时 focus 对账仍工作 | **达成** | smoke（禁用 watcher 后仍对账） |

**遗留债（本期新增两条）**

| # | 债 | 何时还 |
|---|---|---|
| A | **`files.trash` 的「废纸篓里看得见」人机均未验**：命令没绑键（⌘/ 归 Stage 7、文件树归 6b），人工找不到入口；机器侧受 TCC 限制且用的是一次性卷 | **b 期一绑键/一做 UI，第一个人工项就是它** |
| B | **游离打开的人工走查**（dev 通道 `bunx electron . x.md`）+ **双击 .md**（要打包才验得了） | 并入 `.dmg` 债，随 release 专项一起验 |
