import { describe, expect, it } from 'vitest'
import { parseCurl, type HttpRequest } from './curl'
import { generateCode } from './http-codegen'
import {
  applyParamsToUrl,
  basicAuthValue,
  buildQuery,
  buildRequest,
  cloneRequest,
  dynamicValue,
  emptyAuth,
  emptyBody,
  encodeForm,
  formatJsonText,
  fromHttpRequest,
  importNotes,
  kv,
  locateJsonError,
  newRequest,
  normalizeUrl,
  parseQuery,
  requestLabel,
  requestSignature,
  resolveVars,
  splitUrl,
  splitVarSegments,
  syncParamsFromUrl,
  uid,
  validateJson,
  type KeyValue,
} from './api-client'

const ctx = { now: () => Date.UTC(2026, 0, 2, 3, 4, 5), random: () => 0.5 }
const pairs = (rows: KeyValue[]) => rows.map((r) => [r.key, r.value, r.enabled])

describe('uid', () => {
  it('is unique enough', () => {
    const s = new Set(Array.from({ length: 5000 }, uid))
    expect(s.size).toBe(5000)
  })
})

describe('URL ↔ params', () => {
  it('splitUrl', () => {
    expect(splitUrl('https://a.dev/p?x=1&y#h?z')).toEqual({
      base: 'https://a.dev/p',
      query: 'x=1&y',
      hash: '#h?z',
    })
    expect(splitUrl('https://a.dev/p')).toEqual({ base: 'https://a.dev/p', query: null, hash: '' })
    expect(splitUrl('')).toEqual({ base: '', query: null, hash: '' })
  })

  it('parseQuery keeps raw text, including variables and encoded values', () => {
    expect(parseQuery('a=1&b=&c&&d=x=y&e={{v}}&f=%E4%B8%AD&g=a+b')).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '' },
      { key: 'c', value: '' },
      { key: 'd', value: 'x=y' },
      { key: 'e', value: '{{v}}' },
      { key: 'f', value: '%E4%B8%AD' },
      { key: 'g', value: 'a+b' },
    ])
    expect(parseQuery('')).toEqual([])
  })

  it('buildQuery omits empty rows and "=" for empty values', () => {
    expect(
      buildQuery([
        { key: 'a', value: '1' },
        { key: 'flag', value: '' },
        { key: '', value: '' },
        { key: '', value: 'x' },
      ]),
    ).toBe('a=1&flag&=x')
  })

  it('syncParamsFromUrl reuses ids and keeps disabled rows in place', () => {
    const a = kv('a', '1')
    const off = kv('off', 'x', false)
    const b = kv('b', '2')
    const next = syncParamsFromUrl('https://x.dev/?a=1&b=3&c=4', [a, off, b])
    expect(pairs(next)).toEqual([
      ['a', '1', true],
      ['off', 'x', false],
      ['b', '3', true],
      ['c', '4', true],
    ])
    expect(next[0]).toBe(a) // 未变化的行保持引用
    expect(next[2].id).toBe(b.id)
    // 删除查询串时只保留禁用行
    expect(pairs(syncParamsFromUrl('https://x.dev/', next))).toEqual([['off', 'x', false]])
  })

  it('applyParamsToUrl rewrites only the query and keeps the hash', () => {
    const params = [kv('q', '中文'), kv('off', '1', false), kv('page', '{{p}}'), kv('flag', '')]
    expect(applyParamsToUrl('{{base}}/s?old=1#top', params)).toBe(
      '{{base}}/s?q=中文&page={{p}}&flag#top',
    )
    expect(applyParamsToUrl('https://x.dev/s?old=1', [])).toBe('https://x.dev/s')
  })

  it('round-trips URL → params → URL', () => {
    for (const url of [
      'https://a.dev/p?x=1&y=2',
      'https://a.dev/p?x=%20&y={{v}}#frag',
      'https://a.dev/p',
      'https://a.dev/p?flag&z=😀',
    ]) {
      expect(applyParamsToUrl(url, syncParamsFromUrl(url, []))).toBe(url)
    }
  })
})

