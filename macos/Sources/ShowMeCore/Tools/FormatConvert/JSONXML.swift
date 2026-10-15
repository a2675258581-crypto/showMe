import Foundation

/// JSON ⇄ XML 互转（纯 Swift，XML 一侧用自研解析器，Linux 与 macOS 行为一致）。
///
/// - XML → JSON：属性加前缀（默认 `@_`），文本节点用 `#text`，同名子元素合并成数组；
///   可选把数字 / 布尔值转换成对应类型（能原样转回时才转换，如 007、1.0 仍是字符串）。
/// - JSON → XML：顶层有多个键、是数组或基本值时自动用根元素包裹；
///   嵌套数组、空数组、非法的元素名都会被妥善处理并给出提示。
public enum JSONXML {
    public struct Options: Sendable, Hashable {
        /// 属性键前缀（JSON 一侧）；空串表示属性与子元素一样当作普通键
        public var attrPrefix: String
        /// 文本节点键名；空串按 `#text` 处理
        public var textKey: String
        /// JSON → XML：需要包裹时使用的根元素名
        public var rootName: String
        /// 输出缩进单位；空串表示压缩成一行
        public var indent: String
        /// XML → JSON：把数字、布尔值转换成对应类型
        public var parseValues: Bool
        /// XML → JSON：忽略 `<?xml …?>` 声明
        public var ignoreDeclaration: Bool
        /// JSON → XML：输出 `<?xml version="1.0" encoding="UTF-8"?>` 声明
        public var declaration: Bool

        public init(attrPrefix: String = "@_", textKey: String = "#text", rootName: String = "root", indent: String = "  ",
                    parseValues: Bool = true, ignoreDeclaration: Bool = true, declaration: Bool = true) {
            self.attrPrefix = attrPrefix
            self.textKey = textKey
            self.rootName = rootName
            self.indent = indent
            self.parseValues = parseValues
            self.ignoreDeclaration = ignoreDeclaration
            self.declaration = declaration
        }

        var resolvedTextKey: String { textKey.isEmpty ? "#text" : textKey }
    }

    public struct Result: Sendable, Hashable {
        public var output: String
        /// 已按语言生成的提示
        public var warnings: [String]
        /// 元素个数（JSON → XML 为输出的元素数）
        public var elements: Int
        public var attributes: Int
        /// JSON → XML：是否自动加了根元素
        public var wrapped: Bool
    }

    // MARK: 名称与标量

    static func isNameStart(_ v: UInt32) -> Bool { FC.isLetter(v) || v == 0x5F }

    static func isNameChar(_ v: UInt32) -> Bool {
        FC.isLetter(v) || FC.isNumber(v) || FC.isMark(v) || v == 0x5F || v == 0x2E || v == 0x2D || v == 0xB7
    }

    /// 合法的 XML 元素 / 属性名（允许命名空间前缀）
    public static func isXMLName(_ name: String) -> Bool {
        let scalars = Array(name.unicodeScalars)
        guard let first = scalars.first, isNameStart(first.value) else { return false }
        guard scalars.dropFirst().allSatisfy({ isNameChar($0.value) || $0 == ":" }) else { return false }
        return !name.hasSuffix(":") && !name.contains("::")
    }

    /// 把任意字符串整理成合法的 XML 名称：first name → first_name，1abc → _1abc
    public static func xmlName(_ name: String) -> String {
        if isXMLName(name) { return name }
        var out = String.UnicodeScalarView()
        for s in name.unicodeScalars { out.append(isNameChar(s.value) ? s : "_") }
        if let first = out.first, isNameStart(first.value) { return String(out) }
        return "_" + String(out)
    }

    /// 把 XML 文本转换成数字 / 布尔值；只有能原样转回去时才转换：
    /// 42、-3.5、true 会转换；007、1.0、1e5、超出 ±2^53 的整数保持字符串。
    public static func typeScalar(_ s: String) -> JSONValue {
        if s == "true" { return .bool(true) }
        if s == "false" { return .bool(false) }
        let u = Array(s.utf8)
        var i = 0
        if i < u.count, u[i] == 0x2D { i += 1 }
        guard i < u.count, u[i] >= 0x30, u[i] <= 0x39 else { return .string(s) }
        // 只接受 JS 会原样打印回来的写法
        guard u.allSatisfy({ ($0 >= 0x30 && $0 <= 0x39) || $0 == 0x2D || $0 == 0x2E || $0 == 0x65 || $0 == 0x2B }),
              let d = Double(s), let back = FC.jsNumber(d), back == s else { return .string(s) }
        if d == d.rounded(), abs(d) > 9_007_199_254_740_991 { return .string(s) }
        return .number(s)
    }

