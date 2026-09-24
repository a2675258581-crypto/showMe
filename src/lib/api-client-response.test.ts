import { describe, expect, it } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  charsetOf,
  decodeText,
  detectBodyKind,
  formatDuration,
  getHeader,
  hexDump,
  isLikelyText,
  mimeType,
  parseProxyResult,
  parseSetCookie,
  prettyJson,
  previewDocument,
  prettyXml,
  reasonPhrase,
  responseCookies,
  statusMeaning,
  statusTone,
  suggestFileName,
  truncateText,
  withBaseHref,
} from './api-client-response'

const enc = (s: string) => new TextEncoder().encode(s)

describe('base64', () => {
  it('round-trips binary, unicode and large buffers', () => {
    const bytes = new Uint8Array(256).map((_, i) => i)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
    expect(bytesToBase64(enc('中文😀'))).toBe('5Lit5paH8J+YgA==')
    const big = new Uint8Array(300_000).map((_, i) => (i * 7) % 256)
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big)
    expect(bytesToBase64(new Uint8Array())).toBe('')
  })
})

describe('parseProxyResult', () => {
  it('accepts success and failure payloads', () => {
    expect(
      parseProxyResult({
        ok: true,
        status: 201,
        statusText: 'Created',
        url: 'https://a.dev',
        redirected: false,
        headers: [['a', 'b'], ['bad'], 'x'],
        bodyBase64: 'e30=',
        size: 2,
        timeMs: 12,
      }),
    ).toEqual({
      ok: true,
      status: 201,
      statusText: 'Created',
      url: 'https://a.dev',
      redirected: false,
      headers: [['a', 'b']],
      bodyBase64: 'e30=',
      size: 2,
      timeMs: 12,
    })
    expect(parseProxyResult({ ok: false, error: '请求超时（1 ms）', timeMs: 1 })).toEqual({
      ok: false,
      error: '请求超时（1 ms）',
      timeMs: 1,
    })
  })
  it('rejects malformed payloads', () => {
    expect(parseProxyResult(null)).toBeNull()
    expect(parseProxyResult('x')).toBeNull()
    expect(parseProxyResult({ ok: true })).toBeNull()
    expect(parseProxyResult({ ok: false })).toMatchObject({
      ok: false,
      error: '代理返回了未知错误',
    })
  })
})

describe('content type helpers', () => {
  it('getHeader / mimeType / charsetOf', () => {
    expect(getHeader([['Content-Type', 'x']], 'content-type')).toBe('x')
    expect(getHeader([], 'a')).toBeUndefined()
    expect(mimeType('Application/JSON; charset=UTF-8')).toBe('application/json')
    expect(mimeType(undefined)).toBe('')
    expect(charsetOf('text/html; charset="GBK"')).toBe('gbk')
    expect(charsetOf('text/html')).toBeUndefined()
  })

  it('decodeText honours charset and falls back to UTF-8', () => {
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]) // 「中文」
    expect(decodeText(gbk, 'text/plain; charset=gbk')).toBe('中文')
    expect(decodeText(enc('中文'), 'text/plain; charset=bogus')).toBe('中文')
    expect(decodeText(enc('😀'))).toBe('😀')
  })

  it('isLikelyText', () => {
    expect(isLikelyText(enc('hello\nworld\t中文'))).toBe(true)
    expect(isLikelyText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]))).toBe(false)
    expect(isLikelyText(new Uint8Array())).toBe(true)
  })

  it.each([
    ['application/json', '{"a":1}', 'json'],
    ['application/problem+json', '{}', 'json'],
    ['text/plain', '[1,2]', 'json'],
    ['', '{"a":1}', 'json'],
    ['text/plain', '{not json', 'text'],
    ['text/html; charset=utf-8', '<p>x</p>', 'html'],
    ['', '<!DOCTYPE html><html></html>', 'html'],
    ['application/xml', '<a/>', 'xml'],
    ['application/atom+xml', '<feed/>', 'xml'],
    ['', '<?xml version="1.0"?><a/>', 'xml'],
    ['application/javascript', 'let a', 'javascript'],
    ['text/css', 'a{}', 'css'],
    ['image/png', '\x89PNG', 'image'],
    ['application/octet-stream', 'plain words', 'text'],
    ['', '', 'empty'],
  ])('detectBodyKind(%s, %s) = %s', (ct, body, kind) => {
    expect(detectBodyKind(ct, enc(body))).toBe(kind)
  })

  it('detects binary', () => {
    expect(detectBodyKind('application/octet-stream', new Uint8Array([0, 1, 2, 3]))).toBe('binary')
  })
})

