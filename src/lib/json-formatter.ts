/**
 * JSON 格式化核心（纯函数，无 DOM 依赖）：
 * - 自研分词 / 递归下降解析器：精确到行列的中文错误信息
 * - 数字按原文保存，12345678901234567890 这样的大数不会丢精度
 * - 宽松模式（JSON5 风格）：注释、尾随逗号、单引号、无引号键名、十六进制、NaN / Infinity
 * - 打印：缩进 2 / 4 / Tab、递归键排序、压缩、非 ASCII 转 \uXXXX
 * - 转义 / 去转义（支持多层转义）、JSONPath、统计
 */

import { LineIndex, positionAt, utf8Length } from './json-formatter-position'

export { utf8Length }

/* ───────────────────────── AST ───────────────────────── */

interface NodeBase {
  /** 在源文本中的起止偏移（UTF-16） */
  start: number
  end: number
}

export interface JsonObject extends NodeBase {
  type: 'object'
  entries: JsonProperty[]
}

export interface JsonProperty {
  key: string
  keyStart: number
  value: JsonValue
}

export interface JsonArray extends NodeBase {
  type: 'array'
  items: JsonValue[]
}

export interface JsonString extends NodeBase {
  type: 'string'
  value: string
}

export interface JsonNumber extends NodeBase {
  type: 'number'
  /** 规范化后的 JSON 数字原文；NaN / Infinity 时为 'NaN' | 'Infinity' | '-Infinity' */
  raw: string
  /** NaN / Infinity（仅宽松模式），打印时输出 null */
  nonFinite?: boolean
}

export interface JsonBoolean extends NodeBase {
  type: 'boolean'
  value: boolean
}

export interface JsonNull extends NodeBase {
  type: 'null'
}

export type JsonValue = JsonObject | JsonArray | JsonString | JsonNumber | JsonBoolean | JsonNull

/* ───────────────────────── 错误与提示 ───────────────────────── */

export interface JsonIssue {
  message: string
  /** 进一步的修改建议 */
  hint?: string
  line: number
  column: number
  offset: number
  /** 开启宽松模式即可解析 */
  lenientFixable?: boolean
}

/** 「第 3 行第 15 列：缺少逗号」 */
export function formatIssue(issue: Pick<JsonIssue, 'line' | 'column' | 'message'>): string {
  return `第 ${issue.line} 行第 ${issue.column} 列：${issue.message}`
}

export type LenientFix =
  | 'comment'
  | 'trailingComma'
  | 'singleQuote'
  | 'unquotedKey'
  | 'hexNumber'
  | 'specialNumber'
  | 'numberFormat'
  | 'escape'
  | 'whitespace'

export const LENIENT_FIX_LABELS: Record<LenientFix, string> = {
  comment: '注释',
  trailingComma: '尾随逗号',
  singleQuote: '单引号字符串',
  unquotedKey: '无引号键名',
  hexNumber: '十六进制数字',
  specialNumber: 'NaN / Infinity',
  numberFormat: '非标准数字写法',
  escape: '非标准转义',
  whitespace: '特殊空白字符',
}

export type LenientFixCounts = Partial<Record<LenientFix, number>>

export interface ParseOptions {
  /** 宽松模式（JSON5 风格） */
  lenient?: boolean
  /** 最大嵌套层数，防止栈溢出 */
  maxDepth?: number
}

export type ParseResult =
  | { ok: true; value: JsonValue; warnings: JsonIssue[]; fixes: LenientFixCounts }
  | { ok: false; error: JsonIssue }

export const DEFAULT_MAX_DEPTH = 1000
const MAX_WARNINGS = 50

class SyntaxFail extends Error {
  readonly offset: number
  readonly detail: { hint?: string; lenientFixable?: boolean }
  constructor(
    offset: number,
    message: string,
    detail: { hint?: string; lenientFixable?: boolean },
  ) {
    super(message)
    this.offset = offset
    this.detail = detail
  }
}

/* ───────────────────────── 字符工具 ───────────────────────── */

const FULLWIDTH: Record<string, { name: string; ascii: string }> = {
  '，': { name: '中文逗号', ascii: ',' },
  '：': { name: '中文冒号', ascii: ':' },
  '“': { name: '中文引号', ascii: '"' },
  '”': { name: '中文引号', ascii: '"' },
  '‘': { name: '中文单引号', ascii: "'" },
  '’': { name: '中文单引号', ascii: "'" },
  '【': { name: '中文方括号', ascii: '[' },
  '】': { name: '中文方括号', ascii: ']' },
  '［': { name: '全角方括号', ascii: '[' },
  '］': { name: '全角方括号', ascii: ']' },
  '｛': { name: '全角花括号', ascii: '{' },
  '｝': { name: '全角花括号', ascii: '}' },
  '（': { name: '中文括号', ascii: '(' },
  '）': { name: '中文括号', ascii: ')' },
  '；': { name: '中文分号', ascii: ';' },
  '、': { name: '顿号', ascii: ',' },
}

const INVISIBLE: Record<number, string> = {
  0x00a0: '不换行空格',
  0x1680: '欧甘空格',
  0x2000: '特殊空格',
  0x2001: '特殊空格',
  0x2002: '半角空格',
  0x2003: '全角空格',
  0x2004: '特殊空格',
  0x2005: '特殊空格',
  0x2006: '特殊空格',
  0x2007: '数字空格',
  0x2008: '标点空格',
  0x2009: '窄空格',
  0x200a: '极窄空格',
  0x200b: '零宽空格',
  0x200c: '零宽非连接符',
  0x200d: '零宽连接符',
  0x2028: '行分隔符',
  0x2029: '段分隔符',
  0x202f: '窄不换行空格',
  0x205f: '数学空格',
  0x2060: '零宽不换行符',
  0x3000: '全角空格',
  0xfeff: 'BOM / 零宽不换行空格',
  0x000b: '垂直制表符',
  0x000c: '换页符',
}

function hex4(c: number): string {
  return c.toString(16).toUpperCase().padStart(4, '0')
}

