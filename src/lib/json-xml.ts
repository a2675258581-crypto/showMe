/**
 * JSON ⇄ XML 互转（纯逻辑，基于 fast-xml-parser）。
 *
 * - XML → JSON：属性加前缀（默认 `@_`），文本节点用 `#text`，同名子元素合并成数组；
 *   可选把数字 / 布尔值转换成对应类型（能原样转回时才转换，如 007、1.0 仍是字符串）。
 * - JSON → XML：顶层有多个键、是数组或基本值时自动用根元素包裹；
 *   嵌套数组、空数组、非法的元素名都会被妥善处理并给出提示。
 * - XML 错误带行列号与源码摘录。
 */
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import { buildFrame, offsetToPosition, positionToOffset } from './code-formatter-frame'
import { numberWarning, parseJsonExact } from './json-csv-numbers'
import { parseJson, type ConvertIssue } from './json-yaml'

export type XmlDirection = 'json2xml' | 'xml2json'
export type XmlIndent = 2 | 4 | 'tab' | 0

export interface JsonXmlOptions {
  /** 属性键前缀（JSON 一侧），默认 `@_` */
  attrPrefix: string
  /** 文本节点键名，默认 `#text` */
  textKey: string
  /** JSON → XML：需要包裹时使用的根元素名 */
  rootName: string
  /** 输出缩进；0 表示压缩成一行 */
  indent: XmlIndent
  /** XML → JSON：把数字、布尔值转换成对应类型 */
  parseValues: boolean
  /** XML → JSON：忽略 `<?xml …?>` 声明 */
  ignoreDeclaration: boolean
  /** JSON → XML：输出 `<?xml version="1.0" encoding="UTF-8"?>` 声明 */
  declaration: boolean
}

export const DEFAULT_JSON_XML_OPTIONS: JsonXmlOptions = {
  attrPrefix: '@_',
  textKey: '#text',
  rootName: 'root',
  indent: 2,
  parseValues: true,
  ignoreDeclaration: true,
  declaration: true,
}

export interface XmlConvertStats {
  /** 元素个数（JSON → XML 为输出的元素数） */
  elements: number
  attributes: number
  /** JSON → XML：是否自动加了根元素 */
  wrapped: boolean
}

/** 错误：message + 行列号 + 源码摘录，另有可选的修改建议 */
export interface JsonXmlIssue extends ConvertIssue {
  hint?: string
}

export type XmlConvertResult =
  | ({ ok: true; output: string; warnings: string[] } & XmlConvertStats)
  | { ok: false; error: JsonXmlIssue }

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const indentString = (i: XmlIndent) => (i === 'tab' ? '\t' : ' '.repeat(i || 0))

/** 设置自有属性（`__proto__` 这类键也按普通键处理，不会改动原型） */
function setOwn(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__')
    Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
  else obj[key] = value
}

/** 合并默认值；文本键留空时两个方向都按默认的 #text 处理 */
function resolveOptions(options: Partial<JsonXmlOptions>): JsonXmlOptions {
  const opts = { ...DEFAULT_JSON_XML_OPTIONS, ...options }
  if (!opts.textKey) opts.textKey = DEFAULT_JSON_XML_OPTIONS.textKey
  return opts
}

/* ───────────────────────── 标量类型转换 ───────────────────────── */

/**
 * 把 XML 文本转换成数字 / 布尔值；只有能原样转回去时才转换：
 * 42、-3.5、true 会转换；007、1.0、1e5、超过安全范围的整数保持字符串。
 */
export function typeScalar(s: string): string | number | boolean {
  if (s === 'true') return true
  if (s === 'false') return false
  if (!/^-?\d/.test(s)) return s
  const n = Number(s)
  if (!Number.isFinite(n) || String(n) !== s) return s
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) return s
  return n
}

/* ───────────────────────── XML 名称 ───────────────────────── */

const XML_NAME = /^[\p{L}_][\p{L}\p{N}\p{M}_.\-:·]*$/u

export function isXmlName(name: string): boolean {
  return XML_NAME.test(name) && !name.endsWith(':') && !name.includes('::')
}

