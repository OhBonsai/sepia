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

  // ⌘/ 快捷键看板（D-32 / F23）。**只读看板，不是命令面板**。
  'keys.title': '快捷键',
  'keys.search': '搜快捷键…',
  'keys.group.inline': '行内格式',
  'keys.group.block': '块',
  'keys.group.agent': 'Agent',
  'keys.group.file': '文件与视图',
  'keys.group.trigger': '行内触发',
  'keys.unbound': '未绑定',
  'keys.settings.hint': '在 设置 › 快捷键 里可以改键',
  'cmd.keys.board': '快捷键看板',

  // ⌘⇧I 信息浮层（D-30）。只读，不放操作。
  'cmd.info.panel': '信息',
  'info.words': '字数',
  'info.saved': '上次保存',
  'info.saved.never': '还没保存过',
  'info.commit': '最近 commit',
  'info.commit.none': '还没有 commit',
  'info.commit.failed': 'commit 失败',
  'info.threads': '线程',
  'info.orphans': '孤儿',
  'info.book': 'book',
  'info.book.none': '游离 page（不属于任何 book）',
  'info.path': '路径',
  'info.agent': 'Agent',
  'info.agent.ready': '就位',
  'info.agent.absent': '缺席',

  // 写盘终态链（架构 §4.9 后半）
  'save.retrying': '写盘失败，正在重试…',
  'save.exhausted': '写盘反复失败——纸上的字还在，但存不进磁盘',
  'close.blocked.title': '有字还没落盘',
  'close.blocked.body': '写盘一直失败，现在退出会丢掉这些字。',
  'close.blocked.quit': '仍然退出',
  'close.blocked.cancel': '取消',

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

  // W6/W7：markup 浮层的三阶段家具（D-29）。
  // 动词属于 **Agent 配置**而不是界面文案（D-41 / 150 §1.3 core 行），所以它们不在这里。
  'markup.placeholder': '想怎么改这段？',
  'markup.empty': '先选中一段文字，再按 ⌘K',
  'markup.streaming': '正在改写…',
  'markup.stop': '停止',
  'markup.apply': '落笔',
  'markup.discard': '放弃',
  'markup.retry': '重试',
  'markup.followup': '还想再改点什么？',
  'markup.reset': '重置到 diff',
  'markup.diff.original': '原文',
  'markup.diff.revised': '新文',
  'markup.failed': '这一轮没跑通，纸没有被动过',
  'markup.aborted': '已停止，纸没有被动过',
  'markup.stale': '这段文字在生成期间被改过了，没有落笔。重试或手动处理',
  'markup.model': '模型',

  // Stage 6a：纸与外部世界的冲突（架构 §4.9）。三句话都在说同一件事——
  // **纸上的字没有丢**。三选（保留我的/用外部的/看 diff）归 b 期，a 期只报事实。
  'conflict.saved': '这个文件在外部被改过。你刚敲的字已经落盘，外部那一版没有被载入',
  'conflict.removed': '这个文件在外部被删除了。内容还在纸上，⌘S 可以另存回去',
  'conflict.watcher.degraded': '文件监听在这个位置不可用，已改为切回窗口时校准',

  // Stage 5b：徽章、线程面板、还白、冲突三选（W8/W10/W11）。
  'threads.title': '这一篇上的对话',
  'threads.orphans': '暂时对不上正文的（改回去它们会回来）',
  'threads.diff.loading': '正在取 diff…',
  // 链失败时的措辞要**说清楚代价有多小**：徽章还在、对话还在，只是看不了对照
  'threads.diff.unavailable': '这次没能记上版本，对照看不了；对话还在',
  'cmd.threads.panel': '线程面板',
  'cmd.threads.hide': '还白（全隐/全显徽章）',
  // 三选：三个选项的名字要能让人在三秒内选对——选错的代价是自己的字。
  // 所以措辞里都点明"谁会被留下"，而不是只说动作。
  'conflict.choose': '这个文件在外部被改过。你刚敲的字已经落盘——外部那一版要怎么办？',
  'conflict.choice.mine': '用我的（外部那版另存备份）',
  'conflict.choice.theirs': '用外部的（我这版先备份再覆盖）',
  'conflict.choice.both': '都留着（外部那版另存为新文件）',
  'conflict.preserved': '另一版已备份到 .sepia 的 conflicts 里',

  // Stage 6b：库 UI
  'library.tree.empty': '这个文件夹里没有 .md —— 换一个文件夹作 book，或用 ⌘O 打开单个文件',
  'library.tree.degraded': '这个 book 太大了，只列出了顶层——打开子目录里的文件可用 ⌘O',
  'cmd.library.sidebar': '收起 / 展开侧边栏',
  'home.choose.book': '选择文件夹作为 book',
  'home.open.page': '打开一个 .md',
  'home.recents': '最近',

  // T-31：措辞要说清"没有自动改"——用户点了才动他的文件
  'links.pending': '别处还有引用指向旧路径，未更新：',
  'links.list': '看看改哪些',
  'links.apply': '更新',

  // Stage 6b：多 Tab
  'cmd.tab.close': '关闭这一页',
  'cmd.tab.prev': '上一页',
  'cmd.tab.next': '下一页',

  'cmd.file.new': '新建 page',
  'cmd.file.rename': '重命名',
  'cmd.file.move': '移动到…',
  'cmd.file.trash': '移到回收站',
} as const

export type CopyKey = keyof typeof copy

export function t(key: CopyKey): string {
  return copy[key]
}
