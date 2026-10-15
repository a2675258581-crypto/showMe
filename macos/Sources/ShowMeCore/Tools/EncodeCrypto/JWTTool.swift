import Foundation

// JWT 解析 / 校验 / 签发：严格的 Base64URL 与 JSON 校验（错误带段名与位置），
// 注册声明的解释与时间换算，HS256/384/512 验签与签发；RS / PS / ES / EdDSA 只解码不验签。

public enum JWT {
    public enum Segment: String, Sendable { case header = "Header", payload = "Payload", signature = "Signature" }

    public struct DecodeError: Error, Sendable, Hashable {
        public var message: LocalizedText
        public var segment: Segment?
        /// 出错字符在原始输入中的下标（Unicode 标量）
        public var position: Int?
    }

    public struct Decoded: Sendable, Hashable {
        /// 去掉 Bearer 前缀、空白与引号后的令牌
        public var token: String
        public var header: JSONValue
        public var payload: JSONValue
        public var signature: [UInt8]
        public var alg: String
        public var warnings: [LocalizedText]
        public var strippedBearer: Bool
        /// 被签名的部分：header.payload
        public var signingInput: String
    }

    /// 去掉 Bearer 前缀、所有空白与包裹的引号；map[i] 为 token 第 i 个标量在原始输入中的下标
    public static func normalize(_ input: String) -> (token: String, map: [Int], strippedBearer: Bool) {
        let s = Array(input.unicodeScalars)
        var start = 0
        var stripped = false
        // 「Bearer 」或「Authorization: Bearer 」前缀（不区分大小写）
        var p = 0
        while p < s.count && s[p].properties.isWhitespace { p += 1 }
        let rest = EncodeCryptoShared.string(s[p..<min(s.count, p + 32)]).lowercased()
        for prefix in ["authorization: bearer", "authorization:bearer", "bearer"] where rest.hasPrefix(prefix) {
            let after = p + prefix.unicodeScalars.count
            if after < s.count && s[after].properties.isWhitespace {
                var q = after
                while q < s.count && s[q].properties.isWhitespace { q += 1 }
                start = q
                stripped = true
                break
            }
        }
        var last = s.count - 1
        while last >= 0 && s[last].properties.isWhitespace { last -= 1 }
        var token = String.UnicodeScalarView()
        var map: [Int] = []
        for i in start..<max(start, s.count) {
            let c = s[i]
            if c == " " || c == "\n" || c == "\r" || c == "\t" { continue }
            if (c == "\"" || c == "'") && (token.isEmpty || i == last) { continue }
            token.append(c)
            map.append(i)
        }
        return (String(token), map, stripped)
    }

