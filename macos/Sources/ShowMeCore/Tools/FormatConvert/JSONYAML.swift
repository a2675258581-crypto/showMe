import Foundation

/// JSON ⇄ YAML（YAML 一侧交给 App 内置的 js-yaml）。
/// JSON 输入先用本地解析器校验，错误带精确行列；YAML → JSON 的结果用本地打印器按缩进 / 排序输出。
public enum JSONYAML {
    public struct Options: Sendable, Hashable {
        /// 输出缩进（JSON 与 YAML 共用）：2 或 4
        public var indent: Int
        /// 按键名排序（递归）
        public var sortKeys: Bool
        /// JSON → YAML：顶层数组拆成多个 `---` 文档
        public var multiDoc: Bool

        public init(indent: Int = 2, sortKeys: Bool = false, multiDoc: Bool = false) {
            self.indent = indent
            self.sortKeys = sortKeys
            self.multiDoc = multiDoc
        }
    }

    public struct Result: Sendable, Hashable {
        public var output: String
        public var warnings: [String]
        /// 文档数（JSON → YAML 为输出的文档数）
        public var documents: Int
    }

    public static func jsonToYAML(_ text: String, options o: Options = Options(), lang: Lang = .zh) throws -> Result {
        if FC.isJSBlank(text) { return Result(output: "", warnings: [], documents: 0) }
        let value: JSONValue
        do {
            value = try JSON.value(text)
        } catch let e as JSONParseError {
            throw e.toolError(lang)
        }
        var warnings: [String] = []
        let lossy = lossyNumbers(value)
        if !lossy.isEmpty {
            let list = FC.list(lossy, lang)
            warnings.append(lang.t("有数字超出 JavaScript 的精度范围，YAML 里可能与原文不同：\(list)（如需保留原值请改用字符串）",
                                   "Some numbers exceed JavaScript precision and may change in the YAML: \(list) (use strings to keep them exact)"))
        }
        func dump(_ v: JSONValue) throws -> String {
            let args = [
                "json": JSON.print(v, .minified),
                "indent": String(o.indent == 4 ? 4 : 2),
                "sortKeys": o.sortKeys ? "1" : "0",
            ]
            do {
                return try ToolEnvironment.runScript("jsonToYaml", args, lang: lang)
            } catch let e as ToolError {
                if ToolEnvironment.script == nil { throw e }
                throw ToolError(lang.t("生成 YAML 失败：", "Could not generate YAML: ") + e.message)
            }
        }
        if o.multiDoc, case .array(let items) = value {
            if items.isEmpty {
                warnings.append(lang.t("顶层是空数组，没有可拆分的文档。", "The top-level array is empty; there are no documents to split."))
                return Result(output: try dump(value), warnings: warnings, documents: 1)
            }
            var out = ""
            for item in items { out += "---\n" + (try dump(item)) }
            return Result(output: out, warnings: warnings, documents: items.count)
        }
        return Result(output: try dump(value), warnings: warnings, documents: 1)
    }

    public static func yamlToJSON(_ text: String, options o: Options = Options(), lang: Lang = .zh) throws -> Result {
        if FC.isJSBlank(text) { return Result(output: "", warnings: [], documents: 0) }
        let compact: String
        do {
            compact = try ToolEnvironment.runScript("yamlToJson", ["code": text], lang: lang)
        } catch let e as ToolError {
            if ToolEnvironment.script == nil { throw e }
            throw describeYAMLError(e, source: text, lang: lang)
        }
        if FC.isJSBlank(compact) { return Result(output: "", warnings: [], documents: 0) }
        let value: JSONValue
        do {
            value = try JSON.value(compact)
        } catch let e as JSONParseError {
            throw ToolError(lang.t("格式化引擎返回了无效的 JSON：", "The engine returned invalid JSON: ") + e.message(lang))
        }
        let json = JSON.print(value, JSON.PrintOptions(indent: .spaces(o.indent == 4 ? 4 : 2), sortKeys: o.sortKeys))
        return Result(output: json, warnings: [], documents: 1)
    }

