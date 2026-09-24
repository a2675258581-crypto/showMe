import { describe, expect, it } from 'vitest'
import {
  ESCAPE_FORMATS,
  charCategory,
  escapeText,
  inspectChars,
  textStats,
  unescapeText,
  utf16UnitsOf,
  utf8BytesOf,
  type EscapeFormat,
} from './unicode-escape'

const esc = (
  s: string,
  format: EscapeFormat,
  extra: { onlyNonAscii?: boolean; upper?: boolean } = {},
) => escapeText(s, { format, ...extra }).output
const un = (s: string, opts = {}) => unescapeText(s, opts).output

describe('escapeText', () => {
  it.each([
    ['js', 'A中😀', 'A\\u4E2D\\uD83D\\uDE00'],
    ['es6', 'A中😀', 'A\\u{4E2D}\\u{1F600}'],
    ['python', 'A中😀', 'A\\u4E2D\\U0001F600'],
    ['html-hex', 'A中😀', 'A&#x4E2D;&#x1F600;'],
    ['html-dec', 'A中😀', 'A&#20013;&#128512;'],
    ['utf8-hex', 'A中😀', 'A\\xE4\\xB8\\xAD\\xF0\\x9F\\x98\\x80'],
    ['utf8-url', 'A中😀', 'A%E4%B8%AD%F0%9F%98%80'],
    ['codepoint', 'A中😀', 'AU+4E2D U+1F600'],
    ['css', 'A中😀', 'A\\4E2D\\1F600'],
  ] as const)('%s', (format, input, expected) => {
    expect(esc(input, format)).toBe(expected)
  })

  it('supports lowercase hex (except U+ notation)', () => {
    expect(esc('中', 'js', { upper: false })).toBe('\\u4e2d')
    expect(esc('中', 'utf8-url', { upper: false })).toBe('%e4%b8%ad')
    expect(esc('中', 'codepoint', { upper: false })).toBe('U+4E2D')
  })

  it('escapes everything when onlyNonAscii is off', () => {
    expect(esc('Hi\n', 'js', { onlyNonAscii: false })).toBe('\\u0048\\u0069\\u000A')
    expect(esc('Hi', 'codepoint', { onlyNonAscii: false })).toBe('U+0048 U+0069')
    expect(esc('A', 'css', { onlyNonAscii: false })).toBe('\\0041')
    expect(esc('A', 'utf8-url', { onlyNonAscii: false })).toBe('%41')
  })

  it('escapes control characters even in non-ASCII-only mode', () => {
    expect(esc('a\u0001b\tc', 'js')).toBe('a\\u0001b\tc')
  })

  it('adds CSS terminators and codepoint separators where needed', () => {
    expect(esc('中a', 'css')).toBe('\\4E2D a')
    expect(esc('中 x', 'css')).toBe('\\4E2D  x')
    expect(esc('中文', 'css')).toBe('\\4E2D\\6587')
    expect(esc('中g', 'css')).toBe('\\4E2Dg')
    expect(esc('中文', 'codepoint')).toBe('U+4E2D U+6587')
    expect(esc('中a', 'codepoint')).toBe('U+4E2D U+0061')
    expect(esc('中x', 'codepoint')).toBe('U+4E2Dx')
    expect(esc('中, 文', 'codepoint')).toBe('U+4E2D U+002C U+0020 U+6587')
  })

  it('escapes the escape character itself so output decodes back exactly', () => {
    expect(esc('C:\\路径', 'js')).toBe('C:\\\\\\u8DEF\\u5F84')
    expect(esc('100% 中', 'utf8-url')).toBe('100%25 %E4%B8%AD')
  })

  it('reports lone surrogates for UTF-8 formats', () => {
    const r = escapeText('a\ud800', { format: 'utf8-hex' })
    expect(r.output).toBe('a\\xEF\\xBF\\xBD')
    expect(r.issues[0]).toMatchObject({ line: 1, column: 2 })
    expect(escapeText('\ud800', { format: 'js' }).output).toBe('\\uD800')
  })

  it('handles empty input', () => {
    for (const f of ESCAPE_FORMATS) expect(esc('', f.id)).toBe('')
  })
})

