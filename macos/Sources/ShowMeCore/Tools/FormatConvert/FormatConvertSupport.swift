import Foundation

// 本批工具共用的小工具：行列定位、Unicode 分类、字节查找、JS 风格的数字与对象语义。
// 都放在 FC 命名空间里，避免与其它批次的同名内部类型冲突。

enum FC {
    /// UTF-8 字节偏移 → 1 起始的行列（列按 Unicode 标量计；\n、\r\n、单独的 \r 都算换行）
    static func lineColumn(_ bytes: [UInt8], _ offset: Int) -> (line: Int, column: Int) {
        var line = 1, col = 1
        var i = 0
        let end = min(max(0, offset), bytes.count)
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

    /// 1 起始的行列 → UTF-8 字节偏移（超出范围时夹到边界）
    static func offset(_ bytes: [UInt8], line: Int, column: Int) -> Int {
        var i = 0
        var l = 1
        while l < line, i < bytes.count {
            let b = bytes[i]
            i += 1
            if b == 0x0A {
                l += 1
            } else if b == 0x0D {
                if i < bytes.count, bytes[i] == 0x0A { i += 1 }
                l += 1
            }
        }
        var c = 1
        while c < column, i < bytes.count, bytes[i] != 0x0A, bytes[i] != 0x0D {
            i += 1
            while i < bytes.count, bytes[i] & 0xC0 == 0x80 { i += 1 }
            c += 1
        }
        return i
    }

    /// 解码 offset 处的一个 UTF-8 标量，返回码点与字节数（非法序列按 1 字节的 U+FFFD 处理）
    static func scalar(_ bytes: [UInt8], _ offset: Int) -> (value: UInt32, length: Int) {
        let b0 = bytes[offset]
        if b0 < 0x80 { return (UInt32(b0), 1) }
        let need: Int
        var v: UInt32
        if b0 & 0xE0 == 0xC0 { need = 1; v = UInt32(b0 & 0x1F) }
        else if b0 & 0xF0 == 0xE0 { need = 2; v = UInt32(b0 & 0x0F) }
        else if b0 & 0xF8 == 0xF0 { need = 3; v = UInt32(b0 & 0x07) }
        else { return (0xFFFD, 1) }
        guard offset + need < bytes.count else { return (0xFFFD, 1) }
        for k in 1...need {
            let b = bytes[offset + k]
            guard b & 0xC0 == 0x80 else { return (0xFFFD, 1) }
            v = (v << 6) | UInt32(b & 0x3F)
        }
        return (v, need + 1)
    }

    static func isLetter(_ v: UInt32) -> Bool {
        if v < 0x80 { return (v >= 0x41 && v <= 0x5A) || (v >= 0x61 && v <= 0x7A) }
        guard let s = Unicode.Scalar(v) else { return false }
        switch s.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: return true
        default: return false
        }
    }

    static func isNumber(_ v: UInt32) -> Bool {
        if v < 0x80 { return v >= 0x30 && v <= 0x39 }
        guard let s = Unicode.Scalar(v) else { return false }
        switch s.properties.generalCategory {
        case .decimalNumber, .letterNumber, .otherNumber: return true
        default: return false
        }
    }

