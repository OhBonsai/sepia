import { describe, expect, it } from 'vitest'

import { COMMIT_REASONS, commitMessage, parseReason, parseTrailers } from '../src/git/trailer.ts'

// §1.5 #4：trailer 往返。破坏方式瞄的是**特殊字符 page 路径**——
// 普通路径怎么写都往返得回来，那是功能的一般路径，不是会出事的场景（002 §6.2）。

describe('commit message 与 trailer', () => {
  it('三种触发的 message 是固定文本，不含任何变量', () => {
    expect(commitMessage('save')).toBe('sepia: save')
    expect(commitMessage('auto')).toBe('sepia: auto')
    // 模型永远不参与——这些 commit 的读者是徽章与还白链路，不是人类审阅者
    for (const text of Object.values(COMMIT_REASONS)) expect(text.startsWith('sepia: ')).toBe(true)
  })

  it('trailer 与正文之间必须空一行，否则 git 不认它是 trailer', () => {
    const message = commitMessage('save', { page: 'note.md' })
    expect(message).toBe('sepia: save\n\nSepia-Page: note.md')
  })

  it('往返：普通路径', () => {
    const message = commitMessage('save', { page: 'a/b/c.md' })
    expect(parseTrailers(message).page).toBe('a/b/c.md')
    expect(parseReason(message)).toBe('save')
  })

  it('**换行的路径**往返得回来——不转义的话它会把一条 trailer 撑成两行', () => {
    // POSIX 只禁 `/` 与 `\0`，换行是合法文件名字符
    const nasty = 'weird\nname\r\n.md'
    const message = commitMessage('save', { page: nasty })
    expect(message.split('\n').filter((line) => line.startsWith('Sepia-Page:'))).toHaveLength(1)
    expect(parseTrailers(message).page).toBe(nasty)
  })

  it('含冒号与反斜杠的路径也往返', () => {
    const nasty = 'a: b\\c.md'
    expect(parseTrailers(commitMessage('save', { page: nasty })).page).toBe(nasty)
  })

  it('a 期没有线程：不传 thread 就不出现这条 trailer', () => {
    expect(commitMessage('save', { page: 'x.md' })).not.toContain('Sepia-Thread')
    expect(parseTrailers(commitMessage('save', { page: 'x.md' })).thread).toBeUndefined()
  })

  it('认不出的 message 返回 null，不猜', () => {
    expect(parseReason('feat: 用户自己的提交')).toBeNull()
    expect(parseTrailers('没有任何 trailer 的正文')).toEqual({})
  })
})
