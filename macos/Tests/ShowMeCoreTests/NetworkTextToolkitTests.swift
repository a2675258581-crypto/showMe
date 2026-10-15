import XCTest
@testable import ShowMeCore

final class NetworkTextToolkitTests: XCTestCase {
    typealias T = TextToolkit

    func testStats() {
        XCTAssertEqual(T.stats(""), T.Stats())
        let s = T.stats("你好，world! 👨‍👩‍👧\n\nSecond paragraph 第二段")
        XCTAssertEqual(s.cjk, 5)
        XCTAssertEqual(s.words, 3)
        XCTAssertEqual(s.lines, 3)
        XCTAssertEqual(s.paragraphs, 2)
        XCTAssertEqual(s.chars, 33)
        XCTAssertEqual(s.charsNoSpace, s.chars - 5)
        for t in ["abc", "中文", "é", "😀", "mixed 中 😀 text"] { XCTAssertEqual(T.stats(t).bytes, t.utf8.count) }
        XCTAssertEqual(T.countWords("don't stop well-known 42 things"), 4)
        XCTAssertEqual(T.countLines("a"), 1)
        XCTAssertEqual(T.countLines("a\nb\n"), 3)
        XCTAssertEqual(T.countParagraphs("a\nb\n\n\nc\n  \nd"), 3)
        XCTAssertEqual(T.countParagraphs("\n\n"), 0)
        XCTAssertEqual(T.readingSeconds(cjk: 300, words: 0), 60)
        XCTAssertEqual(T.readingSeconds(cjk: 0, words: 100), 30)
        XCTAssertEqual(T.formatReadingTime(0, .zh), "0 秒")
        XCTAssertEqual(T.formatReadingTime(42, .zh), "42 秒")
        XCTAssertEqual(T.formatReadingTime(150, .zh), "约 3 分钟")
        XCTAssertEqual(T.formatReadingTime(4200, .zh), "约 1 小时 10 分钟")
        XCTAssertEqual(T.formatReadingTime(4200, .en), "about 1 h 10 min")
        // 组合字符、CRLF、国旗都算一个字符
        XCTAssertEqual(T.stats("e\u{301}\r\n🇨🇳👍🏽").chars, 4)
        XCTAssertEqual(T.stats("\u{A0}\u{2003}\u{3000}\u{FEFF}\u{2028}x").charsNoSpace, 1)
        let big = String(repeating: "中文 English 😀\n", count: 50_000)
        let start = Date()
        let b = T.stats(big)
        XCTAssertLessThan(Date().timeIntervalSince(start), 10)
        XCTAssertEqual(b.cjk, 100_000)
        XCTAssertEqual(b.words, 50_000)
        XCTAssertEqual(b.lines, 50_001)
    }

    func testDedupe() {
        XCTAssertEqual(T.splitLines("a\r\nb\rc\nd"), ["a", "b", "c", "d"])
        let r = T.dedupe("b\na\nb\nc\na")
        XCTAssertEqual(r.output, "b\na\nc")
        XCTAssertEqual(r.info, "删除了 2 行重复")
        XCTAssertEqual(T.dedupe("b\na\nb", lang: .en).info, "Removed 1 duplicate lines")
        XCTAssertEqual(T.dedupe("Apple\napple\nAPPLE ", ignoreCase: true).output, "Apple\nAPPLE ")
        XCTAssertEqual(T.dedupe("Apple\napple\nAPPLE ", ignoreCase: true, trimmed: true).output, "Apple")
        XCTAssertEqual(T.dedupe("a\n\na\n\nb", keepEmpty: true).output, "a\n\n\nb")
        XCTAssertEqual(T.dedupe("a\n\na\n\nb").output, "a\n\nb")
        XCTAssertEqual(T.dedupe("你好\n😀\n你好\n😀").output, "你好\n😀")
        XCTAssertEqual(T.dedupe("").output, "")
    }

