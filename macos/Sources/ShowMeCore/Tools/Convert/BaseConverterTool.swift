import Foundation

/// 进制转换：基于自研 BigUInt，支持任意大小的整数与负数。
public enum BaseConverter {
    /// 单个数字的最大字符数，防止粘贴超大内容卡死
    public static let maxInputLength = 100_000

    /// 一个带符号的大整数
    public struct Value: Hashable, Sendable {
        public var negative: Bool
        public var magnitude: BigUInt

        public init(negative: Bool, magnitude: BigUInt) {
            self.negative = negative && !magnitude.isZero
            self.magnitude = magnitude
        }
    }

    public struct Parsed: Hashable, Sendable {
        public var value: Value
        /// 实际使用的进制（自动 / 十进制模式下写 0x 时为 16）
        public var base: Int
    }

    public static func baseName(_ base: Int, _ lang: Lang) -> String {
        switch base {
        case 2: lang.t("二进制", "binary")
        case 8: lang.t("八进制", "octal")
        case 10: lang.t("十进制", "decimal")
        case 16: lang.t("十六进制", "hexadecimal")
        default: lang.t("\(base) 进制", "base-\(base)")
        }
    }

    /// 该进制允许的字符说明：0–7、0–9、A–F
    public static func allowedDigits(_ base: Int, _ lang: Lang) -> String {
        if base == 2 { return lang.t("0 和 1", "0 and 1") }
        if base <= 10 { return "0–\(base - 1)" }
        if base == 11 { return lang.t("0–9 和 A", "0–9 and A") }
        let last = String(Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")[base - 1])
        return lang.t("0–9、A–\(last)", "0–9, A–\(last)")
    }

    private static let separators: Set<Unicode.Scalar> = [" ", "_", ",", "'", "\t", "\u{00A0}", "\u{2009}", "\u{202F}", "\u{3000}"]

    /// 数字字符 → 值（不区分大小写）；不是 0-9a-z 时为 nil
    static func digitValue(_ u: Unicode.Scalar) -> Int? {
        switch u.value {
        case 48...57: Int(u.value - 48)
        case 65...90: Int(u.value - 55)
        case 97...122: Int(u.value - 87)
        default: nil
        }
    }

    /// 按指定进制解析整数；空白输入返回 nil。
    /// - 忽略空格、下划线、逗号、单引号等分隔符；接受正负号（含 −）
    /// - 与进制匹配的 0x / 0o / 0b 前缀；`acceptAnyPrefix` 为真（自动 / 十进制）时按前缀切换进制
    public static func parse(_ raw: String, base: Int, acceptAnyPrefix: Bool = false, lang: Lang = .zh) throws -> Parsed? {
        guard base >= 2, base <= 36 else {
            throw ToolError(lang.t("进制必须是 2–36 之间的整数", "The base must be an integer from 2 to 36"))
        }
        if raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return nil }
        let original = Array(raw.unicodeScalars)
        // 全角数字 / 字母 / 正负号（中文输入法）按半角处理
        let s = Array(TextUtil.halfWidth(raw).unicodeScalars)
        if s.count > maxInputLength {
            throw ToolError(lang.t(
                "输入过长（\(NumberText.grouped(s.count)) 个字符），最多支持 \(NumberText.grouped(maxInputLength)) 个",
                "The input is too long (\(NumberText.grouped(s.count)) characters); the limit is \(NumberText.grouped(maxInputLength))"
            ))
        }
        var i = 0
        while i < s.count, separators.contains(s[i]) { i += 1 }
        var negative = false
        if i < s.count, s[i] == "-" || s[i] == "+" || s[i] == "\u{2212}" {
            negative = s[i] != "+"
            i += 1
            while i < s.count, separators.contains(s[i]) { i += 1 }
        }
        var radix = base
        var prefixed = false
        if i + 1 < s.count, s[i] == "0" {
            let p = s[i + 1].properties.lowercaseMapping
            let pb = p == "x" ? 16 : p == "o" ? 8 : p == "b" ? 2 : 0
            if pb > 0, pb == base || acceptAnyPrefix {
                radix = pb
                prefixed = true
                i += 2
            }
        }
        var digits: [UInt8] = []
        digits.reserveCapacity(s.count - i)
        var invalid: [Int] = []
        var signInMiddle = -1
        while i < s.count {
            let u = s[i]
            if !separators.contains(u) {
                if let d = digitValue(u), d < radix {
                    digits.append(UInt8(d))
                } else {
                    if (u == "-" || u == "+") && signInMiddle < 0 { signInMiddle = i }
                    invalid.append(i)
                }
            }
            i += 1
        }
        if let first = invalid.first {
            let ch = String(original[first])
            let pos = first + 1
            var message: String
            if signInMiddle == first {
                message = lang.t("第 \(pos) 个字符「\(ch)」：正负号只能写在最前面", "Character \(pos) “\(ch)”: a sign can only come first")
            } else {
                message = lang.t(
                    "第 \(pos) 个字符「\(ch)」不是有效的\(baseName(radix, .zh))数字（只能是 \(allowedDigits(radix, .zh))）",
                    "Character \(pos) “\(ch)” is not a valid \(baseName(radix, .en)) digit (only \(allowedDigits(radix, .en)))"
                )
                if radix == 2, s.contains(where: { $0 == "x" || $0 == "X" }) {
                    message += lang.t("，十六进制数请把来源进制设为自动或 16", "; for hex, set the source base to Auto or 16")
                }
            }
            if invalid.count > 1 {
                message += lang.t("，共 \(invalid.count) 处无效字符", " (\(invalid.count) invalid characters in total)")
            }
            throw ToolError(message, line: 1, column: pos)
        }
        if digits.isEmpty {
            throw ToolError(prefixed ? lang.t("前缀后面缺少数字", "Digits are missing after the prefix") : lang.t("请输入数字", "Enter a number"))
        }
        return Parsed(value: Value(negative: negative, magnitude: BigUInt(digits: digits, radix: radix)), base: radix)
    }

