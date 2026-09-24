import { describe, expect, it } from 'vitest'
import {
  CROCKFORD,
  IdError,
  NANOID_ALPHABETS,
  buildUuidV7,
  bytesToUlid,
  bytesToUuid,
  clampCount,
  collisionLog10,
  createUlidGenerator,
  createUuidV7Generator,
  decodeUlidTime,
  encodeUlidTime,
  formatLog10Count,
  formatUuid,
  generateIds,
  nanoid,
  normalizeAlphabet,
  parseId,
  randomBits,
  uuidV4,
  uuidV4FromBytes,
  type GenerateOptions,
  type RandomBytes,
} from './uuid-generator'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/

/** 固定字节序列的随机源 */
const constBytes =
  (v: number): RandomBytes =>
  (n) =>
    new Uint8Array(n).fill(v)

const base: GenerateOptions = {
  kind: 'v4',
  count: 5,
  uuid: { uppercase: false, noHyphens: false, braces: false },
  ulidLowercase: false,
  nanoidSize: 21,
  nanoidAlphabet: NANOID_ALPHABETS[0].chars,
}

describe('UUID v4', () => {
  it('has the right format, version and variant', () => {
    for (let i = 0; i < 200; i++) {
      const id = uuidV4()
      expect(id).toMatch(UUID_RE)
      expect(id[14]).toBe('4')
      expect('89ab').toContain(id[19])
    }
  })

  it('sets version/variant bits on arbitrary bytes (fallback path)', () => {
    expect(uuidV4FromBytes(new Uint8Array(16).fill(0xff))).toBe(
      'ffffffff-ffff-4fff-bfff-ffffffffffff',
    )
    expect(uuidV4FromBytes(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000')
    expect(uuidV4(constBytes(0xab))).toBe('abababab-abab-4bab-abab-abababababab')
  })

  it('is unique across a large batch', () => {
    const ids = generateIds({ ...base, count: 1000 })
    expect(new Set(ids).size).toBe(1000)
  })
})

describe('formatUuid', () => {
  const id = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f'
  it('applies uppercase, no hyphens and braces', () => {
    expect(formatUuid(id, { uppercase: true, noHyphens: false, braces: false })).toBe(
      '017F22E2-79B0-7CC3-98C4-DC0C0C07398F',
    )
    expect(formatUuid(id, { uppercase: false, noHyphens: true, braces: false })).toBe(
      '017f22e279b07cc398c4dc0c0c07398f',
    )
    expect(formatUuid(id, { uppercase: true, noHyphens: true, braces: true })).toBe(
      '{017F22E279B07CC398C4DC0C0C07398F}',
    )
  })
})

describe('UUID v7', () => {
  it('builds the RFC 9562 example layout', () => {
    // RFC 9562 附录 A.6：017F22E2-79B0-7CC3-98C4-DC0C0C07398F
    // rand_a = 0xCC3，rand_b 高 30 位 = 0x18C4DC0C 的高 30 位
    const randA = 0xcc3
    const low30 = ((0x18 & 0x3f) << 24) | (0xc4 << 16) | (0xdc << 8) | 0x0c
    const counter = randA * 2 ** 30 + low30
    expect(buildUuidV7(0x017f22e279b0, counter, Uint8Array.of(0x0c, 0x07, 0x39, 0x8f))).toBe(
      '017f22e2-79b0-7cc3-98c4-dc0c0c07398f',
    )
  })

  it('embeds the current timestamp and version 7', () => {
    const gen = createUuidV7Generator({ now: () => 1_700_000_000_123 })
    const id = gen()
    expect(id).toMatch(UUID_RE)
    expect(id[14]).toBe('7')
    expect('89ab').toContain(id[19])
    expect(parseId(id).timestamp!.ms).toBe(1_700_000_000_123)
  })

  it('is strictly monotonic within the same millisecond and across clock rollback', () => {
    let t = 1_700_000_000_000
    const times = [t, t, t, t - 5, t - 5, t + 1, t + 1]
    let i = 0
    const gen = createUuidV7Generator({ now: () => times[i++ % times.length] })
    const ids = Array.from({ length: 7 }, () => gen())
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(7)
    // 时钟回拨时沿用上一毫秒
    expect(parseId(ids[3]).timestamp!.ms).toBe(t)
    t++
    expect(parseId(ids[5]).timestamp!.ms).toBe(t)
  })

  it('keeps ordering over a large same-ms batch with real randomness', () => {
    const gen = createUuidV7Generator({ now: () => 1_234_567_890_000 })
    const ids = Array.from({ length: 5000 }, () => gen())
    for (let k = 1; k < ids.length; k++) expect(ids[k] > ids[k - 1]).toBe(true)
  })

  it('validates the 48-bit timestamp and packs maximum field values', () => {
    expect(() => buildUuidV7(2 ** 48, 0, new Uint8Array(4))).toThrow(RangeError)
    const max = buildUuidV7(2 ** 48 - 1, 2 ** 42 - 1, new Uint8Array(4).fill(0xff))
    expect(max).toBe('ffffffff-ffff-7fff-bfff-ffffffffffff')
  })

  it('shared generator stays monotonic across batches', () => {
    const a = generateIds({ ...base, kind: 'v7', count: 300 })
    const b = generateIds({ ...base, kind: 'v7', count: 300 })
    const all = [...a, ...b]
    expect([...all].sort()).toEqual(all)
  })
})

describe('ULID', () => {
  it('encodes/decodes the spec timestamp example', () => {
    // ulid 规范 README：decodeTime('01ARYZ6S41') === 1469918176385
    expect(encodeUlidTime(1469918176385)).toBe('01ARYZ6S41')
    expect(decodeUlidTime('01ARYZ6S41TSV4RRFFQ69G5FAV')).toBe(1469918176385)
    expect(encodeUlidTime(0)).toBe('0000000000')
    expect(encodeUlidTime(2 ** 48 - 1)).toBe('7ZZZZZZZZZ')
    expect(() => encodeUlidTime(2 ** 48)).toThrow(RangeError)
    expect(() => encodeUlidTime(-1)).toThrow(RangeError)
  })

  it('generates valid, monotonic ULIDs within the same millisecond', () => {
    const gen = createUlidGenerator({ now: () => 1469918176385 })
    const ids = Array.from({ length: 2000 }, () => gen())
    for (const id of ids) {
      expect(id).toMatch(ULID_RE)
      expect(id.startsWith('01ARYZ6S41')).toBe(true)
    }
    for (let k = 1; k < ids.length; k++) expect(ids[k] > ids[k - 1]).toBe(true)
  })

  it('increments with carry and rolls into the next ms on overflow', () => {
    const gen = createUlidGenerator({ now: () => 1000, randomBytes: constBytes(0xff) })
    const first = gen()
    expect(first.slice(10)).toBe('Z'.repeat(16))
    const second = gen()
    // 随机部分已是最大值：借用下一毫秒并重新取随机
    expect(decodeUlidTime(second)).toBe(1001)
    expect(second > first).toBe(true)

    const gen2 = createUlidGenerator({ now: () => 5, randomBytes: constBytes(0) })
    expect(gen2().slice(10)).toBe('0'.repeat(16))
    expect(gen2().slice(10)).toBe('0'.repeat(15) + '1')
  })

  it('converts between ULID and UUID bytes', () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => i * 17)
    const ulid = bytesToUlid(bytes)
    expect(ulid).toMatch(ULID_RE)
    const parsed = parseId(ulid)
    expect(parsed.asUuid).toBe(bytesToUuid(bytes))
    expect(parseId(parsed.asUuid!).asUlid).toBe(ulid)
    expect(bytesToUlid(new Uint8Array(16).fill(0xff))).toBe('7' + 'Z'.repeat(25))
  })

  it('lowercase option and alphabet', () => {
    const ids = generateIds({ ...base, kind: 'ulid', ulidLowercase: true, count: 3 })
    for (const id of ids) expect(id).toMatch(/^[0-7][0-9a-hjkmnp-tv-z]{25}$/)
    expect(CROCKFORD).toHaveLength(32)
    expect(CROCKFORD).not.toMatch(/[ILOU]/)
  })
})

