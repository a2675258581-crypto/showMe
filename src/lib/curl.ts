/**
 * cURL 命令解析（纯函数，无 DOM 依赖）。
 *
 * - 支持 bash / zsh 写法：单引号、双引号转义、$'…' ANSI-C 引号、反斜杠续行、注释、管道与重定向
 * - 支持 Windows cmd 写法：^ 转义与 ^ 续行（含 Chrome DevTools「Copy as cURL (cmd)」）
 * - 解析常用参数，输出结构化请求 + 未支持参数的中文提示
 */

export interface FormPart {
  name: string
  /** 文本字段为字段值；文件字段为本地文件路径 */
  value: string
  kind: 'text' | 'file'
  /** 文件字段上传时使用的文件名（缺省为路径的文件名部分） */
  filename?: string
  contentType?: string
}

export type RequestBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'multipart'; parts: FormPart[] }
  /** 请求体来自本地文件（--data-binary @file、-T file） */
  | { kind: 'file'; path: string }

export interface BasicAuth {
  username: string
  password: string
}

/** 与具体工具无关的结构化 HTTP 请求：cURL 解析结果、代码生成的输入 */
export interface HttpRequest {
  method: string
  url: string
  /** 按出现顺序保存，允许重名 */
  headers: [string, string][]
  body: RequestBody
  auth?: BasicAuth
  /** true：跟随重定向（-L）；false：明确不跟随；undefined：沿用各语言默认行为 */
  followRedirects?: boolean
  /** 跳过 TLS 证书校验（-k） */
  insecure?: boolean
  /** 请求压缩响应（--compressed） */
  compressed?: boolean
  /** 整体超时，单位秒（-m） */
  timeout?: number
}

export type CurlParseResult =
  | { ok: true; request: HttpRequest; warnings: string[] }
  | { ok: false; error: string; warnings: string[] }

export type ShellDialect = 'bash' | 'cmd'

class ShellSyntaxError extends Error {
  index: number
  constructor(message: string, index: number) {
    super(message)
    this.index = index
  }
}

/** 字符下标 → 「第 x 行第 y 列」 */
export function describePosition(src: string, index: number): string {
  let line = 1
  let col = 1
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === '\n') {
      line++
      col = 1
    } else col++
  }
  return `第 ${line} 行第 ${col} 列`
}

/** 粗略判断一段文本是不是 curl 命令（用于粘贴时自动导入） */
export function looksLikeCurl(text: string): boolean {
  return /^\s*(?:\$\s+)?curl(?:\.exe)?(?:\s|\^|\\|$)/i.test(text)
}

/** Windows cmd 写法：出现 ^" 或行尾 ^ 续行 */
export function detectDialect(src: string): ShellDialect {
  return /\^"|\^\r?\n/.test(src) ? 'cmd' : 'bash'
}

// ───────────────────────────── 分词 ─────────────────────────────

interface TokenizeResult {
  tokens: string[]
  notes: string[]
}

const WS = new Set([' ', '\t', '\n', '\r', '\f', '\v'])

