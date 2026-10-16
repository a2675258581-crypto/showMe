import XCTest
@testable import ShowMeCore

final class EditorCoreSearchTests: XCTestCase {
    private func ranges(_ text: String, _ query: String, _ options: TextSearchOptions = .init()) throws -> [String] {
        let ns = text as NSString
        return try TextSearch.matches(in: text, query: query, options: options).map { ns.substring(with: $0) }
    }

    func testPlainSearchIsLiteralAndCaseInsensitiveByDefault() throws {
        XCTAssertEqual(try ranges("Foo foo FOO", "foo"), ["Foo", "foo", "FOO"])
        XCTAssertEqual(try ranges("Foo foo FOO", "foo", .init(caseSensitive: true)), ["foo"])
        // 普通模式下 . ( [ 等都是字面量
        XCTAssertEqual(try ranges("a.b axb (x)", "a.b"), ["a.b"])
        XCTAssertEqual(try ranges("f(x) [1]", "(x)"), ["(x)"])
        XCTAssertEqual(try ranges("abc", ""), [])
    }

    func testWholeWord() throws {
        let opts = TextSearchOptions(wholeWord: true)
        XCTAssertEqual(try ranges("cat category cat_1 (cat)", "cat", opts), ["cat", "cat"])
        XCTAssertEqual(try ranges("中文 中文字", "中文", opts), ["中文"])
    }

    func testRegexAndUTF16Ranges() throws {
        let opts = TextSearchOptions(regex: true)
        XCTAssertEqual(try ranges("id=12, id=345", #"id=(\d+)"#, opts), ["id=12", "id=345"])
        XCTAssertEqual(try ranges("a\nb\nc", "^b$", opts), ["b"])
        let text = "😀 中文 😀"
        let found = try TextSearch.matches(in: text, query: "😀", options: .init())
        XCTAssertEqual(found.map(\.location), [0, 6])
        XCTAssertEqual(found.first?.length, 2)
        XCTAssertThrowsError(try TextSearch.matches(in: "x", query: "(", options: opts)) { error in
            XCTAssertEqual((error as? TextSearchError)?.message.en, "Invalid regular expression")
        }
    }

    func testLimit() throws {
        let text = String(repeating: "a", count: 50)
        XCTAssertEqual(try TextSearch.matches(in: text, query: "a", options: .init(), limit: 10).count, 10)
    }

    func testReplacementForSingleMatch() throws {
        let text = "name: Tom, name: Ann"
        let opts = TextSearchOptions(regex: true)
        let matches = try TextSearch.matches(in: text, query: #"name: (\w+)"#, options: opts)
        XCTAssertEqual(matches.count, 2)
        XCTAssertEqual(
            try TextSearch.replacement(for: matches[1], in: text, query: #"name: (\w+)"#, template: "$1!", options: opts),
            "Ann!"
        )
        // 普通模式：$1 是字面量
        XCTAssertEqual(
            try TextSearch.replacement(for: matches[0], in: text, query: "name", template: "$1", options: .init()),
            "$1"
        )
        // 后顾断言需要看到匹配之前的文字
        let look = try TextSearch.matches(in: "xa ya", query: "(?<=y)a", options: opts)
        XCTAssertEqual(look.map(\.location), [4])
        XCTAssertEqual(try TextSearch.replacement(for: look[0], in: "xa ya", query: "(?<=y)a", template: "b", options: opts), "b")
    }

    func testReplaceAll() throws {
        let plain = try TextSearch.replaceAll(in: "a.b a.b axb", query: "a.b", template: "$0", options: .init())
        XCTAssertEqual(plain.text, "$0 $0 axb")
        XCTAssertEqual(plain.count, 2)

        let regex = try TextSearch.replaceAll(
            in: "k1=v1\nk2=v2",
            query: #"^(\w+)=(\w+)$"#,
            template: #""$1": "$2","#,
            options: .init(regex: true)
        )
        XCTAssertEqual(regex.text, "\"k1\": \"v1\",\n\"k2\": \"v2\",")
        XCTAssertEqual(regex.count, 2)

        let newline = try TextSearch.replaceAll(in: "a,b,c", query: ",", template: #"\n"#, options: .init(regex: true))
        XCTAssertEqual(newline.text, "a\nb\nc")

        let none = try TextSearch.replaceAll(in: "abc", query: "z", template: "y", options: .init())
        XCTAssertEqual(none.count, 0)
        XCTAssertEqual(none.text, "abc")
    }

    func testRegexTemplateEscapes() {
        XCTAssertEqual(TextSearch.regexTemplate(#"a\tb"#), "a\tb")
        XCTAssertEqual(TextSearch.regexTemplate(#"\$1"#), #"\$1"#)
        XCTAssertEqual(TextSearch.regexTemplate(#"x\\y"#), #"x\\y"#)
        XCTAssertEqual(TextSearch.regexTemplate(#"end\"#), #"end\\"#)
    }
}
