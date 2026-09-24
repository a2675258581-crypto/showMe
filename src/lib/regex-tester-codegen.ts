/** 把 JS 正则转换成各语言的示例代码（纯函数） */
import { captureGroups } from './regex-tester'

export type CodeLang = 'javascript' | 'python' | 'java' | 'go' | 'php'

export const CODE_LANGS: { value: CodeLang; label: string }[] = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go' },
  { value: 'php', label: 'PHP' },
]

export interface CodegenInput {
  pattern: string
  flags: string
  /** 测试文本；太长时代码里用占位符 */
  text?: string
  /** 提供时生成替换代码 */
  replacement?: string
}

export interface CodegenResult {
  code: string
  /** 语义差异提醒（中文） */
  notes: string[]
}

const MAX_EMBED = 800

/** 生成双引号字符串字面量（JS / Java / Go / Python 通用的转义子集） */
export function quoteDouble(s: string): string {
  let out = '"'
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) {
      out += '\\u' + c.toString(16).padStart(4, '0')
    } else out += ch
  }
  return out + '"'
}

/** PHP 单引号字符串：只需转义 \ 与 ' */
export function quotePhp(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

/** 转义未被转义的 /（正则字面量与 PHP 分隔符），并把真实换行写成 \n */
function escapeSlash(src: string): string {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\\') {
      out += ch + (src[i + 1] ?? '')
      i++
      continue
    }
    if (ch === '/') out += '\\/'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else out += ch
  }
  return out
}

/** 把 JS 独有的写法换成目标语言的等价写法 */
function convertPattern(pattern: string, lang: Exclude<CodeLang, 'javascript'>): string {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\') {
      const next = pattern[i + 1] ?? ''
      // \u{1F600} / \uXXXX
      if (next === 'u') {
        const brace = /^\\u\{([0-9A-Fa-f]{1,6})\}/.exec(pattern.slice(i))
        const four = /^\\u([0-9A-Fa-f]{4})/.exec(pattern.slice(i))
        const hex = brace?.[1] ?? four?.[1]
        if (hex) {
          const len = (brace ?? four)![0].length
          if (lang === 'python') {
            out += hex.length <= 4 ? `\\u${hex.padStart(4, '0')}` : `\\U${hex.padStart(8, '0')}`
          } else if (lang === 'java' && !brace) out += `\\u${hex}`
          else out += `\\x{${hex}}`
          i += len - 1
          continue
        }
      }
      // \k<name> 反向引用
      if (next === 'k' && pattern[i + 2] === '<') {
        const end = pattern.indexOf('>', i + 3)
        if (end > 0) {
          const name = pattern.slice(i + 3, end)
          if (lang === 'python') out += `(?P=${name})`
          else if (lang === 'php') out += `\\k<${name}>`
          else out += `\\k<${name}>`
          i = end
          continue
        }
      }
      out += ch + next
      i++
      continue
    }
    // (?<name> → Python / Go 的 (?P<name>
    if (
      ch === '(' &&
      pattern.startsWith('(?<', i) &&
      pattern[i + 3] !== '=' &&
      pattern[i + 3] !== '!' &&
      (lang === 'python' || lang === 'go')
    ) {
      out += '(?P<'
      i += 2
      continue
    }
    out += ch
  }
  return out
}

/** 把 JS 替换模板转换成目标语言的写法 */
export function convertReplacement(
  template: string,
  lang: CodeLang,
  groupNames: (string | null)[],
): { value: string; notes: string[] } {
  if (lang === 'javascript') return { value: template, notes: [] }
  const notes = new Set<string>()
  const m = groupNames.length
  let out = ''
  const literal = (s: string) => {
    // Python / Java / PHP 的替换串里反斜杠有特殊含义，需要转义
    if (lang === 'python' || lang === 'php' || lang === 'java') return s.replace(/\\/g, '\\\\')
    return s
  }
  const group = (ref: string | number): string => {
    switch (lang) {
      case 'python':
        return `\\g<${ref}>`
      case 'java':
        return typeof ref === 'number' ? `$${ref}` : `\${${ref}}`
      case 'go':
        return `\${${ref}}`
      case 'php':
        return `\${${ref}}`
    }
  }
  for (let i = 0; i < template.length;) {
    const ch = template[i]
    const next = template[i + 1]
    if (ch !== '$' || next === undefined) {
      if (ch === '$') out += lang === 'java' || lang === 'php' ? '\\$' : lang === 'go' ? '$$' : '$'
      else out += literal(ch)
      i++
      continue
    }
    if (next === '$') {
      out += lang === 'java' || lang === 'php' ? '\\$' : lang === 'go' ? '$$' : '$'
      i += 2
    } else if (next === '&') {
      out += group(0)
      i += 2
    } else if (next === '`' || next === "'") {
      notes.add("替换模板中的 $` 与 $' 在该语言中没有直接对应写法，已原样保留")
      out += literal('$' + next)
      i += 2
    } else if (/\d/.test(next)) {
      const two = /\d/.test(template[i + 2] ?? '')
      let digits = two ? template.slice(i + 1, i + 3) : next
      if (two && Number(digits) > m) digits = next
      const n = Number(digits)
      if (n >= 1 && n <= m) out += group(n)
      else out += literal('$') + digits
      i += 1 + digits.length
    } else if (next === '<') {
      const end = template.indexOf('>', i + 2)
      if (end < 0) {
        out += literal('$<')
        i += 2
        continue
      }
      const name = template.slice(i + 2, end)
      if (lang === 'php') {
        // PCRE 的替换串不支持命名引用，换成组号
        const idx = groupNames.indexOf(name)
        out += idx >= 0 ? group(idx + 1) : ''
      } else out += group(name)
      i = end + 1
    } else {
      out += lang === 'java' || lang === 'php' ? '\\$' : lang === 'go' ? '$$' : '$'
      i++
    }
  }
  return { value: out, notes: [...notes] }
}

