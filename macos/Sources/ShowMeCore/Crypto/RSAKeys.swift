import Foundation

// RSA 密钥的纯 Swift 处理（Linux 上也能跑）：
// DER / ASN.1 读写、PEM、PKCS#1 ⇄ PKCS#8 / SPKI、X.509 证书取公钥、OpenSSH 公钥、JWK。
// 真正的加解密与生成密钥在 RSASecurity.swift（只在 Apple 平台可用）。

public struct RSAKeyError: Error, Sendable, Hashable {
    public var message: LocalizedText
    public init(_ zh: String, _ en: String) { message = LocalizedText(zh, en) }
}

// MARK: - DER

public enum DER {
    public static let integer: UInt8 = 0x02
    public static let bitString: UInt8 = 0x03
    public static let octetString: UInt8 = 0x04
    public static let null: UInt8 = 0x05
    public static let oid: UInt8 = 0x06
    public static let sequence: UInt8 = 0x30

    public struct TLV: Sendable, Hashable {
        public var tag: UInt8
        /// TLV 头的起点
        public var start: Int
        /// 值的范围 [valueStart, end)
        public var valueStart: Int
        public var end: Int
    }

    public static func read(_ b: [UInt8], at pos: Int, limit: Int? = nil) throws -> TLV {
        let limit = min(limit ?? b.count, b.count)
        guard pos >= 0, pos + 2 <= limit else { throw RSAKeyError("DER 数据被截断", "The DER data is truncated") }
        let tag = b[pos]
        var len = Int(b[pos + 1])
        var p = pos + 2
        if len & 0x80 != 0 {
            let n = len & 0x7F
            if n == 0 { throw RSAKeyError("不支持不定长编码（不是有效的 DER）", "Indefinite-length encoding is not valid DER") }
            if n > 4 { throw RSAKeyError("DER 长度字段过大", "The DER length field is too large") }
            guard p + n <= limit else { throw RSAKeyError("DER 数据被截断", "The DER data is truncated") }
            len = 0
            for i in 0..<n { len = len << 8 | Int(b[p + i]) }
            p += n
        }
        guard p + len <= limit else {
            throw RSAKeyError("DER 数据被截断（需要 \(p + len) 字节，只有 \(limit) 字节）", "The DER data is truncated (needs \(p + len) bytes, has \(limit))")
        }
        return TLV(tag: tag, start: pos, valueStart: p, end: p + len)
    }

    public static func children(_ b: [UInt8], _ parent: TLV) throws -> [TLV] {
        var out: [TLV] = []
        var p = parent.valueStart
        while p < parent.end {
            let t = try read(b, at: p, limit: parent.end)
            out.append(t)
            p = t.end
        }
        return out
    }

    public static func value(_ b: [UInt8], _ t: TLV) -> [UInt8] { Array(b[t.valueStart..<t.end]) }

    public static func rootSequence(_ der: [UInt8]) throws -> TLV {
        let root = try read(der, at: 0)
        guard root.tag == sequence else {
            throw RSAKeyError("不是 DER 编码的 ASN.1 结构（应以 SEQUENCE 开头）", "Not a DER-encoded ASN.1 structure (it should start with a SEQUENCE)")
        }
        return root
    }

    public static func encodeLength(_ n: Int) -> [UInt8] {
        if n < 0x80 { return [UInt8(n)] }
        var bytes: [UInt8] = []
        var v = n
        while v > 0 {
            bytes.insert(UInt8(v & 0xFF), at: 0)
            v >>= 8
        }
        return [0x80 | UInt8(bytes.count)] + bytes
    }

    public static func encode(_ tag: UInt8, _ value: [UInt8]) -> [UInt8] {
        [tag] + encodeLength(value.count) + value
    }

    /// 无符号大端整数 → DER INTEGER（去掉多余前导 0，最高位为 1 时补 0）
    public static func encodeUnsignedInteger(_ bytes: [UInt8]) -> [UInt8] {
        var v = stripLeadingZeros(bytes)
        if v.isEmpty { v = [0] }
        if v[0] & 0x80 != 0 { v.insert(0, at: 0) }
        return encode(integer, v)
    }

    /// 去掉前导 0（保留至少一个字节；空数组仍为空）
    public static func stripLeadingZeros(_ b: [UInt8]) -> [UInt8] {
        var i = 0
        while i < b.count - 1 && b[i] == 0 { i += 1 }
        return Array(b[i...])
    }

