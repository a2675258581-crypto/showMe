import Foundation

// URL 编解码（encodeURIComponent / encodeURI / 表单）与 URL 解析（协议、主机、端口、路径、查询参数、片段）。

public enum URLCodecTool {
    public static let spec = ToolSpec(
        id: "url-codec",
        name: LocalizedText("URL 编解码", "URL Encode / Decode"),
        summary: LocalizedText(
            "URL 编码 / 解码，并把链接拆解成协议、主机、路径与查询参数。",
            "Percent-encode or decode URLs, and break a link into scheme, host, path and query parameters."
        ),
        category: .encode,
        keywords: ["url", "uri", "encode", "decode", "encodeURIComponent", "query", "percent", "编码", "解析", "urlencode", "bm"],
        symbol: "link",
        input: .required,
        inputLabel: LocalizedText("文本或 URL", "Text or URL"),
        fields: [
            ToolField("mode", LocalizedText("操作", "Action"), .choice([
                ToolChoice("encode", LocalizedText("编码", "Encode")),
                ToolChoice("decode", LocalizedText("解码", "Decode")),
                ToolChoice("parse", LocalizedText("解析 URL", "Parse URL")),
            ]), default: "encode"),
            ToolField("variant", LocalizedText("规则", "Rules"), .choice([
                ToolChoice("component", "encodeURIComponent"),
                ToolChoice("uri", "encodeURI"),
                ToolChoice("form", LocalizedText("表单（+ 号空格）", "Form (+ for spaces)")),
            ]), default: "component",
            help: LocalizedText(
                "encodeURIComponent 编码单个参数值；encodeURI 保留 ; / ? : @ & = + $ , # 等结构字符；表单把空格变成 +",
                "encodeURIComponent escapes a single value; encodeURI keeps ; / ? : @ & = + $ , # and other URL structure; form turns spaces into +"
            ),
            visibleWhen: ToolCondition("mode", in: ["encode", "decode"])),
            ToolField("perLine", LocalizedText("逐行处理", "Per line"), .toggle, default: "0",
                      help: LocalizedText("每行单独处理，换行不会被编码", "Each line is handled separately; line breaks are kept"),
                      visibleWhen: ToolCondition("mode", in: ["encode", "decode"])),
            ToolField("strict", LocalizedText("RFC 3986 严格", "Strict RFC 3986"), .toggle, default: "0",
                      help: LocalizedText("encodeURIComponent 额外编码 ! ' ( ) *", "encodeURIComponent also escapes ! ' ( ) *"),
                      visibleWhen: ToolCondition("mode", is: "encode")),
            ToolField("keepEscapes", LocalizedText("保留已有 %XX", "Keep existing %XX"), .toggle, default: "0",
                      help: LocalizedText("已经是 %XX 形式的转义不再二次编码", "Escapes already in %XX form are not encoded again"),
                      visibleWhen: ToolCondition("mode", is: "encode")),
        ],
        run: { input in try run(input) }
    )

