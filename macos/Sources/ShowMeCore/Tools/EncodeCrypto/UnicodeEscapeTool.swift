import Foundation

// Unicode 转义互转：\uXXXX（代理对）、\u{…}、\UXXXXXXXX、&#x…; / &#…;、\xHH 与 %HH 的 UTF-8 字节、
// U+XXXX、CSS \XXXX、%uXXXX；还原时自动识别混合的各种写法。另有逐字符分析表。
// 注意：源码里不直接写「反斜杠 + u + 4 位十六进制」，统一用 bs 拼出来，避免被工具链误转成字符。

/// 反斜杠
private let bs = "\\"

public enum UnicodeEscape {
    public enum Format: String, CaseIterable, Sendable {
        case js, es6, python, htmlHex = "html-hex", htmlDec = "html-dec", utf8Hex = "utf8-hex", utf8URL = "utf8-url", codepoint, css, percentU = "percent-u"

        public var label: String {
            switch self {
            case .js: bs + "uXXXX"
            case .es6: bs + "u{XXXX}"
            case .python: bs + "UXXXXXXXX"
            case .htmlHex: "&#xXXXX;"
            case .htmlDec: "&#DDDD;"
            case .utf8Hex: bs + "xE4" + bs + "xB8" + bs + "xAD"
            case .utf8URL: "%E4%B8%AD"
            case .codepoint: "U+XXXX"
            case .css: "CSS " + bs + "4E2D"
            case .percentU: "%uXXXX"
            }
        }

        public var hint: LocalizedText {
            switch self {
            case .js: LocalizedText("JavaScript / Java / JSON，补充平面字符用代理对", "JavaScript / Java / JSON; surrogate pairs above U+FFFF")
            case .es6: LocalizedText("ES6 / Swift / Rust 码点转义", "ES6 / Swift / Rust code point escapes")
            case .python: LocalizedText("Python / C / C++：BMP 用 \(bs)u，其余用 8 位 \(bs)U", "Python / C / C++: \(bs)u in the BMP, 8-digit \(bs)U beyond")
            case .htmlHex: LocalizedText("HTML / XML 十六进制字符引用", "HTML / XML hex character references")
            case .htmlDec: LocalizedText("HTML / XML 十进制字符引用", "HTML / XML decimal character references")
            case .utf8Hex: LocalizedText("UTF-8 字节（C / Python bytes / shell）", "UTF-8 bytes (C / Python bytes / shell)")
            case .utf8URL: LocalizedText("UTF-8 字节的百分号编码（URL）", "Percent-encoded UTF-8 bytes (URL)")
            case .codepoint: LocalizedText("Unicode 码点表示法", "Unicode code point notation")
            case .css: LocalizedText("CSS 字符串 / content 属性转义", "CSS string / content escapes")
            case .percentU: LocalizedText("JavaScript escape() 风格的 UTF-16 转义", "UTF-16 escapes in the style of JavaScript escape()")
            }
        }
    }

    /// 还原时识别出的转义种类
    public enum Kind: String, CaseIterable, Sendable {
        case js, es6, python, perl, htmlHex = "html-hex", htmlDec = "html-dec", utf8Hex = "utf8-hex", utf8URL = "utf8-url", codepoint, css, percentU = "percent-u", simple

        public func label(_ lang: Lang) -> String {
            switch self {
            case .js: bs + "uXXXX"
            case .es6: bs + "u{…}"
            case .python: bs + "UXXXXXXXX"
            case .perl: bs + "x{…}"
            case .htmlHex: "&#x…;"
            case .htmlDec: "&#…;"
            case .utf8Hex: lang.t(bs + "xHH 字节", bs + "xHH bytes")
            case .utf8URL: lang.t("%HH 字节", "%HH bytes")
            case .codepoint: "U+XXXX"
            case .css: "CSS " + bs + "XXXX"
            case .percentU: "%uXXXX"
            case .simple: lang.t(bs + "n " + bs + "t 等", bs + "n " + bs + "t etc.")
            }
        }
    }

