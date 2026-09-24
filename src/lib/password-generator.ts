/**
 * 密码 / 助记口令生成（纯函数，无 DOM 依赖）。
 * 随机数来自 crypto.getRandomValues，取整用拒绝采样消除取模偏差；强度按信息熵估算。
 */
import { PASSPHRASE_WORDS } from './password-generator-words'

// ───────────────────────── 随机数 ─────────────────────────

/** 用随机 32 位整数填满数组（默认 crypto.getRandomValues），测试时可注入确定性来源 */
export type RandomSource = (buf: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer>

const cryptoSource: RandomSource = (buf) => globalThis.crypto.getRandomValues(buf)

export interface Rng {
  /** 均匀分布的 [0, n) 整数，n ≤ 2^32 */
  int(n: number): number
}

const TWO_32 = 2 ** 32

/**
 * 带缓冲的均匀随机整数生成器。
 * 拒绝采样：只接受落在 n 的整数倍范围 [0, limit) 内的 32 位值，再取模，
 * 这样每个结果的概率严格相等（直接 x % n 会让较小的数略多出现）。
 */
export function createRng(source: RandomSource = cryptoSource): Rng {
  const pool = new Uint32Array(64)
  let pos = pool.length
  const next = () => {
    if (pos >= pool.length) {
      source(pool)
      pos = 0
    }
    return pool[pos++]
  }
  return {
    int(n) {
      if (!Number.isInteger(n) || n < 1 || n > TWO_32) {
        throw new RangeError(`随机范围必须是 1 到 2^32 之间的整数，收到 ${n}`)
      }
      if (n === 1) return 0
      const limit = TWO_32 - (TWO_32 % n)
      for (;;) {
        const x = next()
        if (x < limit) return x % n
      }
    },
  }
}

/** Fisher–Yates 原地洗牌 */
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ───────────────────────── 字符集 ─────────────────────────

export type CharClass = 'upper' | 'lower' | 'digit' | 'symbol'

export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const LOWER = 'abcdefghijklmnopqrstuvwxyz'
export const DIGITS = '0123456789'
export const DEFAULT_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>/?~'
/** 容易看错的字符：大写 I、小写 l、数字 1、大写 O、数字 0、小写 o */
export const LOOK_ALIKES = 'Il1O0o'

export const LENGTH_MIN = 4
export const LENGTH_MAX = 128
export const BATCH_MAX = 50

export const CHAR_CLASS_LABELS: Record<CharClass, string> = {
  upper: '大写',
  lower: '小写',
  digit: '数字',
  symbol: '符号',
}

export interface PasswordOptions {
  length: number
  upper: boolean
  lower: boolean
  digits: boolean
  symbols: boolean
  /** 排除 Il1O0o 这类易混淆字符 */
  excludeLookAlikes: boolean
  /** 自定义符号集 */
  symbolSet: string
  /** 每种选中的字符类至少出现一次 */
  requireEach: boolean
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeLookAlikes: false,
  symbolSet: DEFAULT_SYMBOLS,
  requireEach: true,
}

export interface CharPool {
  /** 选中且非空的字符类（彼此不相交） */
  classes: { id: CharClass; chars: string[] }[]
  /** 所有可用字符 */
  all: string[]
  /** 自定义符号里被忽略的字母 / 数字（它们属于其它类；空白和重复字符会被静默跳过） */
  ignoredSymbols: string[]
  /** 开启了但因排除 / 为空而没有可用字符的类 */
  emptyClasses: CharClass[]
}

/** 字符属于哪一类（按 ASCII 字母数字判断，其余一律算符号） */
export function classifyChar(ch: string): CharClass {
  if (ch >= 'A' && ch <= 'Z' && ch.length === 1) return 'upper'
  if (ch >= 'a' && ch <= 'z' && ch.length === 1) return 'lower'
  if (ch >= '0' && ch <= '9' && ch.length === 1) return 'digit'
  return 'symbol'
}

/** 按用户感知的「字符」（字素簇）拆分，带肤色 / ZWJ 的 emoji 不会被拆开 */
export function graphemes(s: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(seg.segment(s), (x) => x.segment)
  }
  return Array.from(s)
}

