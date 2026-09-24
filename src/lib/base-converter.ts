/** 进制转换（纯函数，基于 BigInt，支持任意大小的整数与负数） */

export const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 单个输入的最大字符数，防止粘贴超大内容卡死页面 */
export const MAX_INPUT_LENGTH = 100_000

export const BASE_NAMES: Record<number, string> = {
  2: '二进制',
  8: '八进制',
  10: '十进制',
  16: '十六进制',
}

export function baseName(base: number): string {
  return BASE_NAMES[base] ?? `${base} 进制`
}

/** 该进制允许的字符说明：0–7、0–9、A–F */
export function allowedDigits(base: number): string {
  if (base === 2) return '0 和 1'
  if (base <= 10) return `0–${base - 1}`
  if (base === 11) return '0–9 和 A'
  return `0–9、A–${DIGITS[base - 1].toUpperCase()}`
}

const PREFIX_BASE: Record<string, number> = { x: 16, o: 8, b: 2 }
const SEPARATORS = new Set([' ', '_', ',', "'", '\t', '\u00a0', '\u2009', '\u202f', '\u3000'])

export type ParseResult =
  | { ok: true; value: bigint; /** 实际使用的进制（十进制栏里写 0x 时为 16） */ base: number }
  | { ok: false; error: string; /** 原始字符串中出错字符的下标 */ invalid: number[] }

/** 大于 10 的进制按块累加，避免逐位 BigInt 运算 */
function parseDigits(digits: string, base: number): bigint {
  if (base === 10) return BigInt(digits)
  if (base === 16) return BigInt('0x' + digits)
  if (base === 8) return BigInt('0o' + digits)
  if (base === 2) return BigInt('0b' + digits)
  let chunk = 1
  while (base ** (chunk + 1) < Number.MAX_SAFE_INTEGER) chunk++
  const big = BigInt(base)
  const first = digits.length % chunk || chunk
  let value = BigInt(parseInt(digits.slice(0, first), base))
  const mul = big ** BigInt(chunk)
  for (let i = first; i < digits.length; i += chunk) {
    value = value * mul + BigInt(parseInt(digits.slice(i, i + chunk), base))
  }
  return value
}

/**
 * 按指定进制解析整数。
 * - 忽略空格、下划线、逗号、单引号等分隔符
 * - 接受正负号；与进制匹配的 0x / 0o / 0b 前缀（十进制栏接受任意前缀并按前缀进制解析）
 * - 返回无效字符的位置，便于高亮
 */
export function parseInBase(raw: string, base: number): ParseResult | null {
  if (base < 2 || base > 36 || !Number.isInteger(base)) {
    return { ok: false, error: `进制必须是 2–36 之间的整数`, invalid: [] }
  }
  if (!raw.trim()) return null
  const original = raw
  // 全角数字 / 字母 / 正负号（中文输入法）按半角处理；都是单个 UTF-16 单元，下标不变
  raw = raw.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  if (raw.length > MAX_INPUT_LENGTH) {
    return {
      ok: false,
      error: `输入过长（${raw.length.toLocaleString()} 个字符），最多支持 ${MAX_INPUT_LENGTH.toLocaleString()} 个`,
      invalid: [],
    }
  }
  let i = 0
  while (i < raw.length && SEPARATORS.has(raw[i])) i++
  let neg = false
  if (raw[i] === '-' || raw[i] === '+' || raw[i] === '−') {
    neg = raw[i] !== '+'
    i++
    while (i < raw.length && SEPARATORS.has(raw[i])) i++
  }
  let radix = base
  let prefixed = false
  if (raw[i] === '0' && i + 1 < raw.length) {
    const p = raw[i + 1].toLowerCase()
    const pb = PREFIX_BASE[p]
    if (pb && (pb === base || base === 10)) {
      radix = pb
      prefixed = true
      i += 2
    }
  }
  const invalid: number[] = []
  let digits = ''
  let signInMiddle = -1
  /** 第一个无效字符（完整码点）及它是第几个字符（按码点计） */
  let firstBad: { ch: string; pos: number } | null = null
  while (i < raw.length) {
    // 按码点读取，emoji 等代理对算一个字符；invalid 里记录 UTF-16 下标供高亮使用
    const cp = raw.codePointAt(i)!
    const ch = String.fromCodePoint(cp)
    const at = i
    i += ch.length
    if (SEPARATORS.has(ch)) continue
    const d = DIGITS.indexOf(ch.toLowerCase())
    if (d >= 0 && d < radix) digits += ch.toLowerCase()
    else {
      if ((ch === '-' || ch === '+') && signInMiddle < 0) signInMiddle = at
      firstBad ??= { ch: original.slice(at, at + ch.length), pos: [...raw.slice(0, at)].length + 1 }
      invalid.push(at)
    }
  }
  if (invalid.length && firstBad) {
    const first = invalid[0]
    const { ch, pos } = firstBad
    const name = baseName(radix)
    let error: string
    if (signInMiddle === first) error = `第 ${pos} 个字符「${ch}」：正负号只能写在最前面`
    else {
      error = `第 ${pos} 个字符「${ch}」不是有效的${name}数字（只能是 ${allowedDigits(radix)}）`
      if (radix === 2 && /[x]/i.test(raw)) error += '，十六进制请填到十六进制栏'
    }
    if (invalid.length > 1) error += `，共 ${invalid.length} 处无效字符`
    return { ok: false, error, invalid }
  }
  if (!digits) {
    return {
      ok: false,
      error: prefixed ? '前缀后面缺少数字' : '请输入数字',
      invalid: [],
    }
  }
  const v = parseDigits(digits, radix)
  return { ok: true, value: neg ? -v : v, base: radix }
}

