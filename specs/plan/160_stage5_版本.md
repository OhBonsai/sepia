---
stage: 5
title: 版本
status: planned   # 2026-08-06 起草。a 期（L2 并行线）即刻可开工；b 期入口条件见 §2
dod_a: 写字→停 800ms 自动落盘；静默/定时 commit 产生且个位数、带 trailer；锚点四级（映射/平移/模糊/孤儿）标定用例全过；并发 commit 不撞 index.lock
dod_b: 外部改文件后徽章重对齐成功或优雅降级孤儿；⌘⇧H 还白可来回切（b 期入口后回填细化）
checks_added: 0
checks_reverse_verified: 0
dead_checks: 0
exemptions: 4          # 继承 150 收尾值
disputes: 0
measured: {}
---

# 160 · Stage 5：版本（a 期：GitService + 三触发 + 锚点）

> 模板：003 §1 ｜ 上游：001 §7、002 §7、架构 §4.2 §5、T-27/T-29/T-34 ｜ 基线：150（Stage 4，已关闭）
> 原型对照：W8 后半（徽章浮现）与 W10/W11 全归 **b 期**；a 期无原型对照面（纯机制层）

> **a 期交付的是纸的"时间维度"底座**：写盘与 commit 两条时间线立起来（架构 §4.2），
> 锚点作为纯函数模块可标定、可测。**徽章、线程面板、⌘⇧H、成对 commit 的 markup 接线
> 一概不在**——那是 b 期，入口条件 = 本 a 期与 6a 合并进主干。

---

## 1.1 前置

### 〇、并行声明（L2 线；与 170 §1.1〇 同文）

L1（Stage 4）已合并关闭，master 即基线。本 a 期为 **L2**，与 **L3（Stage 6a：watcher/对账/
冲突/文件操作，170）** 同期在飞（各自 worktree）。规则：

1. **合并顺序：L2 先合，L3 rebase**——保存管线是回声抑制的上游（见 3）。
2. **shell 冻结令继续**：L2/L3 不碰 `App.tsx` / `EditorHost` / session schema / renderer
   editor 区。renderer 侧只允许两处点状 UI：L2 的**纸角警示点**（写盘失败，架构 §4.2）、
   L3 的**冲突提示横条**（复用 Stage 3 提示线模式）。
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
4. 共享注册表仅追加（003 §5 清单）；`bun.lock` 冲突以重新 `bun install` 为准。

### 一、Stage 4 的 DoD 达成情况
已关闭（150，2026-08-06）：全链真模型跑通、CAS 中止、undo 原子、m0–m5 六点齐（功能判定，
性能记债）。本期赖以开工的存量：落笔即写盘的管线、`atomicWrite`、单实例串行（T-29）。

### 二、继承债逐条重问
| 债 | 本期裁决 |
|---|---|
| 150 债 1/2/3（性能实测/基线重立/.dmg） | 不动。**建议 a 期合并后插一次 release 专项一并清**（三者互相咬着） |
| 150 债 4（typecheck 增量化，触发式） | 未触发不动 |
| **150 债 5（`agent=title` 冗余调用）** | **✓ 已还**（2026-08-06）：引擎有开关——`agent: { title: { disable: true } }` 命中即 `delete agents['title']`，而取标题那段开头就是 `agents.get("title")` 取不到就 `return`（vendor `session/prompt.ts`），**整段跳过而非跑完丢掉**。已注入 `OPENCODE_CONFIG_CONTENT`。真引擎复验：整轮 stream 行**从两条降到一条**（只剩 `agent=rewrite`），a4 装置的判据同步加严为「stream 行总共一条」 |
| **150 债 8（002 补元规则）** | **✓ 已还**（2026-08-06）：002 §6 规则 2 下补推论——「破坏方式必须瞄准真正会出事的那个场景，而非功能的一般路径」，附**四例索引**（150 的 #4/#7/#9/#17，各写明"破坏后仍绿是因为什么"与"改成什么才红"）与一句形态判据：**桩替被测系统假设掉的那部分，正是检查最容易空转的地方** |
| 130 债①（列表/表格视觉） | 不动，攒视觉专项 |

