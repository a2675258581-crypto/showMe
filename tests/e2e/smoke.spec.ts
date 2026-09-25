import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// 直接从注册表源码里取工具 id 与名称，避免在 Node 里导入 React 组件
const registry = readFileSync(new URL('../../src/tools/registry.ts', import.meta.url), 'utf8')
const TOOLS = [...registry.matchAll(/id: '([a-z0-9-]+)',\s*\n\s*name: '([^']+)'/g)].map((m) => ({
  id: m[1],
  name: m[2],
}))

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

test('注册表解析到全部工具', () => {
  expect(TOOLS.length).toBeGreaterThanOrEqual(30)
})

test('首页渲染且无报错', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('开发者的')
  await page.mouse.wheel(0, 4000)
  await page.waitForTimeout(800)
  expect(errors).toEqual([])
})

test('全部工具页可搜索', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/tools')
  await page.getByRole('textbox', { name: '搜索工具' }).fill('md5')
  await expect(page.getByRole('heading', { name: '哈希计算' })).toBeVisible()
  expect(errors).toEqual([])
})

test('⌘K / Ctrl+K 命令面板可跳转到工具', async ({ page }) => {
  await page.goto('/tools')
  await page.keyboard.press('ControlOrMeta+k')
  const dialog = page.getByRole('dialog', { name: '搜索工具' })
  await expect(dialog).toBeVisible()
  await page.keyboard.type('时间戳')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/t\/timestamp$/)
})

test('江湖页：七幕滚到底，全词与印章出现且无报错', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/jianghu')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('江湖')
  await expect(page.getByText('一剑一囊风满袂')).toHaveCount(1)
  // 一路滚到底，让每一幕都渲染、动画都跑一遍
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, 1600)
    await page.waitForTimeout(200)
  }
  await expect(page.getByText('一曲送残星。')).toBeVisible()
  await expect(page.getByRole('img', { name: '印章：江湖客' })).toBeVisible()
  await expect(page.getByRole('link', { name: '回百宝箱' })).toBeVisible()
  expect(errors).toEqual([])
})

test('未知路由显示 404', async ({ page }) => {
  await page.goto('/definitely-not-here')
  await expect(page.getByText('404')).toBeVisible()
})

for (const tool of TOOLS) {
  test(`工具页：${tool.name}（/t/${tool.id}）`, async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto(`/t/${tool.id}`)
    await expect(page.getByRole('heading', { level: 1, name: tool.name })).toBeVisible()
    // 等懒加载的工具主体渲染完
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByText('这个工具正在打磨中')).toHaveCount(0)
    await expect(page.getByText('这个工具出了点问题')).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(errors).toEqual([])
  })
}

test('JSON 格式化：非法 JSON 显示错误位置', async ({ page }) => {
  await page.goto('/t/json-formatter')
  const input = page.getByRole('textbox', { name: '输入' }).first()
  await input.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('{"a": 1,, "b": 2}')
  await expect(page.getByRole('alert').first()).toContainText(/行|列/)
})

test('API 调试：通过本地代理请求本站 ping 接口', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/t/api-client')
  const origin = new URL(page.url()).origin
  const url = page.getByPlaceholder(/URL|请求地址|输入/).first()
  await url.click()
  await url.fill(`${origin}/__proxy/ping`)
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByText(/200/).first()).toBeVisible({ timeout: 15_000 })
  expect(errors).toEqual([])
})
