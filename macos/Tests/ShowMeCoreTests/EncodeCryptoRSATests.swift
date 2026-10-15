import XCTest
@testable import ShowMeCore

final class EncodeCryptoRSATests: XCTestCase {
    typealias F = EncodeCryptoRSAFixtures

    func der(_ pem: String) throws -> [UInt8] { try XCTUnwrap(try PEM.decode(pem)).der }

    func message(_ f: () throws -> Void) -> String {
        do { try f() } catch let e as RSAKeyError { return e.message.zh } catch { return "\(error)" }
        return ""
    }

    func testOIDAndDetect() throws {
        XCTAssertEqual(DER.decodeOID([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]), "1.2.840.113549.1.1.1")
        XCTAssertEqual(DER.decodeOID([0x2b, 0x65, 0x70]), "1.3.101.112")
        XCTAssertEqual(try RSAKeys.detect(der(F.spkiPublicPem)), .spki)
        XCTAssertEqual(try RSAKeys.detect(der(F.pkcs8PrivatePem)), .pkcs8)
        XCTAssertEqual(try RSAKeys.detect(der(F.pkcs1PrivatePem)), .pkcs1Private)
        XCTAssertEqual(try RSAKeys.detect(der(F.pkcs1PublicPem)), .pkcs1Public)
        XCTAssertEqual(try RSAKeys.detect(der(F.certPem)), .x509)
        XCTAssertTrue(message { _ = try RSAKeys.detect([0x02, 0x01, 0x00]) }.contains("SEQUENCE"))
        XCTAssertTrue(message { _ = try DER.read([0x30, 0x82, 0x01], at: 0) }.contains("截断"))
    }

    func testWrapUnwrapAndExportExactlyLikeOpenSSL() throws {
        XCTAssertEqual(RSAKeys.wrapPKCS1Private(try der(F.pkcs1PrivatePem)), try der(F.pkcs8PrivatePem))
        XCTAssertEqual(RSAKeys.wrapPKCS1Public(try der(F.pkcs1PublicPem)), try der(F.spkiPublicPem))
        XCTAssertEqual(try RSAKeys.unwrapPKCS8(der(F.pkcs8PrivatePem)), try der(F.pkcs1PrivatePem))
        XCTAssertEqual(try RSAKeys.unwrapSPKI(der(F.spkiPublicPem)), try der(F.pkcs1PublicPem))
        let pkcs8 = try der(F.pkcs8PrivatePem), spki = try der(F.spkiPublicPem)
        XCTAssertEqual(try RSAKeys.exportPrivate(pkcs8: pkcs8, format: .pkcs8), F.pkcs8PrivatePem)
        XCTAssertEqual(try RSAKeys.exportPrivate(pkcs8: pkcs8, format: .pkcs1), F.pkcs1PrivatePem)
        XCTAssertEqual(try RSAKeys.exportPublic(spki: spki, format: .spki), F.spkiPublicPem)
        XCTAssertEqual(try RSAKeys.exportPublic(spki: spki, format: .pkcs1), F.pkcs1PublicPem)
        XCTAssertEqual(try RSAKeys.publicFromPrivate(pkcs8: pkcs8), spki)
        XCTAssertEqual(try RSAKeys.spkiFromCertificate(der(F.certPem)), spki)
        // 重新组装 PKCS#1 私钥与原文逐字节一致
        XCTAssertEqual(RSAKeys.buildPKCS1Private(try RSAKeys.readPKCS1Private(der(F.pkcs1PrivatePem))), try der(F.pkcs1PrivatePem))
    }

