import Foundation

/// CSV 读写（RFC 4180）：字段含分隔符、双引号、换行或首尾空格时加引号，引号写成 ""。
public enum CSVCodec {
    public enum QuoteError: Sendable, Hashable {
        /// 带引号的字段直到结尾都没有闭合（offset 指向开头的引号）
        case missing(offset: Int)
        /// 结尾引号后面还有别的字符（offset 指向这个引号）
        case invalid(offset: Int)
    }

    public struct Parsed: Sendable, Hashable {
        public var rows: [[String]]
        /// 每行在原文中的起始行号（1 起始）
        public var lines: [Int]
        public var quoteError: QuoteError?
    }

    /// 解析 CSV。skipEmpty 时跳过只有空白的行（与 papaparse 的 greedy 一致）。
    public static func parse(_ text: String, delimiter: Character, skipEmpty: Bool = true) -> Parsed {
        parse(Array(text.utf8), delimiter: delimiter.asciiValue ?? 0x2C, skipEmpty: skipEmpty, maxRows: nil)
    }

    static func parse(_ b: [UInt8], delimiter d: UInt8, skipEmpty: Bool, maxRows: Int?) -> Parsed {
        var out = Parsed(rows: [], lines: [], quoteError: nil)
        let n = b.count
        var i = b.starts(with: [0xEF, 0xBB, 0xBF]) ? 3 : 0
        var line = 1
        var row: [String] = []
        var rowLine = 1
        var inRow = false
        func countBreaks(_ from: Int, _ to: Int) -> Int {
            var c = 0, k = from
            while k < to {
                if b[k] == 0x0A { c += 1 } else if b[k] == 0x0D { c += 1; if k + 1 < to, b[k + 1] == 0x0A { k += 1 } }
                k += 1
            }
            return c
        }
        func endRow() {
            let blank = row.allSatisfy { FC.isJSBlank($0) }
            if !(skipEmpty && blank) {
                out.rows.append(row)
                out.lines.append(rowLine)
            }
            row = []
            inRow = false
        }
        /// 跳过换行，返回下一个位置
        func afterBreak(_ k: Int) -> Int {
            b[k] == 0x0D && k + 1 < n && b[k + 1] == 0x0A ? k + 2 : k + 1
        }
        while true {
            if let maxRows, out.rows.count >= maxRows { break }
            if i >= n {
                // 分隔符后面直接是结尾：还有一个空字段
                if inRow { row.append(""); endRow() }
                break
            }
            if !inRow { inRow = true; rowLine = line }
            if b[i] == 0x22 {
                let open = i
                var j = i + 1
                var field: [UInt8] = []
                var closed = false
                while j < n {
                    guard let q = FC.find(b, 0x22, from: j) else { break }
                    field.append(contentsOf: b[j..<q])
                    if q + 1 < n, b[q + 1] == 0x22 {
                        field.append(0x22)
                        j = q + 2
                        continue
                    }
                    // 结尾引号：后面可以有空格，然后必须是分隔符、换行或结尾
                    var k = q + 1
                    while k < n, b[k] == 0x20 { k += 1 }
                    guard k >= n || b[k] == d || b[k] == 0x0A || b[k] == 0x0D else {
                        out.quoteError = .invalid(offset: q)
                        return out
                    }
                    line += countBreaks(open, q)
                    row.append(String(decoding: field, as: UTF8.self))
                    closed = true
                    if k >= n {
                        endRow()
                        i = n
                    } else if b[k] == d {
                        i = k + 1
                    } else {
                        endRow()
                        line += 1
                        i = afterBreak(k)
                    }
                    break
                }
                if !closed {
                    out.quoteError = .missing(offset: open)
                    return out
                }
                continue
            }
            var j = i
            while j < n, b[j] != d, b[j] != 0x0A, b[j] != 0x0D { j += 1 }
            row.append(String(decoding: b[i..<j], as: UTF8.self))
            if j >= n {
                endRow()
                break
            }
            if b[j] == d {
                i = j + 1
            } else {
                endRow()
                line += 1
                i = afterBreak(j)
            }
        }
        return out
    }

