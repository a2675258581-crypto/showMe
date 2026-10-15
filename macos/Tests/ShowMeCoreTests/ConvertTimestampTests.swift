import XCTest
@testable import ShowMeCore

final class ConvertTimestampTests: XCTestCase {
    let t2024: Int64 = 1_704_067_200_000 // 2024-01-01T00:00:00Z，星期一
    let now: Int64 = 1_718_424_000_000 // 2024-06-15T04:00:00Z，星期六
    let sh = Zone("Asia/Shanghai")!
    let ny = Zone("America/New_York")!
    let utc = Zone("UTC")!

    func utcMs(_ y: Int64, _ mo: Int, _ d: Int, _ h: Int = 0, _ mi: Int = 0, _ s: Int = 0) -> Int64 {
        Timestamp.wallToUtcMs(WallTime(year: y, month: mo, day: d, hour: h, minute: mi, second: s))
    }

    func parsed(_ s: String, _ zone: Zone? = nil, file: StaticString = #filePath, line: UInt = #line) -> Int64? {
        do {
            return try Timestamp.parseDate(s, zone: zone ?? sh, nowMs: now).instant.epochMs
        } catch {
            XCTFail("\(s): \(error)", file: file, line: line)
            return nil
        }
    }

    func parseError(_ s: String, _ zone: Zone? = nil, lang: Lang = .zh) -> String {
        do {
            _ = try Timestamp.parseDate(s, zone: zone ?? sh, nowMs: now, lang: lang)
            return "no error"
        } catch {
            return (error as? ToolError)?.message ?? "\(error)"
        }
    }

    func tsError(_ s: String, unit: TsUnit? = nil, lang: Lang = .zh) -> String {
        do {
            _ = try Timestamp.parseTimestamp(s, unit: unit, lang: lang)
            return "no error"
        } catch {
            return (error as? ToolError)?.message ?? "\(error)"
        }
    }

    func testDetectUnit() throws {
        let cases: [(String, TsUnit)] = [
            ("0", .s), ("1704067200", .s), ("99999999999", .s), ("1704067200000", .ms),
            ("1704067200000000", .us), ("1704067200000000000", .ns), ("-1704067200000", .ms),
        ]
        for (input, unit) in cases {
            let r = try Timestamp.parseTimestamp(input)
            XCTAssertEqual(r.unit, unit, input)
            XCTAssertTrue(r.detected)
        }
        for s in ["1704067200", "1704067200000", "1704067200000000", "1704067200000000000"] {
            XCTAssertEqual(try Timestamp.parseTimestamp(s).instant, Instant(epochMs: t2024))
        }
    }

    func testPrecisionNegativesAndSeparators() throws {
        XCTAssertEqual(try Timestamp.parseTimestamp("1704067200123456789").instant, Instant(epochMs: t2024 + 123, subMsNs: 456_789))
        XCTAssertEqual(try Timestamp.parseTimestamp("1704067200.5").instant.epochMs, t2024 + 500)
        XCTAssertEqual(try Timestamp.parseTimestamp("-1.5").instant, Instant(epochMs: -1500))
        XCTAssertEqual(try Timestamp.parseTimestamp("-1", unit: .ns).instant, Instant(epochMs: -1, subMsNs: 999_999))
        let explicit = try Timestamp.parseTimestamp("1704067200", unit: .ms)
        XCTAssertEqual(explicit.instant.epochMs, 1_704_067_200)
        XCTAssertFalse(explicit.detected)
        for s in ["1_704_067_200", " 1,704,067,200 ", "1.7040672e9", "１７０４０６７２００"] {
            XCTAssertEqual(try Timestamp.parseTimestamp(s).instant.epochMs, t2024, s)
        }
    }

