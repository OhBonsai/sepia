---
stage: 1
title: 纸
status: done
dod: 冷启动 <1s 打开上次 page 且可写；无白闪
checks_added: 14
checks_reverse_verified: 14
exemptions: 1
disputes: 0
measured:
  cold_start_p50_ms: 440
  cold_start_p90_ms: 450
  t0_to_window_visible_ms: 316
  window_to_caret_ready_ms: 118
  check_full_s: 6.3
  check_fast_s: 4.2
  reverse_coverage: 1.0
  dead_checks: 0
  bundle_mb_dmg_arm64:
---

# 120 · Stage 1：纸

> 模板：[`003_stage_playbook.md`](./003_stage_playbook.md) §1 ｜ 上游：[`001_boot.md`](./001_boot.md) §7、[`002_boot_harness.md`](./002_boot_harness.md) §7、[`../design/sepia-architecture.md`](../design/sepia-architecture.md) §1 §4.4 §4.7 §4.9 §5 ｜ 前一 stage：[`110_stage0_骨架.md`](./110_stage0_骨架.md)

> **这个 stage 交付的是不变量 1 的前半句**：结束时 Sepia 是一个能打开、能写、能存、秒开的纯文本编辑器。**语法与 Agent 都还不在**，但纸必须已经是真的。
>
> **Stage 1 于 2026-08-04 关闭。** DoD 达成（冷启动 P50 440ms / P90 450ms，预算 1000ms；无白闪两条 smoke + 人工均过）；
> 反向验证 14/14、空转 0、dispute 0、exempt 1；人工验证通过 9 / 延后 1。附录 B（4 条）与附录 C（2 条）均已裁决落地。
>
> **带出 Stage 1 的遗留债**（每个 stage 的 §1.1 要重新问一次"现在有条件了吗"）：
>
> | 债 | 内容 | 何时还 |
> |---|---|---|
> | `.dmg` 人工确认 | 下载→挂载→安装→启动，有纸有光标 | 下次 release 时（人工裁决继续延后） |
> | `.AppImage` / `.exe` | 长期债，无 Linux / Windows 设备 | 挂在架构 §8「win/linux 无日常自用覆盖」名下 |
> | dev 模式两条待打包重验 | 「冷启动主观感受」「无白闪」在 dev 模式下判的通过，与用户实际启动不是一条路径 | 随 `.dmg` 那次一起用打包产物重验 |
> | Stage 6 入口条件 | `fileAssociations` + 游离 page + 双击行为人工验证三者同期；`session.json` 相对路径迁移（读旧格式） | Stage 6 开工时 |
> | 阶梯第 5 层的教训 | 002 §1 第 5 层补「或写一条恒真的断言」的绕过方式（C.1 的元教训，002 未回写） | 下次动 002 时 |

---

## 1.1 前置

### 一、Stage 0 的 DoD 达成情况

DoD 原文：**三平台包可下载、能开空窗口；turbo 能按包并行跑 typecheck 与测试**。三条全部达成，证据如下（不是"我记得过了"）。

**三平台包可下载** —— `alpha-latest` prerelease 的五个资产，逐个 HEAD 请求均 200：

```
Sepia-0.0.0-arm64.dmg          115 MB   macOS arm64
Sepia-0.0.0-x64.dmg            117 MB   macOS x64
Sepia-0.0.0-x86_64.AppImage    123 MB   Linux
Sepia-0.0.0-amd64.deb         95.1 MB   Linux
Sepia-0.0.0-x64.exe           95.6 MB   Windows
```

**能开空窗口** —— 构建产物直接启动：

```
sepia: window ready, registry=1, pending=[]
```

**turbo 按包并行且遵守依赖顺序** —— 冷缓存实测：`core` 先跑，`editor`/`agent`/`ui` 并行，`app` 最后；`bun run check` 冷测 **4.8s**，最后一行 `PASS`。

**人工验证**：已验 5 条、人裁决跳过 1 条、延后 3 条，Stage 0 于 2026-08-04 关闭（110 §1.6）。

#### 继承过来的三条延后账：本 stage 收不收尾

| 账 | 本 stage 裁决 | 理由 |
|---|---|---|
| `.dmg` 能装能起 | **本 stage 收尾**，列入 §1.6 人工清单 | Stage 1 结束时窗口里有真的纸和光标，装完看得见东西；而 Stage 0 装完只有一块空白，验了也说明不了什么。**这正是当初延后的理由，条件现在满足了** |
| `.AppImage` | **不收尾，转长期债** | 手边无 Linux 机器——这是**设备条件**不是意愿问题，硬排进 DoD 只会逼出一个假勾。**但给一条真兜底**：本 stage 把 CI 的 smoke 改成走与人相同的入口（见问题三），Linux 的运行时路径从此每次 push 都被真跑一遍。这不等于"人工确认过安装包"，但比现在强 |
| `.exe` | **不收尾，转长期债** | 同上，且 Windows 连 CI 运行时 smoke 都没有（`build` 只打包不运行）。**明确挂在架构 §8「win/linux 无日常自用覆盖」名下**，随该风险一起管理，不在本 stage 假装解决 |

> **不许把"转长期债"读成"算了"。** 它的含义是：这两条**不进本 stage 的 DoD**，但留在债务清单里，且每个 stage 的 §1.1 都要重新问一次"现在有条件了吗"。

### 二、`open-file` 的中间态：**划给 Stage 6**

**结论：不补 `fileAssociations`，把 `open-file` 从 Stage 0/1 的功能范围里划掉，整体判给 Stage 6（库与文件）。**

现状是 110 附录记的：`main/index.ts` 里 `app.on('open-file', …)` 的 handler 在，但 `electron-builder.yml` 没有 `fileAssociations` 段——系统不知道 Sepia 能开 `.md`，事件永远送不到。**处理事件的那半有，注册成 `.md` 处理器的那半没有。**

为什么判给 Stage 6 而不是现在补：

1. **补一半比不补更糟。** 一旦注册成 `.md` 处理器，用户双击任意 `.md` 都会进 Sepia——包括**不属于任何 book 的文件**。那条路是游离 page（T-30），属 Stage 6。现在补，用户双击后得到的是一个打不开该文件的窗口，比"双击没反应"更像坏掉。
2. **Stage 1 的 DoD 只需要三种入口里的第一种**（正常启动恢复 `session.json` 的上次 page）。argv / 双击 / 拖图标是第三种，与冷启动 <1s 无关。
3. Stage 6 的范围本来就是「文件树、最近的 page、多 Tab、文件管理、游离 page、拖拽」——`fileAssociations` 与它们是同一件事的不同侧面，一起做才有完整语义。

**消除中间态要做的三件事**（本 stage 开头做完，不许继续挂着）：

- [ ] `main/index.ts` 的 `open-file` handler 上方加注释：**未注册为 `.md` 处理器，当前只有 `open -a Sepia x.md` 能触发；`fileAssociations` 与游离 page 一并归 Stage 6**，并指回本节
- [ ] 110 §1.3 功能深度表里 `open-file` 一行标注为「**已划出 Stage 0 范围**」
- [ ] 记进 Stage 6 的入口条件清单：`fileAssociations`（`ext: [md, markdown]`、`role: Editor`）+ 游离 page + 双击行为人工验证，**三者同期**

> 保留 handler 而不删掉，是因为删了下次还得重写，且它本身是对的。**但"代码在"从此不再被读成"功能在"**——这正是中间态最危险的地方。

### 三、CI 的 smoke 改不改走与人相同的入口：**改，且在本 stage 开头就改**

**结论：改。CI 的 `bunx electron out/main/index.js` 换成 `bun run start`（`electron-vite preview`）。**

110 附录 A.6 已经付过一次代价：CI 那条 smoke 走 `bunx electron`，而 `bunx` 会触发 electron 的惰性下载并自愈，于是 **CI 恒绿、且永远会绿**，完全抓不到 `bun run dev` 起不来。CI 与人走两条路径。

本 stage 必须改，还多一条 Stage 0 没有的理由：**冷启动 <1s 是本 stage 的 DoD，而打点数字只有在人实际用的那条路径上测才算数。** 如果 CI 跑的是另一条路径，那 CI 上的打点断言守的就是另一个东西。

**已知风险**：`electron-vite preview` 在 CI 的 `xvfb-run` 下能不能跑通没验过——它比直接起 electron 多一层。记进 §1.8，探不动就退回直接起构建产物（但**必须先跑一次 `ensure-electron`**，把自愈那条路堵死）。

### 四、强制力阶梯第 2 层（包边界的编译期物理约束）：**本 stage 补验**

**结论：补，而且很便宜。**

110 §1.5 记的缺口：反向验证 ① 本想验它（`core` 里 `import 'electron'`），但 **lint 的结构 3 在 typecheck 之前就拦住了**，"包依赖没声明就 import 不到"这层物理约束从来没被真正走过。

补法——**换一个结构 3 不认识的目标**：在 `packages/core/src` 里 `import '@sepia/ui'`。结构 3 只拦 `electron` 与 Node 内建，`@sepia/ui` 不在其列，于是能一路落到包边界那一层：typecheck 报解析不到，`check:deps` 的 `not-to-unresolvable` 也应命中。**两处都要看到，才算这一层真的在守。**

补完 `checks_reverse_verified` 由 11 升到 12，覆盖率 12/13 ≈ **0.92**。剩下的一项是 oxlint（有真实战绩自证，仍不单独补验）。

### 五、架构 §8 未决清单的逐条裁决

**未决七条，本 stage 一条都不依赖**，但逐条说明而不是笼统跳过：