    /// 解码 JWT；输入为空时返回 nil
    public static func decode(_ input: String) throws -> Decoded? {
        let norm = normalize(input)
        let token = norm.token
        if token.isEmpty { return nil }
        let parts = token.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if parts.count == 5 {
            var detail = LocalizedText("", "")
            if let bytes = try? Base64Codec.decode(parts[0], strictURL: true), let text = UTF8Check.decode(bytes),
               let h = try? JSON.value(text), h.members != nil {
                let alg = h["alg"]?.scalarText ?? "undefined", enc = h["enc"]?.scalarText ?? "undefined"
                detail = LocalizedText("（alg: \(alg)，enc: \(enc)）", " (alg: \(alg), enc: \(enc))")
            }
            throw DecodeError(message: LocalizedText(
                "这是 JWE 加密令牌（5 段）\(detail.zh)：Payload 已被加密，需要对应的私钥 / 密钥解密后才能查看。本工具只解析 JWS 签名令牌（3 段）。",
                "This is an encrypted JWE token (5 parts)\(detail.en): the payload is encrypted and needs the matching key to read. Only signed JWS tokens (3 parts) can be decoded here."
            ))
        }
        guard parts.count == 3 else {
            let hint: LocalizedText = parts.count == 1
                ? LocalizedText("当前没有「.」分隔符，可能不是 JWT", "there is no “.” separator, so this may not be a JWT")
                : parts.count == 2
                    ? LocalizedText("当前只有 2 段——可能缺少签名部分，或复制时被截断", "there are only 2 parts — the signature may be missing or the token was cut off")
                    : LocalizedText("当前有 \(parts.count) 段", "there are \(parts.count) parts")
            throw DecodeError(message: LocalizedText(
                "JWT 应由 3 段组成（Header.Payload.Signature），\(hint.zh)。",
                "A JWT has 3 parts (Header.Payload.Signature); \(hint.en)."
            ))
        }
        if parts[0].isEmpty { throw DecodeError(message: LocalizedText("Header 段为空。", "The header is empty."), segment: .header) }
        if parts[1].isEmpty {
            throw DecodeError(message: LocalizedText(
                "Payload 段为空（可能是 RFC 7797 分离式载荷的 JWS），无法解析声明。",
                "The payload is empty (possibly a detached-payload JWS per RFC 7797), so there are no claims to read."
            ), segment: .payload)
        }
        let offsets = [0, parts[0].unicodeScalars.count + 1, parts[0].unicodeScalars.count + parts[1].unicodeScalars.count + 2]
        let segments: [Segment] = [.header, .payload, .signature]
        var decoded: [[UInt8]] = []
        for i in 0..<3 {
            let seg = segments[i]
            do {
                decoded.append(try Base64Codec.decode(parts[i], strictURL: true, label: LocalizedText(seg.rawValue, seg.rawValue)))
            } catch let e as ByteDecodeError {
                let pos = e.position.flatMap { p in offsets[i] + p < norm.map.count ? norm.map[offsets[i] + p] : nil }
                throw DecodeError(message: LocalizedText("\(seg.rawValue) 不是合法的 Base64URL：\(e.message.zh)", "\(seg.rawValue) is not valid Base64URL: \(e.message.en)"),
                                  segment: seg, position: pos)
            }
        }

        func parseJSON(_ i: Int) throws -> JSONValue {
            let seg = segments[i]
            let text: String
            do { text = try UTF8Check.decodeOrThrow(decoded[i]) } catch let e as ByteDecodeError {
                throw DecodeError(message: LocalizedText("\(seg.rawValue) 解码后\(e.message.zh)。", "\(seg.rawValue) decodes to bytes that \(e.message.en)."), segment: seg)
            }
            let value: JSONValue
            do { value = try JSON.value(text) } catch let e as JSONParseError {
                let preview = text.count > 60 ? String(text.prefix(60)) + "…" : text
                throw DecodeError(message: LocalizedText(
                    "\(seg.rawValue) 不是合法的 JSON（\(e.toolError(.zh).message)）。\n解码内容：\(preview)",
                    "\(seg.rawValue) is not valid JSON (\(e.toolError(.en).message)).\nDecoded content: \(preview)"
                ), segment: seg)
            }
            guard value.members != nil else {
                let type: LocalizedText = switch value {
                case .array: LocalizedText("数组", "an array")
                case .null: LocalizedText("null", "null")
                case .string: LocalizedText("string", "a string")
                case .number: LocalizedText("number", "a number")
                case .bool: LocalizedText("boolean", "a boolean")
                case .object: LocalizedText("object", "an object")
                }
                throw DecodeError(message: LocalizedText("\(seg.rawValue) 必须是 JSON 对象，当前是 \(type.zh)。", "\(seg.rawValue) must be a JSON object, not \(type.en)."), segment: seg)
            }
            return value
        }
        let header = try parseJSON(0)
        let payload = try parseJSON(1)

        var warnings: [LocalizedText] = []
        let alg = header["alg"]?.stringValue ?? ""
        if alg.isEmpty { warnings.append(LocalizedText("Header 缺少 alg（签名算法）字段。", "The header has no alg (signing algorithm).")) }
        if alg.lowercased() == "none" {
            warnings.append(LocalizedText("alg 为 none：这是未签名的令牌，任何人都可以伪造，服务端必须拒绝。",
                                          "alg is none: this token is unsigned, anyone can forge it, and servers must reject it."))
        } else if !alg.isEmpty && decoded[2].isEmpty {
            warnings.append(LocalizedText("Header 声明 alg 为 \(alg)，但签名段为空。", "The header says alg is \(alg), but the signature is empty."))
        }
        if let typ = header["typ"]?.stringValue, !typ.lowercased().contains("jwt") {
            warnings.append(LocalizedText("typ 为「\(typ)」，不是常见的 JWT。", "typ is “\(typ)”, not the usual JWT."))
        }
        if let crit = header["crit"]?.items, !crit.isEmpty {
            let list = crit.map(\.scalarText).joined(separator: ", ")
            warnings.append(LocalizedText("Header 含有关键扩展 crit：\(list)，验签方必须理解这些字段。", "The header has critical extensions (crit: \(list)) that verifiers must understand."))
        }
        return Decoded(token: token, header: header, payload: payload, signature: decoded[2], alg: alg, warnings: warnings,
                       strippedBearer: norm.strippedBearer, signingInput: parts[0] + "." + parts[1])
    }

