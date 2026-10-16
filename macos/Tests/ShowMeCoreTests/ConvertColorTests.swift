import XCTest
@testable import ShowMeCore

final class ConvertColorTests: XCTestCase {
    typealias C = ColorConverter

    func rgb(_ s: String, file: StaticString = #filePath, line: UInt = #line) -> C.RGBA {
        do { return try C.parse(s).rgb } catch {
            XCTFail("\(s): \(error)", file: file, line: line)
            return C.black
        }
    }

    func hex(_ s: String) -> String {
        let c = rgb(s)
        return C.toHex(C.gamutMap(c), withAlpha: c.alpha < 1)
    }

    func err(_ s: String, lang: Lang = .zh) -> String {
        do {
            _ = try C.parse(s, lang: lang)
            return "no error"
        } catch {
            return (error as? ToolError)?.message ?? "\(error)"
        }
    }

    func info(_ s: String, uppercase: Bool = false, legacy: Bool = false) throws -> C.Info {
        C.describe(try C.parse(s), uppercase: uppercase, legacy: legacy)
    }

    func testParseVectors() {
        let cases: [(String, String)] = [
            ("#f00", "#ff0000"), ("#F00", "#ff0000"), ("#ff000080", "#ff000080"), ("#f008", "#ff000088"), ("ff8800", "#ff8800"),
            ("red", "#ff0000"), ("RebeccaPurple", "#663399"), ("rgb(255, 0, 0)", "#ff0000"), ("rgba(255,0,0,0.5)", "#ff000080"),
            ("rgb(255 0 0 / 50%)", "#ff000080"), ("rgb(100% 0% 0%)", "#ff0000"), ("rgb(300 -20 0)", "#ff0000"),
            ("rgb(none 128 0)", "#008000"), ("255, 136, 0", "#ff8800"), ("hsl(120, 100%, 25%)", "#008000"),
            ("hsl(120deg 100% 25%)", "#008000"), ("hsl(120 100 25)", "#008000"), ("hsla(0, 100%, 50%, .25)", "#ff000040"),
            ("hsl(0.5turn 100% 50%)", "#00ffff"), ("hsl(3.14159rad 100% 50%)", "#00ffff"), ("hsl(200grad 100% 50%)", "#00ffff"),
            ("hwb(0 0% 0%)", "#ff0000"), ("hwb(0 50% 50%)", "#808080"), ("hwb(120 20% 30%)", "#33b333"),
            ("lab(54.29% 80.8 69.89)", "#ff0000"), ("lab(100 0 0)", "#ffffff"), ("lch(54.29 106.84 40.85)", "#ff0000"),
            ("oklab(0.62796 0.22486 0.12585)", "#ff0000"), ("oklab(62.796% 56.2% 31.46%)", "#ff0000"),
            ("oklch(0.62796 0.25768 29.23)", "#ff0000"), ("oklch(62.8% 0.2577 29.23 / 0.5)", "#ff000080"),
            ("oklch(1 0 0)", "#ffffff"), ("oklch(0 0 0)", "#000000"), ("color(srgb 1 0.5 0)", "#ff8000"),
            ("color(srgb-linear 1 0.2159 0)", "#ff8000"), ("color(display-p3 0.5 0.5 0.5)", "#808080"),
            ("color(xyz-d65 0.9505 1 1.089)", "#ffffff"), ("transparent", "#00000000"), ("  #abc;  ", "#aabbcc"),
            ("fff", "#ffffff"), ("F00A", "#ff0000aa"), ("color: red;", "#ff0000"), ("color: rgb(255 0 0) !important;", "#ff0000"),
            ("background-color:#0071e3", "#0071e3"), ("--brand: oklch(62.8% 0.2577 29.23)", "#ff0000"), ("color(srgb 1 0 0)", "#ff0000"),
        ]
        for (input, expected) in cases {
            XCTAssertEqual(hex(input), expected, input)
        }
        XCTAssertEqual(NamedColors.list.count, 148)
        for (name, value) in NamedColors.list {
            XCTAssertEqual(hex(name), "#" + value, name)
        }
        XCTAssertEqual(try C.parse("navy").format, .named)
        XCTAssertEqual(try C.parse("hsla(0,0%,0%,1)").format, .hsl)
        XCTAssertEqual(try C.parse("oklch(0.5 0.1 200)").format, .oklch)
    }

