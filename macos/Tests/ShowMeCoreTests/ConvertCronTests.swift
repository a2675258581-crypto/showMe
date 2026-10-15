import XCTest
@testable import ShowMeCore

final class ConvertCronTests: XCTestCase {
    let from: Int64 = 1_704_067_200_000 // 2024-01-01 00:00Z（上海 08:00，星期一）
    let sh = Zone("Asia/Shanghai")!
    let utc = Zone("UTC")!
    let ny = Zone("America/New_York")!

    func runs(_ expr: String, _ zone: Zone? = nil, count: Int = 10, from: Int64? = nil) throws -> [String] {
        let n = try Cron.normalize(expr)
        return try Cron.nextRuns(Cron.schedule(n), zone: zone ?? sh, fromMs: from ?? self.from, count: count).map(Timestamp.formatISOUtc)
    }

    func normError(_ expr: String, lang: Lang = .zh) -> String {
        do {
            _ = try Cron.normalize(expr, lang: lang)
            return "no error"
        } catch {
            return (error as? ToolError)?.message ?? "\(error)"
        }
    }

    func v(_ token: String, _ key: Cron.FieldKey) -> String? { Cron.validateField(token, key) }

    func testNormalize() throws {
        let five = try Cron.normalize("*/5  *\t* * *")
        XCTAssertFalse(five.hasSeconds)
        XCTAssertEqual(five.expression, "*/5 * * * *")
        XCTAssertEqual(five.token(.second), "0")
        let six = try Cron.normalize("30 0 2 * * *")
        XCTAssertTrue(six.hasSeconds)
        XCTAssertEqual(six.token(.minute), "0")
        let d = try Cron.normalize("@daily")
        XCTAssertEqual(d.macro, "@daily")
        XCTAssertEqual(d.expression, "0 0 * * *")
        XCTAssertEqual(try Cron.normalize("@HOURLY").expression, "0 * * * *")
        let cmd = try Cron.normalize("0 2 * * * /usr/bin/backup.sh --full")
        XCTAssertEqual(cmd.expression, "0 2 * * *")
        XCTAssertEqual(cmd.command, "/usr/bin/backup.sh --full")
        XCTAssertEqual(try Cron.normalize("@weekly echo hi").command, "echo hi")
    }

    func testNormalizeErrors() {
        XCTAssertEqual(normError(""), "请输入 Cron 表达式")
        XCTAssertEqual(normError("", lang: .en), "Enter a cron expression")
        XCTAssertTrue(normError("* * * *").contains("至少需要 5 段"))
        XCTAssertTrue(normError("@reboot").contains("系统启动时运行一次"))
        XCTAssertTrue(normError("@often").contains("未知的预定义表达式「@often」"))
        XCTAssertTrue(normError("0 0 12 1 1 ? 2025").contains("第 7 段（年份"))
        XCTAssertTrue(normError("0 0 1 1 * 2025").contains("看起来是年份"))
        XCTAssertTrue(normError("0 0 1 1 * 2025-2030").contains("看起来是年份"))
        XCTAssertTrue(normError("0 0 1 1 * 2025,2026").contains("看起来是年份"))
        XCTAssertEqual(normError("60 * * * * *"), "第 1 段（秒）的值 60 超出范围（0–59）")
        XCTAssertEqual(normError("0 24 * * *"), "第 2 段（小时）的值 24 超出范围（0–23）")
        XCTAssertEqual(normError("0 24 * * *", lang: .en), "Field 2 (hour): the value 24 is out of range (0–23)")
        do {
            _ = try Cron.normalize("0  24 * * *")
            XCTFail("expected error")
        } catch let e as ToolError {
            XCTAssertEqual(e.line, 1)
            XCTAssertEqual(e.column, 4)
        } catch {
            XCTFail("\(error)")
        }
    }

