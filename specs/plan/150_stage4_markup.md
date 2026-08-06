---
stage: 4
title: markup
status: done          # 2026-08-06 关闭：1.6b 六项人工走查通过（2026-08-05，dev 真引擎），性能实测经人裁跳过并记债
dod: 选区→完整 diff <15s；生成期间编辑正文则落笔中止而非覆盖；落笔是单独 undo 单元；全链打点六点齐
checks_added: 19         # 口径 003 §3.2（本 stage 新增或改判定逻辑的）：§1.5 的 0–12 共 14 条 + 收尾轮 A/B/C/D 修复新增 5 条（13–17）
checks_reverse_verified: 19  # 19/19，见 §1.5
dead_checks: 4           # 反向验证首轮空转数（003 §3.2，记首轮不记收尾）—— #4 原子性、#7 流式单调、#9 全链打点、**#17 回声（收尾轮新增的第四条）**，均已改到有效，明细见 §1.5
exemptions: 4            # 纪律 20 重述已落地（§1.4 条目 0），8→4 —— 豁免数第一次下降
disputes: 0
measured:                # **本 stage 不做性能测量**（人裁 2026-08-05：跳过性能验证，快速收尾）。七项全部记债，见 §1.7 与文末遗留债
  markup_submit_to_first_token_ms: 未测
  markup_first_token_to_diff_ms: 未测
  markup_select_to_diff_ms: 未测
  markup_apply_ms: 未测
  markup_panel_summon_ms: 未测
  model_switch_ms: 未测
  context_tokens: 未测
  reverse_coverage: 1.0  # 19/19
---

# 150 · Stage 4：markup

> 模板：003 §1 ｜ 上游：001 §7、002 §7、架构 §1.1 §4.3 §4.3b §4.3c §5 ｜ 基线：140（Stage 3，已关闭）
> 原型对照：W6（浮层指令输入）、W7（流式 diff 预览）——W8 的徽章部分属 Stage 5b。CLAUDE.md「交互原型」节

> **这个 stage 交付的是 Aha #2**：选中 → ⌘K → 讨价还价 → diff → 落笔（happy-path 分镜 5–8 的前半）。
> 结束时 markup 全链在真模型上跑通且 <15s，落笔受 CAS 保护、是一次可整体撤销的原子编辑。
> **徽章、线程面板、成对 commit 一概不在**——那是 Stage 5b（GitService 机制本身由 5a 并行建，见 §1.1〇）。本 stage 的 diff 是内存比对，不碰 git。

---

## 1.1 前置

### 〇、并行声明（三线并行的 L1 主线，规则在此成文）

本 stage（L1）与 **L2（Stage 5a：GitService + 三触发 + 锚点纯函数模块）**、
**L3（Stage 6a：watcher + focus 对账 + 冲突策略 + 文件操作）** 同期在飞（各自 worktree）。
规则四条，三份 plan 的 §1.1 同文（**2026-08-05 裁：160/170 缓建，先完成本计划**；
起草时本节规则原文进其 §1.1）：

1. **合并顺序：4 永远第一。** L2/L3 小步 commit、**每日 rebase master**；谁先做完谁等 4，
   不许反向要求 4 rebase 它们。
2. **shell 冻结令**：4 在飞期间，L2/L3 不碰 `App.tsx` / `EditorHost` / session schema /
   renderer editor 区。6a 如需冲突提示 UI，复用 Stage 3 提示线模式做最小横条，完整 UI 归 6b。
3. **5b（徽章/线程/成对 commit）与 6b（文件树/多 Tab/主页/@ 选择器）的入口条件 = Stage 4 合并**，
   在 160/170 的 plan 里写死（缓建，见节首注），不是独立 stage。
4. **共享注册表按 003 §5 清单，仅追加**（`dep-graph.json` / `bridge-snapshot.json` / catalog /
   `core/types`——4 与 5a 都往 `core/types` 加，各加各的）：`bun.lock` 冲突以重新 `bun install`
   再生成为准；`main/index.ts` 装配点小步合是已知代价；桥所有权——本 stage 零增长（见 §1.3），
   L2/L3 各自预声明。

### 一、Stage 3 的 DoD 达成情况

已关闭（140，2026-08-05）：kill -9 后纸全功能可写 ✓、⌘K 缺席提示 ✓、同步路径无引擎 ✓
（判据加严为 fork 晚于 t5）。本 stage 赖以开工的存量：AgentBridge 五方法 + `api.agent.*`
八项 preload 暴露面（本 stage **一项不加**）、真 key 真模型探针（首 token 0.5s，全程 7.3s）。

### 二、140 债①：合并后集成验证——**已还，红了按红处理**

计划起草时跑全量 `check`，即红在 `check:artifacts`：新鲜 checkout 无引擎产物（产物在
.gitignore，Stage 3 在另一 worktree 构建过）。按 140 关闭记录的交代往下挖，抓出**真缺陷**：

- `build-engine.ts` 漏实现了 001 §4 写明的 `MODELS_DEV_API_JSON=scripts/models-dev-snapshot.json`
  机制——build-node 直连 models.dev，本机无网即构建失败（Stage 3 构建时机器有网，侥幸通过）
- 修法（已落地）：快照文件进仓库（`scripts/models-dev-snapshot.json`，3.4MB，models.dev
  api.json 格式，取自本机 opencode 缓存的当日快照，只读复制）；`build-engine.ts` 显式向
  build-node 传 `MODELS_DEV_API_JSON`（实测 Bun 父进程改 `process.env` 不进 spawnSync
  子进程，必须显式 env）
- 复跑全量 `check`：**PASS**（lint 0.2 ｜ typecheck 0.3 ｜ deps 1.1 ｜ bridge 0.2 ｜
  workspace 0.0 ｜ artifacts 0.1 ｜ patches 0.4 ｜ marks 0.2 ｜ test 1.0）

**配套订正（已落地）**：`check:artifacts` 原定「只进 CI」（002 §2.4/§3），Stage 3 实际放进了
gate——本次它真抓到了东西，002 §2.4/§3/§7 已改判为 gate（002 §6.2：新增检查必须能指出它抓到过什么）。

### 三、继承的延后账，逐条重问「现在有条件了吗」

| 账 | 本 stage 裁决 |
|---|---|
| **140 债② / 130 债② typecheck 增量化** | **第三次延后**。理由诚实：今日实测全量 check warm 3.5s、冷约 11s，远低于 30s 预算，痛点未发生。写死触发条件：**check >20s 或 typecheck 冷跑 >10s → 必须做**，不再问「有没有空」。002 §3 的期限子句「在 Stage 2+3 合并仪式前完成」已失去锚点（仪式经人裁跳过），列入 §1.9 回流改为触发式 |
| **140 债③ 纪律 20 重述 + 摘四条 XDG 豁免** | **做，列为本 stage 开门第一项 harness 活**（§1.4 条目 0）。有界：措辞按「Sepia 自有文件 vs 读别人的文件」重述 + check-discipline 规则跟随 + 摘 4 条豁免（8→4）+ 双向补验。豁免数 8 只增不减已是腐化信号，本 stage 是它第一次下降的机会。走卡住协议：两次不成即延后并报告 |
| **140 债④ 基线重立** | 本 stage 不承诺静机窗口；窗口出现时跑 `SEPIA_PERF_ASSERT=1` 校准并回填新基线。不阻塞本 stage：markup 打点是**相对测量**（链内六点），不依赖冷启动基线 |
| **140 债⑤ 打包运行期验证 / 130 债③ `.dmg`** | 不动，继续在 `.dmg` 延后账，随下次 release |
| **130 债① 列表/表格视觉打磨** | 不进本 stage（本 stage 不动列表/表格渲染），继续挂账或攒视觉专项 |
| **130 债④ `check:theme` 随 Shiki** | **本 stage 做**（已裁死，见 §1.4 条目 8） |
| **130 债⑤ /harness 看板** | **已关闭**（2026-08-05 裁死不做，003 §3 头注） |

