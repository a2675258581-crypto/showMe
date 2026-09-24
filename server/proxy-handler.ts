/**
 * 与框架无关的 HTTP 转发逻辑，供「在线 API 调试」绕过浏览器 CORS 使用。
 * 目前挂在 Vite dev / preview 服务器上（见 vite-proxy-plugin.ts），
 * 以后部署到 Vercel / Cloudflare 时可以直接复用 forward()。
 *
 * 注意：这是一个「替你发请求」的代理，只应在本机使用，不要暴露到公网（SSRF 风险）。
 */

export interface ProxyRequest {
  method: string
  url: string
  headers?: [string, string][]
  /** 请求体，base64 编码（二进制安全） */
  bodyBase64?: string | null
  timeoutMs?: number
  followRedirects?: boolean
}

export interface ProxySuccess {
  ok: true
  status: number
  statusText: string
  url: string
  redirected: boolean
  headers: [string, string][]
  bodyBase64: string
  size: number
  timeMs: number
}

export interface ProxyFailure {
  ok: false
  error: string
  timeMs: number
}

export type ProxyResult = ProxySuccess | ProxyFailure

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

/** 由转发方自己决定的头，客户端传来的一律丢弃 */
const DROP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'proxy-connection',
  'proxy-authorization',
  'te',
  'trailer',
])

export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_TIMEOUT_MS = 120_000

export function validateProxyRequest(input: unknown): ProxyRequest | string {
  if (!input || typeof input !== 'object') return '请求格式错误'
  const r = input as Record<string, unknown>
  const method = String(r.method ?? 'GET').toUpperCase()
  if (!METHODS.has(method)) return `不支持的请求方法：${method}`
  if (typeof r.url !== 'string' || !r.url.trim()) return '缺少 URL'
  let parsed: URL
  try {
    parsed = new URL(r.url)
  } catch {
    return `URL 无效：${r.url}`
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '只支持 http:// 和 https:// 协议'
  }
  const headers: [string, string][] = []
  if (r.headers !== undefined) {
    if (!Array.isArray(r.headers)) return 'headers 必须是 [name, value] 数组'
    for (const h of r.headers) {
      if (!Array.isArray(h) || h.length !== 2) return 'headers 必须是 [name, value] 数组'
      headers.push([String(h[0]), String(h[1])])
    }
  }
  const bodyBase64 = typeof r.bodyBase64 === 'string' ? r.bodyBase64 : null
  const timeoutMs =
    typeof r.timeoutMs === 'number' && r.timeoutMs > 0
      ? Math.min(r.timeoutMs, MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS
  return {
    method,
    url: parsed.toString(),
    headers,
    bodyBase64,
    timeoutMs,
    followRedirects: r.followRedirects !== false,
  }
}

export async function forward(
  req: ProxyRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ProxyResult> {
  const started = performance.now()
  const controller = new AbortController()
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = new Headers()
    for (const [name, value] of req.headers ?? []) {
      const key = name.trim()
      if (!key || DROP_REQUEST_HEADERS.has(key.toLowerCase())) continue
      try {
        headers.append(key, value)
      } catch {
        return fail(started, `请求头无效：${key}`)
      }
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && !!req.bodyBase64
    const res = await fetchImpl(req.url, {
      method: req.method,
      headers,
      body: hasBody ? Buffer.from(req.bodyBase64!, 'base64') : undefined,
      redirect: req.followRedirects === false ? 'manual' : 'follow',
      signal: controller.signal,
    })
    const buf = Buffer.from(await res.arrayBuffer())
    const resHeaders: [string, string][] = []
    res.headers.forEach((value, name) => resHeaders.push([name, value]))
    // Node 的 getSetCookie 能拿到多条 set-cookie，forEach 会把它们合并
    const cookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    if (cookies && cookies.length > 1) {
      const rest = resHeaders.filter(([n]) => n.toLowerCase() !== 'set-cookie')
      resHeaders.length = 0
      resHeaders.push(...rest, ...cookies.map((c): [string, string] => ['set-cookie', c]))
    }
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      url: res.url || req.url,
      redirected: res.redirected,
      headers: resHeaders,
      bodyBase64: buf.toString('base64'),
      size: buf.byteLength,
      timeMs: Math.round(performance.now() - started),
    }
  } catch (err) {
    if (controller.signal.aborted) return fail(started, `请求超时（${timeoutMs} ms）`)
    return fail(started, describeError(err))
  } finally {
    clearTimeout(timer)
  }
}

function fail(started: number, error: string): ProxyFailure {
  return { ok: false, error, timeMs: Math.round(performance.now() - started) }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause
    if (cause instanceof Error) {
      const code = (cause as Error & { code?: string }).code
      return code ? `${err.message}：${code}（${cause.message}）` : `${err.message}：${cause.message}`
    }
    return err.message
  }
  return String(err)
}
