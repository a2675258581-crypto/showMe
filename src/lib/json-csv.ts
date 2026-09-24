/**
 * JSON ⇄ CSV 互转（纯逻辑，基于 papaparse）。
 *
 * JSON → CSV：支持对象数组、单个对象、二维数组、基本值数组；嵌套对象可展开成 `a.b` 列，
 * 数组保留为 JSON 字符串；列取所有行键的并集（按首次出现顺序）。
 * CSV → JSON：可自动识别分隔符；首行作表头时自动处理空表头与重复表头；
 * 可选类型推断（数字、布尔、null、JSON 数组 / 对象）与按 `a.b` 还原嵌套结构。
 * 引号错误带行列号与源码摘录，字段数不一致给出提示。
 */
import Papa from 'papaparse'
import { buildFrame, offsetToPosition } from './code-formatter-frame'
import { isLossyNumber, numberWarning, parseJsonExact } from './json-csv-numbers'
import { parseJson, type ConvertIssue } from './json-yaml'

export type CsvDirection = 'json2csv' | 'csv2json'
export type CsvDelimiter = ',' | ';' | '\t' | '|'

export const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
  ',': '逗号',
  ';': '分号',
  '\t': 'Tab',
  '|': '竖线',
}

export interface JsonToCsvOptions {
  delimiter: CsvDelimiter
  /** 嵌套对象展开成 a.b 列；关闭时整个对象写成 JSON 字符串 */
  flatten: boolean
  /** 所有字段都加引号 */
  quoteAll: boolean
  /** 输出表头行 */
  header: boolean
  newline: '\n' | '\r\n'
  /** 只转换顶层对象里的这个数组字段（如 API 返回的 data） */
  path?: string
}

export interface CsvToJsonOptions {
  /** 首行是表头：输出对象数组；否则输出二维数组 */
  header: boolean
  /** 推断数字、布尔、null、JSON 数组 / 对象 */
  dynamicTyping: boolean
  /** 按 a.b 列名还原嵌套对象 */
  unflatten: boolean
  delimiter: CsvDelimiter | 'auto'
  indent: 2 | 4
}

export const DEFAULT_JSON_TO_CSV: JsonToCsvOptions = {
  delimiter: ',',
  flatten: true,
  quoteAll: false,
  header: true,
  newline: '\n',
}

export const DEFAULT_CSV_TO_JSON: CsvToJsonOptions = {
  header: true,
  dynamicTyping: true,
  unflatten: true,
  delimiter: 'auto',
  indent: 2,
}

export interface CsvTable {
  headers: string[]
  rows: unknown[][]
}

/** 顶层对象里可以直接转换成表格的数组字段 */
export interface RecordArrayCandidate {
  key: string
  length: number
}

export type JsonToCsvResult =
  | {
      ok: true
      csv: string
      table: CsvTable
      warnings: string[]
      /** 顶层是对象时，里面可以转换的对象数组字段 */
      candidates: RecordArrayCandidate[]
      /** 实际使用的数组字段 */
      usedPath: string | null
    }
  | { ok: false; error: ConvertIssue }

export type CsvToJsonResult =
  | {
      ok: true
      json: string
      table: CsvTable
      warnings: string[]
      /** 实际使用（或识别出）的分隔符 */
      delimiter: string
    }
  | { ok: false; error: ConvertIssue }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

/** 设置自有属性（`__proto__` 这类键也按普通键处理，不会改动原型） */
function setOwn(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__')
    Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
  else obj[key] = value
}

const own = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)

/** 转换中途抛出的异常 → 中文错误（超深嵌套会让递归栈溢出；结果过大会超出字符串上限） */
function failure(e: unknown): { ok: false; error: ConvertIssue } {
  const msg = e instanceof Error ? e.message : String(e)
  let message = `转换失败：${msg}`
  if (e instanceof RangeError)
    message = /string length/i.test(msg)
      ? '数据太大，生成的结果超出了浏览器的字符串长度上限'
      : '数据嵌套层级过深，无法转换'
  return { ok: false, error: { message } }
}

