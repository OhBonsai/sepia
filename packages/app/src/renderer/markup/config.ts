import { DEFAULT_CONFIG, type AppConfig } from '@sepia/core'

// markup 的两个配置项，由 main 经 argv → 根节点属性交过来（见 preload/index.ts）。
// **不经 window.api**，所以纪律 1 不适用——这里读的是 DOM，不是桥。

type MarkupConfig = Pick<AppConfig, 'contextScope' | 'contextBudgetTokens' | 'autosaveDebounceMs'>

/**
 * 读一次就定死。属性缺失或形状不对一律退回默认值——
 * 配置读不出来不该让 ⌘K 用不了（不变量 1 的精神：能降级就降级，不要罢工）。
 */
export function markupConfig(): MarkupConfig {
  const raw = document.documentElement.getAttribute('data-sepia-markup')
  if (raw === null) return DEFAULT_CONFIG
  const [scope, budget, autosave] = raw.split(',')
  const parsedBudget = Number(budget)
  const parsedAutosave = Number(autosave)
  return {
    contextScope: scope === 'selection' ? 'selection' : DEFAULT_CONFIG.contextScope,
    contextBudgetTokens:
      Number.isInteger(parsedBudget) && parsedBudget > 0 ? parsedBudget : DEFAULT_CONFIG.contextBudgetTokens,
    autosaveDebounceMs:
      Number.isInteger(parsedAutosave) && parsedAutosave > 0
        ? parsedAutosave
        : DEFAULT_CONFIG.autosaveDebounceMs,
  }
}
