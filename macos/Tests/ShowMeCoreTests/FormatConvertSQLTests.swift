import Foundation
import XCTest
@testable import ShowMeCore

final class FormatConvertSQLTests: XCTestCase {
    typealias D = SQLFormatter.Dialect

    func min(_ sql: String, _ d: D = .sql) -> String { SQLFormatter.minify(sql, dialect: d).output }

    let sample = """
    -- 统计 2024 年各城市每月的活跃用户、人均消费与消费冠军
    with monthly_orders as (select o.user_id, date_format(o.created_at, '%Y-%m') as month, sum(o.amount) as total_amount, count(*) as order_cnt from orders o where o.status in ('paid', 'shipped') and o.created_at >= '2024-01-01' and o.remark not like '%测试 -- 请忽略%' group by o.user_id, date_format(o.created_at, '%Y-%m')), ranked as (select mo.*, u.city, row_number() over (partition by u.city, mo.month order by mo.total_amount desc) as rn from monthly_orders mo inner join users u on u.id = mo.user_id where u.deleted_at is null /* 排除已注销用户 */) select r.city as "城市", r.month as "月份", count(distinct r.user_id) as "活跃用户数", round(avg(r.total_amount), 2) as "人均消费", max(case when r.rn = 1 then r.user_id end) as "消费冠军" from ranked r left join city_levels cl on cl.city = r.city where r.order_cnt > 1 and (cl.level is null or cl.level <= 2) group by r.city, r.month having count(distinct r.user_id) >= 10 order by r.month desc, "人均消费" desc limit 20;
    update users set level = 'VIP', updated_at = now() where id in (select user_id from orders where status = 'paid' group by user_id having sum(amount) > 10000);

    """

    func testTokenizerRoundTripsAndTypes() {
        for d in D.allCases {
            XCTAssertEqual(SQLFormatter.tokenize(sample, dialect: d).map(\.text).joined(), sample, d.rawValue)
        }
        let types = SQLFormatter.tokenize("SELECT 'a''b', \"c\", `d` -- x\n/* y */", dialect: .mysql)
            .filter { $0.type != .ws }.map { "\($0.type.rawValue):\($0.text)" }
        XCTAssertEqual(types, ["word:SELECT", "string:'a''b'", "punct:,", "ident:\"c\"", "punct:,", "ident:`d`", "comment:-- x", "comment:/* y */"])
        let q = SQLFormatter.tokenize("values(q'[it's]')", dialect: .plsql).map { "\($0.type.rawValue):\($0.text)" }
        XCTAssertEqual(q, ["word:values", "punct:(", "string:q'[it's]'", "punct:)"])
    }

    func testMinifyBasics() {
        XCTAssertEqual(min("-- 头部注释\nSELECT  a ,  b   -- 行尾注释\nFROM   t   /* 块注释 */\nWHERE  x = 1 ;"), "SELECT a,b FROM t WHERE x = 1;")
        XCTAssertEqual(min("SELECT '  -- not a comment  ', \"col  /* x */\", 'it''s', 'a\n  b' FROM t"),
                       "SELECT '  -- not a comment  ',\"col  /* x */\",'it''s','a\n  b' FROM t")
        XCTAssertEqual(min("SELECT 'a\\' -- still string', 1 -- c", .mysql), "SELECT 'a\\' -- still string',1")
        XCTAssertEqual(min("SELECT 'C:\\' -- comment\n, 2", .postgresql), "SELECT 'C:\\',2")
        XCTAssertEqual(min("SELECT E'a\\'b -- x' -- c", .postgresql), "SELECT E'a\\'b -- x'")
        XCTAssertEqual(min("SELECT 1--1", .mysql), "SELECT 1--1")
        XCTAssertEqual(min("SELECT 1 -- 1\n+ 2", .mysql), "SELECT 1 + 2")
        XCTAssertEqual(min("SELECT 1 # comment\n, 2", .mysql), "SELECT 1,2")
        XCTAssertEqual(min("SELECT 5 # 3", .postgresql), "SELECT 5 # 3")
    }

