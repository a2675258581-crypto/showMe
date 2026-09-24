/**
 * 文本位置工具：偏移量 ↔ 行列号、出错行的代码片段（code frame）。
 * 纯函数，无 DOM 依赖。JSON / XML 格式化共用。
 *
 * 约定：
 * - offset 是 UTF-16 下标（与 JS 字符串一致）
 * - line / column 从 1 开始；column 按 Unicode 码点计数（emoji、中文都算 1 列），制表符算 1 列
 * - 换行符 \n、\r\n、单独的 \r 都算一次换行
 */

export interface TextPosition {
  line: number
  column: number
  offset: number
}

/** 统计 [from, to) 之间的码点数（代理对算 1 个） */
function countCodePoints(text: string, from: number, to: number): number {
  let n = 0
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < to) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) i++
    }
    n++
  }
  return n
}

/** 预先建立行首索引，适合需要多次查询行列号的场景（二分查找） */
export class LineIndex {
  readonly starts: number[] = [0]
  readonly text: string

  constructor(text: string) {
    this.text = text
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c === 10) this.starts.push(i + 1)
      else if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) i++
        this.starts.push(i + 1)
      }
    }
  }

  get lineCount(): number {
    return this.starts.length
  }

  position(offset: number): TextPosition {
    const off = Math.max(0, Math.min(offset, this.text.length))
    let lo = 0
    let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.starts[mid] <= off) lo = mid
      else hi = mid - 1
    }
    return {
      line: lo + 1,
      column: countCodePoints(this.text, this.starts[lo], off) + 1,
      offset: off,
    }
  }

  /** 第 line 行的文本（不含换行符） */
  lineText(line: number): string {
    const i = line - 1
    if (i < 0 || i >= this.starts.length) return ''
    const start = this.starts[i]
    let end = i + 1 < this.starts.length ? this.starts[i + 1] : this.text.length
    if (end > start && this.text.charCodeAt(end - 1) === 10) end--
    if (end > start && this.text.charCodeAt(end - 1) === 13) end--
    return this.text.slice(start, end)
  }
}

/** 单次查询偏移量对应的行列号（只扫描到 offset 为止） */
export function positionAt(text: string, offset: number): TextPosition {
  const off = Math.max(0, Math.min(offset, text.length))
  let line = 1
  let lineStart = 0
  for (let i = 0; i < off; i++) {
    const c = text.charCodeAt(i)
    if (c === 10) {
      line++
      lineStart = i + 1
    } else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        if (i + 1 >= off) break
        i++
      }
      line++
      lineStart = i + 1
    }
  }
  return { line, column: countCodePoints(text, lineStart, off) + 1, offset: off }
}

/**
 * 把「第 column 个码点」换算成该行内的 UTF-16 偏移（0 起），
 * 用于把行列号映射回编辑器位置。超出行尾时返回行长度。
 */
export function columnToUtf16(lineText: string, column: number): number {
  let cp = 1
  let i = 0
  while (i < lineText.length && cp < column) {
    const c = lineText.charCodeAt(i)
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < lineText.length ? 2 : 1
    cp++
  }
  return i
}

export interface CodeFrameLine {
  number: number
  text: string
}

export interface CodeFrame {
  /** 出错行之前的上下文 */
  before: CodeFrameLine[]
  /** 出错行，拆成「光标前 / 出错字符 / 光标后」三段，方便高亮与对齐插入符 */
  line: { number: number; prefix: string; char: string; suffix: string }
  /** 出错行之后的上下文 */
  after: CodeFrameLine[]
}

/**
 * 生成出错位置附近的代码片段。超长的行（比如压缩过的 JSON）会以出错列为中心截取窗口，
 * 两端用 … 标出被省略的部分。
 */
export function codeFrame(
  text: string,
  line: number,
  column: number,
  context = 2,
  maxWidth = 96,
): CodeFrame {
  const index = new LineIndex(text)
  const total = index.lineCount
  const ln = Math.max(1, Math.min(line, total))
  const errCps = Array.from(index.lineText(ln))
  const col = Math.max(1, Math.min(column, errCps.length + 1))

  // 窗口：[winStart, winEnd) 码点范围
  let winStart = 0
  let winEnd = Infinity
  if (errCps.length > maxWidth) {
    const lead = Math.floor(maxWidth * 0.4)
    winStart = Math.max(0, Math.min(col - 1 - lead, errCps.length - maxWidth))
    winEnd = winStart + maxWidth
  }

  const clip = (cps: string[]) => {
    if (winEnd === Infinity) return cps.join('')
    let s = cps.slice(winStart, winEnd).join('')
    if (winStart > 0 && cps.length > 0) s = '…' + s
    if (cps.length > winEnd) s += '…'
    return s
  }

  const ctx = (n: number): CodeFrameLine => ({
    number: n,
    text: clip(Array.from(index.lineText(n))),
  })

  const before: CodeFrameLine[] = []
  for (let n = Math.max(1, ln - context); n < ln; n++) before.push(ctx(n))
  const after: CodeFrameLine[] = []
  for (let n = ln + 1; n <= Math.min(total, ln + context); n++) after.push(ctx(n))

  const lo = winStart
  const hi = winEnd === Infinity ? errCps.length : Math.min(winEnd, errCps.length)
  const prefix = (lo > 0 ? '…' : '') + errCps.slice(lo, col - 1).join('')
  const char = errCps[col - 1] ?? ''
  let suffix = errCps.slice(col, hi).join('')
  if (errCps.length > hi) suffix += '…'

  return { before, line: { number: ln, prefix, char, suffix }, after }
}

/** 字符串按 UTF-8 编码后的字节数（不分配内存） */
export function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (
      c >= 0xd800 &&
      c <= 0xdbff &&
      i + 1 < s.length &&
      (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00
    ) {
      n += 4
      i++
    } else n += 3
  }
  return n
}
