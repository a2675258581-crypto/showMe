import Foundation

// 有序 JSON：自研解析器 + 打印器。
// - 对象保留键的原始顺序（JSONSerialization 做不到），数字按原文保存，大数不丢精度
// - 宽松模式（JSON5 风格）：注释、尾随逗号、单引号、无引号键名、十六进制、NaN / Infinity
// - 错误带 1 起始的行列与中英文说明

public indirect enum JSONValue: Sendable, Hashable {
    case object([JSONMember])
    case array([JSONValue])
    case string(String)
    /// 规范化后的 JSON 数字原文，如 "12345678901234567890"、"1.5e10"
    case number(String)
    case bool(Bool)
    case null

    public subscript(key: String) -> JSONValue? {
        if case .object(let members) = self { return members.last(where: { $0.key == key })?.value }
        return nil
    }

    public subscript(index: Int) -> JSONValue? {
        if case .array(let items) = self, items.indices.contains(index) { return items[index] }
        return nil
    }

    public var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    public var members: [JSONMember]? {
        if case .object(let m) = self { return m }
        return nil
    }

    public var items: [JSONValue]? {
        if case .array(let a) = self { return a }
        return nil
    }

    public var isContainer: Bool {
        switch self {
        case .object, .array: true
        default: false
        }
    }

    /// 把标量转成适合放进 CSV / XML 文本的字符串（字符串不带引号）。
    public var scalarText: String {
        switch self {
        case .string(let s): s
        case .number(let n): n
        case .bool(let b): b ? "true" : "false"
        case .null: "null"
        case .object, .array: JSON.print(self, .minified)
        }
    }
}

public struct JSONMember: Sendable, Hashable {
    public var key: String
    public var value: JSONValue

    public init(_ key: String, _ value: JSONValue) {
        self.key = key
        self.value = value
    }
}

public struct JSONParseError: Error, Sendable, Hashable {
    public var message: LocalizedText
    /// 1 起始
    public var line: Int
    /// 1 起始，按 Unicode 标量计
    public var column: Int
    /// UTF-8 字节偏移
    public var offset: Int
    /// 打开宽松模式能修好这个错误时为 true
    public var fixableByLenient: Bool

    public func toolError(_ lang: Lang) -> ToolError {
        var text = lang.t("第 \(line) 行第 \(column) 列：", "Line \(line), column \(column): ") + message(lang)
        if fixableByLenient {
            text += lang.t("（打开「宽松模式」可自动修复）", " (turn on Lenient mode to fix it automatically)")
        }
        return ToolError(text, line: line, column: column)
    }
}

/// 宽松模式下自动修复的问题计数。
public struct JSONLenientFixes: Sendable, Hashable {
    public var comments = 0
    public var trailingCommas = 0
    public var singleQuotes = 0
    public var unquotedKeys = 0
    public var hexNumbers = 0
    public var nonFinite = 0
    public var otherNumbers = 0

    public init() {}

    public var total: Int { comments + trailingCommas + singleQuotes + unquotedKeys + hexNumbers + nonFinite + otherNumbers }

    public func summary(_ lang: Lang) -> String {
        var parts: [String] = []
        if comments > 0 { parts.append(lang.t("注释 \(comments) 处", "\(comments) comment(s)")) }
        if trailingCommas > 0 { parts.append(lang.t("尾随逗号 \(trailingCommas) 处", "\(trailingCommas) trailing comma(s)")) }
        if singleQuotes > 0 { parts.append(lang.t("单引号 \(singleQuotes) 处", "\(singleQuotes) single-quoted string(s)")) }
        if unquotedKeys > 0 { parts.append(lang.t("无引号键名 \(unquotedKeys) 处", "\(unquotedKeys) unquoted key(s)")) }
        if hexNumbers > 0 { parts.append(lang.t("十六进制数 \(hexNumbers) 处", "\(hexNumbers) hex number(s)")) }
        if nonFinite > 0 { parts.append(lang.t("NaN / Infinity \(nonFinite) 处（已改为 null）", "\(nonFinite) NaN / Infinity (now null)")) }
        if otherNumbers > 0 { parts.append(lang.t("不规范数字 \(otherNumbers) 处", "\(otherNumbers) non-standard number(s)")) }
        return parts.joined(separator: lang.t("、", ", "))
    }
}

