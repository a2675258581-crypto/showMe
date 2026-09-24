import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CODE_OPTIONS,
  LANGS,
  LANG_MAP,
  describePrettierError,
  detectLanguage,
  formatCode,
  isLangLoaded,
  pluginsFor,
  translateParserMessage,
  type CodeFormatOptions,
  type CodeLang,
  type FormatResult,
} from './code-formatter'
import { CODE_SAMPLES } from './code-formatter-samples'

const opts = (o: Partial<CodeFormatOptions> = {}): CodeFormatOptions => ({
  ...DEFAULT_CODE_OPTIONS,
  ...o,
})
const ok = (r: FormatResult) => {
  if (!r.ok) throw new Error(r.error.message)
  return r.output
}
const err = (r: FormatResult) => {
  if (r.ok) throw new Error(`expected error, got ${r.output}`)
  return r.error
}

describe('samples', () => {
  it.each(LANGS.map((l) => l.id))('%s sample is detected and formats cleanly', async (id) => {
    const sample = CODE_SAMPLES[id]
    expect(detectLanguage(sample)).toBe(id)
    const out = ok(await formatCode(sample, id))
    expect(out.length).toBeGreaterThan(0)
    // 幂等：再格式化一次结果不变
    expect(ok(await formatCode(out, id))).toBe(out)
  })
})

describe('formatCode', () => {
  it('returns empty output for blank input', async () => {
    expect(await formatCode('  \n', 'javascript')).toEqual({ ok: true, output: '', ms: 0 })
  })

  it('applies JS options', async () => {
    const src = "const a = {b: 'x', c: [1,2]}\nfoo(a,)"
    expect(ok(await formatCode(src, 'javascript'))).toBe(
      'const a = { b: "x", c: [1, 2] };\nfoo(a);\n',
    )
    expect(
      ok(
        await formatCode(
          src,
          'javascript',
          opts({ semi: false, singleQuote: true, bracketSpacing: false }),
        ),
      ),
    ).toBe("const a = {b: 'x', c: [1, 2]}\nfoo(a)\n")
  })

  it('applies printWidth, tabWidth, useTabs and trailingComma', async () => {
    const src =
      'function f(){return {alpha:1,beta:2,gamma:3,delta:4,epsilon:5,zeta:6,eta:7,theta:8,iota:9}}'
    const wide = ok(await formatCode(src, 'javascript', opts({ printWidth: 120 })))
    expect(wide).toContain('return { alpha: 1,')
    const narrow = ok(await formatCode(src, 'javascript', opts({ printWidth: 80, tabWidth: 4 })))
    expect(narrow).toContain('\n        alpha: 1,\n')
    expect(narrow).toContain('iota: 9,\n')
    const none = ok(await formatCode(src, 'javascript', opts({ trailingComma: 'none' })))
    expect(none).toContain('iota: 9\n')
    const tabs = ok(await formatCode(src, 'javascript', opts({ useTabs: true })))
    expect(tabs).toContain('\n\t\talpha: 1,\n')
  })

  it('treats TSX generics and JSX correctly via filename', async () => {
    const tsx = ok(await formatCode('const x=<T,>(a:T)=>a;const y=<div>hi</div>', 'tsx'))
    expect(tsx).toBe('const x = <T,>(a: T) => a;\nconst y = <div>hi</div>;\n')
    const ts = ok(await formatCode('const x=<T>a', 'typescript'))
    expect(ts).toBe('const x = <T>a;\n')
  })

  it('formats embedded code in HTML, Vue with lang="ts" and Markdown fences', async () => {
    const html = ok(await formatCode('<script>const a={b:1}</script>', 'html'))
    expect(html).toContain('const a = { b: 1 };')
    const vue = ok(
      await formatCode(
        '<template><p>{{a}}</p></template>\n<script setup lang="ts">\nconst a:number=1\n</script>',
        'vue',
      ),
    )
    expect(vue).toContain('const a: number = 1;')
    const md = ok(
      await formatCode('---\ntitle:   x\n---\n\n```ts\nlet a:number=1\n```\n', 'markdown'),
    )
    expect(md).toContain('title: x')
    expect(md).toContain('let a: number = 1;')
  })

  it('formats CSS-family, YAML and GraphQL', async () => {
    expect(ok(await formatCode('a{color:red;margin:0 auto}', 'css'))).toBe(
      'a {\n  color: red;\n  margin: 0 auto;\n}\n',
    )
    expect(ok(await formatCode("a: {b: 1}\nc: 'd'", 'yaml', opts({ bracketSpacing: false })))).toBe(
      'a: {b: 1}\nc: "d"\n',
    )
    expect(ok(await formatCode('{me{id name}}', 'graphql'))).toBe(
      '{\n  me {\n    id\n    name\n  }\n}\n',
    )
  })

  it('keeps 中文 and emoji intact', async () => {
    expect(ok(await formatCode("const s='你好 👋'", 'javascript'))).toBe('const s = "你好 👋";\n')
  })

  it('handles large input', async () => {
    const big = Array.from(
      { length: 2000 },
      (_, i) => `const v${i}={id:${i},name:'用户${i}'}`,
    ).join('\n')
    const out = ok(await formatCode(big, 'javascript'))
    expect(out.split('\n').length).toBe(2001)
  }, 30000)

  it('reports syntax errors with Chinese message, position and frame', async () => {
    const e = err(await formatCode('const a = {b:1,\n  c: [1,2,3', 'javascript'))
    expect(e.kind).toBe('syntax')
    expect(e.message).toBe('意外的符号，此处应为 ","')
    expect(e.detail).toBe('Unexpected token, expected ","')
    expect([e.line, e.column]).toEqual([2, 12])
    expect(e.frame?.lines.find((l) => l.error)?.text).toBe('  c: [1,2,3')
    expect(e.message).not.toContain('\u001b')
  })

  it.each([
    ['const s = "abc', 'javascript', '字符串没有闭合', 1, 11],
    ['const a: number = {b:1', 'typescript', "此处应为 '}'", 1, 23],
    ['a { color: red', 'css', '代码块没有闭合', 1, 1],
    ['<div><span></div>', 'html', '意外的结束标签 </div>', 1, 12],
    ['a:\n  - b\n c: 1', 'yaml', '同一映射中的所有键必须从同一列开始', 3, 1],
    ['query { user(id: 1) { name } ', 'graphql', '此处应为 Name，却遇到了 <EOF>', 1, 30],
  ] as [string, CodeLang, string, number, number][])(
    '%j (%s) → %s',
    async (src, lang, msg, line, column) => {
      const e = err(await formatCode(src, lang))
      expect(e.message).toContain(msg)
      expect([e.line, e.column]).toEqual([line, column])
    },
  )

  it('converts UTF-16 columns to code-point columns', async () => {
    const e = err(await formatCode('const s = "😀😀" +', 'javascript'))
    // "😀😀" 各占两个 UTF-16 单元，换算后列号应减 2
    expect(e.line).toBe(1)
    expect(e.frame?.caretPrefix.startsWith('const s = "😀😀" +')).toBe(true)
  })
})

