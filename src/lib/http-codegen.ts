/**
 * 把结构化 HTTP 请求（见 curl.ts 的 HttpRequest）生成各语言代码（纯函数，无 DOM 依赖）。
 */
import type { FormPart, HttpRequest } from './curl'

export type CodeTarget =
  | 'curl'
  | 'fetch'
  | 'axios'
  | 'node'
  | 'python'
  | 'httpx'
  | 'go'
  | 'java-okhttp'
  | 'java'
  | 'php'
  | 'rust'
  | 'swift'
  | 'csharp'
  | 'wget'
  | 'httpie'

/** 代码高亮用的语言族 */
export type CodeLang =
  'shell' | 'javascript' | 'python' | 'go' | 'java' | 'php' | 'rust' | 'swift' | 'csharp'

export interface CodeTargetInfo {
  id: CodeTarget
  label: string
  lang: CodeLang
  /** 下载时的文件名 */
  filename: string
}

export const CODE_TARGETS: readonly CodeTargetInfo[] = [
  { id: 'curl', label: 'cURL', lang: 'shell', filename: 'request.sh' },
  { id: 'fetch', label: 'JavaScript fetch', lang: 'javascript', filename: 'request.js' },
  { id: 'axios', label: 'Axios', lang: 'javascript', filename: 'request.mjs' },
  { id: 'python', label: 'Python requests', lang: 'python', filename: 'request.py' },
  { id: 'node', label: 'Node.js fetch', lang: 'javascript', filename: 'request.mjs' },
  { id: 'httpx', label: 'Python httpx', lang: 'python', filename: 'request.py' },
  { id: 'go', label: 'Go net/http', lang: 'go', filename: 'main.go' },
  { id: 'java-okhttp', label: 'Java OkHttp', lang: 'java', filename: 'Main.java' },
  { id: 'java', label: 'Java HttpClient', lang: 'java', filename: 'Main.java' },
  { id: 'php', label: 'PHP cURL', lang: 'php', filename: 'request.php' },
  { id: 'rust', label: 'Rust reqwest', lang: 'rust', filename: 'main.rs' },
  { id: 'swift', label: 'Swift URLSession', lang: 'swift', filename: 'main.swift' },
  { id: 'csharp', label: 'C# HttpClient', lang: 'csharp', filename: 'Program.cs' },
  { id: 'wget', label: 'wget', lang: 'shell', filename: 'request.sh' },
  { id: 'httpie', label: 'HTTPie', lang: 'shell', filename: 'request.sh' },
]

export const CODE_TARGET_MAP: Record<CodeTarget, CodeTargetInfo> = Object.fromEntries(
  CODE_TARGETS.map((t) => [t.id, t]),
) as Record<CodeTarget, CodeTargetInfo>

export function generateCode(request: HttpRequest, target: CodeTarget): string {
  const req = { ...request, url: encodeUrlForCode(request.url) }
  switch (target) {
    case 'curl':
      return genCurl(req)
    case 'fetch':
      return genFetch(req, false)
    case 'node':
      return genFetch(req, true)
    case 'axios':
      return genAxios(req)
    case 'python':
      return genPython(req, 'requests')
    case 'httpx':
      return genPython(req, 'httpx')
    case 'go':
      return genGo(req)
    case 'java-okhttp':
      return genOkHttp(req)
    case 'java':
      return genJavaHttpClient(req)
    case 'php':
      return genPhp(req)
    case 'rust':
      return genRust(req)
    case 'swift':
      return genSwift(req)
    case 'csharp':
      return genCSharp(req)
    case 'wget':
      return genWget(req)
    case 'httpie':
      return genHttpie(req)
  }
}

// ───────────────────────────── 通用工具 ─────────────────────────────

/**
 * 生成代码前把 URL 里的空格、中文等非 ASCII 字符按 UTF-8 百分号编码（与浏览器一致），
 * 其余部分保持原样；国际化域名转成 Punycode。很多服务器会拒绝请求行里的原始非 ASCII 字节。
 */
export function encodeUrlForCode(url: string): string {
  if (/^[\x21-\x7e]*$/.test(url)) return url
  const encodeRuns = (s: string) =>
    s.replace(/[^\x21-\x7e]+/g, (run) => {
      try {
        return encodeURI(run)
      } catch {
        return run
      }
    })
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/i.exec(url)
  if (!m) return encodeRuns(url)
  let authority = m[2]
  if (/[^\x21-\x7e]/.test(authority)) {
    try {
      const u = new URL(m[1] + authority)
      const user = u.username ? `${u.username}${u.password ? `:${u.password}` : ''}@` : ''
      authority = user + u.host
    } catch {
      authority = encodeRuns(authority)
    }
  }
  return m[1] + authority + encodeRuns(m[3])
}

const hex = (c: number, w: number) => c.toString(16).padStart(w, '0')

/** 是否含有控制字符（allow 里列出的除外） */
function hasControl(s: string, allow = ''): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if ((c < 0x20 || c === 0x7f) && !allow.includes(s[i])) return true
  }
  return false
}

type Escaper = (ch: string, code: number) => string | undefined

function quoteWith(s: string, quote: string, esc: Escaper): string {
  let out = quote
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    const e = esc(ch, code)
    out += e ?? ch
  }
  return out + quote
}

const commonEsc =
  (quote: string, ctrl: (code: number) => string): Escaper =>
  (ch, code) => {
    if (ch === '\\') return '\\\\'
    if (ch === quote) return '\\' + quote
    if (ch === '\n') return '\\n'
    if (ch === '\r') return '\\r'
    if (ch === '\t') return '\\t'
    if (code < 0x20 || code === 0x7f) return ctrl(code)
    return undefined
  }

