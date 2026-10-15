import Foundation

// HMAC 签名：MD5 / SHA-1 / SHA-2 / SHA3-256 / SM3；密钥与消息可按 UTF-8 / Hex / Base64 解析；
// 可粘贴期望签名校验，并生成 Node / Python / Go / Java / PHP 的等价代码。

/// 反斜杠（避免在源码里直接写出容易被误转的转义序列）
private let bs = "\\"

public enum HMACTool {
    public static let algorithms: [HashAlgorithm] = [.md5, .sha1, .sha224, .sha256, .sha384, .sha512, .sha3_256, .sm3]

    static func label(_ a: HashAlgorithm) -> String {
        switch a {
        case .sha1: "HMAC-SHA1"
        case .sha224: "HMAC-SHA224"
        case .sha256: "HMAC-SHA256"
        case .sha384: "HMAC-SHA384"
        case .sha512: "HMAC-SHA512"
        default: "HMAC-" + a.label
        }
    }

    static let encodingChoices = [
        ToolChoice("utf8", LocalizedText("原文 UTF-8", "Text (UTF-8)")),
        ToolChoice("hex", "Hex"),
        ToolChoice("base64", "Base64"),
    ]

    public static let spec = ToolSpec(
        id: "hmac",
        name: LocalizedText("HMAC 签名", "HMAC"),
        summary: LocalizedText(
            "使用密钥计算 HMAC-MD5 / SHA-1 / SHA-2 / SHA3-256 / SM3 签名，可校验签名并生成多语言代码。",
            "Compute HMAC-MD5 / SHA-1 / SHA-2 / SHA3-256 / SM3 with a key, verify signatures and get equivalent code."
        ),
        category: .crypto,
        keywords: ["hmac", "signature", "sha256", "md5", "签名", "sha1", "sha512", "sha3", "sm3", "webhook", "校验", "qm"],
        symbol: "signature",
        input: .required,
        inputLabel: LocalizedText("要签名的消息", "Message to sign"),
        fields: [
            ToolField("algorithm", LocalizedText("算法", "Algorithm"), .choice(
                [ToolChoice("all", LocalizedText("全部算法", "All"))] + algorithms.map { ToolChoice($0.rawValue, label($0)) }
            ), default: "sha256"),
            ToolField("key", LocalizedText("密钥", "Key"), .text(placeholder: LocalizedText("HMAC 密钥", "HMAC key"), secret: true), default: ""),
            ToolField("keyEncoding", LocalizedText("密钥编码", "Key encoding"), .choice(encodingChoices), default: "utf8"),
            ToolField("messageEncoding", LocalizedText("消息编码", "Message encoding"), .choice(encodingChoices), default: "utf8"),
            ToolField("expected", LocalizedText("校验签名", "Verify"), .text(placeholder: LocalizedText("粘贴期望的签名（Hex / Base64）", "Paste the expected signature (hex / Base64)")), default: ""),
            ToolField("snippet", LocalizedText("代码示例", "Code"), .choice([
                ToolChoice("none", LocalizedText("不生成", "None")),
                ToolChoice("node", "Node.js"), ToolChoice("python", "Python"), ToolChoice("go", "Go"),
                ToolChoice("java", "Java"), ToolChoice("php", "PHP"),
            ]), default: "none", visibleWhen: ToolCondition("algorithm", in: algorithms.map(\.rawValue))),
        ],
        run: { input in try run(input) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let keyEnc = EncodeCryptoShared.choice(input, "keyEncoding", default: ByteEncoding.utf8)
        let msgEnc = EncodeCryptoShared.choice(input, "messageEncoding", default: ByteEncoding.utf8)
        let key = try EncodeCryptoShared.decodeField(input.string("key"), keyEnc, field: LocalizedText("密钥", "Key"), lang: lang)
        let message = try EncodeCryptoShared.decodeField(input.text, msgEnc, field: LocalizedText("消息", "Message"), lang: lang)
        let single = HashAlgorithm(rawValue: input.string("algorithm")).flatMap { algorithms.contains($0) ? $0 : nil }
        let chosen = single.map { [$0] } ?? algorithms
        let macs = chosen.map { ($0, HMAC.mac($0, key: key, message: message)) }

        var outputs: [ToolOutput] = []
        var table: ToolTable?
        if let a = single, let mac = macs.first?.1 {
            outputs = [
                ToolOutput(id: "result", label: label(a) + lang.t("（Hex 小写）", " (hex)"), value: HexCodec.encode(mac), isPrimary: true),
                ToolOutput(id: "hexUpper", label: label(a) + lang.t("（Hex 大写）", " (HEX)"), value: HexCodec.encode(mac, uppercase: true)),
                ToolOutput(id: "base64", label: label(a) + " (Base64)", value: Base64Codec.encode(mac)),
            ]
            let snippetLang = input.string("snippet")
            if snippetLang != "none", !snippetLang.isEmpty,
               let code = snippet(snippetLang, algorithm: a, key: input.string("key"), keyEncoding: keyEnc, message: input.text, messageEncoding: msgEnc, lang: lang) {
                let editorLang = ["node": "javascript", "python": "python", "go": "go", "java": "java", "php": "php"][snippetLang]
                outputs.append(ToolOutput(id: "snippet", label: lang.t("代码示例", "Code"), value: code, language: editorLang))
            }
        } else {
            for (i, (a, mac)) in macs.enumerated() {
                outputs.append(ToolOutput(id: a.rawValue, label: label(a), value: HexCodec.encode(mac), isPrimary: i == 0))
            }
            table = ToolTable(columns: [lang.t("算法", "Algorithm"), "Hex", "Base64"],
                              rows: macs.map { [label($0.0), HexCodec.encode($0.1), Base64Codec.encode($0.1)] })
        }

        var notes: [ToolNote] = []
        if key.isEmpty { notes.append(ToolNote(.warning, lang.t("密钥为空", "The key is empty"))) }
        let hashedFor = chosen.filter { key.count > $0.blockSize }
        if !hashedFor.isEmpty {
            let names = hashedFor.map { label($0).replacingOccurrences(of: "HMAC-", with: "") }.joined(separator: " / ")
            let sizes = Array(Set(hashedFor.map(\.blockSize))).sorted().map(String.init).joined(separator: " / ")
            notes.append(ToolNote(.info, lang.t("密钥 \(key.count) 字节，超过 \(names) 的块大小（\(sizes) 字节），这些算法会先对密钥做一次哈希",
                                                "The \(key.count)-byte key is longer than the \(names) block size (\(sizes) bytes), so it is hashed first")))
        }
        let labels = Dictionary(uniqueKeysWithValues: chosen.map { ($0.rawValue, label($0)) })
        notes += HashTool.matchNotes(HashTool.match(input.string("expected"), macs.map { ($0.0.rawValue, $0.1) }), labels: labels, lang: lang)
        return ToolResult(outputs: outputs, notes: notes, table: table)
    }

    // MARK: 代码示例

    static let maxLiteral = 1000

    /// 双引号字符串字面量（JS / Python / Go / Java 通用的转义）
    static func dq(_ s: String) -> String {
        var out = "\""
        for c in s.unicodeScalars {
            switch c {
            case "\"", "\\": out += bs + String(c)
            case "\n": out += bs + "n"
            case "\r": out += bs + "r"
            case "\t": out += bs + "t"
            default:
                if c.value < 0x20 || c.value == 0x7F {
                    out += bs + "u" + String(format: "%04x", c.value)
                } else {
                    out.unicodeScalars.append(c)
                }
            }
        }
        return out + "\""
    }

    /// JS / Python：内容含双引号而不含单引号时改用单引号
    static func smartQuote(_ s: String) -> String {
        guard s.contains("\""), !s.contains("'") else { return dq(s) }
        let inner = String(dq(s).dropFirst().dropLast()).replacingOccurrences(of: bs + "\"", with: "\"")
        return "'" + inner + "'"
    }

    /// PHP 单引号字符串：只需转义 \ 与 '
    static func sq(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: bs, with: bs + bs).replacingOccurrences(of: "'", with: bs + "'") + "'"
    }

