// 设置页的**清单即数据**（190 P3，`sepia-settings.md` 是真相源）。
//
// 为什么是一张表而不是上百个手写组件：清单有四个一级、十来个二级页、上百个设置项，
// 手写一遍等于把 `sepia-settings.md` 抄进代码——**抄本必然与原本漂移**，
// 而且漂移的方向永远是"代码里少了一项，没人发现"。
//
// 表里每一项要么**真的落 config**（`key` 有值），要么**明确标成"即将推出"**
//（`pending: true`）。**不藏不删**（190 P3 明写）：依赖未建子系统的项照样列出来、
// 置灰——藏起来的话，设置页会给人"这个产品就这些功能"的错觉，
// 而真相是"这些还没做"。这两件事对用户完全不同。

export type ControlKind =
  | 'switch'
  | 'select'
  | 'segmented'
  | 'input'
  | 'number'
  | 'textarea'
  | 'path'
  | 'keybind'
  | 'readonly'
  | 'note'
  | 'button'

export interface SettingItem {
  id: string
  title: string
  description?: string
  control: ControlKind
  /** 落到 config 的键。**没有 key = 这一项还没接上任何子系统**。 */
  key?: string
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  /** 依赖尚未建成的子系统 → 置灰显示「即将推出」。 */
  pending?: boolean
  /** 本期新增 → 挂「新」角标（S4）。 */
  fresh?: boolean
}

export interface SettingSection {
  title: string
  items: SettingItem[]
}

export interface SettingPage {
  id: string
  title: string
  icon: string
  sections: SettingSection[]
}

export interface SettingGroup {
  /** 一级分组标题。**不可点**（S2）——它是标题不是路由。 */
  title: string
  pages: SettingPage[]
}

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

const SCOPE_OPTIONS = [
  { value: 'selection', label: '选中片段' },
  { value: 'page', label: '整篇' },
]

/**
 * 完整清单。**顺序与 `sepia-settings.md` 一一对应**——那份文档改了，这里跟着改，
 * 而不是反过来。
 */
