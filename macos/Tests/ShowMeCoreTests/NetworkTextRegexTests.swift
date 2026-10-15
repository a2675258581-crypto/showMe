import XCTest
@testable import ShowMeCore

final class NetworkTextRegexTests: XCTestCase {
    func re(_ p: String, _ flags: RegexTester.Flags = .init()) throws -> NSRegularExpression {
        try RegexTester.compile(p, flags: flags, lang: .zh)
    }

    func errorMessage(_ p: String, lang: Lang = .zh) -> String? {
        do {
            _ = try RegexTester.compile(p, flags: .init(), lang: lang)
            return nil
        } catch {
            return (error as? ToolError)?.message
        }
    }

    func testCompileErrors() throws {
        XCTAssertNoThrow(try re("\\d+"))
        XCTAssertNoThrow(try re(""))
        let cases: [(String, String)] = [
            ("(abc", "分组没有闭合"),
            ("abc)", "多余的 )"),
            ("*a", "量词前面没有可重复的内容"),
            ("a**", "量词前面没有可重复的内容"),
            ("[abc", "字符集没有闭合"),
            ("a{3,1}", "m 不能大于 n"),
            ("\\", "单独的 \\"),
            ("\\k", "不完整"),
            ("\\p{L", "缺少结尾的 }"),
        ]
        for (p, msg) in cases {
            let m = errorMessage(p)
            XCTAssertNotNil(m, p)
            XCTAssertTrue(m?.hasPrefix("正则表达式无效：") ?? false, p)
            XCTAssertTrue(m?.contains(msg) ?? false, "\(p): \(m ?? "nil")")
        }
        XCTAssertEqual(errorMessage("(abc", lang: .en), "Invalid regular expression: Unclosed group: missing )")
        // 合法的量词组合
        XCTAssertNoThrow(try re("a*?b+?c??d{2}?e*+"))
        XCTAssertNoThrow(try re("(?<name>x)\\k<name>\\p{Script=Han}[a-z[0-9]]"))
    }

    func testCaptureGroups() {
        let g = RegexTester.captureGroups("(a)(?:b)(?<name>c)(?=d)(?<!e)\\(f\\)[(](g)")
        XCTAssertEqual(g.map(\.index), [1, 2, 3])
        XCTAssertEqual(g.map(\.name), [nil, "name", nil])
        XCTAssertEqual(RegexTester.captureGroups(""), [])
        XCTAssertEqual(RegexTester.captureGroups("\\Q(x)\\E(y)").count, 1)
    }

    func testMatches() throws {
        let r = RegexTester.matches(try re("(?<user>\\w+)@(\\w+)"), in: "a@b, 中文 c@d")
        XCTAssertEqual(r.matches.count, 2)
        XCTAssertFalse(r.truncated)
        let m = r.matches[1]
        XCTAssertEqual(m.text, "c@d")
        XCTAssertEqual(m.range, NSRange(location: 8, length: 3))
        XCTAssertEqual(m.groups.map(\.name), ["user", nil])
        XCTAssertEqual(m.groups.map(\.value), ["c", "d"])
        XCTAssertEqual(m.start.line, 1)
        XCTAssertEqual(m.start.column, 9)

        let opt = RegexTester.matches(try re("(a)?(c)"), in: "c").matches[0].groups
        XCTAssertNil(opt[0].value)
        XCTAssertNil(opt[0].range)
        XCTAssertEqual(opt[1].value, "c")

        XCTAssertEqual(RegexTester.matches(try re(""), in: "ab").matches.map(\.range.location), [0, 1, 2])
        XCTAssertEqual(RegexTester.matches(try re("x*"), in: "axxb").matches.map(\.text), ["", "xx", "", ""])
        let han = RegexTester.matches(try re("\\p{Script=Han}+"), in: "Hello 世界！正则 regex，𠮷野家").matches
        XCTAssertEqual(han.map(\.text), ["世界", "正则", "𠮷野家"])
        // 行列：第二行，emoji 按一个字符计
        let lines = RegexTester.matches(try re("x"), in: "ab\n😀x\nx").matches
        XCTAssertEqual(lines.map { "\($0.start.line):\($0.start.column)" }, ["2:2", "3:1"])
        XCTAssertEqual(lines[0].end.column, 3)

        let many = RegexTester.matches(try re("a"), in: String(repeating: "a", count: 5000), limit: 10)
        XCTAssertEqual(many.matches.count, 10)
        XCTAssertTrue(many.truncated)
    }

    func testFlags() throws {
        XCTAssertEqual(RegexTester.matches(try re("^b", .init(multiline: true)), in: "a\nb").matches.count, 1)
        XCTAssertEqual(RegexTester.matches(try re("^b"), in: "a\nb").matches.count, 0)
        XCTAssertEqual(RegexTester.matches(try re("A", .init(ignoreCase: true)), in: "a").matches.count, 1)
        XCTAssertEqual(RegexTester.matches(try re("a.b", .init(dotAll: true)), in: "a\nb").matches.count, 1)
        XCTAssertEqual(RegexTester.matches(try re("a b # 注释", .init(extended: true)), in: "ab").matches.count, 1)
        let js = RegexTester.Flags(js: "gim")
        XCTAssertTrue(js.ignoreCase && js.multiline && !js.dotAll)
    }

