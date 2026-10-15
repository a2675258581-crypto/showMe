import Foundation

// 时间戳 ⇄ 日期时间的纯逻辑：纳秒精度的时刻、时区换算（只依赖 Foundation 的 TimeZone）、
// 各种日期写法的解析与格式化。日历运算全部是整数算法，不受 Date 范围限制。

/// 一个精确到纳秒的时刻：epochMs 为向下取整的毫秒，subMsNs ∈ [0, 999999]
public struct Instant: Hashable, Sendable {
    public var epochMs: Int64
    public var subMsNs: Int

    public init(epochMs: Int64, subMsNs: Int = 0) {
        self.epochMs = epochMs
        self.subMsNs = subMsNs
    }

    public init(date: Date) {
        self.init(epochMs: Timestamp.epochMs(date))
    }
}

public enum TsUnit: String, Sendable, CaseIterable {
    case s, ms, us, ns

    /// 每个单位对应的纳秒数
    public var nanos: UInt32 {
        switch self {
        case .s: 1_000_000_000
        case .ms: 1_000_000
        case .us: 1_000
        case .ns: 1
        }
    }

    /// 精确到纳秒需要的小数位
    var fractionDigits: Int {
        switch self {
        case .s: 9
        case .ms: 6
        case .us: 3
        case .ns: 0
        }
    }

    public func label(_ lang: Lang) -> String {
        switch self {
        case .s: lang.t("秒", "seconds")
        case .ms: lang.t("毫秒", "milliseconds")
        case .us: lang.t("微秒", "microseconds")
        case .ns: lang.t("纳秒", "nanoseconds")
        }
    }
}

/// 某时区下的墙上时间
public struct WallTime: Hashable, Sendable {
    public var year: Int64
    public var month: Int
    public var day: Int
    public var hour: Int = 0
    public var minute: Int = 0
    public var second: Int = 0
    public var millisecond: Int = 0

    public init(year: Int64, month: Int, day: Int, hour: Int = 0, minute: Int = 0, second: Int = 0, millisecond: Int = 0) {
        self.year = year
        self.month = month
        self.day = day
        self.hour = hour
        self.minute = minute
        self.second = second
        self.millisecond = millisecond
    }
}

public struct ZonedParts: Hashable, Sendable {
    public var wall: WallTime
    /// 0 = 星期日
    public var weekday: Int
    /// 与 UTC 的偏移（秒），东八区为 +28800
    public var offsetSeconds: Int
}

public enum Disambiguation: String, Sendable {
    case exact, gap, overlap
}

/// 时区：IANA 名称 + Foundation 的 TimeZone
public struct Zone: Sendable {
    public let id: String
    public let timeZone: TimeZone

    public init?(_ id: String) {
        guard let tz = TimeZone(identifier: id) else { return nil }
        self.id = id
        self.timeZone = tz
    }

    public init(_ timeZone: TimeZone) {
        self.id = timeZone.identifier
        self.timeZone = timeZone
    }

    public static let utc = Zone(TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0) ?? TimeZone.current)

    /// 该时刻的 UTC 偏移（秒）；越界的探测点夹到边界上（那里是固定的地方平时）
    public func offsetSeconds(at epochMs: Int64) -> Int {
        let probe = max(-Timestamp.maxEpochMs, min(Timestamp.maxEpochMs, epochMs))
        return timeZone.secondsFromGMT(for: Date(timeIntervalSince1970: Double(probe) / 1000))
    }
}

public enum Timestamp {
    /// JavaScript Date 能表示的最大毫秒数（±1 亿天），与网页版保持一致
    public static let maxEpochMs: Int64 = 8_640_000_000_000_000
    static let dayMs: Int64 = 86_400_000

    static func rangeError(_ lang: Lang) -> ToolError {
        ToolError(lang.t(
            "超出可表示的范围：日期只支持 ±8.64×10¹⁵ 毫秒（约公元前 27 万年至公元 27.5 万年）",
            "Out of range: dates are limited to ±8.64×10¹⁵ ms (about 271,000 BC to AD 275,000)"
        ))
    }

