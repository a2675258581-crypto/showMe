import Foundation

// Cron 表达式的文字描述（优先用 App 内置的 cronstrue，缺失时用本地双语描述）与工具定义。

extension Cron {
    static let weekZh = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
    static let weekEn = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    static let monthEn = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

    static func isAny(_ t: String) -> Bool { t == "*" || t == "?" }

    static func fmtValue(_ n: Int, _ key: FieldKey, _ lang: Lang) -> String {
        switch key {
        case .second: return lang.t("\(n) 秒", "second \(n)")
        case .minute: return lang.t("\(n) 分", "minute \(n)")
        case .hour: return lang.t("\(n) 点", "\(n):00")
        case .dayOfMonth: return lang.t("\(n) 号", "day \(n)")
        case .month: return lang == .zh ? "\(n) 月" : (1...12).contains(n) ? monthEn[n - 1] : "month \(n)"
        case .dayOfWeek: return lang == .zh ? weekZh[((n % 7) + 7) % 7] : weekEn[((n % 7) + 7) % 7]
        }
    }

    static func every(_ key: FieldKey, _ lang: Lang) -> String {
        switch key {
        case .second: lang.t("每秒", "every second")
        case .minute: lang.t("每分钟", "every minute")
        case .hour: lang.t("每小时", "every hour")
        case .dayOfMonth: lang.t("每天", "every day")
        case .month: lang.t("每个月", "every month")
        case .dayOfWeek: lang.t("不限星期", "any day of the week")
        }
    }

    static func stepUnit(_ key: FieldKey, _ n: Int, _ lang: Lang) -> String {
        let en: String
        switch key {
        case .second: en = "second"
        case .minute: en = "minute"
        case .hour: en = "hour"
        case .month: en = "month"
        case .dayOfMonth, .dayOfWeek: en = "day"
        }
        let zh: String
        switch key {
        case .second: zh = "秒"
        case .minute: zh = "分钟"
        case .hour: zh = "小时"
        case .month: zh = "个月"
        case .dayOfMonth, .dayOfWeek: zh = "天"
        }
        return lang.t(zh, n == 1 ? en : en + "s")
    }

    static func ordinal(_ n: Int) -> String {
        switch n {
        case 1: "1st"
        case 2: "2nd"
        case 3: "3rd"
        default: "\(n)th"
        }
    }