### 四、需要裁的设计点（本计划自带的答案，人审本计划时一并裁）

| 点 | 计划内的答案 | 依据 |
|---|---|---|
| 上下文范围默认值 | **整篇**（已裁，2026-08-05）；与 TTFT 的冲突由机制消化：距离衰减链展开到整篇 + 预算硬截断，超预算时近选区者先进 | 架构 §4.3c 裁决块 |
| @content 的产品入口 | 本 stage **只建块类型**（组装器认得 @content 块，单测覆盖），`@` 选择器入口归 Stage 6b | F15/F16 归 Stage 6b（001 §7 的行拆为 6a/6b，见 §1.1〇）；D-31 要求显式喂 |
| diff 算法 | **自写词级 LCS，纯函数进 core，不引库**——core 外部依赖趋近于零（001 §2.1）；实现超 250 行则停下报告，改引库裁决 | 纪律：先纯函数后依赖 |
| 动词与任务的关系 | 五组动词（文字/代码块/图片/标题/引用）**全部挂同一个改写任务**——动词是 user message 的措辞模板，system prompt 保持常量（纪律 21 不许动词进 prompt）；图片 naming 类新任务**不加**（输出去向机制留好，任务不开） | D-29 + T-33 + 纪律 21 |
| 追问的上下文 | 每轮重发当前选区快照 + system prompt 声明「以本轮原文为准」；前后文首轮发、追问省略（架构 §4.3c 的可后置项，本 stage 就按省略做——它免费） | T-22 / F10 |

---

## 1.2 范围

### 做什么（001 §7 Stage 4 行）

**⌘K 浮层（D-29 三阶段家具，W6/W7 为基准）**
- [ ] 唤起：一行输入 + 随选中对象变化的动词列（文字/代码块/图片/标题/引用五组，zh-CN；
      动词表按语言分组的形状建好——D-41 潜伏态），打字即隐藏动词；空手 ⌘K 给空态提示；Esc 关闭
- [ ] 生成中：一行流式状态 + 停止（Esc / 停止按钮走 `interrupt`）；**家具在提交瞬间就位**，不等首 token
- [ ] 出结果：diff（原文划线/新文）+ **落笔 / 放弃 / 重试**；模型切换收进「重试」下拉
      （`listModels`，切换 <100ms）
- [ ] 同线程追问（F10）：diff 下方追问输入框，同 session 再来一轮，diff 更新；「重置到 diff」回上一版
- [ ] 缺席整合：缺席时 ⌘K 在真浮层里给缺席文案（接 Stage 3 的状态面）；生成中引擎死 → 浮层错误态，纸不受影响
- [ ] 追问排队/转向选择（D-34 采纳①）：生成中再发送 = 排队或立即转向，二选一的交互按 W7 定

**任务四元组与上下文（架构 §4.3c）**
- [ ] `agent` 包任务注册表：任务类型 → { 模型, 上下文策略, system prompt, 输出去向 }；
      MVP 注册一条：改写。加任务 = 加一条配置的结构就位
- [ ] 块式上下文组装器（`agent` 包，不碰 DOM）：接受「块」列表；MVP 填选区块 + 邻近正文块；
      @content 块类型实现（入口不在本 stage，见 §1.1 表）
- [ ] 距离衰减取材 + 预算硬截断：选区 → 所在段 → 前后各 N 段 → 篇首，到预算上限截断；
      范围默认整篇（裁决 2.1），上限是配置项
- [ ] system prompt 常量（纪律 21）+ 「输出与原文同语言」（D-41 Day-1）；类型层第四条（§1.4）
- [ ] session 预热（T-32）：引擎就绪时预建 1 个空 session，池大小为配置项

**流式渲染与 diff**
- [ ] Streamdown 接入：流式 markdown 补全未闭合语法 + 块级 memo（T-14）
- [ ] 揭示节奏：24ms 批次、按词与标点边界 snap、无逐字补间；`prefers-reduced-motion` 整块秒显
- [ ] 四条稳定性不变量：冻结即定、结构块绝不闪 raw、揭示单调只增、节奏与 token 到达率解耦
- [ ] Shiki 双主题输出与 CM6 高亮同一份色板派生（纪律 14）；`check:theme` 落地（130 债④）
- [ ] diff 纯函数（core，词级 LCS）：原文划线 / 新文对照的展示数据

**落笔（T-27 / 纪律 9c / 纪律 19）**
- [ ] 落笔函数**只接受** `{ range, expectedText }`，类型上无未校验通道（类型层第五条，§1.4）
- [ ] CAS 校验：目标区间当前文本 ≠ 提交时快照 → **不落笔**，提示重来或手动处理
- [ ] 单次 CM6 transaction + 隔离为独立 undo 单元，⌘Z 一次撤干净
- [ ] 落笔后立即触发写盘（不等 800ms 防抖——纸角警示与保存管线沿用 Stage 1）

**打点与验收（纪律 22）**
- [ ] markup 全链六点打点，命名定死 **m0–m5**：m0 提交 / m1 请求发出 / m2 首字节 /
      m3 首 token / m4 完成 / m5 落笔——口径进 `core/types`，与启动 t0–t5 命名空间彻底分开
      （架构 §4.3b 原文也叫 t0–t5，撞名，§1.9 回流请人改），smoke 断言顺序与预算
- [ ] **冷启动零增量**：Streamdown / Shiki / 浮层组件全部惰性 chunk，不进启动同步路径
      （纪律 12；Stage 2 的 KaTeX 教训原样适用）——冷启动 smoke 的 t0–t5 攒齐断言即为守卫，
      本 stage 结束时对照一次数字确认无回归

### 明确不做什么

**属于 Stage 5b / 由 5a 并行的**（一件都不碰）：徽章、线程面板、⌘⇧H 还白、成对 commit
（`sepia: pre-markup` / `sepia: markup`）的 markup 侧接线——5b；GitService、三触发机制、
锚点纯函数模块——**5a 在并行建**（§1.1〇），本 stage 不碰也不接。**本 stage 的 diff 是内存比对**
（快照 vs 生成结果），不是 git diff；「徽章展示的 diff 从 git 取」（D-08）等 5b 的成对 commit。

**最容易顺手带出、必须刹住的**：