describe('NanoID', () => {
  it('uses the default URL-safe alphabet and size 21', () => {
    for (let i = 0; i < 100; i++) expect(nanoid()).toMatch(/^[A-Za-z0-9_-]{21}$/)
  })

  it('supports custom alphabets (non power of two, unicode) and sizes', () => {
    expect(nanoid(10, '0123456789')).toMatch(/^\d{10}$/)
    const zh = nanoid(8, '甲乙丙丁戊')
    expect(Array.from(zh)).toHaveLength(8)
    for (const c of zh) expect('甲乙丙丁戊').toContain(c)
    expect(nanoid(6, 'ab', constBytes(1))).toBe('bbbbbb')
  })

  it('is roughly uniform with a 3-char alphabet (rejection sampling)', () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
    const s = nanoid(256, 'abc') + nanoid(256, 'abc') + nanoid(256, 'abc') + nanoid(256, 'abc')
    for (const c of s) counts[c]++
    for (const v of Object.values(counts)) expect(Math.abs(v - 1024 / 3)).toBeLessThan(90)
  })

  it('validates alphabet and size with Chinese errors', () => {
    expect(() => nanoid(21, 'aaaa')).toThrow('字母表至少需要 2 个不同的字符')
    expect(() => nanoid(1)).toThrow(IdError)
    expect(() => nanoid(257)).toThrow('长度需在 2–256 之间')
  })

  it('normalizes alphabets', () => {
    expect(normalizeAlphabet('aab c👍🏽👍🏽')).toEqual({
      chars: ['a', 'b', 'c', '👍🏽'],
      duplicates: ['a', '👍🏽'],
    })
  })

  it('presets are duplicate-free', () => {
    for (const p of NANOID_ALPHABETS) {
      expect(normalizeAlphabet(p.chars).duplicates).toEqual([])
    }
    expect(NANOID_ALPHABETS[0].chars).toHaveLength(64)
  })
})

