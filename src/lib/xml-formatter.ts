/**
 * XML 格式化 / 压缩 / 校验（纯函数，不依赖 DOMParser，可在 Node 中运行）。
 *
 * 自研分词器：XML 声明、DOCTYPE（含内部子集）、注释、CDATA、处理指令、命名空间、
 * 自闭合标签、属性（保留原引号）、实体引用校验；错误信息带行列号。
 */

import { LineIndex } from './text-position'

/* ───────────────────────── 类型 ───────────────────────── */

export interface XmlIssue {
  message: string
  hint?: string
  line: number
  column: number
  offset: number
}

export interface XmlAttr {
  name: string
  /** 原文（实体引用不解码） */
  value: string
  quote: '"' | "'"
  offset: number
}

export interface XmlElement {
  type: 'element'
  name: string
  attrs: XmlAttr[]
  children: XmlNode[]
  /** 原文是否写成 <a/> */
  selfClosing: boolean
  start: number
}

export interface XmlText {
  type: 'text'
  /** 原文（实体引用不解码） */
  text: string
}

/** CDATA、注释、处理指令（含 XML 声明）、DOCTYPE：都按原文保存 */
export interface XmlRaw {
  type: 'cdata' | 'comment' | 'pi' | 'doctype'
  text: string
}

export type XmlNode = XmlElement | XmlText | XmlRaw

export interface XmlDocument {
  children: XmlNode[]
}

export type XmlParseResult =
  { ok: true; doc: XmlDocument; warnings: XmlIssue[] } | { ok: false; error: XmlIssue }

/* ───────────────────────── 解析 ───────────────────────── */

class XmlFail extends Error {
  readonly offset: number
  readonly hint?: string
  constructor(offset: number, message: string, hint?: string) {
    super(message)
    this.offset = offset
    this.hint = hint
  }
}

