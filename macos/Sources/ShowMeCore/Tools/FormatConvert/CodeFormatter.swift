import Foundation

/// 代码格式化：交给 App 内置的 prettier（脚本引擎）；这里负责参数映射、语言识别与错误翻译。
public enum CodeFormatter {
    /// 可选的语言
    public enum Language: String, Sendable, Hashable, CaseIterable {
        case javascript, typescript, jsx, css, scss, less, html, vue, markdown, yaml, graphql

        public var label: String {
            switch self {
            case .javascript: "JavaScript"
            case .typescript: "TypeScript"
            case .jsx: "JSX"
            case .css: "CSS"
            case .scss: "SCSS"
            case .less: "Less"
            case .html: "HTML"
            case .vue: "Vue"
            case .markdown: "Markdown"
            case .yaml: "YAML"
            case .graphql: "GraphQL"
            }
        }

        /// prettier 的 parser
        public var parser: String {
            switch self {
            case .javascript, .jsx: "babel"
            case .typescript: "babel-ts"
            case .css, .scss, .less, .html, .vue, .markdown, .yaml, .graphql: rawValue
            }
        }

        /// 编辑器语言 id
        public var editorLanguage: String {
            switch self {
            case .javascript, .jsx: "javascript"
            case .typescript: "typescript"
            case .vue: "html"
            default: rawValue
            }
        }

        /// 能用分号 / 尾随逗号选项的语言（脚本或内嵌脚本）
        var isScript: Bool { [.javascript, .typescript, .jsx, .html, .vue, .markdown].contains(self) }
    }

    /// 自动识别的结果（比可选语言多几种）
    public enum Detected: String, Sendable, Hashable, CaseIterable {
        case javascript, jsx, typescript, tsx, json, json5, css, scss, less, html, vue, angular, markdown, yaml, graphql

        public var label: String {
            switch self {
            case .tsx: "TSX"
            case .json: "JSON"
            case .json5: "JSON5"
            case .angular: "Angular"
            case .javascript: Language.javascript.label
            case .jsx: Language.jsx.label
            case .typescript: Language.typescript.label
            case .css: Language.css.label
            case .scss: Language.scss.label
            case .less: Language.less.label
            case .html: Language.html.label
            case .vue: Language.vue.label
            case .markdown: Language.markdown.label
            case .yaml: Language.yaml.label
            case .graphql: Language.graphql.label
            }
        }

        public var parser: String {
            switch self {
            case .javascript, .jsx: "babel"
            case .typescript, .tsx: "babel-ts"
            case .json, .json5: "json5"
            case .angular: "html"
            default: rawValue
            }
        }

        public var editorLanguage: String {
            switch self {
            case .javascript, .jsx, .json5: "javascript"
            case .typescript, .tsx: "typescript"
            case .vue, .angular: "html"
            default: rawValue
            }
        }

        var isScript: Bool { [.javascript, .jsx, .typescript, .tsx, .html, .vue, .angular, .markdown].contains(self) }
    }

    public struct Options: Sendable, Hashable {
        public var tabWidth: Int
        public var useTabs: Bool
        public var printWidth: Int
        public var singleQuote: Bool
        public var semi: Bool
        /// all / es5 / none
        public var trailingComma: String

        public init(tabWidth: Int = 2, useTabs: Bool = false, printWidth: Int = 80, singleQuote: Bool = false, semi: Bool = true, trailingComma: String = "all") {
            self.tabWidth = tabWidth
            self.useTabs = useTabs
            self.printWidth = printWidth
            self.singleQuote = singleQuote
            self.semi = semi
            self.trailingComma = trailingComma
        }
    }

    /// 脚本引擎 `format` 的参数（键名与取值是与 App 约定好的）
    public static func engineArgs(_ code: String, parser: String, options o: Options) -> [String: String] {
        [
            "code": code,
            "parser": parser,
            "tabWidth": o.tabWidth == 4 ? "4" : "2",
            "useTabs": o.useTabs ? "1" : "0",
            "printWidth": String(o.printWidth),
            "singleQuote": o.singleQuote ? "1" : "0",
            "semi": o.semi ? "1" : "0",
            "trailingComma": ["all", "es5", "none"].contains(o.trailingComma) ? o.trailingComma : "all",
        ]
    }

    /// 用 prettier 格式化；解析错误整理成「第 L 行第 C 列：中文说明」
    public static func format(_ code: String, parser: String, options: Options = Options(), lang: Lang = .zh) throws -> String {
        if FC.isJSBlank(code) { return "" }
        do {
            return try ToolEnvironment.runScript("format", engineArgs(code, parser: parser, options: options), lang: lang)
        } catch let e as ToolError {
            if ToolEnvironment.script == nil { throw e }
            throw describe(e, code: code, lang: lang)
        }
    }

