import Foundation

/// 假数据导出：JSON / CSV / TSV / SQL INSERT / Markdown 表格
extension MockData {
    public enum SqlDialect: String, Sendable {
        case mysql, postgres, sqlserver
    }

    public static func toJSON(_ columns: [String], _ rows: [[Cell]]) -> String {
        let objects = rows.map { r in
            JSONValue.object(columns.enumerated().map { i, c in JSONMember(c, i < r.count ? r[i].json : .null) })
        }
        return JSON.print(.array(objects))
    }

    /// RFC 4180：含分隔符、引号、换行或首尾空格时加双引号，内部引号翻倍
    public static func csvEscape(_ s: String, delimiter: Character = ",") -> String {
        let needs = s.contains(delimiter) || s.contains("\"") || s.contains("\n") || s.contains("\r") || s.contains("\r\n")
            || s.first?.isWhitespace == true || s.last?.isWhitespace == true
        return needs ? "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : s
    }

    public static func toCSV(_ columns: [String], _ rows: [[Cell]]) -> String {
        ([columns.map { csvEscape($0) }.joined(separator: ",")] + rows.map { $0.map { csvEscape($0.text) }.joined(separator: ",") })
            .joined(separator: "\n")
    }

    /// TSV 不支持引号转义，值里的制表符和换行替换成空格
    public static func toTSV(_ columns: [String], _ rows: [[Cell]]) -> String {
        func clean(_ s: String) -> String {
            var out = ""
            var lastWasSpace = false
            for ch in s {
                if ch == "\t" || ch == "\n" || ch == "\r" || ch == "\r\n" {
                    if !lastWasSpace { out.append(" ") }
                    lastWasSpace = true
                } else {
                    out.append(ch)
                    lastWasSpace = false
                }
            }
            return out
        }
        return ([columns.map(clean).joined(separator: "\t")] + rows.map { $0.map { clean($0.text) }.joined(separator: "\t") })
            .joined(separator: "\n")
    }

    static func quotePart(_ part: String, _ d: SqlDialect) -> String {
        switch d {
        case .mysql: "`" + part.replacingOccurrences(of: "`", with: "``") + "`"
        case .sqlserver: "[" + part.replacingOccurrences(of: "]", with: "]]") + "]"
        case .postgres: "\"" + part.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
    }

    /// 给标识符加引号；qualified（表名）时把 schema.table 拆开分别加引号，列名里的点号是名字的一部分
    public static func quoteIdent(_ name: String, _ d: SqlDialect, qualified: Bool = false) -> String {
        guard qualified else { return quotePart(name, d) }
        let parts = name.components(separatedBy: ".").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return parts.isEmpty ? quotePart(name, d) : parts.map { quotePart($0, d) }.joined(separator: ".")
    }

    public static func sqlLiteral(_ v: Cell, _ d: SqlDialect) -> String {
        switch v {
        case .null: return "NULL"
        case .int(let n): return String(n)
        case .number(let s): return s
        case .bool(let b): return d == .sqlserver ? (b ? "1" : "0") : (b ? "TRUE" : "FALSE")
        case .string(var s):
            s = s.replacingOccurrences(of: "'", with: "''")
            // MySQL 默认把反斜杠当转义符
            if d == .mysql { s = s.replacingOccurrences(of: "\\", with: "\\\\") }
            return d == .sqlserver ? "N'\(s)'" : "'\(s)'"
        }
    }

    public static func toSQL(_ columns: [String], _ rows: [[Cell]], table: String, dialect: SqlDialect, batch: Int = 100) -> String {
        let t = table.trimmingCharacters(in: .whitespaces)
        let name = quoteIdent(t.isEmpty ? "mock_data" : t, dialect, qualified: true)
        let cols = columns.map { quoteIdent($0, dialect) }.joined(separator: ", ")
        let size = max(1, min(1000, batch))
        var out: [String] = []
        var i = 0
        while i < rows.count {
            let chunk = rows[i..<min(rows.count, i + size)]
            let values = chunk.map { "(" + $0.map { sqlLiteral($0, dialect) }.joined(separator: ", ") + ")" }
            out.append(chunk.count == 1
                ? "INSERT INTO \(name) (\(cols)) VALUES \(values[0]);"
                : "INSERT INTO \(name) (\(cols)) VALUES\n  \(values.joined(separator: ",\n  "));")
            i += size
        }
        return out.joined(separator: "\n")
    }

    static func mdEscape(_ s: String) -> String {
        s.replacingOccurrences(of: "|", with: "\\|").replacingOccurrences(of: "\r\n", with: "<br>").replacingOccurrences(of: "\n", with: "<br>")
    }

    /// Markdown 表格；数字列右对齐
    public static func toMarkdown(_ columns: [String], _ rows: [[Cell]]) -> String {
        let numeric = columns.indices.map { i in !rows.isEmpty && rows.allSatisfy { i >= $0.count || $0[i].isNumeric || $0[i] == .null } }
        let header = "| " + columns.map(mdEscape).joined(separator: " | ") + " |"
        let sep = "| " + numeric.map { $0 ? "---:" : "---" }.joined(separator: " | ") + " |"
        let body = rows.map { r in "| " + columns.indices.map { mdEscape($0 < r.count ? r[$0].text : "") }.joined(separator: " | ") + " |" }
        return ([header, sep] + body).joined(separator: "\n")
    }
}

public enum MockDataTool {
    static let formats: [(id: String, label: LocalizedText, language: String)] = [
        ("json", LocalizedText("JSON", "JSON"), "json"),
        ("csv", LocalizedText("CSV", "CSV"), "plain"),
        ("tsv", LocalizedText("TSV", "TSV"), "plain"),
        ("sql", LocalizedText("SQL（MySQL）", "SQL (MySQL)"), "sql"),
        ("sql-postgres", LocalizedText("SQL（PostgreSQL）", "SQL (PostgreSQL)"), "sql"),
        ("sql-sqlserver", LocalizedText("SQL（SQL Server）", "SQL (SQL Server)"), "sql"),
        ("markdown", LocalizedText("Markdown 表格", "Markdown table"), "markdown"),
    ]

