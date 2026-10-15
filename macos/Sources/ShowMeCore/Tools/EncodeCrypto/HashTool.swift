import Foundation

// 哈希计算：MD5（32 / 16 位、大小写）、SHA-1/2/3、Keccak-256、SM3、CRC32、xxHash64、BLAKE3；
// 输入可按 UTF-8 / UTF-16LE / Latin-1 / Hex / Base64 转成字节；粘贴期望值可校验。

public enum HashTool {
    /// 结果列表里的一项：真实算法，或从 MD5 派生的 16 位写法
    public enum Item: Hashable, Sendable {
        case algorithm(HashAlgorithm)
        case md5Half

        public var id: String {
            switch self {
            case .algorithm(let a): a.rawValue
            case .md5Half: "md5-16"
            }
        }

        public func label(_ lang: Lang) -> String {
            switch self {
            case .algorithm(let a): a.label
            case .md5Half: lang.t("MD5 16 位", "MD5 (16 chars)")
            }
        }

        public var bits: Int {
            switch self {
            case .algorithm(let a): a.digestSize * 8
            case .md5Half: 64
            }
        }
    }

    /// 与网页版一致的顺序
    public static let allItems: [Item] = [
        .algorithm(.md5), .md5Half, .algorithm(.sha1), .algorithm(.sha224), .algorithm(.sha256), .algorithm(.sha384),
        .algorithm(.sha512), .algorithm(.sha3_256), .algorithm(.sha3_512), .algorithm(.keccak256), .algorithm(.sm3),
        .algorithm(.crc32), .algorithm(.xxhash64), .algorithm(.blake3),
    ]

    static let presets: [String: [Item]] = [
        "all": allItems,
        "common": [.algorithm(.md5), .algorithm(.sha1), .algorithm(.sha256), .algorithm(.sha512)],
        "sha": [.algorithm(.sha1), .algorithm(.sha224), .algorithm(.sha256), .algorithm(.sha384), .algorithm(.sha512), .algorithm(.sha3_256), .algorithm(.sha3_512)],
    ]

    public static let spec = ToolSpec(
        id: "hash",
        name: LocalizedText("哈希计算", "Hash"),
        summary: LocalizedText(
            "MD5（32 位 / 16 位、大小写）、SHA-1/2/3、Keccak-256、SM3 国密、CRC32、xxHash64、BLAKE3，并可校验。",
            "MD5 (32 / 16 chars, either case), SHA-1/2/3, Keccak-256, SM3, CRC32, xxHash64 and BLAKE3, with digest checking."
        ),
        category: .crypto,
        keywords: ["md5", "sha1", "sha256", "sha512", "sha3", "crc32", "hash", "digest", "checksum", "哈希", "摘要", "加密",
                   "sha224", "sha384", "sm3", "国密", "keccak", "blake3", "xxhash", "md5 16", "md5 32", "32位小写", "32位大写", "校验", "hxjs"],
        symbol: "number",
        input: .required,
        inputLabel: LocalizedText("要计算哈希的内容", "Content to hash"),
        fields: [
            ToolField("algorithm", LocalizedText("算法", "Algorithm"), .choice(
                [ToolChoice("all", LocalizedText("全部", "All")), ToolChoice("common", LocalizedText("常用", "Common")),
                 ToolChoice("sha", LocalizedText("SHA 家族", "SHA family"))]
                + allItems.map { ToolChoice($0.id, LocalizedText($0.label(.zh), $0.label(.en))) }
            ), default: "all"),
            ToolField("encoding", LocalizedText("输入编码", "Input encoding"), .choice([
                ToolChoice("utf8", "UTF-8"),
                ToolChoice("utf16le", "UTF-16LE"),
                ToolChoice("latin1", "Latin-1"),
                ToolChoice("hex", LocalizedText("Hex 字节", "Hex bytes")),
                ToolChoice("base64", LocalizedText("Base64 字节", "Base64 bytes")),
            ]), default: "utf8", help: LocalizedText("先把输入按此编码转换成字节，再计算哈希", "The input is converted to bytes with this encoding before hashing")),
            ToolField("format", LocalizedText("输出格式", "Output"), .choice([
                ToolChoice("hex", "Hex"), ToolChoice("base64", "Base64"),
            ]), default: "hex"),
            ToolField("upper", LocalizedText("大写", "Uppercase"), .toggle, default: "0", visibleWhen: ToolCondition("format", is: "hex")),
            ToolField("expected", LocalizedText("校验", "Verify"), .text(placeholder: LocalizedText("粘贴期望的摘要（Hex / Base64 / sha256:… 均可）", "Paste the expected digest (hex, Base64, sha256:… all work)")),
                      default: ""),
        ],
        run: { input in try run(input) }
    )

