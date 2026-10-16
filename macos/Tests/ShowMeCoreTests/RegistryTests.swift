import XCTest
@testable import ShowMeCore

final class RegistryTests: XCTestCase {
    func testAllThirtySixToolsAreRegisteredInOrder() {
        let ids = ToolRegistry.all.map(\.id)
        XCTAssertEqual(ids, ToolRegistry.order, "注册表应包含网页版全部 36 个工具，且顺序一致")
        XCTAssertEqual(ids.count, 36)
        for chip in ToolRegistry.defaultChips {
            XCTAssertNotNil(ToolRegistry.tool(chip), chip)
        }
    }

    func testEveryToolIsBilingualAndHasValidFields() {
        for tool in ToolRegistry.all {
            XCTAssertFalse(tool.name.zh.isEmpty, tool.id)
            XCTAssertFalse(tool.name.en.isEmpty, tool.id)
            XCTAssertFalse(tool.summary.zh.isEmpty, tool.id)
            XCTAssertFalse(tool.summary.en.isEmpty, tool.id)
            let fieldIDs = tool.fields.map(\.id)
            XCTAssertEqual(Set(fieldIDs).count, fieldIDs.count, "\(tool.id) 有重复的字段 id")
            for field in tool.fields {
                XCTAssertFalse(field.label.en.isEmpty, "\(tool.id).\(field.id)")
                if case .choice(let choices) = field.kind {
                    XCTAssertFalse(choices.isEmpty, "\(tool.id).\(field.id)")
                    XCTAssertTrue(
                        choices.contains { $0.value == field.defaultValue },
                        "\(tool.id).\(field.id) 的默认值 \(field.defaultValue) 不在选项里"
                    )
                }
                if let condition = field.visibleWhen {
                    XCTAssertTrue(fieldIDs.contains(condition.field), "\(tool.id).\(field.id) 依赖不存在的字段 \(condition.field)")
                }
            }
        }
    }

    func testSearchWorksInBothLanguages() {
        XCTAssertTrue(ToolRegistry.search("JSON").contains { $0.id == "json-formatter" })
        XCTAssertTrue(ToolRegistry.search("哈希").contains { $0.id == "hash" })
        XCTAssertTrue(ToolRegistry.search("postman").contains { $0.id == "api-client" })
        XCTAssertTrue(ToolRegistry.search("md5").contains { $0.id == "hash" })
    }

    /// 每个工具用各种奇怪的输入跑一遍：可以报错，但不能崩溃
    func testNoToolCrashesOnOddInput() async {
        let inputs = [
            "", " ", "hello 世界", "{\"a\":[1,2,{\"b\":null}]}", "<a x=\"1\"><b/></a>",
            "SELECT * FROM t WHERE id = 1", "a,b\n1,2", "😀\u{0}\u{FFFD}", "%E4%B8%AD", "1700000000",
            "*/5 * * * *", "192.168.1.10/24", "#ff8800", String(repeating: "x", count: 5000),
        ]
        let fixedRandom: @Sendable (Int) -> [UInt8] = { count in (0..<count).map { UInt8($0 % 251) } }
        for tool in ToolRegistry.all where tool.customView == nil || tool.customView == "markdown" {
            for lang in Lang.allCases {
                for text in inputs {
                    let input = ToolInput(
                        text: text,
                        options: tool.defaults,
                        lang: lang,
                        now: Date(timeIntervalSince1970: 1_760_000_000),
                        random: fixedRandom
                    )
                    _ = await BigStack.run { try? tool.run(input) }
                }
            }
        }
    }
}