    private static let lastDow = Pattern(#"^(\w+)L$"#, caseInsensitive: true)
    private static let nthDow = Pattern(#"^(\w+)#([0-9])$"#)

    static func explainItem(_ item: String, _ key: FieldKey, _ lang: Lang) -> String {
        let sp = spec(key)
        if item == "*" { return every(key, lang) }
        if item == "?" { return lang.t("不指定", "any") }
        if item.uppercased().hasPrefix("H") { return lang.t("随机取值（H，按任务名哈希固定）", "a hashed value (H)") }
        if key == .dayOfMonth, item.uppercased() == "L" { return lang.t("每月最后一天", "the last day of the month") }
        func val(_ v: String) -> String { fmtValue(parseValue(v, sp) ?? 0, key, lang) }
        if key == .dayOfWeek {
            if let m = lastDow.match(item) { return lang.t("每月最后一个\(val(m[1] ?? ""))", "the last \(val(m[1] ?? "")) of the month") }
            if let m = nthDow.match(item) {
                let n = Int(m[2] ?? "") ?? 1
                return lang.t("每月第 \(n) 个\(val(m[1] ?? ""))", "the \(ordinal(n)) \(val(m[1] ?? "")) of the month")
            }
        }
        let parts = item.components(separatedBy: "/")
        let range = parts[0]
        let bounds = range.components(separatedBy: "-")
        if parts.count > 1 {
            let step = parts[1]
            let unit = stepUnit(key, Int(step) ?? 2, lang)
            if isAny(range) {
                if key == .second || key == .minute || key == .hour {
                    return lang.t("每隔 \(step) \(unit)", "every \(step) \(unit)")
                }
                let start = fmtValue(sp.min, key, lang)
                return lang.t("从 \(start)起每隔 \(step) \(unit)", "every \(step) \(unit) from \(start)")
            }
            if bounds.count > 1 {
                return lang.t("\(val(bounds[0]))到 \(val(bounds[1]))之间每隔 \(step) \(unit)",
                              "every \(step) \(unit) from \(val(bounds[0])) to \(val(bounds[1]))")
            }
            return lang.t("从 \(val(bounds[0]))起每隔 \(step) \(unit)", "every \(step) \(unit) from \(val(bounds[0]))")
        }
        if bounds.count > 1 { return lang.t("\(val(bounds[0]))到 \(val(bounds[1]))", "\(val(bounds[0])) to \(val(bounds[1]))") }
        return val(range)
    }

    private static let cjkThenDigit = Pattern(#"([\x{4E00}-\x{9FA5}])([0-9])"#)
    private static let digitThenCjk = Pattern(#"([0-9])([\x{4E00}-\x{9FA5}])"#)
    private static let spaces = Pattern(#"\s+"#)

    /// 中文与数字之间补一个空格：「每隔5分钟」→「每隔 5 分钟」
    static func spaceCjk(_ s: String) -> String {
        digitThenCjk.replace(cjkThenDigit.replace(s, with: "$1 $2"), with: "$1 $2")
    }

    /// 单个字段的解释
    public static func explainToken(_ token: String, _ key: FieldKey, lang: Lang = .zh) -> String {
        let items = token.components(separatedBy: ",")
        if lang == .en { return items.map { explainItem($0, key, .en) }.joined(separator: ", ") }
        return spaceCjk(items.map { spaces.replace(explainItem($0, key, .zh), with: "") }.joined(separator: "、"))
    }

    private static let commaSpace = Pattern(#",\s*"#)
    private static let andSpaces = Pattern(#"\s*和\s*"#)
    private static let commaBeforeMonth = Pattern(#"，和(?=[一二三四五六七八九十]+月)"#)
    private static let geSpace = Pattern(#"个\s+"#)
    private static let multiSpace = Pattern(#"\s{2,}"#)
    private static let dailyPattern = Pattern(#"^在 ([0-9]{2}:[0-9]{2}(?::[0-9]{2})?)$"#)

    /// 整理 cronstrue 的中文输出：全角逗号、去掉多余空格、中文与数字间补空格、「在 02:00」→「每天 02:00」
    static func polishZh(_ s: String) -> String {
        var out = commaSpace.replace(s, with: "，")
        out = andSpaces.replace(out, with: "和")
        out = commaBeforeMonth.replace(out, with: "和")
        out = geSpace.replace(out, with: "个")
        out = multiSpace.replace(out, with: " ")
        out = spaceCjk(out).trimmingCharacters(in: .whitespaces)
        if let m = dailyPattern.match(out), let t = m[1] { out = "每天 " + t }
        return out
    }

    static func number(_ t: String) -> Int? {
        guard !t.isEmpty, t.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        return Int(t)
    }

    static func everyStep(_ t: String) -> Int? {
        guard t.hasPrefix("*/") else { return nil }
        return number(String(t.dropFirst(2)))
    }

    static func numberList(_ t: String) -> [Int]? {
        let items = t.components(separatedBy: ",").map(number)
        guard !items.isEmpty, items.allSatisfy({ $0 != nil }) else { return nil }
        return items.compactMap { $0 }
    }

    /// 只由数字、范围与列表组成（没有步长、L、#）
    static func isPlain(_ t: String) -> Bool {
        !t.contains("/") && !t.uppercased().contains("L") && !t.contains("#") && !isAny(t)
    }

    /// 字段逐一解释（cronstrue 不可用、或时间部分太复杂时使用）
    static func breakdown(_ n: Normalized, _ lang: Lang, separator: String) -> String {
        order.filter { n.hasSeconds || $0 != .second }.map { k in
            lang.t("\(spec(k).label.zh)：", "\(spec(k).name.en.capitalizedFirst): ") + explainToken(n.token(k), k, lang: lang)
        }.joined(separator: separator)
    }

    /// 本地双语描述：每天 09:30 / At 09:30 every day、每 5 分钟 / Every 5 minutes……
    public static func nativeDescription(_ n: Normalized, lang: Lang) -> String {
        let (sec, min, hour) = (n.token(.second), n.token(.minute), n.token(.hour))
        let (dom, month, dow) = (n.token(.dayOfMonth), n.token(.month), n.token(.dayOfWeek))
        if order.contains(where: { hasHash(n.token($0)) }) { return breakdown(n, lang, separator: lang.t("；", "; ")) }
        let daysAny = isAny(dom) && isAny(month) && isAny(dow)
        let secZero = !n.hasSeconds || sec == "0"

        // 时间部分；isDaily 为真时可以写成「每天 …」
        var time: String?
        if !secZero {
            if sec == "*", isAny(min), isAny(hour) {
                time = lang.t("每秒", "Every second")
            } else if let k = everyStep(sec), isAny(min), isAny(hour) {
                time = lang.t("每 \(k) 秒", "Every \(k) seconds")
            }
        }
        if secZero {
            if isAny(min), isAny(hour) {
                time = lang.t("每分钟", "Every minute")
            } else if let k = everyStep(min), isAny(hour) {
                time = lang.t("每 \(k) 分钟", k == 1 ? "Every minute" : "Every \(k) minutes")
            } else if let m = number(min), isAny(hour) {
                time = m == 0 ? lang.t("每小时整点", "Every hour, on the hour") : lang.t("每小时第 \(m) 分", "At minute \(m) past every hour")
            } else if let m = number(min), let k = everyStep(hour) {
                time = lang.t("每 \(k) 小时的第 \(m) 分", "At minute \(m) past every \(k) hours")
            }
        }
        if time == nil, let ms = numberList(min), let hs = numberList(hour), let ss = numberList(sec), ms.count * hs.count * ss.count <= 8 {
            var times: [String] = []
            for h in hs.sorted() {
                for m in ms.sorted() {
                    for s in ss.sorted() {
                        times.append(NumberText.pad(h) + ":" + NumberText.pad(m) + (n.hasSeconds && s != 0 ? ":" + NumberText.pad(s) : ""))
                    }
                }
            }
            if daysAny {
                return lang.t("每天 " + times.joined(separator: "、"), "At " + times.joined(separator: ", ") + " every day")
            }
            time = lang.t("在 " + times.joined(separator: "、"), "At " + times.joined(separator: ", "))
        }
        guard let timeText = time else { return breakdown(n, lang, separator: lang.t("；", "; ")) }
        if daysAny { return timeText }

        // 日期部分
        var parts: [String] = []
        let domText: String? = isAny(dom) ? nil : {
            let t = explainToken(dom, .dayOfMonth, lang: lang)
            if dom.uppercased() == "L" { return t }
            return isPlain(dom) ? lang.t("每月 " + t, t + " of the month") : t
        }()
        let dowText: String? = isAny(dow) ? nil : explainToken(dow, .dayOfWeek, lang: lang)
        switch (domText, dowText) {
        case let (d?, w?): parts.append(lang.t("\(d)或\(w)", "on \(d) or on \(w)"))
        case let (d?, nil): parts.append(lang.t(d, "on " + d))
        case let (nil, w?): parts.append(lang.t(w, "on " + w))
        default: break
        }
        if !isAny(month) {
            let t = explainToken(month, .month, lang: lang)
            parts.append(isPlain(month) ? lang.t("仅 " + t, "only in " + t) : t)
        }
        return ([timeText] + parts).joined(separator: lang.t("，", ", "))
    }

    /// 描述：先用 App 内置的 cronstrue，失败或不可用时用本地描述
    public static func describe(_ n: Normalized, lang: Lang) -> String {
        let args = ["expr": n.expression, "locale": lang == .zh ? "zh_CN" : "en", "use24Hour": "1"]
        if let text = try? ToolEnvironment.runScript("cron", args, lang: lang) {
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty, !t.contains("null"), !t.contains("undefined") {
                return lang == .zh ? polishZh(t) : t
            }
        }
        return nativeDescription(n, lang: lang)
    }

    /// 补充说明：日 / 周的“或”语义、步长过大、H、被忽略的命令
    static func notes(_ n: Normalized, _ lang: Lang) -> [ToolNote] {
        var notes: [ToolNote] = []
        if !isAny(n.token(.dayOfMonth)), !isAny(n.token(.dayOfWeek)) {
            notes.append(ToolNote(.info, lang.t(
                "「日」和「周」同时指定时，满足其中任意一个就会执行（标准 cron 的“或”语义）",
                "When both day of month and day of week are set, either one matching is enough (standard cron “OR” semantics)"
            )))
        }
        for k in order {
            let sp = spec(k)
            if let step = everyStep(n.token(k)), step > sp.max - sp.min {
                notes.append(ToolNote(.warning, lang.t(
                    "「\(sp.label.zh)」的步长 \(step) 超过取值范围，实际只会在 \(fmtValue(sp.min, k, .zh))执行",
                    "The \(sp.name.en) step \(step) exceeds the range, so it only runs at \(fmtValue(sp.min, k, .en))"
                )))
            }
        }
        if order.contains(where: { hasHash(n.token($0)) }) {
            notes.append(ToolNote(.info, lang.t(
                "「H」由调度器按任务名哈希成固定值（如 Jenkins），这里以表达式本身作种子演示，实际执行时刻以调度器为准",
                "“H” is hashed by the scheduler (e.g. Jenkins) from the job name; here the expression itself is the seed, so real run times depend on your scheduler"
            )))
        }
        if let c = n.command {
            notes.append(ToolNote(.info, lang.t("已忽略表达式后面的命令：\(c)", "Ignored the command after the expression: \(c)")))
        }
        return notes
    }

    /// 字段里有 H（哈希）写法；THU 这类英文名里的 H 不算
    static func hasHash(_ token: String) -> Bool {
        token.components(separatedBy: ",").contains { $0.uppercased().hasPrefix("H") }
    }
}

public enum CronParserTool {
    public static let spec = ToolSpec(
        id: "cron-parser",
        name: LocalizedText("Cron 表达式", "Cron Expression"),
        summary: LocalizedText(
            "用中文解释 Cron 表达式，并列出接下来的执行时间。",
            "Explain a cron expression in plain words and list its next run times."
        ),
        category: .convert,
        keywords: ["cron", "crontab", "schedule", "quartz", "定时", "计划任务", "cron 表达式"],
        symbol: "calendar.badge.clock",
        input: .required,
        inputLabel: LocalizedText("Cron 表达式，如 */5 * * * *", "Cron expression, e.g. */5 * * * *"),
        fields: [
            ToolField("tz", LocalizedText("时区", "Time zone"), .choice(ZoneOptions.choices), default: ZoneOptions.local),
            ToolField("count", LocalizedText("列出次数", "Runs to list"), .number(min: 1, max: 50), default: "10"),
        ],
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let n = try Cron.normalize(input.text, lang: lang)
        let (zone, zoneNote) = ZoneOptions.resolve(input.string("tz"), lang: lang)
        let count = min(50, max(1, input.int("count", default: 10)))
        let nowMs = Instant(date: input.now).epochMs
        let runs: [Int64]
        do {
            runs = try Cron.nextRuns(Cron.schedule(n), zone: zone, fromMs: nowMs, count: count)
        } catch Cron.RunError.impossible {
            throw ToolError(lang.t("日期与月份的组合不存在（例如 2 月 30 日），该任务永远不会执行",
                                   "This day and month combination never exists (e.g. February 30), so the job never runs"))
        } catch {
            throw ToolError(lang.t("在可计算的范围内找不到下一次执行时间，请检查日期、月份与星期的组合",
                                   "No upcoming run was found; check the day, month and weekday combination"))
        }

        func describeRun(_ ms: Int64) -> (time: String, weekday: String, offset: String) {
            let p = Timestamp.zonedParts(ms, zone)
            let wd = lang == .zh ? Timestamp.weekdayShortZh[p.weekday] : Timestamp.enWeekdays[p.weekday]
            return (Timestamp.formatDateTime(p.wall, withFraction: false), wd, "UTC" + Timestamp.formatOffset(p.offsetSeconds))
        }
        let rows = runs.enumerated().map { i, ms -> [String] in
            let d = describeRun(ms)
            return [String(i + 1), d.time, d.weekday, d.offset, Timestamp.formatRelative(ms, nowMs, lang)]
        }

        var outputs = [ToolOutput(id: "description", label: lang.t("描述", "Description"), value: Cron.describe(n, lang: lang), style: .prose)]
        if let first = runs.first {
            let d = describeRun(first)
            outputs.append(ToolOutput(id: "next", label: lang.t("下次执行", "Next run"),
                                      value: lang.t("\(d.time) \(d.weekday)（\(Timestamp.formatRelative(first, nowMs, .zh))）",
                                                    "\(d.time) \(d.weekday) (\(Timestamp.formatRelative(first, nowMs, .en)))")))
        }
        let shape = n.macro.map { "\($0) = \(n.expression)" } ?? n.expression
        outputs.append(ToolOutput(id: "expression", label: n.hasSeconds ? lang.t("表达式（6 段 · 含秒）", "Expression (6 fields, with seconds)")
                                      : lang.t("表达式（5 段 · 标准 crontab）", "Expression (5 fields, standard crontab)"), value: shape))
        let fieldLines = Cron.order.filter { n.hasSeconds || $0 != .second }.map { k -> String in
            let sp = Cron.spec(k)
            let text = Cron.explainToken(n.token(k), k, lang: lang)
            return lang.t("\(sp.label.zh)「\(n.token(k))」：\(text)", "\(sp.name.en.capitalizedFirst) “\(n.token(k))”: \(text)")
        }
        outputs.append(ToolOutput(id: "fields", label: lang.t("字段", "Fields"), value: fieldLines.joined(separator: "\n"), style: .prose))

        var notes = Cron.notes(n, lang)
        if runs.count < count {
            notes.append(ToolNote(.info, lang.t("在可计算的范围内只找到 \(runs.count) 次执行", "Only \(runs.count) runs were found in the searchable range")))
        }
        if let zoneNote { notes.insert(zoneNote, at: 0) }
        let table = ToolTable(columns: ["#", lang.t("执行时间", "Run time"), lang.t("星期", "Weekday"), lang.t("偏移", "Offset"), lang.t("距现在", "From now")], rows: rows)
        return ToolResult(outputs: outputs, notes: notes, table: table)
    }
}
