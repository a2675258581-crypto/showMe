/**
 * UUID v4 / v7、ULID、NanoID 生成与 UUID / ULID 解析（纯函数，无 DOM 依赖）。
 * v7 与 ULID 在同一毫秒内严格单调递增；解析支持 v1 / v6 / v7 / ULID 的内嵌时间戳。
 */

// ───────────────────────── 随机数 ─────────────────────────

/** 返回 n 个随机字节（默认 crypto.getRandomValues），测试时可注入 */
export type RandomBytes = (n: number) => Uint8Array

export const cryptoBytes: RandomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))

/** 均匀随机下标 [0, n)，拒绝采样避免取模偏差 */
function randomIndex(n: number, randomBytes: RandomBytes): number {
  if (n <= 1) return 0
  const limit = 2 ** 32 - (2 ** 32 % n)
  for (;;) {
    const b = randomBytes(4)
    const x = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
    if (x < limit) return x % n
  }
}

// ───────────────────────── 通用 ─────────────────────────

export type IdKind = 'v4' | 'v7' | 'ulid' | 'nanoid'

export const ID_KINDS: { id: IdKind; label: string; desc: string }[] = [
  { id: 'v4', label: 'UUID v4', desc: '122 位纯随机，最通用' },
  { id: 'v7', label: 'UUID v7', desc: '毫秒时间戳开头，按时间排序，适合做数据库主键' },
  { id: 'ulid', label: 'ULID', desc: '26 位 Crockford Base32，按时间排序、大小写不敏感' },
  { id: 'nanoid', label: 'NanoID', desc: '长度与字母表可自定义的短 ID，URL 安全' },
]

export const COUNT_MIN = 1
export const COUNT_MAX = 1000

const HEX = '0123456789abcdef'

export function bytesToHex(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += HEX[x >> 4] + HEX[x & 15]
  return s
}

