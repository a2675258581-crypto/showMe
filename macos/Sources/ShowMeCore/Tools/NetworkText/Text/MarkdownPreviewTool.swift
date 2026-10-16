import Foundation

public enum MarkdownPreviewTool {
    public static let spec = ToolSpec(
        id: "markdown-preview",
        name: LocalizedText("Markdown 预览", "Markdown Preview"),
        summary: LocalizedText("所见即所得的 Markdown 实时预览，一键导出 HTML。", "Live Markdown preview with one-click HTML export."),
        category: .text,
        keywords: ["markdown", "md", "preview", "html", "预览", "yl"],
        symbol: "doc.richtext",
        input: .required,
        inputLabel: LocalizedText("Markdown 文本", "Markdown text"),
        fields: [
            ToolField("export", LocalizedText("导出完整 HTML", "Export full HTML"), .toggle, default: "0",
                      help: LocalizedText("包上 <html>、标题与内联样式，可以直接保存为 .html 文件打开",
                                          "Wrap in <html> with a title and inline styles, ready to save as an .html file")),
        ],
        customView: "markdown",
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let body = try ToolEnvironment.runScript("markdown", ["code": input.text, "gfm": "1", "breaks": "0"], lang: lang)
        let stats = stats(input.text)
        let note = ToolNote(.info, lang.t(
            "\(stats.words) 字 · \(stats.lines) 行 · 预计阅读 \(readingText(stats.seconds, lang))",
            "\(stats.words) words · \(stats.lines) lines · reading time \(readingText(stats.seconds, lang))"
        ))
        if input.bool("export") {
            let title = documentTitle(html: body, fallback: lang.t("文档", "Document"))
            return ToolResult(outputs: [.primary("HTML", standaloneHTML(body, title: title, lang: lang), language: "html")], notes: [note])
        }
        return ToolResult(outputs: [.primary("HTML", body, language: "html")], notes: [note])
    }

    static func readingText(_ seconds: Int, _ lang: Lang) -> String {
        if seconds > 0, seconds < 60 { return lang.t("不到 1 分钟", "under a minute") }
        return TextToolkit.formatReadingTime(seconds, lang)
    }

    /// 统计时去掉链接地址、HTML 标签、代码围栏等，避免把 URL 算成单词
    public static func stats(_ md: String) -> (words: Int, lines: Int, seconds: Int) {
        var plain = md
        let rules: [(String, String)] = [
            ("!\\[([^\\]]*)\\]\\([^)]*\\)", "$1"),
            ("\\[([^\\]]*)\\]\\([^)]*\\)", "$1"),
            ("<[^>]+>", ""),
            ("https?://\\S+", ""),
        ]
        for (pattern, template) in rules {
            guard let re = try? NSRegularExpression(pattern: pattern) else { continue }
            plain = re.stringByReplacingMatches(in: plain, range: NSRange(location: 0, length: (plain as NSString).length), withTemplate: template)
        }
        if let fence = try? NSRegularExpression(pattern: "^\\s*```.*$", options: [.anchorsMatchLines]) {
            plain = fence.stringByReplacingMatches(in: plain, range: NSRange(location: 0, length: (plain as NSString).length), withTemplate: "")
        }
        let cjk = plain.unicodeScalars.filter(TextToolkit.isHan).count
        let words = TextToolkit.countWords(plain)
        return (cjk + words, TextToolkit.countLines(md), TextToolkit.readingSeconds(cjk: cjk, words: words))
    }

    /// 文档标题：第一个一级标题，其次任意标题
    public static func documentTitle(html: String, fallback: String) -> String {
        for pattern in ["<h1[^>]*>([\\s\\S]*?)</h1>", "<h[2-6][^>]*>([\\s\\S]*?)</h[2-6]>"] {
            guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
                  let m = re.firstMatch(in: html, range: NSRange(location: 0, length: (html as NSString).length)) else { continue }
            let text = htmlToText((html as NSString).substring(with: m.range(at: 1))).trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { return text }
        }
        return fallback
    }

