import Foundation

/// 代码生成的目标语言 / 库
public enum CodeTarget: String, CaseIterable, Sendable {
    case curl, fetch, axios, python, node, httpx, go
    case javaOkHttp = "java-okhttp"
    case java, php, rust, swift, csharp, wget, httpie
    /// 原始 HTTP 报文
    case http

    public var label: String {
        switch self {
        case .curl: "cURL"
        case .fetch: "JavaScript fetch"
        case .axios: "Axios"
        case .python: "Python requests"
        case .node: "Node.js fetch"
        case .httpx: "Python httpx"
        case .go: "Go net/http"
        case .javaOkHttp: "Java OkHttp"
        case .java: "Java HttpClient"
        case .php: "PHP cURL"
        case .rust: "Rust reqwest"
        case .swift: "Swift URLSession"
        case .csharp: "C# HttpClient"
        case .wget: "wget"
        case .httpie: "HTTPie"
        case .http: "HTTP"
        }
    }

    /// 「新标签打开」时的语言 id
    public var language: String {
        switch self {
        case .curl, .wget, .httpie: "shell"
        case .fetch, .axios, .node: "javascript"
        case .python, .httpx: "python"
        case .go: "go"
        case .javaOkHttp, .java: "java"
        case .php: "php"
        case .rust: "rust"
        case .swift: "swift"
        case .csharp: "csharp"
        case .http: "plain"
        }
    }

    /// 保存时的文件名
    public var filename: String {
        switch self {
        case .curl, .wget, .httpie: "request.sh"
        case .fetch: "request.js"
        case .axios, .node: "request.mjs"
        case .python, .httpx: "request.py"
        case .go: "main.go"
        case .javaOkHttp, .java: "Main.java"
        case .php: "request.php"
        case .rust: "main.rs"
        case .swift: "main.swift"
        case .csharp: "Program.cs"
        case .http: "request.http"
        }
    }
}

/// 把结构化 HTTP 请求生成各语言代码（纯函数）。代码里的注释按 lang 输出。
public enum HTTPCodegen {
    public static func generate(_ request: CurlRequest, _ target: CodeTarget, lang: Lang = .zh) -> String {
        var r = request
        r.url = CodeEscape.encodeURLForCode(request.url)
        let g = Generator(r: r, lang: lang)
        switch target {
        case .curl: return g.curl()
        case .fetch: return g.fetch(node: false)
        case .node: return g.fetch(node: true)
        case .axios: return g.axios()
        case .python: return g.python(httpx: false)
        case .httpx: return g.python(httpx: true)
        case .go: return g.go()
        case .javaOkHttp: return g.okHttp()
        case .java: return g.javaHttpClient()
        case .php: return g.php()
        case .rust: return g.rust()
        case .swift: return g.swift()
        case .csharp: return g.csharp()
        case .wget: return g.wget()
        case .httpie: return g.httpie()
        case .http: return g.rawHTTP()
        }
    }

    /// 同名请求头合并（Cookie 用 ; 连接，其它用 , 连接），用于只能用字典表示请求头的语言
    public static func mergeHeaders(_ headers: [HTTPHeader]) -> [HTTPHeader] {
        var out: [HTTPHeader] = []
        var idx: [String: Int] = [:]
        for h in headers {
            let key = h.name.lowercased()
            if let i = idx[key] {
                out[i].value += (key == "cookie" ? "; " : ", ") + h.value
            } else {
                idx[key] = out.count
                out.append(h)
            }
        }
        return out
    }

    /// 请求体是 JSON 且可以无损地转成语言字面量时返回解析结果
    public static func jsonBodyValue(_ r: CurlRequest) -> JSONValue? {
        guard case .text(let text) = r.body, let ct = r.header("content-type"), isJSONContentType(ct) else { return nil }
        guard let value = try? JSON.value(text), value.isContainer, CodeEscape.lossless(value) else { return nil }
        return value
    }

    static func isJSONContentType(_ ct: String) -> Bool {
        let l = Array(ct.lowercased().unicodeScalars)
        let key = Array("json".unicodeScalars)
        guard l.count >= 5 else { return false }
        for i in 1...(l.count - 4) where Array(l[i..<(i + 4)]) == key && (l[i - 1] == "/" || l[i - 1] == "+") {
            let after = i + 4 < l.count ? l[i + 4] : nil
            if let a = after, Curl.isAlpha(a) || Curl.isDigit(a) || a == "_" { continue }
            return true
        }
        return false
    }

    static let stdMethods: Set<String> = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

    static let browserForbidden: Set<String> = [
        "accept-charset", "accept-encoding", "access-control-request-headers", "access-control-request-method",
        "connection", "content-length", "cookie", "cookie2", "date", "dnt", "expect", "host", "keep-alive",
        "origin", "referer", "te", "trailer", "transfer-encoding", "upgrade", "user-agent", "via",
    ]

    static let javaRestricted: Set<String> = ["connection", "content-length", "expect", "host", "upgrade"]

    static let csContentHeaders: Set<String> = [
        "content-type", "content-length", "content-language", "content-encoding", "content-disposition",
        "content-location", "content-md5", "content-range", "expires", "last-modified", "allow",
    ]

    // MARK: - 生成器

    struct Generator {
        let r: CurlRequest
        let lang: Lang

        typealias E = CodeEscape

        func t(_ zh: String, _ en: String) -> String { lang.t(zh, en) }

        /// 生成代码时实际要写出的请求头：multipart 的 Content-Type 由各库自动生成（带 boundary）
        var codeHeaders: [HTTPHeader] {
            if case .multipart = r.body { return r.headers.filter { $0.name.lowercased() != "content-type" } }
            return r.headers
        }

        var timeoutMs: Int? { r.timeout.map { Int(($0 * 1000).rounded()) } }

        var timeoutText: String? { r.timeout.map(E.jsNumber) }

        var cred: String {
            guard let a = r.auth else { return "" }
            return "\(a.username):\(a.password)"
        }

        func contentsComment(_ name: String) -> String {
            let safe = name.replacingOccurrences(of: "*/", with: "* /")
            return t("/* \(safe) 的内容 */", "/* contents of \(safe) */")
        }

        // MARK: cURL

