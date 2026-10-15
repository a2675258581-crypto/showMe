import Foundation
#if canImport(Security)
import Security
#endif

// RSA 生成密钥与加解密：Apple 平台用 Security 框架（SecKey），其余平台抛出「需要 macOS」。
// 密钥的解析与格式转换在 RSAKeys.swift（纯 Swift）。

public enum RSAPadding: String, CaseIterable, Sendable {
    case oaepSHA256 = "oaep-sha256"
    case oaepSHA1 = "oaep-sha1"
    case pkcs1 = "pkcs1"

    public var label: String {
        switch self {
        case .oaepSHA256: "OAEP-SHA256"
        case .oaepSHA1: "OAEP-SHA1"
        case .pkcs1: "PKCS#1 v1.5"
        }
    }

    /// 单次可加密的最大明文字节数
    public func maxPlaintext(bits: Int) -> Int {
        switch self {
        case .oaepSHA256: RSAKeys.maxOAEPPlaintext(bits: bits, hashLength: 32)
        case .oaepSHA1: RSAKeys.maxOAEPPlaintext(bits: bits, hashLength: 20)
        case .pkcs1: RSAKeys.maxPKCS1Plaintext(bits: bits)
        }
    }
}

public enum RSACrypto {
    /// 当前平台能否生成密钥 / 加解密
    public static var isAvailable: Bool {
        #if canImport(Security)
        return true
        #else
        return false
        #endif
    }

    static let unavailable = RSAKeyError("RSA 生成密钥与加解密需要 macOS", "RSA key generation and encryption require macOS")

    /// 生成密钥对，返回 PKCS#1 DER（私钥 RSAPrivateKey、公钥 RSAPublicKey）
    public static func generate(bits: Int) throws -> (privatePKCS1: [UInt8], publicPKCS1: [UInt8]) {
        #if canImport(Security)
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits as String: bits,
        ]
        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw failure("生成密钥失败", "Key generation failed", error)
        }
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw RSAKeyError("无法取得公钥", "Could not get the public key")
        }
        let priv = try export(privateKey)
        let pub = try export(publicKey)
        return (priv, pub)
        #else
        throw unavailable
        #endif
    }

    /// 用公钥加密。key 为 RSAKeys.parse 的结果（公钥或私钥都可，私钥会取其公钥部分）
    public static func encrypt(_ plaintext: [UInt8], key: RSAKeyInfo, padding: RSAPadding) throws -> [UInt8] {
        let limit = padding.maxPlaintext(bits: key.bits)
        if limit == 0 {
            throw RSAKeyError("RSA-\(key.bits) 太短，无法与 \(padding.label) 搭配使用", "RSA-\(key.bits) is too short for \(padding.label)")
        }
        if plaintext.count > limit {
            throw RSAKeyError(
                "明文 \(plaintext.count) 字节，超过 RSA-\(key.bits) + \(padding.label) 单次加密上限 \(limit) 字节。长数据请用 AES 加密，再用 RSA 加密 AES 密钥（混合加密）",
                "The plaintext is \(plaintext.count) bytes, over the \(limit)-byte limit of RSA-\(key.bits) with \(padding.label). Encrypt long data with AES and wrap the AES key with RSA (hybrid encryption)"
            )
        }
        #if canImport(Security)
        let publicPKCS1 = try key.kind == .public ? key.pkcs1 : RSAKeys.unwrapSPKI(key.spki)
        let secKey = try importKey(publicPKCS1, isPrivate: false)
        var error: Unmanaged<CFError>?
        guard let out = SecKeyCreateEncryptedData(secKey, algorithm(padding), Data(plaintext) as CFData, &error) else {
            throw failure("加密失败", "Encryption failed", error)
        }
        return [UInt8](out as Data)
        #else
        throw unavailable
        #endif
    }

    /// 用私钥解密
    public static func decrypt(_ ciphertext: [UInt8], key: RSAKeyInfo, padding: RSAPadding) throws -> [UInt8] {
        guard key.kind == .private else {
            throw RSAKeyError("解密需要私钥，当前粘贴的是公钥", "Decryption needs the private key; this is a public key")
        }
        let k = (key.bits + 7) / 8
        if ciphertext.count != k {
            throw RSAKeyError("密文长度为 \(ciphertext.count) 字节，RSA-\(key.bits) 的密文应恰好为 \(k) 字节",
                              "The ciphertext is \(ciphertext.count) bytes; RSA-\(key.bits) ciphertext must be exactly \(k) bytes")
        }
        #if canImport(Security)
        let secKey = try importKey(key.pkcs1, isPrivate: true)
        var error: Unmanaged<CFError>?
        guard let out = SecKeyCreateDecryptedData(secKey, algorithm(padding), Data(ciphertext) as CFData, &error) else {
            _ = error?.takeRetainedValue()
            throw RSAKeyError(
                "解密失败：私钥与加密所用公钥不是一对、填充方式（当前 \(padding.label)）与加密时不一致，或密文已损坏",
                "Decryption failed: the private key does not match the encrypting public key, the padding (\(padding.label)) differs, or the ciphertext is damaged"
            )
        }
        return [UInt8](out as Data)
        #else
        throw unavailable
        #endif
    }

    #if canImport(Security)
    static func algorithm(_ padding: RSAPadding) -> SecKeyAlgorithm {
        switch padding {
        case .oaepSHA256: .rsaEncryptionOAEPSHA256
        case .oaepSHA1: .rsaEncryptionOAEPSHA1
        case .pkcs1: .rsaEncryptionPKCS1
        }
    }

    /// SecKeyCreateWithData 需要 PKCS#1 格式（RSAPublicKey / RSAPrivateKey）
    static func importKey(_ pkcs1: [UInt8], isPrivate: Bool) throws -> SecKey {
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: isPrivate ? kSecAttrKeyClassPrivate : kSecAttrKeyClassPublic,
        ]
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateWithData(Data(pkcs1) as CFData, attributes as CFDictionary, &error) else {
            throw failure("无法导入密钥", "Could not import the key", error)
        }
        return key
    }

    static func export(_ key: SecKey) throws -> [UInt8] {
        var error: Unmanaged<CFError>?
        guard let data = SecKeyCopyExternalRepresentation(key, &error) else {
            throw failure("无法导出密钥", "Could not export the key", error)
        }
        return [UInt8](data as Data)
    }

    static func failure(_ zh: String, _ en: String, _ error: Unmanaged<CFError>?) -> RSAKeyError {
        let detail = error.map { ($0.takeRetainedValue() as Error).localizedDescription } ?? ""
        return RSAKeyError(detail.isEmpty ? zh : "\(zh)：\(detail)", detail.isEmpty ? en : "\(en): \(detail)")
    }
    #endif
}
