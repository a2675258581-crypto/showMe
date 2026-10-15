import Foundation

// 时间戳与各种日期写法的解析。错误信息直接按界面语言给出。

public struct ParsedTimestamp: Hashable, Sendable {
    public var instant: Instant
    public var unit: TsUnit
    /// 单位是否由数量级自动识别
    public var detected: Bool
}

public struct ParsedDate: Hashable, Sendable {
    public var instant: Instant
    /// 识别出的格式
    public var format: LocalizedText
    /// 输入是否自带时区 / 偏移
    public var zoneFromInput: Bool
    public var kind: Disambiguation
    /// 输入是纯数字时间戳时识别出的单位
    public var unit: TsUnit?
}

extension Timestamp {
    // MARK: 时间戳

    /// 按数量级猜测单位：< 10¹¹ 秒、< 10¹⁴ 毫秒、< 10¹⁷ 微秒，其余纳秒
    public static func detectUnit(_ intPart: BigUInt) -> TsUnit {
        if intPart < BigUInt.pow10(11) { return .s }
        if intPart < BigUInt.pow10(14) { return .ms }
        if intPart < BigUInt.pow10(17) { return .us }
        return .ns
    }

    /// 把科学计数法 1.7e9 展开成普通小数字符串
    static func expandExponent(_ mantissa: String, _ exp: Int) -> String {
        let parts = mantissa.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        let i = parts.first ?? ""
        let f = parts.count > 1 ? parts[1] : ""
        var digits = i + f
        var point = i.count + exp
        if point < 0 {
            digits = String(repeating: "0", count: -point) + digits
            point = 0
        }
        if point > digits.count { digits += String(repeating: "0", count: point - digits.count) }
        let intText = String(digits.prefix(point))
        let frac = String(digits.dropFirst(point))
        return (intText.isEmpty ? "0" : intText) + (frac.isEmpty ? "" : "." + frac)
    }

