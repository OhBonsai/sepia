# Sepia

一张会越用越懂你的纸：单人、本地、git 打底的 markdown 笔记本，opencode 当 Agent 嵌进纸里。
一本 **book**（= 文件夹 = git repo）由许多 **page**（= 一个 .md）组成。

结构与纪律的真相在 [`specs/design/sepia-architecture.md`](specs/design/sepia-architecture.md)。本文件不复述它，只导航。

## 动手前必读（按序，别全读）

1. `specs/design/sepia-architecture.md` §1 约束 · §5 实现纪律 ← 每次都读
2. `specs/plan/001_boot.md` §2 依赖方向 ← 碰结构时读
3. `specs/plan/001_boot.md` §7 当前 stage 的验收 ← 每次都读
4. `specs/plan/002_boot_harness.md` ← 检查挡路时读

想知道**为什么**：产品决策看 `sepia-mvp-decisions.md`（D-xx），技术论证看 `sepia-tech-rationale.md`（T-xx）。

## 五条不可协商（违反即回退，不要商量）

1. 纸永远可写，Agent 可以缺席
2. 未触及的字节逐字节保留
3. AI 不抢笔：写入正文必经用户落笔
4. Agent 没有写权限
5. 只发明徽章与思维链，其余映射到 opencode / git 既有机制

## 依赖方向（由包边界 + `check:deps` 强制）

```
core ──→ editor ─┐
  └───→ agent ───┼──→ app
        ui ──────┘
```

三条刻意不连线：`editor ↮ ui`、`editor ↮ agent`、`ui ↮ core`。
机器可读的那份图在 `scripts/dep-graph.json` —— **图变了就改它**，改它就会被 diff 看见。

- `core` 叶子，外部依赖趋近于零；`ui` 叶子，不知道领域；`app` 是根，唯一 import electron 的包
- 通用能力不许留在 `app`：不依赖 Electron 又能独立测的逻辑一律下沉

## 常见违规对照

| ❌ | ✅ | 谁抓 |
|---|---|---|
| `import { app } from 'electron'`（core/editor/agent/ui） | 能力上提到 `app` 装配 | 结构 3 · lint |
| `import { api } from '../preload'` | `import { api } from '@/services/api'` | 纪律 1 · lint |
| `color: '#fff'` | `color: 'var(--ink)'` | 纪律 3 · lint |
| `console.log(process.env)` | 只取用到的单个 key，不打印值 | 纪律 18 · lint |
| preload 里悄悄多一个 key | 同步改 `scripts/bridge-snapshot.json` | 纪律 2 · check:bridge |
| `package.json` 里多一条包依赖 | 先改 `scripts/dep-graph.json` | 结构 2 · check:deps |
| `registerCommand({ title: '加粗' })` | `registerCommand({ title: copy.cmd.bold })` | 纪律 5（Stage 1 起类型化） |
| `fs.writeFile(jsonPath, ...)` | `atomicWrite(jsonPath, ...)` | 纪律 8（Stage 1 起） |
| `send(threadId, parts)` | `send(threadId, parts, { directory })` | 纪律 10（Stage 3 起类型化） |

## 完成前必须

```
bun run check:fast   # 每次改动。lint + typecheck，秒级，必须绿
bun run check        # stage 收尾。全量，最后一行必须是 PASS
```

跨包重构的**中间态允许 `check` 红**，但必须在 stage 结束前归零。不给这个空间，大改就永远做不成。

`check` 的七步：`lint`（纪律文本规则 + oxlint）→ `typecheck` → `check:deps` → `check:bridge`
→ `check:workspace` → `check:marks` → `test`。失败时最后一行长这样，照着编号去读纪律：

```
FAIL: 纪律 3（组件与 CM6 扩展不得出现字面色值）— packages/app/src/renderer/shell/App.tsx:2
```

## 卡住协议

连续两次都无法在不违反纪律的前提下完成 → **停下，不要第三次。**

报告四件事：想做什么 / 撞到哪条纪律 / 两次分别试了什么 /
判断是**纪律错了**（用 `harness-dispute`）还是**实现方式错了**。

这防止两种浪费：在死胡同里烧 token，以及最终选一个破坏性方案交差。

## 三种记号，别用混

```
// harness-exempt: <号> <理由>    纪律对、此处是合法例外 —— 可自行处置，计入豁免总数
// harness-dispute: <号> <论据>   认为纪律本身有问题 —— 不得自行处置，停下报告等人裁决
SEPIA_HARNESS_BYPASS=1            临时跳过全部检查跑通别的 —— 大字警告 + 留痕，CI 恒忽略
```

**第二种是关键。** 最容易犯的错是把「我觉得这条纪律不对」当第一种处理——打个豁免继续走，
架构就被悄悄改了，而且改得毫无痕迹。`check:marks` 会让 dispute 变红，逼它升级到人。

发现检查有 bug 时，**先问这条纪律还成不成立**——很多「误报」其实是纪律没想清楚的信号。
改纪律的那次提交，必须同时改对应的检查。

## 汇报格式（每次改动后）

- 改了哪些文件
- `check` 的最后一行
- **是否新增了对外暴露面**（preload 白名单 / 包依赖 / 配置字段）—— 这三样是架构侵蚀最常见的入口，
  单看每一次都「只是加一个」，所以必须主动申报
- 是否有 spec 需要同步更新

## specs/ 目录分工

| 目录 | 职责 | 里面放什么 |
|---|---|---|
| `specs/design/` | 决定做什么、为什么 | happy path、non-goals、决策记录 D-xx、技术架构与论证 T-xx |
| `specs/plan/` | 决定怎么干、干到哪了 | 实施计划、stage 拆解、进度 |
| `specs/mind/` | 脑子蹦出来的 draft | 未定型的畅想，**不许直接变代码** |
| `specs/research/` | 外部知识 | 调研、竞品、技术实证 |

流向：`mind → design → plan → 代码`。逆行（代码里冒出的新想法）先回 mind 报到。
交互原型一律放 `prototype/`，不要在 `specs/` 下另建 prototypes 目录。

## 术语

- 一律叫 **Agent**（「智力器」「智能体」已废止；专名 AgentBridge / Agent Client Protocol 保持原样）
- 笔记库叫 **book**、单篇叫 **page**（**vault 一词废止**）。注意「库」在「音效库/素材库/编码库」等
  library 语义下照常使用，不要误替
- 视觉风格（圆角、配色、字体）待线框走查后单独定；原文里「不要圆角/构成主义」是情绪参考不是规则
