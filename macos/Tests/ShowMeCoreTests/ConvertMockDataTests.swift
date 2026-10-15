import XCTest
@testable import ShowMeCore

final class ConvertMockDataTests: XCTestCase {
    typealias M = MockData
    let now: Int64 = 1_749_945_600_000 // 2025-06-15T00:00Z

    func column(_ spec: String, locale: M.Locale = .zh, count: Int = 300, seed: UInt32 = 42) -> [M.Cell] {
        let fields = M.parseFields("v:" + spec, lang: .zh).fields
        XCTAssertEqual(fields.count, 1, spec)
        return M.generate(fields, count: count, seed: seed, locale: locale, nowMs: now, lang: .zh).rows.map { $0[0] }
    }

    func texts(_ spec: String, locale: M.Locale = .zh) -> [String] { column(spec, locale: locale).map(\.text) }

    func matches(_ pattern: String, _ s: String) -> Bool {
        (try? NSRegularExpression(pattern: pattern))?.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }

    func testPRNG() {
        let a = M.Rng(seed: 123), b = M.Rng(seed: 123), c = M.Rng(seed: 124)
        let sa = (0..<10).map { _ in a.next() }
        XCTAssertEqual(sa, (0..<10).map { _ in b.next() })
        XCTAssertNotEqual(sa, (0..<10).map { _ in c.next() })
        XCTAssertTrue(sa.allSatisfy { $0 >= 0 && $0 < 1 })
        let r = M.Rng(seed: 1)
        var seen = Set<Int>()
        for _ in 0..<2000 {
            let v = r.int(3, 7)
            XCTAssertTrue((3...7).contains(v))
            seen.insert(v)
        }
        XCTAssertEqual(seen, [3, 4, 5, 6, 7])
        let wide = M.Rng(seed: 9)
        var last = Set<Int64>()
        for _ in 0..<500 {
            let v = wide.int(-1_000_000_000_000_000, 1_000_000_000_000_000)
            XCTAssertTrue(v.magnitude <= 1_000_000_000_000_000)
            last.insert(Int64(v.magnitude % 1000))
        }
        XCTAssertGreaterThan(last.count, 350)
        // mulberry32 的第一个输出（与 JS 版逐位一致）
        XCTAssertEqual(M.Rng(seed: 0).next(), 0.26642920868471265, accuracy: 1e-15)
        XCTAssertEqual(M.hashString("abc"), M.hashString("abc"))
        XCTAssertNotEqual(M.hashString("abc"), M.hashString("abd"))
        // 与 JS 版的值一致
        XCTAssertEqual(M.hashString("abc"), 1_792_905_582)
        XCTAssertEqual(M.hashString("中文😀"), 2_689_254_610)
        XCTAssertEqual(M.hashString(""), 167_010_153)
    }

    func testChecksums() {
        XCTAssertEqual(M.idCardCheckDigit("11010519491231002"), "X")
        XCTAssertEqual(M.idCardCheckDigit("44052418800101001"), "4")
        XCTAssertTrue(M.isValidIdCard("11010519491231002X"))
        XCTAssertTrue(M.isValidIdCard("440524188001010014"))
        XCTAssertFalse(M.isValidIdCard("110105194912310021"))
        XCTAssertFalse(M.isValidIdCard("110105194902300028"))
        XCTAssertFalse(M.isValidIdCard("11010519491231002x"))
        XCTAssertFalse(M.isValidIdCard(""))
        XCTAssertTrue(M.isLuhnValid("79927398713"))
        XCTAssertTrue(M.isLuhnValid("4539 1488 0343 6467"))
        XCTAssertFalse(M.isLuhnValid("79927398710"))
        XCTAssertEqual(M.luhnCheckDigit("7992739871"), "3")
        XCTAssertFalse(M.isLuhnValid("abc"))
        XCTAssertEqual(M.creditCodeCheckChar("91350100M000100Y4"), "3")
        XCTAssertTrue(M.isValidCreditCode("91350100M000100Y43"))
        XCTAssertFalse(M.isValidCreditCode("91350100M000100Y44"))
        XCTAssertFalse(M.isValidCreditCode("91350100M000100I43"))
        XCTAssertFalse(M.isValidCreditCode("short"))
        XCTAssertEqual(M.orgCodeCheckChar("M000100Y"), "4")
        XCTAssertEqual(M.orgCodeCheckChar("D2143569"), "X")
        XCTAssertTrue(M.isValidOrgCode("D2143569X"))
        XCTAssertFalse(M.isValidOrgCode("D21435691"))
    }