    static let simpleEscapes: [Unicode.Scalar: String] = [
        "n": "\n", "t": "\t", "r": "\r", "b": "\u{08}", "f": "\u{0C}", "v": "\u{0B}", "0": "\u{00}",
        "\\": "\\", "\"": "\"", "'": "'", "/": "/", "`": "`",
    ]

    @inline(__always) static func isHex(_ s: Unicode.Scalar?) -> Bool { s.map { HexCodec.nibble($0.value) != nil } ?? false }

    static func hex(_ n: UInt32, _ pad: Int, _ upper: Bool) -> String {
        let s = String(n, radix: 16, uppercase: upper)
        return s.count >= pad ? s : String(repeating: "0", count: pad - s.count) + s
    }

    static func utf16Units(_ cp: UInt32) -> [UInt32] {
        guard cp > 0xFFFF else { return [cp] }
        let v = cp - 0x10000
        return [0xD800 + (v >> 10), 0xDC00 + (v & 0x3FF)]
    }

    /// 这些字符在字符串字面量里需要转义自身，才能保证能原样还原
    static func literalSelfEscape(_ f: Format, _ c: Unicode.Scalar) -> String? {
        if c == "\\" && [.js, .es6, .python, .utf8Hex, .css].contains(f) { return bs + bs }
        if c == "%" && (f == .utf8URL || f == .percentU) { return "%25" }
        return nil
    }

    /// 原样保留的 ASCII 字符若恰好组成还原时会被自动识别的转义开头（如文本里本来就有「%41」「&#65;」「U+0041」），
    /// 就必须连它一起转义，否则还原结果与原文不同
    static func startsEscape(_ s: [Unicode.Scalar], _ at: Int, _ c: Unicode.Scalar) -> Bool {
        let next: Unicode.Scalar? = at + 1 < s.count ? s[at + 1] : nil
        switch c {
        case "\\":
            guard let n = next else { return false }
            return n == "u" || n == "U" || n == "x" || isHex(n) || simpleEscapes[n] != nil
        case "%":
            if isHex(next) && at + 2 < s.count && isHex(s[at + 2]) { return true }
            return next == "u" && at + 5 < s.count && (2...5).allSatisfy { isHex(s[at + $0]) }
        case "&":
            return next == "#"
        case "U", "u":
            return next == "+" && at + 5 < s.count && (2...5).allSatisfy { isHex(s[at + $0]) }
        default:
            return false
        }
    }

    static func isHexLike(_ c: Unicode.Scalar) -> Bool { isHex(c) }
    static func isSpace(_ c: Unicode.Scalar) -> Bool { c == " " || c == "\t" || c == "\n" || c == "\r" || c == "\u{0B}" || c == "\u{0C}" }

