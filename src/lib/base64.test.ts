import { describe, expect, it } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  decodeUtf8,
  describeChar,
  encodeText,
  encodedLength,
  findInvalidUtf8,
  hexDump,
  lineColumn,
  overheadPercent,
  utf8Encode,
  wrapLines,
} from './base64'

const decodeText = (s: string) => {
  const r = base64ToBytes(s)
  if (!r.ok) throw new Error(r.error)
  return new TextDecoder().decode(r.bytes)
}

/** 可复现的伪随机字节 */
function randomBytes(n: number, seed = 42): Uint8Array {
  const out = new Uint8Array(n)
  let x = seed
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    out[i] = x >> 16
  }
  return out
}

describe('bytesToBase64 / encodeText', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('RFC 4648 向量 %j', (input, expected) => {
    expect(encodeText(input)).toBe(expected)
    expect(decodeText(expected)).toBe(input)
  })

  it('encodes UTF-8 (中文 / emoji)', () => {
    expect(encodeText('中文')).toBe('5Lit5paH')
    expect(encodeText('你好，世界')).toBe('5L2g5aW977yM5LiW55WM')
    expect(encodeText('😀')).toBe('8J+YgA==')
    expect(encodeText('👨\u200d👩\u200d👧')).toBe(
      Buffer.from('👨\u200d👩\u200d👧').toString('base64'),
    )
  })

  it('supports URL-safe alphabet and no padding', () => {
    expect(encodeText('😀', { urlSafe: true })).toBe('8J-YgA==')
    expect(encodeText('😀', { urlSafe: true, padding: false })).toBe('8J-YgA')
    expect(encodeText('😀', { padding: false })).toBe('8J+YgA')
    const bytes = Uint8Array.from([0xfb, 0xff, 0xbf])
    expect(bytesToBase64(bytes)).toBe('+/+/')
    expect(bytesToBase64(bytes, { urlSafe: true })).toBe('-_-_')
  })

  it('wraps lines at 76 chars (MIME)', () => {
    const out = bytesToBase64(randomBytes(200), { lineWidth: 76 })
    const lines = out.split('\n')
    expect(lines.slice(0, -1).every((l) => l.length === 76)).toBe(true)
    expect(lines.join('')).toBe(Buffer.from(randomBytes(200)).toString('base64'))
  })

  it('matches Node Buffer for random and large inputs', () => {
    for (const n of [1, 2, 3, 4, 5, 63, 64, 65, 1000]) {
      const b = randomBytes(n, n)
      expect(bytesToBase64(b)).toBe(Buffer.from(b).toString('base64'))
      expect(bytesToBase64(b, { urlSafe: true, padding: false })).toBe(
        Buffer.from(b).toString('base64url'),
      )
    }
    const big = randomBytes(1_000_003)
    const enc = bytesToBase64(big)
    expect(enc).toBe(Buffer.from(big).toString('base64'))
    const dec = base64ToBytes(enc)
    expect(dec.ok && Buffer.from(dec.bytes).equals(Buffer.from(big))).toBe(true)
  })

  it('computes encoded length and overhead', () => {
    expect(encodedLength(0)).toBe(0)
    expect(encodedLength(1)).toBe(4)
    expect(encodedLength(1, false)).toBe(2)
    expect(encodedLength(3)).toBe(4)
    expect(encodedLength(10)).toBe(16)
    expect(overheadPercent(3, 4)).toBe(33.3)
    expect(overheadPercent(0, 0)).toBe(0)
  })
})

