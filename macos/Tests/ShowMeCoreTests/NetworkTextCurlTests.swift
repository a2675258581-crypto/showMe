import XCTest
@testable import ShowMeCore

final class NetworkTextCurlTests: XCTestCase {
    func ok(_ s: String) throws -> CurlParseResult { try Curl.parse(s) }

    func parseError(_ s: String) -> CurlParseError? {
        do {
            _ = try Curl.parse(s)
            return nil
        } catch {
            return error as? CurlParseError
        }
    }

    static let chromeBash = """
    curl 'https://api.github.com/graphql' \\
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
      -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' \\
      --data-raw '{"query":"{ viewer { login } }","variables":{}}'
    """

    static let chromeCmd = [
        "curl ^\"https://example.com/api/items?page=1^&size=20^\" ^",
        "  -H ^\"accept: application/json, text/plain, */*^\" ^",
        "  -H ^\"content-type: application/json;charset=UTF-8^\" ^",
        "  -b ^\"sid=abc123; theme=dark^\" ^",
        "  --data-raw ^\"^{^\\^\"name^\\^\":^\\^\"^测^试 ^😀^\\^\",^\\^\"tags^\\^\":^[^\\^\"a^\\^\",^\\^\"b^\\^\"^],^\\^\"pct^\\^\":^\\^\"50%^25^\\^\"^}^\" ^",
        "  --compressed",
    ].joined(separator: "\r\n")

    // MARK: Chrome DevTools「Copy as cURL」

