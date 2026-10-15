import Foundation

// 「API 调试」（Postman 风格界面）的请求模型与纯逻辑：
// URL ↔ Params 双向同步、{{变量}} 替换、请求头 / 请求体构建、cURL 导入导出、响应摘要、历史记录。

public struct HTTPKeyValue: Codable, Hashable, Sendable {
    public var key: String
    public var value: String
    public var enabled: Bool

    public init(_ key: String = "", _ value: String = "", enabled: Bool = true) {
        self.key = key
        self.value = value
        self.enabled = enabled
    }
}

public enum HTTPBody: Codable, Hashable, Sendable {
    case none
    case json(String)
    case text(String)
    case formURLEncoded([HTTPKeyValue])
    /// 只支持文本字段
    case multipart([HTTPKeyValue])
}

public enum HTTPAuth: Codable, Hashable, Sendable {
    case none
    case bearer(String)
    case basic(user: String, password: String)
}

public struct HTTPRequestDraft: Codable, Hashable, Sendable {
    public static let methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

    public var method: String
    /// 地址；查询参数放在 params 里（这里也允许带 ?query，发送时与 params 合并）
    public var url: String
    public var params: [HTTPKeyValue]
    public var headers: [HTTPKeyValue]
    public var body: HTTPBody
    public var auth: HTTPAuth

    public init(
        method: String = "GET",
        url: String = "",
        params: [HTTPKeyValue] = [],
        headers: [HTTPKeyValue] = [],
        body: HTTPBody = .none,
        auth: HTTPAuth = .none
    ) {
        self.method = method
        self.url = url
        self.params = params
        self.headers = headers
        self.body = body
        self.auth = auth
    }

    /// GET / HEAD 不发送请求体
    public var allowsBody: Bool {
        let m = method.uppercased()
        return m != "GET" && m != "HEAD"
    }

    // MARK: - URL ↔ Params

    /// 拆开 URL：地址部分、查询串（不含 ?，没有 ? 时为 nil）、片段（含 #）
    public static func splitURL(_ url: String) -> (base: String, query: String?, fragment: String) {
        let beforeHash: Substring
        let fragment: Substring
        if let hash = url.firstIndex(of: "#") {
            beforeHash = url[..<hash]
            fragment = url[hash...]
        } else {
            beforeHash = url[...]
            fragment = ""
        }
        guard let q = beforeHash.firstIndex(of: "?") else { return (String(beforeHash), nil, String(fragment)) }
        return (String(beforeHash[..<q]), String(beforeHash[beforeHash.index(after: q)...]), String(fragment))
    }

    /// 查询串 → 参数表（百分号解码，+ 视为空格；无法解码时保留原文）
    public static func params(fromQuery query: String) -> [HTTPKeyValue] {
        query.split(separator: "&", omittingEmptySubsequences: true).map { seg in
            if let eq = seg.firstIndex(of: "=") {
                return HTTPKeyValue(decodeComponent(seg[..<eq]), decodeComponent(seg[seg.index(after: eq)...]))
            }
            return HTTPKeyValue(decodeComponent(seg), "")
        }
    }

    /// 参数表 → 查询串（只取启用且有内容的行，按 RFC 3986 编码；未替换的 {{变量}} 原样保留）
    public static func query(from params: [HTTPKeyValue]) -> String {
        params
            .filter { $0.enabled && !($0.key.isEmpty && $0.value.isEmpty) }
            .map { $0.value.isEmpty ? encodeComponent($0.key) : encodeComponent($0.key) + "=" + encodeComponent($0.value) }
            .joined(separator: "&")
    }

    /// 地址栏显示的完整 URL：url + 启用的参数
    public var fullURL: String {
        Self.merge(url, Self.query(from: params))
    }

    /// 地址栏输入变化 → 更新 url 与 params：按顺序复用已启用的行，禁用行原位保留
    public mutating func setFullURL(_ text: String) {
        let parts = Self.splitURL(text)
        url = parts.base + parts.fragment
        let parsed = Self.params(fromQuery: parts.query ?? "")
        var out: [HTTPKeyValue] = []
        var i = 0
        for p in params {
            if !p.enabled {
                out.append(p)
                continue
            }
            guard i < parsed.count else { continue }
            out.append(parsed[i])
            i += 1
        }
        out.append(contentsOf: parsed[min(i, parsed.count)...])
        params = out
    }

