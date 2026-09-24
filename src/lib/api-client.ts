/**
 * 「API 调试」的请求模型与纯逻辑（无 DOM 依赖）：
 * URL ↔ Params 双向同步、{{变量}} 替换、把编辑器状态构建成可发送 / 可生成代码的请求、cURL 导入。
 */
import { maskTemplateVars, reindentJson } from './api-client-json'
import type { FormPart, HttpRequest } from './curl'

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/** Postman 风格的方法配色（CSS 颜色） */
export const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'var(--sys-green)',
  POST: 'var(--sys-orange)',
  PUT: 'var(--sys-blue)',
  PATCH: 'var(--sys-purple)',
  DELETE: 'var(--sys-red)',
  HEAD: 'var(--sys-teal)',
  OPTIONS: 'var(--sys-pink)',
}

export interface KeyValue {
  id: string
  key: string
  value: string
  enabled: boolean
}

export interface FormField extends KeyValue {
  type: 'text' | 'file'
  /** 文件字段：只保存文件的元信息，文件本身在内存里 */
  fileName?: string
  fileSize?: number
  fileType?: string
}

export type BodyMode = 'none' | 'json' | 'text' | 'xml' | 'urlencoded' | 'form-data' | 'binary'

export interface FileMeta {
  name: string
  size: number
  type: string
}

export interface RequestBodyState {
  mode: BodyMode
  json: string
  text: string
  xml: string
  urlencoded: KeyValue[]
  formData: FormField[]
  binary?: FileMeta
}

export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey'

export interface AuthState {
  type: AuthType
  token: string
  username: string
  password: string
  apiKeyName: string
  apiKeyValue: string
  apiKeyIn: 'header' | 'query'
}

export interface RequestSettings {
  timeoutMs: number
  followRedirects: boolean
  useProxy: boolean
}

export interface ApiRequest {
  method: HttpMethod
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  body: RequestBodyState
  auth: AuthState
  settings: RequestSettings
}

export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_TIMEOUT_MS = 120_000

let counter = 0
/** 短随机 id（只在事件处理或数据加载时调用） */
export function uid(): string {
  counter = (counter + 1) % 1296
  return (
    Date.now().toString(36).slice(-4) +
    Math.random().toString(36).slice(2, 8) +
    counter.toString(36).padStart(2, '0')
  )
}

export function kv(key = '', value = '', enabled = true): KeyValue {
  return { id: uid(), key, value, enabled }
}

export function emptyAuth(): AuthState {
  return {
    type: 'none',
    token: '',
    username: '',
    password: '',
    apiKeyName: 'X-API-Key',
    apiKeyValue: '',
    apiKeyIn: 'header',
  }
}

export function emptyBody(): RequestBodyState {
  return { mode: 'none', json: '', text: '', xml: '', urlencoded: [], formData: [] }
}

export function defaultSettings(): RequestSettings {
  return { timeoutMs: DEFAULT_TIMEOUT_MS, followRedirects: true, useProxy: true }
}

export function newRequest(partial: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    body: emptyBody(),
    auth: emptyAuth(),
    settings: defaultSettings(),
    ...partial,
  }
}

export function isHttpMethod(m: string): m is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(m)
}

// ───────────────────────────── URL ↔ Params ─────────────────────────────

export interface UrlParts {
  base: string
  /** 不含 ?，null 表示 URL 里没有 ? */
  query: string | null
  /** 含 #，没有则为空串 */
  hash: string
}

export function splitUrl(url: string): UrlParts {
  const hashAt = url.indexOf('#')
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const q = beforeHash.indexOf('?')
  if (q < 0) return { base: beforeHash, query: null, hash }
  return { base: beforeHash.slice(0, q), query: beforeHash.slice(q + 1), hash }
}

/** 按原文拆分查询串（不做解码，保证 {{变量}} 和已编码内容原样往返） */
export function parseQuery(query: string): { key: string; value: string }[] {
  if (!query) return []
  return query
    .split('&')
    .filter((seg) => seg !== '')
    .map((seg) => {
      const eq = seg.indexOf('=')
      return eq < 0 ? { key: seg, value: '' } : { key: seg.slice(0, eq), value: seg.slice(eq + 1) }
    })
}

export function buildQuery(pairs: { key: string; value: string }[]): string {
  return pairs
    .filter((p) => p.key !== '' || p.value !== '')
    .map((p) => (p.value === '' ? p.key : `${p.key}=${p.value}`))
    .join('&')
}

