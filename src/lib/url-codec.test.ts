import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  domainToUnicode,
  encodeQueryPart,
  lineColumn,
  parseQuery,
  parseUrl,
  rebuildUrl,
  safeDecode,
  serializeQuery,
  splitUrl,
  urlDecode,
  urlEncode,
  urlToJson,
  type QueryParam,
} from './url-codec'

const SAMPLES = [
  '',
  'hello world',
  '你好，世界！',
  'a+b=c&d=e#f?g/h;i:j@k$l,m',
  "!~*'()-_.",
  '😀 👨\u200d👩\u200d👧 emoji',
  '%41 already',
  '[ipv6] {braces} |pipe| ^caret` "quote" <tag>\\',
  'tab\there\nnew line',
]

describe('urlEncode', () => {
  it.each(SAMPLES)('component matches encodeURIComponent: %j', (s) => {
    expect(urlEncode(s, { mode: 'component' }).output).toBe(encodeURIComponent(s))
  })

  it.each(SAMPLES)('uri matches encodeURI: %j', (s) => {
    expect(urlEncode(s, { mode: 'uri' }).output).toBe(encodeURI(s))
  })

  it.each(SAMPLES)('form matches URLSearchParams: %j', (s) => {
    const expected = new URLSearchParams({ x: s }).toString().slice(2)
    expect(urlEncode(s, { mode: 'form' }).output).toBe(expected)
  })

  it("strict RFC 3986 also escapes !'()*", () => {
    expect(urlEncode("!'()*~", { mode: 'component', strict: true }).output).toBe('%21%27%28%29%2A~')
  })

  it('can keep existing escapes to avoid double encoding', () => {
    expect(urlEncode('a%20b c%zz', { mode: 'component', keepEscapes: true }).output).toBe(
      'a%20b%20c%25zz',
    )
    expect(urlEncode('%e4%b8%ad', { mode: 'component', keepEscapes: true }).output).toBe(
      '%E4%B8%AD',
    )
  })

  it('encodes per line without touching newlines', () => {
    const r = urlEncode('a b\r\n\nc&d', { mode: 'component', perLine: true })
    expect(r.output).toBe('a%20b\n\nc%26d')
    expect(urlEncode('a b\nc', { mode: 'component' }).output).toBe('a%20b%0Ac')
  })

  it('reports lone surrogates with position', () => {
    const r = urlEncode('ok\n中\ud800x', { mode: 'component' })
    expect(r.output).toBe('ok%0A%E4%B8%AD%EF%BF%BDx')
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0]).toMatchObject({ line: 2, column: 2, index: 4 })
    expect(r.issues[0].message).toContain('孤立的代理项')
  })
})

