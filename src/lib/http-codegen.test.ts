import { describe, expect, it } from 'vitest'
import { parseCurl, type HttpRequest } from './curl'
import {
  CODE_TARGETS,
  csStr,
  encodeUrlForCode,
  generateCode,
  goStr,
  javaStr,
  jsLiteral,
  jsonBodyValue,
  jsStr,
  mergeHeaders,
  phpStr,
  pyLiteral,
  pyStr,
  rustStr,
  shq,
  swiftStr,
} from './http-codegen'

function parse(src: string): HttpRequest {
  const r = parseCurl(src)
  if (!r.ok) throw new Error(r.error)
  return r.request
}

const TRICKY = `it's "quoted" \\ back\`tick\` $HOME\n\ttab 中文 😀`

const JSON_REQ: HttpRequest = {
  method: 'POST',
  url: 'https://api.example.com/v1/users?page=1&q=中文',
  headers: [
    ['Content-Type', 'application/json'],
    ['X-Trace', 'abc'],
    ['Cookie', 'a=1'],
    ['Cookie', 'b=2'],
  ],
  body: { kind: 'text', text: '{"name":"张三","tags":["a","b"],"n":1.5,"ok":true,"x":null}' },
  auth: { username: 'admin', password: 'p\'a"ss' },
  followRedirects: true,
  insecure: true,
  timeout: 10,
}

const FORM_REQ: HttpRequest = {
  method: 'POST',
  url: 'https://upload.example.com/files',
  headers: [['Authorization', 'Bearer tok']],
  body: {
    kind: 'multipart',
    parts: [
      { name: 'title', value: '年度报告', kind: 'text' },
      { name: 'file', value: './report.pdf', kind: 'file', contentType: 'application/pdf' },
    ],
  },
}

describe('string escapers', () => {
  it('JavaScript', () => {
    expect(jsStr(TRICKY)).toBe(`'it\\'s "quoted" \\\\ back\`tick\` $HOME\\n\\ttab 中文 😀'`)
    expect(jsStr(' \x00')).toBe("'\\u2028\\x00'")
    // 生成的字面量能被 JS 引擎还原
    expect(new Function(`return ${jsStr(TRICKY + ' \x7f')}`)()).toBe(TRICKY + ' \x7f')
  })
  it('Python', () => {
    expect(pyStr(TRICKY)).toBe(`'it\\'s "quoted" \\\\ back\`tick\` $HOME\\n\\ttab 中文 😀'`)
  })
  it('Go / Java / C# / Rust / Swift', () => {
    expect(goStr('a"b\\c\n\x01')).toBe('"a\\"b\\\\c\\n\\x01"')
    expect(javaStr('a"b\\c\n\x01\b')).toBe('"a\\"b\\\\c\\n\\u0001\\b"')
    expect(csStr('a"b\\c\n\x01\0')).toBe('"a\\"b\\\\c\\n\\u0001\\0"')
    expect(rustStr('a"b\\c\n\x01')).toBe('"a\\"b\\\\c\\n\\u{1}"')
    expect(swiftStr('a"b\\c\n\x01')).toBe('"a\\"b\\\\c\\n\\u{1}"')
  })
  it('PHP', () => {
    expect(phpStr(`it's \\ $x "q"`)).toBe(`'it\\'s \\\\ $x "q"'`)
    expect(phpStr('a\x01$b"')).toBe('"a\\x01\\$b\\""')
  })
  it('shell', () => {
    expect(shq("it's")).toBe(`'it'\\''s'`)
    expect(shq('a\nb')).toBe(`$'a\\nb'`)
    expect(shq("x\x01'\\")).toBe(`$'x\\x01\\'\\\\'`)
  })
})

