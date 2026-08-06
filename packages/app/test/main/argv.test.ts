import { describe, expect, it } from 'vitest'

import { markdownPathsFrom, peekPendingPaths, queuePaths, takeNextPendingPath } from '../../src/main/argv'

describe('markdownPathsFrom', () => {
  it('挑出 .md 与 .mdx，忽略 execPath、开关与其它扩展名', () => {
    const argv = ['/path/to/electron', '--inspect', 'note.md', 'image.png', 'draft.MDX']
    expect(markdownPathsFrom(argv, '/work/book')).toEqual([
      '/work/book/note.md',
      '/work/book/draft.MDX',
    ])
  })

  it('相对路径按传入的 cwd 解析，而不是当前进程的 cwd', () => {
    expect(markdownPathsFrom(['electron', 'a.md'], '/second/instance')).toEqual([
      '/second/instance/a.md',
    ])
  })

  it('绝对路径原样保留', () => {
    expect(markdownPathsFrom(['electron', '/abs/x.md'], '/ignored')).toEqual(['/abs/x.md'])
  })
})

describe('待打开队列', () => {
  it('一次取一个，取完即无——同一路径不会被打开两次', () => {
    queuePaths(['/a.md'])
    queuePaths(['/b.md'])
    // 一个路径一扇窗（T-29）：一把取空会让第二个路径静默丢失
    expect(takeNextPendingPath()).toBe('/a.md')
    expect(takeNextPendingPath()).toBe('/b.md')
    expect(takeNextPendingPath()).toBeNull()
  })

  it('peek 不消费——smoke 的日志行曾用 take，把 argv 传进来的 page 吃掉了', () => {
    queuePaths(['/c.md'])
    expect(peekPendingPaths()).toEqual(['/c.md'])
    expect(peekPendingPaths()).toEqual(['/c.md'])
    expect(takeNextPendingPath()).toBe('/c.md')
  })
})
