import Foundation

// 根据内容猜测代码语言（与网页版的打分规则一致）：
// 先处理特征明确的（JSON、标记语言），再给脚本 / 样式 / Markdown / YAML / GraphQL 打分。
// 注意：ICU 正则的字符类里 [ 要转义，{ } 一律转义。

extension CodeFormatter {
    struct Pattern {
        let re: NSRegularExpression?

        init(_ p: String, lines: Bool = false, ignoreCase: Bool = false) {
            var o: NSRegularExpression.Options = []
            if lines { o.insert(.anchorsMatchLines) }
            if ignoreCase { o.insert(.caseInsensitive) }
            re = try? NSRegularExpression(pattern: p, options: o)
        }

        func count(_ s: String) -> Int {
            re?.numberOfMatches(in: s, range: NSRange(location: 0, length: (s as NSString).length)) ?? 0
        }

        func test(_ s: String) -> Bool {
            re?.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
        }
    }

    /// 行首是这些词时不可能是 CSS 选择器
    static let scriptWords = "interface|class|function|if|for|while|switch|type|enum|namespace|export|import|const|let|var|return|else|try|catch|do|async|declare|abstract"

    enum Detect {
        static let leadingComment = Pattern("^\\s*(//[^\\n]*\\n?|/\\*[\\s\\S]*?\\*/)")
        static let scriptKeyword = Pattern("\\b(function|const|let|var|return|import|export|class|if|for|while)\\b|=>|;\\s*$", lines: true)
        static let json5Key = Pattern("(^|[\\{,])\\s*[\"']?[\\w$-]+[\"']?\\s*:\\s*\\S", lines: true)
        static let blockStart = Pattern("^\\s*\\w+\\s*(\\([^)]*\\))?\\s*\\{\\s*$", lines: true)

        static let vueTemplate = Pattern("^<template[\\s>]", lines: true, ignoreCase: true)
        static let vueClose = Pattern("</template>", ignoreCase: true)
        static let angular = Pattern(
            "\\*ng(If|For|Switch\\w*|Template\\w*)\\s*=|\\[\\(ngModel\\)\\]|\\s\\(\\w+(\\.\\w+)*\\)\\s*=\\s*\"|\\s\\[[\\w.-]+\\]\\s*=\\s*\"|@(if|for|switch|defer)\\s*\\(|\\{\\{[^}]*\\|\\s*[a-z]\\w*"
        )
        static let doctypeOrHtml = Pattern("^<!doctype|^<html", ignoreCase: true)
        static let jsxAttr = Pattern("\\s[a-zA-Z-]+=\\{")
        static let className = Pattern("\\bclassName=")

        static let comment = Pattern("^\\s*#")
        static let yamlLine = Pattern("^\\s*(- +)?([\"'][^\"']+[\"']|[\\w./-][\\w ./-]*?)\\s*:(\\s+[^\\s\\{;][^;]*?|\\s*[|>][-+]?\\d*|\\s*&\\w+|\\s*)$")
        static let yamlLineEnd = Pattern("[;\\{]\\s*$")
        static let yamlLineComment = Pattern("^\\s*(//|/\\*|\\*)")
        static let yamlItem = Pattern("^\\s*- +[^\\s:]")
        static let yamlSeparator = Pattern("^---\\s*$", lines: true)
        static let yamlEmptyKey = Pattern("^\\s*[\\w-]+:\\s*$", lines: true)
        static let loneBrace = Pattern("^\\s*\\}\\s*$", lines: true)

        static let mdHeading = Pattern("^#{1,6}\\s+\\S", lines: true)
        static let mdFence = Pattern("^\\s*(```|~~~)", lines: true)
        static let mdLink = Pattern("\\[[^\\]\\n]+\\]\\([^)\\s]+\\)")
        static let mdBold = Pattern("\\*\\*[^*\\n]+\\*\\*")
        static let mdQuote = Pattern("^>\\s", lines: true)
        static let mdTable = Pattern("^\\|.*\\|\\s*$", lines: true)
        static let mdList = Pattern("^\\s*([-*+]|\\d+\\.)\\s+\\S", lines: true)
        static let mdProse = Pattern("^[^\\n<>\\{\\};=]{20,}$", lines: true)

