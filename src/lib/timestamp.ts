/**
 * 时间戳 ⇄ 日期时间（纯函数，无 DOM 依赖）。
 * 时区换算只依赖 Intl.DateTimeFormat#formatToParts，不引入额外库。
 */

export type TsUnit = 's' | 'ms' | 'us' | 'ns'

export const UNIT_LABEL: Record<TsUnit, string> = {
  s: '秒',
  ms: '毫秒',
  us: '微秒',
  ns: '纳秒',
}

/** 每个单位对应的纳秒数 */
const UNIT_NS: Record<TsUnit, bigint> = { s: 1_000_000_000n, ms: 1_000_000n, us: 1_000n, ns: 1n }
/** 单位的小数位（精确到纳秒） */
const UNIT_FRACTION_DIGITS: Record<TsUnit, number> = { s: 9, ms: 6, us: 3, ns: 0 }

/** JavaScript Date 能表示的最大毫秒数（±1 亿天） */
export const MAX_EPOCH_MS = 8.64e15

/** 一个精确到纳秒的时刻：epochMs 为向下取整的毫秒，subMsNs ∈ [0, 999999] */
export interface Instant {
  epochMs: number
  subMsNs: number
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = <T = never>(error: string): Result<T> => ({ ok: false, error })

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q
}

const mod = (a: number, b: number) => ((a % b) + b) % b

export function instantFromNs(totalNs: bigint): Instant {
  const ms = floorDiv(totalNs, 1_000_000n)
  return { epochMs: Number(ms), subMsNs: Number(totalNs - ms * 1_000_000n) }
}

export function instantToNs(i: Instant): bigint {
  return BigInt(i.epochMs) * 1_000_000n + BigInt(i.subMsNs)
}

export const instantFromMs = (ms: number): Instant => {
  const whole = Math.floor(ms)
  return { epochMs: whole, subMsNs: Math.round((ms - whole) * 1e6) % 1_000_000 }
}

const RANGE_ERROR =
  '超出可表示的范围：日期只支持 ±8.64×10¹⁵ 毫秒（约公元前 27 万年至公元 27.5 万年）'

function checkRange(i: Instant): Result<Instant> {
  if (!Number.isFinite(i.epochMs) || Math.abs(i.epochMs) > MAX_EPOCH_MS) return fail(RANGE_ERROR)
  return ok(i)
}

/** 按数量级猜测单位：< 10¹¹ 秒、< 10¹⁴ 毫秒、< 10¹⁷ 微秒，其余纳秒 */
export function detectUnit(intPart: bigint): TsUnit {
  const abs = intPart < 0n ? -intPart : intPart
  if (abs < 100_000_000_000n) return 's'
  if (abs < 100_000_000_000_000n) return 'ms'
  if (abs < 100_000_000_000_000_000n) return 'us'
  return 'ns'
}

export interface ParsedTimestamp {
  instant: Instant
  unit: TsUnit
  /** 单位是否由数量级自动识别 */
  detected: boolean
}

/** 把科学计数法 1.7e9 展开成普通小数字符串 */
function expandExponent(mantissa: string, exp: number): string {
  const [i = '', f = ''] = mantissa.split('.')
  let digits = i + f
  let point = i.length + exp
  if (point < 0) {
    digits = '0'.repeat(-point) + digits
    point = 0
  }
  if (point > digits.length) digits += '0'.repeat(point - digits.length)
  const int = digits.slice(0, point) || '0'
  const frac = digits.slice(point)
  return frac ? `${int}.${frac}` : int
}

const TS_ALLOWED = /[0-9+\-.eE\s_,']/

/** 全角 ASCII（中文输入法常见的１２３、：、－）与全角空格转成半角 */
export function toHalfWidth(s: string): string {
  return s.replace(/[\uff01-\uff5e\u3000]/g, (c) =>
    c === '\u3000' ? ' ' : String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  )
}

/**
 * 解析时间戳字符串。允许负数、小数、下划线/逗号/空格分隔以及科学计数法。
 * unit 为 'auto' 时按整数部分的数量级识别单位。
 */
export function parseTimestamp(
  raw: string,
  unit: TsUnit | 'auto' = 'auto',
): Result<ParsedTimestamp> {
  raw = toHalfWidth(raw)
  const trimmed = raw.trim()
  if (!trimmed) return fail('请输入时间戳')
  // 按码点遍历，emoji 等代理对算一个字符
  let pos = 0
  for (const ch of raw) {
    pos++
    if (!TS_ALLOWED.test(ch)) {
      return fail(`第 ${pos} 个字符「${ch}」不是数字：时间戳只能包含数字、负号和小数点`)
    }
  }
  // 未知单位（例如旧版本存下的选项）按自动识别处理，不要在 BigInt 运算里抛错
  const explicit: TsUnit | null = unit !== 'auto' && unit in UNIT_NS ? unit : null
  let s = trimmed.replace(/[\s_,']/g, '')
  const sci = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)[eE]([+-]?\d{1,3})$/.exec(s)
  if (sci) s = sci[1] + expandExponent(sci[2], Number(sci[3]))
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s)
  if (!m || (!m[2] && !m[3])) {
    if ((s.match(/\./g) ?? []).length > 1) return fail('格式不正确：只能有一个小数点')
    if (/.[+-]/.test(s)) return fail('格式不正确：正负号只能出现在开头')
    return fail('格式不正确：请输入整数或小数形式的时间戳')
  }
  const neg = m[1] === '-'
  const intPart = BigInt(m[2] || '0')
  const detected = explicit === null
  const u: TsUnit = explicit ?? detectUnit(intPart)
  const fracDigits = UNIT_FRACTION_DIGITS[u]
  const frac = (m[3] ?? '').slice(0, fracDigits).padEnd(fracDigits, '0')
  let total = intPart * UNIT_NS[u] + (fracDigits ? BigInt(frac) : 0n)
  if (neg) total = -total
  // 超大数字先粗略判断，避免构造出巨大的 Number
  if (total > 10n ** 25n || total < -(10n ** 25n)) return fail(RANGE_ERROR)
  const range = checkRange(instantFromNs(total))
  if (!range.ok) return range
  return ok({ instant: range.value, unit: u, detected })
}

// ─────────────────────────── 时区 ───────────────────────────

const dtfCache = new Map<string, Intl.DateTimeFormat>()

function getDtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      era: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    dtfCache.set(tz, f)
  }
  return f
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false
  try {
    getDtf(tz)
    return true
  } catch {
    return false
  }
}