/** 描述一个字符，用于错误信息：「"x"」「不可见字符 U+200B（零宽空格）」 */
export function describeChar(ch: string): string {
  if (!ch) return '文本结尾'
  const c = ch.codePointAt(0)!
  if (INVISIBLE[c]) return `不可见字符 U+${hex4(c)}（${INVISIBLE[c]}）`
  if (c < 0x20 || c === 0x7f) return `控制字符 U+${hex4(c)}`
  if (FULLWIDTH[ch]) return `${FULLWIDTH[ch].name}「${ch}」`
  return `"${ch}"`
}

const ID_START = /[\p{ID_Start}$_]/u
const ID_CONTINUE = /[\p{ID_Continue}$\u200C\u200D]/u

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57
}

function isHexDigit(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
}

/** 取 i 处的完整字符（处理代理对） */
function charAt(s: string, i: number): string {
  const c = s.codePointAt(i)
  return c === undefined ? '' : String.fromCodePoint(c)
}

/** 拼写接近 true / false / null（少打、多打或打错一个字母，或只打了开头）时返回猜测 */
function nearKeyword(word: string): string | undefined {
  for (const k of ['true', 'false', 'null']) {
    if (word.length >= 2 && k.startsWith(word)) return k
    if (Math.abs(word.length - k.length) > 1) continue
    // 编辑距离 ≤ 1（含相邻字母交换）
    let i = 0
    while (i < word.length && word[i] === k[i]) i++
    if (
      word.slice(i + 1) === k.slice(i + 1) || // 替换
      word.slice(i) === k.slice(i + 1) || // 少一个字母
      word.slice(i + 1) === k.slice(i) || // 多一个字母
      (word[i] === k[i + 1] && word[i + 1] === k[i] && word.slice(i + 2) === k.slice(i + 2))
    )
      return k
  }
  return undefined
}

const CONTROL_ESCAPES: Record<number, string> = {
  8: '\\b',
  9: '\\t',
  10: '\\n',
  12: '\\f',
  13: '\\r',
}

/* ───────────────────────── 解析器 ───────────────────────── */

class Parser {
  i = 0
  depth = 0
  readonly fixes: LenientFixCounts = {}
  readonly warnings: JsonIssue[] = []
  private index: LineIndex | null = null
  readonly s: string
  readonly lenient: boolean
  readonly maxDepth: number

  constructor(s: string, lenient: boolean, maxDepth: number) {
    this.s = s
    this.lenient = lenient
    this.maxDepth = maxDepth
  }

  fail(offset: number, message: string, hint?: string, lenientFixable?: boolean): never {
    throw new SyntaxFail(offset, message, { hint, lenientFixable })
  }

  /** 严格模式下遇到宽松语法：报错；宽松模式下记一次修正 */
  loose(kind: LenientFix, offset: number, message: string, hint?: string) {
    if (!this.lenient) this.fail(offset, message, hint ?? '开启「宽松模式」即可接受这种写法', true)
    this.fixes[kind] = (this.fixes[kind] ?? 0) + 1
  }

  pos(offset: number) {
    this.index ??= new LineIndex(this.s)
    return this.index.position(offset)
  }

  where(offset: number): string {
    const p = this.pos(offset)
    return `第 ${p.line} 行第 ${p.column} 列`
  }

  warn(offset: number, message: string, hint?: string) {
    if (this.warnings.length >= MAX_WARNINGS) return
    const p = this.pos(offset)
    this.warnings.push({ message, hint, line: p.line, column: p.column, offset })
  }

  parse(): JsonValue {
    const s = this.s
    if (s.charCodeAt(0) === 0xfeff) this.i = 1
    this.skipWs()
    if (this.i >= s.length) this.fail(this.i, '内容为空：没有找到任何 JSON 值')
    const value = this.parseValue('root')
    this.skipWs()
    if (this.i < s.length) {
      const i = this.i
      const ch = charAt(s, i)
      if (ch === '}' || ch === ']')
        this.fail(i, `多余的右括号 "${ch}"：前面的 JSON 已经完整结束`, '检查括号是否成对出现')
      if (ch === ',')
        this.fail(
          i,
          '根值后面多了逗号：一个 JSON 文档只能有一个根值',
          '多个值请用 [ ] 包成数组；如果是 JSON Lines，请逐行处理',
        )
      this.fail(
        i,
        `根值之后还有多余的内容 ${describeChar(ch)}：一个 JSON 文档只能有一个根值`,
        '多个值请用 [ ] 包成数组，或检查是否少了逗号 / 括号',
      )
    }
    return value
  }

  skipWs() {
    const s = this.s
    for (;;) {
      const c = s.charCodeAt(this.i)
      if (c === 32 || c === 10 || c === 13 || c === 9) {
        this.i++
        continue
      }
      if (c === 47) {
        const n = s.charCodeAt(this.i + 1)
        if (n === 47 || n === 42) {
          this.skipComment(n === 42)
          continue
        }
        return
      }
      if (c in INVISIBLE) {
        this.loose(
          'whitespace',
          this.i,
          `${describeChar(s[this.i])}：标准 JSON 只允许空格、制表符和换行作为空白`,
          '通常是从网页或文档复制时带进来的，删掉即可；或开启「宽松模式」自动忽略',
        )
        this.i++
        continue
      }
      return
    }
  }

