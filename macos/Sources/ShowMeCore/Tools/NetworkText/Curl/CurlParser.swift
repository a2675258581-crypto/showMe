import Foundation

// cURL 命令解析（纯函数）：
// - bash / zsh 写法：单引号、双引号转义、$'…' ANSI-C 引号、反斜杠续行、注释、管道与重定向
// - Windows cmd 写法：^ 转义与 ^ 续行（含 Chrome DevTools「Copy as cURL (cmd)」）
// - 解析常用参数，输出结构化请求 + 未支持参数的双语提示

public struct CurlParseError: Error, Sendable, Hashable {
    public var message: LocalizedText
    /// 1 起始；无法定位时为 nil
    public var line: Int?
    public var column: Int?

    public func toolError(_ lang: Lang) -> ToolError {
        ToolError(message(lang), line: line, column: column)
    }
}

public struct CurlParseResult: Sendable, Hashable {
    public var request: CurlRequest
    public var warnings: [LocalizedText]
}

public enum Curl {
    public enum Dialect: Sendable { case bash, cmd }

    /// 粗略判断一段文本是不是 curl 命令（用于粘贴时自动导入）
    public static func looksLikeCurl(_ text: String) -> Bool {
        let s = Array(text.unicodeScalars)
        var i = 0
        while i < s.count, isSpace(s[i]) { i += 1 }
        if i < s.count, s[i] == "$" {
            var j = i + 1
            while j < s.count, isSpace(s[j]) { j += 1 }
            if j > i + 1 { i = j }
        }
        func lowerAt(_ k: Int) -> Unicode.Scalar? {
            guard k < s.count else { return nil }
            let v = s[k].value
            return (v >= 65 && v <= 90) ? Unicode.Scalar(v + 32) : s[k]
        }
        for (k, ch) in "curl".unicodeScalars.enumerated() where lowerAt(i + k) != ch { return false }
        i += 4
        if lowerAt(i) == ".", lowerAt(i + 1) == "e", lowerAt(i + 2) == "x", lowerAt(i + 3) == "e" { i += 4 }
        guard i < s.count else { return true }
        return isSpace(s[i]) || s[i] == "^" || s[i] == "\\"
    }

    /// Windows cmd 写法：出现 ^" 或行尾 ^ 续行
    public static func detectDialect(_ src: String) -> Dialect {
        src.contains("^\"") || src.contains("^\n") || src.contains("^\r\n") ? .cmd : .bash
    }

    /// curl 的 URL 编码：只保留 A-Z a-z 0-9 - . _ ~
    public static func curlEscape(_ s: String) -> String {
        percentEncode(s) { isUnreserved($0) }
    }

    /// 往 URL 追加查询串（插在 # 之前）
    public static func appendQuery(_ url: String, _ query: String) -> String {
        if query.isEmpty { return url }
        let base: Substring
        let frag: Substring
        if let hash = url.firstIndex(of: "#") {
            base = url[..<hash]
            frag = url[hash...]
        } else {
            base = url[...]
            frag = ""
        }
        let sep = !base.contains("?") ? "?" : (base.hasSuffix("?") || base.hasSuffix("&")) ? "" : "&"
        return base + sep + query + frag
    }

    /// 分词（不做变量展开和通配）；dialect 为 nil 时自动判断
    public static func tokenize(_ src: String, dialect: Dialect? = nil) throws -> [String] {
        let scalars = Array(src.unicodeScalars)
        do {
            return try (dialect ?? detectDialect(src)) == .cmd ? tokenizeCmd(scalars).tokens : tokenizeBash(scalars).tokens
        } catch let e as ShellSyntaxError {
            throw positioned(e, scalars)
        }
    }

    // MARK: - 解析

    public static func parse(_ input: String) throws -> CurlParseResult {
        var src = input
        if src.hasPrefix("\u{FEFF}") { src.removeFirst() }
        if src.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw CurlParseError(message: LocalizedText("请输入 curl 命令", "Enter a curl command"))
        }
        let scalars = Array(src.unicodeScalars)
        var state = ParseState()
        let tokens: [String]
        do {
            let r = detectDialect(src) == .cmd ? try tokenizeCmd(scalars) : try tokenizeBash(scalars)
            tokens = r.tokens
            state.warnings.append(contentsOf: r.notes)
        } catch let e as ShellSyntaxError {
            throw positioned(e, scalars)
        }

        guard let start = tokens.firstIndex(where: { isCurlToken(CurlRequest.pathBase($0)) }) else {
            throw CurlParseError(message: LocalizedText(
                "没有找到 curl 命令：请以「curl」开头，例如 curl https://example.com",
                "No curl command found. Start with “curl”, e.g. curl https://example.com"
            ))
        }

