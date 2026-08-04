import { type AppConfig, configToDisk, mergeConfig } from '@sepia/core'

import { atomicWrite, readTextIfExists } from './fsio.ts'
import type { SepiaPaths } from './paths.ts'

// `~/.sepia/config.json` 的读写。解析与合并的逻辑在 core（纯函数、可单测），
// 这里只负责碰磁盘——**能不依赖 Electron 的逻辑一律下沉**（001 §2.1）。

interface Loaded {
  config: AppConfig
  unknown: Record<string, unknown>
}

export async function loadConfig(paths: SepiaPaths): Promise<Loaded> {
  const read = await readTextIfExists(paths.config)
  if (!read.ok || read.value === null) return mergeConfig(undefined)
  try {
    return mergeConfig(JSON.parse(read.value))
  } catch {
    // 配置坏了就用默认值起来。**起不来的编辑器比配置错的编辑器糟得多**（不变量 1）。
    return mergeConfig(undefined)
  }
}

export async function saveConfig(paths: SepiaPaths, loaded: Loaded): Promise<void> {
  const body = `${JSON.stringify(configToDisk(loaded.config, loaded.unknown), null, 2)}\n`
  await atomicWrite(paths.config, body)
}
