import XCTest
@testable import ShowMeCore

final class EncodeCryptoToolTests: XCTestCase {
    // MARK: 登记

    func testRegistryAndSpecs() throws {
        let ids = ["base64", "url-codec", "html-entities", "unicode-escape", "jwt-decoder", "hash", "hmac", "aes-des", "rsa"]
        XCTAssertEqual(EncodeCryptoTools.all.map(\.id), ids)
        for spec in EncodeCryptoTools.all {
            XCTAssertNotNil(ToolRegistry.tool(spec.id), spec.id)
            XCTAssertFalse(spec.name.zh.isEmpty || spec.name.en.isEmpty || spec.summary.zh.isEmpty || spec.summary.en.isEmpty, spec.id)
            XCTAssertEqual(Set(spec.fields.map(\.id)).count, spec.fields.count, spec.id)
            for field in spec.fields {
                XCTAssertFalse(field.label.zh.isEmpty || field.label.en.isEmpty, "\(spec.id).\(field.id)")
                if case .choice(let choices) = field.kind {
                    XCTAssertTrue(choices.contains { $0.value == field.defaultValue }, "\(spec.id).\(field.id) default")
                }
                if let cond = field.visibleWhen { XCTAssertTrue(spec.fields.contains { $0.id == cond.field }, "\(spec.id).\(field.id) condition") }
            }
            // 默认选项下空输入不崩溃
            _ = try? spec("")
        }
        XCTAssertTrue(ToolRegistry.search("md5").contains { $0.id == "hash" })
        XCTAssertTrue(ToolRegistry.search("签名").contains { $0.id == "hmac" })
        XCTAssertTrue(ToolRegistry.search("cryptojs").contains { $0.id == "aes-des" })
        XCTAssertTrue(HMACTool.spec.fields.first { $0.id == "key" }?.isSecret ?? false)
        XCTAssertTrue(AESDESTool.spec.fields.first { $0.id == "key" }?.isSecret ?? false)
        XCTAssertTrue(JWTTool.spec.fields.first { $0.id == "secret" }?.isSecret ?? false)
    }

    // MARK: 哈希

    let hash = HashTool.spec