    private static let sciPattern = Pattern(#"^([+-]?)([0-9]+(?:\.[0-9]*)?|\.[0-9]+)[eE]([+-]?[0-9]{1,3})$"#)
    private static let plainPattern = Pattern(#"^([+-]?)([0-9]*)(?:\.([0-9]*))?$"#)
    private static let signInMiddle = Pattern(#".[+-]"#)

    /// 时间戳允许出现的字符：数字、正负号、小数点、e、空白与分组符
    private static func isTimestampChar(_ u: Unicode.Scalar) -> Bool {
        if u.properties.isWhitespace { return true }
        return "0123456789+-.eE_,'".unicodeScalars.contains(u)
    }

    /// 解析时间戳字符串。允许负数、小数、下划线/逗号/空格分隔以及科学计数法；unit 为 nil 时按数量级识别。
    public static func parseTimestamp(_ raw: String, unit explicit: TsUnit? = nil, lang: Lang = .zh) throws -> ParsedTimestamp {
        let half = TextUtil.halfWidth(raw)
        let trimmed = half.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { throw ToolError(lang.t("请输入时间戳", "Enter a timestamp")) }
        var pos = 0
        for u in half.unicodeScalars {
            pos += 1
            if !isTimestampChar(u) {
                throw ToolError(lang.t(
                    "第 \(pos) 个字符「\(u)」不是数字：时间戳只能包含数字、负号和小数点",
                    "Character \(pos) “\(u)” is not a digit: a timestamp may only contain digits, a minus sign and a decimal point"
                ))
            }
        }
        var s = String(String.UnicodeScalarView(trimmed.unicodeScalars.filter { u in
            !(u.properties.isWhitespace || u == "_" || u == "," || u == "'")
        }))
        if let m = sciPattern.match(s), let mant = m[2], let e = Int(m[3] ?? "") {
            s = (m[1] ?? "") + expandExponent(mant, e)
        }
        guard let m = plainPattern.match(s), !((m[2] ?? "").isEmpty && (m[3] ?? "").isEmpty) else {
            if s.filter({ $0 == "." }).count > 1 {
                throw ToolError(lang.t("格式不正确：只能有一个小数点", "Invalid format: only one decimal point is allowed"))
            }
            if signInMiddle.test(s) {
                throw ToolError(lang.t("格式不正确：正负号只能出现在开头", "Invalid format: a sign may only appear at the start"))
            }
            throw ToolError(lang.t("格式不正确：请输入整数或小数形式的时间戳", "Invalid format: enter the timestamp as an integer or a decimal"))
        }
        let negative = m[1] == "-"
        let intDigits = Array((m[2] ?? "").utf8).map { $0 - 48 }
        let intPart = BigUInt(digits: intDigits, radix: 10)
        let unit = explicit ?? detectUnit(intPart)
        let fd = unit.fractionDigits
        var frac = String((m[3] ?? "").prefix(fd))
        while frac.count < fd { frac += "0" }
        var total = intPart
        total.multiply(by: unit.nanos, adding: 0)
        if fd > 0, let f = UInt64(frac) { total.add(f) }
        // 超大数字先粗略判断，避免后续换算溢出
        if BigUInt.pow10(25) < total { throw rangeError(lang) }
        guard let instant = instantFromNs(total, negative: negative), instant.epochMs.magnitude <= maxEpochMs.magnitude else {
            throw rangeError(lang)
        }
        return ParsedTimestamp(instant: instant, unit: unit, detected: explicit == nil)
    }

    /// 带符号的总纳秒 → 时刻（向下取整到毫秒）；毫秒数放不进 Int64 时返回 nil
    static func instantFromNs(_ magnitude: BigUInt, negative: Bool) -> Instant? {
        var q = magnitude
        let r = Int(q.divide(by: 1_000_000))
        guard q.fitsUInt64, q.low64 < UInt64(Int64.max) else { return nil }
        let ms = Int64(q.low64)
        if !negative || (ms == 0 && r == 0) { return Instant(epochMs: ms, subMsNs: r) }
        return r == 0 ? Instant(epochMs: -ms, subMsNs: 0) : Instant(epochMs: -ms - 1, subMsNs: 1_000_000 - r)
    }

    // MARK: 时区偏移

    static let zoneAbbr: [String: Int] = [
        "z": 0, "ut": 0, "utc": 0, "gmt": 0,
        "est": -300, "edt": -240, "cst": -360, "cdt": -300,
        "mst": -420, "mdt": -360, "pst": -480, "pdt": -420,
    ]

    static let zoneRE = #"(Z|UTC|GMT|UT|[ECMP][SD]T|(?:UTC|GMT)?\s*[+-][0-9]{1,2}(?::?[0-9]{2})?)"#
    private static let offsetPattern = Pattern(#"^(?:utc|gmt)?\s*([+-])([0-9]{1,2})(?::?([0-9]{2}))?$"#)

    /// 解析偏移字符串 → 分钟；无法识别返回 nil
    public static func parseZoneOffset(_ z: String) -> Int? {
        let s = z.trimmingCharacters(in: .whitespaces).lowercased()
        if let v = zoneAbbr[s] { return v }
        guard let m = offsetPattern.match(s), let h = Int(m[2] ?? "") else { return nil }
        let mins = Int(m[3] ?? "") ?? 0
        if h > 18 || mins > 59 { return nil }
        return (m[1] == "-" ? -1 : 1) * (h * 60 + mins)
    }

    // MARK: 字段校验

    struct Fields {
        var year: Int64
        var month: Int
        var day: Int
        var hour = 0
        var minute = 0
        var second = 0
        /// 小数秒的数字串
        var fraction = ""
    }

    static func validate(_ f: Fields, _ lang: Lang) -> String? {
        if f.month < 1 || f.month > 12 {
            return lang.t("月份「\(f.month)」无效，应为 1–12", "Invalid month “\(f.month)”: must be 1–12")
        }
        let dim = daysInMonth(f.year, f.month)
        if f.day < 1 || f.day > dim {
            if f.day >= 1 && f.day <= 31 {
                return lang.t(
                    "\(f.year) 年 \(f.month) 月只有 \(dim) 天，没有 \(f.day) 日",
                    "\(enMonthsFull[f.month - 1]) \(f.year) has only \(dim) days, not \(f.day)"
                )
            }
            return lang.t("日期「\(f.day)」无效，应为 1–\(dim)", "Invalid day “\(f.day)”: must be 1–\(dim)")
        }
        if f.hour > 23 { return lang.t("小时「\(f.hour)」无效，应为 0–23", "Invalid hour “\(f.hour)”: must be 0–23") }
        if f.minute > 59 { return lang.t("分钟「\(f.minute)」无效，应为 0–59", "Invalid minute “\(f.minute)”: must be 0–59") }
        if f.second > 59 { return lang.t("秒「\(f.second)」无效，应为 0–59", "Invalid second “\(f.second)”: must be 0–59") }
        return nil
    }

    static func fieldsToInstant(_ f: Fields, _ zone: Zone, offsetMinutes: Int?, _ lang: Lang) throws -> (Instant, Disambiguation) {
        if let e = validate(f, lang) { throw ToolError(e) }
        // 年份最多 6 位，墙上毫秒数不会溢出；先粗略判断范围
        guard f.year.magnitude <= 1_000_000 else { throw rangeError(lang) }
        var frac = String(f.fraction.prefix(9))
        while frac.count < 9 { frac += "0" }
        let wall = WallTime(year: f.year, month: f.month, day: f.day, hour: f.hour, minute: f.minute, second: f.second,
                            millisecond: Int(frac.prefix(3)) ?? 0)
        var epochMs: Int64
        var kind = Disambiguation.exact
        if let off = offsetMinutes {
            epochMs = wallToUtcMs(wall) - Int64(off) * 60_000
        } else {
            (epochMs, kind) = zonedToEpoch(wall, zone)
        }
        if epochMs.magnitude > maxEpochMs.magnitude { throw rangeError(lang) }
        return (Instant(epochMs: epochMs, subMsNs: Int(frac.suffix(6)) ?? 0), kind)
    }

    static func to24h(_ hour: Int, _ marker: String?) -> Int {
        guard let marker else { return hour }
        let m = marker.lowercased()
        if ["pm", "下午", "晚上"].contains(m) { return hour < 12 ? hour + 12 : hour }
        if ["am", "凌晨", "上午", "早上"].contains(m) { return hour == 12 ? 0 : hour }
        if m == "中午" { return hour < 11 ? hour + 12 : hour }
        return hour
    }

    // MARK: 日历运算

    /// 在指定时区对墙上时间做日历运算（年 / 月 / 周 / 天）或精确运算（时 / 分 / 秒）；越界返回 nil
    static func add(_ epochMs: Int64, _ zone: Zone, _ amount: Double, _ unit: String) -> Int64? {
        guard amount.isFinite else { return nil }
        if ["y", "M", "w", "d"].contains(unit) {
            // 超过 ±100 万年必然越界，提前返回，避免整数溢出
            let limit: Double = unit == "y" ? 1e6 : unit == "M" ? 1.2e7 : unit == "w" ? 6e7 : 4e8
            guard abs(amount) <= limit else { return nil }
            let n = Int64(amount)
            let p = zonedParts(epochMs, zone)
            var w = p.wall
            switch unit {
            case "y":
                w.year += n
                w.day = min(w.day, daysInMonth(w.year, w.month))
            case "M":
                let total = w.year * 12 + Int64(w.month - 1) + n
                w.year = floorDiv(total, 12)
                w.month = Int(mod(total, 12)) + 1
                w.day = min(w.day, daysInMonth(w.year, w.month))
            default:
                let c = civilFromDays(daysFromCivil(w.year, w.month, w.day) + n * (unit == "w" ? 7 : 1))
                (w.year, w.month, w.day) = (c.year, c.month, c.day)
            }
            let r = zonedToEpoch(w, zone).epochMs
            return r.magnitude <= maxEpochMs.magnitude ? r : nil
        }
        let size: Double = ["h": 3_600_000, "m": 60_000, "s": 1000, "ms": 1][unit] ?? 0
        let r = Double(epochMs) + amount * size
        guard r.isFinite, abs(r) <= Double(maxEpochMs) else { return nil }
        return Int64(r.rounded(.down))
    }

    static func startOfDay(_ epochMs: Int64, _ zone: Zone, _ dayOffset: Int) -> Int64? {
        var w = zonedParts(epochMs, zone).wall
        (w.hour, w.minute, w.second, w.millisecond) = (0, 0, 0, 0)
        let base = zonedToEpoch(w, zone).epochMs
        return dayOffset == 0 ? base : add(base, zone, Double(dayOffset), "d")
    }

    static let relUnit: [String: String] = [
        "y": "y", "yr": "y", "year": "y", "years": "y",
        "M": "M", "mo": "M", "mon": "M", "month": "M", "months": "M",
        "w": "w", "wk": "w", "week": "w", "weeks": "w",
        "d": "d", "day": "d", "days": "d",
        "h": "h", "hr": "h", "hour": "h", "hours": "h",
        "m": "m", "min": "m", "mins": "m", "minute": "m", "minutes": "m",
        "s": "s", "sec": "s", "secs": "s", "second": "s", "seconds": "s",
        "ms": "ms",
    ]

    static let zhUnit: [String: String] = [
        "年": "y", "个月": "M", "月": "M", "周": "w", "星期": "w", "个星期": "w", "礼拜": "w",
        "天": "d", "日": "d", "小时": "h", "个小时": "h", "钟头": "h", "分钟": "m", "分": "m", "秒": "s", "秒钟": "s",
    ]

    private static let enRelative = Pattern(#"^(?:now\s*)?((?:[+-]?\s*[0-9]+(?:\.[0-9]+)?\s*[a-zA-Z]+\s*)+)(ago)?$"#, caseInsensitive: true)
    private static let inPrefix = Pattern(#"^in\s+(.+)$"#, caseInsensitive: true)
    private static let startsWithNow = Pattern(#"^now"#, caseInsensitive: true)
    private static let relItem = Pattern(#"([+-])?\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)"#)
    private static let zhRelative = Pattern(#"^([0-9]+|半)\s*(个星期|个小时|个月|星期|礼拜|小时|钟头|分钟|秒钟|年|月|周|天|日|分|秒)\s*(以前|之前|以后|之后|前|后)$"#)

    static func relativeResult(_ ms: Int64?, _ lang: Lang) throws -> ParsedDate {
        guard let ms else { throw rangeError(lang) }
        return ParsedDate(instant: Instant(epochMs: ms), format: LocalizedText("相对时间", "Relative time"), zoneFromInput: false, kind: .exact)
    }

    static func parseRelative(_ s: String, _ zone: Zone, _ nowMs: Int64, _ lang: Lang) throws -> ParsedDate? {
        let lower = s.lowercased()
        let keyword: [String: Int] = ["today": 0, "今天": 0, "今日": 0, "yesterday": -1, "昨天": -1, "tomorrow": 1, "明天": 1, "前天": -2, "后天": 2]
        if lower == "now" || s == "现在" || s == "此刻" {
            return ParsedDate(instant: Instant(epochMs: nowMs), format: LocalizedText("当前时间", "Current time"), zoneFromInput: false, kind: .exact)
        }
        if let k = keyword[lower] {
            guard let ms = startOfDay(nowMs, zone, k) else { throw rangeError(lang) }
            return ParsedDate(instant: Instant(epochMs: ms), format: LocalizedText("相对日期（当天 00:00）", "Relative date (start of day)"), zoneFromInput: false, kind: .exact)
        }
        // now+1d、+1d2h、-3h、1d ago、in 2 hours
        if let inP = inPrefix.match(s) {
            return try applyRelative(body: inP[1] ?? "", ago: false, zone, nowMs, lang)
        }
        if let en = enRelative.match(s), startsWithNow.test(s) || s.hasPrefix("+") || s.hasPrefix("-") || en[2] != nil {
            return try applyRelative(body: en[1] ?? "", ago: en[2] != nil, zone, nowMs, lang)
        }
        // 3天前、2 小时后、半小时后
        if let zh = zhRelative.match(s), let numText = zh[1], let unitText = zh[2], let unit = zhUnit[unitText] {
            let n: Double = numText == "半" ? 0.5 : (Double(numText) ?? 0)
            let sign: Double = (zh[3] ?? "").contains("前") ? -1 : 1
            if n == n.rounded() { return try relativeResult(add(nowMs, zone, sign * n, unit), lang) }
            let sizes: [String: Double] = ["y": 365 * 86_400_000, "M": 30 * 86_400_000, "w": 7 * 86_400_000, "d": 86_400_000, "h": 3_600_000, "m": 60000, "s": 1000]
            return try relativeResult(add(nowMs, zone, sign * n * (sizes[unit] ?? 0), "ms"), lang)
        }
        return nil
    }

    private static func applyRelative(body: String, ago: Bool, _ zone: Zone, _ nowMs: Int64, _ lang: Lang) throws -> ParsedDate? {
        var t: Int64? = nowMs
        var sign: Double = ago ? -1 : 1
        var consumed = ""
        for m in relItem.all(body) {
            consumed += m[0] ?? ""
            if let sg = m[1] { sign = sg == "-" ? -1 : 1 }
            let raw = m[3] ?? ""
            guard let unit = relUnit[raw] ?? relUnit[raw.lowercased()] else {
                throw ToolError(lang.t(
                    "无法识别的时间单位「\(raw)」，可用 y / M / w / d / h / m / s（M 为月，m 为分钟）",
                    "Unknown time unit “\(raw)”; use y / M / w / d / h / m / s (M = month, m = minute)"
                ))
            }
            let n = Double(m[2] ?? "") ?? 0
            let isInt = n == n.rounded()
            if !isInt, unit == "y" || unit == "M" {
                throw ToolError(lang.t("年、月只能加减整数", "Years and months can only change by whole numbers"))
            }
            // 已经越界时继续读完剩下的部分，最后统一报「超出范围」
            guard let cur = t else { continue }
            if isInt || !(unit == "w" || unit == "d") {
                t = add(cur, zone, sign * n, unit)
            } else {
                t = add(cur, zone, sign * n * (unit == "w" ? 7 : 1) * 86_400_000, "ms")
            }
        }
        let squash: (String) -> String = { $0.filter { !$0.isWhitespace } }
        if squash(consumed) != squash(body) { return nil }
        return try relativeResult(t, lang)
    }

    // MARK: 日期字符串

    private static let compactPattern = Pattern(#"^([0-9]{4})([0-9]{2})([0-9]{2})(?:([0-9]{2})([0-9]{2})([0-9]{2})?)?$"#)
    private static let numberPattern = Pattern(#"^[+-]?[0-9]+(?:\.[0-9]+)?$"#)
    private static let isoPattern = Pattern(
        #"^([+-]?[0-9]{4,6})([-/.])([0-9]{1,2})(?:\2([0-9]{1,2}))?(?:(?:T|\s+)([0-9]{1,2}):([0-9]{1,2})(?::([0-9]{1,2})(?:[.,]([0-9]{1,9}))?)?\s*(am|pm)?)?\s*"#
            + zoneRE + "?$", caseInsensitive: true)
    private static let chinesePattern = Pattern(
        #"^([0-9]{4})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*[日号]?(?:\s*(凌晨|早上|上午|中午|下午|晚上)?\s*([0-9]{1,2})\s*[:：时点]\s*(?:([0-9]{1,2})\s*[:：分]?\s*(?:([0-9]{1,2})\s*秒?)?)?)?$"#)
    private static let monthRE = #"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"#
    private static let timeRE = #"(?:,?\s+([0-9]{1,2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,9}))?)?\s*(am|pm)?)?"#
    private static let rfcPattern = Pattern(
        #"^(?:[a-z]{3,9},?\s+)?([0-9]{1,2})\s+"# + monthRE + #"\s+([0-9]{2,4})"# + timeRE + #"\s*"# + zoneRE + "?$",
        caseInsensitive: true)
    private static let englishPattern = Pattern(
        #"^(?:[a-z]{3,9},?\s+)?"# + monthRE + #"\s+([0-9]{1,2})(?:st|nd|rd|th)?,?\s+([0-9]{4})"# + timeRE + #"\s*"# + zoneRE
            + #"?(?:\s*\([^)]*\))?$"#, caseInsensitive: true)
    private static let timeOnlyPattern = Pattern(#"^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,9}))?)?\s*(am|pm)?$"#, caseInsensitive: true)
    private static let jsDateHint = Pattern(#"GMT[+-]"#, caseInsensitive: true)
    private static let whitespaceRun = Pattern(#"\s+"#)
    static let monthIndex: [String: Int] = ["jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12]

    private static func withZone(_ f: Fields, _ zoneText: String?, _ zone: Zone, _ format: LocalizedText, _ lang: Lang) throws -> ParsedDate {
        var offset: Int?
        if let z = zoneText, !z.isEmpty {
            guard let o = parseZoneOffset(z) else {
                throw ToolError(lang.t(
                    "无法识别的时区偏移「\(z)」，示例：+08:00、-0500、Z、GMT+8",
                    "Unrecognized zone offset “\(z)”; examples: +08:00, -0500, Z, GMT+8"
                ))
            }
            offset = o
        }
        let (instant, kind) = try fieldsToInstant(f, zone, offsetMinutes: offset, lang)
        return ParsedDate(instant: instant, format: format, zoneFromInput: offset != nil, kind: kind)
    }

    private static func int(_ s: String?) -> Int { Int(s ?? "") ?? 0 }

    /// 解析各种日期写法：2024-01-01 12:00:00、2024/1/1、ISO 8601（含偏移）、RFC 2822、JS Date#toString、
    /// 2024年1月1日 12:30、20240101、now、today、+1d、-2h、3天前……未带时区的输入按 zone 解析。
    public static func parseDate(_ raw: String, zone: Zone, nowMs: Int64, lang: Lang = .zh) throws -> ParsedDate {
        let s = whitespaceRun.replace(TextUtil.halfWidth(raw).trimmingCharacters(in: .whitespacesAndNewlines), with: " ")
        if s.isEmpty { throw ToolError(lang.t("请输入日期时间", "Enter a date and time")) }

        if let rel = try parseRelative(s, zone, nowMs, lang) { return rel }

        // 紧凑日期：20240101 / 202401011230 / 20240101123000
        if [8, 12, 14].contains(s.count), let m = compactPattern.match(s), let y = Int64(m[1] ?? "") {
            let f = Fields(year: y, month: int(m[2]), day: int(m[3]), hour: int(m[4]), minute: int(m[5]), second: int(m[6]))
            if validate(f, lang) == nil {
                return try withZone(f, nil, zone, LocalizedText("紧凑日期 yyyyMMdd[HHmm[ss]]", "Compact date yyyyMMdd[HHmm[ss]]"), lang)
            }
        }

        // 纯数字 → 时间戳
        if numberPattern.test(s) {
            let ts = try parseTimestamp(s, lang: lang)
            return ParsedDate(
                instant: ts.instant,
                format: LocalizedText("时间戳（识别为\(ts.unit.label(.zh))）", "Timestamp (\(ts.unit.label(.en)))"),
                zoneFromInput: true, kind: .exact, unit: ts.unit
            )
        }

        // yyyy-MM-dd[ T]HH:mm[:ss[.SSS]][zone]，分隔符可为 - / .
        if let m = isoPattern.match(s), let y = Int64(m[1] ?? "") {
            let sep = m[2] ?? "-"
            if m[4] == nil && sep != "-" && sep != "/" {
                throw ToolError(lang.t("无法识别的日期格式", "Unrecognized date format"))
            }
            let f = Fields(year: y, month: int(m[3]), day: m[4].map { Int($0) ?? 0 } ?? 1,
                           hour: m[5].map { to24h(Int($0) ?? 0, m[9]) } ?? 0,
                           minute: int(m[6]), second: int(m[7]), fraction: m[8] ?? "")
            let zoneText = m[10]
            let fmt: LocalizedText
            if s.contains("T") || zoneText != nil {
                fmt = LocalizedText("ISO 8601", "ISO 8601")
            } else if sep == "-" {
                fmt = LocalizedText("yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm:ss")
            } else {
                fmt = LocalizedText("yyyy\(sep)M\(sep)d HH:mm:ss", "yyyy\(sep)M\(sep)d HH:mm:ss")
            }
            return try withZone(f, zoneText, zone, fmt, lang)
        }

        // 2024年1月1日 [下午] 12时30分[05秒] / 12:30[:05]
        if let m = chinesePattern.match(s), let y = Int64(m[1] ?? "") {
            let f = Fields(year: y, month: int(m[2]), day: int(m[3]),
                           hour: m[5].map { to24h(Int($0) ?? 0, m[4]) } ?? 0, minute: int(m[6]), second: int(m[7]))
            return try withZone(f, nil, zone, LocalizedText("中文日期", "Chinese date"), lang)
        }

        // RFC 2822 / 英文月份：[Mon, ]01 Jan 2024 08:00[:00] [+0800]
        if let m = rfcPattern.match(s), let yText = m[3], var year = Int64(yText) {
            if yText.count == 2 { year += year < 50 ? 2000 : 1900 }
            let f = Fields(year: year, month: monthIndex[(m[2] ?? "").lowercased()] ?? 0, day: int(m[1]),
                           hour: m[4].map { to24h(Int($0) ?? 0, m[8]) } ?? 0, minute: int(m[5]), second: int(m[6]),
                           fraction: m[7] ?? "")
            return try withZone(f, m[9], zone, LocalizedText("RFC 2822", "RFC 2822"), lang)
        }

        // Jan 1, 2024 10:00 / Mon Jan 01 2024 08:00:00 GMT+0800 (中国标准时间)
        if let m = englishPattern.match(s), let y = Int64(m[3] ?? "") {
            let f = Fields(year: y, month: monthIndex[(m[1] ?? "").lowercased()] ?? 0, day: int(m[2]),
                           hour: m[4].map { to24h(Int($0) ?? 0, m[8]) } ?? 0, minute: int(m[5]), second: int(m[6]),
                           fraction: m[7] ?? "")
            let js = s.contains("(") || jsDateHint.test(s)
            return try withZone(f, m[9], zone, js ? LocalizedText("JavaScript Date 字符串", "JavaScript Date string") : LocalizedText("英文日期", "English date"), lang)
        }

        // 只有时间：今天的 HH:mm[:ss]
        if let m = timeOnlyPattern.match(s) {
            let p = zonedParts(nowMs, zone).wall
            let f = Fields(year: p.year, month: p.month, day: p.day, hour: to24h(int(m[1]), m[5]), minute: int(m[2]),
                           second: int(m[3]), fraction: m[4] ?? "")
            return try withZone(f, nil, zone, LocalizedText("今天的时间", "Time today"), lang)
        }

        let shown = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        throw ToolError(lang.t(
            "无法识别「\(shown)」。支持的写法示例：2024-01-01 12:00:00、2024/1/1、2024-01-01T12:00:00+08:00、Mon, 01 Jan 2024 12:00:00 +0800、2024年1月1日 12:00、now、+1d、3天前",
            "Can’t recognize “\(shown)”. Examples: 2024-01-01 12:00:00, 2024/1/1, 2024-01-01T12:00:00+08:00, Mon, 01 Jan 2024 12:00:00 +0800, now, +1d, 3 days ago"
        ))
    }
}
