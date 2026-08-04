import type { AppConfig } from '../types/index.ts'

// `~/.sepia/config.json` 的默认值与容错合并。
//
// 三条来自架构 §4.5 的要求，本 stage 全部兑现：
//   1. 文件只存与默认值的**差异**——所以合并时默认值在下、文件在上
//   2. 带 `version`
//   3. **未识别字段保留**——不许在读写往返中丢掉未来版本或用户手写的字段

export const CONFIG_VERSION = 1

export const DEFAULT_CONFIG: AppConfig = {
  version: CONFIG_VERSION,
  theme: 'system',
}

const THEME_MODES = new Set(['system', 'light', 'dark'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把磁盘上的内容合并到默认值上。
 * **任何形状的输入都必须返回一个可用的 config**——损坏的配置不该让应用起不来。
 *
 * @returns `config` 是合并后的可用值；`unknown` 是原样保留的未识别字段（写回时要带上）
 */
export function mergeConfig(raw: unknown): { config: AppConfig; unknown: Record<string, unknown> } {
  if (!isRecord(raw)) return { config: { ...DEFAULT_CONFIG }, unknown: {} }

  const theme = raw['theme']
  const preserved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key !== 'version' && key !== 'theme') preserved[key] = value
  }

  return {
    config: {
      version: CONFIG_VERSION,
      theme: typeof theme === 'string' && THEME_MODES.has(theme) ? (theme as AppConfig['theme']) : DEFAULT_CONFIG.theme,
    },
    unknown: preserved,
  }
}

/** 写回时只落与默认值的差异，外加 `version` 与保留下来的未识别字段。 */
export function configToDisk(
  config: AppConfig,
  preserved: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...preserved, version: CONFIG_VERSION }
  if (config.theme !== DEFAULT_CONFIG.theme) out['theme'] = config.theme
  return out
}