    // MARK: - 错误整理

    /// 模式都是写死的常量；万一写错返回 nil（当作不匹配），而不是崩溃
    static func regex(_ p: String, _ o: NSRegularExpression.Options = []) -> NSRegularExpression? {
        try? NSRegularExpression(pattern: p, options: o)
    }

    /// prettier / babel / postcss / yaml / graphql 的英文报错 → 中文
    static let translations: [(NSRegularExpression, String)] = [
        // Babel / TypeScript
        ("^Unexpected token, expected \"(.+)\"$", "意外的符号，此处应为 \"$1\""),
        ("^Unexpected token$", "意外的符号"),
        ("^Unexpected token:? (.+)$", "意外的符号 $1"),
        ("^Unterminated string constant$", "字符串没有闭合"),
        ("^Unterminated template$", "模板字符串没有闭合"),
        ("^Unterminated regular expression$", "正则表达式没有闭合"),
        ("^Unterminated comment$", "注释没有闭合"),
        ("^Unterminated JSX contents$", "JSX 内容没有闭合"),
        ("^Unterminated string literal$", "字符串没有闭合"),
        ("^Unterminated template literal$", "模板字符串没有闭合"),
        ("^Expected corresponding JSX closing tag for <(.+)>$", "缺少与 <$1> 对应的结束标签"),
        ("^Missing semicolon$", "缺少分号"),
        ("^Unexpected keyword '(.+)'$", "意外的关键字 '$1'"),
        ("^Unexpected reserved word '(.+)'$", "意外的保留字 '$1'"),
        ("^Identifier '(.+)' has already been declared$", "标识符 '$1' 重复声明"),
        ("^'(.+)' expected$", "此处应为 '$1'"),
        ("^Expression expected$", "此处应为表达式"),
        ("^Declaration or statement expected$", "此处应为声明或语句"),
        ("^Identifier expected$", "此处应为标识符"),
        ("^Property assignment expected$", "此处应为属性（key: value）"),
        ("^Argument expression expected$", "此处应为参数表达式"),
        ("^Type expected$", "此处应为类型"),
        ("^Invalid character$", "无效的字符"),
        ("^Unexpected character '(.+)'$", "意外的字符 '$1'"),
        ("^Unexpected end of input$", "代码意外结束（可能缺少括号或引号）"),
        ("^Unexpected end of file$", "代码意外结束（可能缺少括号或引号）"),
        ("^JSX expressions must have one parent element$", "JSX 表达式必须只有一个根元素（可用 <>…</> 包裹）"),
        ("^Adjacent JSX elements must be wrapped in an enclosing tag.*$", "相邻的 JSX 元素必须用一个父元素包裹（可用 <>…</>）"),
        // PostCSS
        ("^Unclosed block$", "代码块没有闭合，缺少 }"),
        ("^Unclosed bracket$", "括号没有闭合"),
        ("^Unclosed string$", "字符串没有闭合"),
        ("^Unclosed comment$", "注释没有闭合"),
        ("^Unknown word (.+)$", "无法识别的内容：$1"),
        ("^Unknown word$", "无法识别的内容（可能缺少分号或冒号）"),
        ("^Unexpected \\}$", "多余的 }"),
        ("^Missed semicolon$", "缺少分号"),
        ("^Double colon$", "多余的冒号"),
        // HTML / Angular / Vue
        ("^Unexpected closing tag \"(.+?)\"\\.?.*$", "意外的结束标签 </$1>：它可能已被其他标签提前闭合，或缺少对应的开始标签"),
        ("^Unexpected character \"EOF\".*$", "文件意外结束（可能有标签或引号没有闭合）"),
        ("^Unexpected character \"(.+)\"$", "意外的字符 \"$1\""),
        ("^Opening tag \"(.+)\" not terminated\\.?$", "开始标签 <$1> 没有写完（缺少 >）"),
        ("^Only void, custom and foreign elements can be self closed \"(.+)\"$", "<$1> 不能自闭合，请写成 <$1></$1>"),
        // YAML
        ("^All mapping items must start at the same column$", "同一映射中的所有键必须从同一列开始（检查缩进）"),
        ("^All sequence items must start at the same column$", "同一列表中的所有项必须从同一列开始（检查缩进）"),
        ("^Implicit map keys need to be followed by map values$", "键后面缺少冒号或值"),
        ("^Implicit keys need to be on a single line$", "键不能跨行（可能缺少冒号）"),
        ("^Nested mappings are not allowed in compact mappings$", "同一行中不能嵌套映射（冒号后需要换行或加引号）"),
        ("^Map keys must be unique.*$", "映射中的键重复"),
        ("^Missing closing \"?quote$", "引号没有闭合"),
        ("^Tabs are not allowed as indentation.*$", "YAML 缩进不能使用 Tab"),
        // GraphQL
        ("^Expected (.+), found (.+?)\\.?$", "此处应为 $1，却遇到了 $2"),
        ("^Unexpected (.+?)\\.?$", "意外的 $1"),
        ("^Unterminated string\\.?$", "字符串没有闭合"),
    ].compactMap { p in regex(p.0).map { ($0, p.1) } }

