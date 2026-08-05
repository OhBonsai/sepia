// 纪律 21：**system prompt 必须是常量，可变内容一律进 user message。**
//
// 两个理由，第二个是钱：
//   1. 行为可预测——prompt 里没有会变的东西，同样的输入就该有同样的行为。
//   2. provider 的 prompt caching **要求前缀逐字节一致**。把时间戳、页面名、选区
//      塞进 system prompt，缓存永远不会命中（架构 §4.3b 条目 3）。
//
// 强制手段是类型（002 §2.1 第三条）：字段类型是**字面量联合**，模板字符串拼变量
// 的结果是 `string`，赋不进去。
//
// **这个联合有一个洞，`.test-d.ts` 就是堵它的。** 如果有人往下面这张表里加一条
// 模板字符串（`` `…${x}` ``），`as const` 保不住字面量，那一项会退化成 `string`，
// 于是 `SystemPrompt` 整个联合被 `string` 吞掉——**所有调用点仍然编译通过**，
// 类型层静默失效。这正是 002 §2.1 第二条元教训说的「品牌类型默认是空转的」。
// `system-prompt.test-d.ts` 用 `@ts-expect-error` 把「裸 string 必须编译不过」
// 变成断言：联合一被吞掉，那些忽略就变成「无用的忽略」，tsc 立刻报错。

export const SYSTEM_PROMPTS = {
  /**
   * 改写任务（MVP 唯一一条）。
   *
   * 三句话各有出处，删任何一句都会破一条已裁的东西：
   *   · 「只输出改写后的正文」—— 输出去向是正文替换，多一个字都会被 CAS 之后原样落进纸里
   *   · 「以本轮提供的原文为准」—— 同线程追问时 session 里躺着上一轮的旧原文（T-22 / F10）
   *   · 「与原文同语言」—— D-41 Day-1，不做语言检测，交给模型
   *
   * 动词（润色/扩写/精简…）**不在这里**——它是 user message 的措辞模板（D-29 + T-33），
   * 动词进 system prompt 就等于每个动词一份 prompt，缓存前缀立刻碎掉。
   */
  // **写成单个无插值模板字面量，不是字符串相加。**
  // `'a' + 'b'` 的类型是 `string` 而不是 `'ab'`——即使包在 `as const` 里也一样。
  // 这里一旦用加号拼，`SystemPrompt` 当场退化成 `string`，纪律 21 静默失效。
  // 这不是假想：本条初稿就是加号拼的，`system-prompt.test-d.ts` 首次运行即报
  // 四条「无用的忽略」把它抓了出来——那正是那个文件存在的理由。
  rewrite: `你是一支笔。改写用户给出的原文，只输出改写后的正文，不要解释、不要前后缀、不要代码围栏。
以本轮提供的原文为准，忽略此前轮次中的旧原文。
输出与原文同语言。`,
} as const

export type TaskType = keyof typeof SYSTEM_PROMPTS

/** 字面量联合。`string` 赋不进来，模板字符串拼变量的结果也赋不进来。 */
export type SystemPrompt = (typeof SYSTEM_PROMPTS)[TaskType]
