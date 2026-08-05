import type { ContextScope } from './registry.ts'

// 块式上下文组装器（架构 §4.3c）。
//
// **接受的是「块」列表，不是一个字符串。** 差别在将来：要加「本篇已落笔摘要」
// 「记忆」时只是多一种块，组装器不用改。把上下文规则写死在每个功能里的话，
// 加一个任务就要在调用、UI、写入三处各改一遍——这张表就是为了避免那件事。
//
// 产出的是 **user message** 的内容。system prompt 是常量（纪律 21），
// 一切会变的东西——选区、前后文、@content——都从这里进去，不许往上跑。

export type ContextBlockKind =
  /** 选区本身。永远第一个，永远不被截断。 */
  | 'selection'
  /** 邻近正文段落。距离越近越先进。 */
  | 'nearby'
  /** 用户显式引用的别处内容（D-31 要求显式喂）。入口归 Stage 6b，块类型本 stage 就位。 */
  | 'at-content'

export interface ContextBlock {
  kind: ContextBlockKind
  text: string
  /**
   * 到选区的距离，0 = 选区自己。**这是取材顺序的唯一依据**（架构 §4.3c 的距离衰减链：
   * 选区 → 所在段 → 前后各 N 段 → 篇首）。调用方负责按自己的文档结构算出它，
   * 组装器只认这个数——于是「怎么算距离」可以随渲染层演化，组装规则不用跟着动。
   */
  distance: number
}

export interface AssembleOptions {
  /** 上限来自配置项 `agent.contextBudgetTokens`。组装器不读配置，只收数。 */
  budgetTokens: number
  scope?: ContextScope
}

export interface AssembledContext {
  /** 已按距离衰减排好序、且已在预算内截断的块。 */
  blocks: ContextBlock[]
  estimatedTokens: number
  /** 有块因预算被丢掉。**要能被看见**——它是「默认整篇」这条裁决的代价面（§1.7）。 */
  truncated: boolean
}

/**
 * token 估算。**是估算，不是真实分词**，故意的。
 *
 * 真实 tokenizer 要么绑定某个 provider 的词表（换模型就漂），要么引一个几 MB 的
 * wasm 依赖——而这里只需要回答「还装不装得下」。估错一成的后果是预算差一成，
 * 硬截断本来就有余量；引一个依赖进 `agent` 的后果是永久的。
 *
 * 口径：CJK 一字约一 token；西文约四字符一 token。两者分开数，中英混排才不会偏。
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const char of text) {
    if (/[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(char)) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}

/**
 * 按距离衰减取材，到预算上限**硬截断**——不做摘要、不做检索（架构 §4.3c）。
 *
 * 「上下文范围默认整篇」（产品裁决 2026-08-05）说的是**取材链默认展开到覆盖整篇**，
 * 不是整篇必然进 prompt。两者的差别就落在这个函数里：块可以给满整篇，
 * 但超预算时离选区近的先进、远的被截。
 */
export function assembleContext(
  blocks: readonly ContextBlock[],
  options: AssembleOptions,
): AssembledContext {
  const selection = blocks.filter((block) => block.kind === 'selection')
  const rest = blocks
    .filter((block) => block.kind !== 'selection')
    // 距离相同则保持输入顺序（sort 在 V8 上稳定），调用方给的前后顺序不会被打乱
    .toSorted((a, b) => a.distance - b.distance)

  const picked: ContextBlock[] = []
  let used = 0

  // 选区**先进且不受预算约束**：它一个人超预算也得进去。
  // 截掉选区的请求在语义上已经不成立了——那不是省钱，是发了一个没有主语的问题。
  for (const block of selection) {
    picked.push(block)
    used += estimateTokens(block.text)
  }

  let truncated = false
  for (const block of rest) {
    const cost = estimateTokens(block.text)
    if (used + cost > options.budgetTokens) {
      // **不 break**：继续看后面的块。远处可能有个很短的块还装得下，
      // 而 break 会因为撞上一个长块就把它后面全部丢掉。
      truncated = true
      continue
    }
    picked.push(block)
    used += cost
  }

  return { blocks: picked, estimatedTokens: used, truncated }
}

/** 每种块在 user message 里的抬头。模型靠它区分「要改的」和「参考的」。 */
const BLOCK_LABEL: Record<ContextBlockKind, string> = {
  selection: '要改写的原文',
  nearby: '前后文（仅供参考，不要改写）',
  'at-content': '用户显式引用的内容（仅供参考，不要改写）',
}

/**
 * 把组装结果拼成 user message。
 *
 * 动词（润色 / 扩写 / 精简…）是**这里**的措辞模板，不是 system prompt 的一部分——
 * 动词进 system prompt 就等于每个动词一份 prompt，provider 的缓存前缀立刻碎掉
 * （D-29 + T-33 + 纪律 21）。
 */
export function toUserMessage(context: AssembledContext, instruction: string): string {
  const parts: string[] = []
  for (const kind of ['at-content', 'nearby', 'selection'] as const) {
    const blocks = context.blocks.filter((block) => block.kind === kind)
    if (blocks.length === 0) continue
    parts.push(`【${BLOCK_LABEL[kind]}】\n${blocks.map((block) => block.text).join('\n\n')}`)
  }
  parts.push(`【要求】\n${instruction}`)
  return parts.join('\n\n')
}
