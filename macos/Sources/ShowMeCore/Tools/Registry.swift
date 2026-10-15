import Foundation

/// 全部工具的唯一登记处。各批工具在自己的文件里导出 `all`，这里按固定顺序汇总。
public enum ToolRegistry {
    /// 与网页版一致的展示顺序
    public static let order: [String] = [
        "json-formatter", "xml-formatter", "code-formatter", "sql-formatter",
        "json-yaml", "json-xml", "json-csv", "json-to-types", "timestamp", "base-converter",
        "color-converter", "case-converter", "cron-parser",
        "base64", "image-base64", "url-codec", "html-entities", "unicode-escape", "jwt-decoder",
        "hash", "hmac", "aes-des", "rsa", "password-generator", "uuid-generator",
        "api-client", "curl-converter", "http-status", "cidr-calculator",
        "text-diff", "regex-tester", "markdown-preview", "text-toolkit", "mock-data",
        "qrcode", "image-compressor",
    ]

    /// 抽屉里默认露出的常用工具
    public static let defaultChips: [String] = [
        "hmac", "hash", "base64", "url-codec", "json-formatter", "timestamp", "text-diff",
    ]

    public static let all: [ToolSpec] = {
        let tools = [JSONFormatterTool.spec] + FormatConvertTools.all + ConvertTools.all
            + EncodeCryptoTools.all + NetworkTextTools.all + AppTools.all
        let rank = Dictionary(uniqueKeysWithValues: order.enumerated().map { ($1, $0) })
        var seen = Set<String>()
        return tools
            .filter { seen.insert($0.id).inserted }
            .enumerated()
            .sorted { (rank[$0.element.id] ?? 1000 + $0.offset) < (rank[$1.element.id] ?? 1000 + $1.offset) }
            .map(\.element)
    }()

    public static let byID: [String: ToolSpec] = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

    public static func tool(_ id: String) -> ToolSpec? { byID[id] }

    public static func search(_ query: String) -> [ToolSpec] {
        all.filter { $0.matches(query) }
    }

    public static func tools(in category: ToolCategory) -> [ToolSpec] {
        all.filter { $0.category == category }
    }
}