| 会顺手带出的东西 | 为什么手会滑 | 刹车 |
|---|---|---|
| 落笔后在段落右缘加小点 | 分镜 8 说「徽章浮现」 | 徽章是 Stage 5b；本 stage 落笔后浮层收起即止 |
| 用 commit 夹 diff | 「成对 commit 又不难」 | GitService 在 5a 并行建，markup 接线归 5b；内存 diff 已够 DoD |
| `@` 选择器 | 都支持 @content 块了 | 入口归 Stage 6b；组装器有块就够 |
| 图片取名等第二个任务 | 输出去向机制建好了 | 任务注册表只注册改写一条；机制留着 |
| 设置 UI | defaults.ts 一下多了仨字段 | MVP 无设置 UI，改 config.json |
| 第二套动词 | 动词表按语言分组了 | D-41 潜伏态：只建形状 |
| 家具切换动画 | 三阶段切换想加过渡 | opencode 气质：即时切换。动效只在流式 24ms 批次里（D-34① 排队交互除外） |
| 给引擎开写路径调试 | 「让它自己改文件多方便」 | 不变量 3/4；check:bridge 不变量子条在看着 |
| preload 加项 | 流式好想加专用通道 | 恰好八项，多一个即红（140 §1.3） |

---

## 1.3 代码结构与功能深度

| 包 | 本 stage 新增 | 深度 |
|---|---|---|
| `agent` | 任务注册表、上下文组装器、system prompt 常量模块 | 四元组结构全，任务只注册改写；组装器认三种块，产品喂两种 |
| `core` | 词级 diff 纯函数、markup 打点类型与口径、Agent 动词/文案（D-41：归 Agent 配置，不进界面 copy 模块） | diff 自写，≤250 行超出即停下报告 |
| `app` renderer | markup 浮层组件（三阶段家具）、Streamdown/Shiki 接入、diff 展示、落笔接线（经 command registry） | 视觉按 130 已裁风格（shadcn + Flexoki + 克制），不做新视觉裁决 |
| `app` main | session 预热钩子（supervisor 就绪后） | 池大小配置项 |
| `editor` / `ui` | **不动** | 浮层是领域组件住 app；CM6 侧唯一接触面是落笔 transaction 的宿主 API |
| 根 | `scripts/check-theme.mjs`、`scripts/models-dev-snapshot.json`（§1.1 二已落地） | — |

### 新增对外暴露面（预先声明，003 §1.3）

| 类别 | 内容 |
|---|---|
| **preload 白名单** | **零新增**。`api.agent.*` 八项是 Stage 3 为本 stage 预声明的；多一个 `check:bridge` 不变量子条即红 |
| **包依赖** | **（§1.8 spike 后改判）** `remend`（零依赖，流式补全解析）+ `shiki` + `@shikijs/langs/*` → `app`；**`streamdown` 不引**（它的视觉层全是 Tailwind，本项目没有 Tailwind——理由见 §1.8 风险 1 记录）。**三者必须落在惰性 chunk**，见 §1.2 冷启动零增量。core 零新增（diff 自写）。**无新原生模块（T-18）** |
| **配置字段** | defaults.ts 增**三个**，全部本 stage 真读：`companion.contextScope`（默认「整篇」，裁决 2.1）· `agent.contextBudgetTokens`（预算硬截断上限，架构 §4.3c）· `agent.sessionPrewarm`（默认 1，T-32） |
| **磁盘** | 无新增（threads/json 归 Stage 5b） |

---

## 1.4 harness 增量

| # | 检查 | 守什么 | 阶梯层 | 硬度 | 状态 |
|---|---|---|---|---|---|
| 0 | **纪律 20 重述**（140 债③）：措辞分「Sepia 自有文件 / 读别人的文件」，规则跟随，摘四条 XDG 豁免（8→4），双向补验 | 豁免数第一次下降 | 3 lint + 文档 | 纪律级 | **✓ 已落地**（8→4） |
| 1 | **类型层第四条**：system prompt 常量字面量联合 + **`.test-d.ts` 负向断言**（纪律 21） | 模板字符串拼变量赋不进去 | 1 类型 | 纪律级 | **✓ 已落地** |
| 2 | **类型层第五条**：落笔只接受 `{ range, expectedText }` + **`.test-d.ts`**（纪律 9c） | 无未校验重载 | 1 类型 | **不变量级** | **✓ 已落地** |
| 3 | 单测 · CAS 行为：快照不匹配即中止、匹配即落 | 落笔不抢笔 | 5 单测 | **不变量级** | **✓ 已落地** |
| 4 | 单测 · 落笔原子性：单 transaction、undo 单元隔离（纪律 19） | ⌘Z 一次撤干净 | 5 单测 | 纪律级 | **✓ 已落地** |
| **4b** | **单测 · m0–m5 判读口径**（实施中新增，纪律 22）：六点齐否、顺序单调否、四段预算；并断言 m0–m5 与启动 t0–t5 **零名字重叠** | 吞点/乱序说得出来 | 5 单测 | 纪律级 | **✓ 已落地** |
| 5 | 单测 · 上下文组装：衰减链顺序、预算硬截断、@content 块 | 裁决 2.1 的机制落地 | 5 单测 | 纪律级 | **✓ 已落地** |
| 6 | 单测 · diff 纯函数：词级对照的已知真值 | diff 可读性底线 | 5 单测 | 纪律级 | **✓ 已落地**（实现 163 行，预算 250） |
| 7 | 单测 · 流式不变量：单调只增、冻结判定、批次边界（state 可判定性质；字节风险归 e2e，002 §1 层级修正） | 流式稳定性四条 | 5 单测 | 纪律级 | **✓ 已落地** |
| 8 | **`check:theme`**：~~比对生成结果~~ → **比对变量名集合**（§1.8 spike 后改判）：三道——CM6 与 Shiki 用的 var 名都在 `themeVar` 表里，且表里每个名字 `theme.css` 真的定义了（纪律 14） | 两处代码用同一个变量 | 4 专项脚本 | 纪律级 | **✓ 已落地，已进 `check`** |
| 9 | **smoke · markup 全链**（DoD 一）：写字 → ⌘K → 提交 → mock SSE 流 → diff → 落笔 → 文件里读得到新字；六点打点顺序与预算断言 | Aha #2 可证 | 5 smoke | 纪律级 | **✓ 已落地** |
| 10 | **smoke · 生成中编辑 → 落笔中止**（DoD 二） | 不覆盖用户刚写的字 | 5 smoke | **不变量级** | **✓ 已落地** |
| 11 | smoke · interrupt：停止后流断、纸面不变 | 可打断性 | 5 smoke | 纪律级 | **✓ 已落地** |
| **12** | **单测 · 浮层宿主**（实施中新增，§1.8 风险 4）：装饰是块级 widget、位在选区行尾、随文档映射、收起即清空 | 推开下文的前提 | 5 单测 | 纪律级 | **✓ 已落地** |

真 LLM 全链手跑（`test/manual/`）：真 key 真模型走一遍讨价还价（分镜 5–8），数字记 §1.7——**不进 CI**（001 §6）。

---

## 1.5 自动化验证

> 口径按 003 §1.5/§3.2（2026-08-05 修订版）：破坏方式**随检查预写**；跑出「破坏后仍绿」
> **先修检查再重跑**，首轮结果与修复记入本节；`dead_checks` 记**首轮**空转数。
> 类型层两条（#1/#2）一上来就带 `.test-d.ts`（002 §2.1 第二条元教训），不等反向验证再发现。

