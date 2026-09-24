/**
 * Cron 表达式：校验、中文解释、字段拆解、下次执行时间、可视化构建（纯逻辑，可在 Node 中运行）。
 * - 描述：cronstrue（zh_CN 语言包）
 * - 执行时间：cron-parser 5（支持时区与夏令时）
 */
import cronstrue from 'cronstrue'
import 'cronstrue/locales/zh_CN'
import { CronExpressionParser, type CronExpression } from 'cron-parser'
import { isValidTimeZone } from './timestamp'

export type FieldKey = 'second' | 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek'

export interface FieldSpec {
  key: FieldKey
  /** 短名：秒 / 分 / 时 / 日 / 月 / 周 */
  label: string
  /** 全称 */
  name: string
  min: number
  max: number
  aliases?: Record<string, number>
}

const MONTH_ALIASES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
}
const DOW_ALIASES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
}

export const FIELD_SPECS: Record<FieldKey, FieldSpec> = {
  second: { key: 'second', label: '秒', name: '秒', min: 0, max: 59 },
  minute: { key: 'minute', label: '分', name: '分钟', min: 0, max: 59 },
  hour: { key: 'hour', label: '时', name: '小时', min: 0, max: 23 },
  dayOfMonth: { key: 'dayOfMonth', label: '日', name: '日期', min: 1, max: 31 },
  month: { key: 'month', label: '月', name: '月份', min: 1, max: 12, aliases: MONTH_ALIASES },
  dayOfWeek: { key: 'dayOfWeek', label: '周', name: '星期', min: 0, max: 7, aliases: DOW_ALIASES },
}

export const FIELD_ORDER: FieldKey[] = [
  'second',
  'minute',
  'hour',
  'dayOfMonth',
  'month',
  'dayOfWeek',
]

export const WEEK_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 预定义宏 → 5 段表达式 */
export const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
  '@minutely': '* * * * *',
  '@weekdays': '0 0 * * 1-5',
  '@weekends': '0 0 * * 0,6',
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = <T = never>(error: string): Result<T> => ({ ok: false, error })

export interface NormalizedCron {
  fields: Record<FieldKey, string>
  /** 是否为 6 段（含秒） */
  hasSeconds: boolean
  /** 规范化后的表达式（5 或 6 段，单空格分隔） */
  expression: string
  /** 使用的宏，如 @daily */
  macro?: string
  /** crontab 行里表达式后面的命令 */
  command?: string
}

// ─────────────────────────── 校验 ───────────────────────────

function parseValue(v: string, spec: FieldSpec): number | null {
  if (/^\d+$/.test(v)) return Number(v)
  const alias = spec.aliases?.[v.toUpperCase()]
  return alias ?? null
}

function valueHint(spec: FieldSpec): string {
  if (spec.key === 'month') return '可用 1–12 或 JAN–DEC'
  if (spec.key === 'dayOfWeek') return '可用 0–7（0 和 7 都是周日）或 SUN–SAT'
  return `应为 ${spec.min}–${spec.max} 的整数`
}

function checkNumber(raw: string, spec: FieldSpec): string | number {
  const where = `「${spec.label}」字段`
  const n = parseValue(raw, spec)
  if (n === null) return `${where}：无法识别「${raw}」，${valueHint(spec)}`
  if (n < spec.min || n > spec.max) {
    return `${where}的值 ${n} 超出范围（${spec.min}–${spec.max}）`
  }
  return n
}

