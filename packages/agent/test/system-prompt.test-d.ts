import { SYSTEM_PROMPTS, type SystemPrompt } from '../src/tasks/prompts.ts'
import type { TaskDefinition } from '../src/tasks/registry.ts'

// 纪律 21 的**类型层断言**（150 §1.4 #1）。这个文件不跑，只被 tsc 检查。
//
// 为什么一上来就带它（不等反向验证再发现）：002 §2.1 第二条元教训——类型层纪律
// **默认是空转的**。`BookDirectory` 那次实测过：把品牌类型放宽成 `string`，
// typecheck 照样全绿，因为生产路径上没有任何一处拿裸值去撞它。
//
// 这里的空转形态更隐蔽：`SYSTEM_PROMPTS` 里只要有**一条**是模板字符串拼了变量，
// 那一项就退化成 `string`，`SystemPrompt` 整个联合被 `string` 吞掉——纪律 21 从此
// 拦不住任何东西，而所有调用点仍然编译通过。下面的 `@ts-expect-error` 就是探针：
// 联合一旦被吞，它们全变成「无用的忽略」，tsc 立刻报错。

declare const runtimeValue: string

// @ts-expect-error 裸 string 不是 SystemPrompt——联合一旦退化成 string，这行就不再报错
const widened: SystemPrompt = runtimeValue
void widened

// @ts-expect-error 模板字符串拼变量的结果是 string，纪律 21 要挡的正是它
const interpolated: SystemPrompt = `${SYSTEM_PROMPTS.rewrite}\n今天是 ${runtimeValue}`
void interpolated

// @ts-expect-error 换个措辞的字面量也不行——prompt 只能来自那张表
const rephrased: SystemPrompt = '你是一支笔。'
void rephrased

// 正例：表里的常量收得下
const constant: SystemPrompt = SYSTEM_PROMPTS.rewrite
void constant

export function taskDefinitionRejectsVariablePrompts(): void {
  // 正例：四元组照常注册
  const ok: TaskDefinition = {
    model: null,
    context: { scope: 'page' },
    systemPrompt: SYSTEM_PROMPTS.rewrite,
    output: 'body-replace',
  }
  void ok

  const bad: TaskDefinition = {
    model: null,
    context: { scope: 'page' },
    // @ts-expect-error 反例：把可变内容拼进 system prompt——缓存前缀会碎，行为不可预测
    systemPrompt: `${SYSTEM_PROMPTS.rewrite} 当前页面：${runtimeValue}`,
    output: 'body-replace',
  }
  void bad
}
