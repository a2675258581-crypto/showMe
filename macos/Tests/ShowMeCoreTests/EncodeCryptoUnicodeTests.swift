import XCTest
@testable import ShowMeCore

/// 测试字符串里用「¥」代替反斜杠，避免源码中出现「反斜杠 + u + 4 位十六进制」被工具链误转
final class EncodeCryptoUnicodeTests: XCTestCase {
    typealias U = UnicodeEscape

    func b(_ s: String) -> String { s.replacingOccurrences(of: "¥", with: "\\") }
    func esc(_ s: String, _ f: U.Format, onlyNonASCII: Bool = true, upper: Bool = true) -> String {
        U.escape(s, format: f, onlyNonASCII: onlyNonASCII, uppercase: upper)
    }
    func un(_ s: String, simple: Bool = true, css: Bool = true) -> String { U.unescape(s, simple: simple, css: css).output }

    func testBackslashPlaceholderIsReal() {
        XCTAssertEqual(b("¥"), String(UnicodeScalar(0x5C)))
        XCTAssertEqual(b("¥u4E2D").unicodeScalars.count, 6)
    }

    func testEscapeEachFormat() {
        let cases: [(U.Format, String)] = [
            (.js, "A¥u4E2D¥uD83D¥uDE00"), (.es6, "A¥u{4E2D}¥u{1F600}"), (.python, "A¥u4E2D¥U0001F600"),
            (.htmlHex, "A&#x4E2D;&#x1F600;"), (.htmlDec, "A&#20013;&#128512;"), (.utf8Hex, "A¥xE4¥xB8¥xAD¥xF0¥x9F¥x98¥x80"),
            (.utf8URL, "A%E4%B8%AD%F0%9F%98%80"), (.codepoint, "AU+4E2D U+1F600"), (.css, "A¥4E2D¥1F600"),
            (.percentU, "A%u4E2D%uD83D%uDE00"),
        ]
        for (f, expected) in cases { XCTAssertEqual(esc("A中😀", f), b(expected), f.rawValue) }
        XCTAssertEqual(esc("中", .js, upper: false), b("¥u4e2d"))
        XCTAssertEqual(esc("中", .utf8URL, upper: false), "%e4%b8%ad")
        XCTAssertEqual(esc("中", .codepoint, upper: false), "U+4E2D")
        XCTAssertEqual(esc("Hi\n", .js, onlyNonASCII: false), b("¥u0048¥u0069¥u000A"))
        XCTAssertEqual(esc("Hi", .codepoint, onlyNonASCII: false), "U+0048 U+0069")
        XCTAssertEqual(esc("A", .css, onlyNonASCII: false), b("¥0041"))
        XCTAssertEqual(esc("A", .utf8URL, onlyNonASCII: false), "%41")
        XCTAssertEqual(esc("a\u{01}b\tc", .js), b("a¥u0001b\tc"))
        for f in U.Format.allCases { XCTAssertEqual(esc("", f), "") }
    }

    func testSeparatorsAndSelfEscapes() {
        XCTAssertEqual(esc("中a", .css), b("¥4E2D a"))
        XCTAssertEqual(esc("中 x", .css), b("¥4E2D  x"))
        XCTAssertEqual(esc("中文", .css), b("¥4E2D¥6587"))
        XCTAssertEqual(esc("中g", .css), b("¥4E2Dg"))
        XCTAssertEqual(esc("中文", .codepoint), "U+4E2D U+6587")
        XCTAssertEqual(esc("中a", .codepoint), "U+4E2D U+0061")
        XCTAssertEqual(esc("中x", .codepoint), "U+4E2Dx")
        XCTAssertEqual(esc("中, 文", .codepoint), "U+4E2D U+002C U+0020 U+6587")
        XCTAssertEqual(esc(b("C:¥路径"), .js), b("C:¥¥¥u8DEF¥u5F84"))
        XCTAssertEqual(esc("100% 中", .utf8URL), "100%25 %E4%B8%AD")
        XCTAssertEqual(esc("50% off & more, U+ sign", .htmlHex), "50% off & more, U+ sign")
        XCTAssertEqual(esc("%41", .js), b("¥u002541"))
        XCTAssertEqual(esc("&#65;", .htmlDec), "&#38;#65;")
        XCTAssertEqual(esc("U+0041", .codepoint), "U+0055+0041")
        XCTAssertEqual(esc(b("a¥nb"), .htmlHex), "a&#x5C;nb")
        XCTAssertEqual(esc(b("a¥qb"), .htmlHex), b("a¥qb"))
    }

    func testUnescapeEachFormat() {
        XCTAssertEqual(un(b("¥u4e2d¥u6587")), "中文")
        XCTAssertEqual(un(b("¥uD83D¥uDE00")), "😀")
        XCTAssertEqual(un(b("¥u{1F600}¥u{4E2D}")), "😀中")
        XCTAssertEqual(un(b("¥U0001F600")), "😀")
        XCTAssertEqual(un(b("¥x{4E2D}")), "中")
        XCTAssertEqual(un("&#x4E2D;&#20013;&#x1f600"), "中中😀")
        XCTAssertEqual(un(b("¥xE4¥xB8¥xAD")), "中")
        XCTAssertEqual(un("%E4%B8%AD%20ok"), "中 ok")
        XCTAssertEqual(un("U+4E2D U+6587, U+1F600"), "中文😀")
        XCTAssertEqual(un(b("¥4E2D¥6587 a")), "中文a")
        XCTAssertEqual(un("%u4E2D%uD83D%uDE00"), "中😀")
    }

