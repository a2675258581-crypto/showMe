import { describe, expect, it } from 'vitest'
import {
  DEFAULT_JSON_XML_OPTIONS,
  convertJsonXml,
  isXmlName,
  jsonToXml,
  toXmlName,
  typeScalar,
  validateXml,
  xmlToJson,
  type JsonXmlOptions,
  type XmlConvertResult,
} from './json-xml'

type Ok = Extract<XmlConvertResult, { ok: true }>

function ok(r: XmlConvertResult): Ok {
  if (!r.ok) throw new Error(r.error.message)
  return r
}

const toXml = (json: unknown, o: Partial<JsonXmlOptions> = {}) =>
  ok(jsonToXml(typeof json === 'string' ? json : JSON.stringify(json), o))
const toJson = (xml: string, o: Partial<JsonXmlOptions> = {}) => {
  const r = ok(xmlToJson(xml, o))
  return { ...r, value: r.output ? (JSON.parse(r.output) as unknown) : undefined }
}

describe('helpers', () => {
  it.each([
    ['42', 42],
    ['-3.5', -3.5],
    ['0', 0],
    ['true', true],
    ['false', false],
    ['007', '007'],
    ['1.0', '1.0'],
    ['1.50', '1.50'],
    ['1e5', '1e5'],
    ['-0', '-0'],
    ['+1', '+1'],
    ['12345678901234567890', '12345678901234567890'],
    ['True', 'True'],
    ['', ''],
    ['abc', 'abc'],
    ['0x1F', '0x1F'],
  ])('typeScalar(%j) → %j', (s, expected) => {
    expect(typeScalar(s)).toBe(expected)
  })

  it('validates and sanitizes XML names', () => {
    expect(isXmlName('book')).toBe(true)
    expect(isXmlName('soap:Envelope')).toBe(true)
    expect(isXmlName('书名')).toBe(true)
    expect(isXmlName('first name')).toBe(false)
    expect(isXmlName('1abc')).toBe(false)
    expect(isXmlName('')).toBe(false)
    expect(toXmlName('first name')).toBe('first_name')
    expect(toXmlName('1abc')).toBe('_1abc')
    expect(toXmlName('')).toBe('_')
    expect(toXmlName('a@b')).toBe('a_b')
    expect(toXmlName('ok')).toBe('ok')
  })
})