describe('pretty printing', () => {
  it('prettyJson', () => {
    expect(prettyJson('{"a":{"b":[1]}}')).toBe('{\n  "a": {\n    "b": [\n      1\n    ]\n  }\n}')
    expect(prettyJson('nope')).toBeNull()
  })

  it('prettyJson keeps big integers and number spelling (regression)', () => {
    expect(prettyJson('{"id":1234567890123456789,"p":2.10}')).toBe(
      '{\n  "id": 1234567890123456789,\n  "p": 2.10\n}',
    )
    expect(prettyJson('[]')).toBe('[]')
    expect(prettyJson('"中文 😀"')).toBe('"中文 😀"')
    expect(prettyJson('{"a":1}{"b":2}')).toBeNull()
  })

  it('truncateText prefers line boundaries and never splits surrogate pairs', () => {
    expect(truncateText('short', 10)).toEqual({ text: 'short', truncated: false })
    expect(truncateText('aaaaaaaaa\nbbbbbbbbb', 11)).toEqual({ text: 'aaaaaaaaa', truncated: true })
    // 换行离截断点太远时直接按字符截断，避免丢掉太多内容
    expect(truncateText('a\nbbbbbbbbbbbbbbbbbbb', 12)).toEqual({
      text: 'a\nbbbbbbbbbb',
      truncated: true,
    })
    expect(truncateText('abcdefghij', 5)).toEqual({ text: 'abcde', truncated: true })
    const emoji = 'abcd😀efgh'
    expect(truncateText(emoji, 5)).toEqual({ text: 'abcd', truncated: true })
    expect(truncateText('', 0)).toEqual({ text: '', truncated: false })
  })

  it('previewDocument strips scripts and inline handlers, keeps content', () => {
    const html =
      '<html><head><script src="a.js"></script></head><body onload="x()"><h1 class="t" onclick=\'y()\'>你好</h1><SCRIPT>alert(1)</SCRIPT><img src=a.png onerror=z()></body></html>'
    expect(previewDocument(html, 'https://a.dev/')).toBe(
      '<html><head><base href="https://a.dev/"></head><body><h1 class="t">你好</h1><img src=a.png></body></html>',
    )
    expect(previewDocument('<p>x</p><script>never closed', '')).toBe('<p>x</p>')
    expect(previewDocument('<p>on=1 onclick="text"</p>', '')).toBe('<p>on=1 onclick="text"</p>')
  })

  it('prettyXml indents nested elements and keeps text-only elements inline', () => {
    expect(
      prettyXml(
        '<?xml version="1.0"?><root><a x="1">text</a><b><c/><d></d></b><!-- note --><e><![CDATA[<raw>]]></e></root>',
      ),
    ).toBe(
      [
        '<?xml version="1.0"?>',
        '<root>',
        '  <a x="1">text</a>',
        '  <b>',
        '    <c/>',
        '    <d></d>',
        '  </b>',
        '  <!-- note -->',
        '  <e>',
        '    <![CDATA[<raw>]]>',
        '  </e>',
        '</root>',
      ].join('\n'),
    )
    expect(prettyXml('plain text')).toBe('plain text')
    expect(prettyXml('')).toBe('')
  })

  it('withBaseHref', () => {
    expect(withBaseHref('<html><head><title>x</title></head></html>', 'https://a.dev/p')).toBe(
      '<html><head><base href="https://a.dev/p"><title>x</title></head></html>',
    )
    expect(withBaseHref('<p>x</p>', 'https://a.dev/"q')).toBe(
      '<base href="https://a.dev/&quot;q"><p>x</p>',
    )
    expect(withBaseHref('<base href="/"><p/>', 'https://a.dev')).toBe('<base href="/"><p/>')
  })

  it('hexDump', () => {
    const dump = hexDump(enc('Hello, 世界!\x00'), 4096)
    expect(dump.split('\n')[0]).toBe(
      '00000000  48 65 6c 6c 6f 2c 20 e4 b8 96 e7 95 8c 21 00     Hello, ......!.',
    )
    expect(hexDump(new Uint8Array(40), 16).split('\n')).toHaveLength(2)
  })

  it('formatDuration', () => {
    expect(formatDuration(12.4)).toBe('12 ms')
    expect(formatDuration(1234)).toBe('1.23 s')
    expect(formatDuration(12_345)).toBe('12.3 s')
    expect(formatDuration(125_000)).toBe('2 min 5 s')
    expect(formatDuration(NaN)).toBe('-')
  })
})