    // MARK: 声明

    static let registered: [(String, LocalizedText, LocalizedText)] = [
        ("iss", LocalizedText("签发者", "Issuer"), LocalizedText("Issuer：签发该令牌的服务（通常是认证服务器的 URL）", "The service that issued the token (usually the auth server URL)")),
        ("sub", LocalizedText("主题", "Subject"), LocalizedText("Subject：令牌所代表的用户或实体 ID", "The user or entity the token represents")),
        ("aud", LocalizedText("受众", "Audience"), LocalizedText("Audience：令牌的预期接收方，服务端应校验是否包含自己", "Intended recipients; servers should check they are included")),
        ("exp", LocalizedText("过期时间", "Expires"), LocalizedText("Expiration Time：此时间之后令牌不再有效（秒级时间戳）", "The token is invalid after this time (seconds)")),
        ("nbf", LocalizedText("生效时间", "Not before"), LocalizedText("Not Before：此时间之前令牌不可使用（秒级时间戳）", "The token cannot be used before this time (seconds)")),
        ("iat", LocalizedText("签发时间", "Issued at"), LocalizedText("Issued At：令牌签发的时间（秒级时间戳）", "When the token was issued (seconds)")),
        ("jti", LocalizedText("令牌 ID", "Token ID"), LocalizedText("JWT ID：令牌唯一标识，可用于防重放或吊销", "A unique token ID for replay protection or revocation")),
    ]

    static let common: [String: (LocalizedText, LocalizedText)] = [
        "name": (LocalizedText("姓名", "Name"), LocalizedText("OIDC：用户全名", "OIDC: full name")),
        "email": (LocalizedText("邮箱", "Email"), LocalizedText("OIDC：用户邮箱", "OIDC: email address")),
        "email_verified": (LocalizedText("邮箱已验证", "Email verified"), LocalizedText("OIDC：邮箱是否经过验证", "OIDC: whether the email is verified")),
        "scope": (LocalizedText("权限范围", "Scope"), LocalizedText("OAuth 2.0：以空格分隔的授权范围", "OAuth 2.0: space-separated scopes")),
        "scp": (LocalizedText("权限范围", "Scope"), LocalizedText("OAuth 2.0：授权范围（数组形式）", "OAuth 2.0: scopes as an array")),
        "roles": (LocalizedText("角色", "Roles"), LocalizedText("自定义：用户角色列表", "Custom: user roles")),
        "azp": (LocalizedText("授权方", "Authorized party"), LocalizedText("OIDC Authorized Party：获得令牌的客户端 ID", "OIDC: the client the token was issued to")),
        "client_id": (LocalizedText("客户端 ID", "Client ID"), LocalizedText("OAuth 2.0 客户端标识", "OAuth 2.0 client identifier")),
        "nonce": (LocalizedText("Nonce", "Nonce"), LocalizedText("OIDC：防重放随机串，需与请求中的一致", "OIDC: anti-replay value that must match the request")),
        "auth_time": (LocalizedText("认证时间", "Auth time"), LocalizedText("OIDC：用户完成认证的时间（秒级时间戳）", "OIDC: when the user authenticated (seconds)")),
        "sid": (LocalizedText("会话 ID", "Session ID"), LocalizedText("OIDC：登录会话标识", "OIDC: session identifier")),
        "at_hash": (LocalizedText("Access Token 哈希", "Access token hash"), LocalizedText("OIDC：access_token 的哈希前半部分", "OIDC: left half of the access token hash")),
        "amr": (LocalizedText("认证方式", "Auth methods"), LocalizedText("OIDC：认证方法引用（如 pwd、otp）", "OIDC: authentication methods (e.g. pwd, otp)")),
        "acr": (LocalizedText("认证等级", "Auth level"), LocalizedText("OIDC：认证上下文等级", "OIDC: authentication context class")),
    ]

