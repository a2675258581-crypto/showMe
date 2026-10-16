import Foundation

// 对称加解密：AES / DES / 3DES / RC4，分组模式 CBC / ECB / CFB / OFB / CTR，多种填充；
// 密钥与 IV 可按 UTF-8 / Hex / Base64 解析，或用 CryptoJS / OpenSSL 兼容的口令模式（Salted__ + EVP_BytesToKey MD5）。
// 结果与 crypto-js 一致（CTR 计数器按整块大端 +1，与 OpenSSL 相同）。

public enum AESDESTool {
    public enum Algorithm: String, CaseIterable, Sendable {
        case aes = "AES", des = "DES", tripleDES = "3DES", rc4 = "RC4"

        public var blockSize: Int {
            switch self {
            case .aes: 16
            case .des, .tripleDES: 8
            case .rc4: 0
            }
        }

        /// 口令模式派生的密钥长度（与 CryptoJS 默认一致）
        public var passphraseKeySize: Int {
            switch self {
            case .aes: 32
            case .des: 8
            case .tripleDES: 24
            case .rc4: 32
            }
        }

        public func cipher(key: [UInt8]) throws -> any BlockCipher {
            switch self {
            case .aes: try AES(key: key)
            case .des: try DES(key: key)
            case .tripleDES: try TripleDES(key: key)
            case .rc4: throw CipherError(LocalizedText("RC4 是流密码，没有分组", "RC4 is a stream cipher without blocks"))
            }
        }
    }

    static let blockAlgorithms = ["AES", "DES", "3DES"]

    public static let spec = ToolSpec(
        id: "aes-des",
        name: LocalizedText("AES / DES 加解密", "AES / DES"),
        summary: LocalizedText(
            "AES / DES / 3DES / RC4 加解密，支持 CBC/ECB/CFB/OFB/CTR、多种填充、CryptoJS 兼容口令模式、Base64 与 Hex。",
            "Encrypt and decrypt with AES, DES, 3DES or RC4: CBC/ECB/CFB/OFB/CTR, several paddings, CryptoJS-compatible passphrases, Base64 or hex."
        ),
        category: .crypto,
        keywords: ["aes", "des", "3des", "tripledes", "encrypt", "decrypt", "cbc", "ecb", "加密", "解密", "rc4", "cfb", "ofb", "ctr",
                   "pkcs7", "openssl", "cryptojs", "口令", "jm"],
        symbol: "lock",
        input: .required,
        inputLabel: LocalizedText("明文（加密）或密文（解密）", "Plaintext (encrypt) or ciphertext (decrypt)"),
        fields: [
            ToolField("mode", LocalizedText("操作", "Action"), .choice([
                ToolChoice("encrypt", LocalizedText("加密", "Encrypt")),
                ToolChoice("decrypt", LocalizedText("解密", "Decrypt")),
            ]), default: "encrypt"),
            ToolField("algorithm", LocalizedText("算法", "Algorithm"), .choice(Algorithm.allCases.map { ToolChoice($0.rawValue) }), default: "AES"),
            ToolField("cipherMode", LocalizedText("模式", "Mode"), .choice(CipherMode.allCases.map { ToolChoice($0.rawValue, $0.label) }),
                      default: "cbc", visibleWhen: ToolCondition("algorithm", in: blockAlgorithms)),
            ToolField("padding", LocalizedText("填充", "Padding"), .choice(CipherPadding.allCases.map { ToolChoice($0.rawValue, $0.label) }),
                      default: "pkcs7", visibleWhen: ToolCondition("algorithm", in: blockAlgorithms)),
            ToolField("key", LocalizedText("密钥", "Key"), .text(placeholder: LocalizedText("AES 16 / 24 / 32 字节，DES 8 字节，3DES 16 / 24 字节", "AES 16/24/32 bytes, DES 8, 3DES 16/24"), secret: true), default: ""),
            ToolField("keyEncoding", LocalizedText("密钥 / IV 编码", "Key / IV encoding"), .choice([
                ToolChoice("utf8", LocalizedText("原文 UTF-8", "Text (UTF-8)")),
                ToolChoice("hex", "Hex"),
                ToolChoice("base64", "Base64"),
                ToolChoice("passphrase", LocalizedText("口令（CryptoJS / OpenSSL）", "Passphrase (CryptoJS / OpenSSL)")),
            ]), default: "utf8", help: LocalizedText(
                "口令模式与 CryptoJS.AES.encrypt(text, \"口令\") 相同：随机 8 字节盐，EVP_BytesToKey(MD5) 派生密钥与 IV，密文以 Salted__ 开头",
                "Passphrase mode matches CryptoJS.AES.encrypt(text, \"passphrase\"): a random 8-byte salt, EVP_BytesToKey(MD5) for key and IV, output starting with Salted__"
            )),
            ToolField("iv", LocalizedText("IV", "IV"), .text(placeholder: LocalizedText("AES 16 字节，DES / 3DES 8 字节", "AES 16 bytes, DES / 3DES 8 bytes")),
                      default: "", visibleWhen: ToolCondition("cipherMode", in: ["cbc", "cfb", "ofb", "ctr"])),
            ToolField("cipherEncoding", LocalizedText("密文编码", "Ciphertext encoding"), .choice([
                ToolChoice("base64", "Base64"), ToolChoice("hex", "Hex"),
            ]), default: "base64"),
        ],
        run: { input in try run(input) }
    )