    func testChineseIdentityAndCards() {
        let codes = Set(MockDict.regions.flatMap { $0.cities.flatMap { $0.districts.map(\.code) } })
        for id in texts("idcard(20-30)") {
            XCTAssertTrue(M.isValidIdCard(id), id)
            XCTAssertTrue(codes.contains(String(id.prefix(6))))
            let chars = Array(id)
            let birthYear = Int(String(chars[6..<10])) ?? 0
            XCTAssertTrue((1994...2005).contains(birthYear), id)
        }
        for id in texts("idcard(male)") { XCTAssertEqual((Array(id)[16].wholeNumberValue ?? 0) % 2, 1) }
        for id in texts("idcard(female)") { XCTAssertEqual((Array(id)[16].wholeNumberValue ?? 1) % 2, 0) }
        for card in texts("bank_card") {
            XCTAssertTrue(matches("^62[0-9]{17}$", card), card)
            XCTAssertTrue(M.isLuhnValid(card))
        }
        for card in texts("bank_card(16,spaced)") {
            XCTAssertTrue(matches("^62[0-9]{2}( [0-9]{4}){3}$", card), card)
            XCTAssertTrue(M.isLuhnValid(card))
        }
        for code in texts("credit_code") {
            XCTAssertEqual(code.count, 18)
            XCTAssertTrue(M.isValidCreditCode(code), code)
            XCTAssertTrue(M.isValidOrgCode(String(Array(code)[8..<17])), code)
        }
    }

    func testChineseShapes() {
        for p in texts("phone") { XCTAssertTrue(matches("^1[3-9][0-9]{9}$", p), p) }
        for p in texts("phone(dash)") { XCTAssertTrue(matches("^1[3-9][0-9]-[0-9]{4}-[0-9]{4}$", p), p) }
        for p in texts("phone(intl)") { XCTAssertTrue(matches("^\\+86 1[3-9][0-9]{9}$", p), p) }
        for e in texts("email") { XCTAssertTrue(matches("^[a-z0-9._]+@[a-z0-9.-]+\\.[a-z]{2,}$", e), e) }
        for e in texts("email(safe)") { XCTAssertTrue(matches("@example\\.(com|net|org)$", e), e) }
        for e in texts("email(@Corp.CN)") { XCTAssertTrue(e.hasSuffix("@corp.cn"), e) }
        for n in texts("name") { XCTAssertTrue(matches("^\\p{Han}{2,4}$", n), n) }
        for a in texts("address") { XCTAssertTrue(matches("^.+(省|市|自治区).*区.+[0-9]+号$", a), a) }
        for a in texts("address(detail)") { XCTAssertTrue(matches("栋[0-9]+单元[0-9]+室$", a), a) }
        for a in texts("address(region)") { XCTAssertFalse(a.contains("北京市北京市")) }
        let provinces = Set(MockDict.regions.map(\.name))
        for a in texts("province") { XCTAssertTrue(provinces.contains(a)) }
        for p in texts("plate") { XCTAssertTrue(matches("^\\p{Han}[A-H][0-9A-HJ-NP-Z]{5}$", p), p) }
        for p in texts("plate(ev)") { XCTAssertTrue(matches("^\\p{Han}[A-H][DF][0-9A-HJ-NP-Z][0-9]{4}$", p), p) }
        for z in texts("zip") { XCTAssertTrue(matches("^[0-9]{6}$", z)) }
        for ip in texts("ip(private)") { XCTAssertTrue(matches("^(10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|192\\.168\\.)", ip), ip) }
        for ip in texts("ip") {
            let parts = ip.split(separator: ".").compactMap { Int($0) }
            XCTAssertEqual(parts.count, 4)
            XCTAssertFalse(M.isPrivateOrReserved(parts[0], parts[1]), ip)
        }
        for u in texts("uuid") { XCTAssertTrue(matches("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", u), u) }
        for u in texts("uuid(compact)") { XCTAssertTrue(matches("^[0-9a-f]{32}$", u)) }
        for c in texts("color") { XCTAssertTrue(matches("^#[0-9a-f]{6}$", c), c) }
        for c in texts("color(rgb)") { XCTAssertTrue(matches("^rgb\\([0-9]{1,3}, [0-9]{1,3}, [0-9]{1,3}\\)$", c), c) }
        for u in texts("url") { XCTAssertNotNil(URL(string: u), u) }
        for s in texts("sentence") { XCTAssertTrue(matches("^\\p{Han}.+[。！]$", s), s) }
        for p in texts("paragraph(2-2)") { XCTAssertEqual(p.filter { $0 == "。" || $0 == "！" }.count, 2, p) }
        for pw in texts("password(16)") {
            XCTAssertEqual(pw.count, 16)
            XCTAssertTrue(matches("[a-z]", pw) && matches("[A-Z]", pw) && matches("[0-9]", pw) && matches("[!@#$%^&*\\-_=+?]", pw), pw)
        }
        for pw in texts("password(8,nosymbols)") { XCTAssertTrue(matches("^[A-Za-z0-9]{8}$", pw), pw) }
        XCTAssertEqual(Set(texts("gender")), ["男", "女"])
    }

