// 「最近自写记录」——**L2 与 L3 唯一的共享接缝**（160/170 §1.1〇-3）。
//
// 要解决的事只有一件：watcher 报来一次文件变更，**怎么知道那是我们自己刚写的**。
// 分不出来的后果不是多刷新一次，是**回声成环**：自写 → watcher 报变更 → 当成外部改动
// 去重载/对账 → 又触发写 → 再报变更。
//
// 住在 `core` 而不是 `app/main`，是 CLAUDE.md 那条「不依赖 Electron 又能独立测的逻辑
// 一律下沉」——这里全是纯逻辑，`stat` 那一步（唯一碰 fs 的）留在 main 的写盘管线里。
// 于是 L3 不必等 L2 的管线落地，对着这个类型先写自己的消费端即可。

/**
 * 一条自写指纹。**三个字段都是"写完之后"的事实**，不是写之前的意图——
 * 要判等的是"盘上现在这个版本"，而不是"我们打算写什么"。
 */
export interface SelfWriteEntry {
  /**
   * 绝对路径，**必须是 realpath（符号链接已解析）**。
   *
   * 不是洁癖：macOS 上 `/var` 是 `/private/var` 的符号链接，同一个文件两侧拿到的字符串
   * 能完全不同（Stage 4 的 a4 装置就在这上面栽过一次，断言拿 `/var/...` 去比引擎打的
   * `/private/var/...`，比不上）。两侧都归一化到 realpath，这条缝才对得齐。
   */
  path: string
  /** 写完后 stat 到的 mtime（毫秒）。 */
  mtimeMs: number
  /** 写完后的字节数。mtime 分辨率不够时的第二道判据。 */
  size: number
}

export interface SelfWriteLog {
  /** 写盘**成功之后**登记一条。失败的写不该登记——盘上没变化，也就不会有回声。 */
  record(entry: SelfWriteEntry): void
  /**
   * 这次变更是不是我们自己写的？**命中即消费**（返回 true 并把那条记录取走）。
   *
   * 为什么是消费型而不是纯查询：一条自写只该挡**一次**回声。留着不消费的话，
   * 一个恰好同指纹的真外部改动会被永久吞掉；消费掉，最坏也只误吞一次。
   * 「宁可漏挡一次，不可永久失明」——与锚点那条「宁可孤儿不误挂」同一种取舍。
   */
  claim(entry: SelfWriteEntry): boolean
  /** 当前在册条数（过期的不算）。给测试与诊断用。 */
  readonly size: number
}

export interface SelfWriteLogOptions {
  /** 环形表容量。默认 64：一次批量保存也远到不了。 */
  capacity?: number
  /**
   * 记录存活时长（毫秒）。默认 5000。
   *
   * 回声是**毫秒级**到达的；超过这个窗口还来的同指纹变更，更可能是真外部改动。
   * 窗口开太大 = 长时间对真改动失明，开太小 = watcher 慢一拍就漏挡。
   */
  ttlMs?: number
  /** 时钟注入（测试用）。默认 `Date.now`。 */
  now?: () => number
}

interface Stamped extends SelfWriteEntry {
  at: number
}

function same(a: SelfWriteEntry, b: SelfWriteEntry): boolean {
  return a.path === b.path && a.mtimeMs === b.mtimeMs && a.size === b.size
}

/**
 * 建一份自写记录表。
 *
 * **判据是 path + mtime + size，不是内容哈希**：哈希要把刚写的内容再读一遍算一遍，
 * 每次保存都付这个钱；而漏网场景（窗口内、同一路径、mtime 与字节数都撞上的**真**外部改动）
 * 少到可以忽略，且消费型语义把它的代价封顶在"误吞一次"。
 */
export function createSelfWriteLog(options: SelfWriteLogOptions = {}): SelfWriteLog {
  const capacity = options.capacity ?? 64
  const ttlMs = options.ttlMs ?? 5_000
  const now = options.now ?? Date.now
  let entries: Stamped[] = []

  const sweep = (at: number): void => {
    entries = entries.filter((entry) => at - entry.at < ttlMs)
  }

  return {
    record(entry) {
      const at = now()
      sweep(at)
      entries.push({ ...entry, at })
      // 环形：满了就丢最旧的。丢掉的那条最多让一次回声漏网，
      // 而无界增长是内存泄漏——两害相权。
      if (entries.length > capacity) entries = entries.slice(entries.length - capacity)
    },
    claim(entry) {
      const at = now()
      sweep(at)
      const index = entries.findIndex((candidate) => same(candidate, entry))
      if (index === -1) return false
      entries.splice(index, 1)
      return true
    },
    get size() {
      sweep(now())
      return entries.length
    },
  }
}