    static let saltedMagic: [UInt8] = Array("Salted__".utf8)

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let decrypting = input.string("mode") == "decrypt"
        let algorithm = EncodeCryptoShared.choice(input, "algorithm", default: Algorithm.aes)
        let mode = EncodeCryptoShared.choice(input, "cipherMode", default: CipherMode.cbc)
        let padding = EncodeCryptoShared.choice(input, "padding", default: CipherPadding.pkcs7)
        let keyEncoding = input.string("keyEncoding")
        let passphrase = keyEncoding == "passphrase"
        let hexOut = input.string("cipherEncoding") == "hex"
        func fail(_ e: CipherError) -> ToolError { ToolError(e.message(lang)) }

        // 输入
        var data: [UInt8]
        if decrypting {
            data = try ciphertext(input.text, hex: hexOut, lang: lang)
            if data.isEmpty { throw ToolError(lang.t("请输入要解密的密文", "Enter the ciphertext to decrypt")) }
        } else {
            data = Array(input.text.utf8)
        }

        // 密钥 / IV
        var key: [UInt8]
        var iv: [UInt8] = []
        var salt: [UInt8]?
        let needsIV = algorithm != .rc4 && mode.needsIV
        if passphrase {
            let pass = Array(input.string("key").utf8)
            if pass.isEmpty { throw ToolError(lang.t("请输入口令", "Enter the passphrase")) }
            if decrypting {
                guard data.count >= 16, Array(data[0..<8]) == saltedMagic else {
                    throw ToolError(lang.t(
                        "口令模式的密文应以「Salted__」开头（Base64 形如 U2FsdGVkX1…），当前密文没有盐值头。若是用密钥 + IV 加密的，请把密钥编码改为 UTF-8 / Hex / Base64。",
                        "Passphrase ciphertext starts with “Salted__” (U2FsdGVkX1… in Base64), but this one has no salt header. If it was encrypted with a key and IV, switch the key encoding to UTF-8 / Hex / Base64."))
                }
                salt = Array(data[8..<16])
                data = Array(data[16...])
            } else {
                let r = input.random(8)
                salt = r.count == 8 ? r : [UInt8](repeating: 0, count: 8)
            }
            let ivLen = algorithm == .rc4 ? 0 : algorithm.blockSize
            let derived = KDF.evpBytesToKey(.md5, password: pass, salt: salt ?? [], keyLength: algorithm.passphraseKeySize, ivLength: ivLen)
            key = derived.key
            iv = needsIV ? derived.iv : []
        } else {
            let enc = ByteEncoding(rawValue: keyEncoding) ?? .utf8
            key = try EncodeCryptoShared.decodeField(input.string("key"), enc, field: LocalizedText("密钥", "Key"), lang: lang)
            if key.isEmpty { throw ToolError(lang.t("密钥不能为空", "The key must not be empty")) }
            if needsIV {
                iv = try EncodeCryptoShared.decodeField(input.string("iv"), enc, field: LocalizedText("IV", "IV"), lang: lang)
            }
        }

