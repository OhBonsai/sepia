import {
  SearchQuery,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  setSearchQuery,
} from '@codemirror/search'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import type { SearchApi, SearchState } from './search-types.ts'

// 查找替换：CM6 的 search 能力 + 自绘 UI（架构 §4.9）。
// 面板本体是 app 侧的 React（ui 包出 dumb 组件），**这里只暴露驱动接口**——
// ui 不认识 CM6（editor ↮ ui），CM6 不认识 React，两边经 app 装配。

export type { SearchApi, SearchState }

export function searchExtension(): Extension {
  // top-level search 扩展带内建面板；createPanel 换成 null 面板等价于"只要状态不要 UI"
  return search({ createPanel: () => ({ dom: document.createElement('div') }) })
}

function countMatches(view: EditorView, query: SearchQuery): number {
  if (!query.search) return 0
  let count = 0
  const cursor = query.getCursor(view.state)
  while (!cursor.next().done) {
    count += 1
    if (count > 9999) break
  }
  return count
}

export function searchApi(view: EditorView): SearchApi {
  const snapshot = (): SearchState => {
    const query = getSearchQuery(view.state)
    return {
      query: query.search,
      replace: query.replace,
      caseSensitive: query.caseSensitive,
      count: countMatches(view, query),
    }
  }
  return {
    set(spec) {
      const query = new SearchQuery({
        search: spec.query,
        replace: spec.replace ?? '',
        caseSensitive: spec.caseSensitive ?? false,
        literal: true,
      })
      view.dispatch({ effects: setSearchQuery.of(query) })
      return snapshot()
    },
    next: () => {
      findNext(view)
    },
    previous: () => {
      findPrevious(view)
    },
    replaceNext: () => {
      replaceNext(view)
    },
    replaceAll: () => {
      replaceAll(view)
    },
    state: snapshot,
  }
}