    /// 写进 XML 文本 / 属性的值：null → 空，对象 / 数组 → 紧凑 JSON
    static func xmlText(_ v: JSONValue) -> String {
        switch v {
        case .null: return ""
        case .string(let s): return s
        case .number(let n): return n
        case .bool(let b): return b ? "true" : "false"
        case .object, .array: return JSON.print(v, .minified)
        }
    }

    static func escape(_ s: String) -> String {
        var out = ""
        out.reserveCapacity(s.utf8.count)
        for ch in s.unicodeScalars {
            switch ch {
            case "&": out += "&amp;"
            case "<": out += "&lt;"
            case ">": out += "&gt;"
            case "'": out += "&apos;"
            case "\"": out += "&quot;"
            default: out.unicodeScalars.append(ch)
            }
        }
        return out
    }

    static func escapeAttr(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    static func jsonIndent(_ unit: String) -> JSON.Indent {
        if unit.isEmpty { return .none }
        if unit == "\t" { return .tab }
        return .spaces(unit.count)
    }
}

// MARK: - JSON → XML

extension JSONXML {
    struct Content {
        var attrs: [(name: String, value: String)] = []
        var items: [Item] = []
    }

    enum Item {
        case text(String)
        case child(String, Content)
    }

    /// 按首次出现顺序去重的列表
    struct OrderedSet {
        private(set) var items: [String] = []
        private var seen = Set<String>()
        mutating func add(_ s: String) { if seen.insert(s).inserted { items.append(s) } }
        var isEmpty: Bool { items.isEmpty }
    }

    struct Builder {
        let o: Options
        let lang: Lang
        var renamed: [(String, String)] = []
        var renamedKeys = Set<String>()
        var stringified = OrderedSet()
        var emptyArrays = OrderedSet()
        var elements = 0
        var attributes = 0

        mutating func rename(_ key: String) -> String {
            let name = JSONXML.xmlName(key)
            if name != key, renamedKeys.insert(key).inserted { renamed.append((key, name)) }
            return name
        }

        /// 一个 JSON 值作为某个元素的内容
        mutating func node(_ value: JSONValue, _ path: String) -> Content {
            switch value {
            case .array(let items):
                if items.isEmpty {
                    emptyArrays.add(path.isEmpty ? lang.t("（根数组）", "(root array)") : path)
                    return Content()
                }
                // 数组直接嵌套数组：用 <item> 包一层
                return element([JSONMember("item", value)], path)
            case .object:
                return element(FC.members(value), path)
            case .null:
                return Content()
            default:
                let t = JSONXML.xmlText(value)
                return t.isEmpty ? Content() : Content(items: [.text(t)])
            }
        }

        mutating func element(_ members: [JSONMember], _ path: String) -> Content {
            var out = Content()
            var used = Set<String>()
            func claim(_ name: String) -> String {
                var n = name
                var i = 2
                while used.contains(n) { n = "\(name)_\(i)"; i += 1 }
                used.insert(n)
                return n
            }
            let prefix = o.attrPrefix
            let textKey = o.resolvedTextKey
            for m in members {
                let key = m.key, value = m.value
                let here = path.isEmpty ? key : "\(path).\(key)"
                if !prefix.isEmpty && key.hasPrefix(prefix) && key.count > prefix.count {
                    let name = rename(String(key.dropFirst(prefix.count)))
                    if value.isContainer { stringified.add(here) }
                    // 属性与子元素的名字互不影响：属性在 used 里带 @ 记录
                    let attrName = String(claim("@" + name).dropFirst())
                    out.attrs.append((attrName, JSONXML.xmlText(value)))
                    attributes += 1
                    continue
                }
                if key == textKey {
                    if value.isContainer { stringified.add(here) }
                    let t = JSONXML.xmlText(value)
                    if !t.isEmpty { out.items.append(.text(t)) }
                    continue
                }
                let name = claim(rename(key))
                if case .array(let items) = value {
                    if items.isEmpty {
                        emptyArrays.add(here)
                        continue
                    }
                    for (i, item) in items.enumerated() {
                        elements += 1
                        out.items.append(.child(name, node(item, "\(here)[\(i)]")))
                    }
                    continue
                }
                elements += 1
                out.items.append(.child(name, node(value, here)))
            }
            return out
        }
    }

