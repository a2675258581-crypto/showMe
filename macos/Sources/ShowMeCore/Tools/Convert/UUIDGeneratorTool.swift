import Foundation

/// UUID v4 / v7、ULID、NanoID 生成。v7 与 ULID 在同一毫秒内严格单调递增。
public enum IDGenerator {
    public enum Kind: String, CaseIterable, Sendable {
        case v4, v7, ulid, nanoid
    }

    static let hexDigits = Array("0123456789abcdef")

    public static func bytesToHex(_ b: [UInt8]) -> String {
        var s = ""
        s.reserveCapacity(b.count * 2)
        for x in b {
            s.append(hexDigits[Int(x >> 4)])
            s.append(hexDigits[Int(x & 15)])
        }
        return s
    }

    /// 16 字节 → 标准 8-4-4-4-12 小写格式
    public static func bytesToUuid(_ b: [UInt8]) -> String {
        let h = Array(bytesToHex(b))
        guard h.count == 32 else { return String(h) }
        return String(h[0..<8]) + "-" + String(h[8..<12]) + "-" + String(h[12..<16]) + "-" + String(h[16..<20]) + "-" + String(h[20..<32])
    }

    public static func formatUuid(_ uuid: String, uppercase: Bool, noHyphens: Bool, braces: Bool) -> String {
        var s = noHyphens ? uuid.replacingOccurrences(of: "-", with: "") : uuid
        s = uppercase ? s.uppercased() : s.lowercased()
        return braces ? "{\(s)}" : s
    }

    /// 把任意 16 字节打上 v4 版本号与 RFC 变体位
    public static func uuidV4(fromBytes bytes: [UInt8]) -> String {
        var b = Array(bytes.prefix(16))
        while b.count < 16 { b.append(0) }
        b[6] = (b[6] & 0x0F) | 0x40
        b[8] = (b[8] & 0x3F) | 0x80
        return bytesToUuid(b)
    }

    static let timestampMax: Int64 = (1 << 48) - 1
    /// v7 的单调计数器：rand_a 的 12 位 + rand_b 高 30 位，共 42 位
    static let v7CounterMax: UInt64 = (1 << 42) - 1

    /// 按字段拼出一个 v7 UUID：48 位毫秒 | ver | 42 位计数器 | var | 32 位随机
    public static func buildUuidV7(ms: Int64, counter: UInt64, tail: [UInt8]) -> String? {
        guard ms >= 0, ms <= timestampMax else { return nil }
        var b = [UInt8](repeating: 0, count: 16)
        var t = UInt64(ms)
        for i in stride(from: 5, through: 0, by: -1) {
            b[i] = UInt8(t & 0xFF)
            t >>= 8
        }
        let randA = counter >> 30
        let low30 = counter & ((1 << 30) - 1)
        b[6] = 0x70 | UInt8((randA >> 8) & 0x0F)
        b[7] = UInt8(randA & 0xFF)
        b[8] = 0x80 | UInt8((low30 >> 24) & 0x3F)
        b[9] = UInt8((low30 >> 16) & 0xFF)
        b[10] = UInt8((low30 >> 8) & 0xFF)
        b[11] = UInt8(low30 & 0xFF)
        for i in 0..<4 { b[12 + i] = i < tail.count ? tail[i] : 0 }
        return bytesToUuid(b)
    }

    /// 取前 6 个随机字节中的 41 位作为计数器起点（最高位留 0 防溢出）
    static func seedCounter(_ r: [UInt8]) -> UInt64 {
        guard r.count >= 6 else { return 0 }
        return (UInt64(r[0] & 1) << 40) | (UInt64(r[1]) << 32) | (UInt64(r[2]) << 24) | (UInt64(r[3]) << 16) | (UInt64(r[4]) << 8) | UInt64(r[5])
    }

    /// UUID v7 生成器（RFC 9562 §6.2 方法 1：专用计数器）：同一毫秒或时钟回拨时计数器 +1，耗尽时借用下一毫秒
    public struct V7Generator {
        var lastMs: Int64 = -1
        var counter: UInt64 = 0

        public init() {}

