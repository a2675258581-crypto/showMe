import XCTest
@testable import ShowMeCore

final class ConvertBaseTests: XCTestCase {
    func value(_ raw: String, _ base: Int, anyPrefix: Bool = false) throws -> String {
        guard let p = try BaseConverter.parse(raw, base: base, acceptAnyPrefix: anyPrefix || base == 10) else { return "nil" }
        return BaseConverter.format(p.value, base: 10)
    }

    func error(_ raw: String, _ base: Int, lang: Lang = .zh) -> ToolError? {
        do {
            _ = try BaseConverter.parse(raw, base: base, acceptAnyPrefix: base == 10, lang: lang)
            return nil
        } catch {
            return error as? ToolError
        }
    }

    func testParseVectors() throws {
        let cases: [(String, Int, String)] = [
            ("255", 10, "255"), ("ff", 16, "255"), ("FF", 16, "255"), ("377", 8, "255"), ("11111111", 2, "255"),
            ("73", 36, "255"), ("zz", 36, "1295"), ("0", 2, "0"), ("-42", 10, "-42"), ("+42", 10, "42"), ("−7", 10, "-7"),
            ("0xFF", 16, "255"), ("0b1010", 2, "10"), ("0o17", 8, "15"), ("-0x10", 16, "-16"),
            ("0b11", 10, "3"), ("0O10", 10, "8"), ("0b1", 16, "177"), ("0x", 36, "33"),
            ("1111_0000 1010", 2, "3850"), ("1,000,000", 10, "1000000"), ("0xdead'beef", 16, "3735928559"), ("  12 34  ", 10, "1234"),
            ("１２３", 10, "123"), ("－４２", 10, "-42"), ("ＦＦ", 16, "255"), ("０ｘ１Ｆ", 10, "31"), ("1\u{3000}2", 10, "12"),
        ]
        for (raw, base, expected) in cases {
            XCTAssertEqual(try value(raw, base), expected, "\(raw) in base \(base)")
        }
        let r = try BaseConverter.parse("0x1f", base: 10, acceptAnyPrefix: true)
        XCTAssertEqual(r?.base, 16)
        XCTAssertNil(try BaseConverter.parse("   ", base: 2))
    }

    func testErrors() {
        XCTAssertEqual(error("1021", 2)?.message, "第 3 个字符「2」不是有效的二进制数字（只能是 0 和 1）")
        XCTAssertEqual(error("1021", 2)?.column, 3)
        let e2 = error("12g4h", 16)?.message ?? ""
        XCTAssertTrue(e2.contains("「g」不是有效的十六进制数字（只能是 0–9、A–F）"))
        XCTAssertTrue(e2.contains("共 2 处"))
        XCTAssertTrue(error("0x1f", 2)?.message.contains("十六进制") ?? false)
        XCTAssertTrue(error("12-3", 10)?.message.contains("正负号只能写在最前面") ?? false)
        XCTAssertEqual(error("0x", 16)?.message, "前缀后面缺少数字")
        XCTAssertEqual(error("-", 10)?.message, "请输入数字")
        XCTAssertEqual(error("1😀2😀", 10)?.message, "第 2 个字符「😀」不是有效的十进制数字（只能是 0–9），共 2 处无效字符")
        XCTAssertEqual(error("中文", 10)?.message, "第 1 个字符「中」不是有效的十进制数字（只能是 0–9），共 2 处无效字符")
        XCTAssertTrue(error("１Ｇ", 16)?.message.contains("第 2 个字符「Ｇ」") ?? false)
        XCTAssertTrue(error("1", 37)?.message.contains("2–36") ?? false)
        XCTAssertTrue(error(String(repeating: "1", count: 100_001), 10)?.message.contains("输入过长") ?? false)
        XCTAssertEqual(error("12x", 10, lang: .en)?.message, "Character 3 “x” is not a valid decimal digit (only 0–9)")
    }

    func testHugeNumbersRoundTrip() throws {
        // 2^4000 - 12345
        var big = BigUInt(1)
        for _ in 0..<4000 { big.multiply(by: 2) }
        big.subtract(12345)
        for b in [2, 3, 7, 8, 10, 16, 20, 36] {
            let text = big.toString(radix: b)
            let back = try BaseConverter.parse(text, base: b)
            XCTAssertEqual(back?.value.magnitude, big, "base \(b)")
        }
        XCTAssertEqual(big.bitWidth, 4000)
        // 18446744073709551615 = 2^64 - 1
        XCTAssertEqual(try BaseConverter.parse("18446744073709551615", base: 10)?.value.magnitude.toString(radix: 16), "ffffffffffffffff")
        XCTAssertEqual(try BaseConverter.parse("18446744073709551616", base: 10)?.value.magnitude.toString(radix: 16), "10000000000000000")
    }

