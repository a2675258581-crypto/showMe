import Foundation

// HTML 实体编码 / 解码，遵循 WHATWG HTML 标准的字符引用规则：
// 全部 2125 个命名实体、十进制与十六进制数字引用、旧式实体可省略分号、0x80–0x9F 按 Windows-1252 解释。

public enum HTMLEntities {
    /// 名称（不含 & 与 ;）→ 字符串
    public static let named: [String: String] = {
        var m: [String: String] = [:]
        m.reserveCapacity(2200)
        for item in HTMLEntityData.entities.split(whereSeparator: { $0 == " " || $0 == "\n" }) {
            guard let eq = item.firstIndex(of: "=") else { continue }
            var value = String.UnicodeScalarView()
            for h in item[item.index(after: eq)...].split(separator: ".") {
                if let v = UInt32(h, radix: 16), let s = Unicode.Scalar(v) { value.append(s) }
            }
            m[String(item[..<eq])] = String(value)
        }
        return m
    }()

    /// 可以省略分号的旧式实体
    public static let legacy: Set<String> = Set(HTMLEntityData.legacyNames.split(whereSeparator: { $0 == " " || $0 == "\n" }).map(String.init))
    static let legacyMaxLength = legacy.map(\.count).max() ?? 0
    static let html4: Set<String> = Set(HTMLEntityData.html4Names.split(whereSeparator: { $0 == " " || $0 == "\n" }).map(String.init))

    /// 码点 → 首选实体名：HTML 4 名称优先，其次取最短、小写优先的名称（只收录单个码点的实体）
    static let preferredName: [UInt32: String] = {
        func rank(_ n: String) -> (Int, Int, Int) { (html4.contains(n) ? 0 : 1, n.count, n.contains(where: \.isUppercase) ? 1 : 0) }
        var best: [UInt32: String] = [:]
        for (name, value) in named {
            let scalars = value.unicodeScalars
            guard scalars.count == 1, let cp = scalars.first?.value else { continue }
            if let cur = best[cp] {
                let a = rank(name), b = rank(cur)
                if a < b || (a == b && name < cur) { best[cp] = name }
            } else {
                best[cp] = name
            }
        }
        return best
    }()

    /// 某个字符的首选实体名（不含 & ;），没有则 nil
    public static func entityName(of scalar: Unicode.Scalar) -> String? { preferredName[scalar.value] }

    public enum EncodeMode: String, CaseIterable, Sendable {
        /// 只转义 & < > " '
        case special
        /// 非 ASCII → 命名实体（没有时回退为数字引用）
        case named
        /// 非 ASCII → &#十进制;
        case decimal
        /// 非 ASCII → &#x十六进制;
        case hex
    }

    /// 编码：换行与制表符保持原样
    public static func encode(_ text: String, mode: EncodeMode, quotes: Bool = true, hexFallback: Bool = false) -> String {
        var out = ""
        out.reserveCapacity(text.utf8.count)
        for s in text.unicodeScalars {
            switch s {
            case "&": out += "&amp;"; continue
            case "<": out += "&lt;"; continue
            case ">": out += "&gt;"; continue
            case "\"": if quotes { out += "&quot;"; continue }
            case "'": if quotes { out += "&#39;"; continue }
            default: break
            }
            if s.value < 0x80 || mode == .special {
                out.unicodeScalars.append(s)
                continue
            }
            switch mode {
            case .named:
                if let name = preferredName[s.value] { out += "&\(name);" } else { out += numeric(s.value, hex: hexFallback) }
            case .hex: out += numeric(s.value, hex: true)
            default: out += numeric(s.value, hex: false)
            }
        }
        return out
    }

    static func numeric(_ cp: UInt32, hex: Bool) -> String {
        hex ? "&#x" + String(cp, radix: 16, uppercase: true) + ";" : "&#\(cp);"
    }

    /// 数字引用落在 0x80–0x9F 时按 Windows-1252 解释（HTML 标准规定）
    static let c1Remap: [UInt32: UInt32] = [
        0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
        0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018,
        0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC,
        0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
    ]

    public struct DecodeResult: Sendable, Hashable {
        public var output: String
        public var namedCount = 0
        public var numericCount = 0
        var issues: [CodecIssue] = []
        /// 解码结果里还含有实体，可能被重复编码过
        public var stillEncoded = false
    }

    @inline(__always) static func isDigit(_ s: Unicode.Scalar) -> Bool { s.value >= 48 && s.value <= 57 }
    @inline(__always) static func isAlnum(_ s: Unicode.Scalar) -> Bool { isDigit(s) || EncodeCryptoShared.isASCIILetter(s) }
    @inline(__always) static func isHexDigit(_ s: Unicode.Scalar) -> Bool { HexCodec.nibble(s.value) != nil }

