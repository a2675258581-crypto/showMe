import Foundation

/// 可直接用来画色块的颜色：分量都在 0...1（已映射到 sRGB 色域并裁剪）
public struct ColorValue: Hashable, Sendable {
    public var r: Double
    public var g: Double
    public var b: Double
    public var a: Double

    public init(r: Double, g: Double, b: Double, a: Double = 1) {
        self.r = r
        self.g = g
        self.b = b
        self.a = a
    }
}

/// 颜色解析与转换：支持 CSS Color 4 的主要写法；超出 sRGB 色域的颜色按 CSS Color 4 的算法在 OKLCH 中压缩色度映射回来。
public enum ColorConverter {
    /// sRGB 分量 0–1（解析 lab/oklch 等时可能超出范围），alpha 0–1
    public struct RGBA: Hashable, Sendable {
        public var r: Double
        public var g: Double
        public var b: Double
        public var alpha: Double

        public init(_ r: Double, _ g: Double, _ b: Double, _ alpha: Double = 1) {
            self.r = r
            self.g = g
            self.b = b
            self.alpha = alpha
        }
    }

    public struct Lab: Hashable, Sendable {
        public var l: Double
        public var a: Double
        public var b: Double
    }

    public struct LCH: Hashable, Sendable {
        public var l: Double
        public var c: Double
        public var h: Double
    }

    public enum Format: String, Sendable {
        case hex, named, rgb, hsl, hwb, lab, lch, oklab, oklch, color, transparent
    }

    public struct Parsed: Hashable, Sendable {
        /// 未裁剪的 sRGB（可能超出 0–1）
        public var rgb: RGBA
        public var format: Format
    }

    // MARK: 色彩空间换算

    typealias Vec3 = (Double, Double, Double)
    typealias Mat3 = (Vec3, Vec3, Vec3)

    static func mul(_ m: Mat3, _ v: Vec3) -> Vec3 {
        (m.0.0 * v.0 + m.0.1 * v.1 + m.0.2 * v.2,
         m.1.0 * v.0 + m.1.1 * v.1 + m.1.2 * v.2,
         m.2.0 * v.0 + m.2.1 * v.1 + m.2.2 * v.2)
    }

    static func sign(_ v: Double) -> Double { v > 0 ? 1 : v < 0 ? -1 : 0 }

    static func toLinear(_ c: Double) -> Double {
        let a = abs(c)
        return a <= 0.04045 ? c / 12.92 : sign(c) * pow((a + 0.055) / 1.055, 2.4)
    }

    static func toGamma(_ c: Double) -> Double {
        let a = abs(c)
        return a > 0.0031308 ? sign(c) * (1.055 * pow(a, 1 / 2.4) - 0.055) : 12.92 * c
    }

    static let linSrgbToXyz: Mat3 = (
        (0.41239079926595934, 0.357584339383878, 0.1804807884018343),
        (0.21263900587151027, 0.715168678767756, 0.07219231536073371),
        (0.01933081871559182, 0.11919477979462598, 0.9505321522496607)
    )
    static let xyzToLinSrgb: Mat3 = (
        (3.2409699419045226, -1.537383177570094, -0.4986107602930034),
        (-0.9692436362808796, 1.8759675015077202, 0.04155505740717559),
        (0.05563007969699366, -0.20397695888897652, 1.0569715142428786)
    )
    static let linP3ToXyz: Mat3 = (
        (0.4865709486482162, 0.26566769316909306, 0.1982172852343625),
        (0.2289745640697488, 0.6917385218365064, 0.079286914093745),
        (0, 0.04511338185890264, 1.043944368900976)
    )
    static let d65ToD50: Mat3 = (
        (1.0479298208405488, 0.022946793341019088, -0.05019222954313557),
        (0.029627815688159344, 0.990434484573249, -0.01707382502938514),
        (-0.009243058152591178, 0.015055144896577895, 0.7518742899580008)
    )
    static let d50ToD65: Mat3 = (
        (0.9554734527042182, -0.023098536874261423, 0.0632593086610217),
        (-0.028369706963208136, 1.0099954580058226, 0.021041398966943008),
        (0.012314001688319899, -0.020507696433477912, 1.3303659366080753)
    )
    static let d50White: Vec3 = (0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585)
    static let labE = 216.0 / 24389
    static let labK = 24389.0 / 27

    static func linToRgb(_ v: Vec3, _ alpha: Double) -> RGBA { RGBA(toGamma(v.0), toGamma(v.1), toGamma(v.2), alpha) }
    static func rgbToLin(_ c: RGBA) -> Vec3 { (toLinear(c.r), toLinear(c.g), toLinear(c.b)) }

