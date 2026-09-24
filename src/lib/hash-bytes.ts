/**
 * 字节编解码工具（纯函数，无 DOM 依赖）：UTF-8 / UTF-16LE / Hex / Base64 / Base64URL。
 * 哈希、HMAC、AES/DES、JWT 几个工具共用，解析失败时抛出带位置的 ByteDecodeError。
 */

export type ByteEncoding = 'utf8' | 'hex' | 'base64'
export type TextEncodingId = ByteEncoding | 'utf16le' | 'latin1'

export const BYTE_ENCODING_LABELS: Record<TextEncodingId, string> = {
  utf8: 'UTF-8',
  utf16le: 'UTF-16LE',
  latin1: 'Latin-1',
  hex: 'Hex',
  base64: 'Base64',
}

/** 解码失败：message 为中文说明，position 为出错字符在原始输入里的下标（0 起） */
export class ByteDecodeError extends Error {
  readonly position?: number
  constructor(message: string, position?: number) {
    super(message)
    this.name = 'ByteDecodeError'
    this.position = position
  }
}

const encoder = new TextEncoder()

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text)
}

/** fatal=true 时遇到非法 UTF-8 序列抛 ByteDecodeError（含字节偏移） */
export function utf8Decode(bytes: Uint8Array, fatal = false): string {
  if (!fatal) return new TextDecoder('utf-8').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    const at = firstInvalidUtf8(bytes)
    throw new ByteDecodeError(
      `不是有效的 UTF-8 文本${at >= 0 ? `（第 ${at + 1} 个字节 0x${hex2(bytes[at])} 起）` : ''}`,
      at >= 0 ? at : undefined,
    )
  }
}

/** 返回第一个非法 UTF-8 序列的字节下标，全部合法返回 -1 */
export function firstInvalidUtf8(b: Uint8Array): number {
  let i = 0
  while (i < b.length) {
    const c = b[i]
    let n: number
    let min: number
    if (c < 0x80) {
      i++
      continue
    } else if (c >= 0xc2 && c <= 0xdf) {
      n = 1
      min = 0x80
    } else if (c >= 0xe0 && c <= 0xef) {
      n = 2
      min = 0x800
    } else if (c >= 0xf0 && c <= 0xf4) {
      n = 3
      min = 0x10000
    } else return i
    if (i + n >= b.length) return i
    let cp = c & (0x3f >> n)
    for (let k = 1; k <= n; k++) {
      const x = b[i + k]
      if (x === undefined || (x & 0xc0) !== 0x80) return i
      cp = (cp << 6) | (x & 0x3f)
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return i
    i += n + 1
  }
  return -1
}

export function utf16leEncode(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    out[i * 2] = c & 0xff
    out[i * 2 + 1] = c >>> 8
  }
  return out
}

/** Latin-1：每个字符取低 8 位；超出 0xFF 的字符报错 */
export function latin1Encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c > 0xff) {
      throw new ByteDecodeError(
        `第 ${i + 1} 个字符「${String.fromCodePoint(text.codePointAt(i) ?? c)}」超出 Latin-1 范围，请改用 UTF-8`,
        i,
      )
    }
    out[i] = c
  }
  return out
}

const HEX = '0123456789abcdef'
const SEP = /[\s:,;-]/
const hex2 = (n: number) => HEX[n >>> 4] + HEX[n & 15]

export function bytesToHex(bytes: Uint8Array, upper = false): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += hex2(bytes[i])
  return upper ? s.toUpperCase() : s
}

/**
 * 解析十六进制：忽略空白、冒号、逗号分隔，允许整体或逐字节的 0x 前缀。
 * 奇数长度、非法字符都抛出带位置的错误。
 */
export function hexToBytes(input: string): Uint8Array {
  const digits: number[] = []
  const positions: number[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    // 0x 前缀：只在开头或分隔符之后出现时当作前缀
    if (
      ch === '0' &&
      (input[i + 1] === 'x' || input[i + 1] === 'X') &&
      (i === 0 || SEP.test(input[i - 1]))
    ) {
      i += 2
      continue
    }
    if (SEP.test(ch)) {
      i++
      continue
    }
    const v = HEX.indexOf(ch.toLowerCase())
    if (v < 0) {
      throw new ByteDecodeError(
        `Hex 第 ${i + 1} 个字符「${ch}」不是十六进制数字（只允许 0-9、a-f）`,
        i,
      )
    }
    digits.push(v)
    positions.push(i)
    i++
  }
  if (digits.length % 2 !== 0) {
    throw new ByteDecodeError(
      `Hex 长度为奇数（${digits.length} 个数字），每个字节需要两位十六进制`,
      positions[positions.length - 1],
    )
  }
  const out = new Uint8Array(digits.length / 2)
  for (let k = 0; k < out.length; k++) out[k] = (digits[k * 2] << 4) | digits[k * 2 + 1]
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64_LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1)
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i
  t['-'.charCodeAt(0)] = 62
  t['_'.charCodeAt(0)] = 63
  return t
})()

