/** 把正则表达式拆成记号，并逐个给出中文解释（简化版，覆盖日常用法） */
import { captureGroups } from './regex-tester'

export type ExplainKind =
  | 'literal'
  | 'escape'
  | 'class'
  | 'quantifier'
  | 'group'
  | 'groupEnd'
  | 'anchor'
  | 'alternation'
  | 'backref'
  | 'dot'
  | 'error'

export interface ExplainNode {
  /** 源码中的原始片段 */
  token: string
  desc: string
  /** 分组嵌套深度，用于缩进 */
  depth: number
  kind: ExplainKind
  /** 在源码中的起始下标 */
  pos: number
}

const SIMPLE_ESCAPES: Record<string, string> = {
  d: '数字（0-9）',
  D: '非数字字符',
  w: '单词字符（字母、数字或下划线）',
  W: '非单词字符',
  s: '空白字符（空格、制表符、换行等）',
  S: '非空白字符',
  n: '换行符 \\n',
  r: '回车符 \\r',
  t: '制表符 \\t',
  v: '垂直制表符',
  f: '换页符',
}

const PROPERTY_NAMES: Record<string, string> = {
  L: '字母',
  Letter: '字母',
  Lu: '大写字母',
  Ll: '小写字母',
  N: '数字字符',
  Nd: '十进制数字',
  P: '标点符号',
  S: '符号',
  Z: '分隔符',
  Emoji: 'Emoji',
  Emoji_Presentation: 'Emoji',
  Extended_Pictographic: '图形符号（含 Emoji）',
  White_Space: '空白字符',
  Alphabetic: '字母类字符',
  'Script=Han': '汉字',
  'sc=Han': '汉字',
  'Script=Hiragana': '平假名',
  'Script=Katakana': '片假名',
  'Script=Latin': '拉丁字母',
  'Script=Greek': '希腊字母',
  'Script=Cyrillic': '西里尔字母',
  'Script=Hangul': '韩文字母',
}

function describeProperty(body: string, negated: boolean): string {
  const name =
    PROPERTY_NAMES[body] ??
    PROPERTY_NAMES[body.replace(/^Script_Extensions=|^scx=/, 'Script=')] ??
    body
  return negated ? `不属于「${name}」的字符（Unicode 属性）` : `「${name}」字符（Unicode 属性）`
}

function show(ch: string): string {
  if (ch === ' ') return '空格'
  if (ch === '\n') return '换行符'
  if (ch === '\t') return '制表符'
  return `“${ch}”`
}

interface EscapeInfo {
  len: number
  desc: string
  kind: ExplainKind
  /** 作为字面字符时的字符（用于合并文本） */
  literal?: string
}

