import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 对 fs 模块做**透传 spy**：行为一律走真实实现，但调用序列可被断言。
// 这是附录 C.1 裁决（方向 ①）的落地——反向验证曾实证：把 tmp + rename 换成直接
// writeFile，原来的四条用例照样全绿。根因是它们全在断言**写完之后的终态**，而原子性
// 的价值只在**中途**兑现。终态测不出过程，只有观察调用序列才行。
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    rename: vi.fn(actual.rename),
  }
})

// eslint 上方注释：mock 必须在被测模块 import 之前声明，vitest 会自动提升
import { mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises'

import { atomicWrite, readText, readTextIfExists } from '../../src/main/services/fsio.ts'
import { sepiaPaths } from '../../src/main/services/paths.ts'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sepia-fsio-'))
  vi.mocked(writeFile).mockClear()
  vi.mocked(rename).mockClear()
})
afterEach(() => {
  dir = ''
})

describe('原子写', () => {
  it('**过程必须是 tmp → rename**：writeFile 落在临时路径、rename 把它挪成目标（附录 C.1）', async () => {
    const target = join(dir, 'a.json')
    expect(await atomicWrite(target, '{"a":1}\n')).toEqual({ ok: true, value: undefined })

    // 这三条断言的是**调用序列**，不是终态——直接 writeFile(target) 的实现过不了任何一条：
    // 1. writeFile 的落点绝不允许是目标本身（那正是"截断旧文件再写"的非原子路径）
    const writeTargets = vi.mocked(writeFile).mock.calls.map((call) => String(call[0]))
    expect(writeTargets).not.toContain(target)
    expect(writeTargets.some((p) => p.endsWith('.tmp'))).toBe(true)
    // 2. rename 必须被调用恰好一次
    expect(vi.mocked(rename)).toHaveBeenCalledTimes(1)
    // 3. 且方向是 tmp → 目标
    const [from, to] = vi.mocked(rename).mock.calls[0]!
    expect(String(from)).toMatch(/\.tmp$/)
    expect(String(to)).toBe(target)

    expect(await readFile(target, 'utf8')).toBe('{"a":1}\n')
  })

  it('目录不存在时自动建出来', async () => {
    const target = join(dir, 'deep', 'nested', 'b.json')
    expect((await atomicWrite(target, 'x')).ok).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('x')
  })

  it('成功后不留临时文件', async () => {
    await atomicWrite(join(dir, 'c.json'), 'x')
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('失败时原文件不被破坏，也不留临时文件', async () => {
    const target = join(dir, 'keep.json')
    await writeFile(target, 'ORIGINAL', 'utf8')
    // 往一个"父路径是文件"的位置写，rename 必失败
    const impossible = join(target, 'child.json')
    expect((await atomicWrite(impossible, 'NEW')).ok).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('ORIGINAL')
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})

describe('读', () => {
  it('文件不存在：readTextIfExists 给 null，readText 报错——两者含义不同，不许混', async () => {
    const missing = join(dir, 'nope.json')
    expect(await readTextIfExists(missing)).toEqual({ ok: true, value: null })
    expect((await readText(missing)).ok).toBe(false)
  })
})

describe('纪律 20：应用自有文件只写 ~/.sepia', () => {
  it('四个路径全在 ~/.sepia 之下，没有一个散落到 XDG', () => {
    const paths = sepiaPaths('/home/someone')
    expect(paths.home).toBe('/home/someone/.sepia')
    expect(paths.config).toBe('/home/someone/.sepia/config.json')
    expect(paths.session).toBe('/home/someone/.sepia/session.json')
    for (const value of Object.values(paths)) {
      expect(value.startsWith('/home/someone/.sepia')).toBe(true)
    }
  })
})
