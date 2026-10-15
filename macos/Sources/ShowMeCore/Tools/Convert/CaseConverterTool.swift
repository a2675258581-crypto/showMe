import Foundation

/// 命名风格转换
public enum CaseConverter {
    public enum Style: String, CaseIterable, Sendable {
        case camel, pascal, snake, constant, kebab, train, dot, path, title, sentence, lower, upper

        public var label: String {
            switch self {
            case .camel: "camelCase"
            case .pascal: "PascalCase"
            case .snake: "snake_case"
            case .constant: "SCREAMING_SNAKE"
            case .kebab: "kebab-case"
            case .train: "Train-Case"
            case .dot: "dot.case"
            case .path: "path/case"
            case .title: "Title Case"
            case .sentence: "Sentence case"
            case .lower: "lower case"
            case .upper: "UPPER CASE"
            }
        }
    }

    private enum Kind {
        case lower, upper, letter, digit, other

        var isLetter: Bool { self == .lower || self == .upper || self == .letter }
    }

    private static func kind(_ u: Unicode.Scalar) -> Kind {
        if u.value >= 48 && u.value <= 57 { return .digit }
        switch u.properties.generalCategory {
        case .lowercaseLetter: return .lower
        case .uppercaseLetter: return .upper
        case .titlecaseLetter, .modifierLetter, .otherLetter: return .letter
        default: return .other
        }
    }

    /// 把任意风格的标识符拆成小写单词："XMLHttpRequest2Fast" → ["xml", "http", "request", "2", "fast"]
    ///
    /// 与网页版的几条正则等价（逐个码点扫描，线性时间）：
    /// aB → a B；ABc → A Bc；字母与数字之间断开；其余非字母数字的字符都是分隔符。
    public static func splitWords(_ input: String) -> [String] {
        let scalars = Array(input.unicodeScalars)
        let kinds = scalars.map(kind)
        var words: [String] = []
        var current = String.UnicodeScalarView()
        func flush() {
            if !current.isEmpty { words.append(String(current).lowercased()) }
            current = String.UnicodeScalarView()
        }
        for i in scalars.indices {
            let k = kinds[i]
            if k == .other {
                flush()
                continue
            }
            if i > 0 {
                let p = kinds[i - 1]
                let boundary = ((p == .lower || p == .digit) && k == .upper)
                    || (p == .upper && k == .upper && i + 1 < kinds.count && kinds[i + 1] == .lower)
                    || (p.isLetter && k == .digit)
                    || (p == .digit && k.isLetter)
                if boundary { flush() }
            }
            current.append(scalars[i])
        }
        flush()
        return words
    }

    static func cap(_ w: String) -> String {
        guard let f = w.first else { return w }
        return String(f).uppercased() + w.dropFirst()
    }

    public static func join(_ w: [String], _ style: Style) -> String {
        guard let first = w.first else { return "" }
        switch style {
        case .camel: return first + w.dropFirst().map(cap).joined()
        case .pascal: return w.map(cap).joined()
        case .snake: return w.joined(separator: "_")
        case .constant: return w.joined(separator: "_").uppercased()
        case .kebab: return w.joined(separator: "-")
        case .train: return w.map(cap).joined(separator: "-")
        case .dot: return w.joined(separator: ".")
        case .path: return w.joined(separator: "/")
        case .title: return w.map(cap).joined(separator: " ")
        case .sentence: return cap(w.joined(separator: " "))
        case .lower: return w.joined(separator: " ")
        case .upper: return w.joined(separator: " ").uppercased()
        }
    }

    public static func convert(_ input: String, _ style: Style) -> String { join(splitWords(input), style) }

    /// 逐行转换，保留空行
    public static func convertLines(_ input: String, _ style: Style) -> String {
        convertLines(input, styles: [style])[0]
    }

    /// 一次拆词、多种风格输出（避免每种风格重复拆词）
    static func convertLines(_ input: String, styles: [Style]) -> [String] {
        let lines = TextUtil.lines(input)
        let words: [[String]?] = lines.map { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : splitWords($0) }
        return styles.map { style in
            zip(lines, words).map { line, w in w.map { join($0, style) } ?? line }.joined(separator: "\n")
        }
    }
}

public enum CaseConverterTool {
    public static let spec = ToolSpec(
        id: "case-converter",
        name: LocalizedText("命名风格转换", "Case Converter"),
        summary: LocalizedText(
            "camelCase、PascalCase、snake_case、kebab-case、CONSTANT_CASE 等一键互转。",
            "Convert between camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE and more."
        ),
        category: .convert,
        keywords: ["case", "camel", "pascal", "snake", "kebab", "upper", "lower", "大小写", "驼峰", "命名", "mmfg"],
        symbol: "textformat",
        input: .required,
        inputLabel: LocalizedText("变量名或短语（每行一个）", "Identifiers or phrases (one per line)"),
        fields: [
            ToolField("target", LocalizedText("目标风格", "Target"), .choice(CaseConverter.Style.allCases.map { ToolChoice($0.rawValue, $0.label) }),
                      default: CaseConverter.Style.camel.rawValue,
                      help: LocalizedText("「替换选中」使用这一种风格，其余风格同时列出", "“Replace selection” uses this style; the others are listed too")),
        ],
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let target = CaseConverter.Style(rawValue: input.string("target")) ?? .camel
        let styles = [target] + CaseConverter.Style.allCases.filter { $0 != target }
        let values = CaseConverter.convertLines(input.text, styles: styles)
        let outputs = zip(styles, values).map { style, value in
            ToolOutput(id: style.rawValue, label: style.label, value: value, isPrimary: style == target)
        }
        var notes: [ToolNote] = []
        if values.first?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true {
            notes.append(ToolNote(.warning, input.t("输入里没有可以拆分的单词（字母或数字）", "No words (letters or digits) were found in the input")))
        }
        return ToolResult(outputs: outputs, notes: notes)
    }
}