  skipComment(block: boolean) {
    const s = this.s
    const start = this.i
    this.loose('comment', start, '标准 JSON 不支持注释')
    if (block) {
      const end = s.indexOf('*/', start + 2)
      if (end < 0) this.fail(start, '块注释没有结束：缺少 "*/"')
      this.i = end + 2
    } else {
      let i = start + 2
      while (i < s.length) {
        const c = s.charCodeAt(i)
        if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) break
        i++
      }
      this.i = i
    }
  }

  parseValue(ctx: 'root' | 'array' | 'property', key?: string): JsonValue {
    this.skipWs()
    const s = this.s
    const i = this.i
    if (i >= s.length) {
      if (ctx === 'property') this.fail(i, `JSON 意外结束：属性 "${key}" 缺少值`)
      if (ctx === 'array') this.fail(i, 'JSON 意外结束：数组缺少元素或右方括号 "]"')
      this.fail(i, 'JSON 意外结束：缺少值')
    }
    const c = s.charCodeAt(i)
    switch (c) {
      case 123: // {
        return this.parseObject()
      case 91: // [
        return this.parseArray()
      case 34: // "
        return this.parseString(34)
      case 39: // '
        this.loose('singleQuote', i, '字符串必须使用双引号 "，不能使用单引号')
        return this.parseString(39)
      case 45: // -
      case 43: // +
      case 46: // .
        return this.parseNumber()
    }
    if (isDigit(c)) return this.parseNumber()
    const ch = charAt(s, i)
    if (ID_START.test(ch)) return this.parseKeyword()

    // 出错：根据上下文给出更具体的提示
    if (ch === ',' || ch === '}' || ch === ']') {
      if (ctx === 'property')
        this.fail(i, `缺少值：属性 "${key}" 的冒号后面应该是一个值`, '例如 "", 0, null, {} 或 []')
      if (ctx === 'array' && ch === ',')
        this.fail(i, '数组中多了一个逗号（或缺少元素）', '删掉多余的 ","，或在两个逗号之间补上值')
    }
    this.unexpected(i, '一个值（对象、数组、字符串、数字、true、false 或 null）')
  }

  unexpected(i: number, expected: string): never {
    const ch = charAt(this.s, i)
    const fw = FULLWIDTH[ch]
    if (fw)
      this.fail(
        i,
        `这里用了${fw.name}「${ch}」，JSON 只认英文半角符号 "${fw.ascii}"`,
        '可以把输入法切到英文标点后重新输入',
      )
    if (ch === '`') this.fail(i, 'JSON 不支持反引号字符串，请使用双引号 "')
    this.fail(
      i,
      `意外的${describeChar(ch).startsWith('"') ? '字符 ' : ''}${describeChar(ch)}：这里应是${expected}`,
    )
  }

  enter(offset: number) {
    if (++this.depth > this.maxDepth) this.fail(offset, `嵌套层级过深：超过 ${this.maxDepth} 层`)
  }

  parseObject(): JsonObject {
    const s = this.s
    const start = this.i
    this.enter(start)
    this.i++
    const entries: JsonProperty[] = []
    const seen = new Map<string, number>()
    let commaAt = -1
    for (;;) {
      this.skipWs()
      const i = this.i
      if (i >= s.length) {
        this.fail(
          i,
          'JSON 意外结束：对象缺少右花括号 "}"',
          `与${this.where(start)}的 "{" 对应的 "}" 没有找到`,
        )
      }
      const c = s.charCodeAt(i)
      if (c === 125) {
        // }
        if (commaAt >= 0)
          this.loose('trailingComma', commaAt, '多余的逗号：对象最后一个属性后面不能有逗号')
        this.i++
        break
      }
      if (commaAt < 0 && entries.length > 0) {
        // 上一个属性后面既不是 "," 也不是 "}"
        this.afterItem(start, '}', entries[entries.length - 1].value.end)
      }

      // 键
      let key: string
      const keyStart = i
      if (c === 34) key = this.parseStringRaw(34)
      else if (c === 39) {
        this.loose('singleQuote', i, '属性名必须使用双引号 "，不能使用单引号')
        key = this.parseStringRaw(39)
      } else if (ID_START.test(charAt(s, i)) || c === 92) {
        const word = this.readIdentifier()
        this.loose(
          'unquotedKey',
          i,
          `属性名必须用双引号包裹：${word}`,
          `应写作 "${word}"；开启「宽松模式」可接受无引号键名`,
        )
        key = word
      } else if (c === 44) {
        this.fail(i, '多余的逗号：这里应是属性名', '删掉这个 ","')
      } else if (c === 93) {
        this.fail(i, `括号不匹配：${this.where(start)}的 "{" 需要用 "}" 闭合，这里却是 "]"`)
      } else {
        this.unexpected(i, '属性名（用双引号包裹的字符串）')
      }
      const keyEnd = this.i

      // 冒号
      this.skipWs()
      if (s.charCodeAt(this.i) !== 58) {
        if (this.i >= s.length) this.fail(this.i, `JSON 意外结束：属性 "${key}" 后面缺少冒号和值`)
        if (s[this.i] === '：')
          this.fail(this.i, '这里用了中文冒号「：」，JSON 只认英文半角冒号 ":"')
        this.fail(keyEnd, `缺少冒号：属性名 "${key}" 后面应有 ":"`)
      }
      this.i++

      const value = this.parseValue('property', key)
      const prev = seen.get(key)
      if (prev !== undefined) {
        const p = this.pos(prev)
        this.warn(
          keyStart,
          `重复的键 "${key}"：第 ${p.line} 行已经出现过`,
          '多数解析器（包括 JSON.parse）只保留最后一个值',
        )
      } else seen.set(key, keyStart)
      entries.push({ key, keyStart, value })

      this.skipWs()
      if (s.charCodeAt(this.i) === 44) {
        commaAt = this.i
        this.i++
      } else commaAt = -1
    }
    this.depth--
    return { type: 'object', entries, start, end: this.i }
  }

  parseArray(): JsonArray {
    const s = this.s
    const start = this.i
    this.enter(start)
    this.i++
    const items: JsonValue[] = []
    let commaAt = -1
    for (;;) {
      this.skipWs()
      const i = this.i
      if (i >= s.length) {
        this.fail(
          i,
          'JSON 意外结束：数组缺少右方括号 "]"',
          `与${this.where(start)}的 "[" 对应的 "]" 没有找到`,
        )
      }
      const c = s.charCodeAt(i)
      if (c === 93) {
        if (commaAt >= 0)
          this.loose('trailingComma', commaAt, '多余的逗号：数组最后一个元素后面不能有逗号')
        this.i++
        break
      }
      if (commaAt < 0 && items.length > 0) this.afterItem(start, ']', items[items.length - 1].end)
      if (c === 44 && items.length === 0)
        this.fail(i, '数组开头多了一个逗号', '删掉这个 ","，或在它前面补上元素')
      if (c === 125)
        this.fail(i, `括号不匹配：${this.where(start)}的 "[" 需要用 "]" 闭合，这里却是 "}"`)
      items.push(this.parseValue('array'))
      this.skipWs()
      if (s.charCodeAt(this.i) === 44) {
        commaAt = this.i
        this.i++
      } else commaAt = -1
    }
    this.depth--
    return { type: 'array', items, start, end: this.i }
  }

  /** 一个元素之后既不是逗号也不是右括号：给出尽量准确的诊断 */
  afterItem(open: number, close: '}' | ']', prevEnd: number): never {
    const s = this.s
    const i = this.i
    const ch = charAt(s, i)
    const openCh = close === '}' ? '{' : '['
    const other = close === '}' ? ']' : '}'
    if (ch === other)
      this.fail(
        i,
        `括号不匹配：${this.where(open)}的 "${openCh}" 需要用 "${close}" 闭合，这里却是 "${other}"`,
      )
    const fw = FULLWIDTH[ch]
    if (fw && (fw.ascii === ',' || fw.ascii === close))
      this.fail(i, `这里用了${fw.name}「${ch}」，JSON 只认英文半角符号 "${fw.ascii}"`)
    const startsValue =
      ch === '"' ||
      ch === "'" ||
      ch === '{' ||
      ch === '[' ||
      ch === '-' ||
      isDigit(s.charCodeAt(i)) ||
      ID_START.test(ch)
    // 紧挨着上一个值的字母（如 "x"y）更可能是多打了字符
    if (startsValue && !(i === prevEnd && ID_START.test(ch))) {
      const what = close === '}' ? '属性' : '元素'
      const next = this.pos(i)
      this.fail(
        prevEnd,
        `缺少逗号：${what}之间需要用 "," 分隔`,
        `在这里补上 ","（下一个${what}从第 ${next.line} 行第 ${next.column} 列开始）`,
      )
    }
    this.unexpected(i, ` "," 或 "${close}"`)
  }

  readIdentifier(): string {
    const s = this.s
    let out = ''
    let i = this.i
    while (i < s.length) {
      const ch = charAt(s, i)
      if (ch === '\\' && s[i + 1] === 'u' && this.lenient) {
        const h = s.slice(i + 2, i + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(h)) this.fail(i, '"\\u" 后面需要 4 位十六进制数字')
        out += String.fromCharCode(parseInt(h, 16))
        i += 6
        continue
      }
      if (out === '' ? ID_START.test(ch) : ID_CONTINUE.test(ch)) {
        out += ch
        i += ch.length
      } else break
    }
    if (!out) this.unexpected(i, '属性名')
    this.i = i
    return out
  }

  parseKeyword(): JsonValue {
    const s = this.s
    const start = this.i
    let i = start
    while (i < s.length) {
      const ch = charAt(s, i)
      if (!ID_CONTINUE.test(ch)) break
      i += ch.length
    }
    const word = s.slice(start, i)
    this.i = i
    if (word === 'true' || word === 'false')
      return { type: 'boolean', value: word === 'true', start, end: i }
    if (word === 'null') return { type: 'null', start, end: i }
    if (word === 'NaN' || word === 'Infinity') {
      this.loose(
        'specialNumber',
        start,
        `${word} 不是合法的 JSON 值`,
        '可改为 null 或字符串；开启「宽松模式」可接受（输出时会转为 null）',
      )
      return this.special(word, start)
    }
    const lower = word.toLowerCase()
    if (lower === 'true' || lower === 'false' || lower === 'null')
      this.fail(start, `关键字必须全部小写：应为 ${lower}`)
    if (word === 'None') this.fail(start, 'None 是 Python 的写法，JSON 中应为 null')
    if (word === 'undefined')
      this.fail(start, 'undefined 不是合法的 JSON 值', '可改为 null，或删掉这个属性')
    if (lower === 'nil') this.fail(start, `${word} 不是合法的 JSON 值，空值应写作 null`)
    const guess = nearKeyword(lower)
    if (guess) this.fail(start, `无效的值 ${word}：是不是想写 ${guess}？`)
    this.fail(start, `字符串必须用双引号包裹：${word}`, `应写作 "${word}"`)
  }

  special(word: string, start: number, sign = ''): JsonNumber {
    const raw = word === 'NaN' ? 'NaN' : sign === '-' ? '-Infinity' : 'Infinity'
    this.warn(start, `${raw} 无法用标准 JSON 表示，输出时已转为 null`)
    return { type: 'number', raw, nonFinite: true, start, end: this.i }
  }

  parseNumber(): JsonNumber {
    const s = this.s
    const start = this.i
    let i = start
    let sign = ''
    if (s[i] === '-') {
      sign = '-'
      i++
    } else if (s[i] === '+') {
      this.loose('numberFormat', i, '数字不能以 "+" 开头', '删掉 "+"；开启「宽松模式」可接受')
      i++
    }
    // NaN / Infinity 带符号
    if (ID_START.test(charAt(s, i))) {
      let j = i
      while (j < s.length && ID_CONTINUE.test(charAt(s, j))) j++
      const word = s.slice(i, j)
      if (word === 'Infinity' || word === 'NaN') {
        this.loose(
          'specialNumber',
          start,
          `${s.slice(start, j)} 不是合法的 JSON 值`,
          '可改为 null 或字符串；开启「宽松模式」可接受（输出时会转为 null）',
        )
        this.i = j
        return this.special(word, start, sign)
      }
      this.fail(i, `${sign ? '负号' : '正号'}后面缺少数字`)
    }
    // 十六进制
    if (s[i] === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X')) {
      let j = i + 2
      while (j < s.length && isHexDigit(s.charCodeAt(j))) j++
      if (j === i + 2) this.fail(j, '十六进制数字 "0x" 后面缺少数字')
      this.loose('hexNumber', start, `标准 JSON 不支持十六进制数字：${s.slice(start, j)}`)
      this.i = j
      this.checkNumberEnd(start)
      const v = BigInt('0x' + s.slice(i + 2, j)).toString()
      return { type: 'number', raw: sign === '-' && v !== '0' ? '-' + v : v, start, end: j }
    }
    // 整数部分
    let int = ''
    if (s[i] === '0') {
      int = '0'
      i++
      if (isDigit(s.charCodeAt(i))) {
        let j = i
        while (isDigit(s.charCodeAt(j))) j++
        this.fail(
          start,
          `数字不能有前导零：${s.slice(start, j)}`,
          '去掉开头的 0；如果是编号、手机号等，请用字符串',
        )
      }
    } else if (isDigit(s.charCodeAt(i))) {
      const j = i
      while (isDigit(s.charCodeAt(i))) i++
      int = s.slice(j, i)
    } else if (s[i] === '.') {
      this.loose('numberFormat', i, '数字不能以小数点开头', '例如 .5 应写作 0.5')
      int = '0'
    } else {
      this.fail(i, sign ? '负号后面缺少数字' : '正号后面缺少数字')
    }
    // 小数部分
    let frac = ''
    if (s[i] === '.') {
      i++
      const j = i
      while (isDigit(s.charCodeAt(i))) i++
      frac = s.slice(j, i)
      if (!frac) {
        if (s[j - 2] === undefined || !isDigit(s.charCodeAt(j - 2)))
          this.fail(j - 1, '无效的数字：只有一个小数点')
        this.loose('numberFormat', j - 1, '小数点后面缺少数字', '例如 5. 应写作 5 或 5.0')
      }
    }
    // 指数部分
    let exp = ''
    if (s[i] === 'e' || s[i] === 'E') {
      const j = i
      i++
      if (s[i] === '+' || s[i] === '-') i++
      if (!isDigit(s.charCodeAt(i))) this.fail(i, '指数部分缺少数字', '例如 1e10、2.5E-3')
      while (isDigit(s.charCodeAt(i))) i++
      exp = s.slice(j, i)
    }
    this.i = i
    this.checkNumberEnd(start)
    return { type: 'number', raw: sign + int + (frac ? '.' + frac : '') + exp, start, end: i }
  }

  /** 数字后面紧跟字母 / 数字 / 小数点，说明整个 token 无效 */
  checkNumberEnd(start: number) {
    const s = this.s
    const ch = charAt(s, this.i)
    if (ch && (ID_CONTINUE.test(ch) || ch === '.')) {
      let j = this.i
      while (j < s.length && (ID_CONTINUE.test(charAt(s, j)) || s[j] === '.')) j++
      this.fail(start, `无效的数字：${s.slice(start, j)}`, '如果这是文本，请用双引号包裹')
    }
  }

  parseString(quote: number): JsonString {
    const start = this.i
    const value = this.parseStringRaw(quote)
    return { type: 'string', value, start, end: this.i }
  }

  /** 解析字符串字面量（this.i 指向开头引号），返回解码后的内容 */
  parseStringRaw(quote: number): string {
    const s = this.s
    const start = this.i
    let i = start + 1
    let out = ''
    let chunk = i
    const q = String.fromCharCode(quote)
    for (;;) {
      if (i >= s.length)
        this.fail(
          start,
          `字符串没有结束：缺少右引号 ${q}`,
          '检查这个字符串的结尾引号是否漏掉或被转义了',
        )
      const c = s.charCodeAt(i)
      if (c === quote) {
        out += s.slice(chunk, i)
        this.i = i + 1
        return out
      }
      if (c === 92) {
        out += s.slice(chunk, i)
        i = this.parseEscape(i, (piece) => (out += piece))
        chunk = i
        continue
      }
      if (c < 0x20) {
        if (c === 10 || c === 13)
          this.fail(
            i,
            '字符串中不能直接换行',
            `换行请写作 \\n；也可能是上一行的字符串漏了右引号 ${q}（字符串起始于${this.where(start)}）`,
          )
        if (!(this.lenient && c === 9))
          this.fail(
            i,
            `字符串中包含未转义的${describeChar(s[i])}`,
            `请写作 ${CONTROL_ESCAPES[c] ?? '\\u' + hex4(c)}${c === 9 ? '；开启「宽松模式」可接受制表符' : ''}`,
            c === 9,
          )
      }
      i++
    }
  }

  /** 解析 i 处的转义序列，返回下一个位置 */
  parseEscape(i: number, emit: (s: string) => void): number {
    const s = this.s
    const e = s[i + 1]
    switch (e) {
      case '"':
      case '\\':
      case '/':
        emit(e)
        return i + 2
      case 'b':
        emit('\b')
        return i + 2
      case 'f':
        emit('\f')
        return i + 2
      case 'n':
        emit('\n')
        return i + 2
      case 'r':
        emit('\r')
        return i + 2
      case 't':
        emit('\t')
        return i + 2
      case 'u': {
        const h = s.slice(i + 2, i + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(h))
          this.fail(i, '"\\u" 后面需要 4 位十六进制数字', '例如 \\u4E2D 表示「中」')
        emit(String.fromCharCode(parseInt(h, 16)))
        return i + 6
      }
      case undefined:
        this.fail(i, '字符串没有结束：反斜杠后面缺少内容')
    }
    // JSON5 扩展转义
    const json5 = "'v0x\n\r\u2028\u2029"
    if (json5.includes(e) || (!/[0-9]/.test(e) && this.lenient)) {
      this.loose('escape', i, `无效的转义序列 "\\${e === '\n' ? '(换行)' : e}"`, VALID_ESCAPES)
      if (e === "'") emit("'")
      else if (e === 'v') emit('\v')
      else if (e === '0') {
        if (isDigit(s.charCodeAt(i + 2))) this.fail(i, '"\\0" 后面不能紧跟数字')
        emit('\0')
      } else if (e === 'x') {
        const h = s.slice(i + 2, i + 4)
        if (!/^[0-9a-fA-F]{2}$/.test(h)) this.fail(i, '"\\x" 后面需要 2 位十六进制数字')
        emit(String.fromCharCode(parseInt(h, 16)))
        return i + 4
      } else if (e === '\r') {
        return s[i + 2] === '\n' ? i + 3 : i + 2
      } else if (e === '\n' || e === '\u2028' || e === '\u2029') {
        return i + 2
      } else {
        const ch = charAt(s, i + 1)
        emit(ch)
        return i + 1 + ch.length
      }
      return i + 2
    }
    const winPath = /^[A-Za-z]:$/.test(s.slice(i - 2, i)) || e === 'U' || e === 'W' || e === 'P'
    this.fail(
      i,
      `无效的转义序列 "\\${charAt(s, i + 1)}"`,
      winPath ? `Windows 路径里的反斜杠要写成 "\\\\"，例如 "C:\\\\Users"` : VALID_ESCAPES,
    )
  }
}

