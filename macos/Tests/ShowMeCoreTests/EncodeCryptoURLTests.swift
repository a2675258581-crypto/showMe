import XCTest
@testable import ShowMeCore

final class EncodeCryptoURLTests: XCTestCase {
    typealias U = URLCodecTool

    let samples = [
        "", "hello world", "你好，世界！", "a+b=c&d=e#f?g/h;i:j@k$l,m", "!~*'()-_.",
        "😀 👨\u{200D}👩\u{200D}👧 emoji", "%41 already", "[ipv6] {braces} |pipe| ^caret` \"quote\" <tag>\\", "tab\there\nnew line",
    ]

    func testEncodeMatchesFoundationRules() {
        // encodeURIComponent 的安全集合：字母数字与 -_.!~*'()
        let component = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
        for s in samples {
            XCTAssertEqual(U.encode(s, variant: .component), s.addingPercentEncoding(withAllowedCharacters: component), s)
            XCTAssertEqual(U.decode(U.encode(s, variant: .component), variant: .component).output, s)
            XCTAssertEqual(U.decode(U.encode(s, variant: .form), variant: .form).output, s)
            XCTAssertEqual(U.decode(U.encode(s, variant: .uri), variant: .component).output, s)
        }
        XCTAssertEqual(U.encode("你好 a+b", variant: .form), "%E4%BD%A0%E5%A5%BD+a%2Bb")
        XCTAssertEqual(U.encode("https://例子.cn/a b?x=1&y=#f", variant: .uri), "https://%E4%BE%8B%E5%AD%90.cn/a%20b?x=1&y=#f")
        XCTAssertEqual(U.encode("a+b=c&d=e#f?g/h;i:j@k$l,m", variant: .uri), "a+b=c&d=e#f?g/h;i:j@k$l,m")
    }

    func testStrictKeepEscapesAndPerLine() {
        XCTAssertEqual(U.encode("!'()*~", variant: .component, strict: true), "%21%27%28%29%2A~")
        XCTAssertEqual(U.encode("a%20b c%zz", variant: .component, keepEscapes: true), "a%20b%20c%25zz")
        XCTAssertEqual(U.encode("%e4%b8%ad", variant: .component, keepEscapes: true), "%E4%B8%AD")
        XCTAssertEqual(U.encode("a b\r\n\nc&d", variant: .component, perLine: true), "a%20b\n\nc%26d")
        XCTAssertEqual(U.encode("a b\nc", variant: .component), "a%20b%0Ac")
    }

    func testDecodeModes() {
        let s = "%2F%3F%23%26%3D%20%E4%B8%AD%41"
        XCTAssertEqual(U.decode(s, variant: .uri).output, "%2F%3F%23%26%3D 中A")
        XCTAssertEqual(U.decode("a+b%2Bc+%E4%B8%AD", variant: .form).output, "a b+c 中")
        XCTAssertEqual(U.decode("a+b", variant: .component).output, "a+b")
        XCTAssertEqual(U.decode("%f0%9f%98%80", variant: .component).output, "😀")
    }

    func testMalformedSequencesKeepPositions() {
        let r = U.decode("ok%20\n100% and %zz and %E4%B8 end", variant: .component)
        XCTAssertEqual(r.output, "ok \n100% and %zz and %E4%B8 end")
        XCTAssertEqual(r.issues.map { [String($0.line), String($0.column), $0.text] }, [["2", "4", "% a"], ["2", "10", "%zz"], ["2", "18", "%E4%B8"]])
        XCTAssertTrue(r.issues[2].message.zh.contains("不是完整或合法的 UTF-8"))
        XCTAssertTrue(U.decode("50%", variant: .component).issues[0].message.zh.contains("末尾"))
        let o = U.decode("%C0%AF%E4%B8%AD%80x", variant: .component)
        XCTAssertEqual(o.output, "%C0%AF中%80x")
        XCTAssertEqual(o.issues.map(\.text), ["%C0%AF", "%80"])
        XCTAssertTrue(o.issues[1].message.zh.contains("孤立的 UTF-8 后续字节"))
        let lines = U.decode("a%20b\nc%2", variant: .component, perLine: true)
        XCTAssertEqual(lines.output, "a b\nc%2")
        XCTAssertEqual(lines.issues[0].line, 2)
        XCTAssertEqual(lines.issues[0].column, 2)
        // 同一长行上的大量问题：位置准确且只记 200 条
        let long = U.decode("x\n" + String(repeating: "😀%", count: 50) + "%zz", variant: .component)
        XCTAssertEqual(long.issues[0].column, 2)
        XCTAssertEqual(long.issues[1].column, 4)
        XCTAssertEqual(long.issues[50].column, 101)
        XCTAssertEqual(long.issues[50].text, "%zz")
        XCTAssertEqual(U.decode(String(repeating: "a%", count: 100_000), variant: .component).issues.count, 200)
    }

