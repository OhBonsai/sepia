// @sepia/editor —— CM6 扩展、widget、markdown 结构判定（lezer 住在这里，不在 core）。
// 刻意不依赖 @sepia/ui（只共享变量名，T-20）与 @sepia/agent（能力上提到 app 装配）。
//
// 两层：baseExtensions（Stage 1 纯文本最小集）+ markdownExtensions（Stage 2 语法层）。

export {
  baseExtensions,
  createState,
  mountEditor,
  readDoc,
  type BaseExtensionOptions,
  type MountOptions,
  type MountedEditor,
} from './base.ts'
export {
  BOM,
  detectLineEnding,
  readFidelity,
  restoreBom,
  stripBom,
  writeFidelity,
  type LineEnding,
  type TextFidelity,
} from './bytes.ts'
// markdown 语法层**不在这里导出**——走 `@sepia/editor/markdown` 子入口异步加载，
// 静态导出会把它拖进 renderer 首屏 bundle（见 base.ts MountOptions.syntax 的注释）。
export type { MarkdownOptions } from './markdown.ts'
export type { SearchApi, SearchState } from './extensions/search-types.ts'