const VALID_ESCAPES =
  '合法的转义只有 \\" \\\\ \\/ \\b \\f \\n \\r \\t 和 \\uXXXX；反斜杠本身要写成 \\\\'

/** 解析 JSON 文本 */
export function parseJson(text: string, opts: ParseOptions = {}): ParseResult {
  const p = new Parser(text, !!opts.lenient, opts.maxDepth ?? DEFAULT_MAX_DEPTH)
  try {
    const value = p.parse()
    return { ok: true, value, warnings: p.warnings, fixes: p.fixes }
  } catch (e) {
    if (e instanceof SyntaxFail) {
      const pos = positionAt(text, e.offset)
      return {
        ok: false,
        error: { message: e.message, ...pos, ...stripUndefined(e.detail) },
      }
    }
    if (e instanceof RangeError) {
      const pos = positionAt(text, p.i)
      return { ok: false, error: { message: '嵌套层级过深，超出了浏览器的处理能力', ...pos } }
    }
    throw e
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {}
  for (const k in o) if (o[k] !== undefined) out[k] = o[k]
  return out
}

/* ───────────────────────── 打印 ───────────────────────── */

export type IndentOption = 2 | 4 | 'tab'

export interface PrintOptions {
  /** 缩进：空格数或 'tab'；0 表示压缩为一行 */
  indent?: number | 'tab'
  /** 递归按键名排序 */
  sortKeys?: boolean
  /** 非 ASCII 字符转为 \uXXXX */
  escapeUnicode?: boolean
}

// eslint-disable-next-line no-control-regex -- 需要匹配控制字符才能转义它们
const NEEDS_ESCAPE = /["\\\u0000-\u001f\ud800-\udfff]/
// eslint-disable-next-line no-control-regex -- 需要匹配控制字符才能转义它们
const NEEDS_ESCAPE_ASCII = /["\\\u0000-\u001f\u007f-\uffff]/

/** 把字符串序列化为 JSON 字符串字面量（与 JSON.stringify 一致，另可转义非 ASCII） */
export function quoteJsonString(str: string, escapeUnicode = false): string {
  if (!(escapeUnicode ? NEEDS_ESCAPE_ASCII : NEEDS_ESCAPE).test(str)) return `"${str}"`
  let out = '"'
  let chunk = 0
  const hex = (c: number) => '\\u' + c.toString(16).padStart(4, '0')
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    let rep: string | null = null
    if (c === 34) rep = '\\"'
    else if (c === 92) rep = '\\\\'
    else if (c < 0x20) rep = CONTROL_ESCAPES[c] ?? hex(c)
    else if (c >= 0xd800 && c <= 0xdfff) {
      const next = str.charCodeAt(i + 1)
      if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        // 合法代理对
        if (escapeUnicode) {
          out += str.slice(chunk, i) + hex(c) + hex(next)
          i++
          chunk = i + 1
        } else i++
        continue
      }
      rep = hex(c) // 孤立代理项
    } else if (escapeUnicode && c > 0x7e) rep = hex(c)
    if (rep !== null) {
      out += str.slice(chunk, i) + rep
      chunk = i + 1
    }
  }
  return out + str.slice(chunk) + '"'
}

const byKey = (a: JsonProperty, b: JsonProperty) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

/** 把 AST 打印为 JSON 文本 */
export function printJson(value: JsonValue, opts: PrintOptions = {}): string {
  const unit = opts.indent === 'tab' ? '\t' : ' '.repeat(Math.max(0, opts.indent ?? 2))
  const pretty = unit.length > 0
  const esc = !!opts.escapeUnicode
  const sort = !!opts.sortKeys
  const indents: string[] = []
  // 压缩时分隔符不带换行
  const nl = (level: number) => (pretty ? (indents[level] ??= '\n' + unit.repeat(level)) : '')
  const colon = pretty ? ': ' : ':'
  // 直接拼接字符串（V8 的 rope 优化），比先 push 进数组再 join 快得多
  let out = ''

  const write = (v: JsonValue, level: number) => {
    switch (v.type) {
      case 'object': {
        if (v.entries.length === 0) {
          out += '{}'
          return
        }
        const entries = sort ? [...v.entries].sort(byKey) : v.entries
        const inner = nl(level + 1)
        out += '{'
        for (let k = 0; k < entries.length; k++) {
          out += (k ? ',' : '') + inner + quoteJsonString(entries[k].key, esc) + colon
          write(entries[k].value, level + 1)
        }
        out += nl(level) + '}'
        return
      }
      case 'array': {
        if (v.items.length === 0) {
          out += '[]'
          return
        }
        const inner = nl(level + 1)
        out += '['
        for (let k = 0; k < v.items.length; k++) {
          out += (k ? ',' : '') + inner
          write(v.items[k], level + 1)
        }
        out += nl(level) + ']'
        return
      }
      case 'string':
        out += quoteJsonString(v.value, esc)
        return
      case 'number':
        out += v.nonFinite ? 'null' : v.raw
        return
      case 'boolean':
        out += v.value ? 'true' : 'false'
        return
      case 'null':
        out += 'null'
    }
  }
  write(value, 0)
  return out
}

/* ───────────────────────── 统计 ───────────────────────── */

export interface JsonStats {
  /** 对象键的总数（递归） */
  keys: number
  /** 值节点总数 */
  nodes: number
  /** 容器嵌套深度：{} 为 1，{"a":{}} 为 2，原始值为 0 */
  maxDepth: number
  objects: number
  arrays: number
  strings: number
  numbers: number
  booleans: number
  nulls: number
  /** 用 JSON.parse 会丢精度的数字个数（比如超过 2^53 的整数） */
  bigNumbers: number
}

/** 把数字原文规范化为「符号 + 有效数字 + 指数」，用于比较数值是否相等 */
function canonicalNumber(raw: string): string {
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw)
  if (!m) return raw
  const digitsAll = (m[2] ?? '') + (m[3] ?? '')
  let exp = Number(m[4] ?? 0) + (m[2] ?? '').length
  let lead = 0
  while (lead < digitsAll.length && digitsAll[lead] === '0') lead++
  const digits = digitsAll.slice(lead).replace(/0+$/, '')
  if (!digits) return '0'
  exp -= lead
  return `${m[1]}0.${digits}e${exp}`
}