    /// 序列化成 XML 文本（显式栈，深层嵌套不爆栈）
    static func serialize(_ roots: [(String, Content)], indent: String) -> String {
        let pretty = !indent.isEmpty
        let nl = pretty ? "\n" : ""
        var out = ""
        var indents = [""]
        func ind(_ level: Int) -> String {
            guard pretty else { return "" }
            while indents.count <= level { indents.append(indents[indents.count - 1] + indent) }
            return indents[level]
        }
        func openTag(_ name: String, _ c: Content) -> String {
            var s = "<" + name
            for a in c.attrs { s += " \(a.name)=\"\(escape(a.value))\"" }
            return s
        }
        enum Work {
            case open(String, Content, Int)
            case raw(String)
        }
        var stack: [Work] = roots.reversed().map { .open($0.0, $0.1, 0) }
        while let w = stack.popLast() {
            switch w {
            case .raw(let s):
                out += s
            case .open(let name, let c, let level):
                let tag = openTag(name, c)
                if c.items.isEmpty {
                    out += ind(level) + tag + "/>" + nl
                } else if c.items.count == 1, case .text(let t) = c.items[0] {
                    out += ind(level) + tag + ">" + escape(t) + "</\(name)>" + nl
                } else {
                    out += ind(level) + tag + ">" + nl
                    stack.append(.raw(ind(level) + "</\(name)>" + nl))
                    for item in c.items.reversed() {
                        switch item {
                        case .child(let n, let cc): stack.append(.open(n, cc, level + 1))
                        case .text(let t): stack.append(.raw(ind(level + 1) + escape(t) + nl))
                        }
                    }
                }
            }
        }
        while out.hasSuffix("\n") { out.removeLast() }
        return out
    }

    /// JSON 文本 → XML 文本；JSON 语法错误抛出带行列的 `ToolError`
    public static func jsonToXML(_ text: String, options: Options = Options(), lang: Lang = .zh) throws -> Result {
        if FC.isJSBlank(text) { return Result(output: "", warnings: [], elements: 0, attributes: 0, wrapped: false) }
        let value: JSONValue
        do {
            value = try JSON.value(text)
        } catch let e as JSONParseError {
            throw e.toolError(lang)
        }
        var b = Builder(o: options, lang: lang)
        let wantedRoot = FC.jsTrim(options.rootName)
        let rootName = xmlName(wantedRoot.isEmpty ? "root" : wantedRoot)
        var body: [(String, Content)] = []
        var wrapped = false
        var declAttrs: [JSONMember]?
        var droppedPIs: [String] = []
        if case .object = value {
            let entries = FC.members(value)
            let rest = entries.filter { !$0.key.hasPrefix("?") }
            for pi in entries where pi.key.hasPrefix("?") {
                if pi.key == "?xml" {
                    if case .object = pi.value { declAttrs = FC.members(pi.value) }
                } else {
                    droppedPIs.append(pi.key)
                }
            }
            let prefix = options.attrPrefix
            if rest.count == 1, !FC.isArray(rest[0].value), rest[0].key != options.resolvedTextKey,
               prefix.isEmpty || !rest[0].key.hasPrefix(prefix) {
                // 单个根元素：直接作为根，不再包裹
                for case .child(let name, let content) in b.element(rest, "").items { body.append((name, content)) }
            } else {
                wrapped = true
                b.elements += 1
                body = [(rootName, b.element(rest, ""))]
            }
        } else {
            wrapped = true
            b.elements += 1
            body = [(rootName, b.node(value, ""))]
        }
        var xml = serialize(body, indent: options.indent)
        if options.declaration {
            var attrs = ""
            if let declAttrs, !options.attrPrefix.isEmpty {
                for m in declAttrs where m.key.hasPrefix(options.attrPrefix) {
                    attrs += " \(m.key.dropFirst(options.attrPrefix.count))=\"\(escapeAttr(xmlText(m.value)))\""
                }
            }
            let decl = "<?xml\(attrs.isEmpty ? " version=\"1.0\" encoding=\"UTF-8\"" : attrs)?>"
            xml = decl + (options.indent.isEmpty ? "" : "\n") + xml
        }

