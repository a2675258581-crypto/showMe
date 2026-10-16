import Foundation

public enum JSONToTypesTool {
    public static let spec = ToolSpec(
        id: "json-to-types",
        name: LocalizedText("JSON 生成类型", "JSON to Types"),
        summary: LocalizedText(
            "根据 JSON 样例生成 TypeScript 接口、Go 结构体、Java 类、Rust 结构体等。",
            "Generate TypeScript interfaces, Go structs, Java classes, Rust structs and more from a JSON sample."
        ),
        category: .convert,
        keywords: ["json", "typescript", "interface", "go", "struct", "java", "class", "rust", "swift", "kotlin", "python", "csharp", "类型", "lx"],
        symbol: "wand.and.stars",
        input: .required,
        inputLabel: LocalizedText("JSON 样例（支持 JSON Lines）", "JSON sample (JSON Lines supported)"),
        fields: [
            ToolField("target", LocalizedText("目标语言", "Target language"),
                      .choice(JSONToTypes.Target.allCases.map { ToolChoice($0.rawValue, $0.label) }), default: "typescript"),
            ToolField("rootName", LocalizedText("根类型名", "Root type name"), .text(placeholder: LocalizedText("Root", "Root")), default: "Root"),
            ToolField("tsDeclaration", LocalizedText("声明方式", "Declaration"), .choice([
                ToolChoice("interface"),
                ToolChoice("type"),
            ]), default: "interface", visibleWhen: ToolCondition("target", is: "typescript")),
            ToolField("tsExport", LocalizedText("export", "export"), .toggle, default: "1", visibleWhen: ToolCondition("target", is: "typescript")),
            ToolField("tsReadonly", LocalizedText("readonly", "readonly"), .toggle, default: "0", visibleWhen: ToolCondition("target", is: "typescript")),
            ToolField("javaLombok", LocalizedText("Lombok", "Lombok"), .toggle, default: "0",
                      help: LocalizedText("用 Lombok 的 @Data 代替手写 getter / setter", "Use Lombok's @Data instead of hand-written getters / setters"),
                      visibleWhen: ToolCondition("target", is: "java")),
            ToolField("pythonStyle", LocalizedText("Python 风格", "Python style"), .choice([
                ToolChoice("dataclass"),
                ToolChoice("typeddict", "TypedDict"),
            ]), default: "dataclass", visibleWhen: ToolCondition("target", is: "python")),
        ],
        run: run
    )

    @Sendable public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let target = JSONToTypes.Target(rawValue: input.string("target")) ?? .typescript
        let options = JSONToTypes.RenderOptions(
            tsInterface: input.string("tsDeclaration") != "type",
            tsReadonly: input.bool("tsReadonly"),
            tsExport: input.options["tsExport"] == nil || input.bool("tsExport"),
            javaLombok: input.bool("javaLombok"),
            pythonTypedDict: input.string("pythonStyle") == "typeddict",
            lang: lang
        )
        let samples = try JSONToTypes.parseSamples(input.text, lang: lang)
        if samples.empty { return ToolResult() }
        let model = JSONToTypes.inferModel(samples.values, rootName: input.options["rootName"] ?? "Root")
        let code = JSONToTypes.render(model, target: target, options: options)
        let st = JSONToTypes.stats(model)
        let count = samples.jsonLines ? samples.values.count : (samples.values.first?.items?.count ?? 1)
        var summary = lang.t("\(st.types) 个类型 · \(st.fields) 个字段", "\(st.types) types · \(st.fields) fields")
        if st.optional > 0 { summary += lang.t(" · \(st.optional) 个可选", " · \(st.optional) optional") }
        if st.nullable > 0 { summary += lang.t(" · \(st.nullable) 个可空", " · \(st.nullable) nullable") }
        summary += samples.jsonLines ? lang.t(" · JSON Lines \(count) 行", " · \(count) JSON Lines") : lang.t(" · 样本 \(count) 个", " · \(count) sample(s)")
        let file = target.fileName(rootName: model.rootName, mainName: JSONToTypes.mainTypeName(model))
        let notes = [
            ToolNote(.info, summary),
            ToolNote(.info, lang.t("建议文件名：\(file)", "Suggested file name: \(file)")),
        ]
        return ToolResult(outputs: [.primary(target.label, code, language: target.language)], notes: notes)
    }
}