    func testReplacementTemplates() throws {
        let text = "John Smith, Jane Doe"
        let regex = try re("(?<first>\\w+) (\\w+)")
        let cases: [(String, String)] = [
            ("$2 $1", "Smith John, Doe Jane"), ("$<first>!", "John!, Jane!"), ("[$&]", "[John Smith], [Jane Doe]"),
            ("$$", "$, $"), ("$`|", "|, John Smith, |"), ("|$'", "|, Jane Doe, |"), ("$0", "$0, $0"), ("$3", "$3, $3"),
            ("$10", "John0, Jane0"), ("$01", "John, Jane"), ("$<missing>", ", "), ("$<unclosed", "$<unclosed, $<unclosed"),
            ("$", "$, $"), ("plain", "plain, plain"), ("中文 $2 😀", "中文 Smith 😀, 中文 Doe 😀"),
        ]
        for (tpl, expected) in cases {
            XCTAssertEqual(RegexTester.replace(regex, in: text, template: tpl).output, expected, tpl)
        }
        let ba = try re("(b)(a)")
        for (tpl, expected) in [("[$`]", "foo [foo ]r [foo bar ]z"), ("[$']", "foo [r baz]r [z]z"), ("$<x>", "foo $<x>r $<x>z"), ("$$&", "foo $&r $&z")] {
            XCTAssertEqual(RegexTester.replace(ba, in: "foo bar baz", template: tpl).output, expected, tpl)
        }
        let digits = RegexTester.replace(try re("\\d+"), in: "a1b22c", template: "<$&>")
        XCTAssertEqual(digits.output, "a<1>b<22>c")
        XCTAssertEqual(digits.count, 2)
        XCTAssertEqual(RegexTester.replace(try re("\\B(?=(?:\\d{3})+(?!\\d))"), in: "1234567", template: ",").output, "1,234,567")
    }

    func testPresets() throws {
        XCTAssertEqual(RegexTester.presets.count, 28)
        XCTAssertEqual(Set(RegexTester.presets.map(\.id)).count, 28)
        // 每个预设都能被 ICU 编译，并且在自带的示例上有匹配
        for p in RegexTester.presets {
            let regex = try RegexTester.compile(p.pattern, flags: RegexTester.Flags(js: p.flags), lang: .en)
            XCTAssertFalse(RegexTester.matches(regex, in: p.sample).matches.isEmpty, p.id)
            XCTAssertFalse(p.name.en.isEmpty)
        }
        let mobile = try RegexTesterTool.spec("13800138000\n12345678901\n19912345678", options: ["preset": "cn-mobile"])
        XCTAssertEqual(mobile.primary?.value, "13800138000\n19912345678")
        let date = try RegexTesterTool.spec("发布日期：2024-01-31，更新于 2024-12-25。", options: ["preset": "date-format", "mode": "replace", "replacement": "$<d>/$<m>/$<y>"])
        XCTAssertEqual(date.primary?.value, "发布日期：31/01/2024，更新于 25/12/2024。")
    }

    func testCatastrophicBacktrackingTimesOut() throws {
        let regex = try re("(a+)+$")
        let text = String(repeating: "a", count: 40) + "b"
        let r = RegexTester.matches(regex, in: text, timeLimit: 0.2)
        XCTAssertTrue(r.timedOut)
        XCTAssertTrue(RegexTester.replace(regex, in: text, template: "x", timeLimit: 0.2).timedOut)
    }

    func testTool() throws {
        let tool = RegexTesterTool.spec
        let r = try tool("联系 support@showme.dev 或 a.b@x.cn", options: ["pattern": "(?<user>[\\w.]+)@(?<domain>[\\w.]+)"])
        XCTAssertEqual(r.primary?.value, "support@showme.dev\na.b@x.cn")
        XCTAssertEqual(r.table?.columns, ["#", "位置", "匹配", "分组"])
        XCTAssertEqual(r.table?.rows.first, ["1", "1:4–1:22", "support@showme.dev", "1 user = support · 2 domain = showme.dev"])
        XCTAssertEqual(r.notes.first?.message, "共 2 处匹配")
        let en = try tool("a\nb", options: ["pattern": "^", "mode": "replace", "replacement": "> ", "m": "1"], lang: .en)
        XCTAssertEqual(en.primary?.value, "> a\n> b")
        XCTAssertEqual(en.notes.first?.message, "Replaced 2 matches")
        XCTAssertEqual(en.table?.columns, ["#", "Range", "Match", "Groups"])
        let none = try tool("abc", options: ["pattern": "x"], lang: .en)
        XCTAssertEqual(none.notes.first?.message, "No matches")
        XCTAssertNil(none.table)
        let capped = try tool(String(repeating: "a", count: 3000), options: ["pattern": "a"])
        XCTAssertEqual(capped.table?.rows.count, RegexTester.matchLimit)
        XCTAssertEqual(capped.notes.first?.message, "共 1000+ 处匹配")
        XCTAssertTrue(capped.notes.contains { $0.level == .warning })
        XCTAssertThrowsError(try tool("x", options: ["pattern": "(a"], lang: .en)) { e in
            XCTAssertEqual((e as? ToolError)?.message, "Invalid regular expression: Unclosed group: missing )")
        }
        XCTAssertThrowsError(try tool("x", options: [:]))
        let multiline = try tool("a\tb\nc", options: ["pattern": "a\\s+b\\s+c"])
        XCTAssertEqual(multiline.table?.rows.first?[2], "a\\tb\\nc")
    }
}