/** 15 位以内的整数一定能精确表示（快速路径，避免对每个数字跑正则） */
const SAFE_INT = /^-?\d{1,15}$/

/** JSON.parse 这个数字会不会丢精度 / 溢出 */
export function isLossyNumber(raw: string): boolean {
  if (SAFE_INT.test(raw)) return false
  const n = Number(raw)
  if (!Number.isFinite(n)) return true
  const str = String(n)
  if (str === raw) return false
  return canonicalNumber(str) !== canonicalNumber(raw)
}

export function jsonStats(value: JsonValue): JsonStats {
  const st: JsonStats = {
    keys: 0,
    nodes: 0,
    maxDepth: 0,
    objects: 0,
    arrays: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    bigNumbers: 0,
  }
  const stack: Array<[JsonValue, number]> = [[value, 0]]
  while (stack.length) {
    const [v, d] = stack.pop()!
    st.nodes++
    switch (v.type) {
      case 'object':
        st.objects++
        st.keys += v.entries.length
        if (d + 1 > st.maxDepth) st.maxDepth = d + 1
        for (const e of v.entries) stack.push([e.value, d + 1])
        break
      case 'array':
        st.arrays++
        if (d + 1 > st.maxDepth) st.maxDepth = d + 1
        for (const it of v.items) stack.push([it, d + 1])
        break
      case 'string':
        st.strings++
        break
      case 'number':
        st.numbers++
        if (!v.nonFinite && isLossyNumber(v.raw)) st.bigNumbers++
        break
      case 'boolean':
        st.booleans++
        break
      case 'null':
        st.nulls++
    }
  }
  return st
}

