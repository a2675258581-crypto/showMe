/** Base64 编解码（纯函数，无 DOM 依赖，可在 Node 中运行） */

const STD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** 字符码 → 6 位值；-1 非法。同时接受标准与 URL 安全字符 */
const DECODE_TABLE = (() => {
  const t = new Int16Array(128).fill(-1)
  for (let i = 0; i < 64; i++) {
    t[STD_ALPHABET.charCodeAt(i)] = i
    t[URL_ALPHABET.charCodeAt(i)] = i
  }
  return t
})()

export interface Base64EncodeOptions {
  /** 使用 URL 安全字符集（- 与 _ 代替 + 与 /） */
  urlSafe?: boolean
  /** 保留末尾的 = 填充，默认 true */
  padding?: boolean
  /** 每行最多字符数（MIME 为 76），0 或缺省表示不换行 */
  lineWidth?: number
}

const utf8Encoder = new TextEncoder()

export function utf8Encode(text: string): Uint8Array {
  return utf8Encoder.encode(text)
}

/** ASCII 码数组 → 字符串，分块避免参数过多 */
function asciiToString(buf: Uint8Array): string {
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) {
    s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  }
  return s
}

/** 按固定宽度折行 */
export function wrapLines(s: string, width: number, eol = '\n'): string {
  if (!width || width <= 0 || s.length <= width) return s
  const parts: string[] = []
  for (let i = 0; i < s.length; i += width) parts.push(s.slice(i, i + width))
  return parts.join(eol)
}

/** Base64 编码后的字符数（不含换行） */
export function encodedLength(byteLength: number, padding = true): number {
  return padding ? Math.ceil(byteLength / 3) * 4 : Math.ceil((byteLength * 4) / 3)
}

export function bytesToBase64(bytes: Uint8Array, opts: Base64EncodeOptions = {}): string {
  const { urlSafe = false, padding = true, lineWidth = 0 } = opts
  const alpha = urlSafe ? URL_ALPHABET : STD_ALPHABET
  const codes = new Uint8Array(64)
  for (let i = 0; i < 64; i++) codes[i] = alpha.charCodeAt(i)
  const len = bytes.length
  const full = len - (len % 3)
  const out = new Uint8Array(Math.ceil(len / 3) * 4)
  let o = 0
  for (let i = 0; i < full; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out[o++] = codes[(n >> 18) & 63]
    out[o++] = codes[(n >> 12) & 63]
    out[o++] = codes[(n >> 6) & 63]
    out[o++] = codes[n & 63]
  }
  const rest = len - full
  if (rest === 1) {
    const n = bytes[full] << 16
    out[o++] = codes[(n >> 18) & 63]
    out[o++] = codes[(n >> 12) & 63]
    if (padding) {
      out[o++] = 61
      out[o++] = 61
    }
  } else if (rest === 2) {
    const n = (bytes[full] << 16) | (bytes[full + 1] << 8)
    out[o++] = codes[(n >> 18) & 63]
    out[o++] = codes[(n >> 12) & 63]
    out[o++] = codes[(n >> 6) & 63]
    if (padding) out[o++] = 61
  }
  return wrapLines(asciiToString(out.subarray(0, o)), lineWidth)
}

/** 文本按 UTF-8 编码后再 Base64 */
export function encodeText(text: string, opts: Base64EncodeOptions = {}): string {
  return bytesToBase64(utf8Encode(text), opts)
}

/** 解码时识别出的输入特征 */
export interface Base64Variant {
  /** 出现了 - 或 _ */
  urlSafe: boolean
  /** 出现了 + 或 / */
  standard: boolean
  /** 末尾有 = 填充 */
  padded: boolean
  /** 缺少应有的填充 */
  missingPadding: boolean
  /** 含空白 / 换行 */
  whitespace: boolean
  /** 带 data: URL 前缀时的 MIME（没有则为 undefined） */
  dataUrlMime?: string
}

export type Base64DecodeResult =
  | { ok: true; bytes: Uint8Array; variant: Base64Variant }
  | {
      ok: false
      error: string
      /** 出错位置（UTF-16 下标，相对原始输入） */
      index: number
      line: number
      column: number
    }

/** UTF-16 下标 → 1 起的行列号（列按 Unicode 字符计） */
export function lineColumn(text: string, index: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  const column = Array.from(text.slice(lineStart, index)).length + 1
  return { line, column }
}

/** 字符的可读描述：“*”（U+002A） */
export function describeChar(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0
  const hex = cp.toString(16).toUpperCase().padStart(4, '0')
  const invisible = /^[\p{C}\p{Z}]$/u.test(ch)
  return invisible ? `U+${hex}（不可见字符）` : `“${ch}”（U+${hex}）`
}

const DATA_URL_RE = /^\s*data:([^,;]*)((?:;[^,;]*)*?);base64,/i

const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11

/**
 * 宽松解码：自动接受 URL 安全字符、缺失填充、空白与换行、data: URL 前缀。
 * 非法字符会给出精确的行列位置。
 */
