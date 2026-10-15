import Foundation

// 字节编解码：Hex / Base64 / Base64URL / UTF-8 校验。
// 哈希、HMAC、AES/DES、JWT、RSA 共用；解析失败时抛出带位置的 ByteDecodeError。

/// 字节解析失败：双语说明 + 出错字符在输入里的位置（按 Unicode 标量计，0 起）。
public struct ByteDecodeError: Error, Sendable, Hashable {
    public var message: LocalizedText
    public var position: Int?

    public init(_ message: LocalizedText, position: Int? = nil) {
        self.message = message
        self.position = position
    }

    public func text(_ lang: Lang) -> String { message(lang) }
}

/// 输入文本按什么编码转成字节
public enum ByteEncoding: String, CaseIterable, Sendable {
    case utf8, hex, base64

    public var label: String {
        switch self {
        case .utf8: "UTF-8"
        case .hex: "Hex"
        case .base64: "Base64"
        }
    }

    /// 按编码把用户输入的文本转成字节
    public func decode(_ text: String) throws -> [UInt8] {
        switch self {
        case .utf8: Array(text.utf8)
        case .hex: try HexCodec.decode(text)
        case .base64: try Base64Codec.decode(text)
        }
    }

    /// 把字节按编码显示（UTF-8 非法序列替换为 U+FFFD）
    public func encode(_ bytes: [UInt8], uppercase: Bool = false) -> String {
        switch self {
        case .utf8: String(decoding: bytes, as: UTF8.self)
        case .hex: HexCodec.encode(bytes, uppercase: uppercase)
        case .base64: Base64Codec.encode(bytes)
        }
    }
}

/// 字符的可读写法：可见字符原样，不可见字符写成 U+XXXX
func describeScalar(_ s: Unicode.Scalar) -> String {
    let v = s.value
    if v < 0x20 || v == 0x7F || s.properties.generalCategory == .format || s.properties.isWhitespace {
        return String(format: "U+%04X", v)
    }
    return String(s)
}

// MARK: - Hex

public enum HexCodec {
    static let lowerDigits: [UInt8] = Array("0123456789abcdef".utf8)
    static let upperDigits: [UInt8] = Array("0123456789ABCDEF".utf8)