describe('helpers', () => {
  it('encodeUrlForCode encodes only non-ASCII characters and spaces', () => {
    expect(encodeUrlForCode('https://a.dev/p?q=1&x={{v}}')).toBe('https://a.dev/p?q=1&x={{v}}')
    expect(encodeUrlForCode('https://a.dev/路径 1?q=中文&e=😀#片段')).toBe(
      'https://a.dev/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87&e=%F0%9F%98%80#%E7%89%87%E6%AE%B5',
    )
    expect(encodeUrlForCode('https://例子.测试/x')).toBe('https://xn--fsqu00a.xn--0zwm56d/x')
    expect(encodeUrlForCode('http://用户:密@例子.cn/')).toMatch(
      /^http:\/\/%E7%94%A8%E6%88%B7:%E5%AF%86@xn--/,
    )
    expect(encodeUrlForCode('a.dev/中')).toBe('a.dev/%E4%B8%AD')
    expect(encodeUrlForCode('https://a.dev/\ud800')).toBe('https://a.dev/\ud800')
  })

  it('mergeHeaders merges duplicates case-insensitively', () => {
    expect(
      mergeHeaders([
        ['Accept', 'a'],
        ['cookie', 'x=1'],
        ['accept', 'b'],
        ['Cookie', 'y=2'],
      ]),
    ).toEqual([
      ['Accept', 'a, b'],
      ['cookie', 'x=1; y=2'],
    ])
  })

  it('jsonBodyValue only accepts lossless JSON objects with a JSON content type', () => {
    expect(jsonBodyValue(JSON_REQ)?.value).toMatchObject({ name: '张三' })
    const base = { ...JSON_REQ }
    expect(
      jsonBodyValue({ ...base, body: { kind: 'text', text: '{"id":12345678901234567890}' } }),
    ).toBeNull()
    expect(
      jsonBodyValue({ ...base, body: { kind: 'text', text: '{"pi":3.14159265358979323846}' } }),
    ).toBeNull()
    expect(jsonBodyValue({ ...base, body: { kind: 'text', text: '{bad json' } })).toBeNull()
    expect(jsonBodyValue({ ...base, body: { kind: 'text', text: '"just a string"' } })).toBeNull()
    expect(jsonBodyValue({ ...base, headers: [], body: { kind: 'text', text: '{}' } })).toBeNull()
    expect(
      jsonBodyValue({
        ...base,
        headers: [['content-type', 'application/vnd.api+json; charset=utf-8']],
        body: { kind: 'text', text: '{"a":"12345678901234567890"}' },
      }),
    ).not.toBeNull()
  })

  it('jsLiteral / pyLiteral', () => {
    const v = { a: 1, 'b-c': [true, null, 'x'], d: { e: [] }, f: {}, g: [{ h: 1 }] }
    expect(jsLiteral(v)).toBe(
      `{\n  a: 1,\n  'b-c': [true, null, 'x'],\n  d: {\n    e: [],\n  },\n  f: {},\n  g: [\n    {\n      h: 1,\n    },\n  ],\n}`,
    )
    expect(new Function(`return ${jsLiteral(v)}`)()).toEqual(v)
    expect(pyLiteral(v)).toBe(
      `{\n    'a': 1,\n    'b-c': [True, None, 'x'],\n    'd': {\n        'e': [],\n    },\n    'f': {},\n    'g': [\n        {\n            'h': 1,\n        },\n    ],\n}`,
    )
  })
})

describe('cURL round trip', () => {
  const commands = [
    'curl https://example.com',
    `curl -X POST 'https://api.example.com/items?x=1&y=2' -H 'Content-Type: application/json' -H 'X-Empty;' --data-raw '{"a":"it\\'s","b":[1,2]}'`.replace(
      "\\'",
      "'\\''",
    ),
    "curl -I https://example.com -H 'Host: other.example.com' -L -k --compressed -m 5",
    "curl -X GET https://example.com/search -H 'content-type: application/json' --data-raw '{\"q\":1}'",
    'curl -X PROPFIND https://dav.example.com/ -d x=1',
    "curl https://example.com/up -F 'a=1' -F 'f=@/tmp/my file.png;type=image/png;filename=pic.png' -F 'g=@\"x;y.txt\"' --form-string 'h=@literal' -F 't=v;type=text/plain'",
    'curl -T ./archive.tar.gz https://example.com/put',
    'curl https://example.com --data-binary @payload.bin',
    "curl -u 'user:p@ss word' https://example.com",
    `curl https://example.com -H 'X-Unicode: 你好 😀' --data-raw $'line1\\nline2\\t\\x01\\'q\\''`,
    CHROME_LIKE,
  ]

  it.each(commands.map((c) => [c]))('%s', (cmd) => {
    const req = parse(cmd)
    const back = parse(generateCode(req, 'curl'))
    expect(back).toEqual(req)
  })

  it('survives randomized requests with nasty strings', () => {
    const pieces = [
      "'",
      '"',
      '\\',
      '$',
      '`',
      ' ',
      '\n',
      '\t',
      '中',
      '😀',
      'a',
      '=',
      ';',
      '&',
      '#',
      '|',
      '\x01',
      '!',
    ]
    let seed = 42
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    const str = (len: number) =>
      Array.from({ length: len }, () => pieces[rnd(pieces.length)]).join('')
    for (let i = 0; i < 200; i++) {
      const req: HttpRequest = {
        method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'][rnd(5)],
        url: 'https://example.com/' + encodeURIComponent(str(5)),
        headers: [
          [
            'X-A' + i,
            'v' +
              str(8)
                .replace(/[\r\n]/g, ' ')
                .trim() +
              'z',
          ],
          ['Content-Type', 'text/plain'],
        ],
        body: rnd(3) === 0 ? { kind: 'none' } : { kind: 'text', text: str(1 + rnd(30)) },
      }
      if (rnd(2)) req.auth = { username: 'u' + str(3).replace(/:/g, ''), password: str(4) }
      const back = parse(generateCode(req, 'curl'))
      expect(back).toEqual(req)
    }
  })
})

