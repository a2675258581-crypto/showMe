import Foundation

// 代码生成用的通用工具：各语言字符串转义、JSON 字面量、URL 编码、Punycode。

public enum CodeEscape {
    static func hex(_ c: UInt32, _ width: Int) -> String {
        let s = String(c, radix: 16)
        return s.count >= width ? s : String(repeating: "0", count: width - s.count) + s
    }

    /// 是否含有控制字符（allow 里列出的除外）
    static func hasControl(_ s: String, allow: Set<Unicode.Scalar> = []) -> Bool {
        s.unicodeScalars.contains { ($0.value < 0x20 || $0.value == 0x7F) && !allow.contains($0) }
    }

    static func hasCtrl(_ s: String) -> Bool { hasControl(s, allow: ["\t", "\n"]) }

    static func quoteWith(_ s: String, _ quote: String, _ esc: (Unicode.Scalar) -> String?) -> String {
        var out = quote
        out.reserveCapacity(s.utf8.count + 2)
        for c in s.unicodeScalars {
            if let e = esc(c) { out += e } else { out.unicodeScalars.append(c) }
        }
        return out + quote
    }

    static func commonEsc(_ quote: Unicode.Scalar, _ c: Unicode.Scalar, ctrl: (UInt32) -> String) -> String? {
        if c == "\\" { return "\\\\" }
        if c == quote { return "\\" + String(quote) }
        if c == "\n" { return "\\n" }
        if c == "\r" { return "\\r" }
        if c == "\t" { return "\\t" }
        if c.value < 0x20 || c.value == 0x7F { return ctrl(c.value) }
        return nil
    }

    static let shellSafe: Set<Unicode.Scalar> = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-./:@%+,=".unicodeScalars)

