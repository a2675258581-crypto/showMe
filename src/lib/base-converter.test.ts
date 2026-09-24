import { describe, expect, it } from 'vitest'
import {
  allowedDigits,
  autoWidth,
  bitLength,
  byteLength,
  formatInBase,
  getBit,
  groupDigits,
  isPowerOfTwo,
  minSignedBits,
  parseInBase,
  popcount,
  toggleBit,
  twosComplement,
} from './base-converter'

function value(raw: string, base: number): bigint {
  const r = parseInBase(raw, base)
  if (!r || !r.ok) throw new Error(r ? r.error : 'empty')
  return r.value
}

function error(raw: string, base: number) {
  const r = parseInBase(raw, base)
  if (!r || r.ok) throw new Error('expected error')
  return r
}

describe('parseInBase', () => {
  it.each([
    ['255', 10, 255n],
    ['ff', 16, 255n],
    ['FF', 16, 255n],
    ['377', 8, 255n],
    ['11111111', 2, 255n],
    ['73', 36, 255n],
    ['zz', 36, 1295n],
    ['0', 2, 0n],
    ['-42', 10, -42n],
    ['+42', 10, 42n],
    ['−7', 10, -7n],
  ] as const)('%s in base %i', (raw, base, expected) => {
    expect(value(raw, base)).toBe(expected)
  })

  it('accepts matching prefixes', () => {
    expect(value('0xFF', 16)).toBe(255n)
    expect(value('0b1010', 2)).toBe(10n)
    expect(value('0o17', 8)).toBe(15n)
    expect(value('-0x10', 16)).toBe(-16n)
  })

  it('decimal field honours any prefix and reports the used base', () => {
    const r = parseInBase('0x1f', 10)
    expect(r).toEqual({ ok: true, value: 31n, base: 16 })
    expect(value('0b11', 10)).toBe(3n)
    expect(value('0O10', 10)).toBe(8n)
  })

  it('does not strip a prefix that is really a digit', () => {
    // 十六进制里 0b1 是合法数字 0xB1
    expect(value('0b1', 16)).toBe(0xb1n)
    // 36 进制里 x 是数字
    expect(value('0x', 36)).toBe(33n)
  })

  it('ignores separators', () => {
    expect(value('1111_0000 1010', 2)).toBe(0b111100001010n)
    expect(value('1,000,000', 10)).toBe(1_000_000n)
    expect(value("0xdead'beef", 16)).toBe(0xdeadbeefn)
    expect(value('  12 34  ', 10)).toBe(1234n)
  })

  it('returns null for blank input', () => {
    expect(parseInBase('', 10)).toBeNull()
    expect(parseInBase('   ', 2)).toBeNull()
  })

  it('highlights invalid digits with precise messages', () => {
    const e = error('1021', 2)
    expect(e.invalid).toEqual([2])
    expect(e.error).toBe('第 3 个字符「2」不是有效的二进制数字（只能是 0 和 1）')
    const e2 = error('12g4h', 16)
    expect(e2.invalid).toEqual([2, 4])
    expect(e2.error).toContain('「g」不是有效的十六进制数字（只能是 0–9、A–F）')
    expect(e2.error).toContain('共 2 处')
    expect(error('789', 8).invalid).toEqual([1, 2])
    expect(error('0x1f', 2).error).toContain('十六进制请填到十六进制栏')
    expect(error('中文', 10).invalid).toEqual([0, 1])
    expect(error('12-3', 10).error).toContain('正负号只能写在最前面')
    expect(error('0x', 16).error).toBe('前缀后面缺少数字')
    expect(error('-', 10).error).toBe('请输入数字')
  })

  it('handles emoji without crashing', () => {
    const e = error('1😀', 10)
    expect(e.invalid.length).toBeGreaterThan(0)
  })

  it('reports an emoji as one whole character (regression: lone surrogate in message)', () => {
    const e = error('1😀2😀', 10)
    expect(e.error).toBe('第 2 个字符「😀」不是有效的十进制数字（只能是 0–9），共 2 处无效字符')
    // 高亮位置是 UTF-16 下标
    expect(e.invalid).toEqual([1, 4])
    expect(error('😀x', 16).error).toContain('第 1 个字符「😀」')
    expect(error('中文', 10).error).toBe(
      '第 1 个字符「中」不是有效的十进制数字（只能是 0–9），共 2 处无效字符',
    )
  })

  it('accepts full-width digits, letters and signs from a Chinese IME', () => {
    expect(value('１２３', 10)).toBe(123n)
    expect(value('－４２', 10)).toBe(-42n)
    expect(value('ＦＦ', 16)).toBe(255n)
    expect(value('０ｘ１Ｆ', 10)).toBe(31n)
    expect(value('1\u30002', 10)).toBe(12n)
    // 报错时显示用户输入的原字符
    expect(error('１Ｇ', 16).error).toContain('第 2 个字符「Ｇ」')
  })

  it('rejects invalid bases and overly long input', () => {
    expect(error('1', 37).error).toContain('2–36')
    expect(error('1'.repeat(100_001), 10).error).toContain('输入过长')
  })

  it('parses very large numbers in every base', () => {
    const big = 2n ** 4000n - 12345n
    for (const b of [2, 3, 7, 8, 10, 16, 20, 36]) {
      expect(value(big.toString(b), b)).toBe(big)
    }
  })
})

