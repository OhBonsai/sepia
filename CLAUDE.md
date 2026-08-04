# Sepia

一张会越用越懂你的纸：单人、本地、git 打底的 markdown 笔记本，opencode 当 Agent 嵌进纸里。一本 **book**（= 文件夹 = git repo）由许多 **page**（= 一个 .md）组成（D-38）。

## specs/ 目录分工

| 目录 | 职责 | 里面放什么 |
|---|---|---|
| `specs/design/` | **设计**——决定做什么、为什么 | happy path（MVP 真理源）、non-goals 反清单、决策记录（D-xx）、已立项功能设计（feature-*） |
| `specs/plan/` | **执行**——决定怎么干、干到哪了 | 实施计划、stage 拆解、todo、进度 |
| `specs/mind/` | **想法**——脑子蹦出来的 draft | 未定型的畅想（draft-*）。合适了升级成 plan/design，不合适就烂在这里，不许直接变代码 |
| `specs/research/` | **研究**——外部知识 | 调研笔记、竞品分析、技术实证材料 |

流向：`mind → design → plan → 代码`。逆行（代码里冒出的新想法）先回 mind 报到。

**原型不在 specs/ 里。** 交互原型一律放 `prototype/`：
- `prototype/PROMPT.md` —— 喂给 design 的提示词，按增量修订 v2 / v3 … 累加，不删旧段
- `prototype/proto-<YYMMDDHHmm>.html` —— 每次导出的原型快照，时间戳用导出时刻（JST）
- 只保留最近若干份，旧的自行清理；**不要在 specs/ 下另建 prototypes 目录**

## 当前必读（按序）

1. `specs/design/sepia-mvp-happy-path.md` — MVP 真理源：14 分镜、双 Aha（白纸秒开 <1s > markup 落笔 <15s）、W1~W12 画面清单、验收清单
2. `specs/design/sepia-mvp-non-goals.md` — 不做什么。写代码前对照，命中即 stop
3. `specs/design/sepia-mvp-decisions.md` — 决策记录 D-01~D-40，改需求先改它
4. `specs/design/sepia-tech-architecture.md` — 技术架构方案（T-01~T-19）。**技术决策用 T-xx，与产品 D-xx 分开**；技术文档若修订了产品决策，回到 D 条目加修订指针（现有：D-04→T-01、D-13→T-19、D-22→T-02）
5. `specs/mind/draft-001-embedded-agent-loop.md` — 畅想，不排期

## 铁律

- **纸永远可写，Agent 可以缺席**（D-23）
- **文件即真相**：纯 .md + 标准围栏，永不改写用户字节（A2）
- **AI 不抢笔**：只在 ⌘K 被召唤时说话，写入正文必经用户落笔
- **样式待定**：视觉风格（圆角、配色、字体）在线框走查完成后单独定，线框阶段只判断信息结构与交互；原文里「不要圆角/构成主义」是情绪参考不是规则（D-33）
- **术语**：①一律叫 **Agent**（D-31，「智力器」「智能体」已废止；专名 AgentBridge / Agent Client Protocol 保持原样）；②笔记库叫 **book**、单篇叫 **page**（D-38，**vault 一词废止**）。注意「库」在「音效库/素材库/编码库」等 library 语义下照常使用，不要误替
- Sepia 只发明两样东西：**徽章**和**思维链**，其余概念一律映射到 opencode / git 既有机制（D-14）

## 流程约定

产品细节 → 交互原型（`prototype/`，可点击灰阶 HTML 线框）→ 技术架构（**已完成**，见 `specs/design/sepia-tech-architecture.md`）→ ultra spec（下一步，进 `specs/plan/`）→ 实施。不跳步。

范围分层：**MVP/产品文档只谈功能与使用习惯**；技术/运维决策（多平台构建走 GitHub Actions、CI、发布、测试策略等）在技术架构阶段的文档里定。
