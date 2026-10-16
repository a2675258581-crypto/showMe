import Foundation

public struct HTTPStatusInfo: Sendable, Hashable {
    /// deprecated 已废弃；reserved 保留不用；unofficial 非标准（厂商扩展）
    public enum Flag: String, Sendable { case deprecated, reserved, unofficial }

    public let code: Int
    /// 官方英文原因短语
    public let phrase: String
    public let zhName: String
    public let zhDescription: String
    public let enDescription: String
    /// 典型场景（仅中文）
    public let zhScenario: String
    /// 开发建议（仅中文）
    public let zhTip: String
    /// 相关的请求 / 响应头
    public let headers: [String]
    /// 规范出处
    public let spec: String
    public let specURL: String?
    /// RFC 9110 §15.1：默认可被启发式缓存
    public let cacheable: Bool
    public let flag: Flag?
    /// 非标准码的来源
    public let vendor: String?
    public let keywords: [String]

    /// 中文界面用中文名，英文界面用原因短语
    public func name(_ lang: Lang) -> String { lang == .zh ? zhName : phrase }

    public func description(_ lang: Lang) -> String { lang == .zh ? zhDescription : enDescription }

    public var statusClass: Int { HTTPStatusCatalog.classOf(code) }

    /// 「已废弃」「非标准（Nginx）」之类的标记；没有时为 nil
    public func flagLabel(_ lang: Lang) -> String? {
        guard let flag else { return nil }
        let base: String = switch flag {
        case .deprecated: lang.t("已废弃", "Deprecated")
        case .reserved: lang.t("保留", "Reserved")
        case .unofficial: lang.t("非标准", "Unofficial")
        }
        guard let vendor else { return base }
        return lang == .zh ? "\(base)（\(vendor)）" : "\(base) (\(vendor))"
    }
}

/// HTTP 状态码速查数据与搜索。标准码以 IANA 注册表为准（RFC 9110 及 WebDAV、RFC 6585 等扩展），另附 Nginx / Cloudflare 常见非标准码。
public enum HTTPStatusCatalog {
    /// 全部状态码，按数字升序
    public static let all: [HTTPStatusInfo] = data.sorted { $0.code < $1.code }

    static let byCode: [Int: HTTPStatusInfo] = Dictionary(all.map { ($0.code, $0) }, uniquingKeysWith: { a, _ in a })

    static let haystacks: [Int: String] = Dictionary(all.map { s in
        let parts = [String(s.code), s.phrase, s.zhName, s.zhDescription, s.enDescription, s.zhScenario, s.zhTip, s.spec, s.vendor ?? ""]
            + s.headers + s.keywords
        return (s.code, parts.joined(separator: "\n").lowercased())
    }, uniquingKeysWith: { a, _ in a })

    public static func status(_ code: Int) -> HTTPStatusInfo? { byCode[code] }

    /// 1–5
    public static func classOf(_ code: Int) -> Int { min(5, max(1, code / 100)) }

    public static func className(_ cls: Int) -> LocalizedText {
        switch cls {
        case 1: LocalizedText("信息响应", "Informational")
        case 2: LocalizedText("成功", "Success")
        case 3: LocalizedText("重定向", "Redirection")
        case 4: LocalizedText("客户端错误", "Client error")
        default: LocalizedText("服务器错误", "Server error")
        }
    }

    public static func classDescription(_ cls: Int) -> LocalizedText {
        switch cls {
        case 1: LocalizedText("请求已收到，继续处理", "The request was received and is being processed")
        case 2: LocalizedText("请求已成功接收、理解并处理", "The request was received, understood and accepted")
        case 3: LocalizedText("需要客户端进一步操作才能完成请求", "Further action is needed to complete the request")
        case 4: LocalizedText("请求有误或无法被满足", "The request is wrong or can't be fulfilled")
        default: LocalizedText("服务器处理一个看似有效的请求时出错", "The server failed to fulfill an apparently valid request")
        }
    }

    /// 「按状态码查找」类的查询 → 状态码前缀；普通文本返回 nil。
    /// "4" / "40" / "404" 原样作为前缀；"4xx"、"40x"（x 大小写均可）去掉通配部分。
    public static func codeQueryPrefix(_ query: String) -> String? {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let chars = Array(q)
        if (1...3).contains(chars.count), chars.allSatisfy({ $0.isASCII && $0.isNumber }) { return q }
        guard chars.count == 3, let first = chars.first, ("1"..."5").contains(first) else { return nil }
        if chars[1] == "x", chars[2] == "x" { return String(first) }
        if chars[1].isASCII, chars[1].isNumber, chars[2] == "x" { return String(chars[0...1]) }
        return nil
    }

