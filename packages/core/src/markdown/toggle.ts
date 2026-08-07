// 标准快捷键集的**纯逻辑**（190 P1 / F2 / D-26）。
//
// 全部是 **toggle 语义**：选中就包裹、已经包着就解包；没选中就插一对标记、光标居中。
// 这一条比"能加粗"重要得多——按第二次能回到原样，人才敢按第一次。
//
// 为什么放 core 而不是 editor：它们是**字符串到字符串**的判断，与 CM6 无关；
// 放这儿能被单测直接盯住，而"加粗一段中文再加粗回来，字节要一模一样"
// 恰恰是不变量 2 最容易破的地方（round-trip 网守的就是它）。

export interface TextEdit {
  from: number
  to: number
  insert: string
}

export interface ToggleResult {
  edits: TextEdit[]
  /** 操作之后选区应该在哪。调用方负责把它落到编辑器上。 */
  selection: { from: number; to: number }
}

/**
 * 行内标记的 toggle：`**` 粗、`*` 斜、`` ` `` 行内代码、`~~` 删除线。
 *
 * 三种情形：
 *   ① 选区正好被这对标记裹着（标记在选区外）→ **解包**
 *   ② 选区自己以标记开头结尾 → **解包**（用户选中了带标记的整段）
 *   ③ 其余 → 包裹
 */
export function toggleInline(text: string, from: number, to: number, mark: string): ToggleResult {
  const len = mark.length
  const outer = text.slice(Math.max(0, from - len), from) === mark && text.slice(to, to + len) === mark
  if (outer) {
    // 标记在选区外侧：把两边各删掉一段。**从后往前排**，否则前一处删除会让后一处偏移错位
    return {
      edits: [
        { from: to, to: to + len, insert: '' },
        { from: from - len, to: from, insert: '' },
      ],
      selection: { from: from - len, to: to - len },
    }
  }
  const inner = to - from >= len * 2 && text.slice(from, from + len) === mark && text.slice(to - len, to) === mark
  if (inner) {
    return {
      edits: [
        { from: to - len, to, insert: '' },
        { from, to: from + len, insert: '' },
      ],
      selection: { from, to: to - len * 2 },
    }
  }
  // 包裹。没选中时插一对、光标落中间——这是"先按快捷键再打字"的用法
  return {
    edits: [{ from, to, insert: `${mark}${text.slice(from, to)}${mark}` }],
    selection: from === to ? { from: from + len, to: from + len } : { from: from + len, to: to + len },
  }
}

/** 一行的起止（不含换行符）。 */
function lineRange(text: string, at: number): { from: number; to: number } {
  const from = text.lastIndexOf('\n', Math.max(0, at - 1)) + 1
  const nl = text.indexOf('\n', at)
  return { from, to: nl === -1 ? text.length : nl }
}

/** 选区覆盖到的所有行。 */
function linesIn(text: string, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  let at = from
  for (;;) {
    const line = lineRange(text, at)
    out.push(line)
    if (line.to >= to) break
    at = line.to + 1
    if (at > text.length) break
  }
  return out
}

/**
 * 标题：`⌘1`–`⌘6` 设为该级，**再按同一级则还原为正文**（等价 ⌘0）。
 * `level = 0` 就是还原。
 */