    func testNumbersDatesBoolsEnums() {
        for v in column("int(-5-5)") {
            guard case .int(let n) = v else { return XCTFail("\(v)") }
            XCTAssertTrue((-5...5).contains(n))
        }
        for v in column("float(1-2,3)") {
            guard case .number(let s) = v, let d = Double(s) else { return XCTFail("\(v)") }
            XCTAssertTrue((1...2).contains(d))
            XCTAssertLessThanOrEqual(s.split(separator: ".").dropFirst().first?.count ?? 0, 3)
        }
        let swapped = M.generate(M.parseFields("n:int(10-1)", lang: .zh).fields, count: 50, seed: 1, locale: .zh, nowMs: now, lang: .zh)
        XCTAssertTrue(swapped.warnings.contains { $0.contains("交换") })
        let none = M.generate(M.parseFields("n:int(1.2-1.8)", lang: .zh).fields, count: 5, seed: 3, locale: .zh, nowMs: now, lang: .zh)
        XCTAssertEqual(none.warnings, ["整数：1.2–1.8 之间没有整数，已固定为 1"])
        XCTAssertTrue(none.rows.allSatisfy { $0[0] == .int(1) })
        let lo = M.parseWallTime("2024-02-01") ?? 0, hi = M.parseWallTime("2024-02-29 23:59:59") ?? 0
        for v in texts("datetime(2024-02-01~2024-02-29 23:59:59)") {
            let t = M.parseWallTime(v) ?? -1
            XCTAssertTrue(t >= lo && t <= hi, v)
        }
        for v in texts("datetime(iso)") { XCTAssertTrue(matches("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\+08:00$", v), v) }
        for v in column("timestamp") { if case .int = v {} else { XCTFail("\(v)") } }
        XCTAssertEqual(M.formatWallTime(M.parseWallTime("2024-01-01 08:00:00") ?? 0, .ts), .int(1_704_067_200))
        XCTAssertEqual(M.formatWallTime(M.parseWallTime("2024-01-01 08:00:00") ?? 0, .tsms), .int(1_704_067_200_000))
        XCTAssertEqual(M.formatWallTime(M.parseWallTime("2024-01-01 08:00:00") ?? 0, .iso), .string("2024-01-01T08:00:00+08:00"))
        XCTAssertEqual(M.parseWallTime("2024/1/2 8:05"), Timestamp.wallToUtcMs(WallTime(year: 2024, month: 1, day: 2, hour: 8, minute: 5)))
        XCTAssertNil(M.parseWallTime("2023-02-29"))
        XCTAssertNil(M.parseWallTime("2024-01-02 24:00"))
        let badDate = M.generate(M.parseFields("d:datetime(yesterday~tomorrow)", lang: .zh).fields, count: 1, seed: 1, locale: .zh, nowMs: now, lang: .zh)
        XCTAssertTrue(badDate.warnings.first?.contains("无法识别") ?? false)
        XCTAssertTrue(column("bool(100)").allSatisfy { $0 == .bool(true) })
        XCTAssertTrue(column("bool(0,number)").allSatisfy { $0 == .int(0) })
        XCTAssertEqual(Set(texts("bool(zh)")), ["是", "否"])
        XCTAssertEqual(M.parseEnumValues("a, b，c\nd|e,,"), ["a", "b", "c", "d", "e"])
        XCTAssertEqual(Set(texts("enum(红|绿，蓝)")), ["红", "绿", "蓝"])
        let empty = M.generate(M.parseFields("e:enum( , )", lang: .zh).fields, count: 2, seed: 1, locale: .zh, nowMs: now, lang: .zh)
        XCTAssertTrue(empty.warnings.first?.contains("没有可选值") ?? false)
        XCTAssertEqual(empty.rows[0][0], .string(""))
        XCTAssertEqual(column("id(100,5)", count: 4), [.int(100), .int(105), .int(110), .int(115)])
        for age in column("age") {
            guard case .int(let n) = age else { return XCTFail() }
            XCTAssertTrue((18...65).contains(n))
        }
    }

