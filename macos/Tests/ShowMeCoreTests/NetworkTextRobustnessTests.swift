import XCTest
@testable import ShowMeCore

/// 所有工具 × 所有选项 × 各种刁钻输入：不崩溃、不卡死、错误信息已本地化
final class NetworkTextRobustnessTests: XCTestCase {
    struct Echo: ScriptEngine {
        func call(_ function: String, _ args: [String: String]) throws -> String { "<p>\(args["code"]?.count ?? 0)</p>" }
    }

    static let inputs: [String] = {
        var seed: UInt64 = 1
        func rnd(_ n: Int) -> Int {
            seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return Int((seed >> 33) % UInt64(n))
        }
        let pieces = ["a", "中", "😀", " ", "\n", "\r\n", "\t", "'", "\"", "\\", "$", "{{x}}", "-", "--", "^", "/", ":", ".", "1", "255", "::", "%", "(", ")", "[", "*", "?", "\u{0}", "\u{301}", "curl"]
        var out = ["", " ", "\n\n", "curl", "curl 'x", "404", "4xx", "限流", "192.168.1.1/24", "::1/64", "1.2.3.4 - 1.2.3.1", "(a+)+$"]
        for _ in 0..<12 { out.append((0..<rnd(60)).map { _ in pieces[rnd(pieces.count)] }.joined()) }
        return out
    }()

    func optionSets(_ spec: ToolSpec) -> [[String: String]] {
        var sets: [[String: String]] = [[:]]
        for f in spec.fields {
            switch f.kind {
            case .choice(let choices):
                sets += choices.map { [f.id: $0.value] }
            case .toggle:
                sets.append([f.id: "1"])
            case .number(let min, let max, _):
                sets += [[f.id: String(min)], [f.id: String(max)], [f.id: "-1"], [f.id: "abc"]]
            case .text:
                sets += [[f.id: "("], [f.id: "{{x}}"], [f.id: "24"], [f.id: "中文 😀\n$&"]]
            }
        }
        // 选择项互相组合：每个选择字段取遍所有值时，其它字段打开
        let toggles = Dictionary(uniqueKeysWithValues: spec.fields.compactMap { f -> (String, String)? in
            if case .toggle = f.kind { return (f.id, "1") }
            return nil
        })
        for f in spec.fields {
            if case .choice(let choices) = f.kind {
                sets += choices.map { toggles.merging([f.id: $0.value]) { _, b in b } }
            }
        }
        return sets
    }

    func testAllToolsSurviveWeirdInput() {
        let saved = ToolEnvironment.script
        ToolEnvironment.script = Echo()
        defer { ToolEnvironment.script = saved }
        for spec in NetworkTextTools.all {
            let sets = optionSets(spec)
            for text in Self.inputs {
                for options in sets {
                    for lang in Lang.allCases {
                        let input = ToolInput(text: text, options: spec.defaults.merging(options) { _, b in b }, lang: lang,
                                              now: Date(timeIntervalSince1970: 0), random: { Array(repeating: 7, count: $0) })
                        do {
                            _ = try spec.run(input)
                        } catch let e as ToolError {
                            XCTAssertFalse(e.message.isEmpty)
                            if lang == .en {
                                // 英文界面的错误里不应出现中文（引用用户输入的部分除外）
                                let quoted = e.message.contains("“") || e.message.contains(text) || options.values.contains { !$0.isEmpty && e.message.contains($0) }
                                if !quoted { XCTAssertFalse(e.message.unicodeScalars.contains { TextToolkit.isHan($0) }, "\(spec.id): \(e.message)") }
                            }
                        } catch {
                            XCTFail("\(spec.id) threw a non-ToolError: \(error)")
                        }
                    }
                }
            }
        }
    }

    func testLargeInputsStayFast() throws {
        let saved = ToolEnvironment.script
        ToolEnvironment.script = Echo()
        defer { ToolEnvironment.script = saved }
        let line = "联系 alice@example.com 访问 https://a.dev/x?q=1 IP 10.0.0.1 价格 12.5 😀 Hello World\n"
        let big = String(repeating: line, count: 1_000_000 / line.utf8.count)
        let cases: [(String, [String: String])] = [
            ("text-toolkit", [:]), ("text-toolkit", ["op": "dedupe"]), ("text-toolkit", ["op": "sort", "sortMode": "natural"]),
            ("text-toolkit", ["op": "extract", "extractKind": "url"]), ("text-toolkit", ["op": "case", "caseMode": "title"]),
            ("text-toolkit", ["op": "replace", "find": "a", "replaceWith": "b"]), ("text-toolkit", ["op": "removeNumbers"]),
            ("regex-tester", ["pattern": "\\d+"]), ("regex-tester", ["pattern": "\\w+", "mode": "replace", "replacement": "[$&]"]),
            ("text-diff", ["against": big.replacingOccurrences(of: "Hello", with: "Hi")]),
            ("http-status", [:]), ("markdown-preview", [:]),
        ]
        for (id, options) in cases {
            let spec = try XCTUnwrap(ToolRegistry.tool(id))
            let start = Date()
            _ = try spec(big, options: options)
            XCTAssertLessThan(Date().timeIntervalSince(start), 30, "\(id) \(options)")
        }
    }
}
