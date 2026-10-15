import Foundation

public enum CurlConverterTool {
    public static let spec = ToolSpec(
        id: "curl-converter",
        name: LocalizedText("cURL 转代码", "cURL to Code"),
        summary: LocalizedText("把 cURL 命令转换成 fetch、axios、Python requests、Go 等代码。", "Convert a cURL command to fetch, axios, Python requests, Go and more."),
        category: .network,
        keywords: ["curl", "fetch", "axios", "python", "requests", "go", "convert", "转换", "zdm"],
        symbol: "terminal",
        input: .required,
        inputLabel: LocalizedText("cURL 命令", "cURL command"),
        fields: [
            ToolField("target", LocalizedText("目标语言", "Target"), .choice(CodeTarget.allCases.map { ToolChoice($0.rawValue, $0.label) }), default: "fetch"),
        ],
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let parsed: CurlParseResult
        do {
            parsed = try Curl.parse(input.text)
        } catch let e as CurlParseError {
            throw e.toolError(lang)
        }
        let target = CodeTarget(rawValue: input.string("target")) ?? .fetch
        let code = HTTPCodegen.generate(parsed.request, target, lang: lang)
        var notes = parsed.warnings.map { ToolNote(.warning, $0(lang)) }
        if notes.count > 1 {
            notes.insert(ToolNote(.info, lang.t("解析时有 \(notes.count) 条提示", "\(notes.count) notes while parsing")), at: 0)
        }
        return ToolResult(
            outputs: [.primary(target.label, code, language: target.language)],
            notes: notes,
            table: summary(parsed.request, lang)
        )
    }

    /// 解析出的请求概要
    static func summary(_ r: CurlRequest, _ lang: Lang) -> ToolTable {
        var rows: [[String]] = [
            [lang.t("方法", "Method"), r.method],
            ["URL", r.url],
        ]
        let parts = HTTPRequestDraft.splitURL(r.url)
        for p in HTTPRequestDraft.params(fromQuery: parts.query ?? "") {
            rows.append([lang.t("查询参数", "Query") + " · " + p.key, p.value])
        }
        for h in r.headers { rows.append([lang.t("请求头", "Header") + " · " + h.name, h.value]) }
        if let a = r.auth { rows.append([lang.t("Basic 认证", "Basic auth"), "\(a.username) : \(String(repeating: "•", count: min(a.password.count, 12)))"]) }
        switch r.body {
        case .none: break
        case .text(let t):
            let preview = t.count > 200 ? String(t.prefix(200)) + "…" : t
            rows.append([lang.t("请求体", "Body"), preview])
        case .file(let path): rows.append([lang.t("请求体", "Body"), lang.t("文件：", "File: ") + path])
        case .multipart(let parts):
            for p in parts {
                rows.append([lang.t("表单", "Form") + " · " + p.name, p.kind == .file ? lang.t("文件：", "File: ") + p.value : p.value])
            }
        }
        var flags: [String] = []
        if r.followRedirects == true { flags.append(lang.t("跟随重定向", "follow redirects")) }
        if r.insecure { flags.append(lang.t("跳过证书校验", "skip TLS verification")) }
        if r.compressed { flags.append(lang.t("压缩响应", "compressed")) }
        if let t = r.timeout { flags.append(lang.t("超时 \(CodeEscape.jsNumber(t)) 秒", "timeout \(CodeEscape.jsNumber(t)) s")) }
        if !flags.isEmpty { rows.append([lang.t("选项", "Options"), flags.joined(separator: lang.t("、", ", "))]) }
        return ToolTable(columns: [lang.t("项目", "Item"), lang.t("值", "Value")], rows: rows)
    }
}
