// 本地资源的自定义特权 scheme（人裁 2026-08-06，170 人工轮 5b）。
//
// **为什么非要有它**：图片 widget 原本直接给 `<img>` 一个 `file://` URL。打包态
// renderer 由 `loadFile` 加载，同为 file 源，能加载；**dev 态由 `loadURL(http://localhost)`
// 加载，Chromium 一律拒绝 http 源加载 `file://` 子资源**——于是开发时永远看不到预览。
// 这条早在 Stage 2 就写在 `widgets/render.ts` 的注释里，排期"Stage 6 随文件域一起"。
//
// **它同时是一道收窄**，不只是补丁：`file://` 能读到磁盘上任何东西，而这个 scheme 的
// 处理器只放行**已登记根目录之内**的文件（见 app 侧 `services/assets.ts`）。
// 换句话说，新增的这一面暴露出去的比它替换掉的那一面**更小**。
//
// 这里只放**两个进程都要用的那部分**：URL 怎么拼、怎么拆、路径在不在根里。
// 注册与读盘在 app（要 Electron），判定在这儿（纯函数，能被单测直接盯住）。

/** scheme 名。改它要同时改 renderer 的 CSP 与 `registerSchemesAsPrivileged`。 */
export const ASSET_SCHEME = 'sepia-asset'

/**
 * 固定的 host。
 *
 * `standard: true` 的 scheme **必须有 host**，否则 `sepia-asset:///Users/…` 会被
 * 解析成 host=`Users`——路径当场少一截。给一个哑 host 把绝对路径原样留在 pathname 里。
 */
const ASSET_HOST = 'local'

/**
 * 绝对路径 → 资源 URL。
 *
 * 逐段 `encodeURIComponent`：文件名里的空格、`#`、`?` 与中文都得转义，否则
 * `img/我的 图.png#1` 会被当成 fragment 截断。**分隔符不能一起转**，所以逐段来。
 */
export function assetUrl(absolutePath: string): string {
  const normalized = absolutePath.replaceAll('\\', '/')
  const encoded = normalized.split('/').map(encodeURIComponent).join('/')
  return `${ASSET_SCHEME}://${ASSET_HOST}${encoded.startsWith('/') ? '' : '/'}${encoded}`
}

/** 资源 URL → 绝对路径。不是这个 scheme、或解不开，一律 null（调用方据此拒绝）。 */
export function assetPath(url: string): string | null {
  // **手工拆而不是 `new URL()`**：core 的 lib 里没有 DOM/Node 全局，为一个前缀匹配
  // 去放宽叶子包的 lib 配置是本末倒置。前缀是我们自己拼的，形状完全确定。
  const prefix = `${ASSET_SCHEME}://${ASSET_HOST}`
  if (!url.startsWith(`${prefix}/`)) return null
  try {
    const path = decodeURIComponent(url.slice(prefix.length))
    // `..` 一律不接受。**不做规范化后再放行**——正常请求里压根不会出现它，
    // 出现了就是在试探，直接拒比"洗干净再用"更不容易出错。
    if (path === '' || path.split('/').includes('..')) return null
    return path
  } catch {
    return null
  }
}

/**
 * `path` 是否落在 `root` 之内（含 root 自身）。
 *
 * **两侧都必须由调用方先 realpath**：macOS 上 `/var` 是 `/private/var` 的符号链接，
 * 只比字符串会让同一个文件时而在根内时而在根外——这个坑本项目已经踩过三次
 * （commit trailer / book-id / `git diff`）。
 */
export function isInsideRoot(root: string, path: string): boolean {
  const base = root.replace(/\/+$/, '')
  return path === base || path.startsWith(`${base}/`)
}