public struct JSONParseResult: Sendable, Hashable {
    public var value: JSONValue
    public var fixes: JSONLenientFixes
    /// 同一对象里重复出现的键（只记第一次重复的键名）
    public var duplicateKeys: [String]
}

public enum JSON {
    public static let maxDepth = 1000

    public static func parse(_ text: String, lenient: Bool = false) throws -> JSONParseResult {
        var p = JSONParser(Array(text.utf8), lenient: lenient)
        return try p.parseDocument()
    }

    /// 只要值，不关心宽松修复统计。
    public static func value(_ text: String, lenient: Bool = false) throws -> JSONValue {
        try parse(text, lenient: lenient).value
    }

    // MARK: 打印

    public enum Indent: Sendable, Hashable {
        case spaces(Int)
        case tab
        /// 压缩成一行
        case none
    }

    public struct PrintOptions: Sendable, Hashable {
        public var indent: Indent
        public var sortKeys: Bool
        /// 非 ASCII 字符输出为 \uXXXX
        public var escapeUnicode: Bool

        public init(indent: Indent = .spaces(2), sortKeys: Bool = false, escapeUnicode: Bool = false) {
            self.indent = indent
            self.sortKeys = sortKeys
            self.escapeUnicode = escapeUnicode
        }

        public static let pretty = PrintOptions()
        public static let minified = PrintOptions(indent: .none)
    }

    public static func print(_ value: JSONValue, _ options: PrintOptions = .pretty) -> String {
        var out = ""
        let unit: String
        switch options.indent {
        case .spaces(let n): unit = String(repeating: " ", count: max(0, n))
        case .tab: unit = "\t"
        case .none: unit = ""
        }
        write(value, into: &out, depth: 0, unit: unit, pretty: options.indent != .none, options: options)
        return out
    }

    private static func write(_ value: JSONValue, into out: inout String, depth: Int, unit: String, pretty: Bool, options: PrintOptions) {
        switch value {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .number(let n): out += n
        case .string(let s): out += quote(s, escapeUnicode: options.escapeUnicode)
        case .array(let items):
            if items.isEmpty { out += "[]"; return }
            out += "["
            for (i, item) in items.enumerated() {
                if i > 0 { out += "," }
                if pretty { out += "\n" + String(repeating: unit, count: depth + 1) }
                write(item, into: &out, depth: depth + 1, unit: unit, pretty: pretty, options: options)
            }
            if pretty { out += "\n" + String(repeating: unit, count: depth) }
            out += "]"
        case .object(let members):
            if members.isEmpty { out += "{}"; return }
            let list = options.sortKeys ? stableSorted(members) : members
            out += "{"
            for (i, m) in list.enumerated() {
                if i > 0 { out += "," }
                if pretty { out += "\n" + String(repeating: unit, count: depth + 1) }
                out += quote(m.key, escapeUnicode: options.escapeUnicode)
                out += pretty ? ": " : ":"
                write(m.value, into: &out, depth: depth + 1, unit: unit, pretty: pretty, options: options)
            }
            if pretty { out += "\n" + String(repeating: unit, count: depth) }
            out += "}"
        }
    }

    private static func stableSorted(_ members: [JSONMember]) -> [JSONMember] {
        members.enumerated()
            .sorted { a, b in
                let ka = Array(a.element.key.utf16), kb = Array(b.element.key.utf16)
                return ka == kb ? a.offset < b.offset : ka.lexicographicallyPrecedes(kb)
            }
            .map(\.element)
    }

    /// 把字符串转成 JSON 字符串字面量（带双引号）。
    public static func quote(_ s: String, escapeUnicode: Bool = false) -> String {
        var out = "\""
        out.reserveCapacity(s.utf8.count + 2)
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if scalar.value < 0x20 || scalar.value == 0x2028 || scalar.value == 0x2029 {
                    out += String(format: "\\u%04x", scalar.value)
                } else if escapeUnicode && scalar.value > 0x7E {
                    for unit in String(scalar).utf16 { out += String(format: "\\u%04x", unit) }
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
        return out
    }
}

// MARK: - 解析器

private struct JSONParser {
    let bytes: [UInt8]
    let lenient: Bool
    var pos = 0
    var depth = 0
    var fixes = JSONLenientFixes()
    var duplicates: [String] = []