/** 某时区下的墙上时间 */
export interface WallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
}

export interface ZonedParts extends WallTime {
  /** 0 = 星期日 */
  weekday: number
  /** 与 UTC 的偏移（秒），东八区为 +28800 */
  offsetSeconds: number
}

const DAY_MS = 86_400_000

/**
 * 公历日期 → 距 1970-01-01 的天数（纯整数运算，不受 Date ±8.64e15 范围限制）。
 * 算法见 Howard Hinnant《chrono-Compatible Low-Level Date Algorithms》。
 */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const mp = (month + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** daysFromCivil 的逆运算 */
export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  )
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day }
}

/** 0 = 星期日（1970-01-01 是星期四） */
const weekdayOfDays = (days: number) => mod(days + 4, 7)

/** 把墙上时间当作 UTC 算出毫秒数（支持 0–99 年及公元前，超出 Date 范围也不会变成 NaN） */
export function wallToUtcMs(w: WallTime): number {
  return (
    daysFromCivil(w.year, w.month, w.day) * DAY_MS +
    w.hour * 3_600_000 +
    w.minute * 60_000 +
    w.second * 1000 +
    w.millisecond
  )
}

/** Intl 只接受 Date 范围内的时刻；越界的探测点夹到边界上（那里的偏移是固定的地方平时） */
const clampEpoch = (ms: number) =>
  Number.isFinite(ms) ? Math.max(-MAX_EPOCH_MS, Math.min(MAX_EPOCH_MS, ms)) : 0

export function zonedParts(epochMs: number, tz: string): ZonedParts {
  const probe = clampEpoch(epochMs)
  const parts = getDtf(tz).formatToParts(new Date(probe))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const era = parts.find((p) => p.type === 'era')?.value ?? ''
  let year = get('year')
  if (/^B/i.test(era)) year = 1 - year
  const probeWall: WallTime = {
    year,
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
    millisecond: mod(probe, 1000),
  }
  const offsetMs = wallToUtcMs(probeWall) - probe
  // 范围内 probe === epochMs，结果与 Intl 完全一致；越界时沿用边界处的偏移推算墙上时间
  const local = epochMs + offsetMs
  const days = Math.floor(local / DAY_MS)
  const rest = local - days * DAY_MS
  return {
    ...civilFromDays(days),
    hour: Math.floor(rest / 3_600_000),
    minute: Math.floor((rest % 3_600_000) / 60_000),
    second: Math.floor((rest % 60_000) / 1000),
    millisecond: rest % 1000,
    weekday: weekdayOfDays(days),
    offsetSeconds: Math.round(offsetMs / 1000),
  }
}

export function offsetSecondsAt(epochMs: number, tz: string): number {
  return zonedParts(epochMs, tz).offsetSeconds
}

export type Disambiguation = 'exact' | 'gap' | 'overlap'

/**
 * 某时区的墙上时间 → 时间戳。与 Temporal 的 "compatible" 策略一致：
 * 夏令时跳过的时刻顺延（gap），重复的时刻取较早的一次（overlap）。
 */
export function zonedToEpoch(w: WallTime, tz: string): { epochMs: number; kind: Disambiguation } {
  const wall = wallToUtcMs(w)
  const DAY = 86_400_000
  const before = offsetSecondsAt(wall - DAY, tz) * 1000
  const after = offsetSecondsAt(wall + DAY, tz) * 1000
  const candidates = [...new Set([wall - before, wall - after])].filter(
    (c) => offsetSecondsAt(c, tz) * 1000 === wall - c,
  )
  if (candidates.length === 2) return { epochMs: Math.min(...candidates), kind: 'overlap' }
  if (candidates.length === 1) return { epochMs: candidates[0], kind: 'exact' }
  return { epochMs: wall - before, kind: 'gap' }
}

// ─────────────────────────── 格式化 ───────────────────────────

export const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0')