    /// 把 url 里自带的查询串移到 params（导入后统一由参数表管理）
    public mutating func absorbQueryFromURL() {
        let parts = Self.splitURL(url)
        guard let q = parts.query else { return }
        url = parts.base + parts.fragment
        params = Self.params(fromQuery: q) + params
    }

    static func merge(_ url: String, _ query: String) -> String {
        let parts = splitURL(url)
        var q = parts.query ?? ""
        if !query.isEmpty { q = q.isEmpty ? query : (q.hasSuffix("&") ? q + query : q + "&" + query) }
        return parts.base + (q.isEmpty ? "" : "?" + q) + parts.fragment
    }

    /// 查询参数允许原样出现的字符（RFC 3986 unreserved + 部分 sub-delims）
    static let queryAllowed: Set<Unicode.Scalar> = Set("!$'()*,;:@/?".unicodeScalars)

    /// 查询参数编码；{{变量}} 片段原样保留
    public static func encodeComponent(_ s: String) -> String {
        var out = ""
        for seg in HTTPVariables.segments(s) {
            if seg.isVariable {
                out += seg.text
            } else {
                out += Curl.percentEncode(seg.text) { Curl.isUnreserved($0) || queryAllowed.contains($0) }
            }
        }
        return out
    }

    static func decodeComponent<S: StringProtocol>(_ s: S) -> String {
        let plus = s.replacingOccurrences(of: "+", with: " ")
        return plus.removingPercentEncoding ?? plus
    }

    // MARK: - 变量

    /// 把所有字段里的 {{变量}} 替换掉（未定义的原样保留）
    public func substituting(_ env: [String: String], now: Date = Date(), random: @escaping @Sendable (Int) -> [UInt8] = ToolInput.systemRandom) -> HTTPRequestDraft {
        let ctx = HTTPVariables.Context(env: env, now: now, random: random)
        func R(_ s: String) -> String { ctx.resolve(s).text }
        func rows(_ list: [HTTPKeyValue]) -> [HTTPKeyValue] {
            list.map { HTTPKeyValue(R($0.key), R($0.value), enabled: $0.enabled) }
        }
        var d = self
        d.url = R(url)
        d.params = rows(params)
        d.headers = rows(headers)
        switch body {
        case .none: break
        case .json(let s): d.body = .json(R(s))
        case .text(let s): d.body = .text(R(s))
        case .formURLEncoded(let list): d.body = .formURLEncoded(rows(list))
        case .multipart(let list): d.body = .multipart(rows(list))
        }
        switch auth {
        case .none: break
        case .bearer(let t): d.auth = .bearer(R(t))
        case .basic(let u, let p): d.auth = .basic(user: R(u), password: R(p))
        }
        return d
    }

    /// 环境里没有定义的变量名（按出现顺序去重；内置动态变量不算）
    public func missingVariables(_ env: [String: String]) -> [String] {
        var texts = [url] + params.filter(\.enabled).flatMap { [$0.key, $0.value] } + headers.filter(\.enabled).flatMap { [$0.key, $0.value] }
        switch body {
        case .none: break
        case .json(let s), .text(let s): texts.append(s)
        case .formURLEncoded(let list), .multipart(let list): texts += list.filter(\.enabled).flatMap { [$0.key, $0.value] }
        }
        switch auth {
        case .none: break
        case .bearer(let t): texts.append(t)
        case .basic(let u, let p): texts += [u, p]
        }
        let ctx = HTTPVariables.Context(env: env, now: Date(timeIntervalSince1970: 0), random: { Array(repeating: 0, count: $0) })
        var seen = Set<String>()
        var out: [String] = []
        for t in texts {
            for name in ctx.resolve(t).missing where seen.insert(name).inserted { out.append(name) }
        }
        return out
    }

    // MARK: - 发送

    /// 最终请求地址：替换变量、补 http://、合并参数
    public func resolvedURL(env: [String: String] = [:]) -> String {
        let d = env.isEmpty ? self : substituting(env)
        let t = d.url.trimmingCharacters(in: .whitespacesAndNewlines)
        var base = t
        if !t.isEmpty, !Curl.hasScheme(t) {
            var rest = Substring(t)
            while rest.hasPrefix("/") { rest = rest.dropFirst() }
            base = "http://" + rest
        }
        return Self.merge(base, Self.query(from: d.params))
    }

