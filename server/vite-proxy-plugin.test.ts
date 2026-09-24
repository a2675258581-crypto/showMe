import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PROXY_PATH, handle, isAllowedClient, isLoopback, proxyPlugin } from './vite-proxy-plugin'

/**
 * connect 的 use(PROXY_PATH, fn) 会把前缀从 req.url 里去掉，
 * 所以这里直接把 handle 挂在一个裸 http 服务器上，路径形如 /ping、/。
 */
let proxy: Server
let target: Server
let proxyBase: string
let targetBase: string

beforeAll(async () => {
  target = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          body: Buffer.concat(chunks).toString(),
        }),
      )
    })
  })
  proxy = createServer((req, res) => void handle(req, res))
  await Promise.all([
    new Promise<void>((r) => target.listen(0, '127.0.0.1', r)),
    new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r)),
  ])
  targetBase = `http://127.0.0.1:${(target.address() as AddressInfo).port}`
  proxyBase = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
})

afterAll(async () => {
  target.closeAllConnections()
  proxy.closeAllConnections()
  await Promise.all([
    new Promise<void>((r) => target.close(() => r())),
    new Promise<void>((r) => proxy.close(() => r())),
  ])
})

/** 用 node:http 发请求，便于自定义 Host / Origin 头 */
function send(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{
  status: number
  headers: Record<string, string | string[] | undefined>
  json: Record<string, unknown>
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${proxyBase}${path}`,
      { method: opts.method ?? 'GET', headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            json: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
          }),
        )
      },
    )
    req.on('error', reject)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

const json = { 'content-type': 'application/json' }

describe('proxy plugin handle()', () => {
  it('answers ping (with or without trailing slash and query)', async () => {
    for (const p of ['/ping', '/ping/', '/ping?t=1']) {
      const r = await send(p)
      expect(r.status).toBe(200)
      expect(r.json).toEqual({ ok: true })
      expect(r.headers['content-type']).toBe('application/json; charset=utf-8')
      expect(r.headers['cache-control']).toBe('no-store')
    }
  })

  it('returns 404 for other paths and methods', async () => {
    expect((await send('/other')).status).toBe(404)
    expect((await send('/', { method: 'GET' })).status).toBe(404)
    expect((await send('/ping', { method: 'POST', headers: json, body: '{}' })).status).toBe(404)
  })

  it('rejects cross-origin requests with 403', async () => {
    const r = await send('/', {
      method: 'POST',
      headers: { ...json, origin: 'https://evil.example' },
      body: JSON.stringify({ method: 'GET', url: targetBase }),
    })
    expect(r.status).toBe(403)
    expect(r.json).toMatchObject({ ok: false, error: '仅允许同源页面使用本地代理' })
    const bad = await send('/', {
      method: 'POST',
      headers: { ...json, origin: 'null' },
      body: '{}',
    })
    expect(bad.status).toBe(403)
  })

  it('rejects non-JSON content types with 415', async () => {
    const r = await send('/', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ method: 'GET', url: targetBase }),
    })
    expect(r.status).toBe(415)
    expect(r.json).toMatchObject({ ok: false, error: '需要 application/json' })
    expect((await send('/', { method: 'POST', body: '{}' })).status).toBe(415)
  })

  it('rejects malformed JSON with 400', async () => {
    const r = await send('/', { method: 'POST', headers: json, body: '{not json' })
    expect(r.status).toBe(400)
    expect(r.json).toMatchObject({ ok: false, error: '请求体不是合法 JSON' })
  })

  it('rejects invalid proxy requests with 400', async () => {
    const r = await send('/', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ url: 'ftp://x' }),
    })
    expect(r.status).toBe(400)
    expect(r.json).toMatchObject({ ok: false, error: '只支持 http:// 和 https:// 协议' })
  })

  it('answers 413 (instead of resetting the connection) for bodies over 50 MB', async () => {
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(`${proxyBase}/`, { method: 'POST', headers: json }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        )
      })
      req.on('error', reject)
      const chunk = Buffer.alloc(1024 * 1024, 0x61)
      let sent = 0
      const pump = () => {
        while (sent < 52) {
          sent++
          if (!req.write(chunk)) {
            req.once('drain', pump)
            return
          }
        }
        req.end()
      }
      pump()
    })
    expect(result.status).toBe(413)
    expect(JSON.parse(result.body)).toMatchObject({ ok: false, error: '请求体过大（上限 50 MB）' })
  }, 20_000)

  it('forwards valid same-origin requests', async () => {
    const host = new URL(proxyBase).host
    const r = await send('/', {
      method: 'POST',
      headers: { ...json, origin: `http://${host}` },
      body: JSON.stringify({
        method: 'POST',
        url: `${targetBase}/echo?a=1`,
        headers: [['content-type', 'text/plain']],
        bodyBase64: Buffer.from('你好').toString('base64'),
      }),
    })
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
    expect(r.json.status).toBe(200)
    const echoed = JSON.parse(Buffer.from(String(r.json.bodyBase64), 'base64').toString('utf8'))
    expect(echoed).toEqual({ method: 'POST', url: '/echo?a=1', body: '你好' })
  })

  it('also accepts requests without an Origin header (e.g. curl)', async () => {
    const r = await send('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ url: targetBase }),
    })
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
  })
})

describe('proxyPlugin()', () => {
  it('mounts the middleware on dev and preview servers', () => {
    const plugin = proxyPlugin()
    expect(plugin.name).toBe('showme-api-proxy')
    const mounted: string[] = []
    const fake = { middlewares: { use: (path: string) => mounted.push(path) } }
    ;(plugin.configureServer as (s: unknown) => void)(fake)
    ;(plugin.configurePreviewServer as (s: unknown) => void)(fake)
    expect(mounted).toEqual([PROXY_PATH, PROXY_PATH])
    expect(PROXY_PATH).toBe('/__proxy')
  })
})

describe('client address check', () => {
  it('recognises loopback addresses', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'])
      expect(isLoopback(a)).toBe(true)
    for (const a of ['192.168.1.5', '10.0.0.1', '::ffff:192.168.1.5', 'fe80::1', '', undefined]) {
      expect(isLoopback(a)).toBe(false)
    }
  })

  it('rejects LAN clients unless explicitly allowed', () => {
    expect(isAllowedClient('192.168.1.5', {})).toBe(false)
    expect(isAllowedClient('192.168.1.5', { SHOWME_PROXY_ALLOW_LAN: '1' })).toBe(true)
    expect(isAllowedClient('127.0.0.1', {})).toBe(true)
  })
})
