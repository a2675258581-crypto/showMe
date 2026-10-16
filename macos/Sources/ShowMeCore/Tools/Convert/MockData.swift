import Foundation

// 假数据生成（纯逻辑）。
// - 可复现：同一个种子 + 同一份字段定义永远生成同样的数据；每一列用「种子 + 列名」派生独立的随机流，
//   所以改动某一列、调整顺序或增减行数都不会打乱其它列。
// - 身份证号、银行卡号、统一社会信用代码都带正确的校验位。

public enum MockData {
    // MARK: 随机数

    /// mulberry32：足够快、分布良好的 32 位 PRNG（与网页版逐位一致）
    public final class Rng {
        private var a: UInt32

        public init(seed: UInt32) { a = seed }

        /// [0, 1)
        public func next() -> Double {
            a = a &+ 0x6D2B_79F5
            var t = a
            t = (t ^ (t >> 15)) &* (t | 1)
            t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
            return Double(t ^ (t >> 14)) / 4_294_967_296
        }

        /// [lo, hi] 闭区间整数；区间超过 2^32 时拼两次随机数得到 53 位精度
        public func int(_ lo: Int64, _ hi: Int64) -> Int64 {
            guard hi > lo else { return lo }
            let span = Double(hi) - Double(lo) + 1
            if span <= 4_294_967_296 { return Int64((next() * span).rounded(.down)) + lo }
            let r = ((next() * 2_097_152).rounded(.down) * 4_294_967_296 + next() * 4_294_967_296) / 9_007_199_254_740_992
            return min(hi, Int64((r * span).rounded(.down) + Double(lo)))
        }

        public func int(_ lo: Int, _ hi: Int) -> Int { Int(int(Int64(lo), Int64(hi))) }

        public func pick<T>(_ list: [T]) -> T {
            list[min(list.count - 1, Int((next() * Double(list.count)).rounded(.down)))]
        }

        public func chance(_ p: Double) -> Bool { next() < p }

        /// n 位随机数字串（可有前导 0）
        public func digits(_ n: Int) -> String {
            String((0..<max(0, n)).map { _ in Character(String(int(0, 9))) })
        }

        /// 按权重抽取
        func weighted<T>(_ entries: [(T, Double)]) -> T {
            let total = entries.reduce(0) { $0 + $1.1 }
            var x = next() * total
            for e in entries {
                if x < e.1 { return e.0 }
                x -= e.1
            }
            return entries[entries.count - 1].0
        }
    }

    /// 字符串 → 32 位哈希（用于从种子和列名派生子种子，与网页版一致：按 UTF-16 码元）
    public static func hashString(_ str: String) -> UInt32 {
        let units = Array(str.utf16)
        var h: UInt32 = 1_779_033_703 ^ UInt32(truncatingIfNeeded: units.count)
        for c in units {
            h = (h ^ UInt32(c)) &* 3_432_918_353
            h = (h << 13) | (h >> 19)
        }
        h = (h ^ (h >> 16)) &* 2_246_822_507
        h = (h ^ (h >> 13)) &* 3_266_489_909
        return h ^ (h >> 16)
    }

    // MARK: 校验位

    static let idWeights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    static let idCheck = Array("10X98765432")

    /// 身份证前 17 位 → 第 18 位校验码（ISO 7064 MOD 11-2）
    public static func idCardCheckDigit(_ first17: String) -> String {
        let d = Array(first17).compactMap(\.wholeNumberValue)
        guard d.count == 17 else { return "" }
        let sum = zip(d, idWeights).reduce(0) { $0 + $1.0 * $1.1 }
        return String(idCheck[sum % 11])
    }

    /// 18 位身份证号：格式、出生日期、校验码都正确
    public static func isValidIdCard(_ id: String) -> Bool {
        let c = Array(id)
        guard c.count == 18, c.prefix(17).allSatisfy({ $0.isASCII && $0.isNumber }), c[17].isASCII, c[17].isNumber || c[17] == "X" else { return false }
        guard let y = Int64(String(c[6..<10])), let m = Int(String(c[10..<12])), let d = Int(String(c[12..<14])),
              (1...12).contains(m), d >= 1, d <= Timestamp.daysInMonth(y, m) else { return false }
        return idCardCheckDigit(String(c.prefix(17))) == String(c[17])
    }

    /// 给数字串计算 Luhn 校验位（附加在末尾）
    public static func luhnCheckDigit(_ payload: String) -> String {
        var sum = 0
        for (i, ch) in payload.reversed().enumerated() {
            var n = ch.wholeNumberValue ?? 0
            if i % 2 == 0 {
                n *= 2
                if n > 9 { n -= 9 }
            }
            sum += n
        }
        return String((10 - sum % 10) % 10)
    }

    public static func isLuhnValid(_ num: String) -> Bool {
        let s = num.filter { !$0.isWhitespace }
        guard s.count >= 2, s.allSatisfy({ $0.isASCII && $0.isNumber }) else { return false }
        return luhnCheckDigit(String(s.dropLast())) == String(s.suffix(1))
    }