/** 16 字节 → 标准 8-4-4-4-12 小写格式 */
export function bytesToUuid(b: Uint8Array): string {
  const h = bytesToHex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export interface UuidFormat {
  uppercase: boolean
  /** 去掉连字符 */
  noHyphens: boolean
  /** 用 {} 包起来（Windows / .NET GUID 风格） */
  braces: boolean
}

export function formatUuid(uuid: string, fmt: UuidFormat): string {
  let s = fmt.noHyphens ? uuid.replace(/-/g, '') : uuid
  s = fmt.uppercase ? s.toUpperCase() : s.toLowerCase()
  return fmt.braces ? `{${s}}` : s
}

// ───────────────────────── UUID v4 ─────────────────────────

/** 把任意 16 字节打上 v4 版本号与 RFC 变体位 */
export function uuidV4FromBytes(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  return bytesToUuid(b)
}

/** crypto.randomUUID 仅在安全上下文（HTTPS / localhost）可用，否则退回 getRandomValues */
export function uuidV4(randomBytes?: RandomBytes): string {
  if (!randomBytes && typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return uuidV4FromBytes((randomBytes ?? cryptoBytes)(16))
}

// ───────────────────────── UUID v7 ─────────────────────────

export interface GeneratorDeps {
  now?: () => number
  randomBytes?: RandomBytes
}

const TS_MAX = 2 ** 48 - 1
/** v7 的单调计数器：rand_a 的 12 位 + rand_b 高 30 位，共 42 位 */
const V7_COUNTER_MAX = 2 ** 42 - 1

function checkTimestamp(ms: number) {
  if (!Number.isFinite(ms) || ms < 0 || ms > TS_MAX) {
    throw new RangeError(`时间戳超出 48 位范围：${ms}`)
  }
}

function writeTimestamp(b: Uint8Array, ms: number) {
  let t = ms
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256
    t = Math.floor(t / 256)
  }
}

/** 按字段拼出一个 v7 UUID：48 位毫秒 | ver | 42 位计数器 | var | 32 位随机 */
export function buildUuidV7(ms: number, counter: number, tail: Uint8Array): string {
  checkTimestamp(ms)
  const b = new Uint8Array(16)
  writeTimestamp(b, ms)
  const randA = Math.floor(counter / 2 ** 30)
  const low30 = counter % 2 ** 30
  b[6] = 0x70 | ((randA >> 8) & 0x0f)
  b[7] = randA & 0xff
  b[8] = 0x80 | ((low30 >>> 24) & 0x3f)
  b[9] = (low30 >>> 16) & 0xff
  b[10] = (low30 >>> 8) & 0xff
  b[11] = low30 & 0xff
  b.set(tail.subarray(0, 4), 12)
  return bytesToUuid(b)
}

/**
 * UUID v7 生成器（RFC 9562 §6.2 方法 1：专用计数器）。
 * 新的毫秒用 41 位随机数作为计数器起点（最高位留 0 防溢出）；同一毫秒或时钟回拨时计数器 +1，
 * 保证同一生成器产出的 ID 严格递增；计数器耗尽时借用下一毫秒。
 */
export function createUuidV7Generator(deps: GeneratorDeps = {}): () => string {
  const now = deps.now ?? Date.now
  const randomBytes = deps.randomBytes ?? cryptoBytes
  let lastMs = -1
  let counter = 0
  return () => {
    const ms = Math.floor(now())
    const r = randomBytes(10)
    if (ms > lastMs) {
      lastMs = ms
      counter = seedCounter(r)
    } else if (counter < V7_COUNTER_MAX) {
      counter++
    } else {
      lastMs++
      counter = seedCounter(r)
    }
    return buildUuidV7(lastMs, counter, r.subarray(6, 10))
  }
}

/** 取前 6 个随机字节中的 41 位作为计数器起点 */
function seedCounter(r: Uint8Array): number {
  const hi = (r[0] & 0x01) * 2 ** 40 + r[1] * 2 ** 32
  const lo = ((r[2] << 24) | (r[3] << 16) | (r[4] << 8) | r[5]) >>> 0
  return hi + lo
}

// ───────────────────────── ULID ─────────────────────────

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 48 位毫秒时间戳 → 10 位 Crockford Base32 */
export function encodeUlidTime(ms: number): string {
  checkTimestamp(ms)
  let t = ms
  let s = ''
  for (let i = 0; i < 10; i++) {
    s = CROCKFORD[t % 32] + s
    t = Math.floor(t / 32)
  }
  return s
}

/** 10 字节（80 位）→ 16 个 5 位数字 */
function bytesToDigits(b: Uint8Array, count: number): number[] {
  const digits: number[] = []
  let acc = 0
  let bits = 0
  for (const x of b) {
    acc = (acc << 8) | x
    bits += 8
    while (bits >= 5 && digits.length < count) {
      bits -= 5
      digits.push((acc >> bits) & 31)
    }
    acc &= (1 << bits) - 1
  }
  return digits
}

/**
 * ULID 生成器（单调模式）：同一毫秒内把 80 位随机部分当作整数 +1；
 * 随机部分溢出（概率约 2^-80）或时钟回拨时沿用 / 借用上一毫秒，永不抛错。
 */
export function createUlidGenerator(deps: GeneratorDeps = {}): () => string {
  const now = deps.now ?? Date.now
  const randomBytes = deps.randomBytes ?? cryptoBytes
  let lastMs = -1
  let rand: number[] = []
  const fresh = () => bytesToDigits(randomBytes(10), 16)
  return () => {
    const ms = Math.floor(now())
    if (ms > lastMs) {
      lastMs = ms
      rand = fresh()
    } else {
      let i = rand.length - 1
      while (i >= 0 && rand[i] === 31) rand[i--] = 0
      if (i >= 0) rand[i]++
      else {
        lastMs++
        rand = fresh()
      }
    }
    return encodeUlidTime(lastMs) + rand.map((d) => CROCKFORD[d]).join('')
  }
}

/** 16 字节 → 26 位 ULID（128 位高位补 2 个 0 位） */
export function bytesToUlid(b: Uint8Array): string {
  let n = BigInt('0x' + bytesToHex(b))
  let s = ''
  for (let i = 0; i < 26; i++) {
    s = CROCKFORD[Number(n & 31n)] + s
    n >>= 5n
  }
  return s
}

// ───────────────────────── NanoID ─────────────────────────

export const NANOID_ALPHABETS = [
  {
    id: 'url',
    label: 'URL 安全（默认）',
    chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-',
  },
  {
    id: 'alnum',
    label: '字母 + 数字',
    chars: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  },
  { id: 'lower', label: '小写 + 数字', chars: '0123456789abcdefghijklmnopqrstuvwxyz' },
  { id: 'hex', label: '十六进制', chars: '0123456789abcdef' },
  { id: 'digits', label: '纯数字', chars: '0123456789' },
  {
    id: 'nolookalikes',
    label: '无易混淆字符',
    chars: '346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtwxyz',
  },
] as const

export const NANOID_DEFAULT_SIZE = 21
export const NANOID_SIZE_MIN = 2
export const NANOID_SIZE_MAX = 256

export interface Alphabet {
  chars: string[]
  /** 被去掉的重复字符 */
  duplicates: string[]
}

/** 按字素簇拆分并去重（允许 emoji / 中文） */
export function normalizeAlphabet(s: string): Alphabet {
  const parts =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? Array.from(
          new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s),
          (x) => x.segment,
        )
      : Array.from(s)
  const seen = new Set<string>()
  const chars: string[] = []
  const duplicates: string[] = []
  for (const c of parts) {
    if (/^\s+$/u.test(c)) continue
    if (seen.has(c)) {
      if (!duplicates.includes(c)) duplicates.push(c)
    } else {
      seen.add(c)
      chars.push(c)
    }
  }
  return { chars, duplicates }
}

