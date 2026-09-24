/** 正则表达式测试：编译、匹配、替换（纯函数，可在 Worker / Node 中运行） */

export type RegexFlag = 'd' | 'g' | 'i' | 'm' | 's' | 'u' | 'v' | 'y'

export interface FlagInfo {
  flag: RegexFlag
  name: string
  desc: string
}

/** 界面上展示的标志（按常用程度排序） */
export const FLAGS: FlagInfo[] = [
  { flag: 'g', name: '全局', desc: '全局匹配：找出所有匹配，而不是找到第一个就停止' },
  { flag: 'i', name: '忽略大小写', desc: '忽略大小写：A 与 a 视为相同' },
  { flag: 'm', name: '多行', desc: '多行模式：^ 和 $ 匹配每一行的开头和结尾' },
  { flag: 's', name: '单行', desc: 'dotAll：让 . 也能匹配换行符' },
  { flag: 'u', name: 'Unicode', desc: 'Unicode 模式：按码点处理，支持 \\u{…} 与 \\p{…}' },
  { flag: 'y', name: '粘连', desc: '粘连（sticky）：只从 lastIndex 位置开始匹配，不向后搜索' },
  { flag: 'd', name: '索引', desc: '生成捕获组的起止索引（match.indices）' },
]

/** JS 规范中 flags 的书写顺序 */
const CANONICAL = 'dgimsuvy'

/** 去重、去掉非法字符并按规范顺序排列 */
export function normalizeFlags(flags: string): string {
  return CANONICAL.split('')
    .filter((f) => flags.includes(f))
    .join('')
}

export function toggleFlag(flags: string, flag: RegexFlag): string {
  let next = flags.includes(flag) ? flags.replace(flag, '') : flags + flag
  // u 与 v 互斥
  if (!flags.includes(flag) && flag === 'u') next = next.replace('v', '')
  if (!flags.includes(flag) && flag === 'v') next = next.replace('u', '')
  return normalizeFlags(next)
}

const ERROR_MAP: [RegExp, string][] = [
  [/Unterminated group/i, '分组没有闭合：缺少 )'],
  [/Unmatched '\)'/i, '多余的 )：找不到与之配对的 ('],
  [/Nothing to repeat/i, '量词前面没有可重复的内容（如开头的 *、+、? 或连续的量词）'],
  [/Unterminated character class/i, '字符集没有闭合：缺少 ]'],
  [/Range out of order in character class/i, '字符集中的范围顺序颠倒（如 [z-a]）'],
  [/numbers out of order in \{\} quantifier/i, '量词 {m,n} 中 m 不能大于 n'],
  [/Incomplete quantifier/i, '量词不完整（如 {2,）'],
  [/Lone quantifier brackets/i, 'Unicode 模式下 { } 需要转义为 \\{ \\}'],
  [/Invalid group/i, '无效的分组语法（(? 后面只能是 :、=、!、<=、<! 或 <名称>）'],
  [/Invalid capture group name/i, '捕获组名称无效：只能包含字母、数字、_ 与 $，且不能以数字开头'],
  [/Duplicate capture group name/i, '捕获组名称重复'],
  [/Invalid named capture referenced/i, '引用了不存在的命名捕获组（\\k<名称>）'],
  [/Invalid named reference/i, '命名反向引用 \\k<名称> 写法无效'],
  [/Invalid Unicode escape/i, 'Unicode 转义无效（应为 \\uXXXX 或 \\u{X…}）'],
  [/Invalid unicode escape/i, 'Unicode 转义无效（应为 \\uXXXX 或 \\u{X…}）'],
  [/Invalid escape/i, '无效的转义序列（Unicode 模式下不允许多余的转义）'],
  [/Invalid property name/i, '\\p{…} 中的 Unicode 属性名无效'],
  [/Invalid class escape/i, '字符集中的转义无效'],
  [/\\ at end of pattern/i, '表达式以单独的 \\ 结尾'],
  [/Invalid flags/i, '无效的标志'],
  [/Invalid regular expression flags/i, '无效的标志'],
  [/Invalid decimal escape/i, 'Unicode 模式下不允许 \\0 后接数字或八进制转义'],
  [/Invalid class set operation/i, 'v 模式下字符集运算写法无效'],
  [/Invalid character in character class/i, 'v 模式下字符集中含有需要转义的字符'],
  [/Regular expression too large/i, '正则表达式过大'],
]

/** 把 V8 / SpiderMonkey / JavaScriptCore 的英文错误信息翻译成中文 */
export function translateRegexError(message: string): string {
  const raw = message
    .replace(/^SyntaxError:\s*/, '')
    .replace(/^Invalid regular expression:\s*\/.*\/[a-z]*:\s*/s, '')
    .replace(/^Invalid regular expression:\s*/, '')
  for (const [re, zh] of ERROR_MAP) if (re.test(raw)) return `${zh}（${raw}）`
  return raw || '正则表达式无效'
}