    /// 把文本转义为指定格式
    public static func escape(_ text: String, format: Format, onlyNonASCII: Bool = true, uppercase: Bool = true) -> String {
        enum Prev { case text, codepoint, css }
        let s = Array(text.unicodeScalars)
        var out = ""
        out.reserveCapacity(s.count * 2)
        var prev = Prev.text
        for (at, c) in s.enumerated() {
            let cp = c.value
            let printable = cp >= 0x20 && cp < 0x7F
            let keep = onlyNonASCII
                && (printable || cp == 10 || cp == 13 || cp == 9)
                // U+XXXX 后紧跟的十六进制字符会被读成同一个码点，空格 / 逗号会被当成分隔符，所以也转义
                && !(prev == .codepoint && (isHex(c) || c == " " || c == "," || c == "\t"))
                && (literalSelfEscape(format, c) != nil || !startsEscape(s, at, c))
            if keep {
                // CSS 转义后紧跟十六进制字符或空白时，需要一个空格作结束符
                if prev == .css && (isHex(c) || isSpace(c)) { out += " " }
                if let e = literalSelfEscape(format, c) { out += e } else { out.unicodeScalars.append(c) }
                prev = .text
                continue
            }
            switch format {
            case .js:
                for u in utf16Units(cp) { out += bs + "u" + hex(u, 4, uppercase) }
            case .es6:
                out += bs + "u{" + hex(cp, 4, uppercase) + "}"
            case .python:
                out += cp > 0xFFFF ? bs + "U" + hex(cp, 8, uppercase) : bs + "u" + hex(cp, 4, uppercase)
            case .htmlHex:
                out += "&#x" + hex(cp, 0, uppercase) + ";"
            case .htmlDec:
                out += "&#\(cp);"
            case .utf8Hex:
                for b in String(c).utf8 { out += bs + "x" + hex(UInt32(b), 2, uppercase) }
            case .utf8URL:
                for b in String(c).utf8 { out += "%" + hex(UInt32(b), 2, uppercase) }
            case .codepoint:
                // 码点表示法约定使用大写
                out += (prev == .codepoint ? " " : "") + "U+" + hex(cp, 4, true)
            case .css:
                out += bs + hex(cp, 4, uppercase)
            case .percentU:
                for u in utf16Units(cp) { out += "%u" + hex(u, 4, uppercase) }
            }
            prev = format == .codepoint ? .codepoint : format == .css ? .css : .text
        }
        return out
    }

    // MARK: 还原

    public struct UnescapeResult: Sendable, Hashable {
        public var output: String
        public var counts: [Kind: Int]
        var issues: [CodecIssue]
    }

    static func readHex(_ s: [Unicode.Scalar], _ i: Int, _ minLen: Int, _ maxLen: Int) -> [Unicode.Scalar]? {
        var j = i
        while j < s.count && j - i < maxLen && isHex(s[j]) { j += 1 }
        return j - i >= minLen ? Array(s[i..<j]) : nil
    }

    /// 十六进制 / 十进制数字（可带很多前导零）→ 数值；有效位过长时返回超出范围的值
    static func value(_ digits: [Unicode.Scalar], radix: Int) -> UInt64 {
        let significant = digits.drop(while: { $0 == "0" })
        if significant.isEmpty { return 0 }
        if significant.count > 8 { return 0x7FFF_FFFF }
        return UInt64(EncodeCryptoShared.string(significant), radix: radix) ?? 0x7FFF_FFFF
    }

    static func string(_ s: ArraySlice<Unicode.Scalar>) -> String { EncodeCryptoShared.string(s) }

    /// 自动识别并还原混合的各种转义
    public static func unescape(_ text: String, simple: Bool = true, css: Bool = true) -> UnescapeResult {
        let s = Array(text.unicodeScalars)
        let n = s.count
        var collector = IssueCollector(s)
        var counts: [Kind: Int] = [:]
        var out = String.UnicodeScalarView()
        out.reserveCapacity(n)

        func fromCodePoint(_ cp: UInt64, _ at: Int, _ len: Int) {
            if cp > 0x10FFFF {
                let raw = string(s[at..<(at + len)]).trimmingCharacters(in: .whitespacesAndNewlines)
                collector.add(at, len, LocalizedText("“\(raw)” 超出 Unicode 范围（最大 U+10FFFF），已原样保留",
                                                     "“\(raw)” is beyond the Unicode range (max U+10FFFF); kept as is"))
                EncodeCryptoShared.append(s[at..<(at + len)], to: &out)
                return
            }
            if let scalar = Unicode.Scalar(UInt32(cp)) {
                out.append(scalar)
            } else {
                // 代理项
                let raw = string(s[at..<(at + len)])
                collector.add(at, len, LocalizedText("\(raw) 是孤立的代理项，已替换为 U+FFFD", "\(raw) is a lone surrogate; replaced with U+FFFD"))
                out.append("\u{FFFD}")
            }
        }

        /// 读一个 UTF-16 码元（\uXXXX / %uXXXX），高代理项后紧跟低代理项时合成一个码点
        func utf16(_ i: Int, prefix: [Unicode.Scalar], kind: Kind) -> Int? {
            guard let h = readHex(s, i + prefix.count, 4, 4) else { return nil }
            var unit = UInt32(value(h, radix: 16))
            var len = prefix.count + 4
            if unit >= 0xD800 && unit <= 0xDBFF, i + len + prefix.count <= n, Array(s[(i + len)..<(i + len + prefix.count)]) == prefix,
               let lo = readHex(s, i + len + prefix.count, 4, 4) {
                let low = UInt32(value(lo, radix: 16))
                if low >= 0xDC00 && low <= 0xDFFF {
                    unit = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)
                    len += prefix.count + 4
                }
            }
            if let scalar = Unicode.Scalar(unit) {
                out.append(scalar)
            } else {
                let raw = string(prefix[...]) + string(h[...])
                collector.add(i, len, LocalizedText("\(raw) 是孤立的代理项（缺少配对的另一半），已替换为 U+FFFD",
                                                    "\(raw) is a lone surrogate (its other half is missing); replaced with U+FFFD"))
                out.append("\u{FFFD}")
            }
            counts[kind, default: 0] += 1
            return i + len
        }