describe('formatInBase / groupDigits', () => {
  it('formats with case and grouping', () => {
    expect(formatInBase(255n, 16)).toBe('ff')
    expect(formatInBase(255n, 16, { uppercase: true })).toBe('FF')
    expect(formatInBase(-255n, 2, { group: true })).toBe('-1111 1111')
    expect(formatInBase(1234567n, 10, { group: true })).toBe('1 234 567')
    expect(formatInBase(1234567n, 10, { group: true, separator: ',' })).toBe('1,234,567')
    expect(formatInBase(0o7654321n, 8, { group: true })).toBe('7 654 321')
    expect(formatInBase(0n, 2, { group: true })).toBe('0')
  })

  it('groups from the right', () => {
    expect(groupDigits('10101', 4)).toBe('1 0101')
    expect(groupDigits('1010', 4)).toBe('1010')
    expect(groupDigits('', 4)).toBe('')
  })

  it('round-trips with parse', () => {
    const v = -98765432109876543210n
    for (const b of [2, 8, 10, 16, 36]) {
      expect(value(formatInBase(v, b, { group: true, uppercase: true }), b)).toBe(v)
    }
  })
})

describe('bit helpers', () => {
  it('bitLength / popcount / bytes / power of two', () => {
    expect(bitLength(0n)).toBe(0)
    expect(bitLength(255n)).toBe(8)
    expect(bitLength(256n)).toBe(9)
    expect(bitLength(-255n)).toBe(8)
    expect(popcount(255n)).toBe(8)
    expect(popcount(0b1010n)).toBe(2)
    expect(byteLength(0n)).toBe(1)
    expect(byteLength(256n)).toBe(2)
    expect(isPowerOfTwo(1024n)).toBe(true)
    expect(isPowerOfTwo(0n)).toBe(false)
    expect(isPowerOfTwo(1023n)).toBe(false)
  })

  it('minSignedBits', () => {
    expect(minSignedBits(0n)).toBe(1)
    expect(minSignedBits(127n)).toBe(8)
    expect(minSignedBits(128n)).toBe(9)
    expect(minSignedBits(-128n)).toBe(8)
    expect(minSignedBits(-129n)).toBe(9)
    expect(minSignedBits(-1n)).toBe(1)
  })

  it('allowedDigits', () => {
    expect(allowedDigits(2)).toBe('0 和 1')
    expect(allowedDigits(8)).toBe('0–7')
    expect(allowedDigits(16)).toBe('0–9、A–F')
    expect(allowedDigits(36)).toBe('0–9、A–Z')
  })
})

describe("two's complement", () => {
  it('represents negatives', () => {
    const i8 = twosComplement(-1n, 8)
    expect(i8.binary).toBe('11111111')
    expect(i8.hex).toBe('FF')
    expect(i8.fitsSigned).toBe(true)
    expect(i8.fitsUnsigned).toBe(false)
    expect(i8.overflow).toBe(false)
    expect(i8.unsigned).toBe(255n)
    expect(twosComplement(-128n, 8).binary).toBe('10000000')
    expect(twosComplement(-2n, 32).hex).toBe('FFFFFFFE')
    expect(twosComplement(-1n, 64).hex).toBe('FFFFFFFFFFFFFFFF')
  })

  it('distinguishes signed-only / unsigned-only / overflow', () => {
    const u = twosComplement(200n, 8)
    expect(u.fitsSigned).toBe(false)
    expect(u.fitsUnsigned).toBe(true)
    expect(u.signed).toBe(-56n)
    const o = twosComplement(256n, 8)
    expect(o.overflow).toBe(true)
    expect(o.pattern).toBe(0n)
    expect(twosComplement(-129n, 8).overflow).toBe(true)
    expect(twosComplement(2n ** 63n, 64).fitsUnsigned).toBe(true)
    expect(twosComplement(2n ** 64n, 64).overflow).toBe(true)
  })

  it('autoWidth picks the smallest width that fits', () => {
    expect(autoWidth(0n)).toBe(8)
    expect(autoWidth(255n)).toBe(8)
    expect(autoWidth(-129n)).toBe(16)
    expect(autoWidth(70000n)).toBe(32)
    expect(autoWidth(2n ** 40n)).toBe(64)
    expect(autoWidth(2n ** 70n)).toBe(64)
  })

  it('toggles bits', () => {
    expect(toggleBit(0n, 0, 8, false)).toBe(1n)
    expect(toggleBit(5n, 2, 8, false)).toBe(1n)
    // 有符号：翻转最高位变成负数
    expect(toggleBit(1n, 7, 8, true)).toBe(-127n)
    expect(toggleBit(-1n, 7, 8, true)).toBe(127n)
    // 无符号：负数先取位模式
    expect(toggleBit(-1n, 0, 8, false)).toBe(254n)
    // 保留宽度以上的高位
    expect(toggleBit(2n ** 70n, 0, 64, false)).toBe(2n ** 70n + 1n)
    expect(getBit(-1n, 63, 64)).toBe(true)
    expect(getBit(4n, 2, 8)).toBe(true)
    expect(getBit(4n, 1, 8)).toBe(false)
  })
})
