import { realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { net, protocol } from 'electron'

import { ASSET_SCHEME, assetPath, isInsideRoot } from '@sepia/core'

// `sepia-asset://` 的注册与读盘（人裁 2026-08-06，170 人工轮 5b）。
// 判定逻辑在 core（纯函数、可单测），这里只做两件必须要 Electron 的事：
// 注册 scheme、把放行的请求交给 `net.fetch`。
//
// **放行的根是"用户这次会话真的打开过的目录"**，不是"整个磁盘"。
// 于是这个新增暴露面比它替换掉的 `file://` 更窄——`file://` 能读到任何东西。

const roots = new Set<string>()

/**
 * 登记一个可读根（book 目录，或游离 page 所在目录）。
 *
 * **存 realpath**：macOS 的 `/var → /private/var` 会让同一个目录以两种字符串出现，
 * 只比字面量会时而在根内时而在根外（本项目已经踩过三次）。
 */
export async function allowAssetRoot(dir: string): Promise<void> {
  try {
    roots.add(await realpath(dir))
  } catch {
    // 目录不在了就不登记。**不抛**——这条路是给图片预览用的，
    // 它失败的正确形态是"图显示不出来"，不是"打开 page 失败"。
  }
}

/** 只给测试用：清空登记。 */
export function resetAssetRoots(): void {
  roots.clear()
}

/**
 * 必须在 `app.whenReady()` **之前**调用——Electron 规定特权 scheme 只能在 ready 前声明。
 *
 * · `standard`：让它有 host/path 结构，`new URL()` 才解得动
 * · `secure`：算作安全上下文，否则 http 页面引用它会被当混合内容拦掉（dev 态正是 http）
 * · `supportFetchAPI: false`：只给 `<img>` 用，不开放给页面脚本 fetch——能不给的就不给
 */
export function declareAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false } },
  ])
}

export function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const requested = assetPath(request.url)
    if (requested === null) return new Response('bad request', { status: 400 })
    let real: string
    try {
      real = await realpath(requested)
    } catch {
      return new Response('not found', { status: 404 })
    }
    // **realpath 之后再判根**：符号链接是绕过限制的常规手法——book 里放一个指向
    // `~/.ssh` 的链接，只看请求路径就会放行。
    if (![...roots].some((root) => isInsideRoot(root, real))) {
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(real).toString())
  })
}
