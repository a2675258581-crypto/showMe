import { describe, expect, it } from 'vitest'
import {
  cellText,
  csvToJson,
  findRecordArrays,
  flattenRecord,
  guessDelimiter,
  jsonToCsv,
  typeCell,
  unflattenRecord,
  withBom,
  type CsvToJsonOptions,
  type CsvToJsonResult,
  type JsonToCsvOptions,
  type JsonToCsvResult,
} from './json-csv'

function toCsv(json: unknown, o: Partial<JsonToCsvOptions> = {}) {
  const r: JsonToCsvResult = jsonToCsv(typeof json === 'string' ? json : JSON.stringify(json), o)
  if (!r.ok) throw new Error(r.error.message)
  return r
}

function toJson(csv: string, o: Partial<CsvToJsonOptions> = {}) {
  const r: CsvToJsonResult = csvToJson(csv, o)
  if (!r.ok) throw new Error(r.error.message)
  return { ...r, value: r.json ? (JSON.parse(r.json) as unknown) : undefined }
}

describe('helpers', () => {
  it('cellText', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(undefined)).toBe('')
    expect(cellText('x')).toBe('x')
    expect(cellText(1.5)).toBe('1.5')
    expect(cellText(false)).toBe('false')
    expect(cellText([1, 'a'])).toBe('[1,"a"]')
    expect(cellText({ a: 1 })).toBe('{"a":1}')
  })

  it('flattenRecord', () => {
    const rec = { a: 1, b: { c: 2, d: { e: 3 } }, f: [1], g: {}, h: null }
    expect([...flattenRecord(rec, true)]).toEqual([
      ['a', '1'],
      ['b.c', '2'],
      ['b.d.e', '3'],
      ['f', '[1]'],
      ['g', '{}'],
      ['h', ''],
    ])
    expect([...flattenRecord(rec, false)]).toEqual([
      ['a', '1'],
      ['b', '{"c":2,"d":{"e":3}}'],
      ['f', '[1]'],
      ['g', '{}'],
      ['h', ''],
    ])
    const collisions = new Set<string>()
    flattenRecord({ 'a.b': 1, a: { b: 2 } }, true, collisions)
    expect([...collisions]).toEqual(['a.b'])
  })

  it.each([
    ['', null],
    ['42', 42],
    ['-1.5', -1.5],
    ['1e3', 1000],
    [' 7 ', 7],
    ['007', '007'],
    ['+1', '+1'],
    ['1.', '1.'],
    ['12345678901234567890', '12345678901234567890'],
    ['true', true],
    ['TRUE', true],
    ['False', false],
    ['null', null],
    ['NULL', null],
    ['[1,2]', [1, 2]],
    ['{"a":1}', { a: 1 }],
    ['[not json]', '[not json]'],
    ['hello', 'hello'],
    ['中文', '中文'],
  ])('typeCell(%j) → %j', (s, v) => {
    expect(typeCell(s)).toEqual(v)
  })

  it('unflattenRecord', () => {
    expect(unflattenRecord({ id: 1, 'a.b': 2, 'a.c.d': 3, 't.0': 'x', 't.1': 'y' })).toEqual({
      id: 1,
      a: { b: 2, c: { d: 3 } },
      t: ['x', 'y'],
    })
    // 非连续数字键保持对象
    expect(unflattenRecord({ 'a.1': 1, 'a.2': 2 })).toEqual({ a: { 1: 1, 2: 2 } })
    // 空段、首尾点保持扁平
    expect(unflattenRecord({ 'a..b': 1, '.x': 2, 'y.': 3 })).toEqual({
      'a..b': 1,
      '.x': 2,
      'y.': 3,
    })
  })

  it('unflattenRecord keeps conflicting keys flat without losing data', () => {
    const conflicts = new Set<string>()
    expect(unflattenRecord({ 'a.b': 1, a: 2 }, conflicts)).toEqual({ 'a.b': 1, a: 2 })
    expect(unflattenRecord({ 'x.y.z': 1, 'x.y': 2 }, conflicts)).toEqual({
      x: { y: { z: 1 } },
      'x.y': 2,
    })
    expect([...conflicts].sort()).toEqual(['a.b', 'x.y'])
  })

  it('findRecordArrays', () => {
    expect(findRecordArrays({ code: 0, data: [{ a: 1 }], tags: ['x'], empty: [] })).toEqual([
      { key: 'data', length: 1 },
    ])
    expect(findRecordArrays([{ a: 1 }])).toEqual([])
  })

  it('guessDelimiter and withBom', () => {
    expect(guessDelimiter('a;b;c\n1;2')).toBe(';')
    expect(guessDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(guessDelimiter('a|b')).toBe('|')
    expect(guessDelimiter('a,b')).toBeNull()
    expect(guessDelimiter('single')).toBeNull()
    expect(withBom('a')).toBe('\uFEFFa')
    expect(withBom('\uFEFFa')).toBe('\uFEFFa')
  })
})

