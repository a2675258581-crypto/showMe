/**
 * 假数据生成（纯逻辑，无 DOM 依赖）。
 *
 * - 可复现：同一个 seed + 同一份字段定义永远生成同样的数据；每个字段用「seed + 字段 id」
 *   派生独立的随机流，所以改动某一列、调整顺序或增减行数都不会打乱其它列。
 * - 身份证号、银行卡号、统一社会信用代码都带正确的校验位。
 */

import {
  ADV_DONE,
  ADV_TODO,
  BANK_BINS,
  COMMUNITIES,
  COMPANY_BRANDS,
  COMPANY_INDUSTRIES,
  EMAIL_DOMAINS,
  EN_FIRST_FEMALE,
  EN_FIRST_MALE,
  EN_LAST,
  GIVEN_FEMALE,
  GIVEN_MALE,
  PHONE_PREFIXES,
  PINYIN_NAMES,
  REGIONS,
  SAFE_EMAIL_DOMAINS,
  SENTENCE_ACTIONS,
  SENTENCE_CONNECTORS,
  SENTENCE_SUBJECTS,
  SENTENCE_TIMES,
  STREETS,
  SURNAMES,
  URL_PATHS,
  URL_TLDS,
  URL_WORDS,
  USER_ADJ,
  USER_NOUN,
  type City,
  type District,
  type Province,
} from './mock-data-dict'

/* ───────────────────────── 随机数 ───────────────────────── */

export interface Rng {
  /** [0, 1) */
  next(): number
  /** [min, max] 闭区间整数 */
  int(min: number, max: number): number
  pick<T>(list: readonly T[]): T
  chance(p: number): boolean
  /** n 位随机数字串（可有前导 0） */
  digits(n: number): string
}

/** 字符串 → 32 位哈希（用于从 seed 和字段 id 派生子种子） */
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

/** mulberry32：足够快、分布良好的 32 位 PRNG */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => {
    const span = max - min + 1
    if (span <= 4294967296) return Math.floor(next() * span) + min
    // 区间超过 2^32 时单次 next() 只有 32 位精度，末几位会呈规律；拼两次得到 53 位
    const r = (Math.floor(next() * 2097152) * 4294967296 + next() * 4294967296) / 2 ** 53
    return Math.min(max, Math.floor(r * span) + min)
  }
  return {
    next,
    int,
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    digits: (n) => {
      let s = ''
      for (let i = 0; i < n; i++) s += String(int(0, 9))
      return s
    },
  }
}

/** 生成一个新的随机种子（「重新生成」时用） */
export function newSeed(): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0]
  } catch {
    return Math.floor(Math.random() * 4294967296)
  }
}

/** 预先计算累积权重，按权重抽取 */
function weighted<T>(entries: readonly (readonly [T, number])[]): (rng: Rng) => T {
  const items = entries.map((e) => e[0])
  const cum: number[] = []
  let total = 0
  for (const [, w] of entries) cum.push((total += w))
  return (rng) => {
    const x = rng.next() * total
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] > x) hi = mid
      else lo = mid + 1
    }
    return items[lo]
  }
}

/* ───────────────────────── 校验位 ───────────────────────── */

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK = '10X98765432'

/** 身份证前 17 位 → 第 18 位校验码（ISO 7064 MOD 11-2） */
export function idCardCheckDigit(first17: string): string {
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(first17[i]) * ID_WEIGHTS[i]
  return ID_CHECK[sum % 11]
}

/** 18 位身份证号：格式、出生日期、校验码都正确 */
export function isValidIdCard(id: string): boolean {
  if (!/^\d{17}[\dX]$/.test(id)) return false
  const y = Number(id.slice(6, 10))
  const m = Number(id.slice(10, 12))
  const d = Number(id.slice(12, 14))
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return false
  }
  return idCardCheckDigit(id) === id[17]
}

/** 给数字串计算 Luhn 校验位（附加在末尾） */
export function luhnCheckDigit(payload: string): string {
  let sum = 0
  for (let i = 0; i < payload.length; i++) {
    let n = Number(payload[payload.length - 1 - i])
    if (i % 2 === 0) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return String((10 - (sum % 10)) % 10)
}

export function isLuhnValid(num: string): boolean {
  const s = num.replace(/\s+/g, '')
  if (!/^\d{2,}$/.test(s)) return false
  return luhnCheckDigit(s.slice(0, -1)) === s[s.length - 1]
}

/** 统一社会信用代码字符集（不含 I O Z S V） */
export const CREDIT_CODE_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY'
const CC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]

/** 统一社会信用代码前 17 位 → 第 18 位校验字符（GB 32100-2015）；含非法字符时返回 null */
export function creditCodeCheckChar(first17: string): string | null {
  let sum = 0
  for (let i = 0; i < 17; i++) {
    const v = CREDIT_CODE_CHARS.indexOf(first17[i])
    if (v < 0) return null
    sum += v * CC_WEIGHTS[i]
  }
  return CREDIT_CODE_CHARS[(31 - (sum % 31)) % 31]
}

export function isValidCreditCode(code: string): boolean {
  if (code.length !== 18) return false
  return creditCodeCheckChar(code) === code[17]
}

const ORG_WEIGHTS = [3, 7, 9, 10, 5, 8, 4, 2]