/** bash 分词：只做引号/转义处理，不做变量展开和通配 */
export function tokenizeBash(src: string): TokenizeResult {
  const tokens: string[] = []
  const notes: string[] = []
  let cur = ''
  let inToken = false
  let i = 0
  const n = src.length
  const push = () => {
    if (inToken) tokens.push(cur)
    cur = ''
    inToken = false
  }

  while (i < n) {
    const c = src[i]

    if (c === '\\') {
      const next = src[i + 1]
      if (next === '\n') {
        i += 2
        continue
      }
      if (next === '\r' && src[i + 2] === '\n') {
        i += 3
        continue
      }
      if (next === undefined) {
        i++
        continue
      }
      cur += next
      inToken = true
      i += 2
      continue
    }

    if (WS.has(c)) {
      push()
      i++
      continue
    }

    // PowerShell 的反引号续行
    if (c === '`' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) {
      push()
      i += src[i + 1] === '\r' ? 3 : 2
      continue
    }

    if (c === "'") {
      const end = src.indexOf("'", i + 1)
      if (end < 0) throw new ShellSyntaxError('单引号没有闭合', i)
      cur += src.slice(i + 1, end)
      inToken = true
      i = end + 1
      continue
    }

    if (c === '$' && src[i + 1] === "'") {
      const r = readAnsiC(src, i + 2)
      cur += r.value
      inToken = true
      i = r.end
      continue
    }

    if (c === '"' || (c === '$' && src[i + 1] === '"')) {
      const start = c === '$' ? i + 1 : i
      let j = start + 1
      let s = ''
      for (;;) {
        if (j >= n) throw new ShellSyntaxError('双引号没有闭合', start)
        const d = src[j]
        if (d === '"') break
        if (d === '\\') {
          const e = src[j + 1]
          if (e === '\n') {
            j += 2
            continue
          }
          if (e === '\r' && src[j + 2] === '\n') {
            j += 3
            continue
          }
          if (e === '"' || e === '\\' || e === '$' || e === '`') {
            s += e
            j += 2
            continue
          }
          s += '\\'
          j++
          continue
        }
        s += d
        j++
      }
      cur += s
      inToken = true
      i = j + 1
      continue
    }

    if (c === '#' && !inToken) {
      const nl = src.indexOf('\n', i)
      i = nl < 0 ? n : nl
      continue
    }

    if (c === '|' || c === ';' || (c === '&' && (src[i + 1] === '&' || isBoundary(src, i + 1)))) {
      push()
      const rest = src.slice(i).trim()
      if (rest.length > 1 || c !== '&') notes.push('已忽略管道 / 分号之后的内容')
      break
    }

    if (c === '>' || c === '<') {
      // 重定向：2>&1、> out.json、< in.txt —— 连同目标一起丢弃
      if (inToken && /^\d+$/.test(cur)) {
        cur = ''
        inToken = false
      } else push()
      i++
      if (src[i] === '>' || src[i] === '&') i++
      if (src[i - 1] === '&') {
        while (i < n && /\d|-/.test(src[i])) i++
      } else {
        while (i < n && (src[i] === ' ' || src[i] === '\t')) i++
        // 读取并丢弃重定向目标（可能带引号）
        const sub = tokenizeWord(src, i)
        i = sub
      }
      notes.push('已忽略输出重定向')
      continue
    }

    cur += c
    inToken = true
    i++
  }
  push()
  return { tokens, notes }
}

function isBoundary(src: string, i: number): boolean {
  return i >= src.length || WS.has(src[i])
}

/** 跳过一个 shell 单词（重定向目标），返回结束位置 */
function tokenizeWord(src: string, start: number): number {
  let i = start
  while (i < src.length && !WS.has(src[i])) {
    const c = src[i]
    if (c === "'") {
      const end = src.indexOf("'", i + 1)
      i = end < 0 ? src.length : end + 1
    } else if (c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1
      i = j + 1
    } else if (c === '\\') i += 2
    else i++
  }
  return Math.min(i, src.length)
}

/** $'…' ANSI-C 引号，start 指向引号后的第一个字符 */
function readAnsiC(src: string, start: number): { value: string; end: number } {
  let out = ''
  let bytes: number[] = []
  const flush = () => {
    if (bytes.length) {
      out += new TextDecoder().decode(new Uint8Array(bytes))
      bytes = []
    }
  }
  let i = start
  for (;;) {
    if (i >= src.length) throw new ShellSyntaxError("$'…' 引号没有闭合", start - 2)
    const c = src[i]
    if (c === "'") break
    if (c !== '\\') {
      flush()
      out += c
      i++
      continue
    }
    const e = src[i + 1]
    i += 2
    const simple: Record<string, string> = {
      a: '\x07',
      b: '\b',
      e: '\x1b',
      E: '\x1b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      '\\': '\\',
      "'": "'",
      '"': '"',
      '?': '?',
    }
    if (e in simple) {
      flush()
      out += simple[e]
      continue
    }
    if (e === 'x') {
      const m = /^[0-9a-fA-F]{1,2}/.exec(src.slice(i, i + 2))
      if (m) {
        bytes.push(parseInt(m[0], 16))
        i += m[0].length
      } else {
        flush()
        out += '\\x'
      }
      continue
    }
    if (e !== undefined && e >= '0' && e <= '7') {
      const m = /^[0-7]{1,3}/.exec(src.slice(i - 1, i + 2))!
      bytes.push(parseInt(m[0], 8) & 0xff)
      i += m[0].length - 1
      continue
    }
    if (e === 'u' || e === 'U') {
      const max = e === 'u' ? 4 : 8
      const m = new RegExp(`^[0-9a-fA-F]{1,${max}}`).exec(src.slice(i, i + max))
      flush()
      if (m) {
        const cp = parseInt(m[0], 16)
        out += cp <= 0x10ffff ? String.fromCodePoint(cp) : '�'
        i += m[0].length
      } else out += '\\' + e
      continue
    }
    if (e === 'c' && src[i] !== undefined) {
      flush()
      out += String.fromCharCode(src[i].toUpperCase().charCodeAt(0) & 0x1f)
      i++
      continue
    }
    flush()
    out += '\\' + (e ?? '')
  }
  flush()
  return { value: out, end: i + 1 }
}