describe('unescapeText', () => {
  it('decodes each format', () => {
    expect(un('\\u4e2d\\u6587')).toBe('中文')
    expect(un('\\uD83D\\uDE00')).toBe('😀')
    expect(un('\\u{1F600}\\u{4E2D}')).toBe('😀中')
    expect(un('\\U0001F600')).toBe('😀')
    expect(un('\\x{4E2D}')).toBe('中')
    expect(un('&#x4E2D;&#20013;&#x1f600')).toBe('中中😀')
    expect(un('\\xE4\\xB8\\xAD')).toBe('中')
    expect(un('%E4%B8%AD%20ok')).toBe('中 ok')
    expect(un('U+4E2D U+6587, U+1F600')).toBe('中文😀')
    expect(un('\\4E2D\\6587 a')).toBe('中文a')
  })

  it('auto-detects mixed escapes and counts them', () => {
    const r = unescapeText(
      '\\u4e2d\\u{6587}&#x1F600;%E4%B8%AD\\xE6\\x96\\x87U+4E2D\\U0001F600\\4E2D\\n',
    )
    expect(r.output).toBe('中文😀中文中😀中\n')
    expect(r.counts).toEqual({
      js: 1,
      es6: 1,
      'html-hex': 1,
      'utf8-url': 3,
      'utf8-hex': 3,
      codepoint: 1,
      python: 1,
      css: 1,
      simple: 1,
    })
    expect(r.issues).toEqual([])
  })

  it('handles simple escapes and escaped backslashes', () => {
    expect(un('a\\nb\\t\\"c\\"')).toBe('a\nb\t"c"')
    expect(un('\\\\u4e2d')).toBe('\\u4e2d')
    expect(un('a\\nb', { simple: false })).toBe('a\\nb')
    expect(un('\\q')).toBe('\\q')
    expect(un('\\face', { css: false })).toBe('\face')
    expect(un('\\face')).toBe('\uface')
  })

  it('reports lone surrogates, invalid bytes and out-of-range code points', () => {
    const lone = unescapeText('x\\uD83D!')
    expect(lone.output).toBe('x\ufffd!')
    expect(lone.issues[0]).toMatchObject({ column: 2, text: '\\uD83D' })

    const latin1 = unescapeText('caf\\xE9')
    expect(latin1.output).toBe('café')
    expect(latin1.issues[0].message).toContain('Latin-1')

    const pct = unescapeText('bad %E4%B8 here')
    expect(pct.output).toBe('bad %E4%B8 here')
    expect(pct.issues[0]).toMatchObject({ column: 5, text: '%E4%B8' })

    const big = unescapeText('\\u{110000}')
    expect(big.output).toBe('\\u{110000}')
    expect(big.issues[0].message).toContain('超出 Unicode 范围')

    expect(un('&#0;')).toBe('\ufffd')
  })

  it('leaves plain text and non-escapes alone', () => {
    const s = '普通文本 100% OK U+12 \\u12 & #1 &#; \\x4'
    expect(un(s)).toBe(s)
    expect(unescapeText('').output).toBe('')
  })

  const TRICKY = [
    'Hello, 世界!',
    '😀 👨\u200d👩\u200d👧 🇨🇳 e\u0301',
    'C:\\Users\\张三\\文档',
    '100% 完成 %zz',
    'tab\tnew\nline',
    '中a中F中 中\t',
    'ABC def 123 中文',
  ]

  it.each(ESCAPE_FORMATS.map((f) => f.id))('round-trips (%s)', (format) => {
    for (const s of TRICKY) {
      for (const onlyNonAscii of [true, false]) {
        for (const upper of [true, false]) {
          const encoded = escapeText(s, { format, onlyNonAscii, upper }).output
          expect(un(encoded), `${format} ${onlyNonAscii} ${upper}: ${encoded}`).toBe(s)
        }
      }
    }
  })

  it('handles large input', () => {
    const s = '中文 test 😀\n'.repeat(20000)
    const enc = escapeText(s, { format: 'js' }).output
    const t = performance.now()
    expect(un(enc)).toBe(s)
    expect(performance.now() - t).toBeLessThan(3000)
  })
})

