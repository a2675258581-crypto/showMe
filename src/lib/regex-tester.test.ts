import { describe, expect, it } from 'vitest'
import {
  captureGroups,
  compileRegex,
  expandReplacement,
  findMatches,
  normalizeFlags,
  replaceWithSpans,
  runRegex,
  toggleFlag,
  translateRegexError,
} from './regex-tester'

const re = (p: string, f = '') => {
  const c = compileRegex(p, f)
  if (!c.ok) throw new Error(c.error)
  return c.re
}

describe('flags', () => {
  it('normalizes order and removes junk / duplicates', () => {
    expect(normalizeFlags('yigmgx')).toBe('gimy')
    expect(normalizeFlags('')).toBe('')
  })
  it('toggles flags and keeps u / v exclusive', () => {
    expect(toggleFlag('g', 'i')).toBe('gi')
    expect(toggleFlag('gi', 'g')).toBe('i')
    expect(toggleFlag('gu', 'v')).toBe('gv')
    expect(toggleFlag('gv', 'u')).toBe('gu')
  })
})

describe('compileRegex', () => {
  it('compiles valid patterns', () => {
    expect(compileRegex('\\d+', 'g').ok).toBe(true)
    expect(compileRegex('', '').ok).toBe(true)
  })
  it('reports errors in Chinese', () => {
    const cases: [string, string, RegExp][] = [
      ['(abc', '', /分组没有闭合/],
      ['abc)', '', /多余的 \)/],
      ['*a', '', /量词前面没有可重复的内容/],
      ['[abc', '', /字符集没有闭合/],
      ['[z-a]', '', /范围顺序颠倒/],
      ['a{3,1}', '', /m 不能大于 n/],
      ['(?<1a>x)', '', /捕获组名称无效/],
      ['(?<a>x)(?<a>y)', '', /名称重复/],
      ['\\k<nope>(?<a>x)', '', /不存在的命名捕获组/],
      ['\\p{Nope}', 'u', /属性名无效/],
      ['\\', '', /单独的 \\/],
      ['\\-', 'u', /无效的转义/],
    ]
    for (const [p, f, msg] of cases) {
      const r = compileRegex(p, f)
      expect(r.ok, p).toBe(false)
      if (!r.ok) expect(r.error, p).toMatch(msg)
    }
  })
  it('rejects bad flags', () => {
    expect(compileRegex('a', 'gx')).toEqual({ ok: false, error: '不支持的标志：x' })
    expect(compileRegex('a', 'gg')).toEqual({ ok: false, error: '标志重复' })
    expect(compileRegex('a', 'uv')).toEqual({ ok: false, error: 'u 与 v 标志不能同时使用' })
  })
  it('keeps unknown messages', () => {
    expect(translateRegexError('Invalid regular expression: /x/: Something new')).toBe(
      'Something new',
    )
  })
})

describe('captureGroups', () => {
  it('lists numbered and named groups, skipping non-capturing ones', () => {
    expect(captureGroups('(a)(?:b)(?<name>c)(?=d)(?<!e)\\(f\\)[(](g)')).toEqual([
      { index: 1, name: null },
      { index: 2, name: 'name' },
      { index: 3, name: null },
    ])
    expect(captureGroups('')).toEqual([])
  })
  it('treats [ inside a character class as a literal outside v mode', () => {
    // 回归：之前把 [^[\]] 当成嵌套字符集，后面的分组全部漏掉
    const md = '\\[([^[\\]]+)\\]\\((?<url>[^)]+)\\)'
    expect(captureGroups(md)).toEqual([
      { index: 1, name: null },
      { index: 2, name: 'url' },
    ])
    expect(captureGroups('[[](a)', 'g')).toEqual([{ index: 1, name: null }])
    // v 模式允许嵌套：[[a-z]--[aeiou]] 是一个字符集
    expect(captureGroups('[[a-z]--[aeiou]](x)', 'v')).toEqual([{ index: 1, name: null }])
  })
  it('names groups correctly in match results for such patterns', () => {
    const r = findMatches(
      re('\\[([^[\\]]+)\\]\\((?<url>[^)]+)\\)', 'g'),
      'see [doc](https://a.com)',
    )
    expect(r.matches[0].groups.map((g) => [g.index, g.name, g.value])).toEqual([
      [1, null, 'doc'],
      [2, 'url', 'https://a.com'],
    ])
  })
})