    init(_ bytes: [UInt8], lenient: Bool) {
        self.bytes = bytes
        self.lenient = lenient
        // 跳过 UTF-8 BOM
        if bytes.starts(with: [0xEF, 0xBB, 0xBF]) { pos = 3 }
    }

    mutating func parseDocument() throws -> JSONParseResult {
        try skipSpace()
        if pos >= bytes.count { throw fail(LocalizedText("内容为空", "The input is empty")) }
        let value = try parseValue()
        try skipSpace()
        if pos < bytes.count {
            throw fail(LocalizedText(
                "JSON 值结束后还有多余的内容 \(describe(at: pos))",
                "Unexpected \(describe(at: pos, lang: .en)) after the JSON value"
            ))
        }
        return JSONParseResult(value: value, fixes: fixes, duplicateKeys: duplicates)
    }

    // MARK: 错误

    func location(_ offset: Int) -> (line: Int, column: Int) {
        var line = 1, col = 1
        var i = 0
        let end = min(offset, bytes.count)
        while i < end {
            let b = bytes[i]
            if b == 0x0A {
                line += 1; col = 1
            } else if b == 0x0D {
                if i + 1 < end, bytes[i + 1] == 0x0A { i += 1 }
                line += 1; col = 1
            } else if b & 0xC0 != 0x80 {
                col += 1
            }
            i += 1
        }
        return (line, col)
    }

    func fail(_ message: LocalizedText, at offset: Int? = nil, fixable: Bool = false) -> JSONParseError {
        let o = offset ?? pos
        let (line, col) = location(o)
        return JSONParseError(message: message, line: line, column: col, offset: o, fixableByLenient: fixable)
    }

    /// 描述某个位置上的字符，如 “}”、换行、文件结尾
    func describe(at offset: Int, lang: Lang = .zh) -> String {
        guard offset < bytes.count else { return lang.t("文件结尾", "end of input") }
        let b = bytes[offset]
        switch b {
        case 0x0A, 0x0D: return lang.t("换行", "a line break")
        case 0x09: return lang.t("Tab 字符", "a tab")
        case 0x20: return lang.t("空格", "a space")
        default:
            var end = offset + 1
            while end < bytes.count, bytes[end] & 0xC0 == 0x80 { end += 1 }
            let ch = String(decoding: bytes[offset..<end], as: UTF8.self)
            return lang == .zh ? "“\(ch)”" : "'\(ch)'"
        }
    }

    func unexpected(_ expected: LocalizedText) -> JSONParseError {
        if pos >= bytes.count {
            return fail(LocalizedText("意外的结尾，缺少\(expected.zh)", "Unexpected end of input, expected \(expected.en)"))
        }
        return fail(LocalizedText(
            "意外的字符 \(describe(at: pos))，这里应该是\(expected.zh)",
            "Unexpected \(describe(at: pos, lang: .en)), expected \(expected.en)"
        ))
    }

    // MARK: 空白与注释

    mutating func skipSpace() throws {
        while pos < bytes.count {
            let b = bytes[pos]
            if b == 0x20 || b == 0x0A || b == 0x0D || b == 0x09 {
                pos += 1
            } else if b == 0x2F, pos + 1 < bytes.count, bytes[pos + 1] == 0x2F || bytes[pos + 1] == 0x2A {
                guard lenient else {
                    throw fail(LocalizedText("标准 JSON 不允许注释", "Comments are not allowed in standard JSON"), fixable: true)
                }
                fixes.comments += 1
                if bytes[pos + 1] == 0x2F {
                    while pos < bytes.count, bytes[pos] != 0x0A { pos += 1 }
                } else {
                    let start = pos
                    pos += 2
                    while pos + 1 < bytes.count, !(bytes[pos] == 0x2A && bytes[pos + 1] == 0x2F) { pos += 1 }
                    guard pos + 1 < bytes.count else {
                        throw fail(LocalizedText("块注释没有闭合（缺少 */）", "Unterminated block comment (missing */)"), at: start)
                    }
                    pos += 2
                }
            } else if lenient, b == 0xEF, pos + 2 < bytes.count, bytes[pos + 1] == 0xBB, bytes[pos + 2] == 0xBF {
                pos += 3
            } else if lenient, b == 0xC2, pos + 1 < bytes.count, bytes[pos + 1] == 0xA0 {
                pos += 2 // 不换行空格
            } else {
                return
            }
        }
    }

