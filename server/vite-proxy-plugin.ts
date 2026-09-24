import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { forward, validateProxyRequest } from './proxy-handler'

export const PROXY_PATH = '/__proxy'
const MAX_BODY_BYTES = 50 * 1024 * 1024

/**
 * 在 `vite` 与 `vite preview` 服务器上挂载 /__proxy：
 *   GET  /__proxy/ping  → { ok: true }（前端用来探测代理是否可用）
 *   POST /__proxy       → 按 ProxyRequest 转发，返回 ProxyResult
 */
export function proxyPlugin(): Plugin {
  return {
    name: 'showme-api-proxy',
    configureServer(server) {
      server.middlewares.use(PROXY_PATH, (req, res) => void handle(req, res))
    },
    configurePreviewServer(server) {
      server.middlewares.use(PROXY_PATH, (req, res) => void handle(req, res))
    },
  }
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '/').split('?')[0]
  if (req.method === 'GET' && (path === '/ping' || path === '/ping/')) {
    return send(res, 200, { ok: true })
  }
  if (req.method !== 'POST' || (path !== '/' && path !== '')) {
    return send(res, 404, { ok: false, error: 'Not found', timeMs: 0 })
  }
  // 只接受同源的 JSON 请求，防止其它网页借本机代理发请求
  const origin = req.headers.origin
  if (origin) {
    let originHost = ''
    try {
      originHost = new URL(origin).host
    } catch {
      /* ignore */
    }
    if (originHost !== req.headers.host) {
      return send(res, 403, { ok: false, error: '仅允许同源页面使用本地代理', timeMs: 0 })
    }
  }
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
    return send(res, 415, { ok: false, error: '需要 application/json', timeMs: 0 })
  }
  let raw: string
  try {
    raw = await readBody(req)
  } catch (e) {
    return send(res, 413, { ok: false, error: (e as Error).message, timeMs: 0 })
  }
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return send(res, 400, { ok: false, error: '请求体不是合法 JSON', timeMs: 0 })
  }
  const parsed = validateProxyRequest(payload)
  if (typeof parsed === 'string') return send(res, 400, { ok: false, error: parsed, timeMs: 0 })
  const result = await forward(parsed)
  send(res, 200, result)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // 不要 req.destroy()：那会直接断开连接，客户端只能看到 ECONNRESET 而收不到 413。
        // 这里丢弃剩余数据，让 handle() 正常回复 413。
        tooLarge = true
        chunks.length = 0
        reject(new Error('请求体过大（上限 50 MB）'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}
