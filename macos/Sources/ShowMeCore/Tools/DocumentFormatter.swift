import Foundation

/// 编辑器的「格式化文档」（⌥⇧F）：按文档语言选择格式化方式。
/// JSON / XML 用原生实现；JS、CSS、HTML、Markdown、YAML、GraphQL 走 prettier，SQL 走 sql-formatter（脚本引擎）。
public enum DocumentFormatter {
    public static func format(_ text: String, languageID: String, indentWidth: Int, lang: Lang) throws -> String {
        let language = EditorLanguage.byID(languageID)
        guard let kind = language.formatter else {
            throw ToolError(lang.t(
                "\(language.displayName(.zh)) 暂不支持格式化",
                "Formatting isn't available for \(language.displayName(.en))"
            ))
        }
        let useTabs = indentWidth == 0
        let width = useTabs ? 4 : max(1, indentWidth)
        let unit = useTabs ? "\t" : String(repeating: " ", count: width)
        let endsWithNewline = text.hasSuffix("\n")

        switch kind {
        case .json:
            let value: JSONValue
            do {
                value = try JSON.value(text)
            } catch let error as JSONParseError {
                throw error.toolError(lang)
            }
            let printed = JSON.print(value, .init(indent: useTabs ? .tab : .spaces(width)))
            return endsWithNewline ? printed + "\n" : printed

        case .xml:
            let printed = try XMLFormatter.format(text, indent: unit, lang: lang)
            return keepTrailingNewline(printed, endsWithNewline)

        case .prettier(let parser):
            return try ToolEnvironment.runScript("format", [
                "code": text,
                "parser": parser,
                "tabWidth": String(width),
                "useTabs": useTabs ? "1" : "0",
                "printWidth": "100",
            ], lang: lang)

        case .sql(let dialect):
            let printed = try ToolEnvironment.runScript("sql", [
                "code": text,
                "language": dialect,
                "keywordCase": "preserve",
                "tabWidth": String(width),
                "useTabs": useTabs ? "1" : "0",
            ], lang: lang)
            return keepTrailingNewline(printed, endsWithNewline)
        }
    }

    private static func keepTrailingNewline(_ text: String, _ wanted: Bool) -> String {
        if wanted, !text.hasSuffix("\n") { return text + "\n" }
        if !wanted, text.hasSuffix("\n") { return String(text.dropLast()) }
        return text
    }
}
