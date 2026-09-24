/**
 * 生成代码的轻量语法高亮（CodeMirror StreamLanguage）。
 * 编辑器公共语言包里没有 Go / Java / Kotlin / Rust / Swift / Python / C#，
 * 这里用一个通用的类 C 分词器覆盖生成代码会用到的语法即可。
 */
import { StreamLanguage, type StringStream } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import type { TargetLang } from '@/lib/json-to-types-render'

interface Spec {
  keywords: string
  /** 内置类型（小写开头的也算类型，如 int64、str） */
  types: string
  atoms: string
  /** # 开头是注释（Python） */
  hashComment?: boolean
  /** #[...] 属性（Rust） */
  rustAttr?: boolean
  /** `...` 原始字符串（Go 标签） */
  backtick?: boolean
}

const SPECS: Record<Exclude<TargetLang, 'typescript'>, Spec> = {
  go: {
    keywords: 'package import type struct interface map func var const chan return',
    types:
      'string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 bool byte rune any error',
    atoms: 'true false nil',
    backtick: true,
  },
  java: {
    keywords:
      'public private protected static final class interface enum import package return void this new extends implements abstract',
    types:
      'long int double float boolean byte short char String Long Integer Double Float Boolean Object List Map',
    atoms: 'true false null',
  },
  kotlin: {
    keywords: 'data class val var import package typealias object fun return private internal',
    types: 'String Long Int Double Float Boolean List Map Any JsonElement',
    atoms: 'true false null',
  },
  rust: {
    keywords: 'pub struct enum use type fn impl mod crate self super let mut as',
    types: 'String i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 bool usize isize Vec Option HashMap',
    atoms: 'true false None Some',
    rustAttr: true,
  },
  swift: {
    keywords:
      'struct enum case let var import func init throws try switch self if else return class typealias protocol',
    types: 'String Int Double Float Bool Decoder Encoder Codable CodingKey Hashable',
    atoms: 'true false nil',
  },
  python: {
    keywords: 'from import class def return as pass',
    types: 'str int float bool list dict Any TypedDict NotRequired',
    atoms: 'True False None',
    hashComment: true,
  },
  csharp: {
    keywords: 'using namespace public private class get set new return static',
    types: 'string long int double float bool object List Dictionary',
    atoms: 'true false null',
  },
}

interface State {
  inBlockComment: boolean
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

function readString(stream: StringStream, quote: string): string {
  let escaped = false
  let ch: string | void
  while ((ch = stream.next()) != null) {
    if (ch === quote && !escaped) break
    escaped = !escaped && ch === '\\'
  }
  return 'string'
}

function makeLanguage(spec: Spec) {
  const keywords = words(spec.keywords)
  const types = words(spec.types)
  const atoms = words(spec.atoms)
  return StreamLanguage.define<State>({
    startState: () => ({ inBlockComment: false }),
    token(stream, state) {
      if (state.inBlockComment) {
        if (stream.skipTo('*/')) {
          stream.pos += 2
          state.inBlockComment = false
        } else stream.skipToEnd()
        return 'comment'
      }
      if (stream.eatSpace()) return null
      if (spec.hashComment ? stream.match('#') : stream.match('//')) {
        stream.skipToEnd()
        return 'comment'
      }
      if (stream.match('/*')) {
        state.inBlockComment = true
        return 'comment'
      }
      if (spec.rustAttr && stream.match(/^#!?\[/)) {
        let depth = 1
        while (!stream.eol() && depth > 0) {
          const ch = stream.next()
          if (ch === '[') depth++
          else if (ch === ']') depth--
          else if (ch === '"') readString(stream, '"')
        }
        return 'meta'
      }
      const ch = stream.peek()
      if (ch === '"' || ch === "'") {
        stream.next()
        return readString(stream, ch)
      }
      if (ch === '`' && spec.backtick) {
        stream.next()
        if (stream.skipTo('`')) stream.next()
        else stream.skipToEnd()
        return 'string'
      }
      if (ch === '@' && stream.match(/^@[\p{L}_][\p{L}\p{N}_.]*/u)) return 'meta'
      if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number'
      if (stream.match(/^[\p{L}_$][\p{L}\p{N}_$]*/u)) {
        const w = stream.current()
        if (keywords.has(w)) return 'keyword'
        if (atoms.has(w)) return 'atom'
        if (types.has(w)) return 'typeName'
        if (/^\p{Lu}/u.test(w)) return 'typeName'
        return stream.match(/^\s*\(/, false) ? 'variableName.function' : 'variableName'
      }
      stream.next()
      return null
    },
    languageData: { commentTokens: { line: spec.hashComment ? '#' : '//' } },
  })
}

const cache = new Map<TargetLang, Extension[]>()

/** 目标语言的高亮扩展；TypeScript 用编辑器自带的语言包，返回空数组 */
export function highlightFor(lang: TargetLang): Extension[] {
  if (lang === 'typescript') return []
  let ext = cache.get(lang)
  if (!ext) {
    ext = [makeLanguage(SPECS[lang])]
    cache.set(lang, ext)
  }
  return ext
}