export class IdError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdError'
  }
}

export function nanoid(
  size: number = NANOID_DEFAULT_SIZE,
  alphabet: string = NANOID_ALPHABETS[0].chars,
  randomBytes: RandomBytes = cryptoBytes,
): string {
  const { chars } = normalizeAlphabet(alphabet)
  if (chars.length < 2) throw new IdError('字母表至少需要 2 个不同的字符')
  if (!Number.isInteger(size) || size < NANOID_SIZE_MIN || size > NANOID_SIZE_MAX) {
    throw new IdError(`长度需在 ${NANOID_SIZE_MIN}–${NANOID_SIZE_MAX} 之间`)
  }
  // 字母表是 2 的幂时一次取一个字节掩码即可，否则走拒绝采样
  const n = chars.length
  if (n <= 256 && (n & (n - 1)) === 0) {
    const bytes = randomBytes(size)
    let s = ''
    for (let i = 0; i < size; i++) s += chars[bytes[i] & (n - 1)]
    return s
  }
  let s = ''
  for (let i = 0; i < size; i++) s += chars[randomIndex(n, randomBytes)]
  return s
}

// ───────────────────────── 批量生成 ─────────────────────────

export interface GenerateOptions {
  kind: IdKind
  count: number
  uuid: UuidFormat
  /** ULID 输出小写 */
  ulidLowercase: boolean
  nanoidSize: number
  nanoidAlphabet: string
}

const sharedV7 = createUuidV7Generator()
const sharedUlid = createUlidGenerator()

export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return COUNT_MIN
  return Math.min(COUNT_MAX, Math.max(COUNT_MIN, Math.round(n)))
}

/** 批量生成（v7 / ULID 共用模块级生成器，跨批次也保持单调） */
export function generateIds(o: GenerateOptions): string[] {
  const count = clampCount(o.count)
  const out: string[] = new Array(count)
  for (let i = 0; i < count; i++) {
    switch (o.kind) {
      case 'v4':
        out[i] = formatUuid(uuidV4(), o.uuid)
        break
      case 'v7':
        out[i] = formatUuid(sharedV7(), o.uuid)
        break
      case 'ulid': {
        const id = sharedUlid()
        out[i] = o.ulidLowercase ? id.toLowerCase() : id
        break
      }
      case 'nanoid':
        out[i] = nanoid(o.nanoidSize, o.nanoidAlphabet)
        break
    }
  }
  return out
}

/** 各类型每个 ID 的随机位数 */
export function randomBits(
  o: Pick<GenerateOptions, 'kind' | 'nanoidSize' | 'nanoidAlphabet'>,
): number {
  switch (o.kind) {
    case 'v4':
      return 122
    case 'v7':
      return 74
    case 'ulid':
      return 80
    case 'nanoid': {
      const n = normalizeAlphabet(o.nanoidAlphabet).chars.length
      return n < 2 ? 0 : o.nanoidSize * Math.log2(n)
    }
  }
}

/**
 * 生日问题：随机位数为 bits 时，生成多少个 ID 后出现重复的概率达到 p。
 * 返回 log10(个数)，避免大数溢出。n ≈ sqrt(2 · 2^bits · ln(1/(1-p)))
 */
export function collisionLog10(bits: number, p = 0.01): number {
  const log2n = (bits + 1 + Math.log2(-Math.log1p(-p))) / 2
  return log2n * Math.log10(2)
}

