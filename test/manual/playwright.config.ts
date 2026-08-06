import { defineConfig } from '@playwright/test'

// 手跑装置专用配置。**根 `playwright.config.ts` 的 testDir 是 `test/smoke`，够不到这里**——
// 这正是「不进 CI」（001 §6）在机制上的落实，而不是靠自觉不跑。
export default defineConfig({
  testDir: '.',
  retries: 0,
  workers: 1,
  // 真模型一轮全链，给足余量（本装置不断言时延，见 README）
  timeout: 180_000,
  reporter: [['list']],
})