    func testOpenSSHJWKAndFingerprints() throws {
        let spki = try der(F.spkiPublicPem)
        let line = try RSAKeys.toOpenSSH(spki: spki, comment: "me@host")
        XCTAssertEqual(line, "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQDNOzSE1ToduJ+8VmvvvGJahN11xLEdVfqa/wjaAax+KK2BDmg7iMDR4XnVPKq6yhjDO0v95pBUos/mXK+UwpHSoEv53zmOPC8qPOpVZjdIh+ftBx2MwfkPccj5XEmQpwbL2USXxUXkeWoKqjYmU6Qqk1DaM8cAQcfVd7vKF0q4Mw== me@host")
        let parsed = try RSAKeys.parse(line)
        XCTAssertEqual(parsed.source, .openssh)
        XCTAssertEqual(parsed.der, spki)
        let fp = try RSAKeys.fingerprints(spki: spki)
        XCTAssertEqual(fp.openssh, "SHA256:kwuSlFU/Eod7KWr954FZCmtp4ua6q6z4OJkXne5dEss")
        XCTAssertEqual(fp.spkiSHA256, "6d:a9:71:f8:21:41:9d:1d:f9:ef:66:8e:5e:52:b5:8c:a3:0f:ae:cc:2e:7e:a0:06:43:8f:ae:14:ce:ca:30:7c")

        // 与 Node 导出的 JWK 一致
        let nodePublic = #"{"kty":"RSA","n":"zTs0hNU6HbifvFZr77xiWoTddcSxHVX6mv8I2gGsfiitgQ5oO4jA0eF51TyqusoYwztL_eaQVKLP5lyvlMKR0qBL-d85jjwvKjzqVWY3SIfn7QcdjMH5D3HI-VxJkKcGy9lEl8VF5HlqCqo2JlOkKpNQ2jPHAEHH1Xe7yhdKuDM","e":"AQAB"}"#
        XCTAssertEqual(JSON.print(try RSAKeys.publicJWK(spki: spki), .minified), nodePublic)
        let priv = try RSAKeys.privateJWK(pkcs8: der(F.pkcs8PrivatePem))
        XCTAssertEqual(priv["qi"], .string("YtgCuW0kX-HrEdG_iDiqKv2fzjxU48eeep6qT6LelCL6WZQcpO6bNHLPQfPqFpj9mSe3bbzfyGgPxwvsLqXk9A"))
        XCTAssertEqual(priv["p"], .string("-YmTwShjcECHnf_LFdgS9FTEsWZvSk-Bb8SYmdCt8GcGW4CTCVit5ix6Lyx1nn2LbkaMar0kG_lcF_c9fL7stQ"))
        let back = try RSAKeys.parse(JSON.print(priv))
        XCTAssertEqual(back.kind, .private)
        XCTAssertEqual(back.source, .jwk)
        XCTAssertEqual(back.der, try der(F.pkcs8PrivatePem))
        let set = #"{"keys":[{"kty":"EC","crv":"P-256","x":"AA","y":"AA"},"# + nodePublic.replacingOccurrences(of: #""AQAB"}"#, with: #""AQAB","kid":"k1"}"#) + "]}"
        XCTAssertEqual(try RSAKeys.parse(set).der, spki)
        XCTAssertTrue(message { _ = try RSAKeys.parse(#"{"keys":[{"kty":"EC"}]}"#) }.contains("都不是 RSA 密钥"))
        XCTAssertTrue(message { _ = try RSAKeys.parse(#"{"keys":[]}"#) }.contains("0 个密钥都不是 RSA"))
        let n = try XCTUnwrap(priv["n"]?.stringValue), e = try XCTUnwrap(priv["e"]?.stringValue), d = try XCTUnwrap(priv["d"]?.stringValue)
        XCTAssertTrue(message { _ = try RSAKeys.parse(#"{"kty":"RSA","n":"\#(n)","e":"\#(e)","d":"\#(d)"}"#) }.contains("缺少 CRT 参数「p」"))
        XCTAssertTrue(message { _ = try RSAKeys.parse(#"{"kty":"RSA","n":123,"e":"AQAB"}"#) }.contains("字段「n」应为 Base64URL 字符串"))
    }

    func testParseEveryFormat() throws {
        let cases: [(String, RSAKeyInfo.Source, RSAKeyInfo.Kind)] = [
            (F.spkiPublicPem, .spki, .public), (F.pkcs1PublicPem, .pkcs1Public, .public), (F.pkcs8PrivatePem, .pkcs8, .private),
            (F.pkcs1PrivatePem, .pkcs1Private, .private), (F.certPem, .x509, .public),
        ]
        for (pem, source, kind) in cases {
            let info = try RSAKeys.parse(pem)
            XCTAssertEqual(info.source, source)
            XCTAssertEqual(info.kind, kind)
            XCTAssertEqual(info.bits, 1024)
            XCTAssertEqual(info.exponent, "65537")
            XCTAssertEqual(info.modulusHex, F.modulusHex)
            XCTAssertEqual(info.der, try der(kind == .public ? F.spkiPublicPem : F.pkcs8PrivatePem))
        }
        XCTAssertEqual(try RSAKeys.parse(Base64Codec.encode(der(F.spkiPublicPem))).source, .spki)
        // Windows 换行
        XCTAssertEqual(try RSAKeys.parse(F.pkcs8PrivatePem.replacingOccurrences(of: "\n", with: "\r\n")).der, try der(F.pkcs8PrivatePem))
        XCTAssertEqual(try RSAKeys.parse(try RSAKeys.toOpenSSH(spki: der(F.spkiPublicPem), comment: "c") + "\r\n").source, .openssh)
        XCTAssertEqual(try RSAKeys.parse("注释\n" + F.pkcs8PrivatePem + "\n尾巴").kind, .private)
        let pssPriv = try RSAKeys.parse(F.pssPrivatePem), pssPub = try RSAKeys.parse(F.pssPublicPem)
        XCTAssertTrue(pssPriv.pssOID)
        XCTAssertTrue(pssPub.pssOID)
        XCTAssertTrue(pssPriv.matches(pssPub))
        XCTAssertEqual(try RSAKeys.detect(pssPub.der), .spki)
        XCTAssertTrue(HexCodec.encode(Array(pssPub.der.prefix(19))).contains("2a864886f70d010101"))
        XCTAssertTrue(try RSAKeys.parse(F.pkcs1PrivatePem).matches(RSAKeys.parse(F.spkiPublicPem)))
        XCTAssertFalse(pssPriv.matches(try RSAKeys.parse(F.spkiPublicPem)))
        XCTAssertEqual(RSAKeys.decimal([0x01, 0x00, 0x01]), "65537")
        XCTAssertEqual(RSAKeys.decimal([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]), "4722366482869645213695")
    }

    func testErrorsInBothLanguages() throws {
        XCTAssertEqual(message { _ = try RSAKeys.parse("") }, "请粘贴密钥")
        XCTAssertEqual(message { _ = try RSAKeys.parse(F.ecPublicPem) }, "这是 EC（椭圆曲线）密钥，不是 RSA 密钥")
        XCTAssertTrue(message { _ = try RSAKeys.parse(F.ed25519PrivatePem) }.contains("这是 Ed25519 密钥"))
        XCTAssertTrue(message { _ = try RSAKeys.parse(F.encryptedPkcs8Pem) }.contains("口令加密的 PKCS#8"))
        XCTAssertTrue(message { _ = try RSAKeys.parse(F.encryptedTraditionalPem) }.contains("口令加密的传统格式"))
        XCTAssertTrue(message { _ = try RSAKeys.parse("-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----") }.contains("OpenSSH 格式的私钥"))
        XCTAssertTrue(message { _ = try RSAKeys.parse(F.spkiPublicPem.replacingOccurrences(of: "-----END PUBLIC KEY-----", with: "")) }.contains("缺少结尾行"))
        var lines = F.spkiPublicPem.components(separatedBy: "\n")
        lines[1] = "#" + lines[1].dropFirst()
        XCTAssertEqual(message { _ = try RSAKeys.parse(lines.joined(separator: "\n")) }, "第 2 行第 1 列出现非 Base64 字符「#」")
        var truncated = F.spkiPublicPem.components(separatedBy: "\n")
        truncated.remove(at: 2)
        XCTAssertFalse(message { _ = try RSAKeys.parse(truncated.joined(separator: "\n")) }.isEmpty)
        XCTAssertTrue(message { _ = try RSAKeys.parse("hello world 你好") }.contains("无法识别的密钥格式"))
        XCTAssertTrue(message { _ = try RSAKeys.parse("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5") }.contains("只支持 ssh-rsa"))
        XCTAssertTrue(message { _ = try RSAKeys.parse(#"{"kty":"EC"}"#) }.contains("不是 RSA"))
        XCTAssertTrue(message { _ = try RSAKeys.parse(#"{"kty":"#) }.contains("JWK 不是有效的 JSON"))
        XCTAssertTrue(message { _ = try RSAKeys.parse(#"{"kty":"RSA","n":"AQAB"}"#) }.contains("JWK 缺少字段「e」"))
        XCTAssertTrue(message { _ = try RSAKeys.parse(F.pkcs8PrivatePem.replacingOccurrences(of: "PRIVATE KEY", with: "PUBLIC KEY")) }.contains("内容是私钥"))
        do { _ = try RSAKeys.parse(F.ecPublicPem) } catch let e as RSAKeyError { XCTAssertEqual(e.message.en, "This key is EC (elliptic curve), not RSA") }
    }

    func testLimits() {
        XCTAssertEqual(RSAKeys.maxOAEPPlaintext(bits: 1024, hashLength: 32), 62)
        XCTAssertEqual(RSAKeys.maxOAEPPlaintext(bits: 2048, hashLength: 32), 190)
        XCTAssertEqual(RSAKeys.maxOAEPPlaintext(bits: 2048, hashLength: 20), 214)
        XCTAssertEqual(RSAKeys.maxOAEPPlaintext(bits: 4096, hashLength: 64), 382)
        XCTAssertEqual(RSAKeys.maxOAEPPlaintext(bits: 1024, hashLength: 64), 0)
        XCTAssertEqual(RSAPadding.pkcs1.maxPlaintext(bits: 2048), 245)
    }

    // MARK: 工具

    let tool = RSATool.spec

    func testInspectToolWorksEverywhere() throws {
        let r = try tool(F.pkcs1PrivatePem, options: ["mode": "inspect"])
        XCTAssertEqual(r.primary?.value, F.pkcs8PrivatePem)
        XCTAssertEqual(r.outputs.first { $0.id == "spki" }?.value, F.spkiPublicPem)
        XCTAssertEqual(r.outputs.first { $0.id == "pkcs1Private" }?.value, F.pkcs1PrivatePem)
        XCTAssertTrue(r.outputs.first { $0.id == "openssh" }?.value.hasPrefix("ssh-rsa AAAAB3NzaC1yc2E") ?? false)
        XCTAssertEqual(r.table?.rows.first?[1], "私钥 · PKCS#1 私钥")
        XCTAssertEqual(r.table?.rows[1][1], "1024 位")
        XCTAssertTrue(r.notes.contains { $0.message.contains("短于 2048 位") })
        let pub = try tool(F.certPem, options: ["mode": "inspect"], lang: .en)
        XCTAssertEqual(pub.primary?.value, F.spkiPublicPem)
        XCTAssertEqual(pub.table?.rows.first?[1], "Public key · X.509 certificate")
        XCTAssertThrowsError(try tool(F.ecPublicPem, options: ["mode": "inspect"], lang: .en)) { e in
            XCTAssertEqual((e as? ToolError)?.message, "This key is EC (elliptic curve), not RSA")
        }
    }

    func testEncryptLimitsAreCheckedBeforeThePlatform() {
        // 超长明文在任何平台都会先报上限错误
        XCTAssertThrowsError(try tool(String(repeating: "x", count: 63), options: ["mode": "encrypt", "key": F.spkiPublicPem])) { e in
            XCTAssertEqual((e as? ToolError)?.message, "明文 63 字节，超过 RSA-1024 + OAEP-SHA256 单次加密上限 62 字节。长数据请用 AES 加密，再用 RSA 加密 AES 密钥（混合加密）")
        }
        XCTAssertThrowsError(try tool(String(repeating: "Q", count: 100), options: ["mode": "decrypt", "key": F.pkcs8PrivatePem])) { e in
            XCTAssertEqual((e as? ToolError)?.message, "密文长度为 75 字节，RSA-1024 的密文应恰好为 128 字节")
        }
        XCTAssertThrowsError(try tool("AAAA", options: ["mode": "decrypt", "key": F.spkiPublicPem])) { e in
            XCTAssertTrue((e as? ToolError)?.message.contains("需要私钥") ?? false)
        }
    }

    #if canImport(Security)
    func testSecurityRoundTrip() throws {
        let gen = try tool("", options: ["mode": "generate", "bits": "1024", "privateFormat": "pkcs8"])
        let privatePEM = try XCTUnwrap(gen.primary?.value)
        XCTAssertTrue(privatePEM.hasPrefix("-----BEGIN PRIVATE KEY-----"))
        let publicPEM = try XCTUnwrap(gen.outputs.first { $0.id == "public" }?.value)
        XCTAssertTrue(try RSAKeys.parse(privatePEM).matches(RSAKeys.parse(publicPEM)))
        for padding in RSAPadding.allCases {
            let ct = try XCTUnwrap(try tool("你好，showMe 🔐", options: ["mode": "encrypt", "key": publicPEM, "padding": padding.rawValue]).primary?.value)
            XCTAssertEqual(try tool(ct, options: ["mode": "decrypt", "key": privatePEM, "padding": padding.rawValue]).primary?.value, "你好，showMe 🔐")
        }
        // 与 OpenSSL 生成的 OAEP-SHA256 密文互通
        let openssl = "h61X21oU3lpKu1UR0Rp62rdFSxtzL9c4wdV36vwFoznYlZg5rsALs4v76mvo817SAuSrX5uT0naROZlXFxauwpsw2E515a+nBJolG36wYEmmgzJbAglwkn4W1TRWVYZcGsl0oRSAydsu+2xS4k/mBRt3fgJyrkUNoJ7Nvk514Vw="
        XCTAssertEqual(try tool(openssl, options: ["mode": "decrypt", "key": F.pkcs1PrivatePem]).primary?.value, "你好，RSA 🔐")
    }
    #else
    func testLinuxExplainsMacOSRequirement() {
        XCTAssertFalse(RSACrypto.isAvailable)
        XCTAssertThrowsError(try tool("", options: ["mode": "generate"])) { e in
            XCTAssertEqual((e as? ToolError)?.message, "RSA 生成密钥与加解密需要 macOS")
        }
        XCTAssertThrowsError(try tool("hi", options: ["mode": "encrypt", "key": F.spkiPublicPem], lang: .en)) { e in
            XCTAssertEqual((e as? ToolError)?.message, "RSA key generation and encryption require macOS")
        }
    }
    #endif
}