/** 最多列出 3 项：第 2、5、9 行 等 12 行 */
function listRows(rows: number[], unit = '行'): string {
  const shown = rows.slice(0, 3).join('、')
  return rows.length > 3 ? `第 ${shown} 等 ${rows.length} ${unit}` : `第 ${shown} ${unit}`
}

/* ───────────────────────── JSON → CSV ───────────────────────── */

/** 单元格文本：null → 空，对象 / 数组 → JSON */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * 把一行对象展开成「列名 → 文本」。flatten 时嵌套对象变成 a.b 列，
 * 数组始终写成 JSON 字符串；返回值里 collisions 记录被覆盖的列名。
 */
export function flattenRecord(
  obj: Record<string, unknown>,
  flatten: boolean,
  collisions?: Set<string>,
): Map<string, string> {
  const out = new Map<string, string>()
  const put = (k: string, v: string) => {
    if (out.has(k)) collisions?.add(k)
    out.set(k, v)
  }
  const visit = (value: unknown, key: string, depth: number) => {
    if (flatten && isPlainObject(value) && depth < 64) {
      const entries = Object.entries(value)
      if (entries.length === 0) put(key, '{}')
      for (const [k, v] of entries) visit(v, `${key}.${k}`, depth + 1)
    } else put(key, cellText(value))
  }
  for (const [k, v] of Object.entries(obj)) visit(v, k, 0)
  return out
}

/** 顶层对象中「非空的对象数组」字段 */
export function findRecordArrays(value: unknown): RecordArrayCandidate[] {
  if (!isPlainObject(value)) return []
  return Object.entries(value)
    .filter(([, v]) => Array.isArray(v) && v.length > 0 && v.every(isPlainObject))
    .map(([key, v]) => ({ key, length: (v as unknown[]).length }))
}

export function jsonToCsv(text: string, options: Partial<JsonToCsvOptions> = {}): JsonToCsvResult {
  try {
    return jsonToCsvImpl(text, options)
  } catch (e) {
    return failure(e)
  }
}

function jsonToCsvImpl(text: string, options: Partial<JsonToCsvOptions>): JsonToCsvResult {
  const opts = { ...DEFAULT_JSON_TO_CSV, ...options }
  const empty: JsonToCsvResult = {
    ok: true,
    csv: '',
    table: { headers: [], rows: [] },
    warnings: [],
    candidates: [],
    usedPath: null,
  }
  if (!text.trim()) return empty
  const parsed = parseJson(text)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  // 超出精度的数字按原文输出（1234567890123456789 不会变成 …800）
  const exact = parseJsonExact(text)
  let value = exact.value
  const candidates = findRecordArrays(value)
  let usedPath: string | null = null
  if (opts.path && isPlainObject(value) && Array.isArray(value[opts.path])) {
    usedPath = opts.path
    value = value[opts.path]
  }

  const warnings: string[] = []
  const numberIssue = numberWarning(exact)
  if (numberIssue) warnings.push(numberIssue)
  const unparse = (fields: string[] | null, data: string[][]) =>
    Papa.unparse(fields ? { fields, data } : data, {
      delimiter: opts.delimiter,
      quotes: opts.quoteAll,
      header: fields ? opts.header : false,
      newline: opts.newline,
    })

  // 二维数组：原样按行输出
  if (Array.isArray(value) && value.length > 0 && value.every(Array.isArray)) {
    const rows = (value as unknown[][]).map((r) => r.map(cellText))
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0)
    const headers =
      opts.header && rows[0].length
        ? Array.from({ length: width }, (_, i) => rows[0][i] ?? `列 ${i + 1}`)
        : Array.from({ length: width }, (_, i) => `列 ${i + 1}`)
    const body = opts.header ? rows.slice(1) : rows
    if (rows.some((r) => r.length !== width))
      warnings.push('各行的元素个数不一致，较短的行在表格中留空')
    return {
      ok: true,
      csv: unparse(null, rows),
      table: { headers, rows: body },
      warnings,
      candidates,
      usedPath,
    }
  }

  const records: Record<string, unknown>[] = Array.isArray(value)
    ? value.map((v) => (isPlainObject(v) ? v : { value: v }))
    : isPlainObject(value)
      ? [value]
      : [{ value }]
  if (Array.isArray(value) && value.length === 0) {
    return { ...empty, warnings: ['数组为空，没有可以转换的数据'], candidates, usedPath }
  }
  if (Array.isArray(value) && value.some((v) => !isPlainObject(v)) && value.some(isPlainObject))
    warnings.push('数组里混有非对象元素，已放进 value 列')

  const collisions = new Set<string>()
  const flat = records.map((r) => flattenRecord(r, opts.flatten, collisions))
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of flat)
    for (const k of row.keys())
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
  // 某行是 null、另一行是对象时，会同时出现 addr 与 addr.city 列：去掉全空的 addr 列
  const prefixed = (k: string) => keys.some((o) => o.startsWith(k + '.'))
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i]
    if (prefixed(k) && flat.every((row) => !row.get(k))) keys.splice(i, 1)
  }
  if (collisions.size)
    warnings.push(
      `展开后列名冲突（如同时存在 “a.b” 键和 a 对象里的 b）：${[...collisions].slice(0, 3).join('、')}`,
    )
  if (keys.length === 0)
    warnings.push(
      records.length === 1
        ? '对象没有任何字段，无法生成 CSV 列'
        : '所有对象都没有字段，无法生成 CSV 列',
    )
  const data = flat.map((row) => keys.map((k) => row.get(k) ?? ''))
  return {
    ok: true,
    csv: keys.length ? unparse(keys, data) : '',
    table: { headers: keys, rows: data },
    warnings,
    candidates,
    usedPath,
  }
}