    func testErrors() {
        XCTAssertEqual(err(""), "请输入颜色")
        XCTAssertEqual(err("", lang: .en), "Enter a color")
        XCTAssertTrue(err("#12345").contains("3、4、6 或 8 位，实际是 5 位"))
        XCTAssertTrue(err("#ggg").contains("「g」不是十六进制数字"))
        XCTAssertTrue(err("rgb(255 0)").contains("需要 3 个分量（红、绿、蓝）"))
        XCTAssertTrue(err("rgb(255 0 abc)").contains("蓝「abc」不是有效的数值"))
        XCTAssertTrue(err("rgb(255, 0%, 0)").contains("不能混用数字和百分比"))
        XCTAssertTrue(err("hsl(10%, 50%, 50%)").contains("色相「10%」不能使用百分比"))
        XCTAssertTrue(err("hsl(10, 50, 50)").contains("需要带 %"))
        XCTAssertTrue(err("hwb(10, 50%, 50%)").contains("不支持逗号分隔"))
        XCTAssertTrue(err("rgb(1 2 3 / )").contains("缺少透明度"))
        XCTAssertTrue(err("rgb(1 2 3 / x)").contains("透明度「x」无效"))
        XCTAssertEqual(err("rgb(1 2 3"), "缺少右括号「)」")
        XCTAssertEqual(err("rgb(1 2 3) foo"), "右括号「)」后面有多余的内容「foo」")
        XCTAssertEqual(err("rgb(1 2 3))"), "右括号「)」后面有多余的内容「)」")
        XCTAssertTrue(err("rgb(calc(255) 0 0)").contains("不支持嵌套函数"))
        XCTAssertTrue(err("foo(1 2 3)").contains("不支持的颜色函数「foo()」"))
        XCTAssertTrue(err("color(rec2020 1 0 0)").contains("不支持的色彩空间"))
        XCTAssertTrue(err("bleu").contains("是不是想输入「blue」"))
        XCTAssertTrue(err("bleu", lang: .en).contains("did you mean “blue”"))
        XCTAssertTrue(err("颜色").contains("无法识别「颜色」"))
        XCTAssertTrue(err("🎨").contains("无法识别"))
        XCTAssertEqual(C.suggestName("grean"), "green")
        XCTAssertEqual(C.suggestName("rebecca"), "rebeccapurple")
        XCTAssertNil(C.suggestName("zzzzzzzz"))
    }