        var i = 0
        while i < n {
            let c = s[i]
            // 反斜杠开头
            if c == "\\" && i + 1 < n {
                let d = s[i + 1]
                let d2: Unicode.Scalar? = i + 2 < n ? s[i + 2] : nil
                // \u{…}
                if d == "u" && d2 == "{", let h = readHex(s, i + 3, 1, 16), i + 3 + h.count < n, s[i + 3 + h.count] == "}" {
                    let len = h.count + 4
                    fromCodePoint(value(h, radix: 16), i, len)
                    counts[.es6, default: 0] += 1
                    i += len
                    continue
                }
                // \uXXXX（含代理对）
                if d == "u", let next = utf16(i, prefix: ["\\", "u"], kind: .js) {
                    i = next
                    continue
                }
                // \UXXXXXXXX
                if d == "U", let h = readHex(s, i + 2, 8, 8) {
                    fromCodePoint(value(h, radix: 16), i, 10)
                    counts[.python, default: 0] += 1
                    i += 10
                    continue
                }
                // \x{…}
                if d == "x" && d2 == "{", let h = readHex(s, i + 3, 1, 16), i + 3 + h.count < n, s[i + 3 + h.count] == "}" {
                    let len = h.count + 4
                    fromCodePoint(value(h, radix: 16), i, len)
                    counts[.perl, default: 0] += 1
                    i += len
                    continue
                }
                // \xHH 连续字节串
                if d == "x", readHex(s, i + 2, 2, 2) != nil {
                    let start = i
                    var bytes: [UInt8] = []
                    while i + 1 < n, s[i] == "\\", s[i + 1] == "x", let h = readHex(s, i + 2, 2, 2) {
                        bytes.append(UInt8(value(h, radix: 16)))
                        i += 4
                    }
                    if let decoded = UTF8Check.decode(bytes) {
                        EncodeCryptoShared.append(decoded.unicodeScalars, to: &out)
                    } else {
                        // 不是 UTF-8：按 Latin-1（Python 字符串 \xHH 的含义）逐字节解释
                        for b in bytes { out.append(Unicode.Scalar(b)) }
                        collector.add(start, i - start, LocalizedText("这串 \(bs)x 字节不是有效的 UTF-8，已按 Latin-1 逐字节解释",
                                                                      "These \(bs)x bytes are not valid UTF-8; read byte by byte as Latin-1"))
                    }
                    counts[.utf8Hex, default: 0] += bytes.count
                    continue
                }
                // CSS \XXXX（4–6 位十六进制，后面可跟一个空白作结束符）
                if css, let h = readHex(s, i + 1, 4, 6) {
                    var len = 1 + h.count
                    if i + len < n {
                        let t = s[i + len]
                        if t == " " || t == "\t" || t == "\n" { len += 1 } else if t == "\r" { len += i + len + 1 < n && s[i + len + 1] == "\n" ? 2 : 1 }
                    }
                    let cp = value(h, radix: 16)
                    if cp == 0 || (cp >= 0xD800 && cp <= 0xDFFF) {
                        collector.add(i, len, LocalizedText("CSS 转义 \(bs)\(string(h[...])) 不是合法字符，已替换为 U+FFFD",
                                                            "The CSS escape \(bs)\(string(h[...])) is not a valid character; replaced with U+FFFD"))
                        out.append("\u{FFFD}")
                    } else {
                        fromCodePoint(cp, i, len)
                    }
                    counts[.css, default: 0] += 1
                    i += len
                    continue
                }
                if simple, let v = simpleEscapes[d] {
                    EncodeCryptoShared.append(v.unicodeScalars, to: &out)
                    counts[.simple, default: 0] += 1
                    i += 2
                    continue
                }
            }
            // %uXXXX
            if c == "%" && i + 1 < n && s[i + 1] == "u", let next = utf16(i, prefix: ["%", "u"], kind: .percentU) {
                i = next
                continue
            }
            // %HH 连续字节串
            if c == "%", readHex(s, i + 1, 2, 2) != nil {
                let start = i
                var bytes: [UInt8] = []
                while i < n, s[i] == "%", let h = readHex(s, i + 1, 2, 2) {
                    bytes.append(UInt8(value(h, radix: 16)))
                    i += 3
                }
                if let decoded = UTF8Check.decode(bytes) {
                    EncodeCryptoShared.append(decoded.unicodeScalars, to: &out)
                } else {
                    EncodeCryptoShared.append(s[start..<i], to: &out)
                    collector.add(start, i - start, LocalizedText("这串 %XX 字节不是有效的 UTF-8，已原样保留", "These %XX bytes are not valid UTF-8; kept as is"))
                }
                counts[.utf8URL, default: 0] += bytes.count
                continue
            }
            // &#x…; / &#…;
            if c == "&" && i + 1 < n && s[i + 1] == "#" {
                let hexRef = i + 2 < n && (s[i + 2] == "x" || s[i + 2] == "X")
                var digits: [Unicode.Scalar]? = nil
                if hexRef {
                    digits = readHex(s, i + 3, 1, 64)
                } else {
                    var j = i + 2
                    while j < n && j - i - 2 < 64 && s[j].value >= 48 && s[j].value <= 57 { j += 1 }
                    if j > i + 2 { digits = Array(s[(i + 2)..<j]) }
                }
                if let h = digits {
                    var len = (hexRef ? 3 : 2) + h.count
                    if i + len < n && s[i + len] == ";" { len += 1 }
                    let cp = value(h, radix: hexRef ? 16 : 10)
                    if cp == 0 || (cp >= 0xD800 && cp <= 0xDFFF) {
                        let raw = string(s[i..<(i + len)])
                        collector.add(i, len, LocalizedText("\(raw) 不是合法字符，已替换为 U+FFFD", "\(raw) is not a valid character; replaced with U+FFFD"))
                        out.append("\u{FFFD}")
                    } else {
                        fromCodePoint(cp, i, len)
                    }
                    counts[hexRef ? .htmlHex : .htmlDec, default: 0] += 1
                    i += len
                    continue
                }
            }
            // U+XXXX（相邻的 U+ 之间的空白 / 逗号会被去掉）
            if (c == "U" || c == "u") && i + 1 < n && s[i + 1] == "+", let h = readHex(s, i + 2, 4, 6) {
                let len = 2 + h.count
                fromCodePoint(value(h, radix: 16), i, len)
                counts[.codepoint, default: 0] += 1
                i += len
                var j = i
                while j < n && (s[j] == " " || s[j] == "\t") { j += 1 }
                if j < n && s[j] == "," { j += 1 }
                while j < n && (s[j] == " " || s[j] == "\t") { j += 1 }
                if j + 1 < n, s[j] == "U" || s[j] == "u", s[j + 1] == "+", readHex(s, j + 2, 4, 4) != nil, j - i <= 10 { i = j }
                continue
            }
            out.append(c)
            i += 1
        }
        return UnescapeResult(output: String(out), counts: counts, issues: collector.issues)
    }

    // MARK: 字符分析

    /// 常见不可见 / 易混淆字符的名称
    static let charNames: [UInt32: LocalizedText] = [
        0x00: LocalizedText("空字符 NUL", "Null NUL"), 0x09: LocalizedText("制表符", "Tab"), 0x0A: LocalizedText("换行 LF", "Line feed LF"),
        0x0D: LocalizedText("回车 CR", "Carriage return CR"), 0x20: LocalizedText("空格", "Space"), 0x7F: LocalizedText("删除 DEL", "Delete DEL"),
        0xA0: LocalizedText("不换行空格", "No-break space"), 0xAD: LocalizedText("软连字符", "Soft hyphen"), 0x3000: LocalizedText("全角空格", "Ideographic space"),
        0x200B: LocalizedText("零宽空格", "Zero-width space"), 0x200C: LocalizedText("零宽不连字 ZWNJ", "Zero-width non-joiner ZWNJ"),
        0x200D: LocalizedText("零宽连字 ZWJ", "Zero-width joiner ZWJ"), 0x200E: LocalizedText("从左到右标记 LRM", "Left-to-right mark LRM"),
        0x200F: LocalizedText("从右到左标记 RLM", "Right-to-left mark RLM"), 0x202A: LocalizedText("从左到右嵌入 LRE", "Left-to-right embedding LRE"),
        0x202B: LocalizedText("从右到左嵌入 RLE", "Right-to-left embedding RLE"), 0x202C: LocalizedText("方向格式结束 PDF", "Pop directional formatting PDF"),
        0x202D: LocalizedText("从左到右覆盖 LRO", "Left-to-right override LRO"), 0x202E: LocalizedText("从右到左覆盖 RLO（可反转显示顺序）", "Right-to-left override RLO (can reverse display order)"),
        0x2028: LocalizedText("行分隔符", "Line separator"), 0x2029: LocalizedText("段分隔符", "Paragraph separator"), 0x2060: LocalizedText("词连接符", "Word joiner"),
        0xFEFF: LocalizedText("BOM / 零宽不换行空格", "BOM / zero-width no-break space"), 0xFE0E: LocalizedText("文本样式选择符 VS15", "Text presentation selector VS15"),
        0xFE0F: LocalizedText("Emoji 样式选择符 VS16", "Emoji presentation selector VS16"), 0xFFFD: LocalizedText("替换字符", "Replacement character"),
        0x20E3: LocalizedText("键帽组合符", "Combining enclosing keycap"),
    ]

    static func categoryLabel(_ s: Unicode.Scalar) -> LocalizedText {
        let v = s.value
        if v < 0x80 {
            if v < 0x20 || v == 0x7F { return v == 9 || v == 10 || v == 13 ? LocalizedText("空白", "Whitespace") : LocalizedText("控制字符", "Control") }
            if v == 0x20 { return LocalizedText("空白", "Whitespace") }
            if EncodeCryptoShared.isASCIILetter(s) { return LocalizedText("ASCII 字母", "ASCII letter") }
            if v >= 0x30 && v <= 0x39 { return LocalizedText("ASCII 数字", "ASCII digit") }
            return LocalizedText("ASCII 符号", "ASCII symbol")
        }
        if (0xFE00...0xFE0F).contains(v) || (0xE0100...0xE01EF).contains(v) { return LocalizedText("变体选择符", "Variation selector") }
        let p = s.properties
        if p.isEmojiPresentation || (0x1F3FB...0x1F3FF).contains(v) { return LocalizedText("Emoji", "Emoji") }
        if (0x4E00...0x9FFF).contains(v) || (0x3400...0x4DBF).contains(v) || (0x20000...0x323AF).contains(v) || (0xF900...0xFAFF).contains(v) {
            return LocalizedText("汉字", "Han")
        }
        if (0x3040...0x30FF).contains(v) || (0x31F0...0x31FF).contains(v) || (0xFF66...0xFF9F).contains(v) { return LocalizedText("日文假名", "Kana") }
        if (0xAC00...0xD7AF).contains(v) || (0x1100...0x11FF).contains(v) || (0x3130...0x318F).contains(v) { return LocalizedText("韩文", "Hangul") }
        switch p.generalCategory {
        case .control: return LocalizedText("控制字符", "Control")
        case .format: return LocalizedText("格式字符", "Format")
        case .privateUse: return LocalizedText("私用区", "Private use")
        case .unassigned: return LocalizedText("未分配", "Unassigned")
        case .spaceSeparator, .lineSeparator, .paragraphSeparator: return LocalizedText("空白", "Whitespace")
        case .nonspacingMark, .spacingMark, .enclosingMark: return LocalizedText("组合符号", "Combining mark")
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter:
            if (0x00C0...0x024F).contains(v) || (0x1E00...0x1EFF).contains(v) { return LocalizedText("拉丁字母", "Latin letter") }
            if (0x0370...0x03FF).contains(v) || (0x1F00...0x1FFF).contains(v) { return LocalizedText("希腊字母", "Greek letter") }
            if (0x0400...0x052F).contains(v) { return LocalizedText("西里尔字母", "Cyrillic letter") }
            return LocalizedText("其他文字", "Other letter")
        case .decimalNumber, .letterNumber, .otherNumber: return LocalizedText("数字", "Number")
        case .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation, .initialPunctuation, .finalPunctuation, .otherPunctuation:
            return LocalizedText("标点", "Punctuation")
        default:
            return p.isEmoji && v >= 0x2100 ? LocalizedText("Emoji", "Emoji") : LocalizedText("符号", "Symbol")
        }
    }

    /// 逐码点分析：码点、UTF-8、UTF-16、类别（最多 limit 行）
    public static func inspect(_ text: String, limit: Int = 500, lang: Lang = .zh) -> ToolTable {
        var rows: [[String]] = []
        for (i, s) in text.unicodeScalars.prefix(limit).enumerated() {
            let v = s.value
            let display: String
            if v < 0x20 {
                display = Unicode.Scalar(0x2400 + v).map { String($0) } ?? ""
            } else if v == 0x7F {
                display = "\u{2421}"
            } else if v == 0x20 || [.spaceSeparator, .format].contains(s.properties.generalCategory) {
                display = "\u{2423}"
            } else {
                display = String(s)
            }
            let utf8 = String(s).utf8.map { hex(UInt32($0), 2, true) }.joined(separator: " ")
            let utf16 = utf16Units(v).map { hex($0, 4, true) }.joined(separator: " ")
            let note = charNames[v].map { categoryLabel(s)(lang) + " · " + $0(lang) } ?? categoryLabel(s)(lang)
            rows.append(["\(i + 1)", display, "U+" + hex(v, 4, true), utf8, utf16, note])
        }
        return ToolTable(columns: ["#", lang.t("字符", "Char"), lang.t("码点", "Code point"), "UTF-8", "UTF-16", lang.t("类别", "Category")], rows: rows)
    }
}