    /// Hex / Base64 规范化成各语言标准库都能解析的形式；无法解析时只去掉空白
    static func canonical(_ v: String, _ e: ByteEncoding) -> String {
        guard e != .utf8 else { return v }
        if let b = try? e.decode(v) { return e == .hex ? HexCodec.encode(b) : Base64Codec.encode(b) }
        return v.filter { !$0.isWhitespace }
    }

    /// 生成等价代码；该语言标准库不支持此算法时返回 nil
    public static func snippet(_ language: String, algorithm a: HashAlgorithm, key: String, keyEncoding: ByteEncoding,
                               message: String, messageEncoding: ByteEncoding, lang: Lang = .zh) -> String? {
        let quote: (String) -> String = language == "php" ? sq : (language == "node" || language == "python") ? smartQuote : dq
        let comment = language == "python" ? "#" : "//"
        var omitted: [String] = []
        func lit(_ v: String, _ name: LocalizedText) -> String {
            if v.count <= maxLiteral { return quote(v) }
            omitted.append(lang.t("\(name.zh)（\(v.count) 个字符）", "\(name.en) (\(v.count) characters)"))
            return quote("...")
        }
        let keyLit = lit(canonical(key, keyEncoding), LocalizedText("密钥", "the key"))
        let msgLit = lit(canonical(message, messageEncoding), LocalizedText("消息", "the message"))
        guard let code = build(language, a, keyLit, keyEncoding, msgLit, messageEncoding) else { return nil }
        if omitted.isEmpty { return code }
        let note = comment + lang.t(" 注意：\(omitted.joined(separator: "、"))过长，已用 \"...\" 代替，请替换为实际内容",
                                    " Note: \(omitted.joined(separator: " and ")) is too long and was replaced with \"...\"; put the real value back")
        if language == "php" || language == "go", let nl = code.firstIndex(of: "\n") {
            return String(code[..<nl]) + "\n" + note + String(code[nl...])
        }
        return note + "\n" + code
    }

