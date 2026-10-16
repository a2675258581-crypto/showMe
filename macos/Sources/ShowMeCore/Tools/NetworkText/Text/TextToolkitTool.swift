import Foundation

public enum TextToolkitTool {
    static func op(_ id: String) -> ToolCondition { ToolCondition("op", is: id) }

    public static let spec = ToolSpec(
        id: "text-toolkit",
        name: LocalizedText("文本处理", "Text Toolkit"),
        summary: LocalizedText("字数统计、去重、排序、去空行、加行号、大小写等批量处理。", "Count words, dedupe, sort, remove empty lines, number lines, change case and more."),
        category: .text,
        keywords: ["text", "count", "word", "dedupe", "sort", "lines", "字数", "统计", "去重", "排序", "wbcl", "zstj"],
        symbol: "text.alignleft",
        input: .optional,
        inputLabel: LocalizedText("要处理的文本", "Text to process"),
        fields: [
            ToolField("op", LocalizedText("操作", "Operation"), .choice([
                ToolChoice("stats", LocalizedText("字数统计", "Statistics")),
                ToolChoice("dedupe", LocalizedText("去重行", "Remove duplicate lines")),
                ToolChoice("sort", LocalizedText("排序", "Sort lines")),
                ToolChoice("trim", LocalizedText("去首尾空白", "Trim lines")),
                ToolChoice("removeEmpty", LocalizedText("去空行", "Remove empty lines")),
                ToolChoice("collapse", LocalizedText("合并空格", "Collapse spaces")),
                ToolChoice("addNumbers", LocalizedText("添加行号", "Add line numbers")),
                ToolChoice("removeNumbers", LocalizedText("去除行号", "Remove line numbers")),
                ToolChoice("affix", LocalizedText("加前缀 / 后缀", "Add prefix / suffix")),
                ToolChoice("case", LocalizedText("大小写", "Change case")),
                ToolChoice("halfWidth", LocalizedText("全角 → 半角", "Full-width → half-width")),
                ToolChoice("fullWidth", LocalizedText("半角 → 全角", "Half-width → full-width")),
                ToolChoice("extract", LocalizedText("提取", "Extract")),
                ToolChoice("replace", LocalizedText("查找替换", "Find and replace")),
                ToolChoice("join", LocalizedText("行 → 逗号列表", "Lines → list")),
                ToolChoice("split", LocalizedText("逗号列表 → 行", "List → lines")),
            ]), default: "stats"),
            // 去重
            ToolField("dedupeIgnoreCase", LocalizedText("忽略大小写", "Ignore case"), .toggle, default: "0", visibleWhen: op("dedupe")),
            ToolField("dedupeTrim", LocalizedText("忽略首尾空白", "Ignore leading / trailing spaces"), .toggle, default: "1", visibleWhen: op("dedupe")),
            ToolField("dedupeKeepEmpty", LocalizedText("保留空行", "Keep empty lines"), .toggle, default: "0", visibleWhen: op("dedupe")),
            // 排序
            ToolField("sortMode", LocalizedText("排序方式", "Order"), .choice([
                ToolChoice("asc", LocalizedText("升序", "Ascending")),
                ToolChoice("desc", LocalizedText("降序", "Descending")),
                ToolChoice("natural", LocalizedText("自然排序", "Natural")),
                ToolChoice("length", LocalizedText("按长度", "By length")),
                ToolChoice("reverse", LocalizedText("反转", "Reverse")),
                ToolChoice("shuffle", LocalizedText("随机打乱", "Shuffle")),
            ]), default: "asc", visibleWhen: op("sort")),
            // 行号
            ToolField("lnStart", LocalizedText("起始编号", "Start at"), .number(min: 0, max: 1_000_000), default: "1", visibleWhen: op("addNumbers")),
            ToolField("lnSeparator", LocalizedText("分隔符", "Separator"), .text(placeholder: LocalizedText(". ", ". ")), default: ". ", visibleWhen: op("addNumbers")),
            ToolField("lnPad", LocalizedText("补齐宽度", "Pad numbers"), .toggle, default: "0", visibleWhen: op("addNumbers")),
            ToolField("lnNumberEmpty", LocalizedText("空行也编号", "Number empty lines"), .toggle, default: "1", visibleWhen: op("addNumbers")),
            // 前后缀
            ToolField("prefix", LocalizedText("前缀", "Prefix"), .text(), default: "- ", visibleWhen: op("affix")),
            ToolField("suffix", LocalizedText("后缀", "Suffix"), .text(), visibleWhen: op("affix")),
            ToolField("affixSkipEmpty", LocalizedText("跳过空行", "Skip empty lines"), .toggle, default: "1", visibleWhen: op("affix")),
            // 大小写
            ToolField("caseMode", LocalizedText("转换为", "Convert to"), .choice([
                ToolChoice("upper", LocalizedText("大写", "UPPER CASE")),
                ToolChoice("lower", LocalizedText("小写", "lower case")),
                ToolChoice("title", LocalizedText("首字母大写", "Title Case")),
                ToolChoice("sentence", LocalizedText("句首大写", "Sentence case")),
            ]), default: "upper", visibleWhen: op("case")),
            // 提取
            ToolField("extractKind", LocalizedText("提取内容", "Extract"), .choice([
                ToolChoice("email", LocalizedText("邮箱", "Emails")),
                ToolChoice("url", LocalizedText("URL", "URLs")),
                ToolChoice("number", LocalizedText("数字", "Numbers")),
                ToolChoice("phone", LocalizedText("手机号", "Phone numbers")),
                ToolChoice("ip", LocalizedText("IP", "IP addresses")),
            ]), default: "email", visibleWhen: op("extract")),
            ToolField("extractUnique", LocalizedText("去重", "Unique only"), .toggle, default: "1", visibleWhen: op("extract")),
            // 查找替换
            ToolField("find", LocalizedText("查找", "Find"), .text(), visibleWhen: op("replace")),
            ToolField("replaceWith", LocalizedText("替换为", "Replace with"), .text(), visibleWhen: op("replace")),
            ToolField("findRegex", LocalizedText("正则表达式", "Regular expression"), .toggle, default: "0", visibleWhen: op("replace")),
            ToolField("findCase", LocalizedText("区分大小写", "Match case"), .toggle, default: "0", visibleWhen: op("replace")),
            // 列表
            ToolField("joinQuote", LocalizedText("引号", "Quotes"), .choice([
                ToolChoice("none", LocalizedText("无", "None")),
                ToolChoice("single", LocalizedText("单引号", "Single")),
                ToolChoice("double", LocalizedText("双引号", "Double")),
                ToolChoice("backtick", LocalizedText("反引号", "Backtick")),
            ]), default: "single", visibleWhen: op("join")),
            ToolField("joinSeparator", LocalizedText("分隔符", "Separator"), .text(), default: ", ", visibleWhen: op("join")),
            ToolField("joinWrap", LocalizedText("外层括号", "Wrap in"), .choice([
                ToolChoice("none", LocalizedText("无", "None")),
                ToolChoice("paren", LocalizedText("( )", "( )")),
                ToolChoice("bracket", LocalizedText("[ ]", "[ ]")),
                ToolChoice("brace", LocalizedText("{ }", "{ }")),
            ]), default: "paren", visibleWhen: op("join")),
            ToolField("joinUnique", LocalizedText("去重", "Unique only"), .toggle, default: "0", visibleWhen: op("join")),
            ToolField("splitSeparator", LocalizedText("分隔符", "Separator"), .text(), default: ",", visibleWhen: op("split")),
        ],
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let text = input.text
        typealias T = TextToolkit
        let r: T.OpResult
        switch input.string("op") {
        case "dedupe":
            r = T.dedupe(text, ignoreCase: input.bool("dedupeIgnoreCase"), trimmed: input.bool("dedupeTrim"), keepEmpty: input.bool("dedupeKeepEmpty"), lang: lang)
        case "sort":
            r = T.sort(text, mode: T.SortMode(rawValue: input.string("sortMode")) ?? .asc, random: input.random, lang: lang)
        case "trim":
            r = T.trimLines(text, lang: lang)
        case "removeEmpty":
            r = T.removeEmptyLines(text, lang: lang)
        case "collapse":
            r = T.collapseSpaces(text, lang: lang)
        case "addNumbers":
            r = T.addLineNumbers(text, start: input.int("lnStart", default: 1), separator: input.string("lnSeparator"),
                                 pad: input.bool("lnPad"), numberEmpty: input.bool("lnNumberEmpty"), lang: lang)
        case "removeNumbers":
            r = T.removeLineNumbers(text, lang: lang)
        case "affix":
            r = T.addPrefixSuffix(text, prefix: input.string("prefix"), suffix: input.string("suffix"), skipEmpty: input.bool("affixSkipEmpty"), lang: lang)
        case "case":
            r = T.OpResult(output: T.changeCase(text, T.CaseMode(rawValue: input.string("caseMode")) ?? .upper), info: nil)
        case "halfWidth":
            r = T.toHalfWidth(text, lang: lang)
        case "fullWidth":
            r = T.toFullWidth(text, lang: lang)
        case "extract":
            r = T.extract(text, kind: T.ExtractKind(rawValue: input.string("extractKind")) ?? .email, unique: input.bool("extractUnique"), lang: lang)
        case "replace":
            r = try T.findReplace(text, find: input.string("find"), replacement: input.string("replaceWith"),
                                  regex: input.bool("findRegex"), caseSensitive: input.bool("findCase"), lang: lang)
        case "join":
            r = T.linesToList(text, quote: T.QuoteStyle(rawValue: input.string("joinQuote")) ?? .single, separator: input.string("joinSeparator"),
                              wrap: T.Wrap(rawValue: input.string("joinWrap")) ?? .paren, unique: input.bool("joinUnique"), lang: lang)
        case "split":
            r = T.listToLines(text, separator: input.string("splitSeparator"), lang: lang)
        default:
            return statsResult(text, lang)
        }
        return ToolResult(outputs: [.primary(lang.t("结果", "Result"), r.output)], notes: r.info.map { [ToolNote(.info, $0)] } ?? [])
    }

    static func statsResult(_ text: String, _ lang: Lang) -> ToolResult {
        let s = TextToolkit.stats(text)
        func row(_ id: String, _ zh: String, _ en: String, _ v: Int) -> ToolOutput {
            ToolOutput(id: id, label: lang.t(zh, en), value: IPv4.formatGrouped(UInt64(max(0, v))))
        }
        return ToolResult(outputs: [
            row("chars", "字符数", "Characters", s.chars),
            row("charsNoSpace", "字符数（不含空白）", "Characters (no spaces)", s.charsNoSpace),
            row("cjk", "汉字", "CJK characters", s.cjk),
            row("words", "英文单词", "Words", s.words),
            row("lines", "行数", "Lines", s.lines),
            row("paragraphs", "段落", "Paragraphs", s.paragraphs),
            row("bytes", "UTF-8 字节", "UTF-8 bytes", s.bytes),
            ToolOutput(id: "reading", label: lang.t("预计阅读时间", "Reading time"), value: TextToolkit.formatReadingTime(s.readingSeconds, lang), style: .prose),
        ])
    }
}