| 未决项 | 裁决 |
|---|---|
| `AGENTS.md` 内容 | 不影响 Stage 1（Stage 3） |
| markup system prompt 文案 | 不影响 Stage 1（Stage 4） |
| 阅读模式的正文抽取实现 | 不影响 Stage 1（外链只做系统浏览器打开，Stage 7） |
| 动词按语言分组 | 不影响 Stage 1（Stage 4） |
| 锚点模糊匹配的参数值 | 不影响 Stage 1（Stage 5，需真实文章标定） |
| **「上下文范围」默认值** | **确认不影响 Stage 1，但有前提**——见下 |
| `sepia-prototype-features.md` 补号 | 文档债，与本 stage 无先后关系 |

#### 「上下文范围」默认值为什么值得单独说

它的冲突是真的：**设置清单写「整篇」，而 §4.3c 建议「选区 + 邻近」，理由是整篇与首 token < 3s 的预算冲突。** 消费者是 `agent/context.ts` 与 AgentBridge，**全在 Stage 4**。

但它有一条能溜进 Stage 1 的路径：**本 stage 要建 `core/config/defaults.ts`**。如果按架构 §4.5 那句「字段树镜像设置清单的四个一级」去理解，就会顺手把设置清单铺满，**于是被迫在 Stage 1 替 Stage 4 裁一个「上下文范围」的默认值**——而这正是 003 §1.1 警告的原话：*若某条正好是本 stage 的输入而没先裁，AI 会在中途自己替你裁一个，然后你要到三个 stage 之后才发现走岔了。*

**所以裁决是两句话**：

1. **不影响 Stage 1** —— 前提是下面这条纪律成立；
2. **`defaults.ts` 只放本 stage 真正读取的字段**，不许为"以后要用"提前铺。本 stage 只需要**一个**字段（主题偏好）。「字段树镜像设置清单四个一级」是**终态**描述，不是 Stage 1 的建设清单——与 001 §1 仓库结构图同理（那张图已经加了 `[Sn]` 标注，§4.5 这句还没有）。

### 六、002 §2.1 类型层五条：本 stage 只有两条有宿主

002 §7 给 Stage 1 排的是「**类型层五条**」。逐条看宿主类型在不在，实际只有两条能做：

| 纪律 | 宿主类型 | 本 stage 是否存在 | 裁决 |
|---|---|---|---|
| registry 存 key 不存字符串 → `title: CopyKey` | `core/copy/` 与 command registry | **在**。本 stage 有 loading 态与保存失败提示（用户可见文案），也有 ⌘S（按纪律 6 必须先注册命令再绑键） | **做** |
| 组件不得出现字面色值 → `ThemeVar` | 主题变量表 | **在**。主题变量表是本 stage 的核心交付之一 | **做**，且**同时删掉 `check-discipline.mjs` 里的纪律 3 lint 规则**（002 §6.1：一条纪律只用一种手段；002 §7 的 Stage 0 实况段已把这个二选一写死） |
| AgentBridge 每请求带 `directory` → `BookDirectory` | AgentBridge | 不在（Stage 3） | 推 Stage 3 |
| system prompt 必须是常量 | system prompt | 不在（Stage 4） | 推 Stage 4 |
| 落笔只接受 `{range, expectedText}` | 落笔函数 | 不在（Stage 4） | 推 Stage 4 |

**两条做、三条推。** 002 §7 那句「类型层五条」是笼统的，与实际可做的不符——记进 §1.9。

### 七、本次读文档新发现的**阻塞项**：`config.json` 住哪儿，架构自相矛盾

> 这一条不在既定的六个问题里，是读文档时撞出来的。**它直接卡住本 stage**，所以必须在这里裁。

架构文档对同一个文件给了两个位置：

| 出处 | 说法 |
|---|---|
| §2.2 真相住在哪 | 应用配置 → `~/.sepia/config.json` |
| §2.3 book 布局 | 完整目录树 `~/.sepia/{config.json, session.json, logs/, engine/, books/}` |
| T-25 | 应用自有文件统一在 `~/.sepia`（配置 / 会话状态 / 日志 / 引擎四个隔离根），**不散落 XDG** |
| 纪律 20 | 应用自有文件只写 `~/.sepia`，**不散落 XDG** |
| **§4.5 配置** | **单一 `~/.config/sepia/config.json`** ← 与上面四处冲突 |

`~/.config/sepia` **正是 XDG 路径**，所以 §4.5 那句话不只是位置不同，它直接违反纪律 20。

**这是本 stage 的直接输入**：`session.json` 是 001 §7 排给 Stage 1 的活，`config.json` 因主题偏好也要读。路径不定，第一行代码就写不下去。

**裁决：以 `~/.sepia/` 为准，§4.5 那句判为笔误。** 三条理由：

1. **T-25 是有编号的技术决策**，§4.5 只是一句行文——决策优先于行文；
2. **纪律 20 是可强制的纪律**，措辞明确点名"不散落 XDG"，而 §4.5 的写法正是被点名的那种；
3. **§2.3 画了完整目录树**，是更具体、更难写错的表述；孤证对四证。

**落地**：本 stage 一律按 `~/.sepia/` 实现；同时把纪律 20 从 review 升级为 lint（见 §1.4）——**本 stage 是第一次真的往磁盘写应用文件，是给它上机器强制的最佳时机**。§1.9 记一条回流，请人订正 §4.5。

---

## 1.2 范围

### 做什么

**CM6 宿主**

- [ ] `renderer/editor/host.tsx` 挂载 CodeMirror 6，生命周期正确（创建 / 销毁 / 换文件不泄漏）
- [ ] `@sepia/editor` 导出一组 `baseExtensions`：**纯文本编辑所需的最小集合**，不含任何装饰、不含 markdown 语言包
- [ ] CM6 自带的 history（撤销 / 重做）可用
- [ ] 中文 IME 能正常输入（本 stage 无装饰，这是**基线**——Stage 2 才验有装饰时不被打断）

**打开与保存单文件**

- [ ] 通过系统 dialog 打开一个 `.md`
- [ ] `⌘S` 保存，走原子写（tmp + rename）
- [ ] 脏标记：未保存时窗口标题有可见标识
- [ ] **字节 round-trip**：打开再原样保存，字节完全一致——覆盖 CRLF / LF、有无 BOM、有无尾换行、非 ASCII（见 §1.9 第 3 条，这条是我加的，001 §7 的 Stage 1 行里没有）

**`~/.sepia/session.json`**

- [ ] 读写：上次 page 的绝对路径、光标位置、滚动位置
- [ ] 原子写
- [ ] 首次运行（文件不存在 / 字段缺失 / 内容损坏）三种情况都不崩，退回空编辑器
- [ ] 上次的 page 已被删除或移动时，优雅降级而不是白屏

**主题变量与首帧注入**

- [ ] `@sepia/ui` 建立主题变量表（CSS 自定义属性，唯一真相）
- [ ] `main/services/theme.ts`：主题真相在 main，订阅 `nativeTheme`
- [ ] **首帧之前**把主题属性落到 `<html>`
- [ ] 窗口 `backgroundColor` 与主题变量表**由同一份真相派生**（Stage 0 那个写死的二元判断被替换掉）
- [ ] `~/.sepia/config.json` 只建一个字段：主题偏好（跟随系统 / 亮 / 暗）

**启动打点**

- [ ] t0–t5 六个打点，口径写死在 `core/types` 里（见 §1.7）
- [ ] 打点可被 smoke 读取并断言
- [ ] 同步路径上只有窗口、单文件与 CM6（纪律 12）

**harness**（详见 §1.4）

- [ ] 类型层两条：`CopyKey`、`ThemeVar`
- [ ] 删掉 `check-discipline.mjs` 的纪律 3 lint 规则（被 `ThemeVar` 取代）
- [ ] 新增 lint：纪律 20（禁硬编码 XDG 路径）、纪律 8（禁 services 之外 `fs.writeFile`）
- [ ] 引入 Playwright `_electron`（001 §6 已定「Stage 1 起」）
- [ ] CI 的 smoke 改走 `bun run start`
- [ ] 补验强制力阶梯第 2 层
- [ ] `open-file` 中间态的三件事（§1.1 问题二）

### 明确不做什么

**属于 Stage 2 的**（一件都不碰）：

- **A/B/C/D 四类装饰**——包括最省事的标题加粗那一档，一个都不做
- 四类块 widget（表格 / 块级公式 / textdiagram / 图片）与行内公式
- **IME 冻结规则**（composition 活跃期间冻结装饰更新）——本 stage 没有装饰可冻
- 剪贴板双格式、HTML→md 智能转换、`⌘⇧V`
- 查找替换（`⌘F` / `⌘⌥F`）
- 落笔的原子撤销语义（T-27，那是 Stage 4）
- `check:theme`（Shiki 与 CM6 同源色板）——本 stage 没有 Shiki 也没有语法高亮

**最容易顺手带出、必须刹住的**（按"手一滑就会做"的概率排序）：

| 会顺手带出的东西 | 为什么手会滑 | 刹车 |
|---|---|---|
| **markdown 语法高亮** | CM6 一挂上，`@codemirror/lang-markdown` 就在手边，加一行就有高亮 | **连这个包都不装**。装了就会想调高亮色，调色就撞主题变量表，撞完就顺手做 A 类装饰——一条龙滑到 Stage 2 |
| **多 Tab** | `session.json` 一写「打开的 tab」字段就想做 | 本 stage 只恢复**一个** page，`session.json` **不建 tab 数组字段**。多 Tab 是 Stage 6 |
| **文件树 / 最近的 page** | 打开文件总得选文件，一想就想做个树 | 用系统 dialog。文件树、最近列表、主页都归 Stage 6 |
| **watcher** | 会保存了就想管外部改动 | 不装 chokidar。T-26 归 Stage 5/6 |
| **git** | 保存了就想 commit | 不碰。GitService 归 Stage 5 |
| **自动保存 / 失焦保存** | 手动 ⌘S 一做就觉得该自动 | 本 stage 只做显式 ⌘S。自动保存与 commit 三触发是同一件事，一起在 Stage 5 定 |
| **`defaults.ts` 铺满设置清单** | §4.5 说「字段树镜像设置清单四个一级」 | **只放本 stage 真正读取的字段**（主题偏好一个）。理由见 §1.1 问题五 |
| **主页 / onboarding** | 没有 session 时总得显示点什么 | 最小回退：空编辑器 + 一个打开文件的入口。主页与 onboarding 归 Stage 6 |
| **保存失败的重试与强制关闭确认** | 写了保存路径就想补错误处理 | 本 stage 只保证**写失败不静默**（有可见提示、不假装成功）。重试 3 次与拦截关闭归 Stage 7 |
| **设置 UI** | 有了 `config.json` 就想给个界面 | 架构 §1.3 已列为非目标。改配置就是改文件 |
| **`/harness` 看板** | 003 §4.5 的期一条件快满足了 | **本 stage 不做**。003 §4.5 的准入是「至少两份 stage plan 已回填真实实测数字」——本 stage 回填后才刚好第二份，做与不做都不属于本 stage 的 DoD |