    func testTimestampErrors() {
        XCTAssertTrue(tsError("17040x7200").contains("第 6 个字符「x」"))
        XCTAssertTrue(tsError("1.2.3").contains("小数点"))
        XCTAssertNotEqual(tsError(""), "no error")
        XCTAssertNotEqual(tsError("-"), "no error")
        XCTAssertTrue(tsError("时间").contains("第 1 个字符「时」"))
        XCTAssertEqual(tsError("1😀"), "第 2 个字符「😀」不是数字：时间戳只能包含数字、负号和小数点")
        XCTAssertTrue(tsError("1x", lang: .en).hasPrefix("Character 2 “x” is not a digit"))
        XCTAssertTrue(tsError(String(repeating: "9", count: 40)).contains("超出可表示的范围"))
        XCTAssertEqual(tsError("8640000000000000", unit: .ms), "no error")
        XCTAssertNotEqual(tsError("8640000000000001", unit: .ms), "no error")
        XCTAssertTrue(tsError(String(repeating: "9", count: 400)).contains("超出"))
    }

    func testZones() {
        let p = Timestamp.zonedParts(t2024, sh)
        XCTAssertEqual(p.wall, WallTime(year: 2024, month: 1, day: 1, hour: 8))
        XCTAssertEqual(p.weekday, 1)
        XCTAssertEqual(p.offsetSeconds, 8 * 3600)
        let n = Timestamp.zonedParts(t2024, ny)
        XCTAssertEqual(n.wall, WallTime(year: 2023, month: 12, day: 31, hour: 19))
        XCTAssertEqual(n.weekday, 0)
        XCTAssertEqual(n.offsetSeconds, -5 * 3600)
        XCTAssertEqual(Timestamp.zonedParts(t2024, Zone("Asia/Kolkata")!).offsetSeconds, 19800)
        XCTAssertEqual(Timestamp.zonedParts(t2024, Zone("Australia/Sydney")!).wall.hour, 11)
        XCTAssertEqual(Timestamp.zonedParts(utcMs(2024, 7, 1), Zone("Europe/London")!).offsetSeconds, 3600)
        XCTAssertEqual(Timestamp.zonedParts(utcMs(2024, 7, 1), Zone("America/Los_Angeles")!).offsetSeconds, -7 * 3600)
    }

    func testDstDisambiguation() {
        func nyWall(_ m: Int, _ d: Int, _ h: Int, _ mi: Int = 0) -> (Int64, Disambiguation) {
            let r = Timestamp.zonedToEpoch(WallTime(year: 2024, month: m, day: d, hour: h, minute: mi), ny)
            return (r.epochMs, r.kind)
        }
        XCTAssertTrue(nyWall(1, 1, 0) == (utcMs(2024, 1, 1, 5), .exact))
        XCTAssertTrue(nyWall(3, 10, 2, 30) == (utcMs(2024, 3, 10, 7, 30), .gap))
        XCTAssertTrue(nyWall(11, 3, 1, 30) == (utcMs(2024, 11, 3, 5, 30), .overlap))
    }

    func testFormatting() {
        XCTAssertEqual(Timestamp.formatOffset(28800), "+08:00")
        XCTAssertEqual(Timestamp.formatOffset(-18000, separator: ""), "-0500")
        XCTAssertEqual(Timestamp.formatOffset(29143), "+08:05:43")
        XCTAssertEqual(Timestamp.formatISO(Instant(epochMs: t2024), sh), "2024-01-01T08:00:00+08:00")
        XCTAssertEqual(Timestamp.formatISO(Instant(epochMs: t2024 + 5), utc), "2024-01-01T00:00:00.005+00:00")
        XCTAssertEqual(Timestamp.formatISO(Instant(epochMs: t2024, subMsNs: 1000), utc), "2024-01-01T00:00:00.000001+00:00")
        XCTAssertEqual(Timestamp.formatISO(Instant(epochMs: t2024, subMsNs: 1), utc), "2024-01-01T00:00:00.000000001+00:00")
        XCTAssertEqual(Timestamp.formatISO(Instant(epochMs: t2024), ny), "2023-12-31T19:00:00-05:00")
        XCTAssertEqual(Timestamp.formatRFC2822(t2024, sh), "Mon, 01 Jan 2024 08:00:00 +0800")
        XCTAssertEqual(Timestamp.formatRFC2822(t2024, Zone("America/Los_Angeles")!), "Sun, 31 Dec 2023 16:00:00 -0800")
        XCTAssertEqual(Timestamp.formatHttpDate(t2024), "Mon, 01 Jan 2024 00:00:00 GMT")
        XCTAssertEqual(Timestamp.formatISOUtc(t2024 + 123), "2024-01-01T00:00:00.123Z")
        XCTAssertTrue(Timestamp.isoWeek(2024, 1, 1) == (2024, 1))
        XCTAssertTrue(Timestamp.isoWeek(2021, 1, 3) == (2020, 53))
        XCTAssertTrue(Timestamp.isoWeek(2024, 12, 30) == (2025, 1))
        XCTAssertTrue(Timestamp.isoWeek(2026, 9, 24) == (2026, 39))
    }

