import { describe, expect, it } from 'vitest'
import {
  CREDIT_CODE_CHARS,
  FIELD_TYPES,
  PRESETS,
  clampCount,
  createRng,
  creditCodeCheckChar,
  formatWallTime,
  generate,
  hashString,
  idCardCheckDigit,
  isLuhnValid,
  isValidCreditCode,
  isValidIdCard,
  isValidOrgCode,
  luhnCheckDigit,
  makeFieldId,
  presetFields,
  sanitizeFields,
  uniqueName,
  orgCodeCheckChar,
  parseEnumValues,
  parseWallTime,
  resolveColumnNames,
  resolveOptions,
  type FieldDef,
  type FieldType,
} from './mock-data'
import { REGIONS } from './mock-data-dict'

const NOW = Date.UTC(2025, 5, 15) // 2025-06-15
const ctx = { now: NOW }

function column(type: FieldType, options: FieldDef['options'] = {}, count = 300, seed = 42) {
  return generate([{ id: 'f', name: 'v', type, options }], count, seed, ctx).rows.map((r) => r[0])
}

describe('PRNG', () => {
  it('is deterministic per seed and varies across seeds', () => {
    const a = createRng(123)
    const b = createRng(123)
    const c = createRng(124)
    const sa = Array.from({ length: 10 }, () => a.next())
    const sb = Array.from({ length: 10 }, () => b.next())
    const sc = Array.from({ length: 10 }, () => c.next())
    expect(sa).toEqual(sb)
    expect(sa).not.toEqual(sc)
    sa.forEach((x) => expect(x >= 0 && x < 1).toBe(true))
  })

  it('int() stays in the closed range and hits both ends', () => {
    const r = createRng(1)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const v = r.int(3, 7)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(7)
      seen.add(v)
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7])
  })

  it('int() keeps full precision on spans wider than 2^32 (regression)', () => {
    const r = createRng(9)
    const lastDigits = new Set<number>()
    for (let i = 0; i < 500; i++) {
      const v = r.int(-1e15, 1e15)
      expect(Number.isSafeInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(-1e15)
      expect(v).toBeLessThanOrEqual(1e15)
      lastDigits.add(Math.abs(v) % 1000)
    }
    // 只有 32 位精度时相邻取值间隔约 46 万，末三位会大量重复
    expect(lastDigits.size).toBeGreaterThan(350)
  })

  it('hashString is stable and handles unicode', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
    expect(hashString('中文😀')).toBeGreaterThanOrEqual(0)
    expect(hashString('')).toBeTypeOf('number')
  })
})

describe('checksums (known vectors)', () => {
  it('ID card: GB 11643 examples', () => {
    expect(idCardCheckDigit('11010519491231002')).toBe('X')
    expect(idCardCheckDigit('44052418800101001')).toBe('4')
    expect(isValidIdCard('11010519491231002X')).toBe(true)
    expect(isValidIdCard('440524188001010014')).toBe(true)
    expect(isValidIdCard('110105194912310021')).toBe(false) // 校验位错
    expect(isValidIdCard('110105194902300028')).toBe(false) // 2 月 30 日
    expect(isValidIdCard('11010519491231002x')).toBe(false) // 小写 x
    expect(isValidIdCard('')).toBe(false)
  })

  it('Luhn: classic vectors', () => {
    expect(isLuhnValid('79927398713')).toBe(true)
    expect(isLuhnValid('4539 1488 0343 6467')).toBe(true)
    expect(isLuhnValid('79927398710')).toBe(false)
    expect(luhnCheckDigit('7992739871')).toBe('3')
    expect(isLuhnValid('abc')).toBe(false)
  })

  it('unified social credit code: GB 32100 example', () => {
    expect(creditCodeCheckChar('91350100M000100Y4')).toBe('3')
    expect(isValidCreditCode('91350100M000100Y43')).toBe(true)
    expect(isValidCreditCode('91350100M000100Y44')).toBe(false)
    expect(isValidCreditCode('91350100M000100I43')).toBe(false) // I 不在字符集
    expect(isValidCreditCode('short')).toBe(false)
  })

  it('organization code: GB 11714 check char', () => {
    // 标准示例 91350100M000100Y43 中嵌入的组织机构代码 M000100Y4
    expect(orgCodeCheckChar('M000100Y')).toBe('4')
    expect(orgCodeCheckChar('D2143569')).toBe('X')
    expect(isValidOrgCode('D2143569X')).toBe(true)
    expect(isValidOrgCode('D21435691')).toBe(false)
  })
})