    func testEnglishLocale() {
        for n in texts("name", locale: .en) { XCTAssertTrue(matches("^[A-Z][a-z]+ [A-Z][a-z]+$", n), n) }
        for n in texts("first_name", locale: .en) { XCTAssertTrue(matches("^[A-Z][a-z]+$", n), n) }
        for p in texts("phone", locale: .en) { XCTAssertTrue(matches("^\\([0-9]{3}\\) 555-01[0-9]{2}$", p), p) }
        for a in texts("address", locale: .en) { XCTAssertTrue(matches("^[0-9]+ [A-Za-z]+ [A-Za-z]+, [A-Za-z ]+, [A-Z]{2} [0-9]{5}$", a), a) }
        for c in texts("company", locale: .en) { XCTAssertTrue(matches("^[A-Za-z]+ [A-Za-z]+ (Inc\\.|LLC|Ltd\\.|Corp\\.|Group)$", c), c) }
        for s in texts("ssn", locale: .en) { XCTAssertTrue(matches("^9[0-9]{2}-(0[1-9]|[1-4][0-9])-[0-9]{4}$", s), s) }
        for c in texts("bank_card", locale: .en) {
            XCTAssertTrue(matches("^4[0-9]{15}$", c), c)
            XCTAssertTrue(M.isLuhnValid(c))
        }
        for s in texts("sentence", locale: .en) { XCTAssertTrue(matches("^[A-Z].+[.!]$", s), s) }
        for s in texts("paragraph", locale: .en) { XCTAssertFalse(s.contains("  ")) }
        for v in texts("datetime(iso)", locale: .en) { XCTAssertTrue(v.hasSuffix("Z"), v) }
        XCTAssertEqual(Set(texts("gender", locale: .en)), ["Male", "Female"])
        for e in texts("email", locale: .en) { XCTAssertTrue(matches("^[a-z0-9._]+@[a-z0-9.-]+\\.[a-z]{2,}$", e), e) }
    }

    func testFieldParsingAndDeterminism() {
        let p = M.parseFields("id, user_id:int(1-10000), status：enum(待支付|已支付,已发货)\n姓名, foo, created_at:date(2024-01-01~2024-12-31)", lang: .zh)
        XCTAssertEqual(p.fields.map(\.name), ["id", "user_id", "status", "姓名", "created_at"])
        XCTAssertEqual(p.fields.map(\.type), [.autoId, .int, .enumValues, .name, .datetime])
        XCTAssertEqual(p.fields[2].args, "待支付|已支付,已发货")
        XCTAssertEqual(p.warnings.count, 1)
        XCTAssertTrue(p.warnings[0].contains("未知的字段类型「foo」"))
        let fields = M.parseFields(M.defaultFields, lang: .zh).fields
        XCTAssertEqual(fields.count, 8)
        let a = M.generate(fields, count: 20, seed: 99, locale: .zh, nowMs: now, lang: .zh)
        XCTAssertEqual(a.rows, M.generate(fields, count: 20, seed: 99, locale: .zh, nowMs: now, lang: .zh).rows)
        XCTAssertNotEqual(a.rows, M.generate(fields, count: 20, seed: 100, locale: .zh, nowMs: now, lang: .zh).rows)
        XCTAssertEqual(a.warnings, [])
        // 增加行数保留前面的行；调整列顺序不影响其它列
        XCTAssertEqual(Array(M.generate(fields, count: 50, seed: 99, locale: .zh, nowMs: now, lang: .zh).rows.prefix(20)), a.rows)
        let reordered = M.generate(Array(fields.reversed()), count: 20, seed: 99, locale: .zh, nowMs: now, lang: .zh)
        XCTAssertEqual(reordered.rows.map { $0.last }, a.rows.map { $0.first })
        let names = M.resolveColumnNames(["a", " ", "a", "a"], lang: .zh)
        XCTAssertEqual(names.columns, ["a", "field_2", "a_2", "a_3"])
        XCTAssertEqual(names.warnings.count, 3)
        XCTAssertEqual(M.generate(fields, count: 5000, seed: 1, locale: .zh, nowMs: now, lang: .zh).rows.count, 1000)
    }