| # | 检查 | 预定破坏方式 | 结果 |
|---|---|---|---|
| 0 | 纪律 20 重述 | 摘豁免后故意往 `~/.config` 写一个文件 → lint 必红；Sepia 自有路径写入 → 必绿 | **✓ 五探针全如期**（见下） |
| 1 | system prompt 类型 | 常量联合放宽为 `string` → `.test-d.ts` 的 `@ts-expect-error` 变无用忽略，tsc 必红 | **✓ 红**；且**首次运行就抓到真缺陷**（见下） |
| 2 | 落笔签名类型 | 加一个无 `expectedText` 的重载 → `.test-d.ts` 必红 | **✓ 红** |
| 3 | CAS 单测 | 删掉快照比对 → 构造「生成中编辑」场景必红 | **✓ 红** |
| 4 | 原子性单测 | 落笔拆成两个 transaction → undo 断言必红 | **首轮空转 → 已修 → 复跑红**（见下，计入 `dead_checks`） |
| 4b | m0–m5 判读单测 | ①`complete && ordered` 恒真化（吞点仍报达标）② 去掉单调判定 → 均必红 | **✓ 两条都红** |
| 5 | 组装单测 | 把衰减顺序打乱 / 去掉截断 / 选区不再豁免预算 / `contextScope` 不生效 / 默认值悄悄变 → 必红 | **✓ 五条都红**（后两条是复盘补的，见下） |
| 6 | diff 单测 | 把词级切分改成整段替换 / 去掉碎片化兜底 / 丢掉空白 token → 必红 | **✓ 三条都红** |
| 7 | 流式单测 | 允许揭示回退 / 冻结后可变 / 批次失效 / 取消词边界 snap → 必红 | **首轮「允许回退」空转 → 已修 → 四条全红**（计入 `dead_checks`） |
| 8 | `check:theme` | Shiki 用表外变量 / CM6 用表外变量 / themeVar 声明 theme.css 没定义的名字 → 必红 | **✓ 三条都红** |
| 9 | 全链 smoke | 吞掉一个打点 / m5 另起时间轴 / 浮层不出 → 必红 | **首轮「吞掉 m4」空转 → 已修 → 三条全红**（计入 `dead_checks`，见下） |
| 10 | 中止 smoke | 跳过 CAS 直接落 → 必红 | **✓ 红** |
| 11 | interrupt smoke | 吞掉 interrupt 透传 → 必红 | **✓ 红** |
| 12 | 宿主单测 | 改成行内 widget / 不随文档映射 / 收起时不清空 → 必红 | **✓ 三条都红** |
| **13** | **bridge 单测 · send 带 agent**（缺陷 A）：agent 逐字进 body；不带时 body 里也不出现该键 | 去掉 body 里的 agent 透传 → 必红 | **✓ 红** |
| **14** | **bridge 单测 · `/event` 必带 directory**（缺陷 C 之四）：query 里有 directory | 不拼 directory（回到实例回落 cwd 的老样子）→ 必红 | **✓ 红**（先写测、后修实现，红→绿全程留痕） |
| **15** | **smoke #9 判据四 · 非 XDG 逃逸探针**（缺陷 B，改的是 Stage 3 那条）：种 `~/.claude/skills/__probe__` → 查引擎 `/skill` 清单断言不出现；另断言 built-in 必在，防清单取空时空转 | 摘掉三个 `OPENCODE_DISABLE_*` 开关 → 必红 | **✓ 红**（报「引擎读到了 ~/.claude」） |
| **16** | **smoke ④b · C 类 widget 内的行内标记**（缺陷 C 之表格）：单元格出 `code`/`strong` 语义节点、无字面反引号星号、块级不递归、无 `<script>` 节点 | ① 单元格改回 raw ② 摘掉 `inlineRenderer` 注入 ③ 合成表格外壳换成裸解析 → 均必红 | **✓ 三条都红** |
| **17** | **smoke #9b · 回声不成为结果**（缺陷 D）：桩按真引擎先回声、模型不答 → 浮层不进 result、无落笔按钮、纸面零字节变化 | ① 去掉两道回声闸 ② 空结果改回判 done → 均必红 | **首轮空转 → 已改测 → 两条都红**（计入 `dead_checks`，见下） |

### 收尾轮反向验证的明细（2026-08-06，缺陷 A/B/C/D）

**#17 首轮空转——第四条 `dead_check`，记在这里而不是抹掉**

回声这条最初是**挂在 #9 里的一句断言**：跑完全链后检查浮层文本里没有 `【要改写的原文】`。
破坏（去掉两道回声闸）之后**它照样绿**——因为 #9 的桩总会推助手文本，回声一到就被
后来的正文覆盖掉了，检查的那一刻回声早已不在。**它测的根本不是出问题的那个场景。**

真正会出事的场景是「回声之后模型一个字都没有」。于是按 003 §1.5 的规矩**先改检查**：
桩加 `silent` 模式（只回声、然后把流收干净），断言改成「不进 result / 没有落笔按钮 /
纸面零变化」，独立成 #9b。再跑两条破坏，**这次都红**。

教训与 §1.9 回流 4 是同一条：**桩替被测系统假设掉的那部分，正是检查最容易空转的地方。**

### 首轮反向验证的明细（2026-08-05）

**#0 纪律 20 重述——五条探针，含两条「必绿」方向**

| 探针 | 期望 | 实际 |
|---|---|---|
| 非 `paths.ts` 里写 `~/.config/sepia` | 红 | 红 ✓ |
| 非 `paths.ts` 里用 `sepiaPaths()` 派生 | 绿 | 绿 ✓ |
| `agent-supervisor.ts` 塞回 `XDG_CONFIG_HOME` 字面量 | 红 | 红 ✓ |
| **`paths.ts` 里写 XDG 根字面量** | 红 | 红 ✓ |
| `paths.ts` 里出现 XDG 变量名 | 绿 | 绿 ✓ |

第四条是实施中**自己发现并堵上的洞**：初版把 `paths.ts` 整个文件放行（照抄纪律 3 的
`PALETTE` 模式），而 120 §1.1 问题七 那个 bug 真要重演，重演的地点恰恰就是 `paths.ts`——
整file 放行等于把规则唯一该守的门拆了。改成两支后才既消掉误报、又没开新口子（详见
`check-discipline.mjs` 纪律 20 段的长注释）。

**#1 首次运行即抓到真缺陷。** `SYSTEM_PROMPTS.rewrite` 初稿写成三段字符串**相加**，
而 `'a' + 'b'` 的类型是 `string` 不是 `'ab'`（`as const` 也救不回来）——于是 `SystemPrompt`
当场退化成 `string`，纪律 21 一行代码都没拦住。`.test-d.ts` 首跑报四条「无用的忽略」把它
逼了出来，改成单个无插值模板字面量后才真正成立。**这正是 002 §2.1 第二条元教训要的效果**：
类型层纪律配 `.test-d.ts`，不等反向验证再发现——这次连反向验证都没跑到，正向一跑就红了。

