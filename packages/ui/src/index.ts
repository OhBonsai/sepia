// @sepia/ui —— 主题变量与组件。叶子包：零内部依赖，不知道领域概念。
// 徽章、线程条目这类知道领域的组件归 app，不许下沉到这里。
//
// theme.css 由消费者显式 import（`@sepia/ui/theme.css`），不在这里副作用式引入——
// 那会让任何 import 这个包的单测都被迫解析 css。

export { type ThemeVar, type ThemeVarName, themeVar } from './theme/vars.ts'
export { Loading, type LoadingProps } from './components/loading.tsx'
export { SearchPanel, type SearchPanelCopy, type SearchPanelProps } from './components/search-panel.tsx'