/** 根据选项组装字符池；自定义符号按码点去重，忽略空白和字母数字，保证各类互不重叠 */
export function buildPool(opts: PasswordOptions): CharPool {
  const exclude = opts.excludeLookAlikes ? new Set(LOOK_ALIKES) : new Set<string>()
  const pick = (s: string) => Array.from(s).filter((c) => !exclude.has(c))
  const classes: CharPool['classes'] = []
  const emptyClasses: CharClass[] = []
  const ignoredSymbols: string[] = []

  const add = (id: CharClass, on: boolean, chars: string[]) => {
    if (!on) return
    if (chars.length) classes.push({ id, chars })
    else emptyClasses.push(id)
  }
  add('upper', opts.upper, pick(UPPER))
  add('lower', opts.lower, pick(LOWER))
  add('digit', opts.digits, pick(DIGITS))

  if (opts.symbols) {
    const seen = new Set<string>()
    const syms: string[] = []
    for (const c of graphemes(opts.symbolSet)) {
      if (/^\s+$/u.test(c) || seen.has(c)) continue
      seen.add(c)
      if (classifyChar(c) !== 'symbol') ignoredSymbols.push(c)
      else if (!exclude.has(c)) syms.push(c)
    }
    add('symbol', true, syms)
  }

  return { classes, all: classes.flatMap((c) => c.chars), ignoredSymbols, emptyClasses }
}

export class PasswordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasswordError'
  }
}

export function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}

function drawFrom(chars: string[], length: number, rng: Rng): string[] {
  const out: string[] = new Array(length)
  for (let i = 0; i < length; i++) out[i] = chars[rng.int(chars.length)]
  return out
}

/**
 * 生成一个随机密码。
 * 「每类至少一个」用整体重抽实现（抽到不满足条件的就整串重来），
 * 结果在所有合规密码中均匀分布；极端情况下 1000 次仍不满足才退回「先各放一个再洗牌」。
 */
export function generatePassword(opts: PasswordOptions, rng: Rng = createRng()): string {
  const pool = buildPool(opts)
  if (pool.all.length === 0) throw new PasswordError('请至少选择一种字符类型')
  const length = clampInt(opts.length, LENGTH_MIN, LENGTH_MAX)
  const need = opts.requireEach && pool.classes.length > 1 && length >= pool.classes.length
  if (!need) return drawFrom(pool.all, length, rng).join('')

  const sets = pool.classes.map((c) => new Set(c.chars))
  for (let attempt = 0; attempt < 1000; attempt++) {
    const chars = drawFrom(pool.all, length, rng)
    if (sets.every((s) => chars.some((c) => s.has(c)))) return chars.join('')
  }
  const chars = [
    ...pool.classes.map((c) => c.chars[rng.int(c.chars.length)]),
    ...drawFrom(pool.all, length - pool.classes.length, rng),
  ]
  return shuffle(chars, rng).join('')
}

// ───────────────────────── 熵与强度 ─────────────────────────

/** 任意大整数的 log2（保留约 15 位有效数字） */
export function log2BigInt(x: bigint): number {
  if (x <= 0n) return -Infinity
  const bits = x.toString(2).length
  if (bits <= 53) return Math.log2(Number(x))
  const shift = bits - 53
  return Math.log2(Number(x >> BigInt(shift))) + shift
}

/**
 * 随机密码的熵（位）：log2(可能的密码总数)。
 * 不要求每类出现时为 L·log2(N)；要求时用容斥原理精确扣除「缺某一类」的组合。
 */
export function passwordEntropy(opts: PasswordOptions): number {
  const pool = buildPool(opts)
  const n = pool.all.length
  if (n === 0) return 0
  const length = clampInt(opts.length, LENGTH_MIN, LENGTH_MAX)
  const k = pool.classes.length
  if (!opts.requireEach || k <= 1 || length < k) return length * Math.log2(n)

  const sizes = pool.classes.map((c) => c.chars.length)
  let total = 0n
  for (let mask = 0; mask < 1 << k; mask++) {
    let removed = 0
    let bits = 0
    for (let i = 0; i < k; i++) {
      if (mask & (1 << i)) {
        removed += sizes[i]
        bits++
      }
    }
    const term = BigInt(n - removed) ** BigInt(length)
    total += bits % 2 ? -term : term
  }
  return log2BigInt(total)
}

export interface PassphraseOptions {
  /** 单词个数 */
  words: number
  separator: string
  /** 每个单词首字母大写 */
  capitalize: boolean
  /** 末尾追加一个 0–99 的随机数 */
  appendNumber: boolean
}