    /// 实际发送的请求头：启用的请求头 + 鉴权头 + 自动 Content-Type（用户手动设置的优先）
    public func effectiveHeaders(env: [String: String] = [:]) -> [HTTPHeader] {
        let d = env.isEmpty ? self : substituting(env)
        var out: [HTTPHeader] = d.headers
            .filter { $0.enabled && !$0.key.trimmingCharacters(in: .whitespaces).isEmpty }
            .map { HTTPHeader($0.key.trimmingCharacters(in: .whitespaces), $0.value) }
        func has(_ name: String) -> Bool { out.contains { $0.name.lowercased() == name } }
        switch d.auth {
        case .none: break
        case .bearer(let token):
            let t = token.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty, !has("authorization") { out.append(HTTPHeader("Authorization", "Bearer \(t)")) }
        case .basic(let user, let password):
            if !(user.isEmpty && password.isEmpty), !has("authorization") {
                out.append(HTTPHeader("Authorization", Self.basicAuthValue(user, password)))
            }
        }
        guard allowsBody else { return out }
        switch d.body {
        case .none: break
        case .json: if !has("content-type") { out.append(HTTPHeader("Content-Type", "application/json")) }
        case .text: if !has("content-type") { out.append(HTTPHeader("Content-Type", "text/plain")) }
        case .formURLEncoded: if !has("content-type") { out.append(HTTPHeader("Content-Type", "application/x-www-form-urlencoded")) }
        case .multipart:
            // multipart 的 Content-Type 必须带上 boundary，手动设置的会让服务器无法解析
            out.removeAll { $0.name.lowercased() == "content-type" }
            out.append(HTTPHeader("Content-Type", "multipart/form-data; boundary=\(d.multipartBoundary)"))
        }
        return out
    }

    /// 请求体字节；没有请求体（或 GET / HEAD）时为 nil
    public func bodyData(env: [String: String] = [:]) -> Data? {
        guard allowsBody else { return nil }
        let d = env.isEmpty ? self : substituting(env)
        switch d.body {
        case .none: return nil
        case .json(let s), .text(let s): return Data(s.utf8)
        case .formURLEncoded(let list): return Data(Self.encodeForm(list).utf8)
        case .multipart(let list):
            let boundary = d.multipartBoundary
            var out = ""
            for p in list where p.enabled && !p.key.trimmingCharacters(in: .whitespaces).isEmpty {
                let name = p.key.replacingOccurrences(of: "\"", with: "%22").replacingOccurrences(of: "\r", with: "%0D").replacingOccurrences(of: "\n", with: "%0A")
                out += "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(p.value)\r\n"
            }
            out += "--\(boundary)--\r\n"
            return Data(out.utf8)
        }
    }

    /// 由内容决定的固定 boundary（保证不出现在字段内容里）
    public var multipartBoundary: String {
        guard case .multipart(let list) = body else { return "----ShowMeFormBoundary" }
        var hash: UInt64 = 0xcbf29ce484222325
        for p in list {
            for b in (p.key + "\u{0}" + p.value + "\u{1}").utf8 {
                hash ^= UInt64(b)
                hash = hash &* 0x100000001b3
            }
        }
        var boundary = "----ShowMeFormBoundary" + String(hash, radix: 16)
        while list.contains(where: { $0.key.contains(boundary) || $0.value.contains(boundary) }) { boundary += "x" }
        return boundary
    }

    /// x-www-form-urlencoded 编码（与浏览器 URLSearchParams 相同，空格为 +）
    public static func encodeForm(_ pairs: [HTTPKeyValue]) -> String {
        func enc(_ s: String) -> String {
            var out = ""
            for c in s.unicodeScalars {
                let v = c.value
                if (v >= 0x41 && v <= 0x5A) || (v >= 0x61 && v <= 0x7A) || (v >= 0x30 && v <= 0x39) || c == "*" || c == "-" || c == "." || c == "_" {
                    out.unicodeScalars.append(c)
                } else if c == " " {
                    out += "+"
                } else {
                    for b in String(c).utf8 { out += "%" + Curl.hex2(b) }
                }
            }
            return out
        }
        return pairs.filter { $0.enabled && !($0.key.isEmpty && $0.value.isEmpty) }.map { enc($0.key) + "=" + enc($0.value) }.joined(separator: "&")
    }

    public static func basicAuthValue(_ user: String, _ password: String) -> String {
        "Basic " + Data("\(user):\(password)".utf8).base64EncodedString()
    }

