import Foundation

public enum ColorConverterTool {
    public static let spec = ToolSpec(
        id: "color-converter",
        name: LocalizedText("颜色转换", "Color Converter"),
        summary: LocalizedText(
            "HEX、RGB、HSL、OKLCH 互转，取色、生成色阶并检查对比度。",
            "Convert between HEX, RGB, HSL, OKLCH and more, and check WCAG contrast."
        ),
        category: .convert,
        keywords: ["color", "hex", "rgb", "hsl", "oklch", "contrast", "palette", "颜色", "取色", "yszh"],
        symbol: "paintpalette",
        input: .required,
        inputLabel: LocalizedText("颜色（HEX、rgb()、hsl()、oklch()、颜色名……）", "Color (HEX, rgb(), hsl(), oklch(), name…)"),
        fields: [
            ToolField("uppercase", LocalizedText("HEX 大写", "Uppercase HEX"), .toggle, default: "0"),
            ToolField("legacy", LocalizedText("逗号语法 rgba()", "Comma syntax rgba()"), .toggle, default: "0"),
            ToolField("background", LocalizedText("对比背景色", "Contrast against"), .text(placeholder: LocalizedText("可选，如 #f5f5f7", "Optional, e.g. #f5f5f7")),
                      help: LocalizedText("除白色、黑色外，再计算与这个颜色的对比度", "Also check contrast against this color, besides white and black")),
        ],
        run: { try run($0) }
    )

    static func formatName(_ f: ColorConverter.Format, _ lang: Lang) -> String {
        switch f {
        case .hex: "HEX"
        case .named: lang.t("颜色名", "color name")
        case .rgb: "RGB"
        case .hsl: "HSL"
        case .hwb: "HWB"
        case .lab: "CIE Lab"
        case .lch: "CIE LCH"
        case .oklab: "OKLab"
        case .oklch: "OKLCH"
        case .color: "color()"
        case .transparent: lang.t("透明", "transparent")
        }
    }

    static func contrastLine(_ fg: ColorConverter.RGBA, _ bg: ColorConverter.RGBA, _ lang: Lang) -> String {
        let w = ColorConverter.wcag(fg, bg)
        func mark(_ ok: Bool) -> String { ok ? "✓" : "✗" }
        let ratio = String(format: "%.2f", w.ratio)
        return lang.t(
            "\(ratio) : 1 · AA 正文 \(mark(w.aaNormal)) · AA 大字 \(mark(w.aaLarge)) · AAA 正文 \(mark(w.aaaNormal)) · AAA 大字 \(mark(w.aaaLarge))",
            "\(ratio) : 1 · AA normal \(mark(w.aaNormal)) · AA large \(mark(w.aaLarge)) · AAA normal \(mark(w.aaaNormal)) · AAA large \(mark(w.aaaLarge))"
        )
    }

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let parsed = try ColorConverter.parse(input.text, lang: lang)
        let info = ColorConverter.describe(parsed, uppercase: input.bool("uppercase"), legacy: input.bool("legacy"))
        let f = info.formats
        let translucent = info.rgb.alpha < 1
        // 主输出：输入是 HEX 时给 RGB，否则给 HEX（有透明度时用 8 位）
        let primaryID = parsed.format == .hex ? "rgb" : (translucent ? "hex8" : "hex")
        let rows: [(String, String, String)] = [
            ("hex", "HEX", f.hex), ("hex8", lang.t("HEX8（含透明度）", "HEX8 (with alpha)"), f.hex8), ("rgb", "RGB", f.rgb),
            ("hsl", "HSL", f.hsl), ("hsv", "HSV / HSB", f.hsv), ("hwb", "HWB", f.hwb), ("oklch", "OKLCH", f.oklch),
            ("oklab", "OKLab", f.oklab), ("lab", "CIE Lab", f.lab), ("lch", "CIE LCH", f.lch),
            ("cmyk", lang.t("CMYK（近似）", "CMYK (approx.)"), f.cmyk),
        ]
        var outputs = rows.map { ToolOutput(id: $0.0, label: $0.1, value: $0.2, isPrimary: $0.0 == primaryID) }
        outputs = outputs.filter(\.isPrimary) + outputs.filter { !$0.isPrimary }

        let nameText: String
        if let n = info.name {
            nameText = n
        } else {
            nameText = lang.t("最接近：\(info.nearest.name)（ΔE \(ColorConverter.fmt(info.nearest.distance * 100, 1))）",
                              "Closest: \(info.nearest.name) (ΔE \(ColorConverter.fmt(info.nearest.distance * 100, 1)))")
        }
        outputs.append(ToolOutput(id: "name", label: lang.t("颜色名", "Name"), value: nameText, style: .prose))
        outputs.append(ToolOutput(id: "contrastWhite", label: lang.t("与白色对比度", "Contrast on white"),
                                  value: contrastLine(info.rgb, ColorConverter.white, lang), style: .prose))
        outputs.append(ToolOutput(id: "contrastBlack", label: lang.t("与黑色对比度", "Contrast on black"),
                                  value: contrastLine(info.rgb, ColorConverter.black, lang), style: .prose))

        var notes: [ToolNote] = [ToolNote(.info, lang.t("识别为 ", "Recognized as ") + formatName(parsed.format, lang))]
        let bgText = input.string("background").trimmingCharacters(in: .whitespacesAndNewlines)
        if !bgText.isEmpty {
            do {
                let bg = ColorConverter.gamutMap(try ColorConverter.parse(bgText, lang: lang).rgb)
                outputs.append(ToolOutput(id: "contrastCustom", label: lang.t("与 \(bgText) 对比度", "Contrast on \(bgText)"),
                                          value: contrastLine(info.rgb, bg, lang), style: .prose))
            } catch let e as ToolError {
                notes.append(ToolNote(.warning, lang.t("对比背景色无效：", "Invalid contrast color: ") + e.message))
            }
        }
        if !info.inGamut {
            notes.append(ToolNote(.warning, lang.t(
                "该颜色超出 sRGB 色域，HEX / RGB 等为映射后的近似值",
                "This color is outside the sRGB gamut; HEX, RGB and similar values are gamut-mapped approximations"
            )))
        }
        notes.append(ToolNote(.info, ColorConverter.readableOnWhite(info.rgb)
            ? lang.t("在这个颜色上，白色文字更易读", "White text reads better on this color")
            : lang.t("在这个颜色上，黑色文字更易读", "Black text reads better on this color")))
        return ToolResult(outputs: outputs, notes: notes)
    }
}
