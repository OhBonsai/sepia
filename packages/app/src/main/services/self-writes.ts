import type { SelfWriteRecord } from '@sepia/core'

// 「最近自写记录」环形表——**这是 L2（Stage 5a，160 §1.1〇-3）声明的共享接缝**。
//
// 接口形状由 L2 定，本期只读；L2 未合并期先用这份本地桩开发（170 §1.1〇-3）。
// rebase 到合并后的 master 时：若 L2 的写盘管线已经维护同一张表，
// **删掉这个文件、把 import 换成 L2 那份**，别让两张表并存——两张表各记一半，
// 回声抑制就会漏，而漏的表现是「保存一次自我重载一次」，很难一眼看出根因。
//
// 为什么是环形表而不是 Set：记录必须**有界**。写作一整天下来自写成千上万次，
// 无界表既吃内存又让 isSelfWrite 的线性扫描越来越慢，而三秒之前的记录已经没用了
// （TTL 由 core 的 SELF_WRITE_TTL_MS 裁）。

/** 容量取「一次连续写作里可能挤在 TTL 窗口内的自写数」的宽松上限。 */
const CAPACITY = 64

const ring: SelfWriteRecord[] = []

/**
 * 记一次自写。`mtimeMs` 为 null 表示这次是删除（自己删的也不该触发重载）。
 *
 * 调用点必须是**写盘真的成功之后**：失败的写没有改动磁盘，记下来只会抑制掉
 * 一次真的外部变更。
 */
export function noteSelfWrite(path: string, mtimeMs: number | null, atMs: number = Date.now()): void {
  ring.push({ path, mtimeMs, atMs })
  if (ring.length > CAPACITY) ring.splice(0, ring.length - CAPACITY)
}

export function recentSelfWrites(): readonly SelfWriteRecord[] {
  return ring
}

/** 只给测试用：清表。生产路径没有「忘掉自写」的需求。 */
export function resetSelfWrites(): void {
  ring.length = 0
}