/**
 * URL 输入变化 → 更新 Params 表：
 * 按顺序复用原有启用行（保留 id，列表不抖动），禁用行原位保留。
 */
export function syncParamsFromUrl(url: string, params: KeyValue[]): KeyValue[] {
  const parsed = parseQuery(splitUrl(url).query ?? '')
  const out: KeyValue[] = []
  let i = 0
  for (const p of params) {
    if (!p.enabled) {
      out.push(p)
      continue
    }
    const next = parsed[i++]
    if (!next) continue
    out.push(p.key === next.key && p.value === next.value ? p : { ...p, ...next })
  }
  for (; i < parsed.length; i++) out.push(kv(parsed[i].key, parsed[i].value))
  return out
}

/** Params 表变化 → 重写 URL 的查询串（保留 # 片段） */
export function applyParamsToUrl(url: string, params: KeyValue[]): string {
  const { base, hash } = splitUrl(url)
  const q = buildQuery(params.filter((p) => p.enabled))
  return base + (q ? `?${q}` : '') + hash
}

// ───────────────────────────── 变量 ─────────────────────────────

export const VAR_PATTERN = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g

export interface VarSegment {
  text: string
  /** 变量名（不是变量时为 undefined） */
  name?: string
  /** 是否在当前环境里有定义（或是内置动态变量） */
  known?: boolean
}

export const DYNAMIC_VARS: { name: string; desc: string }[] = [
  { name: '$timestamp', desc: '当前 Unix 时间戳（秒）' },
  { name: '$isoTimestamp', desc: '当前 ISO 8601 时间' },
  { name: '$uuid', desc: '随机 UUID v4' },
  { name: '$randomInt', desc: '0–1000 的随机整数' },
]

export function isDynamicVar(name: string): boolean {
  return DYNAMIC_VARS.some((d) => d.name === name) || name === '$guid'
}

export interface DynamicContext {
  now: () => number
  random: () => number
}

const defaultCtx: DynamicContext = { now: () => Date.now(), random: () => Math.random() }

