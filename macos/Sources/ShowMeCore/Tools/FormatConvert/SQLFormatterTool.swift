import Foundation

public enum SQLFormatterTool {
    public static let spec = ToolSpec(
        id: "sql-formatter",
        name: LocalizedText("SQL 格式化", "SQL Formatter"),
        summary: LocalizedText(
            "支持 MySQL、PostgreSQL、SQLite、Oracle 等多种方言，关键字大小写可选。",
            "Format SQL for MySQL, PostgreSQL, SQLite, Oracle and more, with selectable keyword case."
        ),
        category: .format,
        keywords: ["sql", "mysql", "postgres", "sqlite", "oracle", "format", "beautify", "美化", "minify", "压缩", "gsh"],
        symbol: "cylinder",
        input: .required,
        inputLabel: LocalizedText("SQL 语句", "SQL statements"),
        fields: [
            ToolField("mode", LocalizedText("操作", "Action"), .choice([
                ToolChoice("format", LocalizedText("格式化", "Format")),
                ToolChoice("minify", LocalizedText("压缩", "Minify")),
            ]), default: "format"),
            ToolField("dialect", LocalizedText("方言", "Dialect"),
                      .choice(SQLFormatter.Dialect.allCases.map { ToolChoice($0.rawValue, $0.label) }), default: "mysql"),
            ToolField("keywordCase", LocalizedText("关键字", "Keywords"), .choice([
                ToolChoice("upper", LocalizedText("大写", "Upper")),
                ToolChoice("lower", LocalizedText("小写", "Lower")),
                ToolChoice("preserve", LocalizedText("保持", "Keep")),
            ]), default: "upper", visibleWhen: ToolCondition("mode", is: "format")),
            ToolField("indent", LocalizedText("缩进", "Indent"), .choice([
                ToolChoice("2", LocalizedText("2 空格", "2 spaces")),
                ToolChoice("4", LocalizedText("4 空格", "4 spaces")),
                ToolChoice("tab", LocalizedText("Tab", "Tab")),
            ]), default: "2", visibleWhen: ToolCondition("mode", is: "format")),
            ToolField("linesBetweenQueries", LocalizedText("语句间空行", "Blank lines between statements"), .number(min: 0, max: 5), default: "1",
                      visibleWhen: ToolCondition("mode", is: "format")),
        ],
        run: run
    )

    @Sendable public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let dialect = SQLFormatter.Dialect(rawValue: input.string("dialect")) ?? .mysql
        if input.string("mode") == "minify" {
            let r = SQLFormatter.minify(input.text, dialect: dialect, lang: lang)
            var notes: [ToolNote] = []
            if r.commentsRemoved > 0 {
                notes.append(ToolNote(.info, lang.t("已去掉 \(r.commentsRemoved) 处注释", "Removed \(r.commentsRemoved) comment(s)")))
            }
            notes += r.warnings.map { ToolNote(.warning, $0) }
            return ToolResult(outputs: [.primary(lang.t("压缩结果", "Minified"), r.output, language: "sql")], notes: notes)
        }
        var o = SQLFormatter.Options(dialect: dialect)
        o.keywordCase = SQLFormatter.LetterCase(rawValue: input.string("keywordCase")) ?? .upper
        switch input.string("indent") {
        case "4": o.indent = "    "
        case "tab": o.indent = "\t"
        default: o.indent = "  "
        }
        o.linesBetweenQueries = input.int("linesBetweenQueries", default: 1)
        let out = try SQLFormatter.format(input.text, options: o, lang: lang)
        return ToolResult(outputs: [.primary(lang.t("格式化结果", "Formatted"), out, language: "sql")],
                          notes: [ToolNote(.info, lang.t("方言：", "Dialect: ") + dialect.label(lang))])
    }
}