    func testDecodeToolNotesBothLanguages() throws {
        let r = try U.spec("100%", options: ["mode": "decode"])
        XCTAssertEqual(r.primary?.value, "100%")
        XCTAssertTrue(r.notes.contains { $0.message.contains("第 1 行第 4 列") })
        let en = try U.spec("100%", options: ["mode": "decode"], lang: .en)
        XCTAssertTrue(en.notes.contains { $0.message.contains("Line 1, column 4: A lone % at the end") })
    }

    func testParseFullURL() throws {
        let u = try U.parse("https://user:p%40ss@例子.测试:8443/a/%E4%B8%AD/b?q=%E4%BD%A0%E5%A5%BD&x=1+2&x=3&flag#top")
        XCTAssertFalse(u.assumedScheme)
        XCTAssertEqual(u.scheme, "https")
        XCTAssertEqual(u.username, "user")
        XCTAssertEqual(u.password, "p%40ss")
        XCTAssertEqual(u.hostname, "xn--fsqu00a.xn--0zwm56d")
        XCTAssertEqual(u.hostUnicode, "例子.测试")
        XCTAssertEqual(u.port, "8443")
        XCTAssertEqual(u.pathname, "/a/%E4%B8%AD/b")
        XCTAssertEqual(u.hash, "#top")
        XCTAssertEqual(u.params.map { [$0.key, $0.value, $0.hasValue ? "1" : "0"] }, [["q", "你好", "1"], ["x", "1 2", "1"], ["x", "3", "1"], ["flag", "", "0"]])
        XCTAssertEqual(u.origin, "https://xn--fsqu00a.xn--0zwm56d:8443")
    }

    func testParseAssumedSchemeAndOthers() throws {
        let a = try U.parse("example.com/path?a=1")
        XCTAssertTrue(a.assumedScheme)
        XCTAssertEqual(a.hostname, "example.com")
        XCTAssertEqual(a.defaultPort, "443")
        let local = try U.parse("localhost:3000/api")
        XCTAssertEqual(local.port, "3000")
        XCTAssertTrue(local.assumedScheme)
        XCTAssertEqual(try U.parse("//cdn.example.com/x.js").hostname, "cdn.example.com")
        let mail = try U.parse("mailto:someone@example.com?subject=Hi%20there")
        XCTAssertEqual(mail.scheme, "mailto")
        XCTAssertEqual(mail.params.first?.value, "Hi there")
        let norm = try U.parse("HTTPS://Example.COM:443/a/./b/../c d")
        XCTAssertEqual(norm.href, "https://example.com/a/c%20d")
        XCTAssertEqual(norm.port, "")
        XCTAssertEqual(try U.parse("https://example.com").pathname, "/")
    }

    func testParseRelative() throws {
        let r = try U.parse("/api/users?page=2&q=%E4%B8%AD#list")
        XCTAssertTrue(r.relative)
        XCTAssertEqual(r.pathname, "/api/users")
        XCTAssertEqual(r.search, "?page=2&q=%E4%B8%AD")
        XCTAssertEqual(r.hash, "#list")
        XCTAssertEqual(r.params.map(\.value), ["2", "中"])
        XCTAssertEqual(try U.parse("?a=1&b=2").params.count, 2)
        XCTAssertEqual(try U.parse("../img/a.png?v=3").pathname, "../img/a.png")
        XCTAssertNoThrow(try U.parse("#top"))
        XCTAssertNoThrow(try U.parse("https://example.com/a b"))
    }

