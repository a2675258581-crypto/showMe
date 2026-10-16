import XCTest
@testable import ShowMeCore

final class EncodeCryptoEntitiesTests: XCTestCase {
    typealias E = HTMLEntities

    func dec(_ s: String) -> String { E.decode(s).output }

    func testEntityTable() {
        XCTAssertEqual(E.named.count, 2125)
        XCTAssertEqual(E.legacy.count, 106)
        XCTAssertTrue(E.legacy.allSatisfy { E.named[$0] != nil })
        let cases: [(String, String)] = [
            ("amp", "&"), ("nbsp", "\u{A0}"), ("copy", "©"), ("hellip", "…"), ("mdash", "—"), ("rarr", "→"), ("check", "✓"),
            ("euro", "€"), ("lang", "⟨"), ("Afr", "𝔄"), ("NotEqualTilde", "≂̸"), ("ThickSpace", "\u{205F}\u{200A}"), ("fjlig", "fj"),
        ]
        for (name, value) in cases { XCTAssertEqual(E.named[name], value, name) }
    }

    func testPreferredNames() {
        XCTAssertEqual(E.entityName(of: "→"), "rarr")
        XCTAssertEqual(E.entityName(of: "∈"), "isin")
        XCTAssertEqual(E.entityName(of: "©"), "copy")
        XCTAssertEqual(E.entityName(of: "\u{A0}"), "nbsp")
        XCTAssertEqual(E.entityName(of: "&"), "amp")
        XCTAssertEqual(E.entityName(of: "✓"), "check")
        XCTAssertNil(E.entityName(of: "中"))
    }

    func testEncode() {
        let src = "<a href=\"x\">'Tom & Jerry'</a>"
        XCTAssertEqual(E.encode(src, mode: .special), "&lt;a href=&quot;x&quot;&gt;&#39;Tom &amp; Jerry&#39;&lt;/a&gt;")
        XCTAssertEqual(E.encode(src, mode: .special, quotes: false), "&lt;a href=\"x\"&gt;'Tom &amp; Jerry'&lt;/a&gt;")
        XCTAssertEqual(E.encode("中文 © 😀", mode: .special), "中文 © 😀")
        XCTAssertEqual(E.encode("© 2024 — 中文 😀 →", mode: .named), "&copy; 2024 &mdash; &#20013;&#25991; &#128512; &rarr;")
        XCTAssertEqual(E.encode("中", mode: .named, hexFallback: true), "&#x4E2D;")
        XCTAssertEqual(E.encode("中😀<", mode: .decimal), "&#20013;&#128512;&lt;")
        XCTAssertEqual(E.encode("中😀<", mode: .hex), "&#x4E2D;&#x1F600;&lt;")
        XCTAssertEqual(E.encode("a\n\tb", mode: .hex), "a\n\tb")
        XCTAssertEqual(E.encode("", mode: .named), "")
        let s = "<p class=\"x\">Tom & Jerry's 中文 😀 👨\u{200D}👩\u{200D}👧 ©®™ — “quotes” ≠ ∞ ⟨x⟩ fj\u{A0}end</p>\n&amp; literal"
        for mode in E.EncodeMode.allCases { XCTAssertEqual(dec(E.encode(s, mode: mode)), s, mode.rawValue) }
    }

    func testDecode() {
        let r = E.decode("&lt;b&gt; &copy; &#20013;&#x6587; &#X1F600; &hellip;")
        XCTAssertEqual(r.output, "<b> © 中文 😀 …")
        XCTAssertEqual(r.namedCount, 4)
        XCTAssertEqual(r.numericCount, 3)
        XCTAssertTrue(r.issues.isEmpty)

        let legacy = E.decode("&copy2024 &amp &lt;")
        XCTAssertEqual(legacy.output, "©2024 & <")
        XCTAssertEqual(legacy.issues.map { "\($0.isWarning)-\($0.column)" }, ["false-1", "false-11"])
        XCTAssertTrue(legacy.issues[0].message.zh.contains("缺少结尾分号"))

        XCTAssertEqual(dec("&notin; &notit; &not"), "∉ ¬it; ¬")
        XCTAssertEqual(dec("&ampersand"), "&ersand")
        XCTAssertEqual(dec("&hellip and &rarr"), "&hellip and &rarr")
    }