describe('base64ToBytes', () => {
  it('accepts URL-safe, missing padding and whitespace', () => {
    expect(decodeText('8J-YgA')).toBe('😀')
    expect(decodeText(' 5Lit\n5paH \r\n')).toBe('中文')
    const r = base64ToBytes('8J-Y\ngA')
    expect(r.ok && r.variant).toMatchObject({
      urlSafe: true,
      standard: false,
      padded: false,
      missingPadding: true,
      whitespace: true,
    })
  })

  it('strips a data: URL prefix', () => {
    const r = base64ToBytes('data:text/plain;charset=utf-8;base64,5Lit5paH')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(new TextDecoder().decode(r.bytes)).toBe('中文')
      expect(r.variant.dataUrlMime).toBe('text/plain')
    }
  })

  it('decodes empty input to empty bytes', () => {
    const r = base64ToBytes('')
    expect(r.ok && r.bytes.length).toBe(0)
  })

  it('reports invalid characters with line and column', () => {
    const r = base64ToBytes('Zm9v\nYm*y')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.line).toBe(2)
      expect(r.column).toBe(3)
      expect(r.index).toBe(7)
      expect(r.error).toContain('第 2 行第 3 列')
      expect(r.error).toContain('“*”（U+002A）')
    }
  })

  it('reports non-ASCII and invisible characters', () => {
    const r = base64ToBytes('Zm9v中')
    expect(!r.ok && r.error).toContain('“中”（U+4E2D）')
    const z = base64ToBytes('Zm9v\u200b')
    expect(!z.ok && z.error).toContain('U+200B（不可见字符）')
  })

  it('rejects data after padding, too many pads and bad lengths', () => {
    const concat = base64ToBytes('Zg==Zg==')
    expect(!concat.ok && concat.error).toContain('拼在了一起')
    expect(!concat.ok && concat.column).toBe(3)
    expect(base64ToBytes('Zg===').ok).toBe(false)
    const short = base64ToBytes('Zm9vY')
    expect(!short.ok && short.error).toContain('余数不能为 1')
    const extra = base64ToBytes('Zm9v=')
    expect(!extra.ok && extra.error).toContain('不需要填充')
    const wrongPad = base64ToBytes('Zg=')
    expect(!wrongPad.ok && wrongPad.error).toContain('应补 2 个 =')
  })

  it('columns count Unicode characters, not UTF-16 units', () => {
    expect(lineColumn('😀a\nb😀c', 7)).toEqual({ line: 2, column: 3 })
  })
})

describe('UTF-8 helpers', () => {
  it('finds invalid sequences', () => {
    expect(findInvalidUtf8(utf8Encode('abc 中文 😀'))).toBe(-1)
    expect(findInvalidUtf8(Uint8Array.from([0xff]))).toBe(0)
    expect(findInvalidUtf8(Uint8Array.from([0x61, 0xe4, 0xb8]))).toBe(1) // 截断
    expect(findInvalidUtf8(Uint8Array.from([0xc0, 0x80]))).toBe(0) // 过长编码
    expect(findInvalidUtf8(Uint8Array.from([0xed, 0xa0, 0x80]))).toBe(0) // 代理项
    expect(findInvalidUtf8(Uint8Array.from([0xf4, 0x90, 0x80, 0x80]))).toBe(0) // > U+10FFFF
    expect(findInvalidUtf8(Uint8Array.from([0x61, 0x80]))).toBe(1) // 孤立后续字节
    expect(findInvalidUtf8(new Uint8Array())).toBe(-1)
  })

  it('decodes with replacement and BOM detection', () => {
    const r = decodeUtf8(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61, 0xff]))
    expect(r.bom).toBe(true)
    expect(r.text).toBe('a�')
    expect(r.invalidAt).toBe(4)
  })

  it('formats hex and hex dumps', () => {
    expect(bytesToHex(Uint8Array.from([0, 15, 255]))).toBe('00 0f ff')
    expect(bytesToHex(Uint8Array.from([0xe4, 0xb8, 0xad]), '', true)).toBe('E4B8AD')
    const dump = hexDump(utf8Encode('Hello 中文\n'))
    expect(dump).toBe('00000000  48 65 6c 6c 6f 20 e4 b8  ad e6 96 87 0a           |Hello .......|')
    const long = hexDump(randomBytes(40), 16)
    expect(long.split('\n')).toHaveLength(2)
    expect(long).toContain('其余 24 字节未显示')
  })

  it('wraps and describes', () => {
    expect(wrapLines('abcdef', 4)).toBe('abcd\nef')
    expect(wrapLines('abc', 0)).toBe('abc')
    expect(describeChar('\t')).toContain('不可见')
  })
})