    public static func decodeOID(_ b: [UInt8]) -> String {
        guard let first = b.first else { return "" }
        var parts: [UInt64] = first >= 80 ? [2, UInt64(first) - 80] : [UInt64(first) / 40, UInt64(first) % 40]
        var v: UInt64 = 0
        for x in b.dropFirst() {
            v = v << 7 | UInt64(x & 0x7F)
            if x & 0x80 == 0 {
                parts.append(v)
                v = 0
            }
        }
        return parts.map(String.init).joined(separator: ".")
    }
}

// MARK: - PEM

public enum PEM {
    /// 按 OpenSSL 的格式输出：每行 64 个字符，结尾带换行
    public static func encode(_ der: [UInt8], label: String) -> String {
        let b64 = Array(Base64Codec.encode(der).utf8)
        var lines: [String] = []
        var i = 0
        while i < b64.count {
            lines.append(String(decoding: b64[i..<min(i + 64, b64.count)], as: UTF8.self))
            i += 64
        }
        return "-----BEGIN \(label)-----\n" + lines.joined(separator: "\n") + "\n-----END \(label)-----\n"
    }

    /// 解析文本中的第一个 PEM 块；没有 PEM 头时返回 nil
    public static func decode(_ text: String) throws -> (label: String, der: [UInt8])? {
        guard let begin = text.range(of: "-----BEGIN ") else { return nil }
        guard let close = text.range(of: "-----", range: begin.upperBound..<text.endIndex) else {
            throw RSAKeyError("PEM 开头行格式不正确，应形如「-----BEGIN PUBLIC KEY-----」", "The PEM header is malformed; it should look like “-----BEGIN PUBLIC KEY-----”")
        }
        let label = String(text[begin.upperBound..<close.lowerBound])
        let endMarker = "-----END \(label)-----"
        guard let end = text.range(of: endMarker, range: close.upperBound..<text.endIndex) else {
            throw RSAKeyError("缺少结尾行「\(endMarker)」，PEM 可能没有复制完整", "The closing line “\(endMarker)” is missing; the PEM may be incomplete")
        }
        let body = String(text[close.upperBound..<end.lowerBound])
        if body.contains("Proc-Type:") || body.contains("DEK-Info:") {
            throw RSAKeyError(
                "这是用口令加密的传统格式私钥，无法直接使用。请先解密：openssl pkey -in key.pem -out plain.pem",
                "This is a passphrase-encrypted legacy private key. Decrypt it first: openssl pkey -in key.pem -out plain.pem"
            )
        }
        // 出错时给出原文行号
        // 按标量处理换行：Swift 把 \r\n 当成一个字符
        let firstLine = text[..<close.upperBound].unicodeScalars.filter { $0 == "\n" }.count + 1
        for (i, line) in body.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            for (col, s) in line.enumerated() {
                let ok = (s >= "A" && s <= "Z") || (s >= "a" && s <= "z") || (s >= "0" && s <= "9") || s == "+" || s == "/" || s == "=" || s == " " || s == "\t" || s == "\r"
                if !ok {
                    throw RSAKeyError(
                        "第 \(firstLine + i) 行第 \(col + 1) 列出现非 Base64 字符「\(describeScalar(s))」",
                        "Line \(firstLine + i), column \(col + 1) has a non-Base64 character “\(describeScalar(s))”"
                    )
                }
            }
        }
        do {
            let der = try Base64Codec.decode(body, label: LocalizedText("PEM 内容", "PEM body"))
            if der.isEmpty { throw RSAKeyError("PEM 内容为空", "The PEM body is empty") }
            return (label, der)
        } catch let e as ByteDecodeError {
            throw RSAKeyError(e.message.zh, e.message.en)
        }
    }
}

// MARK: - RSA 密钥

public struct RSAPublicKeyParts: Sendable, Hashable {
    public var n: [UInt8]
    public var e: [UInt8]
}

public struct RSAPrivateKeyParts: Sendable, Hashable {
    public var n: [UInt8], e: [UInt8], d: [UInt8], p: [UInt8], q: [UInt8], dp: [UInt8], dq: [UInt8], qi: [UInt8]
}

public struct RSAKeyInfo: Sendable, Hashable {
    public enum Kind: String, Sendable { case `public`, `private` }

    public enum Source: String, Sendable {
        case spki, pkcs1Public, openssh, x509, pkcs8, pkcs1Private, jwk

