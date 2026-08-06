---
stage: 6
title: 库与文件
status: planned   # 2026-08-06 起草。a 期（L3 并行线）即刻可开工；b 期入口条件见 §2
dod_a: 外部改文件（无脏）→ 重载且尽量保光标；（有脏）→ 先落盘 + 横条提示；自写不自扰；删除进回收站；`open -a Sepia x.md` 游离打开可写；watcher 失效时 focus 对账仍工作
dod_b: 整个 art/ 作 book 启动仍 <1s；@ 搜索即时（b 期入口后回填细化）
checks_added: 0
checks_reverse_verified: 0
dead_checks: 0
exemptions: 4          # 继承 150 收尾值
disputes: 0
measured: {}
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

   **状态**：纯模块 + 7 条单测已随 L2 落地（`packages/core/test/self-write.test.ts`，
   两条破坏——不消费、指纹去掉 size——均实证必红）。**L3 现在就能 import 真类型**，
   不必等 L2 的写盘管线合并；要跑通链路再用本地桩接 `record` 那一侧。
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
| 对账兜底 | 窗口 focus 时按 mtime/size 快速比对；watcher 整体失效 → 降级"仅 focus 对账"，写作不受影响 | 架构 §4.9（**必须有对账兜底**） |
| 冲突策略 | 无未落盘改动 → 重载 + 尽量保光标；有 → **先立即落盘**，横条提示"外部已修改"（保留我的/用外部的/看 diff 三选归 b 期，a 期横条只报事实 + 打开 Finder 定位） | 架构 §4.9（绝不静默覆盖） |
| 回声抑制 | 「路径 + 刚写入 mtime」过滤（消费 L2 接缝）；git 操作的自写同样过滤 | 架构 §4.9 |
| 删除 | 走系统回收站（`shell.trashItem`），不做自绘确认 | 架构 §4.9 |
| 重命名后更新链接 | **命令留形状不实现**（要改别的文件字节，T-31 用户主动发起 + 列清单 + 同 commit）——依赖 b 期 UI，整体归 b | T-31 |
| fileAssociations | `electron-builder.yml` 补 `ext:[md,markdown], role:Editor`；`open-file`/argv/拖图标三入口统一走游离 page 通道（T-30：无 book 则降级——无 git 无 @，纸完全可写）。**双击行为的人工验证依赖打包，挂 .dmg 债一并验**，本期先验 `open -a` 与 argv 两入口 | 120 §1.1 问题二（三者同期的承诺此处兑现） |

## 1.2 范围（a 期做什么）

**watcher 与对账**
- [ ] chokidar v4 监听当前 book（MVP 单 book）；`atomic:true`；事件归并防抖
- [ ] focus 对账：mtime/size 比对；watcher 失效自动降级仅对账，横条一次性告知
- [ ] 回声抑制：自写（含 git 操作）不触发重载；接缝见 §1.1〇-3

**冲突处理（a 期最小面）**
- [ ] 无脏 → 重载 + 保光标（内容变化时光标按位置夹取）
- [ ] 有脏 → **先落盘**（复用 L2 写盘管线；L2 未合并期用直接 write），再横条提示
- [ ] 外部删除当前 page → 横条 + 转游离态（内容保留在编辑器，可另存）

**文件管理（服务层 + 命令，UI 归 b 期）**
- [ ] `main/services/files.ts`：新建 / 重命名 / 移动 / 删除（回收站）；全部经 command registry 注册
- [ ] 桥拟增 `api.files.*` 四项 + `api.files.onExternalChange(cb)` 一项（见 §1.3）

**入口三通道（120 问题二收尾）**
- [ ] `fileAssociations` 补齐；`open-file` handler 接通游离 page；argv 打开与拖图标同通道
- [ ] 游离 page 降级语义：无 book → 无 git/无 @，纸全功能可写（不变量 1 同构）

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

## 1.4/1.5 harness（破坏方式预写，瞄"出事场景"）
| # | 检查 | 破坏方式（出事场景） |
|---|---|---|
| 1 | 单测 · 冲突判定矩阵（脏 × 外部改 × 删除） | 有脏时判成"直接重载" → **必红**（这是覆盖用户字节的那个场景） |
| 2 | 单测 · 回声抑制 | 自写 mtime 过滤去掉 → 保存一次触发自我重载必红 |
| 3 | 单测 · 光标保持夹取 | 外部变更后光标越界 → 夹取去掉必红 |
| 4 | smoke · 外部改（无脏）→ 重载保光标 | 真文件系统 touch+改内容 |
| 5 | **smoke · 外部改（有脏）→ 先落盘 + 横条,零字节丢失** | 去掉"先落盘" → 用户的字丢了必红（不变量级心态对待） |
| 6 | smoke · 自写不自扰 | ⌘S 后断言零重载事件 |
| 7 | smoke · 删除进回收站 | 假删（unlink）→ 回收站无该文件必红 |
| 8 | smoke · 游离 page：argv 打开非 book 文件 → 可写可存、git 零调用 | 降级判定去掉必红 |
| 9 | smoke · watcher 失效降级 | 杀掉 watcher → focus 对账仍抓到外部变更 |

## 1.6 验证（两栏）
**CC 代验**：上表全部 + RV 记录 + 横条截图留档。
**真人（压到最少）**：① 用 vim/VS Code 改当前 page，看重载与横条的体感（无脏、有脏各一次）；
② 删一个文件到回收站里找到它；③ `open -a Sepia /tmp/x.md` 游离打开写几个字；④ 抽证据包 2 条。

## 1.8 风险
| # | 风险 | 探法 |
|---|---|---|
| 1 | chokidar v4 + `atomic` 对我们 tmp+rename 的真实归并行为 | **先探**：最小脚本验证一次写=一次 change |
| 2 | 大 book 的 watch 成本（Linux inotify 上限属长期债,mac 先记录） | 边做边探,记数字 |
| 3 | 外部删除 vs 移动的事件歧义（unlink+add） | `atomic` 之外补 100ms 窗口归并,单测矩阵覆盖 |
| 4 | L2 接缝的桩与实体差异 | rebase 后跑全量 smoke 即集成验证 |

## 1.9 回流
实施中累积。

---

## §2 · b 期（库 UI）——入口条件与范围预留

**入口条件：5a 与本 a 期均合并进主干，且 5b 先行完成**（5b/6b 都动 renderer shell，串行，5b 先）。
范围预告：文件树（可全收起侧边）、最近的 page、多 Tab（session schema 扩展——冻结令
在此正式解除）、主页/onboarding（无 book 两条路）、`@` 引用选择器与双屏（W9）、
冲突三选完整 UI、重命名更新链接命令（T-31 全流程）、拖拽按落点分工表（架构 §4.9）。
**dod_b 的「整个 art/ 作 book 启动仍 <1s」是继基线重立之后冷启动预算的下一次真实考验。**