describe('generateIds / stats', () => {
  it('clamps count to 1–1000', () => {
    expect(clampCount(0)).toBe(1)
    expect(clampCount(5000)).toBe(1000)
    expect(clampCount(Number.NaN)).toBe(1)
    expect(generateIds({ ...base, count: 3000 })).toHaveLength(1000)
  })

  it('applies uuid formatting for v4 and v7', () => {
    const ids = generateIds({
      ...base,
      kind: 'v7',
      count: 3,
      uuid: { uppercase: true, noHyphens: true, braces: true },
    })
    for (const id of ids) expect(id).toMatch(/^\{[0-9A-F]{32}\}$/)
  })

  it('reports random bits and collision estimates', () => {
    expect(randomBits({ ...base, kind: 'v4' })).toBe(122)
    expect(randomBits({ ...base, kind: 'nanoid' })).toBeCloseTo(126, 10)
    expect(randomBits({ ...base, kind: 'nanoid', nanoidAlphabet: 'a' })).toBe(0)
    // 122 位、1% 概率 ≈ 3.26 × 10^17 个
    expect(collisionLog10(122)).toBeCloseTo(Math.log10(3.26e17), 2)
    expect(formatLog10Count(collisionLog10(122))).toBe('3.3×10¹⁷')
    expect(formatLog10Count(Math.log10(12345))).toBe('1.2 万')
    expect(formatLog10Count(Math.log10(250_000_000))).toBe('2.5 亿')
    expect(formatLog10Count(Math.log10(999))).toBe('999')
  })
})