    /// 自动识别分隔符（papaparse 的算法：前 10 行字段数最稳定、平均字段数最多的那个）
    public static func detectDelimiter(_ text: String) -> Character {
        let b = Array(text.utf8)
        var best: UInt8?
        var bestDelta = Int.max
        var maxAvg = -1.0
        for d: UInt8 in [0x2C, 0x09, 0x7C, 0x3B] {
            let preview = parse(b, delimiter: d, skipEmpty: false, maxRows: 10).rows
            var delta = 0, total = 0, empty = 0
            var prev: Int?
            for r in preview {
                if r.allSatisfy({ FC.isJSBlank($0) }) { empty += 1; continue }
                total += r.count
                if let p = prev {
                    if r.count > 0 { delta += abs(r.count - p); prev = r.count }
                } else {
                    prev = r.count
                }
            }
            let rows = preview.count - empty
            let avg = rows > 0 ? Double(total) / Double(rows) : 0
            if delta <= bestDelta && avg > maxAvg && avg > 1.99 {
                best = d
                bestDelta = delta
                maxAvg = avg
            }
        }
        if let best, best != 0x2C { return Character(Unicode.Scalar(best)) }
        // 识别成逗号（或失败）时，再看首行里哪种分隔符最多
        return guessFromFirstLine(text) ?? ","
    }

    /// 首个非空行不含逗号时，取 ; Tab | 中出现次数最多的那个
    public static func guessFromFirstLine(_ text: String) -> Character? {
        let first = text.split(omittingEmptySubsequences: true, whereSeparator: { $0 == "\n" || $0 == "\r\n" || $0 == "\r" })
            .first(where: { !FC.isJSBlank(String($0)) }) ?? ""
        if first.contains(",") { return nil }
        var best: Character?
        var max = 0
        for d: Character in [";", "\t", "|"] {
            let c = first.filter { $0 == d }.count
            if c > max { max = c; best = d }
        }
        return best
    }

    /// 单个字段的 CSV 写法
    public static func field(_ s: String, delimiter: Character, quoteAll: Bool = false) -> String {
        let d = delimiter.unicodeScalars.first ?? ","
        let needs = quoteAll || s.hasPrefix(" ") || s.hasSuffix(" ")
            || s.unicodeScalars.contains { $0 == "\"" || $0 == "\n" || $0 == "\r" || $0 == "\u{FEFF}" || $0 == d }
        guard needs else { return s }
        return "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    public static func write(_ rows: [[String]], delimiter: Character, quoteAll: Bool = false, newline: String = "\n") -> String {
        let sep = String(delimiter)
        return rows.map { r in r.map { field($0, delimiter: delimiter, quoteAll: quoteAll) }.joined(separator: sep) }.joined(separator: newline)
    }
}

/// JSON ⇄ CSV：嵌套对象展开成 a.b 列、数组写成 JSON 字符串；CSV → JSON 可推断类型并还原嵌套。
public enum JSONCSV {
    public struct ToCSVOptions: Sendable, Hashable {
        public var delimiter: Character
        /// 嵌套对象展开成 a.b 列；关闭时整个对象写成 JSON 字符串
        public var flatten: Bool
        public var quoteAll: Bool
        /// 输出表头行
        public var header: Bool
        public var newline: String
        /// 只转换顶层对象里的这个数组字段（如 API 返回的 data）
        public var path: String

        public init(delimiter: Character = ",", flatten: Bool = true, quoteAll: Bool = false, header: Bool = true, newline: String = "\n", path: String = "") {
            self.delimiter = delimiter
            self.flatten = flatten
            self.quoteAll = quoteAll
            self.header = header
            self.newline = newline
            self.path = path
        }
    }

    public struct ToJSONOptions: Sendable, Hashable {
        /// 首行是表头：输出对象数组；否则输出二维数组
        public var header: Bool
        /// 推断数字、布尔、null、JSON 数组 / 对象
        public var dynamicTyping: Bool
        /// 按 a.b 列名还原嵌套对象
        public var unflatten: Bool
        /// nil = 自动识别
        public var delimiter: Character?
        public var indent: JSON.Indent

        public init(header: Bool = true, dynamicTyping: Bool = true, unflatten: Bool = true, delimiter: Character? = nil, indent: JSON.Indent = .spaces(2)) {
            self.header = header
            self.dynamicTyping = dynamicTyping
            self.unflatten = unflatten
            self.delimiter = delimiter
            self.indent = indent
        }
    }

    public struct Table: Sendable, Hashable {
        public var headers: [String]
        public var rows: [[String]]
    }