    public static func rgbToOklab(_ c: RGBA) -> Lab {
        let (r, g, b) = rgbToLin(c)
        let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        return Lab(
            l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
        )
    }

    public static func oklabToRgb(_ lab: Lab, _ alpha: Double = 1) -> RGBA {
        let l0 = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b
        let m0 = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b
        let s0 = lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b
        let (l, m, s) = (l0 * l0 * l0, m0 * m0 * m0, s0 * s0 * s0)
        return linToRgb((
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
        ), alpha)
    }

    static func normHue(_ h: Double) -> Double {
        let r = h.truncatingRemainder(dividingBy: 360)
        return (r + 360).truncatingRemainder(dividingBy: 360)
    }

    public static func oklabToOklch(_ lab: Lab) -> LCH {
        let c = hypot(lab.a, lab.b)
        let h = c < 1e-6 ? 0 : normHue(atan2(lab.b, lab.a) * 180 / .pi)
        return LCH(l: lab.l, c: c, h: h)
    }

    public static func oklchToOklab(_ lch: LCH) -> Lab {
        let rad = lch.h * .pi / 180
        return Lab(l: lch.l, a: lch.c * cos(rad), b: lch.c * sin(rad))
    }

    public static func rgbToOklch(_ c: RGBA) -> LCH { oklabToOklch(rgbToOklab(c)) }
    public static func oklchToRgb(_ lch: LCH, _ alpha: Double = 1) -> RGBA { oklabToRgb(oklchToOklab(lch), alpha) }

