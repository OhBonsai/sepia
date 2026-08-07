// 快捷键看板的纯逻辑（180 §1.2，D-32 / F23）。
//
// **它是只读看板，不是命令面板**（non-goals 表 2 明确拒绝；T-03：「不做命令面板 UI」）。
// 这里只回答三个问题：键怎么显示、搜什么命中、此刻能不能按。执行一概不在这条路上。
//
// 放在 core 而不是 app：全是纯函数，能被单测直接盯住，而"一屏放不放得下"这类
// 判定必须在真窗口里量（smoke 的活）。两层各管各的。

/** 五组分类（D-32 ②）。顺序即看板里的呈现顺序。 */
export const KEY_GROUPS = ['inline', 'block', 'agent', 'file', 'trigger'] as const
export type KeyGroup = (typeof KEY_GROUPS)[number]

/** 看板里的一行。`keys` 为空 = 这条命令没绑键——**照样列出来**，见下。 */
export interface KeyEntry {
  id: string
  /** 已经解析成人话的功能名（CopyKey 的解析在 app 侧做，core 不认识那张表的具体值） */
  label: string
  group: KeyGroup
  /** CM6 风格的键位描述，如 `Mod-Shift-h`。undefined = 没绑键。 */
  spec?: string
  /** 此刻能不能按。false = 置灰（D-32 ⑤）。 */
  available: boolean
}

/**
 * `Mod-Shift-h` → `['⌘', '⇧', 'H']`。
 *
 * **组合键并排、不加「+」**（D-32 ③ / F23）：`⌘⇧H` 比 `⌘+⇧+H` 更像键盘上的样子，
 * 也更短——而"一屏放下"是这块看板的硬约束，每个加号都在跟它作对。
 *
 * `Mod` 在 mac 上是 ⌘、其他平台是 Ctrl。这里按 mac 出（MVP 只发 mac），
 * 平台参数留着，免得将来要改的时候得动调用方。
 */
export function keyCaps(spec: string, platform: 'mac' | 'other' = 'mac'): string[] {
  const symbols: Record<string, string> = {
    Mod: platform === 'mac' ? '⌘' : 'Ctrl',
    Cmd: '⌘',
    Meta: '⌘',
    Shift: '⇧',
    Alt: platform === 'mac' ? '⌥' : 'Alt',
    Ctrl: platform === 'mac' ? '⌃' : 'Ctrl',
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: '↵',
    Backspace: '⌫',
  }
  return spec.split('-').map((part) => symbols[part] ?? (part.length === 1 ? part.toUpperCase() : part))
}

/**
 * 搜索过滤（D-32 ④）：**打「加粗」或「B」都命中**。
 *
 * 返回的是**命中的 id 集合**而不是过滤后的数组——因为约束是「只隐藏不重排」：
 * 看板必须原地把没命中的藏掉，位置一个都不动。返回数组的话调用方几乎必然
 * 会拿它重新渲染一遍，顺序就变了。**类型上就不给它重排的机会。**
 */
export function matchKeys(entries: KeyEntry[], query: string): Set<string> {
  const q = query.trim().toLowerCase()
  if (q === '') return new Set(entries.map((entry) => entry.id))
  const hit = new Set<string>()
  for (const entry of entries) {
    if (entry.label.toLowerCase().includes(q)) {
      hit.add(entry.id)
      continue
    }
    // 键位那一侧：`b` 要能命中 `⌘B`，`⌘b` 也要能。把键帽拼起来一起比。
    const caps = entry.spec === undefined ? '' : keyCaps(entry.spec).join('').toLowerCase()
    if (caps !== '' && caps.includes(q)) hit.add(entry.id)
  }
  return hit
}

/** 按组分桶，组内保持传入顺序。空组不返回——看板里不留空标题。 */
export function groupKeys(entries: KeyEntry[]): { group: KeyGroup; entries: KeyEntry[] }[] {
  return KEY_GROUPS.map((group) => ({ group, entries: entries.filter((entry) => entry.group === group) })).filter(
    (bucket) => bucket.entries.length > 0,
  )
}