function formatYear(y: number): string {
  return y < 0 ? `-${pad(-y, 4)}` : pad(y, 4)
}

function isoYear(y: number): string {
  if (y >= 0 && y <= 9999) return pad(y, 4)
  return `${y < 0 ? '-' : '+'}${pad(Math.abs(y), 6)}`
}

/** +08:00；带秒的历史偏移（地方平时）输出 +08:05:43 */
export function formatOffset(seconds: number, sep = ':'): string {
  const sign = seconds < 0 ? '-' : '+'
  const abs = Math.abs(seconds)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60
  return `${sign}${pad(h)}${sep}${pad(m)}${s ? `${sep}${pad(s)}` : ''}`
}

/** 0–9 位小数，去掉末尾多余的 0（按 3 位一组保留） */
function fraction(ms: number, subMsNs: number): string {
  if (!subMsNs) return ms ? `.${pad(ms, 3)}` : ''
  const ns = pad(ms, 3) + pad(subMsNs, 6)
  return `.${subMsNs % 1000 === 0 ? ns.slice(0, 6) : ns}`
}

export function formatDateTime(p: WallTime, subMsNs = 0, withFraction = true): string {
  const base = `${formatYear(p.year)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
  return withFraction ? base + fraction(p.millisecond, subMsNs) : base
}

export function formatISO(instant: Instant, tz: string): string {
  const p = zonedParts(instant.epochMs, tz)
  return (
    `${isoYear(p.year)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    fraction(p.millisecond, instant.subMsNs) +
    formatOffset(p.offsetSeconds)
  )
}