function uuidV4(random: () => number): string {
  const b = Array.from({ length: 16 }, () => Math.floor(random() * 256))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function dynamicValue(name: string, ctx: DynamicContext = defaultCtx): string | undefined {
  switch (name) {
    case '$timestamp':
      return String(Math.floor(ctx.now() / 1000))
    case '$isoTimestamp':
      return new Date(ctx.now()).toISOString()
    case '$uuid':
    case '$guid':
      return uuidV4(ctx.random)
    case '$randomInt':
      return String(Math.floor(ctx.random() * 1001))
    default:
      return undefined
  }
}

/** 把文本拆成普通片段与变量片段，用于高亮 */
export function splitVarSegments(text: string, vars: Record<string, string>): VarSegment[] {
  const out: VarSegment[] = []
  let last = 0
  for (const m of text.matchAll(VAR_PATTERN)) {
    const at = m.index ?? 0
    if (at > last) out.push({ text: text.slice(last, at) })
    const name = m[1]
    out.push({ text: m[0], name, known: name in vars || isDynamicVar(name) })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** 替换 {{变量}}：变量值里还可以引用其它变量（最多展开 5 层），未定义的原样保留 */
export function resolveVars(
  text: string,
  vars: Record<string, string>,
  ctx: DynamicContext = defaultCtx,
): { text: string; missing: string[] } {
  const missing = new Set<string>()
  let cur = text
  for (let depth = 0; depth < 5; depth++) {
    let changed = false
    cur = cur.replace(VAR_PATTERN, (all, name: string) => {
      if (Object.prototype.hasOwnProperty.call(vars, name)) {
        changed = true
        return vars[name]
      }
      const d = dynamicValue(name, ctx)
      if (d !== undefined) {
        changed = true
        return d
      }
      missing.add(name)
      return all
    })
    if (!changed) break
  }
  return { text: cur, missing: [...missing] }
}

/** 启用且有名字的变量 → 字典 */
export function varsToRecord(rows: KeyValue[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows ?? []) if (r.enabled && r.key.trim()) out[r.key.trim()] = r.value
  return out
}

// ───────────────────────────── JSON 校验 ─────────────────────────────

/**
 * 校验 JSON，出错时给出行列（不依赖引擎的错误信息格式）。
 * allowVars：把 {{变量}} 当作一个值（请求体模板，如 {"id": {{userId}}}）。
 */
export function validateJson(
  text: string,
  opts: { allowVars?: boolean } = {},
): { ok: true } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true }
  const src = opts.allowVars ? maskTemplateVars(text) : text
  try {
    JSON.parse(src)
    return { ok: true }
  } catch {
    const { index, reason } = locateJsonError(src)
    const before = text.slice(0, index)
    const line = before.split('\n').length
    const col = index - before.lastIndexOf('\n')
    return { ok: false, error: `JSON 格式错误（第 ${line} 行第 ${col} 列）：${reason}` }
  }
}

/** 最小的 JSON 扫描器：找出第一个语法错误的位置和原因 */
export function locateJsonError(text: string): { index: number; reason: string } {
  let i = 0
  const n = text.length
  class Fail extends Error {
    constructor(
      public index: number,
      public reason: string,
    ) {
      super(reason)
    }
  }
  const fail = (reason: string, at = i): never => {
    throw new Fail(at, reason)
  }
  const ws = () => {
    while (i < n && ' \t\n\r'.includes(text[i])) i++
  }
  const show = (c: string) => (c === undefined ? '结尾' : `「${c}」`)
  const value = (): void => {
    ws()
    const c = text[i]
    if (c === undefined) fail('内容意外结束')
    if (c === '{') {
      i++
      ws()
      if (text[i] === '}') {
        i++
        return
      }
      for (;;) {
        ws()
        if (text[i] !== '"')
          fail(
            text[i] === '}' ? '多余的逗号' : `这里应该是用双引号包裹的键名，却遇到${show(text[i])}`,
          )
        string()
        ws()
        if (text[i] !== ':') fail(`键名后面缺少冒号，遇到${show(text[i])}`)
        i++
        value()
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') {
          i++
          return
        }
        fail(
          text[i] === undefined
            ? '对象没有闭合，缺少「}」'
            : `缺少逗号或「}」，遇到${show(text[i])}`,
        )
      }
    }
    if (c === '[') {
      i++
      ws()
      if (text[i] === ']') {
        i++
        return
      }
      for (;;) {
        ws()
        if (text[i] === ']') fail('多余的逗号')
        value()
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') {
          i++
          return
        }
        fail(
          text[i] === undefined
            ? '数组没有闭合，缺少「]」'
            : `缺少逗号或「]」，遇到${show(text[i])}`,
        )
      }
    }
    if (c === '"') return string()
    if (c === '-' || (c >= '0' && c <= '9')) {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400))
      if (!m || m[0] === '-') fail('数字格式不正确')
      i += m![0].length
      return
    }
    for (const lit of ['true', 'false', 'null']) {
      if (text.startsWith(lit, i)) {
        i += lit.length
        return
      }
    }
    if (c === "'") fail('字符串必须使用双引号')
    fail(`意外的字符${show(c)}`)
  }
  const string = () => {
    const start = i
    i++
    for (;;) {
      if (i >= n) fail('字符串没有闭合', start)
      const c = text[i]
      if (c === '"') {
        i++
        return
      }
      if (c === '\\') {
        const e = text[i + 1]
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6)))
            fail('\\u 转义需要 4 位十六进制数字')
          i += 6
          continue
        }
        if (!e || !'"\\/bfnrt'.includes(e)) fail(`无效的转义字符「\\${e ?? ''}」`)
        i += 2
        continue
      }
      if (c < ' ')
        fail(c === '\n' ? '字符串里不能直接换行，请使用 \\n' : '字符串里有未转义的控制字符')
      i++
    }
  }
  try {
    value()
    ws()
    if (i < n) fail(`JSON 结束后还有多余内容${show(text[i])}`)
    return { index: n, reason: '未知错误' }
  } catch (e) {
    if (e instanceof Fail) return { index: e.index, reason: e.reason }
    return { index: 0, reason: String(e) }
  }
}

/**
 * 格式化（indent > 0）或压缩（indent = 0）JSON 文本。
 * 只调整空白，字面量原样保留：大整数不丢精度、键顺序与转义写法不变。
 * 内容不合法时返回 null；allowVars 时允许 {{变量}} 出现在值的位置。
 */
