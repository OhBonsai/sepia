import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// 三段配置。main / preload 打成 CJS 交给 Electron，renderer 走 vite 常规链路。
// 构建管线的另外两段（vendor/opencode 与产物自检）属于 Stage 3，此处刻意不接。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(__dirname, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
})