**#4 首轮空转，两处，均已修（`dead_checks` 记 1，口径 003 §3.2 记首轮）**

1. **undo 隔离断言空转。** 初稿让"用户刚敲的字"落在**文首**，离选区十万八千里。CM6 合并
   history event 的条件是 `isAdjacent`（两次改动区间要挨着），文首那次本来就不会合并——
   于是摘掉 `isolateHistory` 测试照样绿。改成让用户在**选区正后方**打字（也正是真实场景：
   选中一段、⌘K、手没停继续往后写）后，破坏即红。三种打字位置的判别力实测：

   | 用户打字位置 | 摘掉 isolateHistory 后 | 判别力 |
   |---|---|---|
   | 文首 | 仍绿 | **无**（初稿用的就是它） |
   | 选区正前方 | 红 | 有 |
   | 选区正后方 | 红 | 有（已采用） |

2. **「单 transaction」根本测不到。** `applyMarkup` 原本收整个 `EditorView`，而本仓库单测
   无 DOM、起不了 view——把一次 dispatch 拆成两次（纪律 19 最典型的破法）只能等 e2e。
   把参数收窄成 `MarkupTarget`（`{ state, dispatch }`，`EditorView` 结构上满足它，真实调用
   不受影响）之后，测试传个记账桩就能数出 dispatch 次数，破坏即红。

**#7 首轮空转（流式单调性），已修**

「整条流里 revealed 从不回退」这条断言，在把单调地板 `floor` 改成 0 之后**照样绿**——
因为所有用例都从 `revealed = 0` 起步，看不出「从头重算」与「从已揭示处继续」的差别。
补一条从 `revealed = 20` 起步的用例后，破坏即红。**空转的形态高度一致**：
断言写的是对的性质，但用例的起点让那个性质恰好不可能被违反。

**#9 首轮空转（全链打点），已修，并牵出一个真缺陷**

吞掉 m4 而 smoke 照绿——因为 #9 只断言了 UI 流转，没断言打点。补断言时才发现更糟的事：
**m0–m4 与 m5 根本不在同一条时间轴上**。m5 是落笔时在 `App.tsx` 里另起一个
`createMarkupRun()` 打的，于是两条时间轴各自"齐"，合起来一个都不齐——而 DoD 四要的是
六点在**同一条**上。修法：`MarkupHandle` 把本轮的 `run` 交出来，落笔必须用它；
完整判读结果挂到 shell 的 `data-sepia-markup-report` 上供 smoke 断言
（走 DOM 属性而不是 IPC，与启动打点走 stdout 同一个道理：不为测试在桥上加东西）。

这条最能说明反向验证的价值：**它抓到的不是「检查弱」，是「功能错」**。

**复盘补账：`contextScope` 一度是「被搬运」而不是「被读」**

§1.3 申报的是三个配置字段「全部本 stage 真读」。收尾核对时逐个字段查消费点，发现
`contextBudgetTokens`（进组装器预算）与 `sessionPrewarm`（进预热池大小）都真读了，
而 `contextScope` 只是被一路搬运——config → argv → 根节点属性 → `markupConfig()`——
然后**没有任何人拿它改变行为**。读出来存着不叫读。

已补：`nearbyBlocks(doc, range, scope)` 是它行为上的唯一落点。`page`（默认）展开取材链，
`selection` 一块邻近都不取、只发选区。配四条单测 + 两条反向破坏（取消 scope 判断、
把默认值悄悄改成 `selection`），均红。

**这类缺陷 lint 与 typecheck 都抓不到**——字段声明了、类型对了、值也确实流到了 renderer，
唯独没人用它。能抓到它的只有「逐字段问一遍谁在读」这个动作本身。

**最终 `bun run check` 输出**：关闭时回填。当前进度点（条目 0–4 落地时）：

```
lint 0.2s ｜ typecheck 5.5s ｜ deps 1.1s ｜ bridge 0.3s ｜ workspace 0.0s
｜ artifacts 0.1s ｜ patches 0.4s ｜ marks 0.2s ｜ test 1.9s
PASS          # harness-exempt 4 处 ｜ harness-dispute 0 处
```

---

## 1.6 验证（两栏制，沿 130/140）

### 1.6a CC 代验（证据留档，人抽查）
| # | 项 | 方式 | 结果 |
|---|---|---|---|
| a1 | §1.5 全部反向验证 | 逐条预写破坏 | **✓ 全部红**（0–11 共 24 条破坏；3 条首轮空转已修并复跑） |
| a2 | smoke #9/#10/#11 | Playwright `_electron` 真应用 | **✓ 3/3 绿；全量 18/18 绿，无回归** |
| a3 | `check:theme` 绿 + 色板同源证据 | 脚本输出 | **✓ 绿**（`themeVar 20 个 ｜ theme.css 定义 20 个 ｜ 两处高亮同源`），已进 `check` |
| a4 | 真模型一轮全链 | 真 key，打点数字记录 | ✓ **已跑**（2026-08-05，`aliyuntokenplan/qwen3.8-max`，不进 CI）。首轮暴露四个缺陷（§1.9 回流 4），修完复验六条判据全绿：**单发**（`agent=rewrite` 只出现一次；`agent=title` 是引擎给会话取名的 small model 调用，不算 markup 的一发）、**无工具**（part type 仅 `text`/`reasoning`/`step-start`/`step-finish`，无 `tool`）、**直接吐改写正文**（未触及段落逐字节原样）、**m0–m5 六点齐**且 ordered、`withinBudget: true`、**全链 4.3s < 15s**。日志佐证：`agent=rewrite mode=primary`、`directory=<book>`、全程无 `.claude`/`.agents` |
| a5 | 冷启动零增量（§1.2） | 冷启动 smoke + 产物落点 | **✓** t0→t5 523ms（预算 1000）；shiki 111KB、remend 12KB、浮层 11KB **全在惰性 chunk**，入口 507.7→500.6KB（**降了**） |
| a6 | W6/W7 截图 | `evidence/150/*.png` 三阶段 | **✓ 已留档**；三阶段家具、diff 对照、**原地推开下文**均正确（几何断言见 §1.8 风险 4） |

### 1.6b 真人（压到最少）

**走查日期 2026-08-05，口径「dev 真引擎」（非打包产物），六项全部通过。**
走查**不是白跑**——它当场揪出一个 C 类渲染缺陷，见下第一项。

- [x] **W6/W7 走查**：动词列随选中对象变化、打字隐藏、三阶段家具的分寸；对照原型灰阶线框
      —— **不通过 → 已修 → 复验通过**：表格 widget 画出了网格，但单元格内的行内标记没渲染
      （`` `code` `` 露反引号、`**bold**` 露星号）。根因是设计留白而非实现疏忽（§1.9 回流 6），
      已按「复用 A 类装饰管线」修好，smoke ④b 守着，证据 `evidence/150/table-inline.png`
- [x] **讨价还价一轮**：真模型上追问一次、切一次模型重试、Esc 打断一次
- [x] **生成中继续打字**：看着 CAS 中止提示出现，纸面新字未被覆盖（DoD 二的体感面）
- [x] **落笔手感**：⌘Z 一次撤干净，无半截态
- [x] **流式揭示观感**：snap 节奏舒不舒服、结构块有没有闪一下 raw——机器断言只能证
      「没回退」，证不了「舒服」；`prefers-reduced-motion` 也切一次看整块秒显