    func testValidateField() {
        let ok: [(String, Cron.FieldKey)] = [
            ("*", .minute), ("?", .dayOfMonth), ("*/15", .minute), ("5/15", .minute), ("1-5", .dayOfWeek), ("MON-FRI", .dayOfWeek),
            ("jan,mar", .month), ("0,30", .minute), ("9-17/2", .hour), ("L", .dayOfMonth), ("5L", .dayOfWeek), ("1#2", .dayOfWeek),
            ("7", .dayOfWeek), ("H", .minute), ("H(0-29)/5", .minute),
        ]
        for (t, k) in ok { XCTAssertNil(v(t, k), "\(k): \(t)") }
        XCTAssertEqual(v("61", .minute), "「分」字段的值 61 超出范围（0–59）")
        XCTAssertTrue(v("24", .hour)?.contains("超出范围（0–23）") ?? false)
        XCTAssertTrue(v("0", .dayOfMonth)?.contains("超出范围（1–31）") ?? false)
        XCTAssertTrue(v("13", .month)?.contains("超出范围（1–12）") ?? false)
        XCTAssertTrue(v("8", .dayOfWeek)?.contains("超出范围（0–7）") ?? false)
        XCTAssertTrue(v("abc", .month)?.contains("可用 1–12 或 JAN–DEC") ?? false)
        XCTAssertTrue(v("xyz", .dayOfWeek)?.contains("SUN–SAT") ?? false)
        XCTAssertTrue(v("*/0", .minute)?.contains("步长不能为 0") ?? false)
        XCTAssertTrue(v("*/x", .minute)?.contains("步长「x」必须是正整数") ?? false)
        XCTAssertTrue(v("/5", .minute)?.contains("缺少起始值") ?? false)
        XCTAssertTrue(v("22-2", .hour)?.contains("起点大于终点") ?? false)
        XCTAssertTrue(v("1,,2", .minute)?.contains("多余的逗号") ?? false)
        XCTAssertTrue(v("1-2-3", .minute)?.contains("格式不正确") ?? false)
        XCTAssertTrue(v("*/5/2", .minute)?.contains("多个「/」") ?? false)
        XCTAssertTrue(v("15W", .dayOfMonth)?.contains("暂不支持") ?? false)
        XCTAssertTrue(v("L", .minute)?.contains("只能用于日或周字段") ?? false)
        XCTAssertTrue(v("1#6", .dayOfWeek)?.contains("序号应为 1–5") ?? false)
        XCTAssertTrue(v("1#2,3", .dayOfWeek)?.contains("不能与逗号列表一起使用") ?? false)
        XCTAssertTrue(v("五", .minute)?.contains("无法识别「五」") ?? false)
        XCTAssertNil(v("THU", .dayOfWeek))
        XCTAssertNil(v("JUL", .month))
    }

    func testExplainToken() {
        let cases: [(String, Cron.FieldKey, String)] = [
            ("*", .minute, "每分钟"), ("*/5", .minute, "每隔 5 分钟"), ("5/15", .minute, "从 5 分起每隔 15 分钟"),
            ("0,30", .minute, "0 分、30 分"), ("9-17", .hour, "9 点到 17 点"), ("9-17/2", .hour, "9 点到 17 点之间每隔 2 小时"),
            ("*/2", .dayOfMonth, "从 1 号起每隔 2 天"), ("L", .dayOfMonth, "每月最后一天"), ("1-5", .dayOfWeek, "周一到周五"),
            ("MON,FRI", .dayOfWeek, "周一、周五"), ("7", .dayOfWeek, "周日"), ("5L", .dayOfWeek, "每月最后一个周五"),
            ("1#2", .dayOfWeek, "每月第 2 个周一"), ("JAN-MAR", .month, "1 月到 3 月"), ("*/3", .month, "从 1 月起每隔 3 个月"),
            ("?", .dayOfWeek, "不指定"),
        ]
        for (token, key, expected) in cases {
            XCTAssertEqual(Cron.explainToken(token, key), expected, "\(key) \(token)")
        }
        XCTAssertEqual(Cron.explainToken("1#2", .dayOfWeek, lang: .en), "the 2nd Monday of the month")
        XCTAssertEqual(Cron.explainToken("*/5", .minute, lang: .en), "every 5 minutes")
        XCTAssertEqual(Cron.explainToken("JAN-MAR", .month, lang: .en), "January to March")
    }

    func testNextRunsInZones() throws {
        let a = try runs("0 2 * * *")
        XCTAssertEqual(a.count, 10)
        XCTAssertEqual(a[0], "2024-01-01T18:00:00.000Z")
        XCTAssertEqual(a[1], "2024-01-02T18:00:00.000Z")
        XCTAssertEqual(try runs("0 2 * * *", ny)[0], "2024-01-01T07:00:00.000Z")
        XCTAssertEqual(try runs("0 2 * * *", utc)[0], "2024-01-01T02:00:00.000Z")
    }

