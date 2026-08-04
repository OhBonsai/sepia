import { defineConfig } from '@playwright/test'

// smoke 要起真应用，所以按 002 §3 只进 CI，不进 `bun run check`。
// 001 §6 的测试表已定：Stage 0 用自启动开关脚本，**Stage 1 起换 Playwright `_electron`**。

export default defineConfig({
  testDir: 'test/smoke',
  // 冷启动是被测对象本身，重试会掩盖 flaky——宁可红，也不要一个"重试三次总有一次达标"的绿。
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
})