    /// 已知的报错翻译成中文；不认识时返回 nil
    public static func translate(_ message: String) -> String? {
        var m0 = message
        if m0.hasSuffix(".") { m0.removeLast() }
        let ns = m0 as NSString
        let range = NSRange(location: 0, length: ns.length)
        for (re, template) in translations {
            if let match = re.firstMatch(in: m0, range: range) {
                return re.replacementString(for: match, in: m0, offset: 0, template: template)
            }
        }
        return nil
    }

    static let ansi = regex("\u{1B}\\[[0-9;]*[A-Za-z]")
    static let trailingPosition = regex("\\s*\\((\\d+):(\\d+)\\)\\s*$")
    static let errorPrefix = regex("^(CssSyntaxError|SyntaxError|Syntax Error|YAMLSemanticError|YAMLSyntaxError):\\s*", [.caseInsensitive])
    static let cssInput = regex("^<css input>:\\d+:\\d+:\\s*")
    static let moreInfo = regex("\\s*For more info see https?://\\S+")
    static let mayHappen = regex("\\s*It may happen when[^.]*\\.")

    static func replace(_ re: NSRegularExpression?, in s: String, with t: String = "") -> String {
        guard let re else { return s }
        return re.stringByReplacingMatches(in: s, range: NSRange(location: 0, length: (s as NSString).length), withTemplate: t)
    }

    /// 解析器给出的列号按 UTF-16 计，这里换算成按码点计（emoji 算 1 列）
    static func pointColumn(_ code: String, line: Int, unitColumn: Int) -> Int {
        let lines = FC.lines(code)
        guard line >= 1, line <= lines.count else { return unitColumn }
        var units = 0, col = 1
        for s in lines[line - 1].unicodeScalars {
            guard units < unitColumn - 1 else { break }
            units += s.utf16.count
            col += 1
        }
        return col
    }

    static func describe(_ e: ToolError, code: String, lang: Lang) -> ToolError {
        let raw = replace(ansi, in: e.message)
        if raw.range(of: "Maximum call stack size exceeded", options: .caseInsensitive) != nil {
            return ToolError(lang.t("嵌套层级过深，超出了格式化引擎的处理能力", "The code is nested too deeply for the formatter"))
        }
        let firstLine = String(raw.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" || $0 == "\r\n" }).first ?? Substring(raw))
        if raw.contains("ConfigError") || raw.contains("Couldn't resolve parser") || raw.contains("Couldn't find plugin") {
            return ToolError(lang.t("格式化器配置错误：", "Formatter configuration error: ") + firstLine)
        }
        var line = e.line, column = e.column
        if line == nil, let m = trailingPosition?.firstMatch(in: firstLine, range: NSRange(location: 0, length: (firstLine as NSString).length)) {
            let ns = firstLine as NSString
            line = Int(ns.substring(with: m.range(at: 1)))
            column = Int(ns.substring(with: m.range(at: 2)))
        }
        var first = FC.jsTrim(firstLine)
        first = replace(trailingPosition, in: first)
        first = replace(errorPrefix, in: first)
        first = replace(cssInput, in: first)
        first = replace(moreInfo, in: first)
        first = replace(mayHappen, in: first)
        first = FC.jsTrim(first)
        if first.isEmpty { first = lang.t("无法解析代码", "Could not parse the code") }
        let message = lang == .zh ? (translate(first) ?? first) : first
        guard let l = line else { return ToolError(message) }
        let c = pointColumn(code, line: l, unitColumn: column ?? 1)
        return ToolError(lang.t("第 \(l) 行第 \(c) 列：", "Line \(l), column \(c): ") + message, line: l, column: c)
    }
}
