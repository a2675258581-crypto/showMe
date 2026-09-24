/** URL 编解码与解析（纯函数，无 DOM 依赖，可在 Node 中运行） */

export type UrlCodecMode = 'component' | 'uri' | 'form'

export const URL_CODEC_MODES: { id: UrlCodecMode; label: string; hint: string }[] = [
  {
    id: 'component',
    label: 'encodeURIComponent',
    hint: "编码除 A–Z a–z 0–9 - _ . ! ~ * ' ( ) 之外的所有字符，适合编码单个参数值",
  },
  {
    id: 'uri',
    label: 'encodeURI',
    hint: '保留 ; / ? : @ & = + $ , # 等 URL 结构字符，适合编码整条链接',
  },
  {
    id: 'form',
    label: '表单（+ 号空格）',
    hint: 'application/x-www-form-urlencoded：空格变为 +，只保留 A–Z a–z 0–9 * - . _',
  },
]

export interface UrlEncodeOptions {
  mode: UrlCodecMode
  /** 逐行独立处理（换行不会被编码） */
  perLine?: boolean
  /** RFC 3986 严格模式：encodeURIComponent 额外编码 ! ' ( ) * */
  strict?: boolean
  /** 保留已经是 %XX 形式的转义，避免二次编码 */
  keepEscapes?: boolean
}

export interface UrlDecodeOptions {
  mode: UrlCodecMode
  perLine?: boolean
}

export interface CodecIssue {
  /** UTF-16 下标（相对整个输入） */
  index: number
  line: number
  column: number
  /** 出问题的原文 */
  text: string
  message: string
}

export interface CodecResult {
  output: string
  issues: CodecIssue[]
}

const HEX = '0123456789ABCDEF'
const MAX_ISSUES = 200

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const makeSet = (chars: string) => {
  const t = new Uint8Array(128)
  for (const c of chars) t[c.charCodeAt(0)] = 1
  return t
}
const SAFE: Record<string, Uint8Array> = {
  component: makeSet(ALNUM + "-_.!~*'()"),
  strict: makeSet(ALNUM + '-_.~'),
  uri: makeSet(ALNUM + "-_.!~*'();/?:@&=+$,#"),
  form: makeSet(ALNUM + '*-._'),
}
/** decodeURI 不会还原的保留字符 */
const URI_RESERVED = makeSet(';/?:@&=+$,#')

/** UTF-16 下标 → 1 起的行列号（列按 Unicode 字符计） */
export function lineColumn(text: string, index: number): { line: number; column: number } {
  return makeLocator(text)(index)
}

/**
 * 行列定位器：按递增顺序查询时从上一次的位置继续数，
 * 避免超长单行文本里每个问题都从头扫描（O(n²)）。
 */
function makeLocator(text: string) {
  let pos = 0
  let line = 1
  let column = 1
  return (index: number): { line: number; column: number } => {
    const target = Math.min(Math.max(index, 0), text.length)
    if (target < pos) {
      pos = 0
      line = 1
      column = 1
    }
    while (pos < target) {
      const c = text.charCodeAt(pos)
      if (c === 10) {
        line++
        column = 1
      } else if (!(
        c >= 0xdc00 &&
        c <= 0xdfff &&
        pos > 0 &&
        isHighSurrogate(text.charCodeAt(pos - 1))
      )) {
        column++
      }
      pos++
    }
    return { line, column }
  }
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff

const pct = (b: number) => '%' + HEX[b >> 4] + HEX[b & 15]
const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)

function utf8Bytes(cp: number): number[] {
  if (cp < 0x80) return [cp]
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 63)]
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)]
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)]
}

/** 按行拆分处理，并把各行的问题位置换算回整段输入 */
function runLines(
  text: string,
  perLine: boolean | undefined,
  fn: (s: string, push: (index: number, len: number, message: string) => void) => string,
): CodecResult {
  const issues: CodecIssue[] = []
  const locate = makeLocator(text)
  const push = (base: number) => (index: number, len: number, message: string) => {
    if (issues.length >= MAX_ISSUES) return
    const abs = base + index
    const { line, column } = locate(abs)
    issues.push({ index: abs, line, column, text: text.slice(abs, abs + len), message })
  }
  if (!perLine) return { output: fn(text, push(0)), issues }
  const out: string[] = []
  let base = 0
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    out.push(line ? fn(line, push(base)) : line)
    base += raw.length + 1
  }
  return { output: out.join('\n'), issues }
}