    public enum Variant: String, Sendable { case component, uri, form }

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let variant = EncodeCryptoShared.choice(input, "variant", default: Variant.component)
        switch input.string("mode") {
        case "parse":
            return try parseResult(input.text, lang: lang)
        case "decode":
            let r = decode(input.text, variant: variant, perLine: input.bool("perLine"))
            let notes = EncodeCryptoShared.notes(r.issues, lang: lang, title: LocalizedText("以下内容无法解码，已原样保留", "These parts could not be decoded and were kept as is"))
            return ToolResult(outputs: [.primary(lang.t("解码结果", "Decoded"), r.output)], notes: notes)
        default:
            let out = encode(input.text, variant: variant, perLine: input.bool("perLine"), strict: input.bool("strict"), keepEscapes: input.bool("keepEscapes"))
            return ToolResult(outputs: [.primary(lang.t("编码结果", "Encoded"), out)])
        }
    }

    // MARK: 编码

    static let alnum = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    static func asciiSet(_ chars: String) -> [Bool] {
        var t = [Bool](repeating: false, count: 128)
        for c in chars.utf8 { t[Int(c)] = true }
        return t
    }
    static let componentSafe = asciiSet(alnum + "-_.!~*'()")
    static let strictSafe = asciiSet(alnum + "-_.~")
    static let uriSafe = asciiSet(alnum + "-_.!~*'();/?:@&=+$,#")
    static let formSafe = asciiSet(alnum + "*-._")
    static let uriReserved = asciiSet(";/?:@&=+$,#")
    static let querySafe = asciiSet(alnum + "-_.~!$'()*,;:@/?")
    static let hexDigits: [Character] = Array("0123456789ABCDEF")

    @inline(__always) static func isHex(_ s: Unicode.Scalar?) -> Bool {
        guard let v = s?.value else { return false }
        return (v >= 48 && v <= 57) || (v >= 65 && v <= 70) || (v >= 97 && v <= 102)
    }

    static func appendPercent(_ b: UInt8, to out: inout String) {
        out.append("%")
        out.append(hexDigits[Int(b >> 4)])
        out.append(hexDigits[Int(b & 15)])
    }

    /// 按行拆分处理（换行保持原样）
    static func perLines(_ text: String, _ enabled: Bool, _ fn: (Substring) -> String) -> String {
        guard enabled else { return fn(Substring(text)) }
        // 按标量拆分：Swift 把 \r\n 当成一个字符
        return text.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false).map { raw -> String in
            var line = raw
            if line.last == "\r" { line = line.dropLast() }
            return line.isEmpty ? "" : fn(Substring(EncodeCryptoShared.string(line)))
        }.joined(separator: "\n")
    }

    /// 百分号编码
    public static func encode(_ text: String, variant: Variant, perLine: Bool = false, strict: Bool = false, keepEscapes: Bool = false) -> String {
        let safe: [Bool]
        switch variant {
        case .component: safe = strict ? strictSafe : componentSafe
        case .uri: safe = uriSafe
        case .form: safe = formSafe
        }
        let form = variant == .form
        return perLines(text, perLine) { line in
            let s = Array(line.unicodeScalars)
            var out = ""
            out.reserveCapacity(s.count * 3)
            var i = 0
            while i < s.count {
                let c = s[i]
                if c.value < 128 {
                    if safe[Int(c.value)] {
                        out.unicodeScalars.append(c)
                    } else if form && c == " " {
                        out.append("+")
                    } else if c == "%" && keepEscapes && i + 2 < s.count && isHex(s[i + 1]) && isHex(s[i + 2]) {
                        out += "%" + String(s[i + 1]).uppercased() + String(s[i + 2]).uppercased()
                        i += 2
                    } else {
                        appendPercent(UInt8(c.value), to: &out)
                    }
                } else {
                    for b in String(c).utf8 { appendPercent(b, to: &out) }
                }
                i += 1
            }
            return out
        }
    }

    /// 编码查询参数的键或值：保留可读的安全字符，& = + # 与空格等必须编码
    public static func encodeQueryPart(_ s: String, spaceAsPlus: Bool = false) -> String {
        var out = ""
        for c in s.unicodeScalars {
            if c.value < 128 {
                if querySafe[Int(c.value)] { out.unicodeScalars.append(c) } else if c == " " && spaceAsPlus { out.append("+") } else { appendPercent(UInt8(c.value), to: &out) }
            } else {
                for b in String(c).utf8 { appendPercent(b, to: &out) }
            }
        }
        return out
    }

    // MARK: 解码

    /// 从 bytes[i] 开始的合法 UTF-8 序列：(长度, 码点)；不合法时长度为 0
    static func utf8Sequence(_ bytes: [UInt8], _ i: Int) -> (Int, UInt32) {
        let b = bytes[i]
        if b < 0x80 { return (1, UInt32(b)) }
        let need: Int, minimum: UInt32
        switch b {
        case 0xC2...0xDF: need = 1; minimum = 0x80
        case 0xE0...0xEF: need = 2; minimum = 0x800
        case 0xF0...0xF4: need = 3; minimum = 0x10000
        default: return (0, 0)
        }
        if i + need >= bytes.count { return (0, 0) }
        var cp = UInt32(b) & (0x3F >> UInt32(need))
        for k in 1...need {
            let c = bytes[i + k]
            if c & 0xC0 != 0x80 { return (0, 0) }
            cp = cp << 6 | UInt32(c & 63)
        }
        if cp < minimum || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF) { return (0, 0) }
        return (need + 1, cp)
    }

    struct DecodeResult {
        var output: String
        var issues: [CodecIssue]
    }

    /// 百分号解码（宽松）：残缺的 %、非法十六进制、不完整的 UTF-8 序列都原样保留，并给出精确位置
    static func decode(_ text: String, variant: Variant, perLine: Bool = false) -> DecodeResult {
        let all = Array(text.unicodeScalars)
        var collector = IssueCollector(all)
        let form = variant == .form
        let keepReserved = variant == .uri

        func run(_ s: ArraySlice<Unicode.Scalar>, base: Int) -> String {
            let s = Array(s)
            var out = ""
            out.reserveCapacity(s.count)
            var i = 0
            while i < s.count {
                let c = s[i]
                if c == "+" && form { out.append(" "); i += 1; continue }
                if c != "%" { out.unicodeScalars.append(c); i += 1; continue }
                if !(i + 2 < s.count && isHex(s[i + 1]) && isHex(s[i + 2])) {
                    let len = min(3, s.count - i)
                    var bad = ""
                    EncodeCryptoShared.append(s[i..<(i + len)], to: &bad.unicodeScalars)
                    collector.add(base + i, len, i + 1 >= s.count
                        ? LocalizedText("末尾有一个单独的 %，已原样保留", "A lone % at the end was kept as is")
                        : LocalizedText("“\(bad)” 不是合法的转义：% 后应为两位十六进制数字（如 %20），已原样保留",
                                        "“\(bad)” is not a valid escape: % must be followed by two hex digits (like %20); kept as is"))
                    out.append("%")
                    i += 1
                    continue
                }
                // 收集连续的 %XX 字节
                var bytes: [UInt8] = []
                var positions: [Int] = []
                while i + 2 < s.count, s[i] == "%", isHex(s[i + 1]), isHex(s[i + 2]) {
                    bytes.append(UInt8(HexCodec.nibble(s[i + 1].value)! << 4 | HexCodec.nibble(s[i + 2].value)!))
                    positions.append(i)
                    i += 3
                }
                let runEnd = i
                var k = 0
                while k < bytes.count {
                    let (n, cp) = utf8Sequence(bytes, k)
                    if n == 0 {
                        var end = k + 1
                        while end < bytes.count && bytes[end] & 0xC0 == 0x80 { end += 1 }
                        let from = positions[k]
                        let to = end < positions.count ? positions[end] : runEnd
                        var raw = ""
                        EncodeCryptoShared.append(s[from..<to], to: &raw.unicodeScalars)
                        collector.add(base + from, to - from, bytes[k] >= 0x80 && bytes[k] < 0xC0
                            ? LocalizedText("“\(raw)” 是孤立的 UTF-8 后续字节，已原样保留", "“\(raw)” is a stray UTF-8 continuation byte; kept as is")
                            : LocalizedText("“\(raw)” 不是完整或合法的 UTF-8 序列，已原样保留", "“\(raw)” is not a complete or valid UTF-8 sequence; kept as is"))
                        out += raw
                        k = end
                        continue
                    }
                    if n == 1 && keepReserved && uriReserved[Int(bytes[k])] {
                        EncodeCryptoShared.append(s[positions[k]..<(positions[k] + 3)], to: &out.unicodeScalars)
                    } else if let scalar = Unicode.Scalar(cp) {
                        out.unicodeScalars.append(scalar)
                    }
                    k += n
                }
            }
            return out
        }

        guard perLine else { return DecodeResult(output: run(all[...], base: 0), issues: collector.issues) }
        var lines: [String] = []
        var start = 0
        while start <= all.count {
            var end = start
            while end < all.count && all[end] != "\n" { end += 1 }
            var lineEnd = end
            if lineEnd > start && all[lineEnd - 1] == "\r" { lineEnd -= 1 }
            lines.append(lineEnd > start ? run(all[start..<lineEnd], base: start) : "")
            start = end + 1
        }
        return DecodeResult(output: lines.joined(separator: "\n"), issues: collector.issues)
    }

    /// 宽松的百分号解码：出错的部分保留原文
    public static func safeDecode(_ s: String, plusAsSpace: Bool = false) -> String {
        decode(s, variant: plusAsSpace ? .form : .component).output
    }

    // MARK: 解析

    public struct QueryParam: Sendable, Hashable {
        public var key: String
        public var value: String
        /// 是否带 =（`?flag` 与 `?flag=` 不同）
        public var hasValue: Bool
    }

    public struct URLParts: Sendable, Hashable {
        public var href = ""
        public var scheme = ""
        public var username = ""
        public var password = ""
        public var hostname = ""
        /// 国际化域名的 Unicode 形式（与 hostname 相同时为 nil）
        public var hostUnicode: String?
        public var port = ""
        /// 协议默认端口（端口省略时）
        public var defaultPort: String?
        public var pathname = ""
        public var search = ""
        public var hash = ""
        public var origin = ""
        public var params: [QueryParam] = []
        /// 没有协议，按 https:// 补全
        public var assumedScheme = false
        /// 相对地址：只有路径、查询与片段
        public var relative = false
    }

    struct ParseError: Error { var message: LocalizedText }

    static let defaultPorts = ["http": "80", "https": "443", "ws": "80", "wss": "443", "ftp": "21"]
    static let specialSchemes: Set<String> = ["http", "https", "ws", "wss", "ftp", "file"]

    /// 解析查询串（不含 ?）。+ 按表单规则视为空格
    public static func parseQuery(_ query: String) -> [QueryParam] {
        query.split(separator: "&").map { raw in
            if let eq = raw.firstIndex(of: "=") {
                return QueryParam(key: safeDecode(String(raw[..<eq]), plusAsSpace: true),
                                  value: safeDecode(String(raw[raw.index(after: eq)...]), plusAsSpace: true), hasValue: true)
            }
            return QueryParam(key: safeDecode(String(raw), plusAsSpace: true), value: "", hasValue: false)
        }
    }

    /// 按字符串拆出 查询 与 片段（保持原文）
    static func split(_ s: Substring) -> (base: Substring, query: Substring?, hash: Substring) {
        let hashIdx = s.firstIndex(of: "#")
        let beforeHash = hashIdx.map { s[..<$0] } ?? s
        let hash = hashIdx.map { s[$0...] } ?? ""
        if let q = beforeHash.firstIndex(of: "?") {
            return (beforeHash[..<q], beforeHash[beforeHash.index(after: q)...], hash)
        }
        return (beforeHash, nil, hash)
    }

    static func percentEncode(_ s: Substring, keep: (Unicode.Scalar) -> Bool) -> String {
        var out = ""
        for c in s.unicodeScalars {
            if c.value < 128 && keep(c) { out.unicodeScalars.append(c) } else if c.value < 128 { appendPercent(UInt8(c.value), to: &out) } else {
                for b in String(c).utf8 { appendPercent(b, to: &out) }
            }
        }
        return out
    }

    static func isC0OrSpace(_ c: Unicode.Scalar) -> Bool { c.value <= 0x20 || c.value == 0x7F }

    /// 去掉 . 与 .. 路径段
    static func removeDotSegments(_ path: String) -> String {
        var out: [Substring] = []
        let segments = path.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
        for (i, seg) in segments.enumerated() {
            let last = i == segments.count - 1
            let lower = seg.lowercased()
            if seg == ".." || lower == "%2e%2e" || lower == ".%2e" || lower == "%2e." {
                if !out.isEmpty { out.removeLast() }
                if last { out.append("") }
            } else if seg == "." || lower == "%2e" {
                if last { out.append("") }
            } else {
                out.append(seg)
            }
        }
        return "/" + out.joined(separator: "/")
    }

    /// 为常见错误给出原因
    static func diagnose(_ text: String) -> LocalizedText {
        let generic = LocalizedText("无法解析为 URL：请检查协议（如 https://）、主机名与端口是否正确",
                                    "Cannot parse this as a URL: check the scheme (like https://), host and port")
        let whitespace = LocalizedText("URL 中含有空白字符，请先删除或编码为 %20", "The URL contains whitespace; remove it or encode it as %20")
        if let r = text.range(of: "://") {
            let afterScheme = text[r.upperBound...]
            let auth = afterScheme.prefix { !"/?#".contains($0) }
            let hostPort = auth.split(separator: "@", omittingEmptySubsequences: false).last.map(String.init) ?? ""
            if hostPort.contains(where: \.isWhitespace) {
                return LocalizedText("主机名中不能含有空白字符，请检查是否多了空格或换行", "The host cannot contain whitespace; check for stray spaces or line breaks")
            }
            if auth.contains(where: \.isWhitespace) { return whitespace }
            if hostPort.hasPrefix("[") && !hostPort.contains("]") {
                return LocalizedText("IPv6 地址缺少右方括号“]”，应写成 [::1]:8080 这样的形式", "The IPv6 address is missing “]”; write it like [::1]:8080")
            }
            var host = hostPort
            if let colon = hostPort.hasPrefix("[") ? hostPort.range(of: "]:").map({ hostPort.index(before: $0.upperBound) }) : hostPort.lastIndex(of: ":") {
                let port = String(hostPort[hostPort.index(after: colon)...])
                if !port.isEmpty {
                    if !port.allSatisfy(\.isASCII) || !port.allSatisfy(\.isNumber) {
                        return LocalizedText("端口“\(port)”不是数字", "The port “\(port)” is not a number")
                    }
                    if port.count > 5 || (Int(port) ?? 0) > 65535 {
                        return LocalizedText("端口 \(port) 超出范围（0–65535）", "The port \(port) is out of range (0–65535)")
                    }
                }
                host = String(hostPort[..<colon])
            }
            if host.isEmpty && !text.lowercased().hasPrefix("file:") {
                return LocalizedText("缺少主机名：“//” 后面应是域名或 IP", "The host is missing: “//” should be followed by a domain or IP")
            }
            if let bad = host.first(where: { "<>^`{|}\\%\"".contains($0) }) {
                return LocalizedText("主机名中不能包含字符“\(bad)”", "The host cannot contain “\(bad)”")
            }
            if host.hasPrefix("[") && !(host.hasSuffix("]") && host.dropFirst().dropLast().allSatisfy { $0.isHexDigit || $0 == ":" || $0 == "." }) {
                return LocalizedText("IPv6 地址“\(host)”格式不正确", "The IPv6 address “\(host)” is malformed")
            }
        }
        if text.contains(where: \.isWhitespace) { return whitespace }
        return generic
    }

    /// 相对地址：/path、?query、#hash、./x、../x（不含 //host 形式）
    static func isRelative(_ t: String) -> Bool {
        if t.hasPrefix("/") { return !t.hasPrefix("//") }
        if t.hasPrefix("?") || t.hasPrefix("#") { return true }
        return t == "." || t == ".." || t.hasPrefix("./") || t.hasPrefix("../")
    }

    static func hasExplicitScheme(_ t: String) -> Bool {
        let s = Array(t.unicodeScalars)
        guard let first = s.first, EncodeCryptoShared.isASCIILetter(first) else { return false }
        var i = 1
        while i < s.count, EncodeCryptoShared.isASCIILetter(s[i]) || ("0"..."9").contains(s[i]) || s[i] == "+" || s[i] == "." || s[i] == "-" { i += 1 }
        guard i < s.count, s[i] == ":" else { return false }
        // “localhost:3000/x”、“example.com:8080” 这类主机:端口不算协议
        var j = i + 1
        while j < s.count, ("0"..."9").contains(s[j]) { j += 1 }
        let hostLike = s[0..<i].allSatisfy { EncodeCryptoShared.isASCIILetter($0) || ("0"..."9").contains($0) || $0 == "_" || $0 == "." || $0 == "-" }
        if hostLike && j > i + 1 && (j == s.count || "/?#".unicodeScalars.contains(s[j])) { return false }
        return true
    }

    /// 解析 URL；没有协议时按 https:// 补全
    public static func parse(_ input: String) throws -> URLParts {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { throw ParseError(message: LocalizedText("请输入 URL", "Enter a URL")) }
        if isRelative(text) {
            if text.contains(where: \.isWhitespace) {
                throw ParseError(message: LocalizedText("URL 中含有空白字符，请先删除或编码为 %20", "The URL contains whitespace; remove it or encode it as %20"))
            }
            let (base, query, hash) = split(Substring(text))
            var p = URLParts()
            p.relative = true
            p.href = text
            p.pathname = String(base)
            p.search = (query?.isEmpty ?? true) ? "" : "?" + query!
            p.hash = hash == "#" ? "" : String(hash)
            p.params = parseQuery(String(query ?? ""))
            return p
        }
        let explicit = hasExplicitScheme(text)
        let candidate = explicit ? text : "https://" + (text.hasPrefix("//") ? String(text.dropFirst(2)) : text)
        var p = URLParts()
        p.assumedScheme = !explicit
        guard let colon = candidate.firstIndex(of: ":") else { throw ParseError(message: diagnose(candidate)) }
        let scheme = candidate[..<colon].lowercased()
        p.scheme = scheme
        let special = specialSchemes.contains(scheme)
        var rest = candidate[candidate.index(after: colon)...]
        if special { rest = Substring(rest.replacingOccurrences(of: "\\", with: "/")) }
        let (beforeQuery, query, hash) = split(rest)
        p.params = parseQuery(String(query ?? ""))

        if beforeQuery.hasPrefix("//") {
            let afterSlashes = beforeQuery.dropFirst(2)
            let authority = afterSlashes.prefix { $0 != "/" }
            var path = String(afterSlashes.dropFirst(authority.count))
            var hostPort = Substring(authority)
            if let at = authority.lastIndex(of: "@") {
                let userinfo = authority[..<at]
                hostPort = authority[authority.index(after: at)...]
                if let c = userinfo.firstIndex(of: ":") {
                    p.username = String(userinfo[..<c])
                    p.password = String(userinfo[userinfo.index(after: c)...])
                } else {
                    p.username = String(userinfo)
                }
            }
            var host = hostPort
            var port = ""
            if hostPort.hasPrefix("[") {
                guard let close = hostPort.firstIndex(of: "]") else { throw ParseError(message: diagnose(candidate)) }
                host = hostPort[...close]
                let after = hostPort[hostPort.index(after: close)...]
                if after.hasPrefix(":") { port = String(after.dropFirst()) } else if !after.isEmpty { throw ParseError(message: diagnose(candidate)) }
            } else if let c = hostPort.lastIndex(of: ":") {
                host = hostPort[..<c]
                port = String(hostPort[hostPort.index(after: c)...])
            }
            if !port.isEmpty {
                guard port.allSatisfy({ $0.isASCII && $0.isNumber }), port.count <= 5, let n = Int(port), n <= 65535 else {
                    throw ParseError(message: diagnose(candidate))
                }
                port = String(n)
            }
            // 主机校验与规范化
            if host.contains(where: { $0.isWhitespace || "<>^`{|}\\%\"#?@".contains($0) }) { throw ParseError(message: diagnose(candidate)) }
            if host.hasPrefix("[") {
                let inner = host.dropFirst().dropLast()
                guard host.hasSuffix("]"), !inner.isEmpty, inner.allSatisfy({ $0.isHexDigit || $0 == ":" || $0 == "." }) else {
                    throw ParseError(message: diagnose(candidate))
                }
                p.hostname = host.lowercased()
            } else if special {
                if host.isEmpty && scheme != "file" { throw ParseError(message: diagnose(candidate)) }
                let decodedHost = safeDecode(String(host))
                guard let ascii = Punycode.domainToASCII(decodedHost) else { throw ParseError(message: diagnose(candidate)) }
                p.hostname = ascii
                let unicode = Punycode.domainToUnicode(ascii)
                if unicode != ascii { p.hostUnicode = unicode }
            } else {
                p.hostname = String(host)
            }
            if let def = defaultPorts[scheme] {
                if port == def { port = "" }
                if port.isEmpty { p.defaultPort = def }
            }
            p.port = port
            if special {
                if path.isEmpty { path = "/" }
                path = removeDotSegments(percentEncode(Substring(path)) { !isC0OrSpace($0) && !"\"#<>?`{}".unicodeScalars.contains($0) })
            } else {
                path = percentEncode(Substring(path)) { !isC0OrSpace($0) && !"\"#<>?`{}".unicodeScalars.contains($0) }
            }
            p.pathname = path
            let auth = p.username.isEmpty && p.password.isEmpty ? "" : p.username + (p.password.isEmpty ? "" : ":" + p.password) + "@"
            let hostAndPort = p.hostname + (p.port.isEmpty ? "" : ":" + p.port)
            p.origin = special && scheme != "file" ? "\(scheme)://\(hostAndPort)" : "null"
            p.href = "\(scheme)://" + auth + hostAndPort + path
        } else {
            if special {
                throw ParseError(message: diagnose(candidate))
            }
            // mailto:、urn: 等不透明路径
            p.pathname = percentEncode(beforeQuery) { $0.value >= 0x20 && $0.value != 0x7F }
            p.origin = "null"
            p.href = "\(scheme):" + p.pathname
        }
        if let q = query, !q.isEmpty {
            p.search = "?" + percentEncode(q) { !isC0OrSpace($0) && !"\"#<>".unicodeScalars.contains($0) && !(special && $0 == "'") }
        }
        if hash.count > 1 {
            p.hash = "#" + percentEncode(hash.dropFirst()) { !isC0OrSpace($0) && !"\"<>`".unicodeScalars.contains($0) }
        }
        p.href += p.search + p.hash
        return p
    }

    /// 解析结果 → 便于复制的 JSON（重复的键合并为数组）
    public static func json(_ u: URLParts) -> JSONValue {
        // 按首次出现的顺序分组，重复的键合并为数组
        var order: [String] = []
        var values: [String: [String]] = [:]
        for param in u.params {
            if values[param.key] == nil { order.append(param.key) }
            values[param.key, default: []].append(param.value)
        }
        let query = order.map { key -> JSONMember in
            let v = values[key] ?? []
            return JSONMember(key, v.count == 1 ? .string(v[0]) : .array(v.map { .string($0) }))
        }
        var m: [JSONMember] = [JSONMember("href", .string(u.href))]
        if !u.origin.isEmpty { m.append(JSONMember("origin", .string(u.origin))) }
        m += [
            JSONMember("protocol", .string(u.scheme.isEmpty ? "" : u.scheme + ":")),
            JSONMember("username", .string(u.username)),
            JSONMember("password", .string(u.password)),
            JSONMember("hostname", .string(u.hostname)),
        ]
        if let hu = u.hostUnicode { m.append(JSONMember("hostUnicode", .string(hu))) }
        m += [
            JSONMember("port", .string(u.port)),
            JSONMember("pathname", .string(u.pathname)),
            JSONMember("pathSegments", .array(u.pathname.split(separator: "/").map { .string(safeDecode(String($0))) })),
            JSONMember("search", .string(u.search)),
            JSONMember("hash", .string(u.hash)),
            JSONMember("query", .object(query)),
        ]
        return .object(m)
    }

    static func parseResult(_ text: String, lang: Lang) throws -> ToolResult {
        let u: URLParts
        do { u = try parse(text) } catch let e as ParseError { throw ToolError(e.message(lang)) }
        var outputs: [ToolOutput] = [.primary("JSON", JSON.print(json(u)), language: "json")]
        func row(_ id: String, _ zh: String, _ en: String, _ value: String) {
            outputs.append(ToolOutput(id: id, label: lang.t(zh, en), value: value))
        }
        if !u.relative {
            row("protocol", "协议", "Scheme", u.scheme + ":")
            row("host", "主机", "Host", u.hostname)
            if let hu = u.hostUnicode { row("hostUnicode", "主机（Unicode）", "Host (Unicode)", hu) }
            row("port", "端口", "Port", u.port.isEmpty ? (u.defaultPort.map { lang.t("省略，默认 \($0)", "omitted, default \($0)") } ?? "") : u.port)
            if !u.username.isEmpty { row("username", "用户名", "Username", safeDecode(u.username)) }
            if !u.password.isEmpty { row("password", "密码", "Password", safeDecode(u.password)) }
        }
        row("path", "路径", "Path", u.pathname)
        let decodedPath = safeDecode(u.pathname)
        if decodedPath != u.pathname { row("pathDecoded", "路径（解码）", "Path (decoded)", decodedPath) }
        row("search", "查询", "Query", u.search)
        row("hash", "片段", "Fragment", u.hash)
        let decodedHash = safeDecode(u.hash)
        if decodedHash != u.hash { row("hashDecoded", "片段（解码）", "Fragment (decoded)", decodedHash) }
        if !u.origin.isEmpty && u.origin != "null" { row("origin", "源（origin）", "Origin", u.origin) }

        var notes: [ToolNote] = []
        if u.assumedScheme { notes.append(ToolNote(.info, lang.t("没有写协议，已按 https:// 解析", "No scheme given; parsed as https://"))) }
        if u.relative { notes.append(ToolNote(.info, lang.t("这是相对地址，只有路径、查询与片段", "This is a relative URL with only a path, query and fragment"))) }
        if !u.params.isEmpty { notes.append(ToolNote(.info, lang.t("\(u.params.count) 个查询参数", "\(u.params.count) query parameters"))) }
        let table = u.params.isEmpty ? nil : ToolTable(
            columns: ["#", lang.t("参数名", "Key"), lang.t("值", "Value")],
            rows: u.params.enumerated().map { ["\($0.offset + 1)", $0.element.key, $0.element.hasValue ? $0.element.value : lang.t("（无值）", "(no value)")] }
        )
        return ToolResult(outputs: outputs, notes: notes, table: table)
    }
}

