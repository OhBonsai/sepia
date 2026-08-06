// book 身份（T-34 / 160 §1.1 三）：`~/.sepia/books/<book-id>/`。
//
// **按路径算稳定散列**，不生成随机 id 存进 book——book 是 git repo，往里塞一个
// Sepia 自己的 id 文件，就等于让别人 clone 你的笔记本时连 id 一起 clone 走。
// 散列在外面，book 里一个字节都不多。
//
// 代价写明白：**路径变了 id 就变了**（移动 book = 锚点看起来全丢）。MVP 接受这个代价，
// 「重新关联」命令归 b 期——那正是 `meta.json` 记原路径的用处。

/** FNV-1a，跑两轮不同 offset 拼成 64 位。core 是叶子包，不引 crypto。 */
function fnv1a(text: string, offset: number): number {
  let hash = offset
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    // 32 位 FNV 素数 16777619，用移位凑乘法避免精度丢失
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * book 路径 → book-id（16 位十六进制）。
 *
 * 传进来的路径**必须已经是 realpath**（与「最近自写记录」同一条要求，同一个理由：
 * macOS 的 `/var` 与 `/private/var` 是同一个地方的两个名字，散列出来却是两个 book）。
 */
export function bookId(realPath: string): string {
  const normalized = realPath.replace(/\/+$/, '')
  const high = fnv1a(normalized, 0x811c9dc5)
  const low = fnv1a(`${normalized}#`, 0x01000193)
  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`
}

/** book 的元信息（`~/.sepia/books/<id>/meta.json`）。记原路径，为 b 期的「重新关联」留线索。 */
export interface BookMeta {
  version: number
  /** 记录时的 realpath。与当前路径不一致 = book 被移动过 */
  path: string
}

export const BOOK_META_VERSION = 1
