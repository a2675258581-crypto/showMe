/** HTML 实体编码 / 解码（纯函数，无 DOM 依赖，遵循 WHATWG HTML 标准的字符引用规则） */

import { ENTITY_DATA, HTML4_ENTITY_NAMES, LEGACY_ENTITY_NAMES } from './html-entities-data'

/** 名称（不含 & 与 ;）→ 字符串 */
export const NAMED_ENTITIES: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>()
  for (const item of ENTITY_DATA.split(/\s+/)) {
    if (!item) continue
    const eq = item.indexOf('=')
    const cps = item
      .slice(eq + 1)
      .split('.')
      .map((h) => parseInt(h, 16))
    m.set(item.slice(0, eq), String.fromCodePoint(...cps))
  }
  return m
})()

const words = (s: string) => s.split(/\s+/).filter(Boolean)

/** 可以省略分号的旧式实体 */
export const LEGACY_ENTITIES: ReadonlySet<string> = new Set(words(LEGACY_ENTITY_NAMES))
const HTML4 = new Set(words(HTML4_ENTITY_NAMES))
const LEGACY_MAX = Math.max(...Array.from(LEGACY_ENTITIES, (n) => n.length))

/**
 * 码点 → 首选实体名：HTML 4 名称优先，其次取最短、小写优先的名称。
 * 只收录单个码点的实体。
 */
const PREFERRED_NAME: ReadonlyMap<number, string> = (() => {
  const best = new Map<number, string>()
  const rank = (n: string) => [HTML4.has(n) ? 0 : 1, n.length, /[A-Z]/.test(n) ? 1 : 0]
  const better = (a: string, b: string) => {
    const ra = rank(a)
    const rb = rank(b)
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i]
    return a < b
  }
  for (const [name, value] of NAMED_ENTITIES) {
    const cp = value.codePointAt(0)!
    if (value.length !== String.fromCodePoint(cp).length) continue
    const cur = best.get(cp)
    if (!cur || better(name, cur)) best.set(cp, name)
  }
  return best
})()

/** 某个字符的首选实体名（不含 & ;），没有则 null */
export function entityNameOf(ch: string): string | null {
  const cp = ch.codePointAt(0)
  return cp === undefined ? null : (PREFERRED_NAME.get(cp) ?? null)
}

export type EntityEncodeMode = 'special' | 'named' | 'decimal' | 'hex'

export const ENTITY_ENCODE_MODES: { id: EntityEncodeMode; label: string; example: string }[] = [
  { id: 'special', label: '仅特殊字符', example: '< > & " \'' },
  { id: 'named', label: '非 ASCII → 命名实体', example: '© → &copy;' },
  { id: 'decimal', label: '非 ASCII → 十进制', example: '中 → &#20013;' },
  { id: 'hex', label: '非 ASCII → 十六进制', example: '中 → &#x4E2D;' },
]

export interface EntityEncodeOptions {
  mode: EntityEncodeMode
  /** 同时转义 " 与 '（用于属性值），默认 true */
  quotes?: boolean
  /** 没有命名实体时的数字格式（named 模式），默认十进制 */
  fallback?: 'decimal' | 'hex'
}

const numeric = (cp: number, hex: boolean) =>
  hex ? `&#x${cp.toString(16).toUpperCase()};` : `&#${cp};`

/** 编码：换行与制表符保持原样 */
export function encodeEntities(text: string, opts: EntityEncodeOptions): string {
  const quotes = opts.quotes !== false
  let out = ''
  for (const ch of text) {
    switch (ch) {
      case '&':
        out += '&amp;'
        continue
      case '<':
        out += '&lt;'
        continue
      case '>':
        out += '&gt;'
        continue
      case '"':
        out += quotes ? '&quot;' : ch
        continue
      case "'":
        out += quotes ? '&#39;' : ch
        continue
    }
    const cp = ch.codePointAt(0)!
    if (cp < 0x80 || opts.mode === 'special') {
      out += ch
      continue
    }
    if (opts.mode === 'named') {
      const name = PREFERRED_NAME.get(cp)
      out += name ? `&${name};` : numeric(cp, opts.fallback === 'hex')
    } else out += numeric(cp, opts.mode === 'hex')
  }
  return out
}

export interface EntityIssue {
  index: number
  line: number
  column: number
  text: string
  message: string
  /** info：已按规则解码但写法不规范；warning：无法识别，原样保留 */
  level: 'info' | 'warning'
}

export interface EntityDecodeResult {
  output: string
  counts: { named: number; numeric: number }
  issues: EntityIssue[]
  /** 解码结果里还含有实体，可能被重复编码过 */
  stillEncoded: boolean
}

/** 数字引用落在 0x80–0x9F 时按 Windows-1252 解释（HTML 标准规定） */
const C1_REMAP: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
}

const MAX_ISSUES = 200
const isAlnum = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
const isDigit = (c: number) => c >= 48 && c <= 57
const isHexDigit = (c: number) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)

