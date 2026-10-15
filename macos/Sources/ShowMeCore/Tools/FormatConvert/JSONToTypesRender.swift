import Foundation

// 类型模型 → 各语言代码：TypeScript、Go、Java、Kotlin、Rust、Swift、Python、C#。

extension JSONToTypes {
    public enum Target: String, Sendable, Hashable, CaseIterable {
        case typescript, go, java, kotlin, rust, swift, python, csharp

        public var label: String {
            switch self {
            case .typescript: "TypeScript"
            case .go: "Go"
            case .java: "Java"
            case .kotlin: "Kotlin"
            case .rust: "Rust"
            case .swift: "Swift"
            case .python: "Python"
            case .csharp: "C#"
            }
        }

        /// 「新标签打开」时的编辑器语言 id
        public var language: String { rawValue }

        /// 下载文件名；Java 的 public 类名必须与文件名一致
        public func fileName(rootName: String, mainName: String? = nil) -> String {
            switch self {
            case .typescript: "types.ts"
            case .go: "types.go"
            case .java: "\(mainName ?? rootName).java"
            case .kotlin: "\(rootName).kt"
            case .rust: "types.rs"
            case .swift: "\(rootName).swift"
            case .python: "models.py"
            case .csharp: "\(rootName).cs"
            }
        }
    }

    public struct RenderOptions: Sendable, Hashable {
        /// TypeScript：interface 还是 type 别名
        public var tsInterface: Bool
        public var tsReadonly: Bool
        public var tsExport: Bool
        /// Java：用 Lombok @Data 代替 getter / setter
        public var javaLombok: Bool
        /// Python：TypedDict（否则 dataclass）
        public var pythonTypedDict: Bool
        /// 生成代码里注释的语言
        public var lang: Lang

        public init(tsInterface: Bool = true, tsReadonly: Bool = false, tsExport: Bool = true, javaLombok: Bool = false, pythonTypedDict: Bool = false, lang: Lang = .zh) {
            self.tsInterface = tsInterface
            self.tsReadonly = tsReadonly
            self.tsExport = tsExport
            self.javaLombok = javaLombok
            self.pythonTypedDict = pythonTypedDict
            self.lang = lang
        }
    }

    /// 主类型名：根是对象时为根类型，否则为第一个生成的类（Java 的 public 类）
    public static func mainTypeName(_ m: Model) -> String {
        if case .object(let id) = m.root.kind { return m.def(id).name }
        return m.objects.first?.name ?? m.rootName
    }

    public static func render(_ m: Model, target: Target, options o: RenderOptions = RenderOptions()) -> String {
        let r = Renderer(m: m, o: o)
        switch target {
        case .typescript: return r.typescript()
        case .go: return r.go()
        case .java: return r.java()
        case .kotlin: return r.kotlin()
        case .rust: return r.rust()
        case .swift: return r.swift()
        case .python: return r.python()
        case .csharp: return r.csharp()
        }
    }

    /// 解析 JSON 样例并生成代码；输入为空时返回空代码
    public static func generate(_ text: String, target: Target, rootName: String = "Root", options: RenderOptions = RenderOptions(), lang: Lang = .zh) throws -> (code: String, model: Model?) {
        let samples = try parseSamples(text, lang: lang)
        if samples.empty { return ("", nil) }
        let model = inferModel(samples.values, rootName: rootName)
        return (render(model, target: target, options: options), model)
    }

    // MARK: - 通用工具

    enum QuoteStyle { case c, swift, rust, kotlin }

    /// 各语言的双引号字符串字面量
    static func quote(_ s: String, _ style: QuoteStyle = .c) -> String {
        var out = "\""
        for ch in s.unicodeScalars {
            switch ch {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "$" where style == .kotlin: out += "\\$"
            default:
                if ch.value < 0x20 || ch.value == 0x7F {
                    let hex = String(ch.value, radix: 16, uppercase: true)
                    if style == .swift || style == .rust {
                        out += "\\u{" + hex + "}"
                    } else {
                        out += "\\u" + String(repeating: "0", count: max(0, 4 - hex.count)) + hex
                    }
                } else {
                    out.unicodeScalars.append(ch)
                }
            }
        }
        return out + "\""
    }

    /// 按显示宽度（码点数）补齐
    static func padEnd(_ s: String, _ n: Int) -> String {
        s + String(repeating: " ", count: max(0, n - s.unicodeScalars.count))
    }

