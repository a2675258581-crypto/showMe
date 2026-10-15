import Foundation

// 分组密码的公共部分：工作模式（ECB / CBC / CFB / OFB / CTR）、填充与错误。
// 用法：`try AES(key: k).encrypt(data, mode: .cbc, iv: iv, padding: .pkcs7)`

/// 加解密出错时指明是哪个输入的问题，界面可以据此标红
public enum CipherField: String, Sendable, Hashable {
    case key, iv, input
}

public struct CipherError: Error, Sendable, Hashable {
    public var message: LocalizedText
    public var field: CipherField?

    public init(_ message: LocalizedText, field: CipherField? = nil) {
        self.message = message
        self.field = field
    }
}

public protocol BlockCipher: Sendable {
    /// 分组长度（字节）
    var blockSize: Int { get }
    /// 原地加密 data[offset..<offset+blockSize]
    func encryptBlock(_ data: inout [UInt8], at offset: Int)
    func decryptBlock(_ data: inout [UInt8], at offset: Int)
}

public enum CipherMode: String, CaseIterable, Sendable {
    case ecb, cbc, cfb, ofb, ctr

    public var label: String { rawValue.uppercased() }
    public var needsIV: Bool { self != .ecb }
    /// ECB / CBC 要求数据按分组对齐；其余是流式模式
    public var needsAlignment: Bool { self == .ecb || self == .cbc }
}

public enum CipherPadding: String, CaseIterable, Sendable {
    /// 补 N 个值为 N 的字节（等同 PKCS5）
    case pkcs7
    /// 补 0x00；解密时去掉末尾所有 0x00
    case zero
    /// 不填充
    case none
    /// 0x00… + 最后一字节为长度
    case ansiX923
    /// 0x80 后补 0x00（ISO/IEC 9797-1 方法 2）
    case iso97971
    /// 随机字节 + 最后一字节为长度
    case iso10126

    public var label: String {
        switch self {
        case .pkcs7: "PKCS7"
        case .zero: "ZeroPadding"
        case .none: "NoPadding"
        case .ansiX923: "ANSI X.923"
        case .iso97971: "ISO/IEC 9797-1"
        case .iso10126: "ISO 10126"
        }
    }

    /// 填充；iso10126 的随机字节由 random 提供
    public func pad(_ data: [UInt8], blockSize: Int, random: (Int) -> [UInt8] = { [UInt8](repeating: 0, count: $0) }) -> [UInt8] {
        if self == .none { return data }
        let rem = data.count % blockSize
        if self == .zero { return rem == 0 ? data : data + [UInt8](repeating: 0, count: blockSize - rem) }
        let n = blockSize - rem
        var tail = [UInt8](repeating: 0, count: n)
        switch self {
        case .pkcs7: tail = [UInt8](repeating: UInt8(n), count: n)
        case .ansiX923: tail[n - 1] = UInt8(n)
        case .iso10126:
            let r = random(n - 1)
            for i in 0..<min(n - 1, r.count) { tail[i] = r[i] }
            tail[n - 1] = UInt8(n)
        case .iso97971: tail[0] = 0x80
        case .zero, .none: break
        }
        return data + tail
    }

    static let failHint = LocalizedText(
        "通常意味着密钥、IV、模式或填充方式与加密时不一致。",
        "This usually means the key, IV, mode or padding differs from the one used to encrypt."
    )

