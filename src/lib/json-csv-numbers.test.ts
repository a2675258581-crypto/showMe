import { describe, expect, it } from 'vitest'
import { isLossyNumber, numberWarning, parseJsonExact, significantDigits } from './json-csv-numbers'
import { csvToJson, jsonToCsv, typeCell } from './json-csv'
import { jsonToXml } from './json-xml'

describe('significantDigits', () => {
  it.each([
    ['0', 1],
    ['-0.001', 1],
    ['1.50', 2],
    ['123456789012345678', 18],
    ['1.2345e10', 5],
    ['0.12345678901234567890', 19],
  ])('%s → %i', (src, n) => {
    expect(significantDigits(src)).toBe(n)
  })
})

describe('isLossyNumber', () => {
  // 用 Number(源码) 模拟 JSON.parse 得到的值
  const lossy = (src: string) => isLossyNumber(src, Number(src))

  it('flags integers beyond ±2^53 and overflow', () => {
    expect(lossy('9007199254740991')).toBe(false)
    expect(lossy('9007199254740993')).toBe(true)
    expect(lossy('-1234567890123456789')).toBe(true)
    expect(isLossyNumber('1e400', Infinity)).toBe(true)
    expect(isLossyNumber('1e-400', 0)).toBe(true)
  })

  it('accepts ordinary numbers, including ones written differently', () => {
    expect(isLossyNumber('0.1', 0.1)).toBe(false)
    expect(isLossyNumber('1.0', 1)).toBe(false)
    expect(isLossyNumber('1e3', 1000)).toBe(false)
    expect(isLossyNumber('0.30000000000000004', 0.30000000000000004)).toBe(false)
    expect(isLossyNumber('0.0', 0)).toBe(false)
  })

  it('flags decimals with more than 15 significant digits that do not round-trip', () => {
    expect(lossy('0.12345678901234567890')).toBe(true)
    expect(lossy('3.14159265358979323846')).toBe(true)
  })
})

describe('parseJsonExact', () => {
  it('replaces lossy numbers with their source text', () => {
    const r = parseJsonExact(
      '{"id":1234567890123456789,"n":1.5,"s":"1234567890123456789","x":1e400}',
    )
    expect(r.value).toEqual({
      id: '1234567890123456789',
      n: 1.5,
      s: '1234567890123456789',
      x: '1e400',
    })
    expect(r.preserved).toEqual(['1234567890123456789', '1e400'])
    expect(r.lossy).toEqual([])
    expect(numberWarning(r)).toBeNull()
  })

  it('skips the reviver pass for ordinary input and handles a BOM', () => {
    const r = parseJsonExact('\uFEFF[1, 2.5, "中文", {"a": null}]')
    expect(r.value).toEqual([1, 2.5, '中文', { a: null }])
    expect(r.preserved).toEqual([])
  })

  it('warns when precision was actually lost', () => {
    expect(
      numberWarning({ value: null, preserved: [], lossy: ['1e21', '2e21', '3e21', '4e21'] }),
    ).toBe(
      '有数字超出 JavaScript 的精度范围，结果可能与原文不同：1e21、2e21、3e21 等 4 个（可以在 JSON 里把它们写成字符串）',
    )
  })
})

describe('exact numbers end to end', () => {
  it('JSON → CSV keeps 19-digit IDs exactly', () => {
    const r = jsonToCsv('[{"id":1234567890123456789,"price":9.99,"big":1e400}]')
    expect(r.ok && r.csv).toBe('id,price,big\n1234567890123456789,9.99,1e400')
    expect(r.ok && r.warnings).toEqual([])
  })

  it('JSON → XML keeps 19-digit IDs exactly', () => {
    const r = jsonToXml('{"order":{"@_id":1234567890123456789,"total":0.12345678901234567890}}')
    expect(r.ok && r.output).toContain('<order id="1234567890123456789">')
    expect(r.ok && r.output).toContain('<total>0.12345678901234567890</total>')
  })

  it('CSV → JSON keeps lossy numbers as strings', () => {
    expect(typeCell('0.12345678901234567890')).toBe('0.12345678901234567890')
    expect(typeCell('12.5')).toBe(12.5)
    const r = csvToJson('id,v\n1234567890123456789,1e400')
    expect(r.ok && JSON.parse(r.json)).toEqual([{ id: '1234567890123456789', v: '1e400' }])
  })
})