/**
 * Windows cmd 分词：
 *  1. cmd.exe 层：^X → X；行尾 ^ 续行（换行后的首个字符按字面保留，所以 ^\n\n 表示换行本身）
 *  2. 参数层（MS CRT 规则）："…" 包裹，\" 为字面引号
 */
export function tokenizeCmd(src: string): TokenizeResult {
  const chrome = src.includes('^"')
  // 第一层：去掉插入符
  let s = ''
  let inQ = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '"') {
      inQ = !inQ
      s += c
      continue
    }
    if (c === '^' && !inQ) {
      let j = i + 1
      if (src[j] === '\r' && src[j + 1] === '\n') j++
      if (src[j] === '\n') {
        // 续行：换行后的首个字符按字面处理
        j++
        if (src[j] === '\r' && src[j + 1] === '\n') j++
        if (j < src.length) s += src[j] === '\r' ? '\n' : src[j]
        i = j
        continue
      }
      if (j < src.length) s += src[j]
      i = j
      continue
    }
    s += c
  }

  // 第二层：MS CRT 参数切分
  const tokens: string[] = []
  let cur = ''
  let inToken = false
  let quoted = false
  let quoteStart = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      let k = 0
      while (s[i + k] === '\\') k++
      if (s[i + k] === '"') {
        cur += '\\'.repeat(Math.floor(k / 2))
        if (k % 2 === 1) {
          cur += '"'
          i += k
        } else i += k - 1
        inToken = true
        continue
      }
      // Chrome 会把所有反斜杠加倍，这里还原
      cur += '\\'.repeat(chrome ? Math.ceil(k / 2) : k)
      inToken = true
      i += k - 1
      continue
    }
    if (c === '"') {
      if (!quoted) quoteStart = i
      quoted = !quoted
      inToken = true
      continue
    }
    if (!quoted && WS.has(c)) {
      if (inToken) tokens.push(cur)
      cur = ''
      inToken = false
      continue
    }
    cur += c
    inToken = true
  }
  if (quoted) throw new ShellSyntaxError('双引号没有闭合', mapBack(src, quoteStart))
  if (inToken) tokens.push(cur)
  return { tokens, notes: [] }
}

/** 第二层下标近似映射回原文（只用于错误定位） */
function mapBack(src: string, idx: number): number {
  return Math.min(idx, src.length - 1)
}

export function tokenize(src: string, dialect: ShellDialect = detectDialect(src)): TokenizeResult {
  return dialect === 'cmd' ? tokenizeCmd(src) : tokenizeBash(src)
}

// ───────────────────────────── 参数表 ─────────────────────────────

const SHORT: Record<string, string> = {
  X: 'request',
  H: 'header',
  d: 'data',
  F: 'form',
  u: 'user',
  b: 'cookie',
  A: 'user-agent',
  e: 'referer',
  G: 'get',
  I: 'head',
  L: 'location',
  k: 'insecure',
  m: 'max-time',
  T: 'upload-file',
  r: 'range',
  x: 'proxy',
  o: 'output',
  O: 'remote-name',
  s: 'silent',
  S: 'show-error',
  v: 'verbose',
  i: 'include',
  f: 'fail',
  c: 'cookie-jar',
  D: 'dump-header',
  w: 'write-out',
  K: 'config',
  E: 'cert',
  C: 'continue-at',
  U: 'proxy-user',
  z: 'time-cond',
  Y: 'speed-limit',
  y: 'speed-time',
  P: 'ftp-port',
  Q: 'quote',
  t: 'telnet-option',
  '0': 'http1.0',
  '1': 'tlsv1',
  '2': 'sslv2',
  '3': 'sslv3',
  '4': 'ipv4',
  '6': 'ipv6',
  a: 'append',
  B: 'use-ascii',
  g: 'globoff',
  h: 'help',
  j: 'junk-session-cookies',
  J: 'remote-header-name',
  l: 'list-only',
  M: 'manual',
  n: 'netrc',
  N: 'no-buffer',
  p: 'proxytunnel',
  q: 'disable',
  R: 'remote-time',
  V: 'version',
  Z: 'parallel',
  '#': 'progress-bar',
}