    // MARK: - cURL

    /// 转成结构化请求（用于生成 cURL 或其它语言代码）；Basic 认证保留为 -u
    public func curlRequest(env: [String: String] = [:]) -> CurlRequest {
        let d = env.isEmpty ? self : substituting(env)
        var headers = d.headers
            .filter { $0.enabled && !$0.key.trimmingCharacters(in: .whitespaces).isEmpty }
            .map { HTTPHeader($0.key.trimmingCharacters(in: .whitespaces), $0.value) }
        func has(_ name: String) -> Bool { headers.contains { $0.name.lowercased() == name } }
        var auth: CurlBasicAuth?
        switch d.auth {
        case .none: break
        case .bearer(let token):
            let t = token.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty, !has("authorization") { headers.append(HTTPHeader("Authorization", "Bearer \(t)")) }
        case .basic(let user, let password):
            if !(user.isEmpty && password.isEmpty), !has("authorization") { auth = CurlBasicAuth(username: user, password: password) }
        }
        var body = CurlBody.none
        if allowsBody {
            switch d.body {
            case .none: break
            case .json(let s):
                body = .text(s)
                if !has("content-type") { headers.append(HTTPHeader("Content-Type", "application/json")) }
            case .text(let s):
                body = .text(s)
                if !has("content-type") { headers.append(HTTPHeader("Content-Type", "text/plain")) }
            case .formURLEncoded(let list):
                body = .text(Self.encodeForm(list))
                if !has("content-type") { headers.append(HTTPHeader("Content-Type", "application/x-www-form-urlencoded")) }
            case .multipart(let list):
                headers.removeAll { $0.name.lowercased() == "content-type" }
                body = .multipart(list.filter { $0.enabled && !$0.key.trimmingCharacters(in: .whitespaces).isEmpty }.map { CurlFormPart(name: $0.key, value: $0.value) })
            }
        }
        let m = d.method.trimmingCharacters(in: .whitespaces).uppercased()
        return CurlRequest(method: m.isEmpty ? "GET" : m, url: d.resolvedURL(), headers: headers, body: body, auth: auth)
    }

    public func toCurl(env: [String: String] = [:]) -> String {
        HTTPCodegen.generate(curlRequest(env: env), .curl)
    }

    public static func fromCurl(_ command: String) throws -> HTTPRequestDraft {
        try importCurl(command).draft
    }

    /// cURL → 草稿；notes 是编辑器无法完整表示的部分（文件上传等）
    public static func importCurl(_ command: String) throws -> (draft: HTTPRequestDraft, notes: [LocalizedText]) {
        let parsed = try Curl.parse(command)
        return from(parsed.request)
    }

    /// 结构化请求 → 草稿
    public static func from(_ r: CurlRequest) -> (draft: HTTPRequestDraft, notes: [LocalizedText]) {
        var notes: [LocalizedText] = []
        var d = HTTPRequestDraft(method: r.method.uppercased(), url: r.url)
        d.absorbQueryFromURL()
        var contentType = ""
        for h in r.headers {
            let lower = h.name.lowercased()
            if lower == "authorization", case .none = d.auth {
                let v = h.value.trimmingCharacters(in: .whitespaces)
                if v.lowercased().hasPrefix("bearer "), v.count > 7 {
                    d.auth = .bearer(String(v.dropFirst(7)).trimmingCharacters(in: .whitespaces))
                    continue
                }
                if let basic = decodeBasic(v) {
                    d.auth = .basic(user: basic.0, password: basic.1)
                    continue
                }
            }
            if lower == "content-type" { contentType = h.value }
            d.headers.append(HTTPKeyValue(h.name, h.value))
        }
        if let a = r.auth { d.auth = .basic(user: a.username, password: a.password) }
        func dropContentType(_ when: (String) -> Bool) {
            d.headers.removeAll { $0.key.lowercased() == "content-type" && when($0.value.trimmingCharacters(in: .whitespaces).lowercased()) }
        }
        switch r.body {
        case .none: break
        case .text(let text):
            let ct = contentType.lowercased()
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let looksJSON = (trimmed.hasPrefix("{") || trimmed.hasPrefix("[")) && (try? JSON.value(trimmed)) != nil
            // 请求体原样保留、不自动格式化：签名校验等场景要求字节完全一致
            if ct.contains("json") || looksJSON {
                d.body = .json(text)
                dropContentType { $0 == "application/json" }
            } else if ct.contains("x-www-form-urlencoded") {
                d.body = .formURLEncoded(params(fromQuery: text))
                dropContentType { $0.hasPrefix("application/x-www-form-urlencoded") }
            } else {
                d.body = .text(text)
                dropContentType { $0 == "text/plain" }
            }
        case .multipart(let parts):
            d.body = .multipart(parts.filter { $0.kind == .text }.map { HTTPKeyValue($0.name, $0.value) })
            dropContentType { _ in true }
            if parts.contains(where: { $0.kind == .file }) {
                notes.append(LocalizedText("表单里的文件字段无法导入，已忽略", "File fields in the form can't be imported and were skipped"))
            }
        case .file(let path):
            notes.append(LocalizedText("请求体来自本地文件「\(path)」，无法导入", "The body comes from the local file “\(path)” and can't be imported"))
        }
        if !methods.contains(d.method) {
            notes.append(LocalizedText("\(d.method) 不是常用方法，请确认服务器支持", "\(d.method) is not a common method; make sure the server supports it"))
        }
        if r.insecure { notes.append(LocalizedText("忽略证书校验（-k）无法在这里设置，已忽略", "Skipping certificate checks (-k) can't be set here; ignored")) }
        return (d, notes)
    }