---

## 1.3 代码结构与功能深度

### 落在哪些包

| 包 | 本 stage 新增 | 深度 |
|---|---|---|
| `core` | `types/`（IPC 契约、session / config / 打点类型）、`copy/`（第一批文案 + `CopyKey`）、`config/`（`defaults.ts` + merge） | 首次有真实内容。**`anchor/` 不建**（Stage 5） |
| `editor` | `baseExtensions`：纯文本编辑的最小 CM6 扩展集合 | **只到"能编辑纯文本"**。`extensions/`（装饰）与 `widgets/` 一个不建 |
| `agent` | 无 | 仍为空导出 |
| `ui` | `theme/`：主题变量表（CSS 自定义属性）+ `ThemeVar` 类型；一个 loading 态组件 | **只到"变量表 + 一个组件"**。shadcn 组件库不引 |
| `app` | `main/services/{config,session-state,fsio,theme}.ts`、`main/ipc/`、`preload/` 扩容、`renderer/{shell,editor/host.tsx,services/api.ts,commands/}` | 见下 |

`app` 内部**仍然不建**的目录：`main/services/{books,git,watcher,keychain,agent-supervisor}.ts`、`main/engine/`、`renderer/{markup,threads,home,files,overlays}/`、`renderer/editor/{extensions,widgets}/`、`renderer/stores/`。

> **`renderer/stores/` 要不要建**：本 stage 的状态只有「当前 page + 脏标记 + 主题」。够不够格开 zustand，实施时按实际复杂度定——**但若建，就每 domain 一个，不许开一个 god store**。这不是延后决策，是给了判据。

### 与 001 §2.2 依赖图的逐条对照

依赖边**不变**（6 条边、3 条刻意不连线）。但本 stage 是**第一次真正用到**它们，几条边从声明变成实际 import：

| 边 | Stage 0 | Stage 1 | 说明 |
|---|---|---|---|
| `core → editor` | 声明有、无实际 import | 可能仍无 | `baseExtensions` 未必需要 core 的类型 |
| `core → app` | 声明有、无实际 import | **实际用起来** | `main/services` 读 config/session 类型、renderer 组件用 `copy` |
| `editor → app` | 同上 | **实际用起来** | `host.tsx` import `baseExtensions` |
| `ui → app` | 同上 | **实际用起来** | shell 挂主题变量表 |
| `core → agent` | 声明有 | 仍无 | agent 本 stage 不动 |
| **`editor ↮ ui`** | — | **第一次受考验** | CM6 主题要写 `var(--…)`，变量名与 `ui` 的表**必须一致但不许 import**。这条不连线的实际含义在本 stage 才第一次显现 |
| **`ui ↮ core`** | — | **第一次受考验** | loading 态组件需要文案，而文案在 `core/copy`。**解法：文案由 `app` 侧作为 props 传进来**，`ui` 组件只收 `ThemeVar` 与字符串，不认识 `CopyKey` |

> `editor ↮ ui` 与 `ui ↮ core` 这两条，Stage 0 只是写在配置里没被碰过。**本 stage 是它们第一次真的挡路**——挡住时的正确反应是按上表绕，不是去改 `dep-graph.json`。真要改，走 `harness-dispute`。

### 功能深度的取舍（写死，不许加码）

| 能力 | 本 stage 做到哪一档就停 |
|---|---|
| CM6 | **纯文本编辑器**。无装饰、无语法高亮、无 widget、无自动补全 |
| 打开文件 | **系统 dialog + 从 `session.json` 恢复**。无文件树、无最近列表、无拖拽、无 `open-file`（已划给 Stage 6） |
| 保存 | **显式 ⌘S + 原子写 + 脏标记**。无自动保存、无失焦保存、无重试 |
| `session.json` | **一个 page + 光标 + 滚动**。不建 tab 数组，不记窗口位置尺寸 |
| `config.json` | **一个字段（主题偏好）+ version + 未识别字段保留**。不铺设置清单 |
| 主题 | **跟随系统 + 变量表 + 首帧注入**。无切换 UI、无自定义主题、无 Shiki |
| 打点 | **t0–t5 + 断言**。无遥测、无上报（架构 §1.3 非目标） |
| 错误处理 | **失败可见、不静默、不假装成功**。重试与强制关闭确认归 Stage 7 |

### 新增的对外暴露面（预先声明）

003 §1.3 要求**预先声明**，事后才发现就是架构侵蚀。本 stage 是 preload 白名单的**第一次真实增长**，从 4 项只读事实变成有 IPC 通道。

| 类别 | 内容 |
|---|---|
| **preload 白名单** | 拟增：`api.file.read(path)`、`api.file.write(path, content)`、`api.dialog.openMarkdown()`、`api.session.get()`、`api.session.set(state)`、`api.theme.get()`、`api.theme.onChange(cb)`、`api.perf.mark(name)`。**逐项写进 `scripts/bridge-snapshot.json`**；实施时若与此处不符，以 diff 为准并回填本表 |
| **包依赖** | 内部边不变。第三方新增：CodeMirror 6 相关（`@codemirror/state`、`@codemirror/view`、`@codemirror/commands`）→ `editor` 包；`playwright` + `@playwright/test` → 根 devDeps |
| **配置字段** | `~/.sepia/config.json`：`version`、主题偏好（**只此一项**）｜`~/.sepia/session.json`：`version`、page 路径、光标、滚动 |
| **环境变量** | 不新增。`SEPIA_HARNESS_BYPASS` 与 `SEPIA_SMOKE_EXIT` 沿用 |

> **`api.file.write` 是本 stage 最重的一次暴露面增长**：它是 renderer 第一次获得写盘能力。约束写在这里——**它只接受绝对路径，且写入必经 `main/services/fsio.ts` 的原子写**，renderer 侧没有绕过它的第二条路。
>
> **它与 Stage 4 落笔 CAS 的关系必须现在写死，不能留到 Stage 4 再想**（2026-08-04 补）。002 §2.1 把 CAS 称作模式而非技巧：**把危险操作设计成「没有不安全的调用方式」——不安全的路径不存在，就不用检查它有没有被走**。而 `api.file.write(path, content)` 是**全文写入**，天然就是那条"不安全的调用方式"。若它到 Stage 4 还原样挂在桥上，CAS 就从「唯一入口」退化成「其中一个入口」，不变量 3（AI 不抢笔）失去机器保障。
>
> 所以本 stage 就把它的身份钉死：**`api.file.write` 是 ⌘S 全文保存专用通道**，语义是"用户显式保存自己当前编辑的全文"。Stage 4 增加区间写通道时必须做到三件事——① 区间写是**独立通道**，只接受 `{range, expectedText}`，不提供无校验重载；② **markup 路径在类型上够不到全文写通道**（不是靠约定，是靠类型或模块边界）；③ 110 §1.4 注①那条「preload 不得暴露绕过 CAS 或给 Agent 开写路径的通道」的**不变量级子条必须覆盖这两条通道**，且届时单列成独立检查。

---

## 1.4 harness 增量

阶梯层次见 002 §1（1 类型 / 2 包边界 / 3 lint / 4 专项脚本 / 5 单测 / 6 人工），硬度见 002 §5.3。

| # | 检查 | 守什么 | 阶梯层 | 硬度 |
|---|---|---|---|---|
| 1 | **`CopyKey` 类型** | command registry 与组件存 key 不存字符串（纪律 5） | **1 类型** | 纪律级 |
| 2 | **`ThemeVar` 类型** | 组件与 CM6 扩展不得出现字面色值（纪律 3） | **1 类型** | 纪律级 |
| 3 | **删除 lint 纪律 3** | 与 #2 同一条纪律，两头都留就没人维护（002 §6.1） | — | — |
| 4 | lint · 纪律 20 | 应用自有文件只写 `~/.sepia`：禁止硬编码 `~/.config`、`XDG_*`、`Library/Application Support` 等路径 | 3 lint | 纪律级 |
| 5 | lint · 纪律 8 | 禁在 `main/services/` 之外直接 `fs.writeFile` / `writeFileSync` | 3 lint | 纪律级 |
| 6 | **单测 · 字节 round-trip** | 打开再原样保存，字节完全一致 | 5 单测 | **不变量级（不变量 2，无豁免）** |
| 7 | 单测 · 原子写 | 写入走 tmp + rename；中途失败不留半个文件 | 5 单测 | 纪律级 |
| 8 | 单测 · `session.json` 容错 | 缺失 / 字段缺 / 内容损坏 三种输入都不崩 | 5 单测 | 纪律级 |
| 9 | 单测 · config merge | 文件只存差异、`version` 存在、未识别字段保留 | 5 单测 | 纪律级 |
| 10 | **smoke · 冷启动打点断言** | t0→t5 < 1s；同步路径上只有窗口、单文件与 CM6（纪律 12） | 5 smoke | 纪律级 |
| 11 | smoke · 无白闪 | 首帧主题已就位（纪律 13）——截图比对或打点断言二选一，实施时定 | 5 smoke | 纪律级 |
| 12 | `check:bridge` 快照更新 | 不是新检查，但暴露面从 4 项涨到十余项，**快照必须逐项更新并出现在 diff 里** | 4 专项脚本 | 纪律级 |

