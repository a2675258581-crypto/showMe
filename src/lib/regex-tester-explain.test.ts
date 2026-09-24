import { describe, expect, it } from 'vitest'
import { explainRegex } from './regex-tester-explain'

const brief = (p: string, f = '') => explainRegex(p, f).map((n) => [n.token, n.kind, n.depth])

describe('explainRegex', () => {
  it('does not treat [ inside a class as nesting outside v mode', () => {
    // 回归：之前 [^[\]] 被判为「字符集没有闭合」
    const nodes = explainRegex('\\[([^[\\]]+)\\]')
    expect(nodes.some((n) => n.kind === 'error')).toBe(false)
    const cls = nodes.find((n) => n.kind === 'class')!
    expect(cls.token).toBe('[^[\\]]')
    expect(cls.desc).toBe('除 “[”、“]” 以外的任意一个字符')
    // v 模式下嵌套字符集整体算一个
    const v = explainRegex('[[a-z]--[aeiou]]x', 'v')
    expect(v[0].kind).toBe('class')
    expect(v[0].token).toBe('[[a-z]--[aeiou]]')
  })

  it('explains anchors, escapes and quantifiers', () => {
    const nodes = explainRegex('^1[3-9]\\d{9}$')
    expect(nodes.map((n) => n.token)).toEqual(['^', '1', '[3-9]', '\\d', '{9}', '$'])
    expect(nodes[0].desc).toBe('字符串开头')
    expect(nodes[1].desc).toBe('文本 “1”')
    expect(nodes[2].desc).toBe('“3” 到 “9” 中的任意一个字符')
    expect(nodes[3].desc).toBe('数字（0-9）')
    expect(nodes[4].desc).toMatch(/^恰好重复 9 次/)
    expect(nodes[5].kind).toBe('anchor')
  })

  it('uses multiline / dotAll wording from flags', () => {
    expect(explainRegex('^.$', 'ms').map((n) => n.desc)).toEqual([
      '行首（多行模式下每一行的开头）',
      '任意一个字符（包括换行）',
      '行尾（多行模式下每一行的结尾）',
    ])
  })

  it('merges literal text and splits the last char before a quantifier', () => {
    expect(brief('abc+')).toEqual([
      ['ab', 'literal', 0],
      ['c', 'literal', 0],
      ['+', 'quantifier', 0],
    ])
    expect(explainRegex('你好')[0].desc).toBe('文本 “你好”')
  })

  it('describes groups with depth and numbering', () => {
    const nodes = explainRegex('(?<year>\\d{4})-(?:ab|cd)(x)')
    expect(nodes.map((n) => [n.token, n.depth])).toEqual([
      ['(?<year>', 0],
      ['\\d', 1],
      ['{4}', 1],
      [')', 0],
      ['-', 0],
      ['(?:', 0],
      ['ab', 1],
      ['|', 1],
      ['cd', 1],
      [')', 0],
      ['(', 0],
      ['x', 1],
      [')', 0],
    ])
    expect(nodes[0].desc).toBe('命名捕获分组 #1「year」')
    expect(nodes[10].desc).toBe('捕获分组 #2')
  })

  it('describes lookarounds and back references', () => {
    const d = explainRegex('(?=a)(?!b)(?<=c)(?<!d)(e)\\1\\k<n>').map((n) => n.desc)
    expect(d[0]).toMatch(/^正向先行断言/)
    expect(d[3]).toMatch(/^负向先行断言/)
    expect(d[6]).toMatch(/^正向后行断言/)
    expect(d[9]).toMatch(/^负向后行断言/)
    expect(d).toContain('反向引用：与第 1 个分组匹配到的内容相同')
    expect(d).toContain('反向引用：与命名分组「n」匹配到的内容相同')
  })

  it('describes character classes, negation and ranges', () => {
    expect(explainRegex('[^a-z0-9_]')[0].desc).toBe(
      '除 “a” 到 “z”、“0” 到 “9”、“_” 以外的任意一个字符',
    )
    expect(explainRegex('[\\d\\s.]')[0].desc).toBe('数字、空白字符、“.” 中的任意一个字符')
    expect(explainRegex('[^]')[0].desc).toBe('任意字符（包括换行）')
  })

  it('describes lazy / greedy quantifiers', () => {
    const d = explainRegex('a*?b+c?d{2,}e{1,3}').map((n) => n.desc)
    expect(d[1]).toMatch(/重复 0 次或多次（懒惰/)
    expect(d[3]).toMatch(/重复 1 次或多次（贪婪/)
    expect(d[5]).toMatch(/可有可无/)
    expect(d[7]).toMatch(/至少重复 2 次/)
    expect(d[9]).toMatch(/重复 1 到 3 次/)
  })

  it('describes unicode escapes and properties', () => {
    const d = explainRegex('\\u4e2d\\u{1F600}\\p{Script=Han}\\P{L}\\x41', 'u').map((n) => n.desc)
    expect(d[0]).toMatch(/“中”/)
    expect(d[1]).toMatch(/😀/)
    expect(d[2]).toBe('「汉字」字符（Unicode 属性）')
    expect(d[3]).toBe('不属于「字母」的字符（Unicode 属性）')
    expect(d[4]).toMatch(/“A”/)
  })

  it('treats escaped metacharacters as literal text', () => {
    expect(brief('a\\.b')).toEqual([['a\\.b', 'literal', 0]])
  })

  it('flags errors without throwing', () => {
    expect(explainRegex('(ab').at(-1)?.kind).toBe('error')
    expect(explainRegex('ab)')[1].kind).toBe('error')
    expect(explainRegex('*a')[0].kind).toBe('error')
    expect(explainRegex('a**')[2].kind).toBe('error')
    expect(explainRegex('[abc').at(-1)?.kind).toBe('error')
    expect(explainRegex('')).toEqual([])
    expect(explainRegex('\\')[0].kind).toBe('error')
  })

  it('handles literal braces that are not quantifiers', () => {
    expect(explainRegex('a{b}').map((n) => n.token)).toEqual(['a{b}'])
  })

  it('is fast on long patterns', () => {
    const p = '(?:[a-z]+\\d{2,4}|foo)'.repeat(2000)
    const t0 = Date.now()
    expect(explainRegex(p).length).toBeGreaterThan(1000)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})