/** bash 单引号 */
export function shQuote(s: string): string {
  if (s !== '' && /^[A-Za-z0-9_\-./:@%+,=]+$/.test(s)) return s
  return "'" + s.replace(/'/g, "'\\''") + "'"
}
/**
 * 总是加引号的 bash 字符串：普通内容用单引号；含换行或控制字符时用 $'…'（ANSI-C 引号），
 * 与 Chrome「Copy as cURL」的做法一致，便于阅读和复制。
 */
export function shq(s: string): string {
  if (!hasControl(s, '\t')) return "'" + s.replace(/'/g, "'\\''") + "'"
  let out = "$'"
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    if (ch === '\\') out += '\\\\'
    else if (ch === "'") out += "\\'"
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (c < 0x20 || c === 0x7f) out += '\\x' + hex(c, 2)
    else out += ch
  }
  return out + "'"
}

export const jsStr = (s: string) =>
  quoteWith(s, "'", (ch, code) => {
    if (code === 0x2028 || code === 0x2029) return '\\u' + hex(code, 4)
    return commonEsc("'", (c) => '\\x' + hex(c, 2))(ch, code)
  })
export const pyStr = (s: string) =>
  quoteWith(
    s,
    "'",
    commonEsc("'", (c) => '\\x' + hex(c, 2)),
  )
export const goStr = (s: string) =>
  quoteWith(
    s,
    '"',
    commonEsc('"', (c) => '\\x' + hex(c, 2)),
  )
export const javaStr = (s: string) =>
  quoteWith(s, '"', (ch, code) => {
    if (ch === '\b') return '\\b'
    if (ch === '\f') return '\\f'
    return commonEsc('"', (c) => '\\u' + hex(c, 4))(ch, code)
  })
export const csStr = (s: string) =>
  quoteWith(s, '"', (ch, code) => {
    if (ch === '\0') return '\\0'
    return commonEsc('"', (c) => '\\u' + hex(c, 4))(ch, code)
  })
export const rustStr = (s: string) =>
  quoteWith(s, '"', (ch, code) => {
    if (ch === '\0') return '\\0'
    return commonEsc('"', (c) => `\\u{${c.toString(16)}}`)(ch, code)
  })
export const swiftStr = (s: string) =>
  quoteWith(s, '"', (ch, code) => {
    if (ch === '\0') return '\\0'
    return commonEsc('"', (c) => `\\u{${c.toString(16)}}`)(ch, code)
  })
/** PHP 字符串：一般用单引号（只需转义 \\ 和 \'），含控制字符时用双引号转义 */
export function phpStr(s: string): string {
  if (!hasControl(s, '\t\n')) {
    return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
  }
  return quoteWith(s, '"', (ch, code) => {
    if (ch === '$') return '\\$'
    return commonEsc('"', (c) => '\\x' + hex(c, 2))(ch, code)
  })
}

const hasCtrl = (s: string) => hasControl(s, '\t\n')

/** Go 原始字符串（反引号），不能包含反引号和 \r */
function goBody(s: string): string {
  return !s.includes('`') && !s.includes('\r') && !hasCtrl(s) && /["\\\n]/.test(s)
    ? '`' + s + '`'
    : goStr(s)
}

/** Rust 原始字符串 r#"…"# */
function rustBody(s: string): string {
  if (hasCtrl(s) || s.includes('\r') || !/["\\]/.test(s)) return rustStr(s)
  let hashes = '#'
  while (s.includes('"' + hashes)) hashes += '#'
  return `r${hashes}"${s}"${hashes}`
}

/** Swift 原始字符串 #"…"#（单行） */
function swiftBody(s: string): string {
  if (hasCtrl(s) || /[\r\n]/.test(s) || !/["\\]/.test(s)) return swiftStr(s)
  let hashes = '#'
  while (s.includes('"' + hashes) || s.includes('\\' + hashes)) hashes += '#'
  return `${hashes}"${s}"${hashes}`
}

function utf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

const lower = (s: string) => s.toLowerCase()

function headerValue(r: HttpRequest, name: string): string | undefined {
  const h = r.headers.find(([k]) => lower(k) === lower(name))
  return h?.[1]
}

/** 同名请求头合并（Cookie 用 ; 连接，其它用 , 连接），用于只能用字典表示请求头的语言 */
export function mergeHeaders(headers: [string, string][]): [string, string][] {
  const out: [string, string][] = []
  const idx = new Map<string, number>()
  for (const [k, v] of headers) {
    const key = lower(k)
    const i = idx.get(key)
    if (i === undefined) {
      idx.set(key, out.length)
      out.push([k, v])
    } else {
      out[i] = [out[i][0], out[i][1] + (key === 'cookie' ? '; ' : ', ') + v]
    }
  }
  return out
}

/** 生成代码时实际要写出的请求头：multipart 的 Content-Type 由各库自动生成（带 boundary） */
function codeHeaders(r: HttpRequest): [string, string][] {
  if (r.body.kind !== 'multipart') return r.headers
  return r.headers.filter(([k]) => lower(k) !== 'content-type')
}

function isJsonContentType(r: HttpRequest): boolean {
  const ct = headerValue(r, 'content-type')
  return !!ct && /[/+]json\b/i.test(ct)
}

/**
 * 请求体是 JSON 且可以无损地转成语言字面量时返回解析结果：
 * 数字过大（超出双精度安全整数）或位数过多时放弃，保留原始字符串。
 */
export function jsonBodyValue(r: HttpRequest): { value: unknown } | null {
  if (r.body.kind !== 'text' || !isJsonContentType(r)) return null
  const text = r.body.text
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object') return null
  const re = /"(?:[^"\\]|\\.)*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const lit = m[1]
    if (lit === undefined) continue
    const digits = lit
      .replace(/^-/, '')
      .replace(/[eE].*$/, '')
      .replace('.', '')
      .replace(/^0+/, '')
    if (/^-?\d+$/.test(lit) ? !Number.isSafeInteger(Number(lit)) : digits.length > 15) return null
  }
  return { value }
}

const IDENT = /^[A-Za-z_$][\w$]*$/

/** 只含原始值的短数组写在一行：[1, 2, 3] */
function inlineArray(v: unknown[], fmt: (x: unknown) => string): string | null {
  if (v.some((x) => x !== null && typeof x === 'object')) return null
  const s = `[${v.map(fmt).join(', ')}]`
  return s.length <= 60 ? s : null
}

/** JSON 值 → JavaScript 字面量（2 空格缩进） */
export function jsLiteral(v: unknown, indent = 0): string {
  const pad = ' '.repeat(indent + 2)
  const end = ' '.repeat(indent)
  if (v === null) return 'null'
  if (typeof v === 'string') return jsStr(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    if (!v.length) return '[]'
    const inline = inlineArray(v, (x) => jsLiteral(x))
    if (inline) return inline
    return `[\n${v.map((x) => pad + jsLiteral(x, indent + 2) + ',').join('\n')}\n${end}]`
  }
  const entries = Object.entries(v as Record<string, unknown>)
  if (!entries.length) return '{}'
  return `{\n${entries
    .map(([k, x]) => `${pad}${IDENT.test(k) ? k : jsStr(k)}: ${jsLiteral(x, indent + 2)},`)
    .join('\n')}\n${end}}`
}

/** JSON 值 → Python 字面量（4 空格缩进） */
export function pyLiteral(v: unknown, indent = 0): string {
  const pad = ' '.repeat(indent + 4)
  const end = ' '.repeat(indent)
  if (v === null) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'string') return pyStr(v)
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) {
    if (!v.length) return '[]'
    const inline = inlineArray(v, (x) => pyLiteral(x))
    if (inline) return inline
    return `[\n${v.map((x) => pad + pyLiteral(x, indent + 4) + ',').join('\n')}\n${end}]`
  }
  const entries = Object.entries(v as Record<string, unknown>)
  if (!entries.length) return '{}'
  return `{\n${entries
    .map(([k, x]) => `${pad}${pyStr(k)}: ${pyLiteral(x, indent + 4)},`)
    .join('\n')}\n${end}}`
}

function fileName(p: FormPart): string {
  if (p.filename !== undefined) return p.filename
  const m = /[^/\\]*$/.exec(p.value)
  return (m && m[0]) || p.value
}

function pathBase(p: string): string {
  const m = /[^/\\]*$/.exec(p)
  return (m && m[0]) || p
}

const STD_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

function timeoutMs(r: HttpRequest): number | undefined {
  return r.timeout !== undefined ? Math.round(r.timeout * 1000) : undefined
}

// ───────────────────────────── cURL ─────────────────────────────

function genCurl(r: HttpRequest): string {
  const first = ['curl']
  const hasBody = r.body.kind !== 'none'
  // 没有 Content-Type 的文件请求体用 -T 上传（curl 不会自动加 Content-Type）
  const upload = r.body.kind === 'file' && headerValue(r, 'content-type') === undefined
  const implied = upload ? 'PUT' : hasBody ? 'POST' : 'GET'
  if (r.method === 'HEAD' && !hasBody) first.push('-I')
  else if (r.method !== implied) first.push('-X', shQuote(r.method))
  first.push(shq(r.url))
  const lines: string[] = [first.join(' ')]
  for (const [k, v] of r.headers) {
    lines.push(`-H ${shq(v === '' ? `${k};` : `${k}: ${v}`)}`)
  }
  if (r.auth) lines.push(`-u ${shq(`${r.auth.username}:${r.auth.password}`)}`)
  const b = r.body
  if (b.kind === 'text') lines.push(`--data-raw ${shq(b.text)}`)
  else if (b.kind === 'file') {
    lines.push(upload ? `-T ${shq(b.path)}` : `--data-binary ${shq('@' + b.path)}`)
  } else if (b.kind === 'multipart') {
    for (const p of b.parts) {
      if (p.kind === 'file') {
        const path =
          /[;,"]/.test(p.value) || p.value.startsWith('"') ? curlFormQuote(p.value) : p.value
        let s = `${p.name}=@${path}`
        if (p.contentType) s += `;type=${p.contentType}`
        if (p.filename !== undefined) s += `;filename=${curlFormQuote(p.filename)}`
        lines.push(`-F ${shq(s)}`)
      } else if (
        /^[@<]/.test(p.value) ||
        p.value.startsWith('"') ||
        /;\s*(type|filename|headers|encoder)=/.test(p.value)
      ) {
        lines.push(`--form-string ${shq(`${p.name}=${p.value}`)}`)
      } else {
        lines.push(
          `-F ${shq(`${p.name}=${p.value}${p.contentType ? `;type=${p.contentType}` : ''}`)}`,
        )
      }
    }
  }
  if (r.followRedirects === true) lines.push('-L')
  if (r.insecure) lines.push('-k')
  if (r.compressed) lines.push('--compressed')
  if (r.timeout !== undefined) lines.push(`-m ${r.timeout}`)
  return lines.join(' \\\n  ')
}

function curlFormQuote(s: string): string {
  return /[;,"\s]/.test(s) || s === '' ? `"${s.replace(/(["\\])/g, '\\$1')}"` : s
}

// ───────────────────────────── JavaScript ─────────────────────────────

function jsAuthValue(r: HttpRequest): string {
  const cred = `${r.auth!.username}:${r.auth!.password}`
  // btoa 只能处理 Latin-1，非 ASCII 时直接写入编码结果
  return /^[\x20-\x7e]*$/.test(cred)
    ? `'Basic ' + btoa(${jsStr(cred)})`
    : jsStr('Basic ' + utf8Base64(cred))
}

function jsHeadersObject(
  headers: [string, string][],
  extra: [string, string][],
  indent: number,
): string {
  const pad = ' '.repeat(indent + 2)
  const rows = [
    ...mergeHeaders(headers).map(([k, v]) => `${pad}${jsStr(k)}: ${jsStr(v)},`),
    ...extra.map(([k, v]) => `${pad}${jsStr(k)}: ${v},`),
  ]
  return `{\n${rows.join('\n')}\n${' '.repeat(indent)}}`
}

function jsFormLines(parts: FormPart[], node: boolean): string[] {
  const lines = ['const form = new FormData()']
  for (const p of parts) {
    if (p.kind === 'file') {
      const name = fileName(p)
      if (node) {
        const opts = p.contentType ? `, { type: ${jsStr(p.contentType)} }` : ''
        lines.push(
          `form.append(${jsStr(p.name)}, await openAsBlob(${jsStr(p.value)}${opts}), ${jsStr(name)})`,
        )
      } else {
        const opts = p.contentType ? `, { type: ${jsStr(p.contentType)} }` : ''
        lines.push(
          `form.append(${jsStr(p.name)}, new File([/* ${name.replace(/\*\//g, '* /')} 的内容 */], ${jsStr(name)}${opts}))`,
        )
      }
    } else {
      lines.push(`form.append(${jsStr(p.name)}, ${jsStr(p.value)})`)
    }
  }
  return lines
}

/** 浏览器 fetch 不允许脚本设置的请求头（Fetch 标准的 forbidden request-header） */
const BROWSER_FORBIDDEN = new Set([
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

function genFetch(r: HttpRequest, node: boolean): string {
  const pre: string[] = []
  const imports: string[] = []
  const opts: string[] = []
  const b = r.body
  if (r.method !== 'GET') opts.push(`method: ${jsStr(r.method)},`)
  const headers = codeHeaders(r)
  const extra: [string, string][] = r.auth ? [['Authorization', jsAuthValue(r)]] : []
  if (headers.length || extra.length) opts.push(`headers: ${jsHeadersObject(headers, extra, 2)},`)
  if (b.kind === 'text') {
    const j = jsonBodyValue(r)
    opts.push(j ? `body: JSON.stringify(${jsLiteral(j.value, 2)}),` : `body: ${jsStr(b.text)},`)
  } else if (b.kind === 'multipart') {
    if (node && b.parts.some((p) => p.kind === 'file'))
      imports.push("import { openAsBlob } from 'node:fs'")
    pre.push(...jsFormLines(b.parts, node), '')
    opts.push('body: form,')
  } else if (b.kind === 'file') {
    if (node) {
      imports.push("import { openAsBlob } from 'node:fs'")
      opts.push(`body: await openAsBlob(${jsStr(b.path)}),`)
    } else {
      opts.push(
        `body: new File([/* ${pathBase(b.path).replace(/\*\//g, '* /')} 的内容 */], ${jsStr(pathBase(b.path))}),`,
      )
    }
  }
  if (r.followRedirects === false) opts.push("redirect: 'manual',")
  const ms = timeoutMs(r)
  if (ms !== undefined) opts.push(`signal: AbortSignal.timeout(${ms}),`)
  if (r.insecure) {
    pre.unshift(
      node
        ? '// 跳过 TLS 证书校验（-k）：运行前设置环境变量 NODE_TLS_REJECT_UNAUTHORIZED=0'
        : '// 注意：浏览器中无法跳过 TLS 证书校验（-k）',
    )
  }
  if (!node) {
    const blocked = mergeHeaders(headers)
      .map(([k]) => k)
      .filter((k) => BROWSER_FORBIDDEN.has(lower(k)) || /^(proxy-|sec-)/i.test(k))
    if (blocked.length)
      pre.unshift(`// 注意：浏览器会忽略这些受限的请求头：${blocked.join(', ')}（Node.js 中有效）`)
  }
  const call = opts.length
    ? `const response = await fetch(${jsStr(r.url)}, {\n${opts.map((o) => '  ' + o).join('\n')}\n})`
    : `const response = await fetch(${jsStr(r.url)})`
  const out = [
    ...(imports.length ? [...new Set(imports), ''] : []),
    ...pre,
    call,
    '',
    'console.log(response.status)',
    'console.log(await response.text())',
  ]
  return out.join('\n')
}

function genAxios(r: HttpRequest): string {
  const imports = ["import axios from 'axios'"]
  const pre: string[] = []
  const opts: string[] = [`method: ${jsStr(r.method.toLowerCase())},`, `url: ${jsStr(r.url)},`]
  const headers = codeHeaders(r)
  if (headers.length) opts.push(`headers: ${jsHeadersObject(headers, [], 2)},`)
  const b = r.body
  if (b.kind === 'text') {
    const j = jsonBodyValue(r)
    opts.push(`data: ${j ? jsLiteral(j.value, 2) : jsStr(b.text)},`)
  } else if (b.kind === 'multipart') {
    if (b.parts.some((p) => p.kind === 'file')) imports.push("import { openAsBlob } from 'node:fs'")
    pre.push(...jsFormLines(b.parts, true), '')
    opts.push('data: form,')
  } else if (b.kind === 'file') {
    imports.push("import { readFile } from 'node:fs/promises'")
    opts.push(`data: await readFile(${jsStr(b.path)}),`)
  }
  if (r.auth) {
    opts.push(`auth: { username: ${jsStr(r.auth.username)}, password: ${jsStr(r.auth.password)} },`)
  }
  const ms = timeoutMs(r)
  if (ms !== undefined) opts.push(`timeout: ${ms},`)
  if (r.followRedirects === false) opts.push('maxRedirects: 0,')
  if (r.insecure) {
    imports.push("import https from 'node:https'")
    opts.push('httpsAgent: new https.Agent({ rejectUnauthorized: false }),')
  }
  return [
    ...imports,
    '',
    ...pre,
    `const response = await axios.request({\n${opts.map((o) => '  ' + o).join('\n')}\n})`,
    '',
    'console.log(response.status)',
    'console.log(response.data)',
  ].join('\n')
}

// ───────────────────────────── Python ─────────────────────────────

function genPython(r: HttpRequest, lib: 'requests' | 'httpx'): string {
  const lines: string[] = [`import ${lib}`, '']
  const args: string[] = [pyStr(r.url)]
  const headers = mergeHeaders(codeHeaders(r))
  if (headers.length) {
    lines.push(
      `headers = {\n${headers.map(([k, v]) => `    ${pyStr(k)}: ${pyStr(v)},`).join('\n')}\n}`,
      '',
    )
    args.push('headers=headers')
  }
  const b = r.body
  let hasBody = false
  if (b.kind === 'text') {
    hasBody = true
    const j = jsonBodyValue(r)
    if (j) {
      lines.push(`json_data = ${pyLiteral(j.value)}`, '')
      args.push('json=json_data')
    } else {
      // requests 会用 Latin-1 编码 str 请求体，含中文等字符时先转成 UTF-8 字节
      const enc = /[\u0100-\uffff]/.test(b.text) ? '.encode()' : ''
      lines.push(`data = ${pyStr(b.text)}${enc}`, '')
      args.push(lib === 'httpx' ? 'content=data' : 'data=data')
    }
  } else if (b.kind === 'multipart') {
    hasBody = true
    const names = b.parts.map((p) => p.name)
    const dup = new Set(names).size !== names.length
    const entry = (p: FormPart) =>
      p.kind === 'file'
        ? `(${pyStr(fileName(p))}, open(${pyStr(p.value)}, 'rb')${p.contentType ? `, ${pyStr(p.contentType)}` : ''})`
        : `(None, ${pyStr(p.value)})`
    lines.push(
      dup
        ? `files = [\n${b.parts.map((p) => `    (${pyStr(p.name)}, ${entry(p)}),`).join('\n')}\n]`
        : `files = {\n${b.parts.map((p) => `    ${pyStr(p.name)}: ${entry(p)},`).join('\n')}\n}`,
      '',
    )
    args.push('files=files')
  } else if (b.kind === 'file') {
    hasBody = true
    lines.push(`with open(${pyStr(b.path)}, 'rb') as f:`, '    data = f.read()', '')
    args.push(lib === 'httpx' ? 'content=data' : 'data=data')
  }
  if (r.auth) args.push(`auth=(${pyStr(r.auth.username)}, ${pyStr(r.auth.password)})`)
  if (r.timeout !== undefined) args.push(`timeout=${r.timeout}`)
  if (r.insecure) args.push('verify=False')
  if (lib === 'requests') {
    if (r.followRedirects === false && r.method !== 'HEAD') args.push('allow_redirects=False')
    if (r.followRedirects === true && r.method === 'HEAD') args.push('allow_redirects=True')
  } else if (r.followRedirects === true) args.push('follow_redirects=True')

  const m = r.method.toLowerCase()
  let fn: string
  const shortcut =
    lib === 'requests'
      ? STD_METHODS.has(r.method)
      : ['post', 'put', 'patch'].includes(m) || (STD_METHODS.has(r.method) && !hasBody)
  if (shortcut) fn = `${lib}.${m}`
  else {
    fn = `${lib}.request`
    args.unshift(pyStr(r.method))
  }
  const oneLine = `response = ${fn}(${args.join(', ')})`
  lines.push(
    oneLine.length <= 88
      ? oneLine
      : `response = ${fn}(\n${args.map((a) => `    ${a},`).join('\n')}\n)`,
  )
  lines.push('', 'print(response.status_code)', 'print(response.text)')
  return lines.join('\n')
}

// ───────────────────────────── Go ─────────────────────────────

function genGo(r: HttpRequest): string {
  const imports = new Set(['fmt', 'io', 'log', 'net/http'])
  const body: string[] = []
  const t = '\t'
  const fatal = [`${t}if err != nil {`, `${t}${t}log.Fatal(err)`, `${t}}`]

  // client
  const clientOpts: string[] = []
  const ms = timeoutMs(r)
  if (ms !== undefined) {
    imports.add('time')
    clientOpts.push(
      ms % 1000 === 0
        ? `Timeout: ${ms / 1000} * time.Second,`
        : `Timeout: ${ms} * time.Millisecond,`,
    )
  }
  if (r.insecure) {
    imports.add('crypto/tls')
    clientOpts.push(
      'Transport: &http.Transport{',
      `${t}TLSClientConfig: &tls.Config{InsecureSkipVerify: true},`,
      '},',
    )
  }
  if (r.followRedirects === false) {
    clientOpts.push(
      'CheckRedirect: func(req *http.Request, via []*http.Request) error {',
      `${t}return http.ErrUseLastResponse`,
      '},',
    )
  }
  body.push(
    clientOpts.length
      ? `${t}client := &http.Client{\n${clientOpts.map((l) => t + t + l).join('\n')}\n${t}}`
      : `${t}client := &http.Client{}`,
  )

  let reader = 'nil'
  let formCT = false
  const b = r.body
  if (b.kind === 'text') {
    imports.add('strings')
    body.push(`${t}var data = strings.NewReader(${goBody(b.text)})`)
    reader = 'data'
  } else if (b.kind === 'file') {
    imports.add('os')
    body.push(`${t}data, err := os.Open(${goStr(b.path)})`, ...fatal, `${t}defer data.Close()`)
    reader = 'data'
  } else if (b.kind === 'multipart') {
    imports.add('bytes')
    imports.add('mime/multipart')
    body.push(`${t}data := &bytes.Buffer{}`, `${t}writer := multipart.NewWriter(data)`)
    b.parts.forEach((p, i) => {
      if (p.kind === 'file') {
        imports.add('os')
        const f = `file${i}`
        body.push(
          `${t}${f}, err := os.Open(${goStr(p.value)})`,
          ...fatal,
          `${t}defer ${f}.Close()`,
          `${t}part${i}, err := writer.CreateFormFile(${goStr(p.name)}, ${goStr(fileName(p))})`,
          ...fatal,
          `${t}if _, err := io.Copy(part${i}, ${f}); err != nil {`,
          `${t}${t}log.Fatal(err)`,
          `${t}}`,
        )
      } else {
        body.push(
          `${t}if err := writer.WriteField(${goStr(p.name)}, ${goStr(p.value)}); err != nil {`,
          `${t}${t}log.Fatal(err)`,
          `${t}}`,
        )
      }
    })
    body.push(`${t}writer.Close()`)
    reader = 'data'
    formCT = true
  }
  body.push(
    `${t}req, err := http.NewRequest(${goStr(r.method)}, ${goStr(r.url)}, ${reader})`,
    ...fatal,
  )
  const seen = new Set<string>()
  for (const [k, v] of codeHeaders(r)) {
    if (lower(k) === 'host') {
      body.push(`${t}req.Host = ${goStr(v)}`)
      continue
    }
    body.push(`${t}req.Header.${seen.has(lower(k)) ? 'Add' : 'Set'}(${goStr(k)}, ${goStr(v)})`)
    seen.add(lower(k))
  }
  if (formCT) body.push(`${t}req.Header.Set("Content-Type", writer.FormDataContentType())`)
  if (r.auth)
    body.push(`${t}req.SetBasicAuth(${goStr(r.auth.username)}, ${goStr(r.auth.password)})`)
  body.push(
    `${t}resp, err := client.Do(req)`,
    ...fatal,
    `${t}defer resp.Body.Close()`,
    `${t}bodyText, err := io.ReadAll(resp.Body)`,
    ...fatal,
    `${t}fmt.Println(resp.Status)`,
    `${t}fmt.Printf("%s\\n", bodyText)`,
  )
  const sorted = [...imports].sort()
  return [
    'package main',
    '',
    'import (',
    ...sorted.map((i) => `${t}"${i}"`),
    ')',
    '',
    'func main() {',
    ...body,
    '}',
  ].join('\n')
}

// ───────────────────────────── Java ─────────────────────────────

function genOkHttp(r: HttpRequest): string {
  const imports = new Set([
    'java.io.IOException',
    'okhttp3.OkHttpClient',
    'okhttp3.Request',
    'okhttp3.Response',
  ])
  const i2 = '        '
  const lines: string[] = []
  const clientOpts: string[] = []
  if (r.followRedirects === false) clientOpts.push('.followRedirects(false)')
  const ms = timeoutMs(r)
  if (ms !== undefined) {
    imports.add('java.util.concurrent.TimeUnit')
    clientOpts.push(`.callTimeout(${ms}, TimeUnit.MILLISECONDS)`)
  }
  if (r.insecure)
    lines.push(
      `${i2}// 注意：OkHttp 需要自定义 SSLSocketFactory 与 HostnameVerifier 才能跳过证书校验（-k）`,
    )
  lines.push(
    clientOpts.length
      ? `${i2}OkHttpClient client = new OkHttpClient.Builder()\n${clientOpts.map((o) => `${i2}    ${o}`).join('\n')}\n${i2}    .build();`
      : `${i2}OkHttpClient client = new OkHttpClient();`,
    '',
  )

  const b = r.body
  const ct = headerValue(r, 'content-type')
  const media = ct !== undefined ? `MediaType.parse(${javaStr(ct)})` : 'null'
  let bodyVar: string | null = null
  const permitsBody = r.method !== 'GET' && r.method !== 'HEAD'
  const requiresBody = ['POST', 'PUT', 'PATCH', 'PROPPATCH', 'REPORT'].includes(r.method)
  if (b.kind !== 'none' && !permitsBody) {
    lines.push(`${i2}// 注意：OkHttp 不允许 ${r.method} 请求携带请求体，已省略`)
  } else if (b.kind === 'text') {
    imports.add('okhttp3.RequestBody')
    if (ct !== undefined) imports.add('okhttp3.MediaType')
    lines.push(`${i2}RequestBody body = RequestBody.create(${javaStr(b.text)}, ${media});`, '')
    bodyVar = 'body'
  } else if (b.kind === 'file') {
    imports.add('okhttp3.RequestBody')
    imports.add('java.io.File')
    if (ct !== undefined) imports.add('okhttp3.MediaType')
    lines.push(
      `${i2}RequestBody body = RequestBody.create(new File(${javaStr(b.path)}), ${media});`,
      '',
    )
    bodyVar = 'body'
  } else if (b.kind === 'multipart') {
    imports.add('okhttp3.MultipartBody')
    imports.add('okhttp3.RequestBody')
    const parts = b.parts.map((p) => {
      if (p.kind === 'file') {
        imports.add('java.io.File')
        if (p.contentType) imports.add('okhttp3.MediaType')
        const mt = p.contentType ? `MediaType.parse(${javaStr(p.contentType)})` : 'null'
        return `${i2}    .addFormDataPart(${javaStr(p.name)}, ${javaStr(fileName(p))},\n${i2}        RequestBody.create(new File(${javaStr(p.value)}), ${mt}))`
      }
      return `${i2}    .addFormDataPart(${javaStr(p.name)}, ${javaStr(p.value)})`
    })
    lines.push(
      `${i2}RequestBody body = new MultipartBody.Builder()`,
      `${i2}    .setType(MultipartBody.FORM)`,
      ...parts,
      `${i2}    .build();`,
      '',
    )
    bodyVar = 'body'
  } else if (requiresBody) {
    imports.add('okhttp3.RequestBody')
    lines.push(`${i2}RequestBody body = RequestBody.create(new byte[0], null);`, '')
    bodyVar = 'body'
  }

  const builder = [
    `${i2}Request request = new Request.Builder()`,
    `${i2}    .url(${javaStr(r.url)})`,
  ]
  if (r.method === 'GET' && !bodyVar) {
    // 默认就是 GET
  } else if (r.method === 'HEAD') builder.push(`${i2}    .head()`)
  else builder.push(`${i2}    .method(${javaStr(r.method)}, ${bodyVar ?? 'null'})`)
  for (const [k, v] of codeHeaders(r)) {
    if (bodyVar && b.kind !== 'none' && lower(k) === 'content-type') continue
    builder.push(`${i2}    .addHeader(${javaStr(k)}, ${javaStr(v)})`)
  }
  if (r.auth) {
    imports.add('okhttp3.Credentials')
    builder.push(
      `${i2}    .addHeader("Authorization", Credentials.basic(${javaStr(r.auth.username)}, ${javaStr(r.auth.password)}))`,
    )
  }
  builder.push(`${i2}    .build();`)
  lines.push(
    ...builder,
    '',
    `${i2}try (Response response = client.newCall(request).execute()) {`,
    `${i2}    System.out.println(response.code());`,
    `${i2}    System.out.println(response.body().string());`,
    `${i2}}`,
  )
  return javaClass(imports, 'IOException', lines)
}

function javaClass(imports: Set<string>, throwsType: string, lines: string[]): string {
  const sorted = [...imports].sort((a, b) => {
    const ja = a.startsWith('java') ? 0 : 1
    const jb = b.startsWith('java') ? 0 : 1
    return ja - jb || (a < b ? -1 : a > b ? 1 : 0)
  })
  return [
    ...sorted.map((i) => `import ${i};`),
    '',
    'public class Main {',
    `    public static void main(String[] args) throws ${throwsType} {`,
    ...lines,
    '    }',
    '}',
  ].join('\n')
}

const JAVA_RESTRICTED = new Set(['connection', 'content-length', 'expect', 'host', 'upgrade'])

function genJavaHttpClient(r: HttpRequest): string {
  const imports = new Set([
    'java.net.URI',
    'java.net.http.HttpClient',
    'java.net.http.HttpRequest',
    'java.net.http.HttpResponse',
  ])
  const i2 = '        '
  const lines: string[] = []
  if (r.insecure) lines.push(`${i2}// 注意：跳过证书校验（-k）需要自定义 SSLContext，这里没有生成`)
  lines.push(
    r.followRedirects === true
      ? `${i2}HttpClient client = HttpClient.newBuilder()\n${i2}    .followRedirects(HttpClient.Redirect.NORMAL)\n${i2}    .build();`
      : `${i2}HttpClient client = HttpClient.newHttpClient();`,
    '',
  )
  const b = r.body
  let publisher = 'HttpRequest.BodyPublishers.noBody()'
  let multipart = false
  if (b.kind === 'text') publisher = `HttpRequest.BodyPublishers.ofString(${javaStr(b.text)})`
  else if (b.kind === 'file') {
    imports.add('java.nio.file.Path')
    publisher = `HttpRequest.BodyPublishers.ofFile(Path.of(${javaStr(b.path)}))`
  } else if (b.kind === 'multipart') {
    multipart = true
    imports.add('java.io.ByteArrayOutputStream')
    imports.add('java.nio.charset.StandardCharsets')
    lines.push(
      `${i2}String boundary = "----JavaFormBoundary" + System.nanoTime();`,
      `${i2}ByteArrayOutputStream form = new ByteArrayOutputStream();`,
    )
    for (const p of b.parts) {
      if (p.kind === 'file') {
        imports.add('java.nio.file.Files')
        imports.add('java.nio.file.Path')
        const head = `\r\nContent-Disposition: form-data; name="${p.name}"; filename="${fileName(p)}"\r\nContent-Type: ${p.contentType ?? 'application/octet-stream'}\r\n\r\n`
        lines.push(
          `${i2}form.write(("--" + boundary + ${javaStr(head)}).getBytes(StandardCharsets.UTF_8));`,
          `${i2}form.write(Files.readAllBytes(Path.of(${javaStr(p.value)})));`,
          `${i2}form.write("\\r\\n".getBytes(StandardCharsets.UTF_8));`,
        )
      } else {
        const chunk = `\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`
        lines.push(
          `${i2}form.write(("--" + boundary + ${javaStr(chunk)}).getBytes(StandardCharsets.UTF_8));`,
        )
      }
    }
    lines.push(
      `${i2}form.write(("--" + boundary + "--\\r\\n").getBytes(StandardCharsets.UTF_8));`,
      '',
    )
    publisher = 'HttpRequest.BodyPublishers.ofByteArray(form.toByteArray())'
  }

  const builder = [
    `${i2}HttpRequest request = HttpRequest.newBuilder()`,
    `${i2}    .uri(URI.create(${javaStr(r.url)}))`,
  ]
  const ms = timeoutMs(r)
  if (ms !== undefined) {
    imports.add('java.time.Duration')
    builder.push(`${i2}    .timeout(Duration.ofMillis(${ms}))`)
  }
  const skipped: string[] = []
  for (const [k, v] of codeHeaders(r)) {
    if (JAVA_RESTRICTED.has(lower(k))) {
      skipped.push(k)
      continue
    }
    builder.push(`${i2}    .header(${javaStr(k)}, ${javaStr(v)})`)
  }
  if (multipart)
    builder.push(`${i2}    .header("Content-Type", "multipart/form-data; boundary=" + boundary)`)
  if (r.auth) {
    imports.add('java.util.Base64')
    imports.add('java.nio.charset.StandardCharsets')
    builder.push(
      `${i2}    .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(${javaStr(`${r.auth.username}:${r.auth.password}`)}.getBytes(StandardCharsets.UTF_8)))`,
    )
  }
  builder.push(`${i2}    .method(${javaStr(r.method)}, ${publisher})`, `${i2}    .build();`)
  if (skipped.length)
    lines.push(`${i2}// HttpClient 不允许手动设置这些请求头，已省略：${skipped.join(', ')}`)
  lines.push(
    ...builder,
    '',
    `${i2}HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());`,
    `${i2}System.out.println(response.statusCode());`,
    `${i2}System.out.println(response.body());`,
  )
  return javaClass(imports, 'Exception', lines)
}

// ───────────────────────────── PHP ─────────────────────────────

function genPhp(r: HttpRequest): string {
  const L: string[] = [
    '<?php',
    '',
    '$ch = curl_init();',
    `curl_setopt($ch, CURLOPT_URL, ${phpStr(r.url)});`,
  ]
  L.push('curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);')
  const b = r.body
  if (r.method === 'HEAD') L.push('curl_setopt($ch, CURLOPT_NOBODY, true);')
  else if (
    !(r.method === 'GET' && b.kind === 'none') &&
    !(r.method === 'POST' && b.kind !== 'none')
  )
    L.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, ${phpStr(r.method)});`)
  const headers = codeHeaders(r)
  if (headers.length) {
    L.push(
      'curl_setopt($ch, CURLOPT_HTTPHEADER, [',
      ...headers.map(([k, v]) => `    ${phpStr(v === '' ? `${k};` : `${k}: ${v}`)},`),
      ']);',
    )
  }
  if (r.auth)
    L.push(`curl_setopt($ch, CURLOPT_USERPWD, ${phpStr(`${r.auth.username}:${r.auth.password}`)});`)
  if (b.kind === 'text') L.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, ${phpStr(b.text)});`)
  else if (b.kind === 'file')
    L.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents(${phpStr(b.path)}));`)
  else if (b.kind === 'multipart') {
    L.push(
      'curl_setopt($ch, CURLOPT_POSTFIELDS, [',
      ...b.parts.map((p) =>
        p.kind === 'file'
          ? `    ${phpStr(p.name)} => new CURLFile(${phpStr(p.value)}, ${phpStr(p.contentType ?? '')}, ${phpStr(fileName(p))}),`
          : `    ${phpStr(p.name)} => ${phpStr(p.value)},`,
      ),
      ']);',
    )
  }
  if (r.followRedirects === true) L.push('curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);')
  const ms = timeoutMs(r)
  if (ms !== undefined) L.push(`curl_setopt($ch, CURLOPT_TIMEOUT_MS, ${ms});`)
  if (r.insecure) {
    L.push(
      'curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);',
      'curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);',
    )
  }
  if (r.compressed) L.push("curl_setopt($ch, CURLOPT_ENCODING, '');")
  L.push(
    '',
    '$response = curl_exec($ch);',
    'if ($response === false) {',
    "    echo 'Error: ' . curl_error($ch);",
    '} else {',
    '    echo curl_getinfo($ch, CURLINFO_RESPONSE_CODE) . PHP_EOL;',
    '    echo $response;',
    '}',
    'curl_close($ch);',
  )
  return L.join('\n')
}

// ───────────────────────────── Rust ─────────────────────────────

function genRust(r: HttpRequest): string {
  const i1 = '    '
  const L: string[] = [
    '// Cargo.toml: reqwest = { version = "0.12", features = ["blocking", "multipart"] }',
  ]
  const headers = codeHeaders(r)
  if (headers.length) L.push('use reqwest::header;', '')
  L.push('fn main() -> Result<(), Box<dyn std::error::Error>> {')
  if (headers.length) {
    L.push(`${i1}let mut headers = header::HeaderMap::new();`)
    const seen = new Set<string>()
    for (const [k, v] of headers) {
      const key = lower(k)
      L.push(
        `${i1}headers.${seen.has(key) ? 'append' : 'insert'}(${rustStr(key)}, ${rustStr(v)}.parse()?);`,
      )
      seen.add(key)
    }
    L.push('')
  }
  const b = r.body
  if (b.kind === 'multipart') {
    const parts = b.parts.map((p) => {
      if (p.kind === 'text') return `${i1}${i1}.text(${rustStr(p.name)}, ${rustStr(p.value)})`
      if (p.filename === undefined && !p.contentType)
        return `${i1}${i1}.file(${rustStr(p.name)}, ${rustStr(p.value)})?`
      let part = `reqwest::blocking::multipart::Part::file(${rustStr(p.value)})?`
      if (p.filename !== undefined) part += `.file_name(${rustStr(p.filename)})`
      if (p.contentType) part += `.mime_str(${rustStr(p.contentType)})?`
      return `${i1}${i1}.part(${rustStr(p.name)}, ${part})`
    })
    L.push(
      `${i1}let form = reqwest::blocking::multipart::Form::new()`,
      ...parts.map((p, i) => (i === parts.length - 1 ? p + ';' : p)),
      '',
    )
  }
  const cb: string[] = []
  if (r.followRedirects === false) cb.push('.redirect(reqwest::redirect::Policy::none())')
  if (r.insecure) cb.push('.danger_accept_invalid_certs(true)')
  const ms = timeoutMs(r)
  if (ms !== undefined) cb.push(`.timeout(std::time::Duration::from_millis(${ms}))`)
  L.push(
    cb.length
      ? `${i1}let client = reqwest::blocking::Client::builder()\n${cb.map((c) => `${i1}${i1}${c}`).join('\n')}\n${i1}${i1}.build()?;`
      : `${i1}let client = reqwest::blocking::Client::new();`,
  )
  const m = r.method
  let start: string
  if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(m))
    start = `.${m.toLowerCase()}(${rustStr(r.url)})`
  else if (m === 'OPTIONS' || m === 'CONNECT' || m === 'TRACE')
    start = `.request(reqwest::Method::${m}, ${rustStr(r.url)})`
  else start = `.request(reqwest::Method::from_bytes(${`b${rustStr(m)}`})?, ${rustStr(r.url)})`
  const chain = [start]
  if (headers.length) chain.push('.headers(headers)')
  if (r.auth)
    chain.push(`.basic_auth(${rustStr(r.auth.username)}, Some(${rustStr(r.auth.password)}))`)
  if (b.kind === 'text') chain.push(`.body(${rustBody(b.text)})`)
  else if (b.kind === 'file') chain.push(`.body(std::fs::read(${rustStr(b.path)})?)`)
  else if (b.kind === 'multipart') chain.push('.multipart(form)')
  chain.push('.send()?;')
  L.push(
    `${i1}let res = client`,
    ...chain.map((c) => `${i1}${i1}${c}`),
    '',
    `${i1}println!("{}", res.status());`,
    `${i1}println!("{}", res.text()?);`,
    `${i1}Ok(())`,
    '}',
  )
  return L.join('\n')
}

// ───────────────────────────── Swift ─────────────────────────────

function genSwift(r: HttpRequest): string {
  const L: string[] = ['import Foundation', '']
  if (r.insecure) L.push('// 注意：跳过证书校验（-k）需要实现 URLSessionDelegate，这里没有生成')
  if (r.followRedirects === false)
    L.push('// 注意：禁止重定向需要实现 URLSessionTaskDelegate，这里没有生成')
  L.push(`let url = URL(string: ${swiftStr(r.url)})!`, 'var request = URLRequest(url: url)')
  if (r.method !== 'GET') L.push(`request.httpMethod = ${swiftStr(r.method)}`)
  if (r.timeout !== undefined) L.push(`request.timeoutInterval = ${r.timeout}`)
  const seen = new Set<string>()
  for (const [k, v] of codeHeaders(r)) {
    L.push(
      `request.${seen.has(lower(k)) ? 'addValue' : 'setValue'}(${swiftStr(v)}, forHTTPHeaderField: ${swiftStr(k)})`,
    )
    seen.add(lower(k))
  }
  if (r.auth) {
    L.push(
      `let credentials = Data(${swiftStr(`${r.auth.username}:${r.auth.password}`)}.utf8).base64EncodedString()`,
      'request.setValue("Basic \\(credentials)", forHTTPHeaderField: "Authorization")',
    )
  }
  const b = r.body
  if (b.kind === 'text') L.push(`request.httpBody = Data(${swiftBody(b.text)}.utf8)`)
  else if (b.kind === 'file')
    L.push(`request.httpBody = try Data(contentsOf: URL(fileURLWithPath: ${swiftStr(b.path)}))`)
  else if (b.kind === 'multipart') {
    L.push('', 'let boundary = "Boundary-\\(UUID().uuidString)"', 'var body = Data()')
    for (const p of b.parts) {
      if (p.kind === 'file') {
        const head = `\r\nContent-Disposition: form-data; name="${p.name}"; filename="${fileName(p)}"\r\nContent-Type: ${p.contentType ?? 'application/octet-stream'}\r\n\r\n`
        L.push(
          `body.append(Data(("--\\(boundary)" + ${swiftStr(head)}).utf8))`,
          `body.append(try Data(contentsOf: URL(fileURLWithPath: ${swiftStr(p.value)})))`,
          'body.append(Data("\\r\\n".utf8))',
        )
      } else {
        const chunk = `\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`
        L.push(`body.append(Data(("--\\(boundary)" + ${swiftStr(chunk)}).utf8))`)
      }
    }
    L.push(
      'body.append(Data("--\\(boundary)--\\r\\n".utf8))',
      'request.setValue("multipart/form-data; boundary=\\(boundary)", forHTTPHeaderField: "Content-Type")',
      'request.httpBody = body',
    )
  }
  L.push(
    '',
    'let (data, response) = try await URLSession.shared.data(for: request)',
    'if let http = response as? HTTPURLResponse {',
    '    print(http.statusCode)',
    '}',
    'print(String(decoding: data, as: UTF8.self))',
  )
  return L.join('\n')
}

// ───────────────────────────── C# ─────────────────────────────

const CS_CONTENT_HEADERS = new Set([
  'content-type',
  'content-length',
  'content-language',
  'content-encoding',
  'content-disposition',
  'content-location',
  'content-md5',
  'content-range',
  'expires',
  'last-modified',
  'allow',
])

function genCSharp(r: HttpRequest): string {
  const L: string[] = ['using System.Net.Http.Headers;', 'using System.Text;', '']
  const handler: string[] = []
  if (r.followRedirects === false) handler.push('AllowAutoRedirect = false,')
  if (r.insecure)
    handler.push(
      'ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,',
    )
  if (r.compressed) handler.push('AutomaticDecompression = System.Net.DecompressionMethods.All,')
  if (handler.length) {
    L.push(
      'var handler = new HttpClientHandler',
      '{',
      ...handler.map((h) => '    ' + h),
      '};',
      'using var client = new HttpClient(handler);',
    )
  } else L.push('using var client = new HttpClient();')
  const ms = timeoutMs(r)
  if (ms !== undefined) L.push(`client.Timeout = TimeSpan.FromMilliseconds(${ms});`)
  L.push(
    '',
    `using var request = new HttpRequestMessage(new HttpMethod(${csStr(r.method)}), ${csStr(r.url)});`,
  )
  const contentHeaders: [string, string][] = []
  for (const [k, v] of codeHeaders(r)) {
    if (CS_CONTENT_HEADERS.has(lower(k))) {
      contentHeaders.push([k, v])
      continue
    }
    L.push(`request.Headers.TryAddWithoutValidation(${csStr(k)}, ${csStr(v)});`)
  }
  if (r.auth) {
    L.push(
      `request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(${csStr(`${r.auth.username}:${r.auth.password}`)})));`,
    )
  }
  const b = r.body
  let hasContent = true
  if (b.kind === 'text') L.push(`request.Content = new StringContent(${csStr(b.text)});`)
  else if (b.kind === 'file')
    L.push(`request.Content = new ByteArrayContent(File.ReadAllBytes(${csStr(b.path)}));`)
  else if (b.kind === 'multipart') {
    L.push('var form = new MultipartFormDataContent();')
    b.parts.forEach((p, i) => {
      if (p.kind === 'file') {
        L.push(`var file${i} = new ByteArrayContent(File.ReadAllBytes(${csStr(p.value)}));`)
        if (p.contentType)
          L.push(
            `file${i}.Headers.ContentType = MediaTypeHeaderValue.Parse(${csStr(p.contentType)});`,
          )
        L.push(`form.Add(file${i}, ${csStr(p.name)}, ${csStr(fileName(p))});`)
      } else L.push(`form.Add(new StringContent(${csStr(p.value)}), ${csStr(p.name)});`)
    })
    L.push('request.Content = form;')
  } else hasContent = false
  for (const [k, v] of contentHeaders) {
    if (!hasContent) {
      L.push(`// 没有请求体，已省略内容头 ${k}`)
      continue
    }
    if (lower(k) === 'content-type')
      L.push(`request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(${csStr(v)});`)
    else {
      L.push(`request.Content.Headers.Remove(${csStr(k)});`)
      L.push(`request.Content.Headers.TryAddWithoutValidation(${csStr(k)}, ${csStr(v)});`)
    }
  }
  L.push(
    '',
    'using var response = await client.SendAsync(request);',
    'Console.WriteLine((int)response.StatusCode);',
    'Console.WriteLine(await response.Content.ReadAsStringAsync());',
  )
  return L.join('\n')
}