    func testHashAllAlgorithmsAndMD5Formats() throws {
        let r = try hash("abc")
        let byID = Dictionary(uniqueKeysWithValues: r.outputs.map { ($0.id, $0.value) })
        XCTAssertEqual(byID["md5"], "900150983cd24fb0d6963f7d28e17f72")
        XCTAssertEqual(byID["md5-16"], "3cd24fb0d6963f7d")
        XCTAssertEqual(byID["sha256"], "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertEqual(byID["sm3"], "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0")
        XCTAssertEqual(byID["blake3"], "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85")
        XCTAssertEqual(r.outputs.filter(\.isPrimary).count, 1)
        XCTAssertEqual(r.outputs.filter { $0.id.hasPrefix("md5-") && $0.id != "md5-16" }.map(\.value), [
            "900150983cd24fb0d6963f7d28e17f72", "900150983CD24FB0D6963F7D28E17F72", "3cd24fb0d6963f7d", "3CD24FB0D6963F7D",
        ])
        XCTAssertEqual(r.outputs.first { $0.id == "md5-32-lower" }?.label, "MD5 32 位小写")
        XCTAssertEqual(try hash("abc", lang: .en).outputs.first { $0.id == "md5-16-upper" }?.label, "MD5 16 uppercase")
    }

    func testHashOptions() throws {
        // 单个算法 + 大写；MD5 常用格式不受影响
        let up = try hash("abc", options: ["algorithm": "md5", "upper": "1"])
        XCTAssertEqual(up.primary?.value, "900150983CD24FB0D6963F7D28E17F72")
        XCTAssertEqual(up.outputs.first { $0.id == "md5-32-lower" }?.value, "900150983cd24fb0d6963f7d28e17f72")
        XCTAssertEqual(up.outputs.count, 5)
        let b64 = try hash("abc", options: ["algorithm": "md5", "format": "base64"])
        XCTAssertEqual(b64.primary?.value, "kAFQmDzST7DWlj99KOF/cg==")
        XCTAssertEqual(b64.outputs.first { $0.id == "md5-16-upper" }?.value, "3CD24FB0D6963F7D")
        XCTAssertEqual(try hash("abc", options: ["algorithm": "common"]).outputs.filter { !$0.id.hasPrefix("md5-") }.map(\.id), ["md5", "sha1", "sha256", "sha512"])
        XCTAssertEqual(try hash("abc", options: ["algorithm": "sha"]).outputs.count, 7 + 4)
        // 输入编码
        XCTAssertEqual(try hash("616263", options: ["algorithm": "md5", "encoding": "hex"]).primary?.value, "900150983cd24fb0d6963f7d28e17f72")
        XCTAssertEqual(try hash("YWJj", options: ["algorithm": "md5", "encoding": "base64"]).primary?.value, "900150983cd24fb0d6963f7d28e17f72")
        XCTAssertEqual(try hash("中文", options: ["algorithm": "md5"]).primary?.value, "a7bac2239fcdcb3a067903d8077c4a07")
        XCTAssertEqual(try hash("A中", options: ["algorithm": "sha1", "encoding": "utf16le"]).primary?.value, Hash.hex(.sha1, [0x41, 0x00, 0x2D, 0x4E]))
        XCTAssertEqual(try hash("é", options: ["algorithm": "md5", "encoding": "latin1"]).primary?.value, Hash.hex(.md5, [0xE9]))
        XCTAssertThrowsError(try hash("ab中", options: ["encoding": "latin1"])) { e in
            XCTAssertTrue((e as? ToolError)?.message.contains("第 3 个字符「中」超出 Latin-1 范围") ?? false)
        }
        XCTAssertThrowsError(try hash("0g", options: ["encoding": "hex"], lang: .en)) { e in
            XCTAssertTrue((e as? ToolError)?.message.hasPrefix("Input: Hex character 2") ?? false)
        }
    }

    func testHashVerify() throws {
        func notes(_ expected: String) throws -> [ToolNote] { try hash("abc", options: ["expected": expected]).notes }
        XCTAssertTrue(try notes(" 900150983CD24FB0 D6963F7D28E17F72 \n").contains { $0.message == "✓ 校验通过：与 MD5 一致" })
        XCTAssertTrue(try notes("3cd24fb0d6963f7d").contains { $0.message.contains("MD5 16 位") })
        XCTAssertTrue(try notes("kAFQmDzST7DWlj99KOF/cg==").contains { $0.message.contains("与 MD5 一致") })
        XCTAssertTrue(try notes("sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=").contains { $0.message.contains("SHA-256") })
        XCTAssertTrue(try notes("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad").contains { $0.message.contains("SHA-256") })
        XCTAssertTrue(try notes("66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0  ./abc.txt").contains { $0.message.contains("SM3") })
        XCTAssertTrue(try notes("0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45").contains { $0.message.contains("Keccak-256") })
        let colon = HexCodec.encode(Hash.digest(.sha256, "abc"), uppercase: true, separator: ":")
        XCTAssertTrue(try notes(colon).contains { $0.message.contains("SHA-256") })
        XCTAssertTrue(try notes("SHA256 Fingerprint=" + colon).contains { $0.message.contains("SHA-256") })
        XCTAssertTrue(try notes(String(repeating: "0", count: 32)).contains { $0.level == .warning && $0.message.contains("16 字节，同长度的算法有 MD5") })
        let same = try notes(String(repeating: "0", count: 64)).first { $0.level == .warning }?.message ?? ""
        XCTAssertTrue(same.contains("SHA-256、SHA3-256、Keccak-256、SM3、BLAKE3"))
        XCTAssertTrue(try notes("not a hash!").contains { $0.level == .warning && $0.message.hasPrefix("无法识别期望值") })
        XCTAssertTrue(try notes("90:015:09").allSatisfy { !$0.message.hasPrefix("✓") })
    }

    // MARK: HMAC

    let hmac = HMACTool.spec

    func testHMACTool() throws {
        let r = try hmac("what do ya want for nothing?", options: ["key": "Jefe"])
        XCTAssertEqual(r.primary?.value, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843")
        XCTAssertEqual(r.outputs.first { $0.id == "hexUpper" }?.value, "5BDCC146BF60754E6A042426089575C75A003F089D2739839DEC58B964EC3843")
        XCTAssertEqual(r.outputs.first { $0.id == "base64" }?.value, "W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=")
        let all = try hmac("what do ya want for nothing?", options: ["key": "Jefe", "algorithm": "all"])
        XCTAssertEqual(all.outputs.first { $0.id == "md5" }?.value, "750c783e6ab0b503eaa86e310a5db738")
        XCTAssertEqual(all.outputs.count, 8)
        XCTAssertEqual(all.table?.rows.count, 8)
        XCTAssertEqual(all.table?.rows.first?[0], "HMAC-MD5")
        // Hex 密钥与消息
        let hexed = try hmac("4869205468657265", options: ["key": String(repeating: "0b", count: 20), "keyEncoding": "hex", "messageEncoding": "hex"])
        XCTAssertEqual(hexed.primary?.value, "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")
        // 长密钥提示与校验
        let long = try hmac("m", options: ["key": String(repeating: "k", count: 100), "expected": "W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM="])
        XCTAssertTrue(long.notes.contains { $0.message.contains("先对密钥做一次哈希") })
        XCTAssertTrue(long.notes.contains { $0.level == .warning && $0.message.hasPrefix("✗ 不匹配") })
        let ok = try hmac("what do ya want for nothing?", options: ["key": "Jefe", "expected": "W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM="], lang: .en)
        XCTAssertTrue(ok.notes.contains { $0.message == "✓ Match: same as HMAC-SHA256" })
        XCTAssertThrowsError(try hmac("m", options: ["key": "0g", "keyEncoding": "hex"])) { e in
            XCTAssertTrue((e as? ToolError)?.message.hasPrefix("密钥：Hex 第 2 个字符「g」") ?? false)
        }
        XCTAssertThrowsError(try hmac("a*", options: ["key": "k", "messageEncoding": "base64"])) { e in
            XCTAssertTrue((e as? ToolError)?.message.hasPrefix("消息：Base64 第 2 个字符") ?? false)
        }
        XCTAssertTrue(try hmac("m").notes.contains { $0.message == "密钥为空" })
    }

    func testHMACSnippets() throws {
        let node = try hmac("hello", options: ["key": "k\"1", "snippet": "node"]).outputs.first { $0.id == "snippet" }
        XCTAssertEqual(node?.language, "javascript")
        XCTAssertEqual(node?.value, "import { createHmac } from 'node:crypto'\n\nconst key = 'k\"1'\nconst message = \"hello\"\nconst signature = createHmac('sha256', key).update(message).digest('hex')")
        let py = HMACTool.snippet("python", algorithm: .sha3_256, key: "AQID", keyEncoding: .base64, message: "a\nb", messageEncoding: .utf8)
        XCTAssertEqual(py, "import hmac, base64\n\nkey = base64.b64decode(\"AQID\")\nmessage = \"a\\nb\".encode()\nmac = hmac.new(key, message, 'sha3_256')\nsignature = mac.hexdigest()")
        let go = HMACTool.snippet("go", algorithm: .sha256, key: "00 ff", keyEncoding: .hex, message: "m", messageEncoding: .utf8) ?? ""
        XCTAssertTrue(go.contains("key, _ := hex.DecodeString(\"00ff\")"))
        XCTAssertTrue(go.contains("\t\"crypto/sha256\""))
        XCTAssertTrue(HMACTool.snippet("java", algorithm: .sha512, key: "k", keyEncoding: .utf8, message: "m", messageEncoding: .utf8)?.contains("Mac.getInstance(\"HmacSHA512\")") ?? false)
        XCTAssertEqual(HMACTool.snippet("php", algorithm: .md5, key: "it's", keyEncoding: .utf8, message: "m", messageEncoding: .utf8),
                       "<?php\n$key = 'it\\'s';\n$message = 'm';\n$signature = hash_hmac('md5', $message, $key);")
        XCTAssertNil(HMACTool.snippet("go", algorithm: .sm3, key: "k", keyEncoding: .utf8, message: "m", messageEncoding: .utf8))
        let huge = HMACTool.snippet("node", algorithm: .sha256, key: "k", keyEncoding: .utf8, message: String(repeating: "x", count: 1500), messageEncoding: .utf8) ?? ""
        XCTAssertTrue(huge.hasPrefix("// 注意：消息（1500 个字符）过长"))
        XCTAssertEqual(HMACTool.dq("\u{01}"), "\"\\" + "u0001\"")
    }

    // MARK: AES / DES

    let aes = AESDESTool.spec
    let key256 = "603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4"
    let iv = "000102030405060708090a0b0c0d0e0f"

    func testAESToolMatchesCryptoJS() throws {
        let opts = ["key": key256, "iv": iv, "keyEncoding": "hex"]
        let r = try aes("Hello, 世界! 🔐", options: opts)
        XCTAssertEqual(r.primary?.value, "flwNTUsjQuZzbbtmcv1KKU2vTbEK8ssA0cIIvFHo3Co=")
        XCTAssertEqual(r.outputs.first { $0.id == "key" }?.value, key256)
        XCTAssertEqual(r.outputs.first { $0.id == "iv" }?.value, iv)
        XCTAssertTrue(r.notes.contains { $0.message.hasPrefix("AES-256-CBC · PKCS7 · 19 → 32 字节") })
        let back = try aes("flwNTUsjQuZzbbtm\ncv1KKU2vTbEK8ssA 0cIIvFHo3Co=", options: opts.merging(["mode": "decrypt"]) { $1 })
        XCTAssertEqual(back.primary?.value, "Hello, 世界! 🔐")
        let hex = try aes("Hello, 世界! 🔐", options: opts.merging(["cipherEncoding": "hex"]) { $1 })
        XCTAssertEqual(hex.primary?.value, HexCodec.encode((try? Base64Codec.decode("flwNTUsjQuZzbbtmcv1KKU2vTbEK8ssA0cIIvFHo3Co=")) ?? []))
        // 文本密钥与 Base64 密钥等价
        let text = try aes("x", options: ["key": "1234567890abcdef", "iv": "abcdef1234567890"])
        let b64 = try aes("x", options: ["key": Base64Codec.encode(Array("1234567890abcdef".utf8)), "iv": Base64Codec.encode(Array("abcdef1234567890".utf8)), "keyEncoding": "base64"])
        XCTAssertEqual(text.primary?.value, b64.primary?.value)
        // 空明文得到一整块填充
        XCTAssertEqual((try? Base64Codec.decode(try aes("", options: opts).primary?.value ?? ""))?.count, 16)
    }

    func testDESAndRC4Tool() throws {
        let des = try aes("你好，DES！", options: ["algorithm": "DES", "key": "0123456789ABCDEF", "iv": "1122334455667788", "keyEncoding": "hex", "cipherEncoding": "hex"])
        XCTAssertEqual(des.primary?.value, "81d8e7d5053e8c2c86163899157c213a")
        XCTAssertTrue(des.notes.contains { $0.level == .warning && $0.message.contains("56 位") })
        let tdes = try aes("你好，3DES！", options: ["algorithm": "3DES", "key": "0123456789ABCDEFFEDCBA9876543210", "iv": "1122334455667788", "keyEncoding": "hex", "cipherEncoding": "hex"])
        XCTAssertEqual(tdes.primary?.value, "f0174af265f19af0622db15f2e168abd18e659472a531417")
        let rc4 = try aes("Plaintext", options: ["algorithm": "RC4", "key": "Key", "cipherEncoding": "hex"])
        XCTAssertEqual(rc4.primary?.value, "bbf316e8d940af0ad3")
        XCTAssertTrue(rc4.notes.contains { $0.message.contains("RFC 7465") })
        let ecb = try aes("x", options: ["cipherMode": "ecb", "key": "1234567890abcdef", "iv": "garbage!"])
        XCTAssertTrue(ecb.notes.contains { $0.message.contains("ECB") })
        XCTAssertNil(ecb.outputs.first { $0.id == "iv" })
        let ctr = try aes("Hello, 世界! 🔐", options: ["cipherMode": "ctr", "padding": "none", "key": "2b7e151628aed2a6abf7158809cf4f3c", "iv": "f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff", "keyEncoding": "hex", "cipherEncoding": "hex"])
        XCTAssertEqual(ctr.primary?.value, "a4e9b31ff74c5c544a44f1e066bf8114a9bfec")
    }

    func testPassphraseModeCompatibleWithCryptoJS() throws {
        // CryptoJS.AES.encrypt('来自 CryptoJS 的消息 ✓', 'hunter2') 的输出可以解开
        let fixed: @Sendable (Int) -> [UInt8] = { n in Array([1, 2, 3, 4, 5, 6, 7, 8].prefix(n)) }
        let input = ToolInput(text: "Hello, 世界! 🔐", options: aes.defaults.merging(["key": "秘密passphrase", "keyEncoding": "passphrase"]) { $1 }, random: fixed)
        let r = try AESDESTool.run(input)
        XCTAssertTrue(r.primary?.value.hasPrefix("U2FsdGVkX18BAgMEBQYHC") ?? false)
        XCTAssertEqual(r.outputs.first { $0.id == "key" }?.value, "b354e9ceb21d3bd1f526d97e2292b245b3f9979ae6d81713d22aa70f6a887323")
        XCTAssertEqual(r.outputs.first { $0.id == "iv" }?.value, "34696a17f0488d1674cfa8a9e6ec3b3e")
        XCTAssertEqual(r.outputs.first { $0.id == "salt" }?.value, "0102030405060708")
        // 与 openssl enc -aes-256-cbc -md md5 -S 0102030405060708 一致
        let body = Array(((try? Base64Codec.decode(r.primary?.value ?? "")) ?? []).dropFirst(16))
        XCTAssertEqual(Base64Codec.encode(body), "6TG1RA38juHol9DZIKJmp1zDWJgYJy6t48ymqyzK4Yk=")
        XCTAssertTrue(r.notes.contains { $0.message.contains("EVP_BytesToKey") })
        let back = try aes(r.primary?.value ?? "", options: ["mode": "decrypt", "key": "秘密passphrase", "keyEncoding": "passphrase"])
        XCTAssertEqual(back.primary?.value, "Hello, 世界! 🔐")
        let tdes = try aes("Hello, 世界! 🔐", options: ["algorithm": "3DES", "key": "秘密passphrase", "keyEncoding": "passphrase"])
        XCTAssertEqual(try aes(tdes.primary?.value ?? "", options: ["mode": "decrypt", "algorithm": "3DES", "key": "秘密passphrase", "keyEncoding": "passphrase"]).primary?.value, "Hello, 世界! 🔐")
        XCTAssertThrowsError(try aes("AAAAAAAAAAAAAAAAAAAAAA==", options: ["mode": "decrypt", "key": "x", "keyEncoding": "passphrase"])) { e in
            XCTAssertTrue((e as? ToolError)?.message.contains("Salted__") ?? false)
        }
        XCTAssertThrowsError(try aes("x", options: ["keyEncoding": "passphrase"])) { e in
            XCTAssertEqual((e as? ToolError)?.message, "请输入口令")
        }
    }

    func testAESToolErrors() throws {
        func error(_ text: String, _ opts: [String: String], lang: Lang = .zh) -> String {
            do { _ = try aes(text, options: opts, lang: lang) } catch let e as ToolError { return e.message } catch {}
            return ""
        }
        let base = ["key": key256, "iv": iv, "keyEncoding": "hex"]
        XCTAssertTrue(error("x", base.merging(["key": "abc"]) { $1 }).hasPrefix("密钥：Hex 长度为奇数"))
        XCTAssertEqual(error("x", base.merging(["key": String(repeating: "00", count: 20)]) { $1 }), "AES 密钥必须是 16 / 24 / 32 字节（AES-128 / 192 / 256），当前 20 字节")
        XCTAssertEqual(error("x", base.merging(["key": String(repeating: "00", count: 20)]) { $1 }, lang: .en), "An AES key must be 16, 24 or 32 bytes (AES-128 / 192 / 256), got 20 bytes")
        XCTAssertEqual(error("x", base.merging(["iv": ""]) { $1 }), "CBC 模式需要 IV（16 字节）")
        XCTAssertEqual(error("x", base.merging(["iv": "0011"]) { $1 }), "AES 的 IV 必须是 16 字节，当前 2 字节")
        XCTAssertTrue(error("x", base.merging(["iv": "zz"]) { $1 }).hasPrefix("IV：Hex"))
        XCTAssertEqual(error("x", ["algorithm": "DES", "key": "1234567890abcdef"]), "DES 密钥必须是 8 字节，当前 16 字节")
        XCTAssertTrue(error("x", ["algorithm": "3DES", "key": "12345678"]).contains("16 字节（双倍长）或 24 字节"))
        XCTAssertEqual(error("x", ["key": ""]), "密钥不能为空")
        XCTAssertTrue(error("abc*", base.merging(["mode": "decrypt"]) { $1 }).hasPrefix("密文：Base64 第 4 个字符「*」"))
        XCTAssertTrue(error(String(repeating: "ab", count: 15), base.merging(["mode": "decrypt"]) { $1 }).contains("看起来是 Hex"))
        XCTAssertTrue(error("U2FsdGVkX1+abcdefghijklmnopqrstuvw==", base.merging(["mode": "decrypt"]) { $1 }).contains("口令模式"))
        XCTAssertTrue(error("abc", base.merging(["padding": "none", "cipherMode": "ecb"]) { $1 }).contains("整数倍"))
        // 解密结果不是 UTF-8 时改为显示 Hex
        let ct = try aes("x", options: base).primary?.value ?? ""
        var wrongKey = base
        wrongKey["key"] = "000102030405060708090a0b0c0d0e0f"
        XCTAssertTrue(error(ct, wrongKey.merging(["mode": "decrypt"]) { $1 }).contains("填充校验失败"))
        let binary = try aes(Base64Codec.encode(try AES(key: HexCodec.decode(key256)).encrypt([0xFF, 0x00, 0xFE], mode: .cbc, iv: HexCodec.decode(iv))),
                             options: base.merging(["mode": "decrypt"]) { $1 })
        XCTAssertEqual(binary.primary?.value, "ff00fe")
        XCTAssertTrue(binary.notes.first?.message.contains("不是有效的 UTF-8") ?? false)
    }

    func testLargeAESRoundTrip() throws {
        let big = String(repeating: "中文🙂", count: 20_000)
        let opts = ["key": key256, "iv": iv, "keyEncoding": "hex"]
        let ct = try aes(big, options: opts).primary?.value ?? ""
        XCTAssertEqual(try aes(ct, options: opts.merging(["mode": "decrypt"]) { $1 }).primary?.value, big)
    }
}