/* ───────────────────────── CSV → JSON ───────────────────────── */

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

/**
 * 单元格类型推断：空 → null，true / false，null，数字（不含前导零、不超过安全整数），
 * 以 [ 或 { 开头且是合法 JSON 的数组 / 对象。其余保持字符串。
 */
export function typeCell(s: string): unknown {
  if (s === '') return null
  const t = s.trim()
  const lower = t.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false
  if (lower === 'null') return null
  if (JSON_NUMBER.test(t)) {
    const n = Number(t)
    // 转成数字会丢精度（超出安全范围的整数、超过 15 位有效数字的小数、溢出）时保持原文
    return isLossyNumber(t, n) ? s : n
  }
  if ((t[0] === '[' && t.endsWith(']')) || (t[0] === '{' && t.endsWith('}'))) {
    try {
      const v = JSON.parse(t) as unknown
      if (typeof v === 'object' && v !== null) return v
    } catch {
      // 不是 JSON，保持原文
    }
  }
  return s
}

/**
 * 按 a.b 键还原嵌套对象；连续的 0..n-1 数字键还原成数组。
 * 与已有值冲突的键保持扁平，并记入 conflicts。
 */
export function unflattenRecord(
  record: Record<string, unknown>,
  conflicts?: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const created = new WeakSet<object>()
  const isFlat = (parts: string[]) => parts.length < 2 || parts.some((p) => p === '')
  // 扁平键优先：同时有 a 与 a.b 时，a.b 保持扁平
  const flatKeys = new Set(Object.keys(record).filter((k) => isFlat(k.split('.'))))
  for (const [key, value] of Object.entries(record)) {
    const parts = key.split('.')
    if (isFlat(parts)) {
      setOwn(out, key, value)
      continue
    }
    let cur: Record<string, unknown> | null = flatKeys.has(parts[0]) ? null : out
    for (let i = 0; cur && i < parts.length - 1; i++) {
      const p = parts[i]
      // 只看自有属性：constructor、toString 这类键名不能被原型上的同名成员干扰
      const next: unknown = own(cur, p) ? cur[p] : undefined
      if (next === undefined) {
        const obj: Record<string, unknown> = {}
        created.add(obj)
        setOwn(cur, p, obj)
        cur = obj
      } else cur = isPlainObject(next) && created.has(next) ? next : null
    }
    const last = parts[parts.length - 1]
    if (cur && !own(cur, last)) setOwn(cur, last, value)
    else {
      conflicts?.add(key)
      setOwn(out, key, value)
    }
  }
  const arrayify = (v: unknown): unknown => {
    if (!isPlainObject(v) || !created.has(v)) return v
    const keys = Object.keys(v)
    for (const k of keys) setOwn(v, k, arrayify(v[k]))
    if (keys.length > 0 && keys.every((k, i) => k === String(i))) return keys.map((k) => v[k])
    return v
  }
  for (const k of Object.keys(out)) setOwn(out, k, arrayify(out[k]))
  return out
}

