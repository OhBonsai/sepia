#!/usr/bin/env bun
// check:workspace —— 纪律 16：vendor/ 不被任何 workspace glob 匹配。
//
// vendor/opencode 自己是个带 workspace + catalog 的 bun 仓库。一旦被我们的 glob 圈进来，
// bun install 会去解析它的整棵依赖树，锁文件和 node_modules 就此纠缠不清，
// 而这只会在某次看似无关的 `bun install` 之后炸开。所以这条要在图还没长歪时就守住。

import { exists, readJson, Report } from './lib/harness.mjs'

const report = new Report('workspace')
const manifest = readJson('package.json')

const globs = Array.isArray(manifest.workspaces)
  ? manifest.workspaces
  : (manifest.workspaces?.packages ?? [])

if (globs.length === 0) {
  report.add('纪律 16', 'workspace glob 必须显式声明', 'package.json（workspaces）')
}

// 一、假想路径：就算 vendor/ 还没落地（Stage 3 才引），也要先验证 glob 圈不到它。
const PROBES = [
  'vendor',
  'vendor/opencode',
  'vendor/opencode/package.json',
  'vendor/opencode/packages/tui',
  'vendor/opencode/packages/opencode/src/index.ts',
  'vendor/anything/nested/deep/pkg',
]

for (const glob of globs) {
  const matcher = new Bun.Glob(glob)
  for (const probe of PROBES) {
    if (matcher.match(probe)) {
      report.add(
        '纪律 16',
        'vendor/ 不得被任何 workspace glob 匹配',
        `package.json（workspaces: "${glob}"）`,
        `这个 glob 会圈进 ${probe}`,
      )
    }
  }
}

// 二、真实展开：glob 在磁盘上实际匹配到什么，一个都不许落在 vendor/ 下。
const resolved = []
for (const glob of globs) {
  for (const hit of new Bun.Glob(glob).scanSync({ onlyFiles: false, followSymlinks: false })) {
    const normalized = hit.split('\\').join('/')
    resolved.push(normalized)
    if (normalized === 'vendor' || normalized.startsWith('vendor/')) {
      report.add(
        '纪律 16',
        'vendor/ 不得被任何 workspace glob 匹配',
        `package.json（workspaces: "${glob}" → ${normalized}）`,
      )
    }
  }
}

// 三、vendor/ 必须待在 packages/ 之外——挪进去就等于绕过了上面两条。
if (exists('packages/vendor')) {
  report.add(
    '纪律 16',
    'vendor/ 必须留在 packages/ 之外',
    'packages/vendor',
    'vendor 只能在仓库根，由 scripts/build-engine.ts 显式驱动',
  )
}

report.note(`glob ${globs.map((g) => `"${g}"`).join('、')} → ${resolved.length} 个工作区路径`)
report.note(exists('vendor') ? 'vendor/ 已存在，且不在上述任何一条里' : 'vendor/ 尚未引入（Stage 3）')
report.finish('workspace —— vendor/ 在 workspace 之外')
