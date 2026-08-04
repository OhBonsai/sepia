import { contextBridge } from 'electron'

// 纪律 2：这是 renderer 与 main 之间唯一的桥。
// 这里每加一个 key，都要同步更新 scripts/bridge-snapshot.json，
// 否则 `bun run check:bridge` 会红——目的就是让暴露面的增长必须出现在 diff 里。
//
// Stage 0 只暴露只读的环境事实：没有任何 IPC 通道，没有任何写能力。

const api = {
  app: {
    platform: process.platform,
    versions: {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
    },
  },
}

export type SepiaBridge = typeof api

contextBridge.exposeInMainWorld('api', api)