    func testSort() {
        XCTAssertEqual(T.sort("banana\napple\ncherry", mode: .asc).output, "apple\nbanana\ncherry")
        XCTAssertEqual(T.sort("banana\napple\ncherry", mode: .desc).output, "cherry\nbanana\napple")
        XCTAssertEqual(T.sort("张三\n李四\n王五\n阿明", mode: .asc).output, "阿明\n李四\n王五\n张三")
        XCTAssertEqual(T.sort("item10\nitem2\nitem1", mode: .asc).output, "item1\nitem10\nitem2")
        XCTAssertEqual(T.sort("item10\nitem2\nitem1", mode: .natural).output, "item1\nitem2\nitem10")
        XCTAssertEqual(T.sort("file 20.txt\nfile 3.txt\nFile 1.txt", mode: .natural).output, "File 1.txt\nfile 3.txt\nfile 20.txt")
        XCTAssertEqual(T.sort("ccc\na\nbb\nx\n👨‍👩‍👧👨‍👩‍👧", mode: .length).output, "a\nx\nbb\n👨‍👩‍👧👨‍👩‍👧\nccc")
        XCTAssertEqual(T.sort("1\n2\n3", mode: .reverse).output, "3\n2\n1")
        let input = (0..<20).map { "line \($0)" }.joined(separator: "\n")
        let seeded: (Int) -> [UInt8] = { n in (0..<n).map { UInt8(truncatingIfNeeded: $0 &* 37 &+ 11) } }
        let a = T.sort(input, mode: .shuffle, random: seeded).output
        XCTAssertEqual(a, T.sort(input, mode: .shuffle, random: seeded).output)
        XCTAssertNotEqual(a, input)
        XCTAssertEqual(a.split(separator: "\n").sorted(), input.split(separator: "\n").sorted())
        XCTAssertEqual(T.sort("b\na", mode: .asc, lang: .en).info, "Ascending: 2 lines")
    }

    func testWhitespace() {
        let r = T.removeEmptyLines("a\n\n  \n\tb\n\u{3000}\nc")
        XCTAssertEqual(r.output, "a\n\tb\nc")
        XCTAssertEqual(r.info, "删除了 3 个空行")
        XCTAssertEqual(T.trimLines("  a  \n\u{3000}中文\u{3000}\nb").output, "a\n中文\nb")
        XCTAssertEqual(T.collapseSpaces("a   b\t\tc\n  d\u{3000}\u{3000}e").output, "a b c\n d e")
        XCTAssertEqual(T.collapseSpaces("a b").info, "没有连续空白")
        XCTAssertEqual(T.collapseSpaces("a\tb").output, "a b")
    }

    func testLineNumbers() {
        let text = (0..<10).map { String(UnicodeScalar(UInt8(97 + $0))) }.joined(separator: "\n")
        XCTAssertEqual(T.addLineNumbers("a\nb").output, "1. a\n2. b")
        XCTAssertEqual(T.addLineNumbers(text, separator: " | ", pad: true).output.split(separator: "\n").first, " 1 | a")
        XCTAssertEqual(T.addLineNumbers("a\n\nb", start: 5, numberEmpty: false).output, "5. a\n\n6. b")
        XCTAssertEqual(T.removeLineNumbers("1. a\n2) b\n3、c\n(4) d\n[5] e\n  6\tf\n7: g\n10 - h\nplain").output, "a\nb\nc\nd\ne\nf\ng\nh\nplain")
        let src = "alpha\nbeta\n中文 😀"
        for sep in [". ", "、", ") ", ": ", " | ", "\t", " "] {
            for pad in [false, true] {
                XCTAssertEqual(T.removeLineNumbers(T.addLineNumbers(src, start: 9, separator: sep, pad: pad).output).output, src, sep)
            }
        }
        let content = "3.14 是圆周率\n12:30 开会\n2024-01-01 元旦\n42\n1.2.3 版本"
        XCTAssertEqual(T.removeLineNumbers(content).output, content)
        XCTAssertEqual(T.removeLineNumbers(content).info, "没有识别到行号")
        XCTAssertEqual(T.removeLineNumbers("（1）全角括号\n1．全角点").output, "全角括号\n全角点")
        XCTAssertEqual(T.addPrefixSuffix("a\n\nb", prefix: "- ", suffix: ";").output, "- a;\n\n- b;")
        XCTAssertEqual(T.addPrefixSuffix("a\n\nb", prefix: ">", suffix: "", skipEmpty: false).output, ">a\n>\n>b")
    }

