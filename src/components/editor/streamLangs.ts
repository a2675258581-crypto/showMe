/**
 * 生成代码的轻量语法高亮（CodeMirror StreamLanguage）。
 * 共享编辑器只内置了 JS / JSON / XML 等语言包，这里补上 Shell、Python、Go、Java、PHP、Rust、Swift、C#。
 */
import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import type { EditorLang } from '@/components/editor/languages'
import type { CodeLang } from '@/lib/http-codegen'

interface CState {
  /** 正在读取的多行字符串：结束符 + 是否支持反斜杠转义 */
  str: { end: string; escapes: boolean } | null
  block: boolean
  /** 上一个有效 token 是否为「.」，用于识别属性名 */
  afterDot: boolean
}

interface Spec {
  keywords: string[]
  types?: string[]
  atoms?: string[]
  builtins?: string[]
  lineComment: string[]
  blockComment?: boolean
  /** 可以跨行的引号 */
  multiline?: string
  /** 不支持转义的引号（如 Go 的反引号、PHP 单引号按简单处理） */
  rawQuotes?: string
  rust?: boolean
  swift?: boolean
  phpVars?: boolean
  annotations?: boolean
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

function readString(
  stream: StringStream,
  state: { str: { end: string; escapes: boolean } | null },
): string {
  const { end, escapes } = state.str!
  while (!stream.eol()) {
    if (escapes && stream.peek() === '\\') {
      stream.next()
      stream.next()
      continue
    }
    if (stream.match(end)) {
      state.str = null
      return 'string'
    }
    stream.next()
  }
  return 'string'
}

function cLike(spec: Spec): StreamParser<CState> {
  const keywords = words(spec.keywords.join(' '))
  const types = words((spec.types ?? []).join(' '))
  const atoms = words((spec.atoms ?? []).join(' '))
  const builtins = words((spec.builtins ?? []).join(' '))
  return {
    startState: () => ({ str: null, block: false, afterDot: false }),
    token(stream, state) {
      if (state.block) {
        while (!stream.eol()) {
          if (stream.match('*/')) {
            state.block = false
            break
          }
          stream.next()
        }
        return 'comment'
      }
      if (state.str) return readString(stream, state)
      if (stream.eatSpace()) return null
      for (const lc of spec.lineComment) {
        if (stream.match(lc)) {
          stream.skipToEnd()
          return 'comment'
        }
      }
      if (spec.blockComment && stream.match('/*')) {
        state.block = true
        while (!stream.eol()) {
          if (stream.match('*/')) {
            state.block = false
            break
          }
          stream.next()
        }
        return 'comment'
      }
      if (spec.rust) {
        const m = stream.match(/^b?r(#*)"/) as RegExpMatchArray | null
        if (m) {
          state.str = { end: '"' + m[1], escapes: false }
          return readString(stream, state)
        }
      }
      if (spec.swift) {
        const m = stream.match(/^(#+)"/) as RegExpMatchArray | null
        if (m) {
          state.str = { end: '"' + m[1], escapes: false }
          return readString(stream, state)
        }
      }
      const ch = stream.peek()!
      if (ch === '"' || ch === "'" || ch === '`') {
        stream.next()
        state.str = { end: ch, escapes: !(spec.rawQuotes ?? '').includes(ch) }
        const t = readString(stream, state)
        // 不允许跨行的引号：行尾强制结束
        if (state.str && !(spec.multiline ?? '').includes(ch)) state.str = null
        state.afterDot = false
        return t
      }
      if (spec.phpVars && stream.match(/^\$[A-Za-z_]\w*/)) return 'variableName.special'
      if (spec.annotations && stream.match(/^@[A-Za-z_]\w*/)) return 'meta'
      if (stream.match(/^(0x[0-9a-fA-F]+|\d+(\.\d+)?([eE][+-]?\d+)?)[fFdDlLuU]*/)) {
        state.afterDot = false
        return 'number'
      }
      const id = stream.match(/^[A-Za-z_$][\w$]*!?/) as RegExpMatchArray | null
      if (id) {
        const w = id[0]
        const wasDot = state.afterDot
        state.afterDot = false
        if (wasDot) return stream.peek() === '(' ? 'propertyName.function' : 'propertyName'
        if (keywords.has(w)) return 'keyword'
        if (atoms.has(w)) return 'atom'
        if (types.has(w)) return 'typeName'
        if (builtins.has(w)) return 'variableName.standard'
        if (w.endsWith('!')) return 'variableName.function'
        if (/^[A-Z]/.test(w)) return 'typeName'
        if (stream.peek() === '(') return 'variableName.function'
        return 'variableName'
      }
      const c = stream.next()!
      state.afterDot = c === '.'
      return /[=+\-*/%<>!&|:?^~]/.test(c) ? 'operator' : null
    },
  }
}

interface ShState {
  str: { end: string; escapes: boolean } | null
  /** 当前命令是否已经出现过命令名 */
  cmd: boolean
  /** 上一行以 \ 结尾（续行） */
  cont: boolean
}

const shell: StreamParser<ShState> = {
  startState: () => ({ str: null, cmd: false, cont: false }),
  token(stream, state) {
    if (stream.sol() && !state.str) {
      if (!state.cont) state.cmd = false
      state.cont = false
    }
    if (state.str) return readString(stream, state)
    if (stream.eatSpace()) return null
    if (stream.match(/^#.*/)) return 'comment'
    if (stream.match("$'")) {
      state.str = { end: "'", escapes: true }
      return readString(stream, state)
    }
    const ch = stream.peek()
    if (ch === "'" || ch === '"') {
      stream.next()
      state.str = { end: ch, escapes: ch === '"' }
      return readString(stream, state)
    }
    if (stream.match(/^\\$/)) {
      state.cont = true
      return 'operator'
    }
    if (stream.match(/^[|<>&;]+/)) return 'operator'
    if (stream.match(/^\$\{?\w+\}?/)) return 'variableName.special'
    if (stream.match(/^--?[A-Za-z0-9][\w.-]*/)) {
      stream.match(/^=/)
      return 'attributeName'
    }
    if (!state.cmd && stream.match(/^[A-Za-z_][\w.-]*/)) {
      state.cmd = true
      return 'keyword'
    }
    if (stream.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/)) return 'atom'
    if (stream.match(/^[^\s'"\\|<>&;$]+/)) return 'string.special'
    stream.next()
    return null
  },
}

const LANGS: Partial<Record<CodeLang, StreamParser<unknown>>> = {
  shell: shell as StreamParser<unknown>,
  python: cLike({
    keywords: [
      'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield',
    ],
    atoms: ['True False None'],
    builtins: ['print open len dict list str int float bytes'],
    lineComment: ['#'],
  }) as StreamParser<unknown>,
  go: cLike({
    keywords: [
      'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
    ],
    types: ['string int int64 float64 bool byte error rune any'],
    atoms: ['true false nil iota'],
    builtins: ['make new len cap append panic recover'],
    lineComment: ['//'],
    blockComment: true,
    multiline: '`',
    rawQuotes: '`',
  }) as StreamParser<unknown>,
  java: cLike({
    keywords: [
      'abstract catch class else extends final finally for if implements import new package private protected public return static throw throws try var void while',
    ],
    types: ['int long byte boolean char double float short String'],
    atoms: ['true false null this'],
    lineComment: ['//'],
    blockComment: true,
    annotations: true,
  }) as StreamParser<unknown>,
  php: cLike({
    keywords: ['echo if else elseif new return function use namespace array isset print'],
    atoms: ['true false null PHP_EOL'],
    lineComment: ['//', '#'],
    blockComment: true,
    multiline: `'"`,
    rawQuotes: '',
    phpVars: true,
  }) as StreamParser<unknown>,
  rust: cLike({
    keywords: [
      'as async await break const continue crate else enum fn for if impl in let loop match mod move mut pub ref return self Self static struct trait type unsafe use where while dyn',
    ],
    types: ['String str u8 u16 u32 u64 i32 i64 f64 bool usize Vec Box Option Result'],
    atoms: ['true false None Some Ok Err'],
    lineComment: ['//'],
    blockComment: true,
    multiline: '"',
    rust: true,
  }) as StreamParser<unknown>,
  swift: cLike({
    keywords: [
      'as await break case catch class continue default defer do else enum extension for func guard if import in init let return self static struct switch throw throws try var where while',
    ],
    types: ['String Int Double Bool Data URL URLRequest URLSession UUID HTTPURLResponse'],
    atoms: ['true false nil'],
    lineComment: ['//'],
    blockComment: true,
    swift: true,
  }) as StreamParser<unknown>,
  csharp: cLike({
    keywords: [
      'using var new await async return if else foreach for in public private static class namespace void try catch throw typeof is as',
    ],
    types: ['string int long bool byte double object'],
    atoms: ['true false null'],
    lineComment: ['//'],
    blockComment: true,
  }) as StreamParser<unknown>,
}

const graphql = cLike({
  keywords: [
    'query mutation subscription fragment on type interface union enum input scalar schema extend directive implements repeatable',
  ],
  types: ['Int Float String Boolean ID'],
  atoms: ['true false null'],
  lineComment: ['#'],
}) as StreamParser<unknown>

/** 共享编辑器可直接使用的 StreamLanguage（见 languages.ts） */
export type StreamLangName = Exclude<CodeLang, 'javascript'> | 'graphql'

const STREAMS: Record<StreamLangName, StreamParser<unknown> | undefined> = {
  ...(LANGS as Record<Exclude<CodeLang, 'javascript'>, StreamParser<unknown>>),
  graphql,
}

const cache = new Map<StreamLangName, Extension[]>()

export function streamLanguage(name: StreamLangName): Extension[] {
  let ext = cache.get(name)
  if (!ext) {
    const parser = STREAMS[name]
    ext = parser ? [StreamLanguage.define(parser)] : []
    cache.set(name, ext)
  }
  return ext
}

/** 生成代码在 CodeEditor 里的语言设置：JS 用内置语言包，其它直接用对应的 EditorLang */
export function editorLangFor(lang: CodeLang): { lang: EditorLang; extensions?: Extension[] } {
  return { lang }
}