/** 需要取值的长参数 */
const WITH_ARG = new Set([
  'request',
  'header',
  'data',
  'data-ascii',
  'data-binary',
  'data-raw',
  'data-urlencode',
  'json',
  'form',
  'form-string',
  'user',
  'cookie',
  'user-agent',
  'referer',
  'max-time',
  'connect-timeout',
  'upload-file',
  'range',
  'proxy',
  'output',
  'cookie-jar',
  'dump-header',
  'write-out',
  'config',
  'cert',
  'cert-type',
  'key',
  'key-type',
  'pass',
  'cacert',
  'capath',
  'ciphers',
  'continue-at',
  'proxy-user',
  'time-cond',
  'speed-limit',
  'speed-time',
  'ftp-port',
  'quote',
  'telnet-option',
  'url',
  'url-query',
  'oauth2-bearer',
  'max-redirs',
  'resolve',
  'connect-to',
  'interface',
  'limit-rate',
  'max-filesize',
  'retry',
  'retry-delay',
  'retry-max-time',
  'expect100-timeout',
  'keepalive-time',
  'local-port',
  'noproxy',
  'output-dir',
  'proto',
  'proto-default',
  'proto-redir',
  'proxy-header',
  'preproxy',
  'socks4',
  'socks4a',
  'socks5',
  'socks5-hostname',
  'unix-socket',
  'abstract-unix-socket',
  'aws-sigv4',
  'variable',
  'stderr',
  'trace',
  'trace-ascii',
  'trace-config',
  'netrc-file',
  'dns-servers',
  'doh-url',
  'alt-svc',
  'hsts',
  'etag-save',
  'etag-compare',
  'libcurl',
  'rate',
  'request-target',
  'service-name',
  'sasl-authzid',
  'login-options',
  'mail-from',
  'mail-rcpt',
  'mail-auth',
  'tls-max',
  'tls13-ciphers',
  'pinnedpubkey',
  'crlfile',
  'happy-eyeballs-timeout-ms',
  'ip-tos',
  'parallel-max',
  'create-file-mode',
  'ech',
  'curves',
  'krb',
  'delegation',
  'engine',
  'egd-file',
  'random-file',
  'hostpubmd5',
  'hostpubsha256',
  'pubkey',
  'tftp-blksize',
  'ftp-account',
  'ftp-alternative-to-user',
  'ftp-method',
  'ftp-ssl-ccc-mode',
  'socks5-gssapi-service',
  'tlsauthtype',
  'tlsuser',
  'tlspassword',
  'dns-interface',
  'dns-ipv4-addr',
  'dns-ipv6-addr',
])

/** 对生成请求没有影响、静默忽略的参数 */
const SILENT = new Set([
  'silent',
  'show-error',
  'verbose',
  'include',
  'fail',
  'fail-with-body',
  'fail-early',
  'output',
  'remote-name',
  'remote-name-all',
  'remote-header-name',
  'write-out',
  'dump-header',
  'cookie-jar',
  'progress-bar',
  'no-progress-meter',
  'globoff',
  'no-buffer',
  'http1.0',
  'http1.1',
  'http2',
  'http2-prior-knowledge',
  'http3',
  'http3-only',
  'ipv4',
  'ipv6',
  'tlsv1',
  'tlsv1.0',
  'tlsv1.1',
  'tlsv1.2',
  'tlsv1.3',
  'sslv2',
  'sslv3',
  'max-redirs',
  'connect-timeout',
  'retry',
  'retry-delay',
  'retry-max-time',
  'retry-connrefused',
  'retry-all-errors',
  'path-as-is',
  'raw',
  'tr-encoding',
  'stderr',
  'trace',
  'trace-ascii',
  'trace-time',
  'trace-ids',
  'trace-config',
  'keepalive-time',
  'no-keepalive',
  'tcp-nodelay',
  'tcp-fastopen',
  'styled-output',
  'no-styled-output',
  'disable',
  'create-dirs',
  'output-dir',
  'remote-time',
  'ssl-no-revoke',
  'ssl-revoke-best-effort',
  'no-alpn',
  'no-npn',
  'no-sessionid',
  'parallel',
  'parallel-immediate',
  'parallel-max',
  'libcurl',
  'expect100-timeout',
  'happy-eyeballs-timeout-ms',
  'location-trusted',
  'post301',
  'post302',
  'post303',
  'junk-session-cookies',
  'xattr',
  'skip-existing',
  'clobber',
  'no-clobber',
])