    /// Date → 毫秒（先四舍五入到微秒，避免 1700000000.123 这类浮点误差变成 …122）
    public static func epochMs(_ date: Date) -> Int64 {
        let us = (date.timeIntervalSince1970 * 1_000_000).rounded()
        guard us.isFinite else { return 0 }
        let ms = (us / 1000).rounded(.down)
        return Int64(max(-Double(maxEpochMs), min(Double(maxEpochMs), ms)))
    }

    static func floorDiv(_ a: Int64, _ b: Int64) -> Int64 {
        let q = a / b
        return (a % b != 0 && ((a < 0) != (b < 0))) ? q - 1 : q
    }

    static func mod(_ a: Int64, _ b: Int64) -> Int64 { ((a % b) + b) % b }

    // MARK: 日历算法（Howard Hinnant）

    /// 公历日期 → 距 1970-01-01 的天数
    public static func daysFromCivil(_ year: Int64, _ month: Int, _ day: Int) -> Int64 {
        let y = year - (month <= 2 ? 1 : 0)
        let era = floorDiv(y, 400)
        let yoe = y - era * 400
        let mp = Int64((month + 9) % 12)
        let doy = (153 * mp + 2) / 5 + Int64(day) - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    /// daysFromCivil 的逆运算
    public static func civilFromDays(_ days: Int64) -> (year: Int64, month: Int, day: Int) {
        let z = days + 719_468
        let era = floorDiv(z, 146_097)
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let day = Int(doy - (153 * mp + 2) / 5 + 1)
        let month = Int(mp < 10 ? mp + 3 : mp - 9)
        return (yoe + era * 400 + (month <= 2 ? 1 : 0), month, day)
    }

    /// 0 = 星期日（1970-01-01 是星期四）
    static func weekday(ofDays days: Int64) -> Int { Int(mod(days + 4, 7)) }

    public static func isLeapYear(_ y: Int64) -> Bool { (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 }

    public static func daysInMonth(_ y: Int64, _ m: Int) -> Int {
        switch m {
        case 2: isLeapYear(y) ? 29 : 28
        case 4, 6, 9, 11: 30
        default: 31
        }
    }

    public static func dayOfYear(_ y: Int64, _ m: Int, _ d: Int) -> Int {
        var n = d
        for i in stride(from: 1, to: m, by: 1) { n += daysInMonth(y, i) }
        return n
    }

    /// ISO 8601 周：周一为一周开始，含 1 月 4 日的那周是第 1 周
    public static func isoWeek(_ y: Int64, _ m: Int, _ d: Int) -> (year: Int64, week: Int) {
        let days = daysFromCivil(y, m, d)
        let dow = Int64((weekday(ofDays: days) + 6) % 7)
        let thursday = days + 3 - dow
        let ty = civilFromDays(thursday).year
        return (ty, 1 + Int(floorDiv(thursday - daysFromCivil(ty, 1, 1), 7)))
    }

    /// 把墙上时间当作 UTC 算出毫秒数
    public static func wallToUtcMs(_ w: WallTime) -> Int64 {
        daysFromCivil(w.year, w.month, w.day) * dayMs + Int64(w.hour) * 3_600_000 + Int64(w.minute) * 60_000
            + Int64(w.second) * 1000 + Int64(w.millisecond)
    }

    public static func zonedParts(_ epochMs: Int64, _ zone: Zone) -> ZonedParts {
        let offset = zone.offsetSeconds(at: epochMs)
        let local = epochMs + Int64(offset) * 1000
        let days = floorDiv(local, dayMs)
        let rest = local - days * dayMs
        let c = civilFromDays(days)
        let wall = WallTime(
            year: c.year, month: c.month, day: c.day,
            hour: Int(rest / 3_600_000), minute: Int((rest % 3_600_000) / 60_000),
            second: Int((rest % 60_000) / 1000), millisecond: Int(rest % 1000)
        )
        return ZonedParts(wall: wall, weekday: weekday(ofDays: days), offsetSeconds: offset)
    }

    /// 某时区的墙上时间 → 时间戳。夏令时跳过的时刻顺延（gap），重复的时刻取较早的一次（overlap）。
    public static func zonedToEpoch(_ w: WallTime, _ zone: Zone) -> (epochMs: Int64, kind: Disambiguation) {
        let wall = wallToUtcMs(w)
        let before = Int64(zone.offsetSeconds(at: wall - dayMs)) * 1000
        let after = Int64(zone.offsetSeconds(at: wall + dayMs)) * 1000
        var candidates: [Int64] = [wall - before]
        if wall - after != wall - before { candidates.append(wall - after) }
        candidates = candidates.filter { Int64(zone.offsetSeconds(at: $0)) * 1000 == wall - $0 }
        if candidates.count == 2 { return (candidates.min() ?? candidates[0], .overlap) }
        if let only = candidates.first { return (only, .exact) }
        return (wall - before, .gap)
    }

    // MARK: 格式化

    static func pad(_ n: Int, _ width: Int = 2) -> String { NumberText.pad(n, width) }

    static func formatYear(_ y: Int64) -> String {
        y < 0 ? "-" + pad(Int(-y), 4) : pad(Int(y), 4)
    }

    static func isoYear(_ y: Int64) -> String {
        if y >= 0 && y <= 9999 { return pad(Int(y), 4) }
        return (y < 0 ? "-" : "+") + pad(Int(y.magnitude), 6)
    }

    /// +08:00；带秒的历史偏移（地方平时）输出 +08:05:43
    public static func formatOffset(_ seconds: Int, separator: String = ":") -> String {
        let sign = seconds < 0 ? "-" : "+"
        let a = abs(seconds)
        let s = a % 60
        return sign + pad(a / 3600) + separator + pad((a % 3600) / 60) + (s != 0 ? separator + pad(s) : "")
    }

    /// 0–9 位小数，去掉末尾多余的 0（按 3 位一组保留）
    static func fraction(_ ms: Int, _ subMsNs: Int) -> String {
        if subMsNs == 0 { return ms != 0 ? "." + pad(ms, 3) : "" }
        let ns = pad(ms, 3) + pad(subMsNs, 6)
        return "." + (subMsNs % 1000 == 0 ? String(ns.prefix(6)) : ns)
    }

    public static func formatDateTime(_ w: WallTime, subMsNs: Int = 0, withFraction: Bool = true) -> String {
        let base = "\(formatYear(w.year))-\(pad(w.month))-\(pad(w.day)) \(pad(w.hour)):\(pad(w.minute)):\(pad(w.second))"
        return withFraction ? base + fraction(w.millisecond, subMsNs) : base
    }

    public static func formatISO(_ i: Instant, _ zone: Zone) -> String {
        let p = zonedParts(i.epochMs, zone)
        let w = p.wall
        return "\(isoYear(w.year))-\(pad(w.month))-\(pad(w.day))T\(pad(w.hour)):\(pad(w.minute)):\(pad(w.second))"
            + fraction(w.millisecond, i.subMsNs) + formatOffset(p.offsetSeconds)
    }

    /// 与 Date#toISOString 一致：UTC、固定 3 位毫秒、Z 结尾
    public static func formatISOUtc(_ epochMs: Int64) -> String {
        let days = floorDiv(epochMs, dayMs)
        let rest = epochMs - days * dayMs
        let c = civilFromDays(days)
        return "\(isoYear(c.year))-\(pad(c.month))-\(pad(c.day))T\(pad(Int(rest / 3_600_000))):\(pad(Int(rest % 3_600_000 / 60000))):\(pad(Int(rest % 60000 / 1000))).\(pad(Int(rest % 1000), 3))Z"
    }

    static let enWeekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    static let enWeekdaysFull = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    static let enMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    static let enMonthsFull = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    public static let weekdayZh = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]
    public static let weekdayShortZh = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

    /// RFC 2822：Mon, 01 Jan 2024 08:00:00 +0800
    public static func formatRFC2822(_ epochMs: Int64, _ zone: Zone) -> String {
        let p = zonedParts(epochMs, zone)
        let w = p.wall
        let off = Int((Double(p.offsetSeconds) / 60).rounded()) * 60
        return "\(enWeekdays[p.weekday]), \(pad(w.day)) \(enMonths[w.month - 1]) \(formatYear(w.year)) \(pad(w.hour)):\(pad(w.minute)):\(pad(w.second)) \(formatOffset(off, separator: ""))"
    }

    /// HTTP 日期（RFC 7231 IMF-fixdate）：Mon, 01 Jan 2024 00:00:00 GMT
    public static func formatHttpDate(_ epochMs: Int64) -> String {
        let s = formatRFC2822(epochMs, .utc)
        return s.hasSuffix(" +0000") ? String(s.dropLast(6)) + " GMT" : s
    }

    public static func formatChinese(_ p: ZonedParts) -> String {
        let w = p.wall
        let y = w.year > 0 ? "\(w.year)年" : "公元前\(1 - w.year)年"
        return "\(y)\(w.month)月\(w.day)日 \(weekdayZh[p.weekday]) \(pad(w.hour)):\(pad(w.minute)):\(pad(w.second))"
    }

    /// 相对时间：3小时前 / 2天后 / 现在（中文与 Intl.RelativeTimeFormat zh-CN 一致）
    public static func formatRelative(_ targetMs: Int64, _ nowMs: Int64, _ lang: Lang) -> String {
        let diff = Double(targetMs - nowMs) / 1000
        let a = abs(diff)
        if a < 1 { return lang.t("现在", "now") }
        let units: [(Double, String, String)] = [
            (365 * 86400, "年", "year"), (30 * 86400, "个月", "month"), (86400, "天", "day"),
            (3600, "小时", "hour"), (60, "分钟", "minute"), (1, "秒钟", "second"),
        ]
        for (size, zh, en) in units where a >= size {
            let n = Int64((a / size).rounded(.towardZero))
            if lang == .zh { return "\(n)\(zh)\(diff < 0 ? "前" : "后")" }
            let unit = n == 1 ? en : en + "s"
            return diff < 0 ? "\(n) \(unit) ago" : "in \(n) \(unit)"
        }
        return lang.t("现在", "now")
    }

    /// 时长：95 天 3 小时 12 分 5 秒（最多保留 3 个单位）
    public static func formatDuration(_ ms: Int64, _ lang: Lang, maxUnits: Int = 3) -> String {
        var s = Int64(ms.magnitude / 1000)
        if s == 0 { return lang.t("不到 1 秒", "less than a second") }
        let units: [(String, String, Int64)] = [
            ("年", "y", 365 * 86400), ("天", "d", 86400), ("小时", "h", 3600), ("分", "min", 60), ("秒", "s", 1),
        ]
        var out: [String] = []
        for (zh, en, size) in units {
            if s >= size {
                out.append("\(s / size) \(lang.t(zh, en))")
                s %= size
            } else if !out.isEmpty {
                out.append("")
            }
            if out.count >= maxUnits { break }
        }
        return out.filter { !$0.isEmpty }.joined(separator: " ")
    }

    // MARK: 纳秒 ⇄ 字符串

    /// 按单位输出时间戳（向下取整，任意大小都不溢出）
    public static func instantToUnit(_ i: Instant, _ unit: TsUnit) -> String {
        var a = BigUInt(i.epochMs.magnitude)
        a.multiply(by: 1_000_000)
        if i.epochMs >= 0 {
            a.add(UInt64(i.subMsNs))
            a.divide(by: unit.nanos)
            return a.toString()
        }
        // 负数：总纳秒 = -(|ms|·10⁶ - sub)，向下取整即对绝对值向上取整
        a.subtract(UInt64(i.subMsNs))
        let rem = a.divide(by: unit.nanos)
        if rem != 0 { a.add(1) }
        return a.isZero ? "0" : "-" + a.toString()
    }
}
