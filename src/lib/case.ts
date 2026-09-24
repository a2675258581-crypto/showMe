/** 命名风格转换（纯函数，无 DOM 依赖） */

export type CaseStyle =
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'kebab'
  | 'constant'
  | 'dot'
  | 'path'
  | 'title'
  | 'sentence'
  | 'lower'
  | 'upper'
  | 'train'

export const CASE_STYLES: { id: CaseStyle; label: string; example: string }[] = [
  { id: 'camel', label: 'camelCase', example: 'helloWorld' },
  { id: 'pascal', label: 'PascalCase', example: 'HelloWorld' },
  { id: 'snake', label: 'snake_case', example: 'hello_world' },
  { id: 'constant', label: 'CONSTANT_CASE', example: 'HELLO_WORLD' },
  { id: 'kebab', label: 'kebab-case', example: 'hello-world' },
  { id: 'train', label: 'Train-Case', example: 'Hello-World' },
  { id: 'dot', label: 'dot.case', example: 'hello.world' },
  { id: 'path', label: 'path/case', example: 'hello/world' },
  { id: 'title', label: 'Title Case', example: 'Hello World' },
  { id: 'sentence', label: 'Sentence case', example: 'Hello world' },
  { id: 'lower', label: 'lower case', example: 'hello world' },
  { id: 'upper', label: 'UPPER CASE', example: 'HELLO WORLD' },
]

/**
 * 把任意风格的标识符拆成小写单词：
 * "XMLHttpRequest2Fast" → ["xml", "http", "request", "2", "fast"]
 */
export function splitWords(input: string): string[] {
  return (
    input
      // 驼峰边界：aB → a B；ABc → A Bc；字母与数字之间
      .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
      .replace(/(\p{L})(\d)/gu, '$1 $2')
      .replace(/(\d)(\p{L})/gu, '$1 $2')
      .split(/[^\p{L}\d]+/u)
      .filter(Boolean)
      .map((w) => w.toLowerCase())
  )
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

export function convertCase(input: string, style: CaseStyle): string {
  const w = splitWords(input)
  if (w.length === 0) return ''
  switch (style) {
    case 'camel':
      return w[0] + w.slice(1).map(cap).join('')
    case 'pascal':
      return w.map(cap).join('')
    case 'snake':
      return w.join('_')
    case 'constant':
      return w.join('_').toUpperCase()
    case 'kebab':
      return w.join('-')
    case 'train':
      return w.map(cap).join('-')
    case 'dot':
      return w.join('.')
    case 'path':
      return w.join('/')
    case 'title':
      return w.map(cap).join(' ')
    case 'sentence':
      return cap(w.join(' '))
    case 'lower':
      return w.join(' ')
    case 'upper':
      return w.join(' ').toUpperCase()
  }
}

/** 逐行转换，保留空行 */
export function convertLines(input: string, style: CaseStyle): string {
  return input
    .split('\n')
    .map((line) => (line.trim() ? convertCase(line, style) : line))
    .join('\n')
}
