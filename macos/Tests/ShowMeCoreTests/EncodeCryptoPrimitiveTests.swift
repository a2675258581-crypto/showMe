import XCTest
@testable import ShowMeCore

/// 纯 Swift 密码学原语：哈希、HMAC、KDF、AES / DES / 3DES / RC4 与分组模式
final class EncodeCryptoPrimitiveTests: XCTestCase {
    func hex(_ b: [UInt8]) -> String { HexCodec.encode(b) }
    func unhex(_ s: String) -> [UInt8] { (try? HexCodec.decode(s)) ?? [] }
    func pattern(_ n: Int) -> [UInt8] { (0..<n).map { UInt8($0 % 251) } }
    func seq(_ n: Int, _ a: Int, _ b: Int) -> [UInt8] { (0..<n).map { UInt8(($0 * a + b) & 255) } }

    // MARK: 哈希

    func testStandardVectorsForABC() {
        let abc: [HashAlgorithm: String] = [
            .md5: "900150983cd24fb0d6963f7d28e17f72",
            .sha1: "a9993e364706816aba3e25717850c26c9cd0d89d",
            .sha224: "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7",
            .sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            .sha384: "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
            .sha512: "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
            .sha3_256: "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532",
            .sha3_512: "b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0",
            .keccak256: "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
            .sm3: "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0",
            .crc32: "352441c2",
            .xxhash64: "44bc2cf5ad770999",
            .blake3: "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85",
        ]
        for a in HashAlgorithm.allCases {
            XCTAssertEqual(Hash.hex(a, "abc"), abc[a], a.label)
            XCTAssertEqual(Hash.digest(a, "abc").count, a.digestSize, a.label)
        }
    }

    func testStandardVectorsForEmptyInput() {
        let empty: [HashAlgorithm: String] = [
            .md5: "d41d8cd98f00b204e9800998ecf8427e",
            .sha1: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
            .sha224: "d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f",
            .sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            .sha384: "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b",
            .sha512: "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
            .sha3_256: "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a",
            .sha3_512: "a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26",
            .keccak256: "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
            .sm3: "1ab21d8355cfa17f8e61194831e81a8f22bec8c728fefb747ed035eb5082aa2b",
            .crc32: "00000000",
            .xxhash64: "ef46db3751d8e999",
            .blake3: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
        ]
        for a in HashAlgorithm.allCases { XCTAssertEqual(Hash.hex(a, ""), empty[a], a.label) }
    }

