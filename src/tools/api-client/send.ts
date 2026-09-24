/**
 * 发送请求：优先走本地代理（/__proxy，绕过 CORS），不可用时回退到浏览器直连 fetch。
 */
import { basicAuthValue, type BuiltRequest } from '@/lib/api-client'
import {
  base64ToBytes,
  bytesToBase64,
  parseProxyResult,
  type ProxyRequestPayload,
} from '@/lib/api-client-response'
import { binaryKey, getFile } from './files'

export interface ApiResponse {
  status: number
  statusText: string
  url: string
  redirected: boolean
  headers: [string, string][]
  body: Uint8Array
  size: number
  timeMs: number
  via: 'proxy' | 'direct'
  /** 发送过程中的提示（如直连模式下被浏览器忽略的请求头） */
  notes: string[]
}

export class SendError extends Error {
  timeMs?: number
  /** invalid：发送前的检查没通过（URL 为空、请求头非法、文件未选择…），不会记入历史 */
  kind: 'error' | 'invalid' | 'aborted' | 'timeout' | 'network' | 'cors'
  constructor(message: string, kind: SendError['kind'] = 'error', timeMs?: number) {
    super(message)
    this.kind = kind
    this.timeMs = timeMs
  }
}

// ───────────────────────────── 代理探测 ─────────────────────────────

let pingPromise: Promise<boolean> | null = null

/** GET /__proxy/ping 探测本地代理（结果缓存，force 时重新探测） */
export function detectProxy(force = false): Promise<boolean> {
  if (!pingPromise || force) {
    pingPromise = fetch('/__proxy/ping', { cache: 'no-store', signal: AbortSignal.timeout(2500) })
      .then(async (r) => {
        if (!r.ok) return false
        const j = (await r.json()) as { ok?: unknown }
        return j.ok === true
      })
      .catch(() => false)
  }
  return pingPromise
}

// ───────────────────────────── 请求体与请求头 ─────────────────────────────

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** HTTP 头只允许 ISO-8859-1，发送前给出比浏览器更清楚的错误 */
export function validateHeaders(headers: [string, string][]): string | null {
  for (const [k, v] of headers) {
    if (!TOKEN.test(k)) return `请求头名称「${k}」包含不允许的字符（空格、中文或符号）`
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i)
      if (c > 0xff)
        return `请求头「${k}」的值包含中文等非 Latin-1 字符，HTTP 头无法直接发送，请先进行 URL 编码`
      if (c === 10 || c === 13 || c === 0) return `请求头「${k}」的值不能包含换行`
    }
  }
  return null
}

async function materializeBody(
  built: BuiltRequest,
  tabId: string,
): Promise<{ bytes: Uint8Array | null; contentType?: string }> {
  const b = built.request.body
  switch (b.kind) {
    case 'none':
      return { bytes: null }
    case 'text':
      return { bytes: new TextEncoder().encode(b.text) }
    case 'file': {
      const f = getFile(binaryKey(tabId))
      if (!f)
        throw new SendError(
          `请重新选择要上传的文件「${b.path}」（文件不会被保存，刷新后需要重新选择）`,
          'invalid',
        )
      return { bytes: new Uint8Array(await f.arrayBuffer()) }
    }
    case 'multipart': {
      const fd = new FormData()
      for (const part of b.parts) {
        if (part.kind === 'text') {
          fd.append(part.name, part.value)
          continue
        }
        const field = built.fileFields.find((f) => f.part === part)
        const file = field && getFile(field.fieldId)
        if (!file) {
          throw new SendError(
            `表单字段「${part.name}」的文件「${part.value}」需要重新选择（文件不会被保存）`,
            'invalid',
          )
        }
        fd.append(part.name, file, part.value)
      }
      // 借助 Request 生成 multipart 字节与带 boundary 的 Content-Type
      const req = new Request('http://localhost/', { method: 'POST', body: fd })
      return {
        bytes: new Uint8Array(await req.arrayBuffer()),
        contentType: req.headers.get('content-type') ?? undefined,
      }
    }
  }
}