describe('describePrettierError', () => {
  it('strips ANSI codes and code frames from unknown messages', () => {
    const e = describePrettierError(
      Object.assign(new SyntaxError('\u001b[31mSomething odd\u001b[39m (1:2)\n> 1 | x\n    | ^'), {
        loc: { start: { line: 1, column: 2 } },
      }),
      'xy',
    )
    expect(e.message).toBe('Something odd')
    expect(e.detail).toBeUndefined()
    expect(e.column).toBe(2)
  })

  it('turns stack overflows on deeply nested input into a friendly message', async () => {
    const e = err(await formatCode('['.repeat(5000) + ']'.repeat(5000), 'javascript'))
    expect(e.message).toBe('嵌套层级过深，超出了浏览器的处理能力')
    expect(e.line).toBeUndefined()
    expect(
      describePrettierError(new RangeError('Maximum call stack size exceeded'), 'x').kind,
    ).toBe('other')
  })

  it('handles errors without location', () => {
    expect(describePrettierError(new Error('boom'), 'x')).toMatchObject({ message: 'boom' })
    expect(describePrettierError('weird', 'x').message).toBe('weird')
  })
})

describe('translateParserMessage', () => {
  it('returns null for unknown messages', () => {
    expect(translateParserMessage('Totally new error')).toBeNull()
    expect(translateParserMessage('Missing semicolon.')).toBe('缺少分号')
  })
})