    static func build(_ language: String, _ a: HashAlgorithm, _ keyLit: String, _ keyEnc: ByteEncoding, _ msgLit: String, _ msgEnc: ByteEncoding) -> String? {
        let node = a.rawValue
        switch language {
        case "node":
            func dec(_ v: String, _ e: ByteEncoding) -> String { e == .utf8 ? v : "Buffer.from(\(v), '\(e.rawValue)')" }
            return [
                "import { createHmac } from 'node:crypto'",
                "",
                "const key = \(dec(keyLit, keyEnc))",
                "const message = \(dec(msgLit, msgEnc))",
                "const signature = createHmac('\(node)', key).update(message).digest('hex')",
            ].joined(separator: "\n")
        case "python":
            func dec(_ v: String, _ e: ByteEncoding) -> String {
                switch e {
                case .utf8: "\(v).encode()"
                case .hex: "bytes.fromhex(\(v))"
                case .base64: "base64.b64decode(\(v))"
                }
            }
            let needB64 = keyEnc == .base64 || msgEnc == .base64
            let py = a == .sha3_256 ? "sha3_256" : node
            return [
                "import hmac" + (needB64 ? ", base64" : ""),
                "",
                "key = \(dec(keyLit, keyEnc))",
                "message = \(dec(msgLit, msgEnc))",
                "mac = hmac.new(key, message, '\(py)')",
                "signature = mac.hexdigest()",
            ].joined(separator: "\n")
        case "go":
            let ctors: [HashAlgorithm: (String, String)] = [
                .md5: ("crypto/md5", "md5.New"), .sha1: ("crypto/sha1", "sha1.New"), .sha224: ("crypto/sha256", "sha256.New224"),
                .sha256: ("crypto/sha256", "sha256.New"), .sha384: ("crypto/sha512", "sha512.New384"), .sha512: ("crypto/sha512", "sha512.New"),
                .sha3_256: ("crypto/sha3", "func() hash.Hash { return sha3.New256() }"),
            ]
            guard let pair = ctors[a] else { return nil }
            let (pkg, ctor) = pair
            var imports: Set<String> = ["crypto/hmac", pkg, "fmt", "encoding/hex"]
            if a == .sha3_256 { imports.insert("hash") }
            func dec(_ name: String, _ v: String, _ e: ByteEncoding) -> String {
                switch e {
                case .utf8: return "\(name) := []byte(\(v))"
                case .hex: return "\(name), _ := hex.DecodeString(\(v))"
                case .base64:
                    imports.insert("encoding/base64")
                    return "\(name), _ := base64.StdEncoding.DecodeString(\(v))"
                }
            }
            let keyLine = dec("key", keyLit, keyEnc)
            let msgLine = dec("message", msgLit, msgEnc)
            return (["package main", "", "import ("] + imports.sorted().map { "\t\"\($0)\"" } + [
                ")",
                "",
                "func main() {",
                "\t" + keyLine,
                "\t" + msgLine,
                "\tmac := hmac.New(\(ctor), key)",
                "\tmac.Write(message)",
                "\tfmt.Println(hex.EncodeToString(mac.Sum(nil)))",
                "}",
            ]).joined(separator: "\n")
        case "java":
            let names: [HashAlgorithm: String] = [.md5: "HmacMD5", .sha1: "HmacSHA1", .sha224: "HmacSHA224", .sha256: "HmacSHA256",
                                                  .sha384: "HmacSHA384", .sha512: "HmacSHA512", .sha3_256: "HmacSHA3-256"]
            guard let name = names[a] else { return nil }
            func dec(_ v: String, _ e: ByteEncoding) -> String {
                switch e {
                case .utf8: "\(v).getBytes(StandardCharsets.UTF_8)"
                case .hex: "HexFormat.of().parseHex(\(v))"
                case .base64: "Base64.getDecoder().decode(\(v))"
                }
            }
            return [
                "import javax.crypto.Mac;",
                "import javax.crypto.spec.SecretKeySpec;",
                "import java.nio.charset.StandardCharsets;",
                "import java.util.Base64;",
                "import java.util.HexFormat;",
                "",
                "byte[] key = \(dec(keyLit, keyEnc));",
                "byte[] message = \(dec(msgLit, msgEnc));",
                "Mac mac = Mac.getInstance(\"\(name)\");",
                "mac.init(new SecretKeySpec(key, \"\(name)\"));",
                "String signature = HexFormat.of().formatHex(mac.doFinal(message));",
            ].joined(separator: "\n")
        case "php":
            guard a != .sm3 else { return nil }
            func dec(_ v: String, _ e: ByteEncoding) -> String {
                switch e {
                case .utf8: v
                case .hex: "hex2bin(\(v))"
                case .base64: "base64_decode(\(v))"
                }
            }
            return [
                "<?php",
                "$key = \(dec(keyLit, keyEnc));",
                "$message = \(dec(msgLit, msgEnc));",
                "$signature = hash_hmac('\(node)', $message, $key);",
            ].joined(separator: "\n")
        default:
            return nil
        }
    }
}