describe('character inspector', () => {
  it('computes code points, UTF-8 and UTF-16', () => {
    expect(utf8BytesOf(0x4e2d)).toEqual([0xe4, 0xb8, 0xad])
    expect(utf8BytesOf(0x1f600)).toEqual([0xf0, 0x9f, 0x98, 0x80])
    expect(utf16UnitsOf(0x1f600)).toEqual([0xd83d, 0xde00])
    const { rows, total } = inspectChars('a中😀')
    expect(total).toBe(3)
    expect(rows.map((r) => [r.hex, r.category])).toEqual([
      ['U+0061', 'ascii-letter'],
      ['U+4E2D', 'han'],
      ['U+1F600', 'emoji'],
    ])
    expect(rows[2]).toMatchObject({
      utf8: [0xf0, 0x9f, 0x98, 0x80],
      utf16: [0xd83d, 0xde00],
      index: 2,
    })
  })

  it('groups grapheme clusters and names invisible characters', () => {
    const { rows } = inspectChars('👨\u200d👩\u200d👧x')
    expect(rows.map((r) => r.grapheme)).toEqual([0, 0, 0, 0, 0, 1])
    expect(rows[1]).toMatchObject({ category: 'format', name: '零宽连字 ZWJ' })
    const nl = inspectChars('\n \u3000')
    expect(nl.rows.map((r) => r.display)).toEqual(['\u240A', '\u2423', '\u2423'])
    expect(nl.rows[2].name).toBe('全角空格')
  })

  it('limits rows but counts everything', () => {
    const { rows, total } = inspectChars('中'.repeat(1000), 100)
    expect(rows).toHaveLength(100)
    expect(total).toBe(1000)
  })

  it.each([
    [0x41, 'ascii-letter'],
    [0x35, 'ascii-digit'],
    [0x2c, 'ascii-symbol'],
    [0x00, 'control'],
    [0x0a, 'space'],
    [0x3000, 'space'],
    [0x3042, 'kana'],
    [0x30ab, 'kana'],
    [0xd55c, 'hangul'],
    [0xe9, 'latin'],
    [0x3b1, 'greek'],
    [0x416, 'cyrillic'],
    [0x5d0, 'letter'],
    [0x663, 'digit'],
    [0x3002, 'punct'],
    [0xff0c, 'punct'],
    [0x20ac, 'symbol'],
    [0xa9, 'symbol'],
    [0x2764, 'emoji'],
    [0x1f1e8, 'emoji'],
    [0x1f3fb, 'emoji'],
    [0x301, 'mark'],
    [0xfe0f, 'variation'],
    [0x200b, 'format'],
    [0xe000, 'private'],
    [0xd800, 'surrogate'],
    [0x378, 'unassigned'],
  ])('charCategory(U+%s)', (cp, cat) => {
    expect(charCategory(cp)).toBe(cat)
  })

  it('computes text stats', () => {
    expect(textStats('a中😀👨\u200d👩\u200d👧')).toEqual({
      codePoints: 8,
      utf16: 12,
      utf8: 1 + 3 + 4 + 18,
      graphemes: 4,
    })
    expect(textStats('')).toEqual({ codePoints: 0, utf16: 0, utf8: 0, graphemes: 0 })
  })
})

describe('regressions', () => {
  it('round-trips text that already contains escape-like sequences, in every format', () => {
    const tricky = [
      '100%41 and %E4%B8%AD 中',
      '&#65; &#x4E2D; &amp; 中',
      'U+0041 u+4e2d U+ 中',
      'C:\\new\\table \\u4E2D \\x41 \\5FEB 中',
      'mixed %41&#66;U+0043\\x44 😀 end',
    ]
    for (const f of ESCAPE_FORMATS) {
      for (const text of tricky) {
        const encoded = esc(text, f.id)
        expect(un(encoded), `${f.id}: ${encoded}`).toBe(text)
      }
    }
  })

  it('only escapes the ASCII characters that would otherwise be misread', () => {
    expect(esc('50% off & more, U+ sign', 'html-hex')).toBe('50% off & more, U+ sign')
    expect(esc('%41', 'js')).toBe('\\u002541')
    expect(esc('&#65;', 'html-dec')).toBe('&#38;#65;')
    expect(esc('U+0041', 'codepoint')).toBe('U+0055+0041')
    expect(esc('a\\nb', 'html-hex')).toBe('a&#x5C;nb')
    expect(esc('a\\qb', 'html-hex')).toBe('a\\qb')
  })

  it('ignores leading zeros in numeric references and code point escapes', () => {
    expect(un('&#0000000065;&#x0000001F600;')).toBe('A😀')
    expect(un('\\u{0000000041}\\x{00000000042}')).toBe('AB')
    const r = unescapeText('&#x00000000110000;')
    expect(r.output).toBe('&#x00000000110000;')
    expect(r.issues[0].message).toContain('&#x00000000110000;')
  })

  it('does not overflow the stack on very long non-UTF-8 byte runs', () => {
    const r = unescapeText('\\xFF'.repeat(200_000))
    expect(r.output).toBe('\u00FF'.repeat(200_000))
    expect(r.issues).toHaveLength(1)
  })

  it('reports exact positions for many issues on one long line', () => {
    const r = unescapeText('😀\\uD800'.repeat(300))
    expect(r.issues).toHaveLength(200)
    expect(r.issues[0]).toMatchObject({ line: 1, column: 2 })
    expect(r.issues[1]).toMatchObject({ line: 1, column: 9 })
    const t = performance.now()
    unescapeText('x\\uD800'.repeat(200_000))
    expect(performance.now() - t).toBeLessThan(1500)
  })
})
