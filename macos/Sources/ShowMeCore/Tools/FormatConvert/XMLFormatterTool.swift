import Foundation

public enum XMLFormatterTool {
    public static let spec = ToolSpec(
        id: "xml-formatter",
        name: LocalizedText("XML 格式化", "XML Formatter"),
        summary: LocalizedText(
            "美化或压缩 XML，校验结构并指出错误位置。",
            "Beautify or minify XML, validate its structure and pinpoint errors."
        ),
        category: .format,
        keywords: ["xml", "format", "beautify", "minify", "svg", "soap", "美化", "压缩", "gsh"],
        symbol: "chevron.left.forwardslash.chevron.right",
        input: .required,
        inputLabel: LocalizedText("XML 文本", "XML text"),
        fields: [
            ToolField("mode", LocalizedText("操作", "Action"), .choice([
                ToolChoice("format", LocalizedText("格式化", "Format")),
                ToolChoice("minify", LocalizedText("压缩", "Minify")),
            ]), default: "format"),
            ToolField("indent", LocalizedText("缩进", "Indent"), .choice([
                ToolChoice("2", LocalizedText("2 空格", "2 spaces")),
                ToolChoice("4", LocalizedText("4 空格", "4 spaces")),
                ToolChoice("tab", LocalizedText("Tab", "Tab")),
            ]), default: "2", visibleWhen: ToolCondition("mode", is: "format")),
            ToolField("attrWrap", LocalizedText("属性换行", "Attribute wrapping"), .choice([
                ToolChoice("auto", LocalizedText("过长时换行", "When too long")),
                ToolChoice("always", LocalizedText("每个属性一行", "One per line")),
                ToolChoice("never", LocalizedText("不换行", "Never")),
            ]), default: "auto", visibleWhen: ToolCondition("mode", is: "format")),
            ToolField("keepComments", LocalizedText("保留注释", "Keep comments"), .toggle, default: "1"),
            ToolField("selfClose", LocalizedText("自闭合空元素", "Self-close empty elements"), .toggle, default: "1",
                      help: LocalizedText("没有内容的元素写成 <tag/>；关闭时保持原来的写法", "Write empty elements as <tag/>; when off, keep the original form")),
        ],
        run: run
    )

    @Sendable public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let minify = input.string("mode") == "minify"
        var o = XMLFormatter.Options(minify: minify)
        switch input.string("indent") {
        case "4": o.indent = "    "
        case "tab": o.indent = "\t"
        default: o.indent = "  "
        }
        o.attrWrap = XMLFormatter.AttrWrap(rawValue: input.string("attrWrap")) ?? .auto
        o.keepComments = input.options["keepComments"] == nil ? true : input.bool("keepComments")
        o.selfClose = input.options["selfClose"] == nil ? true : input.bool("selfClose")
        let out = try XMLFormatter.process(input.text, options: o, lang: lang)
        let st = out.stats
        var notes = [ToolNote(.info, lang.t(
            "XML 结构正确 · 元素 \(st.elements) · 属性 \(st.attributes) · 最深 \(st.maxDepth) 层",
            "Well-formed XML · \(st.elements) elements · \(st.attributes) attributes · depth \(st.maxDepth)"
        ))]
        notes += out.warnings.map { ToolNote(.warning, $0.text(lang)) }
        return ToolResult(outputs: [.primary(minify ? lang.t("压缩结果", "Minified") : lang.t("格式化结果", "Formatted"), out.text, language: "xml")], notes: notes)
    }
}
