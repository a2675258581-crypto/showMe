import Foundation

/// 常用时区选项（时间戳、Cron 共用）
public enum ZoneOptions {
    public static let local = "local"

    public static let choices: [ToolChoice] = [
        ToolChoice(local, LocalizedText("本机时区", "Local")),
        ToolChoice("Asia/Shanghai", LocalizedText("北京 / 上海", "Beijing / Shanghai")),
        ToolChoice("UTC", LocalizedText("UTC", "UTC")),
        ToolChoice("America/New_York", LocalizedText("纽约", "New York")),
        ToolChoice("Europe/London", LocalizedText("伦敦", "London")),
        ToolChoice("Asia/Tokyo", LocalizedText("东京", "Tokyo")),
        ToolChoice("America/Los_Angeles", LocalizedText("洛杉矶", "Los Angeles")),
        ToolChoice("Europe/Berlin", LocalizedText("柏林", "Berlin")),
        ToolChoice("Australia/Sydney", LocalizedText("悉尼", "Sydney")),
    ]

    /// 选项值 → 时区；"local" 或空为本机时区，其它合法 IANA 名称也接受；无效时回退本机时区并给出提示
    public static func resolve(_ value: String, lang: Lang) -> (Zone, ToolNote?) {
        let v = value.trimmingCharacters(in: .whitespaces)
        if v.isEmpty || v == local { return (Zone(TimeZone.current), nil) }
        if let z = Zone(v) { return (z, nil) }
        let note = ToolNote(.warning, lang.t("无效的时区「\(v)」，已改用本机时区", "Invalid time zone “\(v)”; using the local time zone"))
        return (Zone(TimeZone.current), note)
    }
}

public enum TimestampTool {
    public static let spec = ToolSpec(
        id: "timestamp",
        name: LocalizedText("时间戳转换", "Timestamp Converter"),
        summary: LocalizedText(
            "Unix 时间戳（秒 / 毫秒）与日期时间互转，支持多时区与相对时间。",
            "Convert Unix timestamps (seconds / milliseconds) to dates and back, with time zones and relative time."
        ),
        category: .convert,
        keywords: ["timestamp", "unix", "epoch", "date", "time", "时间", "日期", "sjc", "sjczh"],
        symbol: "clock",
        input: .optional,
        inputLabel: LocalizedText("时间戳或日期（留空 = 现在，可多行）", "Timestamp or date (empty = now, one per line)"),
        fields: [
            ToolField("tz", LocalizedText("时区", "Time zone"), .choice(ZoneOptions.choices), default: ZoneOptions.local,
                      help: LocalizedText("所有转换与输出均按所选时区计算", "All conversions and output use this time zone")),
            ToolField("unit", LocalizedText("时间戳单位", "Timestamp unit"), .choice([
                ToolChoice("auto", LocalizedText("自动", "Auto")),
                ToolChoice("s", LocalizedText("秒", "s")),
                ToolChoice("ms", LocalizedText("毫秒", "ms")),
                ToolChoice("us", LocalizedText("微秒", "μs")),
                ToolChoice("ns", LocalizedText("纳秒", "ns")),
            ]), default: "auto",
            help: LocalizedText("自动：按位数识别秒、毫秒、微秒、纳秒；日期转时间戳时按此单位输出（自动为秒）",
                                "Auto detects s / ms / μs / ns by magnitude; dates are converted to this unit (seconds for auto)")),
        ],
        run: { try run($0) }
    )

    private static let timestampLike = Pattern(#"^[+-]?[0-9][0-9_,' ]*(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$"#, caseInsensitive: true)

    /// 这一行像时间戳（纯数字，可带分组符、小数与科学计数法）而不是日期
    static func looksLikeTimestamp(_ s: String) -> Bool {
        timestampLike.test(TextUtil.halfWidth(s).trimmingCharacters(in: .whitespaces))
    }

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let (zone, zoneNote) = ZoneOptions.resolve(input.string("tz"), lang: lang)
        let unit = TsUnit(rawValue: input.string("unit"))
        let nowMs = Instant(date: input.now).epochMs
        let lines = TextUtil.lines(input.text)
        let filled = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        var result: ToolResult
        if filled.count > 1 {
            result = batch(lines, zone: zone, unit: unit, nowMs: nowMs, lang: lang)
        } else if let line = filled.first {
            result = try single(line.trimmingCharacters(in: .whitespaces), zone: zone, unit: unit, nowMs: nowMs, lang: lang)
        } else {
            result = describe(Instant(epochMs: nowMs), zone: zone, nowMs: nowMs, primary: .seconds, lang: lang)
            result.notes.insert(ToolNote(.info, lang.t("输入为空，显示当前时间", "The input is empty, so this is the current time")), at: 0)
        }
        if let zoneNote { result.notes.insert(zoneNote, at: 0) }
        return result
    }