    // MARK: 值

    mutating func parseValue() throws -> JSONValue {
        guard pos < bytes.count else { throw unexpected(LocalizedText("一个值", "a value")) }
        switch bytes[pos] {
        case UInt8(ascii: "{"): return try parseObject()
        case UInt8(ascii: "["): return try parseArray()
        case UInt8(ascii: "\""): return .string(try parseString(quote: 0x22))
        case UInt8(ascii: "'"):
            guard lenient else {
                throw fail(LocalizedText("字符串必须用双引号", "Strings must use double quotes"), fixable: true)
            }
            fixes.singleQuotes += 1
            return .string(try parseString(quote: 0x27))
        case UInt8(ascii: "-"), UInt8(ascii: "+"), UInt8(ascii: "."), UInt8(ascii: "0")...UInt8(ascii: "9"):
            return try parseNumber()
        default:
            if let word = matchWord() {
                switch word {
                case "true": return .bool(true)
                case "false": return .bool(false)
                case "null": return .null
                case "NaN", "Infinity":
                    if lenient { fixes.nonFinite += 1; return .null }
                    throw fail(LocalizedText("JSON 不支持 \(word)", "\(word) is not valid JSON"), at: pos - word.utf8.count, fixable: true)
                case "True", "False", "None", "undefined", "TRUE", "FALSE", "NULL", "nil":
                    let hint = ["True": "true", "TRUE": "true", "False": "false", "FALSE": "false"][word] ?? "null"
                    throw fail(
                        LocalizedText("“\(word)” 不是合法的 JSON 值，应该写成 \(hint)", "'\(word)' is not a JSON value; use \(hint)"),
                        at: pos - word.utf8.count
                    )
                default:
                    pos -= word.utf8.count
                }
            }
            throw unexpected(LocalizedText("一个值（对象、数组、字符串、数字、true、false 或 null）", "a value (object, array, string, number, true, false or null)"))
        }
    }

