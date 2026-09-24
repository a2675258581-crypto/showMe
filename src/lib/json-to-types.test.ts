import { describe, expect, it } from 'vitest'
import {
  inferModel,
  modelStats,
  normalizeRootName,
  parseSamples,
  type ObjectDef,
  type TypeModel,
  type TypeRef,
} from './json-to-types'

/** 把 TypeRef 写成紧凑的字符串，方便断言 */
function show(t: TypeRef): string {
  let s: string
  switch (t.kind) {
    case 'primitive':
      s = t.type
      break
    case 'any':
      s = 'any'
      break
    case 'array':
      s = `${show(t.item)}[]`
      break
    case 'map':
      s = `map<${show(t.value)}>`
      break
    case 'object':
      s = t.def.name
      break
    case 'union':
      s = `(${t.members.map(show).join('|')})`
      break
  }
  return t.nullable ? `${s}?` : s
}

function modelOf(json: string, rootName?: string): TypeModel {
  const r = parseSamples(json)
  if (!r.ok) throw new Error(r.error.message)
  return inferModel(r.samples, { rootName })
}

function obj(model: TypeModel, name: string): ObjectDef {
  const d = model.objects.find((o) => o.name === name)
  if (!d) throw new Error(`no ${name} in ${model.objects.map((o) => o.name).join(',')}`)
  return d
}

/** { key: 'type' }，可选字段键名后加 ~ */
function fields(d: ObjectDef): Record<string, string> {
  return Object.fromEntries(d.fields.map((f) => [f.key + (f.optional ? '~' : ''), show(f.type)]))
}

describe('parseSamples', () => {
  it('parses a single JSON document', () => {
    const r = parseSamples('{"a":1}')
    expect(r).toMatchObject({ ok: true, samples: [{ a: 1 }], jsonLines: false, empty: false })
  })

  it('treats blank input as empty', () => {
    expect(parseSamples('  \n ')).toMatchObject({ ok: true, empty: true, samples: [] })
    expect(parseSamples('')).toMatchObject({ ok: true, empty: true })
  })

  it('strips a BOM', () => {
    expect(parseSamples('\uFEFF[1]')).toMatchObject({ ok: true, samples: [[1]] })
  })

  it('accepts JSON Lines', () => {
    const r = parseSamples('{"a":1}\n\n{"a":2,"b":"x"}\r\n')
    expect(r).toMatchObject({ ok: true, jsonLines: true })
    if (r.ok) expect(r.samples).toHaveLength(2)
  })

  it('reports syntax errors with line and column', () => {
    const r = parseSamples('{\n  "a": 1,\n  "b": \n}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.line).toBe(4)
      expect(r.error.column).toBe(1)
      expect(r.error.message).toMatch(/[一-龥]/)
      expect(r.error.frame).toBeDefined()
    }
  })

  it('reports trailing commas precisely', () => {
    const r = parseSamples('{"a": 1,}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.message).toContain('尾随逗号')
      expect(r.error.column).toBe(8)
    }
  })
})

