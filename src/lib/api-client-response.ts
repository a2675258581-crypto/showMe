/**
 * 「API 调试」响应相关的纯逻辑：本地代理协议类型、Base64、内容识别、XML 美化、Set-Cookie 解析等。
 */
import { reindentJson } from './api-client-json'

// ───────────────────────────── 本地代理协议（与 server/proxy-handler.ts 保持一致） ─────────────────────────────

export interface ProxyRequestPayload {
  method: string
  url: string
  headers: [string, string][]
  /** 请求体，base64 编码 */
  bodyBase64: string | null
  timeoutMs: number
  followRedirects: boolean
}

export interface ProxySuccessPayload {
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

export interface ProxyFailurePayload {
  ok: false
  error: string
  timeMs: number
}

export type ProxyResultPayload = ProxySuccessPayload | ProxyFailurePayload

/** 校验代理返回的 JSON，防止格式不符时渲染出错 */
export function parseProxyResult(input: unknown): ProxyResultPayload | null {
  if (!input || typeof input !== 'object') return null
  const r = input as Record<string, unknown>
  if (r.ok === false) {
    return {
      ok: false,
      error: typeof r.error === 'string' ? r.error : '代理返回了未知错误',
      timeMs: typeof r.timeMs === 'number' ? r.timeMs : 0,
    }
  }
  if (r.ok !== true || typeof r.status !== 'number' || typeof r.bodyBase64 !== 'string') return null
  const headers = Array.isArray(r.headers)
    ? (r.headers as unknown[])
        .filter((h): h is [unknown, unknown] => Array.isArray(h) && h.length === 2)
        .map(([k, v]): [string, string] => [String(k), String(v)])
    : []
  return {
    ok: true,
    status: r.status,
    statusText: typeof r.statusText === 'string' ? r.statusText : '',
    url: typeof r.url === 'string' ? r.url : '',
    redirected: r.redirected === true,
    headers,
    bodyBase64: r.bodyBase64,
    size: typeof r.size === 'number' ? r.size : 0,
    timeMs: typeof r.timeMs === 'number' ? r.timeMs : 0,
  }
}

// ───────────────────────────── Base64 ─────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ───────────────────────────── 头与内容类型 ─────────────────────────────

export function getHeader(headers: [string, string][], name: string): string | undefined {
  const lower = name.toLowerCase()
  return headers.find(([k]) => k.toLowerCase() === lower)?.[1]
}

/** "application/json; charset=utf-8" → "application/json" */
export function mimeType(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase()
}

export function charsetOf(contentType: string | undefined): string | undefined {
  const m = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType ?? '')
  return m ? m[1].toLowerCase() : undefined
}

/** 按 Content-Type 声明的字符集解码，未知字符集回退 UTF-8 */
export function decodeText(bytes: Uint8Array, contentType?: string): string {
  const cs = charsetOf(contentType)
  try {
    return new TextDecoder(cs ?? 'utf-8').decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** 看前 1KB 判断是不是文本：没有 NUL，控制字符很少 */
export function isLikelyText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 1024)
  if (!n) return true
  let ctrl = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 0) return false
    if (b < 9 || (b > 13 && b < 32)) ctrl++
  }
  return ctrl / n < 0.05
}

export type BodyKind =
  'empty' | 'json' | 'xml' | 'html' | 'javascript' | 'css' | 'image' | 'text' | 'binary'