        public var label: LocalizedText {
            switch self {
            case .spki: LocalizedText("SPKI（X.509 公钥）", "SPKI (X.509 public key)")
            case .pkcs1Public: LocalizedText("PKCS#1 公钥", "PKCS#1 public key")
            case .openssh: LocalizedText("OpenSSH 公钥", "OpenSSH public key")
            case .x509: LocalizedText("X.509 证书", "X.509 certificate")
            case .pkcs8: LocalizedText("PKCS#8 私钥", "PKCS#8 private key")
            case .pkcs1Private: LocalizedText("PKCS#1 私钥", "PKCS#1 private key")
            case .jwk: LocalizedText("JWK", "JWK")
            }
        }
    }

    public var kind: Kind
    public var source: Source
    /// 规范化后的 DER：公钥为 SPKI，私钥为 PKCS#8（算法 OID 统一为 rsaEncryption）
    public var der: [UInt8]
    /// 内层 PKCS#1 结构（RSAPublicKey / RSAPrivateKey），Security 框架导入时用
    public var pkcs1: [UInt8]
    public var bits: Int
    /// 公钥指数（十进制）
    public var exponent: String
    /// 模数（十六进制，无前导 0）
    public var modulusHex: String
    /// 原密钥是否带 RSASSA-PSS 专用 OID（已自动转换）
    public var pssOID: Bool

    /// 对应的 SPKI 公钥
    public var spki: [UInt8] {
        kind == .public ? der : (try? RSAKeys.publicFromPrivate(pkcs8: der)) ?? []
    }

    /// 两把密钥是否为一对
    public func matches(_ other: RSAKeyInfo) -> Bool {
        modulusHex == other.modulusHex && exponent == other.exponent
    }
}

public enum RSAPublicFormat: String, CaseIterable, Sendable { case spki, pkcs1, openssh, jwk }
public enum RSAPrivateFormat: String, CaseIterable, Sendable { case pkcs8, pkcs1, jwk }

public enum RSAKeys {
    static let rsaOID = "1.2.840.113549.1.1.1"
    static let pssOID = "1.2.840.113549.1.1.10"
    static let otherKeyOIDs: [String: LocalizedText] = [
        "1.2.840.10045.2.1": LocalizedText("EC（椭圆曲线）", "EC (elliptic curve)"),
        "1.3.101.112": LocalizedText("Ed25519", "Ed25519"),
        "1.3.101.113": LocalizedText("Ed448", "Ed448"),
        "1.3.101.110": LocalizedText("X25519", "X25519"),
        "1.3.101.111": LocalizedText("X448", "X448"),
        "1.2.840.10040.4.1": LocalizedText("DSA", "DSA"),
        "1.2.840.10046.2.1": LocalizedText("DH", "DH"),
        "1.2.156.10197.1.301": LocalizedText("SM2", "SM2"),
    ]

