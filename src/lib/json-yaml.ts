/**
 * JSON ⇄ YAML 互转（纯逻辑，基于 js-yaml 5）。
 *
 * - YAML 按 YAML 1.2 Core Schema 解析（`yes`/`on` 仍是字符串），支持 `<<` 合并键；
 *   锚点 / 别名会被展开成普通值，并对「YAML 炸弹」和循环引用做保护。
 * - 多文档 YAML（`---` 分隔）多于一个文档时转成 JSON 数组；反向可把顶层数组拆成多文档。
 * - 错误信息带行列与源码摘录，常见报错翻译成中文。
 */
import {
  CORE_SCHEMA,
  EVENT_ALIAS,
  YAMLException,
  constructFromEvents,
  defineMappingTag,
  defineScalarTag,
  defineSequenceTag,
  dump,
  mergeTag,
  parseEvents,
  type Schema,
} from 'js-yaml'
import { buildFrame, offsetToPosition, type CodeFrame } from './code-formatter-frame'

export type Direction = 'json2yaml' | 'yaml2json'

export interface JsonYamlOptions {
  /** 输出缩进（JSON 与 YAML 共用） */
  indent: 2 | 4
  /** 按键名排序（递归） */
  sortKeys: boolean
  /** YAML 折行宽度，-1 为不折行 */
  lineWidth: number
  /** YAML 需要加引号时用单引号还是双引号 */
  quoteStyle: 'single' | 'double'
  /** YAML 所有字符串值都加引号 */
  forceQuotes: boolean
  /** JSON → YAML：顶层数组拆成多个 `---` 文档 */
  multiDoc: boolean
  /** YAML → JSON：容忍自定义标签（如 CloudFormation 的 `!Ref`），忽略标签只保留值 */
  customTags: boolean
}

export const DEFAULT_OPTIONS: JsonYamlOptions = {
  indent: 2,
  sortKeys: false,
  lineWidth: 80,
  quoteStyle: 'single',
  forceQuotes: false,
  multiDoc: false,
  customTags: true,
}

export interface ConvertIssue {
  message: string
  /** 1 起始 */
  line?: number
  /** 1 起始 */
  column?: number
  frame?: CodeFrame
}

export interface ConvertStats {
  /** 文档数（JSON → YAML 为输出的文档数） */
  docCount: number
  /** YAML → JSON：展开的别名（*ref）数量 */
  aliasCount: number
  /** 值得提醒但不致命的问题（精度丢失、NaN 等） */
  warnings: string[]
}

export type ConvertResult =
  ({ ok: true; output: string } & ConvertStats) | { ok: false; error: ConvertIssue }

/* ───────────────────────── 通用工具 ───────────────────────── */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 设置自有属性（`__proto__` 这类键也按普通键处理，不会改动原型） */
function defineOwn(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

/** 递归按键名排序（数组顺序保持不变）；返回新对象，不修改入参 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value).sort(compareKeys)) defineOwn(out, k, sortKeysDeep(value[k]))
    return out
  }
  return value
}

/** 嵌套过深导致调用栈溢出时的统一提示 */
const TOO_DEEP = '嵌套层级过深，超出了浏览器的处理能力'

const isStackOverflow = (e: unknown) =>
  e instanceof RangeError || (e instanceof Error && /call stack/i.test(e.message))

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

function issueAt(source: string, offset: number, message: string, width = 1): ConvertIssue {
  const { line, column } = offsetToPosition(source, offset)
  return { message, line, column, frame: buildFrame(source, line, column, { width }) }
}

/* ───────────────────────── JSON 解析与定位 ───────────────────────── */

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: ConvertIssue }

/** 严格 JSON 解析：先用原生 JSON.parse，失败时再精确定位错误并给出中文说明 */
export function parseJson(text: string): JsonParseResult {
  const src = stripBom(text)
  try {
    return { ok: true, value: JSON.parse(src) }
  } catch (e) {
    return { ok: false, error: locateJsonError(src, e) }
  }
}

class JsonScanError extends Error {
  constructor(
    public offset: number,
    message: string,
    public width = 1,
  ) {
    super(message)
  }
}

const describeChar = (ch: string) => {
  if (ch === '\n' || ch === '\r') return '换行'
  if (ch === '\t') return 'Tab'
  if (ch.trim() === '') return '空白字符'
  return `“${ch}”`
}

