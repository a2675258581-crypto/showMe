import Foundation

// Base64 编解码：标准 / URL 安全、可省略填充、MIME 换行；
// 解码自动识别字符集、缺失填充、空白与 data: 前缀，非法字符给出行列；二进制结果显示十六进制并识别文件类型。

public enum Base64Tool {
    public static let spec = ToolSpec(
        id: "base64",
        name: LocalizedText("Base64 编解码", "Base64"),
        summary: LocalizedText(
            "文本的 Base64 编码、解码，支持 URL 安全字符集与中文。",
            "Encode and decode Base64, with the URL-safe alphabet and full Unicode support."
        ),
        category: .encode,
        keywords: ["base64", "encode", "decode", "btoa", "atob", "编码", "解码", "base64url", "bm"],
        symbol: "textformat",
        input: .required,
        inputLabel: LocalizedText("要编码的文本或 Base64", "Text or Base64"),
        fields: fields,
        run: { input in try run(input) }
    )

    static var fields: [ToolField] {
        var list: [ToolField] = [
            ToolField("mode", LocalizedText("操作", "Action"), .choice([
                ToolChoice("encode", LocalizedText("编码", "Encode")),
                ToolChoice("decode", LocalizedText("解码", "Decode")),
            ]), default: "encode"),
            ToolField("urlSafe", LocalizedText("URL 安全（- _）", "URL-safe (- _)"), .toggle, default: "0",
                      visibleWhen: ToolCondition("mode", is: "encode")),
            ToolField("noPadding", LocalizedText("省略 = 填充", "Omit = padding"), .toggle, default: "0",
                      visibleWhen: ToolCondition("mode", is: "encode")),
            ToolField("wrap", LocalizedText("每 76 字符换行（MIME）", "Wrap at 76 (MIME)"), .toggle, default: "0",
                      visibleWhen: ToolCondition("mode", is: "encode")),
        ]
        #if canImport(Darwin)
        list.append(ToolField("charset", LocalizedText("文本编码", "Charset"), .choice([
            ToolChoice("utf8", "UTF-8"),
            ToolChoice("gb18030", LocalizedText("GBK / GB18030", "GBK / GB18030")),
        ]), default: "utf8", help: LocalizedText("文本按此编码转成字节再做 Base64", "Text is converted to bytes with this charset")))
        #endif
        return list
    }

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let gbk = input.string("charset") == "gb18030"
        if input.string("mode") == "decode" { return try decode(input.text, lang: lang, gbk: gbk) }

