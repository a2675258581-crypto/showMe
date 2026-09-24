import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  forward,
  validateProxyRequest,
  type ProxyRequest,
  type ProxySuccess,
} from './proxy-handler'

/** 本地回显服务器：把收到的请求原样返回，另有几个特殊路径 */
function echoServer(): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x')
      const body = Buffer.concat(chunks)
      if (url.pathname.startsWith('/status/')) {
        res.statusCode = Number(url.pathname.split('/')[2])
        res.statusMessage = url.searchParams.get('text') ?? res.statusMessage
        res.end('status body')
        return
      }
      if (url.pathname === '/redirect') {
        res.writeHead(302, { location: '/final?from=redirect' })
        res.end()
        return
      }
      if (url.pathname === '/final') {
        res.setHeader('content-type', 'text/plain')
        res.end('final')
        return
      }
      if (url.pathname === '/cookies') {
        res.setHeader('set-cookie', ['a=1; Path=/; HttpOnly', 'b=2; Secure', 'c=3'])
        res.setHeader('x-multi', 'one')
        res.end('ok')
        return
      }
      if (url.pathname === '/slow') {
        const t = setTimeout(() => res.end('late'), 1500)
        res.on('close', () => clearTimeout(t))
        return
      }
      if (url.pathname === '/binary') {
        res.setHeader('content-type', 'application/octet-stream')
        res.end(Buffer.from([0, 1, 2, 253, 254, 255]))
        return
      }
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          rawHeaders: req.rawHeaders,
          bodyBase64: body.toString('base64'),
        }),
      )
    })
  })
}

let server: Server
let base: string

beforeAll(async () => {
  server = echoServer()
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((r) => server.close(() => r()))
})

async function ok(req: ProxyRequest): Promise<ProxySuccess> {
  const r = await forward(req)
  if (!r.ok) throw new Error(r.error)
  return r
}

function echo(r: ProxySuccess) {
  return JSON.parse(Buffer.from(r.bodyBase64, 'base64').toString('utf8')) as {
    method: string
    url: string
    headers: Record<string, string>
    rawHeaders: string[]
    bodyBase64: string
  }
}

describe('validateProxyRequest', () => {
  it('rejects malformed input with Chinese messages', () => {
    expect(validateProxyRequest(null)).toBe('请求格式错误')
    expect(validateProxyRequest('x')).toBe('请求格式错误')
    expect(validateProxyRequest({ method: 'BREW', url: 'http://a' })).toBe('不支持的请求方法：BREW')
    expect(validateProxyRequest({ method: 'GET' })).toBe('缺少 URL')
    expect(validateProxyRequest({ method: 'GET', url: '   ' })).toBe('缺少 URL')
    expect(validateProxyRequest({ url: 'not a url' })).toBe('URL 无效：not a url')
    expect(validateProxyRequest({ url: 'ftp://a.dev/x' })).toBe('只支持 http:// 和 https:// 协议')
    expect(validateProxyRequest({ url: 'file:///etc/passwd' })).toBe(
      '只支持 http:// 和 https:// 协议',
    )
    expect(validateProxyRequest({ url: 'http://a', headers: {} })).toBe(
      'headers 必须是 [name, value] 数组',
    )
    expect(validateProxyRequest({ url: 'http://a', headers: [['a']] })).toBe(
      'headers 必须是 [name, value] 数组',
    )
  })

  it('normalizes valid input', () => {
    expect(
      validateProxyRequest({
        method: 'post',
        url: 'http://a.dev',
        headers: [['x', 1]],
        bodyBase64: 'eA==',
      }),
    ).toEqual({
      method: 'POST',
      url: 'http://a.dev/',
      headers: [['x', '1']],
      bodyBase64: 'eA==',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      followRedirects: true,
    })
    expect(
      validateProxyRequest({ url: 'http://a', timeoutMs: 10 ** 9, followRedirects: false }),
    ).toMatchObject({
      method: 'GET',
      timeoutMs: MAX_TIMEOUT_MS,
      followRedirects: false,
      bodyBase64: null,
    })
    expect(validateProxyRequest({ url: 'http://a', timeoutMs: -5 })).toMatchObject({
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })
  })
})

