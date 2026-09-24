import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import {
  DEFAULT_OPTIONS,
  convertJsonYaml,
  displayTag,
  findUnclosedFlow,
  findUnclosedQuote,
  jsonToYaml,
  locateJsonError,
  parseJson,
  sortKeysDeep,
  translateYamlReason,
  yamlToJson,
  type ConvertResult,
  type JsonYamlOptions,
} from './json-yaml'
import { JSON_SAMPLE, YAML_SAMPLE } from './json-yaml-samples'

const opts = (o: Partial<JsonYamlOptions> = {}): JsonYamlOptions => ({ ...DEFAULT_OPTIONS, ...o })

function ok(r: ConvertResult) {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error.message}`)
  return r
}
function fail(r: ConvertResult) {
  if (r.ok) throw new Error(`expected error, got output: ${r.output}`)
  return r.error
}

describe('parseJson / locateJsonError', () => {
  it('parses valid JSON and strips a BOM', () => {
    expect(parseJson('\uFEFF{"a":[1,2]}')).toEqual({ ok: true, value: { a: [1, 2] } })
  })

  it.each([
    ['{"a": 1,}', '尾随逗号', 1, 8],
    ['[1, 2,\n]', '尾随逗号', 1, 6],
    ["{'a': 1}", '单引号', 1, 2],
    ['{a: 1}', '双引号', 1, 2],
    ['{"a" 1}', '冒号', 1, 6],
    ['{"a": 1 "b": 2}', '缺少逗号', 1, 9],
    ['[1 2]', '缺少逗号', 1, 4],
    ['{"a": 01}', '前导零', 1, 7],
    ['{"a": 1.}', '小数点', 1, 7],
    ['{"a": .5}', '0.5', 1, 7],
    ['{"a": +1}', '+ 号', 1, 7],
    ['{"a": 0x1F}', '十六进制', 1, 7],
    ['{"a": 1e}', '指数', 1, 7],
    ['{"a": True}', 'true', 1, 7],
    ['{"a": undefined}', 'undefined', 1, 7],
    ['{"a": NaN}', 'NaN', 1, 7],
    ['name: demo', '双引号括起来', 1, 1],
    ['{"a": "x\\q"}', '转义', 1, 9],
    ['{"a": "\\u12G4"}', 'Unicode', 1, 8],
    ['{"a": "line\nbreak"}', '换行', 1, 12],
    ['{"a": "tab\there"}', 'Tab', 1, 11],
    ['{"a": 1} {"b": 2}', '多余内容', 1, 10],
    ['{\n  // 注释\n  "a": 1\n}', '注释', 2, 3],
    ['{"a": [1, 2}', '此处应为逗号或 ]', 1, 12],
    ['{"a": "unterminated', '没有闭合', 1, 7],
    ['{"a": 1', '缺少结尾的 }', 1, 8],
    ['[1, [2, 3]', '缺少结尾的 ]', 1, 11],
    ['{"a":\u00A01}', 'U+00A0', 1, 6],
    ['', '意外结束', 1, 1],
  ])('%j → %s at %i:%i', (src, msg, line, column) => {
    const r = parseJson(src)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.message).toContain(msg)
    expect([r.error.line, r.error.column]).toEqual([line, column])
    expect(r.error.frame?.line).toBe(line)
  })

  it('counts columns in code points so 中文 / emoji do not shift the caret', () => {
    const e = locateJsonError('{"名字": "😀", oops}')
    expect(e.line).toBe(1)
    expect(e.column).toBe(13)
    expect(e.frame?.caretPrefix).toBe('{"名字": "😀", ')
  })

  it('reports multi-line positions', () => {
    const e = locateJsonError('{\n  "a": 1,\n  "b": [1, 2,],\n  "c": 3\n}')
    expect(e.message).toContain('尾随逗号')
    expect([e.line, e.column]).toEqual([3, 13])
    expect(e.frame?.lines.map((l) => l.no)).toEqual([1, 2, 3, 4, 5])
  })

  it('clips very long minified lines around the error', () => {
    const big = '[' + Array.from({ length: 5000 }, (_, i) => i).join(',') + ',]'
    const e = locateJsonError(big)
    expect(e.message).toContain('尾随逗号')
    expect(e.line).toBe(1)
    const errLine = e.frame!.lines.find((l) => l.error)!
    expect(errLine.text.length).toBeLessThan(110)
    expect(errLine.text.startsWith('…')).toBe(true)
  })
})

describe('sortKeysDeep', () => {
  it('sorts nested object keys and keeps array order', () => {
    const v = sortKeysDeep({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 2 } })
    expect(JSON.stringify(v)).toBe('{"a":{"c":2,"d":[{"y":2,"z":1}]},"b":1}')
  })
})

describe('__proto__ keys (regression)', () => {
  it('sortKeysDeep keeps __proto__ as an own key instead of changing the prototype', () => {
    const v = JSON.parse('{"b":1,"__proto__":{"x":1},"a":2}')
    const sorted = sortKeysDeep(v) as Record<string, unknown>
    expect(Object.keys(sorted)).toEqual(['__proto__', 'a', 'b'])
    expect(Object.getPrototypeOf(sorted)).toBe(Object.prototype)
  })

  it('converts __proto__ keys in both directions with sortKeys on', () => {
    expect(
      ok(jsonToYaml('{"b":1,"__proto__":{"x":1},"a":2}', opts({ sortKeys: true }))).output,
    ).toBe('__proto__:\n  x: 1\na: 2\nb: 1\n')
    expect(
      JSON.parse(ok(yamlToJson('__proto__:\n  x: 1\nb: 2\n', opts({ sortKeys: true }))).output),
    ).toEqual(JSON.parse('{"__proto__":{"x":1},"b":2}'))
  })
})

describe('deep nesting (regression)', () => {
  it('returns an error instead of throwing a RangeError from JSON → YAML', () => {
    const deep = '['.repeat(50000) + ']'.repeat(50000)
    expect(() => jsonToYaml(deep)).not.toThrow()
    expect(fail(jsonToYaml(deep)).message).toBe('嵌套层级过深，超出了浏览器的处理能力')
    expect(fail(jsonToYaml(deep, opts({ sortKeys: true }))).message).toContain('嵌套层级过深')
  })

  it('reports moderately deep input without leaking the English engine message', () => {
    const e = fail(jsonToYaml('['.repeat(3000) + ']'.repeat(3000)))
    expect(e.message).not.toMatch(/call stack/i)
  })
})

describe('jsonToYaml', () => {
  it('returns empty output for blank input', () => {
    expect(ok(jsonToYaml('  \n'))).toMatchObject({ output: '', docCount: 0 })
  })

  it('converts nested structures and quotes ambiguous strings', () => {
    const out = ok(
      jsonToYaml(
        '{"name":"服务 🚀","on":"yes","ver":"1.0","n":null,"t":true,"list":[1,"2024-01-01",{"k":"a: b"}],"empty":{},"arr":[]}',
      ),
    ).output
    expect(out).toBe(
      [
        'name: 服务 🚀',
        "'on': 'yes'",
        "ver: '1.0'",
        "'n': null",
        't: true',
        'list:',
        '  - 1',
        "  - '2024-01-01'",
        "  - k: 'a: b'",
        'empty: {}',
        'arr: []',
        '',
      ].join('\n'),
    )
    // 往返一致
    expect(load(out)).toEqual(
      JSON.parse(
        '{"name":"服务 🚀","on":"yes","ver":"1.0","n":null,"t":true,"list":[1,"2024-01-01",{"k":"a: b"}],"empty":{},"arr":[]}',
      ),
    )
  })

  it('honours indent, quote style, force quotes and sort keys', () => {
    const out = ok(
      jsonToYaml(
        '{"b":{"y":"x","x":"it\'s"},"a":["q"]}',
        opts({ indent: 4, quoteStyle: 'double', forceQuotes: true, sortKeys: true }),
      ),
    ).output
    expect(out).toBe('a:\n    - "q"\nb:\n    x: "it\'s"\n    "y": "x"\n')
  })

  it('folds long strings according to lineWidth', () => {
    const long = 'word '.repeat(40).trim()
    const folded = ok(jsonToYaml(JSON.stringify({ s: long }), opts({ lineWidth: 40 }))).output
    expect(folded.split('\n').length).toBeGreaterThan(3)
    const unlimited = ok(jsonToYaml(JSON.stringify({ s: long }), opts({ lineWidth: -1 }))).output
    expect(unlimited).toBe(`s: ${long}\n`)
    expect(load(folded)).toEqual({ s: long })
  })

  it('splits a top-level array into multiple documents', () => {
    const r = ok(jsonToYaml('[{"kind":"A"},{"kind":"B"}]', opts({ multiDoc: true })))
    expect(r.output).toBe('---\nkind: A\n---\nkind: B\n')
    expect(r.docCount).toBe(2)
    // 关闭时保持为单个数组文档
    expect(ok(jsonToYaml('[{"kind":"A"}]')).output).toBe('- kind: A\n')
  })

  it('keeps multiline strings as literal blocks', () => {
    const out = ok(jsonToYaml('{"script":"echo 1\\necho 2\\n"}')).output
    expect(out).toBe('script: |\n  echo 1\n  echo 2\n')
  })

  it('warns about integers beyond the safe range', () => {
    const r = ok(jsonToYaml('{"id": 12345678901234567890}'))
    expect(r.warnings.join()).toContain('精度')
  })

  it('handles scalars at top level', () => {
    expect(ok(jsonToYaml('"hello"')).output).toBe('hello\n')
    expect(ok(jsonToYaml('42')).output).toBe('42\n')
    expect(ok(jsonToYaml('null')).output).toBe('null\n')
  })

  it('returns located errors for invalid JSON', () => {
    const e = fail(jsonToYaml('{\n  "a": 1,\n}'))
    expect(e.message).toContain('尾随逗号')
    expect(e.line).toBe(2)
  })

  it('converts the JSON sample', () => {
    const r = ok(jsonToYaml(JSON_SAMPLE))
    expect(r.output).toContain('services:\n  web:\n    image: nginx:1.27-alpine')
    expect(r.output).toContain("FEATURE_FLAGS: 'on'")
    expect(load(r.output)).toEqual(JSON.parse(JSON_SAMPLE))
  })

  it('handles large input', () => {
    const data = Array.from({ length: 5000 }, (_, i) => ({
      id: i,
      name: `用户${i}`,
      tags: ['a', 'b'],
    }))
    const r = ok(jsonToYaml(JSON.stringify(data)))
    expect(load(r.output)).toEqual(data)
  })
})

describe('yamlToJson', () => {
  it('returns empty output for blank / comment-only input', () => {
    expect(ok(yamlToJson(''))).toMatchObject({ output: '', docCount: 0 })
    expect(ok(yamlToJson('# 只有注释\n'))).toMatchObject({ output: '', docCount: 0 })
  })

  it('uses YAML 1.2 core types', () => {
    const out = ok(
      yamlToJson('a: yes\nb: on\nc: 0x1F\nd: 1e3\ne: ~\nf: 2024-01-01\ng: "007"\nh: true'),
    ).output
    expect(JSON.parse(out)).toEqual({
      a: 'yes',
      b: 'on',
      c: 31,
      d: 1000,
      e: null,
      f: '2024-01-01',
      g: '007',
      h: true,
    })
  })

  it('resolves anchors, aliases and merge keys', () => {
    const src = 'base: &b\n  x: 1\n  y: [1, 2]\nchild:\n  <<: *b\n  y: [3]\n  z: 中文\ncopy: *b\n'
    const r = ok(yamlToJson(src))
    expect(JSON.parse(r.output)).toEqual({
      base: { x: 1, y: [1, 2] },
      child: { x: 1, y: [3], z: '中文' },
      copy: { x: 1, y: [1, 2] },
    })
    expect(r.aliasCount).toBe(2)
  })

  it('turns multiple documents into an array', () => {
    const r = ok(yamlToJson('---\na: 1\n---\n- x\n...\n---\nplain\n'))
    expect(r.docCount).toBe(3)
    expect(JSON.parse(r.output)).toEqual([{ a: 1 }, ['x'], 'plain'])
    // 单文档不包成数组
    expect(JSON.parse(ok(yamlToJson('---\na: 1\n')).output)).toEqual({ a: 1 })
  })

  it('respects indent and sortKeys', () => {
    expect(
      ok(yamlToJson('b: 1\na: {d: 1, c: 2}', opts({ indent: 4, sortKeys: true }))).output,
    ).toBe('{\n    "a": {\n        "c": 2,\n        "d": 1\n    },\n    "b": 1\n}')
  })

  it('ignores custom tags when enabled and reports them', () => {
    const src = 'Bucket: !Ref MyBucket\nArn: !GetAtt [Role, Arn]\nPolicy: !Sub\n  Name: x\n'
    const r = ok(yamlToJson(src))
    expect(JSON.parse(r.output)).toEqual({
      Bucket: 'MyBucket',
      Arn: ['Role', 'Arn'],
      Policy: { Name: 'x' },
    })
    expect(r.warnings.join()).toContain('!Ref')
    const e = fail(yamlToJson(src, opts({ customTags: false })))
    expect(e.message).toContain('未知的标签 !Ref')
    expect([e.line, e.column]).toEqual([1, 9])
  })

  it('also ignores YAML 1.1 and verbatim tags when enabled (regression)', () => {
    const src =
      'a: !!binary aGVsbG8=\nb: !!timestamp 2020-01-01\nc: !!set {x, y}\nd: !<tag:example.com,2000:foo> bar\n'
    const r = ok(yamlToJson(src))
    expect(JSON.parse(r.output)).toEqual({
      a: 'aGVsbG8=',
      b: '2020-01-01',
      c: { x: null, y: null },
      d: 'bar',
    })
    expect(r.warnings.join()).toContain('!!binary、!!timestamp、!!set、tag:example.com,2000:foo')
    // 核心标签仍然生效
    expect(JSON.parse(ok(yamlToJson('a: !!str 1\nb: !!int "2"\n')).output)).toEqual({
      a: '1',
      b: 2,
    })
    const e = fail(yamlToJson('a: !!binary aGVsbG8=', opts({ customTags: false })))
    expect(e.message).toBe('未知的标签 !!binary（可打开「忽略自定义标签」）')
    expect(fail(yamlToJson('a: !!int abc')).message).toBe('值与显式标签 !!int 不匹配')
  })

  it('outputs null for .nan / .inf with a warning', () => {
    const r = ok(yamlToJson('a: .nan\nb: -.inf'))
    expect(JSON.parse(r.output)).toEqual({ a: null, b: null })
    expect(r.warnings.join()).toContain('.nan')
  })

  it('stops YAML bombs', () => {
    const bomb = [
      'a: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]',
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
      'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
      'f: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e]',
      'g: &g [*f,*f,*f,*f,*f,*f,*f,*f,*f]',
      'h: &h [*g,*g,*g,*g,*g,*g,*g,*g,*g]',
    ].join('\n')
    const e = fail(yamlToJson(bomb))
    expect(e.message).toContain('YAML 炸弹')
  })

  it('detects circular aliases', () => {
    const e = fail(yamlToJson('a: &a\n  self: *a\n'))
    expect(e.message).toContain('循环引用')
  })

  it.each([
    ['a: 1\n  b: 2', '缩进', 2, 4],
    ['a: 1\na: 2', '重复的键', 2, 1],
    ['a: *nope', '找不到锚点 &nope', 1, 5],
    ['a:\n\tb: 1', 'Tab', 2, 1],
    ['a: [1, 2', '没有闭合', 1, 9],
    // 指向开头的引号（而不是文件末尾），更容易找到问题
    ['a: "abc', '双引号字符串没有闭合', 1, 4],
    ['? [a, b]\n: 1', '复合键', 1, 1],
    ['list: [1, 2\nnext: 3\n', '这里的 [ 缺少对应的 ]', 1, 7],
    ["a: {x: '[', y: 2\nb: 1\n", '这里的 { 缺少对应的 }', 1, 4],
  ])('reports %j with Chinese message and position', (src, msg, line, column) => {
    const e = fail(yamlToJson(src))
    expect(e.message).toContain(msg)
    expect([e.line, e.column]).toEqual([line, column])
    expect(e.frame?.lines.some((l) => l.error)).toBe(true)
  })

  it('converts the YAML sample (multi-doc with anchors)', () => {
    const r = ok(yamlToJson(YAML_SAMPLE))
    const docs = JSON.parse(r.output)
    expect(r.docCount).toBe(3)
    expect(docs.map((d: { kind: string }) => d.kind)).toEqual([
      'ConfigMap',
      'Deployment',
      'Service',
    ])
    expect(docs[0].data.FEATURE_NEW_CHECKOUT).toBe('on')
    expect(docs[1].spec.selector.matchLabels).toEqual({ app: 'shop-api', tier: 'backend' })
    expect(docs[1].spec.template.spec.containers[1].resources.limits).toEqual({
      cpu: '1',
      memory: '512Mi',
    })
    expect(r.aliasCount).toBe(3)
  })

  it('round-trips through both directions', () => {
    const json = ok(yamlToJson(YAML_SAMPLE)).output
    const yaml = ok(jsonToYaml(json, opts({ multiDoc: true }))).output
    expect(yaml.match(/^---$/gm)?.length).toBe(3)
    expect(JSON.parse(ok(yamlToJson(yaml)).output)).toEqual(JSON.parse(json))
  })
})

describe('findUnclosedFlow', () => {
  it('ignores brackets inside quotes and comments', () => {
    expect(findUnclosedFlow("a: '[' # [\nb: [1, {c: ']'}", 99)).toBe(14)
    expect(findUnclosedFlow('a: [1, 2]\nb: {c: 1}', 99)).toBeNull()
    expect(findUnclosedFlow("it's: fine\nx: [1", 99)).toBe(14)
  })
})

describe('YAML diagnostics (regression)', () => {
  const at = (src: string) => {
    const e = fail(yamlToJson(src))
    return [e.message, e.line, e.column]
  }

  it('points at an unclosed quote instead of reporting 缩进不足 on the next line', () => {
    expect(at('a: "unterminated\nb: 1\n')).toEqual([
      '双引号字符串没有闭合：从这里开始的 " 缺少结尾的 "',
      1,
      4,
    ])
    expect(at("a: 'abc\nb: 1\n")).toEqual([
      "单引号字符串没有闭合：从这里开始的 ' 缺少结尾的 '",
      1,
      4,
    ])
    expect(at('a:\n  b: "x\n  c: 1\n').slice(1)).toEqual([2, 6])
    expect(at('- "ok"\n- "bad\n- c\n').slice(1)).toEqual([2, 3])
    // 普通标量里的撇号不是字符串起点
    expect(at('name: it\'s fine\nx: "y\n').slice(1)).toEqual([2, 4])
  })

  it('explains stray closing brackets, nested mappings and tab indentation', () => {
    expect(at('a: [1, 2]]\n')).toEqual(['多余的 ]：前面没有与之对应的 [', 1, 10])
    expect(at('a: {x: 1}}\n')).toEqual(['多余的 }：前面没有与之对应的 {', 1, 10])
    expect(at('a: b: c\n')[0]).toContain('同一行里不能嵌套映射')
    expect(at('a:\n\tb: 1\n')).toEqual(['YAML 缩进不能使用 Tab，请改用空格', 2, 1])
    // 值中间的 Tab 是合法的
    expect(JSON.parse(ok(yamlToJson('a:\tb')).output)).toEqual({ a: 'b' })
  })

  it('keeps precise messages for other errors', () => {
    expect(at('a: "x \\q y"\n')[0]).toBe('未知的转义序列')
    expect(at('a: 1\n b: 2\n')).toEqual(['映射项缩进不正确', 2, 3])
  })

  it('findUnclosedQuote skips comments, block scalars and closed strings', () => {
    expect(findUnclosedQuote('a: "x"\nb: 1', 99)).toBeNull()
    expect(findUnclosedQuote('# "note\nb: 1', 99)).toBeNull()
    expect(findUnclosedQuote('run: |\n  "not a string\nb: 1', 99)).toBeNull()
    expect(findUnclosedQuote("a: 'it''s\nb", 99)).toBe(3)
    expect(findUnclosedQuote('a: "x\\"y\nb', 99)).toBe(3)
    expect(findUnclosedQuote('a: [1, "x', 99)).toBe(7)
  })

  it('displayTag shortens the yaml.org prefix', () => {
    expect(displayTag('tag:yaml.org,2002:binary')).toBe('!!binary')
    expect(displayTag('!Ref')).toBe('!Ref')
  })
})

describe('translateYamlReason', () => {
  it('falls back to the original reason', () => {
    expect(translateYamlReason('something new')).toBe('something new')
  })
})

describe('convertJsonYaml', () => {
  it('dispatches on direction', () => {
    expect(ok(convertJsonYaml('json2yaml', '{"a":1}')).output).toBe('a: 1\n')
    expect(ok(convertJsonYaml('yaml2json', 'a: 1')).output).toBe('{\n  "a": 1\n}')
  })
})