export const SETTINGS: SettingGroup[] = [
  {
    title: 'Desktop App',
    pages: [
      {
        id: 'general',
        title: '通用',
        icon: '◎',
        sections: [
          {
            title: '语言',
            items: [
              {
                id: 'locale',
                title: '界面语言',
                description: 'Sepia 的显示语言',
                control: 'select',
                options: [{ value: 'zh-CN', label: '简体中文' }],
                pending: true,
              },
            ],
          },
          {
            title: '启动',
            items: [
              {
                id: 'startup',
                title: '启动时打开',
                description: '上次的纸 / 今日笔记 / 指定文件',
                control: 'select',
                pending: true,
              },
              { id: 'autolaunch', title: '登录时自动启动', control: 'switch', pending: true },
            ],
          },
          {
            title: '通知',
            items: [
              {
                id: 'notify.done',
                title: '后台任务完成时通知',
                description: 'markup 这类十几秒的改写不发通知',
                control: 'switch',
                pending: true,
              },
              { id: 'notify.error', title: '出错时通知', control: 'switch', pending: true },
            ],
          },
          {
            title: '更新',
            items: [
              { id: 'update.auto', title: '自动检查更新', control: 'switch', pending: true },
              { id: 'update.now', title: '立即检查', control: 'button', pending: true },
              { id: 'version', title: '当前版本', control: 'readonly' },
            ],
          },
        ],
      },
      {
        id: 'keys',
        title: '快捷键',
        icon: '▭',
        sections: [
          {
            title: '快捷键',
            items: [
              {
                id: 'keys.list',
                title: '全部快捷键',
                description: '只读速查版是 ⌘/ 唤起的快捷键看板；本页是可编辑版',
                control: 'keybind',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    title: '书写',
    pages: [
      {
        id: 'pen',
        title: '笔',
        icon: '✎',
        sections: [
          {
            title: '输入',
            items: [
              {
                id: 'tabWidth',
                title: 'Tab 缩进宽度',
                description: '空格数',
                control: 'number',
                key: 'tabWidth',
                min: 1,
                max: 8,
                fresh: true,
              },
            ],
          },
          {
            title: '保存与版本',
            items: [
              {
                id: 'autosaveDebounceMs',
                title: '自动保存延迟',
                description: '停止输入后多久写盘（毫秒）',
                control: 'number',
                key: 'autosaveDebounceMs',
                min: 100,
                max: 10_000,
              },
              {
                id: 'commit',
                title: '静默 git commit',
                description: '开（不可关）——关了它徽章 diff 就瞎了（D-19）',
                control: 'note',
              },
            ],
          },
        ],
      },
      {
        id: 'paper',
        title: '纸',
        icon: '▤',
        sections: [
          {
            title: '纸面',
            items: [
              { id: 'theme', title: '配色', control: 'segmented', key: 'theme', options: THEME_OPTIONS },
            ],
          },
          {
            title: '笔记属性',
            items: [
              {
                id: 'frontmatter',
                title: 'frontmatter 呈现',
                description: '表格 / 源码 / 隐藏',
                control: 'select',
                key: 'frontmatterView',
                options: [
                  { value: 'table', label: '表格' },
                  { value: 'source', label: '源码' },
                  { value: 'hidden', label: '隐藏' },
                ],
                fresh: true,
              },
            ],
          },
          {
            title: 'book 与附件',
            items: [
              {
                id: 'imageDirectory',
                title: '图片粘贴目录',
                description: '相对 book 根；默认 assets/（D-40）',
                control: 'input',
                key: 'imageDirectory',
                fresh: true,
              },
              {
                id: 'libraryTreeEntryLimit',
                title: '文件树条目上限',
                description: '超过就降级为只列第一层，并且说出来',
                control: 'number',
                key: 'libraryTreeEntryLimit',
                min: 50,
                max: 10_000,
              },
            ],
          },
          {
            title: '链接',
            items: [
              {
                id: 'externalLinks',
                title: '外链打开方式',
                description: '内嵌浏览器（右侧区）/ 系统浏览器',
                control: 'segmented',
                key: 'externalLinks',
                options: [
                  { value: 'embedded', label: '内嵌浏览器' },
                  { value: 'system', label: '系统浏览器' },
                ],
                fresh: true,
              },
            ],
          },
        ],
      },
      {
        id: 'companion',
        title: '伴',
        icon: '◑',
        sections: [
          {
            title: '上下文',
            items: [
              {
                id: 'contextScope',
                title: '上下文范围',
                control: 'select',
                key: 'contextScope',
                options: SCOPE_OPTIONS,
              },
              {
                id: 'contextBudgetTokens',
                title: '上下文预算',
                description: '超出就按距离衰减截断，并在浮层里说出来',
                control: 'number',
                key: 'contextBudgetTokens',
                min: 500,
                max: 100_000,
              },
            ],
          },
          {
            title: '痕迹（徽章）',
            items: [
              {
                id: 'anchorFuzzyThreshold',
                title: '锚点模糊阈值',
                description: '越高越严；宁可孤儿不误挂',
                control: 'number',
                key: 'anchorFuzzyThreshold',
                min: 0,
                max: 1,
              },
            ],
          },
          {
            title: '记忆',
            items: [
              {
                id: 'memory',
                title: '启用记忆',
                description: '让 Agent 记住写作偏好与术语习惯',
                control: 'switch',
                pending: true,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    title: 'Agent',
    pages: [
      {
        id: 'models',
        title: '模型',
        icon: '◉',
        sections: [
          {
            title: '可用模型',
            items: [
              {
                id: 'model',
                title: '默认模型',
                description: '⌘K 改写的主力；浮层内仍可临时切换',
                control: 'select',
                key: 'model',
              },
            ],
          },
        ],
      },
      {
        id: 'skills',
        title: '技能',
        icon: '✦',
        sections: [{ title: '技能', items: [{ id: 'skills', title: '技能列表', control: 'note', pending: true }] }],
      },
      {
        id: 'connectors',
        title: '连接器',
        icon: '⌗',
        sections: [
          {
            title: '连接器',
            items: [
              {
                id: 'connectors',
                title: '连接器列表',
                description: '权限：只读——写盘与执行命令在 Sepia 里不存在（D-13）',
                control: 'note',
                pending: true,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    title: '输出',
    pages: [
      {
        id: 'wechat',
        title: '微信公众号',
        icon: '✉',
        sections: [
          { title: '账号', items: [{ id: 'wechat', title: '已授权的账号', control: 'readonly', pending: true }] },
        ],
      },
    ],
  },
]

/** 摊平成一张"页 id → 页"的表，导航与内容区共用。 */
export function settingPages(): SettingPage[] {
  return SETTINGS.flatMap((group) => group.pages)
}
