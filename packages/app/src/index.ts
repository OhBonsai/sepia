// @sepia/app 是依赖图的根，不对外导出任何东西——它只被 Electron 装载。
// 真正的入口是 src/main/index.ts（主进程）、src/preload/index.ts（桥）、
// src/renderer/main.tsx（渲染进程）。此文件仅为包形状占位。

export {}
