import Foundation
import XCTest
@testable import ShowMeCore

final class FormatConvertCSVTests: XCTestCase {
    typealias ToCSV = JSONCSV.ToCSVOptions
    typealias ToJSON = JSONCSV.ToJSONOptions

    func csv(_ json: String, _ o: ToCSV = ToCSV(), lang: Lang = .zh) throws -> JSONCSV.CSVResult {
        try JSONCSV.jsonToCSV(json, options: o, lang: lang)
    }

    func json(_ csv: String, _ o: ToJSON = ToJSON(indent: .none), lang: Lang = .zh) throws -> JSONCSV.JSONResult {
        try JSONCSV.csvToJSON(csv, options: o, lang: lang)
    }

    func testHelpers() throws {
        XCTAssertEqual(JSONCSV.cellText(.null), "")
        XCTAssertEqual(JSONCSV.cellText(.number("1.5")), "1.5")
        XCTAssertEqual(JSONCSV.cellText(.bool(false)), "false")
        XCTAssertEqual(JSONCSV.cellText(try JSON.value(#"[1,"a"]"#)), #"[1,"a"]"#)
        var collisions: [String] = []
        let rec = try JSON.value(#"{"a":1,"b":{"c":2,"d":{"e":3}},"f":[1],"g":{},"h":null}"#)
        let flat = JSONCSV.flatten(FC.members(rec), deep: true, collisions: &collisions)
        XCTAssertEqual(flat.keys, ["a", "b.c", "b.d.e", "f", "g", "h"])
        XCTAssertEqual(flat.keys.map { flat.values[$0] ?? "?" }, ["1", "2", "3", "[1]", "{}", ""])
        let shallow = JSONCSV.flatten(FC.members(rec), deep: false, collisions: &collisions)
        XCTAssertEqual(shallow.values["b"], #"{"c":2,"d":{"e":3}}"#)
        _ = JSONCSV.flatten(FC.members(try JSON.value(#"{"a.b":1,"a":{"b":2}}"#)), deep: true, collisions: &collisions)
        XCTAssertEqual(collisions, ["a.b"])

        let cells: [(String, JSONValue)] = [
            ("", .null), ("42", .number("42")), ("-1.5", .number("-1.5")), ("1e3", .number("1e3")), (" 7 ", .number("7")),
            ("007", .string("007")), ("+1", .string("+1")), ("1.", .string("1.")),
            ("12345678901234567890", .number("12345678901234567890")), ("true", .bool(true)), ("TRUE", .bool(true)),
            ("False", .bool(false)), ("null", .null), ("NULL", .null), ("[1,2]", .array([.number("1"), .number("2")])),
            ("{\"a\":1}", .object([JSONMember("a", .number("1"))])), ("[not json]", .string("[not json]")),
            ("hello", .string("hello")), ("中文", .string("中文")),
        ]
        for (s, v) in cells { XCTAssertEqual(JSONCSV.typeCell(s), v, s) }

        var conflicts: [String] = []
        func unflat(_ json: String) throws -> String {
            JSON.print(JSONCSV.unflatten(FC.members(try JSON.value(json)), conflicts: &conflicts), .minified)
        }
        XCTAssertEqual(try unflat(#"{"id":1,"a.b":2,"a.c.d":3,"t.0":"x","t.1":"y"}"#), #"{"id":1,"a":{"b":2,"c":{"d":3}},"t":["x","y"]}"#)
        XCTAssertEqual(try unflat(#"{"a.1":1,"a.2":2}"#), #"{"a":{"1":1,"2":2}}"#)
        XCTAssertEqual(try unflat(#"{"a..b":1,".x":2,"y.":3}"#), #"{"a..b":1,".x":2,"y.":3}"#)
        XCTAssertEqual(conflicts, [])
        XCTAssertEqual(try unflat(#"{"a.b":1,"a":2}"#), #"{"a.b":1,"a":2}"#)
        XCTAssertEqual(try unflat(#"{"x.y.z":1,"x.y":2}"#), #"{"x":{"y":{"z":1}},"x.y":2}"#)
        XCTAssertEqual(conflicts.sorted(), ["a.b", "x.y"])

        let arrays = JSONCSV.recordArrays(try JSON.value(#"{"code":0,"data":[{"a":1}],"tags":["x"],"empty":[]}"#))
        XCTAssertEqual(arrays.map(\.key), ["data"])
        XCTAssertEqual(arrays.map(\.count), [1])
        XCTAssertEqual(CSVCodec.guessFromFirstLine("a;b;c\n1;2"), ";")
        XCTAssertEqual(CSVCodec.guessFromFirstLine("a\tb\n1\t2"), "\t")
        XCTAssertEqual(CSVCodec.guessFromFirstLine("a|b"), "|")
        XCTAssertNil(CSVCodec.guessFromFirstLine("a,b"))
        XCTAssertNil(CSVCodec.guessFromFirstLine("single"))
    }

    let users = #"[{"id":1,"name":"张三","addr":{"city":"北京","geo":{"lat":1.5}},"tags":["a","b"]},{"id":2,"name":"Li, \"Lei\"","vip":true}]"#

    func testJSONToCSV() throws {
        let r = try csv(users)
        XCTAssertEqual(r.csv, "id,name,addr.city,addr.geo.lat,tags,vip\n1,张三,北京,1.5,\"[\"\"a\"\",\"\"b\"\"]\",\n2,\"Li, \"\"Lei\"\"\",,,,true")
        XCTAssertEqual(r.table.headers, ["id", "name", "addr.city", "addr.geo.lat", "tags", "vip"])
        XCTAssertEqual(r.table.rows.count, 2)
        XCTAssertEqual(r.warnings, [])
        let nested = try csv(users, ToCSV(flatten: false))
        XCTAssertEqual(nested.csv.split(separator: "\n").first, "id,name,addr,tags,vip")
        XCTAssertTrue(nested.csv.contains(#""{""city"":""北京"",""geo"":{""lat"":1.5}}""#))

        let data = #"[{"a":1,"b":"x y"}]"#
        XCTAssertEqual(try csv(data, ToCSV(delimiter: ";")).csv, "a;b\n1;x y")
        XCTAssertEqual(try csv(data, ToCSV(delimiter: "\t")).csv, "a\tb\n1\tx y")
        XCTAssertEqual(try csv(data, ToCSV(delimiter: "|")).csv, "a|b\n1|x y")
        XCTAssertEqual(try csv(data, ToCSV(quoteAll: true)).csv, "\"a\",\"b\"\n\"1\",\"x y\"")
        XCTAssertEqual(try csv(data, ToCSV(header: false)).csv, "1,x y")
        XCTAssertEqual(try csv(#"[{"a":1},{"a":2}]"#, ToCSV(newline: "\r\n")).csv, "a\r\n1\r\n2")
        XCTAssertEqual(try csv(#"[{"a":"x,y","b":"line1\nline2","c":" pad","d":"say \"hi\""}]"#).csv,
                       "a,b,c,d\n\"x,y\",\"line1\nline2\",\" pad\",\"say \"\"hi\"\"\"")
        XCTAssertEqual(try csv(#"{"a":1,"b":{"c":2}}"#).csv, "a,b.c\n1,2")
        // 大数与原文一字不差
        XCTAssertEqual(try csv(#"[{"n":12345678901234567890,"f":0.1000000000000000055511}]"#).csv, "n,f\n12345678901234567890,0.1000000000000000055511")
    }

    func testJSONToCSVShapes() throws {
        let grid = try csv(#"[["name","age"],["张三",20],["李四",null,"extra"]]"#)
        XCTAssertEqual(grid.csv, "name,age\n张三,20\n李四,,extra")
        XCTAssertEqual(grid.table.headers, ["name", "age", "列 3"])
        XCTAssertEqual(grid.table.rows, [["张三", "20", ""], ["李四", "", "extra"]])
        XCTAssertEqual(grid.warnings.count, 1)
        XCTAssertEqual(try csv("[[1,2]]", ToCSV(header: false)).table.headers, ["列 1", "列 2"])
        XCTAssertEqual(try csv("[[1,2]]", ToCSV(header: false), lang: .en).table.headers, ["Column 1", "Column 2"])
        XCTAssertEqual(try csv(#"[1,"a",null]"#).csv, "value\n1\na\n")
        XCTAssertEqual(try csv(#""x""#).csv, "value\nx")
        let mixed = try csv(#"[{"a":1},2]"#)
        XCTAssertEqual(mixed.csv, "a,value\n1,\n,2")
        XCTAssertTrue(mixed.warnings[0].contains("value"))
        XCTAssertEqual(try csv(#"[{"addr":{"city":"x"}},{"addr":null}]"#).table.headers, ["addr.city"])
        XCTAssertEqual(try csv(#"[{"a":1,"deleted":null}]"#).table.headers, ["a", "deleted"])
        let api = #"{"code":0,"data":[{"id":1},{"id":2}]}"#
        let whole = try csv(api)
        XCTAssertEqual(whole.candidates, ["data"])
        XCTAssertEqual(whole.candidateCounts, [2])
        XCTAssertNil(whole.usedPath)
        let sub = try csv(api, ToCSV(path: "data"))
        XCTAssertEqual(sub.csv, "id\n1\n2")
        XCTAssertEqual(sub.usedPath, "data")
        XCTAssertNil(try csv(api, ToCSV(path: "missing")).usedPath)
        XCTAssertEqual(try csv("  ").csv, "")
        let empty = try csv("[]")
        XCTAssertEqual(empty.csv, "")
        XCTAssertTrue(empty.warnings[0].contains("数组为空"))
        XCTAssertEqual(try csv("[{}]").csv, "")
        XCTAssertEqual(try csv("{}").warnings, ["对象没有任何字段，无法生成 CSV 列"])
        XCTAssertEqual(try csv("[{},{}]").warnings, ["所有对象都没有字段，无法生成 CSV 列"])
        XCTAssertEqual(try csv("{}", lang: .en).warnings, ["The object has no fields, so there are no CSV columns"])
        XCTAssertThrowsError(try csv(#"[{"a": 1}, {"a": 2]"#)) { error in
            let e = error as? ToolError
            XCTAssertEqual(e?.line, 1)
            XCTAssertGreaterThan(e?.column ?? 0, 1)
        }
    }

    func testCSVToJSON() throws {
        let src = "id,name,addr.city,vip,tags,zip,note\n1,张三,北京,true,\"[\"\"a\"\"]\",007,\n2,Lee,上海,FALSE,[],100080,hi"
        let r = try json(src)
        XCTAssertEqual(r.json, #"[{"id":1,"name":"张三","addr":{"city":"北京"},"vip":true,"tags":["a"],"zip":"007","note":null},{"id":2,"name":"Lee","addr":{"city":"上海"},"vip":false,"tags":[],"zip":100080,"note":"hi"}]"#)
        XCTAssertEqual(r.table.headers, ["id", "name", "addr.city", "vip", "tags", "zip", "note"])
        XCTAssertEqual(r.table.rows[0], ["1", "张三", "北京", "true", #"["a"]"#, "007", ""])
        XCTAssertEqual(r.delimiter, ",")
        XCTAssertEqual(try json("a.b,c\n1,", ToJSON(dynamicTyping: false, unflatten: false, indent: .none)).json, #"[{"a.b":"1","c":""}]"#)
        let grid = try json("1,a\n2,b,c", ToJSON(header: false, indent: .none))
        XCTAssertEqual(grid.json, #"[[1,"a"],[2,"b","c"]]"#)
        XCTAssertEqual(grid.table.headers, ["列 1", "列 2", "列 3"])
        XCTAssertEqual(try json("a\n1", ToJSON(indent: .spaces(4))).json, "[\n    {\n        \"a\": 1\n    }\n]")
        XCTAssertEqual(try json("big\n123456789012345678901234567890").json, #"[{"big":123456789012345678901234567890}]"#)
    }

    func testDelimiterDetection() throws {
        XCTAssertEqual(try json("a;b\n1;2").delimiter, ";")
        XCTAssertEqual(try json("a\tb\n1\t2").json, #"[{"a":1,"b":2}]"#)
        XCTAssertEqual(try json("a|b\n1|2").delimiter, "|")
        let ragged = try json("a;b\n1;2\n\n3;4;5\n6")
        XCTAssertEqual(ragged.delimiter, ";")
        XCTAssertEqual(ragged.json, #"[{"a":1,"b":2},{"a":3,"b":4,"column3":5},{"a":6,"b":null}]"#)
        XCTAssertEqual(try json("a;b\n1;2", ToJSON(delimiter: ",", indent: .none)).json, #"[{"a;b":"1;2"}]"#)
    }

    func testCSVWarningsAndQuotes() throws {
        let w = try json("a,b,c\n1,2,3\n\n4,5\n6,7,8,9").warnings
        XCTAssertEqual(w.count, 2)
        XCTAssertTrue(w[0].contains("第 4 行") && w[0].contains("少"))
        XCTAssertTrue(w[1].contains("第 5 行"))
        let en = try json("a,b,c\n4,5", lang: .en).warnings
        XCTAssertEqual(en, ["Line 2 has fewer fields than the header (3 columns); missing fields are empty"])
        let renamed = try json(" a ,a,,b\n1,2,3,4")
        XCTAssertEqual(renamed.json, #"[{"a":1,"a_2":2,"column3":3,"b":4}]"#)
        XCTAssertTrue(renamed.warnings[0].contains("a_2"))
        XCTAssertEqual(try json("a,b\n\"x, y\",\"say \"\"hi\"\"\nbye\"").json, #"[{"a":"x, y","b":"say \"hi\"\nbye"}]"#)
        XCTAssertEqual(try json("\u{FEFF}name,icon\r\n\r\n张三,😀\r\n").json, #"[{"name":"张三","icon":"😀"}]"#)
        XCTAssertThrowsError(try json("a,b\n1,\"x\n2,3")) { error in
            let e = error as? ToolError
            XCTAssertTrue(e?.message.contains("引号没有闭合") ?? false)
            XCTAssertEqual([e?.line, e?.column], [2, 3])
        }
        XCTAssertThrowsError(try json("a,b\n1,\"x\"y")) { error in
            let e = error as? ToolError
            XCTAssertTrue(e?.message.contains("引号格式不正确") ?? false)
            XCTAssertEqual(e?.line, 2)
        }
        XCTAssertThrowsError(try json("a\n\"x", lang: .en)) { error in
            XCTAssertEqual((error as? ToolError)?.message, "Line 2, column 1: Unclosed quote: this quoted field has no closing double quote")
        }
        XCTAssertEqual(try json("a,b").json, "[]")
        XCTAssertEqual(try json("   ").json, "")
        // 引号后跟空格再接分隔符也算合法
        XCTAssertEqual(try json("a,b\n\"x\" ,y").json, #"[{"a":"x","b":"y"}]"#)
        // 换行行号：引号字段里的换行也计入
        let lines = try json("a,b\n\"1\n2\",3\n4").warnings
        XCTAssertTrue(lines[0].contains("第 4 行"), lines.joined())
    }

    func testRoundTripAndLarge() throws {
        let data = #"[{"id":1,"name":"张三","addr":{"city":"北京","zip":"010"},"tags":["a","b"],"ok":true},{"id":2,"name":"Li, \"Lei\"","addr":{"city":"上海","zip":"021"},"tags":[],"ok":false}]"#
        let out = try csv(data).csv
        XCTAssertEqual(try json(out).json, data)
        XCTAssertEqual(try json(try csv(#"[{"code":"200"}]"#).csv).json, #"[{"code":200}]"#)

        var rows: [String] = []
        for i in 0..<20000 { rows.append(#"{"id":\#(i),"name":"n\#(i)","x":{"y":\#(i)}}"#) }
        let start = Date()
        let big = try csv("[" + rows.joined(separator: ",") + "]")
        XCTAssertEqual(big.csv.split(separator: "\n").count, 20001)
        XCTAssertEqual(big.table.rows.count, JSONCSV.tableLimit)
        let back = try json(big.csv)
        XCTAssertEqual(back.value.items?.count, 20000)
        XCTAssertLessThan(Date().timeIntervalSince(start), 20)
    }

    func testToolSpec() throws {
        let tool = JSONCSVTool.spec
        let r = try tool(#"[{"a":1,"b":{"c":"x"}}]"#)
        XCTAssertEqual(r.primary?.value, "a,b.c\n1,x")
        XCTAssertEqual(r.table?.columns, ["a", "b.c"])
        XCTAssertEqual(r.table?.rows, [["1", "x"]])
        XCTAssertEqual(try tool(#"[{"a":1}]"#, options: ["delimiter": "tab", "quoteAll": "1"]).primary?.value, "\"a\"\n\"1\"")
        let back = try tool("a;b\n1;2", options: ["mode": "csv2json"])
        XCTAssertEqual(back.primary?.value, "[\n  {\n    \"a\": 1,\n    \"b\": 2\n  }\n]")
        XCTAssertEqual(back.primary?.language, "json")
        XCTAssertTrue(back.notes[0].message.contains("分号"))
        let api = try tool(#"{"code":0,"data":[{"id":1}]}"#, lang: .en)
        XCTAssertTrue(api.notes.contains { $0.message.contains("data (1 items)") })
        XCTAssertEqual(try tool(#"{"code":0,"data":[{"id":1}]}"#, options: ["path": "data"]).primary?.value, "id\n1")
    }
}