describe('JSON → CSV', () => {
  const USERS = [
    { id: 1, name: '张三', addr: { city: '北京', geo: { lat: 1.5 } }, tags: ['a', 'b'] },
    { id: 2, name: 'Li, "Lei"', vip: true },
  ]

  it('converts an array of objects with flattening and key union', () => {
    const r = toCsv(USERS)
    expect(r.csv).toBe(
      'id,name,addr.city,addr.geo.lat,tags,vip\n' +
        '1,张三,北京,1.5,"[""a"",""b""]",\n' +
        '2,"Li, ""Lei""",,,,true',
    )
    expect(r.table.headers).toEqual(['id', 'name', 'addr.city', 'addr.geo.lat', 'tags', 'vip'])
    expect(r.table.rows).toHaveLength(2)
    expect(r.warnings).toEqual([])
  })

  it('writes nested objects as JSON when flattening is off', () => {
    const r = toCsv(USERS, { flatten: false })
    expect(r.csv.split('\n')[0]).toBe('id,name,addr,tags,vip')
    expect(r.csv).toContain('"{""city"":""北京"",""geo"":{""lat"":1.5}}"')
  })

  it('supports delimiters, quoting, header toggle and CRLF', () => {
    const data = [{ a: 1, b: 'x y' }]
    expect(toCsv(data, { delimiter: ';' }).csv).toBe('a;b\n1;x y')
    expect(toCsv(data, { delimiter: '\t' }).csv).toBe('a\tb\n1\tx y')
    expect(toCsv(data, { delimiter: '|' }).csv).toBe('a|b\n1|x y')
    expect(toCsv(data, { quoteAll: true }).csv).toBe('"a","b"\n"1","x y"')
    expect(toCsv(data, { header: false }).csv).toBe('1,x y')
    expect(toCsv([{ a: 1 }, { a: 2 }], { newline: '\r\n' }).csv).toBe('a\r\n1\r\n2')
  })

  it('quotes fields containing the delimiter, quotes, newlines or edge spaces', () => {
    const r = toCsv([{ a: 'x,y', b: 'line1\nline2', c: ' pad', d: 'say "hi"' }])
    expect(r.csv).toBe('a,b,c,d\n"x,y","line1\nline2"," pad","say ""hi"""')
  })

  it('converts a single object to one row', () => {
    expect(toCsv({ a: 1, b: { c: 2 } }).csv).toBe('a,b.c\n1,2')
  })

  it('converts arrays of arrays as-is', () => {
    const r = toCsv([
      ['name', 'age'],
      ['张三', 20],
      ['李四', null, 'extra'],
    ])
    expect(r.csv).toBe('name,age\n张三,20\n李四,,extra')
    expect(r.table.headers).toEqual(['name', 'age', '列 3'])
    expect(r.table.rows).toEqual([
      ['张三', '20'],
      ['李四', '', 'extra'],
    ])
    expect(r.warnings).toHaveLength(1)
    expect(toCsv([[1, 2]], { header: false }).table.headers).toEqual(['列 1', '列 2'])
  })

  it('puts primitives into a value column', () => {
    expect(toCsv([1, 'a', null]).csv).toBe('value\n1\na\n')
    expect(toCsv('"x"').csv).toBe('value\nx')
    const mixed = toCsv([{ a: 1 }, 2])
    expect(mixed.csv).toBe('a,value\n1,\n,2')
    expect(mixed.warnings[0]).toContain('value')
  })

  it('drops an all-empty column shadowed by expanded columns', () => {
    const r = toCsv([{ addr: { city: 'x' } }, { addr: null }])
    expect(r.table.headers).toEqual(['addr.city'])
  })

  it('keeps a real column that is always null', () => {
    expect(toCsv([{ a: 1, deleted: null }]).table.headers).toEqual(['a', 'deleted'])
  })

  it('selects a record array by path and lists candidates', () => {
    const json = { code: 0, data: [{ id: 1 }, { id: 2 }] }
    const whole = toCsv(json)
    expect(whole.candidates).toEqual([{ key: 'data', length: 2 }])
    expect(whole.usedPath).toBeNull()
    const sub = toCsv(json, { path: 'data' })
    expect(sub.csv).toBe('id\n1\n2')
    expect(sub.usedPath).toBe('data')
    expect(toCsv(json, { path: 'missing' }).usedPath).toBeNull()
  })

  it('handles empty input and empty arrays', () => {
    expect(toCsv('  ').csv).toBe('')
    const empty = toCsv([])
    expect(empty.csv).toBe('')
    expect(empty.warnings[0]).toContain('数组为空')
    expect(toCsv([{}]).csv).toBe('')
  })

  it('reports JSON errors with position', () => {
    const r = jsonToCsv('[{"a": 1}, {"a": 2]')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.line).toBe(1)
      expect(r.error.column).toBeGreaterThan(1)
    }
  })

  it('handles large input', () => {
    const rows = Array.from({ length: 20000 }, (_, i) => ({ id: i, name: `n${i}`, x: { y: i } }))
    const t = Date.now()
    const r = toCsv(rows)
    expect(Date.now() - t).toBeLessThan(3000)
    expect(r.table.rows).toHaveLength(20000)
    expect(r.csv.split('\n')).toHaveLength(20001)
  })
})

