// SearchApi 的**纯类型**。运行时实现于 search.ts，随 @sepia/editor/markdown 子入口
// 惰性加载——静态图里只留这份类型，@codemirror/search 不进首屏 bundle。

export interface SearchState {
  query: string
  replace: string
  caseSensitive: boolean
  /** 当前文档内的命中数。0 也要显示——"0 结果"是信息，不是空白。 */
  count: number
}

export interface SearchApi {
  set(spec: { query: string; replace?: string; caseSensitive?: boolean }): SearchState
  next(): void
  previous(): void
  replaceNext(): void
  replaceAll(): void
  state(): SearchState
}