    func testWidthAndCase() {
        XCTAssertEqual(T.toHalfWidth("ＡＢＣ１２３！＠\u{3000}ｘ").output, "ABC123!@ x")
        XCTAssertEqual(T.toHalfWidth("你好，世界。").output, "你好,世界。")
        XCTAssertEqual(T.toFullWidth("Hi 1!").output, "Ｈｉ\u{3000}１！")
        let s = "Hello, World! 123 ~"
        XCTAssertEqual(T.toHalfWidth(T.toFullWidth(s).output).output, s)
        XCTAssertEqual(T.toHalfWidth("abc", lang: .en).info, "No full-width characters")
        XCTAssertEqual(T.changeCase("Hello wORLD", .upper), "HELLO WORLD")
        XCTAssertEqual(T.changeCase("Hello wORLD", .lower), "hello world")
        XCTAssertEqual(T.changeCase("hello wORLD, don't panic 中文", .title), "Hello World, Don't Panic 中文")
        XCTAssertEqual(T.changeCase("HELLO. how ARE you? fine", .sentence), "Hello. How are you? Fine")
        XCTAssertEqual(T.changeCase("first\nsecond line", .sentence), "First\nSecond line")
    }

    static let extractText = """
    联系 alice@example.com 或 Bob.Smith+tag@mail.co.uk，重复 alice@example.com。
    网址 https://example.com/path?q=1&x=2，以及 http://中文.cn/页面 (http://foo.org/bar)。
    价格 -12.5 元，数量 1,000，编号 A42，科学计数 6.02e23
    电话 13800138000、+86 139-1234-5678、12345678901、1380013800012
    IP 192.168.1.1、10.0.0.255，无效 256.1.1.1、1.2.3.4.5；IPv6 2001:db8::1 和 ::1，std::vector 不是
    """

    func testExtract() {
        let t = Self.extractText
        XCTAssertEqual(T.extract(t, kind: .email).output, "alice@example.com\nBob.Smith+tag@mail.co.uk")
        XCTAssertEqual(T.extract(t, kind: .email, unique: false).output.split(separator: "\n").count, 3)
        XCTAssertEqual(T.extract(t, kind: .url).output.split(separator: "\n"), ["https://example.com/path?q=1&x=2", "http://中文.cn/页面", "http://foo.org/bar"])
        let nums = T.extract(t, kind: .number, unique: false).output.split(separator: "\n").map(String.init)
        for n in ["-12.5", "1,000", "42", "6.02e23"] { XCTAssertTrue(nums.contains(n), n) }
        XCTAssertEqual(T.extract("服务器 192.168.1.10 版本 v1.2.3，价格 3.5 元，结尾 7.", kind: .number).output, "3.5\n7")
        XCTAssertEqual(T.extract(t, kind: .phone).output, "13800138000\n13912345678")
        XCTAssertEqual(T.extract(t, kind: .ip).output.split(separator: "\n"), ["192.168.1.1", "10.0.0.255", "2001:db8::1", "::1"])
        XCTAssertEqual(T.extract("", kind: .email).info, "没有找到邮箱")
        XCTAssertEqual(T.extract("a@b.cn", kind: .email, lang: .en).info, "Found 1 emails")
    }

