import Foundation

public enum JSONCSVTool {
    static let delimiterChoices = [
        ToolChoice("comma", LocalizedText("逗号 ,", "Comma ,")),
        ToolChoice("tab", LocalizedText("Tab", "Tab")),
        ToolChoice("semicolon", LocalizedText("分号 ;", "Semicolon ;")),
        ToolChoice("pipe", LocalizedText("竖线 |", "Pipe |")),
    ]

    public static let spec = ToolSpec(
        id: "json-csv",
        name: LocalizedText("JSON ⇄ CSV", "JSON ⇄ CSV"),
        summary: LocalizedText(
            "JSON 数组与 CSV / Excel 表格互转，支持嵌套字段展开与表格预览。",
            "Convert JSON arrays to and from CSV / Excel tables, with nested-field flattening and a table preview."
        ),
        category: .convert,
        keywords: ["json", "csv", "excel", "table", "tsv", "表格", "转换", "bg"],
        symbol: "tablecells",
        input: .required,
        inputLabel: LocalizedText("JSON 或 CSV 文本", "JSON or CSV text"),
        fields: [
            ToolField("mode", LocalizedText("方向", "Direction"), .choice([
                ToolChoice("json2csv", "JSON → CSV"),
                ToolChoice("csv2json", "CSV → JSON"),
            ]), default: "json2csv"),
            ToolField("delimiter", LocalizedText("分隔符", "Delimiter"), .choice(delimiterChoices), default: "comma",
                      visibleWhen: ToolCondition("mode", is: "json2csv")),
            ToolField("csvDelimiter", LocalizedText("分隔符", "Delimiter"), .choice([ToolChoice("auto", LocalizedText("自动识别", "Auto-detect"))] + delimiterChoices),
                      default: "auto", visibleWhen: ToolCondition("mode", is: "csv2json")),
            ToolField("header", LocalizedText("表头行", "Header row"), .toggle, default: "1",
                      help: LocalizedText("JSON → CSV：输出表头；CSV → JSON：首行是表头时输出对象数组，否则输出二维数组",
                                          "JSON → CSV: write a header row; CSV → JSON: treat the first row as headers (objects) instead of rows of arrays")),
            ToolField("flatten", LocalizedText("展开嵌套字段", "Flatten nested fields"), .toggle, default: "1",
                      help: LocalizedText("{ a: { b: 1 } } → 列 a.b；关闭时整个对象写成 JSON", "{ a: { b: 1 } } → column a.b; when off, objects are written as JSON"),
                      visibleWhen: ToolCondition("mode", is: "json2csv")),
            ToolField("quoteAll", LocalizedText("全部加引号", "Quote all fields"), .toggle, default: "0",
                      visibleWhen: ToolCondition("mode", is: "json2csv")),
            ToolField("path", LocalizedText("数组字段", "Array field"), .text(placeholder: LocalizedText("如 data", "e.g. data")), default: "",
                      help: LocalizedText("只转换顶层对象里的这个数组（如接口返回的 data）", "Convert only this array inside the top-level object (e.g. an API's data)"),
                      visibleWhen: ToolCondition("mode", is: "json2csv")),
            ToolField("dynamicTyping", LocalizedText("推断类型", "Infer types"), .toggle, default: "1",
                      help: LocalizedText("数字、true / false、空值 → null、JSON 数组 / 对象；007 这类前导零保持字符串",
                                          "Numbers, true / false, empty → null, JSON arrays / objects; values like 007 stay strings"),
                      visibleWhen: ToolCondition("mode", is: "csv2json")),
            ToolField("unflatten", LocalizedText("还原嵌套", "Rebuild nesting"), .toggle, default: "1",
                      help: LocalizedText("列名 a.b → { a: { b } }，a.0、a.1 → 数组", "Column a.b → { a: { b } }; a.0, a.1 → arrays"),
                      visibleWhen: ToolCondition("mode", is: "csv2json")),
        ],
        run: run
    )

    static func delimiter(_ value: String) -> Character? {
        switch value {
        case "comma": return ","
        case "tab": return "\t"
        case "semicolon": return ";"
        case "pipe": return "|"
        default: return nil
        }
    }

    static func delimiterName(_ d: Character, _ lang: Lang) -> String {
        switch d {
        case "\t": return "Tab"
        case ";": return lang.t("分号", "semicolon")
        case "|": return lang.t("竖线", "pipe")
        default: return lang.t("逗号", "comma")
        }
    }

    static func flag(_ input: ToolInput, _ id: String, default fallback: Bool) -> Bool {
        input.options[id] == nil ? fallback : input.bool(id)
    }

    @Sendable public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        if input.string("mode") == "csv2json" {
            let o = JSONCSV.ToJSONOptions(
                header: flag(input, "header", default: true),
                dynamicTyping: flag(input, "dynamicTyping", default: true),
                unflatten: flag(input, "unflatten", default: true),
                delimiter: delimiter(input.string("csvDelimiter"))
            )
            let r = try JSONCSV.csvToJSON(input.text, options: o, lang: lang)
            let count = r.value.items?.count ?? 0
            var notes = [ToolNote(.info, lang.t("\(count) 行 · 分隔符：\(delimiterName(r.delimiter, lang))",
                                                "\(count) rows · delimiter: \(delimiterName(r.delimiter, lang))"))]
            notes += r.warnings.map { ToolNote(.warning, $0) }
            if count > r.table.rows.count {
                notes.append(ToolNote(.info, lang.t("表格只预览前 \(r.table.rows.count) 行", "The table previews the first \(r.table.rows.count) rows")))
            }
            return ToolResult(outputs: [.primary("JSON", r.json, language: "json")], notes: notes,
                              table: r.table.headers.isEmpty ? nil : ToolTable(columns: r.table.headers, rows: r.table.rows))
        }
        let o = JSONCSV.ToCSVOptions(
            delimiter: delimiter(input.string("delimiter")) ?? ",",
            flatten: flag(input, "flatten", default: true),
            quoteAll: flag(input, "quoteAll", default: false),
            header: flag(input, "header", default: true),
            path: FC.jsTrim(input.string("path"))
        )
        let r = try JSONCSV.jsonToCSV(input.text, options: o, lang: lang)
        var notes: [ToolNote] = []
        notes.append(ToolNote(.info, lang.t("\(r.table.headers.count) 列", "\(r.table.headers.count) columns")
            + (r.usedPath.map { lang.t(" · 数组字段：\($0)", " · array field: \($0)") } ?? "")))
        notes += r.warnings.map { ToolNote(.warning, $0) }
        if r.usedPath == nil, !r.candidates.isEmpty {
            let list = zip(r.candidates, r.candidateCounts).map { lang.t("\($0)（\($1) 项）", "\($0) (\($1) items)") }
            notes.append(ToolNote(.info, lang.t("顶层对象里有可以转换的数组：\(FC.list(list, lang))，可填进「数组字段」",
                                                "The top-level object contains convertible arrays: \(FC.list(list, lang)); enter one under Array field")))
        }
        if !o.path.isEmpty, r.usedPath == nil {
            notes.append(ToolNote(.warning, lang.t("顶层对象里没有名为 \(o.path) 的数组，已转换整个 JSON", "There is no array named \(o.path) in the top-level object; converted the whole JSON")))
        }
        return ToolResult(outputs: [.primary("CSV", r.csv, language: "plain")], notes: notes,
                          table: r.table.headers.isEmpty ? nil : ToolTable(columns: r.table.headers, rows: r.table.rows))
    }
}