/** 把任意字符串整理成合法的 XML 元素 / 属性名 */
export function toXmlName(name: string): string {
  if (isXmlName(name)) return name
  let out = Array.from(name)
    .map((ch) => (/[\p{L}\p{N}\p{M}_.\-·]/u.test(ch) ? ch : '_'))
    .join('')
  if (!/^[\p{L}_]/u.test(out)) out = '_' + out
  return out
}

/* ───────────────────────── JSON → XML ───────────────────────── */

/** 内部统一使用的属性前缀 / 文本键：合法的 XML 名称不可能以 @ 或 # 开头，不会冲突 */
const ATTR = '@_'
const TEXT = '#text'
const ITEM = 'item'

interface BuildCtx {
  opts: JsonXmlOptions
  renamed: Map<string, string>
  stringified: Set<string>
  emptyArrays: Set<string>
  elements: number
  attributes: number
}

const scalarText = (v: unknown): string | number | boolean =>
  v === null || v === undefined
    ? ''
    : typeof v === 'object'
      ? JSON.stringify(v)
      : (v as string | number | boolean)

function rename(ctx: BuildCtx, key: string): string {
  const name = toXmlName(key)
  if (name !== key) ctx.renamed.set(key, name)
  return name
}

/** 把一个 JSON 值转换成 XMLBuilder 需要的结构（作为某个元素的内容） */
function toNode(value: unknown, ctx: BuildCtx, path: string): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      ctx.emptyArrays.add(path || '（根数组）')
      return ''
    }
    // 数组直接嵌套数组：用 <item> 包一层
    return toElement({ [ITEM]: value }, ctx, path)
  }
  if (isPlainObject(value)) return toElement(value, ctx, path)
  if (value === null || value === undefined) return ''
  return value
}

function toElement(obj: Record<string, unknown>, ctx: BuildCtx, path: string): unknown {
  const { attrPrefix, textKey } = ctx.opts
  const out: Record<string, unknown> = {}
  const used = new Set<string>()
  const claim = (name: string) => {
    let n = name
    for (let i = 2; used.has(n); i++) n = `${name}_${i}`
    used.add(n)
    return n
  }
  for (const [key, value] of Object.entries(obj)) {
    const here = path ? `${path}.${key}` : key
    if (attrPrefix && key.startsWith(attrPrefix) && key.length > attrPrefix.length) {
      const name = rename(ctx, key.slice(attrPrefix.length))
      if (typeof value === 'object' && value !== null) ctx.stringified.add(here)
      // 属性与子元素的名字互不影响：属性在 used 里带 @ 记录
      const attrName = claim('@' + name).slice(1)
      setOwn(out, ATTR + attrName, String(scalarText(value)))
      ctx.attributes++
      continue
    }
    if (key === textKey) {
      if (typeof value === 'object' && value !== null) ctx.stringified.add(here)
      out[TEXT] = scalarText(value)
      continue
    }
    const name = claim(rename(ctx, key))
    if (Array.isArray(value)) {
      if (value.length === 0) {
        ctx.emptyArrays.add(here)
        continue
      }
      setOwn(
        out,
        name,
        value.map((item, i) => {
          ctx.elements++
          return toNode(item, ctx, `${here}[${i}]`)
        }),
      )
      continue
    }
    ctx.elements++
    setOwn(out, name, toNode(value, ctx, here))
  }
  return out
}

function describeList(items: Iterable<string>, max = 3): string {
  const list = [...items]
  const shown = list.slice(0, max).join('、')
  return list.length > max ? `${shown} 等 ${list.length} 处` : shown
}