/** 百分号编码。孤立代理项无法编码为 UTF-8，会替换为 U+FFFD 并报告 */
export function urlEncode(text: string, opts: UrlEncodeOptions): CodecResult {
  const safe =
    opts.mode === 'component' && opts.strict ? SAFE.strict : (SAFE[opts.mode] ?? SAFE.component)
  const form = opts.mode === 'form'
  return runLines(text, opts.perLine, (s, push) => {
    let out = ''
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      if (c < 128) {
        if (safe[c]) out += s[i]
        else if (form && c === 32) out += '+'
        else if (
          c === 37 &&
          opts.keepEscapes &&
          isHex(s.charCodeAt(i + 1)) &&
          isHex(s.charCodeAt(i + 2))
        ) {
          out += s.slice(i, i + 3).toUpperCase()
          i += 2
        } else out += pct(c)
        continue
      }
      let cp = s.codePointAt(i)!
      if (cp > 0xffff) i++
      else if (cp >= 0xd800 && cp <= 0xdfff) {
        push(
          i,
          1,
          `孤立的代理项 U+${cp.toString(16).toUpperCase()} 无法编码为 UTF-8，已替换为 U+FFFD`,
        )
        cp = 0xfffd
      }
      for (const b of utf8Bytes(cp)) out += pct(b)
    }
    return out
  })
}

/** 从 bytes[i] 开始的合法 UTF-8 序列：[长度, 码点]；不合法时长度为 0 */
function utf8Seq(bytes: number[], i: number): [number, number] {
  const b = bytes[i]
  if (b < 0x80) return [1, b]
  let need: number
  let min: number
  if (b >= 0xc2 && b <= 0xdf) [need, min] = [1, 0x80]
  else if (b >= 0xe0 && b <= 0xef) [need, min] = [2, 0x800]
  else if (b >= 0xf0 && b <= 0xf4) [need, min] = [3, 0x10000]
  else return [0, 0]
  if (i + need >= bytes.length) return [0, 0]
  let cp = b & (0x3f >> need)
  for (let k = 1; k <= need; k++) {
    const c = bytes[i + k]
    if ((c & 0xc0) !== 0x80) return [0, 0]
    cp = (cp << 6) | (c & 63)
  }
  if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return [0, 0]
  return [need + 1, cp]
}

/**
 * 百分号解码（宽松）：残缺的 %、非法十六进制、不完整的 UTF-8 序列都原样保留，
 * 同时在 issues 里给出精确位置。
 */
export function urlDecode(text: string, opts: UrlDecodeOptions): CodecResult {
  const form = opts.mode === 'form'
  const keepReserved = opts.mode === 'uri'
  return runLines(text, opts.perLine, (s, push) => {
    let out = ''
    let i = 0
    while (i < s.length) {
      const c = s.charCodeAt(i)
      if (c === 43 && form) {
        out += ' '
        i++
        continue
      }
      if (c !== 37) {
        out += s[i]
        i++
        continue
      }
      if (!isHex(s.charCodeAt(i + 1)) || !isHex(s.charCodeAt(i + 2))) {
        const bad = s.slice(i, i + 3)
        push(
          i,
          Math.min(3, s.length - i),
          i + 1 >= s.length
            ? '末尾有一个单独的 %，已原样保留'
            : `“${bad}” 不是合法的转义：% 后应为两位十六进制数字（如 %20），已原样保留`,
        )
        out += '%'
        i++
        continue
      }
      // 收集连续的 %XX 字节
      const start = i
      const bytes: number[] = []
      const pos: number[] = []
      while (s.charCodeAt(i) === 37 && isHex(s.charCodeAt(i + 1)) && isHex(s.charCodeAt(i + 2))) {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16))
        pos.push(i)
        i += 3
      }
      let k = 0
      while (k < bytes.length) {
        const [n, cp] = utf8Seq(bytes, k)
        if (n === 0) {
          // 找到这段非法序列的范围：到下一个可以开始新字符的字节为止
          let end = k + 1
          while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end++
          const from = pos[k]
          const to = end < pos.length ? pos[end] : start + bytes.length * 3
          const raw = s.slice(from, to)
          push(
            from,
            to - from,
            bytes[k] >= 0x80 && bytes[k] < 0xc0
              ? `“${raw}” 是孤立的 UTF-8 后续字节，已原样保留`
              : `“${raw}” 不是完整或合法的 UTF-8 序列，已原样保留`,
          )
          out += raw
          k = end
          continue
        }
        if (n === 1 && keepReserved && URI_RESERVED[bytes[k]]) {
          out += s.slice(pos[k], pos[k] + 3)
        } else {
          out += String.fromCodePoint(cp)
        }
        k += n
      }
    }
    return out
  })
}

