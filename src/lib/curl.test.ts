import { describe, expect, it } from 'vitest'
import {
  appendQuery,
  curlEscape,
  describePosition,
  detectDialect,
  looksLikeCurl,
  parseCurl,
  tokenizeBash,
  tokenizeCmd,
  type HttpRequest,
} from './curl'

function ok(input: string): { request: HttpRequest; warnings: string[] } {
  const r = parseCurl(input)
  if (!r.ok) throw new Error('expected ok, got: ' + r.error)
  return r
}

function header(req: HttpRequest, name: string): string | undefined {
  return req.headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]
}

// ───────────────────────── 真实的 Chrome DevTools 样本 ─────────────────────────

const CHROME_BASH = `curl 'https://api.github.com/graphql' \\
  -H 'accept: application/json' \\
  -H 'accept-language: zh-CN,zh;q=0.9,en;q=0.8' \\
  -H 'content-type: application/json' \\
  -b '_octo=GH1.1.123.456; logged_in=yes' \\
  -H 'origin: https://github.com' \\
  -H 'priority: u=1, i' \\
  -H 'referer: https://github.com/' \\
  -H 'sec-ch-ua: "Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"' \\
  -H 'sec-ch-ua-mobile: ?0' \\
  -H 'sec-ch-ua-platform: "macOS"' \\
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' \\
  --data-raw '{"query":"{ viewer { login } }","variables":{}}'`

const CHROME_BASH_ANSI = `curl 'https://example.com/api/notes' \\
  -H 'content-type: application/json' \\
  --data-raw $'{"text":"it\\'s ok\\u0021\\nline2","path":"C:\\\\\\\\temp"}' \\
  --compressed`

const CHROME_CMD = [
  'curl ^"https://example.com/api/items?page=1^&size=20^" ^',
  '  -H ^"accept: application/json, text/plain, */*^" ^',
  '  -H ^"content-type: application/json;charset=UTF-8^" ^',
  '  -b ^"sid=abc123; theme=dark^" ^',
  '  -H ^"user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)^" ^',
  '  --data-raw ^"^{^\\^"name^\\^":^\\^"^测^试 ^😀^\\^",^\\^"tags^\\^":^[^\\^"a^\\^",^\\^"b^\\^"^],^\\^"pct^\\^":^\\^"50%^25^\\^"^}^" ^',
  '  --compressed',
].join('\r\n')