describe('JSON → XML', () => {
  it('converts a single-root object with attributes and text nodes', () => {
    const r = toXml({
      catalog: {
        '@_ver': '1.0',
        book: [
          { '@_id': 'b1', title: 'A' },
          { '@_id': 'b2', title: 'B & C', note: { '@_type': 'tip', '#text': 'hi' } },
        ],
      },
    })
    expect(r.output).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<catalog ver="1.0">
  <book id="b1">
    <title>A</title>
  </book>
  <book id="b2">
    <title>B &amp; C</title>
    <note type="tip">hi</note>
  </book>
</catalog>`)
    expect(r.wrapped).toBe(false)
    expect(r.elements).toBe(6)
    expect(r.attributes).toBe(4)
    expect(r.warnings).toEqual([])
  })

  it('wraps multiple top-level keys, arrays and primitives in the root element', () => {
    expect(toXml({ a: 1, b: 2 }, { declaration: false }).output).toBe(
      '<root>\n  <a>1</a>\n  <b>2</b>\n</root>',
    )
    expect(toXml([1, 2], { declaration: false, rootName: 'list' }).output).toBe(
      '<list>\n  <item>1</item>\n  <item>2</item>\n</list>',
    )
    expect(toXml(42, { declaration: false }).output).toBe('<root>42</root>')
    const single = toXml({ users: [{ n: 1 }, { n: 2 }] }, { declaration: false })
    expect(single.wrapped).toBe(true)
    expect(single.output.startsWith('<root>')).toBe(true)
    expect(toXml({ '@_id': 1, a: 1 }, { declaration: false }).output).toBe(
      '<root id="1">\n  <a>1</a>\n</root>',
    )
  })

  it('handles null, empty strings, booleans and zero', () => {
    const r = toXml({ r: { a: null, b: '', c: 0, d: false } }, { declaration: false })
    expect(r.output).toBe('<r>\n  <a/>\n  <b/>\n  <c>0</c>\n  <d>false</d>\n</r>')
  })

  it('wraps nested arrays in <item>', () => {
    const r = toXml({ r: { m: [[1, 2], [3]] } }, { declaration: false, indent: 0 })
    expect(r.output).toBe('<r><m><item>1</item><item>2</item></m><m><item>3</item></m></r>')
  })

  it('renames invalid element names and reports it', () => {
    const r = toXml({ r: { 'first name': 'x', '2fa': true, 中文: '值' } }, { declaration: false })
    expect(r.output).toContain('<first_name>x</first_name>')
    expect(r.output).toContain('<_2fa>true</_2fa>')
    expect(r.output).toContain('<中文>值</中文>')
    expect(r.warnings[0]).toContain('“first name” → first_name')
  })

  it('dedupes names that collide after renaming', () => {
    const r = toXml({ r: { 'a b': 1, a_b: 2 } }, { declaration: false, indent: 0 })
    expect(r.output).toBe('<r><a_b>1</a_b><a_b_2>2</a_b_2></r>')
  })

  it('warns about empty arrays and object-valued attributes', () => {
    const r = toXml({ r: { list: [], '@_meta': { x: 1 }, keep: 1 } }, { declaration: false })
    expect(r.output).toBe('<r meta="{&quot;x&quot;:1}">\n  <keep>1</keep>\n</r>')
    expect(r.warnings.some((w) => w.includes('空数组') && w.includes('r.list'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('JSON 字符串'))).toBe(true)
  })

  it('escapes special characters in text and attributes', () => {
    const r = toXml(
      { r: { '@_q': 'a"b<c', t: '<tag> & "q" \'s\'' } },
      {
        declaration: false,
        indent: 0,
      },
    )
    expect(r.output).toBe(
      '<r q="a&quot;b&lt;c"><t>&lt;tag&gt; &amp; &quot;q&quot; &apos;s&apos;</t></r>',
    )
  })

  it('supports custom prefixes, text keys, indent and declarations', () => {
    const json = { r: { $id: '1', _: 'text' } }
    const r = toXml(json, { attrPrefix: '$', textKey: '_', declaration: false, indent: 0 })
    expect(r.output).toBe('<r id="1">text</r>')
    const noPrefix = toXml({ r: { '@_id': 1 } }, { attrPrefix: '', declaration: false, indent: 0 })
    expect(noPrefix.output).toBe('<r><__id>1</__id></r>')
    expect(toXml({ a: { b: 1 } }, { indent: 4, declaration: false }).output).toBe(
      '<a>\n    <b>1</b>\n</a>',
    )
    expect(toXml({ a: { b: 1 } }, { indent: 'tab', declaration: false }).output).toBe(
      '<a>\n\t<b>1</b>\n</a>',
    )
    expect(toXml({ a: 1 }, { indent: 0 }).output).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><a>1</a>',
    )
  })

  it('reuses an existing ?xml declaration, or drops it when declarations are off', () => {
    const json = { '?xml': { '@_version': '1.0', '@_standalone': 'yes' }, a: { b: 1 } }
    expect(toXml(json).output.split('\n')[0]).toBe('<?xml version="1.0" standalone="yes"?>')
    expect(toXml(json, { declaration: false }).output).toBe('<a>\n  <b>1</b>\n</a>')
  })

  it('sanitizes an invalid root name', () => {
    expect(toXml([1], { rootName: 'my list', declaration: false, indent: 0 }).output).toBe(
      '<my_list><item>1</item></my_list>',
    )
    expect(toXml([1], { rootName: '  ', declaration: false, indent: 0 }).output).toBe(
      '<root><item>1</item></root>',
    )
  })

  it('returns empty output for blank input', () => {
    expect(toXml('  ').output).toBe('')
  })

  it('reports JSON syntax errors with position', () => {
    const r = jsonToXml('{\n  "a": 1\n  "b": 2\n}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.line).toBe(3)
      expect(r.error.message).toContain('逗号')
    }
  })
})

describe('XML → JSON', () => {
  const XML = `<?xml version="1.0"?>
<order id="SO-1" vip="true">
  <item sku="A"><qty>1</qty><price>1.50</price><zip>007</zip></item>
  <item sku="B"><qty>2</qty><price>2.5</price></item>
  <note>a &amp; b</note>
  <remark><![CDATA[x < y]]></remark>
  <empty/>
</order>`

  it('converts with attribute prefix, arrays and typed values', () => {
    const { value, elements, attributes } = toJson(XML)
    expect(value).toEqual({
      order: {
        '@_id': 'SO-1',
        '@_vip': true,
        item: [
          { '@_sku': 'A', qty: 1, price: '1.50', zip: '007' },
          { '@_sku': 'B', qty: 2, price: 2.5 },
        ],
        note: 'a & b',
        remark: 'x < y',
        empty: '',
      },
    })
    expect(elements).toBe(11)
    expect(attributes).toBe(4)
  })

  it('keeps strings when value parsing is off', () => {
    const { value } = toJson('<a n="1"><b>2</b><c>true</c></a>', { parseValues: false })
    expect(value).toEqual({ a: { '@_n': '1', b: '2', c: 'true' } })
  })

  it('keeps the declaration when asked, without typing it', () => {
    const { value } = toJson('<?xml version="1.0"?><a>1</a>', { ignoreDeclaration: false })
    expect(value).toEqual({ '?xml': { '@_version': '1.0' }, a: 1 })
  })

  it('uses the text key for mixed attribute + text', () => {
    const { value } = toJson('<a id="1">hi</a>', { textKey: '_' })
    expect(value).toEqual({ a: { '@_id': 1, _: 'hi' } })
  })

  it('merges attributes into keys when the prefix is empty', () => {
    const { value } = toJson('<a id="1"><b>2</b></a>', { attrPrefix: '' })
    expect(value).toEqual({ a: { id: 1, b: 2 } })
  })

  it('handles unicode, namespaces and indent options', () => {
    const r = toJson('<soap:Envelope xmlns:soap="x"><名字>张三 😀</名字></soap:Envelope>', {
      indent: 0,
    })
    expect(r.output).toBe('{"soap:Envelope":{"@_xmlns:soap":"x","名字":"张三 😀"}}')
    expect(toJson('<a>1</a>', { indent: 4 }).output).toBe('{\n    "a": 1\n}')
    expect(toJson('<a>1</a>', { indent: 'tab' }).output).toBe('{\n\t"a": 1\n}')
  })

  it('strips a BOM and handles blank input', () => {
    expect(toJson('\uFEFF<a>1</a>').value).toEqual({ a: 1 })
    expect(toJson('   ').output).toBe('')
  })

  it('warns about multiple roots the validator lets through', () => {
    const r = toJson('<a></a>\n<b/>')
    expect(r.warnings[0]).toContain('2 个根元素')
  })

  it('handles a large document', () => {
    const xml = `<list>${Array.from({ length: 5000 }, (_, i) => `<i n="${i}">v${i}</i>`).join('')}</list>`
    const r = toJson(xml)
    expect(r.elements).toBe(5001)
    expect((r.value as { list: { i: unknown[] } }).list.i).toHaveLength(5000)
  })
})

describe('XML errors', () => {
  const err = (xml: string) => {
    const r = xmlToJson(xml)
    if (r.ok) throw new Error('expected an error')
    return r.error
  }

  it('reports mismatched closing tags with line and column', () => {
    const e = err('<a>\n  <b>\n</a>')
    expect(e.message).toBe('这里应为 </b>（开始标签在第 2 行第 3 列），却遇到了 </a>')
    expect(e).toMatchObject({ line: 3, column: 1 })
    expect(e.frame?.lines.find((l) => l.error)?.text).toBe('</a>')
  })

  it('points at the innermost unclosed tag', () => {
    const e = err('<a>\n  <b>\n    <c>')
    expect(e.message).toBe('以下标签没有闭合：<a>、<b>、<c>')
    expect(e).toMatchObject({ line: 3, column: 5 })
  })

  it('reports a single unclosed tag', () => {
    expect(err('<a><b></b>').message).toBe('标签 <a> 没有闭合')
  })

  it('reports attributes without values', () => {
    const e = err('<a>\n<input disabled/>\n</a>')
    expect(e.message).toContain('属性 disabled 缺少值')
    expect(e.line).toBe(2)
  })

  it('reports a second root element at its start tag', () => {
    const e = err('<a></a>\n<b></b>')
    expect(e.message).toContain('只能有一个根元素')
    expect(e.hint).toBeDefined()
    expect(e).toMatchObject({ line: 2, column: 1 })
  })

  it('reports stray text, bare ampersands and duplicate attributes', () => {
    expect(err('hello').message).toContain('意外的字符 “h”')
    expect(err('<a>x & y</a>').message).toContain('&amp;')
    expect(err('<a b="1" b="2"/>').message).toBe('属性 b 重复出现')
    expect(err('<1a/>').message).toContain('标签名 1a 不合法')
  })

  it('validateXml returns null for valid XML', () => {
    expect(validateXml('<a><b/></a>')).toBeNull()
  })
})

describe('round trip', () => {
  it('XML → JSON → XML keeps the structure', () => {
    const xml = `<catalog ver="2">
  <book id="b1" lang="zh">
    <title>三体</title>
    <price>23.5</price>
    <tags>
      <tag>科幻</tag>
      <tag>雨果奖</tag>
    </tags>
  </book>
  <book id="b2">
    <title>Note &amp; more</title>
    <price>45</price>
  </book>
</catalog>`
    const json = ok(xmlToJson(xml)).output
    const back = ok(jsonToXml(json, { declaration: false })).output
    expect(back).toBe(xml)
  })

  it('convertJsonXml dispatches by direction', () => {
    expect(ok(convertJsonXml('json2xml', '{"a":1}', { declaration: false })).output).toBe(
      '<a>1</a>',
    )
    expect(ok(convertJsonXml('xml2json', '<a>1</a>', { indent: 0 })).output).toBe('{"a":1}')
  })

  it('exposes defaults', () => {
    expect(DEFAULT_JSON_XML_OPTIONS).toMatchObject({ attrPrefix: '@_', textKey: '#text' })
  })
})

describe('regressions', () => {
  it('decodes numeric character references without double-decoding &amp;', () => {
    expect(toJson('<a x="&#65;">&#20013;&#x6587;&#x1F600; &amp;#65; &lt;</a>').value).toEqual({
      a: { '@_x': 'A', '#text': '中文😀 &#65; <' },
    })
  })

  it('keeps a __proto__ key as a normal element instead of dropping it', () => {
    const r = toXml({ a: JSON.parse('{"__proto__":{"x":1},"b":2}') as unknown })
    expect(r.output).toContain('<__proto__>')
    expect(r.output).toContain('<x>1</x>')
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it('rejects an attribute called __proto__ with a located Chinese error', () => {
    const r = xmlToJson('<a __proto__="x" b="1"/>', { attrPrefix: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.message).toContain('保留名')
      expect([r.error.line, r.error.column]).toEqual([1, 4])
    }
    // 带前缀时键名是 @___proto__，可以正常转换
    expect(toJson('<a __proto__="x"/>').value).toEqual({ a: { '@___proto__': 'x' } })
  })

  it('reports extremely deep JSON as an error instead of throwing', () => {
    const deep = '['.repeat(20000) + ']'.repeat(20000)
    const r = jsonToXml(deep)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toBe('JSON 嵌套层级过深，无法转换为 XML')
  })

  it('reports overly deep XML in Chinese', () => {
    const deep = '<a>'.repeat(1200) + '</a>'.repeat(1200)
    const r = xmlToJson(deep)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toContain('嵌套层级过深')
  })

  it('points at a tag name that is reserved in JavaScript', () => {
    const r = xmlToJson('<a>\n  <__proto__>1</__proto__>\n</a>')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.message).toContain('__proto__')
      expect(r.error.message).not.toMatch(/SECURITY/)
      expect([r.error.line, r.error.column]).toEqual([2, 3])
    }
  })

  it('warns when the root name had to be sanitized', () => {
    const r = toXml({ a: 1, b: 2 }, { rootName: '1 bad' })
    expect(r.output).toContain('<_1_bad>')
    expect(r.warnings.join()).toContain('根元素名 “1 bad” 不是合法的 XML 名称，已改为 _1_bad')
    // 不需要包裹时不提示
    expect(toXml({ a: { b: 1 } }, { rootName: '1 bad' }).warnings).toEqual([])
  })

  it('warns about dropped processing instructions', () => {
    const r = toXml({ '?xml-stylesheet': { '@_href': 'a.xsl' }, a: 1 })
    expect(r.output).not.toContain('xml-stylesheet')
    expect(r.warnings.join()).toContain('?xml-stylesheet')
  })

  it('labels an empty root array and nested empty arrays by their path', () => {
    expect(toXml([]).warnings).toEqual(['空数组无法用 XML 表示，已省略：（根数组）'])
    expect(toXml({ a: [[], [1]] }).warnings).toEqual(['空数组无法用 XML 表示，已省略：a[0]'])
  })
})

describe('empty text key', () => {
  it('falls back to #text in both directions', () => {
    expect(toJson('<a x="1">t</a>', { textKey: '' }).value).toEqual({
      a: { '@_x': 1, '#text': 't' },
    })
    expect(toJson('<a x="1">t<b/></a>', { textKey: '' }).elements).toBe(2)
    expect(toXml({ a: { '@_x': 1, '#text': 't' } }, { textKey: '' }).output).toContain(
      '<a x="1">t</a>',
    )
    expect(toXml({ a: { '': 1 } }, { textKey: '' }).output).toContain('<_>1</_>')
  })
})
