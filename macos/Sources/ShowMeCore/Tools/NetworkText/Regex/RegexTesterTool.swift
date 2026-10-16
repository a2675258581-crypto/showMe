import Foundation

public enum RegexTesterTool {
    public static let spec = ToolSpec(
        id: "regex-tester",
        name: LocalizedText("正则表达式测试", "Regex Tester"),
        summary: LocalizedText("实时高亮匹配、查看分组、测试替换，内置常用正则库。", "Test matches, inspect groups and try replacements, with a library of common patterns."),
        category: .text,
        keywords: ["regex", "regexp", "regular expression", "match", "replace", "正则", "zzbds", "zz"],
        symbol: "text.magnifyingglass",
        input: .required,
        inputLabel: LocalizedText("要匹配的文本", "Text to match"),
        fields: [
            ToolField("preset", LocalizedText("常用正则", "Common patterns"),
                      .choice([ToolChoice("custom", LocalizedText("自定义", "Custom"))] + RegexTester.presets.map { ToolChoice($0.id, $0.name) }),
                      default: "custom"),
            ToolField("pattern", LocalizedText("表达式", "Pattern"),
                      .text(placeholder: LocalizedText("如 (?<user>\\w+)@(?<domain>[\\w.]+)", "e.g. (?<user>\\w+)@(?<domain>[\\w.]+)")),
                      visibleWhen: ToolCondition("preset", is: "custom")),
            ToolField("mode", LocalizedText("模式", "Mode"), .choice([
                ToolChoice("match", LocalizedText("匹配", "Match")),
                ToolChoice("replace", LocalizedText("替换", "Replace")),
            ]), default: "match"),
            ToolField("replacement", LocalizedText("替换为", "Replace with"),
                      .text(placeholder: LocalizedText("$1、$<name>、$& 引用匹配内容", "$1, $<name> and $& insert matched text")),
                      visibleWhen: ToolCondition("mode", is: "replace")),
            ToolField("i", LocalizedText("忽略大小写 (i)", "Ignore case (i)"), .toggle, default: "0"),
            ToolField("m", LocalizedText("多行 (m)", "Multiline (m)"), .toggle, default: "0",
                      help: LocalizedText("^ 和 $ 匹配每一行的开头和结尾", "^ and $ match at every line")),
            ToolField("s", LocalizedText("点号匹配换行 (s)", "Dot matches newline (s)"), .toggle, default: "0"),
            ToolField("x", LocalizedText("忽略空白与注释 (x)", "Extended (x)"), .toggle, default: "0",
                      help: LocalizedText("表达式里的空白被忽略，# 之后是注释", "Whitespace in the pattern is ignored and # starts a comment")),
        ],
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        var flags = RegexTester.Flags(ignoreCase: input.bool("i"), multiline: input.bool("m"), dotAll: input.bool("s"), extended: input.bool("x"))
        var pattern = input.string("pattern")
        var notes: [ToolNote] = []
        let presetID = input.string("preset")
        if presetID != "custom", !presetID.isEmpty, let preset = RegexTester.presets.first(where: { $0.id == presetID }) {
            pattern = preset.pattern
            flags = flags | RegexTester.Flags(js: preset.flags)
            notes.append(ToolNote(.info, lang == .zh ? "\(preset.name.zh)：\(preset.summary.zh)" : "\(preset.name.en): \(preset.summary.en)"))
        }
        if pattern.isEmpty { throw ToolError(lang.t("请输入正则表达式", "Enter a regular expression")) }
        let regex = try RegexTester.compile(pattern, flags: flags, lang: lang)
        let (matches, truncated, timedOut) = RegexTester.matches(regex, in: input.text)

        let columns = lang == .zh ? ["#", "位置", "匹配", "分组"] : ["#", "Range", "Match", "Groups"]
        let rows = matches.map { m -> [String] in
            let range = "\(m.start.line):\(m.start.column)–\(m.end.line):\(m.end.column)"
            let groups = m.groups.map { g -> String in
                let label = g.name.map { "\(g.index) \($0)" } ?? "\(g.index)"
                return "\(label) = " + (g.value.map(display) ?? lang.t("（未参与）", "(none)"))
            }.joined(separator: " · ")
            return [String(m.number + 1), range, display(m.text), groups]
        }
        var outputs: [ToolOutput] = []
        if input.string("mode") == "replace" {
            let r = RegexTester.replace(regex, in: input.text, template: input.string("replacement"))
            outputs.append(.primary(lang.t("替换结果", "Result"), r.output))
            if r.timedOut, !timedOut { notes.append(timeoutNote(lang)) }
            notes.insert(ToolNote(.info, r.count > 0 ? lang.t("替换了 \(r.count) 处", "Replaced \(r.count) matches") : lang.t("没有找到匹配项", "No matches")), at: 0)
        } else {
            outputs.append(.primary(lang.t("匹配内容", "Matches"), matches.map(\.text).joined(separator: "\n")))
            let count = truncated ? "\(RegexTester.matchLimit)+" : String(matches.count)
            notes.insert(ToolNote(.info, matches.isEmpty ? lang.t("没有匹配", "No matches") : lang.t("共 \(count) 处匹配", "\(count) matches")), at: 0)
        }
        if timedOut { notes.append(timeoutNote(lang)) }
        if truncated {
            notes.append(ToolNote(.warning, lang.t("匹配太多，只列出前 \(RegexTester.matchLimit) 个", "Too many matches; only the first \(RegexTester.matchLimit) are listed")))
        }
        return ToolResult(outputs: outputs, notes: notes, table: matches.isEmpty ? nil : ToolTable(columns: columns, rows: rows))
    }

    static func timeoutNote(_ lang: Lang) -> ToolNote {
        ToolNote(.warning, lang.t("匹配超时（可能存在灾难性回溯，如 (a+)+），结果不完整", "Matching timed out (possibly catastrophic backtracking, e.g. (a+)+); results are incomplete"))
    }

    /// 表格里显示：换行、制表符可见，过长的截断
    static func display(_ s: String) -> String {
        var out = s.replacingOccurrences(of: "\r", with: "\\r").replacingOccurrences(of: "\n", with: "\\n").replacingOccurrences(of: "\t", with: "\\t")
        if out.count > 200 { out = String(out.prefix(200)) + "…" }
        return out
    }
}