    func testAllTypesAndSpeed() {
        let all = M.FieldType.allCases.map { M.Field(name: $0.rawValue, type: $0, args: $0 == .enumValues ? "a|b" : "") }
        let started = Date()
        for locale in [M.Locale.zh, .en] {
            let r = M.generate(all, count: 1000, seed: 7, locale: locale, nowMs: now, lang: .zh)
            XCTAssertEqual(r.rows.count, 1000)
            XCTAssertEqual(r.columns.count, M.FieldType.allCases.count)
            XCTAssertEqual(r.warnings, [])
            XCTAssertGreaterThan(M.toJSON(r.columns, r.rows).count, 1000)
            XCTAssertGreaterThan(M.toSQL(r.columns, r.rows, table: "t", dialect: .mysql).count, 1000)
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 20)
    }

    func testFormats() {
        let cols = ["id", "name", "note", "ok"]
        let rows: [[M.Cell]] = [
            [.int(1), .string("张三"), .string("a,b"), .bool(true)],
            [.int(2), .string("O'Brien"), .string("say \"hi\"\nbye"), .bool(false)],
            [.int(3), .string("😀 表情"), .null, .bool(true)],
        ]
        XCTAssertEqual(M.toJSON(["a"], [[.int(1)]]), "[\n  {\n    \"a\": 1\n  }\n]")
        XCTAssertEqual(M.toJSON([], []), "[]")
        let json = (try? JSON.value(M.toJSON(cols, rows))) ?? .null
        XCTAssertEqual(json[1]?["note"], .string("say \"hi\"\nbye"))
        XCTAssertEqual(json[2]?["note"], .null)
        XCTAssertEqual(M.csvEscape("plain"), "plain")
        XCTAssertEqual(M.csvEscape("a,b"), "\"a,b\"")
        XCTAssertEqual(M.csvEscape("say \"hi\""), "\"say \"\"hi\"\"\"")
        XCTAssertEqual(M.csvEscape("x\ny"), "\"x\ny\"")
        XCTAssertEqual(M.csvEscape(" pad"), "\" pad\"")
        XCTAssertEqual(M.toCSV(cols, rows), "id,name,note,ok\n1,张三,\"a,b\",true\n2,O'Brien,\"say \"\"hi\"\"\nbye\",false\n3,😀 表情,,true")
        XCTAssertEqual(M.toTSV(["a", "b"], [[.string("x\ty"), .string("l1\r\nl2")]]), "a\tb\nx y\tl1 l2")
        XCTAssertEqual(M.quoteIdent("user", .mysql), "`user`")
        XCTAssertEqual(M.quoteIdent("a`b", .mysql), "`a``b`")
        XCTAssertEqual(M.quoteIdent("public.users", .postgres, qualified: true), "\"public\".\"users\"")
        XCTAssertEqual(M.quoteIdent("dbo.t]x", .sqlserver, qualified: true), "[dbo].[t]]x]")
        XCTAssertEqual(M.quoteIdent("db. users ", .mysql, qualified: true), "`db`.`users`")
        XCTAssertEqual(M.quoteIdent("db.", .mysql, qualified: true), "`db`")
        XCTAssertEqual(M.toSQL(["user.name", "姓名"], [[.string("a"), .string("b")]], table: "app.users", dialect: .postgres),
                       "INSERT INTO \"app\".\"users\" (\"user.name\", \"姓名\") VALUES ('a', 'b');")
        XCTAssertEqual(M.sqlLiteral(.string("O'Brien"), .postgres), "'O''Brien'")
        XCTAssertEqual(M.sqlLiteral(.string("C:\\path"), .mysql), "'C:\\\\path'")
        XCTAssertEqual(M.sqlLiteral(.string("C:\\path"), .postgres), "'C:\\path'")
        XCTAssertEqual(M.sqlLiteral(.string("中文"), .sqlserver), "N'中文'")
        XCTAssertEqual(M.sqlLiteral(.bool(true), .mysql), "TRUE")
        XCTAssertEqual(M.sqlLiteral(.bool(true), .sqlserver), "1")
        XCTAssertEqual(M.sqlLiteral(.null, .mysql), "NULL")
        XCTAssertEqual(M.sqlLiteral(.number("1.5"), .mysql), "1.5")
        XCTAssertEqual(M.toSQL(["id", "n"], [[.int(1), .string("a")], [.int(2), .string("b")]], table: "users", dialect: .mysql, batch: 1),
                       "INSERT INTO `users` (`id`, `n`) VALUES (1, 'a');\nINSERT INTO `users` (`id`, `n`) VALUES (2, 'b');")
        XCTAssertEqual(M.toSQL(["id"], [[.int(1)], [.int(2)], [.int(3)]], table: "", dialect: .postgres, batch: 2),
                       "INSERT INTO \"mock_data\" (\"id\") VALUES\n  (1),\n  (2);\nINSERT INTO \"mock_data\" (\"id\") VALUES (3);")
        XCTAssertEqual(M.toSQL(["id"], [], table: "t", dialect: .mysql), "")
        XCTAssertEqual(M.toMarkdown(["n", "s"], [[.int(1), .string("a|b")], [.int(2), .string("x\ny")]]),
                       "| n | s |\n| ---: | --- |\n| 1 | a\\|b |\n| 2 | x<br>y |")
    }