        func curl() -> String {
            var first = ["curl"]
            let hasBody = !r.body.isNone
            var upload = false
            if case .file = r.body, r.header("content-type") == nil { upload = true }
            let implied = upload ? "PUT" : hasBody ? "POST" : "GET"
            if r.method == "HEAD", !hasBody {
                first.append("-I")
            } else if r.method != implied {
                first += ["-X", E.shQuote(r.method)]
            }
            first.append(E.shq(r.url))
            var lines = [first.joined(separator: " ")]
            for h in r.headers { lines.append("-H " + E.shq(h.value.isEmpty ? "\(h.name);" : "\(h.name): \(h.value)")) }
            if r.auth != nil { lines.append("-u " + E.shq(cred)) }
            switch r.body {
            case .none: break
            case .text(let text): lines.append("--data-raw " + E.shq(text))
            case .file(let path): lines.append(upload ? "-T " + E.shq(path) : "--data-binary " + E.shq("@" + path))
            case .multipart(let parts):
                for p in parts {
                    if p.kind == .file {
                        let path = p.value.contains(where: { $0 == ";" || $0 == "," || $0 == "\"" }) ? curlFormQuote(p.value) : p.value
                        var s = "\(p.name)=@\(path)"
                        if let ct = p.contentType, !ct.isEmpty { s += ";type=\(ct)" }
                        if let fn = p.filename { s += ";filename=\(curlFormQuote(fn))" }
                        lines.append("-F " + E.shq(s))
                    } else if p.value.hasPrefix("@") || p.value.hasPrefix("<") || p.value.hasPrefix("\"") || hasFormParam(p.value) {
                        lines.append("--form-string " + E.shq("\(p.name)=\(p.value)"))
                    } else {
                        let type = p.contentType.map { $0.isEmpty ? "" : ";type=\($0)" } ?? ""
                        lines.append("-F " + E.shq("\(p.name)=\(p.value)\(type)"))
                    }
                }
            }
            if r.followRedirects == true { lines.append("-L") }
            if r.insecure { lines.append("-k") }
            if r.compressed { lines.append("--compressed") }
            if let tt = timeoutText { lines.append("-m \(tt)") }
            return lines.joined(separator: " \\\n  ")
        }

        func hasFormParam(_ v: String) -> Bool {
            let chars = Array(v.unicodeScalars)
            for (i, c) in chars.enumerated() where c == ";" && Curl.formParamName(chars, after: i) != nil { return true }
            return false
        }

        func curlFormQuote(_ s: String) -> String {
            if s.isEmpty || s.unicodeScalars.contains(where: { $0 == ";" || $0 == "," || $0 == "\"" || Curl.isSpace($0) }) {
                var out = "\""
                for c in s.unicodeScalars {
                    if c == "\"" || c == "\\" { out += "\\" }
                    out.unicodeScalars.append(c)
                }
                return out + "\""
            }
            return s
        }

        // MARK: JavaScript