### 相对 002 §7 的增减

002 §7 给 Stage 1 排的是：**类型层五条、启动打点断言**。

**减 · 类型层五条 → 两条**。理由见 §1.1 问题六：另外三条（`BookDirectory`、system prompt 常量、落笔 CAS）在本 stage 没有宿主类型可依附。**不是不做，是做不了。**

**增 · lint 纪律 20**。本 stage 是第一次真的往磁盘写应用文件，而纪律 20 现在的强制方式是 `review`——这个项目里没有第二个人来 review。**给它上机器强制的最佳时机就是现在**，晚了就有一堆路径要回头改。002 §2.3 本来就列了这条规则（「禁止硬编码其他配置路径的正则规则」），只是没排期。

**增 · lint 纪律 8**。同理：`fsio.ts` 本 stage 才出现，「禁在 services 之外直接 `fs.writeFile`」现在才有意义。002 §2.3 也已列出。

**增 · 字节 round-trip 单测**。001 §7 把 round-trip 排在 Stage 2，但**本 stage 已经在写文件了**。不变量 2 是无豁免的不变量级，守卫不能晚于被守的行为一个 stage。记进 §1.9。

**增 · Playwright `_electron`**。001 §6 的测试表（经 Stage 0 回流修订）已写明「Stage 0 自启动开关脚本；**Stage 1 起：Playwright `_electron`**」——本 stage 兑现它。冷启动打点断言需要它。

### 可以从 lint 升级到类型的（002 §2.1）

**本 stage 升一条：纪律 3（字面色值）→ `ThemeVar`。**

这是 002 §7 的 Stage 0 实况段写死的二选一：*升类型就把 lint 规则删掉，别两头都留*。**升级与删除必须在同一次提交里**（002 §5.6：改纪律的那次提交必须同时改对应的检查）。

`CopyKey`（纪律 5）严格说不是"从 lint 升级"——纪律 5 原本的强制方式是 `review`，本 stage 是**直接给它上类型**，跨了四层。

---

## 1.5 自动化验证

> 本节是**计划**。实测输出由后续 goal 回填，回填时同步更新 frontmatter 的 `checks_added` 与 `checks_reverse_verified`。

### 新增单测清单

| 包 | 用例 | 守什么 |
|---|---|---|
| `core` | config merge：默认值 + 空文件 / 部分字段 / 未识别字段 / 版本迁移 | 纪律级 #9 |
| `core` | `session.json` 容错：不存在 / 空 / 非法 JSON / 字段类型错 / page 路径已失效 | 纪律级 #8 |
| `core` | `CopyKey` 的类型级用例（`@ts-expect-error` 断言传字面串编译不过） | 类型层 #1 |
| `ui` | `ThemeVar` 的类型级用例（`@ts-expect-error` 断言 `'#fff'` 赋不进去） | 类型层 #2 |
| `editor` | `baseExtensions` 可构造出一个能编辑的 EditorState，且**不产生任何 decoration** | 防止装饰偷偷混进 Stage 1 |
| `app` | **字节 round-trip**：一批 fixture（CRLF / LF、有无 BOM、有无尾换行、非 ASCII、超长行）读入再写出，逐字节比对 | **不变量级 #6** |
| `app` | 原子写：写入过程中 tmp 文件存在、成功后原名替换、失败时原文件未被破坏 | 纪律级 #7 |
| `app` | 打点口径：t0–t5 单调递增、每个点只打一次 | 纪律级 #10 的前置 |

### 新增 smoke 清单（Playwright `_electron`）

| smoke | 断言 |
|---|---|
| 冷启动 | t0→t5 < 1s；t0→窗口可见 < 500ms；窗口可见→光标就位 < 500ms |
| 同步路径纯净 | 启动同步路径上没有 git / watcher / 引擎的任何调用（纪律 12） |
| 无白闪 | 首帧的 `<html>` 已带主题属性；窗口 `backgroundColor` 与之一致（纪律 13） |
| 恢复上次 page | 写一个 `session.json` → 启动 → 该 page 已打开、光标在记录的位置 |
| 写字→保存→重开 | 输入 → ⌘S → 关闭 → 重开 → 内容与光标都在 |

### 新增检查的反向验证清单

002 §6.2：**抓不到真实违规的检查是净负担**。每条新检查都要「故意违规 → 必须 FAIL → 撤销」并贴输出。

> **分母口径已按 003 §3.2（2026-08-04 钉死）重算：13，不是 19。**
> 剔掉的六条全是**沿用且未改动的 Stage 0 老检查**——结构 3、纪律 1、纪律 18、oxlint、`check:bridge`、包边界第 2 层。
> 它们已在 110 §1.5 计过一次并验过，再计入本 stage 就是重复计数，债务面板的趋势会失真。
> **`check:bridge` 本 stage 只更新了快照数据，没改判定逻辑**，所以不计；而**纪律 3 的 lint 改了判定逻辑**（从只扫 `.ts/.tsx` 扩到也扫 `.css` 并加了调色板 allowlist），按口径**要计**。

**13 条全部执行完毕，全部撤销，撤销后 `check` 与 smoke 均恢复绿。**

- [x] ① **`CopyKey` 类型层**（纪律 5）—— 破坏实现：`CopyKey` 放宽成 `string`
      `src/copy/index.ts(26,10): error TS7053: Element implicitly has an 'any' type…`
      `test/copy.test.ts(11,5): error TS2578: Unused '@ts-expect-error' directive.`
      ⚠️ 最后一行是 `FAIL: 类型（typecheck）— 见上方输出，退出码 2`，**不指纪律号**
- [x] ② **`ThemeVar` 类型** —— 破坏实现：`ThemeVar` 放宽成 `string`
      `test/index.test.ts(13,5): error TS2578: Unused '@ts-expect-error' directive.`
      ⚠️ 同上，最后一行**不指纪律号**
- [x] ③ **lint 纪律 20**（禁 XDG）—— 注入 `/Users/x/.config/sepia/config.json`
      `FAIL: 纪律 20（应用自有文件只写 ~/.sepia，不散落 XDG）— packages/app/src/main/services/paths.ts:29`
- [x] ④ **lint 纪律 3 扫 css**（本 stage 改了判定逻辑）—— 往 `renderer/index.css` 塞 `#ff0000`
      `FAIL: 纪律 3（组件与 CM6 扩展不得出现字面色值）— packages/app/src/renderer/index.css:51`
      附带指出「色值只许住在 `packages/ui/src/theme/theme.css`」——**扩到 css 这一改确实在工作**
- [x] ⑤ **lint 纪律 8** —— 在 `session-state.ts` 里直接 `writeFile`
      `FAIL: 纪律 8（services 之外不得直接调 fs 写接口）— packages/app/src/main/services/session-state.ts:29`
- [x] ⑥ **单测 · 字节 round-trip（不变量 2）** —— 破坏实现：删掉 `EditorState.lineSeparator.of(...)`
      8 条变红：`文本变更只动被编辑处` / `CRLF` / `CR（老 Mac）` / `CRLF 且无尾换行` / `混用换行` /
      `带 BOM 的 CRLF` / `反证一` / `反证二`。**不变量级的守卫是活的**
- [x] ⑦ **单测 · 原子写** —— 破坏实现：`tmp + rename` 改成直接 `writeFile`
      **首验：`18 passed`，一条都没红——空转**（见下）。
      **按附录 C.1 裁决（方向 ①）加固后重验（2026-08-04）**：对 `node:fs/promises` 做透传 spy，
      断言调用序列——writeFile 落点必须是 `.tmp` 且绝不许是目标本身、`rename` 恰好一次且方向 tmp → 目标。
      同一破坏重跑：`× **过程必须是 tmp → rename**`（`expected [...a.json] to not include ...a.json`）
      `1 failed | 17 passed`，还原后 `18 passed`。**这次红了**
- [x] ⑧ **单测 · `session.json` 容错** —— 破坏实现：去掉 `JSON.parse` 的 try/catch
      `× 非法 JSON → 空会话，不抛异常`｜`1 failed | 18 passed`
- [x] ⑨ **单测 · config merge** —— 破坏实现：不再保留未识别字段
      `× 未识别字段原样保留`、`× 往返：未识别字段在写回时仍在`｜`2 failed | 17 passed`
- [x] ⑩ **单测 · 打点口径** —— 破坏实现：允许重复打点覆盖
      `× 每个点只打一次，重复打点不覆盖`｜`1 failed | 17 passed`
- [x] ⑪ **单测 · editor 无装饰**（防 Stage 2 提前滑入）—— 注入一个 `languageData`
      `× **本 stage 不许有任何装饰**——Stage 2 才做 A/B/C/D 四类`｜`1 failed | 20 passed`
- [x] ⑫ **smoke · 冷启动打点**（纪律 12）—— 往启动同步路径塞 1.2s 延时
      `Expected: < 1000 / Received: 1679`｜`1 failed | 1 passed`
- [x] ⑬ **smoke · 首帧主题**（纪律 13）—— 破坏实现：`body` 不再取 `var(--sepia-paper)`
      `Expected: not "rgba(0, 0, 0, 0)"`｜`1 failed | 1 passed`

### 空转的检查

> **状态：已修复并复验（2026-08-04，附录 C.1 裁决落地）。** 修法：对 fs 模块做透传 spy，把断言从
> "终态"改成"调用序列"。复验证据见上面 ⑦——同一破坏这次正确变红。下面保留原始排查记录，失败模式比修法值钱。

> 002 §6.2：**抓不到真实违规的检查是净负担。** 110 刚为此付过一次代价（`check:deps` 实际侧空转整个 Stage 0）。
> 这次是第二次，而且是同一个形状：**看起来在守，实际什么都没守。**