    func testSecondsWeekdaysLastAndNth() throws {
        XCTAssertEqual(Array(try runs("*/30 * * * * *").prefix(2)), ["2024-01-01T00:00:30.000Z", "2024-01-01T00:01:00.000Z"])
        XCTAssertEqual(try runs("0 8 * * 0,6")[0], "2024-01-06T00:00:00.000Z")
        XCTAssertEqual(try runs("0 0 L * *", utc)[1], "2024-02-29T00:00:00.000Z")
        XCTAssertEqual(try runs("0 0 * * 5L", utc)[0], "2024-01-26T00:00:00.000Z")
        XCTAssertEqual(try runs("0 0 * * 1#2", utc)[0], "2024-01-08T00:00:00.000Z")
        XCTAssertEqual(try runs("0 0 1 1,4,7,10 *", utc)[0], "2024-04-01T00:00:00.000Z")
        XCTAssertEqual(try runs("0 9 * * MON-FRI", utc).prefix(6).map { String($0.prefix(10)) },
                       ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"])
        // 日、周都指定时为“或”
        XCTAssertEqual(try runs("0 0 15 * 1", utc).prefix(3).map { String($0.prefix(10)) }, ["2024-01-08", "2024-01-15", "2024-01-22"])
        XCTAssertEqual(try runs("0 0 29 2 *", utc, count: 3).map { String($0.prefix(4)) }, ["2024", "2028", "2032"])
    }

    func testDstAndErrors() throws {
        let dst = try runs("30 2 * * *", ny, from: 1_709_985_600_000) // 2024-03-09T12:00Z
        XCTAssertEqual(dst.count, 10)
        XCTAssertEqual(dst, dst.sorted())
        XCTAssertEqual(Set(dst).count, 10)
        XCTAssertEqual(dst[0], "2024-03-10T07:30:00.000Z") // 02:30 不存在，顺延到 03:30 EDT
        XCTAssertEqual(dst[1], "2024-03-11T06:30:00.000Z")
        XCTAssertThrowsError(try runs("0 0 30 2 *")) { e in
            XCTAssertEqual(e as? Cron.RunError, .impossible)
        }
        XCTAssertThrowsError(try CronParserTool.spec("0 0 30 2 *")) { e in
            XCTAssertTrue((e as? ToolError)?.message.contains("永远不会执行") ?? false)
        }
    }

    func testHugeStepsDoNotOverflow() throws {
        XCTAssertEqual(try runs("*/99999999999999999999 * * * *", utc, count: 2), ["2024-01-01T01:00:00.000Z", "2024-01-01T02:00:00.000Z"])
        XCTAssertEqual(try runs("H/9223372036854775807 * * * *", utc, count: 1).count, 1)
    }

    func testHashIsStable() throws {
        XCTAssertEqual(try runs("H H * * *"), try runs("H H * * *"))
        let r = try CronParserTool.spec("H/15 * * * *")
        XCTAssertTrue(r.notes.contains { $0.message.contains("「H」") })
        XCTAssertEqual(r.table?.rows.count, 10)
    }

    func testPresetsAreValid() throws {
        for expr in ["* * * * *", "*/5 * * * *", "*/15 * * * *", "0 * * * *", "0 0 * * *", "0 2 * * *", "0 9 * * 1-5",
                     "0,30 9-18 * * 1-5", "0 10 * * 1", "0 8 * * 0,6", "0 0 1 * *", "0 0 L * *", "0 0 1 1,4,7,10 *",
                     "0 0 1 1 *", "*/30 * * * * *", "@yearly", "@weekends"] {
            XCTAssertEqual(try runs(expr, utc).count, 10, expr)
        }
    }

    func testNativeDescription() throws {
        func d(_ e: String, _ lang: Lang = .zh) throws -> String { Cron.nativeDescription(try Cron.normalize(e), lang: lang) }
        XCTAssertEqual(try d("*/5 * * * *"), "每 5 分钟")
        XCTAssertEqual(try d("*/5 * * * *", .en), "Every 5 minutes")
        XCTAssertEqual(try d("30 9 * * *"), "每天 09:30")
        XCTAssertEqual(try d("30 9 * * *", .en), "At 09:30 every day")
        XCTAssertEqual(try d("@daily"), "每天 00:00")
        XCTAssertEqual(try d("* * * * * *"), "每秒")
        XCTAssertEqual(try d("* * * * *", .en), "Every minute")
        XCTAssertEqual(try d("0 * * * *"), "每小时整点")
        XCTAssertEqual(try d("0 9 * * 1-5"), "在 09:00，周一到周五")
        XCTAssertEqual(try d("0 9 * * 1-5", .en), "At 09:00, on Monday to Friday")
        XCTAssertEqual(try d("0 0 1 1,4,7,10 *"), "在 00:00，每月 1 号，仅 1 月、4 月、7 月、10 月")
        XCTAssertEqual(try d("0 0 L * *", .en), "At 00:00, on the last day of the month")
        XCTAssertEqual(try d("0 9 * * THU"), "在 09:00，周四")
        XCTAssertEqual(try d("0,30 9 * * *"), "每天 09:00、09:30")
        XCTAssertTrue(try d("H * * * *").contains("分：随机取值"))
        XCTAssertEqual(try d("*/15 9-17 * * *"), "分：每隔 15 分钟；时：9 点到 17 点；日：每天；月：每个月；周：不限星期")
    }

    struct FakeEngine: ScriptEngine {
        var reply: String?
        func call(_ function: String, _ args: [String: String]) throws -> String {
            guard function == "cron", args["use24Hour"] == "1", let reply else { throw ScriptError(message: "boom") }
            return reply.replacingOccurrences(of: "{locale}", with: args["locale"] ?? "")
        }
    }

    func testDescriptionUsesScriptEngineAndFallsBack() throws {
        let saved = ToolEnvironment.script
        defer { ToolEnvironment.script = saved }
        let n = try Cron.normalize("0 2 * * *")
        ToolEnvironment.script = FakeEngine(reply: "在 02:00")
        XCTAssertEqual(Cron.describe(n, lang: .zh), "每天 02:00")
        ToolEnvironment.script = FakeEngine(reply: "At 02:00 ({locale})")
        XCTAssertEqual(Cron.describe(n, lang: .en), "At 02:00 (en)")
        ToolEnvironment.script = FakeEngine(reply: "每隔5分钟, 星期一 和 星期二")
        XCTAssertEqual(Cron.describe(n, lang: .zh), "每隔 5 分钟，星期一和星期二")
        ToolEnvironment.script = FakeEngine(reply: nil)
        XCTAssertEqual(Cron.describe(n, lang: .zh), "每天 02:00")
        ToolEnvironment.script = nil
        XCTAssertEqual(Cron.describe(n, lang: .en), "At 02:00 every day")
    }

    func testTool() throws {
        let saved = ToolEnvironment.script
        defer { ToolEnvironment.script = saved }
        ToolEnvironment.script = nil
        let spec = CronParserTool.spec
        let now = Date(timeIntervalSince1970: Double(from) / 1000)
        let r = try spec.run(ToolInput(text: "0 2 * * * /bin/job", options: ["tz": "Asia/Shanghai", "count": "3"], lang: .zh, now: now))
        XCTAssertEqual(r.table?.rows.count, 3)
        XCTAssertEqual(r.table?.rows.first, ["1", "2024-01-02 02:00:00", "周二", "UTC+08:00", "18小时后"])
        XCTAssertEqual(r.outputs.first?.value, "每天 02:00")
        XCTAssertEqual(r.outputs.first { $0.id == "next" }?.value, "2024-01-02 02:00:00 周二（18小时后）")
        XCTAssertTrue(r.notes.contains { $0.message.contains("/bin/job") })
        XCTAssertNil(r.primary)

        let en = try spec.run(ToolInput(text: "0 0 1,15 * 1", options: ["tz": "UTC", "count": "99"], lang: .en, now: now))
        XCTAssertEqual(en.table?.rows.count, 50)
        XCTAssertEqual(en.table?.columns[1], "Run time")
        XCTAssertTrue(en.notes.contains { $0.message.contains("either one matching") })
        let big = try spec.run(ToolInput(text: "*/60 * * * *", options: ["tz": "UTC"], lang: .zh, now: now))
        XCTAssertTrue(big.notes.contains { $0.message.contains("步长 60 超过取值范围") })
        XCTAssertThrowsError(try spec("0 0 * * 8", lang: .en, now: now)) { e in
            XCTAssertEqual((e as? ToolError)?.message, "Field 5 (day of week): the value 8 is out of range (0–7)")
        }
    }
}
