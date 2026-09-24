/**
 * SQL 美化 / 压缩（纯逻辑）。
 *
 * - 美化：sql-formatter，支持多种方言与大小写、缩进选项；MyBatis 风格的 `#{id}` / `${table}`
 *   占位符会被原样保留（先替换成安全标识符，格式化后再还原）。
 * - 压缩：自带按方言区分的词法扫描器，去掉注释、合并空白成单行，
 *   绝不改动字符串、带引号的标识符、美元符引用（$$…$$）与优化器提示（/*+ … *\/）。
 */
import { format, type FormatOptionsWithLanguage } from 'sql-formatter'
import {
  buildFrame,
  offsetToPosition,
  positionToOffset,
  type CodeFrame,
} from './code-formatter-frame'

export type SqlDialect =
  | 'sql'
  | 'mysql'
  | 'mariadb'
  | 'tidb'
  | 'postgresql'
  | 'sqlite'
  | 'plsql'
  | 'transactsql'
  | 'bigquery'
  | 'hive'
  | 'spark'
  | 'redshift'
  | 'snowflake'
  | 'trino'
  | 'clickhouse'
  | 'duckdb'
  | 'db2'
  | 'db2i'
  | 'n1ql'
  | 'singlestoredb'

export const SQL_DIALECTS: { value: SqlDialect; label: string }[] = [
  { value: 'sql', label: '标准 SQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'tidb', label: 'TiDB' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'plsql', label: 'Oracle PL/SQL' },
  { value: 'transactsql', label: 'SQL Server (T-SQL)' },
  { value: 'bigquery', label: 'Google BigQuery' },
  { value: 'hive', label: 'Apache Hive' },
  { value: 'spark', label: 'Spark SQL' },
  { value: 'redshift', label: 'Amazon Redshift' },
  { value: 'snowflake', label: 'Snowflake' },
  { value: 'trino', label: 'Trino / Presto' },
  { value: 'clickhouse', label: 'ClickHouse' },
  { value: 'duckdb', label: 'DuckDB' },
  { value: 'db2', label: 'IBM Db2' },
  { value: 'db2i', label: 'IBM Db2 for i' },
  { value: 'n1ql', label: 'Couchbase N1QL' },
  { value: 'singlestoredb', label: 'SingleStoreDB' },
]

export const dialectLabel = (d: SqlDialect) => SQL_DIALECTS.find((x) => x.value === d)?.label ?? d

export type LetterCase = 'preserve' | 'upper' | 'lower'
export type SqlIndent = '2' | '4' | 'tab'
export type SqlMode = 'format' | 'minify'

export interface SqlOptions {
  dialect: SqlDialect
  mode: SqlMode
  keywordCase: LetterCase
  dataTypeCase: LetterCase
  functionCase: LetterCase
  indent: SqlIndent
  indentStyle: 'standard' | 'tabularLeft' | 'tabularRight'
  logicalOperatorNewline: 'before' | 'after'
  /** 语句之间的空行数 */
  linesBetweenQueries: number
  /** 运算符两侧不加空格：a=b */
  denseOperators: boolean
}

export const DEFAULT_SQL_OPTIONS: SqlOptions = {
  dialect: 'mysql',
  mode: 'format',
  keywordCase: 'upper',
  dataTypeCase: 'upper',
  functionCase: 'preserve',
  indent: '2',
  indentStyle: 'standard',
  logicalOperatorNewline: 'before',
  linesBetweenQueries: 1,
  denseOperators: false,
}

export interface SqlIssue {
  message: string
  /** 补充说明（如「可尝试切换方言」） */
  hint?: string
  line?: number
  column?: number
  frame?: CodeFrame
}

export type SqlResult =
  | {
      ok: true
      output: string
      warnings: string[]
      /** 压缩模式下去掉的注释数 */ commentsRemoved?: number
    }
  | { ok: false; error: SqlIssue }

/* ───────────────────────── 词法（压缩用） ───────────────────────── */

interface LexProfile {
  /** # 行注释 */
  hashComments?: boolean
  /** // 行注释（Snowflake） */
  slashComments?: boolean
  /** MySQL 规则：-- 后必须跟空白才算注释（否则 1--1 是 1 - -1） */
  dashNeedsSpace?: boolean
  /** 块注释可嵌套 */
  nestedComments?: boolean
  /** 单引号字符串支持反斜杠转义 */
  bsSingle?: boolean
  /** 双引号支持反斜杠转义 */
  bsDouble?: boolean
  /** $$…$$ / $tag$…$tag$ */
  dollarQuotes?: boolean
  /** [标识符]（T-SQL / SQLite） */
  bracketIdents?: boolean
  /** ''' / """ 三引号字符串（BigQuery） */
  tripleQuotes?: boolean
  /** Oracle 的 q'[…]' 引用 */
  qQuotes?: boolean
  /** PostgreSQL 的 E'…' 支持反斜杠转义 */
  eStrings?: boolean
}

const MYSQL_LIKE: LexProfile = {
  hashComments: true,
  dashNeedsSpace: true,
  bsSingle: true,
  bsDouble: true,
}

const PROFILES: Record<SqlDialect, LexProfile> = {
  sql: { bsSingle: true },
  mysql: MYSQL_LIKE,
  mariadb: MYSQL_LIKE,
  tidb: MYSQL_LIKE,
  singlestoredb: MYSQL_LIKE,
  postgresql: { nestedComments: true, dollarQuotes: true, eStrings: true },
  duckdb: { nestedComments: true, dollarQuotes: true, eStrings: true },
  redshift: {},
  sqlite: { bracketIdents: true },
  plsql: { qQuotes: true },
  transactsql: { nestedComments: true, bracketIdents: true },
  bigquery: { hashComments: true, tripleQuotes: true, bsSingle: true, bsDouble: true },
  hive: { bsSingle: true, bsDouble: true },
  spark: { bsSingle: true, bsDouble: true },
  snowflake: { slashComments: true, dollarQuotes: true, bsSingle: true },
  trino: {},
  clickhouse: { hashComments: true, dollarQuotes: true, bsSingle: true, bsDouble: true },
  db2: {},
  db2i: { nestedComments: true },
  n1ql: { hashComments: true, bsSingle: true, bsDouble: true },
}

export type SqlTokenType =
  'ws' | 'comment' | 'hint' | 'string' | 'ident' | 'placeholder' | 'word' | 'punct' | 'op'

export interface SqlToken {
  type: SqlTokenType
  text: string
  start: number
  /** 字符串 / 注释没有闭合 */
  unterminated?: boolean
}

const WORD_CHAR = /[\p{L}\p{N}_$@]/u
const Q_CLOSE: Record<string, string> = { '[': ']', '(': ')', '{': '}', '<': '>' }

/** 按方言把 SQL 切成词法单元；拼回去（text 相加）与原文完全一致 */
export function tokenizeSql(sql: string, dialect: SqlDialect = 'sql'): SqlToken[] {
  const p = PROFILES[dialect] ?? {}
  const tokens: SqlToken[] = []
  const n = sql.length
  let i = 0

  const push = (type: SqlTokenType, end: number, unterminated = false) => {
    tokens.push({ type, text: sql.slice(i, end), start: i, ...(unterminated && { unterminated }) })
    i = end
  }
  const lineEnd = (from: number) => {
    let j = from
    while (j < n && sql[j] !== '\n' && sql[j] !== '\r') j++
    return j
  }
  /** 引号字符串：doubling=''/"" 转义；bs=反斜杠转义 */
  const quoted = (type: SqlTokenType, open: number, q: string, bs: boolean) => {
    let j = open + q.length
    while (j < n) {
      const c = sql[j]
      if (bs && c === '\\') {
        j += 2
        continue
      }
      if (sql.startsWith(q, j)) {
        if (q.length === 1 && sql[j + 1] === q) {
          j += 2
          continue
        }
        push(type, j + q.length)
        return
      }
      j++
    }
    push(type, n, true)
  }

  while (i < n) {
    const c = sql[i]
    const c2 = sql[i + 1]

    // 空白（含全角空格等 Unicode 空白）
    if (/\s/.test(c)) {
      let j = i + 1
      while (j < n && /\s/.test(sql[j])) j++
      push('ws', j)
      continue
    }

    // MyBatis / 模板占位符 #{…} ${…}
    if ((c === '#' || c === '$') && c2 === '{') {
      const close = sql.indexOf('}', i + 2)
      const nl = lineEnd(i)
      if (close !== -1 && close < nl) {
        push('placeholder', close + 1)
        continue
      }
    }

    // 行注释
    if (
      (c === '-' && c2 === '-' && (!p.dashNeedsSpace || i + 2 >= n || /\s/.test(sql[i + 2]))) ||
      (c === '#' && p.hashComments) ||
      (c === '/' && c2 === '/' && p.slashComments)
    ) {
      push('comment', lineEnd(i))
      continue
    }

    // 块注释（/*+ 优化器提示与 MySQL 的 /*! 可执行注释要保留）
    if (c === '/' && c2 === '*') {
      const keep = sql[i + 2] === '+' || sql[i + 2] === '!'
      let depth = 1
      let j = i + 2
      while (j < n && depth > 0) {
        if (sql[j] === '*' && sql[j + 1] === '/') {
          depth--
          j += 2
        } else if (p.nestedComments && sql[j] === '/' && sql[j + 1] === '*') {
          depth++
          j += 2
        } else j++
      }
      push(keep ? 'hint' : 'comment', j, depth > 0)
      continue
    }

    // 三引号（BigQuery）
    if (p.tripleQuotes && (sql.startsWith("'''", i) || sql.startsWith('"""', i))) {
      quoted('string', i, sql.slice(i, i + 3), true)
      continue
    }

    if (c === "'") {
      const prev = sql[i - 1]
      const eString =
        p.eStrings && (prev === 'e' || prev === 'E') && !WORD_CHAR.test(sql[i - 2] ?? '')
      quoted('string', i, "'", !!p.bsSingle || !!eString)
      continue
    }
    if (c === '"') {
      quoted('ident', i, '"', !!p.bsDouble)
      continue
    }
    if (c === '`') {
      quoted('ident', i, '`', false)
      continue
    }
    if (c === '[' && p.bracketIdents) {
      quoted('ident', i, ']', false)
      continue
    }

    // 美元符引用 $$…$$ / $tag$…$tag$
    if (c === '$' && p.dollarQuotes) {
      const m = /^\$([A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/.exec(sql.slice(i, i + 128))
      if (m) {
        const tag = m[0]
        const close = sql.indexOf(tag, i + tag.length)
        push('string', close === -1 ? n : close + tag.length, close === -1)
        continue
      }
    }

    // Oracle q'[…]'
    if (p.qQuotes && /^[nN]?[qQ]'/.test(sql.slice(i, i + 3)) && !WORD_CHAR.test(sql[i - 1] ?? '')) {
      const qStart = sql[i + 1] === "'" ? i + 2 : i + 3
      const open = sql[qStart]
      if (open && !/\s/.test(open)) {
        const close = (Q_CLOSE[open] ?? open) + "'"
        const end = sql.indexOf(close, qStart + 1)
        push('string', end === -1 ? n : end + 2, end === -1)
        continue
      }
    }

    if (WORD_CHAR.test(c) || (c === '#' && !p.hashComments)) {
      let j = i + 1
      while (j < n && (WORD_CHAR.test(sql[j]) || (sql[j] === '#' && !p.hashComments))) j++
      push('word', j)
      continue
    }

    if (c === '(' || c === ')' || c === ',' || c === ';' || c === '.') {
      push('punct', i + 1)
      continue
    }

    // 其余字符（运算符等）逐个输出；代理对作为一个整体
    const cp = sql.codePointAt(i) ?? 0
    push('op', i + (cp > 0xffff ? 2 : 1))
  }
  return tokens
}

/* ───────────────────────── 压缩 ───────────────────────── */

const TIGHT_AFTER = new Set(['(', ','])
const TIGHT_BEFORE = new Set([')', ',', ';'])

export interface MinifyResult {
  output: string
  warnings: string[]
  /** 去掉的注释数量 */
  commentsRemoved: number
}

/**
 * 压缩成单行：去掉注释，连续空白合并成一个空格，括号 / 逗号 / 分号两侧不留空格。
 * 字符串与带引号的标识符原样保留；必须独占一行的客户端命令（T-SQL 的 GO、
 * Oracle 的 /、MySQL 的 DELIMITER）保留各自的换行。
 */
export function minifySql(sql: string, dialect: SqlDialect = 'sql'): MinifyResult {
  const tokens = tokenizeSql(sql, dialect)
  const warnings: string[] = []
  let commentsRemoved = 0

  // 只保留有意义的 token，并记录它前面是否出现过换行
  const sig: { tok: SqlToken; nlBefore: boolean; gap: boolean }[] = []
  let nl = true
  let gap = false
  for (const t of tokens) {
    if (t.unterminated) {
      const { line, column } = offsetToPosition(sql, t.start)
      const what =
        t.type === 'comment' || t.type === 'hint'
          ? '块注释'
          : t.type === 'ident'
            ? '带引号的标识符'
            : '字符串'
      warnings.push(`第 ${line} 行第 ${column} 列的${what}没有闭合，之后的内容已原样保留。`)
    }
    if (t.type === 'ws') {
      if (/[\n\r]/.test(t.text)) nl = true
      gap = true
      continue
    }
    if (t.type === 'comment' && !t.unterminated) {
      commentsRemoved++
      gap = true
      continue
    }
    sig.push({ tok: t, nlBefore: nl, gap })
    nl = false
    gap = false
  }

  const nlAfter = (k: number) => k + 1 >= sig.length || sig[k + 1].nlBefore
  const isMysql = PROFILES[dialect] === MYSQL_LIKE
  /** 返回该位置的客户端命令占用的 token 数（0 表示不是） */
  const lineCommand = (k: number): number => {
    const { tok, nlBefore } = sig[k]
    if (!nlBefore) return 0
    const word = tok.text.toUpperCase()
    if (dialect === 'transactsql' && tok.type === 'word' && word === 'GO') {
      if (nlAfter(k)) return 1
      if (sig[k + 1]?.tok.type === 'word' && /^\d+$/.test(sig[k + 1].tok.text) && nlAfter(k + 1))
        return 2
    }
    if (dialect === 'plsql' && tok.text === '/' && nlAfter(k)) return 1
    if (isMysql && tok.type === 'word' && word === 'DELIMITER') {
      let j = k + 1
      while (j < sig.length && !sig[j].nlBefore) j++
      return j - k
    }
    return 0
  }

  let out = ''
  let prev: SqlToken | null = null
  let forceBreak = false
  for (let k = 0; k < sig.length; k++) {
    const cmd = lineCommand(k)
    if (cmd > 0) {
      if (out) out += '\n'
      out += sig
        .slice(k, k + cmd)
        .map((s, idx) => (idx > 0 && s.gap ? ' ' : '') + s.tok.text)
        .join('')
      k += cmd - 1
      prev = null
      forceBreak = true
      continue
    }
    const { tok, gap: hadGap } = sig[k]
    if (forceBreak) {
      out += '\n'
      forceBreak = false
    } else if (
      prev &&
      hadGap &&
      !TIGHT_AFTER.has(prev.text) &&
      !TIGHT_BEFORE.has(tok.text) &&
      prev.text !== ';'
    ) {
      out += ' '
    }
    out += tok.text
    prev = tok
  }

  return { output: out, warnings, commentsRemoved }
}

/* ───────────────────────── 美化 ───────────────────────── */

const PLACEHOLDER_RE = /[#$]\{[^{}\n]*\}/g

/** 把 #{…} / ${…} 换成不会与原文冲突的标识符，格式化后再换回来 */
function protectPlaceholders(sql: string): { text: string; restore: (s: string) => string } {
  const found: string[] = []
  let salt = 0
  while (sql.includes(`zqph${salt}x`)) salt++
  const text = sql.replace(PLACEHOLDER_RE, (m) => {
    found.push(m)
    return `zqph${salt}x${found.length - 1}q`
  })
  if (!found.length) return { text: sql, restore: (s) => s }
  const back = new RegExp(`zqph${salt}x(\\d+)q`, 'gi')
  return { text, restore: (s) => s.replace(back, (_, idx: string) => found[Number(idx)]) }
}

export function toFormatterConfig(o: SqlOptions): FormatOptionsWithLanguage {
  return {
    language: o.dialect,
    keywordCase: o.keywordCase,
    dataTypeCase: o.dataTypeCase,
    functionCase: o.functionCase,
    tabWidth: o.indent === '4' ? 4 : 2,
    useTabs: o.indent === 'tab',
    indentStyle: o.indentStyle,
    logicalOperatorNewline: o.logicalOperatorNewline,
    linesBetweenQueries: Math.max(0, Math.min(5, Math.round(o.linesBetweenQueries))),
    denseOperators: o.denseOperators,
  }
}

/** sql-formatter 按 \n 分行、按 UTF-16 计列；换算成按码点计的列号 */
function unitToPointColumn(sql: string, line: number, column: number): number {
  const text = sql.split('\n')[line - 1]
  if (text === undefined) return column
  return Array.from(text.slice(0, Math.max(0, column - 1))).length + 1
}

/** 把 sql-formatter 抛出的英文错误整理成中文 + 行列 */
export function describeSqlError(err: unknown, sql: string, dialect: SqlDialect): SqlIssue {
  const raw = err instanceof Error ? err.message : String(err)
  const hint = `当前方言：${dialectLabel(dialect)}。若语句属于其他数据库，可尝试切换方言。`
  const pos = /at line (\d+) column (\d+)/.exec(raw)
  const line = pos ? Number(pos[1]) : undefined
  // sql-formatter 的列号按 UTF-16 计（emoji 算 2 列），这里换算成按码点计，与摘录和编辑器一致
  const column = pos ? unitToPointColumn(sql, Number(pos[1]), Number(pos[2])) : undefined

  let message: string
  let width = 1
  const unexpected = /^Parse error: Unexpected "([\s\S]*?)" at line/.exec(raw)
  const atToken = /^Parse error at token: ([\s\S]*?) at line/.exec(raw)
  if (unexpected) {
    // 报错里的片段是按 UTF-16 截的 10 个字符：去掉被截断的半个 emoji，只保留到行尾
    const text = unexpected[1]
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
      .split(/\r?\n/)[0]
    const first = text.trimStart()[0] ?? ''
    if (first === "'" || first === '"' || first === '`') {
      message = `无法识别从这里开始的内容：${text.trimEnd()}…（字符串或带引号的标识符可能没有闭合）`
    } else {
      const word = text.trim().split(/\s/)[0]
      message = `无法识别的内容：${word}`
      width = Math.max(1, Array.from(word).length)
    }
  } else if (atToken) {
    const tok = atToken[1]
    if (tok === '«EOF»') message = 'SQL 意外结束：语句不完整，可能缺少右括号或关键字后面的内容'
    else if (tok === ')') message = '意外的右括号 )：括号不匹配，或括号前的表达式不完整'
    else if (tok === '(') message = '意外的左括号 ('
    else if (tok === ',') message = '意外的逗号：逗号前后可能缺少内容'
    else message = `语法解析失败：此处不应出现 ${tok}`
    width = tok === '«EOF»' ? 1 : Math.max(1, Array.from(tok).length)
  } else if (/Unsupported SQL dialect/.test(raw)) {
    return { message: `不支持的 SQL 方言：${dialect}` }
  } else {
    message = `格式化失败：${raw.split('\n')[0]}`
  }

  if (line !== undefined && column !== undefined) {
    return { message, hint, line, column, frame: buildFrame(sql, line, column, { width }) }
  }
  return { message, hint }
}

/**
 * sql-formatter 在部分方言（如 MySQL）里把 IS / NULL / LIKE 等运算符关键字当成普通单词，
 * 导致「关键字大写」时它们仍是小写。这些词在各方言中都是保留字，不可能是未加引号的标识符，
 * 这里按词法单元补上大小写（跳过字符串、注释与 `a.like` 这类属性访问）。
 */
const OPERATOR_KEYWORDS = new Set(['IS', 'NOT', 'NULL', 'LIKE', 'ILIKE', 'RLIKE', 'REGEXP', 'XOR'])

export function applyOperatorKeywordCase(sql: string, dialect: SqlDialect, kc: LetterCase): string {
  if (kc === 'preserve') return sql
  const tokens = tokenizeSql(sql, dialect)
  let changed = false
  let prevSig: SqlToken | null = null
  for (const t of tokens) {
    if (t.type === 'word' && OPERATOR_KEYWORDS.has(t.text.toUpperCase()) && prevSig?.text !== '.') {
      const next = kc === 'upper' ? t.text.toUpperCase() : t.text.toLowerCase()
      if (next !== t.text) {
        t.text = next
        changed = true
      }
    }
    if (t.type !== 'ws' && t.type !== 'comment') prevSig = t
  }
  return changed ? tokens.map((t) => t.text).join('') : sql
}

type PieceResult = { ok: true; output: string } | { ok: false; error: SqlIssue }

/** 把相对某一段的报错位置换算成整段原文中的行列，并重建摘录 */
function relocate(issue: SqlIssue, piece: string, source: string, base: number): SqlIssue {
  if (issue.line === undefined || issue.column === undefined) return issue
  const abs = base + positionToOffset(piece, issue.line, issue.column)
  const { line, column } = offsetToPosition(source, abs)
  const width = issue.frame?.caretWidth ?? 1
  return { ...issue, line, column, frame: buildFrame(source, line, column, { width }) }
}

/** 美化一段 SQL；base 为这段在 source 中的起始偏移（用于报错定位） */
function formatPiece(piece: string, o: SqlOptions, source: string, base: number): PieceResult {
  const { text, restore } = protectPlaceholders(piece)
  const config = toFormatterConfig(o)
  try {
    const formatted = format(text, config)
    return {
      ok: true,
      output: restore(applyOperatorKeywordCase(formatted, o.dialect, o.keywordCase)),
    }
  } catch (e) {
    // 占位符替换后的报错位置与原文不同，用原文重新定位一次
    let err = e
    if (text !== piece) {
      try {
        format(piece, config)
      } catch (e2) {
        err = e2
      }
    }
    const issue = describeSqlError(err, piece, o.dialect)
    return { ok: false, error: piece === source ? issue : relocate(issue, piece, source, base) }
  }
}

interface DelimiterCommand {
  start: number
  end: number
  text: string
  delimiter: string
}

/** 找出 MySQL 客户端的 DELIMITER 命令（跳过字符串与注释里的同名单词） */
export function findDelimiterCommands(sql: string, dialect: SqlDialect): DelimiterCommand[] {
  const out: DelimiterCommand[] = []
  let lineStart = true
  for (const t of tokenizeSql(sql, dialect)) {
    if (t.type === 'ws') {
      if (/[\n\r]/.test(t.text)) lineStart = true
      continue
    }
    if (lineStart && t.type === 'word' && t.text.toUpperCase() === 'DELIMITER') {
      let end = t.start + t.text.length
      while (end < sql.length && sql[end] !== '\n' && sql[end] !== '\r') end++
      // mysql 客户端取 DELIMITER 后的第一个词作为新分隔符
      const delimiter = sql
        .slice(t.start + t.text.length, end)
        .trim()
        .split(/\s+/)[0]
      if (delimiter) {
        out.push({ start: t.start, end, text: sql.slice(t.start, end).trimEnd(), delimiter })
      }
    }
    if (out.length && out[out.length - 1].end > t.start) continue
    lineStart = false
  }
  return out
}

/** 按自定义分隔符切分语句（分隔符出现在字符串、注释、带引号的标识符里时不算） */
function splitByDelimiter(
  piece: string,
  delimiter: string,
  dialect: SqlDialect,
): { text: string; start: number; terminated: boolean }[] {
  const shielded = new Uint8Array(piece.length)
  for (const t of tokenizeSql(piece, dialect)) {
    if (t.type === 'string' || t.type === 'ident' || t.type === 'comment' || t.type === 'hint')
      shielded.fill(1, t.start, t.start + t.text.length)
  }
  const parts: { text: string; start: number; terminated: boolean }[] = []
  let from = 0
  for (let i = piece.indexOf(delimiter); i !== -1; i = piece.indexOf(delimiter, i)) {
    if (shielded[i]) {
      i++
      continue
    }
    parts.push({ text: piece.slice(from, i), start: from, terminated: true })
    from = i + delimiter.length
    i = from
  }
  parts.push({ text: piece.slice(from), start: from, terminated: false })
  return parts.filter((p) => p.text.trim())
}

/**
 * 含 DELIMITER 命令的 MySQL 脚本（存储过程、触发器）：sql-formatter 不认识这个客户端命令，
 * 会把 `DELIMITER //` 拆成 `DELIMITER / /` 而破坏脚本。这里把命令行原样保留，
 * 其余部分按当前分隔符切成语句逐条美化，再补回分隔符。
 */
function formatDelimiterScript(
  sql: string,
  o: SqlOptions,
  commands: DelimiterCommand[],
): SqlResult {
  const blocks: string[] = []
  let delimiter = ';'
  let pos = 0
  const flush = (end: number): SqlIssue | null => {
    const piece = sql.slice(pos, end)
    if (!piece.trim()) return null
    if (delimiter === ';') {
      const r = formatPiece(piece, o, sql, pos)
      if (!r.ok) return r.error
      blocks.push(r.output)
      return null
    }
    for (const part of splitByDelimiter(piece, delimiter, o.dialect)) {
      const r = formatPiece(part.text, o, sql, pos + part.start)
      if (!r.ok) return r.error
      blocks.push(part.terminated ? r.output + delimiter : r.output)
    }
    return null
  }
  for (const cmd of commands) {
    const err = flush(cmd.start)
    if (err) return { ok: false, error: err }
    blocks.push(cmd.text)
    delimiter = cmd.delimiter
    pos = cmd.end
  }
  const err = flush(sql.length)
  if (err) return { ok: false, error: err }
  // DELIMITER 命令紧贴前后的语句（常见写法），语句之间按「语句间空行」分隔
  const gap = '\n'.repeat(1 + Math.max(0, Math.min(5, Math.round(o.linesBetweenQueries))))
  const isCmd = new Set(commands.map((c) => c.text))
  let output = ''
  blocks.forEach((b, i) => {
    if (i > 0) output += isCmd.has(b) || isCmd.has(blocks[i - 1]) ? '\n' : gap
    output += b
  })
  return { ok: true, output, warnings: [] }
}

export function formatSql(sql: string, o: SqlOptions = DEFAULT_SQL_OPTIONS): SqlResult {
  if (!sql.trim()) return { ok: true, output: '', warnings: [] }
  if (o.mode === 'minify') {
    const r = minifySql(sql, o.dialect)
    return { ok: true, output: r.output, warnings: r.warnings, commentsRemoved: r.commentsRemoved }
  }
  if (PROFILES[o.dialect] === MYSQL_LIKE && /\bDELIMITER\b/i.test(sql)) {
    const commands = findDelimiterCommands(sql, o.dialect)
    if (commands.length) return formatDelimiterScript(sql, o, commands)
  }
  const r = formatPiece(sql, o, sql, 0)
  return r.ok ? { ok: true, output: r.output, warnings: [] } : r
}
