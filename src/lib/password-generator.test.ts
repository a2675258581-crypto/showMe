import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  DEFAULT_SYMBOLS,
  LOOK_ALIKES,
  PasswordError,
  buildPool,
  classifyChar,
  createRng,
  formatCrackTime,
  generatePassphrase,
  generatePassword,
  graphemes,
  log2BigInt,
  passphraseEntropy,
  passwordEntropy,
  shuffle,
  strengthOf,
  type PasswordOptions,
  type RandomSource,
} from './password-generator'
import { PASSPHRASE_WORDS } from './password-generator-words'

/** 依次吐出给定数值的随机源（用完从头循环） */
function seq(values: number[]): RandomSource {
  let i = 0
  return (buf) => {
    for (let k = 0; k < buf.length; k++) buf[k] = values[i++ % values.length]
    return buf
  }
}

/** 线性同余，确定性但分布足够均匀，用于可复现的测试 */
function lcg(seed = 42): RandomSource {
  let s = seed >>> 0
  return (buf) => {
    for (let k = 0; k < buf.length; k++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      buf[k] = s
    }
    return buf
  }
}

const opts = (p: Partial<PasswordOptions> = {}): PasswordOptions => ({
  ...DEFAULT_PASSWORD_OPTIONS,
  ...p,
})

describe('createRng', () => {
  it('rejects values in the biased tail (rejection sampling)', () => {
    // n = 3：limit = 2^32 - (2^32 mod 3) = 4294967295，最大值 0xFFFFFFFF 必须被丢弃
    const rng = createRng(seq([0xffffffff, 0xffffffff, 5]))
    expect(rng.int(3)).toBe(2)
    // n = 2^31 + 1：limit = 2^31 + 1，恰好等于 limit 的值被丢弃，下一个值 7 被接受
    const rng2 = createRng(seq([2 ** 31 + 1, 7]))
    expect(rng2.int(2 ** 31 + 1)).toBe(7)
  })

  it('accepts the full 32-bit range for n = 2^32 and returns 0 for n = 1', () => {
    expect(createRng(seq([0xffffffff])).int(2 ** 32)).toBe(0xffffffff)
    expect(createRng(seq([123])).int(1)).toBe(0)
  })

  it('validates the range', () => {
    const rng = createRng()
    expect(() => rng.int(0)).toThrow(RangeError)
    expect(() => rng.int(1.5)).toThrow(RangeError)
    expect(() => rng.int(2 ** 32 + 1)).toThrow(RangeError)
  })

  it('produces a sane uniform distribution with crypto.getRandomValues', () => {
    const rng = createRng()
    const n = 7
    const draws = 70_000
    const counts = new Array(n).fill(0)
    for (let i = 0; i < draws; i++) counts[rng.int(n)]++
    const expected = draws / n
    // 卡方检验：自由度 6，p=0.0001 的临界值约 27.9
    const chi2 = counts.reduce((a, c) => a + (c - expected) ** 2 / expected, 0)
    expect(chi2).toBeLessThan(27.9)
    for (const c of counts) expect(Math.abs(c - expected) / expected).toBeLessThan(0.05)
  })

  it('shuffles as a permutation', () => {
    const arr = Array.from({ length: 50 }, (_, i) => i)
    const out = shuffle([...arr], createRng(lcg(1)))
    expect([...out].sort((a, b) => a - b)).toEqual(arr)
    expect(out).not.toEqual(arr)
  })
})

describe('classifyChar / graphemes', () => {
  it('classifies ASCII letters, digits and everything else', () => {
    expect(classifyChar('A')).toBe('upper')
    expect(classifyChar('z')).toBe('lower')
    expect(classifyChar('7')).toBe('digit')
    expect(classifyChar('#')).toBe('symbol')
    expect(classifyChar('中')).toBe('symbol')
    expect(classifyChar('😀')).toBe('symbol')
  })

  it('keeps emoji sequences together', () => {
    expect(graphemes('a👍🏽b👨‍👩‍👧')).toEqual(['a', '👍🏽', 'b', '👨‍👩‍👧'])
    expect(graphemes('')).toEqual([])
  })
})