/** 用中文数量级格式化 10^x：万 / 亿 / 万亿，再大用科学计数法 */
export function formatLog10Count(log10: number): string {
  if (log10 < 4) return Math.round(10 ** log10).toLocaleString('en-US')
  if (log10 < 8) return `${trim(10 ** (log10 - 4))} 万`
  if (log10 < 12) return `${trim(10 ** (log10 - 8))} 亿`
  if (log10 < 16) return `${trim(10 ** (log10 - 12))} 万亿`
  const exp = Math.floor(log10)
  const sup = String(exp)
    .split('')
    .map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)])
    .join('')
  return `${(10 ** (log10 - exp)).toFixed(1)}×10${sup}`
}

function trim(v: number): string {
  return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
}

// ───────────────────────── 解析 ─────────────────────────

export interface IdTimestamp {
  /** Unix 毫秒 */
  ms: number
  iso: string
  /** v1 / v6 的 100 纳秒精度 ISO 字符串（小数 7 位） */
  isoPrecise?: string
  precision: 'ms' | '100ns'
}

export interface ParsedId {
  kind: 'uuid' | 'ulid'
  /** UUID：小写 8-4-4-4-12；ULID：大写 26 位 */
  canonical: string
  bytes: Uint8Array
  hex: string
  /** 128 位无符号整数（十进制） */
  decimal: string
  version?: number
  versionName?: string
  variant?: string
  /** 全 0 / 全 1 的特殊 UUID */
  special?: 'nil' | 'max'
  timestamp?: IdTimestamp
  /** v1 / v6：14 位时钟序列 */
  clockSeq?: number
  /** v1 / v6：48 位节点（通常是 MAC 地址） */
  node?: string
  /** 节点的组播位为 1：说明是随机生成的节点而非真实 MAC */
  nodeIsRandom?: boolean
  /** 同一 128 位值的另一种写法 */
  asUlid?: string
  asUuid?: string
}

export const UUID_VERSION_NAMES: Record<number, string> = {
  1: '基于时间 + 节点（MAC）',
  2: 'DCE 安全',
  3: '基于名称（MD5）',
  4: '随机',
  5: '基于名称（SHA-1）',
  6: '重排序时间戳（可排序的 v1）',
  7: 'Unix 毫秒时间戳 + 随机',
  8: '自定义（厂商实现）',
}

/** 1582-10-15（公历起点）到 1970-01-01 的 100 纳秒间隔数 */
const GREGORIAN_OFFSET = 0x01b21dd213814000n

function variantName(b8: number): string {
  if ((b8 & 0x80) === 0) return 'NCS（已废弃的向后兼容保留）'
  if ((b8 & 0xc0) === 0x80) return 'RFC 9562 / 4122（标准）'
  if ((b8 & 0xe0) === 0xc0) return '微软 GUID（向后兼容保留）'
  return '保留（未来定义）'
}

function readUint(b: Uint8Array, from: number, to: number): bigint {
  let n = 0n
  for (let i = from; i < to; i++) n = (n << 8n) | BigInt(b[i])
  return n
}

function gregorianToTimestamp(ticks: bigint): IdTimestamp {
  const unix100ns = ticks - GREGORIAN_OFFSET
  // 向下取整（1970 年之前的时间为负数）
  let ms = unix100ns / 10000n
  let rem = unix100ns % 10000n
  if (rem < 0n) {
    ms -= 1n
    rem += 10000n
  }
  const date = new Date(Number(ms))
  const iso = date.toISOString()
  const isoPrecise = iso.replace(
    /\.(\d{3})Z$/,
    (_, d: string) => `.${d}${String(rem).padStart(4, '0')}Z`,
  )
  return { ms: Number(ms), iso, isoPrecise, precision: '100ns' }
}

function msTimestamp(ms: number): IdTimestamp {
  return { ms, iso: new Date(ms).toISOString(), precision: 'ms' }
}