    /// AlgorithmIdentifier { rsaEncryption, NULL }
    static let rsaAlgorithmID: [UInt8] = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]

    /// 检查 AlgorithmIdentifier；返回是否为 RSASSA-PSS 专用 OID
    static func checkAlgorithm(_ der: [UInt8], _ algID: DER.TLV) throws -> Bool {
        guard let oidTLV = try DER.children(der, algID).first, oidTLV.tag == DER.oid else {
            throw RSAKeyError("算法标识缺少 OID", "The algorithm identifier has no OID")
        }
        let oid = DER.decodeOID(DER.value(der, oidTLV))
        if oid == rsaOID { return false }
        if oid == pssOID { return true }
        if let name = otherKeyOIDs[oid] {
            throw RSAKeyError("这是 \(name.zh)\(name.zh.hasSuffix("）") ? "" : " ")密钥，不是 RSA 密钥", "This key is \(name.en), not RSA")
        }
        throw RSAKeyError("不是 RSA 密钥（算法 OID 为 \(oid)）", "Not an RSA key (algorithm OID \(oid))")
    }

    /// PKCS#1 RSAPrivateKey → PKCS#8 PrivateKeyInfo
    public static func wrapPKCS1Private(_ pkcs1: [UInt8]) -> [UInt8] {
        DER.encode(DER.sequence, [0x02, 0x01, 0x00] + rsaAlgorithmID + DER.encode(DER.octetString, pkcs1))
    }

    /// PKCS#1 RSAPublicKey → SPKI SubjectPublicKeyInfo
    public static func wrapPKCS1Public(_ pkcs1: [UInt8]) -> [UInt8] {
        DER.encode(DER.sequence, rsaAlgorithmID + DER.encode(DER.bitString, [0] + pkcs1))
    }

    /// PKCS#8 → 内层 PKCS#1 RSAPrivateKey
    public static func unwrapPKCS8(_ pkcs8: [UInt8]) throws -> [UInt8] {
        let kids = try DER.children(pkcs8, DER.rootSequence(pkcs8))
        guard kids.count >= 3, kids[0].tag == DER.integer, kids[1].tag == DER.sequence, kids[2].tag == DER.octetString else {
            throw RSAKeyError("不是有效的 PKCS#8 私钥结构", "Not a valid PKCS#8 private key structure")
        }
        _ = try checkAlgorithm(pkcs8, kids[1])
        return DER.value(pkcs8, kids[2])
    }

    /// SPKI → 内层 PKCS#1 RSAPublicKey（SecKeyCreateWithData 需要的格式）
    public static func unwrapSPKI(_ spki: [UInt8]) throws -> [UInt8] {
        let kids = try DER.children(spki, DER.rootSequence(spki))
        guard kids.count == 2, kids[0].tag == DER.sequence, kids[1].tag == DER.bitString else {
            throw RSAKeyError("不是有效的 SPKI 公钥结构", "Not a valid SPKI public key structure")
        }
        _ = try checkAlgorithm(spki, kids[0])
        let bits = DER.value(spki, kids[1])
        guard bits.first == 0 else { throw RSAKeyError("公钥 BIT STRING 的未用位数应为 0", "The public key BIT STRING must have 0 unused bits") }
        return Array(bits.dropFirst())
    }

    static func integers(_ der: [UInt8], _ count: Int, _ what: LocalizedText) throws -> [[UInt8]] {
        let kids = try DER.children(der, DER.rootSequence(der))
        guard kids.count >= count, kids.prefix(count).allSatisfy({ $0.tag == DER.integer }) else {
            throw RSAKeyError("不是有效的 \(what.zh) 结构", "Not a valid \(what.en) structure")
        }
        return kids.prefix(count).map { DER.stripLeadingZeros(DER.value(der, $0)) }
    }

    public static func readPKCS1Public(_ pkcs1: [UInt8]) throws -> RSAPublicKeyParts {
        let v = try integers(pkcs1, 2, LocalizedText("PKCS#1 公钥", "PKCS#1 public key"))
        return RSAPublicKeyParts(n: v[0], e: v[1])
    }

    public static func readPKCS1Private(_ pkcs1: [UInt8]) throws -> RSAPrivateKeyParts {
        let v = try integers(pkcs1, 9, LocalizedText("PKCS#1 私钥", "PKCS#1 private key"))
        guard v[0].count == 1, v[0][0] <= 1 else { throw RSAKeyError("PKCS#1 私钥版本号无效", "Invalid PKCS#1 private key version") }
        return RSAPrivateKeyParts(n: v[1], e: v[2], d: v[3], p: v[4], q: v[5], dp: v[6], dq: v[7], qi: v[8])
    }

    public static func buildPKCS1Public(_ k: RSAPublicKeyParts) -> [UInt8] {
        DER.encode(DER.sequence, DER.encodeUnsignedInteger(k.n) + DER.encodeUnsignedInteger(k.e))
    }

    public static func buildPKCS1Private(_ k: RSAPrivateKeyParts) -> [UInt8] {
        DER.encode(DER.sequence, [0x02, 0x01, 0x00] + [k.n, k.e, k.d, k.p, k.q, k.dp, k.dq, k.qi].flatMap(DER.encodeUnsignedInteger))
    }

    /// 从 PKCS#8 私钥推导 SPKI 公钥
    public static func publicFromPrivate(pkcs8: [UInt8]) throws -> [UInt8] {
        let k = try readPKCS1Private(unwrapPKCS8(pkcs8))
        return wrapPKCS1Public(buildPKCS1Public(RSAPublicKeyParts(n: k.n, e: k.e)))
    }

    /// 从 X.509 证书中取出 SubjectPublicKeyInfo
    public static func spkiFromCertificate(_ cert: [UInt8]) throws -> [UInt8] {
        let top = try DER.children(cert, DER.rootSequence(cert))
        guard top.count == 3, top[0].tag == DER.sequence else { throw RSAKeyError("不是有效的 X.509 证书结构", "Not a valid X.509 certificate structure") }
        let tbs = try DER.children(cert, top[0])
        // [0] version 可选；随后依次为 serialNumber、signature、issuer、validity、subject、subjectPublicKeyInfo
        let start = tbs.first?.tag == 0xA0 ? 1 : 0
        guard tbs.count > start + 5, tbs[start + 5].tag == DER.sequence else {
            throw RSAKeyError("证书中找不到公钥信息", "No public key info found in the certificate")
        }
        let spki = tbs[start + 5]
        return Array(cert[spki.start..<spki.end])
    }

    public enum DERKind: String, Sendable { case spki, pkcs8, pkcs1Public, pkcs1Private, x509 }

    /// 按结构识别 DER 内容
    public static func detect(_ der: [UInt8]) throws -> DERKind {
        let tags = try DER.children(der, DER.rootSequence(der)).map(\.tag)
        if tags == [DER.sequence, DER.bitString] { return .spki }
        if tags == [DER.sequence, DER.sequence, DER.bitString] { return .x509 }
        if tags.count >= 3, tags[0] == DER.integer, tags[1] == DER.sequence, tags[2] == DER.octetString { return .pkcs8 }
        if tags == [DER.integer, DER.integer] { return .pkcs1Public }
        if tags.count >= 9, tags.prefix(9).allSatisfy({ $0 == DER.integer }) { return .pkcs1Private }
        throw RSAKeyError("无法识别的 DER 结构：不是 SPKI / PKCS#8 / PKCS#1 密钥或 X.509 证书",
                          "Unrecognized DER structure: not an SPKI / PKCS#8 / PKCS#1 key or an X.509 certificate")
    }

    static func bitLength(_ n: [UInt8]) -> Int {
        let v = DER.stripLeadingZeros(n)
        guard let first = v.first, first != 0 else { return 0 }
        return (v.count - 1) * 8 + (8 - first.leadingZeroBitCount)
    }

    /// 大端无符号整数 → 十进制字符串
    public static func decimal(_ bytes: [UInt8]) -> String {
        var num = DER.stripLeadingZeros(bytes)
        if num.isEmpty || num == [0] { return "0" }
        var digits: [Character] = []
        while !(num.count == 1 && num[0] == 0) && !num.isEmpty {
            var rem = 0
            var next: [UInt8] = []
            for b in num {
                let cur = rem << 8 | Int(b)
                let q = cur / 10
                rem = cur % 10
                if !next.isEmpty || q != 0 { next.append(UInt8(q)) }
            }
            digits.append(Character(String(rem)))
            num = next.isEmpty ? [0] : next
        }
        return String(digits.reversed())
    }

    static func publicInfo(_ pkcs1: [UInt8], _ source: RSAKeyInfo.Source, pss: Bool = false) throws -> RSAKeyInfo {
        let k = try readPKCS1Public(pkcs1)
        let normalized = buildPKCS1Public(k)
        return RSAKeyInfo(kind: .public, source: source, der: wrapPKCS1Public(normalized), pkcs1: normalized,
                          bits: bitLength(k.n), exponent: decimal(k.e), modulusHex: HexCodec.encode(DER.stripLeadingZeros(k.n)), pssOID: pss)
    }

    static func privateInfo(_ pkcs1: [UInt8], _ source: RSAKeyInfo.Source, pss: Bool = false) throws -> RSAKeyInfo {
        let k = try readPKCS1Private(pkcs1)
        return RSAKeyInfo(kind: .private, source: source, der: wrapPKCS1Private(pkcs1), pkcs1: pkcs1,
                          bits: bitLength(k.n), exponent: decimal(k.e), modulusHex: HexCodec.encode(DER.stripLeadingZeros(k.n)), pssOID: pss)
    }

    static func fromDER(_ der: [UInt8]) throws -> RSAKeyInfo {
        switch try detect(der) {
        case .spki:
            let kids = try DER.children(der, DER.rootSequence(der))
            return try publicInfo(unwrapSPKI(der), .spki, pss: checkAlgorithm(der, kids[0]))
        case .pkcs8:
            let kids = try DER.children(der, DER.rootSequence(der))
            return try privateInfo(unwrapPKCS8(der), .pkcs8, pss: checkAlgorithm(der, kids[1]))
        case .pkcs1Public: return try publicInfo(der, .pkcs1Public)
        case .pkcs1Private: return try privateInfo(der, .pkcs1Private)
        case .x509: return try publicInfo(unwrapSPKI(spkiFromCertificate(der)), .x509)
        }
    }

    /// 解析用户粘贴的 RSA 密钥：PEM（SPKI / PKCS#8 / PKCS#1 / 证书）、裸 Base64 DER、
    /// 「ssh-rsa AAAA…」OpenSSH 公钥、JWK 或 JWK Set（取第一个 RSA 密钥）。
    public static func parse(_ text: String) throws -> RSAKeyInfo {
        let s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { throw RSAKeyError("请粘贴密钥", "Paste a key") }
        if s.hasPrefix("{") {
            let json: JSONValue
            do { json = try JSON.value(s) } catch let e as JSONParseError {
                throw RSAKeyError("JWK 不是有效的 JSON：\(e.toolError(.zh).message)", "The JWK is not valid JSON: \(e.toolError(.en).message)")
            }
            let (kind, der) = try jwkToDER(pickJWK(json))
            return kind == .public ? try publicInfo(unwrapSPKI(der), .jwk) : try privateInfo(unwrapPKCS8(der), .jwk)
        }
        if s.hasPrefix("ssh-") || s.hasPrefix("ecdsa-sha2-") {
            return try publicInfo(unwrapSPKI(parseOpenSSH(s)), .openssh)
        }
        if let pem = try PEM.decode(s) {
            switch pem.label {
            case "ENCRYPTED PRIVATE KEY":
                throw RSAKeyError("这是用口令加密的 PKCS#8 私钥，无法直接使用。请先解密：openssl pkcs8 -in key.pem -out plain.pem",
                                  "This is a passphrase-encrypted PKCS#8 key. Decrypt it first: openssl pkcs8 -in key.pem -out plain.pem")
            case "OPENSSH PRIVATE KEY":
                throw RSAKeyError("这是 OpenSSH 格式的私钥，请先转换为 PEM：ssh-keygen -p -m PKCS8 -f id_rsa（会原地改写文件，请先备份）",
                                  "This is an OpenSSH private key. Convert it to PEM first: ssh-keygen -p -m PKCS8 -f id_rsa (rewrites the file in place; back it up)")
            case "EC PRIVATE KEY": throw RSAKeyError("这是 EC（椭圆曲线）私钥，不是 RSA 密钥", "This is an EC (elliptic curve) private key, not an RSA key")
            case "DSA PRIVATE KEY": throw RSAKeyError("这是 DSA 私钥，不是 RSA 密钥", "This is a DSA private key, not an RSA key")
            case "CERTIFICATE REQUEST", "NEW CERTIFICATE REQUEST":
                throw RSAKeyError("这是证书签名请求（CSR），不是密钥", "This is a certificate signing request (CSR), not a key")
            default: break
            }
            // 以内容结构为准（PKCS#1 / PKCS#8 标签写错也能用），但公私钥类别必须与标签一致
            let info = try fromDER(pem.der)
            if pem.label.contains("PRIVATE") && info.kind != .private {
                throw RSAKeyError("PEM 标签为「\(pem.label)」，但内容是公钥", "The PEM label is “\(pem.label)” but the content is a public key")
            }
            if pem.label.contains("PUBLIC") && info.kind != .public {
                throw RSAKeyError("PEM 标签为「\(pem.label)」，但内容是私钥", "The PEM label is “\(pem.label)” but the content is a private key")
            }
            return info
        }
        if s.hasPrefix("-----") {
            throw RSAKeyError("PEM 开头行格式不正确，应形如「-----BEGIN PUBLIC KEY-----」", "The PEM header is malformed; it should look like “-----BEGIN PUBLIC KEY-----”")
        }
        // 没有 PEM 头尾：当作 Base64 编码的 DER
        guard let der = try? Base64Codec.decode(s), !der.isEmpty else {
            throw RSAKeyError("无法识别的密钥格式：请粘贴 PEM（-----BEGIN … KEY-----）、Base64 DER、ssh-rsa 公钥或 JWK",
                              "Unrecognized key format: paste a PEM (-----BEGIN … KEY-----), Base64 DER, an ssh-rsa public key or a JWK")
        }
        return try fromDER(der)
    }

    // MARK: 导出

    public static func exportPublic(spki: [UInt8], format: RSAPublicFormat, comment: String = "showme-rsa") throws -> String {
        switch format {
        case .spki: return PEM.encode(spki, label: "PUBLIC KEY")
        case .pkcs1: return PEM.encode(try unwrapSPKI(spki), label: "RSA PUBLIC KEY")
        case .openssh: return try toOpenSSH(spki: spki, comment: comment) + "\n"
        case .jwk: return JSON.print(try publicJWK(spki: spki)) + "\n"
        }
    }

    public static func exportPrivate(pkcs8: [UInt8], format: RSAPrivateFormat) throws -> String {
        switch format {
        case .pkcs8: return PEM.encode(pkcs8, label: "PRIVATE KEY")
        case .pkcs1: return PEM.encode(try unwrapPKCS8(pkcs8), label: "RSA PRIVATE KEY")
        case .jwk: return JSON.print(try privateJWK(pkcs8: pkcs8)) + "\n"
        }
    }

    // MARK: OpenSSH

    static func sshString(_ b: [UInt8]) -> [UInt8] {
        let n = UInt32(b.count)
        return [UInt8(n >> 24), UInt8(n >> 16 & 255), UInt8(n >> 8 & 255), UInt8(n & 255)] + b
    }

    /// SSH mpint：大端补码，正数最高位为 1 时补 0
    static func sshMpint(_ unsigned: [UInt8]) -> [UInt8] {
        var v = DER.stripLeadingZeros(unsigned)
        if v == [0] { v = [] } else if let f = v.first, f & 0x80 != 0 { v.insert(0, at: 0) }
        return sshString(v)
    }

    static func sshBlob(_ k: RSAPublicKeyParts) -> [UInt8] {
        sshString(Array("ssh-rsa".utf8)) + sshMpint(k.e) + sshMpint(k.n)
    }

    public static func toOpenSSH(spki: [UInt8], comment: String = "") throws -> String {
        let blob = sshBlob(try readPKCS1Public(unwrapSPKI(spki)))
        return "ssh-rsa " + Base64Codec.encode(blob) + (comment.isEmpty ? "" : " " + comment)
    }

    /// 「ssh-rsa AAAA… 注释」一行 → SPKI
    public static func parseOpenSSH(_ line: String) throws -> [UInt8] {
        let parts = line.split(whereSeparator: \.isWhitespace).map(String.init)
        guard parts.first == "ssh-rsa" else {
            throw RSAKeyError("只支持 ssh-rsa 公钥，当前类型为 \(parts.first ?? "")", "Only ssh-rsa public keys are supported; this one is \(parts.first ?? "")")
        }
        guard parts.count > 1 else { throw RSAKeyError("ssh-rsa 后缺少 Base64 数据", "Base64 data is missing after ssh-rsa") }
        let blob: [UInt8]
        do { blob = try Base64Codec.decode(parts[1], label: LocalizedText("OpenSSH 公钥", "OpenSSH public key")) } catch let e as ByteDecodeError {
            throw RSAKeyError(e.message.zh, e.message.en)
        }
        var p = 0
        func next() throws -> [UInt8] {
            guard p + 4 <= blob.count else { throw RSAKeyError("OpenSSH 公钥数据被截断", "The OpenSSH public key data is truncated") }
            let len = Int(blob[p]) << 24 | Int(blob[p + 1]) << 16 | Int(blob[p + 2]) << 8 | Int(blob[p + 3])
            p += 4
            guard len >= 0, p + len <= blob.count else { throw RSAKeyError("OpenSSH 公钥数据被截断", "The OpenSSH public key data is truncated") }
            defer { p += len }
            return Array(blob[p..<(p + len)])
        }
        let type = String(decoding: try next(), as: UTF8.self)
        guard type == "ssh-rsa" else { throw RSAKeyError("公钥数据中的类型为 \(type)，不是 ssh-rsa", "The key data says \(type), not ssh-rsa") }
        let e = try next()
        let n = try next()
        return wrapPKCS1Public(buildPKCS1Public(RSAPublicKeyParts(n: DER.stripLeadingZeros(n), e: DER.stripLeadingZeros(e))))
    }

    /// OpenSSH 风格指纹（SHA256:base64 无填充）与 SPKI 的 SHA-256（冒号分隔）
    public static func fingerprints(spki: [UInt8]) throws -> (openssh: String, spkiSHA256: String) {
        let blob = sshBlob(try readPKCS1Public(unwrapSPKI(spki)))
        let ssh = "SHA256:" + Base64Codec.encode(Hash.digest(.sha256, blob), padding: false)
        return (ssh, HexCodec.encode(Hash.digest(.sha256, spki), separator: ":"))
    }

    // MARK: JWK

    public static func publicJWK(spki: [UInt8]) throws -> JSONValue {
        let k = try readPKCS1Public(unwrapSPKI(spki))
        return .object([
            JSONMember("kty", .string("RSA")),
            JSONMember("n", .string(Base64Codec.encodeURL(k.n))),
            JSONMember("e", .string(Base64Codec.encodeURL(k.e))),
        ])
    }

    public static func privateJWK(pkcs8: [UInt8]) throws -> JSONValue {
        let k = try readPKCS1Private(unwrapPKCS8(pkcs8))
        let fields: [(String, [UInt8])] = [("n", k.n), ("e", k.e), ("d", k.d), ("p", k.p), ("q", k.q), ("dp", k.dp), ("dq", k.dq), ("qi", k.qi)]
        return .object([JSONMember("kty", .string("RSA"))] + fields.map { JSONMember($0.0, .string(Base64Codec.encodeURL($0.1))) })
    }

    /// JWK Set 取第一个 RSA 密钥；普通 JWK 原样返回
    static func pickJWK(_ json: JSONValue) throws -> [JSONMember] {
        guard let members = json.members else {
            throw RSAKeyError("JWK 应为 JSON 对象，如 {\"kty\":\"RSA\",\"n\":\"…\",\"e\":\"AQAB\"}", "A JWK should be a JSON object such as {\"kty\":\"RSA\",\"n\":\"…\",\"e\":\"AQAB\"}")
        }
        if json["kty"] == nil, let keys = json["keys"]?.items {
            guard let rsa = keys.first(where: { $0["kty"] == .string("RSA") })?.members else {
                throw RSAKeyError("JWK Set 中的 \(keys.count) 个密钥都不是 RSA 密钥", "None of the \(keys.count) keys in the JWK Set is an RSA key")
            }
            return rsa
        }
        return members
    }

    static func jwkField(_ jwk: JSONValue, _ name: String) throws -> [UInt8] {
        guard let v = jwk[name], v != .string("") else {
            if ["p", "q", "dp", "dq", "qi"].contains(name) {
                throw RSAKeyError("私钥 JWK 缺少 CRT 参数「\(name)」：需要同时包含 p、q、dp、dq、qi",
                                  "The private JWK is missing the CRT parameter “\(name)”; p, q, dp, dq and qi are all required")
            }
            throw RSAKeyError("JWK 缺少字段「\(name)」", "The JWK is missing “\(name)”")
        }
        guard let s = v.stringValue else {
            throw RSAKeyError("JWK 字段「\(name)」应为 Base64URL 字符串", "The JWK field “\(name)” should be a Base64URL string")
        }
        do { return try Base64Codec.decode(s, label: LocalizedText("JWK 字段 \(name)", "JWK field \(name)")) } catch let e as ByteDecodeError {
            throw RSAKeyError(e.message.zh, e.message.en)
        }
    }

    /// JWK → SPKI 或 PKCS#8（含 d 即视为私钥）
    public static func jwkToDER(_ members: [JSONMember]) throws -> (RSAKeyInfo.Kind, [UInt8]) {
        let jwk = JSONValue.object(members)
        guard jwk["kty"] == .string("RSA") else {
            throw RSAKeyError("JWK 的 kty 为「\(jwk["kty"]?.scalarText ?? "")」，不是 RSA", "The JWK kty is “\(jwk["kty"]?.scalarText ?? "")”, not RSA")
        }
        let n = try jwkField(jwk, "n"), e = try jwkField(jwk, "e")
        if jwk["d"] == nil {
            return (.public, wrapPKCS1Public(buildPKCS1Public(RSAPublicKeyParts(n: n, e: e))))
        }
        let k = RSAPrivateKeyParts(n: n, e: e, d: try jwkField(jwk, "d"), p: try jwkField(jwk, "p"), q: try jwkField(jwk, "q"),
                                   dp: try jwkField(jwk, "dp"), dq: try jwkField(jwk, "dq"), qi: try jwkField(jwk, "qi"))
        return (.private, wrapPKCS1Private(buildPKCS1Private(k)))
    }

    // MARK: 加密上限

    /// OAEP 单次可加密的最大明文字节数：k − 2·hLen − 2
    public static func maxOAEPPlaintext(bits: Int, hashLength: Int) -> Int {
        max(0, (bits + 7) / 8 - 2 * hashLength - 2)
    }

    /// PKCS#1 v1.5 单次可加密的最大明文字节数：k − 11
    public static func maxPKCS1Plaintext(bits: Int) -> Int {
        max(0, (bits + 7) / 8 - 11)
    }
}
