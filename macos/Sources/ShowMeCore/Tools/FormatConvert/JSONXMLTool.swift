import Foundation

public enum JSONXMLTool {
    public static let spec = ToolSpec(
        id: "json-xml",
        name: LocalizedText("JSON ⇄ XML", "JSON ⇄ XML"),
        summary: LocalizedText(
            "JSON 与 XML 双向互转，属性、数组与文本节点都能正确处理。",
            "Convert between JSON and XML, handling attributes, arrays and text nodes correctly."
        ),
        category: .convert,
        keywords: ["json", "xml", "convert", "转换", "zh"],
        symbol: "shuffle",
        input: .required,
        inputLabel: LocalizedText("JSON 或 XML 文本", "JSON or XML text"),
        fields: [
            ToolField("mode", LocalizedText("方向", "Direction"), .choice([
                ToolChoice("json2xml", "JSON → XML"),
                ToolChoice("xml2json", "XML → JSON"),
            ]), default: "json2xml"),
            ToolField("indent", LocalizedText("缩进", "Indent"), .choice([
                ToolChoice("2", LocalizedText("2 空格", "2 spaces")),
                ToolChoice("4", LocalizedText("4 空格", "4 spaces")),
                ToolChoice("tab", LocalizedText("Tab", "Tab")),
                ToolChoice("0", LocalizedText("压缩", "Minify")),
            ]), default: "2"),
            ToolField("rootName", LocalizedText("根元素", "Root element"), .text(placeholder: LocalizedText("root", "root")), default: "root",
                      help: LocalizedText("JSON 顶层有多个键、是数组或基本值时，用这个元素包裹", "Wraps the output when the JSON has several top-level keys, is an array or a plain value"),
                      visibleWhen: ToolCondition("mode", is: "json2xml")),
            ToolField("attrPrefix", LocalizedText("属性前缀", "Attribute prefix"), .text(placeholder: LocalizedText("无", "None")), default: "@_",
                      help: LocalizedText("JSON 里以它开头的键对应 XML 属性；留空则不区分属性", "JSON keys starting with this prefix map to XML attributes; leave empty to treat attributes as plain keys")),
            ToolField("textKey", LocalizedText("文本键", "Text key"), .text(placeholder: LocalizedText("#text", "#text")), default: "#text",
                      help: LocalizedText("元素同时有属性和文本时，文本放在这个键下", "When an element has both attributes and text, the text goes under this key")),
            ToolField("declaration", LocalizedText("XML 声明", "XML declaration"), .toggle, default: "1",
                      help: LocalizedText("输出 <?xml version=\"1.0\" encoding=\"UTF-8\"?>", "Emit <?xml version=\"1.0\" encoding=\"UTF-8\"?>"),
                      visibleWhen: ToolCondition("mode", is: "json2xml")),
            ToolField("parseValues", LocalizedText("转换数字 / 布尔值", "Detect numbers / booleans"), .toggle, default: "1",
                      help: LocalizedText("把 42、-3.5、true 这类文本转成数字 / 布尔值；007、1.0 等会丢失原文的保持字符串", "Turn text like 42, -3.5 and true into numbers / booleans; values like 007 or 1.0 stay strings"),
                      visibleWhen: ToolCondition("mode", is: "xml2json")),
            ToolField("ignoreDeclaration", LocalizedText("忽略 XML 声明", "Ignore XML declaration"), .toggle, default: "1",
                      visibleWhen: ToolCondition("mode", is: "xml2json")),
        ],
        run: run
    )

    static func options(_ input: ToolInput) -> JSONXML.Options {
        var o = JSONXML.Options()
        switch input.string("indent") {
        case "4": o.indent = "    "
        case "tab": o.indent = "\t"
        case "0": o.indent = ""
        default: o.indent = "  "
        }
        if let v = input.options["attrPrefix"] { o.attrPrefix = v }
        if let v = input.options["textKey"] { o.textKey = v }
        if let v = input.options["rootName"] { o.rootName = v }
        o.declaration = input.options["declaration"] == nil || input.bool("declaration")
        o.parseValues = input.options["parseValues"] == nil || input.bool("parseValues")
        o.ignoreDeclaration = input.options["ignoreDeclaration"] == nil || input.bool("ignoreDeclaration")
        return o
    }

    @Sendable public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let toXML = input.string("mode") != "xml2json"
        let o = options(input)
        let r = toXML ? try JSONXML.jsonToXML(input.text, options: o, lang: lang) : try JSONXML.xmlToJSON(input.text, options: o, lang: lang)
        var notes = [ToolNote(.info, lang.t("\(r.elements) 个元素 · \(r.attributes) 个属性", "\(r.elements) elements · \(r.attributes) attributes")
            + (r.wrapped ? lang.t(" · 已用根元素包裹", " · wrapped in a root element") : ""))]
        notes += r.warnings.map { ToolNote(.warning, $0) }
        let output = ToolOutput.primary(toXML ? "XML" : "JSON", r.output, language: toXML ? "xml" : "json")
        return ToolResult(outputs: [output], notes: notes)
    }
}