**`packages/app/test/main/fsio.test.ts` 的四条「原子写」用例，没有一条真的在测原子性。**

| 项 | 内容 |
|---|---|
| 症状 | 把 `atomicWrite` 的 `tmp + rename` 换成直接 `writeFile(path, content)`，`bun run test` 仍然 **18 passed** |
| 根因 | 四条用例断言的都是**写完之后的终态**：内容完整 / 目录自动建出 / 不留 `.tmp` / 失败时原文件不坏。**这四件事非原子实现同样满足**——尤其「成功后不留临时文件」在直接写下恒真（压根没产生过临时文件），是一条**空洞为真**的断言 |
| 为什么危险 | 原子性的价值只在**中途失败**时兑现：`writeFile` 会先截断目标文件，崩在中间就留下半个 `session.json`；`rename` 则要么旧内容完好、要么新内容完整。**而"中途"恰恰是这组用例唯一没观察的时刻** |
| 波及 | 纪律 8 的 lint 仍然有效（⑤ 已验），所以「谁能写盘」守得住；**守不住的是「写盘的方式是不是原子的」**。`session.json` 与 `config.json` 都靠它 |
| 处置 | **保留给人裁决**（本次只补验证，不改实现）。可行的加固方向两条：① `vi.spyOn` 观察 `rename` 是否真的被调用；② 在写入过程中断言目标路径旁存在 `.tmp` 文件。**任选其一之后必须重跑本条反向验证**，否则等于用同样的方式再信一次 |

**教训与 110 那次同源，但更值得记**：上次空转的是第三方库（dependency-cruiser 少传 `validate`），这次空转的是**我自己写的测试**。002 §1 的阶梯把「单测」放在第 5 层、比 lint 更靠下，理由是"能被删掉"——但这次的失败模式不是被删掉，**是写的时候就没测到点子上，而它照样绿**。阶梯没有描述这一档风险。

### 输出不指向纪律号的（002 §3 第 3 条）

> 002 §3：失败信息必须指向纪律编号，AI 才知道去读哪一条。

**两条，都是类型层的**：

| # | 情形 | 最后一行 | 问题 |
|---|---|---|---|
| ① | `CopyKey` 被放宽 | `FAIL: 类型（typecheck）— 见上方输出，退出码 2` | 违反的是**纪律 5**（registry 存 key 不存字符串），但 `check.mjs` 对 typecheck 只能给通用信息 |
| ② | `ThemeVar` 被放宽 | 同上 | 违反的是**纪律 3** |

这与 110 记的两条同源：**类型层是阶梯最高的一层，却是唯一无法自报纪律号的一层**——`tsc` 不知道我们的编号体系。110 建议过「错误码 → 纪律号映射表」，但类型错误的码（`TS7053`、`TS2578`）与纪律的对应关系依赖上下文文件路径，比 `TS2591` 那种要难。**保留给人裁决，记进 §1.9。**

### 实施记录（2026-08-04）

**`bun run check` 冷缓存输出，最后一行 `PASS`：**

```
▸ lint       纪律 lint          ✓ 0.1s
▸ typecheck  类型               ✓ 4.0s
▸ deps       依赖图              ✓ 0.6s
  实际侧：dependency-cruiser 扫过 49 个模块，8 条规则
▸ bridge     preload 白名单      ✓ 0.2s   （暴露面 12 项）
▸ workspace  workspace 边界     ✓ 0.0s
▸ marks      豁免记号             ✓ 0.0s   harness-exempt 1 处 ｜ harness-dispute 0 处
▸ test       单测               ✓ 1.1s   （5 个包，共 40 个用例）
PASS
```

**`bun run test:smoke`（Playwright `_electron`，只进 CI 不进 check）：**

```
✓ 冷启动 → 可写，全部打点在预算内 (1.1s)
✓ 首帧主题已就位——无白闪的机器可判定部分（纪律 13） (1.2s)
2 passed (3.1s)
```

### 上一版记录已作废（2026-08-04 修订）

首次回填时这里写的是「只做了 3 条，欠 16 条，覆盖率 3/19 ＝ 0.16」。**两处都错了**：

- **分母混了口径**：19 里含六条沿用未改动的 Stage 0 老检查，它们已在 110 计过并验过。003 §3.2 就是因为这次出错才把口径钉死的
- **分子也虚高**：当时记的"已做三条"里，有两条是**误报修正**（纪律 8 把 `api.writeFile(` 与测试 fixture 错判），那是「合法代码被误红」，不是「故意违规必须红」。**两者方向相反，不能算作反向验证**；第三条（阶梯第 2 层）属 Stage 0，同口径下也不进本 stage 的分子

按新口径重算并全部补完后：**13 / 13 ＝ 1.0**，其中 1 条查出是空转的。

---

## 1.6 人工验证

机器判定不了的。每条是**具体动作 + 具体预期**。

**人工判定（2026-08-04，四轮）：通过 9 ｜ 延后 1（`.dmg`）。机器判定不了的部分至此全部验完，无未决项。**

> ⚠️ **本轮全部在 `bun run dev` 下测的**——与 §1.7「怎么测才算数」第 1 条（以打包产物为准）不符。功能行为类的通过仍然有效；但**冷启动主观感受与无白闪两条与启动路径强相关，dev 模式的结论不得以打包产物的名义引用**，随 `.dmg` 延后账一起用打包产物重验。

- [x] **冷启动主观感受**：从 Dock 点击到光标闪烁，**主观上"立刻"**——如果能明显感到"等了一下"，即便打点数字达标也算不通过，回去看是哪一段没算进打点
      → **通过（2026-08-04，dev 模式）**。dev 链路上有 vite dev server，与用户实际启动不是一条路径——**待打包产物重验**
- [x] **深色系统主题**下启动，全程**没有白色闪一下**；切成浅色再来一次，同样不许闪
      → **通过（2026-08-04，dev 模式，待打包产物重验）**。测法备忘：来回切用
      `osascript -e 'tell app "System Events" to tell appearance preferences to set dark mode to not dark mode'`
- [x] **有内容的窗口**：启动后光标停在上次的位置，随手敲几个字**立即出现**，无延迟感
      → **通过（2026-08-04，dev 模式）**
- [x] **中文 IME 输入 200 字**（拼音连续输入），候选框不闪、不吃字、无重排抖动——**本 stage 无装饰，这是基线**；Stage 2 有装饰后要重跑这条并对比
      → **通过（2026-08-04，dev 模式）**。Stage 2 对比用的基线成立
- [x] **2 万字长文**：打开、滚到底、再滚回顶，无卡顿；在中间插入文字无延迟
      → **通过（2026-08-04，dev 模式）**
- [x] **⌘S 后立刻用外部编辑器打开该文件**，内容是刚保存的；用 `xxd` 比对首尾字节，无多余的 BOM / 换行
      → **通过（2026-08-04）**。注：⌘S **存回 ⌘O 打开的那个文件本身，原地覆盖**——Stage 1 无新建、无另存为（`page === null` 时 ⌘S 直接 return）。CRLF fixture 验法留档：
      `printf '# hi\r\n第二行\r\n' > ~/tmp/a.md` → ⌘O 打开、改几个字、⌘S → `xxd ~/tmp/a.md | tail -2`，行尾仍是 `0d0a`
- [x] **保存到只读目录**（`chmod 555` 锁**目录**）：有可见的失败提示，**不假装保存成功**，脏标记仍在
      → **通过（2026-08-04，按修正后测法）**。**测法修正记录**：原文写的 `chmod 444`（锁文件）**测不出来**——原子写是 tmp + rename，`rename` 只需要**目录**的写权限，目标文件是不是 444 完全不影响，照原文做会保存成功，然后误以为错误处理坏了。这与附录 C.1 是同一个盲点的两面：都是照「非原子写」的心智模型设计的验证。正确测法：
      `mkdir -p /tmp/ro && printf 'ORIGINAL\n' > /tmp/ro/a.md` → ⌘O 打开（对话框里 ⌘⇧G 输入路径）、改点东西 → `chmod 555 /tmp/ro` → ⌘S 应报可见错误、脏标记在、文件仍是 ORIGINAL → 测完 `chmod 755 /tmp/ro` 恢复
- [x] **关掉所有窗口再从 Dock 打开**，恢复到上次的 page 与光标位置
      → **通过（2026-08-04 第四轮，附录 D 修复后人工重验）**：滚动位置与光标都回来了。
      第一轮曾不通过——page 与 selection 其实一直是好的，坏的只有视口（`mountEditor` 不 `scrollIntoView`
      叠加 scrollTop 三处断链），视觉上与"光标没恢复"不可区分；定位与修复过程见附录 D。
      另：「没办法打开多个 page」**是设计如此不是缺陷**——多 Tab 归 Stage 6，§1.2 刹车表明写「`session.json` 不建 tab 数组字段」
- [ ] **延后账收尾**：从 CI release 下载 `.dmg`，双击挂载、拖进 Applications、启动 → 能开出**有纸有光标**的窗口（未签名，首次被 Gatekeeper 拦，右键打开绕过——预期行为，不是缺陷）
      → **继续延后（2026-08-04 人工裁决：release 依然延后）**。上面两条「待打包产物重验」的注记与本条同期收尾
- [x] ⚠️ →（**已解除**）`CLAUDE.md` 走查：每条纪律注明了由谁强制 / 有正误对照 / 有卡住协议 / 有三种记号
      → **通过（2026-08-04 人工判定：没问题）**。Stage 0 跳过的那条债就此还上
      > **这一条在 Stage 0 已被人明确裁决为「跳过，不验」**（110 §1.6）。本文档把它放回来的理由是成立的——Stage 0 的记录里留了线索：若本 stage 出现「AI 频繁违反纪律 / 频繁触发卡住协议」，第一个该怀疑的就是这里。
      > **但人的裁决不该被一份新文档静默推翻。** 要么人确认本 stage 做，要么再划掉一次并说明；**不许它每个 stage 自己长回来**——那会让"裁决"这件事失去意义。