    /// 去掉填充并严格校验
    public func unpad(_ data: [UInt8], blockSize: Int) throws -> [UInt8] {
        switch self {
        case .none: return data
        case .zero:
            var end = data.count
            while end > 0 && data[end - 1] == 0 { end -= 1 }
            return Array(data[0..<end])
        default: break
        }
        guard let last = data.last else {
            throw CipherError(LocalizedText("密文为空，无法去除填充", "The ciphertext is empty, so there is no padding to remove"), field: .input)
        }
        let hint = CipherPadding.failHint
        if self == .iso97971 {
            var i = data.count - 1
            while i >= 0 && data[i] == 0 && data.count - i <= blockSize { i -= 1 }
            guard i >= 0, data[i] == 0x80, data.count - i <= blockSize else {
                throw CipherError(LocalizedText(
                    "填充校验失败：末尾不是合法的 ISO/IEC 9797-1 填充（0x80 00…）。" + hint.zh,
                    "Padding check failed: the data does not end with valid ISO/IEC 9797-1 padding (0x80 00…). " + hint.en
                ))
            }
            return Array(data[0..<i])
        }
        let n = Int(last)
        let hexLast = String(format: "0x%02x", last)
        guard n >= 1, n <= blockSize, n <= data.count else {
            throw CipherError(LocalizedText(
                "填充校验失败：最后一个字节是 \(hexLast)，不是合法的 \(label) 填充长度（应为 1–\(blockSize)）。" + hint.zh,
                "Padding check failed: the last byte is \(hexLast), which is not a valid \(label) padding length (1–\(blockSize)). " + hint.en
            ))
        }
        for i in (data.count - n)..<(data.count - 1) {
            let expected: UInt8 = self == .pkcs7 ? last : self == .ansiX923 ? 0 : data[i]
            if data[i] != expected {
                let e = String(format: "0x%02x", expected), a = String(format: "0x%02x", data[i])
                throw CipherError(LocalizedText(
                    "填充校验失败：\(label) 填充的倒数第 \(data.count - i) 个字节应为 \(e)，实际是 \(a)。" + hint.zh,
                    "Padding check failed: byte \(data.count - i) from the end of the \(label) padding should be \(e) but is \(a). " + hint.en
                ))
            }
        }
        return Array(data[0..<(data.count - n)])
    }
}

extension BlockCipher {
    func checkIV(_ iv: [UInt8], mode: CipherMode, name: String) throws {
        guard mode.needsIV else { return }
        if iv.isEmpty {
            throw CipherError(LocalizedText("\(mode.label) 模式需要 IV（\(blockSize) 字节）", "\(mode.label) mode needs an IV (\(blockSize) bytes)"), field: .iv)
        }
        if iv.count != blockSize {
            throw CipherError(LocalizedText(
                "\(name) 的 IV 必须是 \(blockSize) 字节，当前 \(iv.count) 字节",
                "The \(name) IV must be \(blockSize) bytes, got \(iv.count) bytes"
            ), field: .iv)
        }
    }

    var cipherName: String {
        switch self {
        case is AES: "AES"
        case is TripleDES: "3DES"
        default: "DES"
        }
    }

    /// 加密：先填充再按模式处理。NoPadding 下 ECB / CBC 要求明文按分组对齐。
    public func encrypt(_ plaintext: [UInt8], mode: CipherMode, iv: [UInt8] = [], padding: CipherPadding = .pkcs7,
                        random: (Int) -> [UInt8] = { [UInt8](repeating: 0, count: $0) }) throws -> [UInt8] {
        try checkIV(iv, mode: mode, name: cipherName)
        let bs = blockSize
        if padding == .none && mode.needsAlignment && plaintext.count % bs != 0 {
            let missing = bs - plaintext.count % bs
            throw CipherError(LocalizedText(
                "NoPadding 下 \(mode.label) 模式要求明文长度是 \(bs) 字节的整数倍，当前 \(plaintext.count) 字节（还差 \(missing) 字节）。可改用 PKCS7 填充。",
                "With NoPadding, \(mode.label) mode needs the plaintext length to be a multiple of \(bs) bytes; it is \(plaintext.count) bytes (\(missing) short). Try PKCS7 padding."
            ), field: .input)
        }
        var data = padding.pad(plaintext, blockSize: bs, random: random)
        process(&data, mode: mode, iv: iv, encrypt: true)
        return data
    }