export function parseId(raw: string): ParsedId {
  let s = raw.trim()
  if (!s) throw new IdError('请输入 UUID 或 ULID')
  // 从 JSON / 代码里复制时常带着引号
  const quoted = /^(["'`])(.*)\1$/s.exec(s)
  if (quoted) s = quoted[2].trim()
  s = s.replace(/^urn:uuid:/i, '')
  if (s.startsWith('{') || s.endsWith('}')) {
    if (!(s.startsWith('{') && s.endsWith('}'))) throw new IdError('花括号不成对')
    s = s.slice(1, -1).trim()
  }
  if (s.length === 26 && !s.includes('-')) return parseUlid(s)
  if (s.length === 36 || s.length === 32 || s.includes('-')) return parseUuid(s)
  throw new IdError(
    `长度为 ${Array.from(s).length} 个字符，无法识别：UUID 应为 36 位（8-4-4-4-12）或去掉连字符的 32 位十六进制，ULID 应为 26 位`,
  )
}

function parseUuid(s: string): ParsedId {
  let hex: string
  if (s.length === 36) {
    for (const i of [8, 13, 18, 23]) {
      if (s[i] !== '-') {
        throw new IdError(`第 ${i + 1} 个字符应为连字符「-」，UUID 格式为 8-4-4-4-12`)
      }
    }
    hex = s.replace(/-/g, '')
  } else if (s.length === 32) {
    hex = s
  } else {
    const groups = s.split('-').map((g) => g.length)
    throw new IdError(`连字符分组为 ${groups.join('-')}，UUID 应为 8-4-4-4-12（共 36 个字符）`)
  }
  for (let i = 0; i < hex.length; i++) {
    if (!/[0-9a-f]/i.test(hex[i])) {
      const pos = s.length === 36 ? originalIndex(i) : i
      throw new IdError(`第 ${pos + 1} 个字符「${hex[i]}」不是十六进制数字（0-9、a-f）`)
    }
  }
  hex = hex.toLowerCase()
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)

  const out: ParsedId = {
    kind: 'uuid',
    canonical: bytesToUuid(bytes),
    bytes,
    hex,
    decimal: BigInt('0x' + hex).toString(10),
    asUlid: bytesToUlid(bytes),
  }
  if (/^0+$/.test(hex)) return { ...out, special: 'nil', versionName: 'Nil UUID（全 0）' }
  if (/^f+$/.test(hex)) return { ...out, special: 'max', versionName: 'Max UUID（全 1）' }

  const version = bytes[6] >> 4
  out.variant = variantName(bytes[8])
  const rfc = (bytes[8] & 0xc0) === 0x80
  out.version = version
  out.versionName = rfc
    ? (UUID_VERSION_NAMES[version] ?? '未定义的版本')
    : '非 RFC 变体，版本号无意义'
  if (!rfc) return out

  if (version === 1 || version === 6) {
    const ticks =
      version === 1
        ? ((readUint(bytes, 6, 8) & 0x0fffn) << 48n) |
          (readUint(bytes, 4, 6) << 32n) |
          readUint(bytes, 0, 4)
        : (readUint(bytes, 0, 4) << 28n) |
          (readUint(bytes, 4, 6) << 12n) |
          (readUint(bytes, 6, 8) & 0x0fffn)
    out.timestamp = gregorianToTimestamp(ticks)
    out.clockSeq = ((bytes[8] & 0x3f) << 8) | bytes[9]
    out.node = Array.from(bytes.subarray(10), (x) => HEX[x >> 4] + HEX[x & 15]).join(':')
    out.nodeIsRandom = (bytes[10] & 0x01) === 1
  } else if (version === 7) {
    out.timestamp = msTimestamp(Number(readUint(bytes, 0, 6)))
  }
  return out
}

/** 去掉连字符后的下标 → 原 36 位字符串中的下标 */
function originalIndex(i: number): number {
  return i + (i >= 8 ? 1 : 0) + (i >= 12 ? 1 : 0) + (i >= 16 ? 1 : 0) + (i >= 20 ? 1 : 0)
}

function parseUlid(s: string): ParsedId {
  const up = s.toUpperCase()
  let n = 0n
  let canonical = ''
  for (let i = 0; i < up.length; i++) {
    // Crockford 解码规则：I / L 视为 1，O 视为 0
    const c = up[i] === 'I' || up[i] === 'L' ? '1' : up[i] === 'O' ? '0' : up[i]
    const v = CROCKFORD.indexOf(c)
    if (v < 0) {
      throw new IdError(
        `第 ${i + 1} 个字符「${s[i]}」不是 Crockford Base32 字符（ULID 不使用 U，且只含数字与大写字母）`,
      )
    }
    canonical += c
    n = (n << 5n) | BigInt(v)
  }
  if (CROCKFORD.indexOf(canonical[0]) > 7) {
    throw new IdError(`首字符「${s[0]}」超出范围：ULID 首位最大为 7（否则超过 128 位）`)
  }
  const hex = n.toString(16).padStart(32, '0')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  const ms = Number(n >> 80n)
  return {
    kind: 'ulid',
    canonical,
    bytes,
    hex,
    decimal: n.toString(10),
    timestamp: msTimestamp(ms),
    asUuid: bytesToUuid(bytes),
  }
}

/** 只解出 ULID 的毫秒时间戳 */
export function decodeUlidTime(ulid: string): number {
  return parseUlid(ulid.trim()).timestamp!.ms
}