export function formatJsonText(
  text: string,
  indent = 2,
  opts: { allowVars?: boolean } = {},
): string | null {
  if (!text.trim() || !validateJson(text, opts).ok) return null
  return reindentJson(text, indent, opts.allowVars)
}

// ───────────────────────────── 构建请求 ─────────────────────────────

export interface BuiltRequest {
  /** 结构化请求（已替换变量），可直接用于生成代码或发送 */
  request: HttpRequest
  /** form-data 文件字段：字段 id → 文件元信息（发送时从内存取文件） */
  fileFields: { part: FormPart; fieldId: string }[]
  missingVars: string[]
  warnings: string[]
}

const DEFAULT_CT: Partial<Record<BodyMode, string>> = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
  urlencoded: 'application/x-www-form-urlencoded',
}

/** x-www-form-urlencoded 编码（与浏览器 URLSearchParams 相同，空格为 +） */
export function encodeForm(pairs: { key: string; value: string }[]): string {
  return new URLSearchParams(pairs.map((p) => [p.key, p.value])).toString()
}

/** 没有协议时补 http://（与 Postman 一致） */
export function normalizeUrl(url: string): string {
  const t = url.trim()
  if (!t) return t
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t.replace(/^\/+/, '')}`
}

export function basicAuthValue(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `Basic ${btoa(bin)}`
}

/**
 * 编辑器状态 → 结构化请求。
 * - 替换变量；Params 已体现在 URL 里（双向同步），这里只用 URL
 * - Auth：Bearer / API Key 转成请求头或查询参数，Basic 保留为 auth（生成代码更地道）
 * - 自动补 Content-Type（用户手动设置的优先）
 */
export function buildRequest(
  req: ApiRequest,
  vars: Record<string, string>,
  ctx: DynamicContext = defaultCtx,
): BuiltRequest {
  const missing = new Set<string>()
  const warnings: string[] = []
  const R = (s: string) => {
    const r = resolveVars(s, vars, ctx)
    r.missing.forEach((m) => missing.add(m))
    return r.text
  }

  let url = normalizeUrl(R(req.url))
  const headers: [string, string][] = []
  for (const h of req.headers) {
    if (!h.enabled || !h.key.trim()) continue
    headers.push([R(h.key.trim()), R(h.value)])
  }
  const has = (name: string) => headers.some(([k]) => k.toLowerCase() === name.toLowerCase())

  const a = req.auth
  let auth: HttpRequest['auth']
  if (a.type === 'bearer' && a.token.trim()) {
    if (!has('authorization')) headers.push(['Authorization', `Bearer ${R(a.token.trim())}`])
  } else if (a.type === 'basic' && (a.username || a.password)) {
    if (!has('authorization')) auth = { username: R(a.username), password: R(a.password) }
  } else if (a.type === 'apikey' && a.apiKeyName.trim()) {
    const name = R(a.apiKeyName.trim())
    const value = R(a.apiKeyValue)
    if (a.apiKeyIn === 'header') {
      if (!has(name)) headers.push([name, value])
    } else {
      const { base, query, hash } = splitUrl(url)
      const pair = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`
      url = `${base}?${query ? `${query}&` : ''}${pair}${hash}`
    }
  }

  const b = req.body
  let body: HttpRequest['body'] = { kind: 'none' }
  const fileFields: BuiltRequest['fileFields'] = []
  const bodyAllowed = req.method !== 'GET' && req.method !== 'HEAD'
  switch (b.mode) {
    case 'json':
      body = { kind: 'text', text: R(b.json) }
      break
    case 'text':
      body = { kind: 'text', text: R(b.text) }
      break
    case 'xml':
      body = { kind: 'text', text: R(b.xml) }
      break
    case 'urlencoded':
      body = {
        kind: 'text',
        text: encodeForm(
          b.urlencoded
            .filter((p) => p.enabled && (p.key || p.value))
            .map((p) => ({ key: R(p.key), value: R(p.value) })),
        ),
      }
      break
    case 'form-data': {
      const parts: FormPart[] = []
      for (const f of b.formData) {
        if (!f.enabled || !f.key.trim()) continue
        if (f.type === 'file') {
          if (!f.fileName) {
            warnings.push(`表单字段「${f.key}」还没有选择文件`)
            continue
          }
          const part: FormPart = { name: R(f.key), value: f.fileName, kind: 'file' }
          if (f.fileType) part.contentType = f.fileType
          parts.push(part)
          fileFields.push({ part, fieldId: f.id })
        } else parts.push({ name: R(f.key), value: R(f.value), kind: 'text' })
      }
      body = { kind: 'multipart', parts }
      break
    }
    case 'binary':
      if (b.binary) body = { kind: 'file', path: b.binary.name }
      else warnings.push('还没有选择要上传的文件')
      break
  }
  if (body.kind !== 'none' && !bodyAllowed) {
    warnings.push(`${req.method} 请求不能携带请求体，发送和生成代码时会忽略「请求体」`)
    body = { kind: 'none' }
    fileFields.length = 0
  }
  if (body.kind === 'multipart' && has('content-type')) {
    // multipart 的 Content-Type 必须带上自动生成的 boundary，手动设置的会让服务器无法解析
    warnings.push(
      'form-data 会自动生成带 boundary 的 Content-Type，已忽略请求头里手动设置的 Content-Type',
    )
    for (let i = headers.length - 1; i >= 0; i--) {
      if (headers[i][0].toLowerCase() === 'content-type') headers.splice(i, 1)
    }
  }
  if (body.kind !== 'none' && body.kind !== 'multipart' && !has('content-type')) {
    const ct =
      b.mode === 'binary' ? b.binary?.type || 'application/octet-stream' : DEFAULT_CT[b.mode]
    if (ct) headers.push(['Content-Type', ct])
  }

  const request: HttpRequest = { method: req.method, url, headers, body }
  if (auth) request.auth = auth
  request.followRedirects = req.settings.followRedirects
  // 默认超时不写进生成的代码，避免噪音
  if (req.settings.timeoutMs > 0 && req.settings.timeoutMs !== DEFAULT_TIMEOUT_MS)
    request.timeout = req.settings.timeoutMs / 1000

  if (url) {
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:')
        warnings.push(`只支持 http:// 和 https:// 协议，当前为 ${u.protocol}`)
    } catch {
      if (!missing.size) warnings.push(`URL 格式不正确：${url}`)
    }
  }
  return { request, fileFields, missingVars: [...missing], warnings }
}

