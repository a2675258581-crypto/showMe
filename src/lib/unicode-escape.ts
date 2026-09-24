/** Unicode 转义互转与字符分析（纯函数，无 DOM 依赖，可在 Node 中运行） */

export type EscapeFormat =
  'js' | 'es6' | 'python' | 'html-hex' | 'html-dec' | 'utf8-hex' | 'utf8-url' | 'codepoint' | 'css'

export const ESCAPE_FORMATS: {
  id: EscapeFormat
  label: string
  example: string
  hint: string
}[] = [
  {
    id: 'js',
    label: '\\uXXXX',
    example: '\\u4E2D \\uD83D\\uDE00',
    hint: 'JavaScript / Java / JSON，补充平面字符用代理对',
  },
  {
    id: 'es6',
    label: '\\u{XXXX}',
    example: '\\u{4E2D} \\u{1F600}',
    hint: 'ES6 / Swift / Rust 码点转义',
  },
  {
    id: 'python',
    label: '\\U0001XXXX',
    example: '\\u4E2D \\U0001F600',
    hint: 'Python / C / C++：BMP 用 \\u，其余用 8 位 \\U',
  },
  {
    id: 'html-hex',
    label: '&#xXXXX;',
    example: '&#x4E2D; &#x1F600;',
    hint: 'HTML / XML 十六进制字符引用',
  },
  {
    id: 'html-dec',
    label: '&#DDDD;',
    example: '&#20013; &#128512;',
    hint: 'HTML / XML 十进制字符引用',
  },
  {
    id: 'utf8-hex',
    label: '\\xE4\\xB8\\xAD',
    example: '\\xE4\\xB8\\xAD',
    hint: 'UTF-8 字节（C / Python bytes / shell）',
  },
  {
    id: 'utf8-url',
    label: '%E4%B8%AD',
    example: '%E4%B8%AD',
    hint: 'UTF-8 字节的百分号编码（URL）',
  },
  { id: 'codepoint', label: 'U+XXXX', example: 'U+4E2D U+1F600', hint: 'Unicode 码点表示法' },
  {
    id: 'css',
    label: 'CSS \\4E2D',
    example: '\\4E2D \\1F600',
    hint: 'CSS 字符串 / content 属性转义',
  },
]

export interface EscapeOptions {
  format: EscapeFormat
  /** 只转义非 ASCII（以及不可见的控制字符），默认 true */
  onlyNonAscii?: boolean
  /** 十六进制用大写，默认 true */
  upper?: boolean
}

export interface EscapeIssue {
  index: number
  line: number
  column: number
  text: string
  message: string
}

export interface EscapeResult {
  output: string
  issues: EscapeIssue[]
}

const MAX_ISSUES = 200

export function lineColumn(text: string, index: number): { line: number; column: number } {
  return makeLocator(text)(index)
}

/** 行列定位器：按递增顺序查询时接着上一次的位置数，超长单行也是线性时间 */
function makeLocator(text: string) {
  let pos = 0
  let line = 1
  let column = 1
  return (index: number): { line: number; column: number } => {
    const target = Math.min(Math.max(index, 0), text.length)
    if (target < pos) {
      pos = 0
      line = 1
      column = 1
    }
    while (pos < target) {
      const c = text.charCodeAt(pos)
      if (c === 10) {
        line++
        column = 1
      } else if (!(
        c >= 0xdc00 &&
        c <= 0xdfff &&
        pos > 0 &&
        isHighSurrogateCode(text.charCodeAt(pos - 1))
      ))
        column++
      pos++
    }
    return { line, column }
  }
}
const isHighSurrogateCode = (c: number) => c >= 0xd800 && c <= 0xdbff

export function utf8BytesOf(cp: number): number[] {
  if (cp < 0x80) return [cp]
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 63)]
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)]
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)]
}

export function utf16UnitsOf(cp: number): number[] {
  if (cp <= 0xffff) return [cp]
  const v = cp - 0x10000
  return [0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)]
}

const isSurrogate = (cp: number) => cp >= 0xd800 && cp <= 0xdfff
const isHexCode = (c: number) =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)

