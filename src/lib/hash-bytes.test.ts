import { describe, expect, it } from 'vitest'
import {
  ByteDecodeError,
  base64ToBytes,
  byteLength,
  bytesEqual,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
  concatBytes,
  decodeInput,
  encodeOutput,
  firstInvalidUtf8,
  hexToBytes,
  latin1Encode,
  randomBytes,
  randomEncoded,
  randomPrintable,
  utf16leEncode,
  utf8Decode,
  utf8Encode,
  type ByteEncoding,
  type TextEncodingId,
} from './hash-bytes'

const u8 = (...n: number[]) => new Uint8Array(n)

function thrown(fn: () => unknown): ByteDecodeError {
  try {
    fn()
  } catch (e) {
    if (e instanceof ByteDecodeError) return e
    throw e
  }
  throw new Error('expected ByteDecodeError')
}

describe('hex', () => {
  it('round-trips', () => {
    expect(bytesToHex(u8(0, 1, 0xab, 0xff))).toBe('0001abff')
    expect(bytesToHex(u8(0xab), true)).toBe('AB')
    expect(hexToBytes('0001ABff')).toEqual(u8(0, 1, 0xab, 0xff))
    expect(hexToBytes('')).toEqual(u8())
  })

  it('accepts separators and 0x prefixes', () => {
    expect(hexToBytes('0x0a0b')).toEqual(u8(10, 11))
    expect(hexToBytes('0a:0b:0c')).toEqual(u8(10, 11, 12))
    expect(hexToBytes('0x0a, 0x0b\n0x0c')).toEqual(u8(10, 11, 12))
    expect(hexToBytes('de ad-be ef')).toEqual(u8(0xde, 0xad, 0xbe, 0xef))
    expect(hexToBytes('00ff')).toEqual(u8(0, 255))
  })

  it('reports bad characters with position', () => {
    const e = thrown(() => hexToBytes('abxz'))
    expect(e.position).toBe(2)
    expect(e.message).toContain('第 3 个字符「x」')
  })

  it('reports odd length', () => {
    expect(thrown(() => hexToBytes('abc')).message).toContain('奇数')
  })
})

describe('base64', () => {
  const cases: [string, string][] = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ]
  it.each(cases)('RFC 4648 vector %j', (plain, b64) => {
    expect(bytesToBase64(utf8Encode(plain))).toBe(b64)
    expect(base64ToBytes(b64)).toEqual(utf8Encode(plain))
    expect(base64ToBytes(b64.replace(/=/g, ''))).toEqual(utf8Encode(plain))
  })

  it('url-safe alphabet', () => {
    const b = u8(0xfb, 0xff, 0xbf)
    expect(bytesToBase64(b)).toBe('+/+/')
    expect(bytesToBase64Url(b)).toBe('-_-_')
    expect(base64ToBytes('-_-_')).toEqual(b)
    expect(base64ToBytes('+/+/')).toEqual(b)
    expect(bytesToBase64Url(u8(1))).toBe('AQ')
  })

  it('ignores whitespace in lenient mode, rejects it in strict url mode', () => {
    expect(base64ToBytes('Zm9v\nYmFy')).toEqual(utf8Encode('foobar'))
    expect(() => base64ToBytes('Zm9v YmFy', { strictUrl: true })).toThrow(ByteDecodeError)
  })

  it('strict url mode rejects + / and =', () => {
    expect(thrown(() => base64ToBytes('ab+c', { strictUrl: true })).message).toContain(
      'Base64URL 应使用',
    )
    expect(thrown(() => base64ToBytes('Zg==', { strictUrl: true })).position).toBe(2)
  })

  it('reports invalid characters, data after padding and truncated input', () => {
    const e = thrown(() => base64ToBytes('Zm9v*', { label: 'Payload' }))
    expect(e.message).toBe('Payload 第 5 个字符「*」不合法')
    expect(e.position).toBe(4)
    expect(thrown(() => base64ToBytes('Zg==Zg')).message).toContain('填充之后')
    expect(thrown(() => base64ToBytes('Zm9vY')).message).toContain('余 1')
    expect(thrown(() => base64ToBytes('中文')).message).toContain('「中」')
  })
})

