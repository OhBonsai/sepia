# test/manual —— 手跑装置（**不进 CI**）

001 §6 定死：真 key 真模型不进 CI。这里放的就是那一类——需要真凭据、真网络、真模型的
验证装置。`playwright.config.ts` 的 `testDir` 指向 `test/smoke`，够不到这个目录；
要跑得显式指配置：

```bash
bun run build                      # 装置跑的是构建产物，改了代码要先构建
bunx playwright test --config test/manual/playwright.config.ts
```

## a4-real-engine.spec.ts

Stage 4 §1.6a a4 的常驻复验装置（2026-08-05 人裁固化）。一句话职责：
**证明 markup 那一发只唤起受限的改写 agent，没有变成一个会翻文件的 coding agent。**

它盯的是四个只有真引擎才看得见的东西——mock smoke 的桩打在 ipcMain handler 上，
桩以下（bridge 协议、引擎侧 agent 解析、session↔directory 绑定、路径隔离）天然测不到：

| 判据 | 怎么判 |
|---|---|
| 只唤起改写 agent | 引擎日志里 `agent=rewrite` 恰好一次，且**没有** `agent=build` |
| 不进 agentic loop | 没有 `loop … step=N`（N > 1）——单发只会走到 step=1 |
| 没动工具 | 事件流里没有 `type=tool` 的 part |
| 隔离没破 | 日志全程不出现 `.claude` / `.agents`；session 的 `directory=` 是 book 目录 |

**凭据从 `~/.sepia` 读，一个字节都不进仓库**：把用户真实的 `credentials.json`（safeStorage
密文）与 `config.json`（provider 定义）复制进临时 HOME，模型名在临时 config 里指定。
机器上没有 `~/.sepia/credentials.json` 就**跳过**（不是失败）——没凭据是环境缺条件，不是缺陷。

**不断言时延**：性能实测是另一件事（150 §1.7 记债，人裁 2026-08-05 跳过）。
本装置照常把 m0–m5 打印出来，判定只看功能。
