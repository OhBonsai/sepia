#!/usr/bin/env bun
// check:commands —— 纪律 6 的机器面：**`execute` 调的 id 必须真的注册过**。
//
// 为什么有这条：Stage 8 开工时发现 `files/commands.ts` 里那四条命令
// **从来没有被任何地方 import**，于是 ⌘⌫ 与文件树右键都在调不存在的命令；
// 而 `execute` 对未知 id **静默返回**（那是对的——命令层不该因为一次误调就崩），
// 于是这件事一路无声，还骗过了一次人工轮（6b 第 6 项「⌘⌫ 删除」判了通过）。
//
// 两个方向都查：
//   A. `execute('x')` 里的 x，必须有对应的 `registerCommand({ id: 'x' })`
//   B. 注册了却**没有键位、也没有任何 execute 调用**的命令 → 只警告不拦
//      （它可能是留给 UI 按钮的，但也可能就是一笔入口债——⌘/ 看板会把它显示出来）
//
// 查不到"注册体有没有被 import"这件事本身：那是 A 的间接后果——
// 没被 import 的注册体，它的 id 就不会与任何 execute 对上。

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { read, Report } from './lib/harness.mjs'

const report = new Report('commands')
const ROOT = 'packages/app/src'

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

const files = walk(ROOT)
const registered = new Map() // id -> file
const called = new Map() // id -> [files]

for (const file of files) {
  const source = read(file)
  for (const match of source.matchAll(/registerCommand\(\s*\{[^}]*?id:\s*'([^']+)'/gs)) {
    registered.set(match[1], file)
  }
  for (const match of source.matchAll(/execute\(\s*'([^']+)'/g)) {
    const list = called.get(match[1]) ?? []
    list.push(file)
    called.set(match[1], list)
  }
}

for (const [id, where] of called) {
  if (registered.has(id)) continue
  report.add(
    '纪律 6',
    `execute 调了一个没注册的命令：${id}`,
    where[0],
    'execute 对未知 id 静默返回——这条路会一声不响地什么都不做',
  )
}

const orphans = [...registered.keys()].filter((id) => !called.has(id))
report.note(`注册 ${registered.size} 条 ｜ execute 调用 ${called.size} 个 id ｜ 只注册未被调用 ${orphans.length} 条`)
report.finish('commands —— execute 的 id 都注册过（纪律 6）')