    enum PrimaryRow { case seconds, local, unit(TsUnit) }

    static func single(_ text: String, zone: Zone, unit: TsUnit?, nowMs: Int64, lang: Lang) throws -> ToolResult {
        if looksLikeTimestamp(text) {
            let ts = try Timestamp.parseTimestamp(text, unit: unit, lang: lang)
            var r = describe(ts.instant, zone: zone, nowMs: nowMs, primary: .local, lang: lang)
            let how = ts.detected
                ? lang.t("识别为\(ts.unit.label(.zh))", "Detected as \(ts.unit.label(.en))")
                : lang.t("按\(ts.unit.label(.zh))解析", "Parsed as \(ts.unit.label(.en))")
            r.notes.insert(ToolNote(.info, how), at: 0)
            return r
        }
        let d = try Timestamp.parseDate(text, zone: zone, nowMs: nowMs, lang: lang)
        var r = describe(d.instant, zone: zone, nowMs: nowMs, primary: .unit(unit ?? .s), lang: lang)
        let source = d.zoneFromInput
            ? lang.t("（输入自带时区）", " (zone given in the input)")
            : lang.t("（按 \(zone.id) 解析）", " (read in \(zone.id))")
        var notes = [ToolNote(.info, lang.t("识别为 ", "Recognized as ") + d.format(lang) + source)]
        switch d.kind {
        case .gap:
            notes.append(ToolNote(.warning, lang.t("该时刻因夏令时跳过而不存在，已顺延到之后的时间", "This time is skipped by a DST change and was moved forward")))
        case .overlap:
            notes.append(ToolNote(.warning, lang.t("该时刻因夏令时结束出现两次，取较早的一次", "This time occurs twice when DST ends; the earlier one is used")))
        case .exact:
            break
        }
        r.notes.insert(contentsOf: notes, at: 0)
        return r
    }

    /// 一个时刻在所选时区下的各种写法
    static func describe(_ i: Instant, zone: Zone, nowMs: Int64, primary: PrimaryRow, lang: Lang) -> ToolResult {
        let p = Timestamp.zonedParts(i.epochMs, zone)
        let w = p.wall
        let wk = Timestamp.isoWeek(w.year, w.month, w.day)
        let doy = Timestamp.dayOfYear(w.year, w.month, w.day)
        let diy = Timestamp.isLeapYear(w.year) ? 366 : 365
        let isoWeekText = "\(wk.year)-W\(NumberText.pad(wk.week))"
        var outputs: [ToolOutput] = []
        func add(_ id: String, _ label: String, _ value: String, prose: Bool = false, primary isPrimary: Bool = false) {
            outputs.append(ToolOutput(id: id, label: label, value: value, style: prose ? .prose : .mono, isPrimary: isPrimary))
        }
        let primaryUnit: TsUnit? = {
            switch primary {
            case .seconds: return .s
            case .unit(let u): return u
            case .local: return nil
            }
        }()
        // 主输出放在最前面
        if let u = primaryUnit, u != .s, u != .ms {
            add("ts-\(u.rawValue)", lang.t("时间戳（\(u.label(.zh))）", "Timestamp (\(u.label(.en)))"), Timestamp.instantToUnit(i, u), primary: true)
        }
        add("seconds", lang.t("秒", "Seconds"), Timestamp.instantToUnit(i, .s), primary: primaryUnit == .s)
        add("millis", lang.t("毫秒", "Milliseconds"), Timestamp.instantToUnit(i, .ms), primary: primaryUnit == .ms)
        if i.subMsNs != 0 {
            if primaryUnit != .us { add("micros", lang.t("微秒", "Microseconds"), Timestamp.instantToUnit(i, .us)) }
            if primaryUnit != .ns { add("nanos", lang.t("纳秒", "Nanoseconds"), Timestamp.instantToUnit(i, .ns)) }
        }
        add("local", lang.t("日期时间", "Date & time"), Timestamp.formatDateTime(w, subMsNs: i.subMsNs), primary: primaryUnit == nil)
        add("iso", lang.t("ISO 8601", "ISO 8601"), Timestamp.formatISO(i, zone))
        add("isoUtc", lang.t("ISO（UTC）", "ISO (UTC)"), Timestamp.formatISOUtc(i.epochMs))
        add("rfc2822", "RFC 2822", Timestamp.formatRFC2822(i.epochMs, zone))
        if lang == .zh { add("chinese", "中文", Timestamp.formatChinese(p), prose: true) }
        let rel = Timestamp.formatRelative(i.epochMs, nowMs, lang)
        let dist = Timestamp.formatDuration(i.epochMs - nowMs, lang)
        add("relative", lang.t("相对时间", "Relative"), rel == lang.t("现在", "now") ? rel : lang.t("\(rel)（相差 \(dist)）", "\(rel) (\(dist))"), prose: true)
        let weekday = lang == .zh ? Timestamp.weekdayZh[p.weekday] : Timestamp.enWeekdaysFull[p.weekday]
        add("week", lang.t("星期 / 周", "Weekday / week"), lang.t(
            "\(weekday) · 第 \(doy) 天（共 \(diy) 天）· ISO 第 \(wk.week) 周（\(isoWeekText)）",
            "\(weekday) · day \(doy) of \(diy) · ISO week \(wk.week) (\(isoWeekText))"
        ), prose: true)
        let off = Timestamp.formatOffset(p.offsetSeconds)
        add("offset", lang.t("时区偏移", "UTC offset"), lang.t("UTC\(off)（\(zone.id)）", "UTC\(off) (\(zone.id))"))
        return ToolResult(outputs: outputs)
    }