---

## 1.7 实测记录

> 预算列现在填，实测列由后续 goal 回填。**冷启动 <1s 是本 stage 的核心指标**，所以口径与测法必须先写死——否则测出来的数字没有可比性，也守不住回归。

### 打点口径（t0–t5）

口径写进 `core/types`，**六个点的定义不许在实施中改**；真要改，改的那次提交必须同时改断言与本表。

| 点 | 位置 | 含义 |
|---|---|---|
| **t0** | `main/index.ts` 第一行可执行语句 | 进程启动。**不是 `app.whenReady`**——那已经晚了几十到上百毫秒 |
| **t1** | `app.whenReady` 回调进入 | Electron 就绪 |
| **t2** | `new BrowserWindow()` 返回 | 窗口对象已建（此时尚未可见） |
| **t3** | `ready-to-show` 触发、`window.show()` 之后 | **窗口可见**。主题属性必须已在 `<html>` 上 |
| **t4** | renderer 侧 page 文件内容到手 | 纸的字节已到 |
| **t5** | CM6 `EditorView` 就绪且光标落位 | **可写**。这一点即 DoD |

### 预算与实测

| 指标 | 预算 | 本 stage 实测 | 上一 stage |
|---|---|---|---|
| **冷启动 → 可写（t0→t5）** | **< 1s**（架构 §1.1，DoD） | **P50 440ms ｜ P90 450ms** ✓ | — |
| 进程启动 → 窗口可见（t0→t3） | < 500ms | **P50 316ms ｜ P90 329ms** ✓ | — |
| 窗口可见 → 光标就位（t3→t5） | < 500ms | **P50 118ms ｜ P90 123ms** ✓ | — |
| `bun run check` 全量（冷） | < 30s（002 §3） | **6.3s**（lint 0.1 ｜ typecheck 4.0 ｜ deps 0.6 ｜ bridge 0.2 ｜ workspace 0.0 ｜ marks 0.0 ｜ test 1.1） | 4.8s |
| `bun run check:fast`（冷） | 秒级（002 §5.4） | **4.2s** | 3.0s |
| 安装包体积 · macOS dmg arm64 | 无硬预算，记录基线 | 未测（本 stage 未打包） | 115MB |
| `harness-exempt` 总数 | 0（只增不减即腐化） | **1**（`renderer/services/api.ts` 的纪律 1——它就是那个唯一出口） | 0 |
| `harness-dispute` 总数 | 0 | **0** | 0 |
| 反向验证覆盖率 | **1.0** | **1.0**（13/13，新口径）✓ | 0.85（11/13） |
| 空转检查数 | **0** | **1**（原子写单测，见 §1.5「空转的检查」）⚠️ | 0 |

**10 次连续冷启动，全部 complete、全部 withinBudget**，分布很窄（min 428 / max 457），说明这不是一次侥幸。三段都只用掉预算的三到四成——**但这是 Stage 1 的纸**：没有装饰、没有语法高亮、没有 widget。Stage 2 的四类装饰会直接吃进 t3→t5 这一段，那才是这条预算真正受压的时候。

**离红线最近的仍是 `typecheck`**：4.0s / 6.3s ＝ **63%**（Stage 0 是 58%）。绝对值从 2.8s 涨到 4.0s，一个 stage 涨了 43%，而代码量还很小。

**测法与 §1.7「怎么测才算数」的两处偏离，必须记下来**：① 用的是 `out/main/index.js` 构建产物而不是 `.app`，所以**没有覆盖 Gatekeeper 首次验证那一段**；② 因此也没有"首次冷启动"与"常温冷启动"的分别，上表全是常温。**装包之后要重测一次首启**，否则用户开机后第一次点开的真实体感始终没被测过。

### 怎么测才算数

**这一段比数字本身更重要**——测法一变，趋势就断了。

1. **以打包产物为准，不是 `bun run dev`。** dev 要等 vite dev server，测出来的是另一个东西。用 `.app`（或 `bun run start` 的构建产物），与用户实际启动的是同一条路径。
2. **区分"冷"的两个层次**，分别记录：
   - **首次冷启动**：机器刚重启或应用文件不在系统文件缓存里——**单独记一次**，这是用户开机后第一次点开的真实体验；
   - **常温冷启动**：应用已完全退出但文件缓存热——**连续 10 次**取 **P50 与 P90**。
3. **取 P50 与 P90，不取最小值。** 最小值是缓存最热的那一次，不代表体验；P90 才是"偶尔慢一下"的那次。
4. **未签名的 macOS 首次启动会被 Gatekeeper 拖慢**（首次验证 + 隔离属性检查）。**这一次单独标注，不混进 P50/P90**——否则数字会莫名其妙地比第二次大一大截，下个 stage 看趋势时无从解释。
5. **turbo 缓存与冷启动无关**，但 `check` 的计时仍按 Stage 0 的规矩，测前 `rm -rf .turbo node_modules/.cache/turbo`。
6. **记录机器**：Stage 0 的基线是 macOS 14.6 / Darwin 23.6.0 / bun 1.3.14 / node 22.22.1。**换机器测就等于换了基线**，必须注明。

---

## 1.8 风险与未知

| # | 风险 / 未知 | 现在知道多少 | 先探还是边做边探，探到什么程度算够 |
|---|---|---|---|
| 1 | **主题首帧注入真的做得到吗** | 架构 §4.7 要求主题在**首帧之前**落到 `<html>`。但主题真相在 main、渲染在 renderer，中间隔着 IPC——**异步的 IPC 天然晚于首帧**。可能的路子有三条：preload 同步暴露、启动参数 / query 传入、把主题写进 `index.html` 的内联脚本 | **先探，且是本 stage 第一个要探的东西**。它决定 `preload` 的形状与 `theme.ts` 的接口，做错了后面全要返工。**探到"深色系统下截图首帧无白色"为止** |
| 2 | **冷启动 <1s 在未签名 macOS 上能不能达标** | Gatekeeper 首次验证会拖慢启动，幅度未知 | **先探**（选测法时就要定）。探到"能把这一次与常温启动分开记录"即可；若首次启动严重超标，**那是签名问题不是架构问题**，记进债务而不是砍功能 |
| 3 | **`electron-vite preview` 在 CI 的 `xvfb-run` 下能否跑通** | §1.1 问题三要把 CI smoke 换成它，但它比直接起 electron 多一层 | **先探**。探不动就退回直接起构建产物，**但必须先跑 `ensure-electron`**，把 `bunx` 自愈那条路堵死——否则又变成 CI 与人两条路径 |
| 4 | **Playwright `_electron` 的稳定性** | 项目里从没用过。它要能读到我们的打点数据（可能经 stdout、也可能经 `evaluate`），接口怎么设计没定 | **边做边探**。探到"冷启动 smoke 连续跑 10 次不 flaky"算够；flaky 的 smoke 比没有 smoke 更糟——它会训练人忽略红色（002 §6.2 同理） |
| 5 | **CM6 在 2 万字长文下的基线性能** | 架构 §1.1 要求"2 万字长文输入无感、滚动流畅"，但那是**有装饰**时的最终要求。本 stage 无装饰，理应轻松——**正因如此它是个好基线** | **边做边探**。测一次记进 §1.7 的备注；Stage 2 加装饰后对比，就知道装饰花了多少 |
| 6 | **原子写在不同文件系统上的行为** | tmp + rename 在 APFS 上是原子的，**在网络盘 / 某些同步盘上不一定**（rename 可能跨设备失败） | **边做边探**。本 stage 只保证本地盘；网络盘的逃生舱与 watcher 的 `usePolling` 是同一类问题，一起留到 Stage 6 |
| 7 | **中文 IME 在无装饰 CM6 下的基线** | 架构 §8 把「CM6 揭示与中文 IME 冲突」列为风险，但那是**有装饰**时。本 stage 没有装饰，**若此时就有问题，那是 CM6 本身的问题，性质完全不同** | **先探**（人工清单里那条）。探到"连续输入 200 字不吃字"即可。**这条基线不做，Stage 2 出问题时就分不清是装饰的锅还是 CM6 的锅** |
| 8 | **`session.json` 里 page 路径的形式** | 绝对路径最简单，但用户移动 book 后全失效；相对路径需要先有 book 身份，而 `books.ts` 归 Stage 6 | **边做边探**。本 stage 用绝对路径 + 失效时优雅降级，**并在 §1.9 或 Stage 6 的入口条件里记一笔**：有 book 身份后要迁移，且迁移要能读旧格式 |

---

## 1.9 回流

> 本 stage 阅读上游文档时发现的错漏、矛盾与说不通处。

**裁决结果（2026-08-04）：八条全部采纳，上游文档已按裁决修订完毕。** 下表保留原始记录，落地情况见此处：

| # | 裁决 | 落地 |
|---|---|---|
| 1 | **采纳** | 架构 §4.5 的 `~/.config/sepia/config.json` 已改为 `~/.sepia/config.json`，并注明与 T-25、纪律 20 一致 |
| 2 | **采纳** | 002 §7 的 Stage 1 行改为「类型层**两条**」，并新增 Stage 3 行（`BookDirectory`）与 Stage 4 行（system prompt 常量、落笔 CAS），附一句说明「五条不是同一个 stage 能做完的」 |
| 3 | **采纳** | 001 §6 的 round-trip 拆成两半分排两个 stage；§7 的 Stage 1 验收加「读入—写出字节保真」，Stage 2 改为「装饰不改写字节」 |
| 4 | **采纳** | 架构 §5 纪律 20 的强制方式由 `review` 改为 `lint`，注明 Stage 1 落地 |
| 5 | **采纳** | t0–t5 六点定义 + 三条预算 + 测法要点已写进架构 §4.7，**成为设计真相而非 plan 的就地定义** |
| 6 | **采纳** | 架构 §4.5 加终态提醒：字段树是终态，各 stage 只加自己真正读取的字段 |
| 7 | **采纳** | 架构 §4.9 保存失败分两档：Stage 1 起「失败可见、不静默」，Stage 7 补完整重试与拦截关闭 |
| 8 | **采纳** | 根 `package.json` 的 `trustedDependencies: ["electron"]` **已删除**。查证属实：electron 43 的 `package.json` 无 `scripts` 字段，无 postinstall 可被信任；真实机制是 `index.js` 的惰性下载（`path.txt` 缺失即 spawn `install.js`），而 electron-vite 用自己那份 `getElectronPath` 只读 `path.txt`、不触发下载——这才是 `bun run dev` 报 `Electron uninstall` 的真因。**原先「bun 不跑 postinstall」的判断是错的**，真正的解法是 `ensure-electron`（见 §1.8 风险 3） |

