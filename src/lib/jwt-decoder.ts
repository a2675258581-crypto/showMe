/**
 * JWT 解析 / 校验 / 签发（纯逻辑，浏览器与 Node 都能跑）。
 * - 解码：严格的 Base64URL 与 JSON 校验，错误带段名与位置。
 * - 声明：注册声明（iss sub aud exp nbf iat jti）的中文解释与时间换算。
 * - 验签：jose 6，HS* 用密钥，RS* / PS* / ES* / EdDSA 用 PEM / X.509 / JWK / JWKS 公钥。
 * - 签发：HS256 / HS384 / HS512。
 */
import {
  CompactSign,
  compactVerify,
  createLocalJWKSet,
  errors as joseErrors,
  exportJWK,
  importJWK,
  importPKCS8,
  importSPKI,
  importX509,
  type CryptoKey,
  type JSONWebKeySet,
  type JWK,
} from 'jose'
import HmacSHA256 from 'crypto-js/hmac-sha256'
import {
  ByteDecodeError,
  base64ToBytes,
  bytesToBase64Url,
  utf8Decode,
  utf8Encode,
} from './hash-bytes'

// ───────────── 令牌切分与规范化 ─────────────

export type SegmentKind = 'header' | 'payload' | 'signature' | 'extra'

export interface NormalizedToken {
  /** 去掉 Bearer 前缀与所有空白后的令牌 */
  token: string
  /** token[i] 在原始输入中的下标 */
  map: number[]
  strippedBearer: boolean
}

export function normalizeToken(input: string): NormalizedToken {
  let start = 0
  const bearer = /^\s*(?:bearer|authorization:\s*bearer)\s+/i.exec(input)
  if (bearer) start = bearer[0].length
  let token = ''
  const map: number[] = []
  const last = input.trimEnd().length - 1
  for (let i = start; i < input.length; i++) {
    const ch = input[i]
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue
    // 去掉包裹的引号（从 JSON / 代码里复制时常见）
    if ((ch === '"' || ch === "'") && (token === '' || i === last)) continue
    token += ch
    map.push(i)
  }
  return { token, map, strippedBearer: !!bearer }
}

export interface RawSegment {
  kind: SegmentKind
  /** 在原始输入中的起止（半开区间） */
  start: number
  end: number
}

/** 按「.」把原始输入切成若干着色区段（供 jwt.io 式高亮使用） */
export function segmentRanges(input: string): { segments: RawSegment[]; dots: number[] } {
  const segments: RawSegment[] = []
  const dots: number[] = []
  const kinds: SegmentKind[] = ['header', 'payload', 'signature']
  const prefix = /^\s*(?:bearer|authorization:\s*bearer)\s+/i.exec(input)
  let segStart = prefix ? prefix[0].length : 0
  let idx = 0
  for (let i = segStart; i <= input.length; i++) {
    if (i === input.length || input[i] === '.') {
      segments.push({ kind: kinds[idx] ?? 'extra', start: segStart, end: i })
      if (i < input.length) dots.push(i)
      segStart = i + 1
      idx++
    }
  }
  return { segments, dots }
}

// ───────────── JSON 错误定位 ─────────────

export function lineColumn(text: string, pos: number): { line: number; column: number } {
  let line = 1
  let col = 1
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === '\n') {
      line++
      col = 1
    } else col++
  }
  return { line, column: col }
}

const JSON_MESSAGES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/Unexpected end of JSON input/i, () => 'JSON 意外结束，可能缺少 } 或 ]'],
  [/Expected property name/i, () => '此处应为用双引号括起来的属性名'],
  [/Expected ',' or '}'/i, () => '此处应为逗号或 }'],
  [/Expected ',' or ']'/i, () => '此处应为逗号或 ]'],
  [/Expected ':'/i, () => '此处应为冒号'],
  [/Expected double-quoted property name/i, () => '属性名必须用双引号括起来（可能多了尾随逗号）'],
  [/Unterminated string/i, () => '字符串缺少结束的双引号'],
  [/Bad control character/i, () => '字符串里含有未转义的控制字符（如换行）'],
  [/Bad (Unicode )?escape/i, () => '非法的转义序列'],
  [/Unexpected non-whitespace character after JSON/i, () => 'JSON 结束后还有多余的内容'],
  [/Unexpected token '?(.)'?/i, (m) => `意外的字符「${m[1]}」`],
  [
    /No number after minus sign|Exponent part is missing|Unterminated fractional/i,
    () => '数字格式不正确',
  ],
]