/** 解析 pattern[i] === '\\' 开始的转义 */
function readEscape(
  p: string,
  i: number,
  inClass: boolean,
  groupCount: number,
  unicode: boolean,
): EscapeInfo {
  const c = p[i + 1]
  if (c === undefined) return { len: 1, desc: '表达式以单独的 \\ 结尾（无效）', kind: 'error' }
  if (SIMPLE_ESCAPES[c]) return { len: 2, desc: SIMPLE_ESCAPES[c], kind: 'escape' }
  if (c === 'b') {
    return inClass
      ? { len: 2, desc: '退格符', kind: 'escape' }
      : { len: 2, desc: '单词边界（单词字符与非单词字符之间的位置）', kind: 'anchor' }
  }
  if (c === 'B') return { len: 2, desc: '非单词边界', kind: 'anchor' }
  if (c === '0' && !/[0-9]/.test(p[i + 2] ?? ''))
    return { len: 2, desc: '空字符 NUL', kind: 'escape' }
  if (c === 'c' && /[A-Za-z]/.test(p[i + 2] ?? '')) {
    return { len: 3, desc: `控制字符 Ctrl+${p[i + 2].toUpperCase()}`, kind: 'escape' }
  }
  if (c === 'x' && /^[0-9A-Fa-f]{2}$/.test(p.slice(i + 2, i + 4))) {
    const ch = String.fromCharCode(parseInt(p.slice(i + 2, i + 4), 16))
    return { len: 4, desc: `字符 ${show(ch)}（十六进制转义）`, kind: 'escape', literal: ch }
  }
  if (c === 'u') {
    if (p[i + 2] === '{') {
      const end = p.indexOf('}', i + 3)
      const hex = end > 0 ? p.slice(i + 3, end) : ''
      if (/^[0-9A-Fa-f]{1,6}$/.test(hex) && parseInt(hex, 16) <= 0x10ffff) {
        const ch = String.fromCodePoint(parseInt(hex, 16))
        return {
          len: end - i + 1,
          desc: `字符 ${show(ch)}（Unicode 码点 U+${hex.toUpperCase()}${unicode ? '' : '，需要 u 标志'}）`,
          kind: 'escape',
          literal: ch,
        }
      }
    }
    if (/^[0-9A-Fa-f]{4}$/.test(p.slice(i + 2, i + 6))) {
      const code = parseInt(p.slice(i + 2, i + 6), 16)
      const ch = String.fromCharCode(code)
      return {
        len: 6,
        desc: `字符 ${show(ch)}（Unicode 转义 U+${p.slice(i + 2, i + 6).toUpperCase()}）`,
        kind: 'escape',
        literal: ch,
      }
    }
  }
  if ((c === 'p' || c === 'P') && p[i + 2] === '{') {
    const end = p.indexOf('}', i + 3)
    if (end > 0) {
      return {
        len: end - i + 1,
        desc: describeProperty(p.slice(i + 3, end), c === 'P') + (unicode ? '' : '（需要 u 标志）'),
        kind: 'escape',
      }
    }
  }
  if (!inClass && c === 'k' && p[i + 2] === '<') {
    const end = p.indexOf('>', i + 3)
    if (end > 0) {
      return {
        len: end - i + 1,
        desc: `反向引用：与命名分组「${p.slice(i + 3, end)}」匹配到的内容相同`,
        kind: 'backref',
      }
    }
  }
  if (!inClass && /[1-9]/.test(c)) {
    const two = p.slice(i + 1, i + 3)
    const n = /^\d\d$/.test(two) && Number(two) <= groupCount ? Number(two) : Number(c)
    if (n <= groupCount) {
      return {
        len: String(n).length + 1,
        desc: `反向引用：与第 ${n} 个分组匹配到的内容相同`,
        kind: 'backref',
      }
    }
  }
  const cp = p.codePointAt(i + 1)!
  const ch = String.fromCodePoint(cp)
  return {
    len: 1 + ch.length,
    desc: `字符 ${show(ch)}（转义后按字面匹配）`,
    kind: 'escape',
    literal: ch,
  }
}

/** 解析 [...] 字符集，返回结束下标（不含）与描述 */
function readClass(
  p: string,
  i: number,
  unicode: boolean,
  vMode: boolean,
): { end: number; desc: string; ok: boolean } {
  let j = i + 1
  const negated = p[j] === '^'
  if (negated) j++
  const items: string[] = []
  let depth = 1
  const start = j
  while (j < p.length) {
    const ch = p[j]
    if (ch === ']' && depth === 1) break
    // 只有 v 模式允许嵌套字符集；其它模式下 [ 在字符集里只是普通字符
    if (ch === '[' && vMode) depth++
    if (ch === ']') depth--
    let atom: string
    let atomLen: number
    if (ch === '\\') {
      const e = readEscape(p, j, true, 0, unicode)
      atom = e.literal !== undefined ? show(e.literal) : e.desc.replace(/（.*）$/, '')
      atomLen = e.len
    } else {
      const c = String.fromCodePoint(p.codePointAt(j)!)
      atom = show(c)
      atomLen = c.length
    }
    // 范围 a-z
    if (p[j + atomLen] === '-' && p[j + atomLen + 1] !== undefined && p[j + atomLen + 1] !== ']') {
      const k = j + atomLen + 1
      let to: string
      let toLen: number
      if (p[k] === '\\') {
        const e = readEscape(p, k, true, 0, unicode)
        to = e.literal !== undefined ? show(e.literal) : e.desc
        toLen = e.len
      } else {
        const c = String.fromCodePoint(p.codePointAt(k)!)
        to = show(c)
        toLen = c.length
      }
      items.push(`${atom} 到 ${to}`)
      j = k + toLen
      continue
    }
    items.push(atom)
    j += atomLen
  }
  if (j >= p.length) return { end: p.length, desc: '字符集没有闭合：缺少 ]', ok: false }
  if (start === j) {
    return {
      end: j + 1,
      desc: negated ? '任意字符（包括换行）' : '空字符集：永远无法匹配',
      ok: true,
    }
  }
  const list = items.join('、')
  return {
    end: j + 1,
    desc: negated ? `除 ${list} 以外的任意一个字符` : `${list} 中的任意一个字符`,
    ok: true,
  }
}