/**
 * 逐字符扫描 JSON（RFC 8259），找出第一个错误的位置与原因。
 * 只在 JSON.parse 失败后调用，因此不追求速度。
 */
export function locateJsonError(text: string, nativeError?: unknown): ConvertIssue {
  const s = text
  let i = 0
  let depth = 0

  const ws = () => {
    for (;;) {
      const c = s[i]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++
      else if (c === '/' && (s[i + 1] === '/' || s[i + 1] === '*'))
        throw new JsonScanError(i, '标准 JSON 不支持注释，请删除注释', 2)
      else if (c === '\uFEFF' || c === '\u00A0' || c === '\u3000')
        throw new JsonScanError(
          i,
          `包含不可见的特殊空白字符（U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}），请删除`,
        )
      else return
    }
  }

  const eof = (what: string) => new JsonScanError(s.length, `JSON 意外结束：${what}`)

  const literal = () => {
    const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i, i + 64))
    const word = m ? m[0] : s[i]
    if (word === 'true' || word === 'false' || word === 'null') {
      i += word.length
      return
    }
    const lower = word.toLowerCase()
    if (lower === 'true' || lower === 'false' || lower === 'null')
      throw new JsonScanError(
        i,
        `无法识别的字面量 ${word}，JSON 中应为小写的 ${lower}`,
        word.length,
      )
    if (word === 'undefined' || word === 'NaN' || word === 'Infinity')
      throw new JsonScanError(i, `JSON 不支持 ${word}，可改用 null 或字符串`, word.length)
    if (word === "'") throw new JsonScanError(i, 'JSON 字符串必须使用双引号，不能用单引号')
    if (m)
      throw new JsonScanError(
        i,
        `无法识别的内容 ${word}：JSON 的字符串必须用双引号括起来`,
        word.length,
      )
    throw new JsonScanError(i, `意外的字符 ${describeChar(word[0])}，此处应为一个值`, 1)
  }

  const string = () => {
    const start = i
    i++ // 开头的 "
    for (;;) {
      if (i >= s.length) throw new JsonScanError(start, '字符串没有闭合，缺少结尾的双引号')
      const c = s[i]
      if (c === '"') {
        i++
        return
      }
      if (c === '\\') {
        const n = s[i + 1]
        if (n === undefined) throw eof('字符串没有闭合')
        if (n === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6)))
            throw new JsonScanError(i, '无效的 Unicode 转义，\\u 后面应为 4 位十六进制数', 2)
          i += 6
          continue
        }
        if (!'"\\/bfnrt'.includes(n))
          throw new JsonScanError(i, `无效的转义序列 \\${n}（反斜杠本身需写成 \\\\）`, 2)
        i += 2
        continue
      }
      if (c.charCodeAt(0) < 0x20) {
        const what = c === '\n' || c === '\r' ? '换行' : c === '\t' ? 'Tab' : '控制字符'
        throw new JsonScanError(i, `字符串中不能直接包含${what}，请改用转义（如 \\n、\\t）`)
      }
      i++
    }
  }

  const number = () => {
    const rest = s.slice(i, i + 400)
    if (s[i] === '+') throw new JsonScanError(i, '数字前不能带 + 号')
    if (s[i] === '.') throw new JsonScanError(i, '小数必须以数字开头，如 0.5')
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(rest)
    if (!m) {
      if (/^-(Infinity|NaN)/.test(rest)) throw new JsonScanError(i, 'JSON 不支持 -Infinity / NaN')
      throw new JsonScanError(i, '数字格式不正确')
    }
    const after = rest[m[0].length]
    if (after !== undefined && /[\d.eExX]/.test(after)) {
      const bad = /^-?[\dA-Fa-fxX.]*([eE][+-]?\d*)?/.exec(rest)?.[0] ?? m[0]
      const msg = /^-?0[xX]/.test(bad)
        ? 'JSON 不支持十六进制数字'
        : /^-?0\d/.test(bad)
          ? '数字不能有前导零'
          : /\.(?!\d)/.test(bad)
            ? '小数点后必须有数字'
            : /[eE][+-]?$/.test(bad)
              ? '指数部分缺少数字'
              : '数字格式不正确'
      throw new JsonScanError(i, msg, Math.max(1, bad.length))
    }
    i += m[0].length
  }

  const value = (): void => {
    ws()
    if (i >= s.length) throw eof('此处应为一个值')
    const c = s[i]
    if (c === '{') return object()
    if (c === '[') return array()
    if (c === '"') return string()
    if (c === '-' || c === '+' || c === '.' || (c >= '0' && c <= '9')) return number()
    if (c === '}' || c === ']') throw new JsonScanError(i, `意外的 ${c}，此处应为一个值`)
    if (c === ',') throw new JsonScanError(i, '意外的逗号，此处应为一个值')
    return literal()
  }

  const enter = () => {
    if (++depth > 5000) throw new JsonScanError(i, '嵌套层级过深')
  }

  const object = () => {
    enter()
    i++ // {
    ws()
    if (s[i] === '}') {
      i++
      depth--
      return
    }
    for (;;) {
      ws()
      if (i >= s.length) throw eof('对象缺少结尾的 }')
      const c = s[i]
      if (c !== '"') {
        if (c === "'") throw new JsonScanError(i, 'JSON 的键必须用双引号括起来，不能用单引号')
        if (/[A-Za-z_$À-￿]/.test(c)) throw new JsonScanError(i, '对象的键必须用双引号括起来')
        throw new JsonScanError(i, `意外的字符 ${describeChar(c)}，此处应为用双引号括起来的键`)
      }
      string()
      ws()
      if (i >= s.length) throw eof('键后面缺少冒号')
      if (s[i] !== ':') throw new JsonScanError(i, `键后面缺少冒号，却遇到了 ${describeChar(s[i])}`)
      i++
      value()
      ws()
      if (i >= s.length) throw eof('对象缺少结尾的 }')
      if (s[i] === ',') {
        const comma = i
        i++
        ws()
        if (s[i] === '}') throw new JsonScanError(comma, '多余的尾随逗号：最后一项后面不能有逗号')
        continue
      }
      if (s[i] === '}') {
        i++
        depth--
        return
      }
      if (s[i] === '"' || /[\w{[]/.test(s[i]))
        throw new JsonScanError(i, '缺少逗号：对象的各项之间需要用逗号分隔')
      throw new JsonScanError(i, `意外的字符 ${describeChar(s[i])}，此处应为逗号或 }`)
    }
  }

  const array = () => {
    enter()
    i++ // [
    ws()
    if (s[i] === ']') {
      i++
      depth--
      return
    }
    for (;;) {
      value()
      ws()
      if (i >= s.length) throw eof('数组缺少结尾的 ]')
      if (s[i] === ',') {
        const comma = i
        i++
        ws()
        if (s[i] === ']') throw new JsonScanError(comma, '多余的尾随逗号：最后一项后面不能有逗号')
        continue
      }
      if (s[i] === ']') {
        i++
        depth--
        return
      }
      if (s[i] === '"' || /[\w{[-]/.test(s[i]))
        throw new JsonScanError(i, '缺少逗号：数组的各项之间需要用逗号分隔')
      throw new JsonScanError(i, `意外的字符 ${describeChar(s[i])}，此处应为逗号或 ]`)
    }
  }

  try {
    value()
    ws()
    if (i < s.length)
      throw new JsonScanError(i, 'JSON 已经结束，后面却还有多余内容（多个值需要放进数组）')
  } catch (e) {
    if (e instanceof JsonScanError) return issueAt(s, e.offset, e.message, e.width)
    // 递归过深等意外情况：退回原生错误信息
  }
  const native = nativeError instanceof Error ? nativeError.message : String(nativeError ?? '')
  return { message: `JSON 解析失败：${native || '未知错误'}` }
}

/* ───────────────────────── YAML 错误翻译 ───────────────────────── */

const YAML_REASONS: [RegExp, string | ((...m: string[]) => string)][] = [
  [/^bad indentation of a mapping entry/, '映射项缩进不正确'],
  [/^bad indentation of a sequence entry/, '列表项缩进不正确'],
  [/^duplicated mapping key/, '重复的键'],
  [/^unidentified alias "(.*)"/, (_, n) => `找不到锚点 &${n}（别名 *${n} 必须在锚点定义之后使用）`],
  [/^tab characters must not be used in indentation/, 'YAML 缩进不能使用 Tab，请改用空格'],
  [
    /^end of the stream or a document separator is expected/,
    '此处应为文档结束或 ---（可能是缩进或冒号有误）',
  ],
  [
    /^can not read a block mapping entry; a multiline key may not be an implicit key/,
    '无法读取映射项：键不能跨行（可能缺少冒号或冒号后缺少空格）',
  ],
  [/^a whitespace character is expected after the key-value separator/, '冒号后面需要一个空格'],
  [/^expected ':' after a mapping key/, '键后面缺少冒号'],
  [/^missed comma between flow collection entries/, '行内集合的各项之间缺少逗号'],
  [/^unexpected end of the stream within a flow collection/, '行内集合 [ ] 或 { } 没有闭合'],
  [
    /^unexpected end of the (stream|document) within a double quoted scalar/,
    '双引号字符串没有闭合',
  ],
  [
    /^unexpected end of the (stream|document) within a single quoted scalar/,
    '单引号字符串没有闭合',
  ],
  [/^unknown escape sequence/, '未知的转义序列'],
  [/^expected hexadecimal character/, '转义序列中应为十六进制字符'],
  [/^deficient indentation/, '缩进不足'],
  [/^the stream contains non-printable characters/, '包含不可打印的字符'],
  [/^null byte is not allowed in input/, '输入中不能包含空字节'],
  [
    /^object-based map does not support complex keys/,
    '不支持复合键（键本身是列表或映射），JSON 无法表示',
  ],
  [
    /^unknown (scalar|sequence|mapping) tag !<(.*)>/,
    (_, _k, t) => `未知的标签 ${displayTag(t)}（可打开「忽略自定义标签」）`,
  ],
  [
    /^cannot resolve a node with !<(.*)> explicit tag/,
    (_, t) => `值与显式标签 ${displayTag(t)} 不匹配`,
  ],
  [/^nesting exceeded maxDepth/, '嵌套层级过深'],
  [
    /^cannot merge mappings; the provided source object is unacceptable/,
    '合并键 << 只能引用映射（或映射列表）',
  ],
  [/^merge keys exceeded maxTotalMergeKeys/, '合并键 << 展开的数量过多'],
  [/^duplication of an anchor property/, '同一个节点定义了多个锚点'],
  [/^duplication of a tag property/, '同一个节点定义了多个标签'],
  [/^alias node should not have any properties/, '别名节点不能带锚点或标签'],
  [
    /^name of an (alias|anchor) node must contain at least one character/,
    '锚点 / 别名名称不能为空',
  ],
  [/^expected the node content, but found ','/, '此处应为值，却遇到了逗号'],
]

export function translateYamlReason(reason: string): string {
  for (const [re, zh] of YAML_REASONS) {
    const m = re.exec(reason)
    if (m) return typeof zh === 'string' ? zh : zh(...m)
  }
  return reason
}

/**
 * 找出 end 之前最后一个没有闭合的行内集合开括号（[ 或 {）的位置；
 * 跳过引号字符串与 # 注释。用于把 js-yaml 含糊的「缩进不足」解释成「括号没闭合」。
 */
export function findUnclosedFlow(source: string, end: number): number | null {
  const stack: number[] = []
  let quote: string | null = null
  for (let i = 0; i < Math.min(end, source.length); i++) {
    const c = source[i]
    if (quote) {
      if (quote === '"' && c === '\\') i++
      else if (c === quote) {
        if (quote === "'" && source[i + 1] === "'") i++
        else quote = null
      } else if (c === '\n' && stack.length === 0) quote = null // 块上下文中的普通撇号
      continue
    }
    if (c === '#' && (i === 0 || /\s/.test(source[i - 1]))) {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (
      (c === '"' || c === "'") &&
      (stack.length > 0 || /(^|[\s:,[{-])$/.test(source.slice(Math.max(0, i - 1), i)))
    ) {
      quote = c
      continue
    }
    if (c === '[' || c === '{') stack.push(i)
    else if ((c === ']' || c === '}') && stack.length) stack.pop()
  }
  return stack.length ? stack[stack.length - 1] : null
}

/** 这些报错常常是前面某个引号字符串没有闭合、把后面的内容都吞了进去 */
const QUOTE_SYMPTOMS =
  /^(deficient indentation|bad indentation of a (mapping|sequence) entry|end of the stream or a document separator is expected|unexpected end of the (stream|document) within a (single|double) quoted scalar)/

/** 引号前面的内容说明它位于一个值的开头（而不是普通标量中间的撇号） */
const SCALAR_START = /^\s*$|^\s*(-\s+)+$|^\s*\?\s+$|:\s+$|[[{,]\s*$|(^|\s)[!&]\S*\s+$/

/** 块标量头：`key: |`、`- >-`、`|2` 等（后面的更深缩进行都是原文） */
const BLOCK_HEADER = /(^\s*|:\s+|-\s+)[|>][1-9+-]{0,2}\s*(#.*)?$/

/**
 * 找出 end 之前仍未闭合的引号字符串的起点（YAML 的引号字符串可以跨行）。
 * 跳过注释与块标量（| / >）的内容；只把位于值开头的引号当作字符串起点。
 */
export function findUnclosedQuote(source: string, end: number): number | null {
  const limit = Math.min(end, source.length)
  let open: number | null = null
  let quote = ''
  let blockIndent = -1
  let i = 0
  while (i < limit) {
    let lineEnd = source.indexOf('\n', i)
    if (lineEnd === -1) lineEnd = source.length
    const line = source.slice(i, lineEnd).replace(/\r$/, '')
    if (open === null && blockIndent >= 0) {
      const indent = /^ */.exec(line)![0].length
      if (line.trim() === '' || indent > blockIndent) {
        i = lineEnd + 1
        continue
      }
      blockIndent = -1
    }
    for (let j = 0; j < line.length && i + j < limit; j++) {
      const c = line[j]
      if (open !== null) {
        if (quote === '"' && c === '\\') j++
        else if (c === quote) {
          if (quote === "'" && line[j + 1] === "'") j++
          else open = null
        }
        continue
      }
      if (c === '#' && (j === 0 || /\s/.test(line[j - 1]))) break
      if ((c === '"' || c === "'") && SCALAR_START.test(line.slice(0, j))) {
        open = i + j
        quote = c
      }
    }
    if (open === null && BLOCK_HEADER.test(line)) blockIndent = /^ */.exec(line)![0].length
    i = lineEnd + 1
  }
  return open
}

function yamlIssue(source: string, e: unknown): ConvertIssue {
  if (e instanceof YAMLException) {
    const reason = e.reason || e.message
    const message = translateYamlReason(reason)
    const pos = e.mark && e.mark.position >= 0 && e.mark.buffer === source ? e.mark.position : -1
    if (pos >= 0) {
      if (QUOTE_SYMPTOMS.test(reason)) {
        const q = findUnclosedQuote(source, pos)
        if (q !== null) {
          const kind = source[q] === '"' ? '双引号' : '单引号'
          return issueAt(
            source,
            q,
            `${kind}字符串没有闭合：从这里开始的 ${source[q]} 缺少结尾的 ${source[q]}`,
          )
        }
      }
      if (/^deficient indentation/.test(reason)) {
        const open = findUnclosedFlow(source, pos)
        if (open !== null) {
          const close = source[open] === '[' ? ']' : '}'
          return issueAt(
            source,
            open,
            `行内集合没有闭合：这里的 ${source[open]} 缺少对应的 ${close}`,
          )
        }
      }
      const lineStart = source.lastIndexOf('\n', pos - 1) + 1
      const before = source.slice(lineStart, pos)
      const tab = /^[ \t]*/.exec(source.slice(lineStart))![0].indexOf('\t')
      if (tab !== -1) {
        return issueAt(source, lineStart + tab, 'YAML 缩进不能使用 Tab，请改用空格')
      }
      const ch = source[pos]
      if ((ch === ']' || ch === '}') && findUnclosedFlow(source, pos) === null) {
        return issueAt(source, pos, `多余的 ${ch}：前面没有与之对应的 ${ch === ']' ? '[' : '{'}`)
      }
      if (ch === ':' && /^bad indentation of a mapping entry/.test(reason) && /:\s/.test(before)) {
        return issueAt(
          source,
          pos,
          '同一行里不能嵌套映射：值中含有「: 」时请给整个值加引号，或换行并缩进',
        )
      }
      return issueAt(source, pos, message)
    }
    if (e.mark) {
      const line = e.mark.line + 1
      const column = e.mark.column + 1
      return { message, line, column, frame: buildFrame(source, line, column) }
    }
    return { message }
  }
  if (isStackOverflow(e)) return { message: TOO_DEEP }
  return { message: e instanceof Error ? e.message : String(e) }
}

/* ───────────────────────── 展开检查（别名炸弹 / 循环引用） ───────────────────────── */

/** 别名全部展开后允许的最大节点数，防止「十亿笑声」式 YAML 炸弹卡死页面 */
export const MAX_EXPANDED_NODES = 2_000_000

interface InspectResult {
  unsafeInts: number[]
  nonFinite: number
}

class ExpandError extends Error {}

/** 遍历展开后的值：统计精度丢失与 NaN，并检测循环引用和过度展开 */
function inspectValue(root: unknown): InspectResult {
  const res: InspectResult = { unsafeInts: [], nonFinite: 0 }
  const ancestors = new Set<object>()
  let count = 0
  const walk = (v: unknown) => {
    if (++count > MAX_EXPANDED_NODES)
      throw new ExpandError(
        `别名展开后的节点数超过 ${MAX_EXPANDED_NODES.toLocaleString()}，疑似 YAML 炸弹，已停止转换`,
      )
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) res.nonFinite++
      else if (Number.isInteger(v) && !Number.isSafeInteger(v) && res.unsafeInts.length < 3)
        res.unsafeInts.push(v)
      return
    }
    if (typeof v !== 'object' || v === null) return
    if (ancestors.has(v))
      throw new ExpandError('检测到循环引用（别名指向了自身所在的节点），JSON 无法表示')
    ancestors.add(v)
    if (Array.isArray(v)) for (const x of v) walk(x)
    else for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k])
    ancestors.delete(v)
  }
  walk(root)
  return res
}

function numberWarnings(r: InspectResult): string[] {
  const w: string[] = []
  if (r.unsafeInts.length)
    w.push(
      `有整数超出 JavaScript 安全范围（±2^53），已丢失精度：${r.unsafeInts
        .map((n) => n.toLocaleString('en-US', { useGrouping: false }))
        .join('、')}。如需保留原值请改用字符串。`,
    )
  if (r.nonFinite) w.push(`有 ${r.nonFinite} 个 .nan / .inf 值，JSON 无法表示，已输出为 null。`)
  return w
}

/* ───────────────────────── Schema ───────────────────────── */

const ANY_TAG = ''

/** 标签名的简写形式：tag:yaml.org,2002:binary → !!binary */
export function displayTag(tagName: string): string {
  return tagName.startsWith('tag:yaml.org,2002:') ? `!!${tagName.slice(18)}` : tagName
}

function buildSchema(customTags: boolean, seen: Set<string>): Schema {
  const base = CORE_SCHEMA.withTags(mergeTag)
  if (!customTags) return base
  // Core Schema 之外的所有标签：本地标签（!Ref、!Sub、!GetAtt …）、YAML 1.1 的 !!binary / !!timestamp / !!set、
  // 以及 !<tag:…> 这类完整标签，一律忽略标签、按普通值处理。
  // 前缀为空串即匹配任意标签名；js-yaml 先查精确匹配，所以 !!str / !!int 等核心标签不受影响。
  const scalar = defineScalarTag<string>(ANY_TAG, {
    matchByTagPrefix: true,
    resolve: (source, _explicit, tagName) => {
      seen.add(tagName)
      return source
    },
    identify: () => false,
  })
  const seq = defineSequenceTag<unknown[]>(ANY_TAG, {
    matchByTagPrefix: true,
    create: (tagName) => {
      seen.add(tagName)
      return []
    },
    addItem: (c, item) => {
      c.push(item)
    },
    identify: () => false,
  })
  const map = defineMappingTag<Record<string, unknown>>(ANY_TAG, {
    matchByTagPrefix: true,
    create: (tagName) => {
      seen.add(tagName)
      return {}
    },
    addPair: (c, key, value) => {
      if (typeof key === 'object' && key !== null)
        return 'object-based map does not support complex keys'
      defineOwn(c, String(key), value)
      return ''
    },
    has: (c, key) => Object.prototype.hasOwnProperty.call(c, String(key)),
    keys: (c) => Object.keys(c),
    get: (c, key) => c[String(key)],
    identify: () => false,
  })
  return base.withTags(scalar, seq, map)
}

/* ───────────────────────── 转换 ───────────────────────── */

export function jsonToYaml(text: string, opts: JsonYamlOptions = DEFAULT_OPTIONS): ConvertResult {
  if (!text.trim()) return { ok: true, output: '', docCount: 0, aliasCount: 0, warnings: [] }
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed
  let value = parsed.value
  let warnings: string[]
  try {
    if (opts.sortKeys) value = sortKeysDeep(value)
    warnings = numberWarnings(inspectValue(value))
  } catch (e) {
    // JSON.parse 能解析很深的嵌套，但递归遍历会爆栈；不能让异常抛到界面上
    return { ok: false, error: { message: isStackOverflow(e) ? TOO_DEEP : String(e) } }
  }

  const dumpOpts = {
    indent: opts.indent,
    lineWidth: opts.lineWidth,
    quoteStyle: opts.quoteStyle,
    forceQuotes: opts.forceQuotes,
    noRefs: true,
  }
  try {
    if (opts.multiDoc && Array.isArray(value)) {
      if (value.length === 0) {
        warnings.push('顶层是空数组，没有可拆分的文档。')
        return { ok: true, output: dump(value, dumpOpts), docCount: 1, aliasCount: 0, warnings }
      }
      const docs = value.map((v) => dump(v, dumpOpts))
      return {
        ok: true,
        output: docs.map((d) => `---\n${d}`).join(''),
        docCount: docs.length,
        aliasCount: 0,
        warnings,
      }
    }
    return { ok: true, output: dump(value, dumpOpts), docCount: 1, aliasCount: 0, warnings }
  } catch (e) {
    if (isStackOverflow(e)) return { ok: false, error: { message: TOO_DEEP } }
    return {
      ok: false,
      error: { message: `生成 YAML 失败：${e instanceof Error ? e.message : String(e)}` },
    }
  }
}

export function yamlToJson(text: string, opts: JsonYamlOptions = DEFAULT_OPTIONS): ConvertResult {
  const src = stripBom(text)
  if (!src.trim()) return { ok: true, output: '', docCount: 0, aliasCount: 0, warnings: [] }

  const tags = new Set<string>()
  let docs: unknown[]
  let aliasCount = 0
  try {
    const events = parseEvents(src, { maxDepth: 500 })
    for (const ev of events) if (ev.type === EVENT_ALIAS) aliasCount++
    docs = constructFromEvents(events, {
      source: src,
      schema: buildSchema(opts.customTags, tags),
      maxAliases: -1,
    })
  } catch (e) {
    return { ok: false, error: yamlIssue(src, e) }
  }

  if (docs.length === 0) return { ok: true, output: '', docCount: 0, aliasCount, warnings: [] }
  let value: unknown = docs.length === 1 ? docs[0] : docs

  let inspected: InspectResult
  try {
    inspected = inspectValue(value)
  } catch (e) {
    if (e instanceof ExpandError) return { ok: false, error: { message: e.message } }
    return { ok: false, error: { message: TOO_DEEP } }
  }
  const warnings = numberWarnings(inspected)
  if (tags.size) {
    const list = [...tags].slice(0, 6).map(displayTag).join('、')
    warnings.push(`已忽略自定义标签 ${list}${tags.size > 6 ? ' 等' : ''}，只保留了它们的值。`)
  }

  try {
    if (opts.sortKeys) value = sortKeysDeep(value)
    const output = JSON.stringify(value, null, opts.indent)
    return { ok: true, output: output ?? 'null', docCount: docs.length, aliasCount, warnings }
  } catch (e) {
    if (isStackOverflow(e)) return { ok: false, error: { message: TOO_DEEP } }
    return {
      ok: false,
      error: { message: `生成 JSON 失败：${e instanceof Error ? e.message : String(e)}` },
    }
  }
}

export function convertJsonYaml(
  direction: Direction,
  text: string,
  opts: JsonYamlOptions = DEFAULT_OPTIONS,
): ConvertResult {
  return direction === 'json2yaml' ? jsonToYaml(text, opts) : yamlToJson(text, opts)
}