    func testFormats() throws {
        let f = try info("#ff0000").formats
        XCTAssertEqual(f.hex, "#ff0000")
        XCTAssertEqual(f.hex8, "#ff0000ff")
        XCTAssertEqual(f.rgb, "rgb(255 0 0)")
        XCTAssertEqual(f.hsl, "hsl(0 100% 50%)")
        XCTAssertEqual(f.hsv, "hsv(0, 100%, 100%)")
        XCTAssertEqual(f.hwb, "hwb(0 0% 0%)")
        XCTAssertEqual(f.cmyk, "cmyk(0%, 100%, 100%, 0%)")
        XCTAssertEqual(f.oklch, "oklch(62.8% 0.25768 29.23)")
        XCTAssertEqual(f.oklab, "oklab(62.8% 0.22486 0.12585)")
        XCTAssertEqual(f.lab, "lab(54.29% 80.8 69.89)")
        XCTAssertTrue(["lch(54.29% 106.84 40.85)", "lch(54.29% 106.83 40.86)", "lch(54.29% 106.84 40.86)", "lch(54.29% 106.83 40.85)"].contains(f.lch), f.lch)

        let l = try info("rgb(0 113 227 / 50%)", uppercase: true, legacy: true).formats
        XCTAssertEqual(l.hex, "#0071E3")
        XCTAssertEqual(l.hex8, "#0071E380")
        XCTAssertEqual(l.rgb, "rgba(0, 113, 227, 0.5)")
        XCTAssertTrue(l.hsl.hasPrefix("hsla("))
        XCTAssertEqual(try info("rgb(0 113 227 / 50%)").formats.rgb, "rgb(0 113 227 / 50%)")
        XCTAssertEqual(try info("#0071e380").formats.rgb, "rgb(0 113 227 / 50.2%)")

        let w = try info("white").formats
        XCTAssertEqual(w.hsl, "hsl(0 0% 100%)")
        XCTAssertEqual(w.oklch, "oklch(100% 0 0)")
        XCTAssertEqual(w.cmyk, "cmyk(0%, 0%, 0%, 0%)")
        XCTAssertEqual(try info("black").formats.cmyk, "cmyk(0%, 0%, 0%, 100%)")
        XCTAssertEqual(try info("#808080").formats.hsv, "hsv(0, 0%, 50.2%)")
        let gray = try info("lab(50% 0 0)").formats
        XCTAssertEqual(gray.hsl, "hsl(0 0% 46.6%)")
        XCTAssertEqual(gray.hwb, "hwb(0 46.6% 53.4%)")
        XCTAssertEqual(try info("lab(100 0 0)").formats.hsl, "hsl(0 0% 100%)")
        let nearRed = C.describe(C.Parsed(rgb: C.RGBA(1, 0, 0.0001, 1), format: .rgb))
        XCTAssertTrue(nearRed.formats.hsl.hasPrefix("hsl(0 "))
        XCTAssertEqual(try info("#663399").name, "rebeccapurple")
        XCTAssertNil(try info("#663398").name)
        XCTAssertEqual(C.nearestNamed(rgb("#fe0101")).name, "red")
        let lab = C.rgbToLab(C.white)
        XCTAssertEqual(lab.l, 100, accuracy: 1e-3)
        XCTAssertEqual(lab.a, 0, accuracy: 1e-3)
    }

    func testRoundTripThroughEveryFormat() throws {
        var seed: UInt32 = 42
        func rand() -> Double {
            seed = seed &* 1_664_525 &+ 1_013_904_223
            return Double(seed) / 4_294_967_296
        }
        for _ in 0..<600 {
            let c = C.RGBA(rand(), rand(), rand(), 1)
            let h = C.toHex(c)
            let f = try info(h).formats
            for text in [f.rgb, f.hsl, f.hwb, f.oklch, f.oklab, f.lab, f.lch] {
                XCTAssertEqual(C.toHex(rgb(text)), h, "\(h) \(text)")
            }
        }
        for h in ["#0af26f", "#03c29e", "#00c384", "#09f7a9"] {
            XCTAssertEqual(C.toHex(rgb(try info(h).formats.oklch)), h)
            XCTAssertEqual(C.toHex(rgb(try info(h).formats.oklab)), h)
        }
    }

    func testGamutMapping() throws {
        let wide = rgb("oklch(0.7 0.4 150)")
        XCTAssertFalse(C.inGamut(wide))
        let mapped = C.gamutMap(wide)
        XCTAssertTrue(C.inGamut(mapped))
        XCTAssertLessThan(abs(C.rgbToOklch(mapped).h - 150), 6)
        let d = try info("oklch(0.7 0.4 150)")
        XCTAssertFalse(d.inGamut)
        XCTAssertEqual(d.formats.oklch, "oklch(70% 0.4 150)")
        XCTAssertFalse(try info("color(display-p3 0 1 0)").inGamut)
        let p3red = C.gamutMap(rgb("color(display-p3 1 0 0)"))
        XCTAssertEqual(p3red.r, 1, accuracy: 1e-3)
        XCTAssertLessThan(p3red.g, 0.08)
        XCTAssertEqual(C.toHex(C.gamutMap(rgb("oklch(1.2 0.3 20)"))), "#ffffff")
        XCTAssertEqual(C.toHex(C.gamutMap(rgb("lab(0 50 50)"))), "#000000")
    }