    /// 逐行转换：数字行视为时间戳转日期，其余行解析为日期转时间戳
    static func batch(_ lines: [String], zone: Zone, unit: TsUnit?, nowMs: Int64, lang: Lang) -> ToolResult {
        var outLines: [String] = []
        var rows: [[String]] = []
        var errors: [String] = []
        for (n, line) in lines.enumerated() {
            let text = line.trimmingCharacters(in: .whitespaces)
            if text.isEmpty {
                outLines.append("")
                continue
            }
            do {
                if looksLikeTimestamp(text) {
                    let ts = try Timestamp.parseTimestamp(text, unit: unit, lang: lang)
                    let p = Timestamp.zonedParts(ts.instant.epochMs, zone)
                    let out = Timestamp.formatDateTime(p.wall, subMsNs: ts.instant.subMsNs)
                    outLines.append(out)
                    rows.append([text, out, lang.t("时间戳（\(ts.unit.label(.zh))）→ 日期", "Timestamp (\(ts.unit.label(.en))) → date")])
                } else {
                    let d = try Timestamp.parseDate(text, zone: zone, nowMs: nowMs, lang: lang)
                    let u = unit ?? .s
                    let out = Timestamp.instantToUnit(d.instant, u)
                    outLines.append(out)
                    rows.append([text, out, lang.t("日期 → \(u.label(.zh))", "Date → \(u.label(.en))")])
                }
            } catch {
                let message = (error as? ToolError)?.message ?? error.localizedDescription
                outLines.append("")
                rows.append([text, "", message])
                errors.append(lang.t("第 \(n + 1) 行：", "Line \(n + 1): ") + message)
            }
        }
        var notes = [ToolNote(.info, lang.t(
            "逐行转换：数字行按时间戳转成日期，其余行按日期转成时间戳",
            "Converted line by line: numbers become dates, everything else becomes a timestamp"
        ))]
        notes += errors.prefix(5).map { ToolNote(.warning, $0) }
        if errors.count > 5 {
            notes.append(ToolNote(.warning, lang.t("另有 \(errors.count - 5) 行无法识别", "\(errors.count - 5) more lines could not be read")))
        }
        return ToolResult(
            outputs: [.primary(lang.t("转换结果", "Converted"), outLines.joined(separator: "\n"), language: "plain")],
            notes: notes,
            table: ToolTable(columns: [lang.t("输入", "Input"), lang.t("结果", "Result"), lang.t("说明", "Note")], rows: rows)
        )
    }
}