describe('findMatches', () => {
  it('finds all matches with g and group positions', () => {
    const r = findMatches(re('(?<y>\\d{4})-(\\d{2})', 'g'), 'a 2024-01 b 1999-12')
    expect(r.truncated).toBe(false)
    expect(r.matches).toHaveLength(2)
    expect(r.matches[0]).toEqual({
      n: 0,
      start: 2,
      end: 9,
      text: '2024-01',
      groups: [
        { index: 1, name: 'y', value: '2024', start: 2, end: 6 },
        { index: 2, name: null, value: '01', start: 7, end: 9 },
      ],
    })
    expect(r.matches[1].start).toBe(12)
  })
  it('returns only the first match without g', () => {
    expect(findMatches(re('\\d'), 'a1b2').matches.map((m) => m.text)).toEqual(['1'])
  })
  it('respects sticky', () => {
    expect(findMatches(re('\\d', 'y'), 'a1').matches).toEqual([])
    expect(findMatches(re('\\d', 'gy'), '12a3').matches.map((m) => m.text)).toEqual(['1', '2'])
  })
  it('reports unmatched optional groups as undefined', () => {
    const g = findMatches(re('a(b)?(c)'), 'ac').matches[0].groups
    expect(g[0]).toEqual({ index: 1, name: null, value: undefined, start: null, end: null })
    expect(g[1].value).toBe('c')
  })
  it('handles empty matches without looping forever (emoji safe in u mode)', () => {
    expect(findMatches(re('', 'g'), 'ab').matches.map((m) => m.start)).toEqual([0, 1, 2])
    expect(findMatches(re('', 'gu'), '😀').matches.map((m) => m.start)).toEqual([0, 2])
    expect(findMatches(re('x*', 'g'), 'axxb').matches.map((m) => m.text)).toEqual([
      '',
      'xx',
      '',
      '',
    ])
  })
  it('matches Chinese with unicode properties', () => {
    const r = findMatches(re('\\p{Script=Han}+', 'gu'), 'Hello 世界！𠮷野家')
    expect(r.matches.map((m) => m.text)).toEqual(['世界', '𠮷野家'])
    expect(r.matches[1].start).toBe(9)
  })
  it('truncates at the limit', () => {
    const r = findMatches(re('a', 'g'), 'a'.repeat(100), 10)
    expect(r.matches).toHaveLength(10)
    expect(r.truncated).toBe(true)
  })
  it('agrees with matchAll on many inputs', () => {
    const cases: [string, string, string][] = [
      ['\\w+', 'g', 'hello world, 中文 foo_bar'],
      ['(?<=\\$)\\d+(\\.\\d+)?', 'g', 'cost $12.50 and $3'],
      ['^\\s*$', 'gm', 'a\n\n  \nb'],
      ['.', 'gs', 'a\nb'],
      ['[😀-😂]', 'gu', 'x😀y😁z'],
    ]
    for (const [p, f, text] of cases) {
      const ours = findMatches(re(p, f), text).matches.map((m) => [m.start, m.text])
      const native = [...text.matchAll(new RegExp(p, f))].map((m) => [m.index, m[0]])
      expect(ours, p).toEqual(native)
    }
  })
})

describe('expandReplacement / replaceWithSpans', () => {
  it('matches String.prototype.replace for every template form', () => {
    const text = 'John Smith, Jane Doe'
    const pattern = '(?<first>\\w+) (\\w+)'
    const templates = [
      '$2 $1',
      '$<first>!',
      '[$&]',
      '$$',
      '$`|',
      "|$'",
      '$0',
      '$3',
      '$10',
      '$01',
      '$<missing>',
      '$<unclosed',
      '$',
      'plain',
      '中文 $2 😀',
    ]
    for (const tpl of templates) {
      for (const flags of ['g', '']) {
        const r = replaceWithSpans(re(pattern, flags), text, tpl)
        expect(r.output, `${tpl} /${flags}`).toBe(text.replace(new RegExp(pattern, flags), tpl))
      }
    }
  })
  it('treats $<name> literally when there are no named groups', () => {
    expect(expandReplacement('$<x>', 'a', 0, 'a', [], undefined)).toBe('$<x>')
  })
  it('records spans of replaced text', () => {
    const r = replaceWithSpans(re('\\d+', 'g'), 'a1b22c', '<$&>')
    expect(r.output).toBe('a<1>b<22>c')
    expect(r.count).toBe(2)
    expect(r.spans).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 9 },
    ])
  })
  it('handles zero-width replacements (thousands separator)', () => {
    const r = replaceWithSpans(re('\\B(?=(?:\\d{3})+(?!\\d))', 'g'), '1234567', ',')
    expect(r.output).toBe('1,234,567')
    expect(r.count).toBe(2)
  })
})

describe('runRegex', () => {
  it('returns matches and replacement', () => {
    const r = runRegex({ id: 7, pattern: '(\\d)', flags: 'g', text: 'a1b2', replacement: '[$1]' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.id).toBe(7)
      expect(r.matches).toHaveLength(2)
      expect(r.replace?.output).toBe('a[1]b[2]')
      expect(r.elapsed).toBeGreaterThanOrEqual(0)
    }
  })
  it('returns compile errors', () => {
    const r = runRegex({ id: 1, pattern: '(', flags: '', text: '' })
    expect(r.ok).toBe(false)
  })
  it('handles large input', () => {
    const text = 'foo123 bar456 '.repeat(20_000)
    const r = runRegex({ id: 1, pattern: '\\d+', flags: 'g', text })
    expect(r.ok && r.truncated).toBe(true)
    if (r.ok) expect(r.matches).toHaveLength(5000)
  })
})
