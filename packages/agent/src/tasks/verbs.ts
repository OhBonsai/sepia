// 动词列（D-29 的三阶段家具第一阶段；W6）。
//
// **住在 agent 而不是 core/copy**（D-41 / 150 §1.3）：动词不是界面文案，是 Agent 配置——
// 它们是 user message 的措辞模板，会随任务、随语言、随模型能力变，而界面文案不会。
// 混进 copy 表就等于把「改一个 prompt」变成「改一次界面文案」。
//
// **动词绝不进 system prompt**（纪律 21）：每个动词一份 system prompt，
// provider 的缓存前缀立刻碎掉（架构 §4.3b 条目 3）。
//
// D-41 潜伏态：按语言分组的**形状**建好，MVP 只填 zh-CN 一组。加一门语言 = 加一个 key，
// 不用动结构——但本 stage **不加第二组**（150 §1.2 刹车表）。

/** 选中对象的类别。动词列随它变——这是 W6 里「一列随选中对象变化的动词」那句话。 */
export type SelectionKind = 'text' | 'code' | 'image' | 'heading' | 'quote'

export interface Verb {
  /** 稳定标识，用于打点与测试，不直接示人。 */
  id: string
  /** 按钮上的字，也是送进 user message 的措辞。 */
  label: string
}

type VerbTable = Record<SelectionKind, readonly Verb[]>

const ZH_CN: VerbTable = {
  text: [
    { id: 'polish', label: '润色' },
    { id: 'shorten', label: '精简' },
    { id: 'expand', label: '扩写' },
    { id: 'plain', label: '说人话' },
  ],
  code: [
    { id: 'explain', label: '加注释' },
    { id: 'simplify', label: '简化' },
    { id: 'rename', label: '改好名字' },
  ],
  image: [
    { id: 'alt', label: '写替代文字' },
    { id: 'caption', label: '写图注' },
  ],
  heading: [
    { id: 'sharpen', label: '更准确' },
    { id: 'shorten', label: '更短' },
  ],
  quote: [
    { id: 'summarize', label: '提炼' },
    { id: 'attribute', label: '补出处' },
  ],
}

/** 语言 → 动词表。MVP 只有一门语言，形状是为 D-41 留的。 */
const VERBS: Record<string, VerbTable> = { 'zh-CN': ZH_CN }

const DEFAULT_LOCALE = 'zh-CN'

export function verbsFor(kind: SelectionKind, locale: string = DEFAULT_LOCALE): readonly Verb[] {
  return (VERBS[locale] ?? ZH_CN)[kind]
}