/** 组织机构代码前 8 位 → 校验字符（GB 11714），可能是 X */
export function orgCodeCheckChar(first8: string): string {
  let sum = 0
  for (let i = 0; i < 8; i++) sum += parseInt(first8[i], 36) * ORG_WEIGHTS[i]
  const c = 11 - (sum % 11)
  return c === 11 ? '0' : c === 10 ? 'X' : String(c)
}

export function isValidOrgCode(code: string): boolean {
  return /^[0-9A-Z]{8}[\dX]$/.test(code) && orgCodeCheckChar(code) === code[8]
}

/* ───────────────────────── 时间 ───────────────────────── */

const TZ_OFFSET_MS = 8 * 3600_000

/**
 * 解析「北京时间」墙上时间：2024-01-02、2024/1/2 08:30、2024-01-02 08:30:15。
 * 返回把墙上时间当作 UTC 字段的毫秒数；无效时返回 null。
 */
export function parseWallTime(s: string): number | null {
  const m =
    /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(s)
  if (!m) return null
  const [y, mo, d, h = 0, mi = 0, se = 0] = m.slice(1).map((x) => (x === undefined ? 0 : +x))
  if (h > 23 || mi > 59 || se > 59) return null
  const ms = Date.UTC(y, mo - 1, d, h, mi, se)
  const t = new Date(ms)
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null
  return ms
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

export type DateFormat = 'datetime' | 'date' | 'time' | 'iso' | 'ts' | 'tsms'

/** 把墙上时间毫秒数格式化；ts / tsms 按北京时间（UTC+8）换算成 Unix 时间戳 */
export function formatWallTime(wall: number, format: DateFormat): string | number {
  const t = new Date(wall)
  const date = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
  const time = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`
  switch (format) {
    case 'date':
      return date
    case 'time':
      return time
    case 'iso':
      return `${date}T${time}+08:00`
    case 'ts':
      return Math.floor((wall - TZ_OFFSET_MS) / 1000)
    case 'tsms':
      return wall - TZ_OFFSET_MS
    default:
      return `${date} ${time}`
  }
}

/* ───────────────────────── 字段类型 ───────────────────────── */

export type FieldType =
  | 'autoId'
  | 'zhName'
  | 'enName'
  | 'username'
  | 'phone'
  | 'email'
  | 'idCard'
  | 'address'
  | 'zip'
  | 'company'
  | 'creditCode'
  | 'bankCard'
  | 'plate'
  | 'ipv4'
  | 'url'
  | 'uuid'
  | 'color'
  | 'int'
  | 'float'
  | 'datetime'
  | 'bool'
  | 'enum'
  | 'password'
  | 'sentence'
  | 'paragraph'

export type OptionValue = string | number | boolean
export type FieldOptions = Record<string, OptionValue>

interface BaseSpec {
  key: string
  label: string
  /** 仅当另一个选项等于某值时显示 */
  when?: { key: string; equals: OptionValue }
}
export type OptionSpec =
  | (BaseSpec & {
      kind: 'select'
      choices: { value: string; label: string }[]
      default: string
    })
  | (BaseSpec & { kind: 'number'; min: number; max: number; step?: number; default: number })
  | (BaseSpec & { kind: 'text'; placeholder?: string; default: string; wide?: boolean })
  | (BaseSpec & { kind: 'switch'; default: boolean })

export interface FieldTypeMeta {
  type: FieldType
  label: string
  group: string
  /** 新增该类型字段时的默认字段名 */
  defaultName: string
  options: OptionSpec[]
}

const GENDER: OptionSpec = {
  key: 'gender',
  label: '性别',
  kind: 'select',
  choices: [
    { value: 'any', label: '不限' },
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
  ],
  default: 'any',
}

export const FIELD_TYPES: FieldTypeMeta[] = [
  {
    type: 'autoId',
    label: '自增 ID',
    group: '数字与时间',
    defaultName: 'id',
    options: [
      { key: 'start', label: '起始', kind: 'number', min: -1e15, max: 1e15, default: 1 },
      { key: 'step', label: '步长', kind: 'number', min: -1e9, max: 1e9, default: 1 },
    ],
  },
  { type: 'zhName', label: '中文姓名', group: '人物', defaultName: 'name', options: [GENDER] },
  {
    type: 'enName',
    label: '英文姓名',
    group: '人物',
    defaultName: 'english_name',
    options: [
      {
        key: 'format',
        label: '格式',
        kind: 'select',
        choices: [
          { value: 'full', label: '全名' },
          { value: 'first', label: '仅名' },
          { value: 'last', label: '仅姓' },
        ],
        default: 'full',
      },
      GENDER,
    ],
  },
  { type: 'username', label: '用户名', group: '人物', defaultName: 'username', options: [] },
  {
    type: 'phone',
    label: '手机号',
    group: '人物',
    defaultName: 'phone',
    options: [
      {
        key: 'format',
        label: '格式',
        kind: 'select',
        choices: [
          { value: 'plain', label: '13812345678' },
          { value: 'space', label: '138 1234 5678' },
          { value: 'dash', label: '138-1234-5678' },
          { value: 'intl', label: '+86 13812345678' },
        ],
        default: 'plain',
      },
    ],
  },
  {
    type: 'email',
    label: '邮箱',
    group: '人物',
    defaultName: 'email',
    options: [
      {
        key: 'domain',
        label: '域名',
        kind: 'select',
        choices: [
          { value: 'common', label: '常见邮箱' },
          { value: 'safe', label: 'example.com' },
          { value: 'custom', label: '自定义' },
        ],
        default: 'common',
      },
      {
        key: 'customDomain',
        label: '自定义域名',
        kind: 'text',
        placeholder: 'company.com',
        default: 'company.com',
        when: { key: 'domain', equals: 'custom' },
      },
    ],
  },
  {
    type: 'idCard',
    label: '身份证号',
    group: '人物',
    defaultName: 'id_card',
    options: [
      { key: 'minAge', label: '最小年龄', kind: 'number', min: 0, max: 120, default: 18 },
      { key: 'maxAge', label: '最大年龄', kind: 'number', min: 0, max: 120, default: 60 },
      GENDER,
    ],
  },
  {
    type: 'address',
    label: '地址',
    group: '地址与机构',
    defaultName: 'address',
    options: [
      {
        key: 'level',
        label: '粒度',
        kind: 'select',
        choices: [
          { value: 'full', label: '省市区 + 街道门牌' },
          { value: 'detail', label: '含小区楼栋' },
          { value: 'region', label: '省市区' },
          { value: 'province', label: '仅省份' },
          { value: 'city', label: '仅城市' },
        ],
        default: 'full',
      },
    ],
  },
  { type: 'zip', label: '邮编', group: '地址与机构', defaultName: 'zip', options: [] },
  {
    type: 'company',
    label: '公司名',
    group: '地址与机构',
    defaultName: 'company',
    options: [{ key: 'withCity', label: '带城市前缀', kind: 'switch', default: true }],
  },
  {
    type: 'creditCode',
    label: '统一社会信用代码',
    group: '地址与机构',
    defaultName: 'credit_code',
    options: [],
  },
  {
    type: 'bankCard',
    label: '银行卡号',
    group: '地址与机构',
    defaultName: 'bank_card',
    options: [
      {
        key: 'length',
        label: '位数',
        kind: 'select',
        choices: [
          { value: '19', label: '19 位' },
          { value: '16', label: '16 位' },
        ],
        default: '19',
      },
      { key: 'spaced', label: '四位分组', kind: 'switch', default: false },
    ],
  },
  {
    type: 'plate',
    label: '车牌号',
    group: '地址与机构',
    defaultName: 'plate',
    options: [
      {
        key: 'kind',
        label: '类型',
        kind: 'select',
        choices: [
          { value: 'normal', label: '普通蓝牌' },
          { value: 'ev', label: '新能源' },
          { value: 'mixed', label: '混合' },
        ],
        default: 'normal',
      },
    ],
  },
  {
    type: 'ipv4',
    label: 'IPv4',
    group: '网络',
    defaultName: 'ip',
    options: [
      {
        key: 'kind',
        label: '范围',
        kind: 'select',
        choices: [
          { value: 'public', label: '公网' },
          { value: 'private', label: '内网' },
          { value: 'any', label: '不限' },
        ],
        default: 'public',
      },
    ],
  },
  { type: 'url', label: 'URL', group: '网络', defaultName: 'website', options: [] },
  {
    type: 'uuid',
    label: 'UUID',
    group: '网络',
    defaultName: 'uuid',
    options: [
      {
        key: 'format',
        label: '格式',
        kind: 'select',
        choices: [
          { value: 'standard', label: '标准小写' },
          { value: 'upper', label: '大写' },
          { value: 'compact', label: '无连字符' },
        ],
        default: 'standard',
      },
    ],
  },
  {
    type: 'color',
    label: '颜色',
    group: '网络',
    defaultName: 'color',
    options: [
      {
        key: 'format',
        label: '格式',
        kind: 'select',
        choices: [
          { value: 'hex', label: 'HEX' },
          { value: 'rgb', label: 'RGB' },
          { value: 'hsl', label: 'HSL' },
        ],
        default: 'hex',
      },
    ],
  },
  {
    type: 'int',
    label: '整数',
    group: '数字与时间',
    defaultName: 'count',
    options: [
      { key: 'min', label: '最小', kind: 'number', min: -1e15, max: 1e15, default: 0 },
      { key: 'max', label: '最大', kind: 'number', min: -1e15, max: 1e15, default: 100 },
    ],
  },
  {
    type: 'float',
    label: '小数',
    group: '数字与时间',
    defaultName: 'amount',
    options: [
      { key: 'min', label: '最小', kind: 'number', min: -1e15, max: 1e15, default: 0, step: 0.01 },
      {
        key: 'max',
        label: '最大',
        kind: 'number',
        min: -1e15,
        max: 1e15,
        default: 1000,
        step: 0.01,
      },
      { key: 'decimals', label: '小数位', kind: 'number', min: 0, max: 10, default: 2 },
    ],
  },
  {
    type: 'datetime',
    label: '日期时间',
    group: '数字与时间',
    defaultName: 'created_at',
    options: [
      {
        key: 'start',
        label: '开始',
        kind: 'text',
        placeholder: '2020-01-01',
        default: '2020-01-01 00:00:00',
      },
      {
        key: 'end',
        label: '结束',
        kind: 'text',
        placeholder: '2025-12-31',
        default: '2025-12-31 23:59:59',
      },
      {
        key: 'format',
        label: '格式',
        kind: 'select',
        choices: [
          { value: 'datetime', label: '日期 + 时间' },
          { value: 'date', label: '仅日期' },
          { value: 'time', label: '仅时间' },
          { value: 'iso', label: 'ISO 8601' },
          { value: 'ts', label: '秒级时间戳' },
          { value: 'tsms', label: '毫秒时间戳' },
        ],
        default: 'datetime',
      },
    ],
  },
  {
    type: 'bool',
    label: '布尔',
    group: '数字与时间',
    defaultName: 'active',
    options: [
      {
        key: 'format',
        label: '输出',
        kind: 'select',
        choices: [
          { value: 'bool', label: 'true / false' },
          { value: 'number', label: '1 / 0' },
          { value: 'zh', label: '是 / 否' },
        ],
        default: 'bool',
      },
      { key: 'ratio', label: '为真概率 %', kind: 'number', min: 0, max: 100, default: 50 },
    ],
  },
  {
    type: 'enum',
    label: '枚举',
    group: '文本',
    defaultName: 'status',
    options: [
      {
        key: 'values',
        label: '可选值（逗号分隔）',
        kind: 'text',
        placeholder: '男,女',
        default: '男,女',
        wide: true,
      },
    ],
  },
  {
    type: 'password',
    label: '密码',
    group: '文本',
    defaultName: 'password',
    options: [
      { key: 'length', label: '长度', kind: 'number', min: 4, max: 128, default: 12 },
      { key: 'symbols', label: '含符号', kind: 'switch', default: true },
    ],
  },
  { type: 'sentence', label: '中文句子', group: '文本', defaultName: 'title', options: [] },
  {
    type: 'paragraph',
    label: '中文段落',
    group: '文本',
    defaultName: 'content',
    options: [
      { key: 'min', label: '最少句数', kind: 'number', min: 1, max: 30, default: 3 },
      { key: 'max', label: '最多句数', kind: 'number', min: 1, max: 30, default: 6 },
    ],
  },
]

export const FIELD_TYPE_MAP = Object.fromEntries(FIELD_TYPES.map((t) => [t.type, t])) as Record<
  FieldType,
  FieldTypeMeta
>

export function isFieldType(t: unknown): t is FieldType {
  return typeof t === 'string' && Object.hasOwn(FIELD_TYPE_MAP, t)
}

/** 用默认值补齐选项，并把数字钳到合法范围；类型不对的值回退默认 */
export function resolveOptions(type: FieldType, raw: FieldOptions | undefined): FieldOptions {
  const out: FieldOptions = {}
  for (const spec of FIELD_TYPE_MAP[type].options) {
    const v = raw?.[spec.key]
    switch (spec.kind) {
      case 'number': {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
        out[spec.key] = Number.isFinite(n)
          ? Math.min(spec.max, Math.max(spec.min, n))
          : spec.default
        break
      }
      case 'switch':
        out[spec.key] = typeof v === 'boolean' ? v : spec.default
        break
      case 'select':
        out[spec.key] =
          typeof v === 'string' && spec.choices.some((c) => c.value === v) ? v : spec.default
        break
      case 'text':
        out[spec.key] = typeof v === 'string' ? v : spec.default
        break
    }
  }
  return out
}

/* ───────────────────────── 生成器 ───────────────────────── */

export type Cell = string | number | boolean | null

export interface GenContext {
  /** 「当前时间」毫秒数，用于按年龄推算出生日期 */
  now: number
}

type Generator = (rng: Rng, index: number) => Cell
type Maker = (o: FieldOptions, ctx: GenContext, warn: (msg: string) => void) => Generator

const pickSurname = weighted(SURNAMES)
const pickPhonePrefix = weighted(PHONE_PREFIXES)

const ALL_DISTRICTS: { p: Province; c: City; d: District }[] = REGIONS.flatMap((p) =>
  p.cities.flatMap((c) => c.districts.map((d) => ({ p, c, d }))),
)
const ALL_CITIES: { p: Province; c: City }[] = REGIONS.flatMap((p) =>
  p.cities.map((c) => ({ p, c })),
)

const LETTERS_NO_IO = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const CITY_LETTERS = 'ABCDEFGH'

function pickGender(rng: Rng, g: OptionValue): 'male' | 'female' {
  if (g === 'male' || g === 'female') return g
  return rng.chance(0.5) ? 'male' : 'female'
}

function zhName(rng: Rng, gender: 'male' | 'female'): string {
  const pool = gender === 'male' ? GIVEN_MALE : GIVEN_FEMALE
  const surname = pickSurname(rng)
  if (rng.chance(0.2)) return surname + rng.pick(pool)
  const a = rng.pick(pool)
  let b = rng.pick(pool)
  // 叠字名（婷婷、欢欢）偶尔出现在女名里，其它情况避免重复
  if (b === a && !(gender === 'female' && rng.chance(0.3))) b = rng.pick(pool)
  return surname + a + b
}

function sentence(rng: Rng, withTime = true): string {
  const time = withTime && rng.chance(0.4) ? rng.pick(SENTENCE_TIMES) + '，' : ''
  const [verb, obj] = rng.pick(SENTENCE_ACTIONS)
  const done = rng.chance(0.5)
  const body = done ? `${rng.pick(ADV_DONE)}${verb}了${obj}` : `${rng.pick(ADV_TODO)}${verb}${obj}`
  return `${time}${rng.pick(SENTENCE_SUBJECTS)}${body}${rng.chance(0.9) ? '。' : '！'}`
}

function regionText(p: Province, c: City, dist: District): string {
  return p.municipality ? p.name + dist.name : p.name + c.name + dist.name
}

function cityShort(c: City): string {
  return c.name.replace(/市$/, '')
}

function plate(rng: Rng, ev: boolean): string {
  const prefix = rng.pick(REGIONS).short + rng.pick(Array.from(CITY_LETTERS))
  if (ev) {
    const second = rng.chance(0.5) ? String(rng.int(0, 9)) : rng.pick(Array.from(LETTERS_NO_IO))
    return `${prefix}${rng.pick(['D', 'F'])}${second}${rng.digits(4)}`
  }
  let s = ''
  let letters = 0
  for (let i = 0; i < 5; i++) {
    if (letters < 2 && rng.chance(0.2)) {
      s += rng.pick(Array.from(LETTERS_NO_IO))
      letters++
    } else s += String(rng.int(0, 9))
  }
  return prefix + s
}

function isPrivateOrReserved(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

function ipv4(rng: Rng, kind: OptionValue): string {
  const tail = () => `${rng.int(0, 255)}.${rng.int(1, 254)}`
  if (kind === 'private') {
    const r = rng.int(0, 2)
    if (r === 0) return `10.${rng.int(0, 255)}.${tail()}`
    if (r === 1) return `172.${rng.int(16, 31)}.${tail()}`
    return `192.168.${tail()}`
  }
  if (kind === 'any') return `${rng.int(1, 223)}.${rng.int(0, 255)}.${tail()}`
  for (;;) {
    const a = rng.int(1, 223)
    const b = rng.int(0, 255)
    if (!isPrivateOrReserved(a, b)) return `${a}.${b}.${tail()}`
  }
}

function uuid(rng: Rng): string {
  const bytes: number[] = []
  for (let i = 0; i < 16; i++) bytes.push(rng.int(0, 255))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

function shuffle<T>(rng: Rng, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

/** 把枚举值文本拆成列表：支持英文 / 中文逗号、竖线和换行 */
export function parseEnumValues(text: string): string[] {
  return text
    .split(/[,，|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const num = (v: OptionValue) => (typeof v === 'number' ? v : Number(v))

const MAKERS: Record<FieldType, Maker> = {
  autoId: (o) => {
    const start = num(o.start)
    const step = num(o.step)
    return (_rng, i) => start + i * step
  },

  zhName: (o) => (rng) => zhName(rng, pickGender(rng, o.gender)),

  enName: (o) => (rng) => {
    const g = pickGender(rng, o.gender)
    const first = rng.pick(g === 'male' ? EN_FIRST_MALE : EN_FIRST_FEMALE)
    const last = rng.pick(EN_LAST)
    return o.format === 'first' ? first : o.format === 'last' ? last : `${first} ${last}`
  },

  username: () => (rng) => {
    const adj = rng.pick(USER_ADJ)
    const noun = rng.pick(USER_NOUN)
    const py = rng.pick(PINYIN_NAMES)
    switch (rng.int(0, 4)) {
      case 0:
        return `${adj}_${noun}`
      case 1:
        return `${adj}${noun[0].toUpperCase()}${noun.slice(1)}${rng.int(1, 9999)}`
      case 2:
        return `${py}${rng.int(10, 9999)}`
      case 3:
        return `${noun}.${py}`
      default:
        return `${py}_${noun}`
    }
  },

  phone: (o) => (rng) => {
    const p = pickPhonePrefix(rng)
    const a = rng.digits(4)
    const b = rng.digits(4)
    switch (o.format) {
      case 'space':
        return `${p} ${a} ${b}`
      case 'dash':
        return `${p}-${a}-${b}`
      case 'intl':
        return `+86 ${p}${a}${b}`
      default:
        return p + a + b
    }
  },

  email: (o, _ctx, warn) => {
    let fixed: string | null = null
    if (o.domain === 'custom') {
      const d = String(o.customDomain).trim().replace(/^@/, '').toLowerCase()
      if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(d)) {
        fixed = d
      } else {
        warn(`自定义域名「${String(o.customDomain)}」无效，已改用 example.com`)
        fixed = 'example.com'
      }
    }
    return (rng) => {
      const domain =
        fixed ?? (o.domain === 'safe' ? rng.pick(SAFE_EMAIL_DOMAINS) : rng.pick(EMAIL_DOMAINS))
      let local: string
      if (domain === 'qq.com' && rng.chance(0.6)) {
        local = String(rng.int(1, 9)) + rng.digits(rng.int(5, 9))
      } else {
        switch (rng.int(0, 3)) {
          case 0:
            local = `${rng.pick(PINYIN_NAMES)}${rng.int(1, 9999)}`
            break
          case 1: {
            const f = rng.pick(rng.chance(0.5) ? EN_FIRST_MALE : EN_FIRST_FEMALE)
            local = `${f}.${rng.pick(EN_LAST)}`.toLowerCase()
            break
          }
          case 2:
            local = `${rng.pick(USER_ADJ)}_${rng.pick(USER_NOUN)}`
            break
          default:
            local = `${rng.pick(PINYIN_NAMES)}.${rng.pick(USER_NOUN)}`
        }
      }
      return `${local}@${domain}`
    }
  },

  idCard: (o, ctx, warn) => {
    let minAge = num(o.minAge)
    let maxAge = num(o.maxAge)
    if (minAge > maxAge) {
      warn('身份证：最小年龄大于最大年龄，已自动交换')
      ;[minAge, maxAge] = [maxAge, minAge]
    }
    const now = new Date(ctx.now)
    const Y = now.getUTCFullYear()
    const M = now.getUTCMonth()
    const D = now.getUTCDate()
    const latest = Date.UTC(Y - minAge, M, D)
    const earliest = Date.UTC(Y - maxAge - 1, M, D + 1)
    const days = Math.max(0, Math.round((latest - earliest) / 86400_000))
    return (rng) => {
      const { d } = rng.pick(ALL_DISTRICTS)
      const birth = new Date(earliest + rng.int(0, days) * 86400_000)
      const ymd = `${birth.getUTCFullYear()}${pad(birth.getUTCMonth() + 1)}${pad(birth.getUTCDate())}`
      // 顺序码 3 位，末位奇数为男、偶数为女
      const g = pickGender(rng, o.gender)
      const order = pad(rng.int(0, 99)) + String(rng.int(0, 4) * 2 + (g === 'male' ? 1 : 0))
      const first17 = `${d.code}${ymd}${order}`
      return first17 + idCardCheckDigit(first17)
    }
  },

  address: (o) => (rng) => {
    const { p, c, d } = rng.pick(ALL_DISTRICTS)
    switch (o.level) {
      case 'province':
        return p.name
      case 'city':
        return c.name
      case 'region':
        return regionText(p, c, d)
      case 'detail':
        return `${regionText(p, c, d)}${rng.pick(STREETS)}${rng.int(1, 999)}号${rng.pick(COMMUNITIES)}${rng.int(1, 30)}栋${rng.int(1, 6)}单元${rng.int(1, 33)}${pad(rng.int(1, 8))}室`
      default:
        return `${regionText(p, c, d)}${rng.pick(STREETS)}${rng.int(1, 999)}号`
    }
  },

  zip: () => (rng) => rng.pick(ALL_CITIES).c.zip.slice(0, 4) + rng.digits(2),

  company: (o) => (rng) => {
    const { c } = rng.pick(ALL_CITIES)
    const city = o.withCity ? (rng.chance(0.5) ? c.name : cityShort(c)) : ''
    const x = rng.next()
    const suffix =
      x < 0.7 ? '有限公司' : x < 0.85 ? '股份有限公司' : x < 0.95 ? '有限责任公司' : '集团有限公司'
    return `${city}${rng.pick(COMPANY_BRANDS)}${rng.pick(COMPANY_INDUSTRIES)}${suffix}`
  },

  creditCode: () => (rng) => {
    const x = rng.next()
    const head = x < 0.85 ? '91' : x < 0.92 ? '92' : x < 0.96 ? '52' : '12'
    const region = rng.pick(ALL_DISTRICTS).d.code
    const chars = Array.from(CREDIT_CODE_CHARS)
    const body = rng.chance(0.6)
      ? 'MA' + Array.from({ length: 6 }, () => rng.pick(chars)).join('')
      : rng.digits(8)
    const org = body + orgCodeCheckChar(body)
    const first17 = head + region + org
    return first17 + creditCodeCheckChar(first17)!
  },

  bankCard: (o) => (rng) => {
    const len = o.length === '16' ? 16 : 19
    const bin = rng.pick(BANK_BINS)
    const payload = bin + rng.digits(len - bin.length - 1)
    const card = payload + luhnCheckDigit(payload)
    return o.spaced ? card.replace(/(\d{4})(?=\d)/g, '$1 ') : card
  },

  plate: (o) => (rng) => plate(rng, o.kind === 'ev' || (o.kind === 'mixed' && rng.chance(0.3))),

  ipv4: (o) => (rng) => ipv4(rng, o.kind),

  url: () => (rng) => {
    const host = `${rng.chance(0.7) ? 'www.' : ''}${rng.pick(URL_WORDS)}${rng.chance(0.3) ? '-tech' : ''}.${rng.pick(URL_TLDS)}`
    const r = rng.int(0, 3)
    const path =
      r === 0
        ? ''
        : r === 1
          ? `/${rng.pick(URL_PATHS)}`
          : r === 2
            ? `/${rng.pick(URL_PATHS)}/${rng.int(1, 99999)}`
            : `/${rng.pick(URL_PATHS)}?id=${rng.int(1, 99999)}`
    return `https://${host}${path}`
  },

  uuid: (o) => (rng) => {
    const u = uuid(rng)
    return o.format === 'upper' ? u.toUpperCase() : o.format === 'compact' ? u.replace(/-/g, '') : u
  },

  color: (o) => (rng) => {
    const h = rng.int(0, 359)
    const s = rng.int(35, 95)
    const l = rng.int(30, 75)
    if (o.format === 'hsl') return `hsl(${h}, ${s}%, ${l}%)`
    const [r, g, b] = hslToRgb(h, s / 100, l / 100)
    if (o.format === 'rgb') return `rgb(${r}, ${g}, ${b})`
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
  },

  int: (o, _ctx, warn) => {
    let lo = num(o.min)
    let hi = num(o.max)
    if (lo > hi) {
      warn('整数：最小值大于最大值，已自动交换')
      ;[lo, hi] = [hi, lo]
    }
    let min = Math.ceil(lo)
    let max = Math.floor(hi)
    if (min > max) {
      // 例如 1.2–1.8：区间里没有整数，取最接近的整数
      min = max = Math.round(lo)
      warn(`整数：${lo}–${hi} 之间没有整数，已固定为 ${min}`)
    }
    return (rng) => rng.int(min, max)
  },

  float: (o, _ctx, warn) => {
    let min = num(o.min)
    let max = num(o.max)
    const dec = Math.round(num(o.decimals))
    if (min > max) {
      warn('小数：最小值大于最大值，已自动交换')
      ;[min, max] = [max, min]
    }
    return (rng) => {
      const v = min + rng.next() * (max - min)
      return Math.min(max, Math.max(min, Number(v.toFixed(dec))))
    }
  },

  datetime: (o, _ctx, warn) => {
    const defStart = parseWallTime('2020-01-01 00:00:00')!
    const defEnd = parseWallTime('2025-12-31 23:59:59')!
    let start = parseWallTime(String(o.start))
    let end = parseWallTime(String(o.end))
    if (start === null) {
      warn(
        `日期时间：开始时间「${String(o.start)}」无法识别，请用 2024-01-31 或 2024-01-31 08:00:00`,
      )
      start = defStart
    }
    if (end === null) {
      warn(`日期时间：结束时间「${String(o.end)}」无法识别，请用 2024-12-31 或 2024-12-31 23:59:59`)
      end = defEnd
    }
    if (start > end) {
      warn('日期时间：开始晚于结束，已自动交换')
      ;[start, end] = [end, start]
    }
    const s0 = Math.floor(start / 1000)
    const s1 = Math.floor(end / 1000)
    const fmt = String(o.format) as DateFormat
    return (rng) => formatWallTime(rng.int(s0, s1) * 1000, fmt)
  },

  bool: (o) => {
    const p = num(o.ratio) / 100
    return (rng) => {
      const v = rng.next() < p
      return o.format === 'number' ? (v ? 1 : 0) : o.format === 'zh' ? (v ? '是' : '否') : v
    }
  },

  enum: (o, _ctx, warn) => {
    const values = parseEnumValues(String(o.values))
    if (values.length === 0) warn('枚举：没有可选值，请用逗号分隔填写，例如「男,女」')
    return (rng) => (values.length ? rng.pick(values) : '')
  },

  password: (o) => {
    const len = Math.round(num(o.length))
    const lower = 'abcdefghijkmnopqrstuvwxyz'
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    const digit = '23456789'
    const symbol = '!@#$%^&*-_=+?'
    const classes = o.symbols ? [lower, upper, digit, symbol] : [lower, upper, digit]
    const all = classes.join('')
    return (rng) => {
      const chars = classes.map((c) => c[rng.int(0, c.length - 1)])
      while (chars.length < len) chars.push(all[rng.int(0, all.length - 1)])
      return shuffle(rng, chars).slice(0, len).join('')
    }
  },

  sentence: () => (rng) => sentence(rng),

  paragraph: (o, _ctx, warn) => {
    let min = Math.round(num(o.min))
    let max = Math.round(num(o.max))
    if (min > max) {
      warn('中文段落：最少句数大于最多句数，已自动交换')
      ;[min, max] = [max, min]
    }
    return (rng) => {
      const n = rng.int(min, max)
      let text = ''
      for (let i = 0; i < n; i++) {
        text +=
          i > 0 && rng.chance(0.3)
            ? rng.pick(SENTENCE_CONNECTORS) + sentence(rng, false)
            : sentence(rng)
      }
      return text
    }
  },
}