// MARK: - Punycode（RFC 3492）

public enum Punycode {
    static let base: UInt32 = 36, tMin: UInt32 = 1, tMax: UInt32 = 26, skew: UInt32 = 38, damp: UInt32 = 700

    static func adapt(_ delta: UInt32, _ numPoints: UInt32, _ first: Bool) -> UInt32 {
        var d = first ? delta / damp : delta / 2
        d += d / numPoints
        var k: UInt32 = 0
        while d > ((base - tMin) * tMax) / 2 {
            d /= base - tMin
            k += base
        }
        return k + (base - tMin + 1) * d / (d + skew)
    }

    static func digit(_ d: UInt32) -> Unicode.Scalar {
        Unicode.Scalar(d < 26 ? d + 97 : d - 26 + 48)!
    }

    /// Unicode 标签 → Punycode（不含 xn-- 前缀）；溢出时返回 nil
    public static func encode(_ label: String) -> String? {
        let input = label.unicodeScalars.map(\.value)
        var output = String.UnicodeScalarView()
        for c in input where c < 0x80 { output.append(Unicode.Scalar(c)!) }
        let b = UInt32(output.count)
        var h = b
        if b > 0 { output.append("-") }
        var n: UInt32 = 128, delta: UInt32 = 0, bias: UInt32 = 72
        while h < UInt32(input.count) {
            guard let m = input.filter({ $0 >= n }).min() else { break }
            let (mul, o1) = (m - n).multipliedReportingOverflow(by: h + 1)
            let (sum, o2) = delta.addingReportingOverflow(mul)
            if o1 || o2 { return nil }
            delta = sum
            n = m
            for c in input {
                if c < n {
                    let (d, o) = delta.addingReportingOverflow(1)
                    if o { return nil }
                    delta = d
                }
                if c == n {
                    var q = delta
                    var k = base
                    while true {
                        let t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
                        if q < t { break }
                        output.append(digit(t + (q - t) % (base - t)))
                        q = (q - t) / (base - t)
                        k += base
                    }
                    output.append(digit(q))
                    bias = adapt(delta, h + 1, h == b)
                    delta = 0
                    h += 1
                }
            }
            delta += 1
            n += 1
        }
        return String(output)
    }

