import XCTest
@testable import ShowMeCore

final class NetworkTextHTTPModelTests: XCTestCase {
    func testQueryParamsSync() {
        let parts = HTTPRequestDraft.splitURL("https://a.dev/p?x=1&y#frag")
        XCTAssertEqual(parts.base, "https://a.dev/p")
        XCTAssertEqual(parts.query, "x=1&y")
        XCTAssertEqual(parts.fragment, "#frag")
        XCTAssertNil(HTTPRequestDraft.splitURL("https://a.dev").query)

        XCTAssertEqual(HTTPRequestDraft.params(fromQuery: "q=%E4%B8%AD+%E6%96%87&flag&a=b%26c&&bad=100%"), [
            HTTPKeyValue("q", "中 文"), HTTPKeyValue("flag", ""), HTTPKeyValue("a", "b&c"), HTTPKeyValue("bad", "100%"),
        ])
        XCTAssertEqual(HTTPRequestDraft.query(from: [
            HTTPKeyValue("q", "a b&c=d"), HTTPKeyValue("cn", "中文"), HTTPKeyValue("off", "x", enabled: false),
            HTTPKeyValue("id", "{{userId}}"), HTTPKeyValue("", ""), HTTPKeyValue("flag", ""), HTTPKeyValue("path", "/a:b@c?"),
        ]), "q=a%20b%26c%3Dd&cn=%E4%B8%AD%E6%96%87&id={{userId}}&flag&path=/a:b@c?")

        var d = HTTPRequestDraft(url: "https://a.dev/s", params: [HTTPKeyValue("a", "1"), HTTPKeyValue("keep", "me", enabled: false)])
        XCTAssertEqual(d.fullURL, "https://a.dev/s?a=1")
        d.setFullURL("https://a.dev/s?a=2&b=x%20y#top")
        XCTAssertEqual(d.url, "https://a.dev/s#top")
        XCTAssertEqual(d.params, [HTTPKeyValue("a", "2"), HTTPKeyValue("keep", "me", enabled: false), HTTPKeyValue("b", "x y")])
        XCTAssertEqual(d.fullURL, "https://a.dev/s?a=2&b=x%20y#top")
        d.setFullURL("https://a.dev/s")
        XCTAssertEqual(d.params, [HTTPKeyValue("keep", "me", enabled: false)])
    }

