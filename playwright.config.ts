import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// 云端容器预装的 Chromium；本机则使用 Playwright 自己下载的浏览器
const CHROMIUM = '/opt/pw-browsers/chromium'

const PORT = Number(process.env.E2E_PORT ?? 4173)

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