describe('text encodings', () => {
  it('utf8 encodes Chinese and emoji', () => {
    expect(bytesToHex(utf8Encode('中'))).toBe('e4b8ad')
    expect(bytesToHex(utf8Encode('😀'))).toBe('f09f9880')
    expect(utf8Decode(utf8Encode('中文😀'), true)).toBe('中文😀')
  })

  it('utf8Decode fatal reports the first invalid byte', () => {
    const e = thrown(() => utf8Decode(u8(0x61, 0x62, 0xff, 0x63), true))
    expect(e.position).toBe(2)
    expect(e.message).toContain('0xff')
    expect(utf8Decode(u8(0x61, 0xff))).toBe('a�')
  })

  it('firstInvalidUtf8 detects truncation, overlongs and surrogates', () => {
    expect(firstInvalidUtf8(utf8Encode('ok 中文 😀'))).toBe(-1)
    expect(firstInvalidUtf8(u8(0x61, 0xe4, 0xb8))).toBe(1)
    expect(firstInvalidUtf8(u8(0xc0, 0x80))).toBe(0)
    expect(firstInvalidUtf8(u8(0xe0, 0x80, 0x80))).toBe(0)
    expect(firstInvalidUtf8(u8(0xed, 0xa0, 0x80))).toBe(0)
    expect(firstInvalidUtf8(u8(0xf4, 0x90, 0x80, 0x80))).toBe(0)
  })

  it('utf16le and latin1', () => {
    expect(bytesToHex(utf16leEncode('A中'))).toBe('41002d4e')
    expect(latin1Encode('é')).toEqual(u8(0xe9))
    const e = thrown(() => latin1Encode('ab中'))
    expect(e.position).toBe(2)
    expect(e.message).toContain('Latin-1')
  })

  it('decodeInput / encodeOutput dispatch', () => {
    expect(decodeInput('ab', 'utf8')).toEqual(u8(0x61, 0x62))
    expect(decodeInput('6162', 'hex')).toEqual(u8(0x61, 0x62))
    expect(decodeInput('YWI=', 'base64')).toEqual(u8(0x61, 0x62))
    expect(decodeInput('a', 'utf16le')).toEqual(u8(0x61, 0))
    expect(decodeInput('a', 'latin1')).toEqual(u8(0x61))
    expect(encodeOutput(u8(0x61, 0x62), 'utf8')).toBe('ab')
    expect(encodeOutput(u8(0xab), 'hex', true)).toBe('AB')
    expect(encodeOutput(u8(0x61, 0x62), 'base64')).toBe('YWI=')
    expect(byteLength('中文', 'utf8')).toBe(6)
    expect(byteLength('zz', 'hex')).toBeNull()
  })

  it('rejects unknown encodings (e.g. stale persisted options) with a ByteDecodeError', () => {
    const bogus = 'ebcdic' as unknown as TextEncodingId
    expect(() => decodeInput('ab', bogus)).toThrow(ByteDecodeError)
    expect(() => encodeOutput(u8(1), bogus as unknown as ByteEncoding)).toThrow('不支持的编码')
    expect(byteLength('ab', bogus)).toBeNull()
  })
})

describe('misc', () => {
  it('concat / equal', () => {
    expect(concatBytes(u8(1), u8(), u8(2, 3))).toEqual(u8(1, 2, 3))
    expect(bytesEqual(u8(1, 2), u8(1, 2))).toBe(true)
    expect(bytesEqual(u8(1, 2), u8(1, 3))).toBe(false)
    expect(bytesEqual(u8(1), u8(1, 2))).toBe(false)
  })

  it('random helpers produce the requested sizes', () => {
    expect(randomBytes(0)).toHaveLength(0)
    expect(randomBytes(70000)).toHaveLength(70000)
    expect(randomPrintable(24)).toMatch(/^[A-Za-z0-9]{24}$/)
    expect(hexToBytes(randomEncoded(16, 'hex'))).toHaveLength(16)
    expect(base64ToBytes(randomEncoded(24, 'base64'))).toHaveLength(24)
    expect(utf8Encode(randomEncoded(32, 'utf8'))).toHaveLength(32)
    expect(bytesToHex(randomBytes(16))).not.toBe(bytesToHex(randomBytes(16)))
  })
})