/* ───────────────────────── JSONPath ───────────────────────── */

export type PathSegment = string | number

const PATH_IDENT = /^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u

/** ["data","items",0,"name"] → $.data.items[0].name；特殊键名用 ['a b'] */
export function toJsonPath(path: readonly PathSegment[]): string {
  let out = '$'
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else if (PATH_IDENT.test(seg)) out += '.' + seg
    else {
      const body = quoteJsonString(seg).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")
      out += `['${body}']`
    }
  }
  return out
}

/* ───────────────────────── 转义 / 去转义 ───────────────────────── */

/** 把任意文本转成 JSON 字符串字面量 */
export function escapeJsonString(
  text: string,
  opts: { quotes?: boolean; escapeUnicode?: boolean } = {},
): string {
  const q = quoteJsonString(text, !!opts.escapeUnicode)
  return opts.quotes === false ? q.slice(1, -1) : q
}

export type UnescapeResult =
  { ok: true; text: string; levels: number } | { ok: false; error: JsonIssue }

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "'": "'",
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

/**
 * 按 JSON 规则解码「字符串内部」的转义（不要求引号本身被转义）。
 * base：body 在原文中的起始偏移，用于报错定位。
 */
function decodeEscapes(
  body: string,
  source: string,
  base: number,
): { ok: true; text: string } | { ok: false; error: JsonIssue } {
  let out = ''
  let chunk = 0
  for (let i = 0; i < body.length; i++) {
    if (body.charCodeAt(i) !== 92) continue
    out += body.slice(chunk, i)
    const e = body[i + 1]
    if (e !== undefined && e in SIMPLE_ESCAPES) {
      out += SIMPLE_ESCAPES[e]
      i++
    } else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(body.slice(i + 2, i + 6))) {
      out += String.fromCharCode(parseInt(body.slice(i + 2, i + 6), 16))
      i += 5
    } else {
      const pos = positionAt(source, base + i)
      return {
        ok: false,
        error: {
          ...pos,
          message:
            e === undefined
              ? '末尾多了一个反斜杠'
              : e === 'u'
                ? '"\\u" 后面需要 4 位十六进制数字'
                : `无效的转义序列 "\\${charAt(body, i + 1)}"`,
          hint: VALID_ESCAPES,
        },
      }
    }
    chunk = i + 1
  }
  return { ok: true, text: out + body.slice(chunk) }
}