// ───────────────────────── URL 解析 ─────────────────────────

export interface QueryParam {
  key: string
  value: string
  /** 是否带 =（`?flag` 与 `?flag=` 不同） */
  hasValue: boolean
  /** 原始片段（未修改时重建 URL 原样使用，保持原有编码风格） */
  raw: string | null
}

export interface UrlParts {
  href: string
  protocol: string
  username: string
  password: string
  hostname: string
  /** 国际化域名的 Unicode 形式（与 hostname 相同时为 undefined） */
  hostUnicode?: string
  port: string
  /** 协议默认端口（端口省略时） */
  defaultPort?: string
  pathname: string
  search: string
  hash: string
  origin: string
}

export type ParseUrlResult =
  | {
      ok: true
      url: UrlParts
      params: QueryParam[]
      assumedScheme: boolean
      /** 相对地址（/path?x=1、?x=1、#frag 等）：只有路径、查询与片段 */
      relative: boolean
    }
  | { ok: false; error: string }

const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
}

/** 宽松的百分号解码：失败时返回原文 */
export function safeDecode(s: string, plusAsSpace = false): string {
  const t = plusAsSpace ? s.replace(/\+/g, ' ') : s
  try {
    return decodeURIComponent(t)
  } catch {
    return urlDecode(t, { mode: 'component' }).output
  }
}

/** 按字符串拆出 查询 与 片段（保持原文，不做规范化） */
export function splitUrl(input: string): { base: string; query: string | null; hash: string } {
  const h = input.indexOf('#')
  const beforeHash = h >= 0 ? input.slice(0, h) : input
  const hash = h >= 0 ? input.slice(h) : ''
  const q = beforeHash.indexOf('?')
  return {
    base: q >= 0 ? beforeHash.slice(0, q) : beforeHash,
    query: q >= 0 ? beforeHash.slice(q + 1) : null,
    hash,
  }
}

/** 解析查询串（不含 ?）。+ 按表单规则视为空格 */
export function parseQuery(query: string): QueryParam[] {
  if (!query) return []
  return query
    .split('&')
    .filter((p) => p !== '')
    .map((raw) => {
      const eq = raw.indexOf('=')
      const k = eq >= 0 ? raw.slice(0, eq) : raw
      const v = eq >= 0 ? raw.slice(eq + 1) : ''
      return { key: safeDecode(k, true), value: safeDecode(v, true), hasValue: eq >= 0, raw }
    })
}

const QUERY_SAFE = makeSet(ALNUM + "-_.~!$'()*,;:@/?")

/** 编码查询参数的键或值：保留可读的安全字符，& = + # 与空格等必须编码 */
export function encodeQueryPart(s: string, spaceAsPlus = false): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 128) {
      if (QUERY_SAFE[c]) out += s[i]
      else if (c === 32 && spaceAsPlus) out += '+'
      else out += pct(c)
      continue
    }
    let cp = s.codePointAt(i)!
    if (cp > 0xffff) i++
    else if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd
    for (const b of utf8Bytes(cp)) out += pct(b)
  }
  return out
}