    /// 搜索状态码：
    /// - 纯数字按前缀匹配（"4" → 4xx，"40" → 400–409，"404" → 404）；"4xx" / "40x" 按通配前缀匹配
    /// - 其他文本按空格拆词，每个词都要命中（码、英文短语、中文名、说明、场景、建议、相关头、关键词）
    /// 结果按匹配度排序：码 / 名称直接命中的排前面，其余按状态码升序。
    public static func search(_ query: String, includeUnofficial: Bool = true, statusClass: Int? = nil) -> [HTTPStatusInfo] {
        let pool = all.filter {
            (includeUnofficial || $0.flag != .unofficial) && (statusClass == nil || classOf($0.code) == statusClass)
        }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return pool }
        if let prefix = codeQueryPrefix(q) { return pool.filter { String($0.code).hasPrefix(prefix) } }
        let terms = q.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        var scored: [(HTTPStatusInfo, Int)] = []
        for s in pool {
            guard let hay = haystacks[s.code], terms.allSatisfy({ hay.contains($0) }) else { continue }
            let title = "\(s.code) \(s.phrase) \(s.zhName)".lowercased()
            var score = 0
            for t in terms {
                if title.contains(t) { score += 2 }
                if s.keywords.contains(where: { $0.lowercased() == t }) { score += 1 }
            }
            scored.append((s, score))
        }
        return scored.sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0.code < $1.0.code }.map(\.0)
    }
}

public enum HTTPStatusTool {
    public static let spec = ToolSpec(
        id: "http-status",
        name: LocalizedText("HTTP 状态码", "HTTP Status Codes"),
        summary: LocalizedText("所有 HTTP 状态码的中文含义与使用场景速查。", "Look up every HTTP status code with its meaning and typical use."),
        category: .network,
        keywords: ["http", "status", "code", "404", "500", "状态码", "ztm"],
        symbol: "server.rack",
        input: .optional,
        inputLabel: LocalizedText("状态码或关键词（如 404、4xx、限流）", "A code or keyword (e.g. 404, 4xx, rate limit)"),
        fields: [
            ToolField("unofficial", LocalizedText("含非标准码", "Include unofficial codes"), .toggle, default: "1",
                      help: LocalizedText("Nginx、Cloudflare 等厂商扩展的状态码", "Vendor codes such as Nginx and Cloudflare")),
        ],
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        var query = input.text.trimmingCharacters(in: .whitespacesAndNewlines)
        // 选中的是一大段文本时只看第一行
        if query.count > 80, let line = query.split(whereSeparator: \.isNewline).first {
            query = String(line.prefix(80)).trimmingCharacters(in: .whitespaces)
        }
        let results = HTTPStatusCatalog.search(query, includeUnofficial: input.bool("unofficial"))
        guard !results.isEmpty else {
            return ToolResult(notes: [ToolNote(.warning, lang.t("没有找到与「\(query)」相关的状态码", "No status code matches “\(query)”"))])
        }
        let columns = lang == .zh ? ["状态码", "名称", "英文短语", "说明"] : ["Code", "Reason phrase", "Description"]
        let rows = results.map { s -> [String] in
            let flag = s.flagLabel(lang).map { lang == .zh ? "（\($0)）" : " (\($0))" } ?? ""
            return lang == .zh
                ? [String(s.code), s.zhName + flag, s.phrase, s.zhDescription]
                : [String(s.code), s.phrase + flag, s.enDescription]
        }
        var outputs: [ToolOutput] = []
        var notes: [ToolNote] = []
        if results.count == 1, let s = results.first {
            outputs = details(s, lang)
        } else {
            notes.append(ToolNote(.info, lang.t("共 \(results.count) 个状态码", "\(results.count) status codes")))
        }
        return ToolResult(outputs: outputs, notes: notes, table: ToolTable(columns: columns, rows: rows))
    }

    static func details(_ s: HTTPStatusInfo, _ lang: Lang) -> [ToolOutput] {
        let cls = s.statusClass
        var out: [ToolOutput] = [
            ToolOutput(id: "status", label: lang.t("状态码", "Status"), value: "\(s.code) \(s.phrase)"),
        ]
        if lang == .zh { out.append(ToolOutput(id: "name", label: "中文名", value: s.zhName, style: .prose)) }
        out.append(ToolOutput(id: "description", label: lang.t("含义", "Meaning"), value: s.description(lang), style: .prose))
        out.append(ToolOutput(
            id: "class", label: lang.t("分类", "Class"),
            value: "\(cls)xx · \(HTTPStatusCatalog.className(cls)(lang)) — \(HTTPStatusCatalog.classDescription(cls)(lang))",
            style: .prose
        ))
        if let flag = s.flagLabel(lang) { out.append(ToolOutput(id: "flag", label: lang.t("状态", "Note"), value: flag, style: .prose)) }
        if lang == .zh {
            out.append(ToolOutput(id: "scenario", label: "典型场景", value: s.zhScenario, style: .prose))
            out.append(ToolOutput(id: "tip", label: "开发建议", value: s.zhTip, style: .prose))
        }
        if !s.headers.isEmpty {
            out.append(ToolOutput(id: "headers", label: lang.t("相关头", "Related headers"), value: s.headers.joined(separator: ", ")))
        }
        if s.cacheable {
            out.append(ToolOutput(id: "cacheable", label: lang.t("缓存", "Caching"),
                                  value: lang.t("默认可被启发式缓存（RFC 9110 §15.1）", "Heuristically cacheable by default (RFC 9110 §15.1)"), style: .prose))
        }
        out.append(ToolOutput(id: "spec", label: lang.t("规范", "Spec"), value: s.specURL.map { "\(s.spec) · \($0)" } ?? s.spec))
        return out
    }
}