    static func decodeBasic(_ value: String) -> (String, String)? {
        let parts = value.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
        guard parts.count == 2, parts[0].lowercased() == "basic",
              let data = Data(base64Encoded: String(parts[1]).trimmingCharacters(in: .whitespaces)),
              let text = String(data: data, encoding: .utf8),
              let colon = text.firstIndex(of: ":") else { return nil }
        return (String(text[..<colon]), String(text[text.index(after: colon)...]))
    }

    /// 标签页 / 历史里显示的短名称：/users/1
    public var label: String {
        let t = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return "" }
        var rest = Substring(t)
        if let sep = rest.range(of: "://") { rest = rest[sep.upperBound...] }
        let base = Self.splitURL(String(rest)).base
        if let slash = base.firstIndex(of: "/") {
            let path = base[slash...]
            if path != "/" { return path.count > 40 ? "…" + String(path.suffix(39)) : String(path) }
            return String(base[..<slash])
        }
        return base.count > 40 ? String(base.prefix(39)) + "…" : base
    }
}

// MARK: - 变量

/// {{变量}} 的识别与替换
public enum HTTPVariables {
    public struct Segment: Hashable, Sendable {
        public var text: String
        /// 变量名；普通文本为 nil
        public var name: String?
        public var isVariable: Bool { name != nil }
    }

    /// 内置动态变量
    public static let dynamicNames = ["$timestamp", "$isoTimestamp", "$uuid", "$guid", "$randomInt"]

    /// 把文本拆成普通片段与 {{变量}} 片段（用于高亮与编码时保留变量）
    public static func segments(_ text: String) -> [Segment] {
        guard text.contains("{{") else { return text.isEmpty ? [] : [Segment(text: text, name: nil)] }
        let s = Array(text.unicodeScalars)
        var out: [Segment] = []
        var last = 0
        var i = 0
        func str(_ a: Int, _ b: Int) -> String { String(String.UnicodeScalarView(s[a..<b])) }
        while i + 1 < s.count {
            guard s[i] == "{", s[i + 1] == "{" else {
                i += 1
                continue
            }
            // 找到最近的 }}，中间不能有 { 或 }
            var j = i + 2
            while j < s.count, s[j] != "{", s[j] != "}" { j += 1 }
            if j + 1 < s.count, s[j] == "}", s[j + 1] == "}" {
                let name = str(i + 2, j).trimmingCharacters(in: .whitespaces)
                if !name.isEmpty {
                    if i > last { out.append(Segment(text: str(last, i), name: nil)) }
                    out.append(Segment(text: str(i, j + 2), name: name))
                    last = j + 2
                    i = j + 2
                    continue
                }
            }
            i += 1
        }
        if last < s.count { out.append(Segment(text: str(last, s.count), name: nil)) }
        return out
    }

    public struct Context: Sendable {
        public var env: [String: String]
        public var now: Date
        public var random: @Sendable (Int) -> [UInt8]

        public init(env: [String: String], now: Date = Date(), random: @escaping @Sendable (Int) -> [UInt8] = ToolInput.systemRandom) {
            self.env = env
            self.now = now
            self.random = random
        }