    /// 解码命名实体（含 HTML5 全表）、十进制与十六进制数字引用；旧式实体允许省略分号
    public static func decode(_ text: String) -> DecodeResult {
        let s = Array(text.unicodeScalars)
        let n = s.count
        var collector = IssueCollector(s)
        var r = DecodeResult(output: "")
        var out = String.UnicodeScalarView()
        func slice(_ a: Int, _ b: Int) -> String { EncodeCryptoShared.string(s[a..<b]) }
        var i = 0
        while i < n {
            let c = s[i]
            if c != "&" { out.append(c); i += 1; continue }
            let amp = i
            var j = amp + 1
            // 数字引用 &#123; / &#x1F600;
            if j < n && s[j] == "#" {
                j += 1
                let hex = j < n && (s[j] == "x" || s[j] == "X")
                if hex { j += 1 }
                let digitsStart = j
                while j < n && (hex ? isHexDigit(s[j]) : isDigit(s[j])) { j += 1 }
                if j == digitsStart {
                    let raw = slice(amp, j)
                    collector.add(amp, j - amp, LocalizedText(
                        "“\(raw)” 后缺少\(hex ? "十六进制" : "十进制")数字，已原样保留",
                        "“\(raw)” is missing its \(hex ? "hex" : "decimal") digits; kept as is"))
                    EncodeCryptoShared.append(s[amp..<j], to: &out)
                    i = j
                    continue
                }
                let semi = j < n && s[j] == ";"
                let end = semi ? j + 1 : j
                let raw = slice(amp, end)
                // 前导零不影响数值（&#x000041; 是 “A”）；有效位过长时必然超出范围
                var digits = s[digitsStart..<j].drop(while: { $0 == "0" })
                if digits.isEmpty { digits = ["0"] }
                var cp: UInt32 = 0x110000
                if digits.count <= 8, let v = UInt64(EncodeCryptoShared.string(digits), radix: hex ? 16 : 10), v <= 0x10FFFF { cp = UInt32(v) }
                var note: LocalizedText?
                var warn = false
                if cp == 0 {
                    note = LocalizedText("码点 0 不是合法字符，已替换为 U+FFFD", "Code point 0 is not a valid character; replaced with U+FFFD"); warn = true
                } else if cp > 0x10FFFF {
                    note = LocalizedText("超出 Unicode 范围（最大 U+10FFFF），已替换为 U+FFFD", "Beyond the Unicode range (max U+10FFFF); replaced with U+FFFD"); warn = true
                } else if cp >= 0xD800 && cp <= 0xDFFF {
                    note = LocalizedText("代理项码点不能单独使用，已替换为 U+FFFD", "A surrogate code point cannot stand alone; replaced with U+FFFD"); warn = true
                }
                if warn {
                    cp = 0xFFFD
                } else if let mapped = c1Remap[cp] {
                    let ch = Unicode.Scalar(mapped).map { String($0) } ?? ""
                    note = LocalizedText("按 HTML 标准，\(raw) 视为 Windows-1252 字符“\(ch)”", "Per the HTML standard, \(raw) is read as the Windows-1252 character “\(ch)”")
                    cp = mapped
                }
                if let note {
                    collector.add(amp, end - amp, note, warning: warn)
                } else if !semi {
                    collector.add(amp, end - amp, LocalizedText("\(raw) 缺少结尾分号（已按数字引用解码）", "\(raw) is missing its semicolon (decoded as a numeric reference)"), warning: false)
                }
                out.append(Unicode.Scalar(cp) ?? "\u{FFFD}")
                r.numericCount += 1
                i = end
                continue
            }
            // 命名引用
            while j < n && isAlnum(s[j]) { j += 1 }
            if j == amp + 1 {
                out.append("&")
                i = amp + 1
                continue
            }
            let name = slice(amp + 1, j)
            if j < n && s[j] == ";", let v = named[name] {
                EncodeCryptoShared.append(v.unicodeScalars, to: &out)
                r.namedCount += 1
                i = j + 1
                continue
            }
            // 旧式实体可以省略分号：取最长的匹配前缀（&copy2019 → ©2019）
            var matched = ""
            var len = min(j - amp - 1, legacyMaxLength)
            while len >= 2 {
                let cand = slice(amp + 1, amp + 1 + len)
                if legacy.contains(cand) { matched = cand; break }
                len -= 1
            }
            if !matched.isEmpty, let v = named[matched] {
                EncodeCryptoShared.append(v.unicodeScalars, to: &out)
                r.namedCount += 1
                collector.add(amp, matched.unicodeScalars.count + 1, LocalizedText(
                    "&\(matched) 缺少结尾分号（已按旧式实体解码）", "&\(matched) is missing its semicolon (decoded as a legacy entity)"), warning: false)
                i = amp + 1 + matched.unicodeScalars.count
                continue
            }
            if j < n && s[j] == ";" {
                let lower = name.lowercased()
                collector.add(amp, j + 1 - amp, named[lower] != nil
                    ? LocalizedText("未知实体 &\(name);（实体名区分大小写，是否想写 &\(lower);？）", "Unknown entity &\(name); (names are case-sensitive; did you mean &\(lower);?)")
                    : LocalizedText("未知实体 &\(name);，已原样保留", "Unknown entity &\(name); kept as is"))
            }
            EncodeCryptoShared.append(s[amp..<j], to: &out)
            i = j
        }
        r.output = String(out)
        r.issues = collector.issues
        r.stillEncoded = r.namedCount + r.numericCount > 0 && looksEncoded(r.output)
        return r
    }