    public struct CSVResult: Sendable, Hashable {
        public var csv: String
        public var table: Table
        public var warnings: [String]
        /// 顶层是对象时，里面可以直接转换的对象数组字段（键名, 元素个数）
        public var candidates: [String]
        public var candidateCounts: [Int]
        /// 实际使用的数组字段
        public var usedPath: String?
    }

    public struct JSONResult: Sendable, Hashable {
        public var json: String
        public var value: JSONValue
        public var table: Table
        public var warnings: [String]
        /// 实际使用（或识别出）的分隔符
        public var delimiter: Character
    }

    // MARK: 单元格

    /// 单元格文本：null → 空，对象 / 数组 → 紧凑 JSON
    public static func cellText(_ v: JSONValue) -> String {
        switch v {
        case .null: return ""
        case .string(let s): return s
        case .number(let n): return n
        case .bool(let b): return b ? "true" : "false"
        case .object, .array: return JSON.print(v, .minified)
        }
    }

    /// 把一行对象展开成「列名 → 文本」；collisions 记录被覆盖的列名
    static func flatten(_ members: [JSONMember], deep: Bool, collisions: inout [String]) -> (keys: [String], values: [String: String]) {
        var keys: [String] = []
        var values: [String: String] = [:]
        func put(_ k: String, _ v: String) {
            if values[k] != nil {
                if !collisions.contains(k) { collisions.append(k) }
            } else {
                keys.append(k)
            }
            values[k] = v
        }
        func visit(_ value: JSONValue, _ key: String, _ depth: Int) {
            if deep, case .object = value, depth < 64 {
                let entries = FC.members(value)
                if entries.isEmpty { put(key, "{}") }
                for m in entries { visit(m.value, "\(key).\(m.key)", depth + 1) }
            } else {
                put(key, cellText(value))
            }
        }
        for m in members { visit(m.value, m.key, 0) }
        return (keys, values)
    }

    /// 顶层对象中「非空的对象数组」字段
    public static func recordArrays(_ value: JSONValue) -> [(key: String, count: Int)] {
        guard case .object = value else { return [] }
        return FC.members(value).compactMap { m in
            guard case .array(let items) = m.value, !items.isEmpty, items.allSatisfy({ FC.isObject($0) }) else { return nil }
            return (m.key, items.count)
        }
    }

    /// 单元格类型推断：空 → null，true / false / null（不分大小写），JSON 数字（保留原文，大数不丢精度），
    /// 以 [ 或 { 开头且是合法 JSON 的数组 / 对象；其余保持字符串。前导零（007）保持字符串。
    public static func typeCell(_ s: String) -> JSONValue {
        if s.isEmpty { return .null }
        let t = FC.jsTrim(s)
        switch t.lowercased() {
        case "true": return .bool(true)
        case "false": return .bool(false)
        case "null": return .null
        default: break
        }
        if isJSONNumber(t), case .number(let n)? = try? JSON.value(t) { return .number(n) }
        if (t.hasPrefix("[") && t.hasSuffix("]")) || (t.hasPrefix("{") && t.hasSuffix("}")),
           let v = try? JSON.value(t), v.isContainer {
            return v
        }
        return .string(s)
    }

    /// -?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?
    static func isJSONNumber(_ t: String) -> Bool {
        let u = Array(t.utf8)
        var i = 0
        func digits() -> Int {
            let s = i
            while i < u.count, u[i] >= 0x30, u[i] <= 0x39 { i += 1 }
            return i - s
        }
        if i < u.count, u[i] == 0x2D { i += 1 }
        guard i < u.count else { return false }
        if u[i] == 0x30 { i += 1 } else if digits() == 0 { return false }
        if i < u.count, u[i] == 0x2E {
            i += 1
            if digits() == 0 { return false }
        }
        if i < u.count, u[i] == 0x65 || u[i] == 0x45 {
            i += 1
            if i < u.count, u[i] == 0x2B || u[i] == 0x2D { i += 1 }
            if digits() == 0 { return false }
        }
        return i == u.count
    }

    /// 还原嵌套时的临时节点
    final class Nest {
        var keys: [String] = []
        var entries: [String: Entry] = [:]
        enum Entry {
            case value(JSONValue)
            case nest(Nest)
        }

        func set(_ k: String, _ e: Entry) {
            if entries[k] == nil { keys.append(k) }
            entries[k] = e
        }