describe('urlDecode', () => {
  it.each(SAMPLES)('component round-trips: %j', (s) => {
    const enc = encodeURIComponent(s)
    const r = urlDecode(enc, { mode: 'component' })
    expect(r.output).toBe(s)
    expect(r.issues).toEqual([])
  })

  it('uri mode keeps reserved characters escaped like decodeURI', () => {
    const s = '%2F%3F%23%26%3D%20%E4%B8%AD%41'
    expect(urlDecode(s, { mode: 'uri' }).output).toBe(decodeURI(s))
    expect(urlDecode(s, { mode: 'uri' }).output).toBe('%2F%3F%23%26%3D 中A')
  })

  it('form mode turns + into spaces', () => {
    expect(urlDecode('a+b%2Bc+%E4%B8%AD', { mode: 'form' }).output).toBe('a b+c 中')
    expect(urlDecode('a+b', { mode: 'component' }).output).toBe('a+b')
  })

  it('keeps malformed sequences and reports exact positions', () => {
    const r = urlDecode('ok%20\n100% and %zz and %E4%B8 end', { mode: 'component' })
    expect(r.output).toBe('ok \n100% and %zz and %E4%B8 end')
    expect(r.issues.map((i) => [i.line, i.column, i.text])).toEqual([
      [2, 4, '% a'],
      [2, 10, '%zz'],
      [2, 18, '%E4%B8'],
    ])
    expect(r.issues[2].message).toContain('不是完整或合法的 UTF-8')
    expect(urlDecode('50%', { mode: 'component' }).issues[0].message).toContain('末尾')
  })

  it('handles overlong, stray continuation bytes and valid neighbours', () => {
    const r = urlDecode('%C0%AF%E4%B8%AD%80x', { mode: 'component' })
    expect(r.output).toBe('%C0%AF中%80x')
    expect(r.issues.map((i) => i.text)).toEqual(['%C0%AF', '%80'])
    expect(r.issues[1].message).toContain('孤立的 UTF-8 后续字节')
  })

  it('decodes 4-byte sequences and lowercase hex', () => {
    expect(urlDecode('%f0%9f%98%80', { mode: 'component' }).output).toBe('😀')
  })

  it('computes positions per line in batch mode', () => {
    const r = urlDecode('a%20b\nc%2', { mode: 'component', perLine: true })
    expect(r.output).toBe('a b\nc%2')
    expect(r.issues[0]).toMatchObject({ line: 2, column: 2 })
  })

  it('handles large input quickly', () => {
    const big = encodeURIComponent('中文 test/?&='.repeat(20000))
    const t = performance.now()
    expect(urlDecode(big, { mode: 'component' }).output).toBe('中文 test/?&='.repeat(20000))
    expect(performance.now() - t).toBeLessThan(2000)
  })
})

describe('parseUrl', () => {
  it('breaks a full URL into parts', () => {
    const r = parseUrl(
      'https://user:p%40ss@例子.测试:8443/a/%E4%B8%AD/b?q=%E4%BD%A0%E5%A5%BD&x=1+2&x=3&flag#top',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.assumedScheme).toBe(false)
    expect(r.url).toMatchObject({
      protocol: 'https:',
      username: 'user',
      password: 'p%40ss',
      hostname: 'xn--fsqu00a.xn--0zwm56d',
      hostUnicode: '例子.测试',
      port: '8443',
      pathname: '/a/%E4%B8%AD/b',
      hash: '#top',
    })
    expect(r.params.map((p) => [p.key, p.value, p.hasValue])).toEqual([
      ['q', '你好', true],
      ['x', '1 2', true],
      ['x', '3', true],
      ['flag', '', false],
    ])
  })

  it('assumes https:// when the scheme is missing', () => {
    const r = parseUrl('example.com/path?a=1')
    expect(r.ok && r.assumedScheme).toBe(true)
    expect(r.ok && r.url.hostname).toBe('example.com')
    expect(r.ok && r.url.defaultPort).toBe('443')
    const local = parseUrl('localhost:3000/api')
    expect(local.ok && local.url.port).toBe('3000')
    expect(local.ok && local.assumedScheme).toBe(true)
    expect(parseUrl('//cdn.example.com/x.js').ok).toBe(true)
  })

  it('keeps non-http schemes', () => {
    const r = parseUrl('mailto:someone@example.com?subject=Hi%20there')
    expect(r.ok && r.url.protocol).toBe('mailto:')
    expect(r.ok && r.params[0].value).toBe('Hi there')
  })

  it('explains common errors in Chinese', () => {
    expect(parseUrl('').ok).toBe(false)
    const port = parseUrl('https://example.com:99999/')
    expect(!port.ok && port.error).toContain('超出范围')
    const nonDigit = parseUrl('http://example.com:abc/')
    expect(!nonDigit.ok && nonDigit.error).toContain('不是数字')
    const space = parseUrl('https://exa mple.com')
    expect(!space.ok && space.error).toContain('空白')
    const noHost = parseUrl('https://')
    expect(!noHost.ok && noHost.error).toContain('缺少主机名')
    const badChar = parseUrl('https://exa<mple.com')
    expect(!badChar.ok && badChar.error).toContain('“<”')
    const v6 = parseUrl('https://[::1')
    expect(!v6.ok && v6.error).toContain('右方括号')
    const v6bad = parseUrl('https://[zz]/')
    expect(!v6bad.ok && v6bad.error).toContain('IPv6')
  })
})