const NAME = /[\p{L}_:][\p{L}\p{N}\p{M}_:.\-\u00B7\u203F\u2040]*/uy
const ENTITY = /&(?:#[0-9]+|#x[0-9a-fA-F]+|[\p{L}_:][\p{L}\p{N}_:.-]*);/uy
const MAX_WARNINGS = 30
/** 最大嵌套层数：打印是递归的，过深的文档会撑爆调用栈 */
export const MAX_XML_DEPTH = 1000

function isWs(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13
}

function describe(ch: string | undefined): string {
  if (ch === undefined) return '文本结尾'
  if (ch === ' ') return '空格'
  if (ch === '\n' || ch === '\r') return '换行'
  if (ch === '\t') return '制表符'
  return `"${ch}"`
}

class XmlParser {
  readonly s: string
  i = 0
  readonly index: LineIndex
  readonly doc: XmlDocument = { children: [] }
  readonly stack: XmlElement[] = []
  /** 每层元素声明的命名空间前缀 */
  readonly ns: Array<Set<string>> = []
  readonly warnings: XmlIssue[] = []
  readonly warnedPrefixes = new Set<string>()
  roots = 0
  sawDoctype = false
  sawMultiRoot = false
  sawOuterText = false
  bom = 0

  constructor(s: string) {
    this.s = s
    this.index = new LineIndex(s)
  }

  fail(offset: number, message: string, hint?: string): never {
    throw new XmlFail(offset, message, hint)
  }

  warn(offset: number, message: string, hint?: string) {
    if (this.warnings.length >= MAX_WARNINGS) return
    const p = this.index.position(offset)
    this.warnings.push({ message, hint, ...p })
  }

  where(offset: number): string {
    const p = this.index.position(offset)
    return `第 ${p.line} 行第 ${p.column} 列`
  }

  add(node: XmlNode) {
    const top = this.stack[this.stack.length - 1]
    if (top) top.children.push(node)
    else this.doc.children.push(node)
  }

  readName(at: number): string {
    NAME.lastIndex = at
    const m = NAME.exec(this.s)
    return m ? m[0] : ''
  }

  skipWs(j: number): number {
    while (j < this.s.length && isWs(this.s.charCodeAt(j))) j++
    return j
  }

  /** 校验 & 开头的实体引用；base 为 text 在原文中的偏移 */
  checkEntities(text: string, base: number, where: string) {
    let k = text.indexOf('&')
    while (k >= 0) {
      ENTITY.lastIndex = k
      const m = ENTITY.exec(text)
      if (!m) {
        this.fail(
          base + k,
          `${where}中有未转义的 "&"`,
          '"&" 要写作 &amp;；实体引用要以 ";" 结尾，例如 &lt; &#169; &#x4E2D;',
        )
      }
      k = text.indexOf('&', k + m[0].length)
    }
  }

  parse(): XmlDocument {
    const s = this.s
    if (s.charCodeAt(0) === 0xfeff) this.i = this.bom = 1
    while (this.i < s.length) {
      const lt = s.indexOf('<', this.i)
      if (lt !== this.i) {
        const end = lt < 0 ? s.length : lt
        this.text(this.i, end)
        this.i = end
        continue
      }
      if (s.startsWith('<!--', lt)) this.comment()
      else if (s.startsWith('<![CDATA[', lt)) this.cdata()
      else if (s.slice(lt, lt + 9).toUpperCase() === '<!DOCTYPE') this.doctype()
      else if (s.startsWith('<!', lt))
        this.fail(
          lt,
          '无法识别的声明 "<!"',
          '只支持 <!-- 注释 -->、<![CDATA[ … ]]> 和 <!DOCTYPE …>',
        )
      else if (s.startsWith('<?', lt)) this.pi()
      else if (s.startsWith('</', lt)) this.closeTag()
      else this.openTag()
    }
    const top = this.stack[this.stack.length - 1]
    if (top) {
      this.fail(top.start, `标签 <${top.name}> 没有闭合`, `直到文档结束都没有找到 </${top.name}>`)
    }
    if (this.roots === 0) {
      const first = s.length - s.trimStart().length
      this.fail(first, '没有找到任何 XML 元素', 'XML 至少需要一个根元素，例如 <root>…</root>')
    }
    return this.doc
  }

  text(start: number, end: number) {
    const raw = this.s.slice(start, end)
    const cdEnd = raw.indexOf(']]>')
    if (cdEnd >= 0)
      this.fail(
        start + cdEnd,
        '文本中不能出现 "]]>"',
        '它是 CDATA 的结束标记；如果是正文内容，请把 ">" 写作 &gt;，即 ]]&gt;',
      )
    this.checkEntities(raw, start, '文本')
    if (this.stack.length === 0) {
      if (!raw.trim()) return
      if (!this.sawOuterText) {
        this.sawOuterText = true
        const off = start + (raw.length - raw.trimStart().length)
        this.warn(off, '根元素之外存在文本内容', '标准 XML 文档中，文本只能出现在根元素内部')
      }
    }
    this.add({ type: 'text', text: raw })
  }

  comment() {
    const s = this.s
    const start = this.i
    const end = s.indexOf('-->', start + 4)
    if (end < 0) this.fail(start, '注释没有结束：缺少 "-->"')
    const body = s.slice(start + 4, end)
    const dd = body.indexOf('--')
    if (dd >= 0)
      this.warn(start + 4 + dd, '注释内容中不应出现 "--"', 'XML 规范不允许注释里有连续两个减号')
    this.add({ type: 'comment', text: s.slice(start, end + 3) })
    this.i = end + 3
  }

  cdata() {
    const s = this.s
    const start = this.i
    if (this.stack.length === 0) this.fail(start, 'CDATA 只能出现在元素内部')
    const end = s.indexOf(']]>', start + 9)
    if (end < 0) this.fail(start, 'CDATA 没有结束：缺少 "]]>"')
    this.add({ type: 'cdata', text: s.slice(start, end + 3) })
    this.i = end + 3
  }

  doctype() {
    const s = this.s
    const start = this.i
    if (this.roots > 0 || this.stack.length) this.fail(start, 'DOCTYPE 必须位于根元素之前')
    if (this.sawDoctype) this.fail(start, '一个文档只能有一个 DOCTYPE 声明')
    this.sawDoctype = true
    let j = start + 9
    let depth = 0
    let quote = ''
    for (; j < s.length; j++) {
      const ch = s[j]
      if (quote) {
        if (ch === quote) quote = ''
      } else if (ch === '"' || ch === "'") quote = ch
      else if (s.startsWith('<!--', j)) {
        const e = s.indexOf('-->', j + 4)
        if (e < 0) this.fail(j, '注释没有结束：缺少 "-->"')
        j = e + 2
      } else if (ch === '[') depth++
      else if (ch === ']') depth--
      else if (ch === '>' && depth <= 0) break
    }
    if (j >= s.length) this.fail(start, 'DOCTYPE 没有结束：缺少 ">"')
    this.add({ type: 'doctype', text: s.slice(start, j + 1) })
    this.i = j + 1
  }

  pi() {
    const s = this.s
    const start = this.i
    const end = s.indexOf('?>', start + 2)
    if (end < 0) this.fail(start, '处理指令没有结束：缺少 "?>"')
    const target = this.readName(start + 2)
    if (!target)
      this.fail(start + 2, '处理指令缺少名称', '例如 <?xml-stylesheet href="style.xsl"?>')
    if (target.toLowerCase() === 'xml') {
      if (target !== 'xml') this.fail(start, `XML 声明必须小写：应为 <?xml，而不是 <?${target}`)
      const before = s.slice(this.bom, start)
      if (before.trim() || this.doc.children.length > 0)
        this.fail(start, 'XML 声明 <?xml …?> 只能出现在文档最开头', '把它移到第一行，或者删掉它')
      if (before)
        this.warn(start, 'XML 声明前面有空白', '严格的解析器要求 <?xml 必须是文件的第一个字符')
      const body = s.slice(start, end)
      if (!/\sversion\s*=\s*(["'])1\.\d+\1/.test(body))
        this.fail(start, 'XML 声明缺少 version 属性', '例如 <?xml version="1.0" encoding="UTF-8"?>')
    }
    this.add({ type: 'pi', text: s.slice(start, end + 2) })
    this.i = end + 2
  }

  openTag() {
    const s = this.s
    const start = this.i
    const name = this.readName(start + 1)
    if (!name) {
      if (start + 1 >= s.length) this.fail(start, '文档末尾多了一个 "<"')
      this.fail(
        start,
        `意外的 "<"：后面应紧跟标签名，却是 ${describe(s[start + 1])}`,
        '如果这是文本中的小于号，请写作 &lt;',
      )
    }
    if (this.stack.length === 0 && this.roots > 0 && !this.sawMultiRoot) {
      this.sawMultiRoot = true
      this.warn(
        start,
        `发现多个根元素 <${name}>`,
        '标准 XML 文档只能有一个根元素；这里按 XML 片段处理',
      )
    }
    let j = start + 1 + name.length
    const attrs: XmlAttr[] = []
    const seen = new Set<string>()
    let selfClosing = false
    for (;;) {
      const ws = j
      j = this.skipWs(j)
      const ch = s[j]
      if (ch === undefined) this.fail(start, `标签 <${name}> 没有结束：缺少 ">"`)
      if (ch === '>') {
        j++
        break
      }
      if (ch === '/') {
        if (s[j + 1] !== '>') this.fail(j, '"/" 后面应紧跟 ">"', '自闭合标签的写法是 <tag />')
        selfClosing = true
        j += 2
        break
      }
      if (ch === '<') this.fail(j, `标签 <${name}> 没有结束：缺少 ">"`)
      const attrName = this.readName(j)
      if (!attrName) {
        if (ch === '"' || ch === "'") this.fail(j, '属性值前面缺少属性名和 "="')
        this.fail(j, `标签 <${name}> 中有意外的字符 ${describe(ch)}`, '这里应是属性名、">" 或 "/>"')
      }
      if (j === ws) this.fail(j, `属性 ${attrName} 前面缺少空格`, '属性之间需要用空格分隔')
      const aStart = j
      j = this.skipWs(j + attrName.length)
      if (s[j] !== '=')
        this.fail(
          aStart,
          `属性 ${attrName} 缺少 "=" 和属性值`,
          `例如 ${attrName}="…"；XML 不支持 HTML 那样只写属性名的布尔属性`,
        )
      j = this.skipWs(j + 1)
      const q = s[j]
      if (q !== '"' && q !== "'") {
        const bare = /[^\s/>]*/y
        bare.lastIndex = j
        const word = bare.exec(s)?.[0] ?? ''
        this.fail(j, `属性 ${attrName} 的值必须用引号包裹`, `例如 ${attrName}="${word || '…'}"`)
      }
      const vEnd = s.indexOf(q, j + 1)
      if (vEnd < 0) this.fail(j, `属性 ${attrName} 的值缺少结束引号 ${q}`)
      const value = s.slice(j + 1, vEnd)
      const lt = value.indexOf('<')
      if (lt >= 0)
        this.fail(
          j + 1 + lt,
          `属性 ${attrName} 的值中出现了 "<"`,
          `可能是缺少结束引号 ${q}；如果确实需要小于号，请写作 &lt;`,
        )
      this.checkEntities(value, j + 1, `属性 ${attrName} 的值`)
      if (seen.has(attrName))
        this.fail(aStart, `属性 ${attrName} 重复`, '同一个元素上的属性名不能重复')
      seen.add(attrName)
      attrs.push({ name: attrName, value, quote: q, offset: aStart })
      j = vEnd + 1
    }
    const el: XmlElement = { type: 'element', name, attrs, children: [], selfClosing, start }
    if (this.stack.length >= MAX_XML_DEPTH)
      this.fail(start, `嵌套层级过深：超过 ${MAX_XML_DEPTH} 层`, '请检查是否有大量标签没有闭合')
    if (this.stack.length === 0) this.roots++
    this.add(el)
    this.enterNs(el)
    if (selfClosing) this.ns.pop()
    else this.stack.push(el)
    this.i = j
  }

  /** 登记本元素声明的前缀，并检查用到的前缀是否已声明 */
  enterNs(el: XmlElement) {
    const declared = new Set<string>()
    for (const a of el.attrs) if (a.name.startsWith('xmlns:')) declared.add(a.name.slice(6))
    this.ns.push(declared)
    const check = (qname: string, offset: number) => {
      const c = qname.indexOf(':')
      if (c <= 0) return
      const prefix = qname.slice(0, c)
      if (prefix === 'xml' || prefix === 'xmlns' || this.warnedPrefixes.has(prefix)) return
      for (let k = this.ns.length - 1; k >= 0; k--) if (this.ns[k].has(prefix)) return
      this.warnedPrefixes.add(prefix)
      this.warn(
        offset,
        `命名空间前缀 "${prefix}" 未声明`,
        `需要在当前或外层元素上声明 xmlns:${prefix}="…"；如果这是从完整文档里截取的片段，可以忽略`,
      )
    }
    check(el.name, el.start + 1)
    for (const a of el.attrs) check(a.name, a.offset)
  }

  closeTag() {
    const s = this.s
    const start = this.i
    const name = this.readName(start + 2)
    if (!name) this.fail(start + 2, `闭合标签缺少标签名，却是 ${describe(s[start + 2])}`)
    const j = this.skipWs(start + 2 + name.length)
    if (s[j] !== '>') this.fail(j, `闭合标签 </${name}> 缺少 ">"`)
    const top = this.stack[this.stack.length - 1]
    if (!top) this.fail(start, `多余的闭合标签 </${name}>：前面没有对应的开始标签 <${name}>`)
    if (top.name !== name) {
      const open = this.stack.findLastIndex((e) => e.name === name)
      if (open >= 0)
        this.fail(
          start,
          `标签 <${top.name}>（${this.where(top.start)}）没有闭合，就遇到了 </${name}>`,
          `在这里之前补上 </${top.name}>`,
        )
      this.fail(
        start,
        `闭合标签 </${name}> 与开始标签 <${top.name}>（${this.where(top.start)}）不匹配`,
        `应为 </${top.name}>`,
      )
    }
    this.stack.pop()
    this.ns.pop()
    this.i = j + 1
  }
}

/** 解析 XML 文本 */
export function parseXml(text: string): XmlParseResult {
  const p = new XmlParser(text)
  try {
    const doc = p.parse()
    return { ok: true, doc, warnings: p.warnings }
  } catch (e) {
    if (e instanceof XmlFail) {
      const pos = p.index.position(e.offset)
      const error: XmlIssue = { message: e.message, ...pos }
      if (e.hint) error.hint = e.hint
      return { ok: false, error }
    }
    if (e instanceof RangeError) return { ok: false, error: tooDeep(p.index, p.i) }
    throw e
  }
}

function tooDeep(index: LineIndex, offset: number): XmlIssue {
  return { message: '嵌套层级过深，超出了浏览器的处理能力', ...index.position(offset) }
}

/** 「第 3 行第 15 列：…」 */
export function formatXmlIssue(issue: Pick<XmlIssue, 'line' | 'column' | 'message'>): string {
  return `第 ${issue.line} 行第 ${issue.column} 列：${issue.message}`
}

/* ───────────────────────── 统计 ───────────────────────── */

export interface XmlStats {
  elements: number
  attributes: number
  /** 元素嵌套深度，根元素为 1 */
  maxDepth: number
  comments: number
  cdata: number
}

export function xmlStats(doc: XmlDocument): XmlStats {
  const st: XmlStats = { elements: 0, attributes: 0, maxDepth: 0, comments: 0, cdata: 0 }
  const stack: Array<[XmlNode, number]> = doc.children.map((n) => [n, 1])
  while (stack.length) {
    const [n, d] = stack.pop()!
    if (n.type === 'element') {
      st.elements++
      st.attributes += n.attrs.length
      if (d > st.maxDepth) st.maxDepth = d
      for (const c of n.children) stack.push([c, d + 1])
    } else if (n.type === 'comment') st.comments++
    else if (n.type === 'cdata') st.cdata++
  }
  return st
}

/* ───────────────────────── 打印 ───────────────────────── */

export type AttrWrap = 'auto' | 'always' | 'never'

export interface XmlFormatOptions {
  indent: 2 | 4 | 'tab'
  /** 压缩为一行 */
  minify: boolean
  /** 保留注释 */
  keepComments: boolean
  /** 没有内容的元素写成 <a/> */
  selfClose: boolean
  /** 属性换行：auto = 单行超过 printWidth 时每个属性一行 */
  attrWrap: AttrWrap
  /** 单行最大宽度，默认 100 */
  printWidth?: number
}

export const DEFAULT_XML_OPTIONS: XmlFormatOptions = {
  indent: 2,
  minify: false,
  keepComments: true,
  selfClose: true,
  attrWrap: 'auto',
  printWidth: 100,
}

const isBlank = (t: string) => !/[^ \t\r\n]/.test(t)

/** 混合内容：子节点里有非空白文本（如 <p>Hello <b>a</b> <i>b</i></p>） */
const isMixed = (nodes: XmlNode[]) => nodes.some((n) => n.type === 'text' && !isBlank(n.text))

/**
 * 内联 / 压缩时一段文本的输出：首尾的排版空白去掉、内部换行缩进折叠成一个空格。
 * 混合内容中，夹在两个节点之间的纯空白是有意义的（"</b> <i>" 之间的空格），折叠成一个空格保留。
 */
function inlineText(t: string, first: boolean, last: boolean, mixed: boolean): string {
  if (isBlank(t)) return mixed && !first && !last ? ' ' : ''
  return collapseLayout(trimLayout(t, first, last))
}

/** 把含换行的空白折叠成一个空格（缩进产生的空白），不含换行的空白保持原样 */
function collapseLayout(t: string): string {
  return t.replace(/[ \t]*[\r\n][ \t\r\n]*/g, ' ')
}

function trimLayout(t: string, start: boolean, end: boolean): string {
  let r = t
  if (start) r = r.replace(/^[ \t\r\n]+/, '')
  if (end) r = r.replace(/[ \t\r\n]+$/, '')
  return r
}

function preserveSpace(el: XmlElement, inherited: boolean): boolean {
  const a = el.attrs.find((x) => x.name === 'xml:space')
  return a ? a.value === 'preserve' : inherited
}

function attrText(a: XmlAttr): string {
  return `${a.name}=${a.quote}${a.value}${a.quote}`
}

function openTag(el: XmlElement, close: '>' | '/>'): string {
  return `<${el.name}${el.attrs.map((a) => ' ' + attrText(a)).join('')}${close}`
}

/** 原样序列化（用于 xml:space="preserve"） */
function serializeRaw(nodes: XmlNode[]): string {
  let out = ''
  for (const n of nodes) {
    if (n.type === 'element') {
      out +=
        n.children.length === 0 && n.selfClosing
          ? openTag(n, '/>')
          : openTag(n, '>') + serializeRaw(n.children) + `</${n.name}>`
    } else out += n.text
  }
  return out
}

function minifyNodes(nodes: XmlNode[], o: XmlFormatOptions, preserve: boolean): string {
  let out = ''
  const kept = nodes.filter((n) => o.keepComments || n.type !== 'comment')
  const mixed = isMixed(kept)
  kept.forEach((n, i) => {
    switch (n.type) {
      case 'text':
        out += preserve ? n.text : inlineText(n.text, i === 0, i === kept.length - 1, mixed)
        return
      case 'element': {
        const keep = preserveSpace(n, preserve)
        const inner = minifyNodes(n.children, o, keep)
        out +=
          inner === '' && (n.selfClosing || o.selfClose)
            ? openTag(n, '/>')
            : openTag(n, '>') + inner + `</${n.name}>`
        return
      }
      default:
        out += n.text
    }
  })
  return out
}

class PrettyPrinter {
  readonly lines: string[] = []
  readonly unit: string
  readonly unitWidth: number
  readonly width: number
  readonly o: XmlFormatOptions
  private readonly indents: string[] = ['']

  constructor(o: XmlFormatOptions) {
    this.o = o
    this.unit = o.indent === 'tab' ? '\t' : ' '.repeat(o.indent)
    this.unitWidth = o.indent === 'tab' ? 4 : o.indent
    this.width = o.printWidth ?? 100
  }

  ind(level: number): string {
    return (this.indents[level] ??= this.unit.repeat(level))
  }

  keep = (n: XmlNode): boolean =>
    n.type === 'text' ? !isBlank(n.text) : n.type !== 'comment' || this.o.keepComments

  printNodes(nodes: XmlNode[], level: number) {
    for (const n of nodes) if (this.keep(n)) this.printNode(n, level)
  }

  printNode(n: XmlNode, level: number) {
    if (n.type === 'element') return this.printElement(n, level, false)
    if (n.type === 'text') {
      for (const line of n.text.split(/\r\n|\r|\n/)) {
        const t = line.trim()
        if (t) this.lines.push(this.ind(level) + t)
      }
      return
    }
    // 注释、CDATA、PI、DOCTYPE：原样输出，统一换行符
    this.lines.push(this.ind(level) + n.text.replace(/\r\n?/g, '\n'))
  }

  /** 开始标签（可能按属性换行成多行），返回各行（已缩进） */
  openLines(el: XmlElement, level: number, close: '>' | '/>'): string[] {
    const single = this.ind(level) + openTag(el, close)
    const { attrWrap } = this.o
    const wrap =
      el.attrs.length > 1 &&
      (attrWrap === 'always' ||
        (attrWrap === 'auto' && level * this.unitWidth + openTag(el, close).length > this.width))
    if (!wrap) return [single]
    // 每个属性一行，结尾的 > 或 /> 单独一行，与子元素区分开
    const lines = [this.ind(level) + '<' + el.name]
    for (const a of el.attrs) lines.push(this.ind(level + 1) + attrText(a))
    lines.push(this.ind(level) + close)
    return lines
  }

  /** 尝试把元素及其内容排在一行里；不能内联时返回 null */
  inline(el: XmlElement, preserve: boolean): string | null {
    const keep = preserveSpace(el, preserve)
    if (keep) {
      const raw = serializeRaw([el])
      return raw.includes('\n') ? null : raw
    }
    if (!el.children.some(this.keep)) {
      return el.selfClosing || this.o.selfClose
        ? openTag(el, '/>')
        : openTag(el, '>') + `</${el.name}>`
    }
    // 混合内容保留节点之间的空白，所以这里只去掉被丢弃的注释，不去掉空白文本
    const kids = el.children.filter((n) => n.type !== 'comment' || this.o.keepComments)
    const mixed = isMixed(kids)
    let body = ''
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]
      if (k.type === 'text') {
        body += inlineText(k.text, i === 0, i === kids.length - 1, mixed)
      } else if (k.type === 'cdata' || k.type === 'comment') {
        if (k.text.includes('\n')) return null
        body += k.text
      } else if (k.type === 'element') {
        const s = this.inline(k, false)
        if (s === null) return null
        body += s
      } else return null
    }
    return openTag(el, '>') + body + `</${el.name}>`
  }

  printElement(el: XmlElement, level: number, inheritedPreserve: boolean) {
    const preserve = preserveSpace(el, inheritedPreserve)
    const indent = this.ind(level)

    if (preserve) {
      // 内容原样保留
      const raw = serializeRaw([el]).replace(/\r\n?/g, '\n')
      this.lines.push(indent + raw)
      return
    }

    const kids = el.children.filter(this.keep)
    if (kids.length === 0) {
      if (el.selfClosing || this.o.selfClose) this.lines.push(...this.openLines(el, level, '/>'))
      else {
        const open = this.openLines(el, level, '>')
        open[open.length - 1] += `</${el.name}>`
        this.lines.push(...open)
      }
      return
    }

    // 有文本内容（纯文本或混合内容）时，短的整体放在一行
    const hasText = kids.some((k) => k.type === 'text' || k.type === 'cdata')
    if (hasText) {
      const one = this.inline(el, false)
      if (one !== null && level * this.unitWidth + one.length <= this.width) {
        this.lines.push(indent + one)
        return
      }
    }

    this.lines.push(...this.openLines(el, level, '>'))
    for (const k of kids) {
      if (k.type === 'element') this.printElement(k, level + 1, false)
      else this.printNode(k, level + 1)
    }
    this.lines.push(indent + `</${el.name}>`)
  }
}

export type XmlFormatResult =
  | { ok: true; output: string; warnings: XmlIssue[]; stats: XmlStats }
  | { ok: false; error: XmlIssue }

/** 格式化或压缩 XML */
export function formatXml(input: string, opts: Partial<XmlFormatOptions> = {}): XmlFormatResult {
  const o: XmlFormatOptions = { ...DEFAULT_XML_OPTIONS, ...opts }
  const r = parseXml(input)
  if (!r.ok) return r
  const stats = xmlStats(r.doc)
  if (o.minify) {
    return { ok: true, output: minifyNodes(r.doc.children, o, false), warnings: r.warnings, stats }
  }
  const p = new PrettyPrinter(o)
  p.printNodes(r.doc.children, 0)
  return { ok: true, output: p.lines.join('\n'), warnings: r.warnings, stats }
}