### 三、设计点（计划自带答案，人审一并裁）
| 点 | 答案 | 依据 |
|---|---|---|
| git 实现 | **系统 git CLI 子进程**，不引 isomorphic-git（零新依赖、T-18 无原生模块；book 本就 = git repo）。无 git / 非 repo → 优雅降级为"仅写盘无版本"（与游离 page 降级同构） | 001 §2.1 / T-30 |
| commit message | 固定 message + git trailer（`Sepia-Page`；`Sepia-Thread` b 期才有值），**不调模型**（架构 §4.2 原则） | T-32 同族 |
| 自动写盘的宿主 | renderer 停止输入 800ms → 走既有 `api.file.write`（**桥零增长**）；commit 由 main 侧 GitService 监听 fsio 写事件触发，renderer 不知道 git 存在 | 架构 §4.2 顺序恒为写盘→commit |
| 纸角警示 | 写盘失败推送 → 纸角持久警示点。**拟增桥 1 项**：`api.file.onWriteStatus(cb)`（唯一增长，快照 diff 为准） | 架构 §4.2 失败表现 |
| 锚点参数标定 | 用 `specs/` 与 `~/Downloads` 的真实长文各一篇做标定集（fixture 进仓库脱敏截段）；参数进 config，不写死 | 架构 §4.2「用真实文章标定」 |
| book 身份 | MVP 锁单 book；`~/.sepia/books/<book-id>/`，book-id = 路径稳定散列；`meta.json` 记路径 + 「重新关联」命令留 b 期 | T-34 |

## 1.2 范围（a 期做什么）

**写盘时间线**
- [ ] 停止输入 800ms 自动写盘（防抖；⌘S 仍即时）；失败 → 纸角持久警示点，恢复即消
- [ ] 「最近自写记录」环形表（共享接缝，见 §1.1〇-3）

**commit 时间线（GitService）**
- [ ] `main/services/git.ts`：**内部一条队列，串行化一切 git 操作**（防 index.lock，架构 §4.2 原则一）
- [ ] 三触发之二：静默（长于 800ms 一个量级，默认值进 config）→ `sepia: save`；定时兜底（默认 5min，取先到者）→ `sepia: auto`；**内容无变化不 commit**
- [ ] markup 成对触发：**只建 API**（`commitPair(reason)` 可调、有单测），不接 markup——接线是 b 期
- [ ] trailer 写入与解析；commit 完全异步，失败 ⌘⇧I 留痕（留痕机制先落数据，浮层 UI 归 Stage 7）
- [ ] 无 git / 非 repo 降级：仅写盘，无警示骚扰

**锚点纯函数模块（`core/anchor/`，110 起刻意不建的目录此刻建）**
- [ ] 三级对齐：CM6 位置映射（会话内）→ git diff hunk 平移 → 引文 + 前后文模糊匹配 → **失败即孤儿**
- [ ] **宁可孤儿不误挂**（架构 §4.2 原则：误匹配比孤儿更糟）——模糊匹配阈值保守，参数进 config
- [ ] 标定集用例：真实文章 fixture，四级各至少 2 例 + 误挂反证例（改得面目全非必须判孤儿）
- [ ] 锚点数据落 `~/.sepia/books/<book-id>/`（T-34，不进 git）；本期只有读写与对齐，无消费者

**明确不做（刹车）**：徽章/线程面板/⌘⇧H/成对 commit 接线（b 期）；watcher（L3 的地盘，
外部变更触发重对齐 b 期再接）；commit message 调模型（永不）；多 book；回滚/revert UI；
**改 App.tsx / EditorHost / session schema（冻结令）**。

## 1.3 结构与暴露面
| 包 | 新增 |
|---|---|
| `core` | `anchor/`（纯函数 + 类型）、commit/trailer 类型 |
| `app` main | `services/git.ts`、写盘管线扩展（防抖协调、自写记录、警示推送） |
| `app` renderer | 800ms 防抖接线（复用 write 通道）、纸角警示点（点状 UI，冻结令内的豁口已在 §1.1〇 声明） |

**桥**：拟增 `api.file.onWriteStatus(cb)` **一项**，其余零增长。**依赖**：零新增（系统 git CLI）。
**磁盘**：`~/.sepia/books/<book-id>/{meta,anchors}.json`。**配置**：静默阈值、定时间隔、锚点参数——只加真读的。

## 1.4/1.5 harness（口径 003 §3.2，破坏方式预写且瞄"出事场景"——150 债 8 的新元规则首次执行）
| # | 检查 | 破坏方式（瞄出事场景） |
|---|---|---|
| 1 | 单测 · git 队列串行 | 两个 commit 并发发起 → 去掉队列必撞 index.lock（真 repo 里验） |
| 2 | 单测 · 三触发时序（fake timers） | 静默与定时同时到 → 只许一次 commit；连续输入永不 commit |
| 3 | 单测 · 无变化不 commit | 内容未变时触发 → 破坏后出现空 commit 必红 |
| 4 | 单测 · trailer 往返 | 特殊字符 page 路径 → 解析破坏必红 |
| 5 | **单测 · 锚点四级 + 误挂反证** | 把模糊阈值放宽到误挂 → **反证例必红**（这是"真正会出事的场景"：错挂比丢失糟） |
| 6 | 单测 · 降级 | 非 git 目录 → 写盘照常、零 git 调用、零警示 |
| 7 | smoke · 写字→800ms→盘上有→静默 commit 出现（trailer 齐） | 吞掉防抖/吞掉 commit → 必红 |
| 8 | smoke · 写盘失败纸角警示 | 复用 Stage 1 chmod 555 测法脚本化 |
| 9 | **smoke · IME 组合中不写盘**（风险 1）：CDP 真组合管线，组合期间盘上不出现拼音 | 去掉挂起 → 盘上出现 `nihao` 必红 |
| 10 | **smoke · 组合中途失焦仍能自动保存**（风险 1 的保险）：组合中 `blur`，此后打字仍按 800ms 落盘 | 只认 `compositionend` 不认 `blur` → **自动保存从此静默停摆**，必红。破坏瞄的是"悄悄不保存了"这个事故，不是"能不能保存"的一般路径（002 §6.2） |

