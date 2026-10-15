import XCTest
@testable import ShowMeCore

final class ConvertRegistryTests: XCTestCase {
    let ids = ["timestamp", "base-converter", "color-converter", "case-converter", "cron-parser", "uuid-generator", "password-generator", "mock-data"]

    func testAllToolsRegistered() {
        XCTAssertEqual(ConvertTools.all.map(\.id), ids)
        for id in ids {
            let tool = ToolRegistry.tool(id)
            XCTAssertNotNil(tool, id)
            XCTAssertFalse(tool?.name.zh.isEmpty ?? true)
            XCTAssertFalse(tool?.summary.en.isEmpty ?? true)
            XCTAssertFalse(tool?.keywords.isEmpty ?? true)
        }
        XCTAssertEqual(ToolRegistry.search("时间戳").first?.id, "timestamp")
        XCTAssertTrue(ToolRegistry.search("radix").contains { $0.id == "base-converter" })
    }

    /// 每种选项组合下可见的字段不超过 6 个，且默认值都在选项里
    func testVisibleFieldsStaySmall() {
        for tool in ConvertTools.all {
            let fieldIDs = tool.fields.map(\.id)
            XCTAssertEqual(Set(fieldIDs).count, fieldIDs.count, tool.id)
            let controllers = Set(tool.fields.compactMap { $0.visibleWhen?.field })
            var combos: [[String: String]] = [tool.defaults]
            for c in controllers {
                guard let f = tool.fields.first(where: { $0.id == c }), case .choice(let choices) = f.kind else { continue }
                combos = combos.flatMap { base in choices.map { base.merging([c: $0.value]) { $1 } } }
            }
            for options in combos {
                let visible = tool.fields.filter { $0.visibleWhen?.isSatisfied(by: options, defaults: tool.defaults) ?? true }
                XCTAssertLessThanOrEqual(visible.count, 6, "\(tool.id) \(options)")
            }
            for f in tool.fields {
                if case .choice(let choices) = f.kind {
                    XCTAssertTrue(choices.contains { $0.value == f.defaultValue }, "\(tool.id).\(f.id)")
                    XCTAssertTrue(choices.allSatisfy { !$0.label.zh.isEmpty && !$0.label.en.isEmpty })
                }
                if case .number(let lo, let hi, _) = f.kind, let v = Int(f.defaultValue) {
                    XCTAssertTrue((lo...hi).contains(v), "\(tool.id).\(f.id)")
                }
            }
        }
    }

    /// 生成器工具不读输入；所有工具在默认选项下都能跑（必须有输入的给一个示例）
    func testDefaultsRun() throws {
        let samples = ["timestamp": "", "base-converter": "255", "color-converter": "#0071e3", "case-converter": "helloWorld",
                       "cron-parser": "*/5 * * * *", "uuid-generator": "", "password-generator": "", "mock-data": ""]
        for tool in ConvertTools.all {
            for lang in Lang.allCases {
                let r = try tool(samples[tool.id] ?? "", lang: lang)
                XCTAssertFalse(r.outputs.isEmpty, tool.id)
                XCTAssertLessThanOrEqual(r.outputs.filter(\.isPrimary).count, 1, tool.id)
            }
        }
    }
}