    func testVariables() {
        XCTAssertEqual(HTTPVariables.segments("a{{ x }}b{{}}c{{y").map(\.name), [nil, "x", nil])
        let env = ["base": "https://api.dev", "id": "42", "nested": "{{id}}-{{id}}"]
        XCTAssertEqual(HTTPVariables.resolve("{{base}}/u/{{ id }}?n={{nested}}&m={{missing}}", env: env),
                       "https://api.dev/u/42?n=42-42&m={{missing}}")
        let ctx = HTTPVariables.Context(env: [:], now: Date(timeIntervalSince1970: 1_700_000_000.5), random: { Array(repeating: 0xAB, count: $0) })
        XCTAssertEqual(ctx.resolve("{{$timestamp}}").text, "1700000000")
        XCTAssertEqual(ctx.resolve("{{$isoTimestamp}}").text, "2023-11-14T22:13:20.500Z")
        XCTAssertEqual(ctx.resolve("{{$uuid}}").text, "abababab-abab-4bab-abab-abababababab")
        XCTAssertEqual(ctx.resolve("{{$randomInt}}").text, String(0xABABABAB % 1001))

        let d = HTTPRequestDraft(method: "POST", url: "{{base}}/users", params: [HTTPKeyValue("q", "{{q}}")],
                                 headers: [HTTPKeyValue("X-Id", "{{id}}")], body: .json(#"{"id":{{id}}}"#), auth: .bearer("{{token}}"))
        XCTAssertEqual(d.missingVariables(env), ["q", "token"])
        let s = d.substituting(env.merging(["q": "a b", "token": "t0k"]) { a, _ in a })
        XCTAssertEqual(s.url, "https://api.dev/users")
        XCTAssertEqual(s.body, .json(#"{"id":42}"#))
        XCTAssertEqual(s.auth, .bearer("t0k"))
        XCTAssertEqual(d.resolvedURL(env: env.merging(["q": "a b"]) { a, _ in a }), "https://api.dev/users?q=a%20b")
    }

    func testResolvedURLAndHeaders() {
        XCTAssertEqual(HTTPRequestDraft(url: "a.dev/x?keep=1#f", params: [HTTPKeyValue("p", "中")]).resolvedURL(), "http://a.dev/x?keep=1&p=%E4%B8%AD#f")
        XCTAssertEqual(HTTPRequestDraft(url: "//a.dev").resolvedURL(), "http://a.dev")
        XCTAssertEqual(HTTPRequestDraft(url: "").resolvedURL(), "")

        let basic = HTTPRequestDraft(method: "POST", url: "https://a.dev", headers: [HTTPKeyValue("Accept", "*/*"), HTTPKeyValue("Off", "x", enabled: false), HTTPKeyValue(" ", "x")],
                                     body: .json("{}"), auth: .basic(user: "用户", password: "p:w"))
        XCTAssertEqual(basic.effectiveHeaders(), [
            HTTPHeader("Accept", "*/*"),
            HTTPHeader("Authorization", "Basic " + Data("用户:p:w".utf8).base64EncodedString()),
            HTTPHeader("Content-Type", "application/json"),
        ])
        // 用户手动设置的优先
        let manual = HTTPRequestDraft(method: "PUT", url: "https://a.dev", headers: [HTTPKeyValue("content-type", "application/vnd.x+json"), HTTPKeyValue("Authorization", "Custom 1")],
                                      body: .json("{}"), auth: .bearer("tok"))
        XCTAssertEqual(manual.effectiveHeaders(), [HTTPHeader("content-type", "application/vnd.x+json"), HTTPHeader("Authorization", "Custom 1")])
        XCTAssertEqual(HTTPRequestDraft(method: "POST", body: .formURLEncoded([])).effectiveHeaders(), [HTTPHeader("Content-Type", "application/x-www-form-urlencoded")])
        XCTAssertEqual(HTTPRequestDraft(method: "POST", body: .text("x")).effectiveHeaders(), [HTTPHeader("Content-Type", "text/plain")])
        // GET 不带请求体，也不加 Content-Type
        let get = HTTPRequestDraft(method: "GET", body: .json("{}"), auth: .bearer(" tok "))
        XCTAssertEqual(get.effectiveHeaders(), [HTTPHeader("Authorization", "Bearer tok")])
        XCTAssertNil(get.bodyData())
        XCTAssertFalse(get.allowsBody)
        XCTAssertTrue(HTTPRequestDraft(method: "delete").allowsBody)
    }

    func testBodies() throws {
        let form = HTTPRequestDraft(method: "POST", body: .formURLEncoded([HTTPKeyValue("q", "a b&c"), HTTPKeyValue("cn", "中"), HTTPKeyValue("off", "1", enabled: false), HTTPKeyValue("s", "*-._~")]))
        XCTAssertEqual(form.bodyData().map { String(decoding: $0, as: UTF8.self) }, "q=a+b%26c&cn=%E4%B8%AD&s=*-._%7E")
        XCTAssertEqual(HTTPRequestDraft(method: "POST", body: .json(#"{"a":"中"}"#)).bodyData(), Data(#"{"a":"中"}"#.utf8))
        XCTAssertNil(HTTPRequestDraft(method: "POST").bodyData())

        let mp = HTTPRequestDraft(method: "POST", headers: [HTTPKeyValue("Content-Type", "multipart/form-data; boundary=wrong")],
                                  body: .multipart([HTTPKeyValue("title", "年度报告"), HTTPKeyValue("n", "1")]))
        let boundary = mp.multipartBoundary
        XCTAssertEqual(boundary, mp.multipartBoundary)
        XCTAssertEqual(mp.effectiveHeaders(), [HTTPHeader("Content-Type", "multipart/form-data; boundary=\(boundary)")])
        let text = String(decoding: try XCTUnwrap(mp.bodyData()), as: UTF8.self)
        XCTAssertEqual(text, "--\(boundary)\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\n年度报告\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"n\"\r\n\r\n1\r\n--\(boundary)--\r\n")
    }

    func testCurlImportExport() throws {
        let d = try HTTPRequestDraft.fromCurl(#"curl 'https://api.dev/v1/items?page=1&q=%E4%B8%AD' -H 'Authorization: Bearer abc' -H 'X-Trace: 1' -H 'Content-Type: application/json' --data-raw '{"a":1}'"#)
        XCTAssertEqual(d.method, "POST")
        XCTAssertEqual(d.url, "https://api.dev/v1/items")
        XCTAssertEqual(d.params, [HTTPKeyValue("page", "1"), HTTPKeyValue("q", "中")])
        XCTAssertEqual(d.headers, [HTTPKeyValue("X-Trace", "1")])
        XCTAssertEqual(d.body, .json(#"{"a":1}"#))
        XCTAssertEqual(d.auth, .bearer("abc"))
        XCTAssertEqual(try HTTPRequestDraft.fromCurl(d.toCurl()), d)

        let basic = try HTTPRequestDraft.fromCurl("curl -u 'admin:s3cr3t' -d 'a=1&b=x+y%26z' https://a.dev")
        XCTAssertEqual(basic.auth, .basic(user: "admin", password: "s3cr3t"))
        XCTAssertEqual(basic.body, .formURLEncoded([HTTPKeyValue("a", "1"), HTTPKeyValue("b", "x y&z")]))
        XCTAssertEqual(basic.headers, [])
        XCTAssertTrue(basic.toCurl().contains("-u 'admin:s3cr3t'"))
        XCTAssertEqual(try HTTPRequestDraft.fromCurl(basic.toCurl()), basic)

        let header = try HTTPRequestDraft.fromCurl("curl https://a.dev -H 'Authorization: Basic \(Data("u:p".utf8).base64EncodedString())'")
        XCTAssertEqual(header.auth, .basic(user: "u", password: "p"))

        let text = HTTPRequestDraft(method: "PUT", url: "https://a.dev/{{id}}", body: .text("hello"))
        XCTAssertEqual(try HTTPRequestDraft.fromCurl(text.toCurl()), text)
        XCTAssertTrue(text.toCurl(env: ["id": "7"]).contains("'https://a.dev/7'"))

        let mp = HTTPRequestDraft(method: "POST", url: "https://a.dev", body: .multipart([HTTPKeyValue("t", "v")]))
        XCTAssertEqual(try HTTPRequestDraft.fromCurl(mp.toCurl()), mp)

        let imported = try HTTPRequestDraft.importCurl("curl -F 'a=1' -F 'f=@x.png' -k https://a.dev")
        XCTAssertEqual(imported.draft.body, .multipart([HTTPKeyValue("a", "1")]))
        XCTAssertEqual(imported.notes.count, 2)
        let file = try HTTPRequestDraft.importCurl("curl -T big.iso https://a.dev")
        XCTAssertEqual(file.draft.method, "PUT")
        XCTAssertEqual(file.draft.body, .none)
        XCTAssertTrue(file.notes[0].en.contains("big.iso"))
        XCTAssertThrowsError(try HTTPRequestDraft.fromCurl("nope"))
        XCTAssertEqual(HTTPRequestDraft(url: "https://a.dev/users/1?x=1").label, "/users/1")
        XCTAssertEqual(HTTPRequestDraft(url: "https://a.dev/").label, "a.dev")
    }

    func testResponseSummary() {
        let json = HTTPResponseSummary(status: 200, headers: [HTTPHeader("Content-Type", "application/json; charset=utf-8")],
                                       body: Data(#"{"id":12345678901234567890,"ok":true}"#.utf8), duration: 0.1234)
        XCTAssertEqual(json.bodyKind, .json)
        XCTAssertEqual(json.prettyBody, "{\n  \"id\": 12345678901234567890,\n  \"ok\": true\n}")
        XCTAssertEqual(json.language, "json")
        XCTAssertEqual(json.statusLine(.en), "200 OK")
        XCTAssertEqual(json.statusLine(.zh), "200 OK · 成功")
        XCTAssertEqual(json.statusClass, 2)
        XCTAssertEqual(json.durationText, "123 ms")
        XCTAssertEqual(json.sizeText, "37 B")
        let custom = HTTPResponseSummary(status: 404, statusText: "Nope", headers: [], body: Data("<html><body>x</body></html>".utf8), duration: 2.5)
        XCTAssertEqual(custom.statusLine(.en), "404 Nope")
        XCTAssertEqual(custom.bodyKind, .html)
        XCTAssertEqual(custom.prettyBody, "<html><body>x</body></html>")
        XCTAssertEqual(custom.durationText, "2.50 s")
        XCTAssertEqual(HTTPResponseSummary(status: 204).bodyKind, .empty)
        XCTAssertEqual(HTTPResponseSummary(status: 200, body: Data([0, 1, 2, 3])).bodyKind, .binary)
        XCTAssertEqual(HTTPResponseSummary(status: 200, body: Data("[1, 2]".utf8)).bodyKind, .json)
        XCTAssertEqual(HTTPResponseSummary(status: 200, body: Data("not { json".utf8)).prettyBody, "not { json")
        XCTAssertEqual(HTTPResponseSummary(status: 299).statusLine(.zh), "299")
        XCTAssertEqual(HTTPResponseSummary.formatSize(0), "0 B")
        XCTAssertEqual(HTTPResponseSummary.formatSize(1536), "1.5 KB")
        XCTAssertEqual(HTTPResponseSummary.formatSize(1024), "1 KB")
        XCTAssertEqual(HTTPResponseSummary.formatSize(5 * 1024 * 1024 + 1), "5 MB")
        XCTAssertEqual(HTTPResponseSummary.formatDuration(75), "1 min 15 s")
        let latin = HTTPResponseSummary(status: 200, headers: [HTTPHeader("content-type", "text/plain; charset=ISO-8859-1")], body: Data([0x63, 0x61, 0x66, 0xE9]))
        XCTAssertEqual(latin.bodyText, "café")
    }

    func testHistoryAndCodable() throws {
        let draft = HTTPRequestDraft(method: "POST", url: "https://a.dev", params: [HTTPKeyValue("a", "1", enabled: false)],
                                     headers: [HTTPKeyValue("X", "y")], body: .multipart([HTTPKeyValue("k", "v")]), auth: .basic(user: "u", password: "p"))
        var list: [HTTPHistoryEntry] = []
        for i in 0..<130 {
            list = HTTPHistoryEntry.adding(HTTPHistoryEntry(draft: draft, status: 200 + i, duration: 0.1, date: Date(timeIntervalSince1970: Double(i))), to: list)
        }
        XCTAssertEqual(list.count, 100)
        XCTAssertEqual(list.first?.status, 329)
        XCTAssertEqual(list.last?.status, 230)
        let data = try JSONEncoder().encode(list)
        let back = try JSONDecoder().decode([HTTPHistoryEntry].self, from: data)
        XCTAssertEqual(back, list)
        for body in [HTTPBody.none, .json("{}"), .text("t"), .formURLEncoded([HTTPKeyValue("a", "b")])] {
            var d = draft
            d.body = body
            d.auth = .bearer("x")
            XCTAssertEqual(try JSONDecoder().decode(HTTPRequestDraft.self, from: JSONEncoder().encode(d)), d)
        }
    }
}