interface ParsedRows {
  rows: string[][]
  /** 每行在原文中的起始偏移 */
  starts: number[]
  delimiter: string
  quoteError: { code: string; index: number; row: number } | null
}

function parseRows(src: string, delimiter: CsvDelimiter | 'auto'): ParsedRows {
  const rows: string[][] = []
  const starts: number[] = []
  let prev = 0
  let detected: string = delimiter === 'auto' ? ',' : delimiter
  let quoteError: ParsedRows['quoteError'] = null
  Papa.parse<string[]>(src, {
    delimiter: delimiter === 'auto' ? '' : delimiter,
    skipEmptyLines: 'greedy',
    step: (r) => {
      // 跳过的空行会被算进下一行的起点：往后挪到真正的内容处
      let start = prev
      while (start < src.length && (src[start] === '\n' || src[start] === '\r')) start++
      rows.push(r.data)
      starts.push(start)
      prev = r.meta.cursor
      detected = r.meta.delimiter || detected
      for (const e of r.errors) {
        if (!quoteError && e.type === 'Quotes')
          quoteError = { code: e.code, index: e.index ?? prev, row: rows.length - 1 }
      }
    },
  })
  return { rows, starts, delimiter: detected, quoteError }
}

/**
 * 自动识别分隔符：papaparse 在各行字段数不一致时可能识别失败（退回逗号），
 * 此时看首行里哪种分隔符出现得最多。
 */
export function guessDelimiter(src: string): CsvDelimiter | null {
  const first = src.split(/\r?\n/).find((l) => l.trim()) ?? ''
  if (first.includes(',')) return null
  let best: CsvDelimiter | null = null
  let max = 0
  for (const d of [';', '\t', '|'] as const) {
    const n = first.split(d).length - 1
    if (n > max) {
      max = n
      best = d
    }
  }
  return best
}

function quoteIssue(src: string, err: { code: string; index: number }): ConvertIssue {
  let offset: number
  let message: string
  if (err.code === 'MissingQuotes') {
    // 指向没有闭合的那个开头引号
    const q = src.lastIndexOf('"', Math.min(err.index, src.length - 1))
    offset = q >= 0 ? q : err.index
    message = '引号没有闭合：这个带引号的字段缺少结尾的双引号'
  } else {
    const q = src.indexOf('"', err.index)
    offset = q >= 0 ? q : err.index
    message = '引号格式不正确：结尾引号后面还有其它字符（字段内的 " 需要写成 ""）'
  }
  const { line, column } = offsetToPosition(src, offset)
  return { message, line, column, frame: buildFrame(src, line, column) }
}

export function csvToJson(text: string, options: Partial<CsvToJsonOptions> = {}): CsvToJsonResult {
  try {
    return csvToJsonImpl(text, options)
  } catch (e) {
    return failure(e)
  }
}