const CHROME_LIKE = `curl 'https://www.example.com/api/v2/search' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'content-type: application/json;charset=UTF-8' \\
  -b 'sid=abc; theme=dark' \\
  -H 'sec-ch-ua: "Chromium";v="128", "Not;A=Brand";v="24"' \\
  --data-raw '{"keyword":"耳机","page":1}'`

describe('generateCode', () => {
  it('produces non-empty code for every target and every body kind', () => {
    const reqs: HttpRequest[] = [
      JSON_REQ,
      FORM_REQ,
      { method: 'GET', url: 'https://a.dev', headers: [], body: { kind: 'none' } },
      {
        method: 'HEAD',
        url: 'https://a.dev',
        headers: [],
        body: { kind: 'none' },
        followRedirects: false,
      },
      {
        method: 'PUT',
        url: 'https://a.dev',
        headers: [],
        body: { kind: 'file', path: 'data.bin' },
      },
      {
        method: 'PURGE',
        url: 'https://a.dev',
        headers: [['X', '']],
        body: { kind: 'text', text: '' },
      },
    ]
    for (const r of reqs) {
      for (const t of CODE_TARGETS) {
        const code = generateCode(r, t.id)
        expect(code.length, `${t.id}`).toBeGreaterThan(10)
        expect(code, `${t.id}`).not.toContain('undefined')
      }
    }
  })

  it('generates syntactically valid JavaScript', () => {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
      code: string,
    ) => unknown
    for (const r of [JSON_REQ, FORM_REQ, parse(CHROME_LIKE)]) {
      for (const t of ['fetch', 'node', 'axios'] as const) {
        const code = generateCode(r, t)
          .split('\n')
          .filter((l) => !l.startsWith('import '))
          .join('\n')
        expect(() => new AsyncFunction(code), t).not.toThrow()
      }
    }
  })

  it('fetch: JSON body becomes JSON.stringify of an object literal; auth header; options', () => {
    const code = generateCode(JSON_REQ, 'fetch')
    expect(code).toContain(
      "const response = await fetch('https://api.example.com/v1/users?page=1&q=%E4%B8%AD%E6%96%87', {",
    )
    expect(code).toContain("method: 'POST',")
    expect(code).toContain("'Cookie': 'a=1; b=2',")
    expect(code).toContain("'Authorization': 'Basic ' + btoa('admin:p\\'a\"ss'),")
    expect(code).toContain("body: JSON.stringify({\n    name: '张三',\n    tags: ['a', 'b'],")
    expect(code).toContain('signal: AbortSignal.timeout(10000),')
    expect(code).toContain('无法跳过 TLS')
  })

  it('fetch: notes headers the browser refuses to send (but not for Node)', () => {
    const code = generateCode(JSON_REQ, 'fetch')
    expect(code).toContain('// 注意：浏览器会忽略这些受限的请求头：Cookie（Node.js 中有效）')
    expect(generateCode(JSON_REQ, 'node')).not.toContain('受限的请求头')
    const plain = generateCode(
      { method: 'GET', url: 'https://a.dev', headers: [['Accept', '*/*']], body: { kind: 'none' } },
      'fetch',
    )
    expect(plain).not.toContain('受限的请求头')
    const many = generateCode(
      {
        method: 'GET',
        url: 'https://a.dev',
        headers: [
          ['User-Agent', 'x'],
          ['sec-ch-ua', 'y'],
          ['Origin', 'https://b.dev'],
        ],
        body: { kind: 'none' },
      },
      'fetch',
    )
    expect(many.split('\n')[0]).toBe(
      '// 注意：浏览器会忽略这些受限的请求头：User-Agent, sec-ch-ua, Origin（Node.js 中有效）',
    )
  })

  it('fetch: non-ASCII basic auth is pre-encoded', () => {
    const code = generateCode({ ...JSON_REQ, auth: { username: '用户', password: 'x' } }, 'fetch')
    expect(code).toContain("'Authorization': 'Basic 55So5oi3Ong=',")
  })

  it('multipart drops explicit Content-Type (boundary is generated) except for cURL', () => {
    const req: HttpRequest = {
      ...FORM_REQ,
      headers: [['Content-Type', 'multipart/form-data; boundary=xyz']],
    }
    expect(generateCode(req, 'fetch')).not.toContain('boundary=xyz')
    expect(generateCode(req, 'python')).not.toContain('boundary=xyz')
    expect(generateCode(req, 'curl')).toContain('boundary=xyz')
  })

  it('python requests', () => {
    const code = generateCode(JSON_REQ, 'python')
    expect(code).toContain('import requests')
    expect(code).toContain(
      "json_data = {\n    'name': '张三',\n    'tags': ['a', 'b'],\n    'n': 1.5,\n    'ok': True,\n    'x': None,\n}",
    )
    expect(code).toContain("auth=('admin', 'p\\'a\"ss'),")
    expect(code).toContain('verify=False,')
    expect(code).toContain('timeout=10,')
    const form = generateCode(FORM_REQ, 'python')
    expect(form).toContain("'title': (None, '年度报告'),")
    expect(form).toContain("'file': ('report.pdf', open('./report.pdf', 'rb'), 'application/pdf'),")
    // 非 Latin-1 文本请求体需要 encode
    const text = generateCode(
      {
        method: 'POST',
        url: 'https://a.dev',
        headers: [['Content-Type', 'text/plain']],
        body: { kind: 'text', text: '中文' },
      },
      'python',
    )
    expect(text).toContain("data = '中文'.encode()")
    // 重名字段用列表
    const dup = generateCode(
      {
        ...FORM_REQ,
        body: {
          kind: 'multipart',
          parts: [
            { name: 'a', value: '1', kind: 'text' },
            { name: 'a', value: '2', kind: 'text' },
          ],
        },
      },
      'python',
    )
    expect(dup).toContain("files = [\n    ('a', (None, '1')),\n    ('a', (None, '2')),\n]")
  })

  it('python httpx uses request() for bodies on GET/DELETE and follow_redirects', () => {
    const code = generateCode(
      {
        method: 'DELETE',
        url: 'https://a.dev',
        headers: [],
        body: { kind: 'text', text: 'x' },
        followRedirects: true,
      },
      'httpx',
    )
    expect(code).toContain(
      "httpx.request('DELETE', 'https://a.dev', content=data, follow_redirects=True)",
    )
  })

  it('go', () => {
    const code = generateCode(JSON_REQ, 'go')
    expect(code).toContain('req.Header.Set("Cookie", "a=1")')
    expect(code).toContain('req.Header.Add("Cookie", "b=2")')
    expect(code).toContain('req.SetBasicAuth("admin", "p\'a\\"ss")')
    expect(code).toContain('InsecureSkipVerify: true')
    expect(code).toContain('Timeout: 10 * time.Second,')
    expect(code).toContain('strings.NewReader(`{"name":"张三"')
    expect(code).toMatch(
      /import \(\n\t"crypto\/tls"\n\t"fmt"\n\t"io"\n\t"log"\n\t"net\/http"\n\t"strings"\n\t"time"\n\)/,
    )
    const form = generateCode(FORM_REQ, 'go')
    expect(form).toContain('writer.CreateFormFile("file", "report.pdf")')
    expect(form).toContain('req.Header.Set("Content-Type", writer.FormDataContentType())')
  })

  it('java okhttp / java httpclient', () => {
    const ok = generateCode(JSON_REQ, 'java-okhttp')
    expect(ok).toContain('RequestBody.create("{\\"name\\":\\"张三\\"')
    expect(ok).toContain('MediaType.parse("application/json")')
    expect(ok).not.toContain('.addHeader("Content-Type"')
    expect(ok).toContain('Credentials.basic("admin", "p\'a\\"ss")')
    const jc = generateCode(JSON_REQ, 'java')
    expect(jc).toContain('.followRedirects(HttpClient.Redirect.NORMAL)')
    expect(jc).toContain('.timeout(Duration.ofMillis(10000))')
    expect(jc).toContain('.method("POST", HttpRequest.BodyPublishers.ofString(')
    const host = generateCode(parse("curl https://a.dev -H 'Host: b.dev'"), 'java')
    expect(host).toContain('已省略：Host')
    expect(host).not.toContain('.header("Host"')
  })

  it('php', () => {
    const code = generateCode(JSON_REQ, 'php')
    expect(code.startsWith('<?php')).toBe(true)
    expect(code).toContain("curl_setopt($ch, CURLOPT_USERPWD, 'admin:p\\'a\"ss');")
    expect(code).toContain('CURLOPT_SSL_VERIFYPEER, false')
    expect(code).toContain('CURLOPT_FOLLOWLOCATION, true')
    expect(code).not.toContain('CURLOPT_CUSTOMREQUEST')
    expect(generateCode(FORM_REQ, 'php')).toContain(
      "'file' => new CURLFile('./report.pdf', 'application/pdf', 'report.pdf'),",
    )
  })

  it('rust uses lowercase header names and raw strings for JSON', () => {
    const code = generateCode(JSON_REQ, 'rust')
    expect(code).toContain('headers.insert("content-type", "application/json".parse()?);')
    expect(code).toContain('headers.append("cookie", "b=2".parse()?);')
    expect(code).toContain('.body(r#"{"name":"张三"')
    expect(code).toContain('.danger_accept_invalid_certs(true)')
    expect(code).toContain('.basic_auth("admin", Some("p\'a\\"ss"))')
  })

  it('swift / c#', () => {
    const sw = generateCode(JSON_REQ, 'swift')
    expect(sw).toContain('request.httpMethod = "POST"')
    expect(sw).toContain('request.addValue("b=2", forHTTPHeaderField: "Cookie")')
    expect(sw).toContain('request.httpBody = Data(#"{"name":"张三"')
    const cs = generateCode(JSON_REQ, 'csharp')
    expect(cs).toContain('ServerCertificateCustomValidationCallback')
    expect(cs).toContain(
      'request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/json");',
    )
    expect(cs).not.toContain('TryAddWithoutValidation("Content-Type"')
    expect(cs).toContain('client.Timeout = TimeSpan.FromMilliseconds(10000);')
  })

  it('wget / httpie', () => {
    const w = generateCode(JSON_REQ, 'wget')
    expect(w).toContain("--header='Content-Type: application/json'")
    expect(w).toContain('--auth-no-challenge')
    expect(w).toContain('--no-check-certificate')
    expect(generateCode(FORM_REQ, 'wget')).toContain('不支持 multipart')
    const h = generateCode(JSON_REQ, 'httpie')
    expect(h).toContain('http --follow --verify=no --timeout=10')
    expect(h).toContain("'X-Trace:abc'")
    expect(generateCode(FORM_REQ, 'httpie')).toContain("'file@./report.pdf;type=application/pdf'")
  })
})