/** 浏览器直连时 fetch 不允许设置的请求头 */
const FORBIDDEN = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
])

function isForbidden(name: string): boolean {
  const n = name.toLowerCase()
  return FORBIDDEN.has(n) || n.startsWith('proxy-') || n.startsWith('sec-')
}

// ───────────────────────────── 发送 ─────────────────────────────

export interface SendOptions {
  tabId: string
  timeoutMs: number
  followRedirects: boolean
  useProxy: boolean
  signal: AbortSignal
}

export async function sendRequest(built: BuiltRequest, opts: SendOptions): Promise<ApiResponse> {
  const r = built.request
  if (!r.url) throw new SendError('请输入请求 URL', 'invalid')
  let parsed: URL
  try {
    parsed = new URL(r.url)
  } catch {
    const hint = built.missingVars.length
      ? `（变量 ${built.missingVars.map((v) => `{{${v}}}`).join('、')} 未定义）`
      : ''
    throw new SendError(`URL 格式不正确：${r.url}${hint}`, 'invalid')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SendError(`只支持 http:// 和 https:// 协议，当前为 ${parsed.protocol}`, 'invalid')
  }

  const headers: [string, string][] = [...r.headers]
  if (r.auth) headers.push(['Authorization', basicAuthValue(r.auth.username, r.auth.password)])
  const { bytes, contentType } = await materializeBody(built, opts.tabId)
  if (contentType && !headers.some(([k]) => k.toLowerCase() === 'content-type')) {
    headers.push(['Content-Type', contentType])
  }
  const invalid = validateHeaders(headers)
  if (invalid) throw new SendError(invalid, 'invalid')

  const notes: string[] = []
  if (opts.useProxy) {
    if (await detectProxy()) return viaProxy(r.method, r.url, headers, bytes, opts, notes)
    notes.push('本地代理不可用，已改为浏览器直连（可能受 CORS 限制）')
  }
  return direct(r.method, r.url, headers, bytes, opts, notes)
}

async function viaProxy(
  method: string,
  url: string,
  headers: [string, string][],
  bytes: Uint8Array | null,
  opts: SendOptions,
  notes: string[],
): Promise<ApiResponse> {
  const payload: ProxyRequestPayload = {
    method,
    url,
    headers,
    bodyBase64: bytes && bytes.length ? bytesToBase64(bytes) : null,
    timeoutMs: opts.timeoutMs,
    followRedirects: opts.followRedirects,
  }
  const started = performance.now()
  let res: Response
  try {
    res = await fetch('/__proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: opts.signal,
    })
  } catch (e) {
    if (opts.signal.aborted)
      throw new SendError('已取消请求', 'aborted', performance.now() - started)
    throw new SendError(
      `无法连接本地代理：${e instanceof Error ? e.message : String(e)}`,
      'network',
    )
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    if (opts.signal.aborted)
      throw new SendError('已取消请求', 'aborted', performance.now() - started)
    throw new SendError(`本地代理返回了无法解析的内容（HTTP ${res.status}）`)
  }
  const result = parseProxyResult(json)
  if (!result) throw new SendError('本地代理返回了无法识别的数据')
  if (!result.ok) {
    const kind = /超时/.test(result.error) ? 'timeout' : 'network'
    throw new SendError(explainProxyError(result.error), kind, result.timeMs)
  }
  const body = base64ToBytes(result.bodyBase64)
  return {
    status: result.status,
    statusText: result.statusText,
    url: result.url,
    redirected: result.redirected,
    headers: result.headers,
    body,
    size: result.size || body.length,
    timeMs: result.timeMs,
    via: 'proxy',
    notes,
  }
}