    static let timeClaims: Set<String> = ["exp", "nbf", "iat", "auth_time", "updated_at"]

    public struct Claim: Sendable, Hashable {
        public var key: String
        public var name: LocalizedText
        public var description: LocalizedText
        public var registered: Bool
        public var value: JSONValue
        /// 用于展示的文本
        public var text: String
        /// 时间类声明：秒级时间戳
        public var seconds: Double?
        /// 值有问题时的说明
        public var issue: LocalizedText?
    }

    static func claimText(_ v: JSONValue) -> String {
        if case .string(let s) = v { return s }
        if let items = v.items, items.allSatisfy({ $0.stringValue != nil }) { return items.compactMap(\.stringValue).joined(separator: ", ") }
        return JSON.print(v, .minified)
    }

    static func numeric(_ v: JSONValue?) -> Double? {
        switch v {
        case .number(let n)?: Double(n).flatMap { $0.isFinite ? $0 : nil }
        case .string(let s)? where !s.isEmpty && s.allSatisfy({ $0.isASCII && $0.isNumber }): Double(s)
        default: nil
        }
    }

    /// 把 payload 整理成表格行：注册声明在前（按 RFC 顺序），其余按原顺序
    public static func claims(_ payload: JSONValue) -> [Claim] {
        let members = payload.members ?? []
        var keys = registered.map(\.0).filter { k in members.contains { $0.key == k } }
        for m in members where !registered.contains(where: { $0.0 == m.key }) && !keys.contains(m.key) { keys.append(m.key) }
        return keys.compactMap { key in
            guard let value = payload[key] else { return nil }
            let reg = registered.first { $0.0 == key }
            let info = reg.map { ($0.1, $0.2) } ?? common[key]
            var claim = Claim(key: key, name: info?.0 ?? LocalizedText("自定义声明", "Custom claim"),
                              description: info?.1 ?? LocalizedText("应用自定义的私有声明", "An application-specific private claim"),
                              registered: reg != nil, value: value, text: claimText(value))
            if timeClaims.contains(key) {
                switch value {
                case .number(let n):
                    if let d = Double(n), d.isFinite {
                        claim.seconds = d
                        if d > 1e11 {
                            claim.issue = LocalizedText("数值过大，看起来是毫秒时间戳；JWT 规定使用秒级时间戳（NumericDate）",
                                                        "Too large — this looks like milliseconds; JWT uses seconds (NumericDate)")
                        }
                    }
                case .string(let s) where !s.isEmpty && s.allSatisfy({ $0.isASCII && $0.isNumber }):
                    claim.seconds = Double(s)
                    claim.issue = LocalizedText("应为数字而不是字符串", "Should be a number, not a string")
                default:
                    claim.issue = LocalizedText("应为秒级时间戳（数字）", "Should be a timestamp in seconds (a number)")
                }
            }
            if key == "aud", value.stringValue == nil && value.items == nil {
                claim.issue = LocalizedText("aud 应为字符串或字符串数组", "aud should be a string or an array of strings")
            }
            if ["iss", "sub", "jti"].contains(key), value.stringValue == nil {
                claim.issue = LocalizedText("\(key) 应为字符串", "\(key) should be a string")
            }
            return claim
        }
    }