// ───────────────────────────── wget / HTTPie ─────────────────────────────

function genWget(r: HttpRequest): string {
  const pre: string[] = []
  const args: string[] = ['wget', '--quiet']
  if (r.method !== 'GET') args.push(`--method=${shQuote(r.method)}`)
  for (const [k, v] of r.headers) args.push(`--header=${shq(`${k}: ${v}`)}`)
  if (r.auth) {
    args.push(
      `--user=${shq(r.auth.username)}`,
      `--password=${shq(r.auth.password)}`,
      '--auth-no-challenge',
    )
  }
  const b = r.body
  if (b.kind === 'text') args.push(`--body-data=${shq(b.text)}`)
  else if (b.kind === 'file') args.push(`--body-file=${shq(b.path)}`)
  else if (b.kind === 'multipart')
    pre.push('# 注意：wget 不支持 multipart/form-data 表单，已省略请求体，建议改用 curl 或 HTTPie')
  if (r.timeout !== undefined) args.push(`--timeout=${r.timeout}`)
  if (r.insecure) args.push('--no-check-certificate')
  if (r.followRedirects === false) args.push('--max-redirect=0')
  if (r.compressed) args.push('--compression=auto')
  args.push('--output-document=-', shq(r.url))
  return [...pre, joinShell(args)].join('\n')
}