    struct NamedField {
        var field: Field
        var name: String
    }

    struct Renderer {
        let m: Model
        let o: RenderOptions

        func def(_ id: Int) -> ObjectDef { m.def(id) }

        /// 模型里是否用到了某种类型；includeRoot=false 时只看各个类的字段
        func uses(_ pred: (TypeRef) -> Bool, includeRoot: Bool = true) -> Bool {
            func check(_ t: TypeRef) -> Bool {
                if pred(t) { return true }
                switch t.kind {
                case .array(let i): return check(i)
                case .map(let v): return check(v)
                case .union(let ms): return ms.contains(where: check)
                default: return false
                }
            }
            return (includeRoot && check(m.root)) || m.defs.contains { $0.fields.contains { check($0.type) } }
        }

        static func isAnyLike(_ t: TypeRef) -> Bool {
            switch t.kind {
            case .any, .map, .union: return true
            default: return false
            }
        }

        static func isArray(_ t: TypeRef) -> Bool { if case .array = t.kind { return true } else { return false } }
        static func isMap(_ t: TypeRef) -> Bool { if case .map = t.kind { return true } else { return false } }
        static func isObject(_ t: TypeRef) -> Bool { if case .object = t.kind { return true } else { return false } }
        static func isPrimitive(_ t: TypeRef) -> Bool { if case .primitive = t.kind { return true } else { return false } }

        /// 为一个类的所有字段生成互不冲突的成员名；空结果回退为 field1、field2…
        func nameFields(_ fields: [Field], _ convert: (String) -> String, _ fixup: (String) -> String,
                        fold: Bool = false, reserved: [String] = [], fallback: String = "field") -> [NamedField] {
            var used = Set(reserved.map { fold ? $0.lowercased() : $0 })
            return fields.enumerated().map { i, field in
                var base = convert(field.key)
                if base.isEmpty { base = "\(fallback)\(i + 1)" }
                base = fixup(base)
                return NamedField(field: field, name: Names.uniqueName(base, &used, fold: fold))
            }
        }

        /// 数字开头等不合法的名字补下划线
        static func underscoreIfInvalid(_ name: String) -> String { Names.isPlainIdentifier(name) ? name : "_" + name }

        /// 深度优先、依赖在前的顺序（Python 需要先定义再引用）
        func dependencyOrder() -> [ObjectDef] {
            var out: [ObjectDef] = []
            var seen = Set<Int>()
            func visitRef(_ t: TypeRef) {
                switch t.kind {
                case .object(let id): visit(id)
                case .array(let i): visitRef(i)
                case .map(let v): visitRef(v)
                case .union(let ms): ms.forEach(visitRef)
                default: break
                }
            }
            func visit(_ id: Int) {
                guard seen.insert(id).inserted else { return }
                for f in def(id).fields { visitRef(f.type) }
                out.append(def(id))
            }
            visitRef(m.root)
            for d in m.objects { visit(d.id) }
            return out
        }

        // MARK: TypeScript

        func tsType(_ t: TypeRef) -> String {
            let ro = o.tsReadonly ? "readonly " : ""
            var s: String
            switch t.kind {
            case .primitive(let p): s = p == .string ? "string" : p == .boolean ? "boolean" : "number"
            case .any: return "unknown"
            case .array(let item):
                let inner = tsType(item)
                let wrap = inner.contains("|") || inner.hasPrefix("readonly ")
                s = ro + (wrap ? "(\(inner))" : inner) + "[]"
            case .map: s = o.tsReadonly ? "Readonly<Record<string, unknown>>" : "Record<string, unknown>"
            case .object(let id): s = def(id).name
            case .union(let ms): s = ms.map(tsType).joined(separator: " | ")
            }
            return t.nullable ? s + " | null" : s
        }

        func typescript() -> String {
            let ex = o.tsExport ? "export " : ""
            let ro = o.tsReadonly ? "readonly " : ""
            var blocks: [String] = []
            if !Renderer.isObject(m.root) { blocks.append("\(ex)type \(m.rootName) = \(tsType(m.root));") }
            for d in m.objects {
                let body = d.fields.map { f -> String in
                    let key = Names.isJSIdentifier(f.key) ? f.key : JSON.quote(f.key)
                    return "  \(ro)\(key)\(f.optional ? "?" : ""): \(tsType(f.type));"
                }.joined(separator: "\n")
                blocks.append(o.tsInterface ? "\(ex)interface \(d.name) {\n\(body)\n}" : "\(ex)type \(d.name) = {\n\(body)\n};")
            }
            return blocks.joined(separator: "\n\n") + "\n"
        }