public enum UnicodeEscapeTool {
    public static let spec = ToolSpec(
        id: "unicode-escape",
        name: LocalizedText("Unicode 转义", "Unicode Escape"),
        summary: LocalizedText(
            "中文与 " + bs + "uXXXX、&#xXXXX;、UTF-8 字节等编码形式互转。",
            "Convert text to and from " + bs + "uXXXX, &#xXXXX;, UTF-8 bytes and other escape forms."
        ),
        category: .encode,
        keywords: ["unicode", "escape", "utf8", "utf-16", "native2ascii", "中文", "转义", "unescape", "zy"],
        symbol: "character.textbox",
        input: .required,
        inputLabel: LocalizedText("文本或转义序列", "Text or escapes"),
        fields: [
            ToolField("mode", LocalizedText("操作", "Action"), .choice([
                ToolChoice("escape", LocalizedText("转义", "Escape")),
                ToolChoice("unescape", LocalizedText("还原", "Unescape")),
                ToolChoice("inspect", LocalizedText("字符分析", "Inspect")),
            ]), default: "escape"),
            ToolField("format", LocalizedText("转义格式", "Format"), .choice(UnicodeEscape.Format.allCases.map { ToolChoice($0.rawValue, $0.label) }),
                      default: "js", visibleWhen: ToolCondition("mode", is: "escape")),
            ToolField("onlyNonAscii", LocalizedText("只转义非 ASCII", "Non-ASCII only"), .toggle, default: "1",
                      visibleWhen: ToolCondition("mode", is: "escape")),
            ToolField("upper", LocalizedText("大写十六进制", "Uppercase hex"), .toggle, default: "1",
                      visibleWhen: ToolCondition("mode", is: "escape")),
            ToolField("simple", LocalizedText("解析 " + bs + "n " + bs + "t " + bs + bs + " 等简单转义", "Parse " + bs + "n " + bs + "t " + bs + bs + " and friends"),
                      .toggle, default: "1", visibleWhen: ToolCondition("mode", is: "unescape")),
            ToolField("css", LocalizedText("识别 CSS 转义 " + bs + "4E2D", "Detect CSS escapes " + bs + "4E2D"), .toggle, default: "1",
                      visibleWhen: ToolCondition("mode", is: "unescape")),
        ],
        run: { input in try run(input) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        switch input.string("mode") {
        case "inspect":
            let total = input.text.unicodeScalars.count
            let utf8 = input.text.utf8.count, utf16 = input.text.utf16.count, graphemes = input.text.count
            var notes = [ToolNote(.info, lang.t(
                "\(total) 个码点 · \(graphemes) 个字（字素簇）· UTF-8 \(utf8) 字节 · UTF-16 \(utf16) 个码元",
                "\(total) code points · \(graphemes) graphemes · \(utf8) UTF-8 bytes · \(utf16) UTF-16 units"))]
            if total > 500 { notes.append(ToolNote(.info, lang.t("只列出前 500 个字符", "Only the first 500 characters are listed"))) }
            return ToolResult(notes: notes, table: UnicodeEscape.inspect(input.text, lang: lang))
        case "unescape":
            let r = UnicodeEscape.unescape(input.text, simple: input.bool("simple"), css: input.bool("css"))
            var notes: [ToolNote] = []
            let found = UnicodeEscape.Kind.allCases.compactMap { k in r.counts[k].map { "\(k.label(lang)) ×\($0)" } }
            notes.append(ToolNote(.info, found.isEmpty
                ? lang.t("没有找到可识别的转义", "No escapes were found")
                : lang.t("识别到：", "Found: ") + found.joined(separator: lang.t("、", ", "))))
            notes += EncodeCryptoShared.notes(r.issues, lang: lang, title: LocalizedText("以下内容未能按转义解释", "These parts could not be read as escapes"))
            return ToolResult(outputs: [.primary(lang.t("还原结果", "Unescaped"), r.output)], notes: notes)
        default:
            let format = EncodeCryptoShared.choice(input, "format", default: UnicodeEscape.Format.js)
            let out = UnicodeEscape.escape(input.text, format: format, onlyNonASCII: input.bool("onlyNonAscii"), uppercase: input.bool("upper"))
            return ToolResult(outputs: [.primary(lang.t("转义结果", "Escaped"), out)], notes: [ToolNote(.info, format.hint(lang))])
        }
    }
}
