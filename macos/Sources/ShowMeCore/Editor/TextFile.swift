import Foundation

// 文本文件读写：编码识别（BOM → 严格 UTF-8 → GB18030（仅 macOS）→ Latin-1）、换行符识别与转换、
// 二进制判断、缩进识别。编辑器内部统一用 LF，保存时再按原换行符写回。

// MARK: - 换行符

public enum LineEnding: String, Codable, Sendable, CaseIterable {
    case lf, crlf, cr

    /// 换行符本身
    public var sequence: String {
        switch self {
        case .lf: "\n"
        case .crlf: "\r\n"
        case .cr: "\r"
        }
    }

    /// 状态栏显示：LF / CRLF / CR
    public var displayName: String {
        switch self {
        case .lf: "LF"
        case .crlf: "CRLF"
        case .cr: "CR"
        }
    }

    /// 菜单里的说明
    public func description(_ lang: Lang) -> String {
        switch self {
        case .lf: lang.t("LF（macOS / Linux）", "LF (macOS / Linux)")
        case .crlf: lang.t("CRLF（Windows）", "CRLF (Windows)")
        case .cr: lang.t("CR（经典 Mac OS）", "CR (Classic Mac OS)")
        }
    }

    /// 各种换行符的个数
    public static func counts(_ text: String) -> (lf: Int, crlf: Int, cr: Int) {
        var lf = 0, crlf = 0, cr = 0
        var previousCR = false
        for byte in text.utf8 {
            if byte == 0x0A {
                if previousCR { crlf += 1; cr -= 1 } else { lf += 1 }
                previousCR = false
            } else if byte == 0x0D {
                cr += 1
                previousCR = true
            } else {
                previousCR = false
            }
        }
        return (lf, crlf, cr)
    }

    /// 识别换行符：取出现最多的一种；并列时取最先出现的；没有换行时为 LF。
    public static func detect(_ text: String) -> LineEnding {
        var lf = 0, crlf = 0, cr = 0
        var first: LineEnding? = nil
        let bytes = text.utf8
        var index = bytes.startIndex
        while index != bytes.endIndex {
            let byte = bytes[index]
            bytes.formIndex(after: &index)
            if byte == 0x0A {
                lf += 1
                if first == nil { first = .lf }
            } else if byte == 0x0D {
                if index != bytes.endIndex && bytes[index] == 0x0A {
                    crlf += 1
                    bytes.formIndex(after: &index)
                    if first == nil { first = .crlf }
                } else {
                    cr += 1
                    if first == nil { first = .cr }
                }
            }
        }
        let best = max(lf, crlf, cr)
        guard best > 0 else { return .lf }
        var tied: [LineEnding] = []
        if lf == best { tied.append(.lf) }
        if crlf == best { tied.append(.crlf) }
        if cr == best { tied.append(.cr) }
        if tied.count == 1 { return tied[0] }
        return first.flatMap { tied.contains($0) ? $0 : nil } ?? tied[0]
    }

    /// 是否混用了多种换行符
    public static func isMixed(_ text: String) -> Bool {
        let c = counts(text)
        return [c.lf, c.crlf, c.cr].filter { $0 > 0 }.count > 1
    }