    func testClassicVectors() {
        XCTAssertEqual(Hash.hex(.crc32, "123456789"), "cbf43926")
        XCTAssertEqual(Hash.hex(.md5, "The quick brown fox jumps over the lazy dog"), "9e107d9d372bb6826bd81d3542a419d6")
        XCTAssertEqual(Hash.hex(.sha3_512, "The quick brown fox jumps over the lazy dog"),
                       "01dedd5de4ef14642445ba5f5b97c15e47b9ad931326e4b0727cd94cefc44fff23f07bf543139939b49128caf436dc1bdee54fcb24023a08d9403f9b4bf0d450")
        XCTAssertEqual(Hash.hex(.md5, "中文"), "a7bac2239fcdcb3a067903d8077c4a07")
        // FIPS 180 两块消息
        XCTAssertEqual(Hash.hex(.sha256, "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
                       "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
        XCTAssertEqual(Hash.hex(.sha1, String(repeating: "a", count: 1_000_000)), "34aa973cd4c4daa4f61eeb2bdbad27316534016f")
    }

    /// 与 hash-wasm 交叉验证：长度覆盖各算法的分组 / 分块边界，结果拼接后取 SHA-256 指纹
    func testCrossCheckAgainstHashWasm() {
        let lengths = [0, 1, 3, 55, 56, 63, 64, 65, 71, 72, 111, 112, 127, 128, 129, 135, 136, 137,
                       1023, 1024, 1025, 2048, 2049, 3072, 3073, 4097, 8193, 16385, 31744, 102400]
        let expected: [HashAlgorithm: String] = [
            .md5: "01d2ed0b4c82a9f8f8a4a0ecd549f79049b125a8003a73f943dbd29fa681869c",
            .sha1: "a0afe5aed076046ce218f7966d2270ad6a41b6633bc0d8878c7c5b42fdaaa618",
            .sha224: "405fc5baec33327b6b96202bf4f66261225e96dc74f3f7f581396794543fc652",
            .sha256: "0ce5147e0d2133d1a4694e153707bf10bcfe4335fcd041f0cdf169a5271abecb",
            .sha384: "69f7832db6edd47c4a8598062512aba4ced977745ffccc892a7530becd19d0e1",
            .sha512: "1ffd5b6d3ea6eb6fb00139746fc00f12d8fd30dd2444bc86a4ab859733eaa333",
            .sha3_256: "1925f58f49cc0791f1df82680050dc26c4feb3c4bd4f7195254c58ff826dae47",
            .sha3_512: "9a31b06a52d8eb99f16187a4c7965482b6849d3cd189578a410888c2747e03bd",
            .keccak256: "16f3a8422bc46ed3a3ed2a236c2e91a61443f4c952154c2b064bd4832058c635",
            .sm3: "2519cd34d9e2dac31d3daef54de4cfd7684ee77c911bb1c5a2c84033d242fc77",
            .crc32: "016b5f929f15a9ab64ceff6eff16d6aa9bb0b5e4e98da4fa67e9ded150f21117",
            .xxhash64: "ef6802766ab4afda0a26c9927c2783fa86c645a38fda28df9cdba415348e6511",
            .blake3: "e3ffded90a607a74eb65b2f3fed60431cb9ca6dbaf3f037f8af21035966bf6d9",
        ]
        let inputs = lengths.map(pattern)
        for a in HashAlgorithm.allCases {
            let joined = inputs.flatMap { Hash.digest(a, $0) }
            XCTAssertEqual(Hash.hex(.sha256, joined), expected[a], a.label)
        }
        XCTAssertEqual(Hash.hex(.blake3, pattern(1025)), "d00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444")
        XCTAssertEqual(Hash.hex(.blake3, pattern(2049)), "5f4d72f40d7a5f82b15ca2b2e44b1de3c2ef86c426c95c1af0b6879522563030")
        XCTAssertEqual(Hash.hex(.xxhash64, pattern(1025)), "cfd73aedd2d6a39d")
        XCTAssertEqual(Hash.hex(.sm3, pattern(1025)), "6db87da918bda02dcc23f7578c0a947ea1994798ff43dcf83879abd612db4be4")
    }

    func testIncrementalUpdatesMatchOneShot() {
        let data = pattern(5000)
        for a in HashAlgorithm.allCases {
            var ctx = HashContext(a)
            var i = 0
            var step = 1
            while i < data.count {
                let end = min(data.count, i + step)
                ctx.update(Array(data[i..<end]))
                i = end
                step = step * 3 % 997 + 1
            }
            XCTAssertEqual(ctx.finalize(), Hash.digest(a, data), a.label)
        }
    }

    // MARK: HMAC / KDF

    func testHMACRFC2202And4231() {
        let k = [UInt8](repeating: 0x0b, count: 16)
        XCTAssertEqual(hex(HMAC.mac(.md5, key: k, message: Array("Hi There".utf8))), "9294727a3638bb1c13f48ef8158bfc9d")
        XCTAssertEqual(hex(HMAC.mac(.md5, key: "Jefe", message: "what do ya want for nothing?")), "750c783e6ab0b503eaa86e310a5db738")
        XCTAssertEqual(hex(HMAC.mac(.sha1, key: "Jefe", message: "what do ya want for nothing?")), "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79")
        let big = [UInt8](repeating: 0xaa, count: 80)
        XCTAssertEqual(hex(HMAC.mac(.md5, key: big, message: Array("Test Using Larger Than Block-Size Key - Hash Key First".utf8))), "6b1ab7fe4bd7bf8f0b62e6ce61b9d0cd")
        XCTAssertEqual(hex(HMAC.mac(.sha1, key: big, message: Array("Test Using Larger Than Block-Size Key - Hash Key First".utf8))), "aa4ae5e15272d00e95705637ce8a3b55ed402112")

        let k20 = [UInt8](repeating: 0x0b, count: 20)
        let msg = Array("Hi There".utf8)
        XCTAssertEqual(hex(HMAC.mac(.sha224, key: k20, message: msg)), "896fb1128abbdf196832107cd49df33f47b4b1169912ba4f53684b22")
        XCTAssertEqual(hex(HMAC.mac(.sha256, key: k20, message: msg)), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")
        XCTAssertEqual(hex(HMAC.mac(.sha384, key: k20, message: msg)), "afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6")
        XCTAssertEqual(hex(HMAC.mac(.sha512, key: k20, message: msg)), "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854")
        let k131 = [UInt8](repeating: 0xaa, count: 131)
        let long = Array("This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.".utf8)
        XCTAssertEqual(hex(HMAC.mac(.sha256, key: k131, message: long)), "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2")
        XCTAssertEqual(hex(HMAC.mac(.sha512, key: k131, message: long)), "e37b6a775dc87dbaa4dfa9f96e5e3ffddebd71f8867289865df5a32d20cdc944b6022cac3c4982b10d5eeb55c3e4de15134676fb6de0446065c97440fa8c6a58")
        // NIST HMAC-SHA3-256 示例
        XCTAssertEqual(hex(HMAC.mac(.sha3_256, key: (0..<32).map { UInt8($0) }, message: Array("Sample message for keylen<blocklen".utf8))),
                       "4fe8e202c4f058e8dddc23d8c34e467343e23555e24fc2f025d598f558f67205")
        XCTAssertTrue(HMAC.verify(.sha256, key: k20, message: msg, mac: unhex("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")))
        XCTAssertFalse(HMAC.verify(.sha256, key: k20, message: msg, mac: [1, 2, 3]))
    }

    func testPBKDF2AndEVPBytesToKey() {
        // RFC 6070（SHA-1）与 RFC 7914 附录（SHA-256）
        XCTAssertEqual(hex(KDF.pbkdf2(.sha1, password: Array("password".utf8), salt: Array("salt".utf8), iterations: 1, keyLength: 20)),
                       "0c60c80f961f0e71f3a9b524af6012062fe037a6")
        XCTAssertEqual(hex(KDF.pbkdf2(.sha1, password: Array("password".utf8), salt: Array("salt".utf8), iterations: 4096, keyLength: 20)),
                       "4b007901b765489abead49d926f721d065a429c1")
        XCTAssertEqual(hex(KDF.pbkdf2(.sha256, password: Array("passwd".utf8), salt: Array("salt".utf8), iterations: 1, keyLength: 64)),
                       "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783")
        let r = KDF.evpBytesToKey(.md5, password: Array("秘密passphrase".utf8), salt: unhex("0102030405060708"), keyLength: 32, ivLength: 16)
        XCTAssertEqual(hex(r.key), "b354e9ceb21d3bd1f526d97e2292b245b3f9979ae6d81713d22aa70f6a887323")
        XCTAssertEqual(hex(r.iv), "34696a17f0488d1674cfa8a9e6ec3b3e")
    }

    // MARK: AES

    let nistKey = "2b7e151628aed2a6abf7158809cf4f3c"
    let nistIV = "000102030405060708090a0b0c0d0e0f"
    let nistPT = "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51"

    func testAESFIPS197() throws {
        let pt = unhex("00112233445566778899aabbccddeeff")
        let cases = [
            ("000102030405060708090a0b0c0d0e0f", "69c4e0d86a7b0430d8cdb78070b4c55a"),
            ("000102030405060708090a0b0c0d0e0f1011121314151617", "dda97ca4864cdfe06eaf70a0ec0d7191"),
            ("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "8ea2b7ca516745bfeafc49904b496089"),
        ]
        for (key, ct) in cases {
            let aes = try AES(key: unhex(key))
            XCTAssertEqual(hex(try aes.encrypt(pt, mode: .ecb, padding: .none)), ct)
            XCTAssertEqual(hex(try aes.decrypt(unhex(ct), mode: .ecb, padding: .none)), hex(pt))
        }
    }

    func testAESSP80038A() throws {
        let aes = try AES(key: unhex(nistKey))
        let pt = unhex(nistPT)
        XCTAssertEqual(hex(try aes.encrypt(pt, mode: .ecb, padding: .none)), "3ad77bb40d7a3660a89ecaf32466ef97f5d3d58503b9699de785895a96fdbaaf")
        XCTAssertEqual(hex(try aes.encrypt(pt, mode: .cbc, iv: unhex(nistIV), padding: .none)), "7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2")
        XCTAssertEqual(hex(try aes.encrypt(pt, mode: .cfb, iv: unhex(nistIV), padding: .none)), "3b3fd92eb72dad20333449f8e83cfb4ac8a64537a0b3a93fcde3cdad9f1ce58b")
        XCTAssertEqual(hex(try aes.encrypt(pt, mode: .ofb, iv: unhex(nistIV), padding: .none)), "3b3fd92eb72dad20333449f8e83cfb4a7789508d16918f03f53c52dac54ed825")
        XCTAssertEqual(hex(try aes.encrypt(pt, mode: .ctr, iv: unhex("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff"), padding: .none)),
                       "874d6191b620e3261bef6864990db6ce9806f66b7970fdff8617187bb9fffdff")
        // 不完整的最后一块（与 OpenSSL 一致）
        let short = Array("Hello, 世界! 🔐".utf8)
        XCTAssertEqual(short.count, 19)
        XCTAssertEqual(hex(try aes.encrypt(short, mode: .ctr, iv: unhex("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff"), padding: .none)), "a4e9b31ff74c5c544a44f1e066bf8114a9bfec")
        XCTAssertEqual(hex(try aes.encrypt(short, mode: .cfb, iv: unhex(nistIV), padding: .none)), "189b0ba0f6411252629fd07c178ecc9036dbdd")
        XCTAssertEqual(hex(try aes.encrypt(short, mode: .ofb, iv: unhex(nistIV), padding: .none)), "189b0ba0f6411252629fd07c178ecc9046304a")
        XCTAssertEqual(try aes.decrypt(unhex("189b0ba0f6411252629fd07c178ecc9036dbdd"), mode: .cfb, iv: unhex(nistIV), padding: .none), short)
        // AES-256-CBC + PKCS7 与 CryptoJS 默认一致
        let aes256 = try AES(key: unhex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4"))
        XCTAssertEqual(Base64Codec.encode(try aes256.encrypt(short, mode: .cbc, iv: unhex(nistIV))), "flwNTUsjQuZzbbtmcv1KKU2vTbEK8ssA0cIIvFHo3Co=")
    }

    func testDESAndTripleDES() throws {
        let des = try DES(key: unhex("133457799BBCDFF1"))
        XCTAssertEqual(hex(try des.encrypt(unhex("0123456789ABCDEF"), mode: .ecb, padding: .none)), "85e813540f0ab405")
        XCTAssertEqual(hex(try des.decrypt(unhex("85e813540f0ab405"), mode: .ecb, padding: .none)), "0123456789abcdef")
        let zero = try DES(key: unhex("0E329232EA6D0D73"))
        XCTAssertEqual(hex(try zero.encrypt(unhex("8787878787878787"), mode: .ecb, padding: .none)), "0000000000000000")
        let cbc = try DES(key: unhex("0123456789ABCDEF"))
        XCTAssertEqual(hex(try cbc.encrypt(Array("你好，DES！".utf8), mode: .cbc, iv: unhex("1122334455667788"))), "81d8e7d5053e8c2c86163899157c213a")

        let tdes = try TripleDES(key: unhex("0123456789ABCDEF23456789ABCDEF01456789ABCDEF0123"))
        XCTAssertEqual(hex(try tdes.encrypt(Array("The qufck brown fox jump".utf8), mode: .ecb, padding: .none)), "a826fd8ce53b855fcce21c8112256fe668d5c05dd9b6b900")
        let two = try TripleDES(key: unhex("0123456789ABCDEFFEDCBA9876543210"))
        XCTAssertEqual(hex(try two.encrypt(Array("你好，3DES！".utf8), mode: .cbc, iv: unhex("1122334455667788"))), "f0174af265f19af0622db15f2e168abd18e659472a531417")
        let k = unhex("133457799BBCDFF1")
        let same = try TripleDES(key: k + k + k)
        XCTAssertEqual(hex(try same.encrypt(unhex("0123456789ABCDEF"), mode: .ecb, padding: .none)), "85e813540f0ab405")
        XCTAssertTrue(TripleDES.isDegenerate(k + k + k))
        XCTAssertFalse(TripleDES.isDegenerate(unhex("0123456789ABCDEF23456789ABCDEF01456789ABCDEF0123")))
    }

    func testRC4() throws {
        XCTAssertEqual(hex(try RC4(key: Array("Key".utf8)).process(Array("Plaintext".utf8))), "bbf316e8d940af0ad3")
        XCTAssertEqual(hex(try RC4(key: Array("Wiki".utf8)).process(Array("pedia".utf8))), "1021bf0420")
        XCTAssertEqual(hex(try RC4(key: Array("Secret".utf8)).process(Array("Attack at dawn".utf8))), "45a01f645fc35b383552544b9bf5")
        XCTAssertEqual(hex(try RC4(key: seq(16, 37, 11)).process(seq(100, 13, 1))),
                       "ffeebfab365a2d881582aa93db5711678400aa2cf2d387e57091d90b88816991c54c52fd75b7cce6da9064e11f5c1a1446b8ec57108c29434869ffe00ef6f0823cd993a236f16a80674f1e7d995d1a20227fe2263dd3e963f71c7273c2b39032ec581adb")
        XCTAssertThrowsError(try RC4(key: []))
    }

    /// 与 crypto-js 交叉验证：每种算法 × 模式 × 填充，多种长度的密文拼接后取 SHA-256 前 16 位
    func testCrossCheckAgainstCryptoJS() throws {
        let expected: [String: String] = [
            "AES128-ecb-pkcs7": "d6e2374ff0ea7ccf", "AES128-ecb-zero": "0958e04f0a477ac0", "AES128-ecb-none": "67368126d84cd0cd", "AES128-ecb-ansiX923": "e7924c23daf2af03", "AES128-ecb-iso97971": "d27d4dad3bc46e93",
            "AES128-cbc-pkcs7": "7e6a7cef19ee2e83", "AES128-cbc-zero": "09b720ca1ddda017", "AES128-cbc-none": "1f3aaf3bfd36dedd", "AES128-cbc-ansiX923": "7206f252b2b837f9", "AES128-cbc-iso97971": "604307f2e7a537c6",
            "AES128-cfb-pkcs7": "83ad7f7fe802bf6c", "AES128-cfb-zero": "943b41d4329a7953", "AES128-cfb-none": "3ecf75c710b50519", "AES128-cfb-ansiX923": "25222751659a4c26", "AES128-cfb-iso97971": "1f614f5fe0c5d494",
            "AES128-ofb-pkcs7": "80015d0608291475", "AES128-ofb-zero": "be61b313717fcb49", "AES128-ofb-none": "3e2c01407668fae9", "AES128-ofb-ansiX923": "cd3634c82e7bf58b", "AES128-ofb-iso97971": "a11898a440a49193",
            "AES128-ctr-pkcs7": "c8f6f61fe7c26f3a", "AES128-ctr-zero": "82032e9c1297981c", "AES128-ctr-none": "c5632c6bc59103a7", "AES128-ctr-ansiX923": "ce0779cdfde3e8b7", "AES128-ctr-iso97971": "aa2b857b6e8be592",
            "AES192-ecb-pkcs7": "baea0883c9bfd04d", "AES192-ecb-zero": "9f9385264172dabf", "AES192-ecb-none": "e0e9b77c779d0df9", "AES192-ecb-ansiX923": "0095c2ac51dcfc42", "AES192-ecb-iso97971": "49c241f4ab5ae512",
            "AES192-cbc-pkcs7": "ac5ee073cc6d2163", "AES192-cbc-zero": "aef8c2ddbe166475", "AES192-cbc-none": "b7f79c48988c3aad", "AES192-cbc-ansiX923": "06898c3909874946", "AES192-cbc-iso97971": "01c249039847e9de",
            "AES192-cfb-pkcs7": "924f5599a011a0fe", "AES192-cfb-zero": "767cfc2686447163", "AES192-cfb-none": "2527dcc70e54713d", "AES192-cfb-ansiX923": "f82d7cfe5ca046dd", "AES192-cfb-iso97971": "3fc65006c4f8e794",
            "AES192-ofb-pkcs7": "2a273d522ab50d5e", "AES192-ofb-zero": "6ea11cb56bea264c", "AES192-ofb-none": "07742a2c13605166", "AES192-ofb-ansiX923": "afc08455ab4402f3", "AES192-ofb-iso97971": "d3d9aafab01814fe",
            "AES192-ctr-pkcs7": "e10f665647b52d0e", "AES192-ctr-zero": "88449594d3a0cebd", "AES192-ctr-none": "41fbf7efd7aa3b7c", "AES192-ctr-ansiX923": "85cc0227f6a61b4b", "AES192-ctr-iso97971": "79861b3c61393d3c",
            "AES256-ecb-pkcs7": "b3e427ac865310f1", "AES256-ecb-zero": "0a766691ecbe1a99", "AES256-ecb-none": "2f81f9042f89b568", "AES256-ecb-ansiX923": "e409ecee4045470d", "AES256-ecb-iso97971": "5d1d280868998bbb",
            "AES256-cbc-pkcs7": "a9d91baba3b36422", "AES256-cbc-zero": "70de24ad7e0ec4f0", "AES256-cbc-none": "0fc487d6924026c3", "AES256-cbc-ansiX923": "349be515cce3e59c", "AES256-cbc-iso97971": "aaf605893d28bf5d",
            "AES256-cfb-pkcs7": "4db8f1fdad354295", "AES256-cfb-zero": "6034ab3146a78316", "AES256-cfb-none": "aa3f674158f83226", "AES256-cfb-ansiX923": "2fb3f2fe181d1155", "AES256-cfb-iso97971": "b7d55413a451177e",
            "AES256-ofb-pkcs7": "57316a69400d2702", "AES256-ofb-zero": "46d21043dd5671e2", "AES256-ofb-none": "1982ff6fd493df6d", "AES256-ofb-ansiX923": "dabd897d24baa25d", "AES256-ofb-iso97971": "f6d512a95123070c",
            "AES256-ctr-pkcs7": "7dd70d399135efec", "AES256-ctr-zero": "3c46e6be45b1acec", "AES256-ctr-none": "f79faecb8a608e74", "AES256-ctr-ansiX923": "06163f5ad5555a2c", "AES256-ctr-iso97971": "3bfcb328be78cb3a",
            "DES-ecb-pkcs7": "af08f626b756b59d", "DES-ecb-zero": "0af40b2a0f2fd5bf", "DES-ecb-none": "dd3844d36012df2a", "DES-ecb-ansiX923": "2d8574d6c13dbeba", "DES-ecb-iso97971": "357efb4dd0e7e377",
            "DES-cbc-pkcs7": "c8c6fdd69e34152e", "DES-cbc-zero": "5ae0b5a13f80e513", "DES-cbc-none": "dd97d4d9241a9d0e", "DES-cbc-ansiX923": "0bdd741c3566ab6b", "DES-cbc-iso97971": "40ae23c0af8fa897",
            "DES-cfb-pkcs7": "21d72d1d0265312d", "DES-cfb-zero": "b0291886b207ef54", "DES-cfb-none": "2df4be1cde8279db", "DES-cfb-ansiX923": "478b2171f54538ac", "DES-cfb-iso97971": "d579d42975f6284c",
            "DES-ofb-pkcs7": "f2e347a91dbaf53e", "DES-ofb-zero": "068887660839b740", "DES-ofb-none": "62131399a924aa5d", "DES-ofb-ansiX923": "dae41909fe815145", "DES-ofb-iso97971": "061512541a48b8d5",
            "DES-ctr-pkcs7": "6b537173f04ed284", "DES-ctr-zero": "2259a342fe1d55a8", "DES-ctr-none": "b6e2e943d3a6de9d", "DES-ctr-ansiX923": "d1ba7bf2164d84e2", "DES-ctr-iso97971": "40fe166f7e6dbed9",
            "TDES16-ecb-pkcs7": "d1e6c5fb1d5019b8", "TDES16-ecb-zero": "daa5cf64defd44cb", "TDES16-ecb-none": "00a65f548da3330d", "TDES16-ecb-ansiX923": "f2697b43181d5854", "TDES16-ecb-iso97971": "d4cca602aeebdf5c",
            "TDES16-cbc-pkcs7": "cf1f79ed71d0ba94", "TDES16-cbc-zero": "bf8dbca6ae041568", "TDES16-cbc-none": "79ea304a4f649944", "TDES16-cbc-ansiX923": "eaae7d17d21e95ca", "TDES16-cbc-iso97971": "a938a06b38d4e841",
            "TDES16-cfb-pkcs7": "7866b7ed77e82ba4", "TDES16-cfb-zero": "f40c620c24e61465", "TDES16-cfb-none": "da8a6f322718752a", "TDES16-cfb-ansiX923": "fe6272e83778a33e", "TDES16-cfb-iso97971": "62e64a6f0b923c27",
            "TDES16-ofb-pkcs7": "ab5cbad0ccbc01d1", "TDES16-ofb-zero": "ce7f2dd9f730a260", "TDES16-ofb-none": "848a74a43bd99096", "TDES16-ofb-ansiX923": "1a92f70f11b6726e", "TDES16-ofb-iso97971": "b2130dd72b7140b5",
            "TDES16-ctr-pkcs7": "cd3fd11fe3b20c08", "TDES16-ctr-zero": "18a5d392b40ecfbf", "TDES16-ctr-none": "b8182bc4d4f7cc68", "TDES16-ctr-ansiX923": "b7ae9edbeb57b17d", "TDES16-ctr-iso97971": "44c86a2dd56d16eb",
            "TDES24-ecb-pkcs7": "f147429324d8e370", "TDES24-ecb-zero": "e1b503adaa4d8d61", "TDES24-ecb-none": "dcb00eee3caeca10", "TDES24-ecb-ansiX923": "72bfc994d9c0e79b", "TDES24-ecb-iso97971": "f92750a2b8286e40",
            "TDES24-cbc-pkcs7": "0f384f52739af5b8", "TDES24-cbc-zero": "efd07707045c2eb3", "TDES24-cbc-none": "f8d83ed2ff57c938", "TDES24-cbc-ansiX923": "d17339415c8da0a2", "TDES24-cbc-iso97971": "cce2d63b60ea047a",
            "TDES24-cfb-pkcs7": "a1669c85219b6c53", "TDES24-cfb-zero": "b8afbdba63c7d037", "TDES24-cfb-none": "e631b2d05212515d", "TDES24-cfb-ansiX923": "86cbc1e55017fbf7", "TDES24-cfb-iso97971": "d4c5092f1683416c",
            "TDES24-ofb-pkcs7": "9e749a6165b11b11", "TDES24-ofb-zero": "8fb14695c505ae6d", "TDES24-ofb-none": "b20a6a8acb3fc4cc", "TDES24-ofb-ansiX923": "4ddffbf95b5d1ef9", "TDES24-ofb-iso97971": "a6549eef36105089",
            "TDES24-ctr-pkcs7": "1bc5c543bf3ca611", "TDES24-ctr-zero": "7fac2bbf7e7dc206", "TDES24-ctr-none": "61487de0488a256c", "TDES24-ctr-ansiX923": "05033fc0a1c642dc", "TDES24-ctr-iso97971": "4cfac6b85a8ca294",
        ]
        let lengths = [0, 1, 7, 8, 15, 16, 17, 31, 32, 33, 100]
        let ciphers: [(String, Int, ([UInt8]) throws -> any BlockCipher)] = [
            ("AES128", 16, { try AES(key: $0) }), ("AES192", 24, { try AES(key: $0) }), ("AES256", 32, { try AES(key: $0) }),
            ("DES", 8, { try DES(key: $0) }), ("TDES16", 16, { try TripleDES(key: $0) }), ("TDES24", 24, { try TripleDES(key: $0) }),
        ]
        let paddings: [CipherPadding] = [.pkcs7, .zero, .none, .ansiX923, .iso97971]
        for (name, keySize, make) in ciphers {
            let cipher = try make(seq(keySize, 37, 11))
            let iv = seq(cipher.blockSize, 1, 0)
            for mode in CipherMode.allCases {
                for padding in paddings {
                    var joined: [UInt8] = []
                    for n in lengths {
                        if padding == .none && mode.needsAlignment && n % cipher.blockSize != 0 { continue }
                        let pt = seq(n, 13, 1)
                        let ct = try cipher.encrypt(pt, mode: mode, iv: iv, padding: padding)
                        joined += ct
                        if padding != .zero || pt.last != 0 {
                            XCTAssertEqual(try cipher.decrypt(ct, mode: mode, iv: iv, padding: padding), pt, "\(name)-\(mode)-\(padding) len \(n)")
                        }
                    }
                    let key = "\(name)-\(mode.rawValue)-\(padding.rawValue)"
                    XCTAssertEqual(String(Hash.hex(.sha256, joined).prefix(16)), expected[key], key)
                }
            }
        }
    }

    func testPaddingErrors() {
        func message(_ f: () throws -> Void) -> String {
            do { try f() } catch let e as CipherError { return e.message.zh } catch { return "\(error)" }
            return ""
        }
        XCTAssertEqual(CipherPadding.pkcs7.pad(Array("abc".utf8), blockSize: 8), unhex("6162630505050505"))
        XCTAssertEqual(CipherPadding.ansiX923.pad(Array("abc".utf8), blockSize: 8), unhex("6162630000000005"))
        XCTAssertEqual(CipherPadding.iso97971.pad(Array("abc".utf8), blockSize: 8), unhex("6162638000000000"))
        XCTAssertEqual(CipherPadding.pkcs7.pad(unhex("0102030405060708"), blockSize: 8).count, 16)
        let iso = CipherPadding.iso10126.pad(Array("abc".utf8), blockSize: 8) { Array(repeating: 0x5a, count: $0) }
        XCTAssertEqual(iso, unhex("6162635a5a5a5a05"))
        XCTAssertEqual(try CipherPadding.iso10126.unpad(iso, blockSize: 8), Array("abc".utf8))
        XCTAssertTrue(message { _ = try CipherPadding.pkcs7.unpad(unhex("6162630505050509"), blockSize: 8) }.contains("最后一个字节是 0x09"))
        XCTAssertTrue(message { _ = try CipherPadding.pkcs7.unpad(unhex("6162630505050504"), blockSize: 8) }.contains("倒数第 4 个字节应为 0x04"))
        XCTAssertTrue(message { _ = try CipherPadding.pkcs7.unpad(unhex("6162630505050905"), blockSize: 8) }.contains("倒数第 2 个字节应为 0x05，实际是 0x09"))
        XCTAssertTrue(message { _ = try CipherPadding.ansiX923.unpad(unhex("6162630001000005"), blockSize: 8) }.contains("应为 0x00"))
        XCTAssertTrue(message { _ = try CipherPadding.iso97971.unpad(unhex("6162630000000000"), blockSize: 8) }.contains("9797-1"))
        XCTAssertTrue(message { _ = try CipherPadding.pkcs7.unpad([], blockSize: 8) }.contains("为空"))
    }

    func testCipherParameterErrors() throws {
        XCTAssertThrowsError(try AES(key: [UInt8](repeating: 0, count: 20))) { e in
            XCTAssertEqual((e as? CipherError)?.field, .key)
            XCTAssertEqual((e as? CipherError)?.message.zh, "AES 密钥必须是 16 / 24 / 32 字节（AES-128 / 192 / 256），当前 20 字节")
        }
        XCTAssertThrowsError(try DES(key: [1, 2, 3]))
        XCTAssertThrowsError(try TripleDES(key: [UInt8](repeating: 1, count: 8)))
        let aes = try AES(key: unhex(nistKey))
        XCTAssertThrowsError(try aes.encrypt([1], mode: .cbc, iv: [])) { e in
            XCTAssertEqual((e as? CipherError)?.message.zh, "CBC 模式需要 IV（16 字节）")
        }
        XCTAssertThrowsError(try aes.encrypt([1], mode: .cbc, iv: [UInt8](repeating: 0, count: 8))) { e in
            XCTAssertEqual((e as? CipherError)?.message.zh, "AES 的 IV 必须是 16 字节，当前 8 字节")
        }
        XCTAssertThrowsError(try aes.encrypt([1, 2, 3], mode: .ecb, padding: .none)) { e in
            XCTAssertTrue((e as? CipherError)?.message.zh.contains("整数倍") ?? false)
        }
        XCTAssertThrowsError(try aes.decrypt([UInt8](repeating: 0, count: 17), mode: .cbc, iv: unhex(nistIV))) { e in
            XCTAssertEqual((e as? CipherError)?.field, .input)
            XCTAssertTrue((e as? CipherError)?.message.zh.contains("不是 16 字节的整数倍") ?? false)
        }
        // 错误的密钥通常表现为填充校验失败
        let ct = try aes.encrypt(Array("secret message".utf8), mode: .cbc, iv: unhex(nistIV))
        var wrong = unhex(nistKey)
        wrong[0] ^= 1
        XCTAssertThrowsError(try AES(key: wrong).decrypt(ct, mode: .cbc, iv: unhex(nistIV))) { e in
            XCTAssertTrue((e as? CipherError)?.message.zh.contains("填充校验失败") ?? false)
        }
    }

    // MARK: 编解码

    func testHexAndBase64Codecs() throws {
        XCTAssertEqual(HexCodec.encode([0, 1, 0xab, 0xff]), "0001abff")
        XCTAssertEqual(HexCodec.encode([0xab], uppercase: true), "AB")
        XCTAssertEqual(HexCodec.encode([0xde, 0xad], separator: ":"), "de:ad")
        XCTAssertEqual(try HexCodec.decode("0x0a, 0x0b\n0x0c"), [10, 11, 12])
        XCTAssertEqual(try HexCodec.decode("de ad-be ef"), [0xde, 0xad, 0xbe, 0xef])
        XCTAssertEqual(try HexCodec.decode(""), [])
        XCTAssertThrowsError(try HexCodec.decode("abxz")) { e in
            XCTAssertEqual((e as? ByteDecodeError)?.position, 2)
            XCTAssertTrue((e as? ByteDecodeError)?.message.zh.contains("第 3 个字符「x」") ?? false)
            XCTAssertTrue((e as? ByteDecodeError)?.message.en.contains("character 3") ?? false)
        }
        XCTAssertThrowsError(try HexCodec.decode("abc")) { e in
            XCTAssertTrue((e as? ByteDecodeError)?.message.zh.contains("奇数") ?? false)
        }

        for (plain, b64) in [("", ""), ("f", "Zg=="), ("fo", "Zm8="), ("foo", "Zm9v"), ("foob", "Zm9vYg=="), ("fooba", "Zm9vYmE="), ("foobar", "Zm9vYmFy")] {
            XCTAssertEqual(Base64Codec.encode(Array(plain.utf8)), b64)
            XCTAssertEqual(try Base64Codec.decode(b64), Array(plain.utf8))
            XCTAssertEqual(try Base64Codec.decode(b64.replacingOccurrences(of: "=", with: "")), Array(plain.utf8))
        }
        XCTAssertEqual(Base64Codec.encode([0xfb, 0xff, 0xbf]), "+/+/")
        XCTAssertEqual(Base64Codec.encodeURL([0xfb, 0xff, 0xbf]), "-_-_")
        XCTAssertEqual(Base64Codec.encodeURL([1]), "AQ")
        XCTAssertEqual(try Base64Codec.decode("-_-_"), [0xfb, 0xff, 0xbf])
        XCTAssertEqual(try Base64Codec.decode("Zm9v\nYmFy"), Array("foobar".utf8))
        XCTAssertThrowsError(try Base64Codec.decode("Zm9v YmFy", strictURL: true))
        XCTAssertThrowsError(try Base64Codec.decode("ab+c", strictURL: true)) { e in
            XCTAssertTrue((e as? ByteDecodeError)?.message.zh.contains("Base64URL 应使用") ?? false)
        }
        XCTAssertThrowsError(try Base64Codec.decode("Zg==", strictURL: true)) { e in
            XCTAssertEqual((e as? ByteDecodeError)?.position, 2)
        }
        XCTAssertThrowsError(try Base64Codec.decode("Zm9v*", label: LocalizedText("Payload", "Payload"))) { e in
            XCTAssertEqual((e as? ByteDecodeError)?.message.zh, "Payload 第 5 个字符「*」不合法")
            XCTAssertEqual((e as? ByteDecodeError)?.position, 4)
        }
        XCTAssertThrowsError(try Base64Codec.decode("Zg==Zg")) { e in
            XCTAssertTrue((e as? ByteDecodeError)?.message.zh.contains("填充之后") ?? false)
        }
        XCTAssertThrowsError(try Base64Codec.decode("Zm9vY")) { e in
            XCTAssertTrue((e as? ByteDecodeError)?.message.zh.contains("余 1") ?? false)
        }
        XCTAssertThrowsError(try Base64Codec.decode("中文")) { e in
            XCTAssertTrue((e as? ByteDecodeError)?.message.zh.contains("「中」") ?? false)
        }
        let wrapped = Base64Codec.encode(pattern(200), lineWidth: 76)
        let lines = wrapped.split(separator: "\n")
        XCTAssertTrue(lines.dropLast().allSatisfy { $0.count == 76 })
        XCTAssertEqual(try Base64Codec.decode(wrapped), pattern(200))
    }

    func testUTF8Check() throws {
        XCTAssertNil(UTF8Check.firstInvalid(Array("ok 中文 😀".utf8)))
        XCTAssertEqual(UTF8Check.firstInvalid([0x61, 0xe4, 0xb8]), 1)
        XCTAssertEqual(UTF8Check.firstInvalid([0xc0, 0x80]), 0)
        XCTAssertEqual(UTF8Check.firstInvalid([0xe0, 0x80, 0x80]), 0)
        XCTAssertEqual(UTF8Check.firstInvalid([0xed, 0xa0, 0x80]), 0)
        XCTAssertEqual(UTF8Check.firstInvalid([0xf4, 0x90, 0x80, 0x80]), 0)
        XCTAssertEqual(UTF8Check.firstInvalid([0x61, 0x80]), 1)
        XCTAssertThrowsError(try UTF8Check.decodeOrThrow([0x61, 0x62, 0xff, 0x63])) { e in
            XCTAssertEqual((e as? ByteDecodeError)?.position, 2)
            XCTAssertTrue((e as? ByteDecodeError)?.message.zh.contains("0xff") ?? false)
        }
        XCTAssertEqual(ByteUtil.hexDump(Array("Hello 中文\n".utf8)), "00000000  48 65 6c 6c 6f 20 e4 b8  ad e6 96 87 0a           |Hello .......|")
        XCTAssertTrue(ByteUtil.hexDump(pattern(40), maxBytes: 16).contains("其余 24 字节未显示"))
    }
}