        // MARK: Go

        /// encoding/json 能识别的标签名字符（其余字符会让标签被忽略）
        static func goTagNameValid(_ key: String) -> Bool {
            if key.isEmpty { return false }
            let allowed = Set("!#$%&()*+-./:;<=>?@[]^_{|}~ ".unicodeScalars)
            return key.unicodeScalars.allSatisfy { FC.isLetter($0.value) || FC.isNumber($0.value) || allowed.contains($0) }
        }

        func goType(_ t: TypeRef, pointer: Bool = false) -> String {
            switch t.kind {
            case .primitive(let p):
                let base = [Primitive.string: "string", .integer: "int64", .number: "float64", .boolean: "bool"][p] ?? "any"
                return (pointer || t.nullable ? "*" : "") + base
            case .any, .union: return "any"
            case .array(let item): return "[]" + goType(item)
            case .map: return "map[string]any"
            case .object(let id): return (pointer || t.nullable ? "*" : "") + Names.goExport(def(id).name)
            }
        }

        func go() -> String {
            var blocks: [String] = []
            if !Renderer.isObject(m.root) { blocks.append("type \(Names.goExport(m.rootName)) \(goType(m.root))") }
            for d in m.objects {
                let named = nameFields(d.fields, Names.goPascalCase, Names.goExport, fallback: "Field")
                let rows = named.map { nf -> (name: String, t: String, tag: String, note: String) in
                    let f = nf.field
                    // 可选的对象用指针，才能真正省略
                    let t = goType(f.type, pointer: f.optional && Renderer.isObject(f.type))
                    let tagName = f.key == "-" ? "-," : f.key
                    let tagValue = "json:" + JSONToTypes.quote(tagName + (f.optional ? ",omitempty" : ""))
                    let tag = tagValue.contains("`") ? JSONToTypes.quote(tagValue) : "`\(tagValue)`"
                    let note = Renderer.goTagNameValid(f.key) || f.key == "-" ? "" : o.lang.t(" // 注意：键 \(JSONToTypes.quote(f.key)) 含 encoding/json 不支持的字符，需自定义解析",
                                                                                                " // Note: key \(JSONToTypes.quote(f.key)) has characters encoding/json does not support; parse it manually")
                    return (nf.name, t, tag, note)
                }
                let nw = rows.map { $0.name.unicodeScalars.count }.max() ?? 0
                let tw = rows.map { $0.t.unicodeScalars.count }.max() ?? 0
                let body = rows.map { "\t\(JSONToTypes.padEnd($0.name, nw)) \(JSONToTypes.padEnd($0.t, tw)) \($0.tag)\($0.note)" }.joined(separator: "\n")
                blocks.append("type \(Names.goExport(d.name)) struct {\n\(body)\n}")
            }
            return blocks.joined(separator: "\n\n") + "\n"
        }

        // MARK: Java

        func javaType(_ t: TypeRef, boxed: Bool) -> String {
            switch t.kind {
            case .primitive(let p):
                switch p {
                case .string: return "String"
                case .integer: return boxed || t.nullable ? "Long" : "long"
                case .number: return boxed || t.nullable ? "Double" : "double"
                case .boolean: return boxed || t.nullable ? "Boolean" : "boolean"
                }
            case .any, .union: return "Object"
            case .array(let item): return "List<\(javaType(item, boxed: true))>"
            case .map: return "Map<String, Object>"
            case .object(let id): return def(id).name
            }
        }