    /// JS 解析后会变样的数字：超出 ±2^53 的整数、超过 15 位有效数字且不能原样往返的小数
    static func lossyNumbers(_ v: JSONValue) -> [String] {
        var out: [String] = []
        var stack = [v]
        while let x = stack.popLast(), out.count < 5 {
            switch x {
            case .number(let raw):
                guard let d = Double(raw), d.isFinite else {
                    out.append(raw)
                    continue
                }
                let isInteger = !raw.utf8.contains(where: { $0 == 0x2E || $0 == 0x65 || $0 == 0x45 })
                if isInteger {
                    if abs(d) > 9_007_199_254_740_991 { out.append(raw) }
                } else if let back = FC.jsNumber(d), back != raw {
                    // 有效数字位数（去掉符号、指数、小数点与首尾的 0）
                    let digits = raw.prefix { $0 != "e" && $0 != "E" }.filter(\.isNumber).drop { $0 == "0" }
                    let significant = digits.reversed().drop { $0 == "0" }.count
                    if significant > 15 { out.append(raw) }
                }
            case .array(let items): stack.append(contentsOf: items.reversed())
            case .object(let members): stack.append(contentsOf: members.reversed().map(\.value))
            default: break
            }
        }
        return out
    }

    /// js-yaml 的英文原因 → 中文
    static let reasons: [(prefix: String, zh: String)] = [
        ("bad indentation of a mapping entry", "映射项缩进不正确"),
        ("bad indentation of a sequence entry", "列表项缩进不正确"),
        ("duplicated mapping key", "重复的键"),
        ("tab characters must not be used in indentation", "YAML 缩进不能使用 Tab，请改用空格"),
        ("end of the stream or a document separator is expected", "此处应为文档结束或 ---（可能是缩进或冒号有误）"),
        ("can not read a block mapping entry; a multiline key may not be an implicit key", "无法读取映射项：键不能跨行（可能缺少冒号或冒号后缺少空格）"),
        ("a whitespace character is expected after the key-value separator", "冒号后面需要一个空格"),
        ("expected ':' after a mapping key", "键后面缺少冒号"),
        ("missed comma between flow collection entries", "行内集合的各项之间缺少逗号"),
        ("unexpected end of the stream within a flow collection", "行内集合 [ ] 或 { } 没有闭合"),
        ("unexpected end of the stream within a double quoted scalar", "双引号字符串没有闭合"),
        ("unexpected end of the document within a double quoted scalar", "双引号字符串没有闭合"),
        ("unexpected end of the stream within a single quoted scalar", "单引号字符串没有闭合"),
        ("unexpected end of the document within a single quoted scalar", "单引号字符串没有闭合"),
        ("unknown escape sequence", "未知的转义序列"),
        ("expected hexadecimal character", "转义序列中应为十六进制字符"),
        ("deficient indentation", "缩进不足"),
        ("the stream contains non-printable characters", "包含不可打印的字符"),
        ("null byte is not allowed in input", "输入中不能包含空字节"),
        ("object-based map does not support complex keys", "不支持复合键（键本身是列表或映射），JSON 无法表示"),
        ("nesting exceeded maxDepth", "嵌套层级过深"),
        ("cannot merge mappings; the provided source object is unacceptable", "合并键 << 只能引用映射（或映射列表）"),
        ("merge keys exceeded maxTotalMergeKeys", "合并键 << 展开的数量过多"),
        ("duplication of an anchor property", "同一个节点定义了多个锚点"),
        ("duplication of a tag property", "同一个节点定义了多个标签"),
        ("alias node should not have any properties", "别名节点不能带锚点或标签"),
        ("name of an alias node must contain at least one character", "锚点 / 别名名称不能为空"),
        ("name of an anchor node must contain at least one character", "锚点 / 别名名称不能为空"),
        ("expected the node content, but found ','", "此处应为值，却遇到了逗号"),
    ]

    public static func translateYAMLReason(_ reason: String) -> String? {
        if reason.hasPrefix("unidentified alias \"") {
            let name = reason.dropFirst("unidentified alias \"".count).prefix { $0 != "\"" }
            return "找不到锚点 &\(name)（别名 *\(name) 必须在锚点定义之后使用）"
        }
        return reasons.first { reason.hasPrefix($0.prefix) }?.zh
    }