        static let gqlOperation = Pattern("^\\s*(query|mutation|subscription)\\b\\s*\\w*\\s*(\\([^)]*\\))?\\s*(@\\w+\\s*)*\\{", lines: true)
        static let gqlFragment = Pattern("^\\s*fragment\\s+\\w+\\s+on\\s+\\w+", lines: true)
        static let gqlShorthand = Pattern("^\\{\\s*\\w+(\\([^)]*\\))?\\s*\\{")
        static let gqlDefinition = Pattern("^\\s*(type|input|enum|union|scalar|schema|directive|extend)\\s+\\w+[^=;\\n]*(\\{|$)", lines: true)
        static let gqlSpread = Pattern("\\.\\.\\.\\s*(on\\s+)?[A-Z]\\w*")
        static let gqlVariable = Pattern("\\$\\w+\\s*:\\s*\\[?\\w+!?\\]?!?")
        static let gqlField = Pattern("^\\s*\\w+(\\([^)]*\\))?\\s*:\\s*\\[?\\w+!?\\]?!?\\s*$", lines: true)
        static let gqlNonNull = Pattern("\\b[A-Z]\\w*!")

        static let cssRule = Pattern("^\\s*(?!(\(CodeFormatter.scriptWords))\\b)([.#][\\w-]+|:root|\\*|[a-z][\\w-]*(\\s*[>+~]\\s*[\\w.#-]+)*)[^\\n\\{\\}=();]*\\{\\s*$", lines: true)
        /// 单行规则 `.a{color:red}`：属性选择器里的 = 只能出现在 [...] 中，否则 `const x = {a:1}` 会被误判成 CSS
        static let cssOneLine = Pattern("^[ \\t]*(?!(\(CodeFormatter.scriptWords))\\b)(?:[.#:\\w*>+~ ,-]|\\[[^\\]\\n]*\\])+\\{[^\\{\\}()=\\n]*:[^\\{\\}()=\\n]*\\}[ \\t]*$", lines: true)
        static let cssDeclaration = Pattern("^\\s*[a-z-]+\\s*:\\s*[^;\\{\\}\\n]+;\\s*$", lines: true)
        static let cssBlock = Pattern("[.#][\\w-]+\\s*\\{|\\w+\\s*\\{")
        static let cssAt = Pattern("@(media|keyframes|font-face|supports|layer|import\\s+url)\\b")
        static let cssUnit = Pattern("\\d(px|rem|em|vh|vw|ms|deg)\\b")
        static let cssColor = Pattern("#[0-9a-fA-F]{3,8}\\b")
        static let cssImportant = Pattern("!important")
        static let cssPseudo = Pattern("(^|[\\s,])(&)?:(hover|focus|active|before|after|root|not\\(|nth-child)", lines: true)
        static let scssVariable = Pattern("^\\s*\\$[\\w-]+\\s*:", lines: true)
        static let scssAt = Pattern("@(mixin|include|extend|use|forward|each|function|return)\\b")
        static let scssInterpolation = Pattern("#\\{")
        static let scssParent = Pattern("&[-_:.\\w]")
        static let lessVariable = Pattern("^\\s*@[\\w-]+\\s*:", lines: true)
        static let lessMixinCall = Pattern("\\.[\\w-]+\\s*\\([^)]*\\)\\s*;")
        static let lessGuard = Pattern("\\bwhen\\s*\\(")
        static let lessInterpolation = Pattern("@\\{[\\w-]+\\}")
        static let lessEscape = Pattern("~[\"']")
        static let lessFunction = Pattern("\\bfade\\(|\\bspin\\(")

        static let scriptKeywords = Pattern("\\b(const|let|var|function|return|import|export|require|async|await|new|this|typeof|class|extends|throw)\\b")
        static let arrow = Pattern("=>")
        static let semicolonEnd = Pattern(";\\s*$", lines: true)
        static let globals = Pattern("\\b(console|document|window|Math|JSON|Promise|Array|Object)\\.\\w+")
        static let call = Pattern("\\w+\\([^)]*\\)\\s*\\{")
        static let control = Pattern("\\b(if|for|while|switch)\\s*\\(")
        static let codeChars = Pattern("[;\\{\\}()=]")