        func java() -> String {
            // 根类型只出现在注释里，不需要 import
            let usesList = uses(Renderer.isArray, includeRoot: false)
            let usesMap = uses(Renderer.isMap, includeRoot: false)
            var usesJsonProperty = false
            let main: ObjectDef?
            if case .object(let id) = m.root.kind { main = def(id) } else { main = m.objects.first }
            guard let main else {
                return o.lang.t("// JSON 根节点是 \(javaType(m.root, boxed: true))，没有需要生成的类\n",
                                "// The JSON root is \(javaType(m.root, boxed: true)); there are no classes to generate\n")
            }
            func renderClass(_ d: ObjectDef, _ indent: String, _ isMain: Bool) -> String {
                let i1 = indent + "    ", i2 = i1 + "    "
                let named = nameFields(d.fields, Names.camelCase) { n in
                    let v = Renderer.underscoreIfInvalid(n)
                    return Names.javaKeywords.contains(v) ? v + "Value" : v
                }
                var lines: [String] = []
                if o.javaLombok { lines.append("\(indent)@Data") }
                lines.append("\(indent)public \(isMain ? "" : "static ")class \(d.name) {")
                for nf in named {
                    let t = javaType(nf.field.type, boxed: nf.field.optional)
                    // Lombok 给 boolean 字段 isActive 生成 isActive() / setActive()，Jackson 会推断成 active：必须显式标注
                    let lombokIs = o.javaLombok && t == "boolean" && Renderer.isPrefixedUpper(nf.name, "is")
                    if nf.name != nf.field.key || lombokIs {
                        usesJsonProperty = true
                        lines.append("\(i1)@JsonProperty(\(JSONToTypes.quote(nf.field.key)))")
                    }
                    lines.append("\(i1)private \(t) \(nf.name);")
                }
                if !o.javaLombok {
                    for nf in named {
                        let t = javaType(nf.field.type, boxed: nf.field.optional)
                        let getter = (t == "boolean" ? "is" : "get") + Names.cap(nf.name)
                        lines += [
                            "",
                            "\(i1)public \(t) \(getter)() {",
                            "\(i2)return \(nf.name);",
                            "\(i1)}",
                            "",
                            "\(i1)public void set\(Names.cap(nf.name))(\(t) \(nf.name)) {",
                            "\(i2)this.\(nf.name) = \(nf.name);",
                            "\(i1)}",
                        ]
                    }
                }
                if isMain {
                    for other in m.objects where other.id != d.id {
                        lines += ["", renderClass(other, i1, false)]
                    }
                }
                lines.append("\(indent)}")
                return lines.joined(separator: "\n")
            }
            let body = renderClass(main, "", true)
            var imports: [String] = []
            if usesJsonProperty { imports.append("import com.fasterxml.jackson.annotation.JsonProperty;") }
            if usesList { imports.append("import java.util.List;") }
            if usesMap { imports.append("import java.util.Map;") }
            if o.javaLombok { imports.append("import lombok.Data;") }
            var head: [String] = []
            if !imports.isEmpty { head.append(imports.joined(separator: "\n")) }
            if !Renderer.isObject(m.root) { head.append(o.lang.t("// JSON 根节点是 ", "// The JSON root is ") + javaType(m.root, boxed: true)) }
            return (head + [body]).joined(separator: "\n\n") + "\n"
        }

        /// name 以 prefix 开头且紧跟大写字母（isActive）
        static func isPrefixedUpper(_ name: String, _ prefix: String) -> Bool {
            guard name.hasPrefix(prefix) else { return false }
            guard let c = name.dropFirst(prefix.count).unicodeScalars.first else { return false }
            return c.properties.generalCategory == .uppercaseLetter
        }

        // MARK: Kotlin

        func kotlinType(_ t: TypeRef) -> String {
            var s: String
            switch t.kind {
            case .primitive(let p): s = [Primitive.string: "String", .integer: "Long", .number: "Double", .boolean: "Boolean"][p] ?? "JsonElement"
            case .any, .union: s = "JsonElement"
            case .array(let item): s = "List<\(kotlinType(item))>"
            case .map: s = "Map<String, JsonElement>"
            case .object(let id): s = def(id).name
            }
            return t.nullable ? s + "?" : s
        }