    func testTool() throws {
        let spec = MockDataTool.spec
        func gen(_ options: [String: String], lang: Lang = .zh, random: @escaping @Sendable (Int) -> [UInt8] = TestRandom.lcg(3)) throws -> ToolResult {
            try spec.run(ToolInput(text: "", options: spec.defaults.merging(options) { $1 }, lang: lang,
                                   now: Date(timeIntervalSince1970: Double(now) / 1000), random: random))
        }
        let r = try gen([:])
        XCTAssertEqual(r.primary?.language, "json")
        let json = try JSON.value(r.primary?.value ?? "")
        XCTAssertEqual(json.items?.count, 10)
        XCTAssertEqual(json[0]?.members?.map(\.key), ["id", "name", "gender", "age", "phone", "email", "address", "created_at"])
        XCTAssertEqual(r.table?.columns.count, 8)
        XCTAssertEqual(try gen([:]).primary?.value, r.primary?.value)
        XCTAssertNotEqual(try gen([:], random: TestRandom.lcg(4)).primary?.value, r.primary?.value)
        let seeded = try gen(["seed": "hello"], random: TestRandom.lcg(4))
        XCTAssertEqual(seeded.primary?.value, try gen(["seed": "hello"], random: TestRandom.lcg(5)).primary?.value)
        XCTAssertTrue(seeded.notes.last?.message.contains("随机种子 hello") ?? false)

        let en = try gen(["format": "csv", "count": "3"], lang: .en)
        let lines = en.primary?.value.components(separatedBy: "\n") ?? []
        XCTAssertEqual(lines.first, "id,name,gender,age,phone,email,address,created_at")
        XCTAssertEqual(lines.count, 4)
        XCTAssertTrue(lines[1].contains("555-01"))

        let sql = try gen(["format": "sql", "table": "users", "fields": "id, name", "count": "2"])
        XCTAssertTrue(sql.primary?.value.hasPrefix("INSERT INTO `users` (`id`, `name`) VALUES\n  (1, '") ?? false)
        XCTAssertEqual(sql.primary?.language, "sql")
        let pg = try gen(["format": "sql-postgres", "fields": "id", "count": "1", "locale": "en"])
        XCTAssertEqual(pg.primary?.value, "INSERT INTO \"mock_data\" (\"id\") VALUES (1);")
        let md = try gen(["format": "markdown", "fields": "n:int(1-9)", "count": "2"])
        XCTAssertTrue(md.primary?.value.hasPrefix("| n |\n| ---: |") ?? false)

        XCTAssertThrowsError(try gen(["fields": " , "])) { e in
            XCTAssertTrue((e as? ToolError)?.message.contains("至少填写一个字段") ?? false)
        }
        XCTAssertThrowsError(try gen(["fields": "nope"], lang: .en)) { e in
            XCTAssertTrue((e as? ToolError)?.message.hasPrefix("Unknown field type “nope”") ?? false)
        }
        let big = try gen(["count": "1000"])
        XCTAssertEqual(big.table?.rows.count, 100)
        XCTAssertTrue(big.notes.contains { $0.message.contains("前 100 行") })
    }
}
