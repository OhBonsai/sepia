import { beforeEach, describe, expect, it, vi } from 'vitest'

// api 是桥的封装（它在模块加载时就取 `globalThis.api`），单测里换成假的：
// 这一层要验的是**命令有没有走到对的 api 上、参数有没有解对**，
// 而"api 到 main 到底通不通"是 smoke 的活（真桥、真文件、真回收站）。
vi.mock('../../src/renderer/services/api.ts', () => ({
  api: {
    createFile: vi.fn(async (path: string) => ({ ok: true, value: path })),
    renameFile: vi.fn(async (_from: string, to: string) => ({ ok: true, value: to })),
    moveFile: vi.fn(async (_from: string, directory: string) => ({ ok: true, value: `${directory}/a.md` })),
    trashFile: vi.fn(async () => ({ ok: true, value: undefined })),
  },
}))

import { execute, reset } from '../../src/renderer/commands/registry.ts'
import { registerFileCommands } from '../../src/renderer/files/commands.ts'
import { api } from '../../src/renderer/services/api.ts'

// 纪律 6：动作先注册命令，按钮也走 execute。a 期没有文件树 UI，
// 所以这四条命令此刻的**唯一调用方就是这份测试**——它同时也是 b 期接 UI 时的契约样例。

let opened: string[] = []
let gone = 0
const PAGE = '/book/note.md'

beforeEach(() => {
  reset()
  opened = []
  gone = 0
  vi.clearAllMocks()
  registerFileCommands(() => ({
    page: PAGE,
    onOpen: (path) => opened.push(path),
    onGone: () => {
      gone += 1
    },
  }))
})

describe('文件命令', () => {
  it('新建：不给名字就用「未命名.md」，落在当前 page 旁边，成功后打开它', async () => {
    await execute('files.new')
    expect(api.createFile).toHaveBeenCalledWith('/book/未命名.md')
    expect(opened).toEqual(['/book/未命名.md'])
  })

  it('新建：给名字就用它', async () => {
    await execute('files.new', { name: '灵感.md' })
    expect(api.createFile).toHaveBeenCalledWith('/book/灵感.md')
  })

  it('重命名：相对名解析到当前目录，绝对路径原样用', async () => {
    await execute('files.rename', { to: '改名后.md' })
    expect(api.renameFile).toHaveBeenCalledWith(PAGE, '/book/改名后.md')
    await execute('files.rename', '/elsewhere/x.md')
    expect(api.renameFile).toHaveBeenLastCalledWith(PAGE, '/elsewhere/x.md')
    expect(opened).toEqual(['/book/改名后.md', '/elsewhere/x.md'])
  })

  it('重命名：没给目标就什么都不做（不许拿当前路径去猜一个）', async () => {
    await execute('files.rename', {})
    expect(api.renameFile).not.toHaveBeenCalled()
    expect(opened).toEqual([])
  })

  it('移动：目标目录 + 原文件名，成功后打开新路径', async () => {
    await execute('files.move', { directory: '/book/archive' })
    expect(api.moveFile).toHaveBeenCalledWith(PAGE, '/book/archive')
    expect(opened).toEqual(['/book/archive/a.md'])
  })

  it('删除：默认删当前 page，成功后 shell 走空状态', async () => {
    await execute('files.trash')
    expect(api.trashFile).toHaveBeenCalledWith(PAGE)
    expect(gone).toBe(1)
  })

  it('删除别的文件不影响当前 page 的显示状态', async () => {
    await execute('files.trash', { path: '/book/other.md' })
    expect(api.trashFile).toHaveBeenCalledWith('/book/other.md')
    expect(gone).toBe(0)
  })

  it('没有当前 page 时四条命令都得体地什么都不做', async () => {
    reset()
    registerFileCommands(() => ({ page: null, onOpen: () => undefined, onGone: () => undefined }))
    await execute('files.new')
    await execute('files.rename', { to: 'x.md' })
    await execute('files.move', { directory: '/d' })
    await execute('files.trash')
    expect(api.createFile).not.toHaveBeenCalled()
    expect(api.renameFile).not.toHaveBeenCalled()
    expect(api.moveFile).not.toHaveBeenCalled()
    expect(api.trashFile).not.toHaveBeenCalled()
  })
})