describe('parseId', () => {
  it('decodes the RFC 9562 v1 example (100 ns precision, clock seq, node)', () => {
    const p = parseId('C232AB00-9414-11EC-B3C8-9F6BDECED846')
    expect(p.kind).toBe('uuid')
    expect(p.version).toBe(1)
    expect(p.variant).toContain('RFC')
    // 2022-02-22 14:22:22 GMT-05:00
    expect(p.timestamp!.iso).toBe('2022-02-22T19:22:22.000Z')
    expect(p.timestamp!.isoPrecise).toBe('2022-02-22T19:22:22.0000000Z')
    expect(p.timestamp!.precision).toBe('100ns')
    expect(p.clockSeq).toBe(0x33c8)
    expect(p.node).toBe('9f:6b:de:ce:d8:46')
    expect(p.nodeIsRandom).toBe(true)
  })

  it('decodes the RFC 9562 v6 and v7 examples to the same instant', () => {
    const v6 = parseId('1EC9414C-232A-6B00-B3C8-9F6BDECED846')
    expect(v6.version).toBe(6)
    expect(v6.timestamp!.iso).toBe('2022-02-22T19:22:22.000Z')
    expect(v6.clockSeq).toBe(0x33c8)
    const v7 = parseId('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')
    expect(v7.version).toBe(7)
    expect(v7.timestamp!.ms).toBe(1645557742000)
    expect(v7.timestamp!.precision).toBe('ms')
    // v7 与 ULID 前 48 位同为毫秒时间戳
    expect(decodeUlidTime(v7.asUlid!)).toBe(1645557742000)
  })

  it('identifies v3 / v4 / v5 / v8 without timestamps', () => {
    expect(parseId('5df41881-3aed-3515-88a7-2f4a814cf09e').version).toBe(3)
    const v4 = parseId('919108f7-52d1-4320-9bac-f847db4148a8')
    expect(v4.version).toBe(4)
    expect(v4.versionName).toBe('随机')
    expect(v4.timestamp).toBeUndefined()
    expect(parseId('2ed6657d-e927-568b-95e1-2665a8aea6a2').version).toBe(5)
    expect(parseId('2489E9AD-2EE2-8E00-8EC9-32D5F69181C0').version).toBe(8)
  })

  it('accepts braces, urn prefix, no hyphens and upper case', () => {
    const canonical = '919108f7-52d1-4320-9bac-f847db4148a8'
    expect(parseId('{919108F7-52D1-4320-9BAC-F847DB4148A8}').canonical).toBe(canonical)
    expect(parseId('urn:uuid:919108f7-52d1-4320-9bac-f847db4148a8').canonical).toBe(canonical)
    expect(parseId('  919108f752d143209bacf847db4148a8 ').canonical).toBe(canonical)
    // 从 JSON / 代码中复制时带的引号
    expect(parseId('"919108f7-52d1-4320-9bac-f847db4148a8"').canonical).toBe(canonical)
    expect(parseId("'{919108f7-52d1-4320-9bac-f847db4148a8}'").canonical).toBe(canonical)
    expect(parseId('`01ARZ3NDEKTSV4RRFFQ69G5FAV`').kind).toBe('ulid')
  })

  it('recognizes nil / max and non-RFC variants', () => {
    expect(parseId('00000000-0000-0000-0000-000000000000').special).toBe('nil')
    expect(parseId('ffffffff-ffff-ffff-ffff-ffffffffffff').special).toBe('max')
    const ms = parseId('6ba7b810-9dad-11d1-c0b4-00c04fd430c8')
    expect(ms.variant).toContain('微软')
    expect(ms.timestamp).toBeUndefined()
  })

  it('reports decimal value', () => {
    expect(parseId('00000000-0000-0000-0000-0000000000ff').decimal).toBe('255')
  })

  it('parses ULIDs with Crockford aliases', () => {
    const p = parseId('01arz3ndektsv4rrffq69g5fav')
    expect(p.kind).toBe('ulid')
    expect(p.canonical).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV')
    const aliased = parseId('O1ARZ3NDEKTSV4RRFFQ69G5FAV')
    expect(aliased.canonical).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV')
    expect(p.asUuid).toMatch(UUID_RE)
  })

  it('gives precise Chinese errors', () => {
    expect(() => parseId('')).toThrow('请输入 UUID 或 ULID')
    expect(() => parseId('919108f7-52d1-4320-9bac-f847db4148ag')).toThrow('第 36 个字符「g」')
    expect(() => parseId('919108f7x52d1-4320-9bac-f847db4148a8')).toThrow('第 9 个字符应为连字符')
    expect(() => parseId('919108f7-52d1-4320-9bac')).toThrow('8-4-4-4')
    expect(() => parseId('01ARZ3NDEKTSV4RRFFQ69G5FAU')).toThrow('第 26 个字符「U」')
    expect(() => parseId('81ARZ3NDEKTSV4RRFFQ69G5FAV')).toThrow('首字符')
    expect(() => parseId('abc')).toThrow('长度为 3')
    // 按字符（码点）计数，emoji 不算成 2 个
    expect(() => parseId('🙂')).toThrow('长度为 1 个字符')
    expect(() => parseId('"abc')).toThrow('长度为 4')
    expect(() => parseId('{919108f7-52d1-4320-9bac-f847db4148a8')).toThrow('花括号不成对')
    expect(() => parseId('中文中文中文中文-中文中-中文中-中文中-中文中文中文中文中文中')).toThrow(
      IdError,
    )
  })
})
