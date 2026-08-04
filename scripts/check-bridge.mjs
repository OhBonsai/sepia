#!/usr/bin/env bun
// check:bridge —— 纪律 2：preload 是 renderer 与 main 之间唯一的桥，
// 它的暴露面必须与 scripts/bridge-snapshot.json 一致。
//
// 用 TypeScript 的 AST 而不是正则：正则会被换行、注释、嵌套对象骗过去，
// 而这条检查一旦能被骗，它守的就不再是白名单。

import ts from 'typescript'

import { read, readJson, Report } from './lib/harness.mjs'

const FILE = 'packages/app/src/preload/index.ts'
const SNAPSHOT = 'scripts/bridge-snapshot.json'

const report = new Report('bridge')
const source = ts.createSourceFile(FILE, read(FILE), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1

/** 顶层 `const x = {...}`，供 exposeInMainWorld 的第二个参数是标识符时回查。 */
const declarations = new Map()
for (const statement of source.statements) {
  if (!ts.isVariableStatement(statement)) continue
  for (const decl of statement.declarationList.declarations) {
    if (ts.isIdentifier(decl.name) && decl.initializer) {
      declarations.set(decl.name.text, decl.initializer)
    }
  }
}

function flatten(node, prefix, out) {
  if (!ts.isObjectLiteralExpression(node)) {
    out.push(prefix)
    return
  }
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      report.add(
        '纪律 2',
        'preload 暴露面必须逐项可数',
        `${FILE}:${lineOf(property)}`,
        '桥上不许用展开运算符——它让白名单无法被审计',
      )
      continue
    }
    const name = property.name
    if (!name || (!ts.isIdentifier(name) && !ts.isStringLiteral(name))) {
      report.add(
        '纪律 2',
        'preload 暴露面必须逐项可数',
        `${FILE}:${lineOf(property)}`,
        '计算属性名让白名单无法被审计',
      )
      continue
    }
    const path = `${prefix}.${name.text}`
    if (ts.isPropertyAssignment(property)) {
      flatten(property.initializer, path, out)
    } else {
      out.push(path)
    }
  }
}

const collected = []
let exposeCalls = 0

function visit(node) {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'exposeInMainWorld'
  ) {
    exposeCalls += 1
    const [namespaceArg, apiArg] = node.arguments
    if (!namespaceArg || !ts.isStringLiteral(namespaceArg)) {
      report.add('纪律 2', 'preload 暴露面必须逐项可数', `${FILE}:${lineOf(node)}`, '命名空间必须是字面串')
      return
    }
    let target = apiArg
    if (target && ts.isIdentifier(target)) target = declarations.get(target.text)
    if (!target) {
      report.add(
        '纪律 2',
        'preload 暴露面必须逐项可数',
        `${FILE}:${lineOf(node)}`,
        '第二个参数要么是对象字面量，要么是本文件顶层声明的常量',
      )
      return
    }
    flatten(target, namespaceArg.text, collected)
  }
  ts.forEachChild(node, visit)
}

visit(source)

if (exposeCalls === 0) {
  report.add('纪律 2', 'preload 是唯一的桥', FILE, '找不到 contextBridge.exposeInMainWorld 调用')
}

const surface = collected.toSorted()

// ── 不变量级子条（140 §1.4 #2，110 §1.4 注①）：agent 域 == 五方法 + 状态/事件订阅 ──
// 硬度是**不变量 3/4（AI 不抢笔 / Agent 没有写权限）**：这里不认 harness-exempt，
// 多一个方法、或任何方法摸到 agent/* 之外的通道（比如复用 file/write），一律红。
//
// 两道：
//   a. 方法集恰好等于白名单——「只是加一个」正是暴露面腐化的形态
//   b. agent 域内出现的每个 IPC 通道字面量都必须在 agent/* 通道白名单里——
//      防「方法名照旧、内部偷换通道」绕过 a
{
  const AGENT_METHODS = [
    'api.agent.interrupt',
    'api.agent.listModels',
    'api.agent.onEvent',
    'api.agent.onStatusChange',
    'api.agent.openThread',
    'api.agent.send',
    'api.agent.status',
    'api.agent.stream',
  ]
  const AGENT_CHANNELS = new Set([
    'agent/open-thread',
    'agent/send',
    'agent/stream',
    'agent/interrupt',
    'agent/list-models',
    'agent/status',
    'agent/status-changed',
    'agent/event',
  ])

  const actualMethods = surface.filter((key) => key.startsWith('api.agent.'))
  for (const key of actualMethods) {
    if (!AGENT_METHODS.includes(key)) {
      report.add(
        '不变量 3/4',
        'agent 域必须恰好是五方法 + 状态/事件订阅',
        `${FILE}（多出 ${key}）`,
        '扩方法前先问能否用现有五个表达（架构 §4.3）；给 Agent 的写路径无豁免',
      )
    }
  }
  for (const key of AGENT_METHODS) {
    if (!actualMethods.includes(key)) {
      report.add('不变量 3/4', 'agent 域必须恰好是五方法 + 状态/事件订阅', `${FILE}（缺 ${key}）`)
    }
  }

  // b：找到 agent 属性的对象字面量，收集其中所有字符串字面量里长得像 IPC 通道的
  function agentChannelAudit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name &&
      ((ts.isIdentifier(node.name) && node.name.text === 'agent') ||
        (ts.isStringLiteral(node.name) && node.name.text === 'agent')) &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const visitLiterals = (inner) => {
        if (ts.isStringLiteral(inner) && inner.text.includes('/')) {
          if (!AGENT_CHANNELS.has(inner.text)) {
            report.add(
              '不变量 3/4',
              'agent 域不得触达 agent/* 之外的 IPC 通道',
              `${FILE}:${lineOf(inner)}`,
              `'${inner.text}' 不在 agent 通道白名单里——这是给 Agent 开写路径的形态`,
            )
          }
        }
        ts.forEachChild(inner, visitLiterals)
      }
      visitLiterals(node.initializer)
    }
    ts.forEachChild(node, agentChannelAudit)
  }
  agentChannelAudit(source)
}

const snapshot = readJson(SNAPSHOT)
const expected = snapshot.surface.toSorted()

const added = surface.filter((key) => !expected.includes(key))
const removed = expected.filter((key) => !surface.includes(key))

for (const key of added) {
  report.add(
    '纪律 2',
    'preload 暴露面变更须经守卫比对',
    `${FILE}（新增 ${key}）`,
    `确实要加就把它写进 ${SNAPSHOT}，让增长出现在 diff 里`,
  )
}
for (const key of removed) {
  report.add('纪律 2', 'preload 暴露面变更须经守卫比对', `${SNAPSHOT}（已移除 ${key}）`, '快照里有、代码里没有')
}

report.note(`暴露面 ${surface.length} 项：${surface.join('、') || '（空）'}`)
report.finish(`bridge —— 暴露面与快照一致（${surface.length} 项）`)