/** JSON 文本 → XML 文本 */
export function jsonToXml(text: string, options: Partial<JsonXmlOptions> = {}): XmlConvertResult {
  const opts = resolveOptions(options)
  if (!text.trim())
    return { ok: true, output: '', warnings: [], elements: 0, attributes: 0, wrapped: false }
  const parsed = parseJson(text)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  // 超出精度的数字按原文输出（1234567890123456789 不会变成 …800）
  const exact = parseJsonExact(text)
  const value = exact.value

  const ctx: BuildCtx = {
    opts,
    renamed: new Map(),
    stringified: new Set(),
    emptyArrays: new Set(),
    elements: 0,
    attributes: 0,
  }
  const rootName = toXmlName(opts.rootName.trim() || 'root')

  // 判断是否需要额外的根元素
  let body: Record<string, unknown>
  let declAttrs: Record<string, unknown> | null = null
  let wrapped = false
  const droppedPis: string[] = []
  const indent = indentString(opts.indent)
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR,
    textNodeName: TEXT,
    format: opts.indent !== 0,
    indentBy: indent,
    suppressEmptyNode: true,
    suppressBooleanAttributes: false,
    processEntities: true,
  })
  let xml: string
  try {
    if (isPlainObject(value)) {
      const entries = Object.entries(value)
      const pis = entries.filter(([k]) => k.startsWith('?'))
      const rest = entries.filter(([k]) => !k.startsWith('?'))
      const decl = pis.find(([k]) => k === '?xml')
      if (decl && isPlainObject(decl[1])) declAttrs = decl[1]
      for (const [k] of pis) if (k !== '?xml') droppedPis.push(k)
      const single =
        rest.length === 1 &&
        !Array.isArray(rest[0][1]) &&
        rest[0][0] !== opts.textKey &&
        !(opts.attrPrefix && rest[0][0].startsWith(opts.attrPrefix))
      if (single) {
        body = toElement(Object.fromEntries(rest), ctx, '') as Record<string, unknown>
      } else {
        wrapped = true
        ctx.elements++
        body = { [rootName]: toElement(Object.fromEntries(rest), ctx, '') }
      }
    } else {
      wrapped = true
      ctx.elements++
      body = { [rootName]: toNode(value, ctx, '') }
    }
    xml = String(builder.build(body)).trim()
  } catch (e) {
    // 超深的嵌套会让递归栈溢出：给出明确的中文提示，而不是让页面崩溃
    return {
      ok: false,
      error: {
        message:
          e instanceof RangeError && !/string length/i.test(e.message)
            ? 'JSON 嵌套层级过深，无法转换为 XML'
            : `生成 XML 失败：${e instanceof Error ? e.message : String(e)}`,
      },
    }
  }

  if (opts.declaration) {
    const attrs = declAttrs
      ? Object.entries(declAttrs)
          .filter(([k]) => opts.attrPrefix && k.startsWith(opts.attrPrefix))
          .map(([k, v]) => ` ${k.slice(opts.attrPrefix.length)}="${escapeAttr(String(v))}"`)
          .join('')
      : ''
    const decl = `<?xml${attrs || ' version="1.0" encoding="UTF-8"'}?>`
    xml = decl + (opts.indent === 0 ? '' : '\n') + xml
  }

  const warnings: string[] = []
  const numberIssue = numberWarning(exact)
  if (numberIssue) warnings.push(numberIssue)
  const wantedRoot = opts.rootName.trim()
  if (wrapped && wantedRoot && wantedRoot !== rootName)
    warnings.push(`根元素名 “${wantedRoot}” 不是合法的 XML 名称，已改为 ${rootName}`)
  if (ctx.renamed.size)
    warnings.push(
      `${describeList([...ctx.renamed].map(([a, b]) => `“${a}” → ${b}`))} 不是合法的 XML 名称，已自动替换`,
    )
  if (droppedPis.length)
    warnings.push(`处理指令只支持 ?xml 声明，已忽略：${describeList(droppedPis)}`)
  if (ctx.emptyArrays.size)
    warnings.push(`空数组无法用 XML 表示，已省略：${describeList(ctx.emptyArrays)}`)
  if (ctx.stringified.size)
    warnings.push(
      `属性 / 文本节点的值是对象或数组，已转成 JSON 字符串：${describeList(ctx.stringified)}`,
    )
  return {
    ok: true,
    output: xml,
    warnings,
    elements: ctx.elements,
    attributes: ctx.attributes,
    wrapped,
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

/* ───────────────────────── XML → JSON ───────────────────────── */

const XML_REASONS: [RegExp, (...m: string[]) => string, string?][] = [
  [/^Invalid space after '<'/, () => '“<” 后面不能紧跟空格'],
  [/^Tag '(.*)' is an invalid name/, (_, t) => `标签名 ${t} 不合法（不能以数字或标点开头）`],
  [/^Attributes for '(.*)' have open quote/, (_, t) => `标签 <${t}> 的属性值引号没有闭合`],
  [
    /^Closing tag '(.*)' doesn't have proper closing/,
    (_, t) => `结束标签 </${t}> 没有正确闭合（缺少 >）`,
  ],
  [/^Closing tag '(.*)' can't have attributes/, (_, t) => `结束标签 </${t}> 不能带属性`],
  [/^Closing tag '(.*)' has not been opened/, (_, t) => `结束标签 </${t}> 没有对应的开始标签`],
  [
    /^Expected closing tag '(.*)' \(opened in line (\d+), col (\d+)\) instead of closing tag '(.*)'/,
    (_, a, l, c, b) => `这里应为 </${a}>（开始标签在第 ${l} 行第 ${c} 列），却遇到了 </${b}>`,
  ],
  [
    /^Multiple possible root nodes found/,
    () => 'XML 只能有一个根元素，这里出现了第二个根元素',
    '可以把所有内容放进一个外层元素，例如 <root>…</root>',
  ],
  [/^char '&' is not expected/, () => '“&” 必须写成 &amp;（或者是不完整的实体引用）'],
  [/^Extra text at the end/, () => '根元素结束后还有多余的文本'],
  [/^char '(.*)' is not expected/, (_, c) => `意外的字符 “${c}”，XML 应以标签开始`],
  [/^Start tag expected/, () => '没有找到任何 XML 标签'],
  [/^Unclosed tag '(.*)'/, (_, t) => `标签 <${t}> 没有闭合`],
  [
    /^XML declaration allowed only at the start/,
    () => 'XML 声明 <?xml …?> 只能出现在文档最开头（前面不能有空行或其它内容）',
  ],
  [/^Attribute '(.*)' has no space in starting/, (_, a) => `属性 ${a} 前面缺少空格`],
  [/^Attribute '(.*)' is without value/, (_, a) => `属性 ${a} 缺少值，XML 属性必须写成 ${a}="…"`],
  [
    /^boolean attribute '(.*)' is not allowed/,
    (_, a) => `属性 ${a} 缺少值，XML 属性必须写成 ${a}="…"`,
  ],
  [/^Attribute '(.*)' is an invalid name/, (_, a) => `属性名 ${a} 不合法`],
  [/^Attribute '(.*)' is repeated/, (_, a) => `属性 ${a} 重复出现`],
]

function translateXmlReason(msg: string): { message: string; hint?: string } {
  for (const [re, fn, hint] of XML_REASONS) {
    const m = re.exec(msg)
    if (m) return { message: fn(...m), hint }
  }
  return { message: `XML 格式错误：${msg}` }
}

/** XMLValidator 的结果 → 带行列号与源码摘录的中文错误 */
export function validateXml(src: string): JsonXmlIssue | null {
  const r = XMLValidator.validate(src, { allowBooleanAttributes: false })
  if (r === true) return null
  const { msg } = r.err
  let line = r.err.line
  let column = r.err.col ?? 1
  // 多个标签未闭合时校验器只报告第 1 行：改为指向最内层未闭合标签
  const multi = /^Invalid '(\[.*\])' found/.exec(msg)
  let message: string
  let hint: string | undefined
  if (multi) {
    let tags: string[]
    try {
      tags = JSON.parse(multi[1]) as string[]
    } catch {
      tags = []
    }
    message = `以下标签没有闭合：${tags.map((t) => `<${t}>`).join('、')}`
    const last = tags[tags.length - 1]
    if (last) {
      const re = new RegExp(`<${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s/>])`, 'g')
      let offset = -1
      for (let m = re.exec(src); m; m = re.exec(src)) offset = m.index
      if (offset >= 0) ({ line, column } = offsetToPosition(src, offset))
    }
  } else {
    ;({ message, hint } = translateXmlReason(msg))
    // 校验器报告的是读完开始标签后的位置：指回标签开头的 <
    if (/^Multiple possible root nodes/.test(msg)) {
      const lt = src.lastIndexOf('<', positionToOffset(src, line, column))
      if (lt >= 0) ({ line, column } = offsetToPosition(src, lt))
    }
  }
  const issue: JsonXmlIssue = { message, line, column, frame: buildFrame(src, line, column) }
  if (hint) issue.hint = hint
  return issue
}

const MAX_NESTED_TAGS = 1000

/** fast-xml-parser 抛出的（校验器没拦下的）错误 → 中文 */
function translateParserError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (e instanceof RangeError || /Maximum nested tags/i.test(msg))
    return `XML 嵌套层级过深（超过 ${MAX_NESTED_TAGS} 层），无法转换`
  const reserved = /Invalid name: "([^"]*)" is a reserved/.exec(msg)
  if (reserved) return `名称 ${reserved[1]} 是 JavaScript 的保留名，出于安全原因不能转换成 JSON 键`
  if (/entit/i.test(msg)) return `实体展开失败：${msg}（可能是实体嵌套过多或过长）`
  return `XML 解析失败：${msg}`
}

