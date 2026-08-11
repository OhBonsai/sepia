// Lucide 图标的**内嵌资产**（vendored）。
//
// 来源：`lucide-static` v1.31.0 ｜ 协议：**ISC**（见同目录 LICENSE）
// 上游：https://github.com/lucide-icons/lucide
//
// **为什么是拷贝而不是依赖**（190 附录 A-6：依赖是永久的，能拷就不引）：
// 我们只用 25 个图标，而 lucide 有两千多个。引运行时依赖换来的是
// "以后加图标不用手动拷"，付出的是一条永久的供应链边 + 打包体积 + 版本漂移。
// 拷进来之后它就是我们仓库里的一段字符串——不会自己变，也不会在某天 breaking。
//
// **本文件由脚本生成**（`scripts/vendor-icons.mjs`），不要手改：
// 要加图标就把名字加进那个脚本的清单里重跑一次，diff 里看得见加了什么。
//
// 每条只存 `<svg>` 的**内容**，不存根标签——根标签上的 stroke-width / size 由
// `<Icon>` 统一给（图标要统一，就不能让每一份各带各的属性）。

/** 可用图标名。**字面量联合**——写错名字编译期就红（与纪律 5 同一个手法）。 */
export type IconName =
  | 'house'
  | 'plus'
  | 'x'
  | 'activity'
  | 'table-properties'
  | 'link'
  | 'message-square'
  | 'search'
  | 'square-pen'
  | 'settings-2'
  | 'circle-help'
  | 'keyboard'
  | 'pen-tool'
  | 'file-text'
  | 'bot'
  | 'cpu'
  | 'sparkle'
  | 'plug'
  | 'send'
  | 'external-link'
  | 'chevron-up'
  | 'chevron-down'
  | 'rotate-cw'
  | 'workflow'
  | 'image'

export const ICON_PATHS: Record<IconName, string> = {
  'house':
    '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /> <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />',
  'plus':
    '<path d="M5 12h14" /> <path d="M12 5v14" />',
  'x':
    '<path d="M18 6 6 18" /> <path d="m6 6 12 12" />',
  'activity':
    '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />',
  'table-properties':
    '<path d="M15 3v18" /> <rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M21 9H3" /> <path d="M21 15H3" />',
  'link':
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /> <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
  'message-square':
    '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />',
  'search':
    '<path d="m21 21-4.34-4.34" /> <circle cx="11" cy="11" r="8" />',
  'square-pen':
    '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /> <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />',
  'settings-2':
    '<path d="M14 17H5" /> <path d="M19 7h-9" /> <circle cx="17" cy="17" r="3" /> <circle cx="7" cy="7" r="3" />',
  'circle-help':
    '<circle cx="12" cy="12" r="10" /> <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /> <path d="M12 17h.01" />',
  'keyboard':
    '<path d="M10 8h.01" /> <path d="M12 12h.01" /> <path d="M14 8h.01" /> <path d="M16 12h.01" /> <path d="M18 8h.01" /> <path d="M6 8h.01" /> <path d="M7 16h10" /> <path d="M8 12h.01" /> <rect width="20" height="16" x="2" y="4" rx="2" />',
  'pen-tool':
    '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z" /> <path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18" /> <path d="m2.3 2.3 7.286 7.286" /> <circle cx="11" cy="11" r="2" />',
  'file-text':
    '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /> <path d="M10 9H8" /> <path d="M16 13H8" /> <path d="M16 17H8" />',
  'bot':
    '<path d="M12 8V4H8" /> <rect width="16" height="12" x="4" y="8" rx="2" /> <path d="M2 14h2" /> <path d="M20 14h2" /> <path d="M15 13v2" /> <path d="M9 13v2" />',
  'cpu':
    '<path d="M12 20v2" /> <path d="M12 2v2" /> <path d="M17 20v2" /> <path d="M17 2v2" /> <path d="M2 12h2" /> <path d="M2 17h2" /> <path d="M2 7h2" /> <path d="M20 12h2" /> <path d="M20 17h2" /> <path d="M20 7h2" /> <path d="M7 20v2" /> <path d="M7 2v2" /> <rect x="4" y="4" width="16" height="16" rx="2" /> <rect x="8" y="8" width="8" height="8" rx="1" />',
  'sparkle':
    '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />',
  'plug':
    '<path d="M12 22v-5" /> <path d="M15 8V2" /> <path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z" /> <path d="M9 8V2" />',
  'send':
    '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /> <path d="m21.854 2.147-10.94 10.939" />',
  'external-link':
    '<path d="M15 3h6v6" /> <path d="M10 14 21 3" /> <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />',
  'chevron-up':
    '<path d="m18 15-6-6-6 6" />',
  'chevron-down':
    '<path d="m6 9 6 6 6-6" />',
  'rotate-cw':
    '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /> <path d="M21 3v5h-5" />',
  'workflow':
    '<rect width="8" height="8" x="3" y="3" rx="2" /> <path d="M7 11v4a2 2 0 0 0 2 2h4" /> <rect width="8" height="8" x="13" y="13" rx="2" />',
  'image':
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <circle cx="9" cy="9" r="2" /> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />',
}