function joinShell(args: string[]): string {
  // 第一行放命令和前两个参数，其余每行一个
  if (args.length <= 3) return args.join(' ')
  return [args.slice(0, 2).join(' '), ...args.slice(2)].join(' \\\n  ')
}

function genHttpie(r: HttpRequest): string {
  const flags: string[] = []
  const pre: string[] = []
  const b = r.body
  if (r.followRedirects === true) flags.push('--follow')
  if (r.insecure) flags.push('--verify=no')
  if (r.timeout !== undefined) flags.push(`--timeout=${r.timeout}`)
  if (r.auth) flags.push(`--auth=${shq(`${r.auth.username}:${r.auth.password}`)}`)
  if (b.kind === 'text') flags.push(`--raw=${shq(b.text)}`)
  if (b.kind === 'multipart') flags.push('--multipart')
  const items: string[] = []
  for (const [k, v] of codeHeaders(r)) items.push(shq(v === '' ? `${k};` : `${k}:${v}`))
  if (b.kind === 'multipart') {
    for (const p of b.parts) {
      if (p.kind === 'file')
        items.push(shq(`${p.name}@${p.value}${p.contentType ? `;type=${p.contentType}` : ''}`))
      else items.push(shq(`${p.name}=${p.value}`))
    }
  }
  const head = ['http', ...flags, r.method, shq(r.url)].join(' ')
  let cmd = items.length ? [head, ...items].join(' \\\n  ') : head
  if (b.kind === 'file') cmd += ` \\\n  < ${shq(b.path)}`
  return [...pre, cmd].join('\n')
}