    static func isMark(_ v: UInt32) -> Bool {
        guard v >= 0x80, let s = Unicode.Scalar(v) else { return false }
        switch s.properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark: return true
        default: return false
        }
    }

    /// 与 JS 的 String.prototype.trim 一致的空白（含全角空格、BOM）
    static func isJSWhitespace(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        case 0x2000...0x200A: return true
        default: return false
        }
    }

    static func jsTrim(_ s: String) -> String {
        let scalars = s.unicodeScalars
        guard let first = scalars.firstIndex(where: { !isJSWhitespace($0) }) else { return "" }
        guard let last = scalars.lastIndex(where: { !isJSWhitespace($0) }) else { return "" }
        return String(scalars[first...last])
    }

    static func isJSBlank(_ s: String) -> Bool {
        s.unicodeScalars.allSatisfy(isJSWhitespace)
    }

    // MARK: JS 语义

    /// 与 JavaScript `String(n)` 相同的数字写法（Infinity / NaN 返回 nil）
    static func jsNumber(_ d: Double) -> String? {
        guard d.isFinite else { return nil }
        if d == 0 { return "0" }
        let negative = d < 0
        // Swift 的 description 也是最短往返表示，只是写法不同：取出有效数字与指数
        let desc = "\(abs(d))"
        var mantissa = Substring(desc)
        var exp = 0
        if let e = desc.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mantissa = desc[..<e]
            exp = Int(desc[desc.index(after: e)...]) ?? 0
        }
        var digits = ""
        var pointPos: Int?
        for ch in mantissa {
            if ch == "." { pointPos = digits.count } else { digits.append(ch) }
        }
        let intLen = pointPos ?? digits.count
        // 去掉前导零
        var lead = 0
        for ch in digits { if ch == "0" { lead += 1 } else { break } }
        digits.removeFirst(min(lead, digits.count))
        while digits.hasSuffix("0") { digits.removeLast() }
        if digits.isEmpty { return "0" }
        // 值 = 0.digits × 10^n
        let n = intLen - lead + exp
        let k = digits.count
        var out: String
        if k <= n && n <= 21 {
            out = digits + String(repeating: "0", count: n - k)
        } else if 0 < n && n <= 21 {
            let idx = digits.index(digits.startIndex, offsetBy: n)
            out = digits[..<idx] + "." + digits[idx...]
        } else if -6 < n && n <= 0 {
            out = "0." + String(repeating: "0", count: -n) + digits
        } else {
            let e = n - 1
            let sign = e < 0 ? "-" : "+"
            if k == 1 {
                out = digits + "e" + sign + String(abs(e))
            } else {
                out = digits.prefix(1) + "." + digits.dropFirst() + "e" + sign + String(abs(e))
            }
        }
        return negative ? "-" + out : out
    }

    /// 按 JS 对象的语义去重：同名键保留第一次出现的位置、最后一次的值
    static func members(_ v: JSONValue) -> [JSONMember] {
        guard case .object(let members) = v else { return [] }
        var index: [String: Int] = [:]
        var out: [JSONMember] = []
        out.reserveCapacity(members.count)
        for m in members {
            if let i = index[m.key] {
                out[i].value = m.value
            } else {
                index[m.key] = out.count
                out.append(m)
            }
        }
        return out
    }

    static func isObject(_ v: JSONValue) -> Bool {
        if case .object = v { return true }
        return false
    }

    static func isArray(_ v: JSONValue) -> Bool {
        if case .array = v { return true }
        return false
    }

    /// 有序、可覆盖的对象成员表（与 JS 对象赋值语义一致）
    struct OrderedMembers {
        private(set) var members: [JSONMember] = []
        private var index: [String: Int] = [:]

        init() {}

        subscript(key: String) -> JSONValue? {
            guard let i = index[key] else { return nil }
            return members[i].value
        }

        var isEmpty: Bool { members.isEmpty }
        var count: Int { members.count }

        mutating func set(_ key: String, _ value: JSONValue) {
            if let i = index[key] {
                members[i].value = value
            } else {
                index[key] = members.count
                members.append(JSONMember(key, value))
            }
        }

        mutating func remove(_ key: String) {
            guard let i = index[key] else { return }
            members.remove(at: i)
            index = [:]
            for (k, m) in members.enumerated() { index[m.key] = k }
        }

        var value: JSONValue { .object(members) }
    }

    /// 最多列出 3 项：a、b、c 等 5 处 / a, b, c and 2 more
    static func list(_ items: [String], _ lang: Lang, max: Int = 3) -> String {
        let shown = items.prefix(max).joined(separator: lang.t("、", ", "))
        guard items.count > max else { return shown }
        return lang.t("\(shown) 等 \(items.count) 处", "\(shown) and \(items.count - max) more")
    }

    static func capitalizeFirst(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    // MARK: 字节

    /// 在 [from, to) 中查找字节序列
    static func find(_ b: [UInt8], _ pattern: [UInt8], from: Int, to limit: Int? = nil) -> Int? {
        guard let first = pattern.first, from >= 0 else { return nil }
        let n = Swift.min(limit ?? b.count, b.count), m = pattern.count
        var i = from
        while i + m <= n {
            if b[i] == first {
                var ok = true
                var k = 1
                while k < m {
                    if b[i + k] != pattern[k] { ok = false; break }
                    k += 1
                }
                if ok { return i }
            }
            i += 1
        }
        return nil
    }

    static func find(_ b: [UInt8], _ byte: UInt8, from: Int, to limit: Int? = nil) -> Int? {
        var i = Swift.max(0, from)
        let n = Swift.min(limit ?? b.count, b.count)
        while i < n {
            if b[i] == byte { return i }
            i += 1
        }
        return nil
    }

    static func has(_ b: [UInt8], _ pattern: [UInt8], at i: Int) -> Bool {
        guard i >= 0, i + pattern.count <= b.count else { return false }
        for k in 0..<pattern.count where b[i + k] != pattern[k] { return false }
        return true
    }

    static func text(_ b: [UInt8], _ from: Int, _ to: Int) -> String {
        let lo = Swift.max(0, Swift.min(from, b.count)), hi = Swift.max(lo, Swift.min(to, b.count))
        return String(decoding: b[lo..<hi], as: UTF8.self)
    }

    /// 按 \n、\r\n、\r 拆成行（按标量判断，不受 "\r\n" 字素簇影响）
    static func lines(_ s: String) -> [String] {
        var out: [String] = []
        var cur = String.UnicodeScalarView()
        var prevCR = false
        for c in s.unicodeScalars {
            if c == "\n" {
                if !prevCR { out.append(String(cur)) }
                cur = String.UnicodeScalarView()
                prevCR = false
            } else if c == "\r" {
                out.append(String(cur))
                cur = String.UnicodeScalarView()
                prevCR = true
            } else {
                cur.append(c)
                prevCR = false
            }
        }
        out.append(String(cur))
        return out
    }

    /// 是否含换行（按字节判断，不受 "\r\n" 字素簇影响）
    static func hasNewline(_ s: String) -> Bool {
        s.utf8.contains { $0 == 0x0A || $0 == 0x0D }
    }
}
