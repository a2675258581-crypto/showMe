import XCTest
@testable import ShowMeCore

final class EncodeCryptoJWTTests: XCTestCase {
    let jwtIO = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    let jwtIOSecret = "your-256-bit-secret"
    let rs256 = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InNob3dtZS1yc2EtMjAyNiJ9.eyJpc3MiOiJodHRwczovL2F1dGguc2hvd21lLmRldiIsInN1YiI6InVzZXJfMTAwODYiLCJhdWQiOiJzaG93bWUtd2ViIiwibmFtZSI6IuadjumbtyIsInJvbGVzIjpbImFkbWluIiwiZWRpdG9yIl0sImlhdCI6MTc2NzIyNTYwMCwibmJmIjoxNzY3MjI1NjAwLCJleHAiOjQxMDI0NDQ4MDAsImp0aSI6IjdmM2MyYTllLTViMWQtNGU4YS05YzZmLTJkNGI4YTFlMGYzNyJ9.EbvSIcbacMzrNAYIUxMSsv7irSNopj8_ksqtccKVMsSXo68r9535iz5HN26pGu-RhKI0L7hDRielXDdbw_0J8AWE2mpgALFGSpJ-X93USso-L8Qb43FDn25qu7mL7F42DN33QJiXP-ui_bpY24zZZwILPNHtlSSyq6W1zh6UZGawc5ICtfQuUhtYsTI5Hx1PDVV2-0hUxtbFP2srNeXU1WTednK_SMy1GCrKR5Bcq36HbX6WFWCoNr7Sa-w7vw_0YySBsp96oOBK6B34lh77bbT0KdOCpjcoKoJQnGjgIFBzpmSGKjzSxkHF-XykTN0bJ2u2Eh9i6dwz7GooHNzeKg"

    func b64u(_ s: String) -> String { Base64Codec.encodeURL(Array(s.utf8)) }

    func decodeError(_ s: String) -> JWT.DecodeError? {
        do { _ = try JWT.decode(s) } catch let e as JWT.DecodeError { return e } catch {}
        return nil
    }

    func testNormalize() {
        let input = "  Bearer  \"aa.b\nb.cc\" "
        let n = JWT.normalize(input)
        XCTAssertEqual(n.token, "aa.bb.cc")
        XCTAssertTrue(n.strippedBearer)
        XCTAssertEqual(n.map[0], 11)
        XCTAssertEqual(n.map[4], 16)
        XCTAssertEqual(Array(input.unicodeScalars)[n.map[4]], "b")
        XCTAssertEqual(JWT.normalize("Authorization: Bearer x.y.z").token, "x.y.z")
    }