    public static func groupSize(_ base: Int) -> Int { base == 8 || base == 10 ? 3 : 4 }

    /// 从右往左每 size 位插入分隔符
    public static func groupDigits(_ s: String, size: Int, separator: String = " ") -> String {
        let chars = Array(s)
        guard size > 0, chars.count > size else { return s }
        var out = ""
        out.reserveCapacity(chars.count + chars.count / size)
        let head = chars.count % size
        for (i, c) in chars.enumerated() {
            if i > 0, (i - head) % size == 0 { out += separator }
            out.append(c)
        }
        return out
    }

    public static func format(_ v: Value, base: Int, uppercase: Bool = false, group: Bool = false, separator: String = " ") -> String {
        var s = v.magnitude.toString(radix: base)
        if uppercase { s = s.uppercased() }
        if group { s = groupDigits(s, size: groupSize(base), separator: separator) }
        return (v.negative ? "-" : "") + s
    }

    // MARK: 位信息

    public struct TwosComplement: Hashable, Sendable {
        public var bits: Int
        public var binary: String
        public var hex: String
    }

    /// 能装下该值的最小宽度（8/16/32/64，有符号或无符号均可）下的补码；超出 64 位返回 nil
    public static func twosComplement(_ v: Value) -> TwosComplement? {
        guard v.magnitude.fitsUInt64 else { return nil }
        let m = v.magnitude.low64
        for bits in [8, 16, 32, 64] {
            let mask: UInt64 = bits == 64 ? .max : (1 << UInt64(bits)) - 1
            let fits: Bool
            if v.negative {
                fits = bits == 64 ? m <= (1 << 63) : m <= (1 << UInt64(bits - 1))
            } else {
                fits = m <= mask
            }
            guard fits else { continue }
            let pattern = v.negative ? (0 &- m) & mask : m
            var bin = String(pattern, radix: 2)
            bin = String(repeating: "0", count: max(0, bits - bin.count)) + bin
            var hex = String(pattern, radix: 16, uppercase: true)
            hex = String(repeating: "0", count: max(0, bits / 4 - hex.count)) + hex
            return TwosComplement(bits: bits, binary: bin, hex: hex)
        }
        return nil
    }

    /// 补码最少位数（含符号位）
    public static func minSignedBits(_ v: Value) -> Int {
        if !v.negative { return v.magnitude.bitWidth + 1 }
        var m = v.magnitude
        m.subtract(1)
        return m.bitWidth + 1
    }

    public static func summary(_ v: Value, _ lang: Lang) -> String {
        let bits = v.magnitude.bitWidth
        let bytes = max(1, (bits + 7) / 8)
        var traits = [v.negative ? lang.t("负数", "negative") : v.magnitude.isZero ? lang.t("零", "zero") : lang.t("正数", "positive")]
        traits.append(v.magnitude.isOdd ? lang.t("奇数", "odd") : lang.t("偶数", "even"))
        if !v.negative && v.magnitude.isPowerOfTwo { traits.append(lang.t("2 的幂", "power of two")) }
        return lang.t(
            "位长度 \(bits) 位 · 最少 \(bytes) 字节 · 补码最少 \(minSignedBits(v)) 位 · 1 的个数 \(v.magnitude.popCount) · ",
            "\(bits) bits · \(bytes) byte\(bytes == 1 ? "" : "s") min · \(minSignedBits(v)) bits as two’s complement · \(v.magnitude.popCount) ones · "
        ) + traits.joined(separator: lang.t(" · ", ", "))
    }
}