// 用真实的 bash 解析生成的 cURL 命令，确认引号转义正确（没有 bash 的环境自动跳过）
async function runBash(script: string): Promise<string | null> {
  try {
    const mod = 'node:child_process'
    const cp = (await import(/* @vite-ignore */ mod)) as {
      execFileSync: (file: string, args: string[]) => Uint8Array
    }
    return new TextDecoder().decode(cp.execFileSync('bash', ['-c', script]))
  } catch {
    return null
  }
}

describe('bash interprets generated commands exactly', () => {
  it('matches the structured request', async () => {
    const req = parse(
      `curl -X POST 'https://a.dev/?q=1&r=2' -H $'X-A: it\\'s "q" $HOME \\\\' --data-raw $'multi\\nline \\x01 \`tick\` 中文 😀'`,
    )
    const script = `curl() { for a in "$@"; do printf '%s\\0' "$a"; done; }\n${generateCode(req, 'curl')}`
    const out = await runBash(script)
    if (out === null) return
    const args = out.split('\0').slice(0, -1)
    expect(args).toEqual([
      'https://a.dev/?q=1&r=2',
      '-H',
      `X-A: it's "q" $HOME \\`,
      '-H',
      'Content-Type: application/x-www-form-urlencoded',
      '--data-raw',
      'multi\nline \x01 `tick` 中文 😀',
    ])
  })
})