    /// 解密：按模式处理后严格去除填充
    public func decrypt(_ ciphertext: [UInt8], mode: CipherMode, iv: [UInt8] = [], padding: CipherPadding = .pkcs7) throws -> [UInt8] {
        try checkIV(iv, mode: mode, name: cipherName)
        let bs = blockSize
        if ciphertext.count % bs != 0 && (mode.needsAlignment || padding != .none) {
            throw CipherError(LocalizedText(
                "密文长度 \(ciphertext.count) 字节不是 \(bs) 字节的整数倍，" + (mode.needsAlignment ? "\(mode.label) 模式无法解密" : "与所选填充方式不符") + "。请检查密文是否完整、密文编码（Base64 / Hex）是否选对。",
                "The ciphertext is \(ciphertext.count) bytes, not a multiple of \(bs); " + (mode.needsAlignment ? "\(mode.label) mode cannot decrypt it" : "that does not fit the selected padding") + ". Check that the ciphertext is complete and its encoding (Base64 / Hex) is right."
            ), field: .input)
        }
        var data = ciphertext
        process(&data, mode: mode, iv: iv, encrypt: false)
        return try padding.unpad(data, blockSize: bs)
    }

    /// 按模式原地变换（数据长度已由调用方处理好；流式模式允许最后一块不完整）
    func process(_ data: inout [UInt8], mode: CipherMode, iv: [UInt8], encrypt: Bool) {
        let bs = blockSize
        let n = data.count
        switch mode {
        case .ecb:
            var off = 0
            while off + bs <= n {
                if encrypt { encryptBlock(&data, at: off) } else { decryptBlock(&data, at: off) }
                off += bs
            }
        case .cbc:
            var prev = iv
            var off = 0
            while off + bs <= n {
                if encrypt {
                    for i in 0..<bs { data[off + i] ^= prev[i] }
                    encryptBlock(&data, at: off)
                    for i in 0..<bs { prev[i] = data[off + i] }
                } else {
                    let saved = Array(data[off..<(off + bs)])
                    decryptBlock(&data, at: off)
                    for i in 0..<bs { data[off + i] ^= prev[i] }
                    prev = saved
                }
                off += bs
            }
        case .cfb:
            var reg = iv
            var off = 0
            while off < n {
                encryptBlock(&reg, at: 0)
                let len = min(bs, n - off)
                for i in 0..<len {
                    let c = data[off + i]
                    data[off + i] = c ^ reg[i]
                    // 反馈的始终是密文
                    reg[i] = encrypt ? data[off + i] : c
                }
                off += bs
            }
        case .ofb:
            var reg = iv
            var off = 0
            while off < n {
                encryptBlock(&reg, at: 0)
                let len = min(bs, n - off)
                for i in 0..<len { data[off + i] ^= reg[i] }
                off += bs
            }
        case .ctr:
            var counter = iv
            var off = 0
            while off < n {
                var stream = counter
                encryptBlock(&stream, at: 0)
                let len = min(bs, n - off)
                for i in 0..<len { data[off + i] ^= stream[i] }
                // 整个计数器块按大端整数 +1（与 OpenSSL / Java / Go 一致）
                var k = bs - 1
                while k >= 0 {
                    counter[k] &+= 1
                    if counter[k] != 0 { break }
                    k -= 1
                }
                off += bs
            }
        }
    }
}

// MARK: - RC4

/// RC4 流密码（已不安全，仅供兼容旧系统）
public struct RC4: Sendable {
    let key: [UInt8]

    public init(key: [UInt8]) throws {
        guard !key.isEmpty, key.count <= 256 else {
            throw CipherError(LocalizedText(
                key.isEmpty ? "密钥不能为空" : "RC4 密钥最长 256 字节，当前 \(key.count) 字节",
                key.isEmpty ? "The key must not be empty" : "An RC4 key is at most 256 bytes, got \(key.count) bytes"
            ), field: .key)
        }
        self.key = key
    }

    /// 加密与解密相同
    public func process(_ data: [UInt8]) -> [UInt8] {
        var s = [UInt8](0...255)
        var j = 0
        for i in 0..<256 {
            j = (j + Int(s[i]) + Int(key[i % key.count])) & 255
            s.swapAt(i, j)
        }
        var out = data
        var i = 0
        j = 0
        for k in 0..<out.count {
            i = (i + 1) & 255
            j = (j + Int(s[i])) & 255
            s.swapAt(i, j)
            out[k] ^= s[(Int(s[i]) + Int(s[j])) & 255]
        }
        return out
    }
}
