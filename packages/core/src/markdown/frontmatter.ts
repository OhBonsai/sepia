// frontmatter 的解析与回写（190 P4 / F8）。
//
// **编辑属性表 = 编辑 frontmatter 字节**。这一条是这个功能存在的全部前提：
// 属性表不是"关于这张纸的元数据面板"，它就是纸最上面那几行，只是换了个画法。
// 所以这里的每个函数都必须做到——**没动的行逐字节原样**（不变量 2）。
//
// 刻意不引 YAML 解析器：一个真 YAML 库会把 `title: 甲` 读成对象再写回来，
// 于是引号、缩进、注释、键的顺序**全部被规范化**。而用户的 frontmatter 里
// 可能有我们不认识的键、有意的缩进、甚至注释——那些字节不是我们的。
// 这里只做**逐行的键值切分**，改一行就只改那一行。

export interface Frontmatter {
  /** `---` 之间的原始行（不含两条 `---` 本身）。 */
  lines: string[]
  /** 正文起点（字符下标）。没有 frontmatter 时是 0。 */
  bodyFrom: number
  /** 整块（含两条 `---` 与结尾换行）在文档里的区间。没有时 from === to === 0。 */
  range: { from: number; to: number }
}

const FENCE = '---'

/**
 * 解析 frontmatter。**只认文档最开头的那一块**——中间出现的 `---` 是分隔线，
 * 不是 frontmatter，把它当 frontmatter 会把用户的正文吃掉一大段。
 */
export function parseFrontmatter(text: string): Frontmatter {
  const empty: Frontmatter = { lines: [], bodyFrom: 0, range: { from: 0, to: 0 } }
  if (!text.startsWith(FENCE)) return empty
  const firstBreak = text.indexOf('\n')
  if (firstBreak === -1 || text.slice(0, firstBreak).trim() !== FENCE) return empty

  let at = firstBreak + 1
  const lines: string[] = []
  for (;;) {
    const nl = text.indexOf('\n', at)
    const end = nl === -1 ? text.length : nl
    // **行尾的 `\r` 不留在行里**：留着的话，写回时 join 一次 `\r\n` 就成了 `\r\r\n`。
    // CRLF 文件的每一行都会多一个字符——正是不变量 2 最不能出的那种错。
    const line = text.slice(at, end).replace(/\r$/, '')
    if (line.trim() === FENCE) {
      const to = nl === -1 ? text.length : nl + 1
      return { lines, bodyFrom: to, range: { from: 0, to } }
    }
    // 没有收尾的 `---` = 这不是 frontmatter（是一条分隔线加正文）
    if (nl === -1) return empty
    lines.push(line)
    at = nl + 1
  }
}

export interface MetaField {
  key: string
  value: string
  /** 在 `lines` 里的下标。写回时要用它——**按行号改，不按键名重排**。 */
  index: number
}

/**
 * 切出「键: 值」。**不认识的行原样留着**（不返回，也就不会被改写）——
 * 注释、多行值、嵌套结构都属于这一类。
 */
export function metaFields(front: Frontmatter): MetaField[] {
  const out: MetaField[] = []
  for (const [index, line] of front.lines.entries()) {
    const match = /^([A-Za-z_][\w-]*)\s*:\s?(.*)$/.exec(line)
    if (match === null) continue
    out.push({ key: match[1]!, value: match[2] ?? '', index })
  }
  return out
}

/**
 * 改一个字段的值，返回**替换整篇的新文本**。
 *
 * 只重写那一行；键不存在就插在块尾。没有 frontmatter 时**新建一块**——
 * 那是用户在属性表里第一次填字段的情形。
 */
export function setMetaField(text: string, key: string, value: string): string {
  const front = parseFrontmatter(text)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'

  if (front.range.to === 0) {
    // 没有 frontmatter：新建一块，正文原样接在后面
    return `${FENCE}${eol}${key}: ${value}${eol}${FENCE}${eol}${text}`
  }

  const fields = metaFields(front)
  const found = fields.find((field) => field.key === key)
  const lines = [...front.lines]
  if (found === undefined) lines.push(`${key}: ${value}`)
  else lines[found.index] = `${key}: ${value}`

  const block = `${FENCE}${eol}${lines.join(eol)}${eol}${FENCE}${eol}`
  return block + text.slice(front.range.to)
}
