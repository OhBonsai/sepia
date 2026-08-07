import { describe, expect, it } from 'vitest'

import {
  type ToggleResult,
  indentLines,
  listContinuation,
  toggleCodeFence,
  toggleHeading,
  toggleInline,
  toggleLinePrefix,
  toggleLink,
} from '../src/markdown/toggle.ts'

// 190 P1 / F2 / D-26：标准快捷键集的 toggle 语义。

/** 把 edits 落到文本上（edits 已按从后往前排好）。 */
function apply(text: string, result: ToggleResult | null): string {
  if (result === null) throw new Error('这一步本该返回 edits，却返回了 null')
  let out = text
  for (const edit of result.edits) out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to)
  return out
}

describe('行内标记 toggle', () => {
  it('选中一段 → 包上', () => {
    // 下标是**字符位**：这0 是1 关2 键3 词4 。5 —— 选「关键」是 [2,4)
    expect(apply('这是关键词。', toggleInline('这是关键词。', 2, 4, '**'))).toBe('这是**关键**词。')
  })

  it('**按第二次回到原样**——按第二次能回去，人才敢按第一次', () => {
    const once = toggleInline('这是关键词。', 2, 4, '**')
    const text = apply('这是关键词。', once)
    const twice = toggleInline(text, once.selection.from, once.selection.to, '**')
    expect(apply(text, twice)).toBe('这是关键词。')
  })

  it('选中了带标记的整段也能解包（用户常这么选）', () => {
    expect(apply('这是**关键**词。', toggleInline('这是**关键**词。', 2, 8, '**'))).toBe('这是关键词。')
  })

  it('没选中 → 插一对，光标落中间（先按键再打字的用法）', () => {
    const result = toggleInline('这是。', 2, 2, '**')
    expect(apply('这是。', result)).toBe('这是****。')
    expect(result.selection).toEqual({ from: 4, to: 4 })
  })

  it('斜体、行内代码、删除线共用同一条路', () => {
    expect(apply('abc', toggleInline('abc', 0, 3, '*'))).toBe('*abc*')
    expect(apply('abc', toggleInline('abc', 0, 3, '`'))).toBe('`abc`')
    expect(apply('abc', toggleInline('abc', 0, 3, '~~'))).toBe('~~abc~~')
  })
})

describe('标题', () => {
  it('设为二级', () => {
    expect(apply('标题\n正文\n', toggleHeading('标题\n正文\n', 0, 2))).toBe('## 标题\n正文\n')
  })

  it('**同一级按第二次还原为正文**', () => {
    expect(apply('## 标题\n', toggleHeading('## 标题\n', 3, 2))).toBe('标题\n')
  })

  it('换级别是替换不是叠加', () => {
    expect(apply('## 标题\n', toggleHeading('## 标题\n', 3, 4))).toBe('#### 标题\n')
  })

  it('⌘0 一律还原', () => {
    expect(apply('###### 标题\n', toggleHeading('###### 标题\n', 8, 0))).toBe('标题\n')
  })
})

describe('行首标记', () => {
  it('引用：整段加上', () => {
    expect(apply('甲\n乙\n', toggleLinePrefix('甲\n乙\n', 0, 3, 'quote'))).toBe('> 甲\n> 乙\n')
  })

  it('**只要有一行不是就全部加上**——反过来会让人按一次就把半段搞乱', () => {
    expect(apply('> 甲\n乙\n', toggleLinePrefix('> 甲\n乙\n', 0, 5, 'quote'))).toBe('> 甲\n> 乙\n')
  })

  it('全都是了才全部去掉', () => {
    expect(apply('> 甲\n> 乙\n', toggleLinePrefix('> 甲\n> 乙\n', 0, 7, 'quote'))).toBe('甲\n乙\n')
  })

  it('有序列表按行号递增', () => {
    expect(apply('甲\n乙\n', toggleLinePrefix('甲\n乙\n', 0, 3, 'ordered'))).toBe('1. 甲\n2. 乙\n')
  })
})

describe('围栏代码块', () => {
  it('选中几行 → 上下加围栏', () => {
    expect(apply('a\nb\n', toggleCodeFence('a\nb\n', 0, 3))).toBe('```\na\nb\n```\n')
  })

  it('已经被围栏裹着 → 去掉', () => {
    const text = '```\na\n```\n'
    expect(apply(text, toggleCodeFence(text, 4, 5))).toBe('a\n')
  })
})

describe('链接', () => {
  it('包成 `[文字]()`，**光标落进括号**——下一步永远是贴地址', () => {
    const result = toggleLink('看这里', 0, 3)
    expect(apply('看这里', result)).toBe('[看这里]()')
    expect(result.selection.from).toBe('[看这里]('.length)
  })
})

describe('列表续行', () => {
  it('回车续下一项', () => {
    expect(apply('- 甲', listContinuation('- 甲', 3))).toBe('- 甲\n- ')
  })

  it('有序列表号码 +1', () => {
    expect(apply('3. 甲', listContinuation('3. 甲', 4))).toBe('3. 甲\n4. ')
  })

  it('**空项回车退出列表**——没有它，列表一开头就永远出不来', () => {
    expect(apply('- 甲\n- ', listContinuation('- 甲\n- ', 6))).toBe('- 甲\n')
  })

  it('不是列表就交回默认行为', () => {
    expect(listContinuation('普通一行', 2)).toBeNull()
  })

  it('缩进跟着上一项走', () => {
    expect(apply('  - 甲', listContinuation('  - 甲', 5))).toBe('  - 甲\n  - ')
  })
})

describe('缩进', () => {
  it('Tab 加一层（宽度可配）', () => {
    expect(apply('甲\n乙\n', indentLines('甲\n乙\n', 0, 3, 2, false))).toBe('  甲\n  乙\n')
  })

  it('⇧Tab 退一层；没有缩进的行不动', () => {
    expect(apply('  甲\n乙\n', indentLines('  甲\n乙\n', 0, 5, 2, true))).toBe('甲\n乙\n')
  })
})
