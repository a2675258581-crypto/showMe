import { describe, expect, it } from 'vitest'
import {
  CODE_LANGS,
  convertReplacement,
  generateCode,
  quoteDouble,
  quotePhp,
} from './regex-tester-codegen'

describe('string quoting', () => {
  it('quotes double-quoted literals', () => {
    expect(quoteDouble('a"b\\c\nd\t中😀')).toBe('"a\\"b\\\\c\\nd\\t中😀"')
    expect(quoteDouble('\u0001')).toBe('"\\u0001"')
    // JS 中双引号字面量可以直接求值还原
    const s = 'x"y\\z\n '
    expect(JSON.parse(quoteDouble(s))).toBe(s)
  })
  it('quotes PHP single-quoted literals', () => {
    expect(quotePhp("it's \\d")).toBe("'it\\'s \\\\d'")
  })
})

describe('generateCode', () => {
  const input = { pattern: '(?<year>\\d{4})-(\\d{2})/x', flags: 'gim', text: '2024-01/x' }

  it('produces JavaScript that runs', () => {
    const { code } = generateCode('javascript', input)
    expect(code).toContain('const regex = /(?<year>\\d{4})-(\\d{2})\\/x/gim;')
    expect(code).toContain('text.matchAll(regex)')
    const logs: unknown[][] = []
    new Function('console', code)({ log: (...a: unknown[]) => logs.push(a) })
    expect(logs[0][0]).toBe(0)
    expect(logs[0][1]).toBe('2024-01/x')
  })

  it('produces JavaScript replace code that runs', () => {
    const { code } = generateCode('javascript', { ...input, replacement: '$2.$<year>' })
    const logs: unknown[] = []
    new Function('console', code)({ log: (a: unknown) => logs.push(a) })
    expect(logs[0]).toBe('01.2024')
  })

  it('converts named groups and flags for Python', () => {
    const { code } = generateCode('python', input)
    expect(code).toContain(
      're.compile(r"(?P<year>\\d{4})-(\\d{2})/x", re.IGNORECASE | re.MULTILINE)',
    )
    expect(code).toContain('pattern.finditer(text)')
    const single = generateCode('python', { pattern: 'a"b', flags: 'y' }).code
    expect(single).toContain('re.compile(r"a\\"b")')
    expect(single).toContain('pattern.match(text)')
  })

  it('converts replacement templates per language', () => {
    const names = ['year', null]
    expect(convertReplacement('$2/$<year> $& $$', 'python', names).value).toBe(
      '\\g<2>/\\g<year> \\g<0> $',
    )
    expect(convertReplacement('$2/$<year> $& $$', 'java', names).value).toBe('$2/${year} $0 \\$')
    expect(convertReplacement('$2/$<year> $& $$', 'go', names).value).toBe('${2}/${year} ${0} $$')
    expect(convertReplacement('$2/$<year> $& $$', 'php', names).value).toBe('${2}/${1} ${0} \\$')
    expect(convertReplacement('a\\b', 'python', []).value).toBe('a\\\\b')
    expect(convertReplacement("$'", 'go', []).notes).toHaveLength(1)
  })

  it('produces Java with escaped string and flags', () => {
    const { code } = generateCode('java', { ...input, replacement: '$1' })
    expect(code).toContain(
      'Pattern.compile("(?<year>\\\\d{4})-(\\\\d{2})/x", Pattern.CASE_INSENSITIVE | Pattern.MULTILINE)',
    )
    expect(code).toContain('matcher.replaceAll("$1")')
    expect(code).toContain('public class Main')
  })

  it('produces Go with inline flags and warns about RE2 limits', () => {
    const { code } = generateCode('go', input)
    expect(code).toContain('regexp.MustCompile(`(?im)(?P<year>\\d{4})-(\\d{2})/x`)')
    expect(generateCode('go', { pattern: '(?<=a)b', flags: '' }).notes[0]).toMatch(/RE2/)
    expect(generateCode('go', { pattern: 'a`b', flags: '' }).code).toContain(
      'regexp.MustCompile("a`b")',
    )
  })

  it('produces PHP with delimiter escaping and UTF-8 flag', () => {
    const { code } = generateCode('php', input)
    expect(code).toContain("$pattern = '/(?<year>\\\\d{4})-(\\\\d{2})\\\\/x/imu';")
    expect(code).toContain('preg_match_all')
    expect(generateCode('php', { pattern: 'a', flags: '' }).code).toContain('preg_match(')
  })

  it('converts unicode escapes', () => {
    expect(generateCode('python', { pattern: '\\u{1F600}\\u4e2d', flags: 'u' }).code).toContain(
      'r"\\U0001F600\\u4e2d"',
    )
    expect(generateCode('php', { pattern: '\\u4e2d', flags: 'u' }).code).toContain('\\\\x{4e2d}')
    expect(generateCode('go', { pattern: '\\u4e2d', flags: '' }).code).toContain('\\x{4e2d}')
  })

  it('uses a placeholder for long or empty text', () => {
    const { code } = generateCode('javascript', {
      pattern: 'a',
      flags: 'g',
      text: 'x'.repeat(5000),
    })
    expect(code).toContain('在这里放入要匹配的文本')
  })

  it('generates something for every language without throwing', () => {
    for (const { value } of CODE_LANGS) {
      for (const flags of ['', 'g', 'gimsuy', 'dy']) {
        const r = generateCode(value, {
          pattern: '(a)|[b/]\\k<x>(?<x>c)',
          flags,
          replacement: '$1',
        })
        expect(r.code.length).toBeGreaterThan(20)
      }
    }
  })
})
