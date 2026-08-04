// @sepia/editor —— CM6 扩展、widget、markdown 结构判定（lezer 住在这里，不在 core）。
// 刻意不依赖 @sepia/ui（只共享变量名，T-20）与 @sepia/agent（能力上提到 app 装配）。
//
// 本 stage 只有纯文本编辑的最小扩展集；`extensions/`（装饰）与 `widgets/` 归 Stage 2。

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
