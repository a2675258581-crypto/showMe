import { describe, expect, it } from 'vitest'
import {
  LEGACY_ENTITIES,
  NAMED_ENTITIES,
  decodeEntities,
  encodeEntities,
  entityNameOf,
  looksEncoded,
  type EntityEncodeMode,
} from './html-entities'
import { ENTITY_CATEGORIES, ENTITY_REFERENCE, searchEntities } from './html-entities-reference'

const dec = (s: string) => decodeEntities(s).output

describe('entity table', () => {
  it('contains the complete WHATWG list', () => {
    expect(NAMED_ENTITIES.size).toBe(2125)
    expect(LEGACY_ENTITIES.size).toBe(106)
    for (const n of LEGACY_ENTITIES) expect(NAMED_ENTITIES.has(n)).toBe(true)
  })

  it.each([
    ['amp', '&'],
    ['nbsp', '\u00a0'],
    ['copy', '©'],
    ['hellip', '…'],
    ['mdash', '—'],
    ['rarr', '→'],
    ['check', '✓'],
    ['euro', '€'],
    ['lang', '⟨'],
    ['Afr', '𝔄'],
    ['NotEqualTilde', '≂̸'],
    ['ThickSpace', '\u205f\u200a'],
    ['fjlig', 'fj'],
  ])('&%s;', (name, value) => {
    expect(NAMED_ENTITIES.get(name)).toBe(value)
  })

  it('prefers HTML 4 / short lowercase names for encoding', () => {
    expect(entityNameOf('→')).toBe('rarr')
    expect(entityNameOf('∈')).toBe('isin')
    expect(entityNameOf('©')).toBe('copy')
    expect(entityNameOf('\u00a0')).toBe('nbsp')
    expect(entityNameOf('&')).toBe('amp')
    expect(entityNameOf('✓')).toBe('check')
    expect(entityNameOf('中')).toBeNull()
    expect(entityNameOf('')).toBeNull()
  })
})

describe('encodeEntities', () => {
  const src = `<a href="x">'Tom & Jerry'</a>`

  it('escapes only special characters', () => {
    expect(encodeEntities(src, { mode: 'special' })).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;Tom &amp; Jerry&#39;&lt;/a&gt;',
    )
    expect(encodeEntities(src, { mode: 'special', quotes: false })).toBe(
      `&lt;a href="x"&gt;'Tom &amp; Jerry'&lt;/a&gt;`,
    )
    expect(encodeEntities('中文 © 😀', { mode: 'special' })).toBe('中文 © 😀')
  })

  it('uses named entities where available, numeric otherwise', () => {
    expect(encodeEntities('© 2024 — 中文 😀 →', { mode: 'named' })).toBe(
      '&copy; 2024 &mdash; &#20013;&#25991; &#128512; &rarr;',
    )
    expect(encodeEntities('中', { mode: 'named', fallback: 'hex' })).toBe('&#x4E2D;')
  })

  it('encodes code points (not UTF-16 units) in decimal and hex', () => {
    expect(encodeEntities('中😀<', { mode: 'decimal' })).toBe('&#20013;&#128512;&lt;')
    expect(encodeEntities('中😀<', { mode: 'hex' })).toBe('&#x4E2D;&#x1F600;&lt;')
  })

  it('keeps newlines and handles empty input', () => {
    expect(encodeEntities('a\n\tb', { mode: 'hex' })).toBe('a\n\tb')
    expect(encodeEntities('', { mode: 'named' })).toBe('')
  })

  it.each(['special', 'named', 'decimal', 'hex'] as EntityEncodeMode[])(
    'round-trips through decode (%s)',
    (mode) => {
      const s = `<p class="x">Tom & Jerry's 中文 😀 👨\u200d👩\u200d👧 ©®™ — “quotes” ≠ ∞ ⟨x⟩ fj\u00a0end</p>\n&amp; literal`
      expect(dec(encodeEntities(s, { mode }))).toBe(s)
    },
  )
})

