import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it } from 'vitest'

import * as registry from '../../src/main/windows/registry'

const fakeWindow = (id: number): BrowserWindow => ({ id }) as unknown as BrowserWindow

describe('多窗口注册表', () => {
  beforeEach(() => registry.reset())

  it('按 id 登记与查找', () => {
    const win = fakeWindow(7)
    registry.register(win)
    expect(registry.find(7)).toBe(win)
    expect(registry.count()).toBe(1)
  })

  it('注销后不再出现在 all() 里', () => {
    registry.register(fakeWindow(1))
    registry.register(fakeWindow(2))
    registry.unregister(1)
    expect(registry.all().map((w) => w.id)).toEqual([2])
  })

  it('同 id 重复登记不会重复计数', () => {
    registry.register(fakeWindow(3))
    registry.register(fakeWindow(3))
    expect(registry.count()).toBe(1)
  })
})