// ───────────────────────────── 解析 ─────────────────────────────

/** curl 的 URL 编码：只保留 A-Z a-z 0-9 - . _ ~ */
export function curlEscape(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

/** 往 URL 追加查询串（插在 # 之前） */
export function appendQuery(url: string, query: string): string {
  if (!query) return url
  const hash = url.indexOf('#')
  const base = hash >= 0 ? url.slice(0, hash) : url
  const frag = hash >= 0 ? url.slice(hash) : ''
  const sep = !base.includes('?') ? '?' : /[?&]$/.test(base) ? '' : '&'
  return base + sep + query + frag
}

interface DataPart {
  text: string
  /** --json 片段直接拼接，其它用 & 连接 */
  json?: boolean
  /** 来自 @file 的整个请求体 */
  file?: string
}

function basename(p: string): string {
  const m = /[^/\\]*$/.exec(p)
  return (m && m[0]) || p
}

/** --data-urlencode / --url-query 的取值规则 */
function encodeDataArg(v: string, warnings: string[]): string {
  const m = /[=@]/.exec(v)
  if (!m) return curlEscape(v)
  const name = v.slice(0, m.index)
  const rest = v.slice(m.index + 1)
  if (m[0] === '=') return (name ? name + '=' : '') + curlEscape(rest)
  warnings.push(`--data-urlencode 需要读取本地文件「${rest}」，已用占位符代替`)
  return (name ? name + '=' : '') + `{{file:${rest}}}`
}

/** 解析 -F 的值：name=value / name=@file;type=…;filename=… / name=<file */
function parseFormArg(v: string, literal: boolean, warnings: string[]): FormPart | null {
  const eq = v.indexOf('=')
  if (eq < 0) {
    warnings.push(`-F 参数「${v}」缺少「=」，已忽略`)
    return null
  }
  const name = v.slice(0, eq)
  const content = v.slice(eq + 1)
  if (literal) return { name, value: content, kind: 'text' }

  const splitParams = (s: string): { head: string; params: Record<string, string> } => {
    // 第一个片段可能被双引号包裹
    let head = ''
    let i: number
    if (s.startsWith('"')) {
      i = 1
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) i++
        head += s[i]
        i++
      }
      i++
    } else {
      // 只有后面跟着已知参数名时，分号才是分隔符
      const re = /;\s*(type|filename|headers|encoder)=/g
      const m = re.exec(s)
      i = m ? m.index : s.length
      head = s.slice(0, i)
    }
    const params: Record<string, string> = {}
    const rest = s.slice(i)
    const re = /;\s*(type|filename|headers|encoder)=("(?:[^"\\]|\\.)*"|[^;]*)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(rest))) {
      let val = m[2]
      if (val.startsWith('"')) val = val.slice(1, -1).replace(/\\(.)/g, '$1')
      params[m[1]] = val
    }
    return { head, params }
  }

  if (content.startsWith('@')) {
    const { head, params } = splitParams(content.slice(1))
    const part: FormPart = { name, value: head, kind: 'file' }
    if (params.filename !== undefined) part.filename = params.filename
    if (params.type) part.contentType = params.type
    return part
  }
  if (content.startsWith('<')) {
    const { head, params } = splitParams(content.slice(1))
    warnings.push(`表单字段「${name}」的内容来自本地文件「${head}」，已用占位符代替`)
    const part: FormPart = { name, value: `{{file:${head}}}`, kind: 'text' }
    if (params.type) part.contentType = params.type
    return part
  }
  const { head, params } = splitParams(content)
  const part: FormPart = { name, value: head, kind: 'text' }
  if (params.type) part.contentType = params.type
  return part
}