/** 与 Date#toISOString 一致：UTC、固定 3 位毫秒、Z 结尾 */
export function formatISOUtc(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const EN_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** RFC 2822：Mon, 01 Jan 2024 08:00:00 +0800 */
export function formatRFC2822(epochMs: number, tz: string): string {
  const p = zonedParts(epochMs, tz)
  return `${EN_WEEKDAYS[p.weekday]}, ${pad(p.day)} ${EN_MONTHS[p.month - 1]} ${formatYear(p.year)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} ${formatOffset(Math.round(p.offsetSeconds / 60) * 60, '')}`
}

/** HTTP 日期（RFC 7231 IMF-fixdate）：Mon, 01 Jan 2024 00:00:00 GMT */
export function formatHttpDate(epochMs: number): string {
  return formatRFC2822(epochMs, 'UTC').replace(/ \+0000$/, ' GMT')
}

export const WEEKDAY_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
export const WEEKDAY_SHORT_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function formatChinese(p: WallTime & { weekday: number }): string {
  const y = p.year > 0 ? `${p.year}年` : `公元前${1 - p.year}年`
  return `${y}${p.month}月${p.day}日 ${WEEKDAY_ZH[p.weekday]} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
}

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

export function dayOfYear(y: number, m: number, d: number): number {
  let n = d
  for (let i = 1; i < m; i++) n += daysInMonth(y, i)
  return n
}

/** ISO 8601 周：周一为一周开始，含 1 月 4 日的那周是第 1 周 */
export function isoWeek(y: number, m: number, d: number): { year: number; week: number } {
  const days = daysFromCivil(y, m, d)
  const dow = (weekdayOfDays(days) + 6) % 7
  const thursday = days + 3 - dow
  const ty = civilFromDays(thursday).year
  return { year: ty, week: 1 + Math.floor((thursday - daysFromCivil(ty, 1, 1)) / 7) }
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
]

let rtf: Intl.RelativeTimeFormat | undefined

/** 相对时间：3 小时前 / 2 天后 / 现在 */
export function formatRelative(targetMs: number, nowMs: number): string {
  rtf ??= new Intl.RelativeTimeFormat('zh-CN', { numeric: 'always' })
  const diff = (targetMs - nowMs) / 1000
  const abs = Math.abs(diff)
  if (abs < 1) return '现在'
  for (const [unit, sec] of RELATIVE_UNITS) {
    if (abs >= sec) return rtf.format(Math.trunc(diff / sec), unit)
  }
  return '现在'
}

/** 时长：95 天 3 小时 12 分 5 秒（最多保留 3 个单位） */
export function formatDuration(ms: number, maxUnits = 3): string {
  let s = Math.floor(Math.abs(ms) / 1000)
  if (s === 0) return '不到 1 秒'
  const units: [string, number][] = [
    ['年', 365 * 86400],
    ['天', 86400],
    ['小时', 3600],
    ['分', 60],
    ['秒', 1],
  ]
  const out: string[] = []
  for (const [name, size] of units) {
    if (s >= size) {
      out.push(`${Math.floor(s / size)} ${name}`)
      s %= size
    } else if (out.length) {
      out.push('')
    }
    if (out.length >= maxUnits) break
  }
  return out.filter(Boolean).join(' ')
}

export interface InstantDescription {
  /** yyyy-MM-dd HH:mm:ss(.SSS) */
  local: string
  iso: string
  isoUtc: string
  rfc2822: string
  httpDate: string
  chinese: string
  relative: string
  /** 距离现在的时长 */
  distance: string
  weekday: string
  dayOfYear: number
  daysInYear: number
  isoWeek: { year: number; week: number }
  offset: string
  seconds: string
  millis: string
  micros: string
  nanos: string
}

export function describeInstant(instant: Instant, tz: string, nowMs: number): InstantDescription {
  const p = zonedParts(instant.epochMs, tz)
  const ns = instantToNs(instant)
  const wk = isoWeek(p.year, p.month, p.day)
  return {
    local: formatDateTime(p, instant.subMsNs),
    iso: formatISO(instant, tz),
    isoUtc: formatISOUtc(instant.epochMs),
    rfc2822: formatRFC2822(instant.epochMs, tz),
    httpDate: formatHttpDate(instant.epochMs),
    chinese: formatChinese(p),
    relative: formatRelative(instant.epochMs, nowMs),
    distance: formatDuration(instant.epochMs - nowMs),
    weekday: WEEKDAY_ZH[p.weekday],
    dayOfYear: dayOfYear(p.year, p.month, p.day),
    daysInYear: isLeapYear(p.year) ? 366 : 365,
    isoWeek: wk,
    offset: `UTC${formatOffset(p.offsetSeconds)}`,
    seconds: floorDiv(ns, 1_000_000_000n).toString(),
    millis: floorDiv(ns, 1_000_000n).toString(),
    micros: floorDiv(ns, 1_000n).toString(),
    nanos: ns.toString(),
  }
}

/** 按单位输出时间戳（向下取整） */
export function instantToUnit(instant: Instant, unit: TsUnit): string {
  return floorDiv(instantToNs(instant), UNIT_NS[unit]).toString()
}

// ─────────────────────────── 日期字符串解析 ───────────────────────────

export interface ParsedDate {
  instant: Instant
  /** 识别出的格式 */
  format: string
  /** 输入是否自带时区 / 偏移 */
  zoneFromInput: boolean
  kind: Disambiguation
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

/** 常见时区缩写（RFC 2822 及北美） */
const ZONE_ABBR: Record<string, number> = {
  z: 0,
  ut: 0,
  utc: 0,
  gmt: 0,
  est: -5 * 60,
  edt: -4 * 60,
  cst: -6 * 60,
  cdt: -5 * 60,
  mst: -7 * 60,
  mdt: -6 * 60,
  pst: -8 * 60,
  pdt: -7 * 60,
}

const ZONE_RE = String.raw`(Z|UTC|GMT|UT|[ECMP][SD]T|(?:UTC|GMT)?\s*[+-]\d{1,2}(?::?\d{2})?)`

/** 解析偏移字符串 → 分钟；无法识别返回 null */
export function parseZoneOffset(z: string): number | null {
  const s = z.trim().toLowerCase()
  if (s in ZONE_ABBR) return ZONE_ABBR[s]
  const m = /^(?:utc|gmt)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(s)
  if (!m) return null
  const h = Number(m[2])
  const min = m[3] ? Number(m[3]) : 0
  if (h > 18 || min > 59) return null
  return (m[1] === '-' ? -1 : 1) * (h * 60 + min)
}

interface Fields {
  year: number
  month: number
  day: number
  hour?: number
  minute?: number
  second?: number
  /** 小数秒的数字串 */
  fraction?: string
}

function validateFields(f: Fields): string | null {
  if (f.month < 1 || f.month > 12) return `月份「${f.month}」无效，应为 1–12`
  const dim = daysInMonth(f.year, f.month)
  if (f.day < 1 || f.day > dim) {
    return f.day >= 1 && f.day <= 31
      ? `${f.year} 年 ${f.month} 月只有 ${dim} 天，没有 ${f.day} 日`
      : `日期「${f.day}」无效，应为 1–${dim}`
  }
  if ((f.hour ?? 0) > 23) return `小时「${f.hour}」无效，应为 0–23`
  if ((f.minute ?? 0) > 59) return `分钟「${f.minute}」无效，应为 0–59`
  if ((f.second ?? 0) > 59) return `秒「${f.second}」无效，应为 0–59`
  return null
}

function fieldsToInstant(
  f: Fields,
  tz: string,
  offsetMinutes: number | null,
): Result<{ instant: Instant; kind: Disambiguation }> {
  const err = validateFields(f)
  if (err) return fail(err)
  const frac = (f.fraction ?? '').padEnd(9, '0').slice(0, 9)
  const wall: WallTime = {
    year: f.year,
    month: f.month,
    day: f.day,
    hour: f.hour ?? 0,
    minute: f.minute ?? 0,
    second: f.second ?? 0,
    millisecond: Number(frac.slice(0, 3)),
  }
  let epochMs: number
  let kind: Disambiguation = 'exact'
  if (offsetMinutes !== null) {
    epochMs = wallToUtcMs(wall) - offsetMinutes * 60_000
  } else {
    const r = zonedToEpoch(wall, tz)
    epochMs = r.epochMs
    kind = r.kind
  }
  const range = checkRange({ epochMs, subMsNs: Number(frac.slice(3)) })
  if (!range.ok) return range
  return ok({ instant: range.value, kind })
}

function to24h(hour: number, marker: string | undefined): number {
  if (!marker) return hour
  const m = marker.toLowerCase()
  if (/^(pm|下午|晚上)$/.test(m)) return hour < 12 ? hour + 12 : hour
  if (/^(am|凌晨|上午|早上)$/.test(m)) return hour === 12 ? 0 : hour
  if (m === '中午') return hour < 11 ? hour + 12 : hour
  return hour
}

/** 在指定时区对墙上时间做日历运算（年 / 月 / 周 / 天）或精确运算（时 / 分 / 秒） */
export function addToInstant(epochMs: number, tz: string, amount: number, unit: string): number {
  if (/^(y|M|w|d)$/.test(unit)) {
    const p = zonedParts(epochMs, tz)
    let { year, month, day } = p
    if (unit === 'y') year += amount
    if (unit === 'M') {
      const total = year * 12 + (month - 1) + amount
      year = Math.floor(total / 12)
      month = mod(total, 12) + 1
    }
    if (unit === 'y' || unit === 'M') day = Math.min(day, daysInMonth(year, month))
    if (unit === 'w' || unit === 'd') {
      ;({ year, month, day } = civilFromDays(
        daysFromCivil(year, month, day) + amount * (unit === 'w' ? 7 : 1),
      ))
    }
    return zonedToEpoch({ ...p, year, month, day }, tz).epochMs
  }
  const size = { h: 3_600_000, m: 60_000, s: 1000, ms: 1 }[unit] ?? 0
  return epochMs + amount * size
}

const REL_UNIT: Record<string, string> = {
  y: 'y',
  yr: 'y',
  year: 'y',
  years: 'y',
  M: 'M',
  mo: 'M',
  mon: 'M',
  month: 'M',
  months: 'M',
  w: 'w',
  wk: 'w',
  week: 'w',
  weeks: 'w',
  d: 'd',
  day: 'd',
  days: 'd',
  h: 'h',
  hr: 'h',
  hour: 'h',
  hours: 'h',
  m: 'm',
  min: 'm',
  mins: 'm',
  minute: 'm',
  minutes: 'm',
  s: 's',
  sec: 's',
  secs: 's',
  second: 's',
  seconds: 's',
  ms: 'ms',
}

const ZH_UNIT: Record<string, string> = {
  年: 'y',
  个月: 'M',
  月: 'M',
  周: 'w',
  星期: 'w',
  个星期: 'w',
  礼拜: 'w',
  天: 'd',
  日: 'd',
  小时: 'h',
  个小时: 'h',
  钟头: 'h',
  分钟: 'm',
  分: 'm',
  秒: 's',
  秒钟: 's',
}

function startOfDay(epochMs: number, tz: string, dayOffset: number): number {
  const p = zonedParts(epochMs, tz)
  const base = zonedToEpoch({ ...p, hour: 0, minute: 0, second: 0, millisecond: 0 }, tz).epochMs
  return dayOffset ? addToInstant(base, tz, dayOffset, 'd') : base
}

function parseRelative(s: string, tz: string, nowMs: number): Result<ParsedDate> | null {
  const lower = s.toLowerCase()
  const keyword: Record<string, number> = {
    today: 0,
    今天: 0,
    今日: 0,
    yesterday: -1,
    昨天: -1,
    tomorrow: 1,
    明天: 1,
    前天: -2,
    后天: 2,
  }
  if (lower === 'now' || s === '现在' || s === '此刻') {
    return ok({
      instant: instantFromMs(nowMs),
      format: '当前时间',
      zoneFromInput: false,
      kind: 'exact',
    })
  }
  if (lower in keyword) {
    return ok({
      instant: instantFromMs(startOfDay(nowMs, tz, keyword[lower])),
      format: '相对日期（当天 00:00）',
      zoneFromInput: false,
      kind: 'exact',
    })
  }
  // now+1d、+1d2h、-3h、1d ago、in 2 hours
  const en = /^(?:now\s*)?((?:[+-]?\s*\d+(?:\.\d+)?\s*[a-zA-Z]+\s*)+)(ago)?$/i.exec(s)
  const inPrefix = /^in\s+(.+)$/i.exec(s)
  if ((en && (/^now/i.test(s) || /^[+-]/.test(s) || en[2])) || inPrefix) {
    const body = inPrefix ? inPrefix[1] : en![1]
    const ago = !inPrefix && !!en![2]
    const re = /([+-])?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g
    let t = nowMs
    let sign = ago ? -1 : 1
    let m: RegExpExecArray | null
    let consumed = ''
    while ((m = re.exec(body))) {
      consumed += m[0]
      if (m[1]) sign = m[1] === '-' ? -1 : 1
      const unitRaw = m[3]
      const unit = REL_UNIT[unitRaw] ?? REL_UNIT[unitRaw.toLowerCase()]
      if (!unit)
        return fail(
          `无法识别的时间单位「${unitRaw}」，可用 y / M / w / d / h / m / s（M 为月，m 为分钟）`,
        )
      const n = Number(m[2])
      if (!Number.isInteger(n) && /^(y|M)$/.test(unit)) return fail('年、月只能加减整数')
      if (Number.isInteger(n) || !/^(w|d)$/.test(unit)) {
        t = addToInstant(t, tz, sign * n, unit)
      } else {
        t += sign * n * (unit === 'w' ? 7 : 1) * 86_400_000
      }
    }
    if (consumed.replace(/\s/g, '') !== body.replace(/\s/g, '')) return null
    const range = checkRange(instantFromMs(t))
    if (!range.ok) return range
    return ok({ instant: range.value, format: '相对时间', zoneFromInput: false, kind: 'exact' })
  }
  // 3天前、2 小时后、半小时后
  const zh =
    /^(\d+|半)\s*(个星期|个小时|个月|星期|礼拜|小时|钟头|分钟|秒钟|年|月|周|天|日|分|秒)\s*(以前|之前|以后|之后|前|后)$/.exec(
      s,
    )
  if (zh) {
    const n = zh[1] === '半' ? 0.5 : Number(zh[1])
    const unit = ZH_UNIT[zh[2]]
    const sign = /前/.test(zh[3]) ? -1 : 1
    let t: number
    if (Number.isInteger(n)) t = addToInstant(nowMs, tz, sign * n, unit)
    else {
      const size: Record<string, number> = {
        y: 365 * 86_400_000,
        M: 30 * 86_400_000,
        w: 7 * 86_400_000,
        d: 86_400_000,
        h: 3_600_000,
        m: 60_000,
        s: 1000,
      }
      t = nowMs + sign * n * size[unit]
    }
    const range = checkRange(instantFromMs(t))
    if (!range.ok) return range
    return ok({ instant: range.value, format: '相对时间', zoneFromInput: false, kind: 'exact' })
  }
  return null
}

function withZone(
  f: Fields,
  zone: string | undefined,
  tz: string,
  format: string,
): Result<ParsedDate> {
  let offset: number | null = null
  if (zone) {
    offset = parseZoneOffset(zone)
    if (offset === null) return fail(`无法识别的时区偏移「${zone}」，示例：+08:00、-0500、Z、GMT+8`)
  }
  const r = fieldsToInstant(f, tz, offset)
  if (!r.ok) return r
  return ok({ ...r.value, format, zoneFromInput: offset !== null })
}

/**
 * 解析各种日期写法：
 * 2024-01-01 12:00:00、2024/1/1、ISO 8601（含偏移）、RFC 2822、JS Date#toString、
 * 2024年1月1日 12:30、20240101、now、today、+1d、-2h、3天前……
 * 未带时区的输入按 tz 解析。纯数字（非 8/12/14 位日期）按时间戳处理。
 */
export function parseDateInput(raw: string, tz: string, nowMs: number): Result<ParsedDate> {
  try {
    return parseDateInner(raw, tz, nowMs)
  } catch {
    // 兜底：Intl / Date 在极端数值下可能抛 RangeError，界面上只显示错误而不是崩溃
    return fail(RANGE_ERROR)
  }
}

function parseDateInner(raw: string, tz: string, nowMs: number): Result<ParsedDate> {
  const s = toHalfWidth(raw).trim().replace(/\s+/g, ' ')
  if (!s) return fail('请输入日期时间')

  const rel = parseRelative(s, tz, nowMs)
  if (rel) return rel

  // 紧凑日期：20240101 / 202401011230 / 20240101123000
  const compact = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/.exec(s)
  if (compact && (s.length === 8 || s.length === 12 || s.length === 14)) {
    const [, y, mo, d, h, mi, sec] = compact
    const f: Fields = {
      year: +y,
      month: +mo,
      day: +d,
      hour: h ? +h : 0,
      minute: mi ? +mi : 0,
      second: sec ? +sec : 0,
    }
    if (!validateFields(f)) return withZone(f, undefined, tz, '紧凑日期 yyyyMMdd[HHmm[ss]]')
  }

  // 纯数字 → 时间戳
  if (/^[+-]?\d+(?:\.\d+)?$/.test(s)) {
    const ts = parseTimestamp(s)
    if (!ts.ok) return ts
    return ok({
      instant: ts.value.instant,
      format: `时间戳（识别为${UNIT_LABEL[ts.value.unit]}）`,
      zoneFromInput: true,
      kind: 'exact',
    })
  }

  // yyyy-MM-dd[ T]HH:mm[:ss[.SSS]][zone]，分隔符可为 - / .
  const iso = new RegExp(
    String.raw`^([+-]?\d{4,6})([-/.])(\d{1,2})(?:\2(\d{1,2}))?(?:(?:T|\s+)(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:[.,](\d{1,9}))?)?\s*(am|pm|AM|PM)?)?\s*` +
      ZONE_RE +
      '?$',
    'i',
  )
  let m = iso.exec(s)
  if (m) {
    const [, y, sep, mo, d, h, mi, sec, frac, ampm, zone] = m
    if (d === undefined && sep !== '-' && sep !== '/') return fail('无法识别的日期格式')
    const f: Fields = {
      year: +y,
      month: +mo,
      day: d ? +d : 1,
      hour: h !== undefined ? to24h(+h, ampm) : 0,
      minute: mi ? +mi : 0,
      second: sec ? +sec : 0,
      fraction: frac,
    }
    const fmt =
      s.includes('T') || zone
        ? 'ISO 8601'
        : sep === '-'
          ? 'yyyy-MM-dd HH:mm:ss'
          : `yyyy${sep}M${sep}d HH:mm:ss`
    return withZone(f, zone, tz, fmt)
  }

  // 2024年1月1日 [下午] 12时30分[05秒] / 12:30[:05]
  m =
    /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?(?:\s*(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*[:：时点]\s*(?:(\d{1,2})\s*[:：分]?\s*(?:(\d{1,2})\s*秒?)?)?)?$/.exec(
      s,
    )
  if (m) {
    const [, y, mo, d, marker, h, mi, sec] = m
    return withZone(
      {
        year: +y,
        month: +mo,
        day: +d,
        hour: h ? to24h(+h, marker) : 0,
        minute: mi ? +mi : 0,
        second: sec ? +sec : 0,
      },
      undefined,
      tz,
      '中文日期',
    )
  }

  // RFC 2822 / 英文月份：[Mon, ]01 Jan 2024 08:00[:00] [+0800]
  const monthRe = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?'
  const timeRe = String.raw`(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(am|pm)?)?`
  m = new RegExp(
    String.raw`^(?:[a-z]{3,9},?\s+)?(\d{1,2})\s+${monthRe}\s+(\d{2,4})${timeRe}\s*${ZONE_RE}?$`,
    'i',
  ).exec(s)
  if (m) {
    const [, d, mon, y, h, mi, sec, frac, ampm, zone] = m
    let year = +y
    if (y.length === 2) year += year < 50 ? 2000 : 1900
    return withZone(
      {
        year,
        month: MONTH_INDEX[mon.toLowerCase()],
        day: +d,
        hour: h ? to24h(+h, ampm) : 0,
        minute: mi ? +mi : 0,
        second: sec ? +sec : 0,
        fraction: frac,
      },
      zone,
      tz,
      'RFC 2822',
    )
  }

  // Jan 1, 2024 10:00 / Mon Jan 01 2024 08:00:00 GMT+0800 (中国标准时间)
  m = new RegExp(
    String.raw`^(?:[a-z]{3,9},?\s+)?${monthRe}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})${timeRe}\s*${ZONE_RE}?(?:\s*\([^)]*\))?$`,
    'i',
  ).exec(s)
  if (m) {
    const [, mon, d, y, h, mi, sec, frac, ampm, zone] = m
    return withZone(
      {
        year: +y,
        month: MONTH_INDEX[mon.toLowerCase()],
        day: +d,
        hour: h ? to24h(+h, ampm) : 0,
        minute: mi ? +mi : 0,
        second: sec ? +sec : 0,
        fraction: frac,
      },
      zone,
      tz,
      /\(/.test(s) || /GMT[+-]/i.test(s) ? 'JavaScript Date 字符串' : '英文日期',
    )
  }

  // 只有时间：今天的 HH:mm[:ss]
  m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(am|pm)?$/i.exec(s)
  if (m) {
    const p = zonedParts(nowMs, tz)
    return withZone(
      {
        year: p.year,
        month: p.month,
        day: p.day,
        hour: to24h(+m[1], m[5]),
        minute: +m[2],
        second: m[3] ? +m[3] : 0,
        fraction: m[4],
      },
      undefined,
      tz,
      '今天的时间',
    )
  }

  return fail(
    `无法识别「${raw.trim()}」。支持的写法示例：2024-01-01 12:00:00、2024/1/1、2024-01-01T12:00:00+08:00、Mon, 01 Jan 2024 12:00:00 +0800、2024年1月1日 12:00、now、+1d、3天前`,
  )
}

// ─────────────────────────── 批量 ───────────────────────────

export type BatchDateFormat = 'local' | 'iso' | 'isoUtc' | 'rfc2822' | 'chinese'

export const BATCH_DATE_FORMATS: { value: BatchDateFormat; label: string }[] = [
  { value: 'local', label: 'yyyy-MM-dd HH:mm:ss' },
  { value: 'iso', label: 'ISO 8601' },
  { value: 'isoUtc', label: 'ISO（UTC）' },
  { value: 'rfc2822', label: 'RFC 2822' },
  { value: 'chinese', label: '中文' },
]

export interface BatchLine {
  input: string
  output: string
  kind: 'empty' | 'ts2date' | 'date2ts'
  error?: string
  /** ts2date 时识别出的单位 */
  unit?: TsUnit
}

export interface BatchOptions {
  tz: string
  nowMs: number
  dateFormat: BatchDateFormat
  /** 日期 → 时间戳 的输出单位 */
  tsUnit: TsUnit
  /** 时间戳输入单位 */
  inputUnit?: TsUnit | 'auto'
}

function formatBatchDate(instant: Instant, o: BatchOptions): string {
  switch (o.dateFormat) {
    case 'iso':
      return formatISO(instant, o.tz)
    case 'isoUtc':
      return formatISOUtc(instant.epochMs)
    case 'rfc2822':
      return formatRFC2822(instant.epochMs, o.tz)
    case 'chinese':
      return formatChinese(zonedParts(instant.epochMs, o.tz))
    default:
      return formatDateTime(zonedParts(instant.epochMs, o.tz), instant.subMsNs)
  }
}

/** 逐行转换：数字行视为时间戳转日期，其余行解析为日期转时间戳 */
export function convertBatch(text: string, o: BatchOptions): BatchLine[] {
  return text.split(/\r?\n/).map((line): BatchLine => {
    const input = line.trim()
    if (!input) return { input: line, output: '', kind: 'empty' }
    if (/^[+-]?\d[\d_,]*(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(input)) {
      const r = parseTimestamp(input, o.inputUnit ?? 'auto')
      if (!r.ok) return { input, output: '', kind: 'ts2date', error: r.error }
      return {
        input,
        output: formatBatchDate(r.value.instant, o),
        kind: 'ts2date',
        unit: r.value.unit,
      }
    }
    const r = parseDateInput(input, o.tz, o.nowMs)
    if (!r.ok) return { input, output: '', kind: 'date2ts', error: r.error }
    return { input, output: instantToUnit(r.value.instant, o.tsUnit), kind: 'date2ts' }
  })
}

// ─────────────────────────── 时区列表 ───────────────────────────

export const COMMON_TIME_ZONES: { tz: string; label: string }[] = [
  { tz: 'Asia/Shanghai', label: '北京 / 上海' },
  { tz: 'UTC', label: '协调世界时' },
  { tz: 'Asia/Tokyo', label: '东京' },
  { tz: 'Asia/Singapore', label: '新加坡' },
  { tz: 'Europe/London', label: '伦敦' },
  { tz: 'Europe/Berlin', label: '柏林' },
  { tz: 'America/New_York', label: '纽约' },
  { tz: 'America/Los_Angeles', label: '洛杉矶' },
  { tz: 'Australia/Sydney', label: '悉尼' },
]

const EXTRA_LABELS: Record<string, string> = {
  'Asia/Hong_Kong': '香港',
  'Asia/Taipei': '台北',
  'Asia/Macau': '澳门',
  'Asia/Chongqing': '重庆',
  'Asia/Urumqi': '乌鲁木齐',
  'Asia/Seoul': '首尔',
  'Asia/Kolkata': '印度',
  'Asia/Calcutta': '印度',
  'Asia/Dubai': '迪拜',
  'Asia/Bangkok': '曼谷',
  'Asia/Jakarta': '雅加达',
  'Asia/Kuala_Lumpur': '吉隆坡',
  'Asia/Manila': '马尼拉',
  'Europe/Paris': '巴黎',
  'Europe/Moscow': '莫斯科',
  'Europe/Amsterdam': '阿姆斯特丹',
  'Europe/Madrid': '马德里',
  'Europe/Rome': '罗马',
  'America/Chicago': '芝加哥',
  'America/Denver': '丹佛',
  'America/Toronto': '多伦多',
  'America/Vancouver': '温哥华',
  'America/Sao_Paulo': '圣保罗',
  'America/Mexico_City': '墨西哥城',
  'Pacific/Auckland': '奥克兰',
  'Africa/Cairo': '开罗',
  'Africa/Johannesburg': '约翰内斯堡',
}

/** 时区的中文名（常用时区），没有则返回空串 */
export function zoneLabel(tz: string): string {
  return COMMON_TIME_ZONES.find((z) => z.tz === tz)?.label ?? EXTRA_LABELS[tz] ?? ''
}

/** 无效时区回退到 UTC（例如 localStorage 里存了旧值） */
export function normalizeTimeZone(
  tz: string | undefined | null,
  fallback = 'Asia/Shanghai',
): string {
  if (tz && isValidTimeZone(tz)) return tz
  return isValidTimeZone(fallback) ? fallback : 'UTC'
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

let allZones: string[] | undefined

/** 全部 IANA 时区（去重、含 UTC） */
export function allTimeZones(): string[] {
  if (allZones) return allZones
  let list: string[] = []
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf
    if (fn) list = fn('timeZone')
  } catch {
    list = []
  }
  const set = new Set([...COMMON_TIME_ZONES.map((z) => z.tz), ...list])
  allZones = [...set].sort((a, b) => a.localeCompare(b))
  return allZones
}

/** 按 IANA 名称、中文名或偏移（+8、UTC+08:00）搜索时区 */
export function searchTimeZones(query: string, zones: string[], nowMs: number): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '_')
  if (!q) return zones
  const offQ = /^(?:utc|gmt)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(q)
  const scored: { tz: string; score: number }[] = []
  for (const tz of zones) {
    const id = tz.toLowerCase()
    const label = zoneLabel(tz)
    let score = -1
    if (id === q) score = 100
    else if (id.split('/').pop()!.startsWith(q)) score = 80
    else if (id.startsWith(q)) score = 70
    else if (id.includes(q)) score = 50
    else if (label && label.includes(query.trim())) score = 90
    if (score < 0 && offQ) {
      const want = (offQ[1] === '-' ? -1 : 1) * (Number(offQ[2]) * 60 + Number(offQ[3] ?? 0))
      if (Math.round(offsetSecondsAt(nowMs, tz) / 60) === want) score = 60
    }
    if (score >= 0) {
      // 常用时区、有中文名的时区排在同分数的前面
      if (COMMON_TIME_ZONES.some((z) => z.tz === tz)) score += 5
      else if (EXTRA_LABELS[tz]) score += 3
      scored.push({ tz, score })
    }
  }
  return scored.sort((a, b) => b.score - a.score || a.tz.localeCompare(b.tz)).map((x) => x.tz)
}