    func testFindReplace() throws {
        let r = try T.findReplace("a.b A.B a+b", find: "a.b", replacement: "X")
        XCTAssertEqual(r.output, "X X a+b")
        XCTAssertEqual(r.info, "替换了 2 处")
        XCTAssertEqual(try T.findReplace("a.b A.B", find: "a.b", replacement: "X", caseSensitive: true).output, "X A.B")
        XCTAssertEqual(try T.findReplace("cost", find: "cost", replacement: "$1 $&").output, "$1 $&")
        XCTAssertEqual(try T.findReplace("2024-01-31", find: "(\\d+)-(\\d+)-(\\d+)", replacement: "$3/$2/$1", regex: true).output, "31/01/2024")
        XCTAssertEqual(try T.findReplace("2024-01-31", find: "(?<y>\\d+)-(?<m>\\d+)", replacement: "$<m>.$<y> [$&] $$", regex: true).output, "01.2024 [2024-01] $-31")
        XCTAssertEqual(try T.findReplace("a\nb", find: "^", replacement: "> ", regex: true).output, "> a\n> b")
        XCTAssertEqual(try T.findReplace("我爱😀我爱", find: "😀", replacement: "🎉").output, "我爱🎉我爱")
        XCTAssertEqual(try T.findReplace("abc", find: "", replacement: "x").info, "请输入要查找的内容")
        XCTAssertThrowsError(try T.findReplace("abc", find: "(", replacement: "x", regex: true)) { e in
            XCTAssertTrue((e as? ToolError)?.message.hasPrefix("正则表达式无效：分组没有闭合") ?? false)
        }
        XCTAssertThrowsError(try T.findReplace("abc", find: "(", replacement: "x", regex: true, lang: .en)) { e in
            XCTAssertEqual((e as? ToolError)?.message, "Invalid regular expression: Unclosed group: missing )")
        }
    }

