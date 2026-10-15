import Foundation

// Cron 表达式：规范化与逐字段校验、展开成取值集合、按时区计算接下来的执行时间。
// 5 段（分 时 日 月 周）或 6 段（秒 分 时 日 月 周），支持 * , - / ? L # H、月份与星期英文缩写、@daily 等宏。

public enum Cron {
    public enum FieldKey: String, CaseIterable, Sendable {
        case second, minute, hour, dayOfMonth, month, dayOfWeek
    }

    public struct FieldSpec: Sendable {
        public let key: FieldKey
        /// 短名：秒 / 分 / 时 / 日 / 月 / 周
        public let label: LocalizedText
        /// 全称：秒 / 分钟 / 小时 / 日期 / 月份 / 星期
        public let name: LocalizedText
        public let min: Int
        public let max: Int
    }

    public static let specs: [FieldKey: FieldSpec] = [
        .second: FieldSpec(key: .second, label: LocalizedText("秒", "second"), name: LocalizedText("秒", "second"), min: 0, max: 59),
        .minute: FieldSpec(key: .minute, label: LocalizedText("分", "minute"), name: LocalizedText("分钟", "minute"), min: 0, max: 59),
        .hour: FieldSpec(key: .hour, label: LocalizedText("时", "hour"), name: LocalizedText("小时", "hour"), min: 0, max: 23),
        .dayOfMonth: FieldSpec(key: .dayOfMonth, label: LocalizedText("日", "day of month"), name: LocalizedText("日期", "day of month"), min: 1, max: 31),
        .month: FieldSpec(key: .month, label: LocalizedText("月", "month"), name: LocalizedText("月份", "month"), min: 1, max: 12),
        .dayOfWeek: FieldSpec(key: .dayOfWeek, label: LocalizedText("周", "day of week"), name: LocalizedText("星期", "day of week"), min: 0, max: 7),
    ]

    static func spec(_ k: FieldKey) -> FieldSpec {
        specs[k] ?? FieldSpec(key: k, label: LocalizedText("", ""), name: LocalizedText("", ""), min: 0, max: 0)
    }

    public static let order: [FieldKey] = FieldKey.allCases

    static let monthAliases: [String: Int] = ["JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6, "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12]
    static let dowAliases: [String: Int] = ["SUN": 0, "MON": 1, "TUE": 2, "WED": 3, "THU": 4, "FRI": 5, "SAT": 6]

    /// 预定义宏 → 5 段表达式
    public static let macros: [(String, String)] = [
        ("@yearly", "0 0 1 1 *"), ("@annually", "0 0 1 1 *"), ("@monthly", "0 0 1 * *"), ("@weekly", "0 0 * * 0"),
        ("@daily", "0 0 * * *"), ("@midnight", "0 0 * * *"), ("@hourly", "0 * * * *"), ("@minutely", "* * * * *"),
        ("@weekdays", "0 0 * * 1-5"), ("@weekends", "0 0 * * 0,6"),
    ]

    public struct Normalized: Hashable, Sendable {
        /// 6 个字段（5 段表达式的秒字段为 "0"）
        public var fields: [FieldKey: String]
        /// 是否为 6 段（含秒）
        public var hasSeconds: Bool
        /// 规范化后的表达式（5 或 6 段，单空格分隔）
        public var expression: String
        /// 使用的宏，如 @daily
        public var macro: String?
        /// crontab 行里表达式后面的命令
        public var command: String?

        public func token(_ k: FieldKey) -> String { fields[k] ?? "*" }
    }

    // MARK: 校验

    static func parseValue(_ v: String, _ spec: FieldSpec) -> Int? {
        if !v.isEmpty, v.allSatisfy({ $0.isASCII && $0.isNumber }) { return Int(v) ?? Int.max }
        switch spec.key {
        case .month: return monthAliases[v.uppercased()]
        case .dayOfWeek: return dowAliases[v.uppercased()]
        default: return nil
        }
    }

    /// 字段的称呼：不带位置时为「「分」字段」，带位置时为「第 2 段（分钟）」
    static func whereText(_ spec: FieldSpec, _ position: Int?, _ lang: Lang) -> String {
        if let p = position {
            return lang.t("第 \(p) 段（\(spec.name.zh)）", "Field \(p) (\(spec.name.en))")
        }
        return lang.t("「\(spec.label.zh)」字段", "The \(spec.name.en) field")
    }

