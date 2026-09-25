import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { proxyPlugin } from './server/vite-proxy-plugin.ts'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), proxyPlugin()],
  // 允许多个 dev server 并行时各用各的依赖预构建缓存
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    // prettier 插件、CodeMirror 等较大的库都按工具懒加载，单个 chunk 偏大属正常
    chunkSizeWarningLimit: 1500,
    // 静态版（npm run build:static）输出纯 ASCII：部分托管平台拒收含 U+FFFD 等字符的文件
    ...(mode === 'static' && {
      rolldownOptions: {
        output: { minify: { compress: true, mangle: true, codegen: { asciiOnly: true } } },
      },
    }),
  },
}))