    func testChromeBash() throws {
        let r = try ok(Self.chromeBash)
        XCTAssertEqual(r.warnings, [])
        XCTAssertEqual(r.request.method, "POST")
        XCTAssertEqual(r.request.url, "https://api.github.com/graphql")
        XCTAssertEqual(r.request.header("sec-ch-ua"), #""Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128""#)
        XCTAssertEqual(r.request.header("cookie"), "_octo=GH1.1.123.456; logged_in=yes")
        XCTAssertEqual(r.request.headers.count, 11)
        XCTAssertEqual(r.request.body, .text(#"{"query":"{ viewer { login } }","variables":{}}"#))
    }

    func testAnsiCQuotes() throws {
        let src = #"curl 'https://example.com/api/notes' -H 'content-type: application/json' --data-raw $'{"text":"it\'s ok\x21\nline2","path":"C:\\\\temp"}' --compressed"#
        let r = try ok(src)
        XCTAssertTrue(r.request.compressed)
        XCTAssertEqual(r.request.body, .text("{\"text\":\"it's ok!\nline2\",\"path\":\"C:\\\\temp\"}"))
        // 八进制、十六进制、Unicode、控制字符
        let esc = "$'" + "\\x41" + "\\" + "u4e2d" + "\\101\\t\\cA" + "\\" + "U0001F600'"
        XCTAssertEqual(try Curl.tokenize(esc, dialect: .bash), ["A中A\t\u{1}😀"])
        XCTAssertEqual(try Curl.tokenize(#"$'\xe4\xb8\xad\xe6\x96\x87'"#, dialect: .bash), ["中文"])
    }

    func testChromeCmd() throws {
        XCTAssertEqual(Curl.detectDialect(Self.chromeCmd), .cmd)
        let r = try ok(Self.chromeCmd)
        XCTAssertEqual(r.warnings, [])
        XCTAssertEqual(r.request.url, "https://example.com/api/items?page=1&size=20")
        XCTAssertEqual(r.request.method, "POST")
        XCTAssertEqual(r.request.header("cookie"), "sid=abc123; theme=dark")
        guard case .text(let body) = r.request.body else { return XCTFail("body") }
        let v = try JSON.value(body)
        XCTAssertEqual(v["name"]?.stringValue, "测试 😀")
        XCTAssertEqual(v["pct"]?.stringValue, "50%25")
    }

    func testCmdNewlinesAndBackslashes() throws {
        XCTAssertEqual(try ok("curl ^\"https://x.dev/^\" ^\n  --data-raw ^\"line1^\n\nline2^\"").request.body, .text("line1\nline2"))
        let doubled = #"curl ^"https://x.dev/^" --data-raw ^"^{^\^"p^\^":^\^"C:^\^\^\^\dir^\^"^}^""#
        guard case .text(let body) = try ok(doubled).request.body else { return XCTFail("body") }
        XCTAssertEqual(try JSON.value(body)["p"]?.stringValue, "C:\\dir")
        XCTAssertEqual(try ok(#"curl -X POST "http://localhost:8080/api" -H "Content-Type: application/json" -d "{\"a\":1}""#).request.body, .text(#"{"a":1}"#))
        XCTAssertEqual(try Curl.tokenize(#"curl ^"a b^" "c ^ d" e^&f"#, dialect: .cmd), ["curl", "a b", "c ^ d", "e&f"])
        XCTAssertEqual(try Curl.tokenize(#"x "a\"b" "c\\""#, dialect: .cmd), ["x", "a\"b", "c\\"])
    }

    // MARK: 分词

    func testTokenizeBash() throws {
        XCTAssertEqual(try Curl.tokenize(#"curl 'a b' "c d" e\ f 'g'"h"i"#, dialect: .bash), ["curl", "a b", "c d", "e f", "ghi"])
        XCTAssertEqual(try Curl.tokenize(#"x "\"q\" \$HOME \\ \n""#, dialect: .bash), ["x", #""q" $HOME \ \n"#])
        XCTAssertEqual(try Curl.tokenize("a '' \"\"", dialect: .bash), ["a", "", ""])
        XCTAssertEqual(try Curl.tokenize("curl \\\n  -v \\\r\n  url", dialect: .bash), ["curl", "-v", "url"])
        XCTAssertEqual(try Curl.tokenize("# comment\ncurl url # trailing\n| jq .", dialect: .bash), ["curl", "url"])
        XCTAssertEqual(try Curl.tokenize(#"curl url > "out file.json" 2>&1 -v"#, dialect: .bash), ["curl", "url", "-v"])
        XCTAssertEqual(try Curl.tokenize("curl http://x/?a=1&b=2", dialect: .bash), ["curl", "http://x/?a=1&b=2"])
    }

    func testSyntaxErrors() {
        let e1 = parseError("curl 'http://x' \\\n -H 'a")
        XCTAssertEqual(e1?.line, 2)
        let e2 = parseError("curl \"abc")
        XCTAssertEqual(e2?.message.zh, "双引号没有闭合（第 1 行第 6 列）")
        XCTAssertEqual(e2?.message.en, "Unclosed double quote (line 1, column 6)")
        XCTAssertEqual(e2?.toolError(.en).column, 6)
        XCTAssertNotNil(parseError("curl $'abc"))
        XCTAssertEqual(parseError("")?.message.zh, "请输入 curl 命令")
        XCTAssertTrue(parseError("wget https://a.dev")?.message.zh.contains("没有找到 curl") ?? false)
        XCTAssertTrue(parseError("curl -v")?.message.zh.contains("缺少 URL") ?? false)
        XCTAssertEqual(parseError("curl -v")?.toolError(.en).message, "Missing URL: the curl command has no request address")
    }

    func testHelpers() {
        XCTAssertTrue(Curl.looksLikeCurl("curl https://x"))
        XCTAssertTrue(Curl.looksLikeCurl("  $ curl -v x"))
        XCTAssertTrue(Curl.looksLikeCurl("CURL.exe ^\"x^\""))
        XCTAssertFalse(Curl.looksLikeCurl("curly braces"))
        XCTAssertFalse(Curl.looksLikeCurl("https://x"))
        XCTAssertEqual(Curl.curlEscape("a b!'()*~._-中"), "a%20b%21%27%28%29%2A~._-%E4%B8%AD")
        XCTAssertEqual(Curl.appendQuery("http://x/p#frag", "a=1"), "http://x/p?a=1#frag")
        XCTAssertEqual(Curl.appendQuery("http://x/p?b=2", "a=1"), "http://x/p?b=2&a=1")
        XCTAssertEqual(Curl.appendQuery("http://x/p?", "a=1"), "http://x/p?a=1")
    }

    // MARK: 参数

    func testDefaultsAndMethods() throws {
        XCTAssertEqual(try ok("curl example.com/path").request, CurlRequest(url: "http://example.com/path"))
        XCTAssertEqual(try ok("$ curl https://a.dev").request.url, "https://a.dev")
        XCTAssertEqual(try ok("curl.exe https://a.dev").request.url, "https://a.dev")
        XCTAssertEqual(try ok("HTTPS_PROXY=x curl https://a.dev").request.url, "https://a.dev")
        XCTAssertEqual(try ok("curl -XPUT https://a.dev").request.method, "PUT")
        XCTAssertEqual(try ok("curl --request delete https://a.dev").request.method, "DELETE")
        XCTAssertEqual(try ok("curl https://a.dev -X PATCH -d x").request.method, "PATCH")
        XCTAssertEqual(try ok("curl --request=PUT --data=x a.dev").request.method, "PUT")
    }

    func testDataAndHeaders() throws {
        let r = try ok("curl https://a.dev -d 'a=1' -d 'b=2' --data-ascii c=3").request
        XCTAssertEqual(r.method, "POST")
        XCTAssertEqual(r.body, .text("a=1&b=2&c=3"))
        XCTAssertEqual(r.headers, [HTTPHeader("Content-Type", "application/x-www-form-urlencoded")])
        XCTAssertEqual(try ok("curl a.dev -H 'content-type: text/plain' -d x").request.headers, [HTTPHeader("content-type", "text/plain")])
        XCTAssertEqual(try ok("curl a.dev -H 'Content-Type:' -d x").request.headers, [])
        XCTAssertEqual(try ok("curl a.dev -H 'X-A: 1' -H 'X-A:'").request.headers, [])
        XCTAssertEqual(try ok("curl a.dev -H 'X-Empty;' -H 'X-Time: 12:30:00'").request.headers, [HTTPHeader("X-Empty", ""), HTTPHeader("X-Time", "12:30:00")])
        let bad = try ok("curl a.dev -H 'nonsense'")
        XCTAssertEqual(bad.request.headers, [])
        XCTAssertTrue(bad.warnings[0].zh.contains("请求头格式不正确"))
        XCTAssertTrue(bad.warnings[0].en.contains("Malformed header"))
        XCTAssertEqual(try ok("curl a.dev --data-raw '@not-a-file'").request.body, .text("@not-a-file"))
        XCTAssertEqual(try ok("curl a.dev --data-binary @payload.bin").request.body, .file("payload.bin"))
        let at = try ok("curl a.dev -d @body.json")
        XCTAssertEqual(at.request.body, .file("body.json"))
        XCTAssertEqual(at.warnings.count, 1)
    }

    func testURLEncodeQueryAndJSON() throws {
        let r = try ok("curl a.dev --data-urlencode 'hello world' --data-urlencode '=a&b' --data-urlencode 'q=中 文' --data-urlencode 'f@file.txt'")
        XCTAssertEqual(r.request.body, .text("hello%20world&a%26b&q=%E4%B8%AD%20%E6%96%87&f={{file:file.txt}}"))
        let g = try ok("curl -G https://a.dev/s?x=1 -d 'q=a b' --data-urlencode 'r=c d'").request
        XCTAssertEqual(g.method, "GET")
        XCTAssertEqual(g.url, "https://a.dev/s?x=1&q=a b&r=c%20d")
        XCTAssertEqual(g.body, .none)
        XCTAssertEqual(try ok("curl https://a.dev/p --url-query 'q=a b' --url-query '+raw=x y'").request.url, "https://a.dev/p?q=a%20b&raw=x y")
        let j = try ok(#"curl a.dev --json '{"a":' --json '1}'"#).request
        XCTAssertEqual(j.body, .text(#"{"a":1}"#))
        XCTAssertEqual(j.headers, [HTTPHeader("Content-Type", "application/json"), HTTPHeader("Accept", "application/json")])
    }

    func testMultipart() throws {
        let r = try ok(#"curl https://a.dev/upload -F 'name=张三' -F 'avatar=@/tmp/me.png;type=image/png;filename=face.png' -F 'doc=@"my;file.txt"' --form-string 'raw=@literal' -F 'note=hi;type=text/plain' -F 'semi=a;b'"#)
        XCTAssertEqual(r.request.method, "POST")
        XCTAssertEqual(r.request.headers, [])
        XCTAssertEqual(r.request.body, .multipart([
            CurlFormPart(name: "name", value: "张三"),
            CurlFormPart(name: "avatar", value: "/tmp/me.png", kind: .file, filename: "face.png", contentType: "image/png"),
            CurlFormPart(name: "doc", value: "my;file.txt", kind: .file),
            CurlFormPart(name: "raw", value: "@literal"),
            CurlFormPart(name: "note", value: "hi", contentType: "text/plain"),
            CurlFormPart(name: "semi", value: "a;b"),
        ]))
        let lt = try ok("curl a.dev -F 'text=<notes.txt'")
        XCTAssertEqual(lt.request.body, .multipart([CurlFormPart(name: "text", value: "{{file:notes.txt}}")]))
        XCTAssertEqual(lt.warnings.count, 1)
    }

    func testAuthCookiesAndShortcuts() throws {
        XCTAssertEqual(try ok("curl -u admin:p@ss:word a.dev").request.auth, CurlBasicAuth(username: "admin", password: "p@ss:word"))
        let u = try ok("curl --user admin a.dev")
        XCTAssertEqual(u.request.auth, CurlBasicAuth(username: "admin", password: ""))
        XCTAssertEqual(u.warnings.count, 1)
        XCTAssertEqual(try ok("curl a.dev -b 'a=1' --cookie 'b=2'").request.headers, [HTTPHeader("Cookie", "a=1; b=2")])
        let jar = try ok("curl a.dev -b cookies.txt")
        XCTAssertEqual(jar.request.headers, [])
        XCTAssertTrue(jar.warnings[0].zh.contains("Cookie 文件"))
        XCTAssertEqual(try ok("curl a.dev -A 'MyAgent/1.0' -e 'https://ref.dev;auto' --oauth2-bearer tok -r 0-99").request.headers, [
            HTTPHeader("User-Agent", "MyAgent/1.0"), HTTPHeader("Referer", "https://ref.dev"),
            HTTPHeader("Authorization", "Bearer tok"), HTTPHeader("Range", "bytes=0-99"),
        ])
        let flags = try ok("curl -sSLkI --compressed -m 2.5 https://a.dev").request
        XCTAssertEqual(flags.method, "HEAD")
        XCTAssertEqual(flags.followRedirects, true)
        XCTAssertTrue(flags.insecure)
        XCTAssertTrue(flags.compressed)
        XCTAssertEqual(flags.timeout, 2.5)
        XCTAssertEqual(try ok("curl --url https://a.dev/x").request.url, "https://a.dev/x")
        XCTAssertEqual(try ok("curl -v -- -weird.dev").request.url, "http://-weird.dev")
        let t = try ok("curl -T ./file.zip https://a.dev/up").request
        XCTAssertEqual(t.method, "PUT")
        XCTAssertEqual(t.body, .file("./file.zip"))
    }

    func testUnknownFlagsAndWarnings() throws {
        let r = try ok(#"curl -o out.json --proxy http://127.0.0.1:8080 --cacert ca.pem https://a.dev -w "%{http_code}""#)
        XCTAssertEqual(r.request.url, "https://a.dev")
        XCTAssertEqual(r.warnings.map(\.zh), ["不支持的参数 --proxy，已忽略", "不支持的参数 --cacert，已忽略"])
        XCTAssertEqual(r.warnings.map(\.en), ["Unsupported option --proxy; ignored", "Unsupported option --cacert; ignored"])
        let foo = try ok("curl --foo bar -X PUT https://x.dev/a -d x=1")
        XCTAssertEqual(foo.request.url, "https://x.dev/a")
        XCTAssertEqual(foo.warnings.map(\.zh), ["不支持的参数 --foo，已忽略", "「bar」可能是不支持的参数的取值，已忽略"])
        XCTAssertEqual(try ok("curl -j --weird v https://x.dev").request.url, "https://x.dev")
        XCTAssertEqual(try ok("curl --foo bar").request.url, "http://bar")
        let two = try ok("curl --bool https://a.dev https://b.dev")
        XCTAssertEqual(two.request.url, "https://a.dev")
        XCTAssertTrue(two.warnings.map(\.zh).contains("检测到多个 URL，只使用了 https://a.dev"))
        XCTAssertEqual(try ok("curl --frobnicate --frobnicate a.dev").warnings.map(\.zh), ["不支持的参数 --frobnicate，已忽略"])
        XCTAssertTrue(try ok("curl a.dev b.dev").warnings[0].zh.contains("多个 URL"))
        let multi = try ok("curl https://a.dev\ncurl https://b.dev")
        XCTAssertEqual(multi.request.url, "https://a.dev")
        XCTAssertTrue(multi.warnings[0].zh.contains("多条"))
        XCTAssertEqual(try ok("curl a.dev -H").warnings.map(\.zh), ["参数 -H 缺少取值"])
        let pipe = try ok("curl -s https://a.dev/api | jq '.data'")
        XCTAssertEqual(pipe.request.url, "https://a.dev/api")
        XCTAssertEqual(pipe.warnings.count, 1)
    }

    func testUnicodeAndLargeInput() throws {
        let r = try ok(#"curl 'https://例子.测试/路径?q=你好' -H 'X-Emoji: 🎉' -d '{"msg":"👋 世界"}'"#).request
        XCTAssertEqual(r.url, "https://例子.测试/路径?q=你好")
        XCTAssertEqual(r.header("x-emoji"), "🎉")
        XCTAssertEqual(r.body, .text(#"{"msg":"👋 世界"}"#))
        let big = String(repeating: "x", count: 1_000_000)
        let headers = (0..<500).map { "-H 'X-H\($0): \($0)'" }.joined(separator: " \\\n  ")
        let start = Date()
        let req = try ok("curl https://a.dev \\\n  \(headers) \\\n  --data-raw '\(big)'").request
        XCTAssertLessThan(Date().timeIntervalSince(start), 5)
        XCTAssertEqual(req.headers.count, 501)
        guard case .text(let body) = req.body else { return XCTFail("body") }
        XCTAssertEqual(body.count, 1_000_000)
    }

    // MARK: 代码生成

    static let jsonReq = CurlRequest(
        method: "POST", url: "https://api.example.com/v1/users?page=1&q=中文",
        headers: [HTTPHeader("Content-Type", "application/json"), HTTPHeader("X-Trace", "abc"), HTTPHeader("Cookie", "a=1"), HTTPHeader("Cookie", "b=2")],
        body: .text(#"{"name":"张三","tags":["a","b"],"n":1.5,"ok":true,"x":null}"#),
        auth: CurlBasicAuth(username: "admin", password: #"p'a"ss"#), followRedirects: true, insecure: true, timeout: 10
    )

    static let formReq = CurlRequest(
        method: "POST", url: "https://upload.example.com/files", headers: [HTTPHeader("Authorization", "Bearer tok")],
        body: .multipart([CurlFormPart(name: "title", value: "年度报告"), CurlFormPart(name: "file", value: "./report.pdf", kind: .file, contentType: "application/pdf")])
    )

    func testEscapers() {
        let tricky = "it's \"quoted\" \\ back`tick` $HOME\n\ttab 中文 😀"
        XCTAssertEqual(CodeEscape.jsStr(tricky), #"'it\'s "quoted" \\ back`tick` $HOME\n\ttab 中文 😀'"#)
        XCTAssertEqual(CodeEscape.jsStr("\u{2028}\u{0}"), "'" + "\\" + "u2028" + "\\x00'")
        XCTAssertEqual(CodeEscape.pyStr(tricky), #"'it\'s "quoted" \\ back`tick` $HOME\n\ttab 中文 😀'"#)
        XCTAssertEqual(CodeEscape.goStr("a\"b\\c\n\u{1}"), #""a\"b\\c\n\x01""#)
        XCTAssertEqual(CodeEscape.javaStr("a\"b\\c\n\u{1}\u{8}"), #""a\"b\\c\n"# + "\\" + "u0001" + #"\b""#)
        XCTAssertEqual(CodeEscape.csStr("a\"b\\c\n\u{1}\u{0}"), #""a\"b\\c\n"# + "\\" + "u0001" + #"\0""#)
        XCTAssertEqual(CodeEscape.rustStr("a\"b\\c\n\u{1}"), #""a\"b\\c\n\u{1}""#)
        XCTAssertEqual(CodeEscape.swiftStr("a\"b\\c\n\u{1}"), #""a\"b\\c\n\u{1}""#)
        XCTAssertEqual(CodeEscape.phpStr(#"it's \ $x "q""#), #"'it\'s \\ $x "q"'"#)
        XCTAssertEqual(CodeEscape.phpStr("a\u{1}$b\""), #""a\x01\$b\"""#)
        XCTAssertEqual(CodeEscape.shq("it's"), #"'it'\''s'"#)
        XCTAssertEqual(CodeEscape.shq("a\nb"), #"$'a\nb'"#)
        XCTAssertEqual(CodeEscape.shq("x\u{1}'\\"), #"$'x\x01\'\\'"#)
    }

    func testURLForCodeAndPunycode() {
        XCTAssertEqual(CodeEscape.encodeURLForCode("https://a.dev/p?q=1&x={{v}}"), "https://a.dev/p?q=1&x={{v}}")
        XCTAssertEqual(CodeEscape.encodeURLForCode("https://a.dev/路径 1?q=中文&e=😀#片段"),
                       "https://a.dev/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87&e=%F0%9F%98%80#%E7%89%87%E6%AE%B5")
        XCTAssertEqual(CodeEscape.encodeURLForCode("https://例子.测试/x"), "https://xn--fsqu00a.xn--0zwm56d/x")
        XCTAssertTrue(CodeEscape.encodeURLForCode("http://用户:密@例子.cn/").hasPrefix("http://%E7%94%A8%E6%88%B7:%E5%AF%86@xn--"))
        XCTAssertEqual(CodeEscape.encodeURLForCode("a.dev/中"), "a.dev/%E4%B8%AD")
        XCTAssertEqual(CodeEscape.punycode("bücher"), "bcher-kva")
        XCTAssertEqual(CodeEscape.idnaHost("Bücher.Example"), "xn--bcher-kva.example")
    }

    func testMergeHeadersAndJSONBody() throws {
        XCTAssertEqual(HTTPCodegen.mergeHeaders([HTTPHeader("Accept", "a"), HTTPHeader("cookie", "x=1"), HTTPHeader("accept", "b"), HTTPHeader("Cookie", "y=2")]),
                       [HTTPHeader("Accept", "a, b"), HTTPHeader("cookie", "x=1; y=2")])
        XCTAssertEqual(HTTPCodegen.jsonBodyValue(Self.jsonReq)?["name"]?.stringValue, "张三")
        var r = Self.jsonReq
        r.body = .text(#"{"id":12345678901234567890}"#)
        XCTAssertNil(HTTPCodegen.jsonBodyValue(r))
        r.body = .text(#"{"pi":3.14159265358979323846}"#)
        XCTAssertNil(HTTPCodegen.jsonBodyValue(r))
        r.body = .text("{bad json")
        XCTAssertNil(HTTPCodegen.jsonBodyValue(r))
        r.body = .text(#""just a string""#)
        XCTAssertNil(HTTPCodegen.jsonBodyValue(r))
        r.headers = [HTTPHeader("content-type", "application/vnd.api+json; charset=utf-8")]
        r.body = .text(#"{"a":"12345678901234567890"}"#)
        XCTAssertNotNil(HTTPCodegen.jsonBodyValue(r))
        r.headers = []
        XCTAssertNil(HTTPCodegen.jsonBodyValue(r))
    }

    func testLiterals() throws {
        let v = try JSON.value(#"{"a":1,"b-c":[true,null,"x"],"d":{"e":[]},"f":{},"g":[{"h":1}]}"#)
        XCTAssertEqual(CodeEscape.jsLiteral(v), "{\n  a: 1,\n  'b-c': [true, null, 'x'],\n  d: {\n    e: [],\n  },\n  f: {},\n  g: [\n    {\n      h: 1,\n    },\n  ],\n}")
        XCTAssertEqual(CodeEscape.pyLiteral(v), "{\n    'a': 1,\n    'b-c': [True, None, 'x'],\n    'd': {\n        'e': [],\n    },\n    'f': {},\n    'g': [\n        {\n            'h': 1,\n        },\n    ],\n}")
        XCTAssertEqual(CodeEscape.jsNumber(1.5e3), "1500")
        XCTAssertEqual(CodeEscape.jsNumber(-0.0001), "-0.0001")
        XCTAssertEqual(CodeEscape.jsNumber(1e-7), "1e-7")
        XCTAssertEqual(CodeEscape.jsNumber(1e21), "1e+21")
        XCTAssertEqual(CodeEscape.jsNumber(123456789012), "123456789012")
        XCTAssertEqual(CodeEscape.jsNumber(2.5), "2.5")
    }

    func testEveryTargetProducesCode() throws {
        let reqs = [
            Self.jsonReq, Self.formReq, CurlRequest(url: "https://a.dev"),
            CurlRequest(method: "HEAD", url: "https://a.dev", followRedirects: false),
            CurlRequest(method: "PUT", url: "https://a.dev", body: .file("data.bin")),
            CurlRequest(method: "PURGE", url: "https://a.dev", headers: [HTTPHeader("X", "")], body: .text("")),
        ]
        for r in reqs {
            for t in CodeTarget.allCases {
                for lang in Lang.allCases {
                    let code = HTTPCodegen.generate(r, t, lang: lang)
                    XCTAssertGreaterThan(code.count, 10, t.rawValue)
                    XCTAssertFalse(code.contains("undefined"), t.rawValue)
                    XCTAssertFalse(code.contains("Optional("), t.rawValue)
                }
            }
        }
    }

    func testTargets() {
        let fetch = HTTPCodegen.generate(Self.jsonReq, .fetch)
        XCTAssertTrue(fetch.contains("const response = await fetch('https://api.example.com/v1/users?page=1&q=%E4%B8%AD%E6%96%87', {"))
        XCTAssertTrue(fetch.contains("'Cookie': 'a=1; b=2',"))
        XCTAssertTrue(fetch.contains(#"'Authorization': 'Basic ' + btoa('admin:p\'a"ss'),"#))
        XCTAssertTrue(fetch.contains("body: JSON.stringify({\n    name: '张三',\n    tags: ['a', 'b'],"))
        XCTAssertTrue(fetch.contains("signal: AbortSignal.timeout(10000),"))
        XCTAssertTrue(fetch.contains("// 注意：浏览器会忽略这些受限的请求头：Cookie（Node.js 中有效）"))
        XCTAssertTrue(HTTPCodegen.generate(Self.jsonReq, .fetch, lang: .en).contains("// Note: browsers ignore these forbidden headers: Cookie (they work in Node.js)"))
        XCTAssertFalse(HTTPCodegen.generate(Self.jsonReq, .node).contains("受限的请求头"))
        var auth = Self.jsonReq
        auth.auth = CurlBasicAuth(username: "用户", password: "x")
        XCTAssertTrue(HTTPCodegen.generate(auth, .fetch).contains("'Authorization': 'Basic 55So5oi3Ong=',"))

        let py = HTTPCodegen.generate(Self.jsonReq, .python)
        XCTAssertTrue(py.contains("json_data = {\n    'name': '张三',\n    'tags': ['a', 'b'],\n    'n': 1.5,\n    'ok': True,\n    'x': None,\n}"))
        XCTAssertTrue(py.contains("verify=False,"))
        XCTAssertTrue(HTTPCodegen.generate(Self.formReq, .python).contains("'file': ('report.pdf', open('./report.pdf', 'rb'), 'application/pdf'),"))
        XCTAssertTrue(HTTPCodegen.generate(CurlRequest(method: "DELETE", url: "https://a.dev", body: .text("x"), followRedirects: true), .httpx)
            .contains("httpx.request('DELETE', 'https://a.dev', content=data, follow_redirects=True)"))

        let go = HTTPCodegen.generate(Self.jsonReq, .go)
        XCTAssertTrue(go.contains(#"req.Header.Add("Cookie", "b=2")"#))
        XCTAssertTrue(go.contains("import (\n\t\"crypto/tls\"\n\t\"fmt\"\n\t\"io\"\n\t\"log\"\n\t\"net/http\"\n\t\"strings\"\n\t\"time\"\n)"))
        XCTAssertTrue(HTTPCodegen.generate(Self.formReq, .go).contains("req.Header.Set(\"Content-Type\", writer.FormDataContentType())"))

        XCTAssertTrue(HTTPCodegen.generate(Self.jsonReq, .javaOkHttp).contains(#"Credentials.basic("admin", "p'a\"ss")"#))
        XCTAssertTrue(HTTPCodegen.generate(Self.jsonReq, .java).contains(".timeout(Duration.ofMillis(10000))"))
        XCTAssertTrue(HTTPCodegen.generate(Self.jsonReq, .php).contains(#"curl_setopt($ch, CURLOPT_USERPWD, 'admin:p\'a"ss');"#))
        XCTAssertTrue(HTTPCodegen.generate(Self.jsonReq, .rust).contains(#".body(r#"{"name":"张三""#))
        XCTAssertTrue(HTTPCodegen.generate(Self.jsonReq, .swift).contains(#"request.httpBody = Data(#"{"name":"张三""#))
        XCTAssertTrue(HTTPCodegen.generate(Self.jsonReq, .csharp).contains("client.Timeout = TimeSpan.FromMilliseconds(10000);"))
        XCTAssertTrue(HTTPCodegen.generate(Self.formReq, .wget).contains("不支持 multipart"))
        XCTAssertTrue(HTTPCodegen.generate(Self.jsonReq, .httpie).contains("http --follow --verify=no --timeout=10"))

        let raw = HTTPCodegen.generate(Self.jsonReq, .http)
        XCTAssertTrue(raw.hasPrefix("POST /v1/users?page=1&q=%E4%B8%AD%E6%96%87 HTTP/1.1\nHost: api.example.com\n"))
        XCTAssertTrue(raw.contains("Authorization: Basic "))
        XCTAssertTrue(raw.hasSuffix("\n\n" + #"{"name":"张三","tags":["a","b"],"n":1.5,"ok":true,"x":null}"#))
        XCTAssertEqual(CodeTarget.go.language, "go")
        XCTAssertEqual(CodeTarget.http.language, "plain")
    }

    func testCurlRoundTrip() throws {
        let commands = [
            "curl https://example.com",
            "curl -I https://example.com -H 'Host: other.example.com' -L -k --compressed -m 5",
            "curl -X PROPFIND https://dav.example.com/ -d x=1",
            #"curl https://example.com/up -F 'a=1' -F 'f=@/tmp/my file.png;type=image/png;filename=pic.png' -F 'g=@"x;y.txt"' --form-string 'h=@literal' -F 't=v;type=text/plain'"#,
            "curl -T ./archive.tar.gz https://example.com/put",
            "curl https://example.com --data-binary @payload.bin",
            "curl -u 'user:p@ss word' https://example.com",
            #"curl https://example.com -H 'X-Unicode: 你好 😀' --data-raw $'line1\nline2\t\x01\'q\''"#,
            Self.chromeBash,
        ]
        for cmd in commands {
            let req = try ok(cmd).request
            XCTAssertEqual(try ok(HTTPCodegen.generate(req, .curl)).request, req, cmd)
        }
        // 随机的刁钻字符串
        let pieces = ["'", "\"", "\\", "$", "`", " ", "\n", "\t", "中", "😀", "a", "=", ";", "&", "#", "|", "\u{1}", "!"]
        var seed: UInt32 = 42
        func rnd(_ n: Int) -> Int {
            seed = (seed &* 1_103_515_245 &+ 12345) & 0x7FFF_FFFF
            return Int(seed) % n
        }
        func str(_ len: Int) -> String { (0..<len).map { _ in pieces[rnd(pieces.count)] }.joined() }
        for i in 0..<200 {
            var headerValue = "v" + str(8).replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces) + "z"
            headerValue = headerValue.replacingOccurrences(of: "\r", with: " ")
            var req = CurlRequest(
                method: ["GET", "POST", "PUT", "DELETE", "PATCH"][rnd(5)],
                url: "https://example.com/" + Curl.curlEscape(str(5)),
                headers: [HTTPHeader("X-A\(i)", headerValue), HTTPHeader("Content-Type", "text/plain")],
                body: rnd(3) == 0 ? .none : .text(str(1 + rnd(30)))
            )
            if rnd(2) == 1 { req.auth = CurlBasicAuth(username: "u" + str(3).replacingOccurrences(of: ":", with: ""), password: str(4)) }
            let back = try ok(HTTPCodegen.generate(req, .curl)).request
            XCTAssertEqual(back, req, "round trip \(i)")
        }
    }

    func testDeepJSONBodyStaysRaw() {
        let deep = String(repeating: "[", count: 500) + String(repeating: "]", count: 500)
        let r = CurlRequest(method: "POST", url: "https://a.dev", headers: [HTTPHeader("Content-Type", "application/json")], body: .text(deep))
        XCTAssertNil(HTTPCodegen.jsonBodyValue(r))
        XCTAssertTrue(HTTPCodegen.generate(r, .python).contains("data = '[[["))
    }

    func testTool() throws {
        let tool = CurlConverterTool.spec
        let r = try tool("curl -X POST https://a.dev/x?y=1 -H 'Content-Type: application/json' -d '{\"a\":1}'", options: ["target": "python"])
        XCTAssertEqual(r.primary?.language, "python")
        XCTAssertTrue(r.primary?.value.contains("requests.post(") ?? false)
        XCTAssertEqual(r.table?.rows.first, ["方法", "POST"])
        XCTAssertTrue(r.table?.rows.contains(["查询参数 · y", "1"]) ?? false)
        let en = try tool("curl a.dev --frobnicate", options: ["target": "go"], lang: .en)
        XCTAssertEqual(en.primary?.language, "go")
        XCTAssertEqual(en.notes.map(\.message), ["Unsupported option --frobnicate; ignored"])
        XCTAssertEqual(en.table?.columns, ["Item", "Value"])
        XCTAssertThrowsError(try tool("curl \"abc", lang: .en)) { e in
            XCTAssertEqual((e as? ToolError)?.message, "Unclosed double quote (line 1, column 6)")
            XCTAssertEqual((e as? ToolError)?.column, 6)
        }
        XCTAssertThrowsError(try tool("wget x")) { e in
            XCTAssertTrue((e as? ToolError)?.message.contains("没有找到 curl") ?? false)
        }
    }
}