    public static let spec = ToolSpec(
        id: "mock-data",
        name: LocalizedText("假数据生成", "Mock Data"),
        summary: LocalizedText(
            "批量生成中文姓名、手机号、邮箱、地址、身份证号等测试数据，导出 JSON / CSV / SQL。",
            "Generate fake names, phones, emails, addresses, IDs and more as JSON, CSV or SQL."
        ),
        category: .text,
        keywords: ["mock", "fake", "faker", "test data", "假数据", "测试数据", "随机", "jsj"],
        symbol: "person.3",
        input: .none,
        fields: [
            ToolField("fields", LocalizedText("字段", "Fields"), .text(placeholder: LocalizedText(MockData.defaultFields, MockData.defaultFields), multiline: true),
                      default: MockData.defaultFields,
                      help: LocalizedText(
                          "逗号分隔；可写「列名:类型(参数)」，如 user_id:int(1-10000)、status:enum(待支付|已支付)、created_at:date(2024-01-01~2024-12-31)",
                          "Comma-separated; use “column:type(args)”, e.g. user_id:int(1-10000), status:enum(paid|refunded), created_at:date(2024-01-01~2024-12-31)"
                      )),
            ToolField("count", LocalizedText("行数", "Rows"), .number(min: 1, max: 1000), default: "10"),
            ToolField("format", LocalizedText("格式", "Format"), .choice(formats.map { ToolChoice($0.id, $0.label) }), default: "json"),
            ToolField("table", LocalizedText("表名", "Table"), .text(placeholder: LocalizedText("mock_data", "mock_data")), default: "mock_data",
                      visibleWhen: ToolCondition("format", in: ["sql", "sql-postgres", "sql-sqlserver"])),
            ToolField("locale", LocalizedText("数据风格", "Data style"), .choice([
                ToolChoice("auto", LocalizedText("跟随界面语言", "Follow app language")),
                ToolChoice("zh", LocalizedText("中文", "Chinese")),
                ToolChoice("en", LocalizedText("英文", "English")),
            ]), default: "auto"),
            ToolField("seed", LocalizedText("随机种子", "Seed"), .text(placeholder: LocalizedText("留空则每次随机", "Empty = random each time")),
                      help: LocalizedText("填同一个种子会得到完全相同的数据", "The same seed always gives the same data")),
        ],
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let locale: MockData.Locale
        switch input.string("locale") {
        case "zh": locale = .zh
        case "en": locale = .en
        default: locale = lang == .zh ? .zh : .en
        }
        let fieldText = input.options["fields"] ?? MockData.defaultFields
        let parsed = MockData.parseFields(fieldText, lang: lang)
        guard !parsed.fields.isEmpty else {
            throw ToolError(parsed.warnings.first ?? lang.t("请至少填写一个字段，例如 \(MockData.defaultFields)", "Add at least one field, e.g. \(MockData.defaultFields)"))
        }
        let seedText = input.string("seed").trimmingCharacters(in: .whitespaces)
        let seed: UInt32
        if seedText.isEmpty {
            seed = RandomStream(input.random).uint32()
        } else {
            seed = UInt32(seedText) ?? MockData.hashString(seedText)
        }
        let count = min(MockData.maxRows, max(1, input.int("count", default: 10)))
        let g = MockData.generate(parsed.fields, count: count, seed: seed, locale: locale,
                                  nowMs: Timestamp.epochMs(input.now), lang: lang)

        let format = formats.first { $0.id == input.string("format") } ?? formats[0]
        let text: String
        switch format.id {
        case "csv": text = MockData.toCSV(g.columns, g.rows)
        case "tsv": text = MockData.toTSV(g.columns, g.rows)
        case "sql": text = MockData.toSQL(g.columns, g.rows, table: input.string("table"), dialect: .mysql)
        case "sql-postgres": text = MockData.toSQL(g.columns, g.rows, table: input.string("table"), dialect: .postgres)
        case "sql-sqlserver": text = MockData.toSQL(g.columns, g.rows, table: input.string("table"), dialect: .sqlserver)
        case "markdown": text = MockData.toMarkdown(g.columns, g.rows)
        default: text = MockData.toJSON(g.columns, g.rows)
        }

        var notes = (parsed.warnings + g.warnings).map { ToolNote(.warning, $0) }
        notes.append(ToolNote(.info, lang.t(
            "\(g.rows.count) 行 × \(g.columns.count) 列 · 随机种子 \(seedText.isEmpty ? String(seed) : seedText)（填进「随机种子」可复现）",
            "\(g.rows.count) rows × \(g.columns.count) columns · seed \(seedText.isEmpty ? String(seed) : seedText) (enter it as the seed to reproduce)"
        )))
        let preview = 100
        if g.rows.count > preview {
            notes.append(ToolNote(.info, lang.t("表格只预览前 \(preview) 行，完整数据见结果", "The table previews the first \(preview) rows; the result has all of them")))
        }
        return ToolResult(
            outputs: [.primary(format.label(lang), text, language: format.language)],
            notes: notes,
            table: ToolTable(columns: g.columns, rows: g.rows.prefix(preview).map { $0.map(\.text) })
        )
    }
}