    func testRelativeAndDuration() {
        XCTAssertEqual(Timestamp.formatRelative(now - 3 * 3_600_000, now, .zh), "3小时前")
        XCTAssertEqual(Timestamp.formatRelative(now + 2 * 86_400_000, now, .zh), "2天后")
        XCTAssertEqual(Timestamp.formatRelative(now + 400, now, .zh), "现在")
        XCTAssertEqual(Timestamp.formatRelative(now - 400 * 86_400_000, now, .zh), "1年前")
        XCTAssertEqual(Timestamp.formatRelative(now - 45000, now, .zh), "45秒钟前")
        XCTAssertEqual(Timestamp.formatRelative(now - 3 * 60000, now, .en), "3 minutes ago")
        XCTAssertEqual(Timestamp.formatRelative(now + 86_400_000, now, .en), "in 1 day")
        XCTAssertEqual(Timestamp.formatDuration(95 * 86_400_000 + 3 * 3_600_000 + 5000, .zh), "95 天 3 小时")
        XCTAssertEqual(Timestamp.formatDuration(500, .zh), "不到 1 秒")
        XCTAssertEqual(Timestamp.formatDuration(3_725_000, .zh), "1 小时 2 分 5 秒")
    }

    func testInstantToUnit() {
        XCTAssertEqual(Timestamp.instantToUnit(Instant(epochMs: -1500), .s), "-2")
        XCTAssertEqual(Timestamp.instantToUnit(Instant(epochMs: -1500), .ms), "-1500")
        XCTAssertEqual(Timestamp.instantToUnit(Instant(epochMs: t2024 + 123, subMsNs: 456_000), .ns), "1704067200123456000")
        XCTAssertEqual(Timestamp.instantToUnit(Instant(epochMs: -1, subMsNs: 999_999), .ns), "-1")
        XCTAssertEqual(Timestamp.instantToUnit(Instant(epochMs: Timestamp.maxEpochMs), .ns), "8640000000000000000000")
        XCTAssertEqual(Timestamp.instantToUnit(Instant(epochMs: 0), .s), "0")
    }

