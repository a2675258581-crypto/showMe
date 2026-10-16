import Foundation

public enum CodeFormatterTool {
    static let scriptLangs = ["auto", "javascript", "typescript", "jsx", "html", "vue", "markdown"]
    static let quoteLangs = ["auto", "javascript", "typescript", "jsx", "css", "scss", "less", "html", "vue", "markdown", "yaml"]

    public static let spec = ToolSpec(
        id: "code-formatter",
        name: LocalizedText("代码格式化", "Code Formatter"),
        summary: LocalizedText(
            "JavaScript、TypeScript、CSS、SCSS、Less、HTML、Markdown、YAML、GraphQL 一键美化。",
            "Beautify JavaScript, TypeScript, CSS, SCSS, Less, HTML, Markdown, YAML and GraphQL in one click."
        ),
        category: .format,
        keywords: ["prettier", "js", "ts", "css", "scss", "less", "html", "markdown", "yaml", "graphql", "vue", "beautify", "美化", "dmgsh"],
        symbol: "curlybraces.square",
        input: .required,
        inputLabel: LocalizedText("代码", "Code"),
        fields: [
            ToolField("lang", LocalizedText("语言", "Language"),
                      .choice([ToolChoice("auto", LocalizedText("自动识别", "Auto-detect"))] + CodeFormatter.Language.allCases.map { ToolChoice($0.rawValue, $0.label) }),
                      default: "auto"),
            ToolField("indent", LocalizedText("缩进", "Indent"), .choice([
                ToolChoice("2", LocalizedText("2 空格", "2 spaces")),
                ToolChoice("4", LocalizedText("4 空格", "4 spaces")),
                ToolChoice("tab", LocalizedText("Tab", "Tab")),
            ]), default: "2"),
            ToolField("printWidth", LocalizedText("行宽", "Line width"), .choice([
                ToolChoice("80"), ToolChoice("100"), ToolChoice("120"),
            ]), default: "80"),
            ToolField("singleQuote", LocalizedText("单引号", "Single quotes"), .toggle, default: "0",
                      visibleWhen: ToolCondition("lang", in: quoteLangs)),
            ToolField("semi", LocalizedText("分号", "Semicolons"), .toggle, default: "1",
                      visibleWhen: ToolCondition("lang", in: scriptLangs)),
            ToolField("trailingComma", LocalizedText("尾随逗号", "Trailing commas"), .choice([
                ToolChoice("all", LocalizedText("全部", "All")),
                ToolChoice("es5", "ES5"),
                ToolChoice("none", LocalizedText("不加", "None")),
            ]), default: "all", visibleWhen: ToolCondition("lang", in: scriptLangs)),
        ],
        run: run
    )

    static func options(_ input: ToolInput) -> CodeFormatter.Options {
        var o = CodeFormatter.Options()
        switch input.string("indent") {
        case "4": o.tabWidth = 4
        case "tab": o.useTabs = true
        default: o.tabWidth = 2
        }
        o.printWidth = [80, 100, 120].contains(input.int("printWidth", default: 80)) ? input.int("printWidth", default: 80) : 80
        o.singleQuote = input.bool("singleQuote")
        o.semi = input.options["semi"] == nil || input.bool("semi")
        let tc = input.string("trailingComma")
        o.trailingComma = ["all", "es5", "none"].contains(tc) ? tc : "all"
        return o
    }

    @Sendable public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let o = options(input)
        let parser: String, language: String
        var notes: [ToolNote] = []
        if let chosen = CodeFormatter.Language(rawValue: input.string("lang")) {
            parser = chosen.parser
            language = chosen.editorLanguage
        } else {
            let detected = CodeFormatter.detectLanguage(input.text) ?? .typescript
            parser = detected.parser
            language = detected.editorLanguage
            notes.append(ToolNote(.info, lang.t("自动识别：\(detected.label)", "Detected: \(detected.label)")))
        }
        let out = try CodeFormatter.format(input.text, parser: parser, options: o, lang: lang)
        if out == input.text { notes.append(ToolNote(.info, lang.t("代码已经是格式化好的", "The code is already formatted"))) }
        return ToolResult(outputs: [.primary(lang.t("格式化结果", "Formatted"), out, language: language)], notes: notes)
    }
}