        func value() -> JSONValue {
            let items = keys.map { k -> JSONValue in
                switch entries[k] {
                case .value(let v)?: return v
                case .nest(let n)?: return n.value()
                case nil: return .null
                }
            }
            // 连续的 0..n-1 数字键还原成数组
            if !keys.isEmpty, keys.enumerated().allSatisfy({ $0.element == String($0.offset) }) { return .array(items) }
            return .object(zip(keys, items).map { JSONMember($0, $1) })
        }
    }

    /// 按 a.b 键还原嵌套对象；与已有值冲突的键保持扁平并记入 conflicts
    public static func unflatten(_ record: [JSONMember], conflicts: inout [String]) -> JSONValue {
        let root = Nest()
        func isFlat(_ parts: [Substring]) -> Bool { parts.count < 2 || parts.contains { $0.isEmpty } }
        // 扁平键优先：同时有 a 与 a.b 时，a.b 保持扁平
        var flatKeys = Set<String>()
        for m in record where isFlat(m.key.split(separator: ".", omittingEmptySubsequences: false)) { flatKeys.insert(m.key) }
        for m in record {
            let parts = m.key.split(separator: ".", omittingEmptySubsequences: false)
            if isFlat(parts) {
                root.set(m.key, .value(m.value))
                continue
            }
            var cur: Nest? = flatKeys.contains(String(parts[0])) ? nil : root
            var i = 0
            while let c = cur, i < parts.count - 1 {
                let p = String(parts[i])
                switch c.entries[p] {
                case nil:
                    let n = Nest()
                    c.set(p, .nest(n))
                    cur = n
                case .nest(let n)?:
                    cur = n
                default:
                    cur = nil
                }
                i += 1
            }
            let last = String(parts[parts.count - 1])
            if let c = cur, c.entries[last] == nil {
                c.set(last, .value(m.value))
            } else {
                if !conflicts.contains(m.key) { conflicts.append(m.key) }
                root.set(m.key, .value(m.value))
            }
        }
        // 顶层始终是对象
        return .object(root.keys.map { k in
            switch root.entries[k] {
            case .value(let v)?: return JSONMember(k, v)
            case .nest(let n)?: return JSONMember(k, n.value())
            case nil: return JSONMember(k, .null)
            }
        })
    }

    static let tableLimit = 500

    static func columnName(_ i: Int, _ lang: Lang) -> String { lang.t("列 \(i)", "Column \(i)") }

    static func listRows(_ rows: [Int], _ lang: Lang) -> String {
        let shown = rows.prefix(3).map(String.init).joined(separator: lang.t("、", ", "))
        if rows.count > 3 { return lang.t("第 \(shown) 等 \(rows.count) 行", "lines \(shown) and \(rows.count - 3) more") }
        return lang.t("第 \(shown) 行", rows.count == 1 ? "line \(shown)" : "lines \(shown)")
    }

    // MARK: JSON → CSV

