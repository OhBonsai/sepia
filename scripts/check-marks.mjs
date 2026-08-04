#!/usr/bin/env bun
// check:marks —— 三种记号里的前两种（002 §5.2）。第三种（SEPIA_HARNESS_BYPASS）
// 由 check.mjs 处理，因为它要在所有检查之前就拦下来。
//
//   // harness-exempt: <号> <理由>    纪律对、此处是合法例外 —— 计数，不阻塞
//   // harness-dispute: <号> <论据>   认为纪律本身有问题 —— 阻塞，必须升级到人
//
// 为什么 dispute 是硬红：AI 最容易犯的错，是把「我觉得这条纪律不对」当成第一种处理，
// 打个豁免继续走——架构就被悄悄改了，而且改得毫无痕迹。让它红，这件事就必须过人。

import { read, Report, walk } from './lib/harness.mjs'

const report = new Report('marks')

// harness 自身的实现与说明文字里当然会出现这两个词，跳过，免得自己数自己。
const SELF = new Set([
  'scripts/lib/harness.mjs',
  'scripts/check-discipline.mjs',
  'scripts/check-marks.mjs',
  'scripts/check.mjs',
])

const MARK = /(?:\/\/|\/\*|\*|#|<!--)\s*harness-(exempt|dispute)\s*:\s*(.*)$/

const files = [
  ...walk('packages', ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.css', '.html']),
  ...walk('scripts', ['.ts', '.mjs']),
  ...walk('.github', ['.yml', '.yaml']),
].filter((file) => !SELF.has(file))

const exempt = []
const dispute = []

for (const file of files) {
  read(file)
    .split('\n')
    .forEach((line, index) => {
      const match = MARK.exec(line)
      if (!match) return
      const entry = { at: `${file}:${index + 1}`, body: match[2].replace(/\s*(?:\*\/|-->)\s*$/, '').trim() }
      ;(match[1] === 'exempt' ? exempt : dispute).push(entry)
    })
}

for (const entry of exempt) report.note(`exempt  ${entry.at} — ${entry.body}`)

for (const entry of dispute) {
  report.add(
    'harness-dispute',
    '有人认为纪律本身有问题，AI 不得自行处置',
    entry.at,
    `${entry.body} —— 停下报告，等人裁决（002 §5.2）`,
  )
}

report.note(`harness-exempt ${exempt.length} 处 ｜ harness-dispute ${dispute.length} 处（扫了 ${files.length} 个文件）`)
report.note('豁免数只增不减，就是架构在腐化——这个数字比任何单条检查都更能说明健康状况')

report.finish(`marks —— exempt ${exempt.length}、dispute 0`)