// ───────────────────────────── cURL → 编辑器状态 ─────────────────────────────

function decodeBasic(value: string): { username: string; password: string } | null {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(value.trim())
  if (!m) return null
  try {
    const bin = atob(m[1])
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const i = text.indexOf(':')
    if (i < 0) return null
    return { username: text.slice(0, i), password: text.slice(i + 1) }
  } catch {
    return null
  }
}

/** 结构化请求（通常来自 cURL）→ 编辑器状态 */
export function fromHttpRequest(r: HttpRequest): ApiRequest {
  const upper = r.method.toUpperCase()
  const method = isHttpMethod(upper) ? upper : 'POST'
  const req = newRequest({ method, url: r.url })
  req.params = syncParamsFromUrl(r.url, [])

  const auth = emptyAuth()
  const headers: KeyValue[] = []
  let contentType = ''
  for (const [k, v] of r.headers) {
    const lower = k.toLowerCase()
    if (lower === 'authorization' && auth.type === 'none') {
      const bearer = /^Bearer\s+(.+)$/i.exec(v.trim())
      if (bearer) {
        auth.type = 'bearer'
        auth.token = bearer[1]
        continue
      }
      const basic = decodeBasic(v)
      if (basic) {
        auth.type = 'basic'
        auth.username = basic.username
        auth.password = basic.password
        continue
      }
    }
    if (lower === 'content-type') contentType = v
    headers.push(kv(k, v))
  }
  if (r.auth) {
    auth.type = 'basic'
    auth.username = r.auth.username
    auth.password = r.auth.password
  }
  req.auth = auth
  req.headers = headers

  const body = emptyBody()
  const b = r.body
  const dropCT = () => {
    req.headers = req.headers.filter((h) => h.key.toLowerCase() !== 'content-type')
  }
  if (b.kind === 'text') {
    const ct = contentType.toLowerCase()
    const trimmed = b.text.trim()
    const looksJson = /^[[{]/.test(trimmed) && validateJson(trimmed).ok
    // 看起来是 JSON 就用 JSON 编辑器（curl -d 默认带的 form Content-Type 仍保留在请求头里）。
    // 请求体原样保留、不自动格式化：签名校验等场景要求字节完全一致，需要时可以手动点「格式化」
    if (ct.includes('json') || looksJson) {
      body.mode = 'json'
      body.json = b.text
      if (/^application\/json\s*$/i.test(contentType)) dropCT()
    } else if (ct.includes('x-www-form-urlencoded')) {
      body.mode = 'urlencoded'
      body.urlencoded = b.text
        .split('&')
        .filter(Boolean)
        .map((seg) => {
          const eq = seg.indexOf('=')
          const dec = (s: string) => {
            try {
              return decodeURIComponent(s.replace(/\+/g, ' '))
            } catch {
              return s
            }
          }
          return eq < 0 ? kv(dec(seg), '') : kv(dec(seg.slice(0, eq)), dec(seg.slice(eq + 1)))
        })
      dropCT()
    } else if (ct.includes('xml') || (!ct && /^<[?!a-zA-Z]/.test(trimmed))) {
      body.mode = 'xml'
      body.xml = b.text
    } else {
      body.mode = 'text'
      body.text = b.text
    }
  } else if (b.kind === 'multipart') {
    body.mode = 'form-data'
    body.formData = b.parts.map((p) => ({
      ...kv(p.name, p.kind === 'text' ? p.value : ''),
      type: p.kind,
      ...(p.kind === 'file'
        ? { fileName: p.filename ?? p.value.split(/[/\\]/).pop(), fileType: p.contentType }
        : {}),
    }))
    dropCT()
  } else if (b.kind === 'file') {
    body.mode = 'binary'
  }
  req.body = body
  req.settings = {
    timeoutMs: r.timeout
      ? Math.min(Math.round(r.timeout * 1000), MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS,
    followRedirects: r.followRedirects !== false,
    useProxy: true,
  }
  return req
}

/** 导入结构化请求时，编辑器无法完整表示的部分（给用户的提示） */
export function importNotes(r: HttpRequest): string[] {
  const notes: string[] = []
  if (!isHttpMethod(r.method.toUpperCase())) notes.push(`不支持 ${r.method} 方法，已改为 POST`)
  if (r.body.kind === 'file')
    notes.push(`请求体来自本地文件「${r.body.path}」，请在「请求体」里重新选择`)
  if (r.body.kind === 'multipart' && r.body.parts.some((p) => p.kind === 'file'))
    notes.push('表单里的文件字段需要重新选择文件')
  if (r.insecure) notes.push('忽略证书校验（-k）无法在这里设置，已忽略')
  return notes
}

// ───────────────────────────── 杂项 ─────────────────────────────

/** 请求的「内容签名」：忽略行 id，用于判断标签页是否有未保存的修改 */
export function requestSignature(req: ApiRequest): string {
  const rows = (list: KeyValue[]) =>
    list.map((r) => [
      r.key,
      r.value,
      r.enabled,
      (r as FormField).type ?? '',
      (r as FormField).fileName ?? '',
    ])
  return JSON.stringify([
    req.method,
    req.url,
    rows(req.params),
    rows(req.headers),
    req.body.mode,
    req.body.json,
    req.body.text,
    req.body.xml,
    rows(req.body.urlencoded),
    rows(req.body.formData),
    req.body.binary?.name ?? '',
    req.auth,
    req.settings,
  ])
}

/** 标签页 / 历史里显示的短名称：GET /users/1 */
export function requestLabel(req: Pick<ApiRequest, 'url'>): string {
  const url = req.url.trim()
  if (!url) return '新请求'
  const noScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const { base } = splitUrl(noScheme)
  const slash = base.indexOf('/')
  const path = slash >= 0 ? base.slice(slash) : ''
  if (path && path !== '/') return path.length > 40 ? '…' + path.slice(-39) : path
  const host = slash >= 0 ? base.slice(0, slash) : base
  return host.length > 40 ? host.slice(0, 39) + '…' : host || '新请求'
}

/** 深拷贝请求并换新行 id（从历史 / 集合打开时使用） */
export function cloneRequest(req: ApiRequest): ApiRequest {
  const re = <T extends KeyValue>(rows: T[]): T[] => rows.map((r) => ({ ...r, id: uid() }))
  return {
    ...req,
    params: re(req.params),
    headers: re(req.headers),
    body: {
      ...req.body,
      urlencoded: re(req.body.urlencoded),
      formData: re(req.body.formData),
    },
    auth: { ...req.auth },
    settings: { ...req.settings },
  }
}