- [x] 抽查 1.6a 证据包（至少 2 条）

---

## 1.7 实测记录

**本 stage 不做性能实测**（人裁 2026-08-05：跳过性能验证，快速收尾）。七项全部记债，
随下次真模型手跑或 release 一并补——债目见文末「遗留债」。

**DoD 因此按功能达成判定，不含数字**：全链真模型跑通 ✓、CAS 中止生效 ✓、
m0–m5 六点在同一条时间轴上齐 ✓（走查与 a4 装置验的是**行为**：六点齐、顺序单调）。

| 指标 | 预算 | 本 stage 实测 | 参考基线 |
|---|---|---|---|
| ⌘K → 浮层就位 | < 50ms | 未测（人裁 2026-08-05：跳过性能验证，快速收尾） | — |
| 提交 → 首 token | < 3s | 未测（同上） | Stage 3 探针 0.5s（qwen，短 prompt；**整篇默认下会变长，正是打点要看清的**） |
| 首 token → 完整 diff | < 12s | 未测（同上） | Stage 3 全程 7.3s |
| 选中 → 完整 diff（全链） | **< 15s** | 未测（同上） | — |
| 落笔 | < 300ms | 未测（同上） | — |
| 模型切换 | < 100ms | 未测（同上） | — |
| 上下文 token 数（整篇 vs 截断） | 记录 | 未测（同上） | 裁决 2.1 的代价面，进债务面板素材 |

> **顺带观察，不作数**：a4 装置每跑一轮都会把 m0–m5 打印出来，几次的量级在
> 首 token 0.3–5.3s、全链 1.1–5.6s、落笔 0.1–0.4s。**这不是实测口径**——单次、
> 无重复、无静机窗口、只有短文一档，与上表要的 P50/P90 和两档文长不是一回事。
> 记在这里只是为了说明「没测」不等于「一无所知」，正式数字仍以补测为准。

---

## 1.8 风险与未知

| # | 风险 | 先探/边做边探 |
|---|---|---|
| 1 | Streamdown 与本项目气味的契合度（补全策略、样式侵入） | **已探，取降级预案**（2026-08-05，见下）：只用其解析（`remend`），揭示自画 |
| 2 | Shiki 内联色 vs CSS 变量（架构 §4.4 已点名）：双主题输出模式的接线 | **已探，通，且比预案更好**（2026-08-05，见下）：`colorReplacements` 直接吐 `var(--sepia-*)`，双主题接线整个不需要 |

### 风险 1/2 spike 记录（2026-08-05，远早于半天 timebox）

**探法**：`/tmp` 里装真包（streamdown 2.5.0 / remend 1.3.0 / shiki 4.4.2 / @streamdown/code 1.1.1），
SSR 渲染 + 直接跑 API，不进仓库、不动 `dep-graph.json`。

**风险 1 → 降级。** 判据是一条硬事实：**本项目没有 Tailwind**（renderer 只有 `index.css` +
`@sepia/ui/theme.css`，纯 CSS 变量）。而 streamdown 2.5.0 把**全部视觉**放在 Tailwind v4 工具类 +
shadcn token 上——实测 SSR 输出：

```
<div class="space-y-4 whitespace-normal [&>*:first-child]:mt-0 …">
  <h1 class="mt-6 mb-2 font-semibold text-3xl" data-streamdown="heading-1">Title</h1>
```

包里自带的 `styles.css` 只有 499 字节、纯 `@keyframes`，一条排版规则都没有。**没有 Tailwind，
这些类全是死字符串**，渲染出来是无样式的裸文档。要它好看就得把 Tailwind v4 装进 renderer，
再把 `--background`/`--primary`/`--muted` 一整套 shadcn 变量映射到 `--sepia-*`——那是**在
`var(--sepia-*)` 之外引入第二套样式词汇**，与 130 已裁的风格直接打架，也远超 §1.3 申报的
那一行依赖（`streamdown → app`）。附带一条：streamdown 未决 issue #550（streaming 模式下
`useTransition` 被同级紧急更新饿死、markdown 冻在首次解析）撞的正是本 stage 的用法。

**降级后拿到的东西一点没少。** T-14 真正难的那半——补全未闭合语法——是独立包 `remend`
（**零依赖**）干的，streamdown 只是它的消费者。实测：

```
"a `code frag"   → "a `code frag`"
"~~strike"       → "~~strike~~"
"$$E = mc"       → "$$E = mc$$"
"a [link](http"  → "a [link](streamdown:incomplete-link)"   ← 哨兵 URL，我们自己吃掉
```

于是本 stage 的依赖变更从 `streamdown` 改为 `remend`（§1.3 已同步改，属**申报项**）。

**风险 2 → 通，且预案作废（往好的方向）。** 原以为要接「Shiki 双主题输出」再比对两份色板。
实测 `colorReplacements` 允许把占位 hex 换成**任意字符串**，于是可以直接换成 CSS 变量：

```
<span style="color:var(--sepia-syn-keyword)">const</span>
<span style="color:var(--sepia-ink-muted)">// hi</span>
```

**这不是「两处代码同色」，这是两处代码用同一个变量。** 色值仍然只住 `theme.css` 一处，
主题切换由 CSS 变量自己完成——不需要双主题、不需要 `.dark` 选择器、不需要重新高亮。
连带三个后果：

1. `check:theme`（130 债④ / §1.4 条目 8）**从「比对两份生成色值」降级为「比对变量名集合」**——
   断言 Shiki 主题的 `colorReplacements` 值域 ⊆ `@sepia/ui` 的 `themeVar` 名字表。更强也更便宜：
   名字对不上是编译期就该红的事，不必等运行期生成两份 HTML 再 diff。
2. `<pre>` 根节点的 `theme.fg/bg` **不吃 `colorReplacements`**（实测仍吐 `#000010`）——
   所以用 `codeToTokens` 自己渲染 `<pre>`，不用 `codeToHtml`。反正揭示已经自画，顺路的事。
3. 未闭合代码片段（`const x = `、`function f(`、`"unterminated`）`codeToTokens` 不抛异常，
   流式高亮安全。

Shiki 侧用细粒度入口（`shiki/core` + `createHighlighterCore` + `@shikijs/langs/*` +
`shiki/engine/javascript` 的 `createJavaScriptRegexEngine({ forgiving: true })`），
不用主入口——主入口会把全部语言/主题的 chunk 索引拖进来。

### 风险 4 的收尾（2026-08-05，**已达标**）

**做法**：`editor/extensions/markup-host.ts` —— 在选区所在行的行尾插一个**块级 widget**，
装饰来自 StateField（架构 §4.4 结构硬约束①：块级装饰不许来自 ViewPlugin，否则 `RangeError`）。
容器 DOM 由 editor 侧建、app 侧用 React portal 往里挂——CM6 这一侧不认识 React，
也不该认识（`editor ↮ ui`）。浮层于是成了文档流里的一个块，**后文由 CM6 自己排下去**。

**几何证据**（smoke 实测，非目视）：