        func kotlin() -> String {
            var usesSerialName = false
            var blocks: [String] = []
            if !Renderer.isObject(m.root) { blocks.append("typealias \(m.rootName) = \(kotlinType(m.root))") }
            for d in m.objects {
                let named = nameFields(d.fields, Names.camelCase, Renderer.underscoreIfInvalid)
                let params = named.map { nf -> String in
                    let ident = Names.kotlinKeywords.contains(nf.name) ? "`\(nf.name)`" : nf.name
                    var t = kotlinType(nf.field.type)
                    if nf.field.optional && !t.hasSuffix("?") { t += "?" }
                    let ann = nf.name != nf.field.key ? "@SerialName(\(JSONToTypes.quote(nf.field.key, .kotlin))) " : ""
                    if !ann.isEmpty { usesSerialName = true }
                    return "    \(ann)val \(ident): \(t)\(nf.field.optional ? " = null" : ""),"
                }
                blocks.append("@Serializable\ndata class \(d.name)(\n\(params.joined(separator: "\n"))\n)")
            }
            var imports: [String] = []
            if usesSerialName { imports.append("import kotlinx.serialization.SerialName") }
            if !m.defs.isEmpty { imports.append("import kotlinx.serialization.Serializable") }
            if uses(Renderer.isAnyLike) { imports.append("import kotlinx.serialization.json.JsonElement") }
            return ((imports.isEmpty ? [] : [imports.joined(separator: "\n")]) + blocks).joined(separator: "\n\n") + "\n"
        }

        // MARK: Rust

        /// serde 的 rename_all = "camelCase" 规则
        static func serdeCamel(_ snake: String) -> String {
            let parts = snake.split(separator: "_", omittingEmptySubsequences: false).map(String.init)
            guard let first = parts.first else { return snake }
            return first + parts.dropFirst().map(Names.cap).joined()
        }

        func rustType(_ t: TypeRef) -> String {
            var s: String
            switch t.kind {
            case .primitive(let p): s = [Primitive.string: "String", .integer: "i64", .number: "f64", .boolean: "bool"][p] ?? "serde_json::Value"
            case .any, .union: return "serde_json::Value" // serde_json::Value 本身就能表示 null
            case .array(let item): s = "Vec<\(rustType(item))>"
            case .map: s = "HashMap<String, serde_json::Value>"
            case .object(let id): s = def(id).name
            }
            return t.nullable ? "Option<\(s)>" : s
        }

        func rust() -> String {
            var blocks: [String] = []
            if !Renderer.isObject(m.root) { blocks.append("pub type \(m.rootName) = \(rustType(m.root));") }
            for d in m.objects {
                let named = nameFields(d.fields, Names.snakeCase) { n in
                    let v = Renderer.underscoreIfInvalid(n)
                    return Names.rustNoRaw.contains(v) ? v + "_" : v
                }
                let rows = named.map { nf -> (field: Field, name: String, ident: String, t: String) in
                    let ident = Names.rustKeywords.contains(nf.name) ? "r#\(nf.name)" : nf.name
                    var t = rustType(nf.field.type)
                    if nf.field.optional && !t.hasPrefix("Option<") { t = "Option<\(t)>" }
                    return (nf.field, nf.name, ident, t)
                }
                // 大部分字段只是 camelCase 差异时，用 rename_all 减少逐个 rename
                let plainRenames = rows.filter { $0.name != $0.field.key }.count
                let camelRenames = rows.filter { Renderer.serdeCamel($0.name) != $0.field.key }.count
                let renameAll = plainRenames >= 2 && camelRenames < plainRenames
                var lines = ["#[derive(Debug, Clone, Serialize, Deserialize)]"]
                if renameAll { lines.append("#[serde(rename_all = \"camelCase\")]") }
                lines.append("pub struct \(d.name) {")
                for r in rows {
                    let serdeName = renameAll ? Renderer.serdeCamel(r.name) : r.name
                    var attrs: [String] = []
                    if serdeName != r.field.key { attrs.append("rename = \(JSONToTypes.quote(r.field.key, .rust))") }
                    if r.field.optional { attrs.append("skip_serializing_if = \"Option::is_none\"") }
                    if !attrs.isEmpty { lines.append("    #[serde(\(attrs.joined(separator: ", ")))]") }
                    lines.append("    pub \(r.ident): \(r.t),")
                }
                lines.append("}")
                blocks.append(lines.joined(separator: "\n"))
            }
            // 与 rustfmt 一致：按 crate 名排序
            var imports: [String] = []
            if !m.defs.isEmpty { imports.append("use serde::{Deserialize, Serialize};") }
            if uses(Renderer.isMap) { imports.append("use std::collections::HashMap;") }
            return ((imports.isEmpty ? [] : [imports.joined(separator: "\n")]) + blocks).joined(separator: "\n\n") + "\n"
        }

        // MARK: Swift