        func dynamic(_ name: String) -> String? {
            switch name {
            case "$timestamp":
                return String(Int64(now.timeIntervalSince1970.rounded(.down)))
            case "$isoTimestamp":
                let f = ISO8601DateFormatter()
                f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                f.timeZone = TimeZone(identifier: "UTC")
                return f.string(from: now)
            case "$uuid", "$guid":
                var b = random(16)
                if b.count < 16 { b += Array(repeating: 0, count: 16 - b.count) }
                b[6] = (b[6] & 0x0F) | 0x40
                b[8] = (b[8] & 0x3F) | 0x80
                let h = b.prefix(16).map { CodeEscape.hex(UInt32($0), 2) }.joined()
                let c = Array(h)
                return String(c[0..<8]) + "-" + String(c[8..<12]) + "-" + String(c[12..<16]) + "-" + String(c[16..<20]) + "-" + String(c[20..<32])
            case "$randomInt":
                let b = random(4)
                let v = b.prefix(4).reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
                return String(v % 1001)
            default:
                return nil
            }
        }

        /// 替换变量：变量值里还可以引用其它变量（最多展开 5 层），未定义的原样保留
        public func resolve(_ text: String) -> (text: String, missing: [String]) {
            var missing: [String] = []
            var cur = text
            for _ in 0..<5 {
                guard cur.contains("{{") else { break }
                var changed = false
                var out = ""
                for seg in HTTPVariables.segments(cur) {
                    guard let name = seg.name else {
                        out += seg.text
                        continue
                    }
                    if let v = env[name] {
                        out += v
                        changed = true
                    } else if let v = dynamic(name) {
                        out += v
                        changed = true
                    } else {
                        if !missing.contains(name) { missing.append(name) }
                        out += seg.text
                    }
                }
                cur = out
                if !changed { break }
            }
            return (cur, missing)
        }
    }

    /// 便捷方法：只用环境字典替换
    public static func resolve(_ text: String, env: [String: String]) -> String {
        Context(env: env).resolve(text).text
    }
}

// MARK: - 响应

public struct HTTPResponseSummary: Sendable, Hashable {
    public enum BodyKind: String, Sendable { case empty, json, xml, html, javascript, css, image, text, binary }

    public var status: Int
    /// 服务器返回的原因短语（HTTP/2 没有，可为空）
    public var statusText: String
    public var headers: [HTTPHeader]
    public var body: Data
    /// 耗时（秒）
    public var duration: TimeInterval

    public init(status: Int, statusText: String = "", headers: [HTTPHeader] = [], body: Data = Data(), duration: TimeInterval = 0) {
        self.status = status
        self.statusText = statusText
        self.headers = headers
        self.body = body
        self.duration = duration
    }

    public func header(_ name: String) -> String? {
        let l = name.lowercased()
        return headers.first { $0.name.lowercased() == l }?.value
    }

    /// "application/json; charset=utf-8" → "application/json"
    public var mimeType: String {
        (header("content-type") ?? "").split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
    }

    /// 原因短语：优先用服务器返回的，没有时用标准短语
    public var reasonPhrase: String {
        let t = statusText.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? (HTTPStatusCatalog.status(status)?.phrase ?? "") : t
    }

    /// 「200 OK」，中文界面附带中文名：「404 Not Found · 未找到」
    public func statusLine(_ lang: Lang) -> String {
        var s = "\(status)"
        if !reasonPhrase.isEmpty { s += " " + reasonPhrase }
        if lang == .zh, let name = HTTPStatusCatalog.status(status)?.zhName { s += " · " + name }
        return s
    }

    /// 1xx–5xx 分类
    public var statusClass: Int { min(5, max(1, status / 100)) }

    /// 按 Content-Type 声明的字符集解码，未知字符集回退 UTF-8
    public var bodyText: String {
        let ct = (header("content-type") ?? "").lowercased()
        if let r = ct.range(of: "charset=") {
            let cs = ct[r.upperBound...].prefix { $0 != ";" && $0 != " " }.replacingOccurrences(of: "\"", with: "")
            let enc: String.Encoding? = switch cs {
            case "iso-8859-1", "latin1": .isoLatin1
            case "utf-16": .utf16
            case "us-ascii", "ascii": .ascii
            case "gbk", "gb2312", "gb18030": Self.gb18030
            default: nil
            }
            if let enc, let s = String(data: body, encoding: enc) { return s }
        }
        return String(decoding: body, as: UTF8.self)
    }

