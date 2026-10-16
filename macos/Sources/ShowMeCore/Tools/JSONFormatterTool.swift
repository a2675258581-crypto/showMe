import Foundation

public enum JSONFormatterTool {
    public static let spec = ToolSpec(
        id: "json-formatter",
        name: LocalizedText("JSON 格式化", "JSON Formatter"),
        summary: LocalizedText(
            "格式化、压缩、校验 JSON，精确定位错误行列，支持键排序与宽松模式。",
            "Format, minify and validate JSON with exact error positions, key sorting and a lenient mode."
        ),
        category: .format,
        keywords: ["json", "format", "beautify", "minify", "validate", "pretty", "校验", "压缩", "美化", "gsh"],
        symbol: "curlybraces",
        input: .required,
        inputLabel: LocalizedText("JSON 文本", "JSON text"),
        fields: [
            ToolField("mode", LocalizedText("操作", "Action"), .choice([
                ToolChoice("format", LocalizedText("格式化", "Format")),
                ToolChoice("minify", LocalizedText("压缩", "Minify")),
                ToolChoice("escape", LocalizedText("转义为字符串", "Escape")),
                ToolChoice("unescape", LocalizedText("去转义", "Unescape")),
            ]), default: "format"),
            ToolField("indent", LocalizedText("缩进", "Indent"), .choice([
                ToolChoice("2", LocalizedText("2 空格", "2 spaces")),
                ToolChoice("4", LocalizedText("4 空格", "4 spaces")),
                ToolChoice("tab", LocalizedText("Tab", "Tab")),
            ]), default: "2", visibleWhen: ToolCondition("mode", is: "format")),
            ToolField("sortKeys", LocalizedText("键排序", "Sort keys"), .toggle, default: "0",
                      visibleWhen: ToolCondition("mode", in: ["format", "minify"])),
            ToolField("lenient", LocalizedText("宽松模式", "Lenient"), .toggle, default: "0",
                      help: LocalizedText("允许注释、尾随逗号、单引号、无引号键名等 JSON5 写法", "Accept comments, trailing commas, single quotes, unquoted keys (JSON5 style)"),
                      visibleWhen: ToolCondition("mode", in: ["format", "minify"])),
            ToolField("escapeUnicode", LocalizedText("中文转 \\u", "Escape non-ASCII"), .toggle, default: "0",
                      visibleWhen: ToolCondition("mode", in: ["format", "minify"])),
        ],
        run: run
    )

    @Sendable public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        switch input.string("mode") {
        case "escape":
            let quoted = JSON.quote(input.text)
            return ToolResult(outputs: [.primary(lang.t("转义结果", "Escaped"), quoted)])
        case "unescape":
            return try unescape(input.text, lang: lang)
        default:
            break
        }
        let parsed: JSONParseResult
        do {
            parsed = try JSON.parse(input.text, lenient: input.bool("lenient"))
        } catch let e as JSONParseError {
            throw e.toolError(lang)
        }
        let indent: JSON.Indent
        if input.string("mode") == "minify" {
            indent = .none
        } else {
            switch input.string("indent") {
            case "4": indent = .spaces(4)
            case "tab": indent = .tab
            default: indent = .spaces(2)
            }
        }
        let options = JSON.PrintOptions(indent: indent, sortKeys: input.bool("sortKeys"), escapeUnicode: input.bool("escapeUnicode"))
        let text = JSON.print(parsed.value, options)
        var notes: [ToolNote] = [ToolNote(.info, lang.t("JSON 合法 · ", "Valid JSON · ") + stats(parsed.value).summary(lang))]
        if parsed.fixes.total > 0 {
            notes.append(ToolNote(.info, lang.t("宽松模式已修复：", "Fixed in lenient mode: ") + parsed.fixes.summary(lang)))
        }
        if !parsed.duplicateKeys.isEmpty {
            let keys = parsed.duplicateKeys.prefix(5).joined(separator: ", ")
            notes.append(ToolNote(.warning, lang.t("有重复的键：\(keys)（解析时通常以最后一个为准）", "Duplicate keys: \(keys) (most parsers keep the last one)")))
        }
        return ToolResult(outputs: [.primary(lang.t("结果", "Result"), text, language: "json")], notes: notes)
    }

    static func unescape(_ text: String, lang: Lang) throws -> ToolResult {
        var current = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !current.hasPrefix("\"") { current = "\"" + current + "\"" }
        var layers = 0
        // 一层层剥开被多次转义的字符串，直到不再是 JSON 字符串字面量
        while layers < 10, case .string(let inner)? = try? JSON.value(current) {
            layers += 1
            current = inner
            let trimmed = inner.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.hasPrefix("\"") { break }
            current = trimmed
        }
        guard layers > 0 else {
            throw ToolError(lang.t("这不是合法的转义字符串", "This is not a valid escaped JSON string"))
        }
        var outputs = [ToolOutput.primary(lang.t("去转义结果", "Unescaped"), current)]
        var notes: [ToolNote] = []
        if layers > 1 { notes.append(ToolNote(.info, lang.t("共去掉 \(layers) 层转义", "Removed \(layers) levels of escaping"))) }
        if let value = try? JSON.value(current), value.isContainer {
            outputs[0].value = JSON.print(value)
            outputs[0].language = "json"
            notes.append(ToolNote(.info, lang.t("内容是 JSON，已顺便格式化", "The content is JSON and has been formatted")))
        }
        return ToolResult(outputs: outputs, notes: notes)
    }

    public struct Stats: Sendable, Hashable {
        public var objects = 0, arrays = 0, keys = 0, values = 0, maxDepth = 0

        public func summary(_ lang: Lang) -> String {
            lang.t(
                "对象 \(objects) · 数组 \(arrays) · 键 \(keys) · 最深 \(maxDepth) 层",
                "\(objects) objects · \(arrays) arrays · \(keys) keys · depth \(maxDepth)"
            )
        }
    }

    public static func stats(_ value: JSONValue) -> Stats {
        var s = Stats()
        func walk(_ v: JSONValue, _ depth: Int) {
            s.values += 1
            switch v {
            case .object(let members):
                s.objects += 1
                s.keys += members.count
                s.maxDepth = max(s.maxDepth, depth + 1)
                members.forEach { walk($0.value, depth + 1) }
            case .array(let items):
                s.arrays += 1
                s.maxDepth = max(s.maxDepth, depth + 1)
                items.forEach { walk($0, depth + 1) }
            default:
                s.maxDepth = max(s.maxDepth, depth)
            }
        }
        walk(value, 0)
        return s
    }
}