export const PASSPHRASE_WORDS_MIN = 3
export const PASSPHRASE_WORDS_MAX = 12
export const PASSPHRASE_NUMBER_RANGE = 100

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  words: 5,
  separator: '-',
  capitalize: true,
  appendNumber: true,
}

export function generatePassphrase(
  opts: PassphraseOptions,
  rng: Rng = createRng(),
  list: readonly string[] = PASSPHRASE_WORDS,
): string {
  if (list.length === 0) throw new PasswordError('单词表为空')
  const count = clampInt(opts.words, PASSPHRASE_WORDS_MIN, PASSPHRASE_WORDS_MAX)
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    const w = list[rng.int(list.length)]
    parts.push(opts.capitalize ? w.charAt(0).toUpperCase() + w.slice(1) : w)
  }
  if (opts.appendNumber) parts.push(String(rng.int(PASSPHRASE_NUMBER_RANGE)))
  return parts.join(opts.separator)
}

/** 口令熵：单词数 × log2(词表大小)，追加数字再加 log2(100)；大小写与分隔符是固定的，不增加熵 */
export function passphraseEntropy(
  opts: PassphraseOptions,
  listSize: number = PASSPHRASE_WORDS.length,
): number {
  if (listSize <= 0) return 0
  const count = clampInt(opts.words, PASSPHRASE_WORDS_MIN, PASSPHRASE_WORDS_MAX)
  return count * Math.log2(listSize) + (opts.appendNumber ? Math.log2(PASSPHRASE_NUMBER_RANGE) : 0)
}

export type StrengthLevel = 0 | 1 | 2 | 3

export interface Strength {
  level: StrengthLevel
  label: '弱' | '一般' | '强' | '极强'
  /** 强度条填充比例 0–1（128 位封顶） */
  ratio: number
}

/** 强度分级的熵阈值（位）：< 50 弱，< 72 一般，< 100 强，其余极强 */
export const STRENGTH_THRESHOLDS = [50, 72, 100] as const

export function strengthOf(bits: number): Strength {
  const labels = ['弱', '一般', '强', '极强'] as const
  let level = 0
  while (level < STRENGTH_THRESHOLDS.length && bits >= STRENGTH_THRESHOLDS[level]) level++
  const ratio = Math.max(0.04, Math.min(1, bits / 128))
  return { level: level as StrengthLevel, label: labels[level], ratio }
}

/** 离线暴力破解的假设速度：每秒 100 亿次猜测 */
export const GUESSES_PER_SECOND = 1e10

const MINUTE = 60
const HOUR = 3600
const DAY = 86400
const YEAR = 365.2425 * DAY
const CENTURY = 100 * YEAR
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'

function num(v: number): string {
  if (v < 10) return String(Math.round(v * 10) / 10)
  return Math.round(v).toLocaleString('en-US')
}

function superscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => (d === '-' ? '⁻' : SUPERSCRIPT[Number(d)]))
    .join('')
}

/**
 * 估算平均破解时间（需要遍历一半密码空间）并格式化成中文单位。
 * 全程在对数空间计算，熵上千位也不会溢出。
 */
export function formatCrackTime(bits: number, guessesPerSecond = GUESSES_PER_SECOND): string {
  if (!(bits > 0)) return '瞬间'
  const log10s = (bits - 1) * Math.LOG10E * Math.LN2 - Math.log10(guessesPerSecond)
  if (log10s < 0) return '不到 1 秒'
  const s = 10 ** Math.min(log10s, 12)
  if (s < MINUTE) return `${num(s)} 秒`
  if (s < HOUR) return `${num(s / MINUTE)} 分钟`
  if (s < DAY) return `${num(s / HOUR)} 小时`
  if (s < YEAR) return `${num(s / DAY)} 天`
  const log10y = log10s - Math.log10(YEAR)
  if (log10y < 2) return `${num(10 ** log10y)} 年`
  const log10c = log10s - Math.log10(CENTURY)
  if (log10c < 4) return `${num(10 ** log10c)} 世纪`
  if (log10c < 8) return `${num(10 ** (log10c - 4))} 万世纪`
  if (log10c < 12) return `${num(10 ** (log10c - 8))} 亿世纪`
  const exp = Math.floor(log10c)
  const mant = 10 ** (log10c - exp)
  return `${mant.toFixed(1)}×10${superscript(exp)} 世纪`
}