export type CompileResult = { ok: true; re: RegExp } | { ok: false; error: string }

export function compileRegex(pattern: string, flags: string): CompileResult {
  const bad = flags.replace(/[dgimsuvy]/g, '')
  if (bad) return { ok: false, error: `不支持的标志：${[...new Set(bad)].join('')}` }
  if (new Set(flags).size !== flags.length) return { ok: false, error: '标志重复' }
  if (flags.includes('u') && flags.includes('v')) {
    return { ok: false, error: 'u 与 v 标志不能同时使用' }
  }
  try {
    return { ok: true, re: new RegExp(pattern, flags) }
  } catch (e) {
    return { ok: false, error: translateRegexError(e instanceof Error ? e.message : String(e)) }
  }
}

// ───────────── 捕获组扫描 ─────────────

export interface CaptureGroupInfo {
  /** 从 1 开始的组号 */
  index: number
  name: string | null
}

/**
 * 扫描正则源码，按出现顺序列出捕获组（跳过转义、字符集、非捕获组与断言）。
 * 只有 v 模式允许字符集嵌套；其它模式下字符集里的 [ 是普通字符（如 [^[\]]）。
 */
export function captureGroups(pattern: string, flags = ''): CaptureGroupInfo[] {
  const out: CaptureGroupInfo[] = []
  const nested = flags.includes('v')
  let inClass = 0
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (inClass) {
      if (ch === '[' && nested) inClass++
      else if (ch === ']') inClass--
      continue
    }
    if (ch === '[') {
      inClass = 1
      continue
    }
    if (ch !== '(') continue
    if (pattern[i + 1] !== '?') {
      out.push({ index: out.length + 1, name: null })
      continue
    }
    if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') {
      const end = pattern.indexOf('>', i + 3)
      out.push({ index: out.length + 1, name: end > 0 ? pattern.slice(i + 3, end) : null })
    }
  }
  return out
}

// ───────────── 匹配 ─────────────

export interface RegexGroup {
  index: number
  name: string | null
  /** 未参与匹配时为 undefined */
  value: string | undefined
  start: number | null
  end: number | null
}

export interface RegexMatch {
  /** 第几个匹配（从 0 开始） */
  n: number
  start: number
  end: number
  text: string
  groups: RegexGroup[]
}

export interface MatchResult {
  matches: RegexMatch[]
  /** 超过上限后停止收集 */
  truncated: boolean
}

export const MATCH_LIMIT = 5000

/** 把 UTF-16 下标推进一个「字符」：u / v 模式下跳过完整的代理对 */
function advance(text: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= text.length) return index + 1
  const c = text.charCodeAt(index)
  if (c >= 0xd800 && c <= 0xdbff) {
    const d = text.charCodeAt(index + 1)
    if (d >= 0xdc00 && d <= 0xdfff) return index + 2
  }
  return index + 1
}

/** 带 d 标志的副本，用来拿到捕获组的位置 */
function withIndices(re: RegExp): RegExp {
  return re.flags.includes('d')
    ? new RegExp(re.source, re.flags)
    : new RegExp(re.source, re.flags + 'd')
}

type ExecWithIndices = RegExpExecArray & { indices?: Array<[number, number] | undefined> }

function toMatch(m: ExecWithIndices, n: number, names: CaptureGroupInfo[]): RegexMatch {
  const groups: RegexGroup[] = []
  for (let g = 1; g < m.length; g++) {
    const span = m.indices?.[g]
    groups.push({
      index: g,
      name: names[g - 1]?.name ?? null,
      value: m[g],
      start: span ? span[0] : null,
      end: span ? span[1] : null,
    })
  }
  return { n, start: m.index, end: m.index + m[0].length, text: m[0], groups }
}

/**
 * 按 JS 语义找出匹配：没有 g 时只取第一个（有 y 时必须从 0 开始），
 * 有 g 时循环 exec，空匹配自动前进一个字符。
 */
export function findMatches(re: RegExp, text: string, limit = MATCH_LIMIT): MatchResult {
  const r = withIndices(re)
  const names = captureGroups(re.source, re.flags)
  const unicode = r.unicode || r.flags.includes('v')
  const matches: RegexMatch[] = []
  r.lastIndex = 0
  if (!r.global) {
    const m = r.exec(text) as ExecWithIndices | null
    if (m) matches.push(toMatch(m, 0, names))
    return { matches, truncated: false }
  }
  for (;;) {
    const m = r.exec(text) as ExecWithIndices | null
    if (!m) break
    if (matches.length >= limit) return { matches, truncated: true }
    matches.push(toMatch(m, matches.length, names))
    if (m[0] === '') r.lastIndex = advance(text, r.lastIndex, unicode)
  }
  return { matches, truncated: false }
}