    public static func jsonToCSV(_ text: String, options o: ToCSVOptions = ToCSVOptions(), lang: Lang = .zh) throws -> CSVResult {
        var result = CSVResult(csv: "", table: Table(headers: [], rows: []), warnings: [], candidates: [], candidateCounts: [], usedPath: nil)
        if FC.isJSBlank(text) { return result }
        var value: JSONValue
        do {
            value = try JSON.value(text)
        } catch let e as JSONParseError {
            throw e.toolError(lang)
        }
        let candidates = recordArrays(value)
        result.candidates = candidates.map(\.key)
        result.candidateCounts = candidates.map(\.count)
        if !o.path.isEmpty, let sub = value[o.path], FC.isArray(sub) {
            result.usedPath = o.path
            value = sub
        }

        // 二维数组：原样按行输出
        if case .array(let items) = value, !items.isEmpty, items.allSatisfy({ FC.isArray($0) }) {
            let rows = items.map { ($0.items ?? []).map(cellText) }
            let width = rows.map(\.count).max() ?? 0
            let headers = (0..<width).map { i in
                o.header && !rows[0].isEmpty && i < rows[0].count ? rows[0][i] : columnName(i + 1, lang)
            }
            if rows.contains(where: { $0.count != width }) {
                result.warnings.append(lang.t("各行的元素个数不一致，较短的行在表格中留空", "Rows have different lengths; shorter rows are left blank in the table"))
            }
            result.csv = CSVCodec.write(rows, delimiter: o.delimiter, quoteAll: o.quoteAll, newline: o.newline)
            let body = o.header ? Array(rows.dropFirst()) : rows
            result.table = Table(headers: headers, rows: body.prefix(tableLimit).map { r in (0..<width).map { $0 < r.count ? r[$0] : "" } })
            return result
        }

        let records: [[JSONMember]]
        switch value {
        case .array(let items):
            if items.isEmpty {
                result.warnings.append(lang.t("数组为空，没有可以转换的数据", "The array is empty; there is nothing to convert"))
                return result
            }
            records = items.map { FC.isObject($0) ? FC.members($0) : [JSONMember("value", $0)] }
            if items.contains(where: { !FC.isObject($0) }) && items.contains(where: { FC.isObject($0) }) {
                result.warnings.append(lang.t("数组里混有非对象元素，已放进 value 列", "The array mixes objects with other values; those went into a value column"))
            }
        case .object:
            records = [FC.members(value)]
        default:
            records = [[JSONMember("value", value)]]
        }

        var collisions: [String] = []
        let flat = records.map { flatten($0, deep: o.flatten, collisions: &collisions) }
        var keys: [String] = []
        var seen = Set<String>()
        for row in flat {
            for k in row.keys where seen.insert(k).inserted { keys.append(k) }
        }
        // 某行是 null、另一行是对象时，会同时出现 addr 与 addr.city 列：去掉全空的 addr 列
        let prefixes = Set(keys.flatMap { k -> [String] in
            let parts = k.split(separator: ".", omittingEmptySubsequences: false)
            return parts.count < 2 ? [] : (1..<parts.count).map { parts[0..<$0].joined(separator: ".") }
        })
        keys.removeAll { k in prefixes.contains(k) && flat.allSatisfy { ($0.values[k] ?? "").isEmpty } }
        if !collisions.isEmpty {
            let list = collisions.prefix(3).joined(separator: lang.t("、", ", "))
            result.warnings.append(lang.t("展开后列名冲突（如同时存在 “a.b” 键和 a 对象里的 b）：\(list)",
                                          "Column names collide after flattening (e.g. an \"a.b\" key and b inside an a object): \(list)"))
        }
        if keys.isEmpty {
            result.warnings.append(records.count == 1
                ? lang.t("对象没有任何字段，无法生成 CSV 列", "The object has no fields, so there are no CSV columns")
                : lang.t("所有对象都没有字段，无法生成 CSV 列", "None of the objects have fields, so there are no CSV columns"))
            return result
        }
        let data = flat.map { row in keys.map { row.values[$0] ?? "" } }
        result.csv = CSVCodec.write(o.header ? [keys] + data : data, delimiter: o.delimiter, quoteAll: o.quoteAll, newline: o.newline)
        result.table = Table(headers: keys, rows: Array(data.prefix(tableLimit)))
        return result
    }

    // MARK: CSV → JSON