/** XML 文本 → JSON 文本 */
export function xmlToJson(text: string, options: Partial<JsonXmlOptions> = {}): XmlConvertResult {
  const opts = resolveOptions(options)
  const src = stripBom(text)
  if (!src.trim())
    return { ok: true, output: '', warnings: [], elements: 0, attributes: 0, wrapped: false }
  const invalid = validateXml(src)
  if (invalid) return { ok: false, error: invalid }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: opts.attrPrefix,
    textNodeName: opts.textKey,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    ignoreDeclaration: opts.ignoreDeclaration,
    ignorePiTags: false,
    processEntities: true,
    // 解码 &#20013; / &#x4E2D; 这类数字字符引用（以及 &nbsp; 等常见 HTML 实体）
    htmlEntities: true,
    allowBooleanAttributes: false,
    maxNestedTags: MAX_NESTED_TAGS,
  })
  let data: unknown
  try {
    data = parser.parse(src)
  } catch (e) {
    const error: JsonXmlIssue = { message: translateParserError(e) }
    // 保留名：指向源码里第一次出现它的标签 / 属性
    const reserved = /Invalid name: "([^"]*)"/.exec(e instanceof Error ? e.message : '')
    if (reserved) {
      const name = reserved[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const m = new RegExp(`<${name}(?=[\\s/>])|\\s${name}\\s*=`).exec(src)
      if (m) {
        const at = m[0].startsWith('<') ? m.index : m.index + 1
        const { line, column } = offsetToPosition(src, at)
        Object.assign(error, { line, column, frame: buildFrame(src, line, column) })
      }
    }
    return { ok: false, error }
  }

  // 统计 + 类型转换
  let elements = 0
  let attributes = 0
  const prefix = opts.attrPrefix
  const isAttr = (k: string) => prefix !== '' && k.startsWith(prefix)
  const walk = (v: unknown, inPi: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, inPi))
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {}
      // 属性排在最前面，更接近 XML 原文的阅读顺序
      const keys = Object.keys(v)
      const ordered = [...keys.filter(isAttr), ...keys.filter((k) => !isAttr(k))]
      for (const k of ordered) {
        const val = v[k]
        if (isAttr(k)) attributes++
        else if (k !== opts.textKey && !k.startsWith('?'))
          elements += Array.isArray(val) ? val.length : 1
        setOwn(out, k, walk(val, inPi || k.startsWith('?')))
      }
      return out
    }
    if (typeof v === 'string' && opts.parseValues && !inPi) return typeScalar(v)
    return v
  }
  const result = walk(data, false)
  const warnings: string[] = []
  if (isPlainObject(result)) {
    const roots = Object.entries(result)
      .filter(([k]) => !k.startsWith('?'))
      .reduce((n, [, v]) => n + (Array.isArray(v) ? v.length : 1), 0)
    if (roots > 1) warnings.push(`包含 ${roots} 个根元素，严格来说不是合法的 XML 文档`)
  }
  const indent = opts.indent === 0 ? undefined : indentString(opts.indent)
  return {
    ok: true,
    output: JSON.stringify(result, null, indent),
    warnings,
    elements,
    attributes,
    wrapped: false,
  }
}

export function convertJsonXml(
  direction: XmlDirection,
  text: string,
  options: Partial<JsonXmlOptions> = {},
): XmlConvertResult {
  return direction === 'json2xml' ? jsonToXml(text, options) : xmlToJson(text, options)
}