    func testFormatting() throws {
        func f(_ s: String, _ base: Int, upper: Bool = false, group: Bool = false, sep: String = " ") throws -> String {
            let v = try XCTUnwrap(try BaseConverter.parse(s, base: 10)).value
            return BaseConverter.format(v, base: base, uppercase: upper, group: group, separator: sep)
        }
        XCTAssertEqual(try f("255", 16), "ff")
        XCTAssertEqual(try f("255", 16, upper: true), "FF")
        XCTAssertEqual(try f("-255", 2, group: true), "-1111 1111")
        XCTAssertEqual(try f("1234567", 10, group: true), "1 234 567")
        XCTAssertEqual(try f("1234567", 10, group: true, sep: ","), "1,234,567")
        XCTAssertEqual(try f("0", 2, group: true), "0")
        XCTAssertEqual(BaseConverter.groupDigits("10101", size: 4), "1 0101")
        XCTAssertEqual(BaseConverter.groupDigits("1010", size: 4), "1010")
        XCTAssertEqual(BaseConverter.groupDigits("", size: 4), "")
        let v = try XCTUnwrap(try BaseConverter.parse("-98765432109876543210", base: 10)).value
        for b in [2, 8, 10, 16, 36] {
            let text = BaseConverter.format(v, base: b, uppercase: true, group: true)
            XCTAssertEqual(try BaseConverter.parse(text, base: b)?.value, v, "base \(b)")
        }
    }

    func testBitHelpers() throws {
        func v(_ s: String) throws -> BaseConverter.Value { try XCTUnwrap(try BaseConverter.parse(s, base: 10)).value }
        XCTAssertEqual(BaseConverter.minSignedBits(try v("0")), 1)
        XCTAssertEqual(BaseConverter.minSignedBits(try v("127")), 8)
        XCTAssertEqual(BaseConverter.minSignedBits(try v("128")), 9)
        XCTAssertEqual(BaseConverter.minSignedBits(try v("-128")), 8)
        XCTAssertEqual(BaseConverter.minSignedBits(try v("-129")), 9)
        XCTAssertEqual(BaseConverter.minSignedBits(try v("-1")), 1)
        XCTAssertEqual(BaseConverter.twosComplement(try v("-1"))?.binary, "11111111")
        XCTAssertEqual(BaseConverter.twosComplement(try v("-128"))?.binary, "10000000")
        XCTAssertEqual(BaseConverter.twosComplement(try v("-129"))?.bits, 16)
        XCTAssertEqual(BaseConverter.twosComplement(try v("-2147483649"))?.hex, "FFFFFFFF7FFFFFFF")
        XCTAssertEqual(BaseConverter.twosComplement(try v("-9223372036854775808"))?.hex, "8000000000000000")
        XCTAssertNil(BaseConverter.twosComplement(try v("-9223372036854775809")))
        XCTAssertEqual(BaseConverter.allowedDigits(36, .zh), "0–9、A–Z")
        XCTAssertEqual(BaseConverter.allowedDigits(8, .zh), "0–7")
    }

    func testTool() throws {
        let tool = BaseConverterTool.spec
        let r = try tool("0xFF")
        XCTAssertEqual(r.primary?.id, "dec")
        XCTAssertEqual(r.primary?.value, "255")
        XCTAssertEqual(r.outputs.first { $0.id == "bin" }?.value, "11111111")
        XCTAssertEqual(r.outputs.first { $0.id == "oct" }?.value, "377")
        XCTAssertEqual(r.outputs.first { $0.id == "base36" }?.value, "73")
        XCTAssertEqual(r.notes.first?.message, "按十六进制解析")
        XCTAssertTrue(r.outputs.first { $0.id == "info" }?.value.contains("位长度 8 位") ?? false)

        let dec = try tool("3735928559", options: ["group": "1"], lang: .en)
        XCTAssertEqual(dec.primary?.id, "hex")
        XCTAssertEqual(dec.primary?.label, "Hexadecimal")
        XCTAssertEqual(dec.primary?.value, "DEAD BEEF")

        let neg = try tool("-1", options: ["uppercase": "0"])
        XCTAssertEqual(neg.primary?.value, "-1")
        XCTAssertEqual(neg.outputs.first { $0.id == "twos" }?.value, "1111 1111 · 0xFF")

        let custom = try tool("zz", options: ["from": "custom", "fromBase": "36", "toBase": "16"])
        XCTAssertEqual(custom.primary?.value, "1295")
        XCTAssertNil(custom.outputs.first { $0.id == "base16" })

        let lines = try tool("1\n\n10\n255", options: ["from": "16"])
        XCTAssertEqual(lines.primary?.value, "1\n16\n597")

        XCTAssertThrowsError(try tool("12\n1x", options: ["from": "10"])) { e in
            XCTAssertEqual((e as? ToolError)?.line, 2)
            XCTAssertEqual((e as? ToolError)?.column, 2)
        }
        XCTAssertEqual(try tool("101", options: ["from": "2"], lang: .en).primary?.value, "5")
    }
}