describe('pluginsFor / isLangLoaded', () => {
  it('adds embedded language plugins', () => {
    expect(pluginsFor('vue', '<script setup lang="ts">')).toContain('typescript')
    expect(pluginsFor('vue', '<script setup>')).not.toContain('typescript')
    expect(pluginsFor('markdown', '```yaml\na: 1\n```\n```tsx\n```')).toEqual(
      expect.arrayContaining(['markdown', 'yaml', 'typescript', 'estree']),
    )
    expect(pluginsFor('css', '')).toEqual(['postcss'])
  })

  it('reports loaded state after a format', async () => {
    await formatCode('a: 1', 'yaml')
    expect(isLangLoaded('yaml')).toBe(true)
  })
})

describe('detectLanguage', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['const a = 1', 'javascript'],
    ['console.log("hi")', 'javascript'],
    ['let x: number = 1', 'typescript'],
    ['function f(a: string): void {}', 'typescript'],
    ['interface User {\n  id: number;\n  name: string;\n}', 'typescript'],
    ['const x = <T,>(a: T) => a', 'typescript'],
    ['const [v, setV] = useState<string>("")', 'typescript'],
    ['import React from "react"\nexport const App = () => <div className="a">Hi</div>', 'jsx'],
    ['export const App = (p: Props) => <Button onClick={p.go}>去</Button>', 'tsx'],
    ['<div className="a">{x}</div>', 'jsx'],
    ['{"a": 1, "b": [true, null]}', 'json'],
    ['[1, 2, 3]', 'json'],
    ["{a: 1, b: 'x', // 注释\n}", 'json5'],
    ['// 配置\n{\n  port: 8080,\n}', 'json5'],
    ['<div class="a">x</div>', 'html'],
    ['<!doctype html><html><body></body></html>', 'html'],
    ['<template><div/></template>\n<script>export default {}</script>', 'vue'],
    ['<button (click)="go()">去</button>', 'angular'],
    ['<li *ngFor="let x of xs">{{x}}</li>', 'angular'],
    ['.a { color: red; }\n#b > p { margin: 0 }', 'css'],
    ['@media (max-width: 600px) {\n  .a { display: none; }\n}', 'css'],
    ['$x: 1px;\n.a { width: $x; }', 'scss'],
    ['.a {\n  &:hover { color: red; }\n}', 'scss'],
    ['@x: 1px;\n.a { width: @x; }', 'less'],
    ['# 标题\n\n一段说明文字，介绍这个项目。\n\n- 列表项', 'markdown'],
    ['普通的一段中文文本', 'markdown'],
    ['name: demo\nversion: 1\nlist:\n  - a\n  - b', 'yaml'],
    ['# 注释\nkey: value\nother: 2', 'yaml'],
    ['query { me { id } }', 'graphql'],
    ['{ me { id name } }', 'graphql'],
    ['type User {\n  id: ID!\n  name: String\n  posts: [Post!]!\n}', 'graphql'],
    ['mutation Add($t: String!) { add(title: $t) { id } }', 'graphql'],
    // 回归：单行对象字面量曾被当成 CSS 规则（`const x = {a:1}` 形似 `sel{prop:val}`）
    ['const x = {aaaaaaaaaaaaaaaa:1,bbbbbbbbbbbbbbbbbbbb:2}', 'javascript'],
    ['x = {a:1}', 'javascript'],
    ['const style = {color:"red"}', 'javascript'],
    ['input[type="text"]{border:0}', 'css'],
    ['a, b > c{margin:0}', 'css'],
  ] as [string, CodeLang | null][])('%j → %s', (src, lang) => {
    expect(detectLanguage(src)).toBe(lang)
  })

  it('is fast on large input', () => {
    const big = CODE_SAMPLES.typescript.repeat(2000)
    const t0 = performance.now()
    expect(detectLanguage(big)).toBe('typescript')
    expect(performance.now() - t0).toBeLessThan(500)
  })
})

describe('LANG_MAP', () => {
  it('has a definition and sample for every language', () => {
    for (const l of LANGS) {
      expect(LANG_MAP[l.id]).toBe(l)
      expect(CODE_SAMPLES[l.id]).toBeTruthy()
      expect(l.options).toEqual(expect.arrayContaining(['printWidth', 'tabWidth', 'useTabs']))
    }
  })
})
