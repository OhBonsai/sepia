// 流式揭示的节奏与边界（架构 §4.4「流式」；150 §1.2 揭示节奏三条 + 稳定性四条）。
//
// 住在 core 而不是 renderer：它不依赖 Electron、也不依赖 DOM，能独立单测——
// 按 001 §2 的规矩，这类逻辑一律下沉。留在组件里的话，「揭示单调只增」这种
// 性质就只能靠 e2e 去证，而那意味着很长一段时间里没人证。
//
// **四条稳定性不变量**（§1.2），这个模块负责其中三条：
//   · 冻结即定 —— 冻结后 revealed 恒等于收到的全长，不再变
//   · 揭示单调只增 —— revealed 永不回退
//   · 节奏与 token 到达率解耦 —— 推进由时钟批次驱动，不由「又到了一个 token」驱动
// 第四条「结构块绝不闪 raw」靠 markdown 补全（renderer 侧的 remend），不在这里。

/** 揭示批次。24ms ≈ 每帧一次，肉眼连续但不会一 token 一次重排。 */
export const REVEAL_BATCH_MS = 24

/** 一个批次最多推进多少个字符。太大则一顿一顿，太小则追不上快模型。 */
const MAX_CHARS_PER_BATCH = 12

export interface RevealState {
  /** 已揭示的字符数。**只增不减。** */
  revealed: number
  /** 冻结：流已结束（或已中止），此后不再有新字节。 */
  frozen: boolean
}

export const REVEAL_INITIAL: RevealState = { revealed: 0, frozen: false }

/**
 * 词与标点边界判定：`at` 处能不能断开。
 *
 * 为什么要 snap：逐字补间会让西文单词写到一半（`inter…` → `interp…`），
 * 中文虽然逐字也能读，但混排时西文那一半在抖。按边界断开就没有半个词。
 * CJK 每个字都是边界（本来就没有词间空格），西文只在非词字符处断开。
 */
export function isBoundary(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return true
  const before = text[at - 1] ?? ''
  const after = text[at] ?? ''
  if (isCjk(before) || isCjk(after)) return true
  return !(isWordChar(before) && isWordChar(after))
}

function isCjk(char: string): boolean {
  return /[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(char)
}

function isWordChar(char: string): boolean {
  return /[0-9A-Za-z\u00C0-\u024F'-]/.test(char)
}

/** 从 `at` 往回找最近的可断点。找不到就返回 `floor`（本批不推进，由调用方决定下一步）。 */
export function snapBack(text: string, at: number, floor: number): number {
  for (let i = at; i > floor; i--) {
    if (isBoundary(text, i)) return i
  }
  return floor
}

/**
 * 从 `at` 往后找下一个**文本内部**的可断点。
 *
 * 刻意不把 `text.length` 算作边界：流还没结束时，末尾那个词很可能只收到一半，
 * 拿它当边界就等于把半个词当整词揭出去。找不到内部边界返回 -1，语义是
 * 「剩下的还是一个没写完的词，等下一批」。
 */
export function snapForward(text: string, at: number): number {
  for (let i = at + 1; i < text.length; i++) {
    if (isBoundary(text, i)) return i
  }
  return -1
}

/**
 * 推进一个批次。
 *
 * `received` 是**到此刻为止收到的全文**，不是增量——调用方不必自己攒。
 * `frozen` 为真表示流已结束：此时一次性揭示到底，不再按批次挤牙膏
 * （用户已经在等结果了，节奏感在这一刻不再重要）。
 */
export function advanceReveal(
  state: RevealState,
  received: string,
  frozen: boolean,
): RevealState {
  // 冻结即定：到底、且钉死
  if (frozen) return { revealed: received.length, frozen: true }

  // 单调只增：即便 received 因为上游重发而变短，也绝不回退已揭示的部分
  const floor = Math.min(state.revealed, received.length)
  const target = Math.min(received.length, floor + MAX_CHARS_PER_BATCH)
  if (target <= floor) return { revealed: floor, frozen: false }

  const snapped = snapBack(received, target, floor)
  if (snapped > floor) return { revealed: snapped, frozen: false }

  // 本批内没有可断点 —— 说明批次正落在一个长词中间。此时**整词一次给出**（哪怕超批次），
  // 而不是切一半：半个词跳成整个词是最扎眼的一种抖动，正是 snap 要消灭的东西。
  const forward = snapForward(received, target)
  if (forward > floor) return { revealed: forward, frozen: false }

  // 连往后都找不到内部断点 —— 剩下的是一个还没写完的长词，**等下一批**。
  // 不推进不会卡死：要么后续字节带来断点，要么流结束时 frozen 一次性揭到底。
  return { revealed: floor, frozen: false }
}

/**
 * `prefers-reduced-motion` 命中时的揭示：**整块秒显**，不做批次。
 * 这不是「减少动画」的折中版，是直接跳过揭示这件事本身。
 */
export function revealAtOnce(received: string): RevealState {
  return { revealed: received.length, frozen: true }
}