        public mutating func next(ms now: Int64, random: RandomStream) -> String? {
            let r = random.bytes(10)
            if now > lastMs {
                lastMs = now
                counter = seedCounter(r)
            } else if counter < v7CounterMax {
                counter += 1
            } else {
                lastMs += 1
                counter = seedCounter(r)
            }
            return buildUuidV7(ms: lastMs, counter: counter, tail: Array(r[6..<10]))
        }
    }

    public static let crockford = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    /// 48 位毫秒时间戳 → 10 位 Crockford Base32
    public static func encodeUlidTime(_ ms: Int64) -> String? {
        guard ms >= 0, ms <= timestampMax else { return nil }
        var t = ms
        var chars: [Character] = []
        for _ in 0..<10 {
            chars.append(crockford[Int(t % 32)])
            t /= 32
        }
        return String(chars.reversed())
    }

    /// 10 字节（80 位）→ 16 个 5 位数字
    static func bytesToDigits(_ b: [UInt8], count: Int) -> [Int] {
        var digits: [Int] = []
        var acc = 0
        var bits = 0
        for x in b {
            acc = (acc << 8) | Int(x)
            bits += 8
            while bits >= 5 && digits.count < count {
                bits -= 5
                digits.append((acc >> bits) & 31)
            }
            acc &= (1 << bits) - 1
        }
        return digits
    }

    /// ULID 生成器（单调模式）：同一毫秒内把 80 位随机部分当作整数 +1；溢出或时钟回拨时借用下一毫秒
    public struct UlidGenerator {
        var lastMs: Int64 = -1
        var rand: [Int] = []

        public init() {}

        public mutating func next(ms now: Int64, random: RandomStream) -> String? {
            if now > lastMs {
                lastMs = now
                rand = bytesToDigits(random.bytes(10), count: 16)
            } else {
                var i = rand.count - 1
                while i >= 0 && rand[i] == 31 {
                    rand[i] = 0
                    i -= 1
                }
                if i >= 0 {
                    rand[i] += 1
                } else {
                    lastMs += 1
                    rand = bytesToDigits(random.bytes(10), count: 16)
                }
            }
            guard let time = encodeUlidTime(lastMs) else { return nil }
            return time + String(rand.map { crockford[$0] })
        }
    }

    public static let nanoidAlphabets: [(id: String, label: LocalizedText, chars: String)] = [
        ("url", LocalizedText("URL 安全（默认）", "URL-safe (default)"), "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"),
        ("alnum", LocalizedText("字母 + 数字", "Letters + digits"), "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"),
        ("lower", LocalizedText("小写 + 数字", "Lowercase + digits"), "0123456789abcdefghijklmnopqrstuvwxyz"),
        ("hex", LocalizedText("十六进制", "Hex"), "0123456789abcdef"),
        ("digits", LocalizedText("纯数字", "Digits only"), "0123456789"),
        ("nolookalikes", LocalizedText("无易混淆字符", "No look-alikes"), "346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtwxyz"),
    ]

    public static let nanoidSizeRange = 2...256

    /// 按字符（字素簇）拆分并去重，忽略空白；允许 emoji / 中文
    public static func normalizeAlphabet(_ s: String) -> (chars: [String], duplicates: [String]) {
        var seen = Set<String>()
        var chars: [String] = []
        var duplicates: [String] = []
        for c in s {
            if c.isWhitespace { continue }
            let str = String(c)
            if seen.contains(str) {
                if !duplicates.contains(str) { duplicates.append(str) }
            } else {
                seen.insert(str)
                chars.append(str)
            }
        }
        return (chars, duplicates)
    }

    public static func nanoid(size: Int, alphabet: [String], random: RandomStream) -> String {
        let n = alphabet.count
        guard n >= 2 else { return "" }
        var s = ""
        // 字母表是 2 的幂时一次取一个字节掩码即可，否则拒绝采样
        if n <= 256 && n & (n - 1) == 0 {
            for b in random.bytes(size) { s += alphabet[Int(b) & (n - 1)] }
            return s
        }
        for _ in 0..<size { s += alphabet[random.int(n)] }
        return s
    }