describe('inferModel: primitives and root', () => {
  it('infers primitives', () => {
    const m = modelOf('{"s":"x","i":1,"f":1.5,"b":true,"n":null}')
    expect(fields(obj(m, 'Root'))).toEqual({
      s: 'string',
      i: 'integer',
      f: 'number',
      b: 'boolean',
      n: 'any?',
    })
  })

  it('treats 1.0 in the source as a float', () => {
    const m = modelOf('{"price": 1.0, "count": 1, "exp": 1e3}')
    expect(fields(obj(m, 'Root'))).toEqual({ price: 'number', count: 'integer', exp: 'number' })
  })

  it('treats integers beyond int64 as floats', () => {
    const m = modelOf('{"big": 1e20, "huge": 99999999999999999999}')
    expect(fields(obj(m, 'Root'))).toEqual({ big: 'number', huge: 'number' })
  })

  it('handles non-object roots', () => {
    expect(show(modelOf('[1, 2, 3]').root)).toBe('integer[]')
    expect(show(modelOf('"x"').root)).toBe('string')
    expect(show(modelOf('null').root)).toBe('any?')
    expect(show(modelOf('[]').root)).toBe('any[]')
    expect(modelOf('[]').objects).toEqual([])
  })

  it('names root array items from the root name', () => {
    expect(show(modelOf('[{"a":1}]').root)).toBe('RootItem[]')
    expect(show(modelOf('[{"a":1}]', 'Users').root)).toBe('User[]')
    expect(show(modelOf('[{"a":1}]', 'user list').root)).toBe('UserListItem[]')
  })

  it('normalizes the root name', () => {
    expect(normalizeRootName('api response')).toBe('ApiResponse')
    expect(normalizeRootName('')).toBe('Root')
    expect(normalizeRootName('   ')).toBe('Root')
    expect(normalizeRootName('🔥')).toBe('Root')
    expect(normalizeRootName('用户')).toBe('用户')
    expect(modelOf('{"a":1}', 'my_model').objects[0].name).toBe('MyModel')
  })
})

describe('inferModel: arrays and merging', () => {
  it('merges object shapes across array items', () => {
    const m = modelOf(
      '{"items":[{"id":1,"name":"a"},{"id":2,"price":1.5},{"id":3,"name":null,"price":2}]}',
    )
    expect(fields(obj(m, 'Item'))).toEqual({
      id: 'integer',
      'name~': 'string?',
      'price~': 'number',
    })
  })

  it('creates unions for mixed primitives and keeps null separate', () => {
    const m = modelOf('{"v":[1,"a",true,null]}')
    expect(fields(obj(m, 'Root'))).toEqual({ v: '(string|integer|boolean)?[]' })
  })

  it('merges integers and floats into number', () => {
    const m = modelOf('{"v":[1, 2.5]}')
    expect(fields(obj(m, 'Root'))).toEqual({ v: 'number[]' })
  })

  it('infers unknown for empty arrays and map for empty objects', () => {
    const m = modelOf('{"a":[],"b":{}}')
    expect(fields(obj(m, 'Root'))).toEqual({ a: 'any[]', b: 'map<any>' })
  })

  it('uses items from non-empty arrays when some arrays are empty', () => {
    const m = modelOf('{"rows":[{"tags":[]},{"tags":["x"]}]}')
    expect(fields(obj(m, 'Row'))).toEqual({ tags: 'string[]' })
  })

  it('handles nested arrays', () => {
    const m = modelOf('{"matrix":[[1,2],[3]],"groups":[[{"a":1}]]}')
    const root = fields(obj(m, 'Root'))
    expect(root.matrix).toBe('integer[][]')
    expect(root.groups).toMatch(/^\w+\[\]\[\]$/)
  })

  it('unions objects with primitives', () => {
    const m = modelOf('{"v":[{"a":1},"x"]}')
    expect(fields(obj(m, 'Root'))).toEqual({ v: '(string|VItem)[]' })
  })

  it('marks a field nullable when null appears in any sample', () => {
    const m = modelOf('[{"a":1},{"a":null}]')
    expect(fields(obj(m, 'RootItem'))).toEqual({ a: 'integer?' })
  })

  it('merges JSON Lines samples as observations of the root', () => {
    const m = modelOf('{"a":1}\n{"a":2,"b":"x"}')
    expect(fields(obj(m, 'Root'))).toEqual({ a: 'integer', 'b~': 'string' })
  })

  it('handles a large array quickly', () => {
    const rows = Array.from({ length: 20000 }, (_, i) => ({
      id: i,
      name: `user${i}`,
      ...(i % 3 ? { email: 'a@b.c' } : {}),
      tags: i % 2 ? ['a'] : [],
    }))
    const t = Date.now()
    const m = modelOf(JSON.stringify(rows))
    expect(Date.now() - t).toBeLessThan(3000)
    expect(fields(obj(m, 'RootItem'))).toEqual({
      id: 'integer',
      name: 'string',
      'email~': 'string',
      tags: 'string[]',
    })
  })

  it('degrades gracefully on extremely deep nesting', () => {
    const deep = '['.repeat(3000) + ']'.repeat(3000)
    const m = modelOf(deep)
    expect(show(m.root)).toMatch(/any/)
  })
})