| 量 | 开浮层前 | 开浮层后 | 结论 |
|---|---|---|---|
| 选区行 top | 75 | 75 | 没被盖住 |
| 后一段 top | 126 | 244 | 被推下去了 |
| 浮层 top/bottom | — | 101 / 218 | 正好落在两者之间 |

**路上踩到两个坑，都是「容器交出去时是空的」的同一个根**：

1. **gutter 与正文错位。** React 是之后才 portal 进内容的，而 CM6 的高度图在插入当下
   就定了——量到 0/16px，于是正文靠 DOM 重排被推开了，行号却还按旧行高排，
   「第三段」旁边没有号、4/5/6/7 散在浮层边上。先试了 `requestMeasure`、再试了空事务，
   都不解决：**CM6 不会回头重量一个它以为已知高度的 widget**。
   最终解法是把高度**实测后回填**——`openMarkupHost` 侧挂 ResizeObserver，量到真实高度
   就再 dispatch 一次 `setMarkupHost`，widget 的 `estimatedHeight` 直接返回这个数，
   且 `eq()` 把高度纳入身份（高度变了才算换了 widget，CM6 这才重建高度图）。
   修复后 gutter 与正文逐行对齐（行号 4→218、5→244、6→269、7→295、8→320，与各行 top 相同）。
2. **gutter 压根不给块级 widget 生成元素。** 得经 `lineNumberWidgetMarker` 提供一个 marker
   才会有那一格；高度不用自己设，CM6 会拿 `block.height` 去设 `.cm-gutterElement`。

**为什么不用 `position: absolute`**：贴到选区行看起来很像，但它盖住的是下一段正文——
恰好是 W6 点名不要的那个。这条差别在截图上一眼看不出来，在几何断言上一目了然。

## 1.9 回流

实施中发现的回流在此累积，关闭时一并裁决。已知候选一条：

| # | 指向 | 问题 | 建议 |
|---|---|---|---|
| 1 | **002 §3** | typecheck 增量化的期限子句「在 Stage 2+3 合并仪式前完成」已失去锚点（仪式经人裁跳过，140 关闭记录） | 改为触发式：check >20s 或 typecheck 冷跑 >10s → 必须做（§1.1 三的裁决） |
| 2 | **架构 §4.3b + §5 纪律 22 行** | markup 延迟打点原文命名 t0–t5，与 §4.7 启动打点同名——两套口径同名，smoke 断言与趋势表必混。markup 侧共两处：§4.3b 条目 1 与纪律 22「markup 全链埋 t0–t5 打点」（§4.7 的 t0–t5 是启动口径，保留不动） | 两处改为 **m0–m5**（本 stage 已就地采用，§1.2） |
| 3 | **120 §1.3 / 110 §1.4 注①** | 当年预言「Stage 4 增独立区间写 **IPC 通道**」。实际形态：**editor 层类型化落笔函数**（CAS 对照编辑器现值、transaction 内原子完成），写盘走既有全文保存管线，preload 保持八项零增长——CAS 对着编辑器状态校验比对着磁盘更对（TOCTOU 窗口更小），且暴露面不增 | 非静默改道，特此对账：120 §1.3 三条件的②③按此形态重述（「markup 在类型上够不到全文写」→「markup 产生正文变更的唯一途径是类型化落笔函数」）；bridge 不变量子条维持八项清单不变 |
| 4 | **002 §4（mock smoke 的覆盖边界）** | a4 真模型全链实测暴露**四**个缺陷，mock smoke 全部抓不到：① markup 未指定 agent，引擎落到默认 build agent（完整 coding persona + 技能表 + agentic loop）；② 预热 session 绑死在 `~/.sepia`，⌘K 整轮跑错目录；③ 引擎隔离只挡了走 `$HOME` 的路，skill/工程配置的**向上扫描**（非 git 目录 worktree=`/`）读到了真实 `~/.claude`、`~/.agents`；④ **`stream` 没带 directory**——`/event` 是实例级的，缺 directory 就回落到 `process.cwd()`（vendor `workspace-routing.ts:87`），于是流订在 cwd 实例、session 活在 book 实例，renderer 整轮**只收得到 `server.heartbeat`**，浮层永远停在 generating。共因：markup smoke 的桩打在 ipcMain handler 上——**桩以下（bridge 协议、引擎侧 agent 解析、session↔directory 绑定、路径隔离）mock 天然测不到**；④ 尤其刺眼，桩自己往 renderer 推事件，等于把「事件到底来不来」这件事整个假设掉了 | 边界成文：桩下行为一律要有**桩下测试**——bridge 单测管协议字段（agent/directory 已补，含 `/event` 的 directory）、隔离 smoke 以真引擎 + 探针管非 XDG 逃逸（#9 判据四已补）、agent 约束与全链手感只能真引擎手跑（1.6a a4 复验清单）。此后凡在桩下加行为，先问「哪条桩下测试看得见它」 |
| 5 | **架构 §5 纪律 10** | 纪律 10 只把「每请求显式带 directory」类型化到了 send/openThread/interrupt，**漏了 stream**——而五方法里恰恰只有它翻了车（回流 4 之④）。漏的原因是它的注释把 `/event` 当成了全局 firehose，实际是**实例级**的 | 纪律 10 的措辞由「每请求」收紧为「**五方法每一个**都在类型上带 `BookDirectory`」；`StreamOptions.directory` 已按此补齐（本 stage 落地）。改纪律文本的那次提交要同时看一眼 `check-discipline.mjs` 是否需要跟着长出对应检查 |
| 6 | **架构 §4.4（C 类那行）** | 150 当初只写「块 widget 机制建一次四种复用」，**没界定 widget 内部的行内文本归谁渲染**——于是表格解析那 40 行自写只拼了网格，单元格内容当 raw 文本，走查看见「网格画出来了，`` `code` `` 露反引号、`**bold**` 露星号」。这不是实现疏忽，是设计留白：没人说过 widget 里边该由谁管 | 补一条并已落地：**C 类 widget 内部的行内文本一律复用 A 类装饰管线，不自写第二套**（架构 §4.4 C 类行加注 + D 类段后补两条边界）。实现形态：`buildDecorations` 逐字复用，产出的 DecorationSet 物化成脱离 CM6 的 DOM；注入走 Facet（`inlineRenderer`，与 `assetBase` 同套路）——直接 import 会 `decorate ↔ inline-dom` 成环，被结构 2 挡下。边界「不递归块级」交给解析器执行：把单元格文本放回**合成表格行**里解析，GFM 本就规定单元格内只有行内。smoke ④b 守着（破坏两条预案均实证必红），证据 `evidence/150/table-inline.png` |
| 7 | **150 §1.6a a4 的判据措辞** | a4 的「无工具」判据一度想写成「日志里没有 `shell tool` / `ripgrep` 字样」。**实测证明这是误判**：一次完全合格的跑（`agent=rewrite`、零工具、单发）日志里照样有 `shell tool using shell` 与 `downloading ripgrep` 各一条——那是引擎起来时的**工具注册与二进制预置**，跟这一发用没用工具无关。拿它当判据必然误伤 | 三禁按**可证伪的信号**重写并已落地在 `test/manual/`：① `agent=rewrite` 恰好一次且无 `agent=build`；② 无 `loop … step=N`（N>1，单发只到 step=1）；③ **事件流里没有 `type=tool` 的 part**——③ 才是「工具全 deny 生效了没」的直接证据。「无 downloading」同样不可用，理由同上 |
| 8 | **架构 §4.3b（markup 事件消费）** | 引擎会把**用户自己那条消息原样回播**（`message.part.updated`, `type=text`），而 §4.3b 只说了「消费流式事件」，没说回声该怎么办。代价在 a4 上真发生了：模型一个字没答上来时（凭据解不开），回声成了"结果"，diff 里显示整段 prompt，**落笔把 prompt 写进了正文**（实测文件里出现「【要改写的原文】…【要求】…」）。桩此前只推助手文本、从不回声，把这件事整个假设掉了——又一例「桩以下」 | 已修并补两道闸（回流 4 的同科）：① 文本与发出去的那条逐字相同 → 判回声；② 助手消息由 `step-start` 开场，记其 messageID，此后只认这条消息的文本。另加一条更根上的：**一个字都没收到就不判 done 而判 failed**——result 阶段才有落笔按钮，空结果进不了 result，也就写不进正文。桩已按真引擎改成「先回声、助手以 step-start 开场」，smoke #9b 守着（两条破坏均实证必红） |
| 9 | **150 §1.4 / 引擎侧 agent 注入** | 每轮 markup 除了 `agent=rewrite` 那一发，引擎还会**多发一次 `agent=title`**（small model，给会话取标题）。它不影响正确性，但是一次白花的模型调用与一份额外时延，且 MVP 根本不显示会话标题 | 记债不修（本 stage 已收尾）：查引擎有无关掉自动取标题的开关（配置里若有 `autoTitle`/`title` 一类，注入 `OPENCODE_CONFIG_CONTENT` 即可），确认后随下个 stage 一并关掉。a4 装置的判据已按「rewrite 恰好一次」写，不会被这次调用误伤 |