    public static func csvToJSON(_ text: String, options o: ToJSONOptions = ToJSONOptions(), lang: Lang = .zh) throws -> JSONResult {
        var result = JSONResult(json: "", value: .array([]), table: Table(headers: [], rows: []), warnings: [], delimiter: o.delimiter ?? ",")
        if FC.isJSBlank(text) { return result }
        let bytes = Array(text.utf8)
        let delimiter = o.delimiter ?? CSVCodec.detectDelimiter(text)
        result.delimiter = delimiter
        let parsed = CSVCodec.parse(bytes, delimiter: delimiter.asciiValue ?? 0x2C, skipEmpty: true, maxRows: nil)
        if let qe = parsed.quoteError {
            let offset: Int, message: LocalizedText
            switch qe {
            case .missing(let at):
                offset = at
                message = LocalizedText("引号没有闭合：这个带引号的字段缺少结尾的双引号", "Unclosed quote: this quoted field has no closing double quote")
            case .invalid(let at):
                offset = at
                message = LocalizedText("引号格式不正确：结尾引号后面还有其它字符（字段内的 \" 需要写成 \"\"）",
                                        "Malformed quotes: there are characters after the closing quote (write \" inside a field as \"\")")
            }
            let (line, column) = FC.lineColumn(bytes, offset)
            throw ToolError(lang.t("第 \(line) 行第 \(column) 列：", "Line \(line), column \(column): ") + message(lang), line: line, column: column)
        }
        let cell: (String) -> JSONValue = o.dynamicTyping ? typeCell : { .string($0) }
        func display(_ v: JSONValue) -> String { cellText(v) }

        if !o.header {
            let rows = parsed.rows.map { $0.map(cell) }
            let width = parsed.rows.map(\.count).max() ?? 0
            result.value = .array(rows.map { .array($0) })
            result.json = JSON.print(result.value, JSON.PrintOptions(indent: o.indent))
            result.table = Table(headers: (0..<width).map { columnName($0 + 1, lang) },
                                 rows: rows.prefix(tableLimit).map { r in (0..<width).map { $0 < r.count ? display(r[$0]) : "" } })
            return result
        }
        guard let headerRow = parsed.rows.first else {
            result.json = "[]"
            return result
        }
        // 表头：去掉首尾空白；空表头 → column3；重复 → name_2
        var headers: [String] = []
        var used = Set<String>()
        var renamed: [String] = []
        func claim(_ base: String) -> String {
            var n = base
            var i = 2
            while used.contains(n) { n = "\(base)_\(i)"; i += 1 }
            used.insert(n)
            return n
        }
        for (i, h) in headerRow.enumerated() {
            let t = FC.jsTrim(h)
            let name = claim(t.isEmpty ? "column\(i + 1)" : t)
            if name != t {
                renamed.append(t.isEmpty ? lang.t("第 \(i + 1) 列（空表头）→ \(name)", "column \(i + 1) (blank) → \(name)")
                                         : lang.t("“\(t)” → \(name)", "\"\(t)\" → \(name)"))
            }
            headers.append(name)
        }
        if !renamed.isEmpty {
            let list = FC.list(renamed, lang)
            result.warnings.append(lang.t("表头有空白或重复，已重命名：\(list)", "Blank or duplicate headers were renamed: \(list)"))
        }
        var short: [Int] = [], long: [Int] = []
        var allHeaders = headers
        var flatRows: [[JSONMember]] = []
        flatRows.reserveCapacity(parsed.rows.count)
        for (index, cells) in parsed.rows.enumerated().dropFirst() {
            if cells.count < headers.count { short.append(parsed.lines[index]) }
            if cells.count > headers.count { long.append(parsed.lines[index]) }
            var rec: [JSONMember] = []
            for i in 0..<max(cells.count, headers.count) {
                if i >= allHeaders.count { allHeaders.append(claim("column\(i + 1)")) }
                rec.append(JSONMember(allHeaders[i], cell(i < cells.count ? cells[i] : "")))
            }
            flatRows.append(rec)
        }
        if !short.isEmpty {
            result.warnings.append(lang.t("\(listRows(short, lang))的字段比表头少（共 \(headers.count) 列），缺少的字段已留空",
                                          "\(FC.capitalizeFirst(listRows(short, lang))) \(short.count == 1 ? "has" : "have") fewer fields than the header (\(headers.count) columns); missing fields are empty"))
        }
        if !long.isEmpty {
            result.warnings.append(lang.t("\(listRows(long, lang))的字段比表头多，多出的字段放进了 column 开头的新列",
                                          "\(FC.capitalizeFirst(listRows(long, lang))) \(long.count == 1 ? "has" : "have") more fields than the header; the extra fields went into new column… columns"))
        }
        var conflicts: [String] = []
        let records = o.unflatten ? flatRows.map { unflatten($0, conflicts: &conflicts) } : flatRows.map { JSONValue.object($0) }
        if !conflicts.isEmpty {
            let list = conflicts.prefix(3).joined(separator: lang.t("、", ", "))
            result.warnings.append(lang.t("以下列名与其它列的嵌套结构冲突，保持原样：\(list)", "These columns conflict with nested columns and were kept flat: \(list)"))
        }
        result.value = .array(records)
        result.json = JSON.print(result.value, JSON.PrintOptions(indent: o.indent))
        result.table = Table(headers: allHeaders, rows: flatRows.prefix(tableLimit).map { r in
            var byKey: [String: JSONValue] = [:]
            for m in r { byKey[m.key] = m.value }
            return allHeaders.map { byKey[$0].map(display) ?? "" }
        })
        return result
    }
}