**原始记录如下。**

| # | 指向 | 问题 | 建议 |
|---|---|---|---|
| 1 | **架构 §4.5** vs **§2.2 / §2.3 / T-25 / 纪律 20** | `config.json` 的位置自相矛盾：§4.5 写 `~/.config/sepia/config.json`，而另外四处一致写 `~/.sepia/`。**`~/.config/sepia` 正是 XDG 路径，直接违反纪律 20「不散落 XDG」** | **改 §4.5 为 `~/.sepia/config.json`。** 这是本 stage 的阻塞项，已就地按 `~/.sepia/` 裁决（§1.1 问题七）。孤证对四证，且 T-25 是有编号的决策、纪律 20 可被强制 |
| 2 | **002 §7** 的 Stage 1 行 | 写的是「**类型层五条**」，但五条里只有 `CopyKey` 与 `ThemeVar` 在本 stage 有宿主类型；`BookDirectory`、system prompt 常量、落笔 CAS 分别要等 Stage 3 / 4 | 把 Stage 1 行改成「类型层**两条**（`CopyKey`、`ThemeVar`）」，其余三条移到 Stage 3 / Stage 4 行。**照现在这么写，实施时会发现三条做不了，然后要么硬造宿主、要么静默跳过**——后者更可能 |
| 3 | **001 §7** 的 Stage 1/2 行 | 字节 round-trip 单测排在 **Stage 2**，但**写文件是 Stage 1 的事**。守卫晚于被守的行为一个 stage，中间这一整个 stage 里不变量 2 无人看守 | round-trip 拆两半：**Stage 1 做「读入—写出」的字节保真**（本 stage 已加），**Stage 2 做「装饰不改写字节」**。后者才是 001 §7 原本想说的那个 |
| 4 | **架构 §5** 纪律 20 的强制方式 | 写的是 `review`。但这个项目没有第二个人 review，而**本 stage 是第一次真的往磁盘写应用文件** | 改成 `lint`。002 §2.3 早就列了这条规则（「禁止硬编码其他配置路径的正则规则」），只是从没排期——本 stage 补上（§1.4 #4） |
| 5 | **架构 §1.1 / §5 纪律 12** | 纪律 12「启动同步路径只允许窗口、单文件与 CM6」的强制方式是「**打点断言**」，§1.1 也给了三段预算——**但 t0–t5 六个点的口径在任何文档里都没有定义**。纪律 22 要求 markup 打点「口径固定」，启动打点却没有对应的一句 | 把 t0–t5 的定义写进架构 §4.7（或 001）。本 stage 已在 §1.7 就地定义了一份，**但那是 plan 文档，不是设计真相**——两个 stage 之后就会有人重新定义一遍 |
| 6 | **架构 §4.5** 的「字段树镜像设置清单的四个一级」 | 这句话读起来像"`defaults.ts` 一开始就要铺满"。001 §1 的仓库结构图已经因为同样的误读加了 `[Sn]` 标注与「这是终态结构」的提醒，**§4.5 这句还没有** | 加一句同样的提醒：这是**终态**字段树，各 stage 只加自己真正读取的字段。否则每个新 session 读到这里都会想去铺满，并被迫替后面的 stage 裁默认值（§1.1 问题五） |
| 7 | **架构 §4.9** 保存失败的处理 | 「提示 → 自动重试 3 次 → 仍失败则拦截关闭」写在 §4.9，但 001 §7 只在 **Stage 7**「错误提示与重试」里含糊对应。**保存路径在 Stage 1 就存在**，中间六个 stage 里保存失败怎么办没写 | 明确分两档：**Stage 1 保证"失败可见、不静默"**（本 stage 已列入功能深度表），**Stage 7 做完整的重试与拦截关闭**。不写清楚的话，Stage 1 要么过度实现、要么静默吞掉错误 |
| 8 | **根 `package.json` 的 `trustedDependencies: ["electron"]`** | 这是 Stage 0 收尾时加的，但 **electron 43 的 `package.json` 里根本没有 `scripts` 字段**（110 §1.8 风险 8 已查证），没有生命周期脚本可被信任——**这一项是空操作** | 建议删掉，或加一行注释说明它是防御性的（万一将来 electron 恢复 postinstall）。**留着无害，但它会让下一个人以为惰性下载问题已由它解决**——而真正解决它的是 `ensure-electron` |

---

## 附录 B · Stage 1 实施中发现的、需要人裁的四件事

> 2026-08-04 实施期间撞到。**都不是"做完了"，是"做的时候发现设计有缝"。**

**裁决结果（2026-08-04）：四条全部处理完毕，上游文档已改。**

| # | 裁决 | 落地 |
|---|---|---|
| B.1 | **采纳，写进架构** | 架构 §4.4 新增「CM6 接入的字节硬约束」：两层规范化的机制说明 + 三条硬约束（检出并还原换行与 BOM／恒设 `lineSeparator`／取全文一律经 `readDoc()`）+ fixture 覆盖清单，并注明「Stage 2 起接装饰时不因新增扩展而放松」。**核实过 `@codemirror/state@6.7.1` 源码**：`sliceString(from, to = this.length, lineSep = "\n")` 默认值硬编码，`toString()` 不传它，`sliceDoc()` 第 2699 行显式传 `this.lineBreak`——文档描述完全属实 |
| B.2 | **采纳改判** | 002 §2.1 那行改为「维持 lint，`ThemeVar` 仅作 token 词汇」。**并加了一条元教训**：那张表原有五条是在没检验「类型能不能真的够到危险」的前提下写的；剩下三条在 Stage 3/4 落地前，必须先各问一遍「这个类型是危险操作的唯一通道吗」，答不上来就别升 |
| B.3 | **采纳** | 002 §1 阶梯表第 2 层补上盲区说明：带绑定的 import 报 `TS2307`，副作用式 `import 'pkg'` 不报错，由第 4 层 `not-to-unresolvable` 兜底 |
| B.4 | **无需动作** | 判据给对了、用上了、结论合理。Stage 2 加装饰后按同一条判据重判 |

**另修一处口径**：003 §3.2 钉死了 `checks_added` / `checks_reverse_verified` 都是**本 stage 新增或修改**的检查数、不是累计，分子分母必须同口径。本 stage 首次回填的 3/19 ＝ 0.16 正是分母混了 Stage 0 的老检查算出来的，**比真实情况悲观**。补验时按新口径重算。


### B.1 CM6 会把 CRLF 静默改成 LF —— 不变量 2 的一次真实威胁

**这是本 stage 最重要的发现，而且它是被单测抓到的，不是被想到的。**

CodeMirror 6 的 `EditorState.create()` 默认按 `/\r\n?|\n/` 拆行、用 `'\n'` join 回去。也就是说**一个 CRLF 文件读进 CM6 再取出来就变成 LF 了**——全文规范化，正是不变量 2 明令禁止的。

更隐蔽的是第二层：即便显式设了 `EditorState.lineSeparator`，`state.doc.toString()` **仍然恒用 LF 拼行**（`Text.sliceString` 的 `lineSep` 参数默认 `'\n'`，与 facet 无关）。只有 `state.sliceDoc()` 才用 `state.lineBreak`。**两个 API 差一个字符，后果是用户整个文件被静默改写。**

已落地的防线三条：`bytes.ts` 检出换行风格与 BOM ｜ `baseExtensions` 恒设 `lineSeparator` ｜ `readDoc()` 包住取全文，让调用方**没有写错的机会**（002 §2.1 的「把危险操作设计成没有不安全的调用方式」）。11 个 fixture 的 round-trip 单测覆盖 LF / CRLF / CR / 无尾换行 / 混用换行 / BOM / 非 ASCII / 超长行 / 空文件。

**要裁的**：这条该不该写进架构 §4.4「渲染层」，作为 CM6 接入的硬约束？现在它只活在 `bytes.ts` 的注释与单测里，Stage 2 接装饰的人未必会读到。

### B.2 纪律 3 的「升级为类型」不成立 —— 我没有按计划删掉 lint 规则

120 §1.4 #3 写的是「删除 lint 纪律 3，被 `ThemeVar` 取代」。**我没删，理由如下，请裁。**

`ThemeVar` 只能守住「显式声明为 `ThemeVar` 的那些通道」。而 React 的 `style={{ color: '#fff' }}` 走的是 `CSSProperties`，类型上就接受任意字符串——**类型层根本够不着它**。删掉 lint 规则等于用一个覆盖面更小的手段换掉一个更大的，是净退步。

所以我把 `ThemeVar` 定位成**词汇表而不是强制手段**（它给 token 命名、并让调色板之外的地方拿不到色值），纪律 3 的强制手段仍然是 lint——**这样仍然是"一条纪律一种手段"，没有违反 002 §6.1**。同时把 lint 从只扫 `.ts/.tsx` 扩到**也扫 `.css`**，只放过调色板文件一个，把组件样式表这个后门堵上。