    func testParseDateVectors() {
        let cases: [(String, Zone, Int64)] = [
            ("2024-01-01 08:00:00", sh, t2024), ("2024-01-01 08:00", sh, t2024), ("2024-01-01T08:00:00", sh, t2024),
            ("2024-01-01", utc, t2024), ("2024/1/1", utc, t2024), ("2024/1/1 8:00", sh, t2024), ("2024.01.01", utc, t2024),
            ("2024-01", utc, t2024), ("2023-12-31 19:00:00", ny, t2024), ("2024-01-01T00:00:00Z", Zone("Asia/Tokyo")!, t2024),
            ("2024-01-01T08:00:00+08:00", utc, t2024), ("2024-01-01T08:00:00+0800", utc, t2024),
            ("2024-01-01 08:00:00 GMT+8", utc, t2024), ("2023-12-31T19:00:00-05:00", sh, t2024),
            ("Mon, 01 Jan 2024 08:00:00 +0800", utc, t2024), ("01 Jan 2024 00:00:00 GMT", sh, t2024),
            ("Sun, 31 Dec 2023 14:00:00 EST", utc, utcMs(2023, 12, 31, 19)),
            ("Mon Jan 01 2024 08:00:00 GMT+0800 (中国标准时间)", utc, t2024), ("Jan 1, 2024 8:00 AM", sh, t2024),
            ("January 1st, 2024", utc, t2024), ("2024年1月1日 08:00", sh, t2024), ("2024年1月1日 8时", sh, t2024),
            ("2024年1月1日", utc, t2024), ("2023年12月31日 下午7点", ny, t2024), ("20240101", utc, t2024),
            ("20240101080000", sh, t2024), ("1704067200", utc, t2024), ("1704067200000", utc, t2024),
            ("２０２４－０１－０１　０８：００", sh, t2024),
        ]
        for (input, zone, expected) in cases {
            XCTAssertEqual(parsed(input, zone), expected, input)
        }
    }

    func testParseDateDetails() throws {
        let r = try Timestamp.parseDate("2024-01-01T00:00:00.123456789Z", zone: utc, nowMs: now)
        XCTAssertEqual(r.instant, Instant(epochMs: t2024 + 123, subMsNs: 456_789))
        let a = try Timestamp.parseDate("2024-01-01T08:00:00+08:00", zone: utc, nowMs: now)
        XCTAssertTrue(a.zoneFromInput)
        XCTAssertEqual(a.format.zh, "ISO 8601")
        XCTAssertFalse(try Timestamp.parseDate("2024-01-01 08:00:00", zone: utc, nowMs: now).zoneFromInput)
        XCTAssertEqual(try Timestamp.parseDate("2024-03-10 02:30", zone: ny, nowMs: now).kind, .gap)
    }

    func testRelativeInputs() {
        let day: Int64 = 86_400_000
        XCTAssertEqual(parsed("now"), now)
        XCTAssertEqual(parsed("现在"), now)
        XCTAssertEqual(parsed("today"), utcMs(2024, 6, 14, 16))
        XCTAssertEqual(parsed("昨天"), utcMs(2024, 6, 13, 16))
        XCTAssertEqual(parsed("明天"), utcMs(2024, 6, 15, 16))
        XCTAssertEqual(parsed("+1d"), now + day)
        XCTAssertEqual(parsed("now-2h"), now - 7_200_000)
        XCTAssertEqual(parsed("now + 1d2h"), now + day + 7_200_000)
        XCTAssertEqual(parsed("-30m"), now - 1_800_000)
        XCTAssertEqual(parsed("+1M"), utcMs(2024, 7, 15, 4))
        XCTAssertEqual(parsed("+1y"), utcMs(2025, 6, 15, 4))
        XCTAssertEqual(parsed("+1w"), now + 7 * day)
        XCTAssertEqual(parsed("2 days ago"), now - 2 * day)
        XCTAssertEqual(parsed("in 3 hours"), now + 3 * 3_600_000)
        XCTAssertEqual(parsed("3天前"), now - 3 * day)
        XCTAssertEqual(parsed("2 小时后"), now + 2 * 3_600_000)
        XCTAssertEqual(parsed("半小时后"), now + 1_800_000)
        XCTAssertEqual(parsed("12:30"), utcMs(2024, 6, 15, 4, 30))
        XCTAssertEqual(parsed("Now+1d"), now + day)
        XCTAssertEqual(parsed("NOW - 2H"), now - 7_200_000)
        XCTAssertEqual(parsed("2 Days Ago"), now - 2 * day)
    }