    /// 去掉标签并解码常见实体，得到纯文本
    public static func htmlToText(_ html: String) -> String {
        var s = html
        if let tags = try? NSRegularExpression(pattern: "<[^>]*>") {
            s = tags.stringByReplacingMatches(in: s, range: NSRange(location: 0, length: (s as NSString).length), withTemplate: "")
        }
        guard let ent = try? NSRegularExpression(pattern: "&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);") else { return s }
        let ns = s as NSString
        var out = ""
        var last = 0
        let named: [String: String] = ["amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": "\u{A0}"]
        for m in ent.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let e = ns.substring(with: m.range(at: 1))
            var rep: String?
            if e.hasPrefix("#x") || e.hasPrefix("#X") {
                rep = UInt32(e.dropFirst(2), radix: 16).flatMap(Unicode.Scalar.init).map { String(Character($0)) }
            } else if e.hasPrefix("#") {
                rep = UInt32(e.dropFirst()).flatMap(Unicode.Scalar.init).map { String(Character($0)) }
            } else {
                rep = named[e.lowercased()]
            }
            out += rep ?? ns.substring(with: m.range)
            last = m.range.location + m.range.length
        }
        return out + ns.substring(from: last)
    }

    public static func escapeHTML(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }

    /// 独立 HTML 使用的浅色 GitHub 风格样式
    public static let standaloneCSS = """
    *,*::before,*::after{box-sizing:border-box}
    body{margin:0;background:#f5f5f7;color:#1d1d1f;font:16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
    .markdown-body{max-width:860px;margin:40px auto;padding:48px 56px;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:24px;box-shadow:0 2px 12px rgba(0,0,0,.04),0 12px 32px rgba(0,0,0,.06);word-wrap:break-word}
    @media (max-width:720px){.markdown-body{margin:0;padding:24px 18px;border-radius:0;border:0}}
    .markdown-body>*:first-child{margin-top:0}
    h1,h2,h3,h4,h5,h6{margin:1.6em 0 .6em;font-weight:700;line-height:1.3;letter-spacing:-.01em}
    h1{font-size:2em;padding-bottom:.3em;border-bottom:1px solid rgba(0,0,0,.08)}
    h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid rgba(0,0,0,.08)}
    h3{font-size:1.25em}h4{font-size:1.05em}h5{font-size:.95em}h6{font-size:.9em;color:#6e6e73}
    p,ul,ol,blockquote,table,pre{margin:0 0 1em}
    a{color:#0066cc;text-decoration:none}a:hover{text-decoration:underline}
    ul,ol{padding-left:1.6em}li+li{margin-top:.25em}li>ul,li>ol{margin:.25em 0 0}
    blockquote{padding:.25em 1em;color:#6e6e73;border-left:4px solid #0071e3;background:rgba(0,113,227,.06);border-radius:0 12px 12px 0}
    blockquote>:last-child{margin-bottom:0}
    code{font-family:"SF Mono",ui-monospace,Menlo,Consolas,"Liberation Mono",monospace;font-size:.875em}
    :not(pre)>code{padding:.15em .4em;background:rgba(120,120,128,.12);border-radius:6px}
    pre{padding:14px 16px;overflow:auto;line-height:1.6;border:1px solid rgba(0,0,0,.08);border-radius:14px;background:#fbfbfd}
    pre code{font-size:13px}
    table{border-collapse:collapse;display:block;max-width:100%;overflow-x:auto}
    th,td{padding:8px 14px;border:1px solid rgba(0,0,0,.1)}
    th{background:rgba(120,120,128,.08);font-weight:600}
    tr:nth-child(2n) td{background:rgba(120,120,128,.04)}
    hr{height:1px;margin:2em 0;border:0;background:rgba(0,0,0,.1)}
    img{max-width:100%;border-radius:12px}
    del{color:#86868b}
    """

    /// 生成可以单独打开的 HTML 文件（内联 CSS，浅色主题）
    public static func standaloneHTML(_ bodyHTML: String, title: String, lang: Lang = .zh) -> String {
        """
        <!doctype html>
        <html lang="\(lang == .zh ? "zh-CN" : "en")">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="generator" content="showMe">
        <title>\(escapeHTML(title))</title>
        <style>
        \(standaloneCSS)
        </style>
        </head>
        <body>
        <article class="markdown-body">
        \(bodyHTML)
        </article>
        </body>
        </html>

        """
    }
}