    /// 每个 ID 的随机位数
    public static func randomBits(_ kind: Kind, nanoidSize: Int, alphabetCount: Int) -> Double {
        switch kind {
        case .v4: return 122
        case .v7: return 74
        case .ulid: return 80
        case .nanoid: return alphabetCount < 2 ? 0 : Double(nanoidSize) * log2(Double(alphabetCount))
        }
    }

    /// 生日问题：随机位数为 bits 时，生成多少个 ID 后出现重复的概率达到 p，返回 log10(个数)
    public static func collisionLog10(bits: Double, p: Double = 0.01) -> Double {
        let log2n = (bits + 1 + log2(-log1p(-p))) / 2
        return log2n * log10(2)
    }

    /// 用数量级格式化 10^x：中文用 万 / 亿 / 万亿，英文用 thousand / million / billion / trillion，再大用科学计数法
    public static func formatLog10Count(_ x: Double, _ lang: Lang) -> String {
        func trim(_ v: Double) -> String { v >= 100 ? String(Int(v.rounded())) : NumberText.fixed(v, 1) }
        func sci() -> String {
            let exp = Int(x.rounded(.down))
            return String(format: "%.1f", pow(10, x - Double(exp))) + "×10" + NumberText.superscript(exp)
        }
        if x < 4 { return NumberText.grouped(Int(pow(10, x).rounded())) }
        if lang == .zh {
            if x < 8 { return "\(trim(pow(10, x - 4))) 万" }
            if x < 12 { return "\(trim(pow(10, x - 8))) 亿" }
            if x < 16 { return "\(trim(pow(10, x - 12))) 万亿" }
            return sci()
        }
        if x < 6 { return "\(trim(pow(10, x - 3))) thousand" }
        if x < 9 { return "\(trim(pow(10, x - 6))) million" }
        if x < 12 { return "\(trim(pow(10, x - 9))) billion" }
        if x < 15 { return "\(trim(pow(10, x - 12))) trillion" }
        return sci()
    }
}