describe('CSV → JSON', () => {
  it('converts with header, typing and unflatten', () => {
    const csv =
      'id,name,addr.city,vip,tags,zip,note\n1,张三,北京,true,"[""a""]",007,\n2,Lee,上海,FALSE,[],100080,hi'
    const { value, table, delimiter } = toJson(csv)
    expect(value).toEqual([
      {
        id: 1,
        name: '张三',
        addr: { city: '北京' },
        vip: true,
        tags: ['a'],
        zip: '007',
        note: null,
      },
      { id: 2, name: 'Lee', addr: { city: '上海' }, vip: false, tags: [], zip: 100080, note: 'hi' },
    ])
    expect(table.headers).toEqual(['id', 'name', 'addr.city', 'vip', 'tags', 'zip', 'note'])
    expect(table.rows[0]).toEqual([1, '张三', '北京', true, ['a'], '007', null])
    expect(delimiter).toBe(',')
  })

  it('keeps strings when typing is off and keys flat when unflatten is off', () => {
    const { value } = toJson('a.b,c\n1,', { dynamicTyping: false, unflatten: false })
    expect(value).toEqual([{ 'a.b': '1', c: '' }])
  })

  it('outputs arrays of arrays without a header row', () => {
    const { value, table } = toJson('1,a\n2,b,c', { header: false })
    expect(value).toEqual([
      [1, 'a'],
      [2, 'b', 'c'],
    ])
    expect(table.headers).toEqual(['列 1', '列 2', '列 3'])
  })

  it('auto-detects delimiters, including ragged files', () => {
    expect(toJson('a;b\n1;2').delimiter).toBe(';')
    expect(toJson('a\tb\n1\t2').value).toEqual([{ a: 1, b: 2 }])
    expect(toJson('a|b\n1|2').delimiter).toBe('|')
    const ragged = toJson('a;b\n1;2\n\n3;4;5\n6')
    expect(ragged.delimiter).toBe(';')
    expect(ragged.value).toEqual([
      { a: 1, b: 2 },
      { a: 3, b: 4, column3: 5 },
      { a: 6, b: null },
    ])
  })

  it('respects an explicit delimiter', () => {
    expect(toJson('a;b\n1;2', { delimiter: ',' }).value).toEqual([{ 'a;b': '1;2' }])
  })

  it('reports field count mismatches with source line numbers', () => {
    const { warnings } = toJson('a,b,c\n1,2,3\n\n4,5\n6,7,8,9')
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('第 4 行')
    expect(warnings[0]).toContain('少')
    expect(warnings[1]).toContain('第 5 行')
  })

  it('renames empty and duplicate headers', () => {
    const { value, warnings } = toJson(' a ,a,,b\n1,2,3,4')
    expect(value).toEqual([{ a: 1, a_2: 2, column3: 3, b: 4 }])
    expect(warnings[0]).toContain('a_2')
  })

  it('handles quoted fields with delimiters, quotes and newlines', () => {
    const { value } = toJson('a,b\n"x, y","say ""hi""\nbye"')
    expect(value).toEqual([{ a: 'x, y', b: 'say "hi"\nbye' }])
  })

  it('handles CRLF, BOM, emoji and blank lines', () => {
    const { value } = toJson('\uFEFFname,icon\r\n\r\n张三,😀\r\n')
    expect(value).toEqual([{ name: '张三', icon: '😀' }])
  })

  it('reports an unclosed quote with its position', () => {
    const r = csvToJson('a,b\n1,"x\n2,3')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.message).toContain('引号没有闭合')
      expect(r.error).toMatchObject({ line: 2, column: 3 })
      expect(r.error.frame).toBeDefined()
    }
  })

  it('reports malformed quotes', () => {
    const r = csvToJson('a,b\n1,"x"y')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.message).toContain('引号格式不正确')
      expect(r.error.line).toBe(2)
    }
  })

  it('handles header-only and blank input', () => {
    expect(toJson('a,b').value).toEqual([])
    expect(toJson('   ').json).toBe('')
  })

  it('uses the indent option', () => {
    expect(toJson('a\n1', { indent: 4 }).json).toBe('[\n    {\n        "a": 1\n    }\n]')
  })

  it('handles large input', () => {
    const csv = ['id,name,v.x'].concat(Array.from({ length: 20000 }, (_, i) => `${i},n${i},${i}`))
    const t = Date.now()
    const r = toJson(csv.join('\n'))
    expect(Date.now() - t).toBeLessThan(4000)
    expect((r.value as unknown[]).length).toBe(20000)
  })
})