/** 根据 Content-Type 与内容本身判断响应体类型 */
export function detectBodyKind(contentType: string | undefined, bytes: Uint8Array): BodyKind {
  if (!bytes.length) return 'empty'
  const mime = mimeType(contentType)
  if (mime.startsWith('image/')) return 'image'
  if (/[/+]json$/.test(mime) || mime === 'application/x-ndjson') return 'json'
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (/[/+]xml$/.test(mime)) return 'xml'
  if (/javascript|ecmascript/.test(mime)) return 'javascript'
  if (mime === 'text/css') return 'css'
  if (!isLikelyText(bytes)) return 'binary'
  // 没有声明或声明为 text/plain 时，看内容猜
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart()
  if (/^[[{]/.test(head)) {
    try {
      JSON.parse(new TextDecoder().decode(bytes))
      return 'json'
    } catch {
      /* 不是 JSON */
    }
  }
  if (/^<!doctype html|^<html[\s>]/i.test(head)) return 'html'
  if (/^<\?xml|^<[a-zA-Z][\w:.-]*[\s>/]/.test(head) && (mime === '' || mime.includes('xml')))
    return 'xml'
  if (mime.startsWith('text/') || mime === '') return 'text'
  return 'text'
}

// ───────────────────────────── 美化 ─────────────────────────────

/**
 * 美化 JSON 响应：只调整空白，数字等字面量原样保留
 * （JSON.parse + stringify 会把 12345678901234567890 变成 12345678901234567000）。
 */
export function prettyJson(text: string): string | null {
  try {
    JSON.parse(text)
  } catch {
    return null
  }
  return reindentJson(text, 2)
}

/** 截断过长的文本：尽量在换行处截断，返回是否被截断 */
export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  const nl = text.lastIndexOf('\n', max)
  let cut = nl > max * 0.8 ? nl : max
  // 不要把代理对（emoji 等）截成两半
  const code = text.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut--
  return { text: text.slice(0, cut), truncated: true }
}

/** 简单可靠的 XML 缩进：只含文本的元素保持在一行 */
export function prettyXml(xml: string, indent = '  '): string {
  const tokens = xml.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)
  if (!tokens) return xml
  const lines: string[] = []
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    const pad = indent.repeat(Math.max(depth, 0))
    if (!tok.startsWith('<')) {
      const text = tok.trim()
      if (text) lines.push(pad + text)
      continue
    }
    if (tok.startsWith('</')) {
      depth--
      lines.push(indent.repeat(Math.max(depth, 0)) + tok)
      continue
    }
    if (/^<[?!]/.test(tok) || tok.endsWith('/>')) {
      lines.push(pad + tok)
      continue
    }
    // 开始标签：<a>文本</a> 放一行
    const next = tokens[i + 1]
    const after = tokens[i + 2]
    if (next !== undefined && !next.startsWith('<') && after?.startsWith('</')) {
      lines.push(pad + tok + next.trim() + after)
      i += 2
      continue
    }
    if (next?.startsWith('</')) {
      lines.push(pad + tok + next)
      i += 1
      continue
    }
    lines.push(pad + tok)
    depth++
  }
  return lines.join('\n')
}

/**
 * HTML 预览用的文档：去掉 <script>（iframe 已经 sandbox，脚本本来就不会执行，
 * 去掉只是避免控制台里满是「Blocked script execution」），并加上 <base>。
 */
export function previewDocument(html: string, url: string): string {
  const noScripts = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*$/i, '')
    // onload="…" 之类的内联事件也会触发同样的提示
    .replace(/<[a-zA-Z][^>]*>/g, (tag) =>
      tag.replace(/\s+on[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, ''),
    )
  return withBaseHref(noScripts, url)
}

/** 给 HTML 预览加 <base>，让相对路径的图片 / 样式能加载 */
export function withBaseHref(html: string, url: string): string {
  if (!url || /<base\s/i.test(html)) return html
  const tag = `<base href="${url.replace(/"/g, '&quot;')}">`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag)
  return tag + html
}

