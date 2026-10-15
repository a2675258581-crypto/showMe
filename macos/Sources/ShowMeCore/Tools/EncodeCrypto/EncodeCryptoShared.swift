import Foundation

// 本批工具共用的小工具：行列定位、字段解码、问题列表转提示。

/// 按 Unicode 标量下标求 1 起的行列号；按递增顺序查询时接着上次的位置数，长文本也是线性时间
struct LineLocator {
    let scalars: [Unicode.Scalar]
    private var pos = 0
    private var line = 1
    private var column = 1

    init(_ scalars: [Unicode.Scalar]) { self.scalars = scalars }
    init(_ text: String) { self.scalars = Array(text.unicodeScalars) }

    mutating func locate(_ index: Int) -> (line: Int, column: Int) {
        let target = min(max(index, 0), scalars.count)
        if target < pos { pos = 0; line = 1; column = 1 }
        while pos < target {
            if scalars[pos] == "\n" { line += 1; column = 1 } else { column += 1 }
            pos += 1
        }
        return (line, column)
    }
}

/// 解码过程中发现的问题（带位置）
struct CodecIssue: Sendable, Hashable {
    var index: Int
    var line: Int
    var column: Int
    var text: String
    var message: LocalizedText
    var isWarning: Bool = true
}

/// 收集问题，最多 200 条
struct IssueCollector {
    static let limit = 200
    var locator: LineLocator
    var issues: [CodecIssue] = []

    init(_ scalars: [Unicode.Scalar]) { locator = LineLocator(scalars) }

    mutating func add(_ index: Int, _ length: Int, _ message: LocalizedText, warning: Bool = true) {
        guard issues.count < IssueCollector.limit else { return }
        let (line, column) = locator.locate(index)
        let s = locator.scalars
        let end = min(s.count, index + length)
        var text = ""
        if index < end { EncodeCryptoShared.append(s[index..<end], to: &text.unicodeScalars) }
        issues.append(CodecIssue(index: index, line: line, column: column, text: text, message: message, isWarning: warning))
    }
}

enum EncodeCryptoShared {
    /// 逐个追加标量：标准库的 UnicodeScalarView.append(contentsOf:) 在长字符串上反复调用会退化成近似平方复杂度
    @inline(__always) static func append<S: Sequence>(_ seq: S, to out: inout String.UnicodeScalarView) where S.Element == Unicode.Scalar {
        for c in seq { out.append(c) }
    }

    static func string<S: Sequence>(_ seq: S) -> String where S.Element == Unicode.Scalar {
        var v = String.UnicodeScalarView()
        for c in seq { v.append(c) }
        return String(v)
    }

    @inline(__always) static func isASCIILetter(_ s: Unicode.Scalar) -> Bool {
        (s.value >= 0x41 && s.value <= 0x5A) || (s.value >= 0x61 && s.value <= 0x7A)
    }

    /// 把问题列表变成最多 5 条提示，其余合并为一条
    static func notes(_ issues: [CodecIssue], lang: Lang, title: LocalizedText? = nil) -> [ToolNote] {
        guard !issues.isEmpty else { return [] }
        var notes: [ToolNote] = []
        if let title {
            let count = issues.count >= IssueCollector.limit ? "200+" : "\(issues.count)"
            notes.append(ToolNote(issues.contains(where: \.isWarning) ? .warning : .info, lang.t("\(title.zh)（\(count) 处）", "\(title.en) (\(count))")))
        }
        for i in issues.prefix(5) {
            notes.append(ToolNote(i.isWarning ? .warning : .info,
                                  lang.t("第 \(i.line) 行第 \(i.column) 列：", "Line \(i.line), column \(i.column): ") + i.message(lang)))
        }
        if issues.count > 5 {
            notes.append(ToolNote(.info, lang.t("…还有 \(issues.count - 5) 处", "…and \(issues.count - 5) more")))
        }
        return notes
    }

    /// 按编码把字段文本转成字节，出错时给出带字段名的双语错误
    static func decodeField(_ text: String, _ encoding: ByteEncoding, field: LocalizedText, lang: Lang) throws -> [UInt8] {
        do {
            return try encoding.decode(text)
        } catch let e as ByteDecodeError {
            throw ToolError(lang.t("\(field.zh)：", "\(field.en): ") + e.message(lang))
        }
    }

    static func choice<T: RawRepresentable>(_ input: ToolInput, _ id: String, default fallback: T) -> T where T.RawValue == String {
        T(rawValue: input.string(id)) ?? fallback
    }

    /// 字节数的可读写法
    static func formatBytes(_ n: Int, lang: Lang) -> String {
        if n < 1024 { return lang.t("\(n) 字节", "\(n) bytes") }
        if n < 1024 * 1024 { return String(format: "%.1f KB", Double(n) / 1024) }
        return String(format: "%.1f MB", Double(n) / 1024 / 1024)
    }

    /// 字符的可读描述：“*”（U+002A）；不可见字符写成 U+200B（不可见字符）
    static func describeChar(_ s: Unicode.Scalar) -> LocalizedText {
        let hex = String(format: "U+%04X", s.value)
        switch s.properties.generalCategory {
        case .control, .format, .surrogate, .privateUse, .unassigned, .spaceSeparator, .lineSeparator, .paragraphSeparator:
            return LocalizedText("\(hex)（不可见字符）", "\(hex) (invisible)")
        default:
            return LocalizedText("“\(s)”（\(hex)）", "“\(s)” (\(hex))")
        }
    }
}
