/** 文本处理：统计与各种批量操作（纯函数，无 DOM 依赖） */
import { translateRegexError } from './regex-tester'

// ───────────── 统计 ─────────────

export interface TextStats {
  /** 字符数（按用户感知的字符 / 字素簇计，emoji 算 1 个） */
  chars: number
  /** 不含空白的字符数 */
  charsNoSpace: number
  /** 中文字数（汉字） */
  chinese: number
  /** 英文单词数 */
  words: number
  /** 行数（空文本为 0） */
  lines: number
  /** 段落数（以空行分隔的非空文本块） */
  paragraphs: number
  /** UTF-8 编码字节数 */
  bytes: number
  /** 预计阅读时间（秒） */
  readingSeconds: number
}

const HAN_RE = /\p{Script=Han}/gu
const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g

let graphemeSegmenter: Intl.Segmenter | null | undefined

function getSegmenter(): Intl.Segmenter | null {
  if (graphemeSegmenter === undefined) {
    try {
      graphemeSegmenter =
        typeof Intl !== 'undefined' && 'Segmenter' in Intl
          ? new Intl.Segmenter('zh', { granularity: 'grapheme' })
          : null
    } catch {
      graphemeSegmenter = null
    }
  }
  return graphemeSegmenter
}

/** 按字素簇切分（👨‍👩‍👧、é 这类组合字符算一个）；不支持 Segmenter 时按码点 */
export function graphemes(text: string): string[] {
  const seg = getSegmenter()
  if (!seg) return Array.from(text)
  const out: string[] = []
  for (const s of seg.segment(text)) out.push(s.segment)
  return out
}

/**
 * 可能与前后字符组成同一个字素簇的字符（UAX #29）：CR（\r\n）、组合记号、ZWJ / ZWNJ、
 * emoji 肤色与标签字符、半角浊点、谚文字母、区域指示符（国旗）、前置字符等。
 * 文本里一个都没有时，字素簇数就等于码点数，可以跳过很慢的 Intl.Segmenter。
 */
const CLUSTER_RE =
  /[\r\p{M}\u200c\uff9e\uff9f\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff\u0600-\u0605\u06dd\u070f\u0890\u0891\u08e2\u0d4e\u0e33\u0eb3]|\u200d|[\u{1f3fb}-\u{1f3ff}]|[\u{e0020}-\u{e007f}]|[\u{1f1e6}-\u{1f1ff}]|[\u{110bd}\u{110cd}\u{111c2}\u{111c3}\u{1193f}\u{11941}\u{11a3a}\u{11a84}-\u{11a89}\u{11d46}\u{11f02}]/u

/** 字符数：优先字素簇，超长文本按码点计以保证速度 */
function countChars(text: string): { all: number; noSpace: number } {
  let all = 0
  let noSpace = 0
  const seg = text.length <= 2_000_000 && CLUSTER_RE.test(text) ? getSegmenter() : null
  if (seg) {
    for (const s of seg.segment(text)) {
      all++
      if (!/^\s+$/u.test(s.segment)) noSpace++
    }
  } else {
    // 快速路径：按码点计数（逐个 charCode 判断，不创建字符串）
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c >= 0xdc00 && c <= 0xdfff && i > 0) {
        const h = text.charCodeAt(i - 1)
        if (h >= 0xd800 && h <= 0xdbff) continue
      }
      all++
      if (!isSpaceCode(c)) noSpace++
    }
  }
  return { all, noSpace }
}

/** 与 /\s/ 相同的空白判断（ECMAScript WhiteSpace + LineTerminator） */
function isSpaceCode(c: number): boolean {
  if (c <= 0x20) return c === 0x20 || (c >= 0x09 && c <= 0x0d)
  if (c < 0xa0) return false
  return (
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  )
}

export function countChinese(text: string): number {
  return text.match(HAN_RE)?.length ?? 0
}