describe('variables', () => {
  const vars = {
    baseUrl: 'https://api.dev',
    token: 'abc',
    nested: '{{baseUrl}}/v1',
    loop: '{{loop}}',
  }

  it('resolveVars replaces known variables (with spaces and nesting)', () => {
    expect(resolveVars('{{ baseUrl }}/users?t={{token}}', vars, ctx)).toEqual({
      text: 'https://api.dev/users?t=abc',
      missing: [],
    })
    expect(resolveVars('{{nested}}/x', vars, ctx).text).toBe('https://api.dev/v1/x')
  })

  it('keeps unknown variables and reports them once', () => {
    expect(resolveVars('{{a}}-{{a}}-{{b}}', vars, ctx)).toEqual({
      text: '{{a}}-{{a}}-{{b}}',
      missing: ['a', 'b'],
    })
  })

  it('does not loop forever on self references', () => {
    expect(resolveVars('{{loop}}', vars, ctx).text).toBe('{{loop}}')
  })

  it('supports dynamic variables', () => {
    expect(resolveVars('{{$timestamp}}', {}, ctx).text).toBe(
      String(Date.UTC(2026, 0, 2, 3, 4, 5) / 1000),
    )
    expect(resolveVars('{{$isoTimestamp}}', {}, ctx).text).toBe('2026-01-02T03:04:05.000Z')
    expect(resolveVars('{{$randomInt}}', {}, ctx).text).toBe('500')
    expect(dynamicValue('$uuid', ctx)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(dynamicValue('$nope', ctx)).toBeUndefined()
  })

  it('splitVarSegments marks known / unknown variables', () => {
    expect(splitVarSegments('{{baseUrl}}/u/{{id}}?t={{$uuid}}', vars)).toEqual([
      { text: '{{baseUrl}}', name: 'baseUrl', known: true },
      { text: '/u/' },
      { text: '{{id}}', name: 'id', known: false },
      { text: '?t=' },
      { text: '{{$uuid}}', name: '$uuid', known: true },
    ])
    expect(splitVarSegments('', vars)).toEqual([])
    expect(splitVarSegments('{{}} {{ }}', vars)).toEqual([{ text: '{{}} {{ }}' }])
  })
})

describe('JSON helpers', () => {
  it('validateJson reports line and column', () => {
    expect(validateJson('')).toEqual({ ok: true })
    expect(validateJson('{"a":1}')).toEqual({ ok: true })
    const r = validateJson('{\n  "a": 1,\n  "b": }')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/^JSON 格式错误（第 3 行第 \d+ 列）/)
  })
  it('formatJsonText', () => {
    expect(formatJsonText('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}')
    expect(formatJsonText('{')).toBeNull()
    expect(formatJsonText('')).toBeNull()
    expect(formatJsonText('   ')).toBeNull()
  })

  it('formatJsonText is lossless (regression: big integers, decimals, escapes)', () => {
    const src = '{"id":12345678901234567890,"n":1.50,"e":1E+2,"s":"\\u00e9\\n","z":-0}'
    expect(formatJsonText(src)).toBe(
      '{\n  "id": 12345678901234567890,\n  "n": 1.50,\n  "e": 1E+2,\n  "s": "\\u00e9\\n",\n  "z": -0\n}',
    )
    expect(formatJsonText(src, 0)).toBe(src)
    expect(formatJsonText('{\n  "中文": "😀 值",\n  "a": [ ]\n}', 0)).toBe(
      '{"中文":"😀 值","a":[]}',
    )
  })

  it('validates and formats JSON templates with {{variables}}', () => {
    const tpl = '{"id": {{userId}}, "name": "{{name}}", "list": [{{a}}, 2]}'
    expect(validateJson(tpl).ok).toBe(false)
    expect(validateJson(tpl, { allowVars: true })).toEqual({ ok: true })
    expect(formatJsonText(tpl)).toBeNull()
    expect(formatJsonText(tpl, 2, { allowVars: true })).toBe(
      '{\n  "id": {{userId}},\n  "name": "{{name}}",\n  "list": [\n    {{a}},\n    2\n  ]\n}',
    )
    expect(formatJsonText(tpl, 0, { allowVars: true })).toBe(
      '{"id":{{userId}},"name":"{{name}}","list":[{{a}},2]}',
    )
    // 错误位置不受变量影响
    const bad = validateJson('{"id": {{userId}},\n  "x": }', { allowVars: true })
    expect(bad).toEqual({ ok: false, error: 'JSON 格式错误（第 2 行第 8 列）：意外的字符「}」' })
  })
})

describe('buildRequest', () => {
  const vars = { base: 'https://api.dev', tok: 'T0K', id: '42' }

  it('resolves variables everywhere and adds default content type', () => {
    const req = newRequest({
      method: 'POST',
      url: '{{base}}/users/{{id}}?x={{id}}',
      headers: [kv('X-Id', '{{id}}'), kv('X-Off', 'no', false), kv('  ', 'blank')],
      body: { ...emptyBody(), mode: 'json', json: '{"id":"{{id}}"}' },
    })
    const b = buildRequest(req, vars, ctx)
    expect(b.request).toEqual({
      method: 'POST',
      url: 'https://api.dev/users/42?x=42',
      headers: [
        ['X-Id', '42'],
        ['Content-Type', 'application/json'],
      ],
      body: { kind: 'text', text: '{"id":"42"}' },
      followRedirects: true,
    })
    expect(b.missingVars).toEqual([])
    expect(b.warnings).toEqual([])
  })

  it('keeps a user supplied content type and reports missing variables', () => {
    const req = newRequest({
      method: 'PUT',
      url: '{{nope}}/x',
      headers: [kv('content-type', 'application/merge-patch+json')],
      body: { ...emptyBody(), mode: 'json', json: '{}' },
    })
    const b = buildRequest(req, vars, ctx)
    expect(b.request.headers).toEqual([['content-type', 'application/merge-patch+json']])
    expect(b.missingVars).toEqual(['nope'])
  })

  it('auth: bearer, basic, api key in header and query', () => {
    const base = newRequest({ url: 'https://a.dev/p?x=1' })
    expect(
      buildRequest(
        { ...base, auth: { ...emptyAuth(), type: 'bearer', token: '{{tok}}' } },
        vars,
        ctx,
      ).request.headers,
    ).toEqual([['Authorization', 'Bearer T0K']])
    expect(
      buildRequest(
        { ...base, auth: { ...emptyAuth(), type: 'basic', username: 'u', password: 'p' } },
        vars,
        ctx,
      ).request.auth,
    ).toEqual({ username: 'u', password: 'p' })
    expect(
      buildRequest(
        {
          ...base,
          auth: { ...emptyAuth(), type: 'apikey', apiKeyName: 'X-Key', apiKeyValue: 'k' },
        },
        vars,
        ctx,
      ).request.headers,
    ).toEqual([['X-Key', 'k']])
    expect(
      buildRequest(
        {
          ...base,
          url: 'https://a.dev/p?x=1#h',
          auth: {
            ...emptyAuth(),
            type: 'apikey',
            apiKeyName: 'api key',
            apiKeyValue: 'a&b',
            apiKeyIn: 'query',
          },
        },
        vars,
        ctx,
      ).request.url,
    ).toBe('https://a.dev/p?x=1&api%20key=a%26b#h')
    // 手动写了 Authorization 头时不覆盖
    expect(
      buildRequest(
        {
          ...base,
          headers: [kv('Authorization', 'Custom x')],
          auth: { ...emptyAuth(), type: 'bearer', token: 't' },
        },
        vars,
        ctx,
      ).request.headers,
    ).toEqual([['Authorization', 'Custom x']])
  })

  it('urlencoded, text, xml, form-data and binary bodies', () => {
    const post = (body: Partial<ReturnType<typeof emptyBody>>) =>
      buildRequest(
        newRequest({ method: 'POST', url: 'https://a.dev', body: { ...emptyBody(), ...body } }),
        vars,
        ctx,
      )
    const ue = post({
      mode: 'urlencoded',
      urlencoded: [kv('name', '张 三'), kv('x', '{{id}}'), kv('off', '1', false)],
    })
    expect(ue.request.body).toEqual({ kind: 'text', text: 'name=%E5%BC%A0+%E4%B8%89&x=42' })
    expect(ue.request.headers).toEqual([['Content-Type', 'application/x-www-form-urlencoded']])
    expect(post({ mode: 'text', text: 'hi' }).request.headers).toEqual([
      ['Content-Type', 'text/plain'],
    ])
    expect(post({ mode: 'xml', xml: '<a/>' }).request.headers).toEqual([
      ['Content-Type', 'application/xml'],
    ])

    const fileField = {
      ...kv('avatar', ''),
      type: 'file' as const,
      fileName: 'me.png',
      fileSize: 10,
      fileType: 'image/png',
    }
    const fd = post({
      mode: 'form-data',
      formData: [
        { ...kv('name', '{{id}}'), type: 'text' },
        fileField,
        { ...kv('empty', ''), type: 'file' },
      ],
    })
    expect(fd.request.body).toEqual({
      kind: 'multipart',
      parts: [
        { name: 'name', value: '42', kind: 'text' },
        { name: 'avatar', value: 'me.png', kind: 'file', contentType: 'image/png' },
      ],
    })
    expect(fd.request.headers).toEqual([])
    const withCt = buildRequest(
      newRequest({
        method: 'POST',
        url: 'https://a.dev',
        headers: [kv('Content-Type', 'application/x-www-form-urlencoded'), kv('X-A', '1')],
        body: { ...emptyBody(), mode: 'form-data', formData: [{ ...kv('a', '1'), type: 'text' }] },
      }),
      vars,
      ctx,
    )
    expect(withCt.request.headers).toEqual([['X-A', '1']])
    expect(withCt.warnings[0]).toContain('boundary')
    expect(fd.fileFields).toEqual([
      {
        part: fd.request.body.kind === 'multipart' ? fd.request.body.parts[1] : null,
        fieldId: fileField.id,
      },
    ])
    expect(fd.warnings).toEqual(['表单字段「empty」还没有选择文件'])

    const bin = post({
      mode: 'binary',
      binary: { name: 'a.zip', size: 3, type: 'application/zip' },
    })
    expect(bin.request.body).toEqual({ kind: 'file', path: 'a.zip' })
    expect(bin.request.headers).toEqual([['Content-Type', 'application/zip']])
    expect(post({ mode: 'binary' }).warnings).toEqual(['还没有选择要上传的文件'])
  })

  it('drops bodies for GET / HEAD with a warning', () => {
    const b = buildRequest(
      newRequest({
        method: 'GET',
        url: 'https://a.dev',
        body: { ...emptyBody(), mode: 'json', json: '{}' },
      }),
      vars,
      ctx,
    )
    expect(b.request.body).toEqual({ kind: 'none' })
    expect(b.request.headers).toEqual([])
    expect(b.warnings[0]).toContain('GET')
  })

  it('normalizes URLs, validates protocol and writes non-default timeouts', () => {
    expect(normalizeUrl(' example.com/x ')).toBe('http://example.com/x')
    expect(normalizeUrl('https://a.dev')).toBe('https://a.dev')
    expect(normalizeUrl('')).toBe('')
    expect(buildRequest(newRequest({ url: 'ftp://a.dev' }), {}, ctx).warnings[0]).toContain('ftp:')
    expect(buildRequest(newRequest({ url: 'http://exa mple.com' }), {}, ctx).warnings[0]).toContain(
      'URL 格式不正确',
    )
    const t = newRequest({
      url: 'a.dev',
      settings: { timeoutMs: 5000, followRedirects: false, useProxy: true },
    })
    expect(buildRequest(t, {}, ctx).request).toMatchObject({
      timeout: 5,
      followRedirects: false,
      url: 'http://a.dev',
    })
  })

  it('feeds code generation', () => {
    const req = newRequest({
      method: 'POST',
      url: '{{base}}/items',
      body: { ...emptyBody(), mode: 'json', json: '{"a":1}' },
      auth: { ...emptyAuth(), type: 'bearer', token: '{{tok}}' },
    })
    const code = generateCode(buildRequest(req, vars, ctx).request, 'curl')
    expect(code).toBe(
      "curl 'https://api.dev/items' \\\n  -H 'Authorization: Bearer T0K' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{\"a\":1}' \\\n  -L",
    )
  })
})

describe('basicAuthValue', () => {
  it('encodes UTF-8', () => {
    expect(basicAuthValue('user', 'pass')).toBe('Basic dXNlcjpwYXNz')
    expect(basicAuthValue('用户', '密码')).toBe('Basic 55So5oi3OuWvhueggQ==')
  })
})

describe('encodeForm', () => {
  it('matches URLSearchParams', () => {
    expect(encodeForm([{ key: 'a b', value: 'c&d=e' }])).toBe('a+b=c%26d%3De')
  })
})

describe('fromHttpRequest (cURL import)', () => {
  const parse = (s: string): HttpRequest => {
    const r = parseCurl(s)
    if (!r.ok) throw new Error(r.error)
    return r.request
  }

  it('imports JSON bodies, bearer auth and params', () => {
    const req = fromHttpRequest(
      parse(
        `curl 'https://a.dev/api?page=2&q=x' -H 'Authorization: Bearer abc.def' -H 'Content-Type: application/json' -H 'X-A: 1' --data-raw '{"a":[1,2]}' -m 5`,
      ),
    )
    expect(req.method).toBe('POST')
    expect(pairs(req.params)).toEqual([
      ['page', '2', true],
      ['q', 'x', true],
    ])
    expect(req.auth).toMatchObject({ type: 'bearer', token: 'abc.def' })
    expect(pairs(req.headers)).toEqual([['X-A', '1', true]])
    expect(req.body.mode).toBe('json')
    // 请求体原样保留（签名等场景要求字节一致），不自动格式化
    expect(req.body.json).toBe('{"a":[1,2]}')
    expect(req.settings.timeoutMs).toBe(5000)
  })

  it('keeps big integers and exact bytes of JSON bodies (regression)', () => {
    const body = '{"id":12345678901234567890,"price":1.50,"s":"\\u4e2d"}'
    const req = fromHttpRequest(
      parse(`curl https://a.dev -H 'Content-Type: application/json' --data-raw '${body}'`),
    )
    expect(req.body.json).toBe(body)
    const built = buildRequest(req, {})
    expect(built.request.body).toEqual({ kind: 'text', text: body })
  })

  it('reports what the editor cannot represent', () => {
    expect(importNotes(parse('curl -X PROPFIND https://a.dev'))).toEqual([
      '不支持 PROPFIND 方法，已改为 POST',
    ])
    expect(importNotes(parse('curl -k -T a.bin https://a.dev'))).toEqual([
      '请求体来自本地文件「a.bin」，请在「请求体」里重新选择',
      '忽略证书校验（-k）无法在这里设置，已忽略',
    ])
    expect(importNotes(parse("curl -F 'f=@x.png' https://a.dev"))).toEqual([
      '表单里的文件字段需要重新选择文件',
    ])
    expect(importNotes(parse('curl https://a.dev'))).toEqual([])
    expect(fromHttpRequest({ ...parse('curl https://a.dev'), method: 'patch' }).method).toBe(
      'PATCH',
    )
  })

  it('imports basic auth from -u and from an Authorization header', () => {
    expect(fromHttpRequest(parse('curl -u admin:secret https://a.dev')).auth).toMatchObject({
      type: 'basic',
      username: 'admin',
      password: 'secret',
    })
    expect(
      fromHttpRequest(parse("curl https://a.dev -H 'Authorization: Basic 55So5oi3OuWvhueggQ=='"))
        .auth,
    ).toMatchObject({ type: 'basic', username: '用户', password: '密码' })
  })

  it('imports urlencoded bodies as a table', () => {
    const req = fromHttpRequest(parse("curl https://a.dev -d 'name=%E5%BC%A0+%E4%B8%89' -d 'flag'"))
    expect(req.body.mode).toBe('urlencoded')
    expect(pairs(req.body.urlencoded)).toEqual([
      ['name', '张 三', true],
      ['flag', '', true],
    ])
    expect(req.headers).toEqual([])
  })

  it('imports multipart forms, XML, text and file bodies', () => {
    const fd = fromHttpRequest(
      parse("curl https://a.dev -F 'a=1' -F 'f=@/tmp/x.png;type=image/png'"),
    )
    expect(fd.body.mode).toBe('form-data')
    expect(fd.body.formData.map((f) => [f.key, f.value, f.type, f.fileName, f.fileType])).toEqual([
      ['a', '1', 'text', undefined, undefined],
      ['f', '', 'file', 'x.png', 'image/png'],
    ])
    expect(
      fromHttpRequest(parse("curl https://a.dev -H 'Content-Type: text/xml' -d '<a/>'")).body.mode,
    ).toBe('xml')
    expect(
      fromHttpRequest(parse("curl https://a.dev -H 'Content-Type: text/plain' -d 'hi'")).body.mode,
    ).toBe('text')
    expect(fromHttpRequest(parse('curl -T a.bin https://a.dev')).body.mode).toBe('binary')
    // curl -d 发送 JSON 但没写 Content-Type 时：用 JSON 编辑器，但保留 curl 默认的 form Content-Type
    const implicit = fromHttpRequest(parse(`curl https://a.dev --data-raw '{"a":1}'`))
    expect(implicit.body.mode).toBe('json')
    expect(pairs(implicit.headers)).toEqual([
      ['Content-Type', 'application/x-www-form-urlencoded', true],
    ])
  })

  it('maps unknown methods to POST and keeps redirect settings', () => {
    const r = fromHttpRequest(parse('curl -X PROPFIND https://a.dev'))
    expect(r.method).toBe('POST')
    expect(
      fromHttpRequest({ ...parse('curl https://a.dev'), followRedirects: false }).settings
        .followRedirects,
    ).toBe(false)
  })
})

describe('misc', () => {
  it('requestSignature ignores row ids', () => {
    const a = newRequest({ url: 'x', headers: [kv('a', '1')] })
    expect(requestSignature(a)).toBe(requestSignature(cloneRequest(a)))
    expect(requestSignature(a)).not.toBe(requestSignature({ ...a, url: 'y' }))
  })
  it('requestLabel', () => {
    expect(requestLabel({ url: '' })).toBe('新请求')
    expect(requestLabel({ url: 'https://api.dev/users/1?x=1' })).toBe('/users/1')
    expect(requestLabel({ url: 'https://api.dev/' })).toBe('api.dev')
    expect(requestLabel({ url: '{{base}}/posts' })).toBe('/posts')
    expect(requestLabel({ url: 'https://a.dev/' + 'x'.repeat(80) }).length).toBe(40)
  })
  it('cloneRequest gives rows new ids', () => {
    const a = newRequest({ headers: [kv('a', '1')] })
    const b = cloneRequest(a)
    expect(b.headers[0].id).not.toBe(a.headers[0].id)
    expect(b.headers[0].key).toBe('a')
  })
})

describe('locateJsonError', () => {
  it.each([
    ['{"a":1,}', 7, '多余的逗号'],
    ['[1,2,]', 5, '多余的逗号'],
    ['{"a" 1}', 5, '缺少冒号'],
    ["{'a':1}", 1, '双引号'],
    ['{"a":1 "b":2}', 7, '缺少逗号'],
    ['{"a":"x', 5, '没有闭合'],
    ['{"a":"x\ny"}', 7, '不能直接换行'],
    ['{"a":"\\q"}', 6, '无效的转义'],
    ['{"a":tru}', 5, '意外的字符'],
    ['{"a":1}}', 7, '多余内容'],
    ['[1, 2', 5, '数组没有闭合'],
    ['{"a":01}', 6, '缺少逗号'],
    ['-', 0, '数字格式'],
    ['', 0, '意外结束'],
  ])('%s', (text, index, reason) => {
    const r = locateJsonError(text)
    expect(r.index).toBe(index)
    expect(r.reason).toContain(reason)
  })

  it('validateJson uses the located position', () => {
    expect(validateJson('{\n  "a": 1,\n}')).toEqual({
      ok: false,
      error: 'JSON 格式错误（第 3 行第 1 列）：多余的逗号',
    })
    expect(validateJson('{"emoji":"😀","中":1,}')).toMatchObject({ ok: false })
  })
})