// ───────────── 替换 ─────────────

/**
 * 替换模板展开（ECMAScript GetSubstitution）：
 * $$ → $，$& 整个匹配，$` 匹配前的文本，$' 匹配后的文本，$1~$99 编号组，$<name> 命名组
 */
export function expandReplacement(
  template: string,
  matched: string,
  position: number,
  str: string,
  captures: readonly (string | undefined)[],
  named: Record<string, string | undefined> | undefined,
): string {
  if (!template.includes('$')) return template
  let out = ''
  const m = captures.length
  for (let i = 0; i < template.length;) {
    const ch = template[i]
    if (ch !== '$' || i + 1 >= template.length) {
      out += ch
      i++
      continue
    }
    const next = template[i + 1]
    if (next === '$') {
      out += '$'
      i += 2
    } else if (next === '&') {
      out += matched
      i += 2
    } else if (next === '`') {
      out += str.slice(0, position)
      i += 2
    } else if (next === "'") {
      out += str.slice(Math.min(position + matched.length, str.length))
      i += 2
    } else if (next >= '0' && next <= '9') {
      const two = template[i + 2] >= '0' && template[i + 2] <= '9'
      let digits = two ? template.slice(i + 1, i + 3) : next
      let index = Number(digits)
      if (two && index > m) {
        digits = next
        index = Number(digits)
      }
      if (index >= 1 && index <= m) out += captures[index - 1] ?? ''
      else out += '$' + digits
      i += 1 + digits.length
    } else if (next === '<') {
      const close = template.indexOf('>', i + 2)
      if (named === undefined || close < 0) {
        out += '$<'
        i += 2
      } else {
        out += named[template.slice(i + 2, close)] ?? ''
        i = close + 1
      }
    } else {
      out += '$'
      i++
    }
  }
  return out
}

export interface ReplaceResult {
  output: string
  /** 替换后文本中被替换部分的区间，用于高亮（最多 limit 个） */
  spans: { start: number; end: number }[]
  count: number
}

/** 与 String.prototype.replace 结果一致，同时记录替换片段的位置 */
export function replaceWithSpans(
  re: RegExp,
  text: string,
  template: string,
  limit = MATCH_LIMIT,
): ReplaceResult {
  const r = new RegExp(re.source, re.flags.replace('d', ''))
  const unicode = r.unicode || r.flags.includes('v')
  const spans: { start: number; end: number }[] = []
  let out = ''
  let last = 0
  let count = 0
  const apply = (m: RegExpExecArray) => {
    const captures = m.slice(1)
    const rep = expandReplacement(template, m[0], m.index, text, captures, m.groups)
    out += text.slice(last, m.index)
    if (spans.length < limit) spans.push({ start: out.length, end: out.length + rep.length })
    out += rep
    last = m.index + m[0].length
    count++
  }
  r.lastIndex = 0
  if (!r.global) {
    const m = r.exec(text)
    if (m) apply(m)
  } else {
    for (;;) {
      const m = r.exec(text)
      if (!m) break
      apply(m)
      if (m[0] === '') r.lastIndex = advance(text, r.lastIndex, unicode)
    }
  }
  out += text.slice(last)
  return { output: out, spans, count }
}

// ───────────── Worker 协议 ─────────────

export interface RegexRequest {
  id: number
  pattern: string
  flags: string
  text: string
  /** 提供时同时计算替换结果 */
  replacement?: string
  limit?: number
}

export type RegexResponse =
  | {
      id: number
      ok: true
      matches: RegexMatch[]
      truncated: boolean
      replace: ReplaceResult | null
      elapsed: number
    }
  | { id: number; ok: false; error: string }

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function runRegex(req: RegexRequest): RegexResponse {
  const compiled = compileRegex(req.pattern, req.flags)
  if (!compiled.ok) return { id: req.id, ok: false, error: compiled.error }
  const t0 = now()
  try {
    const { matches, truncated } = findMatches(compiled.re, req.text, req.limit ?? MATCH_LIMIT)
    const replace =
      req.replacement !== undefined
        ? replaceWithSpans(compiled.re, req.text, req.replacement, req.limit ?? MATCH_LIMIT)
        : null
    return { id: req.id, ok: true, matches, truncated, replace, elapsed: now() - t0 }
  } catch (e) {
    return {
      id: req.id,
      ok: false,
      error: `匹配时出错：${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