        static let swiftJSONValue = """
        /// 任意 JSON 值
        enum JSONValue: Codable, Hashable {
            case string(String)
            case number(Double)
            case bool(Bool)
            case object([String: JSONValue])
            case array([JSONValue])
            case null

            init(from decoder: Decoder) throws {
                let container = try decoder.singleValueContainer()
                if container.decodeNil() {
                    self = .null
                } else if let value = try? container.decode(Bool.self) {
                    self = .bool(value)
                } else if let value = try? container.decode(Double.self) {
                    self = .number(value)
                } else if let value = try? container.decode(String.self) {
                    self = .string(value)
                } else if let value = try? container.decode([JSONValue].self) {
                    self = .array(value)
                } else {
                    self = .object(try container.decode([String: JSONValue].self))
                }
            }

            func encode(to encoder: Encoder) throws {
                var container = encoder.singleValueContainer()
                switch self {
                case .string(let value): try container.encode(value)
                case .number(let value): try container.encode(value)
                case .bool(let value): try container.encode(value)
                case .object(let value): try container.encode(value)
                case .array(let value): try container.encode(value)
                case .null: try container.encodeNil()
                }
            }
        }
        """

        func swiftType(_ t: TypeRef) -> String {
            var s: String
            switch t.kind {
            case .primitive(let p): s = [Primitive.string: "String", .integer: "Int", .number: "Double", .boolean: "Bool"][p] ?? "JSONValue"
            case .any, .union: s = "JSONValue"
            case .array(let item): s = "[\(swiftType(item))]"
            case .map: s = "[String: JSONValue]"
            case .object(let id): s = def(id).name
            }
            return t.nullable ? s + "?" : s
        }

        func swift() -> String {
            func ident(_ n: String) -> String { Names.swiftKeywords.contains(n) ? "`\(n)`" : n }
            var blocks: [String] = []
            if !Renderer.isObject(m.root) { blocks.append("typealias \(m.rootName) = \(swiftType(m.root))") }
            for d in m.objects {
                let named = nameFields(d.fields, Names.camelCase, Renderer.underscoreIfInvalid)
                var lines = ["struct \(d.name): Codable {"]
                for nf in named {
                    var t = swiftType(nf.field.type)
                    if nf.field.optional && !t.hasSuffix("?") { t += "?" }
                    lines.append("    let \(ident(nf.name)): \(t)")
                }
                if named.contains(where: { $0.field.key != $0.name }) {
                    lines += ["", "    enum CodingKeys: String, CodingKey {"]
                    for nf in named {
                        lines.append("        case \(ident(nf.name))\(nf.name == nf.field.key ? "" : " = \(JSONToTypes.quote(nf.field.key, .swift))")")
                    }
                    lines.append("    }")
                }
                lines.append("}")
                blocks.append(lines.joined(separator: "\n"))
            }
            if uses(Renderer.isAnyLike) {
                blocks.append(o.lang == .zh ? Renderer.swiftJSONValue : Renderer.swiftJSONValue.replacingOccurrences(of: "/// 任意 JSON 值", with: "/// Any JSON value"))
            }
            return (["import Foundation"] + blocks).joined(separator: "\n\n") + "\n"
        }

        // MARK: Python