describe('buildPool', () => {
  it('builds disjoint classes from the defaults', () => {
    const pool = buildPool(opts())
    expect(pool.classes.map((c) => c.id)).toEqual(['upper', 'lower', 'digit', 'symbol'])
    expect(pool.all.length).toBe(26 + 26 + 10 + Array.from(DEFAULT_SYMBOLS).length)
    expect(new Set(pool.all).size).toBe(pool.all.length)
  })

  it('excludes look-alike characters', () => {
    const pool = buildPool(opts({ excludeLookAlikes: true }))
    for (const c of LOOK_ALIKES) expect(pool.all).not.toContain(c)
    expect(pool.classes.find((c) => c.id === 'upper')!.chars.length).toBe(24)
    expect(pool.classes.find((c) => c.id === 'lower')!.chars.length).toBe(24)
    expect(pool.classes.find((c) => c.id === 'digit')!.chars.length).toBe(8)
  })

  it('deduplicates custom symbols, skips whitespace and reports letters/digits', () => {
    const pool = buildPool(opts({ symbolSet: '!! @ a1 ¥€😀👍🏽' }))
    const sym = pool.classes.find((c) => c.id === 'symbol')!
    expect(sym.chars).toEqual(['!', '@', '¥', '€', '😀', '👍🏽'])
    expect(pool.ignoredSymbols).toEqual(['a', '1'])
  })

  it('reports enabled classes that end up empty', () => {
    const pool = buildPool(opts({ symbolSet: '   ', upper: false }))
    expect(pool.emptyClasses).toEqual(['symbol'])
    expect(pool.classes.map((c) => c.id)).toEqual(['lower', 'digit'])
  })
})

describe('generatePassword', () => {
  it('clamps the length to 4–128', () => {
    const rng = createRng(lcg())
    expect(graphemes(generatePassword(opts({ length: 1 }), rng))).toHaveLength(4)
    expect(graphemes(generatePassword(opts({ length: 999 }), rng))).toHaveLength(128)
    expect(graphemes(generatePassword(opts({ length: 33 }), rng))).toHaveLength(33)
  })

  it('only uses the selected classes', () => {
    const rng = createRng(lcg(7))
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword(
        opts({ upper: false, symbols: false, lower: false, length: 16 }),
        rng,
      )
      expect(pw).toMatch(/^\d{16}$/)
    }
  })

  it('contains every selected class when requireEach is on, even at length 4', () => {
    const rng = createRng()
    for (let i = 0; i < 300; i++) {
      const pw = generatePassword(opts({ length: 4 }), rng)
      const kinds = new Set(Array.from(pw).map(classifyChar))
      expect(kinds.size).toBe(4)
    }
  })

  it('satisfies requireEach with a single custom symbol', () => {
    const rng = createRng()
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword(opts({ length: 4, symbolSet: '_' }), rng)
      expect(pw).toContain('_')
    }
  })

  it('never outputs look-alikes when excluded', () => {
    const rng = createRng()
    const pw = Array.from({ length: 40 }, () =>
      generatePassword(opts({ length: 64, excludeLookAlikes: true }), rng),
    ).join('')
    for (const c of LOOK_ALIKES) expect(pw).not.toContain(c)
  })

  it('supports unicode / emoji symbols as whole characters', () => {
    const rng = createRng()
    const pw = generatePassword(
      opts({ upper: false, lower: false, digits: false, symbolSet: '中文😀👍🏽', length: 12 }),
      rng,
    )
    const chars = graphemes(pw)
    expect(chars).toHaveLength(12)
    for (const c of chars) expect(['中', '文', '😀', '👍🏽']).toContain(c)
  })

  it('throws a Chinese error when nothing is selected', () => {
    const none = opts({ upper: false, lower: false, digits: false, symbols: false })
    expect(() => generatePassword(none)).toThrow(PasswordError)
    expect(() => generatePassword(none)).toThrow('请至少选择一种字符类型')
  })

  it('has roughly uniform character frequencies', () => {
    const rng = createRng()
    const o = opts({ upper: false, symbols: false, digits: true, lower: false, length: 128 })
    const counts = new Map<string, number>()
    for (let i = 0; i < 400; i++) {
      for (const c of generatePassword(o, rng)) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    const expected = (400 * 128) / 10
    expect(counts.size).toBe(10)
    for (const v of counts.values()) expect(Math.abs(v - expected) / expected).toBeLessThan(0.06)
  })
})