        var stopFlags = false
        var i = start + 1
        while i < tokens.count {
            let t = tokens[i]
            if !stopFlags, isCurlToken(t) {
                state.warn("检测到多条 curl 命令，只解析了第一条", "Found several curl commands; only the first one was parsed")
                break
            }
            let prevUnknown = state.lastUnknown
            state.lastUnknown = false
            if stopFlags || t == "-" || !t.hasPrefix("-") {
                state.urls.append((t, prevUnknown && !stopFlags))
                i += 1
                continue
            }
            if t == "--" {
                stopFlags = true
                i += 1
                continue
            }
            func takeNext(_ display: String) -> String? {
                if i + 1 >= tokens.count {
                    state.warn("参数 \(display) 缺少取值", "Option \(display) is missing a value")
                    return nil
                }
                i += 1
                return tokens[i]
            }
            if t.hasPrefix("--") {
                var name = String(t.dropFirst(2))
                var inline: String?
                if let eq = name.firstIndex(of: "="), eq != name.startIndex, withArg.contains(String(name[..<eq])) {
                    inline = String(name[name.index(after: eq)...])
                    name = String(name[..<eq])
                }
                if withArg.contains(name) {
                    if let v = inline ?? takeNext(t) { state.apply(name, v, "--\(name)") }
                } else if name.hasPrefix("no-"), !silent.contains(name), name != "no-location" {
                    // --no-xxx 关闭布尔参数
                    let base = name.dropFirst(3)
                    if base == "insecure" { state.insecure = false } else if base == "compressed" { state.compressed = false }
                } else {
                    state.apply(name, nil, t)
                }
                i += 1
                continue
            }
            // 短参数，可合写：-sSL、-XPOST、-H'X: 1'
            let chars = Array(t.unicodeScalars)
            var k = 1
            while k < chars.count {
                let ch = String(chars[k])
                guard let name = short[ch] else {
                    state.unknown("-\(ch)")
                    k += 1
                    continue
                }
                if withArg.contains(name) {
                    let rest = String(String.UnicodeScalarView(chars[(k + 1)...]))
                    if let v = rest.isEmpty ? takeNext("-\(ch)") : rest { state.apply(name, v, "-\(ch)") }
                    break
                }
                state.apply(name, nil, "-\(ch)")
                k += 1
            }
            i += 1
        }
        return try state.finish()
    }

    // MARK: - 内部

    struct ShellSyntaxError: Error {
        var message: LocalizedText
        var index: Int
    }

    static func positioned(_ e: ShellSyntaxError, _ src: [Unicode.Scalar]) -> CurlParseError {
        var line = 1
        var col = 1
        var k = 0
        while k < e.index, k < src.count {
            if src[k] == "\n" {
                line += 1
                col = 1
            } else {
                col += 1
            }
            k += 1
        }
        let msg = LocalizedText(
            "\(e.message.zh)（第 \(line) 行第 \(col) 列）",
            "\(e.message.en) (line \(line), column \(col))"
        )
        return CurlParseError(message: msg, line: line, column: col)
    }

    static func isCurlToken(_ t: String) -> Bool {
        let l = t.lowercased()
        return l == "curl" || l == "curl.exe"
    }

    static let whitespace: Set<Unicode.Scalar> = [" ", "\t", "\n", "\r", "\u{0C}", "\u{0B}"]

    static func isSpace(_ c: Unicode.Scalar) -> Bool { whitespace.contains(c) }

    static func isDigit(_ c: Unicode.Scalar) -> Bool { c.value >= 48 && c.value <= 57 }

    static func isUnreserved(_ c: Unicode.Scalar) -> Bool {
        let v = c.value
        return (v >= 0x41 && v <= 0x5A) || (v >= 0x61 && v <= 0x7A) || (v >= 0x30 && v <= 0x39)
            || c == "-" || c == "." || c == "_" || c == "~"
    }

    /// 把不满足 keep 的字符按 UTF-8 百分号编码（大写十六进制）
    static func percentEncode(_ s: String, keep: (Unicode.Scalar) -> Bool) -> String {
        var out = ""
        out.reserveCapacity(s.utf8.count)
        for c in s.unicodeScalars {
            if keep(c) {
                out.unicodeScalars.append(c)
            } else {
                for b in String(c).utf8 { out += "%" + hex2(b) }
            }
        }
        return out
    }

    static func hex2(_ b: UInt8) -> String {
        let digits = Array("0123456789ABCDEF".unicodeScalars)
        return String(String.UnicodeScalarView([digits[Int(b >> 4)], digits[Int(b & 15)]]))
    }

    // MARK: 分词

    static func tokenizeBash(_ src: [Unicode.Scalar]) throws -> (tokens: [String], notes: [LocalizedText]) {
        var tokens: [String] = []
        var notes: [LocalizedText] = []
        var cur = String.UnicodeScalarView()
        var inToken = false
        var i = 0
        let n = src.count
        func at(_ k: Int) -> Unicode.Scalar? { k < n ? src[k] : nil }
        func push() {
            if inToken { tokens.append(String(cur)) }
            cur = String.UnicodeScalarView()
            inToken = false
        }

        scan: while i < n {
            let c = src[i]

            if c == "\\" {
                let next = at(i + 1)
                if next == "\n" {
                    i += 2
                } else if next == "\r", at(i + 2) == "\n" {
                    i += 3
                } else if let next {
                    cur.append(next)
                    inToken = true
                    i += 2
                } else {
                    i += 1
                }
                continue
            }

            if isSpace(c) {
                push()
                i += 1
                continue
            }

            // PowerShell 的反引号续行
            if c == "`", at(i + 1) == "\n" || (at(i + 1) == "\r" && at(i + 2) == "\n") {
                push()
                i += at(i + 1) == "\r" ? 3 : 2
                continue
            }

            if c == "'" {
                var end = i + 1
                while end < n, src[end] != "'" { end += 1 }
                if end >= n { throw ShellSyntaxError(message: LocalizedText("单引号没有闭合", "Unclosed single quote"), index: i) }
                cur.append(contentsOf: src[(i + 1)..<end])
                inToken = true
                i = end + 1
                continue
            }

            if c == "$", at(i + 1) == "'" {
                let r = try readAnsiC(src, i + 2)
                cur.append(contentsOf: r.value.unicodeScalars)
                inToken = true
                i = r.end
                continue
            }

            if c == "\"" || (c == "$" && at(i + 1) == "\"") {
                let start = c == "$" ? i + 1 : i
                var j = start + 1
                while true {
                    guard j < n else {
                        throw ShellSyntaxError(message: LocalizedText("双引号没有闭合", "Unclosed double quote"), index: start)
                    }
                    let d = src[j]
                    if d == "\"" { break }
                    if d == "\\" {
                        let e = at(j + 1)
                        if e == "\n" {
                            j += 2
                            continue
                        }
                        if e == "\r", at(j + 2) == "\n" {
                            j += 3
                            continue
                        }
                        if let e, e == "\"" || e == "\\" || e == "$" || e == "`" {
                            cur.append(e)
                            j += 2
                            continue
                        }
                        cur.append("\\")
                        j += 1
                        continue
                    }
                    cur.append(d)
                    j += 1
                }
                inToken = true
                i = j + 1
                continue
            }

            if c == "#", !inToken {
                while i < n, src[i] != "\n" { i += 1 }
                continue
            }

            if c == "|" || c == ";" || (c == "&" && (at(i + 1) == "&" || at(i + 1).map(isSpace) ?? true)) {
                push()
                var a = i
                var b = n
                while a < b, isSpace(src[a]) { a += 1 }
                while b > a, isSpace(src[b - 1]) { b -= 1 }
                if b - a > 1 || c != "&" {
                    notes.append(LocalizedText("已忽略管道 / 分号之后的内容", "Ignored everything after a pipe or semicolon"))
                }
                break scan
            }

            if c == ">" || c == "<" {
                // 重定向：2>&1、> out.json、< in.txt —— 连同目标一起丢弃
                if inToken, !cur.isEmpty, cur.allSatisfy(isDigit) {
                    cur = String.UnicodeScalarView()
                    inToken = false
                } else {
                    push()
                }
                i += 1
                if let d = at(i), d == ">" || d == "&" { i += 1 }
                if src[i - 1] == "&" {
                    while i < n, isDigit(src[i]) || src[i] == "-" { i += 1 }
                } else {
                    while i < n, src[i] == " " || src[i] == "\t" { i += 1 }
                    i = skipWord(src, i)
                }
                notes.append(LocalizedText("已忽略输出重定向", "Ignored output redirection"))
                continue
            }

            cur.append(c)
            inToken = true
            i += 1
        }
        push()
        return (tokens, notes)
    }

    /// 跳过一个 shell 单词（重定向目标），返回结束位置
    static func skipWord(_ src: [Unicode.Scalar], _ start: Int) -> Int {
        let n = src.count
        var i = start
        while i < n, !isSpace(src[i]) {
            let c = src[i]
            if c == "'" {
                var end = i + 1
                while end < n, src[end] != "'" { end += 1 }
                i = end + 1
            } else if c == "\"" {
                var j = i + 1
                while j < n, src[j] != "\"" { j += src[j] == "\\" ? 2 : 1 }
                i = j + 1
            } else if c == "\\" {
                i += 2
            } else {
                i += 1
            }
        }
        return min(i, n)
    }

    /// $'…' ANSI-C 引号，start 指向引号后的第一个字符
    static func readAnsiC(_ src: [Unicode.Scalar], _ start: Int) throws -> (value: String, end: Int) {
        var out = String.UnicodeScalarView()
        var bytes: [UInt8] = []
        func flush() {
            if !bytes.isEmpty {
                out.append(contentsOf: String(decoding: bytes, as: UTF8.self).unicodeScalars)
                bytes = []
            }
        }
        func hexValue(_ c: Unicode.Scalar) -> UInt32? {
            switch c.value {
            case 48...57: return c.value - 48
            case 65...70: return c.value - 55
            case 97...102: return c.value - 87
            default: return nil
            }
        }
        let simple: [Unicode.Scalar: Unicode.Scalar] = [
            "a": "\u{07}", "b": "\u{08}", "e": "\u{1B}", "E": "\u{1B}", "f": "\u{0C}", "n": "\n",
            "r": "\r", "t": "\t", "v": "\u{0B}", "\\": "\\", "'": "'", "\"": "\"", "?": "?",
        ]
        let n = src.count
        var i = start
        while true {
            guard i < n else {
                throw ShellSyntaxError(message: LocalizedText("$'…' 引号没有闭合", "Unclosed $'…' quote"), index: max(0, start - 2))
            }
            let c = src[i]
            if c == "'" { break }
            if c != "\\" {
                flush()
                out.append(c)
                i += 1
                continue
            }
            let e: Unicode.Scalar? = i + 1 < n ? src[i + 1] : nil
            i += 2
            guard let e else {
                flush()
                out.append("\\")
                continue
            }
            if let s = simple[e] {
                flush()
                out.append(s)
                continue
            }
            if e == "x" {
                var v: UInt32 = 0
                var len = 0
                while len < 2, i + len < n, let h = hexValue(src[i + len]) {
                    v = v * 16 + h
                    len += 1
                }
                if len > 0 {
                    bytes.append(UInt8(v))
                    i += len
                } else {
                    flush()
                    out.append(contentsOf: "\\x".unicodeScalars)
                }
                continue
            }
            if e.value >= 48, e.value <= 55 {
                // 八进制：最多 3 位（含 e 本身）
                var v: UInt32 = e.value - 48
                var len = 1
                while len < 3, i - 1 + len < n, src[i - 1 + len].value >= 48, src[i - 1 + len].value <= 55 {
                    v = v * 8 + (src[i - 1 + len].value - 48)
                    len += 1
                }
                bytes.append(UInt8(v & 0xFF))
                i += len - 1
                continue
            }
            if e == "u" || e == "U" {
                let maxLen = e == "u" ? 4 : 8
                var v: UInt32 = 0
                var len = 0
                while len < maxLen, i + len < n, let h = hexValue(src[i + len]) {
                    v = v &* 16 &+ h
                    len += 1
                }
                flush()
                if len > 0 {
                    out.append(Unicode.Scalar(v) ?? "\u{FFFD}")
                    i += len
                } else {
                    out.append("\\")
                    out.append(e)
                }
                continue
            }
            if e == "c", i < n {
                flush()
                var v = src[i].value
                if v >= 97, v <= 122 { v -= 32 }
                out.append(Unicode.Scalar(v & 0x1F) ?? "\u{0}")
                i += 1
                continue
            }
            flush()
            out.append("\\")
            out.append(e)
        }
        flush()
        return (String(out), i + 1)
    }

    /// Windows cmd 分词：
    ///  1. cmd.exe 层：^X → X；行尾 ^ 续行（换行后的首个字符按字面保留，所以 ^\n\n 表示换行本身）
    ///  2. 参数层（MS CRT 规则）："…" 包裹，\" 为字面引号
    static func tokenizeCmd(_ src: [Unicode.Scalar]) throws -> (tokens: [String], notes: [LocalizedText]) {
        let n = src.count
        var chrome = false
        if n > 1 {
            for k in 0..<(n - 1) where src[k] == "^" && src[k + 1] == "\"" {
                chrome = true
                break
            }
        }
        func at(_ k: Int) -> Unicode.Scalar? { k < n ? src[k] : nil }
        // 第一层：去掉插入符
        var s: [Unicode.Scalar] = []
        s.reserveCapacity(n)
        var inQ = false
        var i = 0
        while i < n {
            let c = src[i]
            if c == "\"" {
                inQ.toggle()
                s.append(c)
                i += 1
                continue
            }
            if c == "^", !inQ {
                var j = i + 1
                if at(j) == "\r", at(j + 1) == "\n" { j += 1 }
                if at(j) == "\n" {
                    // 续行：换行后的首个字符按字面处理
                    j += 1
                    if at(j) == "\r", at(j + 1) == "\n" { j += 1 }
                    if j < n { s.append(src[j] == "\r" ? "\n" : src[j]) }
                } else if j < n {
                    s.append(src[j])
                }
                i = j + 1
                continue
            }
            s.append(c)
            i += 1
        }

        // 第二层：MS CRT 参数切分
        var tokens: [String] = []
        var cur = String.UnicodeScalarView()
        var inToken = false
        var quoted = false
        var quoteStart = 0
        let m = s.count
        i = 0
        while i < m {
            let c = s[i]
            if c == "\\" {
                var k = 0
                while i + k < m, s[i + k] == "\\" { k += 1 }
                if i + k < m, s[i + k] == "\"" {
                    cur.append(contentsOf: repeatElement(Unicode.Scalar("\\"), count: k / 2))
                    if k % 2 == 1 {
                        cur.append("\"")
                        i += k + 1
                    } else {
                        i += k
                    }
                    inToken = true
                    continue
                }
                // Chrome 会把所有反斜杠加倍，这里还原
                cur.append(contentsOf: repeatElement(Unicode.Scalar("\\"), count: chrome ? (k + 1) / 2 : k))
                inToken = true
                i += k
                continue
            }
            if c == "\"" {
                if !quoted { quoteStart = i }
                quoted.toggle()
                inToken = true
                i += 1
                continue
            }
            if !quoted, isSpace(c) {
                if inToken { tokens.append(String(cur)) }
                cur = String.UnicodeScalarView()
                inToken = false
                i += 1
                continue
            }
            cur.append(c)
            inToken = true
            i += 1
        }
        if quoted {
            throw ShellSyntaxError(message: LocalizedText("双引号没有闭合", "Unclosed double quote"), index: min(quoteStart, max(0, n - 1)))
        }
        if inToken { tokens.append(String(cur)) }
        return (tokens, [])
    }

    // MARK: 参数表

    static let short: [String: String] = [
        "X": "request", "H": "header", "d": "data", "F": "form", "u": "user", "b": "cookie",
        "A": "user-agent", "e": "referer", "G": "get", "I": "head", "L": "location", "k": "insecure",
        "m": "max-time", "T": "upload-file", "r": "range", "x": "proxy", "o": "output", "O": "remote-name",
        "s": "silent", "S": "show-error", "v": "verbose", "i": "include", "f": "fail", "c": "cookie-jar",
        "D": "dump-header", "w": "write-out", "K": "config", "E": "cert", "C": "continue-at", "U": "proxy-user",
        "z": "time-cond", "Y": "speed-limit", "y": "speed-time", "P": "ftp-port", "Q": "quote", "t": "telnet-option",
        "0": "http1.0", "1": "tlsv1", "2": "sslv2", "3": "sslv3", "4": "ipv4", "6": "ipv6", "a": "append",
        "B": "use-ascii", "g": "globoff", "h": "help", "j": "junk-session-cookies", "J": "remote-header-name",
        "l": "list-only", "M": "manual", "n": "netrc", "N": "no-buffer", "p": "proxytunnel", "q": "disable",
        "R": "remote-time", "V": "version", "Z": "parallel", "#": "progress-bar",
    ]

    /// 需要取值的长参数
    static let withArg: Set<String> = [
        "request", "header", "data", "data-ascii", "data-binary", "data-raw", "data-urlencode", "json", "form",
        "form-string", "user", "cookie", "user-agent", "referer", "max-time", "connect-timeout", "upload-file",
        "range", "proxy", "output", "cookie-jar", "dump-header", "write-out", "config", "cert", "cert-type", "key",
        "key-type", "pass", "cacert", "capath", "ciphers", "continue-at", "proxy-user", "time-cond", "speed-limit",
        "speed-time", "ftp-port", "quote", "telnet-option", "url", "url-query", "oauth2-bearer", "max-redirs",
        "resolve", "connect-to", "interface", "limit-rate", "max-filesize", "retry", "retry-delay", "retry-max-time",
        "expect100-timeout", "keepalive-time", "local-port", "noproxy", "output-dir", "proto", "proto-default",
        "proto-redir", "proxy-header", "preproxy", "socks4", "socks4a", "socks5", "socks5-hostname", "unix-socket",
        "abstract-unix-socket", "aws-sigv4", "variable", "stderr", "trace", "trace-ascii", "trace-config",
        "netrc-file", "dns-servers", "doh-url", "alt-svc", "hsts", "etag-save", "etag-compare", "libcurl", "rate",
        "request-target", "service-name", "sasl-authzid", "login-options", "mail-from", "mail-rcpt", "mail-auth",
        "tls-max", "tls13-ciphers", "pinnedpubkey", "crlfile", "happy-eyeballs-timeout-ms", "ip-tos",
        "parallel-max", "create-file-mode", "ech", "curves", "krb", "delegation", "engine", "egd-file",
        "random-file", "hostpubmd5", "hostpubsha256", "pubkey", "tftp-blksize", "ftp-account",
        "ftp-alternative-to-user", "ftp-method", "ftp-ssl-ccc-mode", "socks5-gssapi-service", "tlsauthtype",
        "tlsuser", "tlspassword", "dns-interface", "dns-ipv4-addr", "dns-ipv6-addr",
    ]

    /// 对生成请求没有影响、静默忽略的参数
    static let silent: Set<String> = [
        "silent", "show-error", "verbose", "include", "fail", "fail-with-body", "fail-early", "output",
        "remote-name", "remote-name-all", "remote-header-name", "write-out", "dump-header", "cookie-jar",
        "progress-bar", "no-progress-meter", "globoff", "no-buffer", "http1.0", "http1.1", "http2",
        "http2-prior-knowledge", "http3", "http3-only", "ipv4", "ipv6", "tlsv1", "tlsv1.0", "tlsv1.1", "tlsv1.2",
        "tlsv1.3", "sslv2", "sslv3", "max-redirs", "connect-timeout", "retry", "retry-delay", "retry-max-time",
        "retry-connrefused", "retry-all-errors", "path-as-is", "raw", "tr-encoding", "stderr", "trace",
        "trace-ascii", "trace-time", "trace-ids", "trace-config", "keepalive-time", "no-keepalive", "tcp-nodelay",
        "tcp-fastopen", "styled-output", "no-styled-output", "disable", "create-dirs", "output-dir", "remote-time",
        "ssl-no-revoke", "ssl-revoke-best-effort", "no-alpn", "no-npn", "no-sessionid", "parallel",
        "parallel-immediate", "parallel-max", "libcurl", "expect100-timeout", "happy-eyeballs-timeout-ms",
        "location-trusted", "post301", "post302", "post303", "junk-session-cookies", "xattr", "skip-existing",
        "clobber", "no-clobber",
    ]

    // MARK: 参数取值

    struct DataPart {
        var text: String
        /// --json 片段直接拼接，其它用 & 连接
        var json = false
        /// 来自 @file 的整个请求体
        var file: String?
    }

    struct ParseState {
        var warnings: [LocalizedText] = []
        /// URL 候选；afterUnknown：紧跟在不认识的参数后面，可能其实是那个参数的取值
        var urls: [(value: String, afterUnknown: Bool)] = []
        var lastUnknown = false
        var headers: [HTTPHeader] = []
        var removed = Set<String>()
        var data: [DataPart] = []
        var query: [String] = []
        var form: [CurlFormPart] = []
        var method: String?
        var head = false
        var get = false
        var json = false
        var uploadFile: String?
        var auth: CurlBasicAuth?
        var cookieIdx = -1
        var followRedirects: Bool?
        var insecure = false
        var compressed = false
        var timeout: Double?
        var unsupported = Set<String>()

        mutating func warn(_ zh: String, _ en: String) {
            warnings.append(LocalizedText(zh, en))
        }

        mutating func unknown(_ display: String) {
            lastUnknown = true
            if unsupported.insert(display).inserted {
                warn("不支持的参数 \(display)，已忽略", "Unsupported option \(display); ignored")
            }
        }

        func headerIndex(_ name: String) -> Int? {
            let lower = name.lowercased()
            return headers.firstIndex { $0.name.lowercased() == lower }
        }

        mutating func setHeader(_ name: String, _ value: String) {
            if let idx = headerIndex(name) {
                headers[idx].value = value
            } else {
                headers.append(HTTPHeader(name, value))
            }
        }

        mutating func apply(_ name: String, _ value: String?, _ display: String) {
            let v = value ?? ""
            switch name {
            case "request":
                method = v.uppercased()
            case "header":
                applyHeader(v, display)
            case "data", "data-ascii", "data-binary", "json":
                if name == "json" { json = true }
                if v.hasPrefix("@") {
                    let path = String(v.dropFirst())
                    if path == "-" {
                        warn("\(display) @- 表示从标准输入读取，已用空内容代替", "\(display) @- reads from stdin; an empty body is used instead")
                    } else if name != "data-binary", name != "json" {
                        warn("\(display) @\(path) 会读取文件并去掉换行，这里按原文件上传", "\(display) @\(path) reads the file and strips newlines; it is uploaded as-is here")
                    }
                    data.append(DataPart(text: "", json: name == "json", file: path == "-" || path.isEmpty ? nil : path))
                } else {
                    data.append(DataPart(text: v, json: name == "json"))
                }
            case "data-raw":
                data.append(DataPart(text: v))
            case "data-urlencode":
                data.append(DataPart(text: encodeDataArg(v)))
            case "url-query":
                query.append(v.hasPrefix("+") ? String(v.dropFirst()) : encodeDataArg(v))
            case "form", "form-string":
                if let p = parseFormArg(v, literal: name == "form-string") { form.append(p) }
            case "user":
                if let c = v.firstIndex(of: ":") {
                    auth = CurlBasicAuth(username: String(v[..<c]), password: String(v[v.index(after: c)...]))
                } else {
                    warn("\(display) 只提供了用户名，密码按空处理（curl 会交互式询问）", "\(display) only gives a user name; the password is treated as empty (curl would prompt for it)")
                    auth = CurlBasicAuth(username: v, password: "")
                }
            case "cookie":
                if !v.contains("=") {
                    warn("\(display) 「\(v)」是 Cookie 文件，无法读取，已忽略", "\(display) “\(v)” is a cookie file and can't be read; ignored")
                } else if cookieIdx >= 0, cookieIdx < headers.count {
                    headers[cookieIdx].value += "; " + v
                } else {
                    headers.append(HTTPHeader("Cookie", v))
                    cookieIdx = headers.count - 1
                }
            case "user-agent":
                if v.isEmpty { removed.insert("user-agent") } else { setHeader("User-Agent", v) }
            case "referer":
                let r = v.hasSuffix(";auto") ? String(v.dropLast(5)) : v
                if !r.isEmpty { setHeader("Referer", r) }
            case "oauth2-bearer":
                setHeader("Authorization", "Bearer \(v)")
            case "range":
                setHeader("Range", "bytes=\(v)")
            case "get":
                get = true
            case "head":
                head = true
            case "location", "location-trusted":
                followRedirects = true
            case "no-location":
                followRedirects = nil
            case "insecure":
                insecure = true
            case "compressed":
                compressed = true
            case "max-time":
                if let t = Double(v.trimmingCharacters(in: .whitespacesAndNewlines)), t.isFinite, t > 0 {
                    timeout = t
                } else {
                    warn("\(display) 的值「\(v)」不是有效的秒数，已忽略", "\(display) value “\(v)” is not a valid number of seconds; ignored")
                }
            case "upload-file":
                uploadFile = v
            case "url":
                urls.append((v, false))
            case "next":
                warn("--next 之后的请求没有解析", "Requests after --next were not parsed")
            case "basic":
                break
            case "digest", "ntlm", "negotiate", "anyauth", "ntlm-wb":
                warn("\(display) 认证方式不受支持，已按 Basic 认证处理", "\(display) authentication isn't supported; treated as Basic auth")
            default:
                if silent.contains(name) { return }
                unknown(display)
            }
        }

        mutating func applyHeader(_ v: String, _ display: String) {
            if v.hasPrefix("@") {
                warn("\(display) 从文件「\(v.dropFirst())」读取请求头，已忽略", "\(display) reads headers from the file “\(v.dropFirst())”; ignored")
                return
            }
            let colon = v.firstIndex(of: ":")
            let semi = v.firstIndex(of: ";")
            if let colon, colon != v.startIndex, semi.map({ colon < $0 }) ?? true {
                let hn = v[..<colon].trimmingCharacters(in: .whitespacesAndNewlines)
                let hv = v[v.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
                if hv.isEmpty {
                    // -H 'Accept:' 表示去掉 curl 默认头
                    let lower = hn.lowercased()
                    removed.insert(lower)
                    headers.removeAll { $0.name.lowercased() == lower }
                    if cookieIdx >= headers.count { cookieIdx = -1 }
                    return
                }
                headers.append(HTTPHeader(hn, hv))
                return
            }
            if let semi, semi != v.startIndex, v[v.index(after: semi)...].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                headers.append(HTTPHeader(v[..<semi].trimmingCharacters(in: .whitespacesAndNewlines), ""))
                return
            }
            warn("请求头格式不正确：「\(v)」，应为「名称: 值」", "Malformed header “\(v)”; expected “Name: value”")
        }

        /// --data-urlencode / --url-query 的取值规则
        mutating func encodeDataArg(_ v: String) -> String {
            guard let m = v.firstIndex(where: { $0 == "=" || $0 == "@" }) else { return curlEscape(v) }
            let name = String(v[..<m])
            let rest = String(v[v.index(after: m)...])
            let prefix = name.isEmpty ? "" : name + "="
            if v[m] == "=" { return prefix + curlEscape(rest) }
            warn("--data-urlencode 需要读取本地文件「\(rest)」，已用占位符代替", "--data-urlencode reads the local file “\(rest)”; replaced with a placeholder")
            return prefix + "{{file:\(rest)}}"
        }

        /// 解析 -F 的值：name=value / name=@file;type=…;filename=… / name=<file
        mutating func parseFormArg(_ v: String, literal: Bool) -> CurlFormPart? {
            guard let eq = v.firstIndex(of: "=") else {
                warn("-F 参数「\(v)」缺少「=」，已忽略", "-F value “\(v)” has no “=”; ignored")
                return nil
            }
            let name = String(v[..<eq])
            let content = String(v[v.index(after: eq)...])
            if literal { return CurlFormPart(name: name, value: content) }
            if content.hasPrefix("@") {
                let (head, params) = splitFormParams(String(content.dropFirst()))
                return CurlFormPart(name: name, value: head, kind: .file, filename: params["filename"], contentType: params["type"].flatMap { $0.isEmpty ? nil : $0 })
            }
            if content.hasPrefix("<") {
                let (head, params) = splitFormParams(String(content.dropFirst()))
                warn("表单字段「\(name)」的内容来自本地文件「\(head)」，已用占位符代替", "Form field “\(name)” reads the local file “\(head)”; replaced with a placeholder")
                return CurlFormPart(name: name, value: "{{file:\(head)}}", contentType: params["type"].flatMap { $0.isEmpty ? nil : $0 })
            }
            let (head, params) = splitFormParams(content)
            return CurlFormPart(name: name, value: head, contentType: params["type"].flatMap { $0.isEmpty ? nil : $0 })
        }

        mutating func finish() throws -> CurlParseResult {
            guard !urls.isEmpty else {
                throw CurlParseError(message: LocalizedText("缺少 URL：curl 命令里没有找到请求地址", "Missing URL: the curl command has no request address"))
            }
            // 不认识的参数可能带取值（curl --foo bar https://…）：紧跟在它后面、又不带协议的候选靠后考虑
            func likely(_ u: (value: String, afterUnknown: Bool)) -> Bool {
                !u.afterUnknown || hasScheme(u.value.trimmingCharacters(in: .whitespacesAndNewlines))
            }
            let pickedIndex = urls.firstIndex(where: likely) ?? 0
            let picked = urls[pickedIndex]
            let others = urls.enumerated().filter { $0.offset != pickedIndex }.map(\.element)
            if !others.isEmpty {
                let skipped = others.filter { !likely($0) }.map(\.value)
                if !skipped.isEmpty {
                    warn(skipped.map { "「\($0)」" }.joined(separator: "、") + "可能是不支持的参数的取值，已忽略",
                         skipped.map { "“\($0)”" }.joined(separator: ", ") + " may be values of unsupported options; ignored")
                }
                if skipped.count < others.count {
                    warn("检测到多个 URL，只使用了 \(picked.value)", "Found several URLs; only \(picked.value) was used")
                }
            }
            var url = picked.value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !hasScheme(url) {
                var rest = Substring(url)
                while rest.hasPrefix("/") { rest = rest.dropFirst() }
                url = "http://" + rest
            }
            for q in query { url = appendQuery(url, q) }

            var body = CurlBody.none
            let hasData = !data.isEmpty
            if hasData, !form.isEmpty { warn("-d 与 -F 不能同时使用，已忽略 -F", "-d and -F can't be combined; -F was ignored") }

            if hasData {
                if get {
                    url = appendQuery(url, joinData())
                } else if data.count == 1, let file = data[0].file {
                    body = .file(file)
                } else {
                    body = .text(joinData())
                }
            } else if !form.isEmpty {
                if get { warn("-G 与 -F 同时使用时表单会被忽略", "With -G, the -F form is ignored") } else { body = .multipart(form) }
            } else if let up = uploadFile {
                if up == "-" || up == "." {
                    warn("-T - 表示从标准输入上传，已忽略", "-T - uploads from stdin; ignored")
                } else {
                    body = .file(up)
                }
            }

            var isFile = false
            if case .file = body { isFile = true }
            let finalMethod = method ?? (head ? "HEAD" : get ? "GET" : (hasData || !form.isEmpty) ? "POST" : isFile ? "PUT" : "GET")
            if head, !body.isNone { warn("-I（HEAD 请求）通常不应携带请求体", "-I (HEAD) requests usually should not carry a body") }

            // curl 发送 -d / --data-binary 时的默认 Content-Type
            var isText = false
            if case .text = body { isText = true }
            if isText || (isFile && hasData), !removed.contains("content-type") {
                if json {
                    if headerIndex("content-type") == nil { headers.append(HTTPHeader("Content-Type", "application/json")) }
                    if headerIndex("accept") == nil, !removed.contains("accept") { headers.append(HTTPHeader("Accept", "application/json")) }
                } else if headerIndex("content-type") == nil {
                    headers.append(HTTPHeader("Content-Type", "application/x-www-form-urlencoded"))
                }
            }

            let request = CurlRequest(
                method: finalMethod, url: url, headers: headers, body: body, auth: auth,
                followRedirects: followRedirects, insecure: insecure, compressed: compressed, timeout: timeout
            )
            if !url.contains("{{"), !url.contains("["), !url.contains("{"), !plausibleURL(url) {
                warn("URL 可能无效：\(url)", "The URL may be invalid: \(url)")
            }
            return CurlParseResult(request: request, warnings: warnings)
        }

        mutating func joinData() -> String {
            var out = ""
            for (i, p) in data.enumerated() {
                var text = p.text
                if let file = p.file {
                    warn("请求体需要读取本地文件「\(file)」，已用占位符代替", "The body reads the local file “\(file)”; replaced with a placeholder")
                    text = "{{file:\(file)}}"
                }
                if i > 0, !p.json { out += "&" }
                out += text
            }
            return out
        }
    }

    /// 形如 scheme:// 开头
    static func hasScheme(_ u: String) -> Bool {
        let s = Array(u.unicodeScalars)
        guard let first = s.first, isAlpha(first) else { return false }
        var i = 1
        while i < s.count, isAlpha(s[i]) || isDigit(s[i]) || s[i] == "+" || s[i] == "." || s[i] == "-" { i += 1 }
        return i + 2 < s.count && s[i] == ":" && s[i + 1] == "/" && s[i + 2] == "/"
    }

    static func isAlpha(_ c: Unicode.Scalar) -> Bool {
        (c.value >= 65 && c.value <= 90) || (c.value >= 97 && c.value <= 122)
    }

    /// 近似 WHATWG URL 解析是否会成功（只用于给出「URL 可能无效」的提示）
    static func plausibleURL(_ url: String) -> Bool {
        guard let range = url.range(of: "://") else { return false }
        let scheme = url[..<range.lowerBound].lowercased()
        let rest = url[range.upperBound...]
        let authorityEnd = rest.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" || $0 == "\\" }) ?? rest.endIndex
        var authority = rest[..<authorityEnd]
        if let at = authority.lastIndex(of: "@") { authority = authority[authority.index(after: at)...] }
        let special = ["http", "https", "ws", "wss", "ftp", "file"].contains(scheme)
        if authority.isEmpty { return !special || scheme == "file" }
        var host = authority
        var port: Substring = ""
        if authority.hasPrefix("[") {
            guard let close = authority.firstIndex(of: "]") else { return false }
            host = authority[...close]
            let after = authority[authority.index(after: close)...]
            if !after.isEmpty {
                guard after.hasPrefix(":") else { return false }
                port = after.dropFirst()
            }
        } else if let colon = authority.lastIndex(of: ":") {
            host = authority[..<colon]
            port = authority[authority.index(after: colon)...]
        }
        if !port.isEmpty {
            guard port.allSatisfy({ $0.isASCII && $0.isNumber }), let p = Int(port), p <= 65535 else { return false }
        }
        if host.isEmpty { return false }
        if !host.hasPrefix("[") {
            let forbidden: Set<Character> = [" ", "\t", "\n", "\r", "#", "/", ":", "<", ">", "?", "@", "[", "\\", "]", "^", "|", "%"]
            if host.contains(where: { forbidden.contains($0) }) { return false }
        }
        return true
    }

    /// -F 取值里的 ;type= / ;filename= 等参数
    static func splitFormParams(_ s: String) -> (head: String, params: [String: String]) {
        let chars = Array(s.unicodeScalars)
        var head = String.UnicodeScalarView()
        var i: Int
        if chars.first == "\"" {
            i = 1
            while i < chars.count, chars[i] != "\"" {
                if chars[i] == "\\", i + 1 < chars.count { i += 1 }
                head.append(chars[i])
                i += 1
            }
            i += 1
        } else {
            // 只有后面跟着已知参数名时，分号才是分隔符
            i = chars.count
            var k = 0
            while k < chars.count {
                if chars[k] == ";", formParamName(chars, after: k) != nil {
                    i = k
                    break
                }
                k += 1
            }
            head.append(contentsOf: chars[0..<i])
        }
        var params: [String: String] = [:]
        var k = min(i, chars.count)
        while k < chars.count {
            guard chars[k] == ";", let (key, valueStart) = formParamName(chars, after: k) else {
                k += 1
                continue
            }
            var j = valueStart
            var value = String.UnicodeScalarView()
            if j < chars.count, chars[j] == "\"" {
                // "…" 引号包裹的值，支持 \ 转义
                var q = j + 1
                var closed = false
                var inner = String.UnicodeScalarView()
                while q < chars.count {
                    if chars[q] == "\\", q + 1 < chars.count {
                        inner.append(chars[q + 1])
                        q += 2
                        continue
                    }
                    if chars[q] == "\"" {
                        closed = true
                        break
                    }
                    inner.append(chars[q])
                    q += 1
                }
                if closed {
                    value = inner
                    j = q + 1
                } else {
                    // 没有闭合：按普通值读到分号，并去掉首尾各一个字符（与网页版一致）
                    var e = j
                    while e < chars.count, chars[e] != ";" { e += 1 }
                    if e - j >= 2 { value.append(contentsOf: chars[(j + 1)..<(e - 1)]) }
                    j = e
                }
            } else {
                while j < chars.count, chars[j] != ";" {
                    value.append(chars[j])
                    j += 1
                }
            }
            params[key] = String(value)
            k = j
        }
        return (String(head), params)
    }

    /// chars[at] 是分号时，判断其后是否为「空白* 参数名=」；返回参数名与取值起点
    static func formParamName(_ chars: [Unicode.Scalar], after at: Int) -> (String, Int)? {
        var j = at + 1
        while j < chars.count, isSpace(chars[j]) { j += 1 }
        for key in ["type", "filename", "headers", "encoder"] {
            let k = Array(key.unicodeScalars)
            if j + k.count < chars.count, Array(chars[j..<(j + k.count)]) == k, chars[j + k.count] == "=" {
                return (key, j + k.count + 1)
            }
        }
        return nil
    }
}