    func testParseErrors() {
        func message(_ s: String) -> String {
            do { _ = try U.parse(s) } catch let e as U.ParseError { return e.message.zh } catch {}
            return ""
        }
        XCTAssertEqual(message(""), "请输入 URL")
        XCTAssertTrue(message("https://example.com:99999/").contains("超出范围"))
        XCTAssertTrue(message("http://example.com:abc/").contains("不是数字"))
        XCTAssertTrue(message("https://exa mple.com").contains("空白"))
        XCTAssertTrue(message("https://").contains("缺少主机名"))
        XCTAssertTrue(message("https://exa<mple.com").contains("“<”"))
        XCTAssertTrue(message("https://[::1").contains("右方括号"))
        XCTAssertTrue(message("https://[zz]/").contains("IPv6"))
        XCTAssertTrue(message("/a b?x=1").contains("空白"))
        XCTAssertThrowsError(try U.spec("https://", options: ["mode": "parse"], lang: .en)) { e in
            XCTAssertTrue((e as? ToolError)?.message.contains("The host is missing") ?? false)
        }
    }

    func testParseToolOutputsJSONAndTable() throws {
        let r = try U.spec("https://a.com/x/%E4%B8%AD?a=1&a=2&b=3", options: ["mode": "parse"])
        let json = try JSON.value(r.primary?.value ?? "")
        XCTAssertEqual(json["query"], .object([JSONMember("a", .array([.string("1"), .string("2")])), JSONMember("b", .string("3"))]))
        XCTAssertEqual(json["pathSegments"], .array([.string("x"), .string("中")]))
        XCTAssertEqual(json["hostname"], .string("a.com"))
        XCTAssertEqual(r.primary?.language, "json")
        XCTAssertEqual(r.table?.rows.count, 3)
        XCTAssertEqual(r.outputs.first { $0.id == "port" }?.value, "省略，默认 443")
        XCTAssertEqual(r.outputs.first { $0.id == "pathDecoded" }?.value, "/x/中")
        let rel = try U.spec("/p?x=1", options: ["mode": "parse"])
        XCTAssertNil(try JSON.value(rel.primary?.value ?? "")["origin"])
    }

    func testPunycode() {
        XCTAssertEqual(Punycode.domainToUnicode("xn--fiqs8s.xn--fiqz9s"), "中国.中國")
        XCTAssertEqual(Punycode.domainToUnicode("xn--mnchen-3ya.de"), "münchen.de")
        XCTAssertEqual(Punycode.domainToUnicode("xn--ls8h.la"), "💩.la")
        XCTAssertEqual(Punycode.domainToUnicode("example.com"), "example.com")
        XCTAssertEqual(Punycode.domainToUnicode("xn--!!!.com"), "xn--!!!.com")
        XCTAssertEqual(Punycode.domainToASCII("中国.中國"), "xn--fiqs8s.xn--fiqz9s")
        XCTAssertEqual(Punycode.domainToASCII("München.de"), "xn--mnchen-3ya.de")
        XCTAssertEqual(Punycode.domainToASCII("💩.la"), "xn--ls8h.la")
    }

    func testQueryHelpers() {
        XCTAssertEqual(U.parseQuery("a=%E4%B8&&b").count, 2)
        XCTAssertEqual(U.parseQuery("a=%E4%B8&&b")[0].value, "%E4%B8")
        XCTAssertEqual(U.safeDecode("100%"), "100%")
        for s in samples {
            XCTAssertEqual(U.parseQuery("k=" + U.encodeQueryPart(s)).first?.value ?? "", s)
            XCTAssertEqual(U.parseQuery("k=" + U.encodeQueryPart(s, spaceAsPlus: true)).first?.value ?? "", s)
        }
    }

    func testLargeInput() {
        let text = String(repeating: "中文 test/?&=", count: 20_000)
        let enc = U.encode(text, variant: .component)
        XCTAssertEqual(U.decode(enc, variant: .component).output, text)
    }
}