describe('entropy', () => {
  it('log2BigInt handles huge values', () => {
    expect(log2BigInt(2n ** 200n)).toBeCloseTo(200, 10)
    expect(log2BigInt(3n)).toBeCloseTo(Math.log2(3), 12)
    expect(log2BigInt(3n ** 500n)).toBeCloseTo(500 * Math.log2(3), 8)
    expect(log2BigInt(0n)).toBe(-Infinity)
  })

  it('is L·log2(N) without the requirement', () => {
    const o = opts({ requireEach: false, length: 20 })
    expect(passwordEntropy(o)).toBeCloseTo(20 * Math.log2(89), 10)
  })

  it('matches brute-force counting with requireEach (inclusion–exclusion)', () => {
    const o = opts({ upper: false, lower: false, symbolSet: '!@', length: 4 })
    const pool = buildPool(o).all
    let valid = 0
    for (const a of pool)
      for (const b of pool)
        for (const c of pool)
          for (const d of pool) {
            const s = a + b + c + d
            if (/\d/.test(s) && /[!@]/.test(s)) valid++
          }
    expect(valid).toBe(12 ** 4 - 10 ** 4 - 2 ** 4)
    expect(passwordEntropy(o)).toBeCloseTo(Math.log2(valid), 10)
  })

  it('stays finite for very large pools', () => {
    const big = Array.from({ length: 2000 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('')
    const bits = passwordEntropy(opts({ symbolSet: big, length: 128 }))
    expect(Number.isFinite(bits)).toBe(true)
    expect(bits).toBeGreaterThan(1300)
  })

  it('is zero for an empty pool', () => {
    expect(
      passwordEntropy(opts({ upper: false, lower: false, digits: false, symbols: false })),
    ).toBe(0)
  })
})

describe('passphrase', () => {
  it('word list has ≥ 500 unique lowercase words', () => {
    expect(PASSPHRASE_WORDS.length).toBeGreaterThanOrEqual(500)
    expect(new Set(PASSPHRASE_WORDS).size).toBe(PASSPHRASE_WORDS.length)
    for (const w of PASSPHRASE_WORDS) expect(w).toMatch(/^[a-z]{3,8}$/)
  })

  it('generates words, separator, capitalisation and number', () => {
    const rng = createRng(lcg(3))
    const p = generatePassphrase(DEFAULT_PASSPHRASE_OPTIONS, rng)
    const parts = p.split('-')
    expect(parts).toHaveLength(6)
    for (const w of parts.slice(0, 5)) {
      expect(w).toMatch(/^[A-Z][a-z]+$/)
      expect(PASSPHRASE_WORDS).toContain(w.toLowerCase())
    }
    expect(Number(parts[5])).toBeGreaterThanOrEqual(0)
    expect(Number(parts[5])).toBeLessThan(100)
  })

  it('respects lower case, custom separator and no number', () => {
    const p = generatePassphrase(
      { words: 3, separator: ' · ', capitalize: false, appendNumber: false },
      createRng(lcg(9)),
    )
    const parts = p.split(' · ')
    expect(parts).toHaveLength(3)
    for (const w of parts) expect(w).toMatch(/^[a-z]+$/)
  })

  it('clamps the word count and computes entropy', () => {
    const p = generatePassphrase({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 99, appendNumber: false })
    expect(p.split('-')).toHaveLength(12)
    expect(passphraseEntropy({ ...DEFAULT_PASSPHRASE_OPTIONS, appendNumber: false })).toBeCloseTo(
      5 * Math.log2(PASSPHRASE_WORDS.length),
      10,
    )
    expect(passphraseEntropy(DEFAULT_PASSPHRASE_OPTIONS)).toBeCloseTo(50 + Math.log2(100), 10)
  })

  it('rejects an empty word list', () => {
    expect(() => generatePassphrase(DEFAULT_PASSPHRASE_OPTIONS, createRng(), [])).toThrow(
      PasswordError,
    )
  })
})

describe('strength and crack time', () => {
  it('labels strength by entropy', () => {
    expect(strengthOf(30).label).toBe('弱')
    expect(strengthOf(50).label).toBe('一般')
    expect(strengthOf(71.9).level).toBe(1)
    expect(strengthOf(72).label).toBe('强')
    expect(strengthOf(100).label).toBe('极强')
    expect(strengthOf(0).ratio).toBeGreaterThan(0)
    expect(strengthOf(500).ratio).toBe(1)
  })

  const bitsFor = (seconds: number) => 1 + Math.log2(seconds)
  const YEAR = 365.2425 * 86400

  it('formats Chinese time units (rate = 1 guess/s)', () => {
    expect(formatCrackTime(0)).toBe('瞬间')
    expect(formatCrackTime(1)).toBe('不到 1 秒')
    expect(formatCrackTime(bitsFor(42), 1)).toBe('42 秒')
    expect(formatCrackTime(bitsFor(90), 1)).toBe('1.5 分钟')
    expect(formatCrackTime(bitsFor(7200), 1)).toBe('2 小时')
    expect(formatCrackTime(bitsFor(3 * 86400), 1)).toBe('3 天')
    expect(formatCrackTime(bitsFor(200 * 86400), 1)).toBe('200 天')
    expect(formatCrackTime(bitsFor(5 * YEAR), 1)).toBe('5 年')
    expect(formatCrackTime(bitsFor(300 * YEAR), 1)).toBe('3 世纪')
    expect(formatCrackTime(bitsFor(5e6 * YEAR), 1)).toBe('5 万世纪')
    expect(formatCrackTime(bitsFor(3e10 * YEAR), 1)).toBe('3 亿世纪')
  })

  it('uses 1e10 guesses/s by default and never overflows', () => {
    // 2^40 / 2 / 1e10 ≈ 55 秒
    expect(formatCrackTime(41)).toBe('1.8 分钟')
    expect(formatCrackTime(40)).toBe('55 秒')
    const huge = formatCrackTime(5000)
    expect(huge).toMatch(/^\d\.\d×10[⁰¹²³⁴⁵⁶⁷⁸⁹]+ 世纪$/)
    expect(huge).not.toMatch(/NaN|Infinity/)
  })
})