export function countEnglishWords(text: string): number {
  return text.match(WORD_RE)?.length ?? 0
}

export function countLines(text: string): number {
  if (!text) return 0
  let n = 1
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++
  return n
}

export function countParagraphs(text: string): number {
  return text.split(/\r?\n[ \t\u3000]*\r?\n/).filter((p) => p.trim() !== '').length
}

/** UTF-8 字节数（不依赖 TextEncoder，孤立代理对按 3 字节计，与 TextEncoder 替换为 U+FFFD 的结果一致） */
export function utf8Bytes(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4
        i++
      } else n += 3
    } else n += 3
  }
  return n
}

/** 阅读速度：中文约 300 字 / 分钟，英文约 200 词 / 分钟 */
export function readingSeconds(chinese: number, words: number): number {
  return Math.round((chinese / 300 + words / 200) * 60)
}

/** 12 → "12 秒"，95 → "约 2 分钟" */
export function formatReadingTime(seconds: number): string {
  if (seconds <= 0) return '0 秒'
  if (seconds < 60) return `${seconds} 秒`
  const min = Math.round(seconds / 60)
  if (min < 60) return `约 ${min} 分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `约 ${h} 小时 ${m} 分钟` : `约 ${h} 小时`
}

export function textStats(text: string): TextStats {
  const { all, noSpace } = countChars(text)
  const chinese = countChinese(text)
  const words = countEnglishWords(text)
  return {
    chars: all,
    charsNoSpace: noSpace,
    chinese,
    words,
    lines: countLines(text),
    paragraphs: countParagraphs(text),
    bytes: utf8Bytes(text),
    readingSeconds: readingSeconds(chinese, words),
  }
}

// ───────────── 行工具 ─────────────

/** 统一换行符后按行切分；空文本返回 [] */
export function splitLines(text: string): string[] {
  if (text === '') return []
  return text.replace(/\r\n?/g, '\n').split('\n')
}

const joinLines = (lines: string[]) => lines.join('\n')

export interface OpResult {
  output: string
  /** 给用户的简短说明，如「删除了 3 行重复」 */
  info?: string
  /** 出错时的中文提示（output 保持为输入原样或空） */
  error?: string
}

// ───────────── 去重 / 排序 / 反转 ─────────────

export interface DedupeOptions {
  ignoreCase?: boolean
  /** 比较时忽略首尾空白 */
  trim?: boolean
  /** 保留空行（空行不参与去重） */
  keepEmpty?: boolean
}

export function dedupeLines(text: string, opts: DedupeOptions = {}): OpResult {
  const lines = splitLines(text)
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    if (opts.keepEmpty && line.trim() === '') {
      out.push(line)
      continue
    }
    let key = opts.trim ? line.trim() : line
    if (opts.ignoreCase) key = key.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }
  const removed = lines.length - out.length
  return { output: joinLines(out), info: removed ? `删除了 ${removed} 行重复` : '没有重复行' }
}

export type SortMode = 'asc' | 'desc' | 'natural' | 'length' | 'shuffle'

export const SORT_MODES: { value: SortMode; label: string }[] = [
  { value: 'asc', label: '升序' },
  { value: 'desc', label: '降序' },
  { value: 'natural', label: '自然排序' },
  { value: 'length', label: '按长度' },
  { value: 'shuffle', label: '随机打乱' },
]

const collator = new Intl.Collator('zh-Hans-CN')
const naturalCollator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

/** 可注入的随机数（测试用固定种子） */
export type Rng = () => number

/** mulberry32：小巧的可复现伪随机数 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function sortLines(text: string, mode: SortMode, rng: Rng = Math.random): OpResult {
  const lines = splitLines(text)
  let out: string[]
  switch (mode) {
    case 'asc':
      out = [...lines].sort(collator.compare)
      break
    case 'desc':
      out = [...lines].sort((a, b) => collator.compare(b, a))
      break
    case 'natural':
      out = [...lines].sort(naturalCollator.compare)
      break
    case 'length':
      // 稳定排序：等长的行保持原顺序
      out = [...lines].sort((a, b) => graphemeLength(a) - graphemeLength(b))
      break
    case 'shuffle': {
      out = [...lines]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      break
    }
  }
  const label = SORT_MODES.find((m) => m.value === mode)?.label ?? ''
  return { output: joinLines(out), info: `${label}：${lines.length} 行` }
}

function graphemeLength(s: string): number {
  // 纯 ASCII 走快速路径
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7f]*$/.test(s) ? s.length : graphemes(s).length
}

export function reverseLines(text: string): OpResult {
  const lines = splitLines(text)
  return { output: joinLines(lines.reverse()), info: `已反转 ${lines.length} 行` }
}

// ───────────── 空白处理 ─────────────

export function removeEmptyLines(text: string): OpResult {
  const lines = splitLines(text)
  const out = lines.filter((l) => l.trim() !== '')
  const n = lines.length - out.length
  return { output: joinLines(out), info: n ? `删除了 ${n} 个空行` : '没有空行' }
}

export function trimLines(text: string): OpResult {
  const lines = splitLines(text)
  let changed = 0
  const out = lines.map((l) => {
    const t = l.trim()
    if (t !== l) changed++
    return t
  })
  return { output: joinLines(out), info: changed ? `修整了 ${changed} 行` : '没有首尾空白' }
}

/** 把连续的空格 / 制表符（含全角空格）合并成一个半角空格，不影响换行 */
export function collapseSpaces(text: string): OpResult {
  let n = 0
  const output = text.replace(/[ \t\u3000\u00a0]{2,}|\t|\u3000|\u00a0/g, () => {
    n++
    return ' '
  })
  return { output, info: n ? `合并了 ${n} 处空白` : '没有连续空白' }
}

// ───────────── 行号 / 前后缀 ─────────────

export interface LineNumberOptions {
  start?: number
  /** 行号与内容之间的分隔，如 ". "、"\t"、") " */
  separator?: string
  /** 行号补齐到相同宽度 */
  pad?: boolean
  /** 空行也编号 */
  numberEmpty?: boolean
}

export function addLineNumbers(text: string, opts: LineNumberOptions = {}): OpResult {
  const { start = 1, separator = '. ', pad = false, numberEmpty = true } = opts
  const lines = splitLines(text)
  const total = numberEmpty ? lines.length : lines.filter((l) => l.trim() !== '').length
  const width = String(start + Math.max(total - 1, 0)).length
  let n = start
  const out = lines.map((l) => {
    if (!numberEmpty && l.trim() === '') return l
    const num = pad ? String(n).padStart(width, ' ') : String(n)
    n++
    return `${num}${separator}${l}`
  })
  return { output: joinLines(out), info: `已为 ${total} 行编号` }
}

/**
 * 去掉行首的「12. 」「12) 」「12、」「(12) 」「[12] 」「12: 」「12 | 」「12\t」等行号。
 * 编号后面的 . : - 如果紧跟数字就不是行号（3.14、12:30、2024-01-01 保持原样）。
 */
const LINE_NUMBER_RE =
  /^\s*(?:[(（]\d+[)）]|\[\d+\]|\d+(?=[ \t]|[.．)）、:：\]|｜-](?!\d)))[ \t]*(?:[.．)）、:：\]|｜-](?!\d)[ \t]*)?/

export function removeLineNumbers(text: string): OpResult {
  const re = LINE_NUMBER_RE
  let n = 0
  const out = splitLines(text).map((l) => {
    const m = re.exec(l)
    if (!m) return l
    n++
    return l.slice(m[0].length)
  })
  return { output: joinLines(out), info: n ? `去除了 ${n} 个行号` : '没有识别到行号' }
}

export interface AffixOptions {
  prefix?: string
  suffix?: string
  /** 跳过空行 */
  skipEmpty?: boolean
}

export function addPrefixSuffix(text: string, opts: AffixOptions): OpResult {
  const { prefix = '', suffix = '', skipEmpty = true } = opts
  let n = 0
  const out = splitLines(text).map((l) => {
    if (skipEmpty && l.trim() === '') return l
    n++
    return `${prefix}${l}${suffix}`
  })
  return { output: joinLines(out), info: `处理了 ${n} 行` }
}

// ───────────── 全角 / 半角、大小写 ─────────────

/** 全角 ASCII（！到 ～）与全角空格 → 半角 */
export function toHalfWidth(text: string): OpResult {
  let n = 0
  const output = text.replace(/[\uff01-\uff5e\u3000]/g, (ch) => {
    n++
    return ch === '\u3000' ? ' ' : String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  })
  return { output, info: n ? `转换了 ${n} 个字符` : '没有全角字符' }
}

/** 半角 ASCII 可见字符与空格 → 全角 */
export function toFullWidth(text: string): OpResult {
  let n = 0
  const output = text.replace(/[\x21-\x7e ]/g, (ch) => {
    n++
    return ch === ' ' ? '\u3000' : String.fromCharCode(ch.charCodeAt(0) + 0xfee0)
  })
  return { output, info: n ? `转换了 ${n} 个字符` : '没有半角字符' }
}

export type CaseMode = 'upper' | 'lower' | 'title' | 'sentence'

export function changeCase(text: string, mode: CaseMode): OpResult {
  let output: string
  switch (mode) {
    case 'upper':
      output = text.toUpperCase()
      break
    case 'lower':
      output = text.toLowerCase()
      break
    case 'title':
      // 每个英文单词首字母大写，其余小写（撇号后的字母不算新词：don't → Don't）
      output = text.replace(
        /\p{L}[\p{L}\p{M}\p{N}'’]*/gu,
        (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      )
      break
    case 'sentence':
      output = text
        .toLowerCase()
        .replace(/(^\s*|[.!?。\uff01？]\s+|\n\s*)(\p{Ll})/gu, (_, pre: string, c: string) => {
          return pre + c.toUpperCase()
        })
      break
  }
  return { output }
}

// ───────────── 提取 ─────────────

export type ExtractKind = 'email' | 'url' | 'number' | 'phone' | 'ip'

export const EXTRACT_KINDS: { value: ExtractKind; label: string }[] = [
  { value: 'email', label: '邮箱' },
  { value: 'url', label: 'URL' },
  { value: 'number', label: '数字' },
  { value: 'phone', label: '手机号' },
  { value: 'ip', label: 'IP' },
]

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4 = `${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}`
const H16 = '[0-9A-Fa-f]{1,4}'
const IPV6 = [
  `(?:${H16}:){7}${H16}`,
  `(?:${H16}:){1,7}:`,
  `(?:${H16}:){1,6}:${H16}`,
  `(?:${H16}:){1,5}(?::${H16}){1,2}`,
  `(?:${H16}:){1,4}(?::${H16}){1,3}`,
  `(?:${H16}:){1,3}(?::${H16}){1,4}`,
  `(?:${H16}:){1,2}(?::${H16}){1,5}`,
  `${H16}:(?::${H16}){1,6}`,
  `:(?:(?::${H16}){1,7}|:)`,
].join('|')

const EXTRACTORS: Record<ExtractKind, () => RegExp> = {
  email: () => /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  // URL 结尾的标点（句号、逗号、右括号、中文标点）通常不属于链接
  url: () =>
    /\b(?:https?|ftp):\/\/[^\s<>"'`，。；\uff01？、）】》]+[^\s<>"'`，。；\uff01？、）】》.,;:!?)\]]/gi,
  // 后面紧跟「.数字」的不算（IP 地址、版本号 1.2.3 不会被拆成 192.168 这样的假数字）
  number: () => /(?<![\d.])-?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][+-]?\d+)?(?!\.?\d)/g,
  phone: () => /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d{4}){2}(?!\d)/g,
  ip: () =>
    new RegExp(
      `(?<![\\d.])${IPV4}(?![\\d.]*\\d)|(?<![0-9A-Fa-f:])(?:${IPV6})(?![0-9A-Fa-f:])`,
      'g',
    ),
}