/** 把 Node 的网络错误码翻译成中文说明 */
export function explainProxyError(error: string): string {
  const map: [RegExp, string][] = [
    [/ENOTFOUND|EAI_AGAIN/, '域名解析失败，请检查域名是否正确、网络是否可用'],
    [/ECONNREFUSED/, '连接被拒绝：目标端口没有服务在监听'],
    [/ECONNRESET/, '连接被对方重置'],
    [/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/, '连接超时'],
    [/CERT|SSL|TLS|self[- ]signed/i, 'TLS 证书校验失败（自签名或已过期的证书）'],
    [/EHOSTUNREACH|ENETUNREACH/, '网络不可达'],
    [/bad port/i, '这个端口被视为不安全端口（如 1、22、25），Node 与浏览器都会拒绝连接'],
  ]
  for (const [re, zh] of map) if (re.test(error)) return `${zh}\n${error}`
  return error
}

async function direct(
  method: string,
  url: string,
  headers: [string, string][],
  bytes: Uint8Array | null,
  opts: SendOptions,
  notes: string[],
): Promise<ApiResponse> {
  const dropped = headers.filter(([k]) => isForbidden(k)).map(([k]) => k)
  if (dropped.length)
    notes.push(`浏览器直连时不允许设置这些请求头，已被忽略：${dropped.join('、')}`)
  const h = new Headers()
  for (const [k, v] of headers) if (!isForbidden(k)) h.append(k, v)

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, opts.timeoutMs)
  const onAbort = () => controller.abort()
  opts.signal.addEventListener('abort', onAbort)
  const started = performance.now()
  try {
    const res = await fetch(url, {
      method,
      headers: h,
      body: bytes && bytes.length ? new Blob([bytes as BlobPart]) : undefined,
      redirect: opts.followRedirects ? 'follow' : 'manual',
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    })
    if (res.type === 'opaqueredirect') {
      throw new SendError(
        '服务器返回了重定向，但浏览器直连时无法读取 3xx 响应的内容。\n请在「设置」里开启「跟随重定向」，或使用本地代理。',
        'error',
        performance.now() - started,
      )
    }
    const body = new Uint8Array(await res.arrayBuffer())
    const timeMs = performance.now() - started
    const resHeaders: [string, string][] = []
    res.headers.forEach((v, k) => resHeaders.push([k, v]))
    notes.push('浏览器直连模式：只能看到服务器通过 CORS 暴露的响应头，Set-Cookie 不可见')
    return {
      status: res.status,
      statusText: res.statusText,
      url: res.url || url,
      redirected: res.redirected,
      headers: resHeaders,
      body,
      size: body.length,
      timeMs,
      via: 'direct',
      notes,
    }
  } catch (e) {
    const timeMs = performance.now() - started
    if (e instanceof SendError) throw e
    if (opts.signal.aborted) throw new SendError('已取消请求', 'aborted', timeMs)
    if (timedOut) throw new SendError(`请求超时（${opts.timeoutMs} ms）`, 'timeout', timeMs)
    throw new SendError(corsMessage(url), 'cors', timeMs)
  } finally {
    clearTimeout(timer)
    opts.signal.removeEventListener('abort', onAbort)
  }
}

function corsMessage(url: string): string {
  const lines = ['浏览器拦截了这个跨域请求（CORS），或者服务器无法访问。']
  if (
    typeof location !== 'undefined' &&
    location.protocol === 'https:' &&
    url.startsWith('http:')
  ) {
    lines.push('· 当前页面是 HTTPS，浏览器会阻止向 HTTP 地址发请求（混合内容）。')
  }
  lines.push(
    '· 目标服务器没有返回 Access-Control-Allow-Origin 时，网页无法直接读取响应。',
    '· 用 npm run dev 或 npm run preview 启动 showMe 会自带本地代理，在「设置」里开启「使用本地代理」即可绕过 CORS。',
    '· 也可能是网络不通、域名解析失败或证书无效。',
  )
  return lines.join('\n')
}