export function base64ToBytes(input: string): Base64DecodeResult {
  let start = 0
  let dataUrlMime: string | undefined
  const m = DATA_URL_RE.exec(input)
  if (m) {
    start = m[0].length
    dataUrlMime = m[1].trim().toLowerCase() || 'text/plain'
  }

  const fail = (index: number, error: string): Base64DecodeResult => {
    const { line, column } = lineColumn(input, index)
    return { ok: false, error: `第 ${line} 行第 ${column} 列：${error}`, index, line, column }
  }

  const out = new Uint8Array(Math.ceil(((input.length - start) * 3) / 4) + 3)
  let o = 0
  let acc = 0
  let n = 0 // 已读取的数据字符数
  let pads = 0
  let firstPad = -1
  let whitespace = false
  let urlSafe = false
  let standard = false

  for (let i = start; i < input.length; i++) {
    const c = input.charCodeAt(i)
    if (isSpace(c)) {
      whitespace = true
      continue
    }
    if (c === 61) {
      // '='
      if (pads === 0) firstPad = i
      pads++
      if (pads > 2) return fail(i, '填充符 = 最多只能有 2 个')
      continue
    }
    const v = c < 128 ? DECODE_TABLE[c] : -1
    if (v < 0) {
      const cp = input.codePointAt(i) ?? c
      const ch = String.fromCodePoint(cp)
      return fail(
        i,
        `非法字符 ${describeChar(ch)}。Base64 只能包含 A–Z、a–z、0–9、+ /（或 URL 安全的 - _）以及末尾的 =`,
      )
    }
    if (pads > 0) {
      return fail(
        firstPad,
        '填充符 = 只能出现在末尾，但它后面还有数据（可能是两段 Base64 被拼在了一起）',
      )
    }
    if (c === 43 || c === 47) standard = true
    else if (c === 45 || c === 95) urlSafe = true
    acc = (acc << 6) | v
    n++
    if (n % 4 === 0) {
      out[o++] = (acc >> 16) & 255
      out[o++] = (acc >> 8) & 255
      out[o++] = acc & 255
      acc = 0
    }
  }

  const rem = n % 4
  if (rem === 1) {
    // 定位到最后一个数据字符
    let last = input.length - 1
    while (last >= start && (isSpace(input.charCodeAt(last)) || input[last] === '=')) last--
    return fail(
      Math.max(last, start),
      `长度不正确：共 ${n} 个有效字符，最后一组只剩 1 个字符（有效字符数除以 4 的余数不能为 1），数据可能被截断`,
    )
  }
  if (rem === 2) {
    out[o++] = (acc >> 4) & 255
  } else if (rem === 3) {
    out[o++] = (acc >> 10) & 255
    out[o++] = (acc >> 2) & 255
  }
  if (pads > 0 && (rem === 0 || rem + pads !== 4)) {
    return fail(
      firstPad,
      rem === 0
        ? '多余的填充符 =：数据长度已是 4 的倍数，不需要填充'
        : `填充符数量不对：最后一组有 ${rem} 个字符，应补 ${4 - rem} 个 =，实际为 ${pads} 个`,
    )
  }

  return {
    ok: true,
    bytes: out.slice(0, o),
    variant: {
      urlSafe,
      standard,
      padded: pads > 0,
      missingPadding: pads === 0 && rem !== 0,
      whitespace,
      dataUrlMime,
    },
  }
}

/** 返回第一个非法 UTF-8 序列的字节偏移，全部合法返回 -1 */
export function findInvalidUtf8(bytes: Uint8Array): number {
  const len = bytes.length
  let i = 0
  while (i < len) {
    const b = bytes[i]
    if (b < 0x80) {
      i++
      continue
    }
    let need: number
    let min: number
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1
      min = 0x80
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2
      min = 0x800
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3
      min = 0x10000
    } else return i
    if (i + need >= len) return i
    let cp = b & (0x3f >> need)
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k]
      if (c === undefined || (c & 0xc0) !== 0x80) return i
      cp = (cp << 6) | (c & 0x3f)
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return i
    i += need + 1
  }
  return -1
}

export interface Utf8DecodeResult {
  /** 解码文本（非法序列以 U+FFFD 替代） */
  text: string
  /** 第一个非法字节的偏移，-1 表示完全合法 */
  invalidAt: number
  /** 开头是否有 UTF-8 BOM（EF BB BF，已从 text 中去掉） */
  bom: boolean
}

export function decodeUtf8(bytes: Uint8Array): Utf8DecodeResult {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const text = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(bytes)
  return { text, invalidAt: findInvalidUtf8(bytes), bom }
}

/** 字节 → 十六进制字符串 */
export function bytesToHex(bytes: Uint8Array, sep = ' ', upper = false): string {
  const parts: string[] = new Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16).padStart(2, '0')
    parts[i] = upper ? h.toUpperCase() : h
  }
  return parts.join(sep)
}

/**
 * xxd 风格的十六进制转储：
 * 00000000  48 65 6c 6c 6f 20 e4 b8  ad e6 96 87 0a           |Hello ......|
 */
export function hexDump(bytes: Uint8Array, maxBytes = Infinity): string {
  const total = Math.min(bytes.length, maxBytes)
  const lines: string[] = []
  for (let off = 0; off < total; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, total))
    let hex = ''
    let ascii = ''
    for (let i = 0; i < 16; i++) {
      if (i === 8) hex += ' '
      if (i < row.length) {
        hex += row[i].toString(16).padStart(2, '0') + ' '
        ascii += row[i] >= 0x20 && row[i] < 0x7f ? String.fromCharCode(row[i]) : '.'
      } else hex += '   '
    }
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex} |${ascii}|`)
  }
  if (bytes.length > total) lines.push(`… 其余 ${bytes.length - total} 字节未显示`)
  return lines.join('\n')
}

/** Base64 相对原始字节的膨胀百分比（如 33.3） */
export function overheadPercent(originalBytes: number, encodedChars: number): number {
  if (originalBytes <= 0) return 0
  return Math.round(((encodedChars - originalBytes) / originalBytes) * 1000) / 10
}