    func testMinifyKeepsHintsQuotesAndCommands() {
        XCTAssertEqual(min("SELECT /*+ INDEX(t idx_a) */ a FROM t /* drop me */", .mysql), "SELECT /*+ INDEX(t idx_a) */ a FROM t")
        XCTAssertEqual(min("/*!40101 SET NAMES utf8mb4 */;", .mysql), "/*!40101 SET NAMES utf8mb4 */;")
        let body = "$fn$\nBEGIN\n  -- 注释要保留\n  RETURN 1;\nEND;\n$fn$"
        XCTAssertEqual(min("CREATE FUNCTION f() RETURNS int AS \(body) LANGUAGE plpgsql;", .postgresql), "CREATE FUNCTION f() RETURNS int AS \(body) LANGUAGE plpgsql;")
        XCTAssertEqual(min("SELECT *\nFROM t WHERE id = $1", .postgresql), "SELECT * FROM t WHERE id = $1")
        XCTAssertEqual(min("SELECT /* a /* b */ c */ 1", .postgresql), "SELECT 1")
        XCTAssertEqual(min("SELECT /* a /* b */ 1", .mysql), "SELECT 1")
        XCTAssertEqual(min("SELECT [my -- col]  FROM t", .tsql), "SELECT [my -- col] FROM t")
        XCTAssertEqual(min("SELECT q'[it's -- ok]' FROM dual -- c", .plsql), "SELECT q'[it's -- ok]' FROM dual")
        XCTAssertEqual(min("SELECT '''a\n-- b''' # c", .bigquery), "SELECT '''a\n-- b'''")
        XCTAssertEqual(min("SELECT 1 // c\n, 2", .snowflake), "SELECT 1,2")
        XCTAssertEqual(min("SELECT * FROM t WHERE id = #{id}\n  AND name = ${name}", .mysql), "SELECT * FROM t WHERE id = #{id} AND name = ${name}")
        XCTAssertEqual(min("SELECT a/**/FROM t"), "SELECT a FROM t")
        XCTAssertEqual(min("SELECT 1 -/* x */-1", .mysql), "SELECT 1 - -1")
        XCTAssertEqual(min("SELECT 1\nGO\nSELECT 2\nGO 5\n", .tsql), "SELECT 1\nGO\nSELECT 2\nGO 5")
        XCTAssertEqual(min("BEGIN\n  NULL;\nEND;\n/\nSELECT 1 FROM dual", .plsql), "BEGIN NULL;END;\n/\nSELECT 1 FROM dual")
        XCTAssertEqual(min("DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND$$\nDELIMITER ;", .mysql),
                       "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1;END$$\nDELIMITER ;")
    }

    func testMinifyWarningsUnicodeAndSize() {
        let r = SQLFormatter.minify("SELECT 'abc -- x\n  FROM t", dialect: .mysql)
        XCTAssertEqual(r.output, "SELECT 'abc -- x\n  FROM t")
        XCTAssertTrue(r.warnings[0].contains("第 1 行第 8 列的字符串没有闭合"))
        let c = SQLFormatter.minify("SELECT 1 /* never closed", dialect: .mysql, lang: .en)
        XCTAssertEqual(c.output, "SELECT 1 /* never closed")
        XCTAssertEqual(c.warnings, ["The block comment at line 1, column 10 is not closed; the rest is kept as is."])
        XCTAssertEqual(min("SELECT 名字\u{3000}AS \"😀 别名\"  FROM 用户表 -- 注释"), "SELECT 名字 AS \"😀 别名\" FROM 用户表")
        let s = SQLFormatter.minify(sample, dialect: .mysql)
        XCTAssertFalse(s.output.contains("\n"))
        XCTAssertTrue(s.output.contains("'%测试 -- 请忽略%'"))
        XCTAssertFalse(s.output.contains("排除已注销用户"))
        XCTAssertEqual(s.commentsRemoved, 2)
        XCTAssertEqual(min(""), "")
        XCTAssertEqual(min("  -- only comment\n"), "")
        var parts: [String] = []
        for i in 0..<5000 { parts.append("-- c\(i)\nSELECT \(i) AS \"列\(i)\"") }
        let start = Date()
        let big = min(parts.joined(separator: ";\n"), .mysql)
        XCTAssertLessThan(Date().timeIntervalSince(start), 10)
        XCTAssertEqual(big.split(separator: ";").count, 5000)
        XCTAssertFalse(big.contains("--"))
    }

    func testMinifyTool() throws {
        let tool = SQLFormatterTool.spec
        let r = try tool("select 1 -- c\n, 2", options: ["mode": "minify"])
        XCTAssertEqual(r.primary?.value, "select 1,2")
        XCTAssertEqual(r.primary?.language, "sql")
        XCTAssertEqual(r.notes.first?.message, "已去掉 1 处注释")
        let en = try tool("select 'x", options: ["mode": "minify"], lang: .en)
        XCTAssertEqual(en.notes.first?.level, .warning)
    }
}