    /// 文本中是否含有可识别的实体（用于提示「可能被重复编码」）
    public static func looksEncoded(_ text: String) -> Bool {
        let s = Array(text.unicodeScalars)
        var i = 0
        while i < s.count {
            guard s[i] == "&" else { i += 1; continue }
            var j = i + 1
            if j < s.count && s[j] == "#" {
                j += 1
                let hex = j < s.count && (s[j] == "x" || s[j] == "X")
                if hex { j += 1 }
                let start = j
                while j < s.count && (hex ? isHexDigit(s[j]) : isDigit(s[j])) { j += 1 }
                if j > start && j < s.count && s[j] == ";" { return true }
            } else if j < s.count && EncodeCryptoShared.isASCIILetter(s[j]) {
                while j < s.count && isAlnum(s[j]) { j += 1 }
                if j < s.count && s[j] == ";" && named[EncodeCryptoShared.string(s[(i + 1)..<j])] != nil { return true }
            }
            i = max(j, i + 1)
        }
        return false
    }
}

public enum HTMLEntitiesTool {
    public static let spec = ToolSpec(
        id: "html-entities",
        name: LocalizedText("HTML 实体", "HTML Entities"),
        summary: LocalizedText(
            "HTML 特殊字符与实体（&amp;、&#x4E2D; 等）互相转换。",
            "Convert between HTML special characters and entities such as &amp; and &#x4E2D;."
        ),
        category: .encode,
        keywords: ["html", "entity", "escape", "unescape", "转义", "实体", "htmlentities", "bm"],
        symbol: "chevron.left.forwardslash.chevron.right",
        input: .required,
        inputLabel: LocalizedText("原文或含实体的文本", "Text or HTML with entities"),
        fields: [
            ToolField("mode", LocalizedText("操作", "Action"), .choice([
                ToolChoice("encode", LocalizedText("编码", "Encode")),
                ToolChoice("decode", LocalizedText("解码", "Decode")),
            ]), default: "encode"),
            ToolField("scope", LocalizedText("编码范围", "Scope"), .choice([
                ToolChoice("special", LocalizedText("仅特殊字符（& < > \" '）", "Special characters only (& < > \" ')")),
                ToolChoice("named", LocalizedText("非 ASCII → 命名实体", "Non-ASCII → named entities")),
                ToolChoice("decimal", LocalizedText("非 ASCII → 十进制", "Non-ASCII → decimal")),
                ToolChoice("hex", LocalizedText("非 ASCII → 十六进制", "Non-ASCII → hex")),
            ]), default: "special", visibleWhen: ToolCondition("mode", is: "encode")),
            ToolField("hexFallback", LocalizedText("没有命名实体时用十六进制", "Hex when no named entity"), .toggle, default: "0",
                      help: LocalizedText("关闭时回退为 &#十进制;", "When off, falls back to &#decimal;"),
                      visibleWhen: ToolCondition("scope", is: "named")),
            ToolField("quotes", LocalizedText("转义引号 \" '（属性值）", "Escape quotes \" ' (attributes)"), .toggle, default: "1",
                      visibleWhen: ToolCondition("mode", is: "encode")),
        ],
        run: { input in try run(input) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        if input.string("mode") == "decode" {
            let r = HTMLEntities.decode(input.text)
            var notes: [ToolNote] = []
            if r.namedCount + r.numericCount > 0 {
                notes.append(ToolNote(.info, lang.t("命名实体 \(r.namedCount) 个 · 数字引用 \(r.numericCount) 个",
                                                    "\(r.namedCount) named · \(r.numericCount) numeric references")))
            }
            if r.stillEncoded {
                notes.append(ToolNote(.info, lang.t("解码结果里仍有实体（例如 &amp;lt; 被解成了 &lt;），原文可能被重复编码过，可再解码一次。",
                                                    "The result still contains entities (e.g. &amp;lt; became &lt;); the text may be double-encoded, so decode it again.")))
            }
            let warnings = r.issues.filter(\.isWarning), infos = r.issues.filter { !$0.isWarning }
            notes += EncodeCryptoShared.notes(warnings, lang: lang, title: LocalizedText("以下内容无法识别，已原样保留", "These could not be recognized and were kept as is"))
            notes += EncodeCryptoShared.notes(infos, lang: lang, title: LocalizedText("已按浏览器的宽松规则解码，但写法不规范", "Decoded with the browser’s lenient rules, but written non-standardly"))
            return ToolResult(outputs: [.primary(lang.t("解码结果", "Decoded"), r.output, language: "html")], notes: notes)
        }
        let mode = EncodeCryptoShared.choice(input, "scope", default: HTMLEntities.EncodeMode.special)
        let out = HTMLEntities.encode(input.text, mode: mode, quotes: input.bool("quotes"), hexFallback: input.bool("hexFallback"))
        return ToolResult(outputs: [.primary(lang.t("编码结果", "Encoded"), out, language: "html")])
    }
}