    func testContrast() {
        XCTAssertEqual(C.contrastRatio(C.white, C.black), 21, accuracy: 1e-5)
        XCTAssertEqual(C.fmt(C.contrastRatio(rgb("#777"), C.white), 2), "4.48")
        XCTAssertEqual(C.fmt(C.contrastRatio(rgb("#767676"), C.white), 2), "4.54")
        XCTAssertEqual(C.fmt(C.contrastRatio(rgb("#0071e3"), C.white), 2), "4.7")
        let r = C.wcag(rgb("#777"), C.white)
        XCTAssertEqual([r.aaNormal, r.aaLarge, r.aaaNormal, r.aaaLarge, r.ui], [false, true, false, false, true])
        let b = C.wcag(C.black, C.white)
        XCTAssertTrue(b.aaNormal && b.aaLarge && b.aaaNormal && b.aaaLarge)
        XCTAssertFalse(C.wcag(rgb("#aaa"), C.white).aaLarge)
        XCTAssertEqual(C.contrastRatio(rgb("rgb(0 0 0 / 50%)"), C.white), C.contrastRatio(rgb("#808080"), C.white), accuracy: 0.1)
        XCTAssertEqual(C.contrastRatio(rgb("transparent"), C.white), 1, accuracy: 1e-5)
        XCTAssertFalse(C.readableOnWhite(rgb("#ffcc00")))
        XCTAssertTrue(C.readableOnWhite(rgb("#1d1d1f")))
    }

    func testColorValue() {
        let v = ColorConverter.colorValue("rgb(255 0 0 / 50%)")
        XCTAssertEqual(v, ColorValue(r: 1, g: 0, b: 0, a: 0.5))
        XCTAssertNil(ColorConverter.colorValue("nope"))
        let wide = ColorConverter.colorValue("oklch(0.7 0.4 150)")
        XCTAssertNotNil(wide)
        XCTAssertTrue((0...1).contains(wide?.g ?? -1))
    }

    func testTool() throws {
        let tool = ColorConverterTool.spec
        let r = try tool("#0071e3")
        XCTAssertEqual(r.primary?.id, "rgb")
        XCTAssertEqual(r.primary?.value, "rgb(0 113 227)")
        XCTAssertEqual(r.outputs.first { $0.id == "contrastWhite" }?.value, "4.70 : 1 · AA 正文 ✓ · AA 大字 ✓ · AAA 正文 ✗ · AAA 大字 ✓")
        XCTAssertEqual(r.notes.first?.message, "识别为 HEX")
        let named = try tool("rebeccapurple", lang: .en)
        XCTAssertEqual(named.primary?.id, "hex")
        XCTAssertEqual(named.outputs.first { $0.id == "name" }?.value, "rebeccapurple")
        XCTAssertEqual(named.notes.first?.message, "Recognized as color name")
        let alpha = try tool("rgb(255 0 0 / 50%)", options: ["uppercase": "1"])
        XCTAssertEqual(alpha.primary?.value, "#FF000080")
        let bg = try tool("#777", options: ["background": "#000"])
        XCTAssertNotNil(bg.outputs.first { $0.id == "contrastCustom" })
        let badBg = try tool("#777", options: ["background": "zz"])
        XCTAssertTrue(badBg.notes.contains { $0.level == .warning })
        let wide = try tool("oklch(0.7 0.4 150)")
        XCTAssertTrue(wide.notes.contains { $0.message.contains("sRGB 色域") })
        XCTAssertThrowsError(try tool("bleu"))
    }
}
