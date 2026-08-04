import { describe, expect, it } from 'vitest'

import { markdownPathsFrom, queuePaths, takePendingPaths } from '../../src/main/argv'

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
  it('take 一次就清空，避免同一路径被打开两次', () => {
    queuePaths(['/a.md'])
    queuePaths(['/b.md'])
    expect(takePendingPaths()).toEqual(['/a.md', '/b.md'])
    expect(takePendingPaths()).toEqual([])
  })
})