    /// 读一个由字母数字下划线 $ 组成的单词（用于字面量与无引号键名）
    mutating func matchWord() -> String? {
        let start = pos
        while pos < bytes.count {
            let b = bytes[pos]
            let isWord = (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || b == 0x5F || b == 0x24 || b >= 0x80
            if !isWord { break }
            pos += 1
        }
        return pos > start ? String(decoding: bytes[start..<pos], as: UTF8.self) : nil
    }

    mutating func enter() throws {
        depth += 1
        if depth > JSON.maxDepth {
            throw fail(LocalizedText("嵌套层级超过 \(JSON.maxDepth) 层", "Nesting is deeper than \(JSON.maxDepth) levels"))
        }
    }

    mutating func parseObject() throws -> JSONValue {
        try enter()
        defer { depth -= 1 }
        let open = pos
        pos += 1
        var members: [JSONMember] = []
        var seen = Set<String>()
        try skipSpace()
        if pos < bytes.count, bytes[pos] == UInt8(ascii: "}") {
            pos += 1
            return .object([])
        }
        while true {
            try skipSpace()
            guard pos < bytes.count else {
                throw fail(LocalizedText("对象没有闭合（缺少 }），对象从这里开始", "Unclosed object (missing }) that starts here"), at: open)
            }
            let key: String
            let b = bytes[pos]
            if b == UInt8(ascii: "\"") {
                key = try parseString(quote: 0x22)
            } else if b == UInt8(ascii: "'") {
                guard lenient else {
                    throw fail(LocalizedText("键名必须用双引号", "Property names must use double quotes"), fixable: true)
                }
                fixes.singleQuotes += 1
                key = try parseString(quote: 0x27)
            } else if b == UInt8(ascii: "}") {
                // 尾随逗号：{"a":1,}
                guard lenient else {
                    throw fail(LocalizedText("对象末尾多了一个逗号", "Trailing comma in object"), fixable: true)
                }
                fixes.trailingCommas += 1
                pos += 1
                return .object(members)
            } else if let word = matchWord() {
                guard lenient else {
                    throw fail(
                        LocalizedText("键名 \(word) 必须用双引号包起来", "Property name \(word) must be wrapped in double quotes"),
                        at: pos - word.utf8.count, fixable: true
                    )
                }
                fixes.unquotedKeys += 1
                key = word
            } else {
                throw unexpected(LocalizedText("用双引号包起来的键名", "a double-quoted property name"))
            }
            try skipSpace()
            guard pos < bytes.count, bytes[pos] == UInt8(ascii: ":") else {
                throw unexpected(LocalizedText("冒号 “:”", "':'"))
            }
            pos += 1
            try skipSpace()
            let value = try parseValue()
            if !seen.insert(key).inserted, !duplicates.contains(key) { duplicates.append(key) }
            members.append(JSONMember(key, value))
            try skipSpace()
            guard pos < bytes.count else {
                throw fail(LocalizedText("对象没有闭合（缺少 }），对象从这里开始", "Unclosed object (missing }) that starts here"), at: open)
            }
            if bytes[pos] == UInt8(ascii: ",") {
                pos += 1
                continue
            }
            if bytes[pos] == UInt8(ascii: "}") {
                pos += 1
                return .object(members)
            }
            if bytes[pos] == UInt8(ascii: "\"") {
                throw fail(LocalizedText("缺少逗号：上一个键值对后面要加 “,”", "Missing ',' after the previous property"))
            }
            throw unexpected(LocalizedText("逗号 “,” 或 “}”", "',' or '}'"))
        }
    }

    mutating func parseArray() throws -> JSONValue {
        try enter()
        defer { depth -= 1 }
        let open = pos
        pos += 1
        var items: [JSONValue] = []
        try skipSpace()
        if pos < bytes.count, bytes[pos] == UInt8(ascii: "]") {
            pos += 1
            return .array([])
        }
        while true {
            try skipSpace()
            guard pos < bytes.count else {
                throw fail(LocalizedText("数组没有闭合（缺少 ]），数组从这里开始", "Unclosed array (missing ]) that starts here"), at: open)
            }
            if bytes[pos] == UInt8(ascii: "]") {
                guard lenient else {
                    throw fail(LocalizedText("数组末尾多了一个逗号", "Trailing comma in array"), fixable: true)
                }
                fixes.trailingCommas += 1
                pos += 1
                return .array(items)
            }
            items.append(try parseValue())
            try skipSpace()
            guard pos < bytes.count else {
                throw fail(LocalizedText("数组没有闭合（缺少 ]），数组从这里开始", "Unclosed array (missing ]) that starts here"), at: open)
            }
            if bytes[pos] == UInt8(ascii: ",") {
                pos += 1
                continue
            }
            if bytes[pos] == UInt8(ascii: "]") {
                pos += 1
                return .array(items)
            }
            throw unexpected(LocalizedText("逗号 “,” 或 “]”", "',' or ']'"))
        }
    }

    mutating func parseString(quote: UInt8) throws -> String {
        let start = pos
        pos += 1
        var buf: [UInt8] = []
        var runStart = pos
        while true {
            guard pos < bytes.count else {
                throw fail(LocalizedText("字符串没有闭合（缺少引号），字符串从这里开始", "Unterminated string that starts here"), at: start)
            }
            let b = bytes[pos]
            if b == quote {
                buf.append(contentsOf: bytes[runStart..<pos])
                pos += 1
                return String(decoding: buf, as: UTF8.self)
            }
            if b == 0x5C {
                buf.append(contentsOf: bytes[runStart..<pos])
                try parseEscape(into: &buf)
                runStart = pos
                continue
            }
            if b < 0x20 {
                if b == 0x0A || b == 0x0D {
                    throw fail(LocalizedText("字符串里不能直接换行（写成 \\n），或者缺少右引号", "Line break inside a string (use \\n) or missing closing quote"))
                }
                if !lenient {
                    throw fail(LocalizedText("字符串里的控制字符必须转义", "Control characters in strings must be escaped"), fixable: true)
                }
            }
            pos += 1
        }
    }

    mutating func parseEscape(into buf: inout [UInt8]) throws {
        let start = pos
        pos += 1
        guard pos < bytes.count else {
            throw fail(LocalizedText("转义符 \\ 后面缺少字符", "Incomplete escape sequence"), at: start)
        }
        let c = bytes[pos]
        pos += 1
        switch c {
        case UInt8(ascii: "\""): buf.append(0x22)
        case UInt8(ascii: "\\"): buf.append(0x5C)
        case UInt8(ascii: "/"): buf.append(0x2F)
        case UInt8(ascii: "b"): buf.append(0x08)
        case UInt8(ascii: "f"): buf.append(0x0C)
        case UInt8(ascii: "n"): buf.append(0x0A)
        case UInt8(ascii: "r"): buf.append(0x0D)
        case UInt8(ascii: "t"): buf.append(0x09)
        case UInt8(ascii: "'") where lenient: buf.append(0x27)
        case UInt8(ascii: "u"):
            var scalar = try readHex4(start: start)
            if (0xD800...0xDBFF).contains(scalar) {
                // 代理对
                if pos + 1 < bytes.count, bytes[pos] == 0x5C, bytes[pos + 1] == UInt8(ascii: "u") {
                    let save = pos
                    pos += 2
                    let low = try readHex4(start: save)
                    if (0xDC00...0xDFFF).contains(low) {
                        scalar = 0x10000 + ((scalar - 0xD800) << 10) + (low - 0xDC00)
                    } else {
                        pos = save
                        scalar = 0xFFFD
                    }
                } else {
                    scalar = 0xFFFD
                }
            } else if (0xDC00...0xDFFF).contains(scalar) {
                scalar = 0xFFFD
            }
            buf.append(contentsOf: Array(String(Unicode.Scalar(scalar) ?? "\u{FFFD}").utf8))
        default:
            throw fail(LocalizedText(
                "无效的转义 \\\(String(decoding: [c], as: UTF8.self))",
                "Invalid escape sequence \\\(String(decoding: [c], as: UTF8.self))"
            ), at: start)
        }
    }

    mutating func readHex4(start: Int) throws -> UInt32 {
        guard pos + 4 <= bytes.count else {
            throw fail(LocalizedText("\\u 后面需要 4 位十六进制数", "\\u must be followed by 4 hex digits"), at: start)
        }
        var v: UInt32 = 0
        for _ in 0..<4 {
            let b = bytes[pos]
            let d: UInt32
            switch b {
            case 0x30...0x39: d = UInt32(b - 0x30)
            case 0x41...0x46: d = UInt32(b - 0x41 + 10)
            case 0x61...0x66: d = UInt32(b - 0x61 + 10)
            default:
                throw fail(LocalizedText("\\u 后面需要 4 位十六进制数", "\\u must be followed by 4 hex digits"), at: start)
            }
            v = v * 16 + d
            pos += 1
        }
        return v
    }

    mutating func parseNumber() throws -> JSONValue {
        let start = pos
        var negative = false
        if bytes[pos] == UInt8(ascii: "+") {
            guard lenient else { throw fail(LocalizedText("数字前面不能有 +", "Numbers cannot start with '+'"), fixable: true) }
            fixes.otherNumbers += 1
            pos += 1
        } else if bytes[pos] == UInt8(ascii: "-") {
            negative = true
            pos += 1
        }
        // Infinity / -Infinity
        if pos < bytes.count, bytes[pos] == UInt8(ascii: "I") {
            if let word = matchWord(), word == "Infinity" {
                if lenient { fixes.nonFinite += 1; return .null }
                throw fail(LocalizedText("JSON 不支持 Infinity", "Infinity is not valid JSON"), at: start, fixable: true)
            }
            throw fail(LocalizedText("无效的数字", "Invalid number"), at: start)
        }
        // 十六进制
        if pos + 1 < bytes.count, bytes[pos] == UInt8(ascii: "0"), bytes[pos + 1] | 0x20 == UInt8(ascii: "x") {
            guard lenient else { throw fail(LocalizedText("JSON 不支持十六进制数", "Hex numbers are not valid JSON"), at: start, fixable: true) }
            pos += 2
            let digitsStart = pos
            while pos < bytes.count, isHex(bytes[pos]) { pos += 1 }
            let hex = String(decoding: bytes[digitsStart..<pos], as: UTF8.self)
            guard !hex.isEmpty else { throw fail(LocalizedText("无效的十六进制数", "Invalid hex number"), at: start) }
            fixes.hexNumbers += 1
            let decimal = BigDecimalString.fromHex(hex)
            return .number(negative && decimal != "0" ? "-" + decimal : decimal)
        }
        var intPart = ""
        while pos < bytes.count, isDigit(bytes[pos]) {
            intPart.unicodeScalars.append(Unicode.Scalar(bytes[pos]))
            pos += 1
        }
        var fracPart: String?
        if pos < bytes.count, bytes[pos] == UInt8(ascii: ".") {
            pos += 1
            var f = ""
            while pos < bytes.count, isDigit(bytes[pos]) {
                f.unicodeScalars.append(Unicode.Scalar(bytes[pos]))
                pos += 1
            }
            fracPart = f
        }
        var expPart: String?
        if pos < bytes.count, bytes[pos] | 0x20 == UInt8(ascii: "e") {
            pos += 1
            var e = ""
            if pos < bytes.count, bytes[pos] == UInt8(ascii: "+") || bytes[pos] == UInt8(ascii: "-") {
                e.unicodeScalars.append(Unicode.Scalar(bytes[pos]))
                pos += 1
            }
            var digits = 0
            while pos < bytes.count, isDigit(bytes[pos]) {
                e.unicodeScalars.append(Unicode.Scalar(bytes[pos]))
                pos += 1
                digits += 1
            }
            guard digits > 0 else { throw fail(LocalizedText("指数部分缺少数字", "Exponent has no digits"), at: start) }
            expPart = e
        }
        if intPart.isEmpty && (fracPart ?? "").isEmpty {
            throw fail(LocalizedText("无效的数字", "Invalid number"), at: start)
        }
        var nonStandard = false
        if intPart.isEmpty { intPart = "0"; nonStandard = true } // .5
        if intPart.count > 1, intPart.hasPrefix("0") {
            guard lenient else {
                throw fail(LocalizedText("数字不能以 0 开头（如 012）", "Numbers cannot have leading zeros"), at: start, fixable: true)
            }
            nonStandard = true
            intPart = String(intPart.drop(while: { $0 == "0" }))
            if intPart.isEmpty { intPart = "0" }
        }
        if let f = fracPart, f.isEmpty { fracPart = nil; nonStandard = true } // 5.
        if nonStandard {
            guard lenient else { throw fail(LocalizedText("不规范的数字写法", "Non-standard number"), at: start, fixable: true) }
            fixes.otherNumbers += 1
        }
        var raw = (negative ? "-" : "") + intPart
        if let f = fracPart { raw += "." + f }
        if let e = expPart { raw += "e" + e }
        if peekWordChar() == true {
            throw fail(LocalizedText("无效的数字", "Invalid number"), at: start)
        }
        return .number(raw)
    }

    func peekWordChar() -> Bool? {
        guard pos < bytes.count else { return nil }
        let b = bytes[pos]
        return (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || b == 0x5F
    }

    func isDigit(_ b: UInt8) -> Bool { b >= 0x30 && b <= 0x39 }
    func isHex(_ b: UInt8) -> Bool { isDigit(b) || (b | 0x20 >= 0x61 && b | 0x20 <= 0x66) }
}

/// 任意长度的十六进制 → 十进制字符串（不丢精度）
enum BigDecimalString {
    static func fromHex(_ hex: String) -> String {
        var digits: [UInt8] = [0] // 十进制，低位在前
        for ch in hex.lowercased() {
            guard let v = ch.hexDigitValue else { continue }
            var carry = v
            for i in digits.indices {
                let x = Int(digits[i]) * 16 + carry
                digits[i] = UInt8(x % 10)
                carry = x / 10
            }
            while carry > 0 {
                digits.append(UInt8(carry % 10))
                carry /= 10
            }
        }
        while digits.count > 1, digits.last == 0 { digits.removeLast() }
        return String(digits.reversed().map { Character(String($0)) })
    }
}
