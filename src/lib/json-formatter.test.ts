import { describe, expect, it } from 'vitest'
import {
  DEFAULT_JSON_OPTIONS,
  describeChar,
  escapeJsonString,
  formatIssue,
  isLossyNumber,
  jsonStats,
  parseJson,
  printJson,
  processJson,
  quoteJsonString,
  toJsonPath,
  unescapeJsonString,
  type JsonIssue,
  type JsonToolOptions,
  type JsonValue,
} from './json-formatter'

function ok(text: string, lenient = false): JsonValue {
  const r = parseJson(text, { lenient })
  if (!r.ok) throw new Error(`应当解析成功：${formatIssue(r.error)}`)
  return r.value
}

function err(text: string, lenient = false): JsonIssue {
  const r = parseJson(text, { lenient })
  if (r.ok) throw new Error('应当解析失败')
  return r.error
}

const fmt = (text: string, indent: number | 'tab' = 2, lenient = false) =>
  printJson(ok(text, lenient), { indent })

describe('parseJson · 合法输入', () => {
  it.each([
    '{}',
    '[]',
    '0',
    '-0',
    '1.5e10',
    '-2.25E-3',
    '"str"',
    'true',
    'false',
    'null',
    '{"a":[1,{"b":null}],"c":"d"}',
    '[[[]]]',
    '"\\u4e2d\\u6587 \\ud83d\\ude00"',
    '"\\"\\\\\\/\\b\\f\\n\\r\\t"',
  ])('与 JSON.parse 结果一致：%s', (src) => {
    expect(JSON.parse(printJson(ok(src), { indent: 0 }))).toEqual(JSON.parse(src))
  })

  it('跳过开头的 BOM 与各种空白', () => {
    expect(fmt('\ufeff \t\r\n {"a" : 1 } \n', 0)).toBe('{"a":1}')
  })

  it('解析中文、emoji 与 unicode 转义', () => {
    const v = ok('{"名字":"小明 🍀","转义":"\\u4F60\\u597D"}')
    expect(v.type === 'object' && v.entries.map((e) => [e.key, e.value])).toEqual([
      ['名字', expect.objectContaining({ type: 'string', value: '小明 🍀' })],
      ['转义', expect.objectContaining({ type: 'string', value: '你好' })],
    ])
  })

  it('大数按原文保留，不丢精度', () => {
    const src = '{"id":12345678901234567890,"f":0.1000000000000000055511151231257827,"e":1E+400}'
    expect(fmt(src, 0)).toBe(src)
    expect(fmt('[12345678901234567890]', 2)).toBe('[\n  12345678901234567890\n]')
  })

  it('记录节点在源文本中的位置', () => {
    const v = ok(' {"a": [1, 2]}')
    expect(v.start).toBe(1)
    expect(v.end).toBe(14)
  })

  it('重复的键给出警告但仍然解析', () => {
    const r = parseJson('{\n  "id": 1,\n  "id": 2\n}')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatchObject({ line: 3, column: 3 })
    expect(r.warnings[0].message).toContain('重复的键 "id"')
    expect(r.warnings[0].message).toContain('第 2 行')
  })

  it('能处理较深的嵌套', () => {
    const deep = '['.repeat(900) + ']'.repeat(900)
    expect(printJson(ok(deep), { indent: 0 })).toBe(deep)
  })

  it('超过最大深度时报错而不是栈溢出', () => {
    const deep = '['.repeat(5000) + ']'.repeat(5000)
    const e = err(deep)
    expect(e.message).toContain('嵌套层级过深')
  })

  it('大输入也能快速解析', () => {
    const items = Array.from({ length: 20000 }, (_, i) => ({
      id: i,
      name: `用户${i}`,
      tags: ['a', 'b'],
      ok: i % 2 === 0,
      n: null,
    }))
    const src = JSON.stringify({ items })
    const t = performance.now()
    const v = ok(src)
    const out = printJson(v, { indent: 2 })
    expect(performance.now() - t).toBeLessThan(3000)
    expect(JSON.parse(out)).toEqual({ items })
  })
})