export function serializeParam(p: QueryParam, spaceAsPlus = false): string {
  if (p.raw !== null) return p.raw
  const k = encodeQueryPart(p.key, spaceAsPlus)
  return p.hasValue ? `${k}=${encodeQueryPart(p.value, spaceAsPlus)}` : k
}

export function serializeQuery(params: QueryParam[], spaceAsPlus = false): string {
  return params.map((p) => serializeParam(p, spaceAsPlus)).join('&')
}

/** 用新的参数列表替换 URL 的查询部分，其余部分保持原文 */
export function rebuildUrl(input: string, params: QueryParam[], spaceAsPlus = false): string {
  const { base, hash } = splitUrl(input.trim())
  const q = serializeQuery(params, spaceAsPlus)
  return base + (q ? `?${q}` : '') + hash
}

// ── Punycode（RFC 3492）解码，用于把 xn-- 域名还原为中文等 Unicode

function punyDecode(input: string): string {
  const base = 36
  const tMin = 1
  const tMax = 26
  const skew = 38
  const damp = 700
  let n = 128
  let bias = 72
  let i = 0
  const basic = input.lastIndexOf('-')
  const output: number[] = []
  for (let j = 0; j < Math.max(0, basic); j++) output.push(input.charCodeAt(j))
  const adapt = (delta: number, numPoints: number, first: boolean) => {
    delta = first ? Math.floor(delta / damp) : delta >> 1
    delta += Math.floor(delta / numPoints)
    let k = 0
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin))
      k += base
    }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew))
  }
  const digit = (c: number) =>
    c >= 48 && c <= 57 ? c - 22 : c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 97 : base
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
    const oldi = i
    let w = 1
    for (let k = base; ; k += base) {
      if (idx >= input.length) throw new Error('punycode')
      const d = digit(input.charCodeAt(idx++))
      if (d >= base) throw new Error('punycode')
      i += d * w
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias
      if (d < t) break
      w *= base - t
    }
    bias = adapt(i - oldi, output.length + 1, oldi === 0)
    n += Math.floor(i / (output.length + 1))
    i %= output.length + 1
    if (n > 0x10ffff) throw new Error('punycode')
    output.splice(i++, 0, n)
  }
  return String.fromCodePoint(...output)
}

/** xn--fiqs8s.xn--fiqz9s → 中国.中國；无法解码的标签保持原样 */
export function domainToUnicode(host: string): string {
  return host
    .split('.')
    .map((label) => {
      if (!/^xn--/i.test(label)) return label
      try {
        return punyDecode(label.slice(4))
      } catch {
        return label
      }
    })
    .join('.')
}

