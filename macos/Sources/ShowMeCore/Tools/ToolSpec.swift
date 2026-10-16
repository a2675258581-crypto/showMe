import Foundation

// MARK: - 分类

public enum ToolCategory: String, CaseIterable, Sendable, Codable {
    case format, convert, encode, crypto, network, text, image

    public var name: LocalizedText {
        switch self {
        case .format: LocalizedText("格式化", "Format")
        case .convert: LocalizedText("转换", "Convert")
        case .encode: LocalizedText("编码解码", "Encode")
        case .crypto: LocalizedText("加密与安全", "Crypto")
        case .network: LocalizedText("网络与 API", "Network")
        case .text: LocalizedText("文本", "Text")
        case .image: LocalizedText("图片", "Image")
        }
    }
}

// MARK: - 选项

public struct ToolChoice: Sendable, Hashable {
    public let value: String
    public let label: LocalizedText

    public init(_ value: String, _ label: LocalizedText) {
        self.value = value
        self.label = label
    }

    /// 中英文相同的选项（如 "SHA-256"、"UTF-8"）
    public init(_ value: String, _ label: String) {
        self.value = value
        self.label = LocalizedText(label, label)
    }

    public init(_ value: String) {
        self.init(value, value)
    }
}

public enum ToolFieldKind: Sendable {
    /// 单行 / 多行文本。`secret` 的值不会写进会话存档。
    case text(placeholder: LocalizedText? = nil, secret: Bool = false, mono: Bool = true, multiline: Bool = false)
    /// 选项不超过 4 个时界面显示分段控件，否则显示下拉菜单。
    case choice([ToolChoice])
    case toggle
    case number(min: Int, max: Int, step: Int = 1)
}

/// 只在另一个选项取某些值时才显示的字段。
public struct ToolCondition: Sendable, Hashable {
    public let field: String
    public let values: [String]

    public init(_ field: String, in values: [String]) {
        self.field = field
        self.values = values
    }

    public init(_ field: String, is value: String) {
        self.init(field, in: [value])
    }

    public func isSatisfied(by options: [String: String], defaults: [String: String]) -> Bool {
        values.contains(options[field] ?? defaults[field] ?? "")
    }
}

public struct ToolField: Sendable, Identifiable {
    public let id: String
    public let label: LocalizedText
    public let kind: ToolFieldKind
    public let defaultValue: String
    public let help: LocalizedText?
    public let visibleWhen: ToolCondition?

    public init(
        _ id: String,
        _ label: LocalizedText,
        _ kind: ToolFieldKind,
        default defaultValue: String = "",
        help: LocalizedText? = nil,
        visibleWhen: ToolCondition? = nil
    ) {
        self.id = id
        self.label = label
        self.kind = kind
        self.defaultValue = defaultValue
        self.help = help
        self.visibleWhen = visibleWhen
    }

    public var isSecret: Bool {
        if case .text(_, let secret, _, _) = kind { return secret }
        return false
    }
}

// MARK: - 输入 / 输出

/// 工具读什么作为输入：编辑器里的选区（没有选区时用整篇文档）。
public enum ToolInputMode: Sendable {
    /// 必须有文本；为空时界面提示「选中一段文字或在文档里输入」，不调用 run。
    case required
    /// 文本可以为空（如时间戳：空 = 现在）。
    case optional
    /// 不读文档（如 UUID、密码生成），只看选项。
    case none
}

public struct ToolInput: Sendable {
    public var text: String
    public var options: [String: String]
    public var lang: Lang
    public var now: Date
    /// 用于需要随机数的工具；测试里可以注入固定种子。
    public var random: @Sendable (Int) -> [UInt8]

    public init(
        text: String,
        options: [String: String] = [:],
        lang: Lang = .zh,
        now: Date = Date(),
        random: @escaping @Sendable (Int) -> [UInt8] = ToolInput.systemRandom
    ) {
        self.text = text
        self.options = options
        self.lang = lang
        self.now = now
        self.random = random
    }

    public static let systemRandom: @Sendable (Int) -> [UInt8] = { count in
        var rng = SystemRandomNumberGenerator()
        return (0..<count).map { _ in UInt8.random(in: .min ... .max, using: &rng) }
    }

    public func string(_ id: String) -> String { options[id] ?? "" }
    public func bool(_ id: String) -> Bool { ["1", "true", "yes", "on"].contains(options[id]?.lowercased() ?? "") }
    public func int(_ id: String, default fallback: Int) -> Int { Int(options[id] ?? "") ?? fallback }
    public func t(_ zh: String, _ en: String) -> String { lang.t(zh, en) }
}