        var warnings: [String] = []
        if wrapped && !wantedRoot.isEmpty && wantedRoot != rootName {
            warnings.append(lang.t("根元素名 “\(wantedRoot)” 不是合法的 XML 名称，已改为 \(rootName)",
                                   "The root name \"\(wantedRoot)\" is not a valid XML name; using \(rootName)"))
        }
        if !b.renamed.isEmpty {
            let list = FC.list(b.renamed.map { lang.t("“\($0.0)” → \($0.1)", "\"\($0.0)\" → \($0.1)") }, lang)
            warnings.append(lang.t("\(list) 不是合法的 XML 名称，已自动替换", "Invalid XML names were replaced: \(list)"))
        }
        if !droppedPIs.isEmpty {
            warnings.append(lang.t("处理指令只支持 ?xml 声明，已忽略：\(FC.list(droppedPIs, lang))",
                                   "Only the ?xml declaration is supported; ignored: \(FC.list(droppedPIs, lang))"))
        }
        if !b.emptyArrays.isEmpty {
            warnings.append(lang.t("空数组无法用 XML 表示，已省略：\(FC.list(b.emptyArrays.items, lang))",
                                   "Empty arrays cannot be represented in XML and were left out: \(FC.list(b.emptyArrays.items, lang))"))
        }
        if !b.stringified.isEmpty {
            warnings.append(lang.t("属性 / 文本节点的值是对象或数组，已转成 JSON 字符串：\(FC.list(b.stringified.items, lang))",
                                   "Object or array values of attributes / text nodes were written as JSON strings: \(FC.list(b.stringified.items, lang))"))
        }
        return Result(output: xml, warnings: warnings, elements: b.elements, attributes: b.attributes, wrapped: wrapped)
    }
}

// MARK: - XML → JSON