/** 为常见错误给出中文原因 */
function diagnose(input: string): string {
  const t = input.trim()
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(t)
  if (m) {
    const auth = m[2]
    const hostPort = auth.slice(auth.lastIndexOf('@') + 1)
    if (/\s/.test(hostPort)) return '主机名中不能含有空白字符，请检查是否多了空格或换行'
    if (/\s/.test(auth)) return 'URL 中含有空白字符，请先删除或编码为 %20'
    if (hostPort.startsWith('[') && !hostPort.includes(']'))
      return 'IPv6 地址缺少右方括号“]”，应写成 [::1]:8080 这样的形式'
    const port = /^(?:\[[^\]]*\]|[^:]*):(.*)$/.exec(hostPort)?.[1]
    if (port !== undefined && port !== '') {
      if (!/^\d+$/.test(port)) return `端口“${port}”不是数字`
      if (Number(port) > 65535) return `端口 ${port} 超出范围（0–65535）`
    }
    const host = hostPort.replace(/:\d*$/, '')
    if (!host && !/^file:/i.test(t)) return '缺少主机名：“//” 后面应是域名或 IP'
    const bad = /[<>^`{|}\\%"]/.exec(host)
    if (bad) return `主机名中不能包含字符“${bad[0]}”`
    if (/^\[/.test(host) && !/^\[[0-9a-f:.]+\]$/i.test(host)) return `IPv6 地址“${host}”格式不正确`
  }
  if (/\s/.test(t)) return 'URL 中含有空白字符，请先删除或编码为 %20'
  return '无法解析为 URL：请检查协议（如 https://）、主机名与端口是否正确'
}

/** 需要主机名的“特殊”协议（WHATWG URL 标准） */
const SPECIAL_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:'])

/** 相对地址：/path、?query、#hash、./x、../x（不含 //host 形式） */
const RELATIVE_RE = /^(?:\/(?!\/)|\?|#|\.\.?(?:\/|$))/

function parseRelative(text: string): ParseUrlResult {
  if (/\s/.test(text)) return { ok: false, error: 'URL 中含有空白字符，请先删除或编码为 %20' }
  const { base, query, hash } = splitUrl(text)
  return {
    ok: true,
    assumedScheme: false,
    relative: true,
    url: {
      href: text,
      protocol: '',
      username: '',
      password: '',
      hostname: '',
      port: '',
      pathname: base,
      // 与 URL 对象一致：只有 “?” / “#” 而没有内容时视为空
      search: query ? `?${query}` : '',
      hash: hash === '#' ? '' : hash,
      origin: '',
    },
    params: parseQuery(query ?? ''),
  }
}

/** 解析 URL；没有协议时按 https:// 补全 */
export function parseUrl(input: string): ParseUrlResult {
  const text = input.trim()
  if (!text) return { ok: false, error: '请输入 URL' }
  // 相对地址不能补全协议，否则 “/api/users” 会被当成主机 “api”
  if (RELATIVE_RE.test(text)) return parseRelative(text)
  // “localhost:3000/x”、“example.com:8080” 这类没有协议的主机:端口，也按 https:// 补全
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[\w.-]+:\d+(?:[/?#]|$)/.test(text)
  const assumedScheme = !hasScheme
  const candidate = hasScheme ? text : 'https://' + text.replace(/^\/\//, '')
  let u: URL
  try {
    u = new URL(candidate)
  } catch {
    return { ok: false, error: diagnose(candidate) }
  }
  // Chromium 对非法主机名（如含空格）比标准宽松，会把它百分号编码后照样返回；按标准视为错误
  if (SPECIAL_SCHEMES.has(u.protocol) && u.hostname.includes('%')) {
    return { ok: false, error: diagnose(candidate) }
  }
  const hostUnicode = domainToUnicode(u.hostname)
  const { query } = splitUrl(candidate)
  return {
    ok: true,
    assumedScheme,
    relative: false,
    url: {
      href: u.href,
      protocol: u.protocol,
      username: u.username,
      password: u.password,
      hostname: u.hostname,
      hostUnicode: hostUnicode !== u.hostname ? hostUnicode : undefined,
      port: u.port,
      defaultPort: u.port ? undefined : DEFAULT_PORTS[u.protocol],
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
      origin: u.origin,
    },
    params: parseQuery(query ?? ''),
  }
}

/** 解析结果 → 便于复制的 JSON（重复的键合并为数组） */
export function urlToJson(url: UrlParts, params: QueryParam[]): string {
  // 无原型对象：参数名为 constructor、toString、__proto__ 时也能正确收集
  const query: Record<string, string | string[]> = Object.create(null)
  for (const p of params) {
    const prev = query[p.key]
    if (prev === undefined) query[p.key] = p.value
    else query[p.key] = Array.isArray(prev) ? [...prev, p.value] : [prev, p.value]
  }
  const obj: Record<string, unknown> = {
    href: url.href,
    ...(url.origin ? { origin: url.origin } : {}),
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    ...(url.hostUnicode ? { hostUnicode: url.hostUnicode } : {}),
    port: url.port,
    pathname: url.pathname,
    pathSegments: url.pathname
      .split('/')
      .filter(Boolean)
      .map((s) => safeDecode(s)),
    search: url.search,
    hash: url.hash,
    query,
  }
  return JSON.stringify(obj, null, 2)
}