describe('status', () => {
  it('statusTone', () => {
    expect([101, 200, 204, 301, 404, 418, 500, 503].map(statusTone)).toEqual([
      'info',
      'success',
      'success',
      'redirect',
      'client',
      'client',
      'server',
      'server',
    ])
  })
  it('reasonPhrase / statusMeaning', () => {
    expect(reasonPhrase(404, '')).toBe('Not Found')
    expect(reasonPhrase(200, 'Everything OK')).toBe('Everything OK')
    expect(reasonPhrase(299)).toBe('')
    expect(statusMeaning(429)).toBe('请求过多')
  })
})

describe('cookies', () => {
  it('parses attributes', () => {
    expect(
      parseSetCookie(
        'sid="abc=123"; Path=/; Domain=.example.com; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600; Secure; HttpOnly; SameSite=Lax; Partitioned',
      ),
    ).toEqual({
      name: 'sid',
      value: 'abc=123',
      path: '/',
      domain: '.example.com',
      expires: 'Wed, 21 Oct 2026 07:28:00 GMT',
      maxAge: 3600,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      partitioned: true,
    })
    expect(parseSetCookie('flag')).toMatchObject({ name: '', value: 'flag' })
    expect(parseSetCookie('')).toBeNull()
    const bad = parseSetCookie('名字=值; max-age=abc')
    expect(bad).toMatchObject({ name: '名字', value: '值' })
    expect(bad).not.toHaveProperty('maxAge')
  })

  it('collects multiple set-cookie headers', () => {
    expect(
      responseCookies([
        ['set-cookie', 'a=1'],
        ['content-type', 'x'],
        ['Set-Cookie', 'b=2; HttpOnly'],
      ]).map((c) => [c.name, c.value, c.httpOnly]),
    ).toEqual([
      ['a', '1', false],
      ['b', '2', true],
    ])
  })
})

describe('suggestFileName', () => {
  it.each([
    ['https://a.dev/files/report.pdf', 'application/pdf', undefined, 'report.pdf'],
    ['https://a.dev/api/users', 'application/json; charset=utf-8', undefined, 'users.json'],
    ['https://a.dev/', 'text/html', undefined, 'response.html'],
    ['https://a.dev/x', 'application/vnd.api+json', undefined, 'x.json'],
    [
      'https://a.dev/x',
      'application/octet-stream',
      'attachment; filename="data 1.csv"',
      'data 1.csv',
    ],
    ['https://a.dev/x', '', "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.xlsx", '报告.xlsx'],
    ['not a url', 'image/png', undefined, 'response.png'],
    ['https://a.dev/%E4%B8%AD%E6%96%87', 'text/plain', undefined, '中文.txt'],
  ])('%s', (url, ct, disp, name) => {
    expect(suggestFileName(url, ct, disp)).toBe(name)
  })
})