describe('query editing', () => {
  it('splits URLs without normalising them', () => {
    expect(splitUrl('https://a.com/p?x=1#h?y')).toEqual({
      base: 'https://a.com/p',
      query: 'x=1',
      hash: '#h?y',
    })
    expect(splitUrl('https://a.com')).toEqual({ base: 'https://a.com', query: null, hash: '' })
  })

  it('preserves untouched params exactly and re-encodes edited ones', () => {
    const input = 'https://a.com/s?q=a%2Cb&tag=x+y&empty=#frag'
    const params = parseQuery(splitUrl(input).query!)
    expect(rebuildUrl(input, params)).toBe(input)
    const edited: QueryParam[] = [
      { ...params[0], value: '你好 & 再见', raw: null },
      params[1],
      { key: 'new key', value: 'a/b?c=d#e+f', hasValue: true, raw: null },
    ]
    expect(rebuildUrl(input, edited)).toBe(
      'https://a.com/s?q=%E4%BD%A0%E5%A5%BD%20%26%20%E5%86%8D%E8%A7%81&tag=x+y&new%20key=a/b?c%3Dd%23e%2Bf#frag',
    )
    expect(rebuildUrl(input, edited, true)).toContain('q=%E4%BD%A0%E5%A5%BD+%26+')
    expect(rebuildUrl(input, [])).toBe('https://a.com/s#frag')
  })

  it('round-trips encodeQueryPart through parseQuery', () => {
    for (const s of SAMPLES) {
      const q = `k=${encodeQueryPart(s)}`
      expect(parseQuery(q)[0].value).toBe(s)
      expect(parseQuery(`k=${encodeQueryPart(s, true)}`)[0].value).toBe(s)
    }
  })

  it('serializes flags and tolerates bad escapes', () => {
    expect(serializeQuery([{ key: 'debug', value: '', hasValue: false, raw: null }])).toBe('debug')
    expect(parseQuery('a=%E4%B8&&b')[0].value).toBe('%E4%B8')
    expect(parseQuery('a=%E4%B8&&b')).toHaveLength(2)
    expect(safeDecode('100%')).toBe('100%')
  })

  it('exports JSON with repeated keys as arrays', () => {
    const r = parseUrl('https://a.com/x/%E4%B8%AD?a=1&a=2&b=3')
    if (!r.ok) throw new Error(r.error)
    const json = JSON.parse(urlToJson(r.url, r.params))
    expect(json.query).toEqual({ a: ['1', '2'], b: '3' })
    expect(json.pathSegments).toEqual(['x', '中'])
    expect(json.hostname).toBe('a.com')
  })
})

describe('domainToUnicode', () => {
  it('decodes punycode labels', () => {
    expect(domainToUnicode('xn--fiqs8s.xn--fiqz9s')).toBe('中国.中國')
    expect(domainToUnicode('xn--mnchen-3ya.de')).toBe('münchen.de')
    expect(domainToUnicode('xn--ls8h.la')).toBe('💩.la')
    expect(domainToUnicode('example.com')).toBe('example.com')
    expect(domainToUnicode('xn--!!!.com')).toBe('xn--!!!.com')
  })
})

