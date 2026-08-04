#!/usr/bin/env bun
// check:patches —— patch 必须可复现、可审计（140 §1.4 #4，架构 §4.1 原则二）。
//
// 守三件事：
//   1. submodule 在锁定 commit 上（HEAD 漂移 = 有人升了 tag 或在里面动了提交——刹车表）
//   2. 每个 patch 都 `git apply --check` 得上（已应用的按 --reverse --check 认定），硬失败不静默
//   3. 零 patch 时 vendor 工作树必须干净——「绝不在 submodule 里直接改」的机器化
//
// 首版零 patch 也要有这条检查：它守的是路，不是当下的货（140 §1.1 问题三）。

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { exists, Report, ROOT } from './lib/harness.mjs'

const report = new Report('patches')
const VENDOR = join(ROOT, 'vendor/opencode')

function git(args, cwd = VENDOR) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' })
}

if (!exists('vendor/opencode/package.json')) {
  report.add('patch 可复现', 'submodule 必须就位', 'vendor/opencode', '先跑 `git submodule update --init`')
  report.finish('patches —— patch 可复现')
  process.exit(process.exitCode ?? 0)
}

// ── 1. submodule 在锁定 commit 上 ───────────────────────────────────────────
const status = git(['submodule', 'status', 'vendor/opencode'], ROOT).stdout
if (status.startsWith('+')) {
  report.add(
    'patch 可复现',
    'submodule HEAD 必须等于锁定 commit',
    'vendor/opencode',
    '检出的 commit 与 gitlink 不一致——升 tag 是独立事件且 patch 必重验（140 §1.2 刹车表）',
  )
}

// ── 2. 每个 patch 都应用得上 ────────────────────────────────────────────────
const patches = exists('patches')
  ? readdirSync(join(ROOT, 'patches'))
      .filter((name) => name.endsWith('.patch'))
      .toSorted()
  : []

for (const name of patches) {
  const file = join(ROOT, 'patches', name)
  if (git(['apply', '--reverse', '--check', file]).status === 0) continue // 已应用
  const check = git(['apply', '--check', file])
  if (check.status !== 0) {
    report.add(
      'patch 可复现',
      'git apply --check 硬失败不静默',
      `patches/${name}`,
      check.stderr.trim().split('\n')[0] ?? 'apply --check 失败',
    )
  }
}

// ── 3. 零 patch 时工作树必须干净 ────────────────────────────────────────────
if (patches.length === 0) {
  const dirty = git(['status', '--porcelain'])
    .stdout.trim()
    .split('\n')
    .filter((line) => line && !line.startsWith('??'))
  for (const line of dirty) {
    report.add(
      'patch 可复现',
      '绝不在 submodule 里直接改（架构 §4.1 原则二）',
      `vendor/opencode/${line.slice(3)}`,
      '偏离上游走 patches/ 或配置层，不许直接改工作树',
    )
  }
}

report.note(`patch ${patches.length} 个 ｜ submodule ${status.trim().split(' ')[0]?.slice(0, 9) ?? '?'}`)
report.finish('patches —— patch 可复现、submodule 未漂移')