    #if canImport(Darwin)
    static let gb18030: String.Encoding? = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)))
    #else
    static let gb18030: String.Encoding? = nil
    #endif

    /// 前 1KB 没有 NUL、控制字符很少时视为文本
    public var isLikelyText: Bool {
        let n = min(body.count, 1024)
        if n == 0 { return true }
        var ctrl = 0
        for b in body.prefix(n) {
            if b == 0 { return false }
            if b < 9 || (b > 13 && b < 32) { ctrl += 1 }
        }
        return Double(ctrl) / Double(n) < 0.05
    }

    public var bodyKind: BodyKind {
        if body.isEmpty { return .empty }
        let mime = mimeType
        if mime.hasPrefix("image/") { return .image }
        if mime.hasSuffix("/json") || mime.hasSuffix("+json") { return .json }
        if mime == "text/html" || mime == "application/xhtml+xml" { return .html }
        if mime.hasSuffix("/xml") || mime.hasSuffix("+xml") { return .xml }
        if mime.contains("javascript") || mime.contains("ecmascript") { return .javascript }
        if mime == "text/css" { return .css }
        if !isLikelyText { return .binary }
        let head = String(decoding: body.prefix(512), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if head.hasPrefix("{") || head.hasPrefix("["), (try? JSON.value(bodyText)) != nil { return .json }
        let lower = head.lowercased()
        if lower.hasPrefix("<!doctype html") || lower.hasPrefix("<html") { return .html }
        if lower.hasPrefix("<?xml"), mime.isEmpty || mime.contains("xml") { return .xml }
        return .text
    }

    /// 美化后的响应体：JSON 用 JSON.print 缩进（数字原样保留），其它原样返回
    public var prettyBody: String {
        let text = bodyText
        if bodyKind == .json, let v = try? JSON.value(text) { return JSON.print(v) }
        return text
    }

    /// 「新标签打开」时的语言 id
    public var language: String {
        switch bodyKind {
        case .json: "json"
        case .xml: "xml"
        case .html: "html"
        case .javascript: "javascript"
        case .css: "css"
        default: "plain"
        }
    }

    public var sizeText: String { Self.formatSize(body.count) }

    public var durationText: String { Self.formatDuration(duration) }

    /// 1536 → "1.5 KB"
    public static func formatSize(_ bytes: Int) -> String {
        let units = ["B", "KB", "MB", "GB", "TB"]
        var v = Double(abs(bytes))
        var i = 0
        while v >= 1024, i < units.count - 1 {
            v /= 1024
            i += 1
        }
        var s: String
        if i == 0 {
            s = String(abs(bytes))
        } else {
            s = String(format: "%.1f", v)
            if s.hasSuffix(".0") { s.removeLast(2) }
        }
        return (bytes < 0 ? "-" : "") + s + " " + units[i]
    }

    /// 0.123 → "123 ms"，2.5 → "2.50 s"
    public static func formatDuration(_ seconds: TimeInterval) -> String {
        let ms = seconds * 1000
        if !ms.isFinite || ms < 0 { return "-" }
        if ms < 1000 { return "\(Int(ms.rounded())) ms" }
        if ms < 60_000 { return String(format: ms < 10_000 ? "%.2f s" : "%.1f s", ms / 1000) }
        let m = Int(ms / 60_000)
        return "\(m) min \(Int((ms.truncatingRemainder(dividingBy: 60_000) / 1000).rounded())) s"
    }
}

// MARK: - 历史

public struct HTTPHistoryEntry: Codable, Hashable, Sendable {
    public static let limit = 100

    public var draft: HTTPRequestDraft
    /// 没有收到响应（网络错误）时为 nil
    public var status: Int?
    /// 耗时（秒）
    public var duration: TimeInterval?
    public var date: Date

    public init(draft: HTTPRequestDraft, status: Int? = nil, duration: TimeInterval? = nil, date: Date) {
        self.draft = draft
        self.status = status
        self.duration = duration
        self.date = date
    }

    /// 新记录放在最前面，最多保留 limit 条
    public static func adding(_ entry: HTTPHistoryEntry, to list: [HTTPHistoryEntry], limit: Int = HTTPHistoryEntry.limit) -> [HTTPHistoryEntry] {
        Array(([entry] + list).prefix(max(0, limit)))
    }
}