    func testDecodeJWTIOSample() throws {
        let jwt = try XCTUnwrap(try JWT.decode(jwtIO))
        XCTAssertEqual(jwt.alg, "HS256")
        XCTAssertEqual(JSON.print(jwt.header), "{\n  \"alg\": \"HS256\",\n  \"typ\": \"JWT\"\n}")
        XCTAssertEqual(JSON.print(jwt.payload, .minified), #"{"sub":"1234567890","name":"John Doe","iat":1516239022}"#)
        XCTAssertEqual(jwt.signature.count, 32)
        XCTAssertTrue(jwt.warnings.isEmpty)
        XCTAssertEqual(JWT.verifyHMAC(jwt, secret: Array(jwtIOSecret.utf8)), true)
        XCTAssertEqual(JWT.verifyHMAC(jwt, secret: Array("nope".utf8)), false)
        let cn = try XCTUnwrap(try JWT.decode(b64u(#"{"alg":"HS256"}"#) + "." + b64u(#"{"name":"张三 🚀","city":"北京"}"#) + ".c2ln"))
        XCTAssertEqual(cn.payload["name"], .string("张三 🚀"))
        XCTAssertNil(try JWT.decode("  \n "))
    }

    func testStructureErrors() {
        XCTAssertTrue(decodeError("abc")?.message.zh.contains("没有「.」") ?? false)
        XCTAssertTrue(decodeError("a.b")?.message.zh.contains("只有 2 段") ?? false)
        XCTAssertTrue(decodeError("a.b.c.d")?.message.zh.contains("4 段") ?? false)
        let jwe = b64u(#"{"alg":"RSA-OAEP","enc":"A256GCM"}"#) + ".x.y.z.w"
        XCTAssertTrue(decodeError(jwe)?.message.zh.contains("JWE 加密令牌（5 段）（alg: RSA-OAEP，enc: A256GCM）") ?? false)

        let t = b64u(#"{"alg":"HS256"}"#) + ".eyJh+GciOi.sig"
        let e = decodeError("Bearer " + t)
        XCTAssertEqual(e?.segment, .payload)
        XCTAssertTrue(e?.message.zh.contains("Payload 不是合法的 Base64URL：Payload 第 5 个字符「+」不合法") ?? false)
        XCTAssertEqual(e.flatMap { $0.position.map { Array(("Bearer " + t).unicodeScalars)[$0] } }, "+")
        XCTAssertEqual(decodeError(b64u(#"{"alg":"HS256"}"#) + "." + b64u("{}") + ".ab=")?.segment, .signature)
        let short = decodeError("e." + b64u("{}") + ".x")
        XCTAssertEqual(short?.segment, .header)
        XCTAssertTrue(short?.message.zh.contains("末尾可能被截断") ?? false)
    }

    func testJSONAndUTF8Errors() {
        let bad = decodeError(b64u(#"{"alg":"HS256",}"#) + "." + b64u("{}") + ".")
        XCTAssertEqual(bad?.segment, .header)
        XCTAssertTrue(bad?.message.zh.hasPrefix("Header 不是合法的 JSON（第 1 行第") ?? false)
        let p = decodeError(b64u(#"{"alg":"HS256"}"#) + "." + b64u("not json") + ".")
        XCTAssertTrue(p?.message.zh.contains("Payload 不是合法的 JSON") ?? false)
        XCTAssertTrue(p?.message.zh.contains("解码内容：not json") ?? false)
        XCTAssertTrue(decodeError(b64u(#"{"alg":"HS256"}"#) + "." + b64u("[1,2]") + ".")?.message.zh.contains("必须是 JSON 对象，当前是 数组") ?? false)
        let invalid = decodeError(Base64Codec.encodeURL([0x7B, 0xFF, 0x7D]) + "." + b64u("{}") + ".")
        XCTAssertEqual(invalid?.segment, .header)
        XCTAssertTrue(invalid?.message.zh.contains("不是有效的 UTF-8") ?? false)
        XCTAssertEqual(decodeError("." + b64u("{}") + ".x")?.segment, .header)
        XCTAssertEqual(decodeError(b64u(#"{"alg":"HS256"}"#) + "..x")?.segment, .payload)
    }

    func testWarnings() throws {
        let none = try XCTUnwrap(try JWT.decode(b64u(#"{"alg":"none"}"#) + "." + b64u(#"{"a":1}"#) + "."))
        XCTAssertTrue(none.warnings.map(\.zh).joined().contains("未签名"))
        let noAlg = try XCTUnwrap(try JWT.decode(b64u(#"{"typ":"JWT"}"#) + "." + b64u("{}") + "."))
        XCTAssertTrue(noAlg.warnings.map(\.zh).joined().contains("缺少 alg"))
        let emptySig = try XCTUnwrap(try JWT.decode(b64u(#"{"alg":"HS256"}"#) + "." + b64u("{}") + "."))
        XCTAssertTrue(emptySig.warnings.map(\.zh).joined().contains("签名段为空"))
        let crit = try XCTUnwrap(try JWT.decode(b64u(#"{"alg":"HS256","typ":"at+jwt","crit":["b64"]}"#) + "." + b64u("{}") + ".c2ln"))
        XCTAssertTrue(crit.warnings.map(\.zh).joined().contains("crit：b64"))
    }

    func testClaims() throws {
        let payload = try JSON.value(#"{"name":"张三","exp":1700003600,"iss":"https://auth.example.com","iat":1700000000,"aud":["a","b"],"nbf":1700000000,"custom":{"x":1},"sub":42}"#)
        let rows = JWT.claims(payload)
        XCTAssertEqual(rows.map(\.key), ["iss", "sub", "aud", "exp", "nbf", "iat", "name", "custom"])
        let exp = try XCTUnwrap(rows.first { $0.key == "exp" })
        XCTAssertEqual(exp.name.zh, "过期时间")
        XCTAssertTrue(exp.registered)
        XCTAssertEqual(exp.seconds, 1_700_003_600)
        XCTAssertEqual(rows.first { $0.key == "aud" }?.text, "a, b")
        XCTAssertEqual(rows.first { $0.key == "custom" }?.text, #"{"x":1}"#)
        XCTAssertEqual(rows.first { $0.key == "custom" }?.name.zh, "自定义声明")
        XCTAssertEqual(rows.first { $0.key == "name" }?.name.zh, "姓名")
        XCTAssertEqual(rows.first { $0.key == "sub" }?.issue?.zh, "sub 应为字符串")

        let odd = JWT.claims(try JSON.value(#"{"exp":1700000000000,"iat":"1700000000","nbf":"soon"}"#))
        XCTAssertTrue(odd.first { $0.key == "exp" }?.issue?.zh.contains("毫秒") ?? false)
        XCTAssertEqual(odd.first { $0.key == "iat" }?.seconds, 1_700_000_000)
        XCTAssertEqual(odd.first { $0.key == "iat" }?.issue?.zh, "应为数字而不是字符串")
        XCTAssertTrue(odd.first { $0.key == "nbf" }?.issue?.zh.contains("秒级时间戳") ?? false)

        let now = Date(timeIntervalSince1970: 1_700_001_800)
        let valid = JWT.timeState(payload, now: now)
        XCTAssertEqual(valid.state, .valid)
        XCTAssertEqual(valid.remaining, 1800)
        XCTAssertEqual(valid.progress, 0.5)
        XCTAssertEqual(JWT.timeState(payload, now: Date(timeIntervalSince1970: 1_700_003_600)).state, .expired)
        let notYet = JWT.timeState(payload, now: Date(timeIntervalSince1970: 1_699_999_000))
        XCTAssertEqual(notYet.state, .notYet)
        XCTAssertEqual(notYet.untilValid, 1000)
        XCTAssertEqual(JWT.timeState(try JSON.value(#"{"iat":1}"#), now: now).state, .noExp)
    }

    func testTimeFormatting() throws {
        let utc = try XCTUnwrap(TimeZone(identifier: "UTC"))
        XCTAssertEqual(JWT.formatDateTime(0, timeZone: utc), "1970-01-01 00:00:00")
        XCTAssertEqual(JWT.formatDateTime(1_700_000_000, timeZone: try XCTUnwrap(TimeZone(identifier: "Asia/Shanghai"))), "2023-11-15 06:13:20")
        XCTAssertEqual(JWT.formatDuration(0, lang: .zh), "0 秒")
        XCTAssertEqual(JWT.formatDuration(90_061, lang: .zh), "1 天 1 小时 1 分 1 秒")
        XCTAssertEqual(JWT.formatDuration(-3600, lang: .zh), "1 小时")
        XCTAssertEqual(JWT.formatDuration(400 * 86_400, maxUnits: 2, lang: .zh), "1 年 35 天")
        XCTAssertEqual(JWT.formatDuration(90_061, lang: .en), "1d 1h 1m 1s")
        XCTAssertEqual(JWT.formatRelative(-1, lang: .zh), "刚刚")
        XCTAssertEqual(JWT.formatRelative(-120, lang: .zh), "2 分钟前")
        XCTAssertEqual(JWT.formatRelative(3 * 86_400, lang: .zh), "3 天后")
        XCTAssertEqual(JWT.formatRelative(-60, lang: .en), "1 minute ago")
        XCTAssertEqual(JWT.formatRelative(7200, lang: .en), "in 2 hours")
    }

    func testSigning() throws {
        let payload = try JSON.value(#"{"sub":"1234567890","name":"John Doe","iat":1516239022}"#)
        XCTAssertEqual(JWT.signHMAC(payload: payload, secret: Array(jwtIOSecret.utf8), alg: "HS256"), jwtIO)
        for alg in ["HS256", "HS384", "HS512"] {
            let token = try XCTUnwrap(JWT.signHMAC(payload: try JSON.value(#"{"sub":"张三","n":1}"#), secret: Array("secret-秘密".utf8), alg: alg))
            let d = try XCTUnwrap(try JWT.decode(token))
            XCTAssertEqual(d.alg, alg)
            XCTAssertEqual(d.payload["sub"], .string("张三"))
            XCTAssertEqual(JWT.verifyHMAC(d, secret: Array("secret-秘密".utf8)), true)
        }
        XCTAssertNil(JWT.signHMAC(payload: payload, secret: [1], alg: "RS256"))
        XCTAssertEqual(JWT.algFamily("HS512"), .hmac)
        XCTAssertEqual(JWT.algFamily("RS256"), .rsa)
        XCTAssertEqual(JWT.algFamily("PS384"), .rsaPSS)
        XCTAssertEqual(JWT.algFamily("ES256K"), .ec)
        XCTAssertEqual(JWT.algFamily("EdDSA"), .eddsa)
        XCTAssertEqual(JWT.algFamily("none"), .none)
        XCTAssertEqual(JWT.algFamily("HS1"), .unknown)
    }

    // MARK: 工具

    let tool = JWTTool.spec
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    func run(_ text: String, _ opts: [String: String] = [:], lang: Lang = .zh) throws -> ToolResult {
        let utc = TimeZone(identifier: "UTC") ?? .current
        return try JWTTool.run(ToolInput(text: text, options: tool.defaults.merging(opts) { $1 }, lang: lang, now: now), timeZone: utc)
    }

    func testToolDecodeAndVerify() throws {
        let r = try run(jwtIO, ["secret": jwtIOSecret])
        XCTAssertEqual(r.primary?.label, "Payload")
        XCTAssertEqual(r.primary?.language, "json")
        XCTAssertEqual(r.outputs.first { $0.id == "signature" }?.value, "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c")
        XCTAssertEqual(r.outputs.first { $0.id == "signatureHex" }?.value.count, 64)
        XCTAssertTrue(r.notes.contains { $0.level == .info && $0.message == "签名有效（HS256）" })
        XCTAssertTrue(r.notes.contains { $0.message.contains("没有 exp 声明") })
        let iat = try XCTUnwrap(r.table?.rows.first { $0[0] == "iat" })
        XCTAssertTrue(iat[2].contains("2018-01-18 01:30:22 UTC+00:00"))
        XCTAssertTrue(iat[2].contains("年前"))

        let wrong = try run(jwtIO, ["secret": "nope"], lang: .en)
        XCTAssertTrue(wrong.notes.contains { $0.level == .warning && $0.message.hasPrefix("Signature mismatch") })
        XCTAssertTrue(try run(jwtIO).notes.contains { $0.message.contains("填写 HS 密钥") })

        // Base64 密钥
        let secret = Array("这是一个足够长的 HS384 密钥，长度超过四十八个字节！！".utf8)
        let token = try XCTUnwrap(JWT.signHMAC(payload: try JSON.value(#"{"a":1}"#), secret: secret, alg: "HS384"))
        let b64 = Base64Codec.encode(secret)
        XCTAssertTrue(try run(token, ["secret": b64, "secretEncoding": "base64"]).notes.contains { $0.message == "签名有效（HS384）" })
        XCTAssertTrue(try run(token, ["secret": b64]).notes.contains { $0.message.hasPrefix("签名不匹配") })
        XCTAssertThrowsError(try run(token, ["secret": "***", "secretEncoding": "base64"])) { e in
            XCTAssertTrue((e as? ToolError)?.message.contains("密钥（Base64） 第 1 个字符「*」") ?? false)
        }
    }

    func testToolExpiryRSAAndErrors() throws {
        let expired = b64u(#"{"alg":"HS256"}"#) + "." + b64u(#"{"exp":1799996400}"#) + ".c2ln"
        XCTAssertTrue(try run(expired).notes.contains { $0.level == .warning && $0.message == "令牌已过期（1 小时前）" })
        XCTAssertTrue(try run(expired, lang: .en).notes.contains { $0.message == "The token expired 1h ago" })
        let rs = try run(rs256)
        XCTAssertTrue(rs.notes.contains { $0.message.contains("RS256 签名需要公钥验证") })
        XCTAssertTrue(rs.notes.contains { $0.message.hasPrefix("令牌有效，还剩") })
        XCTAssertEqual(rs.table?.rows.first { $0[0] == "name" }?[2], "李雷")
        let none = try run(b64u(#"{"alg":"none"}"#) + "." + b64u("{}") + ".")
        XCTAssertTrue(none.notes.contains { $0.level == .warning && $0.message.contains("alg 为 none") })

        XCTAssertThrowsError(try run("Bearer " + b64u(#"{"alg":"HS256"}"#) + ".eyJh+GciOi.sig")) { e in
            let te = e as? ToolError
            XCTAssertEqual(te?.line, 1)
            XCTAssertEqual(te?.column, 7 + b64u(#"{"alg":"HS256"}"#).count + 1 + 5)
        }
        XCTAssertEqual(try run("").outputs.count, 0)
    }

    func testToolSign() throws {
        let r = try run(#"{"sub":"1234567890","name":"John Doe","iat":1516239022}"#, ["mode": "sign", "secret": jwtIOSecret])
        XCTAssertEqual(r.primary?.value, jwtIO)
        XCTAssertTrue(r.notes.contains { $0.message.contains("RFC 7518") })
        XCTAssertThrowsError(try run(#"{"a":}"#, ["mode": "sign", "secret": "s"])) { e in
            XCTAssertTrue((e as? ToolError)?.message.contains("第 1 行") ?? false)
        }
        XCTAssertThrowsError(try run(#""x""#, ["mode": "sign", "secret": "s"]))
        XCTAssertThrowsError(try run("{}", ["mode": "sign"])) { e in
            XCTAssertEqual((e as? ToolError)?.message, "请输入密钥")
        }
        let long = String(repeating: "k", count: 64)
        let hs512 = try run(#"{"a":1}"#, ["mode": "sign", "secret": long, "alg": "HS512"])
        XCTAssertTrue(hs512.notes.isEmpty)
        XCTAssertEqual(try JWT.decode(hs512.primary?.value ?? "")?.alg, "HS512")
    }

    func testLargeToken() throws {
        let payload = #"{"sub":"用户🙂","blob":""# + String(repeating: "数据", count: 100_000) + #""}"#
        let token = b64u(#"{"alg":"HS256","typ":"JWT"}"#) + "." + b64u(payload) + "." + b64u("sig")
        let d = try XCTUnwrap(try JWT.decode("\"" + token + "\"\n"))
        XCTAssertEqual(d.payload["sub"], .string("用户🙂"))
        XCTAssertEqual(JWT.normalize("'" + token + "'").token, token)
    }
}