    func testCalendarArithmetic() {
        let jan31 = utcMs(2024, 1, 31, 12)
        XCTAssertEqual(Timestamp.add(jan31, utc, 1, "M"), utcMs(2024, 2, 29, 12))
        XCTAssertEqual(Timestamp.add(jan31, utc, -2, "M"), utcMs(2023, 11, 30, 12))
        XCTAssertEqual(Timestamp.add(utcMs(2024, 2, 29), utc, 1, "y"), utcMs(2025, 2, 28))
        let start = utcMs(2024, 3, 9, 17)
        XCTAssertEqual(Timestamp.add(start, ny, 1, "d"), utcMs(2024, 3, 10, 16))
        XCTAssertEqual(Timestamp.add(start, ny, 24, "h"), utcMs(2024, 3, 10, 17))
        for (days, y, m, d) in [(Int64(0), Int64(1970), 1, 1), (-1, 1969, 12, 31), (19723, 2024, 1, 1), (100_000_000, 275_760, 9, 13)] {
            let c = Timestamp.civilFromDays(days)
            XCTAssertTrue(c == (y, m, d), "\(days)")
            XCTAssertEqual(Timestamp.daysFromCivil(y, m, d), days)
        }
    }

    func testHelpfulErrors() {
        XCTAssertTrue(parseError("2024-13-01").contains("月份「13」无效"))
        XCTAssertTrue(parseError("2023-02-29").contains("2023 年 2 月只有 28 天"))
        XCTAssertTrue(parseError("2024-01-01 25:00").contains("小时「25」无效"))
        XCTAssertTrue(parseError("2024-01-01 10:61").contains("分钟「61」无效"))
        XCTAssertTrue(parseError("hello world").contains("无法识别「hello world」"))
        XCTAssertTrue(parseError("+1q").contains("无法识别的时间单位「q」"))
        XCTAssertEqual(parseError(""), "请输入日期时间")
        XCTAssertEqual(parseError("", lang: .en), "Enter a date and time")
        XCTAssertTrue(parseError("2023-02-29", lang: .en).contains("February 2023 has only 28 days"))
        XCTAssertTrue(parseError("1900-02-29", utc).contains("只有 28 天"))
        XCTAssertEqual(parsed("2000-02-29", utc), utcMs(2000, 2, 29))
        XCTAssertEqual(Timestamp.parseZoneOffset("+08:00"), 480)
        XCTAssertEqual(Timestamp.parseZoneOffset("-0530"), -330)
        XCTAssertEqual(Timestamp.parseZoneOffset("GMT+8"), 480)
        XCTAssertEqual(Timestamp.parseZoneOffset("PDT"), -420)
        XCTAssertNil(Timestamp.parseZoneOffset("+25"))
    }

    func testRangeRegressionsNeverThrowUnexpectedly() {
        for input in ["999999-01-01", "+275760-09-13", "275760-09-13", "-271821-04-20", "+1000000y", "+99999999999d",
                      "+100000000000000000000M", "999999999999天前", "+" + String(repeating: "9", count: 400) + "d"] {
            for zone in [utc, sh, ny] {
                _ = parseError(input, zone)
            }
        }
        XCTAssertTrue(parseError("999999-01-01").contains("超出可表示的范围"))
        XCTAssertTrue(parseError("+1000000y").contains("超出可表示的范围"))
        XCTAssertEqual(parsed("275760-09-13", utc), Timestamp.maxEpochMs)
    }

    func testEdgeOfRangeDescriptions() throws {
        let max = Instant(epochMs: Timestamp.maxEpochMs)
        let p = Timestamp.zonedParts(max.epochMs, sh)
        XCTAssertEqual(Timestamp.formatDateTime(p.wall), "275760-09-13 08:00:00")
        XCTAssertEqual(Timestamp.formatISO(max, sh), "+275760-09-13T08:00:00+08:00")
        XCTAssertEqual(Timestamp.formatRFC2822(max.epochMs, sh), "Sat, 13 Sep 275760 08:00:00 +0800")
        XCTAssertEqual(Timestamp.formatISO(Instant(epochMs: -Timestamp.maxEpochMs), ny), "-271821-04-19T19:03:58-04:56:02")
    }

