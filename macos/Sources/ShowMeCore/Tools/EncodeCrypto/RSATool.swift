import Foundation

// RSA：生成密钥对（PEM）、公钥加密、私钥解密（Apple 平台用 Security 框架，其余平台提示需要 macOS），
// 以及纯 Swift 的密钥查看与格式转换（SPKI / PKCS#1 / PKCS#8 / OpenSSH / JWK，任何平台可用）。

public enum RSATool {
    public static let spec = ToolSpec(
        id: "rsa",
        name: LocalizedText("RSA 密钥与加解密", "RSA Keys & Encryption"),
        summary: LocalizedText(
            "生成 RSA 密钥对（PEM），用公钥加密、私钥解密，查看并转换密钥格式。",
            "Generate RSA key pairs (PEM), encrypt with a public key, decrypt with a private key, and inspect or convert keys."
        ),
        category: .crypto,
        keywords: ["rsa", "pem", "public key", "private key", "oaep", "公钥", "私钥", "非对称", "pkcs1", "pkcs8", "jwk", "ssh-rsa", "my"],
        symbol: "key.horizontal",
        input: .optional,
        inputLabel: LocalizedText("明文 / 密文 / 密钥（按操作）", "Plaintext, ciphertext or a key (per action)"),
        fields: [
            ToolField("mode", LocalizedText("操作", "Action"), .choice([
                ToolChoice("generate", LocalizedText("生成密钥", "Generate")),
                ToolChoice("encrypt", LocalizedText("公钥加密", "Encrypt")),
                ToolChoice("decrypt", LocalizedText("私钥解密", "Decrypt")),
                ToolChoice("inspect", LocalizedText("查看 / 转换密钥", "Inspect / convert")),
            ]), default: "generate"),
            ToolField("bits", LocalizedText("密钥长度", "Key size"), .choice([
                ToolChoice("1024", LocalizedText("1024 位", "1024 bits")),
                ToolChoice("2048", LocalizedText("2048 位", "2048 bits")),
                ToolChoice("4096", LocalizedText("4096 位", "4096 bits")),
            ]), default: "2048", visibleWhen: ToolCondition("mode", is: "generate")),
            ToolField("privateFormat", LocalizedText("私钥格式", "Private key format"), .choice([
                ToolChoice("pkcs1", LocalizedText("PKCS#1（BEGIN RSA PRIVATE KEY）", "PKCS#1 (BEGIN RSA PRIVATE KEY)")),
                ToolChoice("pkcs8", LocalizedText("PKCS#8（BEGIN PRIVATE KEY）", "PKCS#8 (BEGIN PRIVATE KEY)")),
            ]), default: "pkcs1", visibleWhen: ToolCondition("mode", is: "generate")),
            ToolField("key", LocalizedText("密钥 PEM", "Key PEM"), .text(
                placeholder: LocalizedText("加密粘贴公钥，解密粘贴私钥（PEM / Base64 DER / JWK）", "Public key to encrypt, private key to decrypt (PEM / Base64 DER / JWK)"),
                secret: true, mono: true, multiline: true
            ), default: "", visibleWhen: ToolCondition("mode", in: ["encrypt", "decrypt"])),
            ToolField("padding", LocalizedText("填充", "Padding"), .choice(RSAPadding.allCases.map { ToolChoice($0.rawValue, $0.label) }),
                      default: "oaep-sha256", visibleWhen: ToolCondition("mode", in: ["encrypt", "decrypt"])),
        ],
        run: { input in try run(input) }
    )

