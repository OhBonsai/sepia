#!/usr/bin/env bun
// AI 与 CI 共用的唯一入口（002 §3）。三条硬要求：
//   1. 快 —— 目标 30 秒内，慢了就没人在提交前跑
//   2. 输出可判定 —— 最后一行只会是 `PASS` 或 `FAIL: …`
//   3. 失败指向纪律编号 —— 而不只是报错行
//
//   bun run check:fast   类型 + lint，秒级。每次改动跑，必须绿
//   bun run check        全量。stage 边界跑，必须 PASS
//
// 中间态允许 `check` 红（跨包重构做到一半是常态），但必须在 stage 结束前归零。
// 不给这个空间，大改就永远做不成（002 §5.4）。

import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT } from './lib/harness.mjs'

const FAST = process.argv.includes('--fast')
const IN_CI = Boolean(process.env['CI'])
const BYPASS_LOG = '.harness-bypass.log'

// ── 记号三：SEPIA_HARNESS_BYPASS ─────────────────────────────────────────────
// 不堵死是有意的：堵死会让人去改检查脚本本身，那比临时绕过糟得多——
// 脚本被改坏是永久的，绕过是一次性的（002 §5.2）。但它必须留痕，且 CI 恒忽略。
const bypass = process.env['SEPIA_HARNESS_BYPASS']
if (bypass) {
  if (IN_CI) {
    process.stdout.write('注意：检测到 SEPIA_HARNESS_BYPASS，但 CI 恒忽略该变量，照常全量检查。\n\n')
  } else {
    const stamp = new Date().toISOString()
    const mode = FAST ? 'check:fast' : 'check'
    appendFileSync(join(ROOT, BYPASS_LOG), `${stamp}\t${mode}\tSEPIA_HARNESS_BYPASS=${bypass}\n`)
    process.stdout.write(
      [
        '',
        '  ██  SEPIA_HARNESS_BYPASS 已启用：本次跳过全部检查  ██',
        '',
        `  已记录到 ${BYPASS_LOG}。这只用于本地探索——CI 恒忽略此变量，`,
        '  所以绕过的东西一定会在 CI 上原样撞回来。',
        '',
        `BYPASS: 已跳过全部检查（记录于 ${BYPASS_LOG}）`,
        '',
      ].join('\n'),
    )
    process.exit(0)
  }
}

// 顺序即 002 §3：lint → typecheck → check:deps → check:bridge → check:workspace → test。
// marks 插在 test 之前：它统计豁免、并把 harness-dispute 变成一次必须升级到人的事件。
const STEPS = [
  { id: 'lint', fast: true, cmd: ['bun', 'run', '--silent', 'lint'], label: '纪律 lint' },
  { id: 'typecheck', fast: true, cmd: ['bun', 'run', '--silent', 'typecheck'], label: '类型' },
  { id: 'deps', fast: false, cmd: ['bun', 'scripts/check-deps.mjs'], label: '依赖图' },
  { id: 'bridge', fast: false, cmd: ['bun', 'scripts/check-bridge.mjs'], label: 'preload 白名单' },
  { id: 'workspace', fast: false, cmd: ['bun', 'scripts/check-workspace.mjs'], label: 'workspace 边界' },
  { id: 'theme', fast: false, cmd: ['bun', 'scripts/check-theme.mjs'], label: '色板同源' },
  { id: 'artifacts', fast: false, cmd: ['bun', 'scripts/check-artifacts.mjs'], label: '引擎产物' },
  { id: 'patches', fast: false, cmd: ['bun', 'scripts/check-patches.mjs'], label: 'patch 可复现' },
  { id: 'marks', fast: false, cmd: ['bun', 'scripts/check-marks.mjs'], label: '豁免记号' },
  { id: 'test', fast: false, cmd: ['bun', 'run', '--silent', 'test'], label: '单测' },
]

const steps = FAST ? STEPS.filter((step) => step.fast) : STEPS
process.stdout.write(`${FAST ? 'check:fast' : 'check'} —— ${steps.length} 步\n\n`)

let failure = null
const timings = []

for (const step of steps) {
  const started = Date.now()
  const [command, ...args] = step.cmd
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const ok = result.status === 0

  process.stdout.write(`▸ ${step.id.padEnd(10)} ${step.label.padEnd(16)} ${ok ? '✓' : '✗'} ${seconds}s\n`)
  const body = combined.trimEnd()
  if (
    body &&
    (!ok ||
      step.id === 'deps' ||
      step.id === 'bridge' ||
      step.id === 'workspace' ||
      step.id === 'artifacts' ||
      step.id === 'patches' ||
      step.id === 'marks')
  ) {
    process.stdout.write(`${body}\n`)
  }
  timings.push(`${step.id} ${seconds}s`)

  if (!ok) {
    const reported = combined
      .split('\n')
      .toReversed()
      .find((line) => line.startsWith('FAIL: '))
    failure = reported ?? `FAIL: ${step.label}（${step.id}）— 见上方输出，退出码 ${result.status}`
    break
  }
}

process.stdout.write(`\n${timings.join(' ｜ ')}\n`)
if (failure) {
  process.stdout.write(`${failure}\n`)
  process.exit(1)
}
process.stdout.write('PASS\n')