function csvToJsonImpl(text: string, options: Partial<CsvToJsonOptions>): CsvToJsonResult {
  const opts = { ...DEFAULT_CSV_TO_JSON, ...options }
  const src = stripBom(text)
  if (!src.trim())
    return {
      ok: true,
      json: '',
      table: { headers: [], rows: [] },
      warnings: [],
      delimiter: opts.delimiter === 'auto' ? ',' : opts.delimiter,
    }

  let parsed = parseRows(src, opts.delimiter)
  if (opts.delimiter === 'auto' && parsed.delimiter === ',') {
    const guess = guessDelimiter(src)
    if (guess) parsed = parseRows(src, guess)
  }
  if (parsed.quoteError) return { ok: false, error: quoteIssue(src, parsed.quoteError) }

  // 行号按原文计算（空行已被跳过）
  const lineOf = (i: number) => offsetToPosition(src, parsed.starts[i]).line
  const kept = parsed.rows.map((cells, index) => ({ cells, index }))
  const warnings: string[] = []
  const cell = (s: string) => (opts.dynamicTyping ? typeCell(s) : s)

  if (!opts.header) {
    const width = kept.reduce((m, r) => Math.max(m, r.cells.length), 0)
    const rows = kept.map((r) => r.cells.map(cell))
    return {
      ok: true,
      json: JSON.stringify(rows, null, opts.indent),
      table: { headers: Array.from({ length: width }, (_, i) => `列 ${i + 1}`), rows },
      warnings,
      delimiter: parsed.delimiter,
    }
  }

  if (kept.length === 0) {
    return {
      ok: true,
      json: '[]',
      table: { headers: [], rows: [] },
      warnings,
      delimiter: parsed.delimiter,
    }
  }

  // 表头：去掉首尾空白；空表头 → column3；重复 → name_2
  const headerRow = kept[0].cells
  const headers: string[] = []
  const used = new Set<string>()
  const renamed: string[] = []
  const claim = (base: string) => {
    let n = base
    for (let i = 2; used.has(n); i++) n = `${base}_${i}`
    used.add(n)
    return n
  }
  headerRow.forEach((h, i) => {
    const t = h.trim()
    const name = claim(t || `column${i + 1}`)
    if (name !== t) renamed.push(t ? `“${t}” → ${name}` : `第 ${i + 1} 列（空表头）→ ${name}`)
    headers.push(name)
  })
  if (renamed.length)
    warnings.push(
      `表头有空白或重复，已重命名：${renamed.slice(0, 3).join('、')}${renamed.length > 3 ? ` 等 ${renamed.length} 列` : ''}`,
    )

  const short: number[] = []
  const long: number[] = []
  const body = kept.slice(1)
  const allHeaders = [...headers]
  const flatRows: Record<string, unknown>[] = body.map((r) => {
    const rec: Record<string, unknown> = {}
    if (r.cells.length < headers.length) short.push(lineOf(r.index))
    if (r.cells.length > headers.length) long.push(lineOf(r.index))
    const n = Math.max(r.cells.length, headers.length)
    for (let i = 0; i < n; i++) {
      let key = allHeaders[i]
      if (key === undefined) {
        key = claim(`column${i + 1}`)
        allHeaders[i] = key
      }
      setOwn(rec, key, cell(r.cells[i] ?? ''))
    }
    return rec
  })
  if (short.length)
    warnings.push(`${listRows(short)}的字段比表头少（共 ${headers.length} 列），缺少的字段已留空`)
  if (long.length)
    warnings.push(`${listRows(long)}的字段比表头多，多出的字段放进了 column 开头的新列`)

  const conflicts = new Set<string>()
  const records = opts.unflatten ? flatRows.map((r) => unflattenRecord(r, conflicts)) : flatRows
  if (conflicts.size)
    warnings.push(
      `以下列名与其它列的嵌套结构冲突，保持原样：${[...conflicts].slice(0, 3).join('、')}`,
    )

  return {
    ok: true,
    json: JSON.stringify(records, null, opts.indent),
    table: {
      headers: allHeaders,
      rows: flatRows.map((r) => allHeaders.map((h) => (own(r, h) ? r[h] : null))),
    },
    warnings,
    delimiter: parsed.delimiter,
  }
}

/** Excel 打开 UTF-8 CSV 时需要 BOM 才能正确识别中文 */
export function withBom(csv: string): string {
  return csv.charCodeAt(0) === 0xfeff ? csv : '\uFEFF' + csv
}
