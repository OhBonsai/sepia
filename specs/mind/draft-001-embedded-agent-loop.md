# DRAFT-001 · 嵌入式 Agent Loop（畅想，非 MVP）

> **状态：DRAFT / 畅想**。以 issue 形式记录，不进 MVP，不排期。
> 触发条件见文末——在那之前，本文档只增补想法，不产生任何工程动作。

## 背景

MVP 架构（D-03 / D-04）：Electron 壳 + `opencode serve` sidecar，Sepia 是 opencode 的 HTTP 客户端。这个架构的代价：

- 包体：Electron 基底 + 依赖外部安装的 opencode，安装体验是"装两个东西"
- 双进程：sidecar 生命周期管理（spawn、健康检查、崩溃恢复）
- 能力过剩：opencode 带完整 provider 层（75+ 家）、TUI、code-agent 工具集，Sepia 只用其中一小片

## 畅想

**把 agent loop 作为 Sepia 代码的一部分，而不是 sidecar。**

- 不需要 provider 抽象层——直连一家 API（或云端跑一个 opencode，见变体 B）
- 需要保留的能力：**mcp / skill / tool / workspace / session / plugin**
- 壳换 **Tauri**（Rust 基底），安装包压到 **5–10MB**
- 不考虑 API 成本，考虑的是架构的干净：单进程、单安装包、启动即就绪（Aha #1 的极限形态）

## 两个变体

**变体 A · 内嵌 loop**：Rust/TS 实现最小 agent loop（LLM 调用 + tool dispatch + session 持久化 + mcp client + skill 加载）。彻底无 sidecar。

**变体 B · 云端 opencode**：`opencode serve` 跑在自己的服务器上（它原生支持 `--hostname` + `OPENCODE_SERVER_PASSWORD`），本地 Sepia 只是瘦客户端。**这个变体 MVP 架构免费送**——AgentBridge 指向远程 URL 即可，一行编辑器代码不改。

## 为什么现在不做

1. MVP 的目标是验证 markup/徽章/思维链这套交互，agent 引擎是不是 sidecar 与验证无关
2. 自实现 loop 要重造：session 持久化、tool 沙箱、mcp 协议客户端、skill 规范、权限层——每一个都是 opencode 已经踩平的坑
3. D-15 的 AgentBridge 就是为这一天准备的：**5 个方法（openThread / send / stream / interrupt / listModels）之下随便换引擎，编辑器无感**

## 需要解决的问题（认真做之前的功课清单）

- [ ] 最小 loop 的 session 持久化格式（对齐 `.sepia/` 的文件哲学？）
- [ ] tool 沙箱：闭手/开手模型（D-13）在自实现里如何强制
- [ ] mcp client：Rust 生态成熟度调研（rmcp 等）
- [ ] skill 加载规范：兼容 opencode/Claude 的 SKILL.md 还是自定义
- [ ] Tauri 下 WebGL shader 块、CM6 性能与 Electron 的差异实测
- [ ] pinpin 的 Tauri 实证材料回收：`pinpin/docs/research/tauri-vs-electron-2026.md`、`electron-process-perf-deepdive.md`

## 触发条件（满足任一才升级为正式 spec）

1. MVP 跑通且交互稳定，sidecar 的运维痛感真实出现（崩溃恢复、版本兼容）
2. 要把 Sepia 分发给作者以外的用户（安装体验变成产品问题）
3. opencode 上游变动导致 AgentBridge 维护成本超过自实现 loop 的估算

## 关联

- D-03（Electron）/ D-04（opencode serve）/ D-15（AgentBridge 收窄）——本畅想不推翻任何已有决策，只是给 AgentBridge 的第二个实现预留思考
- 变体 B 与 D-16（锁单 vault）兼容：远程 serve 的 cwd 即 vault