    public enum TimeStateKind: String, Sendable { case valid, expired, notYet, noExp }

    public struct TimeState: Sendable, Hashable {
        public var state: TimeStateKind
        public var exp: Double?, nbf: Double?, iat: Double?
        /// 距过期的秒数（已过期为负）
        public var remaining: Double?
        /// 距生效的秒数（未生效时为正）
        public var untilValid: Double?
        /// 从 iat（或 nbf）到 exp 已经过的比例 0–1
        public var progress: Double?
    }

    public static func timeState(_ payload: JSONValue, now: Date) -> TimeState {
        let exp = numeric(payload["exp"]), nbf = numeric(payload["nbf"]), iat = numeric(payload["iat"])
        let t = now.timeIntervalSince1970
        var s = TimeState(state: .noExp, exp: exp, nbf: nbf, iat: iat)
        if let nbf, t < nbf {
            s.state = .notYet
            s.untilValid = nbf - t
            return s
        }
        guard let exp else { return s }
        s.remaining = exp - t
        if let start = iat ?? nbf, exp > start { s.progress = min(1, max(0, (t - start) / (exp - start))) }
        s.state = exp - t <= 0 ? .expired : .valid
        return s
    }

    // MARK: 时间格式

    /// 秒级时间戳 → "YYYY-MM-DD HH:mm:ss"
    public static func formatDateTime(_ seconds: Double, timeZone: TimeZone) -> String {
        guard seconds.isFinite, abs(seconds) < 1e14 else { return "—" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = timeZone
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f.string(from: Date(timeIntervalSince1970: seconds))
    }

    /// 时区偏移，如 UTC+08:00
    static func offsetLabel(_ tz: TimeZone, at seconds: Double) -> String {
        let off = tz.secondsFromGMT(for: Date(timeIntervalSince1970: seconds))
        return String(format: "UTC%@%02d:%02d", off < 0 ? "-" : "+", abs(off) / 3600, abs(off) % 3600 / 60)
    }

    /// 秒 → "2 天 3 小时 4 分 5 秒"（取最大的若干个单位）
    public static func formatDuration(_ seconds: Double, maxUnits: Int = 4, lang: Lang) -> String {
        var s = Int(abs(seconds).rounded(.down))
        let units: [(Int, String, String)] = [(365 * 86400, "年", "y"), (86400, "天", "d"), (3600, "小时", "h"), (60, "分", "m"), (1, "秒", "s")]
        var out: [String] = []
        for (size, zh, en) in units where out.count < maxUnits {
            let n = s / size
            if n > 0 {
                out.append(lang.t("\(n) \(zh)", "\(n)\(en)"))
                s -= n * size
            }
        }
        return out.isEmpty ? lang.t("0 秒", "0s") : out.joined(separator: " ")
    }

    /// 相对时间："3 分钟前" / "2 天后"
    public static func formatRelative(_ diffSeconds: Double, lang: Lang) -> String {
        let a = abs(diffSeconds)
        if a < 5 { return lang.t("刚刚", "just now") }
        let units: [(Double, String, String)] = [(365 * 86400, "年", "year"), (30 * 86400, "个月", "month"), (86400, "天", "day"), (3600, "小时", "hour"), (60, "分钟", "minute"), (1, "秒", "second")]
        for (size, zh, en) in units where a >= size {
            let n = Int((a / size).rounded(.down))
            let word = n == 1 ? en : en + "s"
            return diffSeconds < 0 ? lang.t("\(n) \(zh)前", "\(n) \(word) ago") : lang.t("\(n) \(zh)后", "in \(n) \(word)")
        }
        return lang.t("刚刚", "just now")
    }

    // MARK: 验签与签发

    public enum AlgFamily: String, Sendable { case hmac, rsa, rsaPSS, ec, eddsa, none, unknown }

    public static func algFamily(_ alg: String) -> AlgFamily {
        switch alg {
        case "HS256", "HS384", "HS512": .hmac
        case "RS256", "RS384", "RS512": .rsa
        case "PS256", "PS384", "PS512": .rsaPSS
        case "ES256", "ES384", "ES512", "ES256K": .ec
        case "EdDSA", "Ed25519": .eddsa
        default: alg.lowercased() == "none" ? .none : .unknown
        }
    }

    static func hmacAlgorithm(_ alg: String) -> HashAlgorithm? {
        switch alg {
        case "HS256": .sha256
        case "HS384": .sha384
        case "HS512": .sha512
        default: nil
        }
    }

    /// RFC 7518 §3.2：HMAC 密钥至少与哈希输出等长
    public static func minSecretBytes(_ alg: String) -> Int { hmacAlgorithm(alg)?.digestSize ?? 0 }

    /// HS 密钥：原文 UTF-8 或 Base64 / Base64URL
    public static func secretBytes(_ secret: String, base64: Bool) throws -> [UInt8] {
        if secret.isEmpty { throw ByteDecodeError(LocalizedText("请输入密钥", "Enter the secret")) }
        if !base64 { return Array(secret.utf8) }
        return try Base64Codec.decode(secret.trimmingCharacters(in: .whitespacesAndNewlines), label: LocalizedText("密钥（Base64）", "Secret (Base64)"))
    }

    /// 校验 HS256/384/512 签名（不校验 exp / nbf）；不是 HS 算法时返回 nil
    public static func verifyHMAC(_ jwt: Decoded, secret: [UInt8]) -> Bool? {
        guard let h = hmacAlgorithm(jwt.alg) else { return nil }
        return ByteUtil.constantTimeEqual(HMAC.mac(h, key: secret, message: Array(jwt.signingInput.utf8)), jwt.signature)
    }

    /// 签发 HS 令牌：header 为 {"alg": …, "typ": "JWT"}，payload 原样（压缩）
    public static func signHMAC(payload: JSONValue, secret: [UInt8], alg: String, extraHeader: [JSONMember] = []) -> String? {
        guard let h = hmacAlgorithm(alg) else { return nil }
        var header = [JSONMember("alg", .string(alg))]
        if !extraHeader.contains(where: { $0.key == "typ" }) { header.append(JSONMember("typ", .string("JWT"))) }
        header += extraHeader.filter { $0.key != "alg" }
        let input = Base64Codec.encodeURL(Array(JSON.print(.object(header), .minified).utf8)) + "." + Base64Codec.encodeURL(Array(JSON.print(payload, .minified).utf8))
        return input + "." + Base64Codec.encodeURL(HMAC.mac(h, key: secret, message: Array(input.utf8)))
    }
}

public enum JWTTool {
    public static let spec = ToolSpec(
        id: "jwt-decoder",
        name: LocalizedText("JWT 解析", "JWT Decoder"),
        summary: LocalizedText(
            "解码 JWT 的 Header 与 Payload，显示有效期，校验 HS256/384/512 签名，并可签发 HS 令牌。",
            "Decode a JWT’s header and payload, show its validity, verify HS256/384/512 signatures and sign HS tokens."
        ),
        category: .encode,
        keywords: ["jwt", "token", "json web token", "decode", "verify", "hs256", "令牌", "rs256", "es256", "jwk", "jwks", "签名", "生成", "bearer", "jx"],
        symbol: "key",
        input: .required,
        inputLabel: LocalizedText("JWT 令牌（签发时为 Payload JSON）", "JWT (payload JSON when signing)"),
        fields: [
            ToolField("mode", LocalizedText("操作", "Action"), .choice([
                ToolChoice("decode", LocalizedText("解析", "Decode")),
                ToolChoice("sign", LocalizedText("签发", "Sign")),
            ]), default: "decode"),
            ToolField("secret", LocalizedText("HS 密钥", "HS secret"), .text(placeholder: LocalizedText("填写后校验 / 签发 HS256/384/512", "Fill in to verify or sign HS256/384/512"), secret: true),
                      default: ""),
            ToolField("secretEncoding", LocalizedText("密钥编码", "Secret encoding"), .choice([
                ToolChoice("utf8", LocalizedText("原文", "Text")),
                ToolChoice("base64", "Base64"),
            ]), default: "utf8"),
            ToolField("alg", LocalizedText("算法", "Algorithm"), .choice([
                ToolChoice("HS256"), ToolChoice("HS384"), ToolChoice("HS512"),
            ]), default: "HS256", visibleWhen: ToolCondition("mode", is: "sign")),
        ],
        run: { input in try run(input) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        try run(input, timeZone: .current)
    }

    static func secret(_ input: ToolInput) throws -> [UInt8]? {
        let s = input.string("secret")
        if s.isEmpty { return nil }
        do { return try JWT.secretBytes(s, base64: input.string("secretEncoding") == "base64") } catch let e as ByteDecodeError {
            throw ToolError(e.message(input.lang))
        }
    }

    static func run(_ input: ToolInput, timeZone: TimeZone) throws -> ToolResult {
        let lang = input.lang
        if input.string("mode") == "sign" { return try sign(input) }

        let jwt: JWT.Decoded
        do {
            guard let d = try JWT.decode(input.text) else { return ToolResult() }
            jwt = d
        } catch let e as JWT.DecodeError {
            if let pos = e.position {
                var loc = LineLocator(input.text)
                let (line, column) = loc.locate(pos)
                throw ToolError(lang.t("第 \(line) 行第 \(column) 列：", "Line \(line), column \(column): ") + e.message(lang), line: line, column: column)
            }
            throw ToolError(e.message(lang))
        }

        var notes: [ToolNote] = jwt.warnings.map { ToolNote(.warning, $0(lang)) }
        if jwt.strippedBearer { notes.append(ToolNote(.info, lang.t("已去掉 Bearer 前缀", "Removed the Bearer prefix"))) }

        // 有效期
        let now = input.now.timeIntervalSince1970
        let ts = JWT.timeState(jwt.payload, now: input.now)
        switch ts.state {
        case .valid:
            let left = JWT.formatDuration(ts.remaining ?? 0, lang: lang)
            let pct = ts.progress.map { lang.t("，已用 \(Int(($0 * 100).rounded()))%", ", \(Int(($0 * 100).rounded()))% elapsed") } ?? ""
            notes.append(ToolNote(.info, lang.t("令牌有效，还剩 \(left)\(pct)", "The token is valid for another \(left)\(pct)")))
        case .expired:
            let ago = JWT.formatDuration(-(ts.remaining ?? 0), lang: lang)
            notes.append(ToolNote(.warning, lang.t("令牌已过期（\(ago)前）", "The token expired \(ago) ago")))
        case .notYet:
            notes.append(ToolNote(.warning, lang.t("令牌尚未生效，还要 \(JWT.formatDuration(ts.untilValid ?? 0, lang: lang))", "The token is not valid yet; it starts in \(JWT.formatDuration(ts.untilValid ?? 0, lang: lang))")))
        case .noExp:
            notes.append(ToolNote(.info, lang.t("没有 exp 声明：令牌永不过期", "No exp claim: the token never expires")))
        }

        // 签名
        let family = JWT.algFamily(jwt.alg)
        switch family {
        case .hmac:
            if let key = try secret(input), let ok = JWT.verifyHMAC(jwt, secret: key) {
                notes.append(ok
                    ? ToolNote(.info, lang.t("签名有效（\(jwt.alg)）", "Signature is valid (\(jwt.alg))"))
                    : ToolNote(.warning, lang.t("签名不匹配：令牌内容被修改过，或密钥不正确", "Signature mismatch: the token was modified or the secret is wrong")))
            } else {
                notes.append(ToolNote(.info, lang.t("填写 HS 密钥即可校验 \(jwt.alg) 签名", "Fill in the HS secret to verify the \(jwt.alg) signature")))
            }
        case .rsa, .rsaPSS, .ec, .eddsa:
            notes.append(ToolNote(.info, lang.t("\(jwt.alg) 签名需要公钥验证，本工具暂不支持（只解码）", "Verifying \(jwt.alg) signatures needs a public key and is not supported here (decode only)")))
        case .none:
            break
        case .unknown:
            if !jwt.alg.isEmpty { notes.append(ToolNote(.warning, lang.t("不支持的签名算法：\(jwt.alg)", "Unsupported signing algorithm: \(jwt.alg)"))) }
        }

        // 声明表
        let rows: [[String]] = JWT.claims(jwt.payload).map { c in
            var value = c.text
            if let s = c.seconds {
                let secs = s > 1e11 ? s / 1000 : s
                value += "\n" + JWT.formatDateTime(secs, timeZone: timeZone) + " " + JWT.offsetLabel(timeZone, at: secs)
                    + lang.t("（\(JWT.formatRelative(secs - now, lang: lang))）", " (\(JWT.formatRelative(secs - now, lang: lang)))")
            }
            var desc = c.description(lang)
            if let issue = c.issue { desc = "⚠️ " + issue(lang) + "\n" + desc }
            return [c.key, c.name(lang), value, desc]
        }
        let table = rows.isEmpty ? nil : ToolTable(columns: [lang.t("声明", "Claim"), lang.t("含义", "Meaning"), lang.t("值", "Value"), lang.t("说明", "Notes")], rows: rows)

        let outputs: [ToolOutput] = [
            ToolOutput(id: "result", label: "Payload", value: JSON.print(jwt.payload), isPrimary: true, language: "json"),
            ToolOutput(id: "header", label: "Header", value: JSON.print(jwt.header), language: "json"),
            ToolOutput(id: "signature", label: lang.t("签名（Base64URL）", "Signature (Base64URL)"), value: Base64Codec.encodeURL(jwt.signature)),
            ToolOutput(id: "signatureHex", label: lang.t("签名（Hex）", "Signature (hex)"), value: HexCodec.encode(jwt.signature)),
        ]
        return ToolResult(outputs: outputs, notes: notes, table: table)
    }

    static func sign(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let alg = input.string("alg").isEmpty ? "HS256" : input.string("alg")
        let payload: JSONValue
        do { payload = try JSON.value(input.text) } catch let e as JSONParseError {
            let err = e.toolError(lang)
            throw ToolError(lang.t("Payload 不是合法的 JSON：", "The payload is not valid JSON: ") + err.message, line: err.line, column: err.column)
        }
        guard payload.members != nil else {
            throw ToolError(lang.t("Payload 必须是 JSON 对象（声明集合）", "The payload must be a JSON object (a set of claims)"))
        }
        guard let key = try secret(input), !key.isEmpty else {
            throw ToolError(lang.t("请输入密钥", "Enter the secret"))
        }
        guard let token = JWT.signHMAC(payload: payload, secret: key, alg: alg) else {
            throw ToolError(lang.t("不支持的算法：\(alg)", "Unsupported algorithm: \(alg)"))
        }
        var notes: [ToolNote] = []
        let min = JWT.minSecretBytes(alg)
        if key.count < min {
            notes.append(ToolNote(.warning, lang.t("密钥只有 \(key.count) 字节，RFC 7518 要求 \(alg) 的密钥至少 \(min) 字节。",
                                                   "The secret is only \(key.count) bytes; RFC 7518 requires at least \(min) bytes for \(alg).")))
        }
        return ToolResult(outputs: [.primary("JWT", token)], notes: notes)
    }
}