/** 这些字符在字符串字面量里需要转义自身，才能保证能原样还原 */
function literalSelfEscape(format: EscapeFormat, ch: string): string | null {
  if (ch === '\\' && ['js', 'es6', 'python', 'utf8-hex', 'css'].includes(format)) return '\\\\'
  if (ch === '%' && format === 'utf8-url') return '%25'
  return null
}

/**
 * 原样保留的 ASCII 字符若恰好组成还原时会被自动识别的转义开头
 * （如文本里本来就有 “%41”“&#65;”“U+0041”“\\n”），就必须连它一起转义，
 * 否则还原得到的文本与原文不同。
 */
function startsEscape(text: string, at: number, ch: string): boolean {
  const next = text[at + 1]
  switch (ch) {
    case '\\':
      return next !== undefined && (/[uUx0-9A-Fa-f]/.test(next) || Object.hasOwn(SIMPLE, next))
    case '%':
      return isHexCode(text.charCodeAt(at + 1)) && isHexCode(text.charCodeAt(at + 2))
    case '&':
      return next === '#'
    case 'U':
    case 'u':
      return next === '+' && /^[0-9A-Fa-f]{4}/.test(text.slice(at + 2, at + 6))
  }
  return false
}

/** 把文本转义为指定格式 */
export function escapeText(text: string, opts: EscapeOptions): EscapeResult {
  const { format, onlyNonAscii = true, upper = true } = opts
  const hx = (n: number, pad = 0) => {
    const s = n.toString(16).padStart(pad, '0')
    return upper ? s.toUpperCase() : s
  }
  const issues: EscapeIssue[] = []
  const locate = makeLocator(text)
  let out = ''
  /** 上一个输出的转义类型：决定是否需要分隔符 */
  let prev: 'text' | 'codepoint' | 'css' = 'text'
  let index = 0

  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const at = index
    index += ch.length
    const printableAscii = cp >= 0x20 && cp < 0x7f
    const hexLike = /[0-9A-Fa-f]/.test(ch)
    // U+XXXX 后紧跟的十六进制字符会被读成同一个码点，空格 / 逗号会被当成分隔符，所以也转义
    const keep =
      onlyNonAscii &&
      (printableAscii || cp === 10 || cp === 13 || cp === 9) &&
      !(prev === 'codepoint' && /[0-9A-Fa-f ,\t]/.test(ch)) &&
      (literalSelfEscape(format, ch) !== null || !startsEscape(text, at, ch))
    if (keep) {
      // CSS 转义后紧跟十六进制字符或空白时，需要一个空格作结束符
      if (prev === 'css' && (hexLike || /\s/.test(ch))) out += ' '
      out += literalSelfEscape(format, ch) ?? ch
      prev = 'text'
      continue
    }

    const lone = isSurrogate(cp)
    const report = (message: string) => {
      if (issues.length < MAX_ISSUES) issues.push({ index: at, ...locate(at), text: ch, message })
    }
    switch (format) {
      case 'js':
        out += utf16UnitsOf(cp)
          .map((u) => `\\u${hx(u, 4)}`)
          .join('')
        break
      case 'es6':
        out += `\\u{${hx(cp, 4)}}`
        break
      case 'python':
        out += cp > 0xffff ? `\\U${hx(cp, 8)}` : `\\u${hx(cp, 4)}`
        break
      case 'html-hex':
      case 'html-dec':
        if (lone) report(`孤立的代理项 U+${hx(cp, 4)} 在 HTML 中会显示为 �`)
        out += format === 'html-hex' ? `&#x${hx(cp)};` : `&#${cp};`
        break
      case 'utf8-hex':
      case 'utf8-url': {
        let c = cp
        if (lone) {
          report(`孤立的代理项 U+${hx(cp, 4)} 无法编码为 UTF-8，已替换为 U+FFFD`)
          c = 0xfffd
        }
        const prefix = format === 'utf8-hex' ? '\\x' : '%'
        out += utf8BytesOf(c)
          .map((b) => prefix + hx(b, 2))
          .join('')
        break
      }
      case 'codepoint':
        // 码点表示法约定使用大写
        out += `${prev === 'codepoint' ? ' ' : ''}U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
        break
      case 'css':
        out += `\\${hx(cp, 4)}`
        break
    }
    prev = format === 'codepoint' ? 'codepoint' : format === 'css' ? 'css' : 'text'
  }
  return { output: out, issues }
}

// ─────────────────────────────── 解码 ───────────────────────────────

export type EscapeKind =
  | 'js'
  | 'es6'
  | 'python'
  | 'perl'
  | 'html-hex'
  | 'html-dec'
  | 'utf8-hex'
  | 'utf8-url'
  | 'codepoint'
  | 'css'
  | 'simple'

export const ESCAPE_KIND_LABEL: Record<EscapeKind, string> = {
  js: '\\uXXXX',
  es6: '\\u{…}',
  python: '\\UXXXXXXXX',
  perl: '\\x{…}',
  'html-hex': '&#x…;',
  'html-dec': '&#…;',
  'utf8-hex': '\\xHH 字节',
  'utf8-url': '%HH 字节',
  codepoint: 'U+XXXX',
  css: 'CSS \\XXXX',
  simple: '\\n \\t 等',
}

export interface UnescapeOptions {
  /** 同时解析 \n \t \r \\ \" 等简单转义，默认 true */
  simple?: boolean
  /** 解析 CSS 风格的 \4E2D（4–6 位十六进制），默认 true */
  css?: boolean
}

export interface UnescapeResult {
  output: string
  counts: Partial<Record<EscapeKind, number>>
  issues: EscapeIssue[]
}

const SIMPLE: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
  '\\': '\\',
  '"': '"',
  "'": "'",
  '/': '/',
  '`': '`',
}

function readHex(s: string, i: number, min: number, max: number): string | null {
  let j = i
  while (j < s.length && j - i < max && isHexCode(s.charCodeAt(j))) j++
  return j - i >= min ? s.slice(i, j) : null
}

/** 从 bytes 里按 UTF-8 严格解码；不合法返回 null */
function strictUtf8(bytes: number[]): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes))
  } catch {
    return null
  }
}

/**
 * 自动识别并还原混合的各种转义：
 * \uXXXX（含代理对）、\u{…}、\UXXXXXXXX、\x{…}、\xHH 字节串、%HH 字节串、
 * &#x…; / &#…;、U+XXXX、CSS \XXXX，以及可选的 \n \t 等简单转义。
 */
export function unescapeText(text: string, opts: UnescapeOptions = {}): UnescapeResult {
  const simple = opts.simple !== false
  const css = opts.css !== false
  const counts: Partial<Record<EscapeKind, number>> = {}
  const issues: EscapeIssue[] = []
  const locate = makeLocator(text)
  const count = (k: EscapeKind) => (counts[k] = (counts[k] ?? 0) + 1)
  const issue = (index: number, len: number, message: string) => {
    if (issues.length < MAX_ISSUES)
      issues.push({
        index,
        ...locate(index),
        text: text.slice(index, index + len),
        message,
      })
  }
  const fromCp = (cp: number, at: number, len: number): string => {
    if (cp > 0x10ffff) {
      issue(
        at,
        len,
        `“${text.slice(at, at + len).trim()}” 超出 Unicode 范围（最大 U+10FFFF），已原样保留`,
      )
      return text.slice(at, at + len)
    }
    return String.fromCodePoint(cp)
  }

  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]

    // ── 反斜杠开头
    if (c === '\\' && i + 1 < n) {
      const d = text[i + 1]
      // \u{…}
      if (d === 'u' && text[i + 2] === '{') {
        const h = readHex(text, i + 3, 1, 16)
        if (h && text[i + 3 + h.length] === '}') {
          const len = h.length + 4
          out += fromCp(parseInt(h, 16), i, len)
          count('es6')
          i += len
          continue
        }
      }
      // \uXXXX（含代理对）
      if (d === 'u') {
        const h = readHex(text, i + 2, 4, 4)
        if (h) {
          let unit = parseInt(h, 16)
          let len = 6
          if (unit >= 0xd800 && unit <= 0xdbff && text[i + 6] === '\\' && text[i + 7] === 'u') {
            const lo = readHex(text, i + 8, 4, 4)
            const low = lo ? parseInt(lo, 16) : -1
            if (low >= 0xdc00 && low <= 0xdfff) {
              unit = 0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00)
              len = 12
            }
          }
          if (isSurrogate(unit)) {
            issue(i, len, `\\u${h} 是孤立的代理项（缺少配对的另一半），已替换为 U+FFFD`)
            unit = 0xfffd
          }
          out += String.fromCodePoint(unit)
          count('js')
          i += len
          continue
        }
      }
      // \UXXXXXXXX
      if (d === 'U') {
        const h = readHex(text, i + 2, 8, 8)
        if (h) {
          out += fromCp(parseInt(h, 16), i, 10)
          count('python')
          i += 10
          continue
        }
      }
      // \x{…}
      if (d === 'x' && text[i + 2] === '{') {
        const h = readHex(text, i + 3, 1, 16)
        if (h && text[i + 3 + h.length] === '}') {
          const len = h.length + 4
          out += fromCp(parseInt(h, 16), i, len)
          count('perl')
          i += len
          continue
        }
      }
      // \xHH 连续字节串
      if (d === 'x' && readHex(text, i + 2, 2, 2)) {
        const start = i
        const bytes: number[] = []
        while (text[i] === '\\' && text[i + 1] === 'x' && readHex(text, i + 2, 2, 2)) {
          bytes.push(parseInt(text.slice(i + 2, i + 4), 16))
          i += 4
        }
        const decoded = strictUtf8(bytes)
        if (decoded !== null) out += decoded
        else {
          // 不是 UTF-8：按 Latin-1（Python 字符串 \xHH 的含义）逐字节解释
          // （分块转换：超长字节串直接展开参数会栈溢出）
          for (let k = 0; k < bytes.length; k += 0x2000)
            out += String.fromCharCode(...bytes.slice(k, k + 0x2000))
          issue(start, i - start, '这串 \\x 字节不是有效的 UTF-8，已按 Latin-1 逐字节解释')
        }
        counts['utf8-hex'] = (counts['utf8-hex'] ?? 0) + bytes.length
        continue
      }
      // CSS \XXXX（4–6 位十六进制，后面可跟一个空白作结束符）
      if (css) {
        const h = readHex(text, i + 1, 4, 6)
        if (h) {
          let len = 1 + h.length
          if (/[ \t\n]/.test(text[i + len] ?? '')) len++
          else if (text[i + len] === '\r') len += text[i + len + 1] === '\n' ? 2 : 1
          const cp = parseInt(h, 16)
          if (cp === 0 || isSurrogate(cp)) {
            issue(i, len, `CSS 转义 \\${h} 不是合法字符，已替换为 U+FFFD`)
            out += '�'
          } else out += fromCp(cp, i, len)
          count('css')
          i += len
          continue
        }
      }
      if (simple && d in SIMPLE) {
        out += SIMPLE[d]
        count('simple')
        i += 2
        continue
      }
    }

    // ── %HH 连续字节串
    if (c === '%' && readHex(text, i + 1, 2, 2)) {
      const start = i
      const bytes: number[] = []
      while (text[i] === '%' && readHex(text, i + 1, 2, 2)) {
        bytes.push(parseInt(text.slice(i + 1, i + 3), 16))
        i += 3
      }
      const decoded = strictUtf8(bytes)
      if (decoded !== null) out += decoded
      else {
        out += text.slice(start, i)
        issue(start, i - start, '这串 %XX 字节不是有效的 UTF-8，已原样保留')
      }
      counts['utf8-url'] = (counts['utf8-url'] ?? 0) + bytes.length
      continue
    }

    // ── &#x…; / &#…;
    if (c === '&' && text[i + 1] === '#') {
      const hex = text[i + 2] === 'x' || text[i + 2] === 'X'
      // 前导零不影响数值（&#x000041; 就是 “A”），所以数字部分不限长度，再按有效位判断范围
      const h = hex ? readHex(text, i + 3, 1, 64) : /^\d{1,64}/.exec(text.slice(i + 2, i + 66))?.[0]
      if (h) {
        let len = (hex ? 3 : 2) + h.length
        if (text[i + len] === ';') len++
        const significant = h.replace(/^0+/, '') || '0'
        const cp = significant.length > 8 ? Infinity : parseInt(significant, hex ? 16 : 10)
        if (cp === 0 || isSurrogate(cp)) {
          issue(i, len, `${text.slice(i, i + len)} 不是合法字符，已替换为 U+FFFD`)
          out += '�'
        } else out += fromCp(cp, i, len)
        count(hex ? 'html-hex' : 'html-dec')
        i += len
        continue
      }
    }

    // ── U+XXXX（相邻的 U+ 之间的空白会被去掉）
    if ((c === 'U' || c === 'u') && text[i + 1] === '+') {
      const h = readHex(text, i + 2, 4, 6)
      if (h) {
        const len = 2 + h.length
        out += fromCp(parseInt(h, 16), i, len)
        count('codepoint')
        i += len
        const gap = /^[ \t]*,?[ \t]*(?=[Uu]\+[0-9A-Fa-f]{4})/.exec(text.slice(i, i + 16))
        if (gap) i += gap[0].length
        continue
      }
    }

    out += c
    i++
  }
  return { output: out, counts, issues }
}

// ───────────────────────────── 字符分析 ─────────────────────────────

export type CharCategory =
  | 'control'
  | 'space'
  | 'ascii-letter'
  | 'ascii-digit'
  | 'ascii-symbol'
  | 'han'
  | 'kana'
  | 'hangul'
  | 'latin'
  | 'greek'
  | 'cyrillic'
  | 'letter'
  | 'digit'
  | 'emoji'
  | 'punct'
  | 'symbol'
  | 'mark'
  | 'variation'
  | 'format'
  | 'private'
  | 'surrogate'
  | 'unassigned'

export const CHAR_CATEGORY_LABEL: Record<CharCategory, string> = {
  control: '控制字符',
  space: '空白',
  'ascii-letter': 'ASCII 字母',
  'ascii-digit': 'ASCII 数字',
  'ascii-symbol': 'ASCII 符号',
  han: '汉字',
  kana: '日文假名',
  hangul: '韩文',
  latin: '拉丁字母',
  greek: '希腊字母',
  cyrillic: '西里尔字母',
  letter: '其他文字',
  digit: '数字',
  emoji: 'Emoji',
  punct: '标点',
  symbol: '符号',
  mark: '组合符号',
  variation: '变体选择符',
  format: '格式字符',
  private: '私用区',
  surrogate: '孤立代理项',
  unassigned: '未分配',
}

/** 常见不可见 / 易混淆字符的中文名 */
const CHAR_NAMES: Record<number, string> = {
  0x00: '空字符 NUL',
  0x09: '制表符',
  0x0a: '换行 LF',
  0x0d: '回车 CR',
  0x20: '空格',
  0x7f: '删除 DEL',
  0xa0: '不换行空格',
  0xad: '软连字符',
  0x3000: '全角空格',
  0x200b: '零宽空格',
  0x200c: '零宽不连字 ZWNJ',
  0x200d: '零宽连字 ZWJ',
  0x200e: '从左到右标记 LRM',
  0x200f: '从右到左标记 RLM',
  0x202a: '从左到右嵌入 LRE',
  0x202b: '从右到左嵌入 RLE',
  0x202c: '方向格式结束 PDF',
  0x202d: '从左到右覆盖 LRO',
  0x202e: '从右到左覆盖 RLO（可反转显示顺序）',
  0x2028: '行分隔符',
  0x2029: '段分隔符',
  0x2060: '词连接符',
  0xfeff: 'BOM / 零宽不换行空格',
  0xfe0e: '文本样式选择符 VS15',
  0xfe0f: 'Emoji 样式选择符 VS16',
  0xfffd: '替换字符',
  0x20e3: '键帽组合符',
}

export function charCategory(cp: number): CharCategory {
  if (isSurrogate(cp)) return 'surrogate'
  if (cp < 0x80) {
    if (cp < 0x20 || cp === 0x7f) return cp === 9 || cp === 10 || cp === 13 ? 'space' : 'control'
    if (cp === 0x20) return 'space'
    if (/[A-Za-z]/.test(String.fromCharCode(cp))) return 'ascii-letter'
    if (cp >= 0x30 && cp <= 0x39) return 'ascii-digit'
    return 'ascii-symbol'
  }
  const ch = String.fromCodePoint(cp)
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 'variation'
  if (/\p{Emoji_Presentation}/u.test(ch) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) return 'emoji'
  if (/\p{Extended_Pictographic}/u.test(ch) && cp >= 0x2100) return 'emoji'
  if (/\p{Script=Han}/u.test(ch)) return 'han'
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) return 'kana'
  if (/\p{Script=Hangul}/u.test(ch)) return 'hangul'
  if (/\p{Cc}/u.test(ch)) return 'control'
  if (/\p{Cf}/u.test(ch)) return 'format'
  if (/\p{Co}/u.test(ch)) return 'private'
  if (/\p{Cn}/u.test(ch)) return 'unassigned'
  if (/\p{Z}/u.test(ch)) return 'space'
  if (/\p{M}/u.test(ch)) return 'mark'
  if (/\p{L}/u.test(ch)) {
    if (/\p{Script=Latin}/u.test(ch)) return 'latin'
    if (/\p{Script=Greek}/u.test(ch)) return 'greek'
    if (/\p{Script=Cyrillic}/u.test(ch)) return 'cyrillic'
    return 'letter'
  }
  if (/\p{N}/u.test(ch)) return 'digit'
  if (/\p{P}/u.test(ch)) return 'punct'
  return 'symbol'
}

export interface CharInfo {
  /** 原字符 */
  char: string
  /** 适合显示的形式（不可见字符用控制图形符号代替） */
  display: string
  codePoint: number
  /** U+4E2D */
  hex: string
  utf8: number[]
  utf16: number[]
  category: CharCategory
  /** 常见特殊字符的中文名 */
  name?: string
  /** 所在字素簇（用户感知的“一个字”）的序号，从 0 开始 */
  grapheme: number
  /** 在原文中的 UTF-16 下标 */
  index: number
}

function displayOf(cp: number, cat: CharCategory): string {
  if (cp < 0x20) return String.fromCodePoint(0x2400 + cp)
  if (cp === 0x7f) return '␡'
  if (cp === 0x20) return '␣'
  if (cat === 'surrogate' || cat === 'format' || cat === 'variation') return '⬚'
  if (cat === 'space') return '␣'
  if (cat === 'mark') return '◌' + String.fromCodePoint(cp)
  return String.fromCodePoint(cp)
}

/** 逐码点分析文本（最多 limit 个） */
export function inspectChars(text: string, limit = 500): { rows: CharInfo[]; total: number } {
  const rows: CharInfo[] = []
  // 字素簇边界：UTF-16 下标 → 簇序号
  const clusterAt = new Map<number, number>()
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    let k = 0
    for (const s of seg.segment(text)) {
      clusterAt.set(s.index, k++)
      if (s.index > limit * 4) break
    }
  } catch {
    /* 不支持 Intl.Segmenter 时每个码点单独成簇 */
  }
  let total = 0
  let index = 0
  let cluster = -1
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const at = index
    index += ch.length
    total++
    if (clusterAt.size ? clusterAt.has(at) : true) cluster = clusterAt.get(at) ?? cluster + 1
    if (rows.length >= limit) continue
    const category = charCategory(cp)
    rows.push({
      char: ch,
      display: displayOf(cp, category),
      codePoint: cp,
      hex: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
      utf8: isSurrogate(cp) ? [] : utf8BytesOf(cp),
      utf16: utf16UnitsOf(cp),
      category,
      name: CHAR_NAMES[cp],
      grapheme: cluster,
      index: at,
    })
  }
  return { rows, total }
}

/** 文本统计：码点数、UTF-16 长度、UTF-8 字节数、字素簇数 */
export function textStats(text: string): {
  codePoints: number
  utf16: number
  utf8: number
  graphemes: number
} {
  let codePoints = 0
  let utf8 = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    codePoints++
    utf8 += isSurrogate(cp) ? 3 : utf8BytesOf(cp).length
  }
  let graphemes = 0
  try {
    for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text))
      graphemes++
  } catch {
    graphemes = codePoints
  }
  return { codePoints, utf16: text.length, utf8, graphemes }
}
