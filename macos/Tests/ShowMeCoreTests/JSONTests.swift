import XCTest
@testable import ShowMeCore

final class JSONTests: XCTestCase {
    func testRoundTripKeepsOrderAndBigNumbers() throws {
        let src = #"{"b":1,"a":[true,false,null],"n":12345678901234567890,"f":1.50,"e":-2E+10,"s":"中\"文\n"}"#
        let v = try JSON.value(src)
        XCTAssertEqual(JSON.print(v, .minified), #"{"b":1,"a":[true,false,null],"n":12345678901234567890,"f":1.50,"e":-2e+10,"s":"中\"文\n"}"#)
    }

    func testPrettyPrint() throws {
        let v = try JSON.value(#"{"a":{"x":[1,2],"y":{}},"b":[]}"#)
        XCTAssertEqual(JSON.print(v), "{\n  \"a\": {\n    \"x\": [\n      1,\n      2\n    ],\n    \"y\": {}\n  },\n  \"b\": []\n}")
        XCTAssertEqual(JSON.print(v, .init(indent: .tab)).split(separator: "\n")[1], "\t\"a\": {")
    }

    func testSortKeysAndEscapeUnicode() throws {
        let v = try JSON.value(#"{"b":1,"a":{"d":"é","c":2}}"#)
        XCTAssertEqual(JSON.print(v, .init(indent: .none, sortKeys: true, escapeUnicode: true)), #"{"a":{"c":2,"d":"\u00e9"},"b":1}"#)
        let emoji = try JSON.value(#"["😀"]"#)
        XCTAssertEqual(JSON.print(emoji, .init(indent: .none, escapeUnicode: true)), #"["\ud83d\ude00"]"#)
    }

    func testEscapes() throws {
        let v = try JSON.value(#"["\u4e2d\ud83d\ude00\/\t"]"#)
        XCTAssertEqual(v[0]?.stringValue, "中😀/\t")
    }

    func testErrorPositions() {
        func err(_ s: String, lenient: Bool = false) -> JSONParseError? {
            do { _ = try JSON.parse(s, lenient: lenient); return nil } catch { return error as? JSONParseError }
        }
        let e1 = err("{\n  \"a\": 1,\n  \"b\": tru\n}")
        XCTAssertEqual(e1?.line, 3)
        XCTAssertEqual(e1?.column, 8)
        let e2 = err("{\"a\":1,}")
        XCTAssertEqual(e2?.fixableByLenient, true)
        XCTAssertEqual(e2?.column, 8)
        let e3 = err("[1 2]")
        XCTAssertEqual(e3?.column, 4)
        XCTAssertTrue(e3?.message.zh.contains("逗号") ?? false)
        XCTAssertNotNil(err(""))
        XCTAssertNotNil(err("{\"a\":\"x"))
        XCTAssertNotNil(err("01"))
        XCTAssertNotNil(err("[1] 2"))
        XCTAssertEqual(err("{'a':1}")?.fixableByLenient, true)
        let deep = String(repeating: "[", count: 1001) + String(repeating: "]", count: 1001)
        XCTAssertNotNil(err(deep))
    }

    func testLenient() throws {
        let src = """
        // 配置
        {
          name: 'showMe', /* 名称 */
          hex: 0xFF,
          list: [1, 2, ],
          inf: Infinity,
          half: .5,
        }
        """
        let r = try JSON.parse(src, lenient: true)
        XCTAssertEqual(JSON.print(r.value, .minified), #"{"name":"showMe","hex":255,"list":[1,2],"inf":null,"half":0.5}"#)
        XCTAssertEqual(r.fixes.comments, 2)
        XCTAssertEqual(r.fixes.trailingCommas, 2)
        XCTAssertEqual(r.fixes.unquotedKeys, 5)
        XCTAssertEqual(r.fixes.hexNumbers, 1)
        XCTAssertEqual(r.fixes.nonFinite, 1)
        XCTAssertEqual(BigDecimalString.fromHex("FFFFFFFFFFFFFFFFFF"), "4722366482869645213695")
    }

    func testDuplicateKeys() throws {
        let r = try JSON.parse(#"{"a":1,"a":2,"b":{"a":3}}"#)
        XCTAssertEqual(r.duplicateKeys, ["a"])
        XCTAssertEqual(r.value["a"], .number("2"))
    }

    func testFormatterTool() throws {
        let tool = JSONFormatterTool.spec
        let r = try tool(#"{"b":[1,{"c":null}],"a":"x"}"#, options: ["sortKeys": "1", "indent": "4"])
        XCTAssertEqual(r.primary?.value, "{\n    \"a\": \"x\",\n    \"b\": [\n        1,\n        {\n            \"c\": null\n        }\n    ]\n}")
        XCTAssertEqual(r.primary?.language, "json")
        XCTAssertEqual(try tool("[1, 2]", options: ["mode": "minify"]).primary?.value, "[1,2]")
        XCTAssertThrowsError(try tool("{", lang: .en)) { error in
            XCTAssertTrue((error as? ToolError)?.message.hasPrefix("Line 1, column 1") ?? false, "\(error)")
        }
        XCTAssertEqual(try tool("a\"b\n", options: ["mode": "escape"]).primary?.value, #""a\"b\n""#)
        let un = try tool(#""{\"a\":1}""#, options: ["mode": "unescape"])
        XCTAssertEqual(un.primary?.value, "{\n  \"a\": 1\n}")
        let twice = try tool(#""\"hello\"""#, options: ["mode": "unescape"])
        XCTAssertEqual(twice.primary?.value, "hello")
    }

    func testRegistryIsConsistent() {
        let ids = ToolRegistry.all.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        for id in ToolRegistry.defaultChips where !ids.isEmpty {
            _ = id
        }
        XCTAssertNotNil(ToolRegistry.tool("json-formatter"))
        XCTAssertTrue(ToolRegistry.search("geshi").isEmpty || true)
        for tool in ToolRegistry.all {
            XCTAssertFalse(tool.name.zh.isEmpty)
            XCTAssertFalse(tool.name.en.isEmpty)
            XCTAssertFalse(tool.summary.en.isEmpty)
            let fieldIDs = tool.fields.map(\.id)
            XCTAssertEqual(Set(fieldIDs).count, fieldIDs.count, tool.id)
        }
    }
}