        static let tsSignals: [Pattern] = [
            Pattern("\\binterface\\s+\\w+(\\s*<[^>]*>)?\\s*(extends\\s+[\\w<>, .]+)?\\s*\\{[^}]*[;,]"),
            Pattern("\\btype\\s+\\w+(\\s*<[^>]*>)?\\s*="),
            Pattern("[\\w)\\]?]\\s*:\\s*(string|number|boolean|any|unknown|void|never|object|bigint|symbol|null|undefined)\\b(\\[\\])?\\s*[;,)=|&>\\]]"),
            Pattern("\\)\\s*:\\s*[\\w<>\\[\\]|., ]+\\s*(\\{|=>)"),
            Pattern("\\b(as\\s+const|satisfies|keyof|implements|declare\\s+(const|module|global)|namespace\\s+\\w+|abstract\\s+class)\\b"),
            Pattern("\\b(public|private|protected|readonly)\\s+\\w+\\s*[:=(;?]"),
            Pattern("\\bimport\\s+type\\b|\\bexport\\s+type\\b"),
            Pattern("\\b\\w+<(string|number|boolean|any|unknown|[A-Z][\\w, <>\\[\\]|]*)(\\[\\])?>\\s*\\("),
            Pattern("\\benum\\s+\\w+\\s*\\{"),
            Pattern("\\w+\\?:\\s*[\\w'\"\\[\\{(]"),
            Pattern(":\\s*[A-Z]\\w*(<[^>]+>)?(\\[\\])?\\s*[;,)=]"),
            Pattern("\\bas\\s+[A-Z]\\w*"),
        ]
        /// 标签前必须是表达式起始位置（排除 Promise<T>、useState<string>() 这类泛型）
        static let jsxOpenTag = Pattern("(^|[(>\\{?:,=&|]|\\breturn)\\s*<([A-Za-z][\\w.]*)(\\s[^<>]*)?/?>(?!\\s*\\()", lines: true)
        static let jsxCloseTag = Pattern("</[A-Za-z][\\w.]*>|/>")
        static let fragment = Pattern("<>|</>")
    }

    static func scriptTs(_ s: String) -> Bool { Detect.tsSignals.contains { $0.test(s) } }

    static func scriptJsx(_ s: String) -> Bool {
        (Detect.jsxOpenTag.test(s) && Detect.jsxCloseTag.test(s)) || Detect.className.test(s) || Detect.fragment.test(s)
    }

    static func stripLeadingComments(_ s: String) -> String {
        var out = s
        while let re = Detect.leadingComment.re,
              let m = re.firstMatch(in: out, range: NSRange(location: 0, length: (out as NSString).length)), m.range.length > 0 {
            out = (out as NSString).substring(from: m.range.length)
        }
        return String(out.unicodeScalars.drop(while: FC.isJSWhitespace))
    }

