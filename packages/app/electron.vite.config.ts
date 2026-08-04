import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// 三段配置。main / preload 打成 CJS 交给 Electron，renderer 走 vite 常规链路。
// main 有两个入口：index（主进程）与 sidecar（utilityProcess 的引擎宿主，Stage 3）。
// 引擎产物本体**不经 rollup**——sidecar 在运行期 `import` packages/app/engine/node.js
//（fork 时经 SEPIA_ENGINE_ENTRY 注入），产物字节与 vendor 构建输出逐字节一致，
// check:artifacts 才有稳定的被检对象；探路记录见 140 §1.8 风险 2。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: {
        entry: {
          index: resolve(__dirname, 'src/main/index.ts'),
          sidecar: resolve(__dirname, 'src/main/engine/sidecar.ts'),
        },
      },
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
      // electron-vite 默认不压缩 renderer——入口曾以 1.2MB 未压缩源码的姿态
      // 挡在首帧前，t0→t3 因此从 316ms 涨到 ~550ms（Stage 2 实测撞出来的）。
      minify: 'esbuild',
    },
  },
})