    static func parseKey(_ text: String, lang: Lang) throws -> RSAKeyInfo {
        do { return try RSAKeys.parse(text) } catch let e as RSAKeyError { throw ToolError(e.message(lang)) }
    }

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let padding = EncodeCryptoShared.choice(input, "padding", default: RSAPadding.oaepSHA256)
        do {
            switch input.string("mode") {
            case "inspect":
                return try inspect(parseKey(input.text, lang: lang), lang: lang)
            case "encrypt":
                let key = try parseKey(input.string("key"), lang: lang)
                let ct = try RSACrypto.encrypt(Array(input.text.utf8), key: key, padding: padding)
                var notes = [ToolNote(.info, lang.t("RSA-\(key.bits) · \(padding.label) · 单次最多 \(padding.maxPlaintext(bits: key.bits)) 字节",
                                                     "RSA-\(key.bits) · \(padding.label) · up to \(padding.maxPlaintext(bits: key.bits)) bytes per message"))]
                if padding != .pkcs1 { notes.append(ToolNote(.info, lang.t("OAEP 是随机化的：每次加密结果都不同", "OAEP is randomized: every encryption gives a different result"))) }
                if key.kind == .private { notes.append(ToolNote(.info, lang.t("粘贴的是私钥，已取其公钥部分加密", "A private key was given; its public part was used"))) }
                return ToolResult(outputs: [
                    .primary(lang.t("密文（Base64）", "Ciphertext (Base64)"), Base64Codec.encode(ct)),
                    ToolOutput(id: "hex", label: lang.t("密文（Hex）", "Ciphertext (hex)"), value: HexCodec.encode(ct)),
                ], notes: notes)
            case "decrypt":
                let key = try parseKey(input.string("key"), lang: lang)
                let ct = try decodeCiphertext(input.text, lang: lang)
                let pt = try RSACrypto.decrypt(ct, key: key, padding: padding)
                if let text = UTF8Check.decode(pt) { return ToolResult(outputs: [.primary(lang.t("明文", "Plaintext"), text)]) }
                return ToolResult(outputs: [.primary(lang.t("明文（Hex）", "Plaintext (hex)"), HexCodec.encode(pt))],
                                  notes: [ToolNote(.warning, lang.t("解密结果不是有效的 UTF-8 文本，已显示为 Hex", "The plaintext is not valid UTF-8, so it is shown as hex"))])
            default:
                return try generate(bits: input.int("bits", default: 2048), pkcs8: input.string("privateFormat") == "pkcs8", lang: lang)
            }
        } catch let e as RSAKeyError {
            throw ToolError(e.message(lang))
        }
    }

    /// 密文：自动识别 Hex 或 Base64
    static func decodeCiphertext(_ text: String, lang: Lang) throws -> [UInt8] {
        let compact = text.filter { !$0.isWhitespace }
        if compact.isEmpty { throw ToolError(lang.t("请输入要解密的密文（Base64 或 Hex）", "Enter the ciphertext (Base64 or hex)")) }
        if compact.count % 2 == 0, compact.allSatisfy(\.isHexDigit), let b = try? HexCodec.decode(compact) { return b }
        do { return try Base64Codec.decode(compact, label: LocalizedText("密文", "Ciphertext")) } catch let e as ByteDecodeError {
            throw ToolError(e.message(lang))
        }
    }

    static func generate(bits: Int, pkcs8: Bool, lang: Lang) throws -> ToolResult {
        let size = [1024, 2048, 4096].contains(bits) ? bits : 2048
        let pair = try RSACrypto.generate(bits: size)
        let pkcs8DER = RSAKeys.wrapPKCS1Private(pair.privatePKCS1)
        let spki = RSAKeys.wrapPKCS1Public(pair.publicPKCS1)
        let privatePEM = pkcs8 ? PEM.encode(pkcs8DER, label: "PRIVATE KEY") : PEM.encode(pair.privatePKCS1, label: "RSA PRIVATE KEY")
        var outputs: [ToolOutput] = [
            ToolOutput(id: "result", label: lang.t("私钥", "Private key"), value: privatePEM, isPrimary: true, language: "plain"),
            ToolOutput(id: "public", label: lang.t("公钥（SPKI）", "Public key (SPKI)"), value: PEM.encode(spki, label: "PUBLIC KEY")),
        ]
        if let ssh = try? RSAKeys.toOpenSSH(spki: spki, comment: "showme-rsa") {
            outputs.append(ToolOutput(id: "openssh", label: lang.t("公钥（OpenSSH）", "Public key (OpenSSH)"), value: ssh))
        }
        var notes = [ToolNote(.warning, lang.t("私钥请妥善保管；每次修改选项都会重新生成一对新密钥", "Keep the private key safe; changing any option generates a new pair"))]
        if size < 2048 { notes.append(ToolNote(.warning, lang.t("1024 位 RSA 已不安全，仅用于测试", "1024-bit RSA is no longer secure; use it only for testing"))) }
        return ToolResult(outputs: outputs, notes: notes)
    }

    static func inspect(_ key: RSAKeyInfo, lang: Lang) throws -> ToolResult {
        let spki = key.spki
        var outputs: [ToolOutput] = []
        if key.kind == .private {
            outputs.append(ToolOutput(id: "result", label: lang.t("私钥 PKCS#8", "Private key PKCS#8"), value: try RSAKeys.exportPrivate(pkcs8: key.der, format: .pkcs8), isPrimary: true))
            outputs.append(ToolOutput(id: "pkcs1Private", label: lang.t("私钥 PKCS#1", "Private key PKCS#1"), value: try RSAKeys.exportPrivate(pkcs8: key.der, format: .pkcs1)))
            outputs.append(ToolOutput(id: "jwkPrivate", label: lang.t("私钥 JWK", "Private key JWK"), value: try RSAKeys.exportPrivate(pkcs8: key.der, format: .jwk), language: "json"))
        }
        outputs.append(ToolOutput(id: key.kind == .public ? "result" : "spki", label: lang.t("公钥 SPKI", "Public key SPKI"),
                                  value: try RSAKeys.exportPublic(spki: spki, format: .spki), isPrimary: key.kind == .public))
        outputs.append(ToolOutput(id: "pkcs1Public", label: lang.t("公钥 PKCS#1", "Public key PKCS#1"), value: try RSAKeys.exportPublic(spki: spki, format: .pkcs1)))
        outputs.append(ToolOutput(id: "openssh", label: lang.t("公钥 OpenSSH", "Public key OpenSSH"), value: try RSAKeys.exportPublic(spki: spki, format: .openssh)))
        outputs.append(ToolOutput(id: "jwkPublic", label: lang.t("公钥 JWK", "Public key JWK"), value: try RSAKeys.exportPublic(spki: spki, format: .jwk), language: "json"))

        let fp = try RSAKeys.fingerprints(spki: spki)
        let kind = key.kind == .private ? lang.t("私钥", "Private key") : lang.t("公钥", "Public key")
        let rows: [[String]] = [
            [lang.t("类型", "Type"), "\(kind) · " + key.source.label(lang)],
            [lang.t("长度", "Size"), lang.t("\(key.bits) 位", "\(key.bits) bits")],
            [lang.t("公钥指数", "Public exponent"), key.exponent],
            [lang.t("模数（Hex）", "Modulus (hex)"), key.modulusHex],
            [lang.t("指纹（OpenSSH）", "Fingerprint (OpenSSH)"), fp.openssh],
            [lang.t("指纹（SPKI SHA-256）", "Fingerprint (SPKI SHA-256)"), fp.spkiSHA256],
            [lang.t("OAEP-SHA256 单次上限", "OAEP-SHA256 limit"), lang.t("\(RSAPadding.oaepSHA256.maxPlaintext(bits: key.bits)) 字节", "\(RSAPadding.oaepSHA256.maxPlaintext(bits: key.bits)) bytes")],
        ]
        var notes: [ToolNote] = []
        if key.pssOID { notes.append(ToolNote(.info, lang.t("原密钥带 RSASSA-PSS 专用 OID，已转换为通用的 rsaEncryption", "The key used the RSASSA-PSS OID; it was converted to plain rsaEncryption"))) }
        if key.bits < 2048 { notes.append(ToolNote(.warning, lang.t("密钥短于 2048 位，已不安全", "The key is shorter than 2048 bits and is no longer secure"))) }
        if !RSACrypto.isAvailable { notes.append(ToolNote(.info, lang.t("当前平台不支持 RSA 加解密（需要 macOS），但可以查看与转换密钥", "RSA encryption needs macOS here, but keys can still be inspected and converted"))) }
        return ToolResult(outputs: outputs, notes: notes, table: ToolTable(columns: [lang.t("项目", "Item"), lang.t("值", "Value")], rows: rows))
    }
}