    /// Punycode → Unicode 标签；格式错误返回 nil
    public static func decode(_ input: String) -> String? {
        let s = Array(input.unicodeScalars)
        var output: [UInt32] = []
        let basic = s.lastIndex(of: "-") ?? -1
        if basic > 0 {
            for c in s[0..<basic] {
                guard c.value < 0x80 else { return nil }
                output.append(c.value)
            }
        }
        var n: UInt32 = 128, i: UInt32 = 0, bias: UInt32 = 72
        var idx = basic > 0 ? basic + 1 : 0
        while idx < s.count {
            let oldi = i
            var w: UInt32 = 1
            var k = base
            while true {
                guard idx < s.count else { return nil }
                let c = s[idx].value
                idx += 1
                let d: UInt32 = c >= 48 && c <= 57 ? c - 22 : c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 97 : base
                guard d < base else { return nil }
                let (dw, o1) = d.multipliedReportingOverflow(by: w)
                let (ni, o2) = i.addingReportingOverflow(dw)
                if o1 || o2 { return nil }
                i = ni
                let t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
                if d < t { break }
                let (nw, o3) = w.multipliedReportingOverflow(by: base - t)
                if o3 { return nil }
                w = nw
                k += base
            }
            let count = UInt32(output.count + 1)
            bias = adapt(i - oldi, count, oldi == 0)
            n += i / count
            i %= count
            guard n <= 0x10FFFF else { return nil }
            output.insert(n, at: Int(i))
            i += 1
        }
        var out = String.UnicodeScalarView()
        for v in output {
            guard let scalar = Unicode.Scalar(v) else { return nil }
            out.append(scalar)
        }
        return String(out)
    }

    /// xn--fiqs8s.xn--fiqz9s → 中国.中國；无法解码的标签保持原样
    public static func domainToUnicode(_ host: String) -> String {
        host.split(separator: ".", omittingEmptySubsequences: false).map { label -> String in
            guard label.lowercased().hasPrefix("xn--") else { return String(label) }
            return decode(String(label.dropFirst(4))) ?? String(label)
        }.joined(separator: ".")
    }

    /// 例子.测试 → xn--fsqu00a.xn--0zwm56d（ASCII 部分转小写）
    public static func domainToASCII(_ host: String) -> String? {
        var labels: [String] = []
        for label in host.lowercased().split(separator: ".", omittingEmptySubsequences: false) {
            if label.unicodeScalars.allSatisfy({ $0.value < 0x80 }) {
                labels.append(String(label))
            } else {
                guard let p = encode(String(label)) else { return nil }
                labels.append("xn--" + p)
            }
        }
        return labels.joined(separator: ".")
    }
}