const MAX_UNESCAPE_LEVELS = 8

/**
 * 去转义：把 JSON 字符串字面量还原成原文。
 * - 有外层引号："{\"a\":1}" → {"a":1}
 * - 无外层引号：{\"a\":1} → {"a":1}
 * - 多层转义：{\\\"a\\\":1} → {"a":1}（结果仍像转义过的 JSON 时继续解一层）
 * levels 为实际去掉的层数；输入本身已是合法 JSON 对象 / 数组时为 0。
 */
export function unescapeJsonString(input: string): UnescapeResult {
  const lead = input.length - input.trimStart().length
  const s = input.trim()
  if (!s) return { ok: true, text: '', levels: 0 }

  const direct = parseJson(s)
  if (direct.ok && direct.value.type !== 'string') return { ok: true, text: s, levels: 0 }

  let text: string
  if (direct.ok && direct.value.type === 'string') text = direct.value.value
  else {
    const quoted =
      s.length >= 2 &&
      ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))
    const body = quoted ? s.slice(1, -1) : s
    const r = decodeEscapes(body, input, lead + (quoted ? 1 : 0))
    if (!r.ok) return r
    // 既没有外层引号、也没有任何转义序列：没有可去掉的层
    if (!quoted && r.text === body) return { ok: true, text: body, levels: 0 }
    text = r.text
  }

  let levels = 1
  while (levels < MAX_UNESCAPE_LEVELS) {
    const t = text.trim()
    const p = parseJson(t)
    if (p.ok) {
      if (p.value.type !== 'string') break
      text = p.value.value
      levels++
      continue
    }
    // 仍然像是转义过的 JSON（含 \" 或 \\）才继续解
    if (!/^[[{"]/.test(t) || !/\\["\\]/.test(t)) break
    const r = decodeEscapes(t, t, 0)
    if (!r.ok || r.text === t) break
    text = r.text
    levels++
  }
  return { ok: true, text, levels }
}

/* ───────────────────────── 工具主流程 ───────────────────────── */

export type JsonMode = 'format' | 'minify' | 'escape' | 'unescape'

export interface JsonToolOptions {
  mode: JsonMode
  indent: IndentOption
  sortKeys: boolean
  lenient: boolean
  escapeUnicode: boolean
  /** 转义：保留外层双引号 */
  quotes: boolean
  /** 转义：输入是合法 JSON 时先压缩再转义 */
  compactBeforeEscape: boolean
}

export const DEFAULT_JSON_OPTIONS: JsonToolOptions = {
  mode: 'format',
  indent: 2,
  sortKeys: false,
  lenient: false,
  escapeUnicode: false,
  quotes: true,
  compactBeforeEscape: true,
}

export type JsonToolResult =
  | { status: 'empty' }
  | {
      status: 'error'
      error: JsonIssue
      /** error 行列号所对应的文本（通常就是输入） */
      source: string
      /** 错误位置是否对应输入框（可以「定位到错误」） */
      inInput: boolean
    }
  | {
      status: 'ok'
      output: string
      /** 结果对应的 JSON（转义模式下为 null） */
      value: JsonValue | null
      stats: JsonStats | null
      warnings: JsonIssue[]
      fixes: LenientFixCounts
      /** 给用户的补充说明 */
      notes: string[]
      /** 根值是一个装着 JSON 的字符串，建议切换到「去转义」 */
      suggestUnescape?: boolean
      /** 输出是否为 JSON（决定语法高亮） */
      outputIsJson: boolean
    }

function looksLikeEscapedJson(v: JsonValue): boolean {
  if (v.type !== 'string') return false
  const t = v.value.trim()
  if (!/^[[{]/.test(t)) return false
  const r = parseJson(t, { lenient: true })
  return r.ok && (r.value.type === 'object' || r.value.type === 'array')
}

/** 根据选项处理输入：格式化 / 压缩 / 转义 / 去转义 */
export function processJson(input: string, opts: JsonToolOptions): JsonToolResult {
  if (!input.trim()) return { status: 'empty' }
  const print = (v: JsonValue, minify: boolean) =>
    printJson(v, {
      indent: minify ? 0 : opts.indent,
      sortKeys: opts.sortKeys,
      escapeUnicode: opts.escapeUnicode,
    })

  if (opts.mode === 'format' || opts.mode === 'minify') {
    const r = parseJson(input, { lenient: opts.lenient })
    if (!r.ok) return { status: 'error', error: r.error, source: input, inInput: true }
    return {
      status: 'ok',
      output: print(r.value, opts.mode === 'minify'),
      value: r.value,
      stats: jsonStats(r.value),
      warnings: r.warnings,
      fixes: r.fixes,
      notes: [],
      suggestUnescape: looksLikeEscapedJson(r.value),
      outputIsJson: true,
    }
  }

  if (opts.mode === 'escape') {
    let text = input
    const notes: string[] = []
    if (opts.compactBeforeEscape) {
      const r = parseJson(input, { lenient: opts.lenient })
      if (r.ok) text = printJson(r.value, { indent: 0, sortKeys: opts.sortKeys })
      else notes.push('输入不是合法 JSON，已按原文转义')
    }
    return {
      status: 'ok',
      output: escapeJsonString(text, { quotes: opts.quotes, escapeUnicode: opts.escapeUnicode }),
      value: null,
      stats: null,
      warnings: [],
      fixes: {},
      notes,
      outputIsJson: opts.quotes,
    }
  }

  // 去转义
  const u = unescapeJsonString(input)
  if (!u.ok) return { status: 'error', error: u.error, source: input, inInput: true }
  const notes: string[] = []
  const r = parseJson(u.text, { lenient: opts.lenient })
  if (r.ok && (r.value.type === 'object' || r.value.type === 'array')) {
    notes.push(
      u.levels === 0
        ? '输入本身就是合法 JSON，无需去转义，已直接格式化'
        : `已去除 ${u.levels} 层转义，结果是合法 JSON，已自动格式化`,
    )
    return {
      status: 'ok',
      output: print(r.value, false),
      value: r.value,
      stats: jsonStats(r.value),
      warnings: r.warnings,
      fixes: r.fixes,
      notes,
      outputIsJson: true,
    }
  }
  notes.push(
    u.levels === 0
      ? '没有发现需要去转义的内容'
      : `已去除 ${u.levels} 层转义（结果不是 JSON 对象或数组，按文本输出）`,
  )
  return {
    status: 'ok',
    output: u.text,
    value: null,
    stats: null,
    warnings: [],
    fixes: {},
    notes,
    outputIsJson: false,
  }
}