/* ───────────────────────── 批量生成 ───────────────────────── */

export interface FieldDef {
  /** 稳定的唯一 id（决定该列的随机流） */
  id: string
  name: string
  type: FieldType
  options?: FieldOptions
}

export interface GenerateResult {
  columns: string[]
  /** 每行按 columns 顺序排列 */
  rows: Cell[][]
  warnings: string[]
}

export const MAX_ROWS = 1000

/** 字段名：空名补 field_N，重复名自动加后缀 */
export function resolveColumnNames(fields: Pick<FieldDef, 'name'>[]): {
  columns: string[]
  warnings: string[]
} {
  const warnings: string[] = []
  const used = new Set<string>()
  const columns = fields.map((f, i) => {
    let name = f.name.trim()
    if (!name) {
      name = `field_${i + 1}`
      warnings.push(`第 ${i + 1} 个字段没有名称，已使用「${name}」`)
    }
    if (used.has(name)) {
      let k = 2
      while (used.has(`${name}_${k}`)) k++
      warnings.push(`字段名「${name}」重复，已改为「${name}_${k}」`)
      name = `${name}_${k}`
    }
    used.add(name)
    return name
  })
  return { columns, warnings }
}

export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(MAX_ROWS, Math.max(1, Math.round(n)))
}

/** 生成 count 行数据（1–1000），永不抛异常 */
export function generate(
  fields: FieldDef[],
  count: number,
  seed: number,
  ctx: GenContext = { now: Date.now() },
): GenerateResult {
  const { columns, warnings } = resolveColumnNames(fields)
  const n = clampCount(count)
  const gens = fields.map((f) => {
    const type = isFieldType(f.type) ? f.type : 'sentence'
    if (type !== f.type) warnings.push(`未知的字段类型「${String(f.type)}」，已按中文句子处理`)
    const opts = resolveOptions(type, f.options)
    const gen = MAKERS[type](opts, ctx, (m) => warnings.push(m))
    const rng = createRng(hashString(`${seed >>> 0}:${f.id}`))
    return { gen, rng }
  })
  const rows: Cell[][] = []
  for (let i = 0; i < n; i++) rows.push(gens.map(({ gen, rng }) => gen(rng, i)))
  return { columns, rows, warnings: Array.from(new Set(warnings)) }
}

