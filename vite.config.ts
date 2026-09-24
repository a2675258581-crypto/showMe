import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { proxyPlugin } from './server/vite-proxy-plugin'

export default defineConfig({
  plugins: [react(), tailwindcss(), proxyPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    // prettier 插件、CodeMirror 等较大的库都按工具懒加载，单个 chunk 偏大属正常
    chunkSizeWarningLimit: 1500,
  },
})