public struct ToolOutput: Sendable, Hashable, Identifiable {
    public enum Style: Sendable, Hashable {
        /// 等宽，适合代码 / 哈希 / 编码结果
        case mono
        /// 普通文字说明（如 Cron 的中文描述、状态码含义）
        case prose
    }

    public var id: String
    public var label: String
    public var value: String
    public var style: Style
    /// 主输出：「替换选中」「新标签打开」作用于它。每个结果最多一个。
    public var isPrimary: Bool
    /// 「新标签打开」时使用的语言 id（见 `EditorLanguage`），如 "json"。
    public var language: String?

    public init(
        id: String,
        label: String,
        value: String,
        style: Style = .mono,
        isPrimary: Bool = false,
        language: String? = nil
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.style = style
        self.isPrimary = isPrimary
        self.language = language
    }

    /// 主输出的便捷构造
    public static func primary(_ label: String, _ value: String, language: String? = nil) -> ToolOutput {
        ToolOutput(id: "result", label: label, value: value, style: .mono, isPrimary: true, language: language)
    }
}

public struct ToolNote: Sendable, Hashable {
    public enum Level: Sendable, Hashable { case info, warning }
    public var level: Level
    public var message: String

    public init(_ level: Level, _ message: String) {
        self.level = level
        self.message = message
    }
}

/// 表格型结果（正则匹配列表、状态码速查、Cron 下次执行时间……）
public struct ToolTable: Sendable, Hashable {
    public var columns: [String]
    public var rows: [[String]]

    public init(columns: [String], rows: [[String]]) {
        self.columns = columns
        self.rows = rows
    }
}

public struct ToolResult: Sendable, Hashable {
    public var outputs: [ToolOutput]
    public var notes: [ToolNote]
    public var table: ToolTable?

    public init(outputs: [ToolOutput] = [], notes: [ToolNote] = [], table: ToolTable? = nil) {
        self.outputs = outputs
        self.notes = notes
        self.table = table
    }

    public var primary: ToolOutput? { outputs.first(where: \.isPrimary) }
}

/// 工具报错：消息已按 `ToolInput.lang` 解析好；能定位时带上 1 起始的行列。
public struct ToolError: Error, Sendable, Hashable, LocalizedError {
    public var message: String
    public var line: Int?
    public var column: Int?

    public init(_ message: String, line: Int? = nil, column: Int? = nil) {
        self.message = message
        self.line = line
        self.column = column
    }

    public var errorDescription: String? { message }
}

// MARK: - 工具

public struct ToolSpec: Sendable, Identifiable {
    public let id: String
    public let name: LocalizedText
    public let summary: LocalizedText
    public let category: ToolCategory
    /// 搜索关键词（英文名、别名、拼音首字母等）
    public let keywords: [String]
    /// SF Symbol 名称
    public let symbol: String
    public let input: ToolInputMode
    /// 输入说明，如「要编码的文本」；nil 时界面写「选中的文字」
    public let inputLabel: LocalizedText?
    public let fields: [ToolField]
    /// 非 nil 时 App 用专门的界面（如 "http-client"、"qrcode"）；`run` 仍可作为纯逻辑部分。
    public let customView: String?
    public let run: @Sendable (ToolInput) throws -> ToolResult

    public init(
        id: String,
        name: LocalizedText,
        summary: LocalizedText,
        category: ToolCategory,
        keywords: [String] = [],
        symbol: String,
        input: ToolInputMode = .required,
        inputLabel: LocalizedText? = nil,
        fields: [ToolField] = [],
        customView: String? = nil,
        run: @escaping @Sendable (ToolInput) throws -> ToolResult
    ) {
        self.id = id
        self.name = name
        self.summary = summary
        self.category = category
        self.keywords = keywords
        self.symbol = symbol
        self.input = input
        self.inputLabel = inputLabel
        self.fields = fields
        self.customView = customView
        self.run = run
    }

    public var defaults: [String: String] {
        Dictionary(uniqueKeysWithValues: fields.map { ($0.id, $0.defaultValue) })
    }

    /// 用默认值补全选项后运行。
    public func callAsFunction(_ text: String, options: [String: String] = [:], lang: Lang = .zh, now: Date = Date()) throws -> ToolResult {
        try run(ToolInput(text: text, options: defaults.merging(options) { _, new in new }, lang: lang, now: now))
    }

    public func matches(_ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces)
        if q.isEmpty { return true }
        return name.matches(q) || summary.matches(q) || id.localizedCaseInsensitiveContains(q)
            || keywords.contains { $0.localizedCaseInsensitiveContains(q) }
    }
}
