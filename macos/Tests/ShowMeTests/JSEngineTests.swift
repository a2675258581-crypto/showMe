import XCTest
@testable import ShowMe
import ShowMeCore

/// 在真正的 JavaScriptCore 里跑打包好的引擎（只在 macOS 上编译）
final class JSEngineTests: XCTestCase {
    private let engine = JSEngine.shared

    func testPrettierFormatsJavaScriptAndTypeScript() throws {
        XCTAssertEqual(try engine.call("format", ["code": "const a={b:1}", "parser": "babel"]), "const a = { b: 1 };\n")
        XCTAssertEqual(
            try engine.call("format", ["code": "let x:number=1", "parser": "babel-ts", "semi": "0"]),
            "let x: number = 1\n"
        )
        XCTAssertEqual(try engine.call("format", ["code": "a:   1", "parser": "yaml"]), "a: 1\n")
        XCTAssertEqual(try engine.call("format", ["code": ".a{color:red}", "parser": "css"]), ".a {\n  color: red;\n}\n")
    }

    func testEngineErrorsCarryPosition() {
        XCTAssertThrowsError(try engine.call("format", ["code": "const = 1", "parser": "babel"])) { error in
            let scriptError = error as? ScriptError
            XCTAssertEqual(scriptError?.line, 1)
            XCTAssertEqual(scriptError?.column, 7)
        }
        XCTAssertThrowsError(try engine.call("nope", [:]))
    }

    func testSQLYamlMarkdownCron() throws {
        XCTAssertEqual(
            try engine.call("sql", ["code": "select a from t", "keywordCase": "upper"]),
            "SELECT\n  a\nFROM\n  t"
        )
        XCTAssertEqual(try engine.call("yamlToJson", ["code": "a: 1\nb: [x, y]"]), #"{"a":1,"b":["x","y"]}"#)
        XCTAssertEqual(try engine.call("jsonToYaml", ["json": #"{"b":1,"a":[1]}"#]), "b: 1\na:\n  - 1\n")
        XCTAssertTrue(try engine.call("markdown", ["code": "# Hi"]).contains("<h1>Hi</h1>"))
        XCTAssertEqual(try engine.call("cron", ["expr": "30 9 * * *", "locale": "en"]), "At 09:30")
    }

    func testDocumentFormatterUsesTheEngine() throws {
        ToolEnvironment.script = engine
        defer { ToolEnvironment.script = nil }
        XCTAssertEqual(
            try DocumentFormatter.format("function f(){return 1}\n", languageID: "javascript", indentWidth: 2, lang: .zh),
            "function f() {\n  return 1;\n}\n"
        )
        XCTAssertEqual(try DocumentFormatter.format("{\"a\":1}", languageID: "json", indentWidth: 4, lang: .zh), "{\n    \"a\": 1\n}")
        XCTAssertEqual(
            try DocumentFormatter.format("<a><b>x</b></a>", languageID: "xml", indentWidth: 2, lang: .zh),
            "<a>\n  <b>x</b>\n</a>"
        )
    }

    func testCodeFormatterToolEndToEnd() throws {
        ToolEnvironment.script = engine
        defer { ToolEnvironment.script = nil }
        let tool = try XCTUnwrap(ToolRegistry.tool("code-formatter"))
        let result = try tool("const a={b:1}", options: ["lang": "javascript"])
        XCTAssertEqual(result.primary?.value, "const a = { b: 1 };\n")
    }
}
