#!/usr/bin/env bun
// check:deps —— 断言实际依赖图 == 001_boot.md §2.2 的图。
//
// 两道，缺一不可：
//   A. 声明侧：每个包 package.json 里的 @sepia/* 依赖，必须**恰好等于** dep-graph.json
//      的边集（不多一条，不少一条）。没有 import 的多余声明，dependency-cruiser 抓不到。
//   B. 实际侧：dependency-cruiser 跑真实 import 图，抓越界的边（含两条刻意不连线）。

import { cruise } from 'dependency-cruiser'

import config, { RULE_CODES } from '../.dependency-cruiser.mjs'
import { readJson, Report } from './lib/harness.mjs'

const report = new Report('deps')
const graph = readJson('scripts/dep-graph.json')
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

// ── A. 声明侧 ────────────────────────────────────────────────────────────────
for (const pkg of graph.packages) {
  const manifestPath = `packages/${pkg}/package.json`
  const manifest = readJson(manifestPath)

  const declared = new Map()
  for (const field of DEP_FIELDS) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (name.startsWith(`${graph.scope}/`)) declared.set(name, { range, field })
    }
  }

  const expected = new Set(graph.edges[pkg].map((dep) => `${graph.scope}/${dep}`))

  for (const [name, { range, field }] of declared) {
    if (!expected.has(name)) {
      const deliberate = graph.deliberateNonEdges.find(
        (edge) => edge.from === pkg && `${graph.scope}/${edge.to}` === name,
      )
      report.add(
        '结构 2',
        '包依赖声明必须等于 001 §2.2 的图',
        `${manifestPath}（${field}.${name}）`,
        deliberate
          ? `这是一条刻意不连线：${deliberate.why}`
          : `图里没有 ${pkg} → ${name.slice(graph.scope.length + 1)} 这条边`,
      )
      continue
    }
    if (range !== 'workspace:*') {
      report.add(
        '结构 2',
        '跨包依赖一律 workspace:*',
        `${manifestPath}（${field}.${name} = ${range}）`,
      )
    }
  }

  for (const name of expected) {
    if (!declared.has(name)) {
      report.add(
        '结构 2',
        '包依赖声明必须等于 001 §2.2 的图',
        `${manifestPath}（缺 ${name}）`,
        '图里有这条边，package.json 里却没声明',
      )
    }
  }
}

report.note(
  `声明侧：${graph.packages.length} 个包，` +
    `${Object.values(graph.edges).reduce((n, list) => n + list.length, 0)} 条边，` +
    `${graph.deliberateNonEdges.length} 条刻意不连线`,
)

// ── B. 实际侧 ────────────────────────────────────────────────────────────────
const result = await cruise(['packages'], {
  ...config.options,
  ruleSet: { forbidden: config.forbidden },
  outputType: 'json',
})

const output = typeof result.output === 'string' ? JSON.parse(result.output) : result.output
const { violations, totalCruised } = output.summary

for (const violation of violations) {
  const [code, title] = RULE_CODES[violation.rule.name] ?? ['结构 2', violation.rule.name]
  const where = violation.to && violation.to !== violation.from ? ` → ${violation.to}` : ''
  report.add(code, title, `${violation.from}${where}`, `规则 ${violation.rule.name}`)
}

report.note(`实际侧：dependency-cruiser 扫过 ${totalCruised} 个模块，${config.forbidden.length} 条规则`)

report.finish('deps —— 依赖图与 001 §2.2 一致')