        // 运算
        var out: [UInt8]
        do {
            if algorithm == .rc4 {
                out = try RC4(key: key).process(data)
            } else {
                let cipher = try algorithm.cipher(key: key)
                out = decrypting
                    ? try cipher.decrypt(data, mode: mode, iv: iv, padding: padding)
                    : try cipher.encrypt(data, mode: mode, iv: iv, padding: padding, random: input.random)
            }
        } catch let e as CipherError {
            var err = fail(e)
            if decrypting && e.field != .key && e.field != .iv {
                if !hexOut && looksHex(input.text) {
                    err.message += hexHint(lang)
                } else if !passphrase && looksSalted(input.text, hex: hexOut) {
                    err.message += lang.t("（密文以 Salted__ 开头，看起来是口令模式，请把密钥编码改为「口令」）",
                                          " (The ciphertext starts with Salted__, so it looks like passphrase mode; set the key encoding to Passphrase.)")
                }
            }
            throw err
        }

        var notes = warnings(algorithm, mode, padding, key: key, passphrase: passphrase, lang: lang)
        var outputs: [ToolOutput]
        if decrypting {
            if let text = UTF8Check.decode(out) {
                outputs = [.primary(lang.t("明文", "Plaintext"), text)]
            } else {
                let at = (UTF8Check.firstInvalid(out) ?? 0) + 1
                notes.insert(ToolNote(.warning, lang.t(
                    "解密完成，但结果不是有效的 UTF-8 文本（第 \(at) 字节起），已改为显示 Hex。可能是密钥、IV、模式或填充不对，或者原文本来就是二进制。",
                    "Decrypted, but the result is not valid UTF-8 (from byte \(at)), so it is shown as hex. The key, IV, mode or padding may be wrong, or the plaintext is binary.")), at: 0)
                outputs = [.primary(lang.t("明文（Hex）", "Plaintext (hex)"), HexCodec.encode(out))]
            }
        } else {
            let full = (salt.map { saltedMagic + $0 } ?? []) + out
            outputs = [.primary(lang.t("密文", "Ciphertext"), hexOut ? HexCodec.encode(full) : Base64Codec.encode(full))]
        }
        outputs.append(ToolOutput(id: "key", label: lang.t("实际密钥（Hex）", "Key used (hex)"), value: HexCodec.encode(key)))
        if !iv.isEmpty { outputs.append(ToolOutput(id: "iv", label: lang.t("实际 IV（Hex）", "IV used (hex)"), value: HexCodec.encode(iv))) }
        if let salt { outputs.append(ToolOutput(id: "salt", label: lang.t("盐（Hex）", "Salt (hex)"), value: HexCodec.encode(salt))) }
        let name = algorithm == .aes ? "AES-\(key.count * 8)" : algorithm.rawValue
        let modeText = algorithm == .rc4 ? "" : "-\(mode.label) · \(padding.label)"
        notes.append(ToolNote(.info, lang.t("\(name)\(modeText) · \(data.count) → \(out.count) 字节", "\(name)\(modeText) · \(data.count) → \(out.count) bytes")))
        return ToolResult(outputs: outputs, notes: notes)
    }

    /// 解析密文：Base64（忽略空白）或 Hex；Base64 解析失败但看起来是 Hex 时给出提示
    static func ciphertext(_ text: String, hex: Bool, lang: Lang) throws -> [UInt8] {
        let compact = text.filter { !$0.isWhitespace }
        do {
            return hex ? try HexCodec.decode(compact) : try Base64Codec.decode(compact)
        } catch let e as ByteDecodeError {
            var msg = lang.t("密文：", "Ciphertext: ") + e.message(lang)
            if !hex && looksHex(compact) { msg += hexHint(lang) }
            throw ToolError(msg)
        }
    }

    static func looksHex(_ text: String) -> Bool {
        let c = text.filter { !$0.isWhitespace }
        return !c.isEmpty && c.count % 2 == 0 && c.allSatisfy(\.isHexDigit)
    }

    static func hexHint(_ lang: Lang) -> String {
        lang.t("（看起来是 Hex，试试把密文编码改为 Hex）", " (it looks like hex; try setting the ciphertext encoding to Hex)")
    }

    static func looksSalted(_ text: String, hex: Bool) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return hex ? t.lowercased().hasPrefix("53616c7465645f5f") : t.hasPrefix("U2FsdGVkX1")
    }

    /// 额外提示（不阻止运行）
    static func warnings(_ a: Algorithm, _ mode: CipherMode, _ padding: CipherPadding, key: [UInt8], passphrase: Bool, lang: Lang) -> [ToolNote] {
        var out: [ToolNote] = []
        switch a {
        case .des: out.append(ToolNote(.warning, lang.t("DES 只有 56 位有效密钥，可被暴力破解，仅用于兼容旧系统。", "DES has only 56 effective key bits and can be brute-forced; use it only for legacy systems.")))
        case .tripleDES: out.append(ToolNote(.warning, lang.t("3DES 分组只有 64 位，已被 NIST 弃用，新系统请用 AES。", "3DES has 64-bit blocks and is deprecated by NIST; use AES for new systems.")))
        case .rc4: out.append(ToolNote(.warning, lang.t("RC4 存在严重的密钥流偏差，已被 RFC 7465 禁用。", "RC4 has serious keystream biases and is prohibited by RFC 7465.")))
        case .aes: break
        }
        if a != .rc4 {
            if mode == .ecb {
                out.append(ToolNote(.warning, lang.t("ECB 模式不使用 IV，相同的明文分组会得到相同的密文分组，会泄露数据模式。", "ECB uses no IV: identical plaintext blocks give identical ciphertext blocks, leaking patterns.")))
            }
            if !mode.needsAlignment && padding != .none {
                out.append(ToolNote(.info, lang.t(
                    "\(mode.label) 是流式模式，OpenSSL / Java / Go 通常不填充（NoPadding）；CryptoJS 默认仍会 PKCS7 填充，互通时请保持一致。",
                    "\(mode.label) is a streaming mode: OpenSSL / Java / Go usually use NoPadding, while CryptoJS still pads with PKCS7 by default. Keep both sides the same.")))
            }
            if padding == .zero { out.append(ToolNote(.info, lang.t("ZeroPadding 解密时会去掉明文末尾所有 0x00 字节。", "ZeroPadding strips every trailing 0x00 byte when decrypting."))) }
            if a == .tripleDES && TripleDES.isDegenerate(key) {
                out.append(ToolNote(.warning, lang.t("3DES 的相邻子密钥相同，实际退化为单 DES。", "Adjacent 3DES subkeys are equal, so it degrades to single DES.")))
            }
        }
        if passphrase {
            out.append(ToolNote(.info, lang.t("EVP_BytesToKey 只做一次 MD5，抗暴力破解能力弱；新数据建议使用随机密钥。", "EVP_BytesToKey runs MD5 only once and resists brute force poorly; prefer random keys for new data.")))
        }
        return out
    }
}
