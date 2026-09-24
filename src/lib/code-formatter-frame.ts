/**
 * 出错位置的源码摘录（类似 Babel 的 code frame，但返回结构化数据）。
 *
 * 界面用「隐形前缀 + ^」来画指示箭头：前缀就是出错列之前的原文，
 * 因此中文、emoji、Tab 等宽度不一的字符也能精确对齐。
 * 被 code-formatter / sql-formatter / json-yaml 共用。
 */

export interface FrameLine {
  /** 1 起始的行号 */
  no: number
  text: string
  /** 是否为出错行 */
  error: boolean
}

export interface CodeFrame {
  /** 1 起始 */
  line: number
  /** 1 起始（按 Unicode 码点计） */
  column: number
  lines: FrameLine[]
  /** 出错行被截断时，箭头之前的可见原文（用于对齐） */
  caretPrefix: string
  /** 箭头宽度（至少 1） */
  caretWidth: number
}

export interface Position {
  /** 1 起始 */
  line: number
  /** 1 起始（按 Unicode 码点计） */
  column: number
}

const LINE_BREAK = /\r\n|\r|\n/

/** 把字符串偏移（UTF-16 下标）换算成 1 起始的行列（列按码点计，emoji 算 1 列） */
export function offsetToPosition(source: string, offset: number): Position {
  const clamped = Math.max(0, Math.min(offset, source.length))
  let line = 1
  let lineStart = 0
  for (let i = 0; i < clamped; i++) {
    const c = source.charCodeAt(i)
    if (c === 10) {
      line++
      lineStart = i + 1
    } else if (c === 13) {
      if (source.charCodeAt(i + 1) === 10 && i + 1 < clamped) i++
      line++
      lineStart = i + 1
    }
  }
  const column = Array.from(source.slice(lineStart, clamped)).length + 1
  return { line, column }
}

/** 1 起始行列 → 字符串偏移（列按码点计） */
export function positionToOffset(source: string, line: number, column: number): number {
  const lines = source.split(LINE_BREAK)
  const seps = source.match(/\r\n|\r|\n/g) ?? []
  let offset = 0
  const target = Math.max(1, Math.min(line, lines.length))
  for (let i = 0; i < target - 1; i++) offset += lines[i].length + seps[i].length
  const chars = Array.from(lines[target - 1])
  const col = Math.max(1, Math.min(column, chars.length + 1))
  return offset + chars.slice(0, col - 1).join('').length
}

const TAB = '  '

interface FrameOptions {
  /** 出错行前后展示的行数，默认 2 */
  context?: number
  /** 单行最多展示的字符数（超长的压缩代码会以出错列为中心截取），默认 96 */
  maxChars?: number
  /** 箭头宽度（如出错的 token 长度） */
  width?: number
}

/** 生成出错位置附近的源码摘录；行列越界时会被夹到合法范围 */
export function buildFrame(
  source: string,
  line: number,
  column: number,
  { context = 2, maxChars = 96, width = 1 }: FrameOptions = {},
): CodeFrame {
  const all = source.split(LINE_BREAK)
  const ln = Math.max(1, Math.min(Math.floor(line) || 1, all.length))
  const errChars = Array.from(all[ln - 1])
  const col = Math.max(1, Math.min(Math.floor(column) || 1, errChars.length + 1))

  // 以出错列为中心截取超长行
  let start = 0
  if (errChars.length > maxChars) {
    start = Math.max(0, Math.min(col - 1 - Math.floor(maxChars / 2), errChars.length - maxChars))
  }
  const clip = (text: string) => {
    const chars = Array.from(text)
    if (chars.length <= maxChars && start === 0) return text.replace(/\t/g, TAB)
    const s = Math.min(start, chars.length)
    const piece = chars.slice(s, s + maxChars).join('')
    return (s > 0 ? '…' : '') + piece.replace(/\t/g, TAB) + (s + maxChars < chars.length ? '…' : '')
  }

  const lines: FrameLine[] = []
  for (let n = Math.max(1, ln - context); n <= Math.min(all.length, ln + context); n++) {
    lines.push({ no: n, text: clip(all[n - 1]), error: n === ln })
  }

  const prefixChars = errChars.slice(start, col - 1).join('')
  const caretPrefix = (start > 0 ? '…' : '') + prefixChars.replace(/\t/g, TAB)
  const rest = errChars.length - (col - 1)
  const caretWidth = Math.max(1, Math.min(width, rest > 0 ? rest : 1, maxChars))

  return { line: ln, column: col, lines, caretPrefix, caretWidth }
}

/** 纯文本形式（测试与复制用）：`> 2 | code` + 箭头行 */
export function frameToText(frame: CodeFrame): string {
  const gutter = String(frame.lines[frame.lines.length - 1]?.no ?? frame.line).length
  const out: string[] = []
  for (const l of frame.lines) {
    const no = String(l.no).padStart(gutter)
    out.push(`${l.error ? '>' : ' '} ${no} | ${l.text}`.trimEnd())
    if (l.error) {
      const pad = Array.from(frame.caretPrefix)
        .map((c) => (c === '\t' ? '  ' : ' '))
        .join('')
      out.push(`  ${' '.repeat(gutter)} | ${pad}${'^'.repeat(frame.caretWidth)}`)
    }
  }
  return out.join('\n')
}