describe('round trip', () => {
  it('JSON → CSV → JSON restores nested data', () => {
    const data = [
      { id: 1, name: '张三', addr: { city: '北京', zip: '010' }, tags: ['a', 'b'], ok: true },
      { id: 2, name: 'Li, "Lei"', addr: { city: '上海', zip: '021' }, tags: [], ok: false },
    ]
    const csv = toCsv(data).csv
    expect(toJson(csv).value).toEqual(data)
  })

  it('cannot tell numeric-looking strings from numbers once typing is on', () => {
    const csv = toCsv([{ code: '200' }]).csv
    expect(toJson(csv).value).toEqual([{ code: 200 }])
    expect(toJson(csv, { dynamicTyping: false }).value).toEqual([{ code: '200' }])
  })
})

describe('regressions', () => {
  it('keeps a __proto__ column as data', () => {
    const r = toJson('a,__proto__\n1,2')
    const rec = (r.value as Record<string, unknown>[])[0]
    expect(Object.keys(rec)).toEqual(['a', '__proto__'])
    expect(Object.getPrototypeOf(rec)).toBe(Object.prototype)
    expect(r.json).toContain('"__proto__": 2')
    expect(r.table.rows).toEqual([[1, 2]])
  })

  it('unflattens keys that share names with Object.prototype members', () => {
    const r = toJson('constructor.x,toString.y,hasOwnProperty\n1,2,3')
    expect(r.value).toEqual([{ constructor: { x: 1 }, toString: { y: 2 }, hasOwnProperty: 3 }])
    expect(r.warnings).toEqual([])
  })

  it('never pollutes prototypes while unflattening', () => {
    const out = unflattenRecord({ '__proto__.polluted': 1, 'a.__proto__.b': 2 })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(JSON.stringify(out)).toBe('{"__proto__":{"polluted":1},"a":{"__proto__":{"b":2}}}')
  })

  it('explains why empty objects produce no CSV', () => {
    expect(toCsv({}).warnings).toEqual(['对象没有任何字段，无法生成 CSV 列'])
    expect(toCsv([{}, {}]).warnings).toEqual(['所有对象都没有字段，无法生成 CSV 列'])
  })

  it('reports extremely deep data as an error instead of throwing', () => {
    const deep = '[{"a":' + '['.repeat(20000) + ']'.repeat(20000) + '}]'
    const r = jsonToCsv(deep)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toBe('数据嵌套层级过深，无法转换')
    const cell = 'a\n"' + '['.repeat(20000) + ']'.repeat(20000) + '"'
    expect(csvToJson(cell).ok).toBe(false)
  })
})

describe('large inputs', () => {
  it('handles 2D arrays and header-less CSV with 200k rows', () => {
    const rows = Array.from({ length: 200_000 }, (_, i) => [i, 'x'])
    const r = toCsv(rows, { header: false })
    expect(r.table.rows).toHaveLength(200_000)
    expect(r.table.headers).toEqual(['列 1', '列 2'])
    const back = toJson(r.csv, { header: false })
    expect((back.value as unknown[]).length).toBe(200_000)
    expect(back.table.headers).toEqual(['列 1', '列 2'])
  })
})