        func jsAuthValue() -> String {
            // btoa 只能处理 Latin-1，非 ASCII 时直接写入编码结果
            if cred.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value <= 0x7E }) {
                return "'Basic ' + btoa(\(E.jsStr(cred)))"
            }
            return E.jsStr("Basic " + Data(cred.utf8).base64EncodedString())
        }

        func jsHeadersObject(_ headers: [HTTPHeader], _ extra: [(String, String)], indent: Int) -> String {
            let pad = String(repeating: " ", count: indent + 2)
            let rows = HTTPCodegen.mergeHeaders(headers).map { "\(pad)\(E.jsStr($0.name)): \(E.jsStr($0.value))," }
                + extra.map { "\(pad)\(E.jsStr($0.0)): \($0.1)," }
            return "{\n" + rows.joined(separator: "\n") + "\n" + String(repeating: " ", count: indent) + "}"
        }

        func jsFormLines(_ parts: [CurlFormPart], node: Bool) -> [String] {
            var lines = ["const form = new FormData()"]
            for p in parts {
                if p.kind == .file {
                    let name = p.effectiveFileName
                    let opts = p.contentType.map { $0.isEmpty ? "" : ", { type: \(E.jsStr($0)) }" } ?? ""
                    if node {
                        lines.append("form.append(\(E.jsStr(p.name)), await openAsBlob(\(E.jsStr(p.value))\(opts)), \(E.jsStr(name)))")
                    } else {
                        lines.append("form.append(\(E.jsStr(p.name)), new File([\(contentsComment(name))], \(E.jsStr(name))\(opts)))")
                    }
                } else {
                    lines.append("form.append(\(E.jsStr(p.name)), \(E.jsStr(p.value)))")
                }
            }
            return lines
        }

        func fetch(node: Bool) -> String {
            var pre: [String] = []
            var imports: [String] = []
            var opts: [String] = []
            if r.method != "GET" { opts.append("method: \(E.jsStr(r.method)),") }
            let headers = codeHeaders
            let extra: [(String, String)] = r.auth != nil ? [("Authorization", jsAuthValue())] : []
            if !headers.isEmpty || !extra.isEmpty { opts.append("headers: \(jsHeadersObject(headers, extra, indent: 2)),") }
            switch r.body {
            case .none: break
            case .text(let text):
                if let j = HTTPCodegen.jsonBodyValue(r) {
                    opts.append("body: JSON.stringify(\(E.jsLiteral(j, indent: 2))),")
                } else {
                    opts.append("body: \(E.jsStr(text)),")
                }
            case .multipart(let parts):
                if node, parts.contains(where: { $0.kind == .file }) { imports.append("import { openAsBlob } from 'node:fs'") }
                pre += jsFormLines(parts, node: node) + [""]
                opts.append("body: form,")
            case .file(let path):
                if node {
                    imports.append("import { openAsBlob } from 'node:fs'")
                    opts.append("body: await openAsBlob(\(E.jsStr(path))),")
                } else {
                    let base = CurlRequest.pathBase(path)
                    opts.append("body: new File([\(contentsComment(base))], \(E.jsStr(base))),")
                }
            }
            if r.followRedirects == false { opts.append("redirect: 'manual',") }
            if let ms = timeoutMs { opts.append("signal: AbortSignal.timeout(\(ms)),") }
            if r.insecure {
                pre.insert(node
                    ? t("// 跳过 TLS 证书校验（-k）：运行前设置环境变量 NODE_TLS_REJECT_UNAUTHORIZED=0", "// To skip TLS verification (-k), set NODE_TLS_REJECT_UNAUTHORIZED=0 before running")
                    : t("// 注意：浏览器中无法跳过 TLS 证书校验（-k）", "// Note: browsers cannot skip TLS certificate verification (-k)"), at: 0)
            }
            if !node {
                let blocked = HTTPCodegen.mergeHeaders(headers).map(\.name).filter {
                    let l = $0.lowercased()
                    return HTTPCodegen.browserForbidden.contains(l) || l.hasPrefix("proxy-") || l.hasPrefix("sec-")
                }
                if !blocked.isEmpty {
                    let list = blocked.joined(separator: ", ")
                    pre.insert(t("// 注意：浏览器会忽略这些受限的请求头：\(list)（Node.js 中有效）", "// Note: browsers ignore these forbidden headers: \(list) (they work in Node.js)"), at: 0)
                }
            }
            let call = opts.isEmpty
                ? "const response = await fetch(\(E.jsStr(r.url)))"
                : "const response = await fetch(\(E.jsStr(r.url)), {\n" + opts.map { "  " + $0 }.joined(separator: "\n") + "\n})"
            var out: [String] = []
            if !imports.isEmpty { out += unique(imports) + [""] }
            out += pre + [call, "", "console.log(response.status)", "console.log(await response.text())"]
            return out.joined(separator: "\n")
        }

        func unique(_ a: [String]) -> [String] {
            var seen = Set<String>()
            return a.filter { seen.insert($0).inserted }
        }

        func axios() -> String {
            var imports = ["import axios from 'axios'"]
            var pre: [String] = []
            var opts = ["method: \(E.jsStr(r.method.lowercased())),", "url: \(E.jsStr(r.url)),"]
            let headers = codeHeaders
            if !headers.isEmpty { opts.append("headers: \(jsHeadersObject(headers, [], indent: 2)),") }
            switch r.body {
            case .none: break
            case .text(let text):
                let j = HTTPCodegen.jsonBodyValue(r)
                opts.append("data: \(j.map { E.jsLiteral($0, indent: 2) } ?? E.jsStr(text)),")
            case .multipart(let parts):
                if parts.contains(where: { $0.kind == .file }) { imports.append("import { openAsBlob } from 'node:fs'") }
                pre += jsFormLines(parts, node: true) + [""]
                opts.append("data: form,")
            case .file(let path):
                imports.append("import { readFile } from 'node:fs/promises'")
                opts.append("data: await readFile(\(E.jsStr(path))),")
            }
            if let a = r.auth {
                opts.append("auth: { username: \(E.jsStr(a.username)), password: \(E.jsStr(a.password)) },")
            }
            if let ms = timeoutMs { opts.append("timeout: \(ms),") }
            if r.followRedirects == false { opts.append("maxRedirects: 0,") }
            if r.insecure {
                imports.append("import https from 'node:https'")
                opts.append("httpsAgent: new https.Agent({ rejectUnauthorized: false }),")
            }
            let call = "const response = await axios.request({\n" + opts.map { "  " + $0 }.joined(separator: "\n") + "\n})"
            return (imports + [""] + pre + [call, "", "console.log(response.status)", "console.log(response.data)"]).joined(separator: "\n")
        }

        // MARK: Python

        func python(httpx: Bool) -> String {
            let lib = httpx ? "httpx" : "requests"
            var lines = ["import \(lib)", ""]
            var args = [E.pyStr(r.url)]
            let headers = HTTPCodegen.mergeHeaders(codeHeaders)
            if !headers.isEmpty {
                lines += ["headers = {\n" + headers.map { "    \(E.pyStr($0.name)): \(E.pyStr($0.value))," }.joined(separator: "\n") + "\n}", ""]
                args.append("headers=headers")
            }
            var hasBody = false
            switch r.body {
            case .none: break
            case .text(let text):
                hasBody = true
                if let j = HTTPCodegen.jsonBodyValue(r) {
                    lines += ["json_data = \(E.pyLiteral(j))", ""]
                    args.append("json=json_data")
                } else {
                    // requests 会用 Latin-1 编码 str 请求体，含中文等字符时先转成 UTF-8 字节
                    let enc = text.unicodeScalars.contains { $0.value >= 0x100 } ? ".encode()" : ""
                    lines += ["data = \(E.pyStr(text))\(enc)", ""]
                    args.append(httpx ? "content=data" : "data=data")
                }
            case .multipart(let parts):
                hasBody = true
                let names = parts.map(\.name)
                let dup = Set(names).count != names.count
                func entry(_ p: CurlFormPart) -> String {
                    if p.kind == .file {
                        let ct = p.contentType.map { $0.isEmpty ? "" : ", \(E.pyStr($0))" } ?? ""
                        return "(\(E.pyStr(p.effectiveFileName)), open(\(E.pyStr(p.value)), 'rb')\(ct))"
                    }
                    return "(None, \(E.pyStr(p.value)))"
                }
                lines += [
                    dup
                        ? "files = [\n" + parts.map { "    (\(E.pyStr($0.name)), \(entry($0)))," }.joined(separator: "\n") + "\n]"
                        : "files = {\n" + parts.map { "    \(E.pyStr($0.name)): \(entry($0))," }.joined(separator: "\n") + "\n}",
                    "",
                ]
                args.append("files=files")
            case .file(let path):
                hasBody = true
                lines += ["with open(\(E.pyStr(path)), 'rb') as f:", "    data = f.read()", ""]
                args.append(httpx ? "content=data" : "data=data")
            }
            if let a = r.auth { args.append("auth=(\(E.pyStr(a.username)), \(E.pyStr(a.password)))") }
            if let tt = timeoutText { args.append("timeout=\(tt)") }
            if r.insecure { args.append("verify=False") }
            if !httpx {
                if r.followRedirects == false, r.method != "HEAD" { args.append("allow_redirects=False") }
                if r.followRedirects == true, r.method == "HEAD" { args.append("allow_redirects=True") }
            } else if r.followRedirects == true {
                args.append("follow_redirects=True")
            }
            let m = r.method.lowercased()
            let shortcut = !httpx
                ? HTTPCodegen.stdMethods.contains(r.method)
                : ["post", "put", "patch"].contains(m) || (HTTPCodegen.stdMethods.contains(r.method) && !hasBody)
            let fn: String
            if shortcut {
                fn = "\(lib).\(m)"
            } else {
                fn = "\(lib).request"
                args.insert(E.pyStr(r.method), at: 0)
            }
            let oneLine = "response = \(fn)(\(args.joined(separator: ", ")))"
            lines.append(oneLine.utf16.count <= 88 ? oneLine : "response = \(fn)(\n" + args.map { "    \($0)," }.joined(separator: "\n") + "\n)")
            lines += ["", "print(response.status_code)", "print(response.text)"]
            return lines.joined(separator: "\n")
        }

        // MARK: Go

        func go() -> String {
            var imports: Set<String> = ["fmt", "io", "log", "net/http"]
            var body: [String] = []
            let tab = "\t"
            let fatal = ["\(tab)if err != nil {", "\(tab)\(tab)log.Fatal(err)", "\(tab)}"]
            var clientOpts: [String] = []
            if let ms = timeoutMs {
                imports.insert("time")
                clientOpts.append(ms % 1000 == 0 ? "Timeout: \(ms / 1000) * time.Second," : "Timeout: \(ms) * time.Millisecond,")
            }
            if r.insecure {
                imports.insert("crypto/tls")
                clientOpts += ["Transport: &http.Transport{", "\(tab)TLSClientConfig: &tls.Config{InsecureSkipVerify: true},", "},"]
            }
            if r.followRedirects == false {
                clientOpts += ["CheckRedirect: func(req *http.Request, via []*http.Request) error {", "\(tab)return http.ErrUseLastResponse", "},"]
            }
            body.append(clientOpts.isEmpty
                ? "\(tab)client := &http.Client{}"
                : "\(tab)client := &http.Client{\n" + clientOpts.map { tab + tab + $0 }.joined(separator: "\n") + "\n\(tab)}")
            var reader = "nil"
            var formCT = false
            switch r.body {
            case .none: break
            case .text(let text):
                imports.insert("strings")
                body.append("\(tab)var data = strings.NewReader(\(E.goBody(text)))")
                reader = "data"
            case .file(let path):
                imports.insert("os")
                body += ["\(tab)data, err := os.Open(\(E.goStr(path)))"] + fatal + ["\(tab)defer data.Close()"]
                reader = "data"
            case .multipart(let parts):
                imports.insert("bytes")
                imports.insert("mime/multipart")
                body += ["\(tab)data := &bytes.Buffer{}", "\(tab)writer := multipart.NewWriter(data)"]
                for (i, p) in parts.enumerated() {
                    if p.kind == .file {
                        imports.insert("os")
                        let f = "file\(i)"
                        body += ["\(tab)\(f), err := os.Open(\(E.goStr(p.value)))"] + fatal + [
                            "\(tab)defer \(f).Close()",
                            "\(tab)part\(i), err := writer.CreateFormFile(\(E.goStr(p.name)), \(E.goStr(p.effectiveFileName)))",
                        ] + fatal + [
                            "\(tab)if _, err := io.Copy(part\(i), \(f)); err != nil {",
                            "\(tab)\(tab)log.Fatal(err)",
                            "\(tab)}",
                        ]
                    } else {
                        body += [
                            "\(tab)if err := writer.WriteField(\(E.goStr(p.name)), \(E.goStr(p.value))); err != nil {",
                            "\(tab)\(tab)log.Fatal(err)",
                            "\(tab)}",
                        ]
                    }
                }
                body.append("\(tab)writer.Close()")
                reader = "data"
                formCT = true
            }
            body += ["\(tab)req, err := http.NewRequest(\(E.goStr(r.method)), \(E.goStr(r.url)), \(reader))"] + fatal
            var seen = Set<String>()
            for h in codeHeaders {
                let l = h.name.lowercased()
                if l == "host" {
                    body.append("\(tab)req.Host = \(E.goStr(h.value))")
                    continue
                }
                body.append("\(tab)req.Header.\(seen.contains(l) ? "Add" : "Set")(\(E.goStr(h.name)), \(E.goStr(h.value)))")
                seen.insert(l)
            }
            if formCT { body.append("\(tab)req.Header.Set(\"Content-Type\", writer.FormDataContentType())") }
            if let a = r.auth { body.append("\(tab)req.SetBasicAuth(\(E.goStr(a.username)), \(E.goStr(a.password)))") }
            body += ["\(tab)resp, err := client.Do(req)"] + fatal + [
                "\(tab)defer resp.Body.Close()",
                "\(tab)bodyText, err := io.ReadAll(resp.Body)",
            ] + fatal + [
                "\(tab)fmt.Println(resp.Status)",
                "\(tab)fmt.Printf(\"%s\\n\", bodyText)",
            ]
            let sorted = imports.sorted()
            return (["package main", "", "import ("] + sorted.map { "\(tab)\"\($0)\"" } + [")", "", "func main() {"] + body + ["}"])
                .joined(separator: "\n")
        }

        // MARK: Java

        func javaClass(_ imports: Set<String>, _ throwsType: String, _ lines: [String]) -> String {
            let sorted = imports.sorted { a, b in
                let ja = a.hasPrefix("java") ? 0 : 1
                let jb = b.hasPrefix("java") ? 0 : 1
                return ja != jb ? ja < jb : a < b
            }
            return (sorted.map { "import \($0);" } + [
                "",
                "public class Main {",
                "    public static void main(String[] args) throws \(throwsType) {",
            ] + lines + ["    }", "}"]).joined(separator: "\n")
        }

        func okHttp() -> String {
            var imports: Set<String> = ["java.io.IOException", "okhttp3.OkHttpClient", "okhttp3.Request", "okhttp3.Response"]
            let i2 = "        "
            var lines: [String] = []
            var clientOpts: [String] = []
            if r.followRedirects == false { clientOpts.append(".followRedirects(false)") }
            if let ms = timeoutMs {
                imports.insert("java.util.concurrent.TimeUnit")
                clientOpts.append(".callTimeout(\(ms), TimeUnit.MILLISECONDS)")
            }
            if r.insecure {
                lines.append(i2 + t("// 注意：OkHttp 需要自定义 SSLSocketFactory 与 HostnameVerifier 才能跳过证书校验（-k）",
                                    "// Note: OkHttp needs a custom SSLSocketFactory and HostnameVerifier to skip certificate checks (-k)"))
            }
            lines += [
                clientOpts.isEmpty
                    ? "\(i2)OkHttpClient client = new OkHttpClient();"
                    : "\(i2)OkHttpClient client = new OkHttpClient.Builder()\n" + clientOpts.map { "\(i2)    \($0)" }.joined(separator: "\n") + "\n\(i2)    .build();",
                "",
            ]
            let ct = r.header("content-type")
            let media = ct.map { "MediaType.parse(\(E.javaStr($0)))" } ?? "null"
            var bodyVar: String?
            let permitsBody = r.method != "GET" && r.method != "HEAD"
            let requiresBody = ["POST", "PUT", "PATCH", "PROPPATCH", "REPORT"].contains(r.method)
            if !r.body.isNone, !permitsBody {
                lines.append(i2 + t("// 注意：OkHttp 不允许 \(r.method) 请求携带请求体，已省略", "// Note: OkHttp doesn't allow a body on \(r.method) requests; omitted"))
            } else {
                switch r.body {
                case .text(let text):
                    imports.insert("okhttp3.RequestBody")
                    if ct != nil { imports.insert("okhttp3.MediaType") }
                    lines += ["\(i2)RequestBody body = RequestBody.create(\(E.javaStr(text)), \(media));", ""]
                    bodyVar = "body"
                case .file(let path):
                    imports.insert("okhttp3.RequestBody")
                    imports.insert("java.io.File")
                    if ct != nil { imports.insert("okhttp3.MediaType") }
                    lines += ["\(i2)RequestBody body = RequestBody.create(new File(\(E.javaStr(path))), \(media));", ""]
                    bodyVar = "body"
                case .multipart(let parts):
                    imports.insert("okhttp3.MultipartBody")
                    imports.insert("okhttp3.RequestBody")
                    let rows = parts.map { p -> String in
                        if p.kind == .file {
                            imports.insert("java.io.File")
                            let pct = p.contentType.flatMap { $0.isEmpty ? nil : $0 }
                            if pct != nil { imports.insert("okhttp3.MediaType") }
                            let mt = pct.map { "MediaType.parse(\(E.javaStr($0)))" } ?? "null"
                            return "\(i2)    .addFormDataPart(\(E.javaStr(p.name)), \(E.javaStr(p.effectiveFileName)),\n\(i2)        RequestBody.create(new File(\(E.javaStr(p.value))), \(mt)))"
                        }
                        return "\(i2)    .addFormDataPart(\(E.javaStr(p.name)), \(E.javaStr(p.value)))"
                    }
                    lines += ["\(i2)RequestBody body = new MultipartBody.Builder()", "\(i2)    .setType(MultipartBody.FORM)"] + rows + ["\(i2)    .build();", ""]
                    bodyVar = "body"
                case .none:
                    if requiresBody {
                        imports.insert("okhttp3.RequestBody")
                        lines += ["\(i2)RequestBody body = RequestBody.create(new byte[0], null);", ""]
                        bodyVar = "body"
                    }
                }
            }
            var builder = ["\(i2)Request request = new Request.Builder()", "\(i2)    .url(\(E.javaStr(r.url)))"]
            if r.method == "GET", bodyVar == nil {
                // 默认就是 GET
            } else if r.method == "HEAD" {
                builder.append("\(i2)    .head()")
            } else {
                builder.append("\(i2)    .method(\(E.javaStr(r.method)), \(bodyVar ?? "null"))")
            }
            for h in codeHeaders {
                if bodyVar != nil, !r.body.isNone, h.name.lowercased() == "content-type" { continue }
                builder.append("\(i2)    .addHeader(\(E.javaStr(h.name)), \(E.javaStr(h.value)))")
            }
            if let a = r.auth {
                imports.insert("okhttp3.Credentials")
                builder.append("\(i2)    .addHeader(\"Authorization\", Credentials.basic(\(E.javaStr(a.username)), \(E.javaStr(a.password))))")
            }
            builder.append("\(i2)    .build();")
            lines += builder + [
                "",
                "\(i2)try (Response response = client.newCall(request).execute()) {",
                "\(i2)    System.out.println(response.code());",
                "\(i2)    System.out.println(response.body().string());",
                "\(i2)}",
            ]
            return javaClass(imports, "IOException", lines)
        }

        func javaHttpClient() -> String {
            var imports: Set<String> = ["java.net.URI", "java.net.http.HttpClient", "java.net.http.HttpRequest", "java.net.http.HttpResponse"]
            let i2 = "        "
            var lines: [String] = []
            if r.insecure { lines.append(i2 + t("// 注意：跳过证书校验（-k）需要自定义 SSLContext，这里没有生成", "// Note: skipping certificate checks (-k) needs a custom SSLContext, which is not generated here")) }
            lines += [
                r.followRedirects == true
                    ? "\(i2)HttpClient client = HttpClient.newBuilder()\n\(i2)    .followRedirects(HttpClient.Redirect.NORMAL)\n\(i2)    .build();"
                    : "\(i2)HttpClient client = HttpClient.newHttpClient();",
                "",
            ]
            var publisher = "HttpRequest.BodyPublishers.noBody()"
            var multipart = false
            switch r.body {
            case .none: break
            case .text(let text): publisher = "HttpRequest.BodyPublishers.ofString(\(E.javaStr(text)))"
            case .file(let path):
                imports.insert("java.nio.file.Path")
                publisher = "HttpRequest.BodyPublishers.ofFile(Path.of(\(E.javaStr(path))))"
            case .multipart(let parts):
                multipart = true
                imports.insert("java.io.ByteArrayOutputStream")
                imports.insert("java.nio.charset.StandardCharsets")
                lines += [
                    "\(i2)String boundary = \"----JavaFormBoundary\" + System.nanoTime();",
                    "\(i2)ByteArrayOutputStream form = new ByteArrayOutputStream();",
                ]
                for p in parts {
                    if p.kind == .file {
                        imports.insert("java.nio.file.Files")
                        imports.insert("java.nio.file.Path")
                        let head = "\r\nContent-Disposition: form-data; name=\"\(p.name)\"; filename=\"\(p.effectiveFileName)\"\r\nContent-Type: \(p.contentType.flatMap { $0.isEmpty ? nil : $0 } ?? "application/octet-stream")\r\n\r\n"
                        lines += [
                            "\(i2)form.write((\"--\" + boundary + \(E.javaStr(head))).getBytes(StandardCharsets.UTF_8));",
                            "\(i2)form.write(Files.readAllBytes(Path.of(\(E.javaStr(p.value)))));",
                            "\(i2)form.write(\"\\r\\n\".getBytes(StandardCharsets.UTF_8));",
                        ]
                    } else {
                        let chunk = "\r\nContent-Disposition: form-data; name=\"\(p.name)\"\r\n\r\n\(p.value)\r\n"
                        lines.append("\(i2)form.write((\"--\" + boundary + \(E.javaStr(chunk))).getBytes(StandardCharsets.UTF_8));")
                    }
                }
                lines += ["\(i2)form.write((\"--\" + boundary + \"--\\r\\n\").getBytes(StandardCharsets.UTF_8));", ""]
                publisher = "HttpRequest.BodyPublishers.ofByteArray(form.toByteArray())"
            }
            var builder = ["\(i2)HttpRequest request = HttpRequest.newBuilder()", "\(i2)    .uri(URI.create(\(E.javaStr(r.url))))"]
            if let ms = timeoutMs {
                imports.insert("java.time.Duration")
                builder.append("\(i2)    .timeout(Duration.ofMillis(\(ms)))")
            }
            var skipped: [String] = []
            for h in codeHeaders {
                if HTTPCodegen.javaRestricted.contains(h.name.lowercased()) {
                    skipped.append(h.name)
                    continue
                }
                builder.append("\(i2)    .header(\(E.javaStr(h.name)), \(E.javaStr(h.value)))")
            }
            if multipart { builder.append("\(i2)    .header(\"Content-Type\", \"multipart/form-data; boundary=\" + boundary)") }
            if r.auth != nil {
                imports.insert("java.util.Base64")
                imports.insert("java.nio.charset.StandardCharsets")
                builder.append("\(i2)    .header(\"Authorization\", \"Basic \" + Base64.getEncoder().encodeToString(\(E.javaStr(cred)).getBytes(StandardCharsets.UTF_8)))")
            }
            builder += ["\(i2)    .method(\(E.javaStr(r.method)), \(publisher))", "\(i2)    .build();"]
            if !skipped.isEmpty {
                let list = skipped.joined(separator: ", ")
                lines.append(i2 + t("// HttpClient 不允许手动设置这些请求头，已省略：\(list)", "// HttpClient doesn't allow setting these headers; omitted: \(list)"))
            }
            lines += builder + [
                "",
                "\(i2)HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());",
                "\(i2)System.out.println(response.statusCode());",
                "\(i2)System.out.println(response.body());",
            ]
            return javaClass(imports, "Exception", lines)
        }

        // MARK: PHP

        func php() -> String {
            var L = ["<?php", "", "$ch = curl_init();", "curl_setopt($ch, CURLOPT_URL, \(E.phpStr(r.url)));", "curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);"]
            let hasBody = !r.body.isNone
            if r.method == "HEAD" {
                L.append("curl_setopt($ch, CURLOPT_NOBODY, true);")
            } else if !(r.method == "GET" && !hasBody), !(r.method == "POST" && hasBody) {
                L.append("curl_setopt($ch, CURLOPT_CUSTOMREQUEST, \(E.phpStr(r.method)));")
            }
            let headers = codeHeaders
            if !headers.isEmpty {
                L.append("curl_setopt($ch, CURLOPT_HTTPHEADER, [")
                L += headers.map { "    \(E.phpStr($0.value.isEmpty ? "\($0.name);" : "\($0.name): \($0.value)")),"}
                L.append("]);")
            }
            if r.auth != nil { L.append("curl_setopt($ch, CURLOPT_USERPWD, \(E.phpStr(cred)));") }
            switch r.body {
            case .none: break
            case .text(let text): L.append("curl_setopt($ch, CURLOPT_POSTFIELDS, \(E.phpStr(text)));")
            case .file(let path): L.append("curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents(\(E.phpStr(path))));")
            case .multipart(let parts):
                L.append("curl_setopt($ch, CURLOPT_POSTFIELDS, [")
                L += parts.map { p in
                    p.kind == .file
                        ? "    \(E.phpStr(p.name)) => new CURLFile(\(E.phpStr(p.value)), \(E.phpStr(p.contentType ?? "")), \(E.phpStr(p.effectiveFileName))),"
                        : "    \(E.phpStr(p.name)) => \(E.phpStr(p.value)),"
                }
                L.append("]);")
            }
            if r.followRedirects == true { L.append("curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);") }
            if let ms = timeoutMs { L.append("curl_setopt($ch, CURLOPT_TIMEOUT_MS, \(ms));") }
            if r.insecure { L += ["curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);", "curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);"] }
            if r.compressed { L.append("curl_setopt($ch, CURLOPT_ENCODING, '');") }
            L += [
                "", "$response = curl_exec($ch);", "if ($response === false) {", "    echo 'Error: ' . curl_error($ch);", "} else {",
                "    echo curl_getinfo($ch, CURLINFO_RESPONSE_CODE) . PHP_EOL;", "    echo $response;", "}", "curl_close($ch);",
            ]
            return L.joined(separator: "\n")
        }

        // MARK: Rust

        func rust() -> String {
            let i1 = "    "
            var L = ["// Cargo.toml: reqwest = { version = \"0.12\", features = [\"blocking\", \"multipart\"] }"]
            let headers = codeHeaders
            if !headers.isEmpty { L += ["use reqwest::header;", ""] }
            L.append("fn main() -> Result<(), Box<dyn std::error::Error>> {")
            if !headers.isEmpty {
                L.append("\(i1)let mut headers = header::HeaderMap::new();")
                var seen = Set<String>()
                for h in headers {
                    let key = h.name.lowercased()
                    L.append("\(i1)headers.\(seen.contains(key) ? "append" : "insert")(\(E.rustStr(key)), \(E.rustStr(h.value)).parse()?);")
                    seen.insert(key)
                }
                L.append("")
            }
            if case .multipart(let parts) = r.body {
                let rows = parts.map { p -> String in
                    if p.kind == .text { return "\(i1)\(i1).text(\(E.rustStr(p.name)), \(E.rustStr(p.value)))" }
                    let ct = p.contentType.flatMap { $0.isEmpty ? nil : $0 }
                    if p.filename == nil, ct == nil { return "\(i1)\(i1).file(\(E.rustStr(p.name)), \(E.rustStr(p.value)))?" }
                    var part = "reqwest::blocking::multipart::Part::file(\(E.rustStr(p.value)))?"
                    if let fn = p.filename { part += ".file_name(\(E.rustStr(fn)))" }
                    if let ct { part += ".mime_str(\(E.rustStr(ct)))?" }
                    return "\(i1)\(i1).part(\(E.rustStr(p.name)), \(part))"
                }
                L.append("\(i1)let form = reqwest::blocking::multipart::Form::new()")
                L += rows.enumerated().map { $0.offset == rows.count - 1 ? $0.element + ";" : $0.element }
                L.append("")
            }
            var cb: [String] = []
            if r.followRedirects == false { cb.append(".redirect(reqwest::redirect::Policy::none())") }
            if r.insecure { cb.append(".danger_accept_invalid_certs(true)") }
            if let ms = timeoutMs { cb.append(".timeout(std::time::Duration::from_millis(\(ms)))") }
            L.append(cb.isEmpty
                ? "\(i1)let client = reqwest::blocking::Client::new();"
                : "\(i1)let client = reqwest::blocking::Client::builder()\n" + cb.map { "\(i1)\(i1)\($0)" }.joined(separator: "\n") + "\n\(i1)\(i1).build()?;")
            let m = r.method
            let start: String
            if ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].contains(m) {
                start = ".\(m.lowercased())(\(E.rustStr(r.url)))"
            } else if ["OPTIONS", "CONNECT", "TRACE"].contains(m) {
                start = ".request(reqwest::Method::\(m), \(E.rustStr(r.url)))"
            } else {
                start = ".request(reqwest::Method::from_bytes(b\(E.rustStr(m)))?, \(E.rustStr(r.url)))"
            }
            var chain = [start]
            if !headers.isEmpty { chain.append(".headers(headers)") }
            if let a = r.auth { chain.append(".basic_auth(\(E.rustStr(a.username)), Some(\(E.rustStr(a.password))))") }
            switch r.body {
            case .none: break
            case .text(let text): chain.append(".body(\(E.rustBody(text)))")
            case .file(let path): chain.append(".body(std::fs::read(\(E.rustStr(path)))?)")
            case .multipart: chain.append(".multipart(form)")
            }
            chain.append(".send()?;")
            L += ["\(i1)let res = client"] + chain.map { "\(i1)\(i1)\($0)" } + [
                "", "\(i1)println!(\"{}\", res.status());", "\(i1)println!(\"{}\", res.text()?);", "\(i1)Ok(())", "}",
            ]
            return L.joined(separator: "\n")
        }

        // MARK: Swift

        func swift() -> String {
            var L = ["import Foundation", ""]
            if r.insecure { L.append(t("// 注意：跳过证书校验（-k）需要实现 URLSessionDelegate，这里没有生成", "// Note: skipping certificate checks (-k) needs a URLSessionDelegate, which is not generated here")) }
            if r.followRedirects == false { L.append(t("// 注意：禁止重定向需要实现 URLSessionTaskDelegate，这里没有生成", "// Note: disabling redirects needs a URLSessionTaskDelegate, which is not generated here")) }
            L += ["let url = URL(string: \(E.swiftStr(r.url)))!", "var request = URLRequest(url: url)"]
            if r.method != "GET" { L.append("request.httpMethod = \(E.swiftStr(r.method))") }
            if let tt = timeoutText { L.append("request.timeoutInterval = \(tt)") }
            var seen = Set<String>()
            for h in codeHeaders {
                let l = h.name.lowercased()
                L.append("request.\(seen.contains(l) ? "addValue" : "setValue")(\(E.swiftStr(h.value)), forHTTPHeaderField: \(E.swiftStr(h.name)))")
                seen.insert(l)
            }
            if r.auth != nil {
                L += [
                    "let credentials = Data(\(E.swiftStr(cred)).utf8).base64EncodedString()",
                    "request.setValue(\"Basic \\(credentials)\", forHTTPHeaderField: \"Authorization\")",
                ]
            }
            switch r.body {
            case .none: break
            case .text(let text): L.append("request.httpBody = Data(\(E.swiftBody(text)).utf8)")
            case .file(let path): L.append("request.httpBody = try Data(contentsOf: URL(fileURLWithPath: \(E.swiftStr(path))))")
            case .multipart(let parts):
                L += ["", "let boundary = \"Boundary-\\(UUID().uuidString)\"", "var body = Data()"]
                for p in parts {
                    if p.kind == .file {
                        let head = "\r\nContent-Disposition: form-data; name=\"\(p.name)\"; filename=\"\(p.effectiveFileName)\"\r\nContent-Type: \(p.contentType.flatMap { $0.isEmpty ? nil : $0 } ?? "application/octet-stream")\r\n\r\n"
                        L += [
                            "body.append(Data((\"--\\(boundary)\" + \(E.swiftStr(head))).utf8))",
                            "body.append(try Data(contentsOf: URL(fileURLWithPath: \(E.swiftStr(p.value)))))",
                            "body.append(Data(\"\\r\\n\".utf8))",
                        ]
                    } else {
                        let chunk = "\r\nContent-Disposition: form-data; name=\"\(p.name)\"\r\n\r\n\(p.value)\r\n"
                        L.append("body.append(Data((\"--\\(boundary)\" + \(E.swiftStr(chunk))).utf8))")
                    }
                }
                L += [
                    "body.append(Data(\"--\\(boundary)--\\r\\n\".utf8))",
                    "request.setValue(\"multipart/form-data; boundary=\\(boundary)\", forHTTPHeaderField: \"Content-Type\")",
                    "request.httpBody = body",
                ]
            }
            L += [
                "", "let (data, response) = try await URLSession.shared.data(for: request)", "if let http = response as? HTTPURLResponse {",
                "    print(http.statusCode)", "}", "print(String(decoding: data, as: UTF8.self))",
            ]
            return L.joined(separator: "\n")
        }

        // MARK: C#

        func csharp() -> String {
            var L = ["using System.Net.Http.Headers;", "using System.Text;", ""]
            var handler: [String] = []
            if r.followRedirects == false { handler.append("AllowAutoRedirect = false,") }
            if r.insecure { handler.append("ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,") }
            if r.compressed { handler.append("AutomaticDecompression = System.Net.DecompressionMethods.All,") }
            if !handler.isEmpty {
                L += ["var handler = new HttpClientHandler", "{"] + handler.map { "    " + $0 } + ["};", "using var client = new HttpClient(handler);"]
            } else {
                L.append("using var client = new HttpClient();")
            }
            if let ms = timeoutMs { L.append("client.Timeout = TimeSpan.FromMilliseconds(\(ms));") }
            L += ["", "using var request = new HttpRequestMessage(new HttpMethod(\(E.csStr(r.method))), \(E.csStr(r.url)));"]
            var contentHeaders: [HTTPHeader] = []
            for h in codeHeaders {
                if HTTPCodegen.csContentHeaders.contains(h.name.lowercased()) {
                    contentHeaders.append(h)
                    continue
                }
                L.append("request.Headers.TryAddWithoutValidation(\(E.csStr(h.name)), \(E.csStr(h.value)));")
            }
            if r.auth != nil {
                L.append("request.Headers.Authorization = new AuthenticationHeaderValue(\"Basic\", Convert.ToBase64String(Encoding.UTF8.GetBytes(\(E.csStr(cred)))));")
            }
            var hasContent = true
            switch r.body {
            case .none: hasContent = false
            case .text(let text): L.append("request.Content = new StringContent(\(E.csStr(text)));")
            case .file(let path): L.append("request.Content = new ByteArrayContent(File.ReadAllBytes(\(E.csStr(path))));")
            case .multipart(let parts):
                L.append("var form = new MultipartFormDataContent();")
                for (i, p) in parts.enumerated() {
                    if p.kind == .file {
                        L.append("var file\(i) = new ByteArrayContent(File.ReadAllBytes(\(E.csStr(p.value))));")
                        if let ct = p.contentType, !ct.isEmpty { L.append("file\(i).Headers.ContentType = MediaTypeHeaderValue.Parse(\(E.csStr(ct)));") }
                        L.append("form.Add(file\(i), \(E.csStr(p.name)), \(E.csStr(p.effectiveFileName)));")
                    } else {
                        L.append("form.Add(new StringContent(\(E.csStr(p.value))), \(E.csStr(p.name)));")
                    }
                }
                L.append("request.Content = form;")
            }
            for h in contentHeaders {
                if !hasContent {
                    L.append(t("// 没有请求体，已省略内容头 \(h.name)", "// No request body; the content header \(h.name) is omitted"))
                    continue
                }
                if h.name.lowercased() == "content-type" {
                    L.append("request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(\(E.csStr(h.value)));")
                } else {
                    L.append("request.Content.Headers.Remove(\(E.csStr(h.name)));")
                    L.append("request.Content.Headers.TryAddWithoutValidation(\(E.csStr(h.name)), \(E.csStr(h.value)));")
                }
            }
            L += [
                "", "using var response = await client.SendAsync(request);", "Console.WriteLine((int)response.StatusCode);",
                "Console.WriteLine(await response.Content.ReadAsStringAsync());",
            ]
            return L.joined(separator: "\n")
        }

        // MARK: wget / HTTPie

        func wget() -> String {
            var pre: [String] = []
            var args = ["wget", "--quiet"]
            if r.method != "GET" { args.append("--method=\(E.shQuote(r.method))") }
            for h in r.headers { args.append("--header=" + E.shq("\(h.name): \(h.value)")) }
            if let a = r.auth { args += ["--user=" + E.shq(a.username), "--password=" + E.shq(a.password), "--auth-no-challenge"] }
            switch r.body {
            case .none: break
            case .text(let text): args.append("--body-data=" + E.shq(text))
            case .file(let path): args.append("--body-file=" + E.shq(path))
            case .multipart:
                pre.append(t("# 注意：wget 不支持 multipart/form-data 表单，已省略请求体，建议改用 curl 或 HTTPie",
                             "# Note: wget doesn't support multipart/form-data; the body is omitted. Use curl or HTTPie instead"))
            }
            if let tt = timeoutText { args.append("--timeout=\(tt)") }
            if r.insecure { args.append("--no-check-certificate") }
            if r.followRedirects == false { args.append("--max-redirect=0") }
            if r.compressed { args.append("--compression=auto") }
            args += ["--output-document=-", E.shq(r.url)]
            // 第一行放命令和前两个参数，其余每行一个
            let joined = args.count <= 3 ? args.joined(separator: " ") : ([args[0...1].joined(separator: " ")] + args[2...]).joined(separator: " \\\n  ")
            return (pre + [joined]).joined(separator: "\n")
        }

        func httpie() -> String {
            var flags: [String] = []
            if r.followRedirects == true { flags.append("--follow") }
            if r.insecure { flags.append("--verify=no") }
            if let tt = timeoutText { flags.append("--timeout=\(tt)") }
            if r.auth != nil { flags.append("--auth=" + E.shq(cred)) }
            if case .text(let text) = r.body { flags.append("--raw=" + E.shq(text)) }
            var items: [String] = []
            for h in codeHeaders { items.append(E.shq(h.value.isEmpty ? "\(h.name);" : "\(h.name):\(h.value)")) }
            if case .multipart(let parts) = r.body {
                flags.append("--multipart")
                for p in parts {
                    if p.kind == .file {
                        let type = p.contentType.map { $0.isEmpty ? "" : ";type=\($0)" } ?? ""
                        items.append(E.shq("\(p.name)@\(p.value)\(type)"))
                    } else {
                        items.append(E.shq("\(p.name)=\(p.value)"))
                    }
                }
            }
            let head = (["http"] + flags + [r.method, E.shq(r.url)]).joined(separator: " ")
            var cmd = items.isEmpty ? head : ([head] + items).joined(separator: " \\\n  ")
            if case .file(let path) = r.body { cmd += " \\\n  < " + E.shq(path) }
            return cmd
        }

        // MARK: 原始 HTTP 报文

        func rawHTTP() -> String {
            var target = "/"
            var host = ""
            if let sep = r.url.range(of: "://") {
                let rest = r.url[sep.upperBound...]
                let pathStart = rest.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) ?? rest.endIndex
                var authority = rest[..<pathStart]
                if let at = authority.lastIndex(of: "@") { authority = authority[authority.index(after: at)...] }
                host = String(authority)
                var path = String(rest[pathStart...])
                if let hash = path.firstIndex(of: "#") { path = String(path[..<hash]) }
                if path.isEmpty { path = "/" } else if path.hasPrefix("?") { path = "/" + path }
                target = path
            } else {
                target = r.url
            }
            var lines = ["\(r.method) \(target) HTTP/1.1"]
            if r.header("host") == nil, !host.isEmpty { lines.append("Host: \(host)") }
            let boundary = "----ShowMeFormBoundary"
            for h in codeHeaders { lines.append("\(h.name): \(h.value)") }
            if r.auth != nil { lines.append("Authorization: Basic " + Data(cred.utf8).base64EncodedString()) }
            var body = ""
            switch r.body {
            case .none: break
            case .text(let text): body = text
            case .file(let path): body = t("<\(path) 的内容>", "<contents of \(path)>")
            case .multipart(let parts):
                lines.append("Content-Type: multipart/form-data; boundary=\(boundary)")
                var chunks: [String] = []
                for p in parts {
                    if p.kind == .file {
                        chunks.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(p.name)\"; filename=\"\(p.effectiveFileName)\"\r\nContent-Type: \(p.contentType.flatMap { $0.isEmpty ? nil : $0 } ?? "application/octet-stream")\r\n\r\n" + t("<\(p.value) 的内容>", "<contents of \(p.value)>"))
                    } else {
                        chunks.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(p.name)\"\r\n\r\n\(p.value)")
                    }
                }
                body = chunks.joined(separator: "\r\n") + "\r\n--\(boundary)--"
                body = body.replacingOccurrences(of: "\r\n", with: "\n")
            }
            if case .text = r.body, r.header("content-length") == nil { lines.append("Content-Length: \(body.utf8.count)") }
            return lines.joined(separator: "\n") + "\n\n" + body
        }
    }
}