describe('decodeEntities', () => {
  it('decodes named, decimal and hex references', () => {
    const r = decodeEntities('&lt;b&gt; &copy; &#20013;&#x6587; &#X1F600; &hellip;')
    expect(r.output).toBe('<b> © 中文 😀 …')
    expect(r.counts).toEqual({ named: 4, numeric: 3 })
    expect(r.issues).toEqual([])
  })

  it('tolerates missing semicolons for legacy entities', () => {
    const r = decodeEntities('&copy2024 &amp &lt;')
    expect(r.output).toBe('©2024 & <')
    expect(r.issues.map((i) => [i.level, i.column])).toEqual([
      ['info', 1],
      ['info', 11],
    ])
    expect(r.issues[0].message).toContain('缺少结尾分号')
  })

  it('uses the longest match like browsers do', () => {
    expect(dec('&notin; &notit; &not')).toBe('∉ ¬it; ¬')
    expect(dec('&ampersand')).toBe('&ersand')
  })

  it('does not decode non-legacy names without a semicolon', () => {
    expect(dec('&hellip and &rarr')).toBe('&hellip and &rarr')
  })

  it('handles numeric edge cases per the HTML standard', () => {
    expect(dec('&#128;&#x99;')).toBe('€™')
    expect(dec('&#0;')).toBe('�')
    expect(dec('&#x110000;')).toBe('�')
    expect(dec('&#xD800;')).toBe('�')
    expect(dec('&#99999999999;')).toBe('�')
    expect(dec('&#65&#x42')).toBe('AB')
    const r = decodeEntities('&#0; &#128;')
    expect(r.issues.map((i) => i.level)).toEqual(['warning', 'info'])
  })

  it('leaves unknown or incomplete references and reports them', () => {
    const r = decodeEntities('AT&T &foo; &#x; &#; & &Amp;\n&bogus;')
    expect(r.output).toBe('AT&T &foo; &#x; &#; & &Amp;\n&bogus;')
    const warnings = r.issues.filter((i) => i.level === 'warning')
    expect(warnings.map((i) => i.text)).toEqual(['&foo;', '&#x', '&#', '&Amp;', '&bogus;'])
    expect(warnings[3].message).toContain('&amp;')
    expect(warnings[4]).toMatchObject({ line: 2, column: 1 })
  })

  it('flags double-encoded text', () => {
    const r = decodeEntities('&amp;lt;div&amp;gt;')
    expect(r.output).toBe('&lt;div&gt;')
    expect(r.stillEncoded).toBe(true)
    expect(decodeEntities('&amp;foo;').stillEncoded).toBe(false)
    expect(decodeEntities('plain').stillEncoded).toBe(false)
    expect(looksEncoded('&#x41;')).toBe(true)
  })

  it('handles empty and large input', () => {
    expect(decodeEntities('')).toMatchObject({ output: '', issues: [] })
    const big = '&lt;p&gt;中文 &copy; &#x1F600;&lt;/p&gt;\n'.repeat(20000)
    const t = performance.now()
    const r = decodeEntities(big)
    expect(r.output).toBe('<p>中文 © 😀</p>\n'.repeat(20000))
    expect(performance.now() - t).toBeLessThan(2000)
  })
})

describe('reference grid', () => {
  it('resolves every listed entity', () => {
    for (const e of ENTITY_REFERENCE) {
      expect(e.char, e.name).not.toBe('')
      expect(ENTITY_CATEGORIES.some((c) => c.id === e.category)).toBe(true)
    }
  })

  it('searches by name, char, description and code point', () => {
    expect(searchEntities('rarr').map((e) => e.name)).toContain('rarr')
    expect(searchEntities('&copy;').map((e) => e.name)).toContain('copy')
    expect(searchEntities('→').map((e) => e.name)).toEqual(['rarr'])
    expect(searchEntities('箭头').length).toBeGreaterThan(5)
    expect(searchEntities('U+2192').map((e) => e.name)).toEqual(['rarr'])
    expect(searchEntities('8594').map((e) => e.name)).toEqual(['rarr'])
    expect(searchEntities('', 'greek').every((e) => e.category === 'greek')).toBe(true)
    const all = searchEntities('')
    expect(new Set(all.map((e) => e.name)).size).toBe(all.length)
  })
})

describe('regressions', () => {
  it('ignores leading zeros in numeric references like browsers', () => {
    expect(dec('&#x000000041;&#0000000065;&#x0000001F600;')).toBe('AA😀')
    expect(dec('&#00000000000;')).toBe('�')
    expect(dec('&#x0000000110000;')).toBe('�')
    expect(decodeEntities('&#x000000041;').issues).toEqual([])
  })

  it('reports exact positions for many issues on one long line', () => {
    const text = '😀&copy'.repeat(300)
    const r = decodeEntities(text)
    expect(r.output).toBe('😀©'.repeat(300))
    expect(r.issues).toHaveLength(200)
    expect(r.issues[0]).toMatchObject({ line: 1, column: 2, text: '&copy' })
    expect(r.issues[1]).toMatchObject({ line: 1, column: 8 })
    const big = 'x&copy'.repeat(300_000)
    const t = performance.now()
    decodeEntities(big)
    expect(performance.now() - t).toBeLessThan(1500)
  })
})
