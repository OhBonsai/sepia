import { SYSTEM_PROMPTS, type SystemPrompt, type TaskType } from './prompts.ts'

// 任务四元组注册表（架构 §4.3c）：`任务类型 → { 模型, 上下文策略, system prompt, 输出去向 }`。
//
// **加任务 = 加一条配置。** 上下文规则写死在每个功能里的话，加一个任务要在调用、UI、
// 写入三处各改一遍——那正是这张表要避免的。MVP 只注册改写一条，但四个维度全在。

/**
 * 输出去向。**这一维最容易被忽略，但它决定结果落在哪里**——缺了它，每加一个
 * 非改写类任务都要动写入层（架构 §4.3c）。
 */
export type OutputTarget =
  /** 正文替换：走落笔的 CAS 校验（纪律 9c），是本 stage 唯一走通的一条 */
  | 'body-replace'
  /** 写 frontmatter */
  | 'metadata'
  /** 文件名，如图片取名 */
  | 'filename'
  /** 只显示不写入 */
  | 'display-only'

/**
 * 取材范围。默认整篇（产品裁决 2026-08-05）——「整篇」指取材链默认展开到覆盖整篇，
 * 不是整篇必然进 prompt：到 `budgetTokens` 即硬截断，离选区近的先进。
 */
export type ContextScope = 'selection' | 'page'

export interface ContextPolicy {
  scope: ContextScope
  /**
   * 预算上限从 config 注入，不写死在表里——它是配置项（`agent.contextBudgetTokens`），
   * 写死就等于每加一个任务都要重裁一次预算。
   */
  budgetTokens: number
}

export interface TaskDefinition {
  /** 来自 D-36 的用途指派表。null = 用引擎侧默认（MVP 只配一个模型时就是它）。 */
  model: { providerID: string; modelID: string } | null
  context: Omit<ContextPolicy, 'budgetTokens'>
  /** 纪律 21：类型是字面量联合，模板字符串拼变量赋不进来。 */
  systemPrompt: SystemPrompt
  output: OutputTarget
}

export const TASKS = {
  rewrite: {
    model: null,
    context: { scope: 'page' },
    systemPrompt: SYSTEM_PROMPTS.rewrite,
    output: 'body-replace',
  },
} as const satisfies Record<TaskType, TaskDefinition>

export function taskDefinition(type: TaskType): TaskDefinition {
  return TASKS[type]
}