    /// bash：安全字符原样，其余用单引号
    public static func shQuote(_ s: String) -> String {
        if !s.isEmpty, s.unicodeScalars.allSatisfy({ shellSafe.contains($0) }) { return s }
        return "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    /// 总是加引号的 bash 字符串：普通内容用单引号；含换行或控制字符时用 $'…'（与 Chrome「Copy as cURL」一致）
    public static func shq(_ s: String) -> String {
        if !hasControl(s, allow: ["\t"]) { return "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        var out = "$'"
        for c in s.unicodeScalars {
            switch c {
            case "\\": out += "\\\\"
            case "'": out += "\\'"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if c.value < 0x20 || c.value == 0x7F { out += "\\x" + hex(c.value, 2) } else { out.unicodeScalars.append(c) }
            }
        }
        return out + "'"
    }

    public static func jsStr(_ s: String) -> String {
        quoteWith(s, "'") { c in
            if c.value == 0x2028 || c.value == 0x2029 { return "\\u" + hex(c.value, 4) }
            return commonEsc("'", c) { "\\x" + hex($0, 2) }
        }
    }

    public static func pyStr(_ s: String) -> String {
        quoteWith(s, "'") { commonEsc("'", $0) { "\\x" + hex($0, 2) } }
    }

    public static func goStr(_ s: String) -> String {
        quoteWith(s, "\"") { commonEsc("\"", $0) { "\\x" + hex($0, 2) } }
    }

    public static func javaStr(_ s: String) -> String {
        quoteWith(s, "\"") { c in
            if c.value == 8 { return "\\b" }
            if c.value == 12 { return "\\f" }
            return commonEsc("\"", c) { "\\u" + hex($0, 4) }
        }
    }

    public static func csStr(_ s: String) -> String {
        quoteWith(s, "\"") { c in
            if c.value == 0 { return "\\0" }
            return commonEsc("\"", c) { "\\u" + hex($0, 4) }
        }
    }

    public static func rustStr(_ s: String) -> String {
        quoteWith(s, "\"") { c in
            if c.value == 0 { return "\\0" }
            return commonEsc("\"", c) { "\\u{" + String($0, radix: 16) + "}" }
        }
    }

    public static func swiftStr(_ s: String) -> String { rustStr(s) }

    /// PHP：一般用单引号（只需转义 \ 和 '），含控制字符时用双引号转义
    public static func phpStr(_ s: String) -> String {
        if !hasControl(s, allow: ["\t", "\n"]) {
            return "'" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'") + "'"
        }
        return quoteWith(s, "\"") { c in
            if c == "$" { return "\\$" }
            return commonEsc("\"", c) { "\\x" + hex($0, 2) }
        }
    }

    /// Go 原始字符串（反引号），不能包含反引号和 \r
    static func goBody(_ s: String) -> String {
        let needs = s.unicodeScalars.contains { $0 == "\"" || $0 == "\\" || $0 == "\n" }
        return !s.contains("`") && !s.unicodeScalars.contains("\r") && !hasCtrl(s) && needs ? "`" + s + "`" : goStr(s)
    }

    /// Rust 原始字符串 r#"…"#
    static func rustBody(_ s: String) -> String {
        if hasCtrl(s) || s.unicodeScalars.contains("\r") || !s.unicodeScalars.contains(where: { $0 == "\"" || $0 == "\\" }) {
            return rustStr(s)
        }
        var hashes = "#"
        while s.contains("\"" + hashes) { hashes += "#" }
        return "r\(hashes)\"\(s)\"\(hashes)"
    }

    /// Swift 原始字符串 #"…"#（单行）
    static func swiftBody(_ s: String) -> String {
        if hasCtrl(s) || s.unicodeScalars.contains(where: { $0 == "\r" || $0 == "\n" })
            || !s.unicodeScalars.contains(where: { $0 == "\"" || $0 == "\\" }) {
            return swiftStr(s)
        }
        var hashes = "#"
        while s.contains("\"" + hashes) || s.contains("\\" + hashes) { hashes += "#" }
        return "\(hashes)\"\(s)\"\(hashes)"
    }

    // MARK: - 数字

    /// 与 JavaScript `String(number)` 相同的数字格式（最短往返表示）
    public static func jsNumber(_ d: Double) -> String {
        if d == 0 { return "0" }
        if d.isNaN { return "NaN" }
        if d.isInfinite { return d < 0 ? "-Infinity" : "Infinity" }
        let neg = d < 0
        let desc = "\(abs(d))"
        let parts = desc.lowercased().split(separator: "e", maxSplits: 1)
        let mant = parts.first.map(String.init) ?? desc
        let exp = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
        let dot = mant.firstIndex(of: ".")
        let intPart = dot.map { String(mant[..<$0]) } ?? mant
        let fracPart = dot.map { String(mant[mant.index(after: $0)...]) } ?? ""
        var digits = Array(intPart + fracPart)
        var point = intPart.count + exp
        while digits.count > 1, digits.first == "0" {
            digits.removeFirst()
            point -= 1
        }
        while digits.count > 1, digits.last == "0" { digits.removeLast() }
        let k = digits.count
        let n = point
        let ds = String(digits)
        var out: String
        if k <= n, n <= 21 {
            out = ds + String(repeating: "0", count: n - k)
        } else if n > 0, n <= 21 {
            out = String(digits[0..<n]) + "." + String(digits[n...])
        } else if n > -6, n <= 0 {
            out = "0." + String(repeating: "0", count: -n) + ds
        } else {
            let e = n - 1
            let sign = e < 0 ? "-" : "+"
            out = k == 1 ? ds + "e" + sign + String(abs(e)) : String(digits[0]) + "." + String(digits[1...]) + "e" + sign + String(abs(e))
        }
        return neg ? "-" + out : out
    }

    // MARK: - JSON 字面量

    static func isIdent(_ k: String) -> Bool {
        let s = Array(k.unicodeScalars)
        guard let f = s.first else { return false }
        func word(_ c: Unicode.Scalar) -> Bool {
            Curl.isAlpha(c) || Curl.isDigit(c) || c == "_" || c == "$"
        }
        return (Curl.isAlpha(f) || f == "_" || f == "$") && s.allSatisfy(word)
    }

    /// 与 JS 对象一致：重复的键保留第一次出现的位置、最后一次的值
    static func dedupe(_ members: [JSONMember]) -> [JSONMember] {
        var index: [String: Int] = [:]
        var out: [JSONMember] = []
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

    static func numberText(_ n: String) -> String {
        Double(n).map(jsNumber) ?? n
    }

    /// 只含原始值的短数组写在一行：[1, 2, 3]
    static func inlineArray(_ items: [JSONValue], _ fmt: (JSONValue) -> String) -> String? {
        if items.contains(where: \.isContainer) { return nil }
        let s = "[" + items.map(fmt).joined(separator: ", ") + "]"
        return s.utf16.count <= 60 ? s : nil
    }

    /// JSON 值 → JavaScript 字面量（2 空格缩进）
    public static func jsLiteral(_ v: JSONValue, indent: Int = 0) -> String {
        let pad = String(repeating: " ", count: indent + 2)
        let end = String(repeating: " ", count: indent)
        switch v {
        case .null: return "null"
        case .string(let s): return jsStr(s)
        case .number(let n): return numberText(n)
        case .bool(let b): return b ? "true" : "false"
        case .array(let items):
            if items.isEmpty { return "[]" }
            if let inline = inlineArray(items, { jsLiteral($0) }) { return inline }
            return "[\n" + items.map { pad + jsLiteral($0, indent: indent + 2) + "," }.joined(separator: "\n") + "\n" + end + "]"
        case .object(let members):
            let ms = dedupe(members)
            if ms.isEmpty { return "{}" }
            return "{\n" + ms.map { pad + (isIdent($0.key) ? $0.key : jsStr($0.key)) + ": " + jsLiteral($0.value, indent: indent + 2) + "," }
                .joined(separator: "\n") + "\n" + end + "}"
        }
    }

    /// JSON 值 → Python 字面量（4 空格缩进）
    public static func pyLiteral(_ v: JSONValue, indent: Int = 0) -> String {
        let pad = String(repeating: " ", count: indent + 4)
        let end = String(repeating: " ", count: indent)
        switch v {
        case .null: return "None"
        case .bool(let b): return b ? "True" : "False"
        case .string(let s): return pyStr(s)
        case .number(let n): return numberText(n)
        case .array(let items):
            if items.isEmpty { return "[]" }
            if let inline = inlineArray(items, { pyLiteral($0) }) { return inline }
            return "[\n" + items.map { pad + pyLiteral($0, indent: indent + 4) + "," }.joined(separator: "\n") + "\n" + end + "]"
        case .object(let members):
            let ms = dedupe(members)
            if ms.isEmpty { return "{}" }
            return "{\n" + ms.map { pad + pyStr($0.key) + ": " + pyLiteral($0.value, indent: indent + 4) + "," }
                .joined(separator: "\n") + "\n" + end + "}"
        }
    }

    /// 数字能否无损地写成 JS / Python 字面量（不超出双精度安全整数、有效数字不超过 15 位）；
    /// 嵌套过深时也放弃（保留原始字符串），避免生成字面量时递归太深
    static func lossless(_ v: JSONValue, depth: Int = 0) -> Bool {
        if depth > 64 { return false }
        switch v {
        case .number(let n):
            let body = n.hasPrefix("-") ? String(n.dropFirst()) : n
            if !body.isEmpty, body.allSatisfy({ $0.isASCII && $0.isNumber }) {
                guard let d = Double(n) else { return false }
                return abs(d) <= 9_007_199_254_740_991
            }
            var digits = body
            if let e = digits.firstIndex(where: { $0 == "e" || $0 == "E" }) { digits = String(digits[..<e]) }
            digits = digits.replacingOccurrences(of: ".", with: "")
            while digits.hasPrefix("0") { digits.removeFirst() }
            return digits.count <= 15
        case .array(let items): return items.allSatisfy { lossless($0, depth: depth + 1) }
        case .object(let members): return members.allSatisfy { lossless($0.value, depth: depth + 1) }
        default: return true
        }
    }

    // MARK: - URL

    /// 生成代码前把 URL 里的空格、中文等字符按 UTF-8 百分号编码（与浏览器一致），其余保持原样；国际化域名转成 Punycode
    public static func encodeURLForCode(_ url: String) -> String {
        func printable(_ c: Unicode.Scalar) -> Bool { c.value >= 0x21 && c.value <= 0x7E }
        if url.unicodeScalars.allSatisfy(printable) { return url }
        let encodeRuns: (Substring) -> String = { Curl.percentEncode(String($0), keep: printable) }
        guard let sep = url.range(of: "://"), let first = url.unicodeScalars.first, Curl.isAlpha(first),
              url[..<sep.lowerBound].unicodeScalars.allSatisfy({ Curl.isAlpha($0) || Curl.isDigit($0) || $0 == "+" || $0 == "." || $0 == "-" })
        else { return encodeRuns(url[...]) }
        let afterScheme = url[sep.upperBound...]
        let authEnd = afterScheme.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) ?? afterScheme.endIndex
        var authority = String(afterScheme[..<authEnd])
        if !authority.unicodeScalars.allSatisfy(printable) {
            authority = idnAuthority(authority) ?? encodeRuns(authority[...])
        }
        return String(url[..<sep.upperBound]) + authority + encodeRuns(afterScheme[authEnd...])
    }

    static func idnAuthority(_ authority: String) -> String? {
        func printable(_ c: Unicode.Scalar) -> Bool { c.value >= 0x21 && c.value <= 0x7E }
        var userinfo = ""
        var hostPort = Substring(authority)
        if let at = authority.lastIndex(of: "@") {
            let info = authority[..<at]
            hostPort = authority[authority.index(after: at)...]
            let user: Substring
            let pass: Substring
            if let colon = info.firstIndex(of: ":") {
                user = info[..<colon]
                pass = info[info.index(after: colon)...]
            } else {
                user = info
                pass = ""
            }
            if !user.isEmpty {
                userinfo = Curl.percentEncode(String(user), keep: printable)
                if !pass.isEmpty { userinfo += ":" + Curl.percentEncode(String(pass), keep: printable) }
                userinfo += "@"
            }
        }
        var host = hostPort
        var port: Substring = ""
        if let colon = hostPort.lastIndex(of: ":"), !hostPort.hasPrefix("[") {
            let p = hostPort[hostPort.index(after: colon)...]
            if p.allSatisfy({ $0.isASCII && $0.isNumber }) {
                host = hostPort[..<colon]
                port = hostPort[colon...]
            }
        }
        guard let ascii = idnaHost(String(host)) else { return nil }
        return userinfo + ascii + port
    }

    /// 国际化域名 → ASCII（小写 + NFKC，逐个标签做 Punycode）
    public static func idnaHost(_ host: String) -> String? {
        let mapped = host.precomposedStringWithCompatibilityMapping.lowercased()
            .replacingOccurrences(of: "\u{3002}", with: ".")
            .replacingOccurrences(of: "\u{FF61}", with: ".")
            .replacingOccurrences(of: "\u{FF0E}", with: ".")
        // 与 WHATWG URL 一致：主机名里不能有空白与这些符号
        let forbidden = Set(" #%/:<>?@[\\]^|".unicodeScalars)
        if mapped.unicodeScalars.contains(where: { $0.value <= 0x20 || $0.value == 0x7F || forbidden.contains($0) }) { return nil }
        var labels: [String] = []
        for label in mapped.split(separator: ".", omittingEmptySubsequences: false) {
            if label.unicodeScalars.allSatisfy(\.isASCII) {
                labels.append(String(label))
            } else {
                guard let p = punycode(String(label)) else { return nil }
                labels.append("xn--" + p)
            }
        }
        return labels.joined(separator: ".")
    }

    /// RFC 3492 Punycode 编码
    public static func punycode(_ input: String) -> String? {
        let base = 36, tmin = 1, tmax = 26, skew = 38, damp = 700
        let cps = input.unicodeScalars.map { Int($0.value) }
        func adapt(_ d: Int, _ numPoints: Int, _ first: Bool) -> Int {
            var delta = first ? d / damp : d / 2
            delta += delta / numPoints
            var k = 0
            while delta > ((base - tmin) * tmax) / 2 {
                delta /= base - tmin
                k += base
            }
            return k + (base - tmin + 1) * delta / (delta + skew)
        }
        func digit(_ d: Int) -> Unicode.Scalar {
            Unicode.Scalar(UInt8(d < 26 ? 97 + d : 22 + d))
        }
        var output = String.UnicodeScalarView()
        for c in cps where c < 0x80 { output.append(Unicode.Scalar(UInt8(c))) }
        let b = output.count
        var h = b
        if b > 0 { output.append("-") }
        var n = 128
        var delta = 0
        var bias = 72
        while h < cps.count {
            guard let m = cps.filter({ $0 >= n }).min() else { return nil }
            let (mul, o1) = (m - n).multipliedReportingOverflow(by: h + 1)
            guard !o1 else { return nil }
            delta += mul
            n = m
            for c in cps {
                if c < n { delta += 1 }
                if c == n {
                    var q = delta
                    var k = base
                    while true {
                        let t = k <= bias ? tmin : (k >= bias + tmax ? tmax : k - bias)
                        if q < t { break }
                        output.append(digit(t + (q - t) % (base - t)))
                        q = (q - t) / (base - t)
                        k += base
                    }
                    output.append(digit(q))
                    bias = adapt(delta, h + 1, h == b)
                    delta = 0
                    h += 1
                }
            }
            delta += 1
            n += 1
        }
        return String(output)
    }
}