function validateItem(item: string, spec: FieldSpec): string | null {
  const where = `「${spec.label}」字段`
  if (item === '') return `${where}有多余的逗号`
  if (item === '*' || item === '?') return null
  if (/^H(?:\(\d+-\d+\))?(?:\/\d+)?$/i.test(item)) return null
  if (spec.key === 'dayOfMonth') {
    if (/^L$/i.test(item)) return null
    if (/^L-\d+$/i.test(item) || /W$/i.test(item)) {
      return `${where}：暂不支持「${item}」（W / L-n 语法），可用 L 表示每月最后一天`
    }
  }
  if (spec.key === 'dayOfWeek') {
    const last = /^(\w+)L$/i.exec(item)
    if (last) {
      const n = checkNumber(last[1], spec)
      return typeof n === 'string' ? n : null
    }
    const nth = /^(\w+)#(\w*)$/.exec(item)
    if (nth) {
      const n = checkNumber(nth[1], spec)
      if (typeof n === 'string') return n
      if (!/^[1-5]$/.test(nth[2]))
        return `${where}：「#」后的序号应为 1–5（表示当月第几个），实际是「${nth[2]}」`
      return null
    }
  } else if (/[L#]/i.test(item) && spec.key !== 'dayOfMonth' && !/^[A-Z]{3}/i.test(item)) {
    return `${where}不支持「${item}」，L / # 只能用于日或周字段`
  }
  const slash = item.split('/')
  if (slash.length > 2) return `${where}「${item}」中有多个「/」`
  const [rangePart, stepPart] = slash
  if (stepPart !== undefined) {
    if (!/^\d+$/.test(stepPart)) return `${where}：步长「${stepPart}」必须是正整数`
    if (Number(stepPart) === 0) return `${where}：步长不能为 0`
    if (rangePart === '') return `${where}：「/」前面缺少起始值，例如 */${stepPart}`
  }
  if (rangePart === '*' || rangePart === '?') return null
  const bounds = rangePart.split('-')
  if (bounds.length > 2 || bounds.some((b) => b === '')) {
    return `${where}：「${rangePart}」格式不正确，范围应写成 a-b`
  }
  const nums: number[] = []
  for (const b of bounds) {
    const n = checkNumber(b, spec)
    if (typeof n === 'string') return n
    nums.push(n)
  }
  if (nums.length === 2 && nums[0] > nums[1]) {
    return `${where}：范围「${rangePart}」的起点大于终点，不支持跨越边界的范围，可拆成两段（如 22-23,0-2）`
  }
  return null
}

export function validateField(token: string, spec: FieldSpec): string | null {
  if (spec.key === 'dayOfWeek' && token.includes('#') && token.includes(',')) {
    return '「周」字段：「#」不能与逗号列表一起使用'
  }
  for (const item of token.split(',')) {
    const e = validateItem(item, spec)
    if (e) return e
  }
  return null
}

function validateAll(tokens: string[]): string | null {
  const keys = tokens.length === 6 ? FIELD_ORDER : FIELD_ORDER.slice(1)
  for (let i = 0; i < keys.length; i++) {
    const e = validateField(tokens[i], FIELD_SPECS[keys[i]])
    if (e) return e
  }
  return null
}

function toNormalized(tokens: string[], extra: Partial<NormalizedCron> = {}): NormalizedCron {
  const hasSeconds = tokens.length === 6
  const t = hasSeconds ? tokens : ['0', ...tokens]
  const fields = Object.fromEntries(FIELD_ORDER.map((k, i) => [k, t[i]])) as Record<
    FieldKey,
    string
  >
  return { fields, hasSeconds, expression: tokens.join(' '), ...extra }
}

/**
 * 规范化并校验表达式：5 段（分 时 日 月 周）、6 段（秒 分 时 日 月 周）、@daily 等宏；
 * 如果是 crontab 行，会把后面的命令分离出来。
 */
export function normalizeCron(input: string): Result<NormalizedCron> {
  const s = input.trim().replace(/\s+/g, ' ')
  if (!s) return fail('请输入 Cron 表达式')
  const tokens = s.split(' ')
  if (tokens[0].startsWith('@')) {
    const macro = tokens[0].toLowerCase()
    if (macro === '@reboot') return fail('@reboot 表示系统启动时运行一次，没有固定的执行时间')
    const expr = MACROS[macro]
    if (!expr) {
      return fail(`未知的预定义表达式「${tokens[0]}」，可用：${Object.keys(MACROS).join('、')}`)
    }
    const command = tokens.slice(1).join(' ') || undefined
    return ok(toNormalized(expr.split(' '), { macro, command }))
  }
  if (tokens.length < 5) {
    return fail(`Cron 表达式至少需要 5 段（分 时 日 月 周），当前只有 ${tokens.length} 段`)
  }
  if (tokens.length === 7 && /^(?:\*|\?|\d{4}(?:[-/,]\d{1,4})*)$/.test(tokens[6])) {
    const six = validateAll(tokens.slice(0, 6))
    if (!six) return fail('检测到第 7 段（年份，Quartz 语法），暂不支持；请去掉最后的年份')
  }
  if (
    tokens.length === 6 &&
    /^\d{4}(?:[-/,]\d{1,4})*$/.test(tokens[5]) &&
    Number(tokens[5].slice(0, 4)) > 7 &&
    !validateAll(tokens.slice(0, 5))
  ) {
    return fail(`最后一段「${tokens[5]}」看起来是年份（Quartz 语法），暂不支持；请去掉年份`)
  }
  if (tokens.length >= 6) {
    const six = validateAll(tokens.slice(0, 6))
    if (!six) {
      return ok(
        toNormalized(tokens.slice(0, 6), { command: tokens.slice(6).join(' ') || undefined }),
      )
    }
    const five = validateAll(tokens.slice(0, 5))
    if (!five && !/^[\d*?,\-/]+$/.test(tokens[5])) {
      return ok(toNormalized(tokens.slice(0, 5), { command: tokens.slice(5).join(' ') }))
    }
    if (tokens.length === 6) return fail(six)
    return fail(five ?? six)
  }
  const e = validateAll(tokens)
  return e ? fail(e) : ok(toNormalized(tokens))
}

// ─────────────────────────── 描述 ───────────────────────────

/** 中文与数字之间补一个空格：「每隔5分钟」→「每隔 5 分钟」 */
function spaceCjk(s: string): string {
  return s.replace(/([\u4e00-\u9fa5])(\d)/g, '$1 $2').replace(/(\d)([\u4e00-\u9fa5])/g, '$1 $2')
}

function polish(s: string): string {
  let out = spaceCjk(
    s
      .replace(/,\s*/g, '，')
      .replace(/\s*和\s*/g, '和')
      .replace(/，和(?=[一二三四五六七八九十]+月)/g, '和')
      .replace(/个\s+/g, '个')
      .replace(/\s{2,}/g, ' '),
  ).trim()
  const daily = /^在 (\d{2}:\d{2}(?::\d{2})?)$/.exec(out)
  if (daily) out = `每天 ${daily[1]}`
  return out
}

/** 用 cronstrue 生成中文描述；失败时根据字段拆解拼出描述 */
export function describeCron(n: NormalizedCron): string {
  try {
    const text = cronstrue.toString(n.expression, {
      locale: 'zh_CN',
      use24HourTimeFormat: true,
      throwExceptionOnParseError: true,
      dayOfWeekStartIndexZero: true,
    })
    if (text && !/null|undefined/.test(text)) return polish(text)
  } catch {
    // 回退到字段拆解
  }
  return FIELD_ORDER.filter((k) => n.hasSeconds || k !== 'second')
    .map((k) => `${FIELD_SPECS[k].label}：${explainToken(n.fields[k], FIELD_SPECS[k])}`)
    .join('；')
}

function fmtValue(n: number, spec: FieldSpec): string {
  switch (spec.key) {
    case 'second':
      return `${n} 秒`
    case 'minute':
      return `${n} 分`
    case 'hour':
      return `${n} 点`
    case 'dayOfMonth':
      return `${n} 号`
    case 'month':
      return `${n} 月`
    case 'dayOfWeek':
      return WEEK_ZH[n % 7]
  }
}

const EVERY: Record<FieldKey, string> = {
  second: '每秒',
  minute: '每分钟',
  hour: '每小时',
  dayOfMonth: '每天',
  month: '每个月',
  dayOfWeek: '不限星期',
}
const STEP_UNIT: Record<FieldKey, string> = {
  second: '秒',
  minute: '分钟',
  hour: '小时',
  dayOfMonth: '天',
  month: '个月',
  dayOfWeek: '天',
}

function explainItem(item: string, spec: FieldSpec): string {
  if (item === '*') return EVERY[spec.key]
  if (item === '?') return '不指定'
  if (/^H/i.test(item)) return '随机取值（H，按任务名哈希固定）'
  if (spec.key === 'dayOfMonth' && /^L$/i.test(item)) return '每月最后一天'
  const val = (v: string) => fmtValue(parseValue(v, spec) ?? 0, spec)
  if (spec.key === 'dayOfWeek') {
    const last = /^(\w+)L$/i.exec(item)
    if (last) return `每月最后一个${val(last[1])}`
    const nth = /^(\w+)#(\d)$/.exec(item)
    if (nth) return `每月第 ${nth[2]} 个${val(nth[1])}`
  }
  const [range, step] = item.split('/')
  const unit = STEP_UNIT[spec.key]
  if (step !== undefined) {
    if (range === '*' || range === '?') {
      return spec.key === 'second' || spec.key === 'minute' || spec.key === 'hour'
        ? `每隔 ${step} ${unit}`
        : `从 ${fmtValue(spec.min, spec)}起每隔 ${step} ${unit}`
    }
    const [a, b] = range.split('-')
    return b !== undefined
      ? `${val(a)}到 ${val(b)}之间每隔 ${step} ${unit}`
      : `从 ${val(a)}起每隔 ${step} ${unit}`
  }
  const [a, b] = range.split('-')
  return b !== undefined ? `${val(a)}到 ${val(b)}` : val(a)
}

/** 单个字段的中文解释 */
export function explainToken(token: string, spec: FieldSpec): string {
  return spaceCjk(
    token
      .split(',')
      .map((item) => explainItem(item, spec).replace(/\s+/g, ''))
      .join('、'),
  )
}

// ─────────────────────────── 分析 ───────────────────────────

export interface FieldExplanation {
  key: FieldKey
  label: string
  name: string
  raw: string
  text: string
  /** 展开后的取值（来自 cron-parser） */
  values: (number | string)[]
  /** 该字段是否为通配 */
  wildcard: boolean
  /** 5 段表达式中隐含的秒字段 */
  implicit: boolean
}

export interface CronAnalysis {
  normalized: NormalizedCron
  description: string
  fields: FieldExplanation[]
  runs: Date[]
  notes: string[]
}

export interface AnalyzeOptions {
  tz: string
  /** 从哪个时刻开始计算（毫秒） */
  from: number
  count?: number
}

/** 把 cron-parser 的英文错误翻译成中文 */
export function translateCronError(message: string): string {
  let m: RegExpExecArray | null
  if (/Invalid explicit day of month definition/i.test(message)) {
    return '日期与月份的组合不存在（例如 2 月 30 日），该任务永远不会执行'
  }
  if (/loop limit exceeded/i.test(message)) {
    return '在可计算的范围内找不到下一次执行时间，请检查日期、月份与星期的组合'
  }
  if (/Out of the time span range/i.test(message)) return '超出可计算的时间范围'
  if ((m = /got value (\S+) expected range (\d+)-(\d+)/i.exec(message))) {
    return `数值 ${m[1]} 超出范围（${m[2]}–${m[3]}）`
  }
  if ((m = /Invalid characters, got value: (.*)/i.exec(message)))
    return `包含无法识别的内容：${m[1]}`
  if (/incompatible/i.test(message)) return '「#」不能与逗号列表一起使用'
  if (/cannot repeat at every 0 time/i.test(message)) return '步长不能为 0'
  return `表达式无效：${message}`
}

function uniqSorted(values: (number | string)[], key: FieldKey): (number | string)[] {
  const mapped = values.map((v) => (key === 'dayOfWeek' && v === 7 ? 0 : v))
  const nums = [...new Set(mapped.filter((v): v is number => typeof v === 'number'))].sort(
    (a, b) => a - b,
  )
  const strs = [...new Set(mapped.filter((v): v is string => typeof v === 'string'))]
  return [...nums, ...strs]
}

/** 一次完成：校验、描述、字段拆解、接下来 count 次执行时间 */
export function analyzeCron(input: string, opts: AnalyzeOptions): Result<CronAnalysis> {
  const n = normalizeCron(input)
  if (!n.ok) return n
  if (!isValidTimeZone(opts.tz)) return fail(`无效的时区「${opts.tz}」`)
  const norm = n.value
  let parsed: CronExpression
  try {
    parsed = CronExpressionParser.parse(norm.expression, {
      tz: opts.tz,
      currentDate: new Date(opts.from),
      // H（哈希）不给种子时 cron-parser 每次随机取值，界面每秒重算会导致执行时间来回跳；
      // 用表达式本身作种子，保证同一表达式结果稳定
      hashSeed: norm.expression,
    })
  } catch (e) {
    return fail(translateCronError(e instanceof Error ? e.message : String(e)))
  }
  const runs: Date[] = []
  const count = opts.count ?? 10
  try {
    for (let i = 0; i < count; i++) runs.push(parsed.next().toDate())
  } catch (e) {
    if (!runs.length) return fail(translateCronError(e instanceof Error ? e.message : String(e)))
  }
  const cf = parsed.fields
  const fields = FIELD_ORDER.map((key): FieldExplanation => {
    const spec = FIELD_SPECS[key]
    const raw = norm.fields[key]
    const field = cf[key]
    return {
      key,
      label: spec.label,
      name: spec.name,
      raw,
      text: explainToken(raw, spec),
      values: uniqSorted(field.values as (number | string)[], key),
      wildcard: raw === '*' || raw === '?',
      implicit: key === 'second' && !norm.hasSeconds,
    }
  })
  const notes: string[] = []
  const domSet = !['*', '?'].includes(norm.fields.dayOfMonth)
  const dowSet = !['*', '?'].includes(norm.fields.dayOfWeek)
  if (domSet && dowSet) {
    notes.push('「日」和「周」同时指定时，满足其中任意一个就会执行（标准 cron 的“或”语义）')
  }
  for (const key of FIELD_ORDER) {
    const spec = FIELD_SPECS[key]
    const m = /^\*\/(\d+)$/.exec(norm.fields[key])
    if (m && Number(m[1]) > spec.max - spec.min) {
      notes.push(
        `「${spec.label}」的步长 ${m[1]} 超过取值范围，实际只会在 ${fmtValue(spec.min, spec)}执行`,
      )
    }
  }
  if (FIELD_ORDER.some((k) => /H/i.test(norm.fields[k]))) {
    notes.push(
      '「H」由调度器按任务名哈希成固定值（如 Jenkins），这里以表达式本身作种子演示，实际执行时刻以调度器为准',
    )
  }
  if (norm.command) notes.push(`已忽略表达式后面的命令：${norm.command}`)
  return ok({ normalized: norm, description: describeCron(norm), fields, runs, notes })
}

// ─────────────────────────── 可视化构建 ───────────────────────────

export type BuilderMode = 'every' | 'step' | 'range' | 'specific' | 'custom'

export interface FieldBuilder {
  mode: BuilderMode
  step: number
  start: number
  from: number
  to: number
  values: number[]
  custom: string
}

/** 构建器里各字段的取值范围（周字段只用 0–6） */
export function builderRange(key: FieldKey): { min: number; max: number } {
  const spec = FIELD_SPECS[key]
  return { min: spec.min, max: key === 'dayOfWeek' ? 6 : spec.max }
}

const DEFAULT_STEP: Record<FieldKey, number> = {
  second: 10,
  minute: 5,
  hour: 2,
  dayOfMonth: 2,
  month: 3,
  dayOfWeek: 2,
}

export function defaultBuilder(key: FieldKey): FieldBuilder {
  const { min, max } = builderRange(key)
  return {
    mode: 'every',
    step: DEFAULT_STEP[key],
    start: min,
    from: min,
    to: max,
    values: [],
    custom: '',
  }
}

/** 把字段 token 解析成构建器状态；复杂写法（L、#、H、混合列表）归为 custom */
export function tokenToBuilder(token: string, key: FieldKey): FieldBuilder {
  const spec = FIELD_SPECS[key]
  const base = defaultBuilder(key)
  const t = token.trim()
  const num = (v: string) => {
    const n = parseValue(v, spec)
    return n === null ? null : key === 'dayOfWeek' && n === 7 ? 0 : n
  }
  if (t === '*' || t === '?') return base
  let m = /^(\*|\w+)\/(\d+)$/.exec(t)
  if (m) {
    const start = m[1] === '*' ? spec.min : num(m[1])
    if (start !== null && Number(m[2]) > 0)
      return { ...base, mode: 'step', step: Number(m[2]), start }
  }
  m = /^(\w+)-(\w+)$/.exec(t)
  if (m) {
    const a = num(m[1])
    // 周字段的 7 也是周日：0-7、1-7 覆盖整周；其余以 7 结尾的范围构建器表示不了，保留原文
    if (key === 'dayOfWeek' && parseValue(m[2], spec) === 7 && a !== null) {
      return a <= 1 ? base : { ...base, mode: 'custom', custom: t }
    }
    const b = num(m[2])
    if (a !== null && b !== null && a <= b) return { ...base, mode: 'range', from: a, to: b }
  }
  if (/^\w+(,\w+)*$/.test(t)) {
    const values = t.split(',').map(num)
    if (values.every((v): v is number => v !== null)) {
      return { ...base, mode: 'specific', values: [...new Set(values)].sort((a, b) => a - b) }
    }
  }
  return { ...base, mode: 'custom', custom: t }
}

export function builderToToken(b: FieldBuilder, key: FieldKey): string {
  const { min } = builderRange(key)
  switch (b.mode) {
    case 'every':
      return '*'
    case 'step':
      return b.start === min ? `*/${b.step}` : `${b.start}/${b.step}`
    case 'range':
      return b.from === b.to
        ? String(b.from)
        : `${Math.min(b.from, b.to)}-${Math.max(b.from, b.to)}`
    case 'specific':
      return b.values.length ? [...new Set(b.values)].sort((x, y) => x - y).join(',') : '*'
    case 'custom':
      return b.custom.trim() || '*'
  }
}

export function buildExpression(
  builders: Record<FieldKey, FieldBuilder>,
  withSeconds: boolean,
): string {
  const keys = withSeconds ? FIELD_ORDER : FIELD_ORDER.slice(1)
  return keys.map((k) => builderToToken(builders[k], k)).join(' ')
}

// ─────────────────────────── 预设 ───────────────────────────

export const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: '每分钟', expr: '* * * * *' },
  { label: '每 5 分钟', expr: '*/5 * * * *' },
  { label: '每 15 分钟', expr: '*/15 * * * *' },
  { label: '每小时', expr: '0 * * * *' },
  { label: '每天 0 点', expr: '0 0 * * *' },
  { label: '每天凌晨 2 点', expr: '0 2 * * *' },
  { label: '工作日 9 点', expr: '0 9 * * 1-5' },
  { label: '工作时间每半小时', expr: '0,30 9-18 * * 1-5' },
  { label: '每周一 10 点', expr: '0 10 * * 1' },
  { label: '周末 8 点', expr: '0 8 * * 0,6' },
  { label: '每月 1 号', expr: '0 0 1 * *' },
  { label: '每月最后一天', expr: '0 0 L * *' },
  { label: '每季度第一天', expr: '0 0 1 1,4,7,10 *' },
  { label: '每年元旦', expr: '0 0 1 1 *' },
  { label: '每 30 秒', expr: '*/30 * * * * *' },
]