    /// 按编码把输入转成字节
    public static func bytes(_ text: String, encoding: String, lang: Lang) throws -> [UInt8] {
        switch encoding {
        case "utf16le":
            return text.utf16.flatMap { [UInt8($0 & 0xFF), UInt8($0 >> 8)] }
        case "latin1":
            var out: [UInt8] = []
            out.reserveCapacity(text.unicodeScalars.count)
            for (i, s) in text.unicodeScalars.enumerated() {
                guard s.value <= 0xFF else {
                    throw ToolError(lang.t("第 \(i + 1) 个字符「\(s)」超出 Latin-1 范围，请改用 UTF-8",
                                           "Character \(i + 1) “\(s)” is outside Latin-1; use UTF-8 instead"))
                }
                out.append(UInt8(s.value))
            }
            return out
        case "hex":
            return try EncodeCryptoShared.decodeField(text, .hex, field: LocalizedText("输入", "Input"), lang: lang)
        case "base64":
            return try EncodeCryptoShared.decodeField(text, .base64, field: LocalizedText("输入", "Input"), lang: lang)
        default:
            return Array(text.utf8)
        }
    }

    /// 计算若干项；md5-16 取 32 位 MD5 的中间 16 位（第 9–24 位）
    public static func digests(_ items: [Item], _ data: [UInt8]) -> [Item: [UInt8]] {
        var out: [Item: [UInt8]] = [:]
        var md5: [UInt8]?
        for item in items {
            switch item {
            case .algorithm(let a):
                let d = Hash.digest(a, data)
                if a == .md5 { md5 = d }
                out[item] = d
            case .md5Half:
                let full = md5 ?? Hash.digest(.md5, data)
                md5 = full
                out[item] = Array(full[4..<12])
            }
        }
        return out
    }

    public static func format(_ digest: [UInt8], base64: Bool, uppercase: Bool) -> String {
        base64 ? Base64Codec.encode(digest) : HexCodec.encode(digest, uppercase: uppercase)
    }

    /// 国内常见的四种 MD5 写法：32 / 16 位 × 小写 / 大写（固定 Hex，不受大写开关影响）
    public static func md5Variants(_ md5: [UInt8]) -> [(id: String, label: LocalizedText, value: String)] {
        let full = HexCodec.encode(md5)
        let half = String(full.dropFirst(8).prefix(16))
        return [
            ("md5-32-lower", LocalizedText("MD5 32 位小写", "MD5 32 lowercase"), full),
            ("md5-32-upper", LocalizedText("MD5 32 位大写", "MD5 32 uppercase"), full.uppercased()),
            ("md5-16-lower", LocalizedText("MD5 16 位小写", "MD5 16 lowercase"), half),
            ("md5-16-upper", LocalizedText("MD5 16 位大写", "MD5 16 uppercase"), half.uppercased()),
        ]
    }

    // MARK: 校验

    public enum Match<ID: Hashable>: Hashable {
        case empty
        case invalid(LocalizedText)
        case match([ID], base64: Bool)
        case mismatch(byteLength: Int, sameLength: [ID], base64: Bool)
    }