/** 二进制内容的十六进制预览 */
export function hexDump(bytes: Uint8Array, max = 4096): string {
  const n = Math.min(bytes.length, max)
  const lines: string[] = []
  for (let off = 0; off < n; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, n))
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0')).join(' ')
    const ascii = Array.from(row, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join(
      '',
    )
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`)
  }
  if (bytes.length > max) lines.push(`… 共 ${bytes.length} 字节，仅显示前 ${max} 字节`)
  return lines.join('\n')
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
  const m = Math.floor(ms / 60_000)
  return `${m} min ${Math.round((ms % 60_000) / 1000)} s`
}

// ───────────────────────────── 状态码 ─────────────────────────────

export type StatusTone = 'info' | 'success' | 'redirect' | 'client' | 'server'

export function statusTone(status: number): StatusTone {
  if (status >= 500) return 'server'
  if (status >= 400) return 'client'
  if (status >= 300) return 'redirect'
  if (status >= 200) return 'success'
  return 'info'
}

export const STATUS_COLORS: Record<StatusTone, string> = {
  info: 'var(--sys-indigo)',
  success: 'var(--sys-green)',
  redirect: 'var(--sys-blue)',
  client: 'var(--sys-orange)',
  server: 'var(--sys-red)',
}

const REASONS: Record<number, [string, string]> = {
  100: ['Continue', '继续'],
  101: ['Switching Protocols', '切换协议'],
  200: ['OK', '成功'],
  201: ['Created', '已创建'],
  202: ['Accepted', '已接受'],
  204: ['No Content', '无内容'],
  206: ['Partial Content', '部分内容'],
  301: ['Moved Permanently', '永久重定向'],
  302: ['Found', '临时重定向'],
  303: ['See Other', '查看其它位置'],
  304: ['Not Modified', '未修改'],
  307: ['Temporary Redirect', '临时重定向'],
  308: ['Permanent Redirect', '永久重定向'],
  400: ['Bad Request', '请求有误'],
  401: ['Unauthorized', '未认证'],
  403: ['Forbidden', '禁止访问'],
  404: ['Not Found', '未找到'],
  405: ['Method Not Allowed', '方法不允许'],
  406: ['Not Acceptable', '无法接受'],
  408: ['Request Timeout', '请求超时'],
  409: ['Conflict', '冲突'],
  410: ['Gone', '已删除'],
  413: ['Payload Too Large', '请求体过大'],
  415: ['Unsupported Media Type', '不支持的媒体类型'],
  418: ["I'm a teapot", '我是茶壶'],
  422: ['Unprocessable Entity', '无法处理'],
  429: ['Too Many Requests', '请求过多'],
  500: ['Internal Server Error', '服务器内部错误'],
  501: ['Not Implemented', '未实现'],
  502: ['Bad Gateway', '网关错误'],
  503: ['Service Unavailable', '服务不可用'],
  504: ['Gateway Timeout', '网关超时'],
}

/** 状态文本：优先用服务器返回的，HTTP/2 没有原因短语时用标准短语 */
export function reasonPhrase(status: number, statusText?: string): string {
  return statusText?.trim() || REASONS[status]?.[0] || ''
}

export function statusMeaning(status: number): string | undefined {
  return REASONS[status]?.[1]
}

// ───────────────────────────── Cookie ─────────────────────────────

export interface ResponseCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: string
  maxAge?: number
  secure: boolean
  httpOnly: boolean
  sameSite?: string
  partitioned: boolean
}

export function parseSetCookie(header: string): ResponseCookie | null {
  const parts = header.split(';')
  const first = parts.shift() ?? ''
  const eq = first.indexOf('=')
  if (eq < 0 && !first.trim()) return null
  const name = eq < 0 ? '' : first.slice(0, eq).trim()
  let value = eq < 0 ? first.trim() : first.slice(eq + 1).trim()
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
  const c: ResponseCookie = { name, value, secure: false, httpOnly: false, partitioned: false }
  for (const p of parts) {
    const i = p.indexOf('=')
    const k = (i < 0 ? p : p.slice(0, i)).trim().toLowerCase()
    const v = i < 0 ? '' : p.slice(i + 1).trim()
    switch (k) {
      case 'domain':
        c.domain = v
        break
      case 'path':
        c.path = v
        break
      case 'expires':
        c.expires = v
        break
      case 'max-age': {
        const n = Number(v)
        if (Number.isFinite(n)) c.maxAge = n
        break
      }
      case 'secure':
        c.secure = true
        break
      case 'httponly':
        c.httpOnly = true
        break
      case 'samesite':
        c.sameSite = v
        break
      case 'partitioned':
        c.partitioned = true
        break
    }
  }
  return c
}

export function responseCookies(headers: [string, string][]): ResponseCookie[] {
  return headers
    .filter(([k]) => k.toLowerCase() === 'set-cookie')
    .map(([, v]) => parseSetCookie(v))
    .filter((c): c is ResponseCookie => c !== null)
}

// ───────────────────────────── 下载文件名 ─────────────────────────────

const EXT: Record<string, string> = {
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/html': 'html',
  'text/css': 'css',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/javascript': 'js',
  'text/javascript': 'js',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
}

/** 按 Content-Disposition → URL 路径 → Content-Type 推断下载文件名 */
export function suggestFileName(url: string, contentType?: string, disposition?: string): string {
  if (disposition) {
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition)
    if (star) {
      try {
        return decodeURIComponent(star[1].trim())
      } catch {
        /* 继续尝试普通 filename */
      }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)
    if (plain) return plain[1].trim()
  }
  const mime = mimeType(contentType)
  const ext = EXT[mime] ?? (/[/+]json$/.test(mime) ? 'json' : /[/+]xml$/.test(mime) ? 'xml' : 'bin')
  let base: string
  try {
    const path = new URL(url).pathname
    base = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '')
  } catch {
    base = ''
  }
  if (!base) return `response.${ext}`
  return /\.[a-z0-9]{1,5}$/i.test(base) ? base : `${base}.${ext}`
}