    func testLists() {
        XCTAssertEqual(T.linesToList(" a \nb\n\nO'Neil", quote: .single, separator: ", ", wrap: .paren).output, "('a', 'b', 'O''Neil')")
        XCTAssertEqual(T.linesToList("x\ny\nx\nsay \"hi\"", quote: .double, wrap: .bracket, unique: true).output, #"["x", "y", "say \"hi\""]"#)
        XCTAssertEqual(T.linesToList("a\nb", separator: ",").output, "a,b")
        XCTAssertEqual(T.listToLines("('a', 'b, c', 'O''Neil')").output, "a\nb, c\nO'Neil")
        XCTAssertEqual(T.listToLines(#"["x", "y\"z"]"#).output, "x\ny\"z")
        XCTAssertEqual(T.listToLines("苹果，香蕉, 橘子").output, "苹果\n香蕉\n橘子")
        XCTAssertEqual(T.listToLines("a|b|c", separator: "|").output, "a\nb\nc")
        XCTAssertEqual(T.listToLines("  ").output, "")
        let src = "alpha\nbe'ta\n中文 😀"
        XCTAssertEqual(T.listToLines(T.linesToList(src, quote: .single).output).output, src)
    }

    func testTool() throws {
        let tool = TextToolkitTool.spec
        let stats = try tool("你好 world\n第二行")
        XCTAssertNil(stats.primary)
        XCTAssertEqual(stats.outputs.first { $0.id == "cjk" }?.value, "5")
        XCTAssertEqual(stats.outputs.first { $0.id == "lines" }?.value, "2")
        let en = try tool("", lang: .en)
        XCTAssertEqual(en.outputs.first { $0.id == "reading" }?.value, "0 s")
        XCTAssertEqual(en.outputs.first?.label, "Characters")
        XCTAssertEqual(try tool("b\na\nb", options: ["op": "dedupe"]).primary?.value, "b\na")
        XCTAssertEqual(try tool("b\na", options: ["op": "sort", "sortMode": "desc"]).primary?.value, "b\na")
        XCTAssertEqual(try tool("a\nb", options: ["op": "addNumbers"]).primary?.value, "1. a\n2. b")
        XCTAssertEqual(try tool("a\nb", options: ["op": "join"]).primary?.value, "('a', 'b')")
        XCTAssertEqual(try tool("hello", options: ["op": "case", "caseMode": "title"]).primary?.value, "Hello")
        XCTAssertEqual(try tool("a b", options: ["op": "replace", "find": "a", "replaceWith": "x"], lang: .en).notes.first?.message, "Replaced 1 matches")
        let shuffled = try tool("1\n2\n3\n4\n5", options: ["op": "sort", "sortMode": "shuffle"])
        XCTAssertEqual(shuffled.primary?.value.split(separator: "\n").sorted(), ["1", "2", "3", "4", "5"])
        let visible = tool.fields.filter { $0.visibleWhen?.isSatisfied(by: ["op": "join"], defaults: tool.defaults) ?? true }
        XCTAssertLessThanOrEqual(visible.count, 6)
    }

    // MARK: Markdown

    struct FakeEngine: ScriptEngine {
        func call(_ function: String, _ args: [String: String]) throws -> String {
            guard function == "markdown" else { throw ScriptError(message: "unknown \(function)") }
            if args["code"] == "boom" { throw ScriptError(message: "解析失败", line: 3, column: 2) }
            XCTAssertEqual(args["gfm"], "1")
            XCTAssertEqual(args["breaks"], "0")
            return "<h1 id=\"t\">标题 &amp; <em>副标题</em></h1>\n<p>" + (args["code"] ?? "") + "</p>\n"
        }
    }

    func testMarkdown() throws {
        let saved = ToolEnvironment.script
        defer { ToolEnvironment.script = saved }
        ToolEnvironment.script = nil
        XCTAssertThrowsError(try MarkdownPreviewTool.spec("# x", lang: .en)) { e in
            XCTAssertEqual((e as? ToolError)?.message, "The formatting engine is unavailable")
        }
        ToolEnvironment.script = FakeEngine()
        let r = try MarkdownPreviewTool.spec("hello 世界 [链接](https://a.dev)")
        XCTAssertEqual(r.primary?.language, "html")
        XCTAssertEqual(r.primary?.value, "<h1 id=\"t\">标题 &amp; <em>副标题</em></h1>\n<p>hello 世界 [链接](https://a.dev)</p>\n")
        XCTAssertEqual(r.notes.first?.message, "5 字 · 1 行 · 预计阅读 不到 1 分钟")
        let full = try MarkdownPreviewTool.spec("x", options: ["export": "1"], lang: .en)
        let html = try XCTUnwrap(full.primary?.value)
        XCTAssertTrue(html.hasPrefix("<!doctype html>\n<html lang=\"en\">"))
        XCTAssertTrue(html.contains("<title>标题 &amp; 副标题</title>"))
        XCTAssertTrue(html.contains("<article class=\"markdown-body\">\n<h1 id=\"t\">"))
        XCTAssertTrue(html.contains(".markdown-body{max-width:860px"))
        XCTAssertThrowsError(try MarkdownPreviewTool.spec("boom")) { e in
            XCTAssertEqual((e as? ToolError)?.line, 3)
        }
        XCTAssertEqual(MarkdownPreviewTool.documentTitle(html: "<p>x</p><h3>小节</h3>", fallback: "文档"), "小节")
        XCTAssertEqual(MarkdownPreviewTool.documentTitle(html: "<p>x</p>", fallback: "文档"), "文档")
        XCTAssertEqual(MarkdownPreviewTool.htmlToText("a &lt;b&gt; &#x4E2D;&#25991; &unknown;"), "a <b> 中文 &unknown;")
        XCTAssertEqual(MarkdownPreviewTool.stats("中文 words ![图](https://x/y.png) <b>t</b>\n```js\ncode\n```").words, 6)
    }

    func testRegistryEntries() {
        let ids = NetworkTextTools.all.map(\.id)
        XCTAssertEqual(ids, ["curl-converter", "http-status", "cidr-calculator", "text-diff", "regex-tester", "markdown-preview", "text-toolkit"])
        for spec in NetworkTextTools.all {
            XCTAssertNotNil(ToolRegistry.tool(spec.id))
            XCTAssertFalse(spec.name.zh.isEmpty)
            XCTAssertFalse(spec.name.en.isEmpty)
            XCTAssertFalse(spec.summary.en.isEmpty)
            XCTAssertEqual(Set(spec.fields.map(\.id)).count, spec.fields.count, spec.id)
            for f in spec.fields {
                XCTAssertFalse(f.label.en.isEmpty)
                if case .choice(let choices) = f.kind {
                    XCTAssertTrue(choices.contains { $0.value == f.defaultValue }, "\(spec.id).\(f.id)")
                }
            }
        }
        XCTAssertEqual(ToolRegistry.tool("markdown-preview")?.customView, "markdown")
        XCTAssertTrue(ToolRegistry.search("zzbds").contains { $0.id == "regex-tester" })
        XCTAssertTrue(ToolRegistry.search("子网").contains { $0.id == "cidr-calculator" })
    }
}