    static func regex(_ pattern: String) -> NSRegularExpression? { try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) }
    static let fingerprintPrefix = regex("^[a-z][a-z0-9-]*\\s+fingerprint\\s*=\\s*")
    static let algoPrefix = regex("^([a-z][a-z0-9]*(?:-\\d+)?)\\s*[:=-]\\s*")
    static let knownAlgo = regex("^(md5|sha|sm3|crc|xxh|blake|keccak)")
    static let separatedHex = regex("^[0-9a-f]{2}(?:[:-][0-9a-f]{2})+$")
    static let sumLine = regex("^([0-9a-f]{8,})\\s+\\*?\\S")
    static let plainHex = regex("^(0x)?[0-9a-f]+$")
    static let pureHex = regex("^[0-9a-f]+$")
    static let base64Like = try? NSRegularExpression(pattern: "^[A-Za-z0-9+/_-]+={0,2}$")

    static func firstMatch(_ re: NSRegularExpression?, _ s: String) -> NSTextCheckingResult? {
        re?.firstMatch(in: s, range: NSRange(s.startIndex..., in: s))
    }

    /// 解析期望的摘要：去掉常见前缀与空白，优先按 Hex 解析，否则按 Base64；也接受 sha256sum 输出与冒号分隔的指纹
    public static func parseExpected(_ input: String) -> (bytes: [UInt8], base64: Bool)?? {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return .some(nil) }
        if let m = firstMatch(fingerprintPrefix, s), let r = Range(m.range, in: s) { s = String(s[r.upperBound...]) }
        if let m = firstMatch(algoPrefix, s), let name = Range(m.range(at: 1), in: s), firstMatch(knownAlgo, String(s[name])) != nil,
           let r = Range(m.range, in: s) {
            s = String(s[r.upperBound...])
        }
        var compact = s.filter { !$0.isWhitespace }
        if firstMatch(separatedHex, compact) != nil { compact = compact.filter { $0 != ":" && $0 != "-" } }
        if let m = firstMatch(sumLine, s), let r = Range(m.range(at: 1), in: s), firstMatch(pureHex, compact) == nil {
            compact = String(s[r])
        }
        if firstMatch(plainHex, compact) != nil {
            let hex = compact.lowercased().hasPrefix("0x") ? String(compact.dropFirst(2)) : compact
            if hex.count % 2 == 0, let b = try? HexCodec.decode(hex) { return .some((b, false)) }
        }
        if firstMatch(base64Like, compact) != nil, let b = try? Base64Codec.decode(compact) {
            return .some((b, true))
        }
        return nil
    }

    /// 在一组结果里查找与期望值一致的项（不区分大小写，Hex / Base64 均可）
    public static func match<ID: Hashable>(_ input: String, _ digests: [(ID, [UInt8])]) -> Match<ID> {
        guard let parsed = parseExpected(input) else {
            return .invalid(LocalizedText("无法识别期望值：请粘贴 Hex（如 900150…）或 Base64 格式的摘要", "Cannot read the expected value: paste a hex (like 900150…) or Base64 digest"))
        }
        guard let pair = parsed else { return .empty }
        let (bytes, base64) = pair
        let ids = digests.filter { ByteUtil.constantTimeEqual($0.1, bytes) }.map(\.0)
        if !ids.isEmpty { return .match(ids, base64: base64) }
        return .mismatch(byteLength: bytes.count, sameLength: digests.filter { $0.1.count == bytes.count }.map(\.0), base64: base64)
    }

    static func matchNotes(_ m: Match<String>, labels: [String: String], lang: Lang) -> [ToolNote] {
        switch m {
        case .empty: return []
        case .invalid(let msg): return [ToolNote(.warning, msg(lang))]
        case .match(let ids, _):
            let names = ids.compactMap { labels[$0] }.joined(separator: lang.t("、", ", "))
            return [ToolNote(.info, lang.t("✓ 校验通过：与 \(names) 一致", "✓ Match: same as \(names)"))]
        case .mismatch(let n, let same, _):
            let names = same.compactMap { labels[$0] }.joined(separator: lang.t("、", ", "))
            return [ToolNote(.warning, same.isEmpty
                ? lang.t("✗ 不匹配：期望值有 \(n) 字节，没有同样长度的算法", "✗ No match: the expected value is \(n) bytes and no algorithm has that length")
                : lang.t("✗ 不匹配：期望值有 \(n) 字节，同长度的算法有 \(names)", "✗ No match: the expected value is \(n) bytes; same-length algorithms: \(names)"))]
        }
    }

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let data = try bytes(input.text, encoding: input.string("encoding"), lang: lang)
        let key = input.string("algorithm")
        let items = presets[key] ?? allItems.filter { $0.id == key }
        let chosen = items.isEmpty ? allItems : items
        let base64 = input.string("format") == "base64"
        let upper = input.bool("upper")
        let results = digests(chosen, data)

        var outputs: [ToolOutput] = []
        for (i, item) in chosen.enumerated() {
            guard let d = results[item] else { continue }
            outputs.append(ToolOutput(id: item.id, label: item.label(lang), value: format(d, base64: base64, uppercase: upper), isPrimary: i == 0))
        }
        // MD5 常用格式：固定 Hex，不受大写与输出格式影响
        let md5 = results[.algorithm(.md5)] ?? Hash.digest(.md5, data)
        for v in md5Variants(md5) {
            outputs.append(ToolOutput(id: v.id, label: v.label(lang), value: v.value))
        }

        var notes = [ToolNote(.info, lang.t("输入 \(EncodeCryptoShared.formatBytes(data.count, lang: lang))", "Input: \(EncodeCryptoShared.formatBytes(data.count, lang: lang))"))]
        let weak = chosen.filter { if case .algorithm(let a) = $0 { return a.isWeak } else { return true } }
        if weak.count == chosen.count {
            notes.append(ToolNote(.info, lang.t("MD5 / SHA-1 / CRC32 / xxHash 已不适合安全用途，只适合做文件校验", "MD5, SHA-1, CRC32 and xxHash are not secure; use them only as checksums")))
        }
        let labels = Dictionary(uniqueKeysWithValues: chosen.map { ($0.id, $0.label(lang)) })
        notes += matchNotes(match(input.string("expected"), chosen.compactMap { item in results[item].map { (item.id, $0) } }), labels: labels, lang: lang)
        return ToolResult(outputs: outputs, notes: notes)
    }
}