describe('inferModel: naming and dedupe', () => {
  it('names nested types from keys', () => {
    const m = modelOf('{"userProfile":{"a":1},"order_items":[{"b":1}],"categories":[{"c":1}]}')
    expect(m.objects.map((o) => o.name)).toEqual(['Root', 'UserProfile', 'OrderItem', 'Category'])
  })

  it('dedupes identical structures and picks a common name', () => {
    const m = modelOf(
      '{"billingAddress":{"city":"a","zip":"1"},"shippingAddress":{"zip":"2","city":"b"}}',
    )
    expect(m.objects.map((o) => o.name)).toEqual(['Root', 'Address'])
    expect(fields(obj(m, 'Root'))).toEqual({
      billingAddress: 'Address',
      shippingAddress: 'Address',
    })
  })

  it('does not dedupe structures that differ', () => {
    const m = modelOf('{"a":{"x":1},"b":{"x":"s"}}')
    expect(m.objects.map((o) => o.name)).toEqual(['Root', 'A', 'B'])
  })

  it('resolves name clashes with the parent name, then numbers', () => {
    const m = modelOf('{"order":{"items":[{"sku":"a"}]},"cart":{"items":[{"qty":1}]}}')
    expect(m.objects.map((o) => o.name)).toEqual(['Root', 'Order', 'Item', 'Cart', 'CartItem'])
  })

  it('avoids reserved type names', () => {
    const m = modelOf('{"data":{"a":1},"string":{"b":1}}')
    expect(m.objects.map((o) => o.name)).toEqual(['Root', 'RootData', 'RootString'])
    const top = modelOf('{"a":1}', 'Data')
    expect(top.objects[0].name).toBe('Data')
  })

  it('names data arrays DataItem and handles odd keys', () => {
    const m = modelOf('{"data":[{"a":1}],"🔥":{"b":1},"2fa":{"c":1},"用户":{"d":1}}')
    expect(m.objects.map((o) => o.name)).toEqual(['Root', 'DataItem', 'RootType', 'T2fa', '用户'])
  })

  it('does not reuse the root name for nested types', () => {
    const m = modelOf('{"root":{"a":1}}')
    expect(m.objects.map((o) => o.name)).toEqual(['Root', 'RootRoot'])
  })

  it('keeps field order from first appearance', () => {
    const m = modelOf('[{"b":1,"a":2},{"c":3,"a":1}]')
    expect(obj(m, 'RootItem').fields.map((f) => f.key)).toEqual(['b', 'a', 'c'])
  })
})

describe('modelStats', () => {
  it('counts types and fields', () => {
    const m = modelOf('[{"a":1,"b":null},{"a":2,"c":{"d":1}}]')
    expect(modelStats(m)).toEqual({ types: 2, fields: 4, optional: 2, nullable: 1 })
  })
})

describe('parseSamples · JSON Lines errors', () => {
  it('points at the broken line of a JSON Lines input', () => {
    const r = parseSamples('{"a":1}\n\n{"a":2,\n{"a":3}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.message).toMatch(/^JSON Lines 第 3 行：/)
      expect(r.error.line).toBe(3)
      expect(r.error.column).toBe(8)
      expect(r.error.frame?.line).toBe(3)
    }
  })

  it('still reports a pretty-printed document as a whole', () => {
    const r = parseSamples('{\n  "a": 1,\n}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.message).not.toContain('JSON Lines')
      expect(r.error.message).toContain('尾随逗号')
    }
  })
})
