// 词级 diff（150 §1.2 / §1.3 core 行）。给浮层出「原文划线 / 新文」的展示数据。
//
// **自写不引库**，理由是包边界而非骨气：core 的外部依赖趋近于零（001 §2.1），
// 而这件事的规模撑得住自写。plan 写死了刹车——实现超 250 行就停下报告、改引库裁决。
//
// 为什么是**词级**而不是行级或字级：
//   · 行级 —— 改一个词整段划掉重写，读者看不出改了什么，diff 等于没有
//   · 字级 —— 中英混排下会碎成一地单字，视觉噪声盖过信息（§1.8 风险 5）
//   · 词级 —— 中文按字、西文按词，是这两者之间唯一读得下去的粒度

/** `equal` 两边都有；`delete` 只在原文（划线）；`insert` 只在新文。 */
export type DiffOp = 'equal' | 'delete' | 'insert'

export interface DiffSegment {
  op: DiffOp
  text: string
}

/**
 * 相似度低于此值就不做词级对照，直接整段划掉重写。
 *
 * §1.8 风险 5 的兜底：模型「改写」时经常是重说一遍，几乎没有公共子序列。
 * 这时词级 LCS 会在几十处零散命中「的」「了」「是」，diff 碎成一地彩纸屑——
 * **技术上正确，阅读上毫无用处**。0.3 是拍的，但拍得有依据：低于三成公共内容，
 * 人眼已经在读两段不同的话，不是在读一处修改。
 */
const FRAGMENTATION_FLOOR = 0.3

/**
 * token 数上限。LCS 的 DP 表是 O(n×m)，两段各 3000 token 就是 900 万格。
 * 选区级的输入远到不了这个量级；到了说明输入不是「一段」，此时整段替换
 * 既省内存又更好读。**不抛异常**——diff 只是展示层，不该成为落笔的拦路虎。
 */
const MAX_TOKENS = 3_000

/**
 * 切词。三类各自成 token：
 *   · CJK（汉字、假名）—— **逐字**，中文没有词边界，按字切是唯一不需要词典的正解
 *   · 西文单词与数字 —— 连续成词
 *   · 其余（空白、标点、符号）—— 逐字符
 *
 * 空白与标点**照样进 token 流**，不是被丢掉。丢了就拼不回原文，
 * 而「拼得回原文」是这个模块的不变式（不变量 2 在展示层的投影）。
 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  // 逐 code point 走，避免把 emoji 之类的代理对从中间劈开
  const chars = [...text]
  let latin = ''

  const flushLatin = (): void => {
    if (latin !== '') {
      tokens.push(latin)
      latin = ''
    }
  }

  for (const char of chars) {
    if (isLatinWordChar(char)) {
      latin += char
      continue
    }
    flushLatin()
    tokens.push(char)
  }
  flushLatin()
  return tokens
}

/** 西文字母、数字、以及词内的连字符与撇号（don't / well-known 不该被劈开）。 */
function isLatinWordChar(char: string): boolean {
  return /[0-9A-Za-z\u00C0-\u024F'-]/.test(char)
}

/** LCS 长度表。行用滚动数组也够，但要回溯路径就得留全表——输入有 MAX_TOKENS 兜着。 */
function lcsMatrix(a: string[], b: string[]): Uint32Array {
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const here = i * width + j
      table[here] =
        a[i] === b[j]
          ? (table[here + width + 1] ?? 0) + 1
          : Math.max(table[here + width] ?? 0, table[here + 1] ?? 0)
    }
  }
  return table
}

/** 把同 op 的相邻段并起来。不并的话「你好」会变成两个 delete，渲染出一堆碎片。 */
function merge(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = []
  for (const segment of segments) {
    if (segment.text === '') continue
    const last = out[out.length - 1]
    if (last !== undefined && last.op === segment.op) last.text += segment.text
    else out.push({ op: segment.op, text: segment.text })
  }
  return out
}

function wholesale(original: string, revised: string): DiffSegment[] {
  return merge([
    { op: 'delete', text: original },
    { op: 'insert', text: revised },
  ])
}

/**
 * 算出「原文划线 / 新文」的展示数据。
 *
 * **不变式（单测逐例断言）**：
 *   · `equal + delete` 的文本拼起来 === original
 *   · `equal + insert` 的文本拼起来 === revised
 * 少一个字都说明 diff 在骗人——而它骗人的后果是用户照着一段并不存在的「原文」
 * 决定要不要落笔。
 */
export function diffWords(original: string, revised: string): DiffSegment[] {
  if (original === revised) return merge([{ op: 'equal', text: original }])
  if (original === '') return merge([{ op: 'insert', text: revised }])
  if (revised === '') return merge([{ op: 'delete', text: original }])

  const a = tokenize(original)
  const b = tokenize(revised)
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return wholesale(original, revised)

  const table = lcsMatrix(a, b)
  const width = b.length + 1
  const common = table[0] ?? 0

  // 相似度按较长一侧算：短文本改长时，用较短侧当分母会虚高
  if (common / Math.max(a.length, b.length) < FRAGMENTATION_FLOOR) {
    return wholesale(original, revised)
  }

  const segments: DiffSegment[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      segments.push({ op: 'equal', text: a[i] ?? '' })
      i++
      j++
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      segments.push({ op: 'delete', text: a[i] ?? '' })
      i++
    } else {
      segments.push({ op: 'insert', text: b[j] ?? '' })
      j++
    }
  }
  while (i < a.length) {
    segments.push({ op: 'delete', text: a[i] ?? '' })
    i++
  }
  while (j < b.length) {
    segments.push({ op: 'insert', text: b[j] ?? '' })
    j++
  }

  return merge(segments)
}