/** Python 原始字符串：内容里的引号只能用「前面有偶数个反斜杠」时加 \ 的方式转义 */
function pythonRaw(s: string): string {
  if (/[\n\r]/.test(s) || /(^|[^\\])(\\\\)*\\$/.test(s)) return quoteDouble(s)
  let out = ''
  let bs = 0
  for (const ch of s) {
    if (ch === '"' && bs % 2 === 0) out += '\\"'
    else out += ch
    bs = ch === '\\' ? bs + 1 : 0
  }
  return 'r"' + out + '"'
}

function goPattern(s: string): string {
  return s.includes('`') ? quoteDouble(s) : '`' + s + '`'
}

const UNSUPPORTED_GO = /\(\?<?[=!]|\\[1-9]|\\k</

function textLiteral(
  input: CodegenInput,
  quote: (s: string) => string,
  placeholder: string,
): string {
  const t = input.text ?? ''
  return t && t.length <= MAX_EMBED ? quote(t) : quote(placeholder)
}

export function generateCode(lang: CodeLang, input: CodegenInput): CodegenResult {
  const { pattern, flags } = input
  const global = flags.includes('g')
  const sticky = flags.includes('y')
  const replace = input.replacement !== undefined
  const names = captureGroups(pattern, flags).map((g) => g.name)
  const notes: string[] = []
  const placeholder = '在这里放入要匹配的文本'

  switch (lang) {
    case 'javascript': {
      const lit = `/${escapeSlash(pattern) || '(?:)'}/${flags}`
      const text = textLiteral(input, quoteDouble, placeholder)
      const lines = [`const regex = ${lit};`, `const text = ${text};`, '']
      if (replace) {
        lines.push(`const result = text.replace(regex, ${quoteDouble(input.replacement!)});`)
        lines.push('console.log(result);')
      } else if (global) {
        lines.push('for (const m of text.matchAll(regex)) {')
        lines.push('  console.log(m.index, m[0], m.groups);')
        lines.push('}')
      } else {
        lines.push('const m = regex.exec(text);')
        lines.push('if (m) {')
        lines.push('  console.log(m.index, m[0], m.groups);')
        lines.push('}')
      }
      return { code: lines.join('\n'), notes }
    }

    case 'python': {
      const p = convertPattern(pattern, 'python')
      const pyFlags = [
        flags.includes('i') && 're.IGNORECASE',
        flags.includes('m') && 're.MULTILINE',
        flags.includes('s') && 're.DOTALL',
      ].filter(Boolean) as string[]
      const text = textLiteral(input, quoteDouble, placeholder)
      const lines = [
        'import re',
        '',
        `pattern = re.compile(${pythonRaw(p)}${pyFlags.length ? ', ' + pyFlags.join(' | ') : ''})`,
        `text = ${text}`,
        '',
      ]
      if (replace) {
        const r = convertReplacement(input.replacement!, 'python', names)
        notes.push(...r.notes)
        lines.push(
          `result = pattern.sub(${pythonRaw(r.value)}, text${global ? '' : ', count=1'})`,
          'print(result)',
        )
      } else if (global) {
        lines.push(
          'for m in pattern.finditer(text):',
          '    print(m.start(), m.group(0), m.groups())',
        )
      } else {
        lines.push(
          `m = pattern.${sticky ? 'match' : 'search'}(text)`,
          'if m:',
          '    print(m.start(), m.group(0), m.groups())',
        )
      }
      if (sticky && global) notes.push('Python 没有 y（粘连）标志，已按普通全局匹配处理')
      return { code: lines.join('\n'), notes }
    }

    case 'java': {
      const p = convertPattern(pattern, 'java')
      const jFlags = [
        flags.includes('i') && 'Pattern.CASE_INSENSITIVE',
        flags.includes('i') &&
          (flags.includes('u') || flags.includes('v')) &&
          'Pattern.UNICODE_CASE',
        flags.includes('m') && 'Pattern.MULTILINE',
        flags.includes('s') && 'Pattern.DOTALL',
      ].filter(Boolean) as string[]
      const text = textLiteral(input, quoteDouble, placeholder)
      const body: string[] = [
        `Pattern pattern = Pattern.compile(${quoteDouble(p)}${jFlags.length ? ', ' + jFlags.join(' | ') : ''});`,
        `String text = ${text};`,
        'Matcher matcher = pattern.matcher(text);',
        '',
      ]
      if (replace) {
        const r = convertReplacement(input.replacement!, 'java', names)
        notes.push(...r.notes)
        body.push(
          `String result = matcher.${global ? 'replaceAll' : 'replaceFirst'}(${quoteDouble(r.value)});`,
          'System.out.println(result);',
        )
      } else if (global) {
        body.push(
          'while (matcher.find()) {',
          '    System.out.println(matcher.start() + ": " + matcher.group());',
          '}',
        )
      } else {
        body.push(
          `if (matcher.${sticky ? 'lookingAt' : 'find'}()) {`,
          '    System.out.println(matcher.start() + ": " + matcher.group());',
          '}',
        )
      }
      const code = [
        'import java.util.regex.Matcher;',
        'import java.util.regex.Pattern;',
        '',
        'public class Main {',
        '    public static void main(String[] args) {',
        ...body.map((l) => (l ? '        ' + l : '')),
        '    }',
        '}',
      ].join('\n')
      return { code, notes }
    }

    case 'go': {
      const inline = ['i', 'm', 's'].filter((f) => flags.includes(f)).join('')
      const p = (inline ? `(?${inline})` : '') + convertPattern(pattern, 'go')
      if (UNSUPPORTED_GO.test(pattern)) {
        notes.push('Go 的 regexp（RE2 引擎）不支持先行 / 后行断言和反向引用，这段代码会编译失败')
      }
      if (sticky) notes.push('Go 没有 y（粘连）标志，可在表达式开头加 ^ 或 \\A 达到类似效果')
      const text = textLiteral(input, quoteDouble, placeholder)
      const body = [`re := regexp.MustCompile(${goPattern(p)})`, `text := ${text}`, '']
      if (replace) {
        const r = convertReplacement(input.replacement!, 'go', names)
        notes.push(...r.notes)
        if (!global) notes.push('Go 的 ReplaceAllString 总是替换全部匹配')
        body.push(
          `result := re.ReplaceAllString(text, ${quoteDouble(r.value)})`,
          'fmt.Println(result)',
        )
      } else if (global) {
        body.push(
          'for _, m := range re.FindAllStringSubmatchIndex(text, -1) {',
          '\tfmt.Println(m[0], text[m[0]:m[1]])',
          '}',
        )
      } else {
        body.push('if m := re.FindStringSubmatch(text); m != nil {', '\tfmt.Println(m)', '}')
      }
      const code = [
        'package main',
        '',
        'import (',
        '\t"fmt"',
        '\t"regexp"',
        ')',
        '',
        'func main() {',
        ...body.map((l) => (l ? '\t' + l : '')),
        '}',
      ].join('\n')
      return { code, notes }
    }

    case 'php': {
      const phpFlags = ['i', 'm', 's'].filter((f) => flags.includes(f)).join('') + 'u'
      const src = escapeSlash(convertPattern(pattern, 'php'))
      const text = textLiteral(input, quotePhp, placeholder)
      const lines = [
        '<?php',
        `$pattern = ${quotePhp(`/${src}/${phpFlags}`)};`,
        `$text = ${text};`,
        '',
      ]
      if (replace) {
        const r = convertReplacement(input.replacement!, 'php', names)
        notes.push(...r.notes)
        lines.push(
          `$result = preg_replace($pattern, ${quotePhp(r.value)}, $text${global ? '' : ', 1'});`,
          'echo $result;',
        )
      } else if (global) {
        lines.push(
          'if (preg_match_all($pattern, $text, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE)) {',
          '    print_r($matches);',
          '}',
        )
      } else {
        lines.push(
          'if (preg_match($pattern, $text, $m, PREG_OFFSET_CAPTURE)) {',
          '    print_r($m);',
          '}',
        )
      }
      if (sticky) notes.push('PHP 没有 y（粘连）标志，可改用 A 修饰符（锚定到开头）')
      return { code: lines.join('\n'), notes }
    }
  }
}