        let bytes: [UInt8]
        if gbk {
            guard let b = Charset.gb18030Encode(input.text) else {
                throw ToolError(lang.t("当前平台不支持 GB18030 编码", "GB18030 is not available on this platform"))
            }
            bytes = b
        } else {
            bytes = Array(input.text.utf8)
        }
        let out = Base64Codec.encode(bytes, urlSafe: input.bool("urlSafe"), padding: !input.bool("noPadding"), lineWidth: input.bool("wrap") ? 76 : 0)
        let chars = out.utf8.count - out.utf8.filter { $0 == 10 }.count
        let overhead = bytes.isEmpty ? 0 : (Double(chars - bytes.count) / Double(bytes.count) * 1000).rounded() / 10
        let size = EncodeCryptoShared.formatBytes(bytes.count, lang: lang)
        return ToolResult(
            outputs: [.primary("Base64", out)],
            notes: [ToolNote(.info, lang.t("\(size) → \(chars) 字符 · 体积 +\(overhead)%", "\(size) → \(chars) characters · +\(overhead)% size"))]
        )
    }

    // MARK: 解码

    /// 解码时识别出的输入特征
    public struct Variant: Sendable, Hashable {
        /// 出现了 - 或 _
        public var urlSafe = false
        /// 出现了 + 或 /
        public var standard = false
        /// 末尾有 = 填充
        public var padded = false
        /// 缺少应有的填充
        public var missingPadding = false
        /// 含空白 / 换行
        public var whitespace = false
        /// 带 data: URL 前缀时的 MIME
        public var dataURLMime: String?
    }

    public struct DecodeFailure: Error, Sendable, Hashable {
        public var message: LocalizedText
        /// 出错位置（Unicode 标量下标，相对原始输入）
        public var index: Int
        public var line: Int
        public var column: Int

        public func toolError(_ lang: Lang) -> ToolError {
            ToolError(lang.t("第 \(line) 行第 \(column) 列：", "Line \(line), column \(column): ") + message(lang), line: line, column: column)
        }
    }

    /// 去掉 data:…;base64, 前缀，返回前缀长度（标量数）与 MIME
    static func dataURLPrefix(_ s: [Unicode.Scalar]) -> (length: Int, mime: String)? {
        var i = 0
        while i < s.count, s[i].properties.isWhitespace { i += 1 }
        let start = i
        let head = EncodeCryptoShared.string(s[start..<min(s.count, start + 5)]).lowercased()
        guard head == "data:" else { return nil }
        guard let comma = s[start...].firstIndex(of: ",") else { return nil }
        let header = EncodeCryptoShared.string(s[(start + 5)..<comma])
        guard header.lowercased().hasSuffix(";base64") else { return nil }
        let mime = header.split(separator: ";", omittingEmptySubsequences: false).first.map {
            $0.trimmingCharacters(in: .whitespaces).lowercased()
        } ?? ""
        return (comma + 1, mime.isEmpty ? "text/plain" : mime)
    }

    /// 宽松解码：自动接受 URL 安全字符、缺失填充、空白与换行、data: URL 前缀。非法字符给出精确的行列。
    public static func decodeDetailed(_ text: String) -> Result<([UInt8], Variant), DecodeFailure> {
        let s = Array(text.unicodeScalars)
        var variant = Variant()
        var start = 0
        if let prefix = dataURLPrefix(s) {
            start = prefix.length
            variant.dataURLMime = prefix.mime
        }
        func fail(_ index: Int, _ message: LocalizedText) -> Result<([UInt8], Variant), DecodeFailure> {
            var loc = LineLocator(s)
            let (line, column) = loc.locate(index)
            return .failure(DecodeFailure(message: message, index: index, line: line, column: column))
        }
        var values: [UInt8] = []
        values.reserveCapacity(s.count)
        var pads = 0
        var firstPad = -1
        for i in start..<s.count {
            let v = s[i].value
            if Base64Codec.isSpace(v) { variant.whitespace = true; continue }
            if v == 61 {
                if pads == 0 { firstPad = i }
                pads += 1
                if pads > 2 { return fail(i, LocalizedText("填充符 = 最多只能有 2 个", "There can be at most 2 “=” padding characters")) }
                continue
            }
            let d: Int8 = v < 128 ? Base64Codec.decodeTable[Int(v)] : -1
            if d < 0 {
                let ch = EncodeCryptoShared.describeChar(s[i])
                return fail(i, LocalizedText(
                    "非法字符 \(ch.zh)。Base64 只能包含 A–Z、a–z、0–9、+ /（或 URL 安全的 - _）以及末尾的 =",
                    "Invalid character \(ch.en). Base64 may only contain A–Z, a–z, 0–9, + / (or URL-safe - _) and trailing ="
                ))
            }
            if pads > 0 {
                return fail(firstPad, LocalizedText(
                    "填充符 = 只能出现在末尾，但它后面还有数据（可能是两段 Base64 被拼在了一起）",
                    "Padding “=” must come last, but more data follows it (two Base64 strings may have been joined)"
                ))
            }
            if v == 43 || v == 47 { variant.standard = true } else if v == 45 || v == 95 { variant.urlSafe = true }
            values.append(UInt8(d))
        }
        let rem = values.count % 4
        if rem == 1 {
            var last = s.count - 1
            while last >= start && (Base64Codec.isSpace(s[last].value) || s[last] == "=") { last -= 1 }
            return fail(max(last, start), LocalizedText(
                "长度不正确：共 \(values.count) 个有效字符，最后一组只剩 1 个字符（有效字符数除以 4 的余数不能为 1），数据可能被截断",
                "Wrong length: \(values.count) data characters leave a final group of 1 (the count modulo 4 cannot be 1), so the data may be truncated"
            ))
        }
        if pads > 0 && (rem == 0 || rem + pads != 4) {
            return fail(firstPad, rem == 0
                ? LocalizedText("多余的填充符 =：数据长度已是 4 的倍数，不需要填充", "Extra “=” padding: the data length is already a multiple of 4")
                : LocalizedText("填充符数量不对：最后一组有 \(rem) 个字符，应补 \(4 - rem) 个 =，实际为 \(pads) 个",
                                "Wrong amount of padding: the final group has \(rem) characters and needs \(4 - rem) “=”, but has \(pads)"))
        }
        variant.padded = pads > 0
        variant.missingPadding = pads == 0 && rem != 0
        return .success((Base64Codec.assemble(values), variant))
    }

    static func decode(_ text: String, lang: Lang, gbk: Bool) throws -> ToolResult {
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return ToolResult() }
        let bytes: [UInt8]
        let variant: Variant
        switch decodeDetailed(text) {
        case .failure(let f): throw f.toolError(lang)
        case .success(let r): (bytes, variant) = r
        }
        var notes: [ToolNote] = []
        var tags: [String] = []
        if variant.standard && variant.urlSafe {
            notes.append(ToolNote(.warning, lang.t("混用了 + / 与 - _ 两种字符集", "Mixes + / with - _")))
        } else {
            tags.append(variant.urlSafe ? lang.t("URL 安全字符集", "URL-safe alphabet") : lang.t("标准字符集", "Standard alphabet"))
        }
        if variant.padded { tags.append(lang.t("有 = 填充", "padded")) }
        if variant.missingPadding { tags.append(lang.t("省略了填充", "padding omitted")) }
        if variant.whitespace { tags.append(lang.t("含空白 / 换行", "contains whitespace")) }
        if let mime = variant.dataURLMime { tags.append("data: \(mime)") }
        let bom = bytes.count >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF
        if bom { tags.append("UTF-8 BOM") }

        let type = FileTypeSniffer.detect(bytes)
        let size = EncodeCryptoShared.formatBytes(bytes.count, lang: lang)

        if gbk, let s = Charset.gb18030Decode(bytes) {
            notes.insert(ToolNote(.info, lang.t("识别到：", "Detected: ") + tags.joined(separator: lang.t("、", ", "))), at: 0)
            notes.append(ToolNote(.info, lang.t("解码得到 \(size) · 按 GB18030 解释", "Decoded \(size) · read as GB18030")))
            return ToolResult(outputs: [.primary(lang.t("文本", "Text"), s)], notes: notes)
        }

        if let invalidAt = UTF8Check.firstInvalid(bytes) {
            // 二进制：显示十六进制，不能当文本
            if let type, type.kind != .text { tags.append(type.label(lang)) }
            notes.insert(ToolNote(.info, lang.t("识别到：", "Detected: ") + tags.joined(separator: lang.t("、", ", "))), at: 0)
            let what = type.map { lang.t("，看起来是 \($0.label.zh)（\($0.mime)）", ", and looks like a \($0.label.en) (\($0.mime))") } ?? ""
            notes.append(ToolNote(.warning, lang.t(
                "解码得到 \(size) 的二进制数据，从第 \(invalidAt + 1) 个字节起不是有效的 UTF-8 文本\(what)。下面显示十六进制。",
                "Decoded \(size) of binary data that is not valid UTF-8 from byte \(invalidAt + 1)\(what). Showing hex below."
            )))
            let limit = 64 * 1024
            var outputs: [ToolOutput] = [ToolOutput(id: "result", label: lang.t("十六进制", "Hex"), value: ByteUtil.hexDump(bytes, maxBytes: limit, lang: lang), isPrimary: true)]
            outputs.append(ToolOutput(id: "hex", label: "Hex", value: HexCodec.encode(Array(bytes.prefix(limit)))))
            return ToolResult(outputs: outputs, notes: notes)
        }

        var textBytes = bytes
        if bom { textBytes.removeFirst(3) }
        let decoded = String(decoding: textBytes, as: UTF8.self)
        if let type, type.kind != .text { tags.append(type.label(lang)) }
        notes.insert(ToolNote(.info, lang.t("识别到：", "Detected: ") + tags.joined(separator: lang.t("、", ", "))), at: 0)
        let count = decoded.unicodeScalars.count
        notes.append(ToolNote(.info, lang.t("解码得到 \(size) · \(count) 个字符 · UTF-8", "Decoded \(size) · \(count) characters · UTF-8")))
        let language: String? = switch type?.ext {
        case "json": "json"
        case "xml", "svg": "xml"
        case "html": "html"
        default: nil
        }
        return ToolResult(outputs: [.primary(lang.t("文本", "Text"), decoded, language: language)], notes: notes)
    }
}

/// GBK / GB18030 文本编码：只在 Apple 平台可用（Linux 上返回 nil）
enum Charset {
    #if canImport(Darwin)
    static let gb18030: String.Encoding = {
        let cf = CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)
        return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))
    }()
    #endif

    static func gb18030Encode(_ text: String) -> [UInt8]? {
        #if canImport(Darwin)
        return text.data(using: gb18030).map { [UInt8]($0) }
        #else
        return nil
        #endif
    }

    static func gb18030Decode(_ bytes: [UInt8]) -> String? {
        #if canImport(Darwin)
        return String(data: Data(bytes), encoding: gb18030)
        #else
        return nil
        #endif
    }
}