---

## Stage 4 关闭（2026-08-05）

**DoD 四条判定，全部按功能达成**（人裁 2026-08-05：跳过性能验证，快速收尾——
所以判的是"这件事成不成立"，不是"多少毫秒"）：

| DoD | 判定 | 据什么 |
|---|---|---|
| 选区 → 完整 diff（<15s） | **功能达成**（数字未测，记债） | a4 真引擎全链跑通：真 key 真模型，⌘K → 动词 → 流式 → diff → 落笔，改写落进正文且未触及段落逐字节原样 |
| 生成期间编辑正文 → 落笔中止而非覆盖 | **达成** | smoke #10（CAS 快照不匹配即中止）+ 1.6b「生成中继续打字」人工走查 |
| 落笔是单独 undo 单元 | **达成** | §1.4 #4 单测（单 transaction、undo 隔离）+ 1.6b「落笔手感」人工走查（⌘Z 一次撤干净） |
| 全链打点六点齐 | **达成** | m0–m5 齐、顺序单调、在同一条时间轴上——smoke #9 与 a4 装置都断言了**行为**（不含预算数字） |

**人工走查**：1.6b 六项于 2026-08-05 全部通过（口径 dev 真引擎）。走查当场揪出一个 C 类
渲染缺陷（表格 widget 单元格不渲染行内标记），已修 + 架构回填 + smoke ④b 守着。

**收尾轮暴露并修掉的四个缺陷**（全部来自**真引擎**，mock 一个都抓不到——共因见 §1.9 回流 4）：

| # | 缺陷 | 修法 | 守卫 |
|---|---|---|---|
| A | markup 落到引擎默认的 **build agent**（完整 coding persona + 技能表 + agentic loop），且 `directory` 传成了 dev cwd | 任务注册表注入引擎侧受限 agent（`permission: '*': deny` + `default_agent`）；send 显式带 `agent`；预热 session 绑 book 目录；引擎 cwd 进隔离根 | §1.5 #13 + a4 装置（`agent=rewrite`、无工具、单发） |
| B | 引擎隔离**只挡了走 `$HOME`/XDG 的路**，skill/工程配置的向上扫描读到了真实 `~/.claude`、`~/.agents` | fork env 增 `OPENCODE_DISABLE_{EXTERNAL_SKILLS,CLAUDE_CODE,PROJECT_CONFIG}` 三开关 | §1.5 #15（Stage 3 smoke #9 补判据四，探针实证必红）；**140 关闭记录已据实补注**——那条「隔离与零落盘」当时验的是个假的 |
| C | 浮层定位 / **表格 widget 单元格不渲染行内标记**；另含 `/event` 未带 directory（流订在 cwd 实例，整轮只收得到心跳） | 单元格复用 A 类装饰管线（不自写第二套）；`StreamOptions.directory` 类型化必填 + 订流等连上再 send | §1.5 #14、#16（各自破坏均实证必红） |
| D | 引擎**回播用户自己那条消息**，模型没答上来时回声成了"结果"，**落笔把 prompt 写进正文** | 两道回声闸（逐字相同 / 只认 step-start 那条消息）+ 空结果判 `failed` 而非 `done`（result 阶段才有落笔按钮） | §1.5 #17（**首轮空转，已改到有效**，计入 `dead_checks`） |

**a4 手跑装置已固化**：`test/manual/a4-real-engine.spec.ts`（+ 同目录 README 与专用
playwright 配置）。不进 CI 靠的是**机制**——根配置的 `testDir` 是 `test/smoke`，够不到它。
凭据走架构 §4.1 的一次性导入，密钥只在内存，仓库零落盘。

**最终 `bun run check`**：见文末命令记录，最后一行 `PASS`（exempt 4 ｜ dispute 0）。
smoke 全绿（20 条）。

### 遗留债（下一 stage §1.1 逐条重问）

| # | 债 | 何时还 |
|---|---|---|
| 1 | **markup 全链性能实测**（本轮人裁跳过）：m0–m5 六点、短文 / 2 万字两档 TTFT、§1.7 七项数字 | 随下次真模型手跑或 release 一并补。装置已现成（`test/manual/`），补的是**口径**：多次取 P50/P90、静机窗口、两档文长 |
| 2 | **typecheck 增量化**（第三次延后，触发式未触发） | 触发条件已写死：`check` >20s 或 typecheck 冷跑 >10s。本 stage 收尾实测仍在秒级，未触发 |
| 3 | **冷启动基线重立**（140 债④ 继承） | 静机窗口出现时跑 `SEPIA_PERF_ASSERT=1` 校准。与债 1 同批做最省事 |
| 4 | **`.dmg` 打包产物重验**（140 债⑤ / 130 债③ 继承） | 随下次 release。注意本 stage 起 `test/manual/` 的装置只验 dev 形态，打包形态未覆盖 |
| 5 | **`agent=title` 冗余调用**：每轮 markup 白搭一次 small model 调用给会话取标题，MVP 根本不显示标题 | 查引擎有无关掉自动取标题的开关，确认后注入配置关掉（§1.9 回流 9） |
| 6 | **130 债① 列表/表格视觉打磨** | 继续挂账或攒视觉专项。注意本 stage 只修了单元格的**行内渲染**，没动表格视觉 |