/**
 * 找出 JSON 文本里第一个语法错误的位置（JSON.parse 的报错不总带位置）。
 * 合法时返回 -1；意外结束返回 text.length。
 */
export function jsonErrorPosition(s: string): number {
  let i = 0
  const fail = (): never => {
    throw i
  }
  const ws = () => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++
  }
  const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  const str = () => {
    i++
    while (i < s.length) {
      const c = s[i]
      if (c === '"') {
        i++
        return
      }
      if (c === '\\') {
        const n = s[i + 1]
        if (n === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) {
            i++
            fail()
          }
          i += 6
          continue
        }
        if (n === undefined || !'"\\/bfnrt'.includes(n)) {
          i++
          fail()
        }
        i += 2
        continue
      }
      if (c < ' ') fail()
      i++
    }
    fail()
  }
  const value = (): void => {
    ws()
    const c = s[i]
    if (c === '{') {
      i++
      ws()
      if (s[i] === '}') {
        i++
        return
      }
      for (;;) {
        ws()
        if (s[i] !== '"') fail()
        str()
        ws()
        if (s[i] !== ':') fail()
        i++
        value()
        ws()
        if (s[i] === ',') i++
        else if (s[i] === '}') {
          i++
          return
        } else fail()
      }
    }
    if (c === '[') {
      i++
      ws()
      if (s[i] === ']') {
        i++
        return
      }
      for (;;) {
        value()
        ws()
        if (s[i] === ',') i++
        else if (s[i] === ']') {
          i++
          return
        } else fail()
      }
    }
    if (c === '"') return str()
    if (c === '-' || (c >= '0' && c <= '9')) {
      NUM.lastIndex = i
      const m = NUM.exec(s)
      if (!m) fail()
      i += m![0].length
      return
    }
    for (const lit of ['true', 'false', 'null']) {
      if (s.startsWith(lit, i)) {
        i += lit.length
        return
      }
    }
    fail()
  }
  try {
    value()
    ws()
    if (i < s.length) fail()
    return -1
  } catch (p) {
    return typeof p === 'number' ? p : -1
  }
}

/** 把 JSON.parse 的异常翻译成中文并尽量给出行列号 */
export function describeJsonError(text: string, e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  let msg = raw
  for (const [re, fn] of JSON_MESSAGES) {
    const m = re.exec(raw)
    if (m) {
      msg = fn(m)
      break
    }
  }
  const pm = /position (\d+)/i.exec(raw)
  let pos = pm ? Number(pm[1]) : jsonErrorPosition(text)
  if (pos < 0 && /Unexpected end of JSON input/i.test(raw)) pos = text.length
  if (pos < 0) return msg
  if (pos >= text.length && !/意外结束/.test(msg)) msg = `${msg}（JSON 意外结束）`
  const { line, column } = lineColumn(text, pos)
  return `第 ${line} 行第 ${column} 列：${msg}`
}