    /// 把引擎的报错整理成「第 L 行第 C 列：原因」（行列优先取引擎给的，否则从「(3:5)」里取）
    static func describeYAMLError(_ e: ToolError, source: String, lang: Lang) -> ToolError {
        var first = String(e.message.split(omittingEmptySubsequences: true, whereSeparator: { $0 == "\n" || $0 == "\r\n" }).first ?? Substring(e.message))
        first = FC.jsTrim(first)
        for prefix in ["YAMLException: ", "YAMLSemanticError: ", "YAMLSyntaxError: "] where first.hasPrefix(prefix) {
            first = String(first.dropFirst(prefix.count))
        }
        var line = e.line, column = e.column
        // 末尾的 (3:5)
        if first.hasSuffix(")"), let open = first.lastIndex(of: "(") {
            let inner = first[first.index(after: open)..<first.index(before: first.endIndex)]
            let parts = inner.split(separator: ":")
            if parts.count == 2, let l = Int(parts[0]), let c = Int(parts[1]) {
                if line == nil { line = l; column = c }
                first = FC.trimTrailingSpace(String(first[..<open]))
            }
        }
        let reason = lang == .zh ? (translateYAMLReason(first) ?? first) : first
        let message = reason.isEmpty ? lang.t("YAML 解析失败", "Could not parse the YAML") : reason
        guard let l = line else { return ToolError(message) }
        let c = column ?? 1
        return ToolError(lang.t("第 \(l) 行第 \(c) 列：", "Line \(l), column \(c): ") + message, line: l, column: c)
    }
}

public enum JSONYAMLTool {
    public static let spec = ToolSpec(
        id: "json-yaml",
        name: LocalizedText("JSON ⇄ YAML", "JSON ⇄ YAML"),
        summary: LocalizedText("JSON 与 YAML 双向互转，保留结构与类型。", "Convert between JSON and YAML, keeping structure and types."),
        category: .convert,
        keywords: ["json", "yaml", "yml", "convert", "转换", "k8s", "config", "zh"],
        symbol: "arrow.left.arrow.right",
        input: .required,
        inputLabel: LocalizedText("JSON 或 YAML 文本", "JSON or YAML text"),
        fields: [
            ToolField("mode", LocalizedText("方向", "Direction"), .choice([
                ToolChoice("json2yaml", "JSON → YAML"),
                ToolChoice("yaml2json", "YAML → JSON"),
            ]), default: "json2yaml"),
            ToolField("indent", LocalizedText("缩进", "Indent"), .choice([
                ToolChoice("2", LocalizedText("2 空格", "2 spaces")),
                ToolChoice("4", LocalizedText("4 空格", "4 spaces")),
            ]), default: "2"),
            ToolField("sortKeys", LocalizedText("键排序", "Sort keys"), .toggle, default: "0"),
            ToolField("multiDoc", LocalizedText("数组拆成多文档", "Split array into documents"), .toggle, default: "0",
                      help: LocalizedText("顶层数组的每一项输出成一个 --- 分隔的 YAML 文档", "Write each item of a top-level array as its own --- separated YAML document"),
                      visibleWhen: ToolCondition("mode", is: "json2yaml")),
        ],
        run: run
    )

    @Sendable public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let o = JSONYAML.Options(indent: input.string("indent") == "4" ? 4 : 2, sortKeys: input.bool("sortKeys"), multiDoc: input.bool("multiDoc"))
        if input.string("mode") == "yaml2json" {
            let r = try JSONYAML.yamlToJSON(input.text, options: o, lang: lang)
            return ToolResult(outputs: [.primary("JSON", r.output, language: "json")], notes: r.warnings.map { ToolNote(.warning, $0) })
        }
        let r = try JSONYAML.jsonToYAML(input.text, options: o, lang: lang)
        var notes = r.warnings.map { ToolNote(.warning, $0) }
        if r.documents > 1 { notes.insert(ToolNote(.info, lang.t("共 \(r.documents) 个文档", "\(r.documents) documents")), at: 0) }
        return ToolResult(outputs: [.primary("YAML", r.output, language: "yaml")], notes: notes)
    }
}