    // MARK: 工具

    func run(_ text: String, _ options: [String: String] = [:], lang: Lang = .zh) throws -> ToolResult {
        let spec = TimestampTool.spec
        return try spec.run(ToolInput(text: text, options: spec.defaults.merging(options) { $1 }, lang: lang,
                                      now: Date(timeIntervalSince1970: Double(now) / 1000)))
    }

    func value(_ r: ToolResult, _ id: String) -> String? { r.outputs.first { $0.id == id }?.value }

    func testToolTimestampInput() throws {
        let r = try run("1704067200", ["tz": "Asia/Shanghai"])
        XCTAssertEqual(r.primary?.id, "local")
        XCTAssertEqual(r.primary?.value, "2024-01-01 08:00:00")
        XCTAssertEqual(value(r, "iso"), "2024-01-01T08:00:00+08:00")
        XCTAssertEqual(value(r, "isoUtc"), "2024-01-01T00:00:00.000Z")
        XCTAssertEqual(value(r, "millis"), "1704067200000")
        XCTAssertEqual(value(r, "chinese"), "2024年1月1日 星期一 08:00:00")
        XCTAssertEqual(value(r, "relative"), "5个月前（相差 166 天 4 小时）")
        XCTAssertTrue(value(r, "week")?.contains("ISO 第 1 周") ?? false)
        XCTAssertEqual(r.notes.first?.message, "识别为秒")
        let ms = try run("1704067200", ["tz": "UTC", "unit": "ms"], lang: .en)
        XCTAssertEqual(ms.primary?.value, "1970-01-20 17:21:07.200")
        XCTAssertEqual(ms.notes.first?.message, "Parsed as milliseconds")
        XCTAssertNil(value(ms, "chinese"))
    }

    func testToolDateInputAndNow() throws {
        let r = try run("2024-01-01 08:00:00", ["tz": "Asia/Shanghai"])
        XCTAssertEqual(r.primary?.id, "seconds")
        XCTAssertEqual(r.primary?.value, "1704067200")
        XCTAssertTrue(r.notes.first?.message.contains("yyyy-MM-dd HH:mm:ss") ?? false)
        let us = try run("2024-01-01T00:00:00Z", ["unit": "us"])
        XCTAssertEqual(us.primary?.value, "1704067200000000")
        let empty = try run("   ", ["tz": "UTC"])
        XCTAssertEqual(empty.primary?.value, "1718424000")
        XCTAssertEqual(value(empty, "relative"), "现在")
        XCTAssertThrowsError(try run("hello")) { error in
            XCTAssertTrue((error as? ToolError)?.message.contains("无法识别") ?? false)
        }
        let bad = try run("1704067200", ["tz": "Mars/Base"])
        XCTAssertEqual(bad.notes.first?.level, .warning)
    }

    func testToolBatch() throws {
        let r = try run("1704067200\n\n2024-01-01 08:00:00\n1704067200000\nfoo\n-1", ["tz": "Asia/Shanghai"])
        let lines = r.primary?.value.components(separatedBy: "\n")
        XCTAssertEqual(lines, ["2024-01-01 08:00:00", "", "1704067200", "2024-01-01 08:00:00", "", "1970-01-01 07:59:59"])
        XCTAssertEqual(r.table?.rows.count, 5)
        XCTAssertTrue(r.notes.contains { $0.level == .warning && $0.message.hasPrefix("第 5 行") })
        let big = (0..<5000).map { String(1_704_067_200 + $0 * 3600) }.joined(separator: "\n")
        let started = Date()
        let out = try run(big, ["tz": "Asia/Shanghai"])
        XCTAssertEqual(out.table?.rows.count, 5000)
        XCTAssertLessThan(Date().timeIntervalSince(started), 10)
    }
}