    static func valueHint(_ spec: FieldSpec, _ lang: Lang) -> String {
        switch spec.key {
        case .month: return lang.t("可用 1–12 或 JAN–DEC", "use 1–12 or JAN–DEC")
        case .dayOfWeek: return lang.t("可用 0–7（0 和 7 都是周日）或 SUN–SAT", "use 0–7 (0 and 7 are Sunday) or SUN–SAT")
        default: return lang.t("应为 \(spec.min)–\(spec.max) 的整数", "it must be an integer from \(spec.min) to \(spec.max)")
        }
    }

    static func checkNumber(_ raw: String, _ spec: FieldSpec, _ w: String, _ lang: Lang) -> Result<Int, ToolError> {
        guard let n = parseValue(raw, spec) else {
            return .failure(ToolError(lang.t("\(w)：无法识别「\(raw)」，\(valueHint(spec, .zh))", "\(w): can’t read “\(raw)”; \(valueHint(spec, .en))")))
        }
        if n < spec.min || n > spec.max {
            return .failure(ToolError(lang.t("\(w)的值 \(n) 超出范围（\(spec.min)–\(spec.max)）", "\(w): the value \(n) is out of range (\(spec.min)–\(spec.max))")))
        }
        return .success(n)
    }

    private static let hashPattern = Pattern(#"^H(?:\(([0-9]+)-([0-9]+)\))?(?:/([0-9]+))?$"#, caseInsensitive: true)
    private static let lastDowPattern = Pattern(#"^(\w+)L$"#, caseInsensitive: true)
    private static let nthPattern = Pattern(#"^(\w+)#(\w*)$"#)
    private static let lMinusPattern = Pattern(#"^L-[0-9]+$"#, caseInsensitive: true)
    private static let threeLetters = Pattern(#"^[A-Z]{3}"#, caseInsensitive: true)

    static func validateItem(_ item: String, _ spec: FieldSpec, _ w: String, _ lang: Lang) -> String? {
        if item.isEmpty { return lang.t("\(w)有多余的逗号", "\(w) has an extra comma") }
        if item == "*" || item == "?" { return nil }
        if hashPattern.test(item) { return nil }
        let upper = item.uppercased()
        if spec.key == .dayOfMonth {
            if upper == "L" { return nil }
            if lMinusPattern.test(item) || upper.hasSuffix("W") {
                return lang.t(
                    "\(w)：暂不支持「\(item)」（W / L-n 语法），可用 L 表示每月最后一天",
                    "\(w): “\(item)” (W / L-n syntax) isn’t supported yet; use L for the last day of the month"
                )
            }
        }
        if spec.key == .dayOfWeek {
            if let m = lastDowPattern.match(item), let v = m[1] {
                if case .failure(let e) = checkNumber(v, spec, w, lang) { return e.message }
                return nil
            }
            if let m = nthPattern.match(item), let v = m[1] {
                if case .failure(let e) = checkNumber(v, spec, w, lang) { return e.message }
                let nth = m[2] ?? ""
                if !["1", "2", "3", "4", "5"].contains(nth) {
                    return lang.t(
                        "\(w)：「#」后的序号应为 1–5（表示当月第几个），实际是「\(nth)」",
                        "\(w): the number after “#” must be 1–5 (which occurrence in the month), not “\(nth)”"
                    )
                }
                return nil
            }
        } else if (upper.contains("L") || upper.contains("#")) && spec.key != .dayOfMonth && !threeLetters.test(item) {
            return lang.t(
                "\(w)不支持「\(item)」，L / # 只能用于日或周字段",
                "\(w) doesn’t support “\(item)”; L and # only work in the day-of-month and day-of-week fields"
            )
        }
        let slash = item.components(separatedBy: "/")
        if slash.count > 2 { return lang.t("\(w)「\(item)」中有多个「/」", "\(w): “\(item)” has more than one “/”") }
        let rangePart = slash[0]
        if slash.count == 2 {
            let step = slash[1]
            if step.isEmpty || !step.allSatisfy({ $0.isASCII && $0.isNumber }) {
                return lang.t("\(w)：步长「\(step)」必须是正整数", "\(w): the step “\(step)” must be a positive integer")
            }
            if (Int(step) ?? 1) == 0 { return lang.t("\(w)：步长不能为 0", "\(w): the step can’t be 0") }
            if rangePart.isEmpty {
                return lang.t("\(w)：「/」前面缺少起始值，例如 */\(step)", "\(w): a start value is missing before “/”, e.g. */\(step)")
            }
        }
        if rangePart == "*" || rangePart == "?" { return nil }
        let bounds = rangePart.components(separatedBy: "-")
        if bounds.count > 2 || bounds.contains(where: \.isEmpty) {
            return lang.t("\(w)：「\(rangePart)」格式不正确，范围应写成 a-b", "\(w): “\(rangePart)” is malformed; write a range as a-b")
        }
        var nums: [Int] = []
        for b in bounds {
            switch checkNumber(b, spec, w, lang) {
            case .failure(let e): return e.message
            case .success(let n): nums.append(n)
            }
        }
        if nums.count == 2, nums[0] > nums[1] {
            return lang.t(
                "\(w)：范围「\(rangePart)」的起点大于终点，不支持跨越边界的范围，可拆成两段（如 22-23,0-2）",
                "\(w): the range “\(rangePart)” starts after it ends; wrap-around ranges aren’t supported, so split it (e.g. 22-23,0-2)"
            )
        }
        return nil
    }

    /// 校验单个字段，返回错误信息；position 为 1 起始的段号（可选，用于报错）
    public static func validateField(_ token: String, _ key: FieldKey, position: Int? = nil, lang: Lang = .zh) -> String? {
        let s = spec(key)
        let w = whereText(s, position, lang)
        if key == .dayOfWeek, token.contains("#"), token.contains(",") {
            return lang.t("\(w)：「#」不能与逗号列表一起使用", "\(w): “#” can’t be combined with a comma list")
        }
        for item in token.components(separatedBy: ",") {
            if let e = validateItem(item, s, w, lang) { return e }
        }
        return nil
    }

    /// 逐段校验；返回第一个错误及其段号（0 起始）
    static func validateAll(_ tokens: [String], _ lang: Lang) -> (message: String, index: Int)? {
        let keys = tokens.count == 6 ? order : Array(order.dropFirst())
        for (i, k) in keys.enumerated() where i < tokens.count {
            if let e = validateField(tokens[i], k, position: i + 1, lang: lang) { return (e, i) }
        }
        return nil
    }

    static func toNormalized(_ tokens: [String], macro: String? = nil, command: String? = nil) -> Normalized {
        let hasSeconds = tokens.count == 6
        let t = hasSeconds ? tokens : ["0"] + tokens
        var fields: [FieldKey: String] = [:]
        for (i, k) in order.enumerated() where i < t.count { fields[k] = t[i] }
        return Normalized(fields: fields, hasSeconds: hasSeconds, expression: tokens.joined(separator: " "), macro: macro, command: command)
    }

    private static let yearLike7 = Pattern(#"^(?:\*|\?|[0-9]{4}(?:[-/,][0-9]{1,4})*)$"#)
    private static let yearLike6 = Pattern(#"^[0-9]{4}(?:[-/,][0-9]{1,4})*$"#)
    private static let plainSixth = Pattern(#"^[0-9*?,\-/]+$"#)

    /// 规范化并校验表达式：5 段、6 段、@daily 等宏；crontab 行会把后面的命令分离出来。
    /// 报错时 column 指向出错字段在输入中的位置（1 起始，按字符计）。
    public static func normalize(_ input: String, lang: Lang = .zh) throws -> Normalized {
        // 记录每段在原文中的列号
        var tokens: [String] = []
        var columns: [Int] = []
        var current = ""
        var col = 0
        var start = 0
        for ch in input {
            col += 1
            if ch.isWhitespace {
                if !current.isEmpty {
                    tokens.append(current)
                    columns.append(start)
                    current = ""
                }
            } else {
                if current.isEmpty { start = col }
                current.append(ch)
            }
        }
        if !current.isEmpty {
            tokens.append(current)
            columns.append(start)
        }
        let singleLine = !input.trimmingCharacters(in: .whitespacesAndNewlines).contains(where: \.isNewline)
        func fail(_ message: String, at index: Int? = nil) -> ToolError {
            guard singleLine, let i = index, i < columns.count else { return ToolError(message) }
            return ToolError(message, line: 1, column: columns[i])
        }

        guard let first = tokens.first else { throw ToolError(lang.t("请输入 Cron 表达式", "Enter a cron expression")) }
        if first.hasPrefix("@") {
            let macro = first.lowercased()
            if macro == "@reboot" {
                throw ToolError(lang.t("@reboot 表示系统启动时运行一次，没有固定的执行时间", "@reboot runs once at system startup and has no fixed schedule"))
            }
            guard let expr = macros.first(where: { $0.0 == macro })?.1 else {
                let list = macros.map(\.0)
                throw fail(lang.t(
                    "未知的预定义表达式「\(first)」，可用：\(list.joined(separator: "、"))",
                    "Unknown macro “\(first)”; available: \(list.joined(separator: ", "))"
                ), at: 0)
            }
            let command = tokens.dropFirst().joined(separator: " ")
            return toNormalized(expr.components(separatedBy: " "), macro: macro, command: command.isEmpty ? nil : command)
        }
        if tokens.count < 5 {
            throw ToolError(lang.t(
                "Cron 表达式至少需要 5 段（分 时 日 月 周），当前只有 \(tokens.count) 段",
                "A cron expression needs at least 5 fields (minute hour day month weekday); this one has \(tokens.count)"
            ))
        }
        if tokens.count == 7, yearLike7.test(tokens[6]), validateAll(Array(tokens.prefix(6)), lang) == nil {
            throw fail(lang.t("检测到第 7 段（年份，Quartz 语法），暂不支持；请去掉最后的年份", "A 7th field (year, Quartz syntax) isn’t supported; remove the trailing year"), at: 6)
        }
        if tokens.count == 6, yearLike6.test(tokens[5]), (Int(tokens[5].prefix(4)) ?? 0) > 7, validateAll(Array(tokens.prefix(5)), lang) == nil {
            throw fail(lang.t(
                "最后一段「\(tokens[5])」看起来是年份（Quartz 语法），暂不支持；请去掉年份",
                "The last field “\(tokens[5])” looks like a year (Quartz syntax), which isn’t supported; remove it"
            ), at: 5)
        }
        if tokens.count >= 6 {
            let six = validateAll(Array(tokens.prefix(6)), lang)
            if six == nil {
                let command = tokens.dropFirst(6).joined(separator: " ")
                return toNormalized(Array(tokens.prefix(6)), command: command.isEmpty ? nil : command)
            }
            let five = validateAll(Array(tokens.prefix(5)), lang)
            if five == nil, !plainSixth.test(tokens[5]) {
                return toNormalized(Array(tokens.prefix(5)), command: tokens.dropFirst(5).joined(separator: " "))
            }
            if tokens.count == 6, let six { throw fail(six.message, at: six.index) }
            if let e = five ?? six { throw fail(e.message, at: e.index) }
        }
        if let e = validateAll(tokens, lang) { throw fail(e.message, at: e.index) }
        return toNormalized(tokens)
    }

    // MARK: 展开

    /// 展开后的计划：每个字段允许的取值，以及日 / 周字段的 L、# 规则
    public struct Schedule: Sendable {
        public var seconds: [Int]
        public var minutes: [Int]
        public var hours: [Int]
        public var days: Set<Int>
        public var lastDayOfMonth: Bool
        public var months: [Int]
        public var weekdays: Set<Int>
        /// 每月最后一个星期几（5L）
        public var lastWeekdays: Set<Int>
        /// 每月第 n 个星期几（1#2）
        public var nthWeekdays: [(weekday: Int, n: Int)]
        public var domWildcard: Bool
        public var dowWildcard: Bool
    }

    /// FNV-1a，用表达式本身作 H 的种子，保证同一表达式结果稳定
    static func hash(_ s: String) -> UInt32 {
        var h: UInt32 = 2_166_136_261
        for b in s.utf8 {
            h ^= UInt32(b)
            h = h &* 16_777_619
        }
        return h
    }

    static func expandItem(_ item: String, _ spec: FieldSpec, seed: String) -> [Int] {
        let maxV = spec.key == .dayOfWeek ? 6 : spec.max
        if item == "*" || item == "?" { return Array(spec.min...maxV) }
        if let m = hashPattern.match(item) {
            var lo = Int(m[1] ?? "") ?? spec.min
            var hi = Int(m[2] ?? "") ?? maxV
            lo = min(max(lo, spec.min), maxV)
            hi = min(max(hi, spec.min), maxV)
            if lo > hi { swap(&lo, &hi) }
            let h = Int(hash(seed + "|" + spec.key.rawValue) % 1_000_003)
            if let st = Int(m[3] ?? "").map({ min($0, 1000) }), st > 0 {
                let start = lo + h % min(st, hi - lo + 1)
                return Array(stride(from: start, through: hi, by: st))
            }
            return [lo + h % (hi - lo + 1)]
        }
        let slash = item.components(separatedBy: "/")
        // 步长超过取值范围时效果相同，夹到 1000 以内避免 stride 溢出
        let step = slash.count == 2 ? max(1, min(1000, Int(slash[1]) ?? 1000)) : 1
        let rangePart = slash[0]
        var lo: Int
        var hi: Int
        if rangePart == "*" || rangePart == "?" {
            lo = spec.min
            hi = spec.max
        } else {
            let b = rangePart.components(separatedBy: "-")
            lo = parseValue(b[0], spec) ?? spec.min
            hi = b.count > 1 ? (parseValue(b[1], spec) ?? lo) : (slash.count == 2 ? spec.max : lo)
        }
        lo = max(spec.min, lo)
        hi = min(spec.max, hi)
        guard lo <= hi else { return [] }
        return stride(from: lo, through: hi, by: step).map { spec.key == .dayOfWeek && $0 == 7 ? 0 : $0 }
    }

    public static func schedule(_ n: Normalized) -> Schedule {
        var s = Schedule(seconds: [], minutes: [], hours: [], days: [], lastDayOfMonth: false, months: [], weekdays: [],
                         lastWeekdays: [], nthWeekdays: [], domWildcard: false, dowWildcard: false)
        func values(_ k: FieldKey) -> [Int] {
            let sp = spec(k)
            var set = Set<Int>()
            for item in n.token(k).components(separatedBy: ",") {
                if k == .dayOfMonth, item.uppercased() == "L" { s.lastDayOfMonth = true; continue }
                if k == .dayOfWeek {
                    if let m = lastDowPattern.match(item), let v = parseValue(m[1] ?? "", sp) {
                        s.lastWeekdays.insert(v % 7)
                        continue
                    }
                    if let m = nthPattern.match(item), let v = parseValue(m[1] ?? "", sp), let nth = Int(m[2] ?? "") {
                        s.nthWeekdays.append((v % 7, nth))
                        continue
                    }
                }
                set.formUnion(expandItem(item, sp, seed: n.expression))
            }
            return set.sorted()
        }
        s.seconds = values(.second)
        s.minutes = values(.minute)
        s.hours = values(.hour)
        s.months = values(.month)
        let dom = values(.dayOfMonth)
        let dow = values(.dayOfWeek)
        s.days = Set(dom)
        s.weekdays = Set(dow)
        s.domWildcard = !s.lastDayOfMonth && dom.count == 31
        s.dowWildcard = s.lastWeekdays.isEmpty && s.nthWeekdays.isEmpty && dow.count == 7
        return s
    }

    static func dayMatches(_ s: Schedule, year: Int64, month: Int, day: Int) -> Bool {
        let dim = Timestamp.daysInMonth(year, month)
        let wd = Timestamp.weekday(ofDays: Timestamp.daysFromCivil(year, month, day))
        let domMatch = s.days.contains(day) || (s.lastDayOfMonth && day == dim)
        let dowMatch = s.weekdays.contains(wd) || (s.lastWeekdays.contains(wd) && day + 7 > dim)
            || s.nthWeekdays.contains { $0.weekday == wd && (day - 1) / 7 + 1 == $0.n }
        if s.domWildcard && s.dowWildcard { return true }
        if s.domWildcard { return dowMatch }
        if s.dowWildcard { return domMatch }
        // 「日」和「周」都指定时满足其一即可（标准 cron 的“或”语义）
        return domMatch || dowMatch
    }

    /// 日期与月份的组合根本不存在（如 2 月 30 日）
    static func isImpossible(_ s: Schedule) -> Bool {
        guard s.dowWildcard, !s.lastDayOfMonth, !s.days.isEmpty else { return s.months.isEmpty }
        let longest = s.months.map { Timestamp.daysInMonth(2024, $0) }.max() ?? 0
        return (s.days.min() ?? 99) > longest
    }

    public enum RunError: Error, Sendable {
        case impossible, notFound
    }

    /// 从 fromMs 之后（不含）开始，在 zone 时区里找接下来的 count 次执行时间（毫秒）
    public static func nextRuns(_ s: Schedule, zone: Zone, fromMs: Int64, count: Int) throws -> [Int64] {
        if isImpossible(s) { throw RunError.impossible }
        guard !s.seconds.isEmpty, !s.minutes.isEmpty, !s.hours.isEmpty else { throw RunError.notFound }
        let monthSet = Set(s.months)
        func next(_ list: [Int], after v: Int) -> Int? { list.first { $0 > v } }

        let startMs = Timestamp.floorDiv(fromMs, 1000) * 1000 + 1000
        var w = Timestamp.zonedParts(startMs, zone).wall
        var (y, mo, d, h, mi, sec) = (w.year, w.month, w.day, w.hour, w.minute, w.second)
        let yearLimit = y + 2000
        var runs: [Int64] = []
        var last = fromMs
        var steps = 0

        func nextMonth() {
            mo += 1
            if mo > 12 { mo = 1; y += 1 }
            (d, h, mi, sec) = (1, 0, 0, 0)
        }
        func nextDay() {
            d += 1
            (h, mi, sec) = (0, 0, 0)
            if d > Timestamp.daysInMonth(y, mo) { nextMonth() }
        }

        while runs.count < count {
            steps += 1
            if steps > 3_000_000 || y > yearLimit { break }
            if !monthSet.contains(mo) {
                nextMonth()
                continue
            }
            if d > Timestamp.daysInMonth(y, mo) {
                nextMonth()
                continue
            }
            if !dayMatches(s, year: y, month: mo, day: d) {
                nextDay()
                continue
            }
            if !s.hours.contains(h) {
                if let nh = next(s.hours, after: h) { (h, mi, sec) = (nh, 0, 0) } else { nextDay() }
                continue
            }
            if !s.minutes.contains(mi) {
                if let nm = next(s.minutes, after: mi) { (mi, sec) = (nm, 0) } else if let nh = next(s.hours, after: h) { (h, mi, sec) = (nh, 0, 0) } else { nextDay() }
                continue
            }
            if !s.seconds.contains(sec) {
                if let ns = next(s.seconds, after: sec) { sec = ns } else if let nm = next(s.minutes, after: mi) { (mi, sec) = (nm, 0) } else if let nh = next(s.hours, after: h) { (h, mi, sec) = (nh, 0, 0) } else { nextDay() }
                continue
            }
            w = WallTime(year: y, month: mo, day: d, hour: h, minute: mi, second: sec)
            // 夏令时跳过的时刻顺延，重复的时刻只取较早的一次
            let epoch = Timestamp.zonedToEpoch(w, zone).epochMs
            if epoch.magnitude > Timestamp.maxEpochMs.magnitude { break }
            if epoch > last {
                runs.append(epoch)
                last = epoch
            }
            // 前进到下一个候选秒
            if let ns = next(s.seconds, after: sec) { sec = ns }
            else if let nm = next(s.minutes, after: mi) { (mi, sec) = (nm, s.seconds[0]) }
            else if let nh = next(s.hours, after: h) { (h, mi, sec) = (nh, s.minutes[0], s.seconds[0]) }
            else { nextDay() }
        }
        if runs.isEmpty { throw RunError.notFound }
        return runs
    }
}
