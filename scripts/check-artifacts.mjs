#!/usr/bin/env bun
// check:artifacts —— 引擎产物齐全可查（140 §1.4 #3，架构 §6 核对 ⑥）。
//
// 守四件事：
//   1. 产物齐全：单文件 ESM + 恰好 4 份 wasm + ESM 声明 + 两个 external 的解析件
//   2. manifest 与磁盘一致（体积记录在 manifest，篡改/缺文件都红）
//   3. 产物出自**当前锁定的 submodule commit**——vendor 升了 tag 而产物没重建，红
//   4. 原生模块归零：整棵产物树里零 .node（PTY 桩、wasm 化的前提）

import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { exists, readJson, Report, ROOT } from './lib/harness.mjs'

const report = new Report('artifacts')
const ENGINE = 'packages/app/engine'
const WASM_COUNT = 4

if (!exists(`${ENGINE}/manifest.json`)) {
  report.add(
    '引擎产物',
    '产物齐全（ESM + 4 wasm）',
    `${ENGINE}/manifest.json`,
    '还没构建——跑 `bun scripts/build-engine.ts`（dev/build 的 pre 脚本会自动跑）',
  )
  report.finish('artifacts —— 引擎产物齐全')
  process.exit(process.exitCode ?? 0)
}

const manifest = readJson(`${ENGINE}/manifest.json`)

// ── 1. 齐全 ─────────────────────────────────────────────────────────────────
const names = Object.keys(manifest.files ?? {})
const wasm = names.filter((name) => name.endsWith('.wasm'))
if (!names.includes('node.js')) {
  report.add('引擎产物', '产物齐全（ESM + 4 wasm）', `${ENGINE}/node.js`, 'manifest 里没有单文件 ESM')
}
if (wasm.length !== WASM_COUNT) {
  report.add(
    '引擎产物',
    '产物齐全（ESM + 4 wasm）',
    `${ENGINE}/manifest.json`,
    `wasm 应恰好 ${WASM_COUNT} 份，manifest 记了 ${wasm.length} 份`,
  )
}
for (const requirement of [
  `${ENGINE}/package.json`,
  `${ENGINE}/node_modules/jsonc-parser/package.json`,
  `${ENGINE}/node_modules/@lydell/node-pty/package.json`,
]) {
  if (!exists(requirement)) {
    report.add('引擎产物', '产物齐全（ESM + 4 wasm）', requirement, '缺——build-engine 的复制步骤没走完')
  }
}

// ── 2. manifest 与磁盘一致（体积记录）──────────────────────────────────────
let totalBytes = 0
for (const [name, bytes] of Object.entries(manifest.files ?? {})) {
  const path = `${ENGINE}/${name}`
  if (!exists(path)) {
    report.add('引擎产物', 'manifest 与磁盘一致', path, 'manifest 记了、磁盘上没有')
    continue
  }
  const actual = statSync(join(ROOT, path)).size
  totalBytes += actual
  if (actual !== bytes) {
    report.add('引擎产物', 'manifest 与磁盘一致', path, `manifest 记 ${bytes}B，磁盘是 ${actual}B——产物被改过或复制不完整`)
  }
}

// ── 3. 产物出自当前锁定 commit ──────────────────────────────────────────────
const gitlink = spawnSync('git', ['ls-files', '-s', 'vendor/opencode'], { cwd: ROOT, encoding: 'utf8' })
  .stdout.trim()
  .split(/\s+/)[1]
if (gitlink && manifest.commit !== gitlink) {
  report.add(
    '引擎产物',
    '产物必须出自锁定的 submodule commit',
    `${ENGINE}/manifest.json`,
    `manifest.commit=${String(manifest.commit).slice(0, 9)}，锁定 gitlink=${gitlink.slice(0, 9)}——重跑 build-engine`,
  )
}

// ── 4. 原生模块归零 ─────────────────────────────────────────────────────────
function findNative(dirRelative) {
  const absolute = join(ROOT, dirRelative)
  let entries
  try {
    entries = readdirSync(absolute, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const child = `${dirRelative}/${entry.name}`
    if (entry.isDirectory()) return findNative(child)
    return entry.name.endsWith('.node') ? [child] : []
  })
}
for (const hit of findNative(ENGINE)) {
  report.add('引擎产物', '原生模块归零（架构 §4.1）', hit, 'PTY 走抛错桩、监听不打包——.node 不该存在')
}

report.note(
  `${String(manifest.tag)}@${String(manifest.commit).slice(0, 9)} —— ${names.length} 个产物，` +
    `${(totalBytes / 1024 / 1024).toFixed(1)}MB（patch ${manifest.patches?.length ?? 0} 个）`,
)
report.finish('artifacts —— 引擎产物齐全、与锁定 commit 一致')
