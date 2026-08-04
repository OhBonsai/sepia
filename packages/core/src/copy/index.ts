// 界面文案。main 与 renderer 双可达（T-21），所以住在 core。
//
// 纪律 5：command registry 存 key 不存字符串。强制手段是**类型**——
// `CopyKey` 是下面这张表的键的联合，把「保存」这种字面串传进去编译不过。
// key 一律用点分 ASCII，与人类可读的文案在形状上就分得开。

export const copy = {
  'app.name': 'Sepia',
  'app.loading': '正在打开…',
  'app.untitled': '未命名',

  'cmd.file.open': '打开…',
  'cmd.file.save': '保存',
  'cmd.agent.summon': '召唤 Agent',

  'empty.hint': '还没有打开任何 page',
  'empty.open': '打开一个 .md',

  'error.open.failed': '打不开这个文件',
  'error.save.failed': '保存失败',
  'error.page.missing': '上次的 page 已经不在原处了',

  'cmd.edit.find': '查找',
  'cmd.edit.replace': '替换',
  'search.placeholder': '查找…',
  'search.replace.placeholder': '替换为…',
  'search.next': '下一个',
  'search.previous': '上一个',
  'search.replace.one': '替换',
  'search.replace.all': '全部替换',
  'search.close': '关闭',
  'search.count.none': '无结果',

  // W12：Agent 缺席。提示是细线不是弹窗——纸照常可写，这句话必须一直成立。
  'agent.absent.line': 'Agent 缺席，纸照常可写',
  'agent.k.absent': 'Agent 缺席。纸照常可写，稍后再试 ⌘K',
  'agent.k.starting': 'Agent 正在就位…',
} as const

export type CopyKey = keyof typeof copy

export function t(key: CopyKey): string {
  return copy[key]
}