## 1.6 验证（两栏）
**CC 代验**：上表全部 + RV 记录 + `git log` 样本留档（个位数、message 干净）。
**真人（压到最少）**：① 写一段真文字，观察 800ms 落盘无感、不打断输入；② `git log` 观感——
一次写作个位数 commit、message 可读；③ 抽证据包 2 条。

## 1.8 风险
| # | 风险 | 探法 |
|---|---|---|
| 1 | 800ms 防抖与 CM6 输入的交互（IME 组合中不许写盘） | **已探完（2026-08-06），结论见下** |
| 2 | git CLI 在用户环境的差异（版本/配置/hook） | 边做边探；`-c` 显式覆盖关键配置，用户 hook 不执行（`--no-verify`?）——查证后定，记回 |
| 3 | 锚点标定集的代表性 | 边做边探；b 期真实使用后回标 |
| 4 | 定时 commit 与静默 commit 的竞态 | 队列天然串行 + 单测 #2 |

### 风险 1 的探针结论（2026-08-06，CDP 真组合管线）

装置沿用 130 smoke ③ 那套 CDP `Input.imeSetComposition`——**合成 CompositionEvent 设不动
`view.composing`**（130 §1.8 风险 4 实测），只有 CDP 走的是与真 IME 同一条管线。三问三答：

**一、组合中途文档里装的是什么？** 拼音本身。实测中途文档是 `输入区nihao 尾`——
**这一刻写盘，落到磁盘上的就是 `nihao`**。它随后会被 `你好` 替换掉，所以不是数据损坏；
但盘上确实短暂存在过一个用户从没打算保存的版本，且组合每敲一下都触发一次写。
**这就是"IME 组合中不许写盘"的具体理由**，不是洁癖。

**二、靠什么信号知道正在组合？** `compositionstart` / `compositionend`，**它们冒泡到
`document`**——实测在 `document` 上就能收全。这一条决定了实现形态：
**防抖的挂起/恢复不需要碰 `EditorHost`，也不需要 `view.composing`**，
在 renderer 顶层挂两个监听即可。**冻结令因此不被触碰**（§1.1〇-2）。

**三、`compositionend` 时文档是终态了吗？** 是。实测事件顺序为
`compositionstart → (update, input)×n → input(你好) → compositionend`——
**带最终文本的 `input` 排在 `compositionend` 之前**。所以恢复防抖时直接用当前文档即可，
不必为"等文本落定"再补延时。

**据此定的做法**：`compositionstart` 取消在飞的防抖并挂起；`compositionend` 解挂并重启计时。
**外加一条保险**：`blur` 也解挂——组合中途切走窗口时 `compositionend` 未必来，
只认 `compositionend` 的话防抖会永久挂起，那是"自动保存悄悄停了"，比写早了更糟。
这条保险要有自己的检查（挂进 §1.4/1.5，破坏方式瞄的正是"组合中途失焦 → 从此不再自动保存"）。

---

## 1.9 回流
实施中累积。已知候选：002 §6.2 元规则（债 8，开门做）。

---

## §2 · b 期（徽章/线程/⌘⇧H）——入口条件与范围预留

**入口条件：a 期与 6a 均合并进主干。** 届时按 003 模板把本节展开成完整 plan 章节再开工。
范围预告：徽章小点（≤8px，W8）、线程面板 + 孤儿置灰区（W11）、⌘⇧H 还白（W10）、
成对 commit 接 markup 落笔链（UI 先行 300ms，链后台）、锚点消费（打开文件时对齐 + 外部
变更触发重对齐——与 6a 的 watcher 事件在此汇合）、`threads/*.json` 持久化、撤销联动
（T-27：撤销徽章移出面板对话保留）。**b 期是 shell 冻结令解除后第一个动 renderer 的，
与 6b 串行，b 先。**