describe('parseJson · 错误定位与中文提示', () => {
  it('缺少逗号：指向上一个值的末尾', () => {
    const e = err('{\n  "name": "张三",\n  "age": 18\n  "city": "上海"\n}')
    expect(e).toMatchObject({ line: 3, column: 12 })
    expect(e.message).toContain('缺少逗号')
    expect(e.hint).toContain('第 4 行第 3 列')
    expect(formatIssue(e)).toBe('第 3 行第 12 列：' + e.message)
  })

  it('数组中缺少逗号', () => {
    const e = err('[1 2]')
    expect(e).toMatchObject({ line: 1, column: 3 })
    expect(e.message).toContain('元素之间')
  })

  it('括号不匹配', () => {
    const e = err('{"a": [1, 2}')
    expect(e).toMatchObject({ line: 1, column: 12 })
    expect(e.message).toContain('括号不匹配')
    expect(e.message).toContain('第 1 行第 7 列')
  })

  it('多余的右括号', () => {
    const e = err('{"a": 1}}')
    expect(e).toMatchObject({ line: 1, column: 9 })
    expect(e.message).toContain('多余的右括号')
  })

  it('JSON 意外结束时指出未闭合的括号位置', () => {
    const e = err('{\n  "a": [1, 2]')
    expect(e.message).toContain('缺少右花括号')
    expect(e.hint).toContain('第 1 行第 1 列')
    expect(e).toMatchObject({ line: 2, column: 14 })
  })

  it('尾随逗号（严格模式）', () => {
    const e = err('{"a": 1,\n}')
    expect(e).toMatchObject({ line: 1, column: 8, lenientFixable: true })
    expect(e.message).toContain('多余的逗号')
    expect(err('[1, 2, ]').message).toContain('数组最后一个元素')
  })

  it('多余 / 缺失的元素', () => {
    expect(err('[1,,2]').message).toContain('多了一个逗号')
    expect(err('[,1]').message).toContain('开头多了一个逗号')
    expect(err('{,}').message).toContain('多余的逗号')
    expect(err('{"a": }').message).toContain('缺少值')
    expect(err('{"a" 1}').message).toContain('缺少冒号')
  })

  it('单引号、无引号键名、注释都提示可用宽松模式', () => {
    expect(err("{'a': 1}")).toMatchObject({ lenientFixable: true, column: 2 })
    const k = err('{name: 1}')
    expect(k.message).toContain('属性名必须用双引号包裹')
    expect(k.lenientFixable).toBe(true)
    expect(err('{"a": 1 // 注释\n}')).toMatchObject({ lenientFixable: true, line: 1, column: 9 })
    expect(err('/* x */ 1').message).toContain('不支持注释')
  })

  it('字符串相关错误', () => {
    const e = err('{"a": "abc}')
    expect(e.message).toContain('字符串没有结束')
    expect(e).toMatchObject({ line: 1, column: 7 })
    expect(err('"a\nb"').message).toContain('不能直接换行')
    expect(err('"a\tb"')).toMatchObject({ lenientFixable: true })
    expect(err('"\\x41"').message).toContain('无效的转义序列')
    expect(err('"\\u12"').message).toContain('4 位十六进制')
    expect(err('{"path": "C:\\Users\\me"}').hint).toContain('Windows 路径')
  })

  it('数字相关错误', () => {
    expect(err('01').message).toContain('前导零')
    expect(err('1.').message).toContain('小数点后面缺少数字')
    expect(err('.5')).toMatchObject({ lenientFixable: true })
    expect(err('+1')).toMatchObject({ lenientFixable: true })
    expect(err('1e').message).toContain('指数部分缺少数字')
    expect(err('-').message).toContain('负号后面缺少数字')
    expect(err('0x1F')).toMatchObject({ lenientFixable: true })
    expect(err('[1.2.3]').message).toContain('无效的数字：1.2.3')
    expect(err('[12abc]').message).toContain('无效的数字')
  })

  it('关键字相关错误', () => {
    expect(err('True').message).toContain('应为 true')
    expect(err('NULL').message).toContain('应为 null')
    expect(err('None').message).toContain('Python')
    expect(err('{"a": undefined}').message).toContain('undefined')
    expect(err('NaN')).toMatchObject({ lenientFixable: true })
    expect(err('[hello]').hint).toBe('应写作 "hello"')
  })

  it('中文全角符号', () => {
    expect(err('{"a"：1}').message).toContain('中文冒号')
    expect(err('["a"，"b"]').message).toContain('中文逗号')
    expect(err('{“a”: 1}').message).toContain('中文引号')
  })

  it('不可见字符', () => {
    const e = err('{"a":\u00a01}')
    expect(e.message).toContain('U+00A0')
    expect(e.lenientFixable).toBe(true)
    expect(err('[1]\u200b').message).toContain('零宽空格')
  })

  it('多个根值 / 空输入', () => {
    expect(err('{"a":1} {"b":2}').message).toContain('只能有一个根值')
    expect(err('1,2').message).toContain('根值后面多了逗号')
    expect(err('   ').message).toContain('内容为空')
  })

  it('列号按码点计算（emoji、中文算 1 列）', () => {
    const e = err('["😀中", x]')
    expect(e).toMatchObject({ line: 1, column: 8 })
  })

  it('支持 \\r\\n 换行', () => {
    expect(err('{\r\n  "a": 1\r\n  "b": 2\r\n}')).toMatchObject({ line: 2, column: 9 })
  })
})