export function groupSize(base: number): number {
  return base === 8 || base === 10 ? 3 : 4
}

/** 从右往左每 size 位插入分隔符 */
export function groupDigits(s: string, size: number, sep = ' '): string {
  if (size <= 0 || s.length <= size) return s
  const head = s.length % size
  const parts: string[] = []
  if (head) parts.push(s.slice(0, head))
  for (let i = head; i < s.length; i += size) parts.push(s.slice(i, i + size))
  return parts.join(sep)
}

export interface FormatOptions {
  uppercase?: boolean
  group?: boolean
  /** 分组分隔符，默认空格 */
  separator?: string
}

export function formatInBase(value: bigint, base: number, opts: FormatOptions = {}): string {
  const neg = value < 0n
  let s = (neg ? -value : value).toString(base)
  if (opts.uppercase) s = s.toUpperCase()
  if (opts.group) s = groupDigits(s, groupSize(base), opts.separator ?? ' ')
  return (neg ? '-' : '') + s
}

const abs = (v: bigint) => (v < 0n ? -v : v)

/** |v| 的二进制位数，0 → 0 */
export function bitLength(v: bigint): number {
  const a = abs(v)
  return a === 0n ? 0 : a.toString(2).length
}

/** |v| 中 1 的个数 */
export function popcount(v: bigint): number {
  let n = 0
  for (const c of abs(v).toString(2)) if (c === '1') n++
  return n
}

export function isPowerOfTwo(v: bigint): boolean {
  return v > 0n && (v & (v - 1n)) === 0n
}

/** 表示该值所需的最少补码位数（含符号位） */
export function minSignedBits(v: bigint): number {
  if (v >= 0n) return bitLength(v) + 1
  return bitLength(-v - 1n) + 1
}

/** 存放 |v| 所需的最少字节数 */
export function byteLength(v: bigint): number {
  return Math.max(1, Math.ceil(bitLength(v) / 8))
}

export const WIDTHS = [8, 16, 32, 64] as const
export type Width = (typeof WIDTHS)[number]

export interface WidthInfo {
  bits: Width
  /** 能否作为有符号整数（int8/16/32/64）存下 */
  fitsSigned: boolean
  /** 能否作为无符号整数（uint8/16/32/64）存下 */
  fitsUnsigned: boolean
  /** 两者都存不下：被截断 */
  overflow: boolean
  /** 该宽度下的位模式（按无符号理解） */
  pattern: bigint
  /** 同一位模式按有符号 / 无符号解释的值 */
  signed: bigint
  unsigned: bigint
  binary: string
  hex: string
}

export function twosComplement(v: bigint, bits: Width): WidthInfo {
  const n = BigInt(bits)
  const min = -(1n << (n - 1n))
  const maxSigned = (1n << (n - 1n)) - 1n
  const maxUnsigned = (1n << n) - 1n
  const fitsSigned = v >= min && v <= maxSigned
  const fitsUnsigned = v >= 0n && v <= maxUnsigned
  const pattern = BigInt.asUintN(bits, v)
  return {
    bits,
    fitsSigned,
    fitsUnsigned,
    overflow: !fitsSigned && !fitsUnsigned,
    pattern,
    signed: BigInt.asIntN(bits, v),
    unsigned: pattern,
    binary: pattern.toString(2).padStart(bits, '0'),
    hex: pattern
      .toString(16)
      .toUpperCase()
      .padStart(bits / 4, '0'),
  }
}

/** 能装下该值的最小宽度（有符号或无符号均可），都装不下时为 64 */
export function autoWidth(v: bigint): Width {
  for (const w of WIDTHS) {
    const info = twosComplement(v, w)
    if (!info.overflow) return w
  }
  return 64
}

/**
 * 翻转第 bit 位（0 为最低位）。
 * signed 为真时按 width 位补码解释结果（最高位是符号位）；
 * 否则非负数直接异或（保留 width 以上的高位），负数先取 width 位模式。
 */
export function toggleBit(v: bigint, bit: number, width: Width, signed: boolean): bigint {
  const mask = 1n << BigInt(bit)
  if (signed) return BigInt.asIntN(width, BigInt.asUintN(width, v) ^ mask)
  if (v >= 0n) return v ^ mask
  return BigInt.asUintN(width, v) ^ mask
}

/** 读取第 bit 位（按 width 位补码） */
export function getBit(v: bigint, bit: number, width: Width): boolean {
  return ((BigInt.asUintN(width, v) >> BigInt(bit)) & 1n) === 1n
}