public enum BaseConverterTool {
    public static let spec = ToolSpec(
        id: "base-converter",
        name: LocalizedText("进制转换", "Base Converter"),
        summary: LocalizedText(
            "二、八、十、十六进制及任意进制互转，支持超大整数。",
            "Convert between binary, octal, decimal, hex and any base from 2 to 36, with arbitrarily large integers."
        ),
        category: .convert,
        keywords: ["radix", "binary", "hex", "octal", "decimal", "base", "二进制", "十六进制", "进制", "jzzh"],
        symbol: "number",
        input: .required,
        inputLabel: LocalizedText("整数（每行一个）", "Integers (one per line)"),
        fields: [
            ToolField("from", LocalizedText("来源进制", "From base"), .choice([
                ToolChoice("auto", LocalizedText("自动（识别 0x / 0b / 0o）", "Auto (0x / 0b / 0o)")),
                ToolChoice("2", LocalizedText("二进制", "Binary")),
                ToolChoice("8", LocalizedText("八进制", "Octal")),
                ToolChoice("10", LocalizedText("十进制", "Decimal")),
                ToolChoice("16", LocalizedText("十六进制", "Hex")),
                ToolChoice("32", LocalizedText("32 进制", "Base 32")),
                ToolChoice("36", LocalizedText("36 进制", "Base 36")),
                ToolChoice("custom", LocalizedText("自定义", "Custom")),
            ]), default: "auto",
            help: LocalizedText("自动：带 0x / 0b / 0o 前缀按前缀识别，否则按十进制", "Auto reads 0x / 0b / 0o prefixes and decimal otherwise")),
            ToolField("fromBase", LocalizedText("自定义来源进制", "Custom base"), .number(min: 2, max: 36), default: "36",
                      visibleWhen: ToolCondition("from", is: "custom")),
            ToolField("toBase", LocalizedText("另输出进制", "Also output base"), .number(min: 2, max: 36), default: "36",
                      help: LocalizedText("除二、八、十、十六进制外再输出的进制", "An extra base besides 2, 8, 10 and 16")),
            ToolField("group", LocalizedText("数字分组", "Group digits"), .toggle, default: "0"),
            ToolField("uppercase", LocalizedText("大写字母", "Uppercase"), .toggle, default: "1"),
        ],
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let from = input.string("from")
        let base: Int
        switch from {
        case "auto", "": base = 10
        case "custom": base = min(36, max(2, input.int("fromBase", default: 36)))
        default: base = min(36, max(2, Int(from) ?? 10))
        }
        let anyPrefix = from == "auto" || from == "" || base == 10
        let extra = min(36, max(2, input.int("toBase", default: 36)))
        let group = input.bool("group")
        let upper = input.bool("uppercase")

        var values: [BaseConverter.Parsed] = []
        for (n, line) in TextUtil.lines(input.text).enumerated() {
            do {
                if let p = try BaseConverter.parse(line, base: base, acceptAnyPrefix: anyPrefix, lang: lang) { values.append(p) }
            } catch let e as ToolError {
                throw ToolError(e.message, line: n + 1, column: e.column)
            }
        }
        guard !values.isEmpty else { throw ToolError(lang.t("请输入数字", "Enter a number")) }

        let sourceBase = values[0].base
        var bases: [(id: String, base: Int)] = [("dec", 10), ("hex", 16), ("bin", 2), ("oct", 8)]
        if ![2, 8, 10, 16].contains(extra) { bases.append(("base\(extra)", extra)) }
        // 主输出：输入不是十进制时给十进制，否则给十六进制
        let primaryID = sourceBase == 10 ? "hex" : "dec"
        var outputs: [ToolOutput] = []
        for (id, b) in bases {
            let text = values.map { BaseConverter.format($0.value, base: b, uppercase: upper, group: group) }.joined(separator: "\n")
            let label = b == 10 || b == 16 || b == 2 || b == 8
                ? BaseConverter.baseName(b, lang).capitalizedFirst
                : lang.t("\(b) 进制", "Base \(b)")
            outputs.append(ToolOutput(id: id, label: label, value: text, isPrimary: id == primaryID))
        }
        outputs = outputs.filter(\.isPrimary) + outputs.filter { !$0.isPrimary }

        var notes: [ToolNote] = []
        if values.count == 1, let v = values.first?.value {
            outputs.append(ToolOutput(id: "info", label: lang.t("位信息", "Bits"), value: BaseConverter.summary(v, lang), style: .prose))
            if v.negative, let tc = BaseConverter.twosComplement(v) {
                outputs.append(ToolOutput(id: "twos", label: lang.t("补码（\(tc.bits) 位）", "Two’s complement (\(tc.bits)-bit)"),
                                          value: "\(BaseConverter.groupDigits(tc.binary, size: 4)) · 0x\(tc.hex)"))
            }
        }
        if from == "auto" || from == "" {
            notes.append(ToolNote(.info, lang.t("按\(BaseConverter.baseName(sourceBase, .zh))解析", "Read as \(BaseConverter.baseName(sourceBase, .en))")))
        }
        if values.count > 1 {
            notes.append(ToolNote(.info, lang.t("共 \(values.count) 个数，逐行转换", "\(values.count) numbers converted line by line")))
        }
        return ToolResult(outputs: outputs, notes: notes)
    }
}

extension String {
    /// 首字母大写（英文标签用）
    var capitalizedFirst: String {
        guard let f = first else { return self }
        return String(f).uppercased() + dropFirst()
    }
}