extension JSONXML {
    /// HTML 常用命名实体（与 fast-xml-parser 的 htmlEntities 一致）
    static let namedEntities: [String: String] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'",
        "nbsp": "\u{A0}", "cent": "\u{A2}", "pound": "\u{A3}", "yen": "\u{A5}", "euro": "\u{20AC}",
        "copy": "\u{A9}", "reg": "\u{AE}", "inr": "\u{20B9}",
    ]

    /// 解码实体引用；不认识的实体保持原样
    static func decodeEntities(_ s: String, custom: [String: String]) -> String {
        guard s.utf8.contains(0x26) else { return s }
        let u = Array(s.unicodeScalars)
        var out = ""
        var i = 0
        while i < u.count {
            guard u[i] == "&", let semi = u[(i + 1)...].prefix(40).firstIndex(of: ";") else {
                out.unicodeScalars.append(u[i])
                i += 1
                continue
            }
            let name = String(String.UnicodeScalarView(u[(i + 1)..<semi]))
            var replacement: String?
            if name.hasPrefix("#x") || name.hasPrefix("#X") {
                if let v = UInt32(name.dropFirst(2), radix: 16), let sc = Unicode.Scalar(v) { replacement = String(sc) }
            } else if name.hasPrefix("#") {
                if let v = UInt32(name.dropFirst()), let sc = Unicode.Scalar(v) { replacement = String(sc) }
            } else if !name.isEmpty {
                replacement = custom[name] ?? namedEntities[name]
            }
            if let r = replacement {
                out += r
                i = semi + 1
            } else {
                out.unicodeScalars.append(u[i])
                i += 1
            }
        }
        return out
    }

    /// DOCTYPE 内部子集里的 <!ENTITY name "value">
    static func doctypeEntities(_ doctype: String) -> [String: String] {
        var out: [String: String] = [:]
        var rest = Substring(doctype)
        while let r = rest.range(of: "<!ENTITY") {
            rest = rest[r.upperBound...]
            let body = rest.drop(while: { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" })
            guard !body.hasPrefix("%") else { continue }
            let name = body.prefix(while: { !($0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r") })
            let afterName = body.dropFirst(name.count).drop(while: { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" })
            guard let q = afterName.first, q == "\"" || q == "'" else { continue }
            let valueStart = afterName.dropFirst()
            guard let end = valueStart.firstIndex(of: q) else { break }
            if !name.isEmpty, out[String(name)] == nil { out[String(name)] = String(valueStart[..<end]) }
        }
        return out
    }

    /// <?target a="1" b='2'?> → (target, [(a, 1), (b, 2)])
    static func parsePI(_ raw: String) -> (target: String, attrs: [(String, String)]) {
        var body = Substring(raw)
        if body.hasPrefix("<?") { body = body.dropFirst(2) }
        if body.hasSuffix("?>") { body = body.dropLast(2) }
        let isSpace: (Character) -> Bool = { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" }
        let target = body.prefix(while: { !isSpace($0) })
        var rest = body.dropFirst(target.count)
        var attrs: [(String, String)] = []
        while true {
            rest = rest.drop(while: isSpace)
            guard !rest.isEmpty else { break }
            let name = rest.prefix(while: { !isSpace($0) && $0 != "=" })
            rest = rest.dropFirst(name.count).drop(while: isSpace)
            guard !name.isEmpty, rest.first == "=" else {
                // 不是 name="value" 形式（布尔属性等）：跳过这个词
                rest = rest.drop(while: { !isSpace($0) })
                continue
            }
            rest = rest.dropFirst().drop(while: isSpace)
            guard let q = rest.first, q == "\"" || q == "'" else {
                rest = rest.drop(while: { !isSpace($0) })
                continue
            }
            let valueStart = rest.dropFirst()
            guard let end = valueStart.firstIndex(of: q) else { break }
            attrs.append((String(name), String(valueStart[..<end])))
            rest = valueStart[valueStart.index(after: end)...]
        }
        return (String(target), attrs)
    }

    struct Reader {
        let o: Options
        let entities: [String: String]
        var elements = 0
        var attributes = 0

        func typed(_ s: String) -> JSONValue {
            o.parseValues ? JSONXML.typeScalar(s) : .string(s)
        }

        func attrValue(_ raw: String, typed shouldType: Bool) -> JSONValue {
            let v = FC.jsTrim(JSONXML.decodeEntities(raw, custom: entities))
            return shouldType ? typed(v) : .string(v)
        }

        /// 一组子节点 → JSON（attrs 为 nil 表示文档顶层）
        mutating func convert(_ children: [XMLSyntax.Node], attrs: [XMLSyntax.Attribute]?) -> JSONValue {
            var keys: [String] = []
            var groups: [String: [JSONValue]] = [:]
            var text: String?
            func add(_ key: String, _ v: JSONValue) {
                if groups[key] == nil { keys.append(key); groups[key] = [v] } else { groups[key]?.append(v) }
            }
            for child in children {
                switch child {
                case .text(let raw):
                    let t = FC.jsTrim(JSONXML.decodeEntities(raw, custom: entities))
                    if !t.isEmpty { text = (text ?? "") + t }
                case .cdata(let raw):
                    text = (text ?? "") + String(raw.dropFirst(9).dropLast(3))
                case .pi(let raw):
                    let (target, piAttrs) = JSONXML.parsePI(raw)
                    if target == "xml" && o.ignoreDeclaration { continue }
                    var m = FC.OrderedMembers()
                    for (k, v) in piAttrs {
                        m.set(o.attrPrefix + k, attrValue(v, typed: false))
                    }
                    add("?" + target, m.isEmpty ? .string("") : m.value)
                case .element(let el):
                    elements += 1
                    add(el.name, convert(el.children, attrs: el.attrs))
                case .comment, .doctype:
                    continue
                }
            }
            var members = FC.OrderedMembers()
            for k in keys {
                let list = groups[k] ?? []
                members.set(k, list.count == 1 ? list[0] : .array(list))
            }
            let textKey = o.resolvedTextKey
            if let text, !text.isEmpty { members.set(textKey, typed(text)) }
            guard let attrs, !attrs.isEmpty else {
                if attrs == nil { return members.value }
                if members.count == 1, let t = members[textKey] { return t }
                return members.isEmpty ? .string("") : members.value
            }
            // 属性排在最前面，更接近 XML 原文的阅读顺序；同名时属性覆盖子元素
            var head = FC.OrderedMembers()
            for a in attrs {
                attributes += 1
                let key = o.attrPrefix + a.name
                head.set(key, attrValue(a.value, typed: true))
                members.remove(key)
            }
            return .object(head.members + members.members)
        }
    }

    /// XML 文本 → JSON 文本；XML 结构错误抛出带行列的 `ToolError`
    public static func xmlToJSON(_ text: String, options: Options = Options(), lang: Lang = .zh) throws -> Result {
        if FC.isJSBlank(text) { return Result(output: "", warnings: [], elements: 0, attributes: 0, wrapped: false) }
        let doc: XMLSyntax.Document
        do {
            doc = try XMLSyntax.parse(text)
        } catch let e as XMLIssueError {
            throw e.issue.toolError(lang)
        }
        var entities: [String: String] = [:]
        for case .doctype(let d) in doc.children { entities = doctypeEntities(d) }
        var r = Reader(o: options, entities: entities)
        let value = r.convert(doc.children, attrs: nil)
        var warnings: [String] = []
        let roots = doc.children.reduce(0) { n, c in if case .element = c { return n + 1 } else { return n } }
        if roots > 1 {
            warnings.append(lang.t("包含 \(roots) 个根元素，严格来说不是合法的 XML 文档",
                                   "Contains \(roots) root elements, so strictly speaking it is not a well-formed XML document"))
        }
        let json = JSON.print(value, JSON.PrintOptions(indent: jsonIndent(options.indent)))
        return Result(output: json, warnings: warnings, elements: r.elements, attributes: r.attributes, wrapped: false)
    }
}