    /// 统一社会信用代码字符集（不含 I O Z S V）
    public static let creditCodeChars = Array("0123456789ABCDEFGHJKLMNPQRTUWXY")
    static let ccWeights = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]

    /// 统一社会信用代码前 17 位 → 第 18 位校验字符（GB 32100-2015）；含非法字符时返回 nil
    public static func creditCodeCheckChar(_ first17: String) -> String? {
        let c = Array(first17)
        guard c.count >= 17 else { return nil }
        var sum = 0
        for i in 0..<17 {
            guard let v = creditCodeChars.firstIndex(of: c[i]) else { return nil }
            sum += v * ccWeights[i]
        }
        return String(creditCodeChars[(31 - sum % 31) % 31])
    }

    public static func isValidCreditCode(_ code: String) -> Bool {
        code.count == 18 && creditCodeCheckChar(String(code.prefix(17))) == String(code.suffix(1))
    }

    static let orgWeights = [3, 7, 9, 10, 5, 8, 4, 2]

    /// 组织机构代码前 8 位 → 校验字符（GB 11714），可能是 X
    public static func orgCodeCheckChar(_ first8: String) -> String {
        let c = Array(first8)
        guard c.count >= 8 else { return "" }
        var sum = 0
        for i in 0..<8 { sum += (c[i].unicodeScalars.first.flatMap(BaseConverter.digitValue) ?? 0) * orgWeights[i] }
        let v = 11 - sum % 11
        return v == 11 ? "0" : v == 10 ? "X" : String(v)
    }

    public static func isValidOrgCode(_ code: String) -> Bool {
        let c = Array(code)
        guard c.count == 9, c.prefix(8).allSatisfy({ $0.isASCII && ($0.isNumber || $0.isUppercase) }) else { return false }
        return orgCodeCheckChar(String(c.prefix(8))) == String(c[8])
    }

    // MARK: 时间

    private static let wallPattern = Pattern(#"^\s*([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})(?:[ T]([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?)?\s*$"#)

    /// 解析墙上时间：2024-01-02、2024/1/2 08:30、2024-01-02 08:30:15；返回把它当作 UTC 字段的毫秒数
    public static func parseWallTime(_ s: String) -> Int64? {
        guard let m = wallPattern.match(s), let y = Int64(m[1] ?? "") else { return nil }
        let v = m.dropFirst(2).map { Int($0 ?? "0") ?? 0 }
        let (mo, d, h, mi, se) = (v[0], v[1], v[2], v[3], v[4])
        guard (1...12).contains(mo), d >= 1, d <= Timestamp.daysInMonth(y, mo), h <= 23, mi <= 59, se <= 59 else { return nil }
        return Timestamp.wallToUtcMs(WallTime(year: y, month: mo, day: d, hour: h, minute: mi, second: se))
    }

    public enum DateFormat: String, CaseIterable, Sendable {
        case datetime, date, time, iso, ts, tsms
    }

    /// 墙上时间毫秒数 → 文本 / 时间戳；offsetHours 为墙上时间所在时区（中文数据按北京时间，英文数据按 UTC）
    public static func formatWallTime(_ wall: Int64, _ format: DateFormat, offsetHours: Int = 8) -> Cell {
        let days = Timestamp.floorDiv(wall, 86_400_000)
        let c = Timestamp.civilFromDays(days)
        let rest = Int(wall - days * 86_400_000)
        let date = "\(c.year)-\(NumberText.pad(c.month))-\(NumberText.pad(c.day))"
        let time = "\(NumberText.pad(rest / 3_600_000)):\(NumberText.pad(rest / 60000 % 60)):\(NumberText.pad(rest / 1000 % 60))"
        let offsetMs = Int64(offsetHours) * 3_600_000
        switch format {
        case .date: return .string(date)
        case .time: return .string(time)
        case .iso: return .string("\(date)T\(time)" + (offsetHours == 0 ? "Z" : Timestamp.formatOffset(offsetHours * 3600)))
        case .ts: return .int(Timestamp.floorDiv(wall - offsetMs, 1000))
        case .tsms: return .int(wall - offsetMs)
        case .datetime: return .string("\(date) \(time)")
        }
    }

    // MARK: 单元格

    public enum Cell: Hashable, Sendable {
        case string(String)
        case int(Int64)
        /// 小数，按 JS 的数字写法保存
        case number(String)
        case bool(Bool)
        case null

        public var text: String {
            switch self {
            case .string(let s): s
            case .int(let n): String(n)
            case .number(let s): s
            case .bool(let b): b ? "true" : "false"
            case .null: ""
            }
        }

        public var isNumeric: Bool {
            switch self {
            case .int, .number: true
            default: false
            }
        }

        var json: JSONValue {
            switch self {
            case .string(let s): .string(s)
            case .int(let n): .number(String(n))
            case .number(let s): .number(s)
            case .bool(let b): .bool(b)
            case .null: .null
            }
        }
    }

    public enum Locale: String, Sendable {
        case zh, en
    }
}
