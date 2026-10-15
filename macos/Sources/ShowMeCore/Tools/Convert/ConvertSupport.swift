import Foundation

// 本批工具共用的小工具：正则封装、随机数流、按 JS 规则格式化数字、全角转半角。

// MARK: - 正则

/// NSRegularExpression 的薄封装：模式写死在源码里，编译失败时（理论上不会）只是永远不匹配，不会崩溃。
final class Pattern: @unchecked Sendable {
    private let re: NSRegularExpression?

    init(_ pattern: String, caseInsensitive: Bool = false) {
        re = try? NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
    }

    /// 整体匹配时返回各捕获组（下标 0 为整个匹配；未参与匹配的组为 nil）
    func match(_ s: String) -> [String?]? {
        guard let re else { return nil }
        let ns = s as NSString
        guard let m = re.firstMatch(in: s, options: [], range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (0..<m.numberOfRanges).map { i in
            let r = m.range(at: i)
            return r.location == NSNotFound ? nil : ns.substring(with: r)
        }
    }

    func test(_ s: String) -> Bool {
        guard let re else { return false }
        return re.firstMatch(in: s, options: [], range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }

    func replace(_ s: String, with template: String) -> String {
        guard let re else { return s }
        return re.stringByReplacingMatches(in: s, options: [], range: NSRange(location: 0, length: (s as NSString).length), withTemplate: template)
    }

    /// 所有匹配（每个匹配的各捕获组）
    func all(_ s: String) -> [[String?]] {
        guard let re else { return [] }
        let ns = s as NSString
        return re.matches(in: s, options: [], range: NSRange(location: 0, length: ns.length)).map { m in
            (0..<m.numberOfRanges).map { i in
                let r = m.range(at: i)
                return r.location == NSNotFound ? nil : ns.substring(with: r)
            }
        }
    }

    /// 按匹配切分（类似 JS 的 String#split(regex)，不含捕获组）
    func split(_ s: String) -> [String] {
        guard let re else { return [s] }
        let ns = s as NSString
        var out: [String] = []
        var last = 0
        for m in re.matches(in: s, options: [], range: NSRange(location: 0, length: ns.length)) {
            out.append(ns.substring(with: NSRange(location: last, length: m.range.location - last)))
            last = m.range.location + m.range.length
        }
        out.append(ns.substring(from: last))
        return out
    }
}

// MARK: - 随机数

/// 把 `ToolInput.random` 包装成带缓冲的字节流，并提供无取模偏差的均匀整数。
public final class RandomStream {
    private let source: @Sendable (Int) -> [UInt8]
    private var buffer: [UInt8] = []
    private var pos = 0

    public init(_ source: @escaping @Sendable (Int) -> [UInt8]) {
        self.source = source
    }

    public func byte() -> UInt8 {
        if pos >= buffer.count {
            buffer = source(256)
            pos = 0
            // 注入的随机源返回空数组时退化为 0，保证不会死循环或越界
            if buffer.isEmpty { return 0 }
        }
        defer { pos += 1 }
        return buffer[pos]
    }

    public func bytes(_ n: Int) -> [UInt8] {
        (0..<max(0, n)).map { _ in byte() }
    }

    public func uint32() -> UInt32 {
        var x: UInt32 = 0
        for _ in 0..<4 { x = (x << 8) | UInt32(byte()) }
        return x
    }

    /// 均匀分布的 [0, n)：拒绝采样，只接受落在 n 的整数倍范围内的 32 位值
    public func int(_ n: Int) -> Int {
        guard n > 1 else { return 0 }
        let n64 = UInt64(min(n, Int(UInt32.max) + 1))
        let space: UInt64 = 1 << 32
        let limit = space - space % n64
        // 极端情况下（注入的随机源一直给出被拒绝的值）最多重试有限次
        for _ in 0..<10_000 {
            let x = UInt64(uint32())
            if x < limit { return Int(x % n64) }
        }
        return Int(UInt64(uint32()) % n64)
    }
}

// MARK: - 数字格式化

enum NumberText {
    /// 与 JS `String(Math.round(n * 10^d) / 10^d)` 一致：四舍五入并去掉多余的 0，-0 写成 0
    static func fixed(_ n: Double, _ digits: Int) -> String {
        guard n.isFinite else { return n.isNaN ? "NaN" : (n > 0 ? "Infinity" : "-Infinity") }
        let f = pow(10, Double(digits))
        let v = (n * f + 0.5).rounded(.down) / f
        return trimmed(v, digits)
    }

    /// 按 `%.{digits}f` 输出后去掉末尾的 0 与小数点
    static func trimmed(_ v: Double, _ digits: Int) -> String {
        var s = String(format: "%.\(max(0, digits))f", v)
        if s.contains(".") {
            while s.hasSuffix("0") { s.removeLast() }
            if s.hasSuffix(".") { s.removeLast() }
        }
        if s == "-0" { s = "0" }
        return s
    }

    /// 类似 JS 的 Number#toString：整数不带小数点，其余用最短表示
    static func js(_ v: Double) -> String {
        guard v.isFinite else { return v.isNaN ? "NaN" : (v > 0 ? "Infinity" : "-Infinity") }
        if v == v.rounded(), abs(v) < 1e21 {
            if abs(v) < 9.0e18 { return String(Int64(v)) }
            return String(format: "%.0f", v)
        }
        let s = "\(v)"
        // Swift 在 |v| < 1e-4 时用科学计数法（1e-05），JS 要到 1e-7 才用
        if s.contains("e"), abs(v) >= 1e-7, abs(v) < 1e21 {
            return trimmed(v, 20)
        }
        return s.replacingOccurrences(of: "e-0", with: "e-").replacingOccurrences(of: "e+0", with: "e+")
    }

    /// 千位分隔：1234567 → 1,234,567
    static func grouped(_ n: Int) -> String {
        let s = String(n.magnitude)
        var out = ""
        for (i, ch) in s.enumerated() {
            if i > 0, (s.count - i) % 3 == 0 { out.append(",") }
            out.append(ch)
        }
        return (n < 0 ? "-" : "") + out
    }

    static func pad(_ n: Int, _ width: Int = 2) -> String {
        let s = String(n.magnitude)
        return s.count >= width ? s : String(repeating: "0", count: width - s.count) + s
    }

    private static let superscripts: [Character] = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"]

    static func superscript(_ n: Int) -> String {
        String(String(n).map { ch -> Character in
            if ch == "-" { return "⁻" }
            if let d = ch.wholeNumberValue, d >= 0, d < 10 { return superscripts[d] }
            return ch
        })
    }
}

// MARK: - 文本

enum TextUtil {
    /// 全角 ASCII（中文输入法常见的１２３、：、－）与全角空格转成半角
    static func halfWidth(_ s: String) -> String {
        var scalars = String.UnicodeScalarView()
        scalars.reserveCapacity(s.unicodeScalars.count)
        for u in s.unicodeScalars {
            if u.value == 0x3000 {
                scalars.append(" ")
            } else if u.value >= 0xFF01, u.value <= 0xFF5E, let h = Unicode.Scalar(u.value - 0xFEE0) {
                scalars.append(h)
            } else {
                scalars.append(u)
            }
        }
        return String(scalars)
    }

    /// 按行拆分（兼容 \r\n；Swift 里 "\r\n" 是一个 Character）
    static func lines(_ s: String) -> [String] {
        s.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" || $0 == "\r\n" }).map(String.init)
    }
}