/* ───────────────────────── 字段编辑辅助 ───────────────────────── */

/** 新字段的随机 id */
export function makeFieldId(): string {
  return 'f' + newSeed().toString(36) + newSeed().toString(36)
}

/** 在已有名称中取一个不重复的名字：name、name_2、name_3… */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  let k = 2
  while (used.has(`${base}_${k}`)) k++
  return `${base}_${k}`
}

/**
 * 校验从 localStorage 读回的字段列表；结构不对返回 null。
 * 已经合法的字段原样返回（保持对象引用不变，拖动排序依赖引用识别条目）。
 */
export function sanitizeFields(raw: unknown): FieldDef[] | null {
  if (!Array.isArray(raw)) return null
  const out: FieldDef[] = []
  const ids = new Set<string>()
  let changed = false
  for (const f of raw as unknown[]) {
    if (!f || typeof f !== 'object') return null
    const { id, name, type, options } = f as Record<string, unknown>
    if (typeof id !== 'string' || !id || ids.has(id) || typeof name !== 'string') return null
    if (!isFieldType(type)) return null
    ids.add(id)
    const entries = options && typeof options === 'object' ? Object.entries(options) : []
    const clean = entries.filter(
      ([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
    )
    if (options !== undefined && (typeof options !== 'object' || clean.length !== entries.length)) {
      changed = true
      out.push({ id, name, type, options: Object.fromEntries(clean) as FieldOptions })
    } else {
      out.push(f as FieldDef)
    }
  }
  return changed ? out : (raw as FieldDef[])
}

/** 由预设生成带 id 的字段 */
export function presetFields(preset: SchemaPreset, makeId: () => string = makeFieldId): FieldDef[] {
  return preset.fields.map((f) => ({ ...f, id: makeId(), options: { ...f.options } }))
}

/* ───────────────────────── 预设模板 ───────────────────────── */

export interface SchemaPreset {
  id: string
  label: string
  fields: Omit<FieldDef, 'id'>[]
}

export const PRESETS: SchemaPreset[] = [
  {
    id: 'user',
    label: '用户表',
    fields: [
      { name: 'id', type: 'autoId' },
      { name: 'name', type: 'zhName' },
      { name: 'gender', type: 'enum', options: { values: '男,女' } },
      { name: 'age', type: 'int', options: { min: 18, max: 65 } },
      { name: 'phone', type: 'phone' },
      { name: 'email', type: 'email' },
      { name: 'id_card', type: 'idCard' },
      { name: 'address', type: 'address' },
      { name: 'created_at', type: 'datetime' },
    ],
  },
  {
    id: 'order',
    label: '订单表',
    fields: [
      { name: 'order_no', type: 'autoId', options: { start: 202400001, step: 1 } },
      { name: 'user_id', type: 'int', options: { min: 1, max: 10000 } },
      {
        name: 'product',
        type: 'enum',
        options: { values: '无线耳机,机械键盘,显示器,咖啡豆,运动鞋,保温杯,双肩包' },
      },
      { name: 'amount', type: 'float', options: { min: 9.9, max: 2999, decimals: 2 } },
      { name: 'status', type: 'enum', options: { values: '待支付,已支付,已发货,已完成,已取消' } },
      { name: 'paid', type: 'bool', options: { ratio: 80 } },
      { name: 'receiver', type: 'zhName' },
      { name: 'ship_address', type: 'address', options: { level: 'detail' } },
      { name: 'created_at', type: 'datetime', options: { format: 'iso' } },
    ],
  },
  {
    id: 'employee',
    label: '员工表',
    fields: [
      { name: 'emp_no', type: 'autoId', options: { start: 1001, step: 1 } },
      { name: 'name', type: 'zhName' },
      {
        name: 'department',
        type: 'enum',
        options: { values: '研发部,产品部,设计部,市场部,销售部,人事部,财务部' },
      },
      { name: 'salary', type: 'int', options: { min: 8000, max: 50000 } },
      {
        name: 'hire_date',
        type: 'datetime',
        options: { start: '2015-01-01', end: '2025-06-30', format: 'date' },
      },
      { name: 'phone', type: 'phone' },
      { name: 'email', type: 'email', options: { domain: 'custom', customDomain: 'company.com' } },
      { name: 'bank_card', type: 'bankCard' },
    ],
  },
  {
    id: 'company',
    label: '企业表',
    fields: [
      { name: 'id', type: 'uuid' },
      { name: 'company_name', type: 'company' },
      { name: 'credit_code', type: 'creditCode' },
      { name: 'legal_person', type: 'zhName' },
      { name: 'address', type: 'address' },
      { name: 'zip', type: 'zip' },
      { name: 'website', type: 'url' },
      { name: 'intro', type: 'paragraph', options: { min: 2, max: 3 } },
    ],
  },
  {
    id: 'log',
    label: '访问日志',
    fields: [
      { name: 'id', type: 'uuid', options: { format: 'compact' } },
      { name: 'ip', type: 'ipv4' },
      { name: 'user', type: 'username' },
      { name: 'action', type: 'enum', options: { values: 'login,logout,upload,download,delete' } },
      { name: 'success', type: 'bool', options: { ratio: 90, format: 'number' } },
      { name: 'latency_ms', type: 'int', options: { min: 5, max: 1500 } },
      { name: 'ts', type: 'datetime', options: { format: 'tsms' } },
    ],
  },
]