**要裁的**：002 §2.1 那张表里「组件不得出现字面色值 → `ThemeVar`」这一行，是否该改成「维持 lint，`ThemeVar` 仅作 token 词汇」。**类型层五条里，这一条大概率是设计时想当然了。**

### B.3 002 §1 阶梯第 2 层的描述需要精化

阶梯表写「包边界：编译时（import 不到）」。实测：**带绑定的 import 确实编译不过（TS2307），但副作用式的 `import 'x'` 不报错**。后者由 `check:deps` 的 `not-to-unresolvable`（第 4 层）接住。

**要裁的**：阶梯表第 2 层加一句「副作用 import 是盲区，由第 4 层兜底」。这不是理论问题——`import './some-side-effect.css'` 这类写法在前端很常见。

### B.4 `renderer/stores/` 没建，判据已用上

120 §1.3 给的判据是「按实际复杂度定，若建就每 domain 一个」。实测下来本 stage 的状态只有「当前 page + 脏标记 + 主题 + 错误」四项，全部装在 `App.tsx` 的 `useState` 里，**没有跨组件共享的需求**，所以没建。Stage 2 加装饰与 widget 后会不会需要，届时再按同一条判据判。

---

## 附录 C · 补验证一轮（2026-08-04）发现的两件事，需要人裁

**裁决结果（2026-08-04）：两条均已裁，已落地。**

| # | 裁决 | 落地 |
|---|---|---|
| C.1 | **采纳方向 ①** | `fsio.test.ts` 对 `node:fs/promises` 做透传 spy，断言调用序列（writeFile 落 `.tmp` 且不许落目标本身、`rename` 恰一次且 tmp → 目标）。**加固后重跑反向验证 ⑦：同一破坏正确变红**（§1.5 ⑦），`dead_checks` 归零 |
| C.2 | **采纳方案 ②** | 映射表不做（单人项目维护成本不值）。`CLAUDE.md`「完成前必须」一节加了一句：typecheck 红了不报纪律号，先看是不是动了 `CopyKey`（纪律 5）/ `ThemeVar`（纪律 3） |

> 原始记录如下。本轮只补反向验证，不加功能、不改实现。

### C.1 原子写单测空转 —— 阶梯第 5 层有一档没被描述的风险

详见 §1.5「空转的检查」。**要裁的不只是"把测试补硬"，还有一条更普遍的**：

002 §1 的阶梯把「单测」放在第 5 层，绕过方式写的是「删测试」。但这次的失败模式**不是被删掉**——测试在、绿着、看起来在守，**它只是写的时候没测到点子上**。110 那次空转的是第三方库（少传 `validate`），这次是自己写的测试；两次的共同点是**"存在且绿"被当成了"有效"**。

建议：阶梯表第 5 层补一句绕过方式——**「或写一条恒真的断言」**，并在 §6.2 后面加一句判据：**一条单测若在实现被合理破坏后仍然全绿，它就等于不存在。**

### C.2 类型层无法自报纪律号 —— 阶梯最高的一层，输出质量最差

详见 §1.5「输出不指向纪律号的」。两条类型层的反向验证都只得到 `FAIL: 类型（typecheck）— 见上方输出`。

这是个**结构性张力**，不是实现疏忽：002 §1 说「能用上面的手段就别用下面的」，而阶梯越往上、失败信息离我们的纪律编号体系越远——lint 是自己写的所以能报编号，`tsc` 根本不知道有这个体系。**升级到类型换来更早发现，代价是更差的可读性。**

建议二选一，**都不便宜，所以请你裁**：① 给 `check.mjs` 的 typecheck 包装层做「文件路径 + TS 错误码 → 纪律号」的映射（`packages/*/src/copy/` 下的 `TS7053`/`TS2578` → 纪律 5，`ui/src/theme/` 下的 → 纪律 3）；② 或者接受这一层只给通用信息，改为在 `CLAUDE.md` 里写明「typecheck 红了先看是不是动了 `CopyKey` / `ThemeVar`」。

---

## 附录 D · 第一轮人工验证后的修复 goal（2026-08-04）

> 依据：§1.6 第一轮人工判定 + `~/.sepia/session.json` 实测（`cursor: 25166`，非 0）。

### D.1 确认的缺口：滚动位置从未被保存——三处断链，不是一处

§1.2 明写「读写：上次 page 的绝对路径、光标位置、滚动位置」，滚动这半是**漏做**，不是设计取舍：

| 环 | 位置 | 现状 |
|---|---|---|
| 采集 | `editor/base.ts` updateListener | 只监听 `selectionSet`，**滚动事件根本没被采集**——第 50 行注释还写着「光标或滚动变化时回调」，实现只接了一半 |
| 写入 | `App.tsx:121` | `scrollTop: 0` 硬编码 |
| 恢复 | `mountEditor` / `EditorHost` | `MountOptions` 没有 scrollTop 入参；挂载后也不 `scrollIntoView` |

### D.2 光标「未见恢复」：已实证——selection 恢复了，视口没跟上

写入侧证实是好的（cursor=25166 落盘）；恢复链每一环静态走查是通的，且 clamp 界内（该文件 801,785 字节、纯 LF）。`mountEditor` 落位 selection 后**从不 `scrollIntoView`**，视口停在文件顶部——视觉上与"光标没恢复"不可区分。

**实证已做（2026-08-04，通过）**：重开应用后什么都不点直接敲一个字，**视口瞬间跳到上次位置、字出现在那里**。结论坐实：光标恢复链全程无缺陷，本 goal 只需修视口/滚动这一侧（D.1 三处断链 + D.3 第 3 条的 `scrollIntoView` 兜底）。

### D.3 修复 goal 的内容（一条链修完整，不拆散）

1. **采集**：`base.ts` 补滚动监听（`scrollDOM` 的 scroll 事件或 geometry 变化），`onSelectionChange` 旁并列一个 scroll 回调
2. **写入**：`App.tsx` 用真实 `scrollTop` 替掉硬编码 0；**并加 debounce**——现状是每次 selection 变化都 `atomicWrite` 一次 `session.json`（每敲一个字写一次盘），补上滚动采集后只会更密
3. **恢复**：`MountOptions` 增 `scrollTop`；挂载后恢复滚动位置，且**无论如何对 selection 补一次 `scrollIntoView` 兜底**（scrollTop 失效/文件变短时光标仍可见）
4. **顺带**：`void api.setSession(...)` 吞掉失败——session 写失败至少要在 dev console 可见，不许静默（与「保存失败不静默」同一条纪律的精神）
5. 修完重验 §1.6 「关掉所有窗口再从 Dock 打开」那条，并重跑「写字→保存→重开」smoke

### D.4 修复记录（2026-08-04，本 goal 完成）

**D.3 五条全部落地**，且修复过程中又挖出两个计划外的真 bug——都不是滚动链本身，是滚动链的验证把它们照了出来：

| 修了什么 | 位置 | 说明 |
|---|---|---|
| 采集 | `editor/base.ts` `mountEditor` | `MountOptions` 增 `onScroll`，挂在 `scrollDOM` 的 scroll 事件上（passive），`destroy()` 时摘除。滚动属于 view 不属于 state，所以不进 `updateListener` |
| 写入 + debounce | `App.tsx` | 光标与滚动攒进 `sessionDraft` ref，**500ms 静默期一次原子写**——替掉「每敲一个字写一次盘」与硬编码 `scrollTop: 0` |
| 恢复 | `mountEditor` | `MountOptions` 增 `scrollTop`；**在 rAF（CM6 首次 measure 之后）**先落 scrollTop、再对 selection 补一次 `scrollIntoView` 兜底。构造刚返回时就设会被夹回 0——smoke 实测抓到过（`Received: 0`） |
| session 写失败可见 | `session-state.ts` + `ipc/index.ts` | `saveSession` 改为交还 `IoResult`，ipc 侧失败写 stderr（dev 终端可见）。UI 级提示归 Stage 7 错误体系 |
| smoke | `test/smoke/write-save-reopen.spec.ts` | 「写字→保存→重开」全链落地（§1.5 smoke 表最后一条此前未实现）：滚动恢复 >500、⌘S 落盘、重开后内容与滚动都在。**已当场反向验证**：删掉恢复逻辑 → `Expected: > 500 / Received: 0` 红，还原后绿 |

**计划外揪出的两个真 bug**：

1. **`onChange` 走的是 `doc.toString()`——不变量 2 在采集端就破了**（`base.ts`）。CRLF 文件每敲一个字，回调交出的全文已被规范化成 LF，⌘S 一存整篇改写。B.1 定案时只堵了 `readDoc` 这条读路径，漏了 updateListener 这条。第一轮人工验证没撞上纯因测的文件是纯 LF（D.2 记过）。已改为 `sliceDoc()`；单测够不到 updateListener（需要真 EditorView），由新 smoke 的 CRLF 断言端到端守住：保存后 `/(?<!\r)\n/` 必须无匹配。
2. **macOS 上 `app.getPath('home')` 无视 `$HOME`**（`main/index.ts`）。实测 `HOME=/tmp/fake` 时它仍返回 `/Users/wp`，于是 smoke 的 HOME 隔离完全失效——**冷启动 smoke 一直在读写用户真实的 `~/.sepia`**，此前的绿有水分（t4/t5 照样打点，只是打开的是用户自己的上次 page）。改用 `os.homedir()`（POSIX 上优先取 `$HOME`，正常启动两者等价）。新 smoke 的内容断言（`title: "a.md"`、`firstLine: "ORIGINAL"`）正是这样把它照出来的。

frontmatter 同步：`checks_added` 13→14、`checks_reverse_verified` 13→14（新 smoke 计入并已反向验证），覆盖率维持 1.0。

**待人工**：D.3 第 5 条的另一半——重验 §1.6「关掉所有窗口再从 Dock 打开」（滚动位置这次该跟着回来了）。机器侧三条 smoke 全绿、`check` 全量 `PASS`。