function findHeader(headers: [string, string][], name: string): number {
  const lower = name.toLowerCase()
  return headers.findIndex(([k]) => k.toLowerCase() === lower)
}

/** 解析一条 curl 命令 */
export function parseCurl(input: string): CurlParseResult {
  const warnings: string[] = []
  const src = input.replace(/^\uFEFF/, '')
  if (!src.trim()) return { ok: false, error: '请输入 curl 命令', warnings }

  let tokens: string[]
  try {
    const r = tokenize(src)
    tokens = r.tokens
    warnings.push(...r.notes)
  } catch (e) {
    if (e instanceof ShellSyntaxError) {
      return {
        ok: false,
        error: `${e.message}（${describePosition(src, e.index)}）`,
        warnings,
      }
    }
    return { ok: false, error: String(e), warnings }
  }

  const start = tokens.findIndex((t) => /^curl(\.exe)?$/i.test(basename(t)))
  if (start < 0) {
    return {
      ok: false,
      error: '没有找到 curl 命令：请以「curl」开头，例如 curl https://example.com',
      warnings,
    }
  }

  /** URL 候选；afterUnknown：紧跟在不认识的参数后面，可能其实是那个参数的取值 */
  const urls: { value: string; afterUnknown: boolean }[] = []
  let lastUnknown = false
  const headers: [string, string][] = []
  const removed = new Set<string>()
  const data: DataPart[] = []
  const query: string[] = []
  const form: FormPart[] = []
  let method: string | undefined
  let head = false
  let get = false
  let json = false
  let uploadFile: string | undefined
  let auth: BasicAuth | undefined
  let cookieIdx = -1
  let followRedirects: boolean | undefined
  let insecure = false
  let compressed = false
  let timeout: number | undefined
  const unsupported = new Set<string>()

  const setHeader = (name: string, value: string) => {
    const idx = findHeader(headers, name)
    if (idx >= 0) headers[idx] = [headers[idx][0], value]
    else headers.push([name, value])
  }

  const apply = (name: string, value: string | undefined, display: string): void => {
    switch (name) {
      case 'request':
        method = value!.toUpperCase()
        return
      case 'header': {
        const v = value!
        if (v.startsWith('@')) {
          warnings.push(`${display} 从文件「${v.slice(1)}」读取请求头，已忽略`)
          return
        }
        const colon = v.indexOf(':')
        const semi = v.indexOf(';')
        if (colon > 0 && (semi < 0 || colon < semi)) {
          const hn = v.slice(0, colon).trim()
          const hv = v.slice(colon + 1).trim()
          if (!hv) {
            // -H 'Accept:' 表示去掉 curl 默认头
            removed.add(hn.toLowerCase())
            for (let k = headers.length - 1; k >= 0; k--) {
              if (headers[k][0].toLowerCase() === hn.toLowerCase()) headers.splice(k, 1)
            }
            return
          }
          headers.push([hn, hv])
          return
        }
        if (semi > 0 && !v.slice(semi + 1).trim()) {
          headers.push([v.slice(0, semi).trim(), ''])
          return
        }
        warnings.push(`请求头格式不正确：「${v}」，应为「名称: 值」`)
        return
      }
      case 'data':
      case 'data-ascii':
      case 'data-binary':
      case 'json': {
        const v = value!
        if (name === 'json') json = true
        if (v.startsWith('@')) {
          const path = v.slice(1)
          if (path === '-') warnings.push(`${display} @- 表示从标准输入读取，已用空内容代替`)
          else if (name !== 'data-binary' && name !== 'json')
            warnings.push(`${display} @${path} 会读取文件并去掉换行，这里按原文件上传`)
          data.push({ text: '', file: path === '-' ? undefined : path, json: name === 'json' })
          return
        }
        data.push({ text: v, json: name === 'json' })
        return
      }
      case 'data-raw':
        data.push({ text: value! })
        return
      case 'data-urlencode':
        data.push({ text: encodeDataArg(value!, warnings) })
        return
      case 'url-query': {
        const v = value!
        query.push(v.startsWith('+') ? v.slice(1) : encodeDataArg(v, warnings))
        return
      }
      case 'form':
      case 'form-string': {
        const p = parseFormArg(value!, name === 'form-string', warnings)
        if (p) form.push(p)
        return
      }
      case 'user': {
        const v = value!
        const c = v.indexOf(':')
        if (c < 0) {
          warnings.push(`${display} 只提供了用户名，密码按空处理（curl 会交互式询问）`)
          auth = { username: v, password: '' }
        } else auth = { username: v.slice(0, c), password: v.slice(c + 1) }
        return
      }
      case 'cookie': {
        const v = value!
        if (!v.includes('=')) {
          warnings.push(`${display} 「${v}」是 Cookie 文件，无法读取，已忽略`)
          return
        }
        if (cookieIdx >= 0) {
          headers[cookieIdx] = [headers[cookieIdx][0], `${headers[cookieIdx][1]}; ${v}`]
        } else {
          headers.push(['Cookie', v])
          cookieIdx = headers.length - 1
        }
        return
      }
      case 'user-agent':
        if (value) setHeader('User-Agent', value)
        else removed.add('user-agent')
        return
      case 'referer': {
        const v = value!.replace(/;auto$/, '')
        if (v) setHeader('Referer', v)
        return
      }
      case 'oauth2-bearer':
        setHeader('Authorization', `Bearer ${value}`)
        return
      case 'range':
        setHeader('Range', `bytes=${value}`)
        return
      case 'get':
        get = true
        return
      case 'head':
        head = true
        return
      case 'location':
      case 'location-trusted':
        followRedirects = true
        return
      case 'no-location':
        followRedirects = undefined
        return
      case 'insecure':
        insecure = true
        return
      case 'compressed':
        compressed = true
        return
      case 'max-time': {
        const t = Number(value)
        if (Number.isFinite(t) && t > 0) timeout = t
        else warnings.push(`${display} 的值「${value}」不是有效的秒数，已忽略`)
        return
      }
      case 'upload-file':
        uploadFile = value
        return
      case 'url':
        urls.push({ value: value!, afterUnknown: false })
        return
      case 'next':
        warnings.push('--next 之后的请求没有解析')
        return
      case 'basic':
        return
      case 'digest':
      case 'ntlm':
      case 'negotiate':
      case 'anyauth':
      case 'ntlm-wb':
        warnings.push(`${display} 认证方式不受支持，已按 Basic 认证处理`)
        return
      default:
        if (SILENT.has(name)) return
        lastUnknown = true
        if (!unsupported.has(display)) {
          unsupported.add(display)
          warnings.push(`不支持的参数 ${display}，已忽略`)
        }
    }
  }

  let stopFlags = false
  for (let i = start + 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (!stopFlags && /^curl(\.exe)?$/i.test(t)) {
      warnings.push('检测到多条 curl 命令，只解析了第一条')
      break
    }
    const prevUnknown = lastUnknown
    lastUnknown = false
    if (stopFlags || t === '-' || !t.startsWith('-')) {
      urls.push({ value: t, afterUnknown: prevUnknown && !stopFlags })
      continue
    }
    if (t === '--') {
      stopFlags = true
      continue
    }
    const takeNext = (display: string): string | undefined => {
      if (i + 1 >= tokens.length) {
        warnings.push(`参数 ${display} 缺少取值`)
        return undefined
      }
      return tokens[++i]
    }
    if (t.startsWith('--')) {
      let name = t.slice(2)
      let inline: string | undefined
      const eq = name.indexOf('=')
      if (eq > 0 && WITH_ARG.has(name.slice(0, eq))) {
        inline = name.slice(eq + 1)
        name = name.slice(0, eq)
      }
      if (WITH_ARG.has(name)) {
        const v = inline ?? takeNext(t)
        if (v !== undefined) apply(name, v, `--${name}`)
        continue
      }
      if (name.startsWith('no-') && !SILENT.has(name) && name !== 'no-location') {
        // --no-xxx 关闭布尔参数
        const base = name.slice(3)
        if (base === 'insecure') insecure = false
        else if (base === 'compressed') compressed = false
        continue
      }
      apply(name, undefined, t)
      continue
    }
    // 短参数，可合写：-sSL、-XPOST、-H'X: 1'
    for (let k = 1; k < t.length; k++) {
      const ch = t[k]
      const name = SHORT[ch]
      if (!name) {
        const d = `-${ch}`
        lastUnknown = true
        if (!unsupported.has(d)) {
          unsupported.add(d)
          warnings.push(`不支持的参数 ${d}，已忽略`)
        }
        continue
      }
      if (WITH_ARG.has(name)) {
        const rest = t.slice(k + 1)
        const v = rest ? rest : takeNext(`-${ch}`)
        if (v !== undefined) apply(name, v, `-${ch}`)
        break
      }
      apply(name, undefined, `-${ch}`)
    }
  }

  if (urls.length === 0)
    return { ok: false, error: '缺少 URL：curl 命令里没有找到请求地址', warnings }
  // 不认识的参数可能带取值（curl --foo bar https://…）：紧跟在它后面、又不带协议的候选靠后考虑
  const hasScheme = (u: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(u.trim())
  const likely = (u: (typeof urls)[number]) => !u.afterUnknown || hasScheme(u.value)
  const picked = urls.find(likely) ?? urls[0]
  const others = urls.filter((u) => u !== picked)
  if (others.length) {
    const skipped = others.filter((u) => !likely(u)).map((u) => `「${u.value}」`)
    if (skipped.length) warnings.push(`${skipped.join('、')}可能是不支持的参数的取值，已忽略`)
    if (skipped.length < others.length) warnings.push(`检测到多个 URL，只使用了 ${picked.value}`)
  }
  let url = picked.value.trim()
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url.replace(/^\/+/, '')
  for (const q of query) url = appendQuery(url, q)

  let body: RequestBody = { kind: 'none' }
  const hasData = data.length > 0
  if (hasData && form.length) warnings.push('-d 与 -F 不能同时使用，已忽略 -F')

  if (hasData) {
    const onlyFile = data.length === 1 && data[0].file
    if (get) {
      const text = joinData(data, warnings)
      url = appendQuery(url, text)
    } else if (onlyFile) {
      body = { kind: 'file', path: data[0].file! }
    } else {
      body = { kind: 'text', text: joinData(data, warnings) }
    }
  } else if (form.length) {
    if (get) warnings.push('-G 与 -F 同时使用时表单会被忽略')
    else body = { kind: 'multipart', parts: form }
  } else if (uploadFile !== undefined) {
    if (uploadFile === '-' || uploadFile === '.') {
      warnings.push('-T - 表示从标准输入上传，已忽略')
    } else {
      body = { kind: 'file', path: uploadFile }
    }
  }

  const finalMethod =
    method ??
    (head
      ? 'HEAD'
      : get
        ? 'GET'
        : hasData || form.length
          ? 'POST'
          : body.kind === 'file'
            ? 'PUT'
            : 'GET')
  if (head && body.kind !== 'none') warnings.push('-I（HEAD 请求）通常不应携带请求体')

  // curl 发送 -d / --data-binary 时的默认 Content-Type
  if ((body.kind === 'text' || (body.kind === 'file' && hasData)) && !removed.has('content-type')) {
    if (json) {
      if (findHeader(headers, 'content-type') < 0)
        headers.push(['Content-Type', 'application/json'])
      if (findHeader(headers, 'accept') < 0 && !removed.has('accept'))
        headers.push(['Accept', 'application/json'])
    } else if (findHeader(headers, 'content-type') < 0) {
      headers.push(['Content-Type', 'application/x-www-form-urlencoded'])
    }
  }

  const request: HttpRequest = { method: finalMethod, url, headers, body }
  if (auth) request.auth = auth
  if (followRedirects !== undefined) request.followRedirects = followRedirects
  if (insecure) request.insecure = true
  if (compressed) request.compressed = true
  if (timeout !== undefined) request.timeout = timeout

  if (!/\{\{|[[{]/.test(url)) {
    try {
      new URL(url)
    } catch {
      warnings.push(`URL 可能无效：${url}`)
    }
  }
  return { ok: true, request, warnings }
}

function joinData(parts: DataPart[], warnings: string[]): string {
  let out = ''
  parts.forEach((p, i) => {
    let text = p.text
    if (p.file) {
      warnings.push(`请求体需要读取本地文件「${p.file}」，已用占位符代替`)
      text = `{{file:${p.file}}}`
    }
    if (i > 0 && !p.json) out += '&'
    out += text
  })
  return out
}