    /// 根据内容猜测语言；空内容返回 nil
    public static func detectLanguage(_ input: String) -> Detected? {
        var src = input
        if src.hasPrefix("\u{FEFF}") { src.removeFirst() }
        src = FC.jsTrim(src)
        guard !src.isEmpty else { return nil }
        let head = src.unicodeScalars.count > 20000 ? String(String.UnicodeScalarView(src.unicodeScalars.prefix(20000))) : src

        // JSON / JSON5
        let body = stripLeadingComments(head)
        if body.hasPrefix("{") || body.hasPrefix("[") {
            if body == head, src.utf8.count < 5_000_000, (try? JSON.value(src)) != nil { return .json }
            let tail = src.unicodeScalars.last
            if tail == "}" || tail == "]",
               !Detect.scriptKeyword.test(body), Detect.json5Key.test(body), !Detect.blockStart.test(body) {
                return .json5
            }
        }

        // 标记语言
        if head.hasPrefix("<") {
            if Detect.vueTemplate.test(head) && Detect.vueClose.test(head) { return .vue }
            if Detect.angular.test(head) { return .angular }
            if !Detect.doctypeOrHtml.test(head) && (Detect.jsxAttr.test(head) || Detect.className.test(head)) {
                return scriptTs(head) ? .tsx : .jsx
            }
            return .html
        }

        // 打分
        let lines = FC.lines(head)
        let meaningful = lines.filter { !FC.isJSBlank($0) && !Detect.comment.test($0) }
        var yamlHits = 0
        for l in meaningful {
            let line = Detect.yamlLine.test(l) && !Detect.yamlLineEnd.test(l) && !Detect.yamlLineComment.test(l)
            if line || Detect.yamlItem.test(l) { yamlHits += 1 }
        }
        let yamlRatio = meaningful.isEmpty ? 0 : Double(yamlHits) / Double(meaningful.count)
        var yaml = yamlRatio >= 0.6 ? 6 + Double(yamlHits) * 1.5 + 4 * Double(Detect.yamlSeparator.count(head)) : 0
        if Detect.yamlEmptyKey.test(head) && yamlRatio >= 0.5 { yaml += 3 }
        // 单独一行的 } 基本不会出现在 YAML 里（GraphQL / 脚本 / 样式才会）
        if Detect.loneBrace.test(head) { yaml *= 0.2 }

        func c(_ p: Pattern) -> Double { Double(p.count(head)) }
        let markdown = 3 * c(Detect.mdHeading) + 3 * c(Detect.mdFence) + 2 * c(Detect.mdLink) + 2 * c(Detect.mdBold)
            + 2 * c(Detect.mdQuote) + 2 * c(Detect.mdTable) + c(Detect.mdList) + c(Detect.mdProse) * 0.5
        let graphql = 6 * c(Detect.gqlOperation) + 6 * c(Detect.gqlFragment) + 6 * c(Detect.gqlShorthand) + 3 * c(Detect.gqlDefinition)
            + 3 * c(Detect.gqlSpread) + 2 * c(Detect.gqlVariable) + c(Detect.gqlField) + c(Detect.gqlNonNull)
        let declarationWeight = Detect.cssBlock.test(head) ? 1.0 : 0.2
        let cssBase = 3 * c(Detect.cssRule) + 3 * c(Detect.cssOneLine) + 2 * c(Detect.cssDeclaration) * declarationWeight
            + 3 * c(Detect.cssAt) + c(Detect.cssUnit) + c(Detect.cssColor) * 0.5 + 2 * c(Detect.cssImportant) + 2 * c(Detect.cssPseudo)
        let scss = 3 * c(Detect.scssVariable) + 3 * c(Detect.scssAt) + 2 * c(Detect.scssInterpolation) + c(Detect.scssParent) * 0.5
        let less = 3 * c(Detect.lessVariable) + 3 * c(Detect.lessMixinCall) + 3 * c(Detect.lessGuard) + 3 * c(Detect.lessInterpolation)
            + 2 * c(Detect.lessEscape) + 2 * c(Detect.lessFunction)
        let style = cssBase > 0 || scss > 0 || less > 0 ? cssBase + max(scss, less) : 0
        let isTs = scriptTs(head)
        let script = 2 * c(Detect.scriptKeywords) + 2 * c(Detect.arrow) + c(Detect.semicolonEnd) * 0.5 + c(Detect.globals) * 2
            + c(Detect.call) + c(Detect.control) + (isTs ? 6 : 0)

        // 同分时保持这个顺序（与 JS 的稳定排序一致）
        let scores: [(String, Double)] = [("yaml", yaml), ("markdown", markdown), ("graphql", graphql), ("style", style), ("script", script)]
        var best = scores[0]
        for s in scores.dropFirst() where s.1 > best.1 { best = s }
        if best.1 <= 0 { return Detect.codeChars.test(head) ? .javascript : .markdown }
        switch best.0 {
        case "style":
            if scss > 0 && scss >= less { return .scss }
            return less > 0 ? .less : .css
        case "script":
            let jsx = scriptJsx(head)
            return isTs ? (jsx ? .tsx : .typescript) : (jsx ? .jsx : .javascript)
        case "yaml": return .yaml
        case "markdown": return .markdown
        default: return .graphql
        }
    }
}