export function bytesToBase64(bytes: Uint8Array, url = false, pad = !url): string {
  const alpha = url ? B64URL : B64
  let s = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    s += alpha[n >>> 18] + alpha[(n >>> 12) & 63] + alpha[(n >>> 6) & 63] + alpha[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    s += alpha[n >>> 18] + alpha[(n >>> 12) & 63] + (pad ? '==' : '')
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    s += alpha[n >>> 18] + alpha[(n >>> 12) & 63] + alpha[(n >>> 6) & 63] + (pad ? '=' : '')
  }
  return s
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes, true, false)
}

/**
 * 宽松解析 Base64：同时接受标准与 URL-safe 字母表，忽略空白，允许缺省的 = 填充。
 * strictUrl=true 时只接受 Base64URL（JWT 用），遇到 + / = 报错。
 */
export function base64ToBytes(input: string, opts: { strictUrl?: boolean; label?: string } = {}) {
  const label = opts.label ?? 'Base64'
  const vals: number[] = []
  let padStart = -1
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    const code = input.charCodeAt(i)
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      if (opts.strictUrl) throw new ByteDecodeError(`${label} 第 ${i + 1} 个字符是空白`, i)
      continue
    }
    if (ch === '=') {
      if (opts.strictUrl) {
        throw new ByteDecodeError(`${label} 不应包含「=」填充（第 ${i + 1} 个字符）`, i)
      }
      if (padStart < 0) padStart = vals.length
      continue
    }
    if (padStart >= 0) {
      throw new ByteDecodeError(`${label} 第 ${i + 1} 个字符「${ch}」出现在「=」填充之后`, i)
    }
    const v = code < 128 ? B64_LOOKUP[code] : -1
    if (v < 0 || (opts.strictUrl && (ch === '+' || ch === '/'))) {
      const shown = String.fromCodePoint(input.codePointAt(i) ?? code)
      throw new ByteDecodeError(
        `${label} 第 ${i + 1} 个字符「${shown}」不合法${
          opts.strictUrl && (ch === '+' || ch === '/')
            ? '（Base64URL 应使用 - 和 _ 代替 + 和 /）'
            : ''
        }`,
        i,
      )
    }
    vals.push(v)
  }
  if (vals.length % 4 === 1) {
    throw new ByteDecodeError(
      `${label} 长度不正确：去掉填充后有 ${vals.length} 个字符，除以 4 余 1，末尾可能被截断`,
    )
  }
  const out = new Uint8Array(Math.floor((vals.length * 3) / 4))
  let o = 0
  let k = 0
  for (; k + 3 < vals.length; k += 4) {
    const n = (vals[k] << 18) | (vals[k + 1] << 12) | (vals[k + 2] << 6) | vals[k + 3]
    out[o++] = n >>> 16
    out[o++] = (n >>> 8) & 255
    out[o++] = n & 255
  }
  const rest = vals.length - k
  if (rest === 2) {
    const n = (vals[k] << 18) | (vals[k + 1] << 12)
    out[o] = n >>> 16
  } else if (rest === 3) {
    const n = (vals[k] << 18) | (vals[k + 1] << 12) | (vals[k + 2] << 6)
    out[o] = n >>> 16
    out[o + 1] = (n >>> 8) & 255
  }
  return out
}

/** 按编码把用户输入的字符串转成字节 */
export function decodeInput(text: string, enc: TextEncodingId): Uint8Array {
  switch (enc) {
    case 'utf8':
      return utf8Encode(text)
    case 'utf16le':
      return utf16leEncode(text)
    case 'latin1':
      return latin1Encode(text)
    case 'hex':
      return hexToBytes(text)
    case 'base64':
      return base64ToBytes(text)
    default:
      throw new ByteDecodeError(`不支持的编码：${String(enc)}`)
  }
}

/** 把字节按编码显示；utf8 用非严格解码 */
export function encodeOutput(bytes: Uint8Array, enc: ByteEncoding, upper = false): string {
  switch (enc) {
    case 'utf8':
      return utf8Decode(bytes)
    case 'hex':
      return bytesToHex(bytes, upper)
    case 'base64':
      return bytesToBase64(bytes)
    default:
      throw new ByteDecodeError(`不支持的编码：${String(enc)}`)
  }
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

/** 安全随机字节（浏览器与 Node 18+ 均有 globalThis.crypto） */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  const c = globalThis.crypto
  for (let i = 0; i < n; i += 65536) c.getRandomValues(out.subarray(i, Math.min(n, i + 65536)))
  return out
}

const PRINTABLE = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** 随机可打印 ASCII 字符串（每个字符 1 字节，适合 UTF-8 密钥） */
export function randomPrintable(n: number): string {
  // 拒绝采样，避免取模偏差
  const limit = 256 - (256 % PRINTABLE.length)
  let s = ''
  while (s.length < n) {
    for (const v of randomBytes(n * 2)) {
      if (v >= limit) continue
      s += PRINTABLE[v % PRINTABLE.length]
      if (s.length === n) break
    }
  }
  return s
}

/** 生成 n 个随机字节并按编码输出（utf8 时输出 n 个可打印字符） */
export function randomEncoded(n: number, enc: ByteEncoding): string {
  if (enc === 'utf8') return randomPrintable(n)
  return encodeOutput(randomBytes(n), enc)
}

/** 统计字符串按某编码解析后的字节数；无效时返回 null */
export function byteLength(text: string, enc: TextEncodingId): number | null {
  try {
    return decodeInput(text, enc).length
  } catch {
    return null
  }
}
