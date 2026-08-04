// Stage 0 的 shell 是一张真正的白纸：不渲染任何内容。
// 路由、布局、主题挂载、loading 态从 Stage 1 开始长（001 §2.1）。

export function App(): React.JSX.Element {
  return <div data-sepia-shell="empty" />
}
