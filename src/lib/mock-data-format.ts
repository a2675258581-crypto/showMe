/** 假数据导出：JSON / CSV / TSV / SQL INSERT / Markdown 表格（纯函数） */

import type { Cell } from './mock-data'

export type OutputFormat = 'json' | 'csv' | 'tsv' | 'sql' | 'markdown'
export type SqlDialect = 'mysql' | 'postgres' | 'sqlserver'

export interface SqlOptions {
  table: string
  /** 每条 INSERT 语句包含的行数 */
  batch: number
  dialect: SqlDialect
}

export const OUTPUT_META: Record<OutputFormat, { label: string; ext: string; mime: string }> = {
  json: { label: 'JSON', ext: 'json', mime: 'application/json;charset=utf-8' },
  csv: { label: 'CSV', ext: 'csv', mime: 'text/csv;charset=utf-8' },
  tsv: { label: 'TSV', ext: 'tsv', mime: 'text/tab-separated-values;charset=utf-8' },
  sql: { label: 'SQL', ext: 'sql', mime: 'application/sql;charset=utf-8' },
  markdown: { label: 'Markdown', ext: 'md', mime: 'text/markdown;charset=utf-8' },
}

export function toJSON(columns: string[], rows: Cell[][]): string {
  const objects = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? null])))
  return JSON.stringify(objects, null, 2)
}

function cellText(v: Cell): string {
  return v === null || v === undefined ? '' : String(v)
}

/** RFC 4180：含分隔符、引号、换行或首尾空格时加双引号，内部引号翻倍 */
export function csvEscape(v: Cell, delimiter = ','): string {
  const s = cellText(v)
  if (s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function toCSV(columns: string[], rows: Cell[][]): string {
  const line = (cells: Cell[]) => cells.map((c) => csvEscape(c)).join(',')
  return [line(columns), ...rows.map(line)].join('\n')
}

/** TSV 不支持引号转义，值里的制表符和换行替换成空格 */
export function toTSV(columns: string[], rows: Cell[][]): string {
  const clean = (v: Cell) => cellText(v).replace(/[\t\r\n]+/g, ' ')
  const line = (cells: Cell[]) => cells.map(clean).join('\t')
  return [line(columns), ...rows.map(line)].join('\n')
}

function quotePart(part: string, dialect: SqlDialect): string {
  if (dialect === 'mysql') return '`' + part.replace(/`/g, '``') + '`'
  if (dialect === 'sqlserver') return '[' + part.replace(/]/g, ']]') + ']'
  return '"' + part.replace(/"/g, '""') + '"'
}

/**
 * 给标识符加引号。qualified = true（表名）时把 `schema.table` 拆开分别加引号；
 * 列名里的点号是名字的一部分，不能拆。
 */
export function quoteIdent(name: string, dialect: SqlDialect, qualified = false): string {
  if (!qualified) return quotePart(name, dialect)
  const parts = name
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean)
  return parts.length ? parts.map((p) => quotePart(p, dialect)).join('.') : quotePart(name, dialect)
}

export function sqlLiteral(v: Cell, dialect: SqlDialect): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') {
    if (dialect === 'sqlserver') return v ? '1' : '0'
    return v ? 'TRUE' : 'FALSE'
  }
  let s = v.replace(/'/g, "''")
  // MySQL 默认把反斜杠当转义符
  if (dialect === 'mysql') s = s.replace(/\\/g, '\\\\')
  return dialect === 'sqlserver' ? `N'${s}'` : `'${s}'`
}

export function toSQL(columns: string[], rows: Cell[][], opts: SqlOptions): string {
  const table = quoteIdent(opts.table.trim() || 'mock_data', opts.dialect, true)
  const cols = columns.map((c) => quoteIdent(c, opts.dialect)).join(', ')
  const batch = Math.max(1, Math.min(1000, Math.round(opts.batch) || 1))
  const out: string[] = []
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch)
    const values = chunk.map((r) => `(${r.map((v) => sqlLiteral(v, opts.dialect)).join(', ')})`)
    out.push(
      chunk.length === 1
        ? `INSERT INTO ${table} (${cols}) VALUES ${values[0]};`
        : `INSERT INTO ${table} (${cols}) VALUES\n  ${values.join(',\n  ')};`,
    )
  }
  return out.join('\n')
}

function mdEscape(v: Cell): string {
  return cellText(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

/** Markdown 表格；数字列右对齐 */
export function toMarkdown(columns: string[], rows: Cell[][]): string {
  const numeric = columns.map(
    (_, i) =>
      rows.length > 0 &&
      rows.every((r) => r[i] === null || r[i] === undefined || typeof r[i] === 'number'),
  )
  const header = `| ${columns.map((c) => mdEscape(c)).join(' | ')} |`
  const sep = `| ${numeric.map((n) => (n ? '---:' : '---')).join(' | ')} |`
  const body = rows.map((r) => `| ${columns.map((_, i) => mdEscape(r[i])).join(' | ')} |`)
  return [header, sep, ...body].join('\n')
}

export function formatRows(
  columns: string[],
  rows: Cell[][],
  format: OutputFormat,
  sql: SqlOptions,
): string {
  switch (format) {
    case 'csv':
      return toCSV(columns, rows)
    case 'tsv':
      return toTSV(columns, rows)
    case 'sql':
      return toSQL(columns, rows, sql)
    case 'markdown':
      return toMarkdown(columns, rows)
    default:
      return toJSON(columns, rows)
  }
}
