// `@sepia/agent/tasks` —— **纯任务层子入口：不碰 SDK、不碰网络。**
//
// 存在的理由是一次真实的构建失败（Stage 4）：renderer 的浮层要用上下文组装器与动词表，
// 顺手从包主入口 import，于是 `bridge.ts` 连着 `@opencode-ai/sdk` 一起被拖进 renderer bundle，
// 而 SDK 里有 `node:child_process`——rollup 当场报 `"spawnSync" is not exported by
// "__vite-browser-external"`。**typecheck 是绿的，build 才红**：类型不关心谁被打进哪个 bundle。
//
// 这正是纪律 12 要挡的东西（Stage 3 实测：SDK 值导入让 t0→t3 从 316ms 涨到 1089ms），
// 也是 `@sepia/editor/markdown` 用过的同一招——**重的那层单开子入口，主入口保持轻**。

export * from './prompts.ts'
export * from './registry.ts'
export * from './context.ts'
export * from './verbs.ts'