    public static func rgbToLab(_ c: RGBA) -> Lab {
        let xyz = mul(d65ToD50, mul(linSrgbToXyz, rgbToLin(c)))
        func f(_ v: Double, _ white: Double) -> Double {
            let t = v / white
            return t > labE ? cbrt(t) : (labK * t + 16) / 116
        }
        let fx = f(xyz.0, d50White.0), fy = f(xyz.1, d50White.1), fz = f(xyz.2, d50White.2)
        return Lab(l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz))
    }

    public static func labToRgb(_ lab: Lab, _ alpha: Double = 1) -> RGBA {
        let fy = (lab.l + 16) / 116
        let fx = lab.a / 500 + fy
        let fz = fy - lab.b / 200
        let x3 = fx * fx * fx, z3 = fz * fz * fz
        let xyz: Vec3 = (
            (x3 > labE ? x3 : (116 * fx - 16) / labK) * d50White.0,
            (lab.l > labK * labE ? fy * fy * fy : lab.l / labK) * d50White.1,
            (z3 > labE ? z3 : (116 * fz - 16) / labK) * d50White.2
        )
        return linToRgb(mul(xyzToLinSrgb, mul(d50ToD65, xyz)), alpha)
    }

    public static func labToLch(_ lab: Lab) -> LCH {
        let c = hypot(lab.a, lab.b)
        return LCH(l: lab.l, c: c, h: c < 1e-4 ? 0 : normHue(atan2(lab.b, lab.a) * 180 / .pi))
    }

    /// s、l 为 0–1
    public static func hslToRgb(_ h: Double, _ s: Double, _ l: Double, _ alpha: Double = 1) -> RGBA {
        func f(_ n: Double) -> Double {
            let k = (n + h / 30).truncatingRemainder(dividingBy: 12)
            let a = s * min(l, 1 - l)
            return l - a * max(-1, min(k - 3, 9 - k, 1))
        }
        return RGBA(f(0), f(8), f(4), alpha)
    }

    /// 小于它的色差视为浮点噪声，不能因此算出随机色相或 100% 饱和度
    static let achromaticEps = 1e-5

    public static func rgbToHsl(_ c: RGBA) -> (h: Double, s: Double, l: Double) {
        let mx = max(c.r, c.g, c.b)
        let mn = min(c.r, c.g, c.b)
        let d = mx - mn
        let l = (mx + mn) / 2
        var h = 0.0
        var s = 0.0
        if d > achromaticEps {
            let denom = min(l, 1 - l)
            s = denom <= achromaticEps ? 0 : min(1, (mx - l) / denom)
            if mx == c.r { h = (c.g - c.b) / d + (c.g < c.b ? 6 : 0) }
            else if mx == c.g { h = (c.b - c.r) / d + 2 }
            else { h = (c.r - c.g) / d + 4 }
            h *= 60
        }
        return (normHue(h), s, l)
    }

    public static func rgbToHsv(_ c: RGBA) -> (h: Double, s: Double, v: Double) {
        let mx = max(c.r, c.g, c.b)
        let mn = min(c.r, c.g, c.b)
        let h = rgbToHsl(c).h
        return (h, mx <= achromaticEps || mx - mn <= achromaticEps ? 0 : (mx - mn) / mx, mx)
    }

    public static func hwbToRgb(_ h: Double, _ w: Double, _ bl: Double, _ alpha: Double = 1) -> RGBA {
        if w + bl >= 1 {
            let gray = w / (w + bl)
            return RGBA(gray, gray, gray, alpha)
        }
        let base = hslToRgb(h, 1, 0.5)
        func f(_ v: Double) -> Double { v * (1 - w - bl) + w }
        return RGBA(f(base.r), f(base.g), f(base.b), alpha)
    }

    public static func rgbToHwb(_ c: RGBA) -> (h: Double, w: Double, b: Double) {
        (rgbToHsl(c).h, min(c.r, c.g, c.b), 1 - max(c.r, c.g, c.b))
    }

    public static func rgbToCmyk(_ c: RGBA) -> (c: Double, m: Double, y: Double, k: Double) {
        let k = 1 - max(c.r, c.g, c.b)
        if k >= 1 - 1e-9 { return (0, 0, 0, 1) }
        return ((1 - c.r - k) / (1 - k), (1 - c.g - k) / (1 - k), (1 - c.b - k) / (1 - k), k)
    }

    // MARK: 色域

    static let gamutEps = 1e-5

    public static func inGamut(_ c: RGBA) -> Bool {
        [c.r, c.g, c.b].allSatisfy { $0 >= -gamutEps && $0 <= 1 + gamutEps }
    }

    static func clamp01(_ v: Double) -> Double { v.isNaN ? 0 : min(1, max(0, v)) }

    public static func clip(_ c: RGBA) -> RGBA { RGBA(clamp01(c.r), clamp01(c.g), clamp01(c.b), clamp01(c.alpha)) }

    public static func deltaEOK(_ a: Lab, _ b: Lab) -> Double {
        let dl = a.l - b.l, da = a.a - b.a, db = a.b - b.b
        return (dl * dl + da * da + db * db).squareRoot()
    }

    /// CSS Color 4 色域映射：在 OKLCH 中二分降低色度，直到裁剪误差低于 JND
    public static func gamutMap(_ c: RGBA) -> RGBA {
        if inGamut(c) { return clip(c) }
        let origin = rgbToOklch(c)
        if origin.l >= 1 - 1e-6 { return RGBA(1, 1, 1, clamp01(c.alpha)) }
        if origin.l <= 1e-6 { return RGBA(0, 0, 0, clamp01(c.alpha)) }
        let jnd = 0.02
        let eps = 0.0001
        var lo = 0.0
        var hi = origin.c
        var minInGamut = true
        var current = origin
        var clipped = clip(oklchToRgb(current, c.alpha))
        if deltaEOK(rgbToOklab(clipped), oklchToOklab(current)) < jnd { return clipped }
        var guardCount = 0
        while hi - lo > eps, guardCount < 200 {
            guardCount += 1
            current.c = (lo + hi) / 2
            let rgb = oklchToRgb(current, c.alpha)
            if minInGamut && inGamut(rgb) {
                lo = current.c
                continue
            }
            clipped = clip(rgb)
            let e = deltaEOK(rgbToOklab(clipped), oklchToOklab(current))
            if e < jnd {
                if jnd - e < eps { return clipped }
                minInGamut = false
                lo = current.c
            } else {
                hi = current.c
            }
        }
        return clipped
    }

    // MARK: 解析

    static func parseHex(_ hex: String, _ lang: Lang) -> Result<RGBA, ToolError> {
        let scalars = Array(hex.unicodeScalars)
        if let idx = scalars.firstIndex(where: { BaseConverter.digitValue($0).map { $0 >= 16 } ?? true }) {
            return .failure(ToolError(lang.t(
                "「\(scalars[idx])」不是十六进制数字（第 \(idx + 2) 个字符）",
                "“\(scalars[idx])” is not a hex digit (character \(idx + 2))"
            )))
        }
        guard [3, 4, 6, 8].contains(scalars.count) else {
            return .failure(ToolError(lang.t(
                "HEX 颜色应为 3、4、6 或 8 位，实际是 \(scalars.count) 位",
                "A HEX color has 3, 4, 6 or 8 digits, not \(scalars.count)"
            )))
        }
        var digits = scalars.compactMap { BaseConverter.digitValue($0) }
        if digits.count <= 4 { digits = digits.flatMap { [$0, $0] } }
        func n(_ i: Int) -> Double { Double(digits[i] * 16 + digits[i + 1]) / 255 }
        return .success(RGBA(n(0), n(2), n(4), digits.count == 8 ? n(6) : 1))
    }

    struct Token {
        var raw: String
        var value: Double
        var unit: String
        var none: Bool
    }

    private static let tokenPattern = Pattern(#"^([+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:e[+-]?[0-9]+)?)(%|deg|rad|grad|turn)?$"#, caseInsensitive: true)

    static func parseToken(_ raw: String) -> Token? {
        if raw.lowercased() == "none" { return Token(raw: raw, value: 0, unit: "", none: true) }
        guard let m = tokenPattern.match(raw), let v = Double(m[1] ?? "") else { return nil }
        return Token(raw: raw, value: v, unit: (m[2] ?? "").lowercased(), none: false)
    }

    static func hueDeg(_ t: Token, _ lang: Lang) -> Result<Double, ToolError> {
        switch t.unit {
        case "", "deg": return .success(t.value)
        case "rad": return .success(t.value * 180 / .pi)
        case "grad": return .success(t.value * 0.9)
        case "turn": return .success(t.value * 360)
        default:
            return .failure(ToolError(lang.t(
                "色相「\(t.raw)」不能使用百分比，请用角度（如 120、120deg、0.5turn）",
                "The hue “\(t.raw)” can’t be a percentage; use an angle (e.g. 120, 120deg, 0.5turn)"
            )))
        }
    }

    static func labels(_ fn: String) -> [LocalizedText] {
        switch fn {
        case "rgb": [LocalizedText("红", "red"), LocalizedText("绿", "green"), LocalizedText("蓝", "blue")]
        case "hsl": [LocalizedText("色相", "hue"), LocalizedText("饱和度", "saturation"), LocalizedText("亮度", "lightness")]
        case "hwb": [LocalizedText("色相", "hue"), LocalizedText("白度", "whiteness"), LocalizedText("黑度", "blackness")]
        case "lab", "oklab": [LocalizedText("亮度 L", "lightness L"), LocalizedText("a", "a"), LocalizedText("b", "b")]
        case "lch", "oklch": [LocalizedText("亮度 L", "lightness L"), LocalizedText("色度 C", "chroma C"), LocalizedText("色相 H", "hue H")]
        default: [LocalizedText("分量 1", "component 1"), LocalizedText("分量 2", "component 2"), LocalizedText("分量 3", "component 3")]
        }
    }

    static let colorSpaces = ["srgb", "srgb-linear", "display-p3", "xyz", "xyz-d65", "xyz-d50"]

    static func words(_ s: String) -> [String] {
        s.split(whereSeparator: { $0.isWhitespace }).map(String.init)
    }

    static func parseFunction(_ name: String, _ body: String, _ lang: Lang) throws -> Parsed {
        var fn = name.lowercased()
        if fn == "rgba" { fn = "rgb" }
        if fn == "hsla" { fn = "hsl" }
        let legacy = body.contains(",")
        var parts: [String]
        var alphaRaw: String?
        var space: String?
        if fn == "color" {
            let pieces = body.components(separatedBy: "/")
            if pieces.count > 2 { throw ToolError(lang.t("color() 中只能有一个「/」", "color() can contain only one “/”")) }
            var w = words(pieces[0])
            space = w.isEmpty ? nil : w.removeFirst().lowercased()
            guard let sp = space, colorSpaces.contains(sp) else {
                throw ToolError(lang.t(
                    "不支持的色彩空间「\(space ?? "")」，可用：\(colorSpaces.joined(separator: "、"))",
                    "Unsupported color space “\(space ?? "")”; use one of: \(colorSpaces.joined(separator: ", "))"
                ))
            }
            parts = w
            alphaRaw = pieces.count > 1 ? pieces[1].trimmingCharacters(in: .whitespaces) : nil
            if parts.count != 3 {
                throw ToolError(lang.t("color(\(sp) …) 需要 3 个分量，实际得到 \(parts.count) 个", "color(\(sp) …) needs 3 components, got \(parts.count)"))
            }
        } else if legacy {
            if fn != "rgb" && fn != "hsl" {
                throw ToolError(lang.t("\(fn)() 不支持逗号分隔，请用空格分隔分量", "\(fn)() doesn’t accept commas; separate the components with spaces"))
            }
            if body.contains("/") { throw ToolError(lang.t("\(name)() 不能混用逗号和「/」", "\(name)() can’t mix commas and “/”")) }
            parts = body.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            if parts.count == 4 { alphaRaw = parts.removeLast() }
        } else {
            let pieces = body.components(separatedBy: "/")
            if pieces.count > 2 { throw ToolError(lang.t("\(name)() 中只能有一个「/」", "\(name)() can contain only one “/”")) }
            parts = words(pieces[0])
            if pieces.count > 1 {
                let a = pieces[1].trimmingCharacters(in: .whitespaces)
                if a.isEmpty { throw ToolError(lang.t("「/」后面缺少透明度", "The alpha after “/” is missing")) }
                alphaRaw = a
            }
        }
        let names = labels(fn)
        if parts.count != 3 {
            let list = names.map { $0(lang) }.joined(separator: lang.t("、", ", "))
            throw ToolError(lang.t(
                "\(name)() 需要 3 个分量（\(list)）\(alphaRaw == nil ? "，可选透明度" : "")，实际得到 \(parts.count) 个",
                "\(name)() needs 3 components (\(list))\(alphaRaw == nil ? " and an optional alpha" : ""), got \(parts.count)"
            ))
        }
        var tokens: [Token] = []
        for i in 0..<3 {
            guard let t = parseToken(parts[i]) else {
                throw ToolError(lang.t(
                    "\(name)() 的\(names[i].zh)「\(parts[i])」不是有效的数值",
                    "The \(names[i].en) “\(parts[i])” in \(name)() is not a valid number"
                ))
            }
            tokens.append(t)
        }
        var alpha = 1.0
        if let a = alphaRaw {
            guard let t = parseToken(a), t.unit == "" || t.unit == "%" else {
                throw ToolError(lang.t("透明度「\(a)」无效，应为 0–1 或百分比", "Invalid alpha “\(a)”: use 0–1 or a percentage"))
            }
            alpha = clamp01(t.unit == "%" ? t.value / 100 : t.value)
        }
        func pct(_ t: Token, _ scale: Double) -> Double { t.unit == "%" ? t.value / 100 * scale : t.value }
        func noAngle(_ t: Token, _ label: LocalizedText) throws {
            if t.unit != "" && t.unit != "%" {
                throw ToolError(lang.t("\(label.zh)「\(t.raw)」不能带角度单位", "The \(label.en) “\(t.raw)” can’t have an angle unit"))
            }
        }
        let (t0, t1, t2) = (tokens[0], tokens[1], tokens[2])

        switch fn {
        case "rgb":
            for (i, t) in tokens.enumerated() { try noAngle(t, names[i]) }
            if legacy && Set(tokens.map { $0.unit == "%" }).count > 1 {
                throw ToolError(lang.t("逗号写法的 rgb() 不能混用数字和百分比", "Comma-separated rgb() can’t mix numbers and percentages"))
            }
            func ch(_ t: Token) -> Double { clamp01(pct(t, 255) / 255) }
            return Parsed(rgb: RGBA(ch(t0), ch(t1), ch(t2), alpha), format: .rgb)
        case "hsl", "hwb":
            let h = try hueDeg(t0, lang).get()
            for (i, t) in [t1, t2].enumerated() {
                try noAngle(t, names[i + 1])
                if legacy && t.unit != "%" {
                    throw ToolError(lang.t("逗号写法的 hsl() 中\(names[i + 1].zh)需要带 %", "In comma-separated hsl(), the \(names[i + 1].en) needs a %"))
                }
            }
            let a = clamp01(pct(t1, 100) / 100)
            let b = clamp01(pct(t2, 100) / 100)
            let rgb = fn == "hsl" ? hslToRgb(normHue(h), a, b, alpha) : hwbToRgb(normHue(h), a, b, alpha)
            return Parsed(rgb: rgb, format: fn == "hsl" ? .hsl : .hwb)
        case "lab", "oklab":
            let ok = fn == "oklab"
            for (i, t) in tokens.enumerated() { try noAngle(t, names[i]) }
            let l = max(0, pct(t0, ok ? 1 : 100))
            let a = pct(t1, ok ? 0.4 : 125)
            let b = pct(t2, ok ? 0.4 : 125)
            let rgb = ok ? oklabToRgb(Lab(l: min(l, 1), a: a, b: b), alpha) : labToRgb(Lab(l: min(l, 100), a: a, b: b), alpha)
            return Parsed(rgb: rgb, format: ok ? .oklab : .lab)
        case "lch", "oklch":
            let ok = fn == "oklch"
            try noAngle(t0, names[0])
            try noAngle(t1, names[1])
            let h = try hueDeg(t2, lang).get()
            let l = max(0, pct(t0, ok ? 1 : 100))
            let c = max(0, pct(t1, ok ? 0.4 : 150))
            let rad = normHue(h) * .pi / 180
            let lab = Lab(l: min(l, ok ? 1 : 100), a: c * cos(rad), b: c * sin(rad))
            return Parsed(rgb: ok ? oklabToRgb(lab, alpha) : labToRgb(lab, alpha), format: ok ? .oklch : .lch)
        case "color":
            let v: Vec3 = (pct(t0, 1), pct(t1, 1), pct(t2, 1))
            let rgb: RGBA
            switch space {
            case "srgb": rgb = RGBA(v.0, v.1, v.2, alpha)
            case "srgb-linear": rgb = linToRgb(v, alpha)
            case "display-p3": rgb = linToRgb(mul(xyzToLinSrgb, mul(linP3ToXyz, (toLinear(v.0), toLinear(v.1), toLinear(v.2)))), alpha)
            case "xyz-d50": rgb = linToRgb(mul(xyzToLinSrgb, mul(d50ToD65, v)), alpha)
            default: rgb = linToRgb(mul(xyzToLinSrgb, v), alpha)
            }
            return Parsed(rgb: rgb, format: .color)
        default:
            throw ToolError(lang.t(
                "不支持的颜色函数「\(name)()」。支持 rgb、rgba、hsl、hsla、hwb、lab、lch、oklab、oklch、color",
                "Unsupported color function “\(name)()”. Supported: rgb, rgba, hsl, hsla, hwb, lab, lch, oklab, oklch, color"
            ))
        }
    }

    static func editDistance(_ a: [Character], _ b: [Character]) -> Int {
        var dp = Array(0...b.count)
        for i in stride(from: 1, through: a.count, by: 1) {
            var prev = dp[0]
            dp[0] = i
            for j in stride(from: 1, through: b.count, by: 1) {
                let tmp = dp[j]
                dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] == b[j - 1] ? 0 : 1))
                prev = tmp
            }
        }
        return dp[b.count]
    }

    /// 拼写相近的颜色名（编辑距离 ≤ 2，或前缀匹配）
    public static func suggestName(_ word: String) -> String? {
        let w = Array(word.lowercased())
        guard w.count <= 64 else { return nil }
        var best: (name: String, d: Int)?
        for (name, _) in NamedColors.list {
            let d = editDistance(w, Array(name))
            if d < (best?.d ?? Int.max) { best = (name, d) }
        }
        if let best, best.d <= 2 { return best.name }
        let lower = String(w)
        return w.count >= 3 ? NamedColors.list.first { $0.name.hasPrefix(lower) }?.name : nil
    }

    private static let trailingSemicolon = Pattern(#";$"#)
    private static let important = Pattern(#"\s*!important$"#, caseInsensitive: true)
    private static let declaration = Pattern(#"^(?:--[\w-]+|[a-z][a-z-]*)\s*:\s*(?=\S)"#, caseInsensitive: true)
    private static let bareHex = Pattern(#"^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$"#, caseInsensitive: true)
    private static let functionPattern = Pattern(#"^([a-z-]+)\(\s*([^()]*?)\s*\)$"#, caseInsensitive: true)
    private static let functionStart = Pattern(#"^[a-z-]+\("#, caseInsensitive: true)
    private static let bareRgb = Pattern(#"^([0-9]{1,3}(?:\.[0-9]+)?)\s*[,\s]\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*[,\s]\s*([0-9]{1,3}(?:\.[0-9]+)?)$"#)
    private static let letters = Pattern(#"^[a-z]+$"#, caseInsensitive: true)

    /// 解析任意 CSS 颜色：HEX、rgb()/rgba()、hsl()/hsla()、hwb()、lab()、lch()、oklab()、oklch()、color()、命名颜色、
    /// transparent，也接受不带 # 的 HEX、「255, 0, 0」这样的裸 RGB 与整条 CSS 声明（color: red;）。
    public static func parse(_ input: String, lang: Lang = .zh) throws -> Parsed {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        s = trailingSemicolon.replace(s, with: "")
        s = important.replace(s, with: "")
        s = declaration.replace(s, with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { throw ToolError(lang.t("请输入颜色", "Enter a color")) }
        let lower = s.lowercased()
        if lower == "transparent" { return Parsed(rgb: RGBA(0, 0, 0, 0), format: .transparent) }
        if let hex = NamedColors.byName[lower], case .success(let rgb) = parseHex(hex, lang) {
            return Parsed(rgb: rgb, format: .named)
        }
        if s.hasPrefix("#") { return Parsed(rgb: try parseHex(String(s.dropFirst()), lang).get(), format: .hex) }
        // 省略 # 的 HEX（没有任何 CSS 颜色名只由 0-9a-f 组成）
        if bareHex.test(s), case .success(let rgb) = parseHex(s, lang) { return Parsed(rgb: rgb, format: .hex) }
        if let m = functionPattern.match(s) { return try parseFunction(m[1] ?? "", m[2] ?? "", lang) }
        if functionStart.test(s) {
            let opens = s.filter { $0 == "(" }.count
            if opens > 1 {
                throw ToolError(lang.t("不支持嵌套函数（如 calc()、var()），请直接填写数值", "Nested functions such as calc() or var() aren’t supported; enter the values directly"))
            }
            guard let close = s.firstIndex(of: ")") else { throw ToolError(lang.t("缺少右括号「)」", "The closing “)” is missing")) }
            let rest = s[s.index(after: close)...].trimmingCharacters(in: .whitespaces)
            throw ToolError(lang.t("右括号「)」后面有多余的内容「\(rest)」", "Unexpected text after “)”: “\(rest)”"))
        }
        if let m = bareRgb.match(s) { return try parseFunction("rgb", "\(m[1] ?? "") \(m[2] ?? "") \(m[3] ?? "")", lang) }
        if letters.test(s) {
            let near = suggestName(lower)
            throw ToolError(lang.t(
                "未知的颜色名「\(s)」" + (near.map { "，是不是想输入「\($0)」？" } ?? ""),
                "Unknown color name “\(s)”" + (near.map { "; did you mean “\($0)”?" } ?? "")
            ))
        }
        throw ToolError(lang.t(
            "无法识别「\(s)」。支持 HEX、rgb()、hsl()、hwb()、lab()、lch()、oklab()、oklch() 和 CSS 颜色名",
            "Can’t recognize “\(s)”. Supported: HEX, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch() and CSS color names"
        ))
    }

    /// 给界面画色块用：解析失败返回 nil，成功时返回映射到 sRGB 并裁剪后的颜色
    public static func colorValue(_ input: String) -> ColorValue? {
        guard let p = try? parse(input) else { return nil }
        let c = gamutMap(p.rgb)
        return ColorValue(r: c.r, g: c.g, b: c.b, a: c.alpha)
    }

    // MARK: 格式化

    /// 四舍五入并去掉多余的 0：12.50 → "12.5"，-0 → "0"
    public static func fmt(_ n: Double, _ digits: Int = 2) -> String { NumberText.fixed(n, digits) }

    static func jsRound(_ v: Double) -> Int { Int((v + 0.5).rounded(.down)) }

    static func hex2(_ v: Double) -> String {
        let n = jsRound(clamp01(v) * 255)
        return (n < 16 ? "0" : "") + String(n, radix: 16)
    }

    public static func toHex(_ c: RGBA, withAlpha: Bool = false) -> String {
        "#" + hex2(c.r) + hex2(c.g) + hex2(c.b) + (withAlpha ? hex2(c.alpha) : "")
    }

    /// 色相四舍五入后可能变成 360，统一写成 0
    static func fmtHue(_ h: Double, _ digits: Int) -> String {
        let v = fmt(h, digits)
        return v == "360" ? "0" : v
    }

    static func alphaPart(_ alpha: Double) -> String { alpha < 1 ? " / \(fmt(alpha * 100, 1))%" : "" }

    public struct Formats: Hashable, Sendable {
        public var hex, hex8, rgb, hsl, hsv, hwb, oklch, oklab, lab, lch, cmyk: String
    }

    public struct Info: Hashable, Sendable {
        /// 映射到 sRGB 色域并裁剪后的颜色
        public var rgb: RGBA
        /// 原始颜色是否在 sRGB 色域内
        public var inGamut: Bool
        public var formats: Formats
        /// 与之完全相同的 CSS 颜色名
        public var name: String?
        /// 最接近的 CSS 颜色名（OKLab 距离）
        public var nearest: NamedMatch
    }

    public struct NamedMatch: Hashable, Sendable {
        public var name: String
        public var distance: Double
    }

    static let namedLabs: [(String, Lab)] = NamedColors.list.compactMap { item in
        guard case .success(let rgb) = parseHex(item.hex, .zh) else { return nil }
        return (item.name, rgbToOklab(rgb))
    }

    public static func nearestNamed(_ c: RGBA) -> NamedMatch {
        let lab = rgbToOklab(c)
        var best = NamedMatch(name: "black", distance: .infinity)
        for (name, ref) in namedLabs {
            let d = deltaEOK(lab, ref)
            if d < best.distance { best = NamedMatch(name: name, distance: d) }
        }
        return best
    }

    public static func describe(_ parsed: Parsed, uppercase: Bool = false, legacy: Bool = false) -> Info {
        let original = parsed.rgb
        let rgb = gamutMap(original)
        let oklab = rgbToOklab(original)
        let oklch = oklabToOklch(oklab)
        func up(_ s: String) -> String { uppercase ? s.uppercased() : s }
        let (R, G, B) = (jsRound(rgb.r * 255), jsRound(rgb.g * 255), jsRound(rgb.b * 255))
        let hsl = rgbToHsl(rgb)
        let hsv = rgbToHsv(rgb)
        let hwb = rgbToHwb(rgb)
        let lab = rgbToLab(original)
        let lch = labToLch(lab)
        let cmyk = rgbToCmyk(rgb)
        let a = rgb.alpha
        func pctS(_ v: Double) -> String { "\(fmt(v * 100, 1))%" }
        let legacyAlpha = a < 1 ? ", \(fmt(a, 3))" : ""
        let formats = Formats(
            hex: up(toHex(rgb)),
            hex8: up(toHex(rgb, withAlpha: true)),
            rgb: legacy ? "\(a < 1 ? "rgba" : "rgb")(\(R), \(G), \(B)\(legacyAlpha))" : "rgb(\(R) \(G) \(B)\(alphaPart(a)))",
            hsl: legacy
                ? "\(a < 1 ? "hsla" : "hsl")(\(fmtHue(hsl.h, 1)), \(pctS(hsl.s)), \(pctS(hsl.l))\(legacyAlpha))"
                : "hsl(\(fmtHue(hsl.h, 1)) \(pctS(hsl.s)) \(pctS(hsl.l))\(alphaPart(a)))",
            hsv: "hsv(\(fmtHue(hsv.h, 1)), \(pctS(hsv.s)), \(pctS(hsv.v)))",
            hwb: "hwb(\(fmtHue(hwb.h, 1)) \(pctS(hwb.w)) \(pctS(hwb.b))\(alphaPart(a)))",
            // 色度 / a / b 保留 5 位小数：4 位时少数 8 位 HEX 颜色解析回来会差 1
            oklch: "oklch(\(fmt(oklch.l * 100, 2))% \(fmt(oklch.c, 5)) \(fmtHue(oklch.h, 2))\(alphaPart(a)))",
            oklab: "oklab(\(fmt(oklab.l * 100, 2))% \(fmt(oklab.a, 5)) \(fmt(oklab.b, 5))\(alphaPart(a)))",
            lab: "lab(\(fmt(lab.l, 2))% \(fmt(lab.a, 2)) \(fmt(lab.b, 2))\(alphaPart(a)))",
            lch: "lch(\(fmt(lch.l, 2))% \(fmt(lch.c, 2)) \(fmtHue(lch.h, 2))\(alphaPart(a)))",
            cmyk: "cmyk(\(pctS(cmyk.c)), \(pctS(cmyk.m)), \(pctS(cmyk.y)), \(pctS(cmyk.k)))"
        )
        let lowerHex = String(toHex(rgb).dropFirst())
        let name = a == 1 ? NamedColors.list.first { $0.hex == lowerHex }?.name : nil
        return Info(rgb: rgb, inGamut: inGamut(original), formats: formats, name: name, nearest: nearestNamed(rgb))
    }

    // MARK: 对比度（WCAG 2.1）

    public static let white = RGBA(1, 1, 1, 1)
    public static let black = RGBA(0, 0, 0, 1)

    /// 把带透明度的前景色合成到不透明背景上
    public static func composite(_ fg: RGBA, _ bg: RGBA) -> RGBA {
        let a = fg.alpha
        return RGBA(fg.r * a + bg.r * (1 - a), fg.g * a + bg.g * (1 - a), fg.b * a + bg.b * (1 - a), 1)
    }

    /// WCAG 2.1 相对亮度
    public static func relativeLuminance(_ c: RGBA) -> Double {
        func ch(_ v: Double) -> Double { v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * ch(clamp01(c.r)) + 0.7152 * ch(clamp01(c.g)) + 0.0722 * ch(clamp01(c.b))
    }

    /// 对比度 1–21；前景有透明度时先合成到背景上，背景有透明度时先合成到白色上
    public static func contrastRatio(_ fg: RGBA, _ bg: RGBA) -> Double {
        let solidBg = bg.alpha < 1 ? composite(bg, white) : bg
        let solidFg = fg.alpha < 1 ? composite(fg, solidBg) : fg
        let l1 = relativeLuminance(solidFg)
        let l2 = relativeLuminance(solidBg)
        return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
    }

    public struct Wcag: Hashable, Sendable {
        public var ratio: Double
        public var aaNormal, aaLarge, aaaNormal, aaaLarge, ui: Bool
    }

    public static func wcag(_ fg: RGBA, _ bg: RGBA) -> Wcag {
        // 按 WCAG 的做法，判定前先截断到两位小数，避免 4.499 被显示成 4.5 却不达标
        let ratio = contrastRatio(fg, bg)
        let r = (ratio * 100).rounded(.down) / 100
        return Wcag(ratio: ratio, aaNormal: r >= 4.5, aaLarge: r >= 3, aaaNormal: r >= 7, aaaLarge: r >= 4.5, ui: r >= 3)
    }

    /// 在该颜色上更易读的文字颜色
    public static func readableOnWhite(_ bg: RGBA) -> Bool {
        let solid = bg.alpha < 1 ? composite(bg, white) : bg
        return contrastRatio(white, solid) >= contrastRatio(black, solid)
    }
}