export function toggleHeading(text: string, at: number, level: number): ToggleResult {
  const line = lineRange(text, at)
  const body = text.slice(line.from, line.to)
  const match = /^(#{1,6})\s+/.exec(body)
  const current = match === null ? 0 : match[1]!.length
  const prefix = level === 0 || current === level ? '' : `${'#'.repeat(level)} `
  const stripped = match === null ? body : body.slice(match[0].length)
  return {
    edits: [{ from: line.from, to: line.to, insert: `${prefix}${stripped}` }],
    selection: (() => {
      const delta = prefix.length - (match?.[0].length ?? 0)
      const next = Math.max(line.from, at + delta)
      return { from: next, to: next }
    })(),
  }
}

/**
 * 行首标记的 toggle：引用 `> `、无序 `- `、有序 `1. `。
 *
 * **整段选中时按"全都已经是"判断**：只要有一行还不是，就全部加上；
 * 全都是了才全部去掉。反过来（有一行是就全去掉）会让人按一次就把半段搞乱。
 */
export function toggleLinePrefix(
  text: string,
  from: number,
  to: number,
  kind: 'quote' | 'bullet' | 'ordered',
): ToggleResult {
  const lines = linesIn(text, from, to)
  const pattern = kind === 'quote' ? /^>\s?/ : kind === 'bullet' ? /^[-*+]\s+/ : /^\d+\.\s+/
  const all = lines.every((line) => pattern.test(text.slice(line.from, line.to)))
  const edits: TextEdit[] = []
  let index = 0
  for (const line of lines) {
    const body = text.slice(line.from, line.to)
    index += 1
    if (all) {
      const match = pattern.exec(body)!
      edits.push({ from: line.from, to: line.from + match[0].length, insert: '' })
    } else if (!pattern.test(body)) {
      const mark = kind === 'quote' ? '> ' : kind === 'bullet' ? '- ' : `${String(index)}. `
      edits.push({ from: line.from, to: line.from, insert: mark })
    }
  }
  // **从后往前**：前面的插入/删除会让后面的偏移全错
  edits.reverse()
  return { edits, selection: { from, to } }
}

/**
 * 围栏代码块：选中几行 → 上下各加一行围栏；已经被围栏裹着 → 去掉。
 * 没选中时插一对空围栏，光标落在中间那行。
 */
export function toggleCodeFence(text: string, from: number, to: number): ToggleResult {
  const first = lineRange(text, from)
  const last = lineRange(text, to)
  const above = first.from === 0 ? null : lineRange(text, first.from - 1)
  const below = last.to >= text.length ? null : lineRange(text, last.to + 1)
  const wrapped =
    above !== null &&
    below !== null &&
    text.slice(above.from, above.to).startsWith('```') &&
    text.slice(below.from, below.to).startsWith('```')
  if (wrapped) {
    return {
      edits: [
        { from: below.from, to: Math.min(text.length, below.to + 1), insert: '' },
        { from: above.from, to: above.to + 1, insert: '' },
      ],
      selection: { from: from - (above.to - above.from + 1), to: to - (above.to - above.from + 1) },
    }
  }
  const body = text.slice(first.from, last.to)
  return {
    edits: [{ from: first.from, to: last.to, insert: `\`\`\`\n${body}\n\`\`\`` }],
    selection: { from: first.from + 4, to: first.from + 4 + body.length },
  }
}

/** 链接：`[选中](url)`，没选中时 `[](url)`，光标落在 url 位置等着粘。 */
export function toggleLink(text: string, from: number, to: number): ToggleResult {
  const body = text.slice(from, to)
  const insert = `[${body}]()`
  return {
    edits: [{ from, to, insert }],
    // 光标落到括号里——**链接的下一步永远是贴地址**
    selection: { from: from + insert.length - 1, to: from + insert.length - 1 },
  }
}

/**
 * Enter 续列表 / 空项退出（D-26）。
 *
 * 返回 null = 这一行不是列表，Enter 交回给编辑器默认行为。
 * **空项退出比续行更重要**：没有它，列表一旦开头就永远出不来，
 * 只能靠退格删掉那个符号——那正是所有编辑器里最烦人的一件事。
 */
export function listContinuation(text: string, at: number): ToggleResult | null {
  const line = lineRange(text, at)
  const body = text.slice(line.from, line.to)
  const match = /^(\s*)(?:([-*+])|(\d+)\.)(\s+)(.*)$/.exec(body)
  if (match === null) return null
  const [, indent = '', bullet, ordered, space = ' ', rest = ''] = match
  if (rest.trim() === '') {
    // 空项：把这一行的标记清掉（退出列表），不再插新行
    return { edits: [{ from: line.from, to: line.to, insert: '' }], selection: { from: line.from, to: line.from } }
  }
  const next = bullet !== undefined ? `${bullet}${space}` : `${String(Number(ordered) + 1)}.${space}`
  const insert = `\n${indent}${next}`
  return {
    edits: [{ from: at, to: at, insert }],
    selection: { from: at + insert.length, to: at + insert.length },
  }
}

/** Tab / ⇧Tab 缩进。宽度可配（设置「Tab 缩进宽度」，默认 2）。 */
export function indentLines(text: string, from: number, to: number, width: number, out: boolean): ToggleResult {
  const pad = ' '.repeat(Math.max(1, width))
  const edits: TextEdit[] = []
  for (const line of linesIn(text, from, to)) {
    if (out) {
      const body = text.slice(line.from, line.to)
      const lead = /^[ \t]+/.exec(body)?.[0] ?? ''
      if (lead === '') continue
      edits.push({ from: line.from, to: line.from + Math.min(lead.length, pad.length), insert: '' })
    } else {
      edits.push({ from: line.from, to: line.from, insert: pad })
    }
  }
  edits.reverse()
  return { edits, selection: { from, to } }
}