    public static func encode(_ bytes: [UInt8], uppercase: Bool = false, separator: String = "") -> String {
        let digits = uppercase ? upperDigits : lowerDigits
        let sep = Array(separator.utf8)
        var out: [UInt8] = []
        out.reserveCapacity(bytes.count * (2 + sep.count))
        for (i, b) in bytes.enumerated() {
            if i > 0 && !sep.isEmpty { out.append(contentsOf: sep) }
            out.append(digits[Int(b >> 4)])
            out.append(digits[Int(b & 15)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    static func nibble(_ v: UInt32) -> UInt8? {
        switch v {
        case 0x30...0x39: UInt8(v - 0x30)
        case 0x41...0x46: UInt8(v - 0x41 + 10)
        case 0x61...0x66: UInt8(v - 0x61 + 10)
        default: nil
        }
    }

    static func isSeparator(_ v: UInt32) -> Bool {
        v == 0x20 || (v >= 0x09 && v <= 0x0D) || v == 0x3A || v == 0x2C || v == 0x3B || v == 0x2D
    }

    /// 宽松解析：忽略空白、冒号、逗号、分号、短横线分隔，允许整体或逐字节的 0x 前缀。
    public static func decode(_ text: String) throws -> [UInt8] {
        let scalars = Array(text.unicodeScalars)
        var out: [UInt8] = []
        out.reserveCapacity(scalars.count / 2)
        var high: UInt8? = nil
        var lastDigitAt = 0
        var digitCount = 0
        var i = 0
        while i < scalars.count {
            let v = scalars[i].value
            // 0x 前缀：只在开头或分隔符之后出现时当作前缀
            if v == 0x30, i + 1 < scalars.count, scalars[i + 1] == "x" || scalars[i + 1] == "X",
               i == 0 || isSeparator(scalars[i - 1].value), high == nil {
                i += 2
                continue
            }
            if isSeparator(v) {
                i += 1
                continue
            }
            guard let n = nibble(v) else {
                let ch = describeScalar(scalars[i])
                throw ByteDecodeError(LocalizedText(
                    "Hex 第 \(i + 1) 个字符「\(ch)」不是十六进制数字（只允许 0-9、a-f）",
                    "Hex character \(i + 1) “\(ch)” is not a hex digit (only 0-9 and a-f are allowed)"
                ), position: i)
            }
            digitCount += 1
            lastDigitAt = i
            if let h = high {
                out.append(h << 4 | n)
                high = nil
            } else {
                high = n
            }
            i += 1
        }
        if high != nil {
            throw ByteDecodeError(LocalizedText(
                "Hex 长度为奇数（\(digitCount) 个数字），每个字节需要两位十六进制",
                "Hex has an odd number of digits (\(digitCount)); each byte needs two"
            ), position: lastDigitAt)
        }
        return out
    }
}

// MARK: - Base64

public enum Base64Codec {
    static let standardAlphabet: [UInt8] = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".utf8)
    static let urlAlphabet: [UInt8] = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".utf8)

    /// ASCII → 6 位值，同时接受标准与 URL 安全字符；-1 表示非法
    static let decodeTable: [Int8] = {
        var t = [Int8](repeating: -1, count: 128)
        for i in 0..<64 {
            t[Int(standardAlphabet[i])] = Int8(i)
            t[Int(urlAlphabet[i])] = Int8(i)
        }
        return t
    }()

    /// 编码。lineWidth > 0 时每行最多这么多字符（MIME 为 76），用 \n 分行。
    public static func encode(_ bytes: [UInt8], urlSafe: Bool = false, padding: Bool = true, lineWidth: Int = 0) -> String {
        let alpha = urlSafe ? urlAlphabet : standardAlphabet
        var out: [UInt8] = []
        out.reserveCapacity((bytes.count + 2) / 3 * 4)
        let full = bytes.count - bytes.count % 3
        var i = 0
        while i < full {
            let n = UInt32(bytes[i]) << 16 | UInt32(bytes[i + 1]) << 8 | UInt32(bytes[i + 2])
            out.append(alpha[Int(n >> 18 & 63)])
            out.append(alpha[Int(n >> 12 & 63)])
            out.append(alpha[Int(n >> 6 & 63)])
            out.append(alpha[Int(n & 63)])
            i += 3
        }
        let rest = bytes.count - full
        if rest == 1 {
            let n = UInt32(bytes[full]) << 16
            out.append(alpha[Int(n >> 18 & 63)])
            out.append(alpha[Int(n >> 12 & 63)])
            if padding { out.append(61); out.append(61) }
        } else if rest == 2 {
            let n = UInt32(bytes[full]) << 16 | UInt32(bytes[full + 1]) << 8
            out.append(alpha[Int(n >> 18 & 63)])
            out.append(alpha[Int(n >> 12 & 63)])
            out.append(alpha[Int(n >> 6 & 63)])
            if padding { out.append(61) }
        }
        if lineWidth > 0 && out.count > lineWidth {
            var wrapped: [UInt8] = []
            wrapped.reserveCapacity(out.count + out.count / lineWidth)
            for (k, c) in out.enumerated() {
                if k > 0 && k % lineWidth == 0 { wrapped.append(10) }
                wrapped.append(c)
            }
            out = wrapped
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// Base64URL（无填充），JWT 等使用
    public static func encodeURL(_ bytes: [UInt8]) -> String {
        encode(bytes, urlSafe: true, padding: false)
    }

    static func isSpace(_ v: UInt32) -> Bool { v == 0x20 || v == 0x0A || v == 0x0D || v == 0x09 || v == 0x0C || v == 0x0B }

    /// 宽松解码：同时接受标准与 URL 安全字母表，忽略空白，允许缺省的 = 填充。
    /// strictURL 为 true 时只接受 Base64URL（JWT 用），遇到空白、+ / = 报错。
    /// label 是错误信息里的字段名，如「Payload」「密钥（Base64）」。
    public static func decode(_ text: String, strictURL: Bool = false, label: LocalizedText = LocalizedText("Base64", "Base64")) throws -> [UInt8] {
        var values: [UInt8] = []
        values.reserveCapacity(text.utf8.count)
        var padStarted = false
        var index = 0
        for scalar in text.unicodeScalars {
            defer { index += 1 }
            let v = scalar.value
            let pos = index + 1
            if isSpace(v) {
                if strictURL {
                    throw ByteDecodeError(LocalizedText("\(label.zh) 第 \(pos) 个字符是空白", "\(label.en) character \(pos) is whitespace"), position: index)
                }
                continue
            }
            if v == 61 {
                if strictURL {
                    throw ByteDecodeError(LocalizedText(
                        "\(label.zh) 不应包含「=」填充（第 \(pos) 个字符）",
                        "\(label.en) must not contain “=” padding (character \(pos))"
                    ), position: index)
                }
                padStarted = true
                continue
            }
            let ch = describeScalar(scalar)
            if padStarted {
                throw ByteDecodeError(LocalizedText(
                    "\(label.zh) 第 \(pos) 个字符「\(ch)」出现在「=」填充之后",
                    "\(label.en) character \(pos) “\(ch)” comes after the “=” padding"
                ), position: index)
            }
            let d: Int8 = v < 128 ? decodeTable[Int(v)] : -1
            let wrongAlphabet = strictURL && (v == 43 || v == 47)
            if d < 0 || wrongAlphabet {
                throw ByteDecodeError(LocalizedText(
                    "\(label.zh) 第 \(pos) 个字符「\(ch)」不合法" + (wrongAlphabet ? "（Base64URL 应使用 - 和 _ 代替 + 和 /）" : ""),
                    "\(label.en) character \(pos) “\(ch)” is invalid" + (wrongAlphabet ? " (Base64URL uses - and _ instead of + and /)" : "")
                ), position: index)
            }
            values.append(UInt8(d))
        }
        if values.count % 4 == 1 {
            throw ByteDecodeError(LocalizedText(
                "\(label.zh) 长度不正确：去掉填充后有 \(values.count) 个字符，除以 4 余 1，末尾可能被截断",
                "\(label.en) has the wrong length: \(values.count) characters without padding leaves a remainder of 1 when divided by 4, so it may be truncated"
            ))
        }
        return assemble(values)
    }

    /// 6 位值数组 → 字节（长度已校验过余数不为 1）
    static func assemble(_ values: [UInt8]) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(values.count * 3 / 4)
        var k = 0
        while k + 3 < values.count {
            let n = UInt32(values[k]) << 18 | UInt32(values[k + 1]) << 12 | UInt32(values[k + 2]) << 6 | UInt32(values[k + 3])
            out.append(UInt8(n >> 16 & 255))
            out.append(UInt8(n >> 8 & 255))
            out.append(UInt8(n & 255))
            k += 4
        }
        let rest = values.count - k
        if rest == 2 {
            let n = UInt32(values[k]) << 18 | UInt32(values[k + 1]) << 12
            out.append(UInt8(n >> 16 & 255))
        } else if rest == 3 {
            let n = UInt32(values[k]) << 18 | UInt32(values[k + 1]) << 12 | UInt32(values[k + 2]) << 6
            out.append(UInt8(n >> 16 & 255))
            out.append(UInt8(n >> 8 & 255))
        }
        return out
    }
}

// MARK: - UTF-8

public enum UTF8Check {
    /// 第一个非法 UTF-8 序列的字节偏移；全部合法返回 nil
    public static func firstInvalid(_ bytes: [UInt8]) -> Int? {
        bytes.withUnsafeBufferPointer { b in
            let n = b.count
            var i = 0
            while i < n {
                let c = b[i]
                if c < 0x80 { i += 1; continue }
                let need: Int
                let minimum: UInt32
                switch c {
                case 0xC2...0xDF: need = 1; minimum = 0x80
                case 0xE0...0xEF: need = 2; minimum = 0x800
                case 0xF0...0xF4: need = 3; minimum = 0x10000
                default: return i
                }
                if i + need >= n { return i }
                var cp = UInt32(c) & (0x3F >> UInt32(need))
                for k in 1...need {
                    let x = b[i + k]
                    if x & 0xC0 != 0x80 { return i }
                    cp = cp << 6 | UInt32(x & 0x3F)
                }
                if cp < minimum || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF) { return i }
                i += need + 1
            }
            return nil
        }
    }

    /// 严格解码；不合法时返回 nil
    public static func decode(_ bytes: [UInt8]) -> String? {
        firstInvalid(bytes) == nil ? String(decoding: bytes, as: UTF8.self) : nil
    }

    /// 严格解码，失败时抛出带字节位置的错误
    public static func decodeOrThrow(_ bytes: [UInt8]) throws -> String {
        if let at = firstInvalid(bytes) {
            let hex = String(format: "0x%02x", bytes[at])
            throw ByteDecodeError(LocalizedText(
                "不是有效的 UTF-8 文本（第 \(at + 1) 个字节 \(hex) 起）",
                "is not valid UTF-8 text (from byte \(at + 1), \(hex))"
            ), position: at)
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}

// MARK: - 其他小工具

public enum ByteUtil {
    /// 常数时间比较，用于校验签名
    public static func constantTimeEqual(_ a: [UInt8], _ b: [UInt8]) -> Bool {
        guard a.count == b.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<a.count { diff |= a[i] ^ b[i] }
        return diff == 0
    }

    /// xxd 风格的十六进制转储，最多 maxBytes 字节
    public static func hexDump(_ bytes: [UInt8], maxBytes: Int = .max, lang: Lang = .zh) -> String {
        let total = min(bytes.count, maxBytes)
        var lines: [String] = []
        var off = 0
        while off < total {
            let end = min(off + 16, total)
            var hex = ""
            var ascii = ""
            for i in 0..<16 {
                if i == 8 { hex += " " }
                if off + i < end {
                    let b = bytes[off + i]
                    hex += String(format: "%02x ", b)
                    ascii += b >= 0x20 && b < 0x7F ? String(UnicodeScalar(b)) : "."
                } else {
                    hex += "   "
                }
            }
            lines.append(String(format: "%08x  ", off) + hex + " |" + ascii + "|")
            off += 16
        }
        if bytes.count > total {
            lines.append(lang.t("… 其余 \(bytes.count - total) 字节未显示", "… \(bytes.count - total) more bytes not shown"))
        }
        return lines.joined(separator: "\n")
    }
}