export function extract(text: string, kind: ExtractKind, unique = true): OpResult {
  const re = EXTRACTORS[kind]()
  const found = text.match(re) ?? []
  let cleaned: string[] = found
  // 手机号统一成 11 位纯数字
  if (kind === 'phone') cleaned = found.map((p) => p.replace(/[-\s]/g, '').replace(/^\+?86/, ''))
  // IPv6 候选里去掉 "::"、"dead::beef" 这类不含数字的误报（如 C++ 的 std::vector）
  if (kind === 'ip') cleaned = found.filter((ip) => !ip.includes(':') || /\d/.test(ip))
  const list = unique ? [...new Set(cleaned)] : cleaned
  const label = EXTRACT_KINDS.find((k) => k.value === kind)?.label ?? ''
  return {
    output: list.join('\n'),
    info: list.length ? `提取到 ${list.length} 个${label}` : `没有找到${label}`,
  }
}

// ───────────── 查找替换 ─────────────

export interface ReplaceOptions {
  regex?: boolean
  caseSensitive?: boolean
  /** 仅限正则：多行模式（^ $ 匹配每一行） */
  multiline?: boolean
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function findReplace(
  text: string,
  find: string,
  replacement: string,
  opts: ReplaceOptions = {},
): OpResult {
  if (!find) return { output: text, info: '请输入要查找的内容' }
  let flags = 'g'
  if (!opts.caseSensitive) flags += 'i'
  if (opts.regex && opts.multiline !== false) flags += 'm'
  let re: RegExp
  try {
    re = new RegExp(opts.regex ? find : escapeRegExp(find), flags + 'u')
  } catch {
    try {
      re = new RegExp(opts.regex ? find : escapeRegExp(find), flags)
    } catch (e) {
      // 报告普通模式下的错误：u 模式的报错（如「无效的转义」）常常掩盖真正的问题
      return {
        output: text,
        error: `正则表达式无效：${translateRegexError(e instanceof Error ? e.message : String(e))}`,
      }
    }
  }
  let count = 0
  // 普通文本模式下替换串按字面量使用（不解析 $1 之类）
  const output = text.replace(re, (...args: unknown[]) => {
    count++
    if (!opts.regex) return replacement
    return expandSimple(replacement, args)
  })
  return { output, info: count ? `替换了 ${count} 处` : '没有找到匹配项' }
}

/** 正则模式下的替换模板：$& $` $' $1..$99 $<name> $$（与 String.prototype.replace 一致） */
function expandSimple(tpl: string, args: unknown[]): string {
  const hasGroups = typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null
  const groups = hasGroups ? (args[args.length - 1] as Record<string, string | undefined>) : null
  const tail = hasGroups ? 3 : 2
  const captures = args.slice(1, -tail) as (string | undefined)[]
  const offset = args[args.length - tail] as number
  const str = args[args.length - tail + 1] as string
  const matched = String(args[0])
  return tpl.replace(/\$(\$|&|`|'|\d{1,2}|<([^>]*)>)/g, (all, token: string, name?: string) => {
    if (token === '$') return '$'
    if (token === '&') return matched
    if (token === '`') return str.slice(0, offset)
    if (token === "'") return str.slice(offset + matched.length)
    if (name !== undefined) return groups ? (groups[name] ?? '') : all
    let idx = Number(token)
    if (idx > captures.length && token.length === 2) {
      idx = Number(token[0])
      if (idx >= 1 && idx <= captures.length) return (captures[idx - 1] ?? '') + token[1]
      return all
    }
    if (idx >= 1 && idx <= captures.length) return captures[idx - 1] ?? ''
    return all
  })
}

// ───────────── 列表转换 ─────────────

export type QuoteStyle = 'none' | 'single' | 'double' | 'backtick'

export interface JoinOptions {
  quote?: QuoteStyle
  /** 分隔符，缺省 ", " */
  separator?: string
  /** 外层包裹，如 "(" + ")" */
  wrap?: 'none' | 'paren' | 'bracket' | 'brace'
  /** 跳过空行 */
  skipEmpty?: boolean
  /** 去掉每项首尾空白 */
  trim?: boolean
  /** 结果去重 */
  unique?: boolean
}

const QUOTES: Record<QuoteStyle, string> = { none: '', single: "'", double: '"', backtick: '`' }
const WRAPS = {
  none: ['', ''],
  paren: ['(', ')'],
  bracket: ['[', ']'],
  brace: ['{', '}'],
} as const

/** 多行 → 逗号列表，如 SQL 的 IN ('a', 'b') */
export function linesToList(text: string, opts: JoinOptions = {}): OpResult {
  const {
    quote = 'none',
    separator = ', ',
    wrap = 'none',
    skipEmpty = true,
    trim = true,
    unique = false,
  } = opts
  let items = splitLines(text).map((l) => (trim ? l.trim() : l))
  if (skipEmpty) items = items.filter((l) => l !== '')
  if (unique) items = [...new Set(items)]
  const q = QUOTES[quote]
  const quoted = items.map((it) => {
    if (!q) return it
    // SQL / 大多数语言中引号用重复或反斜杠转义；单引号按 SQL 习惯写成 ''
    const escaped =
      quote === 'single'
        ? it.replace(/'/g, "''")
        : it
            .replace(/\\/g, '\\\\')
            .split(q)
            .join('\\' + q)
    return q + escaped + q
  })
  const [l, r] = WRAPS[wrap]
  return { output: l + quoted.join(separator) + r, info: `共 ${items.length} 项` }
}

/** 逗号（或其它分隔符）列表 → 多行；会去掉外层括号与每项的引号 */
export function listToLines(text: string, separator = ','): OpResult {
  let src = text.trim()
  const pairs: [string, string][] = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ]
  for (const [l, r] of pairs) {
    if (src.startsWith(l) && src.endsWith(r)) {
      src = src.slice(1, -1)
      break
    }
  }
  if (!src.trim()) return { output: '', info: '共 0 项' }
  const items = splitRespectingQuotes(src, separator || ',').map(unquote)
  return { output: items.join('\n'), info: `共 ${items.length} 项` }
}

function splitRespectingQuotes(src: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  // 分隔符为 "," 时同时接受中文逗号和换行
  const isSep = (i: number) =>
    src.startsWith(sep, i)
      ? sep.length
      : sep === ',' && (src[i] === '，' || src[i] === '\n')
        ? 1
        : 0
  for (let i = 0; i < src.length;) {
    const ch = src[i]
    if (quote) {
      cur += ch
      if (ch === '\\' && i + 1 < src.length) {
        cur += src[i + 1]
        i += 2
        continue
      }
      if (ch === quote) {
        if (quote === "'" && src[i + 1] === "'") {
          cur += "'"
          i += 2
          continue
        }
        quote = null
      }
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      cur += ch
      i++
      continue
    }
    const n = isSep(i)
    if (n) {
      out.push(cur)
      cur = ''
      i += n
      continue
    }
    cur += ch
    i++
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter((s) => s !== '')
}

function unquote(s: string): string {
  const q = s[0]
  if (s.length >= 2 && (q === '"' || q === "'" || q === '`') && s[s.length - 1] === q) {
    const inner = s.slice(1, -1)
    return q === "'"
      ? inner.replace(/''/g, "'").replace(/\\'/g, "'")
      : inner.replace(/\\(.)/g, '$1')
  }
  return s
}
