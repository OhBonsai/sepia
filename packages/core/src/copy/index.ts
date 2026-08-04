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

  'empty.hint': '还没有打开任何 page',
  'empty.open': '打开一个 .md',

  'error.open.failed': '打不开这个文件',
  'error.save.failed': '保存失败',
  'error.page.missing': '上次的 page 已经不在原处了',
} as const

export type CopyKey = keyof typeof copy

export function t(key: CopyKey): string {
  return copy[key]
}