export function parseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e) {
    return { ok: false, error: describeJsonError(text, e) }
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// ───────────── 解码 ─────────────

export interface DecodedJwt {
  token: string
  header: Record<string, unknown>
  payload: Record<string, unknown>
  headerJson: string
  payloadJson: string
  signature: Uint8Array
  alg: string
  warnings: string[]
  strippedBearer: boolean
}

export type JwtDecodeResult =
  | { ok: true; jwt: DecodedJwt }
  | {
      ok: false
      error: string
      segment?: Exclude<SegmentKind, 'extra'>
      /** 出错字符在原始输入中的下标 */
      position?: number
    }

const SEG_LABEL = { header: 'Header', payload: 'Payload', signature: 'Signature' } as const

/** 解码 JWT；输入为空时返回 null */
export function decodeJwt(input: string): JwtDecodeResult | null {
  const norm = normalizeToken(input)
  const { token } = norm
  if (!token) return null
  const parts = token.split('.')

  if (parts.length === 5) {
    let detail = ''
    try {
      const h = JSON.parse(utf8Decode(base64ToBytes(parts[0], { strictUrl: true }), true))
      if (isObject(h)) detail = `（alg: ${String(h.alg)}，enc: ${String(h.enc)}）`
    } catch {
      // 忽略，只给出通用提示
    }
    return {
      ok: false,
      error: `这是 JWE 加密令牌（5 段）${detail}：Payload 已被加密，需要对应的私钥 / 密钥解密后才能查看。本工具只解析 JWS 签名令牌（3 段）。`,
    }
  }
  if (parts.length !== 3) {
    const hint =
      parts.length === 1
        ? '当前没有「.」分隔符，可能不是 JWT'
        : parts.length === 2
          ? '当前只有 2 段——可能缺少签名部分，或复制时被截断'
          : `当前有 ${parts.length} 段`
    return { ok: false, error: `JWT 应由 3 段组成（Header.Payload.Signature），${hint}。` }
  }

  const offsets = [0, parts[0].length + 1, parts[0].length + parts[1].length + 2]
  const decodeSeg = (i: 0 | 1 | 2): Uint8Array | JwtDecodeResult => {
    const kind = (['header', 'payload', 'signature'] as const)[i]
    try {
      return base64ToBytes(parts[i], { strictUrl: true, label: SEG_LABEL[kind] })
    } catch (e) {
      const pos =
        e instanceof ByteDecodeError && e.position !== undefined
          ? norm.map[offsets[i] + e.position]
          : undefined
      return {
        ok: false,
        segment: kind,
        position: pos,
        error: `${SEG_LABEL[kind]} 不是合法的 Base64URL：${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }

  if (!parts[0]) return { ok: false, segment: 'header', error: 'Header 段为空。' }
  if (!parts[1]) {
    return {
      ok: false,
      segment: 'payload',
      error: 'Payload 段为空（可能是 RFC 7797 分离式载荷的 JWS），无法解析声明。',
    }
  }

  const decoded: Uint8Array[] = []
  for (const i of [0, 1, 2] as const) {
    const r = decodeSeg(i)
    if (!(r instanceof Uint8Array)) return r
    decoded.push(r)
  }

  type Fail = Extract<JwtDecodeResult, { ok: false }>
  const parseSeg = (i: 0 | 1): { value: Record<string, unknown> } | { fail: Fail } => {
    const kind = i === 0 ? 'header' : 'payload'
    let text: string
    try {
      text = utf8Decode(decoded[i], true)
    } catch (e) {
      return {
        fail: {
          ok: false,
          segment: kind,
          error: `${SEG_LABEL[kind]} 解码后${e instanceof Error ? e.message : ''}。`,
        },
      }
    }
    const r = parseJson(text)
    if (!r.ok) {
      const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text
      return {
        fail: {
          ok: false,
          segment: kind,
          error: `${SEG_LABEL[kind]} 不是合法的 JSON（${r.error}）。\n解码内容：${preview}`,
        },
      }
    }
    if (!isObject(r.value)) {
      const type = Array.isArray(r.value) ? '数组' : r.value === null ? 'null' : typeof r.value
      return {
        fail: {
          ok: false,
          segment: kind,
          error: `${SEG_LABEL[kind]} 必须是 JSON 对象，当前是 ${type}。`,
        },
      }
    }
    return { value: r.value }
  }

  const h = parseSeg(0)
  if ('fail' in h) return h.fail
  const p = parseSeg(1)
  if ('fail' in p) return p.fail
  const header = h.value
  const payload = p.value

  const warnings: string[] = []
  const alg = typeof header.alg === 'string' ? header.alg : ''
  if (!alg) warnings.push('Header 缺少 alg（签名算法）字段。')
  if (alg.toLowerCase() === 'none') {
    warnings.push('alg 为 none：这是未签名的令牌，任何人都可以伪造，服务端必须拒绝。')
  } else if (alg && decoded[2].length === 0) {
    warnings.push(`Header 声明 alg 为 ${alg}，但签名段为空。`)
  }
  if (header.typ !== undefined && typeof header.typ === 'string' && !/jwt/i.test(header.typ)) {
    warnings.push(`typ 为「${header.typ}」，不是常见的 JWT。`)
  }
  if (Array.isArray(header.crit) && header.crit.length) {
    warnings.push(`Header 含有关键扩展 crit：${header.crit.join(', ')}，验签方必须理解这些字段。`)
  }

  return {
    ok: true,
    jwt: {
      token,
      header,
      payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      signature: decoded[2],
      alg,
      warnings,
      strippedBearer: norm.strippedBearer,
    },
  }
}

// ───────────── 声明（claims） ─────────────

export const REGISTERED_CLAIMS: Record<string, { name: string; desc: string }> = {
  iss: { name: '签发者', desc: 'Issuer：签发该令牌的服务（通常是认证服务器的 URL）' },
  sub: { name: '主题', desc: 'Subject：令牌所代表的用户或实体 ID' },
  aud: { name: '受众', desc: 'Audience：令牌的预期接收方，服务端应校验是否包含自己' },
  exp: { name: '过期时间', desc: 'Expiration Time：此时间之后令牌不再有效（秒级时间戳）' },
  nbf: { name: '生效时间', desc: 'Not Before：此时间之前令牌不可使用（秒级时间戳）' },
  iat: { name: '签发时间', desc: 'Issued At：令牌签发的时间（秒级时间戳）' },
  jti: { name: '令牌 ID', desc: 'JWT ID：令牌唯一标识，可用于防重放或吊销' },
}

export const COMMON_CLAIMS: Record<string, { name: string; desc: string }> = {
  name: { name: '姓名', desc: 'OIDC：用户全名' },
  email: { name: '邮箱', desc: 'OIDC：用户邮箱' },
  email_verified: { name: '邮箱已验证', desc: 'OIDC：邮箱是否经过验证' },
  scope: { name: '权限范围', desc: 'OAuth 2.0：以空格分隔的授权范围' },
  scp: { name: '权限范围', desc: 'OAuth 2.0：授权范围（数组形式）' },
  roles: { name: '角色', desc: '自定义：用户角色列表' },
  azp: { name: '授权方', desc: 'OIDC Authorized Party：获得令牌的客户端 ID' },
  client_id: { name: '客户端 ID', desc: 'OAuth 2.0 客户端标识' },
  nonce: { name: 'Nonce', desc: 'OIDC：防重放随机串，需与请求中的一致' },
  auth_time: { name: '认证时间', desc: 'OIDC：用户完成认证的时间（秒级时间戳）' },
  sid: { name: '会话 ID', desc: 'OIDC：登录会话标识' },
  at_hash: { name: 'Access Token 哈希', desc: 'OIDC：access_token 的哈希前半部分' },
  amr: { name: '认证方式', desc: 'OIDC：认证方法引用（如 pwd、otp）' },
  acr: { name: '认证等级', desc: 'OIDC：认证上下文等级' },
}

const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat', 'auth_time', 'updated_at'])

export interface ClaimRow {
  key: string
  name: string
  desc: string
  registered: boolean
  value: unknown
  /** 用于展示的文本 */
  text: string
  /** 时间类声明：秒级时间戳 */
  seconds?: number
  /** 值有问题时的说明 */
  issue?: string
}

function claimText(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join(', ')
  return JSON.stringify(v)
}

/** 把 payload 整理成表格行：注册声明在前（按 RFC 顺序），其余按原顺序 */
export function claimRows(payload: Record<string, unknown>): ClaimRow[] {
  const order = Object.keys(REGISTERED_CLAIMS)
  const keys = [
    ...order.filter((k) => k in payload),
    ...Object.keys(payload).filter((k) => !(k in REGISTERED_CLAIMS)),
  ]
  return keys.map((key) => {
    const value = payload[key]
    const info = REGISTERED_CLAIMS[key] ?? COMMON_CLAIMS[key]
    const row: ClaimRow = {
      key,
      name: info?.name ?? '自定义声明',
      desc: info?.desc ?? '应用自定义的私有声明',
      registered: key in REGISTERED_CLAIMS,
      value,
      text: claimText(value),
    }
    if (TIME_CLAIMS.has(key)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        row.seconds = value
        if (value > 1e11) {
          row.issue = '数值过大，看起来是毫秒时间戳；JWT 规定使用秒级时间戳（NumericDate）'
        }
      } else if (typeof value === 'string' && /^\d+$/.test(value)) {
        row.seconds = Number(value)
        row.issue = '应为数字而不是字符串'
      } else {
        row.issue = '应为秒级时间戳（数字）'
      }
    }
    if (key === 'aud' && !(typeof value === 'string' || Array.isArray(value))) {
      row.issue = 'aud 应为字符串或字符串数组'
    }
    if ((key === 'iss' || key === 'sub' || key === 'jti') && typeof value !== 'string') {
      row.issue = `${key} 应为字符串`
    }
    return row
  })
}

export type JwtTimeStateKind = 'valid' | 'expired' | 'notYet' | 'noExp'

export interface JwtTimeState {
  state: JwtTimeStateKind
  exp?: number
  nbf?: number
  iat?: number
  /** 距过期的毫秒数（已过期为负） */
  remainingMs?: number
  /** 距生效的毫秒数（未生效时为正） */
  untilValidMs?: number
  /** 从 iat（或 nbf）到 exp 已经过的比例 0–1 */
  progress?: number
}

const numericClaim = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && /^\d+$/.test(v)
      ? Number(v)
      : undefined

export function timeState(payload: Record<string, unknown>, nowMs: number): JwtTimeState {
  const exp = numericClaim(payload.exp)
  const nbf = numericClaim(payload.nbf)
  const iat = numericClaim(payload.iat)
  const base = { exp, nbf, iat }
  if (nbf !== undefined && nowMs < nbf * 1000) {
    return { ...base, state: 'notYet', untilValidMs: nbf * 1000 - nowMs }
  }
  if (exp === undefined) return { ...base, state: 'noExp' }
  const remainingMs = exp * 1000 - nowMs
  const startSec = iat ?? nbf
  let progress: number | undefined
  if (startSec !== undefined && exp > startSec) {
    progress = Math.min(1, Math.max(0, (nowMs / 1000 - startSec) / (exp - startSec)))
  }
  return { ...base, state: remainingMs <= 0 ? 'expired' : 'valid', remainingMs, progress }
}

// ───────────── 时间格式 ─────────────

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 秒级时间戳 → "YYYY-MM-DD HH:mm:ss"（指定时区，缺省为本地时区） */
export function formatDateTime(seconds: number, timeZone?: string): string {
  const d = new Date(seconds * 1000)
  if (Number.isNaN(d.getTime())) return '无效时间'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

/** 毫秒 → "2 天 3 小时 4 分 5 秒"（取最大的若干个单位） */
export function formatDuration(ms: number, maxUnits = 4): string {
  let s = Math.floor(Math.abs(ms) / 1000)
  const units: [number, string][] = [
    [365 * 86400, '年'],
    [86400, '天'],
    [3600, '小时'],
    [60, '分'],
    [1, '秒'],
  ]
  const out: string[] = []
  for (const [size, label] of units) {
    if (out.length >= maxUnits) break
    const n = Math.floor(s / size)
    if (n > 0) {
      out.push(`${n} ${label}`)
      s -= n * size
    }
  }
  return out.length ? out.join(' ') : '0 秒'
}

/** 相对时间："3 分钟前" / "2 天后" */
export function formatRelative(diffMs: number): string {
  const abs = Math.abs(diffMs)
  if (abs < 5000) return '刚刚'
  const units: [number, string][] = [
    [365 * 86400000, '年'],
    [30 * 86400000, '个月'],
    [86400000, '天'],
    [3600000, '小时'],
    [60000, '分钟'],
    [1000, '秒'],
  ]
  for (const [size, label] of units) {
    if (abs >= size) {
      const n = Math.floor(abs / size)
      return diffMs < 0 ? `${n} ${label}前` : `${n} ${label}后`
    }
  }
  return '刚刚'
}

/** 倒计时 "HH:MM:SS"，超过一天前面加 "N 天" */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const hms = `${pad2(h)}:${pad2(m)}:${pad2(s)}`
  return d > 0 ? `${d} 天 ${hms}` : hms
}

// ───────────── 验签 ─────────────

export type AlgFamily = 'hmac' | 'rsa' | 'rsa-pss' | 'ec' | 'eddsa' | 'none' | 'unknown'

export function algFamily(alg: string): AlgFamily {
  if (/^HS(256|384|512)$/.test(alg)) return 'hmac'
  if (/^RS(256|384|512)$/.test(alg)) return 'rsa'
  if (/^PS(256|384|512)$/.test(alg)) return 'rsa-pss'
  if (/^ES(256|384|512|256K)$/.test(alg)) return 'ec'
  if (alg === 'EdDSA' || alg === 'Ed25519') return 'eddsa'
  if (alg.toLowerCase() === 'none') return 'none'
  return 'unknown'
}

export const ALG_FAMILY_LABEL: Record<AlgFamily, string> = {
  hmac: 'HMAC 对称签名',
  rsa: 'RSA PKCS#1 v1.5',
  'rsa-pss': 'RSA-PSS',
  ec: 'ECDSA 椭圆曲线',
  eddsa: 'EdDSA',
  none: '未签名',
  unknown: '未知算法',
}

export interface VerifyKeyInput {
  secret?: string
  secretBase64?: boolean
  publicKey?: string
}

export interface VerifyOutcome {
  status: 'valid' | 'invalid' | 'error'
  message: string
  /** 附加说明（如「已从私钥中提取公钥」） */
  note?: string
}

/** HS 密钥：原文 UTF-8 或 Base64 / Base64URL */
export function secretBytes(secret: string, base64: boolean): Uint8Array {
  if (!secret) throw new VerifyError('请输入密钥')
  if (!base64) return utf8Encode(secret)
  try {
    return base64ToBytes(secret.trim(), { label: '密钥（Base64）' })
  } catch (e) {
    throw new VerifyError(e instanceof Error ? e.message : String(e))
  }
}

class VerifyError extends Error {}

const PRIVATE_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'] as const

function toPublicJwk(jwk: JWK): JWK {
  const out: Record<string, unknown> = { ...jwk }
  for (const f of PRIVATE_FIELDS) delete out[f]
  delete out.key_ops
  return out as JWK
}

type KeyLike = CryptoKey | ReturnType<typeof createLocalJWKSet>

/** 解析公钥文本：SPKI PEM / X.509 证书 / PKCS#8 私钥（自动取公钥）/ JWK / JWKS */
export async function importVerifyKey(
  text: string,
  alg: string,
): Promise<{ key: KeyLike; note?: string }> {
  const t = text.trim()
  if (!t) throw new VerifyError('请粘贴公钥（PEM、X.509 证书或 JWK / JWKS）')
  if (t.startsWith('{') || t.startsWith('[')) {
    const r = parseJson(t)
    if (!r.ok) throw new VerifyError(`JWK 不是合法的 JSON：${r.error}`)
    const v = r.value
    if (isObject(v) && Array.isArray(v.keys)) {
      return {
        key: createLocalJWKSet(v as unknown as JSONWebKeySet),
        note: `JWKS 共 ${v.keys.length} 个密钥，按 kid / alg 自动匹配`,
      }
    }
    if (!isObject(v) || typeof v.kty !== 'string') {
      throw new VerifyError('JWK 必须是包含 kty 字段的对象，或包含 keys 数组的 JWKS')
    }
    const hasPrivate = PRIVATE_FIELDS.some((f) => f in v && f !== 'k')
    if (v.kty === 'oct') {
      throw new VerifyError('这是对称密钥（kty: oct），HS 算法请直接填写密钥')
    }
    const key = await importJWK(toPublicJwk(v as JWK), alg)
    if (key instanceof Uint8Array) throw new VerifyError('JWK 不是公钥')
    return { key, note: hasPrivate ? '检测到私钥 JWK，已只取公钥部分验签' : undefined }
  }
  if (/-----BEGIN PUBLIC KEY-----/.test(t)) return { key: await importSPKI(t, alg) }
  if (/-----BEGIN CERTIFICATE-----/.test(t)) {
    return { key: await importX509(t, alg), note: '已从 X.509 证书中提取公钥' }
  }
  if (/-----BEGIN RSA PUBLIC KEY-----/.test(t)) {
    throw new VerifyError(
      '这是 PKCS#1 格式的 RSA 公钥（BEGIN RSA PUBLIC KEY），请先转换为 SPKI：\nopenssl rsa -RSAPublicKey_in -in key.pem -pubout',
    )
  }
  if (/-----BEGIN PRIVATE KEY-----/.test(t)) {
    const priv = await importPKCS8(t, alg, { extractable: true })
    const pub = await importJWK(toPublicJwk(await exportJWK(priv)), alg)
    return {
      key: pub as CryptoKey,
      note: '检测到 PKCS#8 私钥，已自动提取公钥验签（请勿在不可信环境粘贴私钥）',
    }
  }
  if (/-----BEGIN (RSA|EC) PRIVATE KEY-----/.test(t)) {
    throw new VerifyError(
      '这是传统格式私钥，请粘贴公钥；或转换为 PKCS#8：\nopenssl pkcs8 -topk8 -nocrypt -in key.pem',
    )
  }
  throw new VerifyError(
    '无法识别的公钥格式：请粘贴 PEM（-----BEGIN PUBLIC KEY-----）、X.509 证书，或 JWK / JWKS JSON',
  )
}

function joseMessage(e: unknown, alg: string): string {
  if (e instanceof VerifyError) return e.message
  if (e instanceof joseErrors.JWSSignatureVerificationFailed) {
    return '签名不匹配：令牌内容被修改过，或密钥不正确'
  }
  if (e instanceof joseErrors.JWKSNoMatchingKey) {
    return 'JWKS 中没有与令牌 kid / alg 匹配的公钥'
  }
  if (e instanceof joseErrors.JWKSMultipleMatchingKeys) {
    return 'JWKS 中有多个匹配的公钥，请在令牌 Header 中指定 kid'
  }
  if (e instanceof joseErrors.JOSENotSupported) return `不支持的算法或密钥类型：${alg}`
  if (e instanceof joseErrors.JWSInvalid) return `JWS 格式无效：${e.message}`
  const msg = e instanceof Error ? e.message : String(e)
  if (/Zero-length key/i.test(msg)) return '密钥不能为空'
  if (/modulusLength|2048 bits/i.test(msg)) return 'RSA 密钥长度不足 2048 位，出于安全考虑被拒绝'
  if (/Invalid keyData|DataError|Failed to read|asn1|DER/i.test(msg)) {
    return '公钥数据无效：PEM / JWK 内容损坏或不完整'
  }
  if (
    /Invalid key type|must be of type|does not support this operation|algorithm\.name|namedCurve|curve/i.test(
      msg,
    )
  ) {
    return `密钥类型与算法 ${alg} 不匹配（例如用 RSA 公钥验证 ES256 令牌）`
  }
  return `验签失败：${msg}`
}

/** 非安全上下文（如用局域网 IP 通过 http 打开）里浏览器不提供 crypto.subtle，jose 无法工作 */
export const NO_WEBCRYPTO =
  '当前页面不在安全上下文（HTTPS 或 localhost）中，浏览器禁用了 Web Crypto，无法验证或生成签名；请改用 https:// 或 localhost 打开。'

const hasWebCrypto = () => !!globalThis.crypto?.subtle

/** 验证签名（不校验 exp / nbf，时间状态单独显示）；永不抛出 */
export async function verifyJwt(token: string, key: VerifyKeyInput): Promise<VerifyOutcome> {
  const decoded = decodeJwt(token)
  if (!decoded) return { status: 'error', message: '请输入令牌' }
  if (!decoded.ok) return { status: 'error', message: decoded.error }
  const { alg } = decoded.jwt
  const family = algFamily(alg)
  if (family === 'none') {
    return { status: 'invalid', message: '未签名令牌（alg: none）没有可以验证的签名' }
  }
  if (family === 'unknown')
    return { status: 'error', message: `不支持的签名算法：${alg || '（空）'}` }
  if (!hasWebCrypto()) return { status: 'error', message: NO_WEBCRYPTO }
  try {
    let note: string | undefined
    if (family === 'hmac') {
      const bytes = secretBytes(key.secret ?? '', !!key.secretBase64)
      await compactVerify(decoded.jwt.token, bytes, { algorithms: [alg] })
    } else {
      const imported = await importVerifyKey(key.publicKey ?? '', alg)
      note = imported.note
      if (typeof imported.key === 'function') {
        await compactVerify(decoded.jwt.token, imported.key, { algorithms: [alg] })
      } else {
        await compactVerify(decoded.jwt.token, imported.key, { algorithms: [alg] })
      }
    }
    return { status: 'valid', message: `签名有效（${alg}）`, note }
  } catch (e) {
    const message = joseMessage(e, alg)
    const invalid = e instanceof joseErrors.JWSSignatureVerificationFailed
    return { status: invalid ? 'invalid' : 'error', message }
  }
}

// ───────────── 签发 ─────────────

export const HMAC_ALGS = ['HS256', 'HS384', 'HS512'] as const
export type HmacAlg = (typeof HMAC_ALGS)[number]

/** RFC 7518 §3.2：HMAC 密钥至少与哈希输出等长 */
export const MIN_SECRET_BYTES: Record<HmacAlg, number> = { HS256: 32, HS384: 48, HS512: 64 }

export type SignResult =
  | { ok: true; token: string; warnings: string[] }
  | { ok: false; error: string; field: 'header' | 'payload' | 'secret' }

export async function signHmacJwt(
  headerText: string,
  payloadText: string,
  secret: string,
  secretBase64: boolean,
  alg: HmacAlg,
): Promise<SignResult> {
  const h = parseJson(headerText)
  if (!h.ok) return { ok: false, field: 'header', error: `Header 不是合法的 JSON：${h.error}` }
  if (!isObject(h.value)) return { ok: false, field: 'header', error: 'Header 必须是 JSON 对象' }
  const p = parseJson(payloadText)
  if (!p.ok) return { ok: false, field: 'payload', error: `Payload 不是合法的 JSON：${p.error}` }
  if (!isObject(p.value)) {
    return { ok: false, field: 'payload', error: 'Payload 必须是 JSON 对象（声明集合）' }
  }
  let key: Uint8Array
  try {
    key = secretBytes(secret, secretBase64)
  } catch (e) {
    return { ok: false, field: 'secret', error: e instanceof Error ? e.message : String(e) }
  }
  if (key.length === 0) return { ok: false, field: 'secret', error: '密钥不能为空' }
  const warnings: string[] = []
  if (key.length < MIN_SECRET_BYTES[alg]) {
    warnings.push(
      `密钥只有 ${key.length} 字节，RFC 7518 要求 ${alg} 的密钥至少 ${MIN_SECRET_BYTES[alg]} 字节。`,
    )
  }
  const header = { ...h.value, alg }
  if (!hasWebCrypto()) return { ok: false, field: 'secret', error: NO_WEBCRYPTO }
  try {
    const token = await new CompactSign(utf8Encode(JSON.stringify(p.value)))
      .setProtectedHeader(header as { alg: string })
      .sign(key)
    return { ok: true, token, warnings }
  } catch (e) {
    return { ok: false, field: 'header', error: `签名失败：${joseMessage(e, alg)}` }
  }
}

/** 修改 payload JSON 中的若干声明（值为 undefined 表示删除），保持 2 空格缩进 */
export function patchClaims(
  payloadText: string,
  patch: Record<string, unknown>,
): { ok: true; text: string } | { ok: false; error: string } {
  const r = parseJson(payloadText.trim() ? payloadText : '{}')
  if (!r.ok) return { ok: false, error: `Payload 不是合法的 JSON：${r.error}` }
  if (!isObject(r.value)) return { ok: false, error: 'Payload 必须是 JSON 对象' }
  const next: Record<string, unknown> = { ...r.value }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]
    else next[k] = v
  }
  return { ok: true, text: JSON.stringify(next, null, 2) }
}

/** 同步签发 HS256 示例令牌（iat = now，1 小时后过期），用于页面初始示例 */
export function makeHs256Sample(nowSec: number, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    iss: 'https://auth.showme.dev',
    sub: 'user_42',
    aud: 'showme-web',
    name: '张三',
    email: 'zhangsan@example.com',
    roles: ['developer'],
    iat: nowSec,
    nbf: nowSec,
    exp: nowSec + 3600,
    jti: `demo-${nowSec.toString(36)}`,
  }
  const enc = (o: unknown) => bytesToBase64Url(utf8Encode(JSON.stringify(o)))
  const input = `${enc(header)}.${enc(payload)}`
  const mac = HmacSHA256(input, secret)
  const sig = new Uint8Array(mac.sigBytes)
  for (let i = 0; i < sig.length; i++) sig[i] = (mac.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
  return `${input}.${bytesToBase64Url(sig)}`
}