    func testMixedAndCounts() {
        let r = U.unescape(b("¥u4e2d¥u{6587}&#x1F600;%E4%B8%AD¥xE6¥x96¥x87U+4E2D¥U0001F600¥4E2D¥n"))
        XCTAssertEqual(r.output, "中文😀中文中😀中\n")
        XCTAssertEqual(r.counts, [.js: 1, .es6: 1, .htmlHex: 1, .utf8URL: 3, .utf8Hex: 3, .codepoint: 1, .python: 1, .css: 1, .simple: 1])
        XCTAssertTrue(r.issues.isEmpty)
    }

    func testSimpleEscapes() {
        XCTAssertEqual(un(b("a¥nb¥t¥\"c¥\"")), "a\nb\t\"c\"")
        XCTAssertEqual(un(b("¥¥u4e2d")), b("¥u4e2d"))
        XCTAssertEqual(un(b("a¥nb"), simple: false), b("a¥nb"))
        XCTAssertEqual(un(b("¥q")), b("¥q"))
        XCTAssertEqual(un(b("¥face"), css: false), "\u{0C}ace")
        XCTAssertEqual(un(b("¥face")), "\u{FACE}")
    }

    func testIssues() {
        let lone = U.unescape(b("x¥uD83D!"))
        XCTAssertEqual(lone.output, "x\u{FFFD}!")
        XCTAssertEqual(lone.issues.first?.column, 2)
        XCTAssertEqual(lone.issues.first?.text, b("¥uD83D"))
        let latin1 = U.unescape(b("caf¥xE9"))
        XCTAssertEqual(latin1.output, "café")
        XCTAssertTrue(latin1.issues[0].message.zh.contains("Latin-1"))
        let pct = U.unescape("bad %E4%B8 here")
        XCTAssertEqual(pct.output, "bad %E4%B8 here")
        XCTAssertEqual(pct.issues[0].column, 5)
        XCTAssertEqual(pct.issues[0].text, "%E4%B8")
        let big = U.unescape(b("¥u{110000}"))
        XCTAssertEqual(big.output, b("¥u{110000}"))
        XCTAssertTrue(big.issues[0].message.zh.contains("超出 Unicode 范围"))
        XCTAssertEqual(un("&#0;"), "\u{FFFD}")
        let s = b("普通文本 100% OK U+12 ¥u12 & #1 &#; ¥x4")
        XCTAssertEqual(un(s), s)
        XCTAssertEqual(un(""), "")
        XCTAssertEqual(un("&#0000000065;&#x0000001F600;"), "A😀")
        XCTAssertEqual(un(b("¥u{0000000041}¥x{00000000042}")), "AB")
        let r = U.unescape("&#x00000000110000;")
        XCTAssertEqual(r.output, "&#x00000000110000;")
        XCTAssertTrue(r.issues[0].message.zh.contains("&#x00000000110000;"))
        let ff = U.unescape(String(repeating: b("¥xFF"), count: 50_000))
        XCTAssertEqual(ff.output, String(repeating: "\u{FF}", count: 50_000))
        XCTAssertEqual(ff.issues.count, 1)
        let many = U.unescape(String(repeating: b("😀¥uD800"), count: 300))
        XCTAssertEqual(many.issues.count, 200)
        XCTAssertEqual(many.issues[0].column, 2)
        XCTAssertEqual(many.issues[1].column, 9)
    }

    func testRoundTrips() {
        let tricky = [
            "Hello, 世界!", "😀 👨\u{200D}👩\u{200D}👧 🇨🇳 e\u{301}", b("C:¥Users¥张三¥文档"), "100% 完成 %zz", "tab\tnew\nline",
            "中a中F中 中\t", "ABC def 123 中文",
            "100%41 and %E4%B8%AD 中", "&#65; &#x4E2D; &amp; 中", "U+0041 u+4e2d U+ 中",
            b("C:¥new¥table ¥u4E2D ¥x41 ¥5FEB 中"), b("mixed %41&#66;U+0043¥x44 😀 end"), "%u4E2D literal 中",
        ]
        for f in U.Format.allCases {
            for s in tricky {
                for only in [true, false] {
                    for upper in [true, false] {
                        let e = esc(s, f, onlyNonASCII: only, upper: upper)
                        XCTAssertEqual(un(e), s, "\(f.rawValue) \(only) \(upper): \(e)")
                    }
                }
            }
        }
    }

    func testLargeInput() {
        let s = String(repeating: "中文 test 😀\n", count: 20_000)
        XCTAssertEqual(un(esc(s, .js)), s)
    }

    func testToolAndInspector() throws {
        let tool = UnicodeEscapeTool.spec
        XCTAssertEqual(try tool("中", options: ["format": "es6"]).primary?.value, b("¥u{4E2D}"))
        let r = try tool(b("¥u4e2d&#20013;"), options: ["mode": "unescape"])
        XCTAssertEqual(r.primary?.value, "中中")
        XCTAssertTrue(r.notes[0].message.hasPrefix("识别到："))
        let en = try tool("plain", options: ["mode": "unescape"], lang: .en)
        XCTAssertEqual(en.notes[0].message, "No escapes were found")
        let inspect = try tool("a中😀\n", options: ["mode": "inspect"])
        let rows = inspect.table?.rows ?? []
        XCTAssertEqual(rows.map { $0[2] }, ["U+0061", "U+4E2D", "U+1F600", "U+000A"])
        XCTAssertEqual(rows[2][3], "F0 9F 98 80")
        XCTAssertEqual(rows[2][4], "D83D DE00")
        XCTAssertEqual(rows[1][5], "汉字")
        XCTAssertEqual(rows[2][5], "Emoji")
        XCTAssertEqual(rows[3][1], "\u{240A}")
        XCTAssertTrue(rows[3][5].contains("换行 LF"))
        XCTAssertTrue(inspect.notes[0].message.hasPrefix("4 个码点"))
    }
}