        func python() -> String {
            let typed = o.pythonTypedDict
            var usesAny = false
            func pyType(_ t: TypeRef) -> String {
                var s: String
                switch t.kind {
                case .primitive(let p): s = [Primitive.string: "str", .integer: "int", .number: "float", .boolean: "bool"][p] ?? "Any"
                case .any:
                    usesAny = true
                    return "Any"
                case .array(let item): s = "list[\(pyType(item))]"
                case .map:
                    usesAny = true
                    s = "dict[str, Any]"
                case .object(let id): s = def(id).name
                case .union(let ms): s = ms.map(pyType).joined(separator: " | ")
                }
                return t.nullable ? s + " | None" : s
            }
            var usesNotRequired = false
            var blocks: [String] = []
            for d in dependencyOrder() {
                if typed {
                    let classSyntax = d.fields.allSatisfy { Names.isPlainIdentifier($0.key) && !Names.pythonKeywords.contains($0.key) }
                    let entries = d.fields.map { f -> (key: String, t: String) in
                        var t = pyType(f.type)
                        if f.optional {
                            usesNotRequired = true
                            t = "NotRequired[\(t)]"
                        }
                        return (f.key, t)
                    }
                    if classSyntax {
                        blocks.append("class \(d.name)(TypedDict):\n" + entries.map { "    \($0.key): \($0.t)" }.joined(separator: "\n"))
                    } else {
                        let body = entries.map { "        \(JSONToTypes.quote($0.key)): \($0.t)," }.joined(separator: "\n")
                        blocks.append("\(d.name) = TypedDict(\n    \(JSONToTypes.quote(d.name)),\n    {\n\(body)\n    },\n)")
                    }
                    continue
                }
                let named = nameFields(d.fields, Names.snakeCase) { n in
                    let v = Renderer.underscoreIfInvalid(n)
                    return Names.pythonKeywords.contains(v) ? v + "_" : v
                }
                // dataclass：有默认值的字段必须排在后面
                let ordered = named.filter { !$0.field.optional } + named.filter { $0.field.optional }
                let lines = ordered.map { nf -> String in
                    var t = pyType(nf.field.type)
                    if nf.field.optional && !t.hasSuffix("| None") && t != "Any" { t += " | None" }
                    let def = nf.field.optional ? " = None" : ""
                    let note = nf.name != nf.field.key ? o.lang.t("  # JSON 键：", "  # JSON key: ") + JSONToTypes.quote(nf.field.key) : ""
                    return "    \(nf.name): \(t)\(def)\(note)"
                }
                blocks.append("@dataclass\nclass \(d.name):\n" + lines.joined(separator: "\n"))
            }
            if !Renderer.isObject(m.root) { blocks.append("\(m.rootName) = \(pyType(m.root))") }
            var typing: [String] = []
            if usesAny { typing.append("Any") }
            if typed {
                if usesNotRequired { typing.append("NotRequired") }
                if !m.defs.isEmpty { typing.append("TypedDict") }
            }
            var stdlib: [String] = []
            if !typed && !m.defs.isEmpty { stdlib.append("from dataclasses import dataclass") }
            if !typing.isEmpty { stdlib.append("from typing import \(typing.joined(separator: ", "))") }
            let head = (["from __future__ import annotations"] + (stdlib.isEmpty ? [] : [stdlib.joined(separator: "\n")])).joined(separator: "\n\n")
            return ([head] + blocks).joined(separator: "\n\n\n") + "\n"
        }

        // MARK: C#

        func csType(_ t: TypeRef) -> String {
            var s: String
            switch t.kind {
            case .primitive(let p): s = [Primitive.string: "string", .integer: "long", .number: "double", .boolean: "bool"][p] ?? "object"
            case .any, .union: return "object?"
            case .array(let item): s = "List<\(csType(item))>"
            case .map: s = "Dictionary<string, object?>"
            case .object(let id): s = def(id).name
            }
            return t.nullable ? s + "?" : s
        }

        func csharp() -> String {
            var blocks: [String] = []
            for d in m.objects {
                // 成员名不能与所在类同名
                let named = nameFields(d.fields, Names.pascalCase, { n in
                    let v = Renderer.underscoreIfInvalid(n)
                    return Names.csharpKeywords.contains(v) ? "@" + v : v
                }, reserved: [d.name], fallback: "Field")
                let props = named.map { nf -> String in
                    var t = csType(nf.field.type)
                    if nf.field.optional && !t.hasSuffix("?") { t += "?" }
                    var initializer = ""
                    if !t.hasSuffix("?") {
                        if t == "string" { initializer = " = string.Empty;" } else if !Renderer.isPrimitive(nf.field.type) { initializer = " = new();" }
                    }
                    return "    [JsonPropertyName(\(JSONToTypes.quote(nf.field.key)))]\n    public \(t) \(nf.name) { get; set; }\(initializer)"
                }
                blocks.append("public class \(d.name)\n{\n\(props.joined(separator: "\n\n"))\n}")
            }
            var usings: [String] = []
            if uses({ Renderer.isArray($0) || Renderer.isMap($0) }, includeRoot: false) { usings.append("using System.Collections.Generic;") }
            if !m.defs.isEmpty { usings.append("using System.Text.Json.Serialization;") }
            var head: [String] = []
            if !usings.isEmpty { head.append(usings.joined(separator: "\n")) }
            if !Renderer.isObject(m.root) { head.append(o.lang.t("// JSON 根节点是 ", "// The JSON root is ") + csType(m.root)) }
            return (head + blocks).joined(separator: "\n\n") + "\n"
        }
    }
}