    func testNumericEdgeCases() {
        XCTAssertEqual(dec("&#128;&#x99;"), "€™")
        XCTAssertEqual(dec("&#0;"), "\u{FFFD}")
        XCTAssertEqual(dec("&#x110000;"), "\u{FFFD}")
        XCTAssertEqual(dec("&#xD800;"), "\u{FFFD}")
        XCTAssertEqual(dec("&#99999999999;"), "\u{FFFD}")
        XCTAssertEqual(dec("&#65&#x42"), "AB")
        XCTAssertEqual(E.decode("&#0; &#128;").issues.map(\.isWarning), [true, false])
        XCTAssertEqual(dec("&#x000000041;&#0000000065;&#x0000001F600;"), "AA😀")
        XCTAssertEqual(dec("&#00000000000;"), "\u{FFFD}")
        XCTAssertTrue(E.decode("&#x000000041;").issues.isEmpty)
    }

    func testUnknownReferences() {
        let r = E.decode("AT&T &foo; &#x; &#; & &Amp;\n&bogus;")
        XCTAssertEqual(r.output, "AT&T &foo; &#x; &#; & &Amp;\n&bogus;")
        let warnings = r.issues.filter(\.isWarning)
        XCTAssertEqual(warnings.map(\.text), ["&foo;", "&#x", "&#", "&Amp;", "&bogus;"])
        XCTAssertTrue(warnings[3].message.zh.contains("&amp;"))
        XCTAssertEqual(warnings[4].line, 2)
        XCTAssertEqual(warnings[4].column, 1)
    }

    func testDoubleEncodingAndTool() throws {
        let r = E.decode("&amp;lt;div&amp;gt;")
        XCTAssertEqual(r.output, "&lt;div&gt;")
        XCTAssertTrue(r.stillEncoded)
        XCTAssertFalse(E.decode("&amp;foo;").stillEncoded)
        XCTAssertFalse(E.decode("plain").stillEncoded)
        XCTAssertTrue(E.looksEncoded("&#x41;"))

        let tool = HTMLEntitiesTool.spec
        let d = try tool("&amp;lt;div&amp;gt; &foo;", options: ["mode": "decode"])
        XCTAssertEqual(d.primary?.value, "&lt;div&gt; &foo;")
        XCTAssertTrue(d.notes.contains { $0.message.contains("重复编码") })
        XCTAssertTrue(d.notes.contains { $0.level == .warning && $0.message.contains("第 1 行第 21 列") })
        let en = try tool("&foo;", options: ["mode": "decode"], lang: .en)
        XCTAssertTrue(en.notes.contains { $0.message.contains("Unknown entity &foo; kept as is") })
        XCTAssertEqual(try tool("中 <", options: ["scope": "hex"]).primary?.value, "&#x4E2D; &lt;")
        XCTAssertEqual(try tool("'", options: ["quotes": "0"]).primary?.value, "'")
    }

    func testLongInputPositions() {
        let r = E.decode(String(repeating: "😀&copy", count: 300))
        XCTAssertEqual(r.output, String(repeating: "😀©", count: 300))
        XCTAssertEqual(r.issues.count, 200)
        XCTAssertEqual(r.issues[0].column, 2)
        XCTAssertEqual(r.issues[0].text, "&copy")
        XCTAssertEqual(r.issues[1].column, 8)
        let big = String(repeating: "&lt;p&gt;中文 &copy; &#x1F600;&lt;/p&gt;\n", count: 5000)
        XCTAssertEqual(dec(big), String(repeating: "<p>中文 © 😀</p>\n", count: 5000))
    }
}