describe('parseJson · 宽松模式', () => {
  it('接受 JSON5 风格语法并统计修正', () => {
    const src = `// 配置
{
  name: 'showMe', /* 块注释 */
  'single': 'it\\'s',
  hex: 0xFF,
  neg: -0x10,
  pos: +1,
  half: .5,
  five: 5.,
  list: [1, 2, 3,],
  $id_1: "ok",
  中文键: true,
}`
    const r = parseJson(src, { lenient: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(JSON.parse(printJson(r.value, { indent: 0 }))).toEqual({
      name: 'showMe',
      single: "it's",
      hex: 255,
      neg: -16,
      pos: 1,
      half: 0.5,
      five: 5,
      list: [1, 2, 3],
      $id_1: 'ok',
      中文键: true,
    })
    expect(r.fixes).toMatchObject({
      comment: 2,
      trailingComma: 2,
      unquotedKey: 9,
      singleQuote: 3,
      hexNumber: 2,
      numberFormat: 3,
    })
  })

  it('大十六进制数不丢精度', () => {
    expect(fmt('0xFFFFFFFFFFFFFFFFFF', 0, true)).toBe('4722366482869645213695')
  })

  it('NaN / Infinity 输出为 null 并给出警告', () => {
    const r = parseJson('[NaN, Infinity, -Infinity, +Infinity]', { lenient: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(printJson(r.value, { indent: 0 })).toBe('[null,null,null,null]')
    expect(r.warnings).toHaveLength(4)
    expect(r.fixes.specialNumber).toBe(4)
  })

  it('JSON5 扩展转义与行延续', () => {
    const v = ok("'a\\x41\\v\\0b\\\nc\\q'", true)
    expect(v).toMatchObject({ type: 'string', value: 'aA\v\0bcq' })
  })

  it('忽略不可见空白', () => {
    expect(fmt('\u00a0{\u200b"a"\u3000:1}', 0, true)).toBe('{"a":1}')
  })

  it('宽松模式仍然拒绝真正的错误', () => {
    expect(err('{a: 1 b: 2}', true).message).toContain('缺少逗号')
    expect(err('[01]', true).message).toContain('前导零')
    expect(err('/* 没结束', true).message).toContain('块注释没有结束')
  })
})

describe('printJson', () => {
  const src = '{"b":1,"a":{"d":[1,2,{}],"c":[]},"e":"x"}'

  it('缩进 2 / 4 / tab', () => {
    expect(fmt('{"a":[1,{"b":2}]}', 2)).toBe(
      '{\n  "a": [\n    1,\n    {\n      "b": 2\n    }\n  ]\n}',
    )
    expect(fmt('{"a":1}', 4)).toBe('{\n    "a": 1\n}')
    expect(fmt('{"a":[1]}', 'tab')).toBe('{\n\t"a": [\n\t\t1\n\t]\n}')
  })

  it('与 JSON.stringify 的格式一致', () => {
    const obj = JSON.parse(src)
    expect(fmt(src, 2)).toBe(JSON.stringify(obj, null, 2))
    expect(fmt(src, 4)).toBe(JSON.stringify(obj, null, 4))
    expect(fmt(src, 0)).toBe(JSON.stringify(obj))
  })

  it('递归键排序', () => {
    expect(printJson(ok(src), { indent: 0, sortKeys: true })).toBe(
      '{"a":{"c":[],"d":[1,2,{}]},"b":1,"e":"x"}',
    )
  })

  it('非 ASCII 转为 \\uXXXX', () => {
    expect(printJson(ok('{"中":"文😀é"}'), { indent: 0, escapeUnicode: true })).toBe(
      '{"\\u4e2d":"\\u6587\\ud83d\\ude00\\u00e9"}',
    )
  })

  it('保持转义行为与 JSON.stringify 一致', () => {
    const s = 'a"b\\c\n\t\u0001\u001f\u007f\u2028/'
    expect(quoteJsonString(s)).toBe(JSON.stringify(s))
    expect(quoteJsonString('\ud800x')).toBe(JSON.stringify('\ud800x'))
    expect(quoteJsonString('😀')).toBe('"😀"')
    expect(quoteJsonString('')).toBe('""')
  })
})

describe('jsonStats', () => {
  it('统计键、深度、类型与大数', () => {
    const st = jsonStats(ok('{"a":[1,{"b":null,"c":true}],"d":"x","big":12345678901234567890}'))
    expect(st).toMatchObject({
      keys: 5,
      maxDepth: 3,
      objects: 2,
      arrays: 1,
      strings: 1,
      numbers: 2,
      booleans: 1,
      nulls: 1,
      bigNumbers: 1,
      nodes: 8,
    })
    expect(jsonStats(ok('1')).maxDepth).toBe(0)
    expect(jsonStats(ok('{}')).maxDepth).toBe(1)
  })

  it('isLossyNumber', () => {
    expect(isLossyNumber('9007199254740991')).toBe(false)
    expect(isLossyNumber('9007199254740993')).toBe(true)
    expect(isLossyNumber('1.0')).toBe(false)
    expect(isLossyNumber('1E+5')).toBe(false)
    expect(isLossyNumber('0.1')).toBe(false)
    expect(isLossyNumber('-0')).toBe(false)
    expect(isLossyNumber('3.141592653589793238')).toBe(true)
    expect(isLossyNumber('1e400')).toBe(true)
    // 15 位以内整数走快速路径；16 位以上仍按数值判断
    expect(isLossyNumber('999999999999999')).toBe(false)
    expect(isLossyNumber('-123456789012345')).toBe(false)
    expect(isLossyNumber('1234567890123456')).toBe(false)
    expect(isLossyNumber('12345678901234567890')).toBe(true)
    expect(isLossyNumber('1e-400')).toBe(true)
    expect(isLossyNumber('0.30000000000000004')).toBe(false)
  })
})

describe('toJsonPath', () => {
  it('生成 JSONPath', () => {
    expect(toJsonPath([])).toBe('$')
    expect(toJsonPath(['data', 'items', 0, 'name'])).toBe('$.data.items[0].name')
    expect(toJsonPath(['用户', '名字'])).toBe('$.用户.名字')
    expect(toJsonPath(['a b', "it's", 'x-y', '', '1a'])).toBe("$['a b']['it\\'s']['x-y']['']['1a']")
    expect(toJsonPath(['say "hi"\n'])).toBe(`$['say "hi"\\n']`)
  })
})

describe('转义 / 去转义', () => {
  it('escapeJsonString', () => {
    expect(escapeJsonString('{"a":"中"}')).toBe('"{\\"a\\":\\"中\\"}"')
    expect(escapeJsonString('{"a":1}', { quotes: false })).toBe('{\\"a\\":1}')
    expect(escapeJsonString('中', { escapeUnicode: true })).toBe('"\\u4e2d"')
    expect(escapeJsonString('')).toBe('""')
  })

  it('有外层引号', () => {
    expect(unescapeJsonString('"{\\"a\\":1}"')).toEqual({ ok: true, text: '{"a":1}', levels: 1 })
  })

  it('没有外层引号', () => {
    expect(unescapeJsonString('{\\"a\\":\\"x\\\\ny\\"}')).toEqual({
      ok: true,
      text: '{"a":"x\\ny"}',
      levels: 1,
    })
  })

  it('双重转义', () => {
    const once = JSON.stringify('{"a":"中文"}')
    const twice = JSON.stringify(once)
    expect(unescapeJsonString(twice)).toEqual({ ok: true, text: '{"a":"中文"}', levels: 2 })
    // 去掉外层引号的双重转义
    expect(unescapeJsonString(twice.slice(1, -1))).toMatchObject({
      text: '{"a":"中文"}',
      levels: 2,
    })
  })

  it('三重转义', () => {
    const t = JSON.stringify(JSON.stringify(JSON.stringify(JSON.stringify({ k: [1, 'v'] }))))
    expect(unescapeJsonString(t)).toEqual({ ok: true, text: '{"k":[1,"v"]}', levels: 3 })
  })

  it('普通字符串与 unicode', () => {
    expect(unescapeJsonString('"\\u4f60\\u597d\\n"')).toEqual({
      ok: true,
      text: '你好\n',
      levels: 1,
    })
    // 没有引号也没有转义序列：什么都没去掉，层数为 0（回归：曾误报「已去除 1 层」）
    expect(unescapeJsonString('hello')).toEqual({ ok: true, text: 'hello', levels: 0 })
    expect(unescapeJsonString("'hello'")).toEqual({ ok: true, text: 'hello', levels: 1 })
  })

  it('已经是 JSON 时不做处理', () => {
    expect(unescapeJsonString(' {"a":"b\\nc"} ')).toEqual({
      ok: true,
      text: '{"a":"b\\nc"}',
      levels: 0,
    })
  })

  it('无效转义报出位置', () => {
    const r = unescapeJsonString('{\\"a\\":\\q}')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatchObject({ line: 1, column: 8 })
    expect(r.error.message).toContain('\\q')
  })

  it('往返：转义后再去转义得到原文', () => {
    const src = '{"msg":"换行\\n引号\\"反斜杠\\\\ 😀"}'
    expect(
      unescapeJsonString(escapeJsonString(src)).ok && unescapeJsonString(escapeJsonString(src)),
    ).toMatchObject({
      text: src,
    })
  })
})

describe('processJson', () => {
  const o = (patch: Partial<JsonToolOptions>): JsonToolOptions => ({
    ...DEFAULT_JSON_OPTIONS,
    ...patch,
  })

  it('空输入', () => {
    expect(processJson('  \n', o({}))).toEqual({ status: 'empty' })
  })

  it('格式化 + 统计', () => {
    const r = processJson('{"a":[1,2],"id":12345678901234567890}', o({ indent: 4 }))
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.output).toBe(
      '{\n    "a": [\n        1,\n        2\n    ],\n    "id": 12345678901234567890\n}',
    )
    expect(r.stats).toMatchObject({ keys: 2, maxDepth: 2, bigNumbers: 1 })
  })

  it('压缩', () => {
    const r = processJson('{\n  "a" : [ 1 , 2 ]\n}', o({ mode: 'minify' }))
    expect(r.status === 'ok' && r.output).toBe('{"a":[1,2]}')
  })

  it('错误结果带上源文本', () => {
    const r = processJson('{"a" 1}', o({}))
    expect(r.status).toBe('error')
    if (r.status !== 'error') return
    expect(r.inInput).toBe(true)
    expect(r.source).toBe('{"a" 1}')
  })

  it('宽松模式的修正计数', () => {
    const r = processJson('{a: 1, // c\n}', o({ lenient: true }))
    expect(r.status === 'ok' && r.fixes).toEqual({ unquotedKey: 1, comment: 1, trailingComma: 1 })
  })

  it('转义：先压缩', () => {
    const r = processJson('{\n  "a": "中"\n}', o({ mode: 'escape' }))
    expect(r.status === 'ok' && r.output).toBe('"{\\"a\\":\\"中\\"}"')
    const r2 = processJson(
      '{\n  "a": 1\n}',
      o({ mode: 'escape', compactBeforeEscape: false, quotes: false }),
    )
    expect(r2.status === 'ok' && r2.output).toBe('{\\n  \\"a\\": 1\\n}')
  })

  it('转义：非 JSON 输入按原文转义', () => {
    const r = processJson('hello "world"', o({ mode: 'escape' }))
    expect(r.status === 'ok' && r.output).toBe('"hello \\"world\\""')
    expect(r.status === 'ok' && r.notes[0]).toContain('按原文转义')
  })

  it('去转义后自动格式化', () => {
    const r = processJson('"{\\"a\\":[1,2]}"', o({ mode: 'unescape' }))
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.output).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}')
    expect(r.value?.type).toBe('object')
    expect(r.notes[0]).toContain('1 层')
  })

  it('根值是装着 JSON 的字符串时建议去转义', () => {
    const r = processJson('"{\\"a\\":1}"', o({}))
    expect(r.status === 'ok' && r.suggestUnescape).toBe(true)
    const r2 = processJson('"hello"', o({}))
    expect(r2.status === 'ok' && r2.suggestUnescape).toBe(false)
  })
})

describe('describeChar', () => {
  it('描述特殊字符', () => {
    expect(describeChar('x')).toBe('"x"')
    expect(describeChar('，')).toBe('中文逗号「，」')
    expect(describeChar('\u200b')).toContain('零宽空格')
    expect(describeChar('\u0001')).toBe('控制字符 U+0001')
    expect(describeChar('')).toBe('文本结尾')
  })
})

describe('拼写接近关键字', () => {
  it.each([
    ['tru', 'true'],
    ['ture', 'true'],
    ['flase', 'false'],
    ['nul', 'null'],
    ['nulll', 'null'],
    ['NUL', 'null'],
  ])('%s → %s', (word, guess) => {
    expect(err(`[${word}]`).message).toBe(`无效的值 ${word}：是不是想写 ${guess}？`)
  })

  it('无关的单词提示加引号；紧贴上一个值的字母提示意外字符', () => {
    expect(err('[xyz]').message).toBe('字符串必须用双引号包裹：xyz')
    expect(err('[nil]').message).toContain('空值应写作 null')
    expect(err('{"a": "x"y}').message).toContain('意外的字符 "y"')
    expect(err('["a""b"]').message).toContain('缺少逗号')
  })
})

describe('示例数据', () => {
  it('每种模式的示例都能成功处理', async () => {
    const s = await import('./json-formatter-samples')
    const run = (input: string, patch: Partial<JsonToolOptions>) =>
      processJson(input, { ...DEFAULT_JSON_OPTIONS, ...patch })
    const a = run(s.SAMPLE_JSON, {})
    expect(a.status).toBe('ok')
    expect(a.status === 'ok' && a.stats?.bigNumbers).toBe(2)
    expect(a.status === 'ok' && a.output).toContain('"id": 1234567890123456789')
    expect(run(s.SAMPLE_JSON5, {}).status).toBe('error')
    const b = run(s.SAMPLE_JSON5, { lenient: true })
    expect(b.status === 'ok' && Object.keys(b.fixes).length).toBeGreaterThan(3)
    const c = run(s.SAMPLE_ESCAPE, { mode: 'escape' })
    expect(c.status === 'ok' && c.notes).toEqual([])
    const d = run(s.SAMPLE_UNESCAPE, { mode: 'unescape' })
    expect(d.status === 'ok' && d.value?.type).toBe('object')
    expect(d.status === 'ok' && d.output).toContain('"note": "第一行\\n第二行"')
  })
})

describe('与 JSON.parse 差分对比（确定性随机用例）', () => {
  // 线性同余伪随机数：结果可复现
  let seed = 20240924
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
  const LEAVES = [
    0,
    -1,
    1.5,
    1e-7,
    123456,
    'a',
    '中文',
    '😀',
    'q"\\\n\t\u0001',
    '',
    true,
    false,
    null,
  ]
  const KEYS = ['a', 'b', '键', 'x y', '', '😀']
  const gen = (d: number): unknown => {
    const r = rnd()
    if (d > 3 || r < 0.4) return pick(LEAVES)
    if (r < 0.7) return Array.from({ length: Math.floor(rnd() * 4) }, () => gen(d + 1))
    const o: Record<string, unknown> = {}
    for (let i = 0; i < Math.floor(rnd() * 4); i++) o[pick(KEYS)] = gen(d + 1)
    return o
  }
  const CHARS = ['{', '}', '[', ']', ',', ':', '"', ' ', '\n', 'a', '1', '-', '.', 'e', '\\', 't']

  it('合法 JSON 的打印结果与 JSON.stringify 一致；随机篡改后合法性判断与 JSON.parse 一致', () => {
    for (let k = 0; k < 3000; k++) {
      const v = gen(0)
      const s = JSON.stringify(v, null, pick([0, 2, '\t'] as const))
      const value = ok(s)
      expect(printJson(value, { indent: 0 })).toBe(JSON.stringify(v))
      expect(printJson(value, { indent: 2 })).toBe(JSON.stringify(v, null, 2))

      let m = s
      const i = Math.floor(rnd() * (m.length + 1))
      const op = rnd()
      m =
        op < 0.4
          ? m.slice(0, i) + m.slice(i + 1)
          : op < 0.8
            ? m.slice(0, i) + pick(CHARS) + m.slice(i)
            : m.slice(0, i) + pick(CHARS) + m.slice(i + 1)
      let native = true
      try {
        JSON.parse(m)
      } catch {
        native = false
      }
      const mine = parseJson(m)
      expect({ m, ok: mine.ok }).toEqual({ m, ok: native })
      // 宽松模式是严格模式的超集
      if (native) expect(parseJson(m, { lenient: true }).ok).toBe(true)
      if (!mine.ok) {
        expect(mine.error.line).toBeGreaterThanOrEqual(1)
        expect(mine.error.column).toBeGreaterThanOrEqual(1)
      }
    }
  })
})
