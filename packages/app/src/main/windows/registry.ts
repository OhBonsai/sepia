import type { BrowserWindow } from 'electron'

// 多窗口注册表。刻意只用 `import type` 拿 electron 的类型：
// 运行期不加载 electron，因此这份逻辑能被单测直接跑（packages/app/test/main/）。

const windows = new Map<number, BrowserWindow>()

export function register(window: BrowserWindow): void {
  windows.set(window.id, window)
}

export function unregister(id: number): void {
  windows.delete(id)
}

export function find(id: number): BrowserWindow | undefined {
  return windows.get(id)
}

export function all(): BrowserWindow[] {
  return [...windows.values()]
}

export function count(): number {
  return windows.size
}

/** 测试与冷启动用：清空注册表。生产路径不该调用。 */
export function reset(): void {
  windows.clear()
}