describe('forward', () => {
  it('passes method, path, query, headers and body through', async () => {
    const body = JSON.stringify({ name: '张三', emoji: '😀' })
    const r = await ok({
      method: 'PUT',
      url: `${base}/api/items?x=1&y=%E4%B8%AD`,
      headers: [
        ['Content-Type', 'application/json'],
        ['X-Custom', 'hello'],
        ['X-Dup', 'a'],
        ['X-Dup', 'b'],
      ],
      bodyBase64: Buffer.from(body).toString('base64'),
    })
    expect(r.status).toBe(200)
    expect(r.statusText).toBe('OK')
    expect(r.redirected).toBe(false)
    expect(r.url).toBe(`${base}/api/items?x=1&y=%E4%B8%AD`)
    const e = echo(r)
    expect(e.method).toBe('PUT')
    expect(e.url).toBe('/api/items?x=1&y=%E4%B8%AD')
    expect(e.headers['content-type']).toBe('application/json')
    expect(e.headers['x-custom']).toBe('hello')
    expect(e.headers['x-dup']).toBe('a, b')
    expect(Buffer.from(e.bodyBase64, 'base64').toString('utf8')).toBe(body)
    expect(r.size).toBe(Buffer.from(r.bodyBase64, 'base64').length)
    expect(r.timeMs).toBeGreaterThanOrEqual(0)
    expect(r.headers.find(([k]) => k === 'content-type')?.[1]).toBe(
      'application/json; charset=utf-8',
    )
  })

  it('supports every method and binary bodies', async () => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(echo(await ok({ method, url: `${base}/m` })).method).toBe(method)
    }
    const head = await ok({ method: 'HEAD', url: `${base}/m` })
    expect(head.status).toBe(200)
    expect(head.size).toBe(0)
    const bin = Buffer.from([0, 255, 128, 10, 13])
    expect(
      echo(await ok({ method: 'POST', url: `${base}/b`, bodyBase64: bin.toString('base64') }))
        .bodyBase64,
    ).toBe(bin.toString('base64'))
    const res = await ok({ method: 'GET', url: `${base}/binary` })
    expect([...Buffer.from(res.bodyBase64, 'base64')]).toEqual([0, 1, 2, 253, 254, 255])
  })

  it('does not send a body for GET / HEAD', async () => {
    const e = echo(
      await ok({
        method: 'GET',
        url: `${base}/g`,
        bodyBase64: Buffer.from('x').toString('base64'),
      }),
    )
    expect(e.bodyBase64).toBe('')
  })

  it('drops hop-by-hop and proxy headers supplied by the client', async () => {
    const e = echo(
      await ok({
        method: 'POST',
        url: `${base}/h`,
        headers: [
          ['Host', 'evil.example'],
          ['Connection', 'upgrade'],
          ['Content-Length', '999'],
          ['Transfer-Encoding', 'chunked'],
          ['Keep-Alive', 'timeout=5'],
          ['Upgrade', 'websocket'],
          ['Proxy-Connection', 'keep-alive'],
          ['Proxy-Authorization', 'Basic xxx'],
          ['TE', 'trailers'],
          ['Trailer', 'Expires'],
          ['  ', 'blank name'],
          ['X-Kept', 'yes'],
        ],
        bodyBase64: Buffer.from('abc').toString('base64'),
      }),
    )
    expect(e.headers.host).toBe(new URL(base).host)
    expect(e.headers['content-length']).toBe('3')
    expect(e.headers['transfer-encoding']).toBeUndefined()
    expect(e.headers['keep-alive']).toBeUndefined()
    expect(e.headers.upgrade).toBeUndefined()
    expect(e.headers['proxy-connection']).toBeUndefined()
    expect(e.headers['proxy-authorization']).toBeUndefined()
    expect(e.headers.te).toBeUndefined()
    expect(e.headers.trailer).toBeUndefined()
    expect(e.headers['x-kept']).toBe('yes')
    expect(Buffer.from(e.bodyBase64, 'base64').toString()).toBe('abc')
  })

  it('reports status codes and status text', async () => {
    for (const code of [201, 204, 400, 404, 418, 500, 503]) {
      const r = await ok({ method: 'GET', url: `${base}/status/${code}` })
      expect(r.status).toBe(code)
    }
    const custom = await ok({ method: 'GET', url: `${base}/status/422?text=Bad%20Things` })
    expect(custom.statusText).toBe('Bad Things')
  })

  it('keeps multiple set-cookie headers separate', async () => {
    const r = await ok({ method: 'GET', url: `${base}/cookies` })
    expect(r.headers.filter(([k]) => k === 'set-cookie').map(([, v]) => v)).toEqual([
      'a=1; Path=/; HttpOnly',
      'b=2; Secure',
      'c=3',
    ])
    expect(r.headers.find(([k]) => k === 'x-multi')?.[1]).toBe('one')
  })

  it('follows redirects by default and can stop at the 3xx', async () => {
    const followed = await ok({ method: 'GET', url: `${base}/redirect` })
    expect(followed.status).toBe(200)
    expect(followed.redirected).toBe(true)
    expect(followed.url).toBe(`${base}/final?from=redirect`)
    expect(Buffer.from(followed.bodyBase64, 'base64').toString()).toBe('final')
    const manual = await ok({ method: 'GET', url: `${base}/redirect`, followRedirects: false })
    expect(manual.status).toBe(302)
    expect(manual.headers.find(([k]) => k === 'location')?.[1]).toBe('/final?from=redirect')
  })

  it('times out', async () => {
    const r = await forward({ method: 'GET', url: `${base}/slow`, timeoutMs: 100 })
    expect(r).toMatchObject({ ok: false, error: '请求超时（100 ms）' })
    expect(r.timeMs).toBeGreaterThanOrEqual(90)
  })

  it('rejects invalid header names / values', async () => {
    expect(
      await forward({ method: 'GET', url: `${base}/x`, headers: [['Bad Header', 'x']] }),
    ).toMatchObject({
      ok: false,
      error: '请求头无效：Bad Header',
    })
    expect(
      await forward({ method: 'GET', url: `${base}/x`, headers: [['X-Zh', '中文']] }),
    ).toMatchObject({
      ok: false,
      error: '请求头无效：X-Zh',
    })
  })

  it('describes network errors', async () => {
    // 找一个没人监听的端口
    const tmp = createServer()
    await new Promise<void>((r) => tmp.listen(0, '127.0.0.1', r))
    const port = (tmp.address() as AddressInfo).port
    await new Promise<void>((r) => tmp.close(() => r()))
    const r = await forward({ method: 'GET', url: `http://127.0.0.1:${port}/`, timeoutMs: 5000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('ECONNREFUSED')
  })

  it('uses the injected fetch implementation and stringifies odd errors', async () => {
    const fake = (async () => {
      throw 'boom'
    }) as unknown as typeof fetch
    expect(await forward({ method: 'GET', url: 'http://a.dev/' }, fake)).toMatchObject({
      ok: false,
      error: 'boom',
    })
    const plain = (async () => {
      throw new Error('plain failure')
    }) as unknown as typeof fetch
    expect(await forward({ method: 'GET', url: 'http://a.dev/' }, plain)).toMatchObject({
      ok: false,
      error: 'plain failure',
    })
  })
})