public enum UUIDGeneratorTool {
    public static let spec = ToolSpec(
        id: "uuid-generator",
        name: LocalizedText("UUID 生成", "UUID Generator"),
        summary: LocalizedText(
            "批量生成 UUID v4 / v7、ULID、NanoID。",
            "Generate UUID v4 / v7, ULID and NanoID in bulk."
        ),
        category: .crypto,
        keywords: ["uuid", "guid", "ulid", "nanoid", "id", "random", "唯一"],
        symbol: "dice",
        input: .none,
        fields: [
            ToolField("kind", LocalizedText("类型", "Type"), .choice([
                ToolChoice("v4", LocalizedText("UUID v4", "UUID v4")),
                ToolChoice("v7", LocalizedText("UUID v7", "UUID v7")),
                ToolChoice("ulid", LocalizedText("ULID", "ULID")),
                ToolChoice("nanoid", LocalizedText("NanoID", "NanoID")),
            ]), default: "v4",
            help: LocalizedText("v4 纯随机；v7 与 ULID 以毫秒时间戳开头、可按时间排序；NanoID 长度与字母表可自定义",
                                "v4 is fully random; v7 and ULID start with a millisecond timestamp and sort by time; NanoID has a custom size and alphabet")),
            ToolField("count", LocalizedText("数量", "Count"), .number(min: 1, max: 1000), default: "10"),
            ToolField("uppercase", LocalizedText("大写", "Uppercase"), .toggle, default: "0", visibleWhen: ToolCondition("kind", in: ["v4", "v7"])),
            ToolField("noHyphens", LocalizedText("去掉连字符", "No hyphens"), .toggle, default: "0", visibleWhen: ToolCondition("kind", in: ["v4", "v7"])),
            ToolField("braces", LocalizedText("{ } 花括号", "{ } braces"), .toggle, default: "0", visibleWhen: ToolCondition("kind", in: ["v4", "v7"])),
            ToolField("lowercase", LocalizedText("小写输出", "Lowercase"), .toggle, default: "0", visibleWhen: ToolCondition("kind", is: "ulid")),
            ToolField("size", LocalizedText("长度", "Size"), .number(min: 2, max: 256), default: "21", visibleWhen: ToolCondition("kind", is: "nanoid")),
            ToolField("alphabet", LocalizedText("字母表", "Alphabet"), .choice(IDGenerator.nanoidAlphabets.map { ToolChoice($0.id, $0.label) }),
                      default: "url", visibleWhen: ToolCondition("kind", is: "nanoid")),
            ToolField("customAlphabet", LocalizedText("自定义字母表", "Custom alphabet"), .text(placeholder: LocalizedText("留空则用上面的预设", "Leave empty to use the preset")),
                      visibleWhen: ToolCondition("kind", is: "nanoid")),
        ],
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let kind = IDGenerator.Kind(rawValue: input.string("kind")) ?? .v4
        let count = min(1000, max(1, input.int("count", default: 10)))
        let random = RandomStream(input.random)
        let ms = Timestamp.epochMs(input.now)
        var ids: [String] = []
        ids.reserveCapacity(count)
        var notes: [ToolNote] = []
        var alphabetCount = 0
        let size = min(256, max(2, input.int("size", default: 21)))

        switch kind {
        case .v4:
            for _ in 0..<count { ids.append(IDGenerator.uuidV4(fromBytes: random.bytes(16))) }
        case .v7, .ulid:
            guard ms >= 0, ms <= IDGenerator.timestampMax else {
                throw ToolError(lang.t("当前时间超出 48 位毫秒时间戳的范围", "The current time is outside the 48-bit millisecond range"))
            }
            var v7 = IDGenerator.V7Generator()
            var ulid = IDGenerator.UlidGenerator()
            for _ in 0..<count {
                let id = kind == .v7 ? v7.next(ms: ms, random: random) : ulid.next(ms: ms, random: random)
                if let id { ids.append(id) }
            }
            notes.append(ToolNote(.info, lang.t("时间戳部分取自当前时间 ", "The timestamp part is the current time, ") + Timestamp.formatISOUtc(ms)))
        case .nanoid:
            let custom = input.string("customAlphabet")
            let preset = IDGenerator.nanoidAlphabets.first { $0.id == input.string("alphabet") }?.chars ?? IDGenerator.nanoidAlphabets[0].chars
            let alphabet = IDGenerator.normalizeAlphabet(custom.trimmingCharacters(in: .whitespaces).isEmpty ? preset : custom)
            guard alphabet.chars.count >= 2 else {
                throw ToolError(lang.t("字母表至少需要 2 个不同的字符", "The alphabet needs at least 2 different characters"))
            }
            if !alphabet.duplicates.isEmpty {
                notes.append(ToolNote(.warning, lang.t("字母表里有重复字符，已去重：", "Duplicate characters were removed from the alphabet: ")
                    + alphabet.duplicates.joined(separator: lang.t("、", ", "))))
            }
            alphabetCount = alphabet.chars.count
            for _ in 0..<count { ids.append(IDGenerator.nanoid(size: size, alphabet: alphabet.chars, random: random)) }
        }

        let formatted: [String]
        switch kind {
        case .v4, .v7:
            formatted = ids.map { IDGenerator.formatUuid($0, uppercase: input.bool("uppercase"), noHyphens: input.bool("noHyphens"), braces: input.bool("braces")) }
        case .ulid:
            formatted = input.bool("lowercase") ? ids.map { $0.lowercased() } : ids
        case .nanoid:
            formatted = ids
        }

        let bits = IDGenerator.randomBits(kind, nanoidSize: size, alphabetCount: alphabetCount)
        let bitsText = NumberText.fixed(bits, 1)
        let collision = IDGenerator.formatLog10Count(IDGenerator.collisionLog10(bits: bits), lang)
        notes.append(ToolNote(.info, lang.t(
            "每个 ID 含 \(bitsText) 位随机数；约生成 \(collision) 个才有 1% 的概率出现重复",
            "\(bitsText) random bits per ID; about \(collision) IDs before a 1% chance of a collision"
        )))
        let label = lang.t("\(kind == .nanoid ? "NanoID" : kind == .ulid ? "ULID" : "UUID \(kind.rawValue)") · \(formatted.count) 个",
                           "\(kind == .nanoid ? "NanoID" : kind == .ulid ? "ULID" : "UUID \(kind.rawValue)") · \(formatted.count)")
        return ToolResult(outputs: [.primary(label, formatted.joined(separator: "\n"), language: "plain")], notes: notes)
    }
}