/** 解析量词，返回长度与描述；不是量词时返回 null */
function readQuantifier(p: string, i: number): { len: number; desc: string } | null {
  const ch = p[i]
  let len: number
  let base: string
  if (ch === '*') {
    len = 1
    base = '重复 0 次或多次'
  } else if (ch === '+') {
    len = 1
    base = '重复 1 次或多次'
  } else if (ch === '?') {
    len = 1
    base = '可有可无（0 次或 1 次）'
  } else if (ch === '{') {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(p.slice(i))
    if (!m) return null
    len = m[0].length
    const min = Number(m[1])
    if (m[2] === undefined) base = `恰好重复 ${min} 次`
    else if (m[3] === '') base = `至少重复 ${min} 次`
    else base = `重复 ${min} 到 ${m[3]} 次`
  } else return null
  const lazy = p[i + len] === '?'
  return {
    len: len + (lazy ? 1 : 0),
    desc: `${base}${lazy ? '（懒惰：尽可能少）' : ch === '{' && !/,/.test(p.slice(i, i + len)) ? '' : '（贪婪：尽可能多）'}`,
  }
}

type WorkNode = ExplainNode & { literalText?: string }

export function explainRegex(pattern: string, flags = ''): ExplainNode[] {
  const nodes: WorkNode[] = []
  const vMode = flags.includes('v')
  const unicode = flags.includes('u') || vMode
  const multiline = flags.includes('m')
  const dotAll = flags.includes('s')
  const groups = captureGroups(pattern, flags)
  let groupNo = 0
  let depth = 0
  let i = 0

  const pushLiteral = (ch: string, pos: number, token = ch) => {
    const last = nodes[nodes.length - 1]
    if (last && last.kind === 'literal' && last.pos + last.token.length === pos) {
      last.token += token
      last.literalText = (last.literalText ?? '') + ch
      last.desc = `文本 ${show(last.literalText)}`
      return
    }
    nodes.push({ token, desc: `文本 ${show(ch)}`, depth, kind: 'literal', pos, literalText: ch })
  }

  while (i < pattern.length) {
    const ch = pattern[i]
    const pos = i
    // 量词作用于前一项；多字符文本只作用于最后一个字符
    const q = readQuantifier(pattern, i)
    if (q && (ch !== '{' || nodes.length)) {
      const last = nodes[nodes.length - 1] as WorkNode | undefined
      const invalid =
        !last ||
        last.kind === 'alternation' ||
        last.kind === 'group' ||
        last.kind === 'anchor' ||
        last.kind === 'quantifier'
      if (invalid) {
        if (ch !== '{') {
          nodes.push({
            token: pattern.slice(i, i + q.len),
            desc:
              last?.kind === 'quantifier'
                ? '量词不能连续使用（无效）'
                : '量词前面没有可重复的内容（无效）',
            depth,
            kind: 'error',
            pos,
          })
          i += q.len
          continue
        }
      } else {
        if (last.kind === 'literal' && last.literalText && [...last.literalText].length > 1) {
          const chars = [...last.literalText]
          const lastChar = chars.pop()!
          // 只在文本没有转义记号时拆分 token（转义文本保持原样更易读）
          if (last.token === last.literalText) {
            last.token = chars.join('')
            last.literalText = chars.join('')
            last.desc = `文本 ${show(last.literalText)}`
            nodes.push({
              token: lastChar,
              desc: `文本 ${show(lastChar)}`,
              depth,
              kind: 'literal',
              pos: pos - lastChar.length,
            })
          }
        }
        nodes.push({
          token: pattern.slice(i, i + q.len),
          desc: `${q.desc}：作用于前一项`,
          depth,
          kind: 'quantifier',
          pos,
        })
        i += q.len
        continue
      }
    }

    if (ch === '\\') {
      const e = readEscape(pattern, i, false, groups.length, unicode)
      const token = pattern.slice(i, i + e.len)
      if (e.literal !== undefined && /^\\[^\w]$/.test(token)) pushLiteral(e.literal, pos, token)
      else nodes.push({ token, desc: e.desc, depth, kind: e.kind, pos })
      i += e.len
      continue
    }
    if (ch === '[') {
      const c = readClass(pattern, i, unicode, vMode)
      nodes.push({
        token: pattern.slice(i, c.end),
        desc: c.ok ? c.desc : c.desc,
        depth,
        kind: c.ok ? 'class' : 'error',
        pos,
      })
      i = c.end
      continue
    }
    if (ch === '(') {
      let len = 1
      let desc: string
      if (pattern.startsWith('(?:', i)) {
        len = 3
        desc = '非捕获分组：只分组，不单独记录匹配内容'
      } else if (pattern.startsWith('(?=', i)) {
        len = 3
        desc = '正向先行断言：后面必须紧跟以下内容（不消耗字符）'
      } else if (pattern.startsWith('(?!', i)) {
        len = 3
        desc = '负向先行断言：后面不能紧跟以下内容（不消耗字符）'
      } else if (pattern.startsWith('(?<=', i)) {
        len = 4
        desc = '正向后行断言：前面必须是以下内容（不消耗字符）'
      } else if (pattern.startsWith('(?<!', i)) {
        len = 4
        desc = '负向后行断言：前面不能是以下内容（不消耗字符）'
      } else if (pattern.startsWith('(?<', i)) {
        const end = pattern.indexOf('>', i + 3)
        len = end > 0 ? end - i + 1 : 3
        groupNo++
        desc = `命名捕获分组 #${groupNo}「${end > 0 ? pattern.slice(i + 3, end) : ''}」`
      } else if (/^\(\?[imsx]*(?:-[imsx]+)?:/.test(pattern.slice(i))) {
        const m = /^\(\?([imsx]*)(?:-([imsx]+))?:/.exec(pattern.slice(i))!
        len = m[0].length
        desc = `局部修饰符分组：${m[1] ? `开启 ${m[1]}` : ''}${m[1] && m[2] ? '，' : ''}${m[2] ? `关闭 ${m[2]}` : ''}`
      } else if (pattern[i + 1] === '?') {
        nodes.push({ token: '(?', desc: '无效的分组语法', depth, kind: 'error', pos })
        i += 2
        continue
      } else {
        groupNo++
        desc = `捕获分组 #${groupNo}`
      }
      nodes.push({ token: pattern.slice(i, i + len), desc, depth, kind: 'group', pos })
      depth++
      i += len
      continue
    }
    if (ch === ')') {
      if (depth === 0) {
        nodes.push({ token: ')', desc: '多余的 )：没有与之配对的 (', depth, kind: 'error', pos })
      } else {
        depth--
        nodes.push({ token: ')', desc: '分组结束', depth, kind: 'groupEnd', pos })
      }
      i++
      continue
    }
    if (ch === '|') {
      nodes.push({
        token: '|',
        desc: depth ? '或：分组内左右两侧任选其一' : '或：匹配左侧或右侧的整个表达式',
        depth,
        kind: 'alternation',
        pos,
      })
      i++
      continue
    }
    if (ch === '^') {
      nodes.push({
        token: '^',
        desc: multiline ? '行首（多行模式下每一行的开头）' : '字符串开头',
        depth,
        kind: 'anchor',
        pos,
      })
      i++
      continue
    }
    if (ch === '$') {
      nodes.push({
        token: '$',
        desc: multiline ? '行尾（多行模式下每一行的结尾）' : '字符串结尾',
        depth,
        kind: 'anchor',
        pos,
      })
      i++
      continue
    }
    if (ch === '.') {
      nodes.push({
        token: '.',
        desc: dotAll ? '任意一个字符（包括换行）' : '任意一个字符（换行符除外）',
        depth,
        kind: 'dot',
        pos,
      })
      i++
      continue
    }
    const c = String.fromCodePoint(pattern.codePointAt(i)!)
    pushLiteral(c, pos)
    i += c.length
  }
  if (depth > 0) {
    nodes.push({
      token: '',
      desc: `还有 ${depth} 个分组没有闭合：缺少 )`,
      depth: 0,
      kind: 'error',
      pos: pattern.length,
    })
  }
  // 去掉内部辅助字段
  return nodes.map(({ token, desc, depth: d, kind, pos: p }) => ({
    token,
    desc,
    depth: d,
    kind,
    pos: p,
  }))
}