    /// 全部换行统一成 LF
    public static func normalize(_ text: String) -> String {
        guard text.utf8.contains(0x0D) else { return text }
        var out: [UInt8] = []
        out.reserveCapacity(text.utf8.count)
        var previousCR = false
        for byte in text.utf8 {
            if byte == 0x0D {
                out.append(0x0A)
                previousCR = true
            } else if byte == 0x0A {
                if !previousCR { out.append(0x0A) }
                previousCR = false
            } else {
                out.append(byte)
                previousCR = false
            }
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// 把文本（任意换行符）转换成指定换行符，保存前调用
    public static func apply(_ lineEnding: LineEnding, to text: String) -> String {
        if lineEnding == .lf { return normalize(text) }
        let utf8 = text.utf8
        guard utf8.contains(0x0A) || utf8.contains(0x0D) else { return text }
        let seq: [UInt8] = lineEnding == .crlf ? [0x0D, 0x0A] : [0x0D]
        var out: [UInt8] = []
        out.reserveCapacity(utf8.count + utf8.count / 16)
        var previousCR = false
        for byte in utf8 {
            if byte == 0x0D {
                out.append(contentsOf: seq)
                previousCR = true
            } else if byte == 0x0A {
                if !previousCR { out.append(contentsOf: seq) }
                previousCR = false
            } else {
                out.append(byte)
                previousCR = false
            }
        }
        return String(decoding: out, as: UTF8.self)
    }

    public func apply(to text: String) -> String {
        LineEnding.apply(self, to: text)
    }
}

// MARK: - 编码

public enum TextEncoding: String, Codable, Sendable, CaseIterable {
    case utf8
    case utf8BOM
    case utf16LE
    case utf16BE
    case gb18030
    case latin1

    public var displayName: String {
        switch self {
        case .utf8: "UTF-8"
        case .utf8BOM: "UTF-8 with BOM"
        case .utf16LE: "UTF-16 LE"
        case .utf16BE: "UTF-16 BE"
        case .gb18030: "GB18030"
        case .latin1: "Latin-1"
        }
    }

    public func displayName(_ lang: Lang) -> String {
        switch self {
        case .utf8: "UTF-8"
        case .utf8BOM: lang.t("UTF-8（带 BOM）", "UTF-8 with BOM")
        case .utf16LE: "UTF-16 LE"
        case .utf16BE: "UTF-16 BE"
        case .gb18030: lang.t("GB18030（简体中文）", "GB18030 (Simplified Chinese)")
        case .latin1: lang.t("Latin-1（西欧）", "Latin-1 (Western)")
        }
    }

    /// 当前平台能否用这种编码读写（GB18030 依赖 macOS 的 CoreFoundation）
    public var isAvailable: Bool {
        #if canImport(Darwin)
        return true
        #else
        return self != .gb18030
        #endif
    }

    /// 写文件时放在开头的 BOM（UTF-16 总是带 BOM，因为只有带 BOM 的 UTF-16 才能被识别回来）
    public var bom: [UInt8] {
        switch self {
        case .utf8BOM: [0xEF, 0xBB, 0xBF]
        case .utf16LE: [0xFF, 0xFE]
        case .utf16BE: [0xFE, 0xFF]
        default: []
        }
    }
}

// MARK: - 文件读写

public enum TextFile {
    /// 解码后的文件内容：文本已统一为 LF，并记下原编码与换行符，保存时原样写回。
    public struct Contents: Sendable, Hashable {
        public var text: String
        public var encoding: TextEncoding
        public var lineEnding: LineEnding

        public init(text: String, encoding: TextEncoding, lineEnding: LineEnding) {
            self.text = text
            self.encoding = encoding
            self.lineEnding = lineEnding
        }
    }

    /// 打开文件：识别编码与换行符，返回 LF 文本
    public static func read(_ bytes: [UInt8]) -> Contents? {
        guard let (text, encoding) = decode(bytes) else { return nil }
        return Contents(text: LineEnding.normalize(text), encoding: encoding, lineEnding: LineEnding.detect(text))
    }

    /// 保存文件：换行符转回原样再编码；无法用该编码表示时返回 nil
    public static func write(_ text: String, encoding: TextEncoding, lineEnding: LineEnding) -> [UInt8]? {
        encode(LineEnding.apply(lineEnding, to: text), as: encoding)
    }

    /// 解码：BOM → 严格 UTF-8 → GB18030（仅 macOS）→ Latin-1（任何字节都能解，所以 Linux 上总有结果）
    public static func decode(_ bytes: [UInt8]) -> (String, TextEncoding)? {
        if bytes.isEmpty { return ("", .utf8) }
        if bytes.count >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
            let body = bytes[3...]
            if isValidUTF8(body) { return (String(decoding: body, as: UTF8.self), .utf8BOM) }
        } else if bytes.count >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
            return (decodeUTF16(bytes[2...], littleEndian: true), .utf16LE)
        } else if bytes.count >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
            return (decodeUTF16(bytes[2...], littleEndian: false), .utf16BE)
        }
        if isValidUTF8(bytes) { return (String(decoding: bytes, as: UTF8.self), .utf8) }
        #if canImport(Darwin)
        if let text = String(data: Data(bytes), encoding: gb18030Encoding) { return (text, .gb18030) }
        #endif
        return (decodeLatin1(bytes), .latin1)
    }

    /// 编码；字符无法用该编码表示（如 Latin-1 遇到中文）或平台不支持时返回 nil
    public static func encode(_ s: String, as encoding: TextEncoding) -> [UInt8]? {
        switch encoding {
        case .utf8:
            return Array(s.utf8)
        case .utf8BOM:
            return encoding.bom + Array(s.utf8)
        case .utf16LE, .utf16BE:
            var out = encoding.bom
            out.reserveCapacity(2 + s.utf16.count * 2)
            let little = encoding == .utf16LE
            for unit in s.utf16 {
                let hi = UInt8(truncatingIfNeeded: unit >> 8)
                let lo = UInt8(truncatingIfNeeded: unit)
                if little { out.append(lo); out.append(hi) } else { out.append(hi); out.append(lo) }
            }
            return out
        case .gb18030:
            #if canImport(Darwin)
            guard let data = s.data(using: gb18030Encoding, allowLossyConversion: false) else { return nil }
            return [UInt8](data)
            #else
            return nil
            #endif
        case .latin1:
            var out: [UInt8] = []
            out.reserveCapacity(s.utf8.count)
            for scalar in s.unicodeScalars {
                guard scalar.value <= 0xFF else { return nil }
                out.append(UInt8(scalar.value))
            }
            return out
        }
    }

    #if canImport(Darwin)
    /// GB18030-2000 对应的 String.Encoding（Foundation 没有直接的常量）
    static let gb18030Encoding = String.Encoding(
        rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue))
    )
    #endif

    /// 严格 UTF-8 校验（拒绝过长编码、代理区、超过 U+10FFFF）
    public static func isValidUTF8<C: Collection>(_ bytes: C) -> Bool where C.Element == UInt8 {
        if let result = bytes.withContiguousStorageIfAvailable(validateUTF8) { return result }
        return Array(bytes).withUnsafeBufferPointer(validateUTF8)
    }

    private static func validateUTF8(_ p: UnsafeBufferPointer<UInt8>) -> Bool {
        let n = p.count
        var i = 0
        while i < n {
            let b0 = p[i]
            if b0 < 0x80 {
                i += 1
                continue
            }
            let need: Int
            var lo: UInt8 = 0x80
            var hi: UInt8 = 0xBF
            switch b0 {
            case 0xC2...0xDF: need = 1
            case 0xE0: need = 2; lo = 0xA0          // 过长编码
            case 0xED: need = 2; hi = 0x9F          // 代理区 U+D800–DFFF
            case 0xE1...0xEC, 0xEE...0xEF: need = 2
            case 0xF0: need = 3; lo = 0x90          // 过长编码
            case 0xF4: need = 3; hi = 0x8F          // 超过 U+10FFFF
            case 0xF1...0xF3: need = 3
            default: return false                   // 孤立续字节、C0 / C1、F5 以上
            }
            guard i + need < n else { return false } // 末尾被截断
            let b1 = p[i + 1]
            guard b1 >= lo && b1 <= hi else { return false }
            var k = 2
            while k <= need {
                guard p[i + k] & 0xC0 == 0x80 else { return false }
                k += 1
            }
            i += need + 1
        }
        return true
    }

    private static func decodeUTF16(_ bytes: ArraySlice<UInt8>, littleEndian: Bool) -> String {
        var units: [UInt16] = []
        units.reserveCapacity(bytes.count / 2)
        var i = bytes.startIndex
        while i + 1 < bytes.endIndex {
            let a = UInt16(bytes[i]), b = UInt16(bytes[i + 1])
            units.append(littleEndian ? (b << 8 | a) : (a << 8 | b))
            i += 2
        }
        // 孤立代理项会被替换成 U+FFFD；奇数长度的最后一个字节丢弃
        return String(decoding: units, as: UTF16.self)
    }

    private static func decodeLatin1(_ bytes: [UInt8]) -> String {
        var utf8: [UInt8] = []
        utf8.reserveCapacity(bytes.count + bytes.count / 4)
        for byte in bytes {
            if byte < 0x80 {
                utf8.append(byte)
            } else {
                utf8.append(0xC0 | (byte >> 6))
                utf8.append(0x80 | (byte & 0x3F))
            }
        }
        return String(decoding: utf8, as: UTF8.self)
    }

    /// 是否像二进制文件：前 8 KB 有 NUL 字节，或控制字符超过 10%。带 BOM 的 UTF-16 / UTF-8 不算。
    public static func isProbablyBinary(_ bytes: [UInt8]) -> Bool {
        guard !bytes.isEmpty else { return false }
        if bytes.count >= 2 && ((bytes[0] == 0xFF && bytes[1] == 0xFE) || (bytes[0] == 0xFE && bytes[1] == 0xFF)) {
            return false
        }
        if bytes.count >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF { return false }
        let sample = bytes.prefix(8192)
        var control = 0
        for byte in sample {
            if byte == 0 { return true }
            // 允许 \t \n \v \f \r、退格和 ESC（终端日志里的颜色码）
            if (byte < 0x20 && byte != 0x09 && byte != 0x0A && byte != 0x0B && byte != 0x0C && byte != 0x0D && byte != 0x08
                && byte != 0x1B) || byte == 0x7F {
                control += 1
            }
        }
        return control * 10 > sample.count
    }

    // MARK: 缩进

    /// 行首的空格 / 制表符
    public static func indentation<S: StringProtocol>(of line: S) -> String {
        String(line.prefix(while: { $0 == " " || $0 == "\t" }))
    }

    /// 一级缩进的字符串
    public static func indentUnit(useTabs: Bool, width: Int) -> String {
        useTabs ? "\t" : String(repeating: " ", count: max(1, width))
    }

    /// 回车后新行的缩进：沿用当前行，行尾是 { [ (（或 Python / YAML 的冒号）时再加一级
    public static func nextLineIndentation<S: StringProtocol>(after line: S, unit: String, increaseAfterColon: Bool = false) -> String {
        let indent = indentation(of: line)
        guard let last = line.last(where: { $0 != " " && $0 != "\t" }) else { return indent }
        if last == "{" || last == "[" || last == "(" || (increaseAfterColon && last == ":") {
            return indent + unit
        }
        return indent
    }

    /// 根据内容猜缩进：制表符行多于空格行 → 制表符；否则统计相邻行缩进的增量，取 2 / 4 / 8 中最常见的。
    /// 没有缩进时默认 4 个空格。只看前 10000 行。
    public static func detectIndent(_ text: String) -> (useTabs: Bool, width: Int) {
        var tabLines = 0
        var spaceLines = 0
        var deltas = [Int](repeating: 0, count: 9)
        var previous = 0
        var lines = 0
        var atLineStart = true
        var spaces = 0
        var startsWithTab = false
        var inIndent = true

        func finishLine(firstChar: UInt8?) {
            lines += 1
            guard let firstChar else { return } // 空行不影响
            if firstChar == UInt8(ascii: "*") { return } // 块注释续行「 * xxx」
            if startsWithTab {
                tabLines += 1
                previous = 0
                return
            }
            if spaces > 0 { spaceLines += 1 }
            let delta = spaces - previous
            if delta >= 2 && delta <= 8 { deltas[delta] += 1 }
            previous = spaces
        }

        var firstChar: UInt8? = nil
        for byte in text.utf8 {
            if lines >= 10000 { break }
            if byte == 0x0A || byte == 0x0D {
                if !atLineStart || firstChar != nil { finishLine(firstChar: firstChar) }
                atLineStart = true
                spaces = 0
                startsWithTab = false
                inIndent = true
                firstChar = nil
                continue
            }
            if atLineStart {
                atLineStart = false
                startsWithTab = byte == 0x09
            }
            if inIndent {
                if byte == 0x20 { spaces += 1; continue }
                if byte == 0x09 { continue }
                inIndent = false
                firstChar = byte
            }
        }
        if firstChar != nil { finishLine(firstChar: firstChar) }

        if tabLines > spaceLines { return (true, 4) }
        // 2 / 4 / 8，计数相同时优先 4
        var best = 4
        for w in [2, 8] where deltas[w] > deltas[best] { best = w }
        if deltas[2] == 0 && deltas[4] == 0 && deltas[8] == 0 {
            // 少见的 3 / 6 空格
            if deltas[3] > 0 && deltas[3] >= deltas[6] { return (false, 3) }
            return (false, 4)
        }
        return (false, best)
    }
}