/** 行列定位器：问题按出现顺序递增查询，从上一次的位置接着数，长文本也是线性时间 */
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
        isHighSurrogate(text.charCodeAt(pos - 1))
      ))
        column++
      pos++
    }
    return { line, column }
  }
}
const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff

/** 解码命名实体（含 HTML5 全表）、十进制与十六进制数字引用；旧式实体允许省略分号 */
export function decodeEntities(text: string): EntityDecodeResult {
  const issues: EntityIssue[] = []
  const counts = { named: 0, numeric: 0 }
  const locate = makeLocator(text)
  const issue = (index: number, len: number, level: EntityIssue['level'], message: string) => {
    if (issues.length >= MAX_ISSUES) return
    issues.push({
      index,
      ...locate(index),
      text: text.slice(index, index + len),
      level,
      message,
    })
  }

  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const amp = text.indexOf('&', i)
    if (amp < 0) {
      out += text.slice(i)
      break
    }
    out += text.slice(i, amp)
    let j = amp + 1

    // ── 数字引用 &#123; / &#x1F600;
    if (text.charCodeAt(j) === 35) {
      j++
      const hex = text.charCodeAt(j) === 120 || text.charCodeAt(j) === 88
      if (hex) j++
      const digitsStart = j
      while (j < n && (hex ? isHexDigit(text.charCodeAt(j)) : isDigit(text.charCodeAt(j)))) j++
      if (j === digitsStart) {
        issue(
          amp,
          j - amp,
          'warning',
          `“${text.slice(amp, j)}” 后缺少${hex ? '十六进制' : '十进制'}数字，已原样保留`,
        )
        out += text.slice(amp, j)
        i = j
        continue
      }
      const digits = text.slice(digitsStart, j)
      const semi = text.charCodeAt(j) === 59
      const end = semi ? j + 1 : j
      const raw = text.slice(amp, end)
      // 前导零不影响数值（&#x000041; 是 “A”）；有效位过长时必然超出范围
      const significant = digits.replace(/^0+/, '')
      let cp = significant.length > 8 ? Infinity : parseInt(significant || '0', hex ? 16 : 10)
      let note: string | null = null
      if (cp === 0) note = '码点 0 不是合法字符，已替换为 U+FFFD'
      else if (cp > 0x10ffff) note = '超出 Unicode 范围（最大 U+10FFFF），已替换为 U+FFFD'
      else if (cp >= 0xd800 && cp <= 0xdfff) note = '代理项码点不能单独使用，已替换为 U+FFFD'
      if (note) cp = 0xfffd
      else if (C1_REMAP[cp]) {
        note = `按 HTML 标准，${raw} 视为 Windows-1252 字符“${String.fromCodePoint(C1_REMAP[cp])}”`
        cp = C1_REMAP[cp]
      }
      if (note) issue(amp, end - amp, note.includes('FFFD') ? 'warning' : 'info', note)
      else if (!semi) issue(amp, end - amp, 'info', `${raw} 缺少结尾分号（已按数字引用解码）`)
      out += String.fromCodePoint(cp)
      counts.numeric++
      i = end
      continue
    }

    // ── 命名引用
    while (j < n && isAlnum(text.charCodeAt(j))) j++
    const name = text.slice(amp + 1, j)
    if (!name) {
      out += '&'
      i = amp + 1
      continue
    }
    if (text.charCodeAt(j) === 59) {
      const v = NAMED_ENTITIES.get(name)
      if (v !== undefined) {
        out += v
        counts.named++
        i = j + 1
        continue
      }
    }
    // 旧式实体可以省略分号：取最长的匹配前缀（&copy2019 → ©2019）
    let matched = ''
    for (let len = Math.min(name.length, LEGACY_MAX); len >= 2; len--) {
      const cand = name.slice(0, len)
      if (LEGACY_ENTITIES.has(cand)) {
        matched = cand
        break
      }
    }
    if (matched) {
      out += NAMED_ENTITIES.get(matched)!
      counts.named++
      issue(amp, matched.length + 1, 'info', `&${matched} 缺少结尾分号（已按旧式实体解码）`)
      i = amp + 1 + matched.length
      continue
    }
    if (text.charCodeAt(j) === 59) {
      const lower = NAMED_ENTITIES.has(name.toLowerCase()) ? name.toLowerCase() : null
      issue(
        amp,
        j + 1 - amp,
        'warning',
        `未知实体 &${name};${lower ? `（实体名区分大小写，是否想写 &${lower};？）` : '，已原样保留'}`,
      )
    }
    out += text.slice(amp, j)
    i = j
  }

  return {
    output: out,
    counts,
    issues,
    stillEncoded: counts.named + counts.numeric > 0 && looksEncoded(out),
  }
}

/** 文本中是否含有可识别的实体（用于提示“可能被重复编码”） */
export function looksEncoded(text: string): boolean {
  if (/&#(\d+|x[0-9a-f]+);/i.test(text)) return true
  for (const m of text.matchAll(/&([A-Za-z][A-Za-z0-9]*);/g)) {
    if (NAMED_ENTITIES.has(m[1])) return true
  }
  return false
}
