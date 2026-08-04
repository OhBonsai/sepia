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
  provider: {},
  model: null,
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
  const provider = raw['provider']
  const model = raw['model']
  const KNOWN = new Set(['version', 'theme', 'provider', 'model'])
  const preserved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN.has(key)) preserved[key] = value
  }

  return {
    config: {
      version: CONFIG_VERSION,
      theme: typeof theme === 'string' && THEME_MODES.has(theme) ? (theme as AppConfig['theme']) : DEFAULT_CONFIG.theme,
      // provider 的内部形状由引擎裁（它有自己的 schema），我们只保证是个对象——
      // 越俎代庖地校验它，等于把引擎的 schema 抄一份到这里，升 tag 就会漂。
      provider: isRecord(provider) ? provider : DEFAULT_CONFIG.provider,
      model: typeof model === 'string' && model.includes('/') ? model : DEFAULT_CONFIG.model,
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
  if (Object.keys(config.provider).length > 0) out['provider'] = config.provider
  if (config.model !== null) out['model'] = config.model
  return out
}

/**
 * 把 `providerID/modelID` 拆开。拆不出来（格式不对、缺一半）一律返回 null——
 * 宁可用引擎侧默认，也不要把半截字符串当模型名发出去。
 */
export function parseModel(value: string | null): { providerID: string; modelID: string } | null {
  if (value === null) return null
  const cut = value.indexOf('/')
  if (cut <= 0 || cut === value.length - 1) return null
  return { providerID: value.slice(0, cut), modelID: value.slice(cut + 1) }
}