describe('Chrome DevTools「Copy as cURL」', () => {
  it('parses bash format', () => {
    const { request, warnings } = ok(CHROME_BASH)
    expect(warnings).toEqual([])
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.github.com/graphql')
    expect(header(request, 'sec-ch-ua')).toBe(
      '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    )
    expect(header(request, 'cookie')).toBe('_octo=GH1.1.123.456; logged_in=yes')
    expect(header(request, 'content-type')).toBe('application/json')
    expect(request.headers).toHaveLength(11)
    expect(request.body).toEqual({
      kind: 'text',
      text: '{"query":"{ viewer { login } }","variables":{}}',
    })
  })

  it("parses bash $'…' ANSI-C quoted bodies", () => {
    const { request } = ok(CHROME_BASH_ANSI)
    expect(request.compressed).toBe(true)
    expect(request.body).toEqual({
      kind: 'text',
      text: '{"text":"it\'s ok!\nline2","path":"C:\\\\temp"}',
    })
  })

  it('parses cmd format with ^ escapes and CRLF continuations', () => {
    expect(detectDialect(CHROME_CMD)).toBe('cmd')
    const { request, warnings } = ok(CHROME_CMD)
    expect(warnings).toEqual([])
    expect(request.url).toBe('https://example.com/api/items?page=1&size=20')
    expect(request.method).toBe('POST')
    expect(header(request, 'accept')).toBe('application/json, text/plain, */*')
    expect(header(request, 'cookie')).toBe('sid=abc123; theme=dark')
    expect(request.compressed).toBe(true)
    const body = (request.body as { text: string }).text
    expect(JSON.parse(body)).toEqual({ name: '测试 😀', tags: ['a', 'b'], pct: '50%25' })
  })

  it('handles cmd newlines inside data (^ + blank line)', () => {
    const src = 'curl ^"https://x.dev/^" ^\n  --data-raw ^"line1^\n\nline2^"'
    const { request } = ok(src)
    expect(request.body).toEqual({ kind: 'text', text: 'line1\nline2' })
  })

  it('handles cmd backslashes doubled by Chrome', () => {
    const src = 'curl ^"https://x.dev/^" --data-raw ^"^{^\\^"p^\\^":^\\^"C:^\\^\\^\\^\\dir^\\^"^}^"'
    const { request } = ok(src)
    expect(JSON.parse((request.body as { text: string }).text)).toEqual({ p: 'C:\\dir' })
  })

  it('parses plain Windows cmd style with \\" escapes', () => {
    const { request } = ok(
      'curl -X POST "http://localhost:8080/api" -H "Content-Type: application/json" -d "{\\"a\\":1}"',
    )
    expect(request.body).toEqual({ kind: 'text', text: '{"a":1}' })
  })
})

// ───────────────────────── 分词 ─────────────────────────

describe('tokenizeBash', () => {
  it('handles quotes, concatenation and escapes', () => {
    expect(tokenizeBash(`curl 'a b' "c d" e\\ f 'g'"h"i`).tokens).toEqual([
      'curl',
      'a b',
      'c d',
      'e f',
      'ghi',
    ])
  })

  it('keeps unknown escapes inside double quotes', () => {
    expect(tokenizeBash('x "\\"q\\" \\$HOME \\\\ \\n"').tokens).toEqual(['x', '"q" $HOME \\ \\n'])
  })

  it('supports empty strings', () => {
    expect(tokenizeBash(`a '' ""`).tokens).toEqual(['a', '', ''])
  })

  it("decodes $'…' escapes including octal, hex, unicode and control chars", () => {
    expect(tokenizeBash(`$'\\x41\\u4e2d\\101\\t\\cA\\U0001F600'`).tokens).toEqual(['A中A\t\x01😀'])
    expect(tokenizeBash(`$'\\xe4\\xb8\\xad\\xe6\\x96\\x87'`).tokens).toEqual(['中文'])
  })

  it('joins backslash-newline continuations (LF and CRLF)', () => {
    expect(tokenizeBash('curl \\\n  -v \\\r\n  url').tokens).toEqual(['curl', '-v', 'url'])
  })

  it('skips comments and stops at pipes', () => {
    const r = tokenizeBash('# comment\ncurl url # trailing\n| jq .')
    expect(r.tokens).toEqual(['curl', 'url'])
    expect(r.notes.length).toBe(1)
  })

  it('drops redirections with their targets', () => {
    const r = tokenizeBash('curl url > "out file.json" 2>&1 -v')
    expect(r.tokens).toEqual(['curl', 'url', '-v'])
  })

  it('keeps & inside unquoted words', () => {
    expect(tokenizeBash('curl http://x/?a=1&b=2').tokens).toEqual(['curl', 'http://x/?a=1&b=2'])
  })

  it('throws with position on unterminated quotes', () => {
    expect(parseCurl("curl 'http://x' \\\n -H 'a")).toMatchObject({
      ok: false,
      error: expect.stringContaining('第 2 行'),
    })
    expect(parseCurl('curl "abc')).toMatchObject({
      ok: false,
      error: '双引号没有闭合（第 1 行第 6 列）',
    })
    expect(parseCurl("curl $'abc")).toMatchObject({ ok: false })
  })
})

describe('tokenizeCmd', () => {
  it('removes carets and honours quotes', () => {
    expect(tokenizeCmd('curl ^"a b^" "c ^ d" e^&f').tokens).toEqual(['curl', 'a b', 'c ^ d', 'e&f'])
  })
  it('handles \\" per MS CRT rules', () => {
    expect(tokenizeCmd('x "a\\"b" "c\\\\"').tokens).toEqual(['x', 'a"b', 'c\\'])
  })
})

describe('helpers', () => {
  it('describePosition', () => {
    expect(describePosition('ab\ncd', 4)).toBe('第 2 行第 2 列')
  })
  it('looksLikeCurl', () => {
    expect(looksLikeCurl('curl https://x')).toBe(true)
    expect(looksLikeCurl('  $ curl -v x')).toBe(true)
    expect(looksLikeCurl('CURL.exe ^"x^"')).toBe(true)
    expect(looksLikeCurl('curly braces')).toBe(false)
    expect(looksLikeCurl('https://x')).toBe(false)
  })
  it('curlEscape encodes everything except unreserved characters', () => {
    expect(curlEscape("a b!'()*~._-中")).toBe('a%20b%21%27%28%29%2A~._-%E4%B8%AD')
  })
  it('appendQuery keeps fragments', () => {
    expect(appendQuery('http://x/p#frag', 'a=1')).toBe('http://x/p?a=1#frag')
    expect(appendQuery('http://x/p?b=2', 'a=1')).toBe('http://x/p?b=2&a=1')
    expect(appendQuery('http://x/p?', 'a=1')).toBe('http://x/p?a=1')
  })
})

// ───────────────────────── 参数 ─────────────────────────

describe('parseCurl flags', () => {
  it('defaults to GET and adds http:// when the scheme is missing', () => {
    const { request } = ok('curl example.com/path')
    expect(request).toEqual({
      method: 'GET',
      url: 'http://example.com/path',
      headers: [],
      body: { kind: 'none' },
    })
  })

  it('accepts $ prompt, curl.exe and leading env assignments', () => {
    expect(ok('$ curl https://a.dev').request.url).toBe('https://a.dev')
    expect(ok('curl.exe https://a.dev').request.url).toBe('https://a.dev')
    expect(ok('HTTPS_PROXY=x curl https://a.dev').request.url).toBe('https://a.dev')
  })

  it('-X / --request (attached and separate), upper-cased', () => {
    expect(ok('curl -XPUT https://a.dev').request.method).toBe('PUT')
    expect(ok('curl --request delete https://a.dev').request.method).toBe('DELETE')
    expect(ok('curl https://a.dev -X PATCH -d x').request.method).toBe('PATCH')
  })

  it('infers POST from data and sets the default form Content-Type', () => {
    const { request } = ok("curl https://a.dev -d 'a=1' -d 'b=2' --data-ascii c=3")
    expect(request.method).toBe('POST')
    expect(request.body).toEqual({ kind: 'text', text: 'a=1&b=2&c=3' })
    expect(request.headers).toEqual([['Content-Type', 'application/x-www-form-urlencoded']])
  })

  it('keeps an explicit Content-Type and supports header removal', () => {
    expect(ok("curl a.dev -H 'content-type: text/plain' -d x").request.headers).toEqual([
      ['content-type', 'text/plain'],
    ])
    expect(ok("curl a.dev -H 'Content-Type:' -d x").request.headers).toEqual([])
    expect(ok("curl a.dev -H 'X-A: 1' -H 'X-A:'").request.headers).toEqual([])
  })

  it('supports empty header values with a semicolon and header values containing colons', () => {
    expect(ok("curl a.dev -H 'X-Empty;' -H 'X-Time: 12:30:00'").request.headers).toEqual([
      ['X-Empty', ''],
      ['X-Time', '12:30:00'],
    ])
  })

  it('warns about malformed headers', () => {
    const r = ok("curl a.dev -H 'nonsense'")
    expect(r.request.headers).toEqual([])
    expect(r.warnings[0]).toContain('请求头格式不正确')
  })

  it('--data-raw does not treat @ specially; --data-binary @file becomes a file body', () => {
    expect(ok("curl a.dev --data-raw '@not-a-file'").request.body).toEqual({
      kind: 'text',
      text: '@not-a-file',
    })
    const r = ok('curl a.dev --data-binary @payload.bin')
    expect(r.request.body).toEqual({ kind: 'file', path: 'payload.bin' })
    expect(r.request.method).toBe('POST')
  })

  it('-d @file warns about newline stripping', () => {
    const r = ok('curl a.dev -d @body.json')
    expect(r.request.body).toEqual({ kind: 'file', path: 'body.json' })
    expect(r.warnings.length).toBe(1)
  })

  it('--data-urlencode variants', () => {
    const { request } = ok(
      "curl a.dev --data-urlencode 'hello world' --data-urlencode '=a&b' --data-urlencode 'q=中 文' --data-urlencode 'f@file.txt'",
    )
    expect((request.body as { text: string }).text).toBe(
      'hello%20world&a%26b&q=%E4%B8%AD%20%E6%96%87&f={{file:file.txt}}',
    )
  })

  it('-G moves data into the query string', () => {
    const { request } = ok("curl -G https://a.dev/s?x=1 -d 'q=a b' --data-urlencode 'r=c d'")
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://a.dev/s?x=1&q=a b&r=c%20d')
    expect(request.body).toEqual({ kind: 'none' })
    expect(request.headers).toEqual([])
  })

  it('--url-query', () => {
    expect(ok("curl https://a.dev/p --url-query 'q=a b' --url-query '+raw=x y'").request.url).toBe(
      'https://a.dev/p?q=a%20b&raw=x y',
    )
  })

  it('--json sets content-type and accept, concatenating pieces', () => {
    const { request } = ok(`curl a.dev --json '{"a":' --json '1}'`)
    expect(request.method).toBe('POST')
    expect(request.body).toEqual({ kind: 'text', text: '{"a":1}' })
    expect(request.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
    ])
  })

  it('-F multipart fields and files', () => {
    const { request } = ok(
      `curl https://a.dev/upload -F 'name=张三' -F 'avatar=@/tmp/me.png;type=image/png;filename=face.png' -F 'doc=@"my;file.txt"' --form-string 'raw=@literal' -F 'note=hi;type=text/plain' -F 'semi=a;b'`,
    )
    expect(request.method).toBe('POST')
    expect(request.headers).toEqual([])
    expect(request.body).toEqual({
      kind: 'multipart',
      parts: [
        { name: 'name', value: '张三', kind: 'text' },
        {
          name: 'avatar',
          value: '/tmp/me.png',
          kind: 'file',
          contentType: 'image/png',
          filename: 'face.png',
        },
        { name: 'doc', value: 'my;file.txt', kind: 'file' },
        { name: 'raw', value: '@literal', kind: 'text' },
        { name: 'note', value: 'hi', kind: 'text', contentType: 'text/plain' },
        { name: 'semi', value: 'a;b', kind: 'text' },
      ],
    })
  })

  it('-F name=<file uses a placeholder and warns', () => {
    const r = ok("curl a.dev -F 'text=<notes.txt'")
    expect(r.request.body).toEqual({
      kind: 'multipart',
      parts: [{ name: 'text', value: '{{file:notes.txt}}', kind: 'text' }],
    })
    expect(r.warnings.length).toBe(1)
  })

  it('-u basic auth', () => {
    expect(ok('curl -u admin:p@ss:word a.dev').request.auth).toEqual({
      username: 'admin',
      password: 'p@ss:word',
    })
    const r = ok('curl --user admin a.dev')
    expect(r.request.auth).toEqual({ username: 'admin', password: '' })
    expect(r.warnings.length).toBe(1)
  })

  it('-b cookies merge; cookie files warn', () => {
    expect(ok("curl a.dev -b 'a=1' --cookie 'b=2'").request.headers).toEqual([
      ['Cookie', 'a=1; b=2'],
    ])
    const r = ok('curl a.dev -b cookies.txt')
    expect(r.request.headers).toEqual([])
    expect(r.warnings[0]).toContain('Cookie 文件')
  })

  it('-A / -e / --oauth2-bearer / -r become headers', () => {
    expect(
      ok("curl a.dev -A 'MyAgent/1.0' -e 'https://ref.dev;auto' --oauth2-bearer tok -r 0-99")
        .request.headers,
    ).toEqual([
      ['User-Agent', 'MyAgent/1.0'],
      ['Referer', 'https://ref.dev'],
      ['Authorization', 'Bearer tok'],
      ['Range', 'bytes=0-99'],
    ])
  })

  it('-I / -L / -k / --compressed / -m and combined short flags', () => {
    const { request } = ok('curl -sSLkI --compressed -m 2.5 https://a.dev')
    expect(request).toMatchObject({
      method: 'HEAD',
      followRedirects: true,
      insecure: true,
      compressed: true,
      timeout: 2.5,
    })
  })

  it('--url and --', () => {
    expect(ok('curl --url https://a.dev/x').request.url).toBe('https://a.dev/x')
    expect(ok('curl -v -- -weird.dev').request.url).toBe('http://-weird.dev')
  })

  it('-T uploads a file with PUT', () => {
    expect(ok('curl -T ./file.zip https://a.dev/up').request).toMatchObject({
      method: 'PUT',
      body: { kind: 'file', path: './file.zip' },
      headers: [],
    })
  })

  it('skips values of unsupported flags instead of treating them as URLs', () => {
    const r = ok(
      'curl -o out.json --proxy http://127.0.0.1:8080 --cacert ca.pem https://a.dev -w "%{http_code}"',
    )
    expect(r.request.url).toBe('https://a.dev')
    expect(r.warnings).toEqual(['不支持的参数 --proxy，已忽略', '不支持的参数 --cacert，已忽略'])
  })

  it('does not mistake the value of an unknown flag for the URL (regression)', () => {
    const r = ok('curl --foo bar -X PUT https://x.dev/a -d x=1')
    expect(r.request.url).toBe('https://x.dev/a')
    expect(r.request.method).toBe('PUT')
    expect(r.warnings).toEqual([
      '不支持的参数 --foo，已忽略',
      '「bar」可能是不支持的参数的取值，已忽略',
    ])
    expect(ok('curl -j --weird v https://x.dev').request.url).toBe('https://x.dev')
    // 只有一个候选时仍然用它
    expect(ok('curl --foo bar').request.url).toBe('http://bar')
    // 都是真实地址时仍取第一个
    const two = ok('curl --bool https://a.dev https://b.dev')
    expect(two.request.url).toBe('https://a.dev')
    expect(two.warnings).toContain('检测到多个 URL，只使用了 https://a.dev')
  })

  it('warns about unknown flags only once', () => {
    const r = ok('curl --frobnicate --frobnicate a.dev')
    expect(r.warnings).toEqual(['不支持的参数 --frobnicate，已忽略'])
  })

  it('accepts --flag=value leniently', () => {
    expect(ok('curl --request=PUT --data=x a.dev').request).toMatchObject({
      method: 'PUT',
      body: { kind: 'text', text: 'x' },
    })
  })

  it('warns about multiple URLs and multiple commands', () => {
    const r = ok('curl a.dev b.dev')
    expect(r.request.url).toBe('http://a.dev')
    expect(r.warnings[0]).toContain('多个 URL')
    const r2 = ok('curl https://a.dev\ncurl https://b.dev')
    expect(r2.request.url).toBe('https://a.dev')
    expect(r2.warnings[0]).toContain('多条')
  })

  it('reports missing values and missing URL', () => {
    expect(ok('curl a.dev -H').warnings).toEqual(['参数 -H 缺少取值'])
    expect(parseCurl('curl -v')).toMatchObject({
      ok: false,
      error: expect.stringContaining('缺少 URL'),
    })
    expect(parseCurl('')).toMatchObject({ ok: false, error: '请输入 curl 命令' })
    expect(parseCurl('wget https://a.dev')).toMatchObject({
      ok: false,
      error: expect.stringContaining('没有找到 curl'),
    })
  })

  it('handles unicode and emoji everywhere', () => {
    const { request } = ok(
      `curl 'https://例子.测试/路径?q=你好' -H 'X-Emoji: 🎉' -d '{"msg":"👋 世界"}'`,
    )
    expect(request.url).toBe('https://例子.测试/路径?q=你好')
    expect(header(request, 'x-emoji')).toBe('🎉')
    expect((request.body as { text: string }).text).toBe('{"msg":"👋 世界"}')
  })

  it('handles large inputs quickly', () => {
    const big = 'x'.repeat(1_000_000)
    const headers = Array.from({ length: 500 }, (_, i) => `-H 'X-H${i}: ${i}'`).join(' \\\n  ')
    const t = performance.now()
    const { request } = ok(`curl https://a.dev \\\n  ${headers} \\\n  --data-raw '${big}'`)
    expect(performance.now() - t).toBeLessThan(2000)
    expect(request.headers).toHaveLength(501)
    expect((request.body as { text: string }).text.length).toBe(1_000_000)
  })

  it('ignores trailing pipes and redirections', () => {
    const r = ok("curl -s https://a.dev/api | jq '.data'")
    expect(r.request.url).toBe('https://a.dev/api')
    expect(r.warnings.length).toBe(1)
  })
})