describe('regressions', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses relative URLs instead of treating the first path segment as a host', () => {
    const r = parseUrl('/api/users?page=2&q=%E4%B8%AD#list')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.relative).toBe(true)
    expect(r.assumedScheme).toBe(false)
    expect(r.url).toMatchObject({
      protocol: '',
      hostname: '',
      pathname: '/api/users',
      search: '?page=2&q=%E4%B8%AD',
      hash: '#list',
      origin: '',
    })
    expect(r.params.map((p) => [p.key, p.value])).toEqual([
      ['page', '2'],
      ['q', '中'],
    ])
    const q = parseUrl('?a=1&b=2')
    expect(q.ok && q.relative && q.params.length).toBe(2)
    expect(q.ok && q.url.pathname).toBe('')
    const dot = parseUrl('../img/a.png?v=3')
    expect(dot.ok && dot.url.pathname).toBe('../img/a.png')
    expect(parseUrl('#top').ok).toBe(true)
    // 协议相对地址仍然补全为 https
    const pr = parseUrl('//cdn.example.com/x.js')
    expect(pr.ok && !pr.relative && pr.url.hostname).toBe('cdn.example.com')
    // 相对地址的查询参数同样可以编辑重建
    expect(rebuildUrl('/s?a=1#h', [{ key: 'b', value: '中', hasValue: true, raw: null }])).toBe(
      '/s?b=%E4%B8%AD#h',
    )
    const ws = parseUrl('/a b?x=1')
    expect(!ws.ok && ws.error).toContain('空白')
  })

  it('collects parameters named like Object.prototype members in JSON', () => {
    const r = parseUrl('https://a.com/?constructor=1&toString=2&__proto__=3&__proto__=4&a=5')
    if (!r.ok) throw new Error(r.error)
    const json = JSON.parse(urlToJson(r.url, r.params))
    expect(json.query.constructor).toBe('1')
    expect(json.query.toString).toBe('2')
    expect(Object.getOwnPropertyDescriptor(json.query, '__proto__')?.value).toEqual(['3', '4'])
    expect(json.query.a).toBe('5')
  })

  it('omits origin in JSON for relative URLs', () => {
    const r = parseUrl('/p?x=1')
    if (!r.ok) throw new Error(r.error)
    expect(JSON.parse(urlToJson(r.url, r.params))).not.toHaveProperty('origin')
  })

  it('rejects hosts that lenient URL parsers (Chromium) percent-encode', () => {
    // 模拟 Chromium：非法主机字符被百分号编码后照样返回
    const Real = URL
    class LenientURL extends Real {
      #host: string | null = null
      constructor(input: string, base?: string) {
        const m = /^(https?:\/\/)([^/?#]*)(.*)$/.exec(input)
        const bad = !!m && /[ <]/.test(m[2])
        super(bad ? `${m[1]}placeholder.invalid${m[3]}` : input, base)
        if (bad) this.#host = m[2].replace(/ /g, '%20').replace(/</g, '%3C')
      }
      get hostname() {
        return this.#host ?? super.hostname
      }
    }
    vi.stubGlobal('URL', LenientURL)
    const space = parseUrl('https://exa mple.com/path')
    expect(space.ok).toBe(false)
    expect(!space.ok && space.error).toContain('主机名中不能含有空白字符')
    const lt = parseUrl('https://exa<mple.com')
    expect(!lt.ok && lt.error).toContain('“<”')
    expect(parseUrl('https://example.com/a b').ok).toBe(true)
  })

  it('keeps line / column exact for many issues on one long line', () => {
    const text = 'x\n' + '😀%'.repeat(50) + '%zz'
    const r = urlDecode(text, { mode: 'component' })
    expect(r.issues[0]).toMatchObject({ line: 2, column: 2 })
    expect(r.issues[1]).toMatchObject({ line: 2, column: 4 })
    expect(r.issues[50]).toMatchObject({ line: 2, column: 101, text: '%zz' })
    expect(lineColumn('a😀b\ncd', 4)).toEqual({ line: 1, column: 4 })
    expect(lineColumn('a😀b\ncd', 6)).toEqual({ line: 2, column: 2 })
    const big = 'a%'.repeat(400_000)
    const t = performance.now()
    const many = urlDecode(big, { mode: 'component' })
    expect(many.issues).toHaveLength(200)
    expect(many.issues[199].column).toBe(400)
    expect(performance.now() - t).toBeLessThan(1500)
  })
})