describe('generators', () => {
  it('ID cards are valid, use real region codes and respect age range', () => {
    const codes = new Set(
      REGIONS.flatMap((p) => p.cities.flatMap((c) => c.districts.map((d) => d.code))),
    )
    for (const v of column('idCard', { minAge: 20, maxAge: 30 })) {
      const id = String(v)
      expect(isValidIdCard(id)).toBe(true)
      expect(codes.has(id.slice(0, 6))).toBe(true)
      const birth = Date.UTC(+id.slice(6, 10), +id.slice(10, 12) - 1, +id.slice(12, 14))
      const age = (NOW - birth) / (365.2425 * 86400_000)
      expect(age).toBeGreaterThanOrEqual(19.99)
      expect(age).toBeLessThan(31.01)
    }
  })

  it('ID card gender digit follows the option', () => {
    column('idCard', { gender: 'male' }).forEach((v) => expect(+String(v)[16] % 2).toBe(1))
    column('idCard', { gender: 'female' }).forEach((v) => expect(+String(v)[16] % 2).toBe(0))
  })

  it('bank cards are Luhn-valid, start with 62 and have the chosen length', () => {
    for (const v of column('bankCard')) {
      expect(String(v)).toMatch(/^62\d{17}$/)
      expect(isLuhnValid(String(v))).toBe(true)
    }
    for (const v of column('bankCard', { length: '16', spaced: true })) {
      expect(String(v)).toMatch(/^62\d{2}( \d{4}){3}$/)
      expect(isLuhnValid(String(v))).toBe(true)
    }
  })

  it('credit codes pass both the USCC and embedded org-code checks', () => {
    for (const v of column('creditCode')) {
      const s = String(v)
      expect(s).toHaveLength(18)
      expect([...s].every((ch) => CREDIT_CODE_CHARS.includes(ch))).toBe(true)
      expect(isValidCreditCode(s)).toBe(true)
      expect(isValidOrgCode(s.slice(8, 17))).toBe(true)
    }
  })

  it('phones use valid 13x–19x prefixes in every format', () => {
    column('phone').forEach((v) => expect(String(v)).toMatch(/^1[3-9]\d{9}$/))
    column('phone', { format: 'space' }).forEach((v) =>
      expect(String(v)).toMatch(/^1[3-9]\d \d{4} \d{4}$/),
    )
    column('phone', { format: 'dash' }).forEach((v) =>
      expect(String(v)).toMatch(/^1[3-9]\d-\d{4}-\d{4}$/),
    )
    column('phone', { format: 'intl' }).forEach((v) =>
      expect(String(v)).toMatch(/^\+86 1[3-9]\d{9}$/),
    )
    // 不会出现不存在的号段
    column('phone').forEach((v) =>
      expect(String(v).slice(0, 3)).not.toMatch(/^(140|154|160|174|179)$/),
    )
  })

  it('emails look valid; custom and safe domains are honoured', () => {
    const re = /^[a-z0-9._]+@[a-z0-9.-]+\.[a-z]{2,}$/
    column('email').forEach((v) => expect(String(v)).toMatch(re))
    column('email', { domain: 'safe' }).forEach((v) =>
      expect(String(v)).toMatch(/@example\.(com|net|org)$/),
    )
    column('email', { domain: 'custom', customDomain: '@Corp.CN' }).forEach((v) =>
      expect(String(v)).toMatch(/@corp\.cn$/),
    )
    const bad = generate(
      [
        {
          id: 'x',
          name: 'e',
          type: 'email',
          options: { domain: 'custom', customDomain: 'no dot' },
        },
      ],
      3,
      1,
      ctx,
    )
    expect(bad.warnings[0]).toContain('自定义域名')
    bad.rows.forEach((r) => expect(String(r[0])).toMatch(/@example\.com$/))
  })

  it('Chinese names are 2–4 CJK chars; English names are ASCII', () => {
    column('zhName').forEach((v) => expect(String(v)).toMatch(/^\p{Script=Han}{2,4}$/u))
    column('enName').forEach((v) => expect(String(v)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/))
    column('enName', { format: 'first' }).forEach((v) => expect(String(v)).toMatch(/^[A-Z][a-z]+$/))
  })

  it('addresses include province / district at the chosen granularity', () => {
    column('address').forEach((v) => expect(String(v)).toMatch(/^.+(省|市|自治区).*区.+\d+号$/))
    column('address', { level: 'province' }).forEach((v) =>
      expect(REGIONS.map((p) => p.name)).toContain(v),
    )
    column('address', { level: 'detail' }).forEach((v) =>
      expect(String(v)).toMatch(/栋\d+单元\d+室$/),
    )
    // 直辖市不写两遍
    column('address', { level: 'region' }).forEach((v) =>
      expect(String(v)).not.toMatch(/北京市北京市/),
    )
  })

  it('plates, zips, IPs, UUIDs, colors, URLs have the right shape', () => {
    column('plate').forEach((v) =>
      expect(String(v)).toMatch(/^\p{Script=Han}[A-H][0-9A-HJ-NP-Z]{5}$/u),
    )
    column('plate', { kind: 'ev' }).forEach((v) =>
      expect(String(v)).toMatch(/^\p{Script=Han}[A-H][DF][0-9A-HJ-NP-Z]\d{4}$/u),
    )
    column('zip').forEach((v) => expect(String(v)).toMatch(/^\d{6}$/))
    column('ipv4', { kind: 'private' }).forEach((v) =>
      expect(String(v)).toMatch(/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/),
    )
    column('ipv4').forEach((v) => {
      const [a, b] = String(v).split('.').map(Number)
      expect(
        a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31),
      ).toBe(false)
      expect(String(v)).toMatch(/^(\d{1,3}\.){3}\d{1,3}$/)
    })
    column('uuid').forEach((v) =>
      expect(String(v)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    )
    column('uuid', { format: 'compact' }).forEach((v) =>
      expect(String(v)).toMatch(/^[0-9a-f]{32}$/),
    )
    column('color').forEach((v) => expect(String(v)).toMatch(/^#[0-9a-f]{6}$/))
    column('color', { format: 'rgb' }).forEach((v) =>
      expect(String(v)).toMatch(/^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/),
    )
    column('url').forEach((v) => expect(() => new URL(String(v))).not.toThrow())
  })

  it('numbers respect ranges and decimals; min > max is swapped with a warning', () => {
    column('int', { min: -5, max: 5 }).forEach((v) => {
      expect(Number.isInteger(v)).toBe(true)
      expect(v as number).toBeGreaterThanOrEqual(-5)
      expect(v as number).toBeLessThanOrEqual(5)
    })
    column('float', { min: 1, max: 2, decimals: 3 }).forEach((v) => {
      expect(v as number).toBeGreaterThanOrEqual(1)
      expect(v as number).toBeLessThanOrEqual(2)
      expect(String(v).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3)
    })
    const r = generate(
      [{ id: 'a', name: 'n', type: 'int', options: { min: 10, max: 1 } }],
      50,
      1,
      ctx,
    )
    expect(r.warnings.some((w) => w.includes('交换'))).toBe(true)
    r.rows.forEach(([v]) => expect(v as number).toBeGreaterThanOrEqual(1))
  })

  it('int ranges with fractional bounds stay inside the bounds (regression)', () => {
    // 交换后仍应向内取整：[1.5, 10.5] → 2..10
    const swapped = generate(
      [{ id: 'a', name: 'n', type: 'int', options: { min: 10.5, max: 1.5 } }],
      400,
      3,
      ctx,
    )
    const vals = swapped.rows.map(([v]) => v as number)
    expect(Math.min(...vals)).toBe(2)
    expect(Math.max(...vals)).toBe(10)
    // 区间里没有整数：给出明确提示，而不是误报「最小值大于最大值」
    const none = generate(
      [{ id: 'a', name: 'n', type: 'int', options: { min: 1.2, max: 1.8 } }],
      5,
      3,
      ctx,
    )
    expect(none.warnings).toEqual(['整数：1.2–1.8 之间没有整数，已固定为 1'])
    none.rows.forEach(([v]) => expect(v).toBe(1))
  })

  it('datetimes stay within range and support every format', () => {
    const lo = parseWallTime('2024-02-01')!
    const hi = parseWallTime('2024-02-29 23:59:59')!
    column('datetime', { start: '2024-02-01', end: '2024-02-29 23:59:59' }).forEach((v) => {
      const t = parseWallTime(String(v))!
      expect(t).toBeGreaterThanOrEqual(lo)
      expect(t).toBeLessThanOrEqual(hi)
    })
    column('datetime', { format: 'iso' }).forEach((v) =>
      expect(String(v)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/),
    )
    column('datetime', { format: 'ts' }).forEach((v) => expect(Number.isInteger(v)).toBe(true))
    const bad = generate(
      [{ id: 'd', name: 'd', type: 'datetime', options: { start: 'yesterday' } }],
      1,
      1,
      ctx,
    )
    expect(bad.warnings[0]).toContain('无法识别')
  })

  it('booleans honour ratio and output style', () => {
    expect(column('bool', { ratio: 100 }).every((v) => v === true)).toBe(true)
    expect(column('bool', { ratio: 0, format: 'number' }).every((v) => v === 0)).toBe(true)
    expect(new Set(column('bool', { format: 'zh' }))).toEqual(new Set(['是', '否']))
  })

  it('enums pick only from the provided values (commas, 中文逗号, newlines)', () => {
    expect(parseEnumValues('a, b，c\nd|e,,')).toEqual(['a', 'b', 'c', 'd', 'e'])
    const vals = new Set(column('enum', { values: '红,绿，蓝' }))
    expect(vals).toEqual(new Set(['红', '绿', '蓝']))
    const empty = generate(
      [{ id: 'e', name: 'e', type: 'enum', options: { values: ' , ' } }],
      2,
      1,
      ctx,
    )
    expect(empty.warnings[0]).toContain('没有可选值')
    expect(empty.rows[0][0]).toBe('')
  })

  it('passwords have the requested length and all character classes', () => {
    column('password', { length: 16 }).forEach((v) => {
      const s = String(v)
      expect(s).toHaveLength(16)
      expect(s).toMatch(/[a-z]/)
      expect(s).toMatch(/[A-Z]/)
      expect(s).toMatch(/\d/)
      expect(s).toMatch(/[!@#$%^&*\-_=+?]/)
    })
    column('password', { length: 8, symbols: false }).forEach((v) =>
      expect(String(v)).toMatch(/^[A-Za-z0-9]{8}$/),
    )
  })

  it('Chinese sentences / paragraphs end with punctuation', () => {
    column('sentence').forEach((v) => expect(String(v)).toMatch(/^\p{Script=Han}.+[。！]$/u))
    column('paragraph', { min: 2, max: 2 }).forEach((v) =>
      expect(String(v).match(/[。！]/g)).toHaveLength(2),
    )
  })

  it('autoId counts from start by step', () => {
    expect(column('autoId', { start: 100, step: 5 }, 4)).toEqual([100, 105, 110, 115])
  })

  it('every declared type generates without throwing', () => {
    const fields = FIELD_TYPES.map((t, i) => ({
      id: `f${i}`,
      name: t.defaultName + i,
      type: t.type,
    }))
    const r = generate(fields, 50, 7, ctx)
    expect(r.columns).toHaveLength(FIELD_TYPES.length)
    expect(r.rows).toHaveLength(50)
    expect(r.warnings).toEqual([])
  })
})

describe('generate()', () => {
  const schema: FieldDef[] = [
    { id: 'a', name: 'name', type: 'zhName' },
    { id: 'b', name: 'phone', type: 'phone' },
    { id: 'c', name: 'id_card', type: 'idCard' },
  ]

  it('is deterministic with a seed', () => {
    expect(generate(schema, 20, 99, ctx)).toEqual(generate(schema, 20, 99, ctx))
    expect(generate(schema, 20, 99, ctx).rows).not.toEqual(generate(schema, 20, 100, ctx).rows)
  })

  it('keeps other columns stable when one field changes or order changes', () => {
    const base = generate(schema, 10, 5, ctx)
    const changed = generate(
      [schema[0], { ...schema[1], options: { format: 'dash' } }, schema[2]],
      10,
      5,
      ctx,
    )
    expect(changed.rows.map((r) => r[0])).toEqual(base.rows.map((r) => r[0]))
    expect(changed.rows.map((r) => r[2])).toEqual(base.rows.map((r) => r[2]))
    const reordered = generate([schema[2], schema[0], schema[1]], 10, 5, ctx)
    expect(reordered.rows.map((r) => r[1])).toEqual(base.rows.map((r) => r[0]))
  })

  it('growing the row count keeps the earlier rows', () => {
    const small = generate(schema, 5, 3, ctx)
    const big = generate(schema, 50, 3, ctx)
    expect(big.rows.slice(0, 5)).toEqual(small.rows)
  })

  it('clamps row count to 1–1000 and handles empty schema', () => {
    expect(clampCount(0)).toBe(1)
    expect(clampCount(5000)).toBe(1000)
    expect(clampCount(NaN)).toBe(1)
    expect(generate(schema, 5000, 1, ctx).rows).toHaveLength(1000)
    const empty = generate([], 3, 1, ctx)
    expect(empty.columns).toEqual([])
    expect(empty.rows).toEqual([[], [], []])
  })

  it('fixes blank and duplicate column names with warnings', () => {
    const { columns, warnings } = resolveColumnNames([
      { name: 'a' },
      { name: ' ' },
      { name: 'a' },
      { name: 'a' },
    ])
    expect(columns).toEqual(['a', 'field_2', 'a_2', 'a_3'])
    expect(warnings).toHaveLength(3)
  })

  it('survives garbage options and unknown types', () => {
    const r = generate(
      [
        { id: 'x', name: 'x', type: 'int', options: { min: 'abc', max: Infinity } },
        { id: 'y', name: 'y', type: 'nope' as FieldType },
      ],
      3,
      1,
      ctx,
    )
    expect(r.rows).toHaveLength(3)
    expect(r.warnings.some((w) => w.includes('未知的字段类型'))).toBe(true)
  })

  it('handles 1000 rows × all presets quickly', () => {
    const t0 = performance.now()
    for (const p of PRESETS) {
      const fields = p.fields.map((f, i) => ({ ...f, id: `${p.id}-${i}` }))
      const r = generate(fields, 1000, 1, ctx)
      expect(r.rows).toHaveLength(1000)
      expect(r.warnings).toEqual([])
    }
    expect(performance.now() - t0).toBeLessThan(2000)
  })
})

describe('options & time helpers', () => {
  it('resolveOptions fills defaults and clamps numbers', () => {
    expect(resolveOptions('password', {})).toEqual({ length: 12, symbols: true })
    expect(resolveOptions('password', { length: 9999 })).toMatchObject({ length: 128 })
    expect(resolveOptions('phone', { format: 'bogus' })).toEqual({ format: 'plain' })
  })

  it('parseWallTime accepts common formats and rejects invalid dates', () => {
    expect(parseWallTime('2024-01-02')).toBe(Date.UTC(2024, 0, 2))
    expect(parseWallTime('2024/1/2 8:05')).toBe(Date.UTC(2024, 0, 2, 8, 5))
    expect(parseWallTime('2024-01-02T08:05:09')).toBe(Date.UTC(2024, 0, 2, 8, 5, 9))
    expect(parseWallTime('2023-02-29')).toBeNull()
    expect(parseWallTime('2024-01-02 24:00')).toBeNull()
    expect(parseWallTime('')).toBeNull()
  })

  it('formatWallTime treats wall clock as Beijing time for timestamps', () => {
    const wall = Date.UTC(2024, 0, 1, 8, 0, 0)
    expect(formatWallTime(wall, 'datetime')).toBe('2024-01-01 08:00:00')
    expect(formatWallTime(wall, 'iso')).toBe('2024-01-01T08:00:00+08:00')
    expect(formatWallTime(wall, 'ts')).toBe(1704067200)
    expect(formatWallTime(wall, 'tsms')).toBe(1704067200000)
  })
})

describe('field editing helpers', () => {
  it('uniqueName adds numeric suffixes', () => {
    expect(uniqueName('name', [])).toBe('name')
    expect(uniqueName('name', ['name'])).toBe('name_2')
    expect(uniqueName('name', ['name', 'name_2'])).toBe('name_3')
  })

  it('makeFieldId is unique enough', () => {
    const ids = new Set(Array.from({ length: 500 }, makeFieldId))
    expect(ids.size).toBe(500)
  })

  it('sanitizeFields accepts good data and rejects malformed data', () => {
    const good = [{ id: 'a', name: 'x', type: 'int', options: { min: 1, bad: { deep: 1 } } }]
    expect(sanitizeFields(good)).toEqual([{ id: 'a', name: 'x', type: 'int', options: { min: 1 } }])
    expect(sanitizeFields(null)).toBeNull()
    expect(sanitizeFields([{ id: 'a', name: 'x', type: 'wat' }])).toBeNull()
    expect(
      sanitizeFields([
        { id: 'a', name: 'x', type: 'int' },
        { id: 'a', name: 'y', type: 'int' },
      ]),
    ).toBeNull()
    expect(sanitizeFields([])).toEqual([])
  })

  it('sanitizeFields keeps object identity when nothing needs fixing', () => {
    const list = [
      { id: 'a', name: 'x', type: 'int', options: { min: 1 } },
      { id: 'b', name: 'y', type: 'uuid' },
    ]
    const out = sanitizeFields(list)
    expect(out).toBe(list)
    expect(out![1]).toBe(list[1])
  })

  it('presetFields copies preset fields with fresh ids', () => {
    let n = 0
    const f = presetFields(PRESETS[0], () => `id${n++}`)
    expect(f.map((x) => x.id)).toEqual(PRESETS[0].fields.map((_, i) => `id${i}`))
    f[0].options!.start = 99
    expect(PRESETS[0].fields[0].options?.start).toBeUndefined()
  })
})
