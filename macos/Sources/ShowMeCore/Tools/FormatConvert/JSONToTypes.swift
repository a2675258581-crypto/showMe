import Foundation

/// JSON 样例 → 类型模型 → 各语言代码。
///
/// - 数组里的对象会合并字段：部分元素缺少的字段标记为可选，出现过 null 的标记为可空；
/// - 不同基本类型混合时生成联合类型；整数与小数混合时统一为浮点数（`1.0` 也按小数处理）；
/// - 空数组的元素、只出现过 null 的值推断为 unknown / any；空对象推断为 Map；
/// - 嵌套类型按键名 PascalCase 命名，数组元素自动单数化（items → Item、data → DataItem）；
/// - 结构完全相同的对象共用一个类型（billingAddress / shippingAddress → Address）；
/// - 支持 JSON Lines（每行一个 JSON 样例）。
public enum JSONToTypes {
    public enum Primitive: String, Sendable, Hashable {
        case string, integer, number, boolean
    }

    public indirect enum Kind: Sendable, Hashable {
        case primitive(Primitive)
        /// 无法推断（空数组元素、只出现过 null）
        case any
        case array(TypeRef)
        /// 空对象 {}：按「字符串 → 任意值」的字典处理
        case map(TypeRef)
        /// 引用 `Model.defs` 里的对象类型
        case object(Int)
        /// 两个以上互不相同的非 null 类型
        case union([TypeRef])
    }

    public struct TypeRef: Sendable, Hashable {
        public var kind: Kind
        public var nullable: Bool

        public init(_ kind: Kind, nullable: Bool = false) {
            self.kind = kind
            self.nullable = nullable
        }

        static let any = TypeRef(.any)
    }

    public struct Field: Sendable, Hashable {
        /// 原始 JSON 键
        public var key: String
        public var type: TypeRef
        /// 部分样本中缺少这个字段
        public var optional: Bool
    }

    public struct ObjectDef: Sendable, Hashable {
        public var id: Int
        public var name: String
        public var fields: [Field]
    }

    public struct Model: Sendable, Hashable {
        public var rootName: String
        public var root: TypeRef
        /// 按 id 索引
        public var defs: [ObjectDef]
        /// 输出顺序：根对象（若有）在前，其余按首次出现的顺序
        public var order: [Int]

        public var objects: [ObjectDef] { order.map { defs[$0] } }

        public func def(_ id: Int) -> ObjectDef { defs[id] }
    }

    public struct Stats: Sendable, Hashable {
        public var types = 0, fields = 0, optional = 0, nullable = 0
    }

    public static func stats(_ m: Model) -> Stats {
        var s = Stats()
        s.types = m.defs.count
        for o in m.defs {
            s.fields += o.fields.count
            for f in o.fields {
                if f.optional { s.optional += 1 }
                if f.type.nullable { s.nullable += 1 }
            }
        }
        return s
    }

    // MARK: - 解析样例

    public struct Samples: Sendable, Hashable {
        public var values: [JSONValue]
        public var jsonLines: Bool
        public var empty: Bool
    }

    /// 普通 JSON 返回一个样例；JSON Lines（每行一个值）返回多个样例。解析失败抛出带行列的 `ToolError`。
    public static func parseSamples(_ text: String, lang: Lang = .zh) throws -> Samples {
        if FC.isJSBlank(text) { return Samples(values: [], jsonLines: false, empty: true) }
        let whole: JSONParseError
        do {
            return Samples(values: [try JSON.value(text)], jsonLines: false, empty: false)
        } catch let e as JSONParseError {
            whole = e
        }
        // 继续尝试 JSON Lines
        var lines: [(text: String, no: Int)] = []
        var no = 1
        var start = text.unicodeScalars.startIndex
        let scalars = text.unicodeScalars
        var i = scalars.startIndex
        while i < scalars.endIndex {
            let c = scalars[i]
            if c == "\n" || c == "\r" {
                lines.append((String(scalars[start..<i]), no))
                no += 1
                var next = scalars.index(after: i)
                if c == "\r", next < scalars.endIndex, scalars[next] == "\n" { next = scalars.index(after: next) }
                i = next
                start = i
            } else {
                i = scalars.index(after: i)
            }
        }
        lines.append((String(scalars[start...]), no))
        let filled = lines.filter { !FC.isJSBlank($0.text) }
        if filled.count >= 2 {
            var values: [JSONValue] = []
            var bad: (text: String, no: Int, error: JSONParseError)?
            for line in filled {
                do {
                    values.append(try JSON.value(line.text))
                } catch let e as JSONParseError {
                    bad = (line.text, line.no, e)
                    break
                }
            }
            guard let bad else { return Samples(values: values, jsonLines: true, empty: false) }
            // 前面至少有一行是完整的对象 / 数组：多半是 JSON Lines 里某一行写错了，直接指出那一行
            let first = FC.jsTrim(filled[0].text)
            if !values.isEmpty, first.hasPrefix("{") || first.hasPrefix("[") {
                let line = bad.no - 1 + bad.error.line
                throw ToolError(lang.t("JSON Lines 第 \(bad.no) 行：", "JSON Lines, line \(bad.no): ") + bad.error.message(lang),
                                line: line, column: bad.error.column)
            }
        }
        throw whole.toolError(lang)
    }

    // MARK: - 形状推断

    /// 超过此深度的值按 any 处理
    static let maxDepth = 128
    /// 超出 int64 范围的整数按浮点数处理
    static let int64Limit = 9.223372036854776e18

    final class ObjShape {
        var count = 0
        var keys: [String] = []
        var fields: [String: Shape] = [:]
    }

    final class Shape {
        /// 观察到的值数量（含 null）
        var count = 0
        var nulls = 0, string = 0, integer = 0, float = 0, boolean = 0
        /// 超出深度限制
        var deep = 0
        var arrayCount = 0
        var items: Shape?
        var object: ObjShape?

        var hasPrimitive: Bool { string + integer + float + boolean + deep > 0 }
    }

    static func observe(_ s: Shape, _ v: JSONValue, _ depth: Int) {
        s.count += 1
        switch v {
        case .null:
            s.nulls += 1
        case .string:
            s.string += 1
        case .bool:
            s.boolean += 1
        case .number(let raw):
            // 源码里写成 1.0 / 1e3 的整数值也按浮点数推断
            if raw.utf8.contains(where: { $0 == 0x2E || $0 == 0x65 || $0 == 0x45 }) {
                s.float += 1
            } else if let d = Double(raw), abs(d) < int64Limit {
                s.integer += 1
            } else {
                s.float += 1
            }
        case .array(let list):
            if depth >= maxDepth { s.deep += 1; return }
            s.arrayCount += 1
            let items = s.items ?? Shape()
            s.items = items
            for item in list { observe(items, item, depth + 1) }
        case .object:
            if depth >= maxDepth { s.deep += 1; return }
            let o = s.object ?? ObjShape()
            s.object = o
            o.count += 1
            for m in FC.members(v) {
                let f: Shape
                if let existing = o.fields[m.key] {
                    f = existing
                } else {
                    f = Shape()
                    o.fields[m.key] = f
                    o.keys.append(m.key)
                }
                observe(f, m.value, depth + 1)
            }
        }
    }

    // MARK: - 建模：去重 + 命名

    final class ObjNode {
        var id = -1
        var name = ""
        var fields: [Field] = []
        var sig = ""
        /// 先序编号：越小越先出现（用于稳定命名与输出顺序）
        let order: Int
        var candidates: [(name: String, parent: ObjNode?)] = []

        init(order: Int) { self.order = order }
    }

    struct Builder {
        var bySig: [String: ObjNode] = [:]
        var nodes: [ObjNode] = []
        var order = 0

        func sig(_ t: TypeRef) -> String {
            let n = t.nullable ? "?" : ""
            switch t.kind {
            case .primitive(let p): return String(p.rawValue.prefix(1)) + n
            case .any: return "A" + n
            case .array(let item): return "[\(sig(item))]" + n
            case .map(let v): return "M(\(sig(v)))" + n
            case .object(let id): return "O\(id)" + n
            case .union(let members): return "U(" + members.map(sig).joined(separator: "|") + ")" + n
            }
        }

        /// Shape → TypeRef；nameHint 为该位置的类型名候选，parent 为所在对象
        mutating func build(_ s: Shape, _ nameHint: String, _ parent: ObjNode?) -> TypeRef {
            let nullable = s.nulls > 0
            var members: [TypeRef] = []
            if s.string > 0 { members.append(TypeRef(.primitive(.string))) }
            if s.integer > 0 || s.float > 0 { members.append(TypeRef(.primitive(s.float > 0 ? .number : .integer))) }
            if s.boolean > 0 { members.append(TypeRef(.primitive(.boolean))) }
            if s.arrayCount > 0 {
                let item: TypeRef
                if let items = s.items, items.count > 0 {
                    item = build(items, Names.typeName(fromKey: nameHint, plural: true), parent)
                } else {
                    item = .any
                }
                members.append(TypeRef(.array(item)))
            }
            if let o = s.object { members.append(buildObject(o, nameHint, parent)) }
            if s.deep > 0 { members.append(.any) }
            if members.isEmpty || members.contains(where: { $0.kind == .any }) { return TypeRef(.any, nullable: nullable) }
            if members.count == 1 { return TypeRef(members[0].kind, nullable: nullable) }
            return TypeRef(.union(members), nullable: nullable)
        }

        mutating func buildObject(_ o: ObjShape, _ nameHint: String, _ parent: ObjNode?) -> TypeRef {
            if o.keys.isEmpty { return TypeRef(.map(.any)) }
            // 先占位，子类型命名时可以用它作为「父类型」前缀
            let placeholder = ObjNode(order: order)
            order += 1
            var fields: [Field] = []
            for key in o.keys {
                guard let shape = o.fields[key] else { continue }
                fields.append(Field(key: key, type: build(shape, key, placeholder), optional: shape.count < o.count))
            }
            let signature = fields.map { "\(JSON.quote($0.key)):\(sig($0.type))\($0.optional ? "~" : "")" }.sorted().joined(separator: ",")
            if let existing = bySig[signature] {
                existing.candidates.append((nameHint, parent))
                // 子类型里记录的父节点指向占位节点：改指向已有节点
                for n in nodes {
                    for k in n.candidates.indices where n.candidates[k].parent === placeholder { n.candidates[k].parent = existing }
                }
                return TypeRef(.object(existing.id))
            }
            placeholder.fields = fields
            placeholder.sig = signature
            placeholder.candidates.append((nameHint, parent))
            placeholder.id = nodes.count
            bySig[signature] = placeholder
            nodes.append(placeholder)
            return TypeRef(.object(placeholder.id))
        }
    }

    /// 把用户输入的根类型名整理成合法的 PascalCase
    public static func normalizeRootName(_ name: String) -> String {
        let n = Names.typeName(fromKey: FC.jsTrim(name))
        return n.isEmpty ? "Root" : n
    }

    /// Root → RootItem；Users → User
    static func singularOrItem(_ name: String) -> String {
        var words = Names.keyWords(name)
        guard let last = words.last else { return "Item" }
        let single = Names.singularize(last)
        if single != last { words[words.count - 1] = single } else { words.append("item") }
        return words.map(Names.cap).joined()
    }

    static func assignNames(_ nodes: [ObjNode], rootName: String, rootNode: ObjNode?) {
        // 根不是对象时（数组 / 基本类型）根名用于类型别名，同样占用
        var taken: Set<String> = [rootName.lowercased()]
        func free(_ n: String) -> Bool { !n.isEmpty && !taken.contains(n.lowercased()) && !Names.reservedTypeNames.contains(n) }
        for node in nodes.sorted(by: { $0.order < $1.order }) {
            if node === rootNode {
                node.name = rootName
                continue
            }
            var names: [String] = []
            for c in node.candidates {
                let n = Names.typeName(fromKey: c.name)
                let v = n.isEmpty ? "Type" : n
                if !names.contains(v) { names.append(v) }
            }
            let base = names.count == 1 ? names[0] : (Names.commonSuffixName(names) ?? names[0])
            var parentName = ""
            if let p = node.candidates.first?.parent, p !== node { parentName = p.name }
            var name: String
            if free(base) {
                name = base
            } else if !parentName.isEmpty, free(parentName + base) {
                name = parentName + base
            } else {
                let stem = Names.reservedTypeNames.contains(base) ? parentName + base + "Model" : base
                name = stem
                var i = 2
                while !free(name) { name = "\(stem)\(i)"; i += 1 }
            }
            taken.insert(name.lowercased())
            node.name = name
        }
    }

    /// 从若干样例推断类型模型。多个样例（JSON Lines）视为同一个根类型的多次观察。
    public static func inferModel(_ samples: [JSONValue], rootName rawRoot: String = "Root") -> Model {
        let rootName = normalizeRootName(rawRoot)
        let shape = Shape()
        for s in samples { observe(shape, s, 0) }
        var b = Builder()
        let root: TypeRef
        if shape.count == 0 {
            root = .any
        } else if shape.arrayCount > 0, shape.object == nil, !shape.hasPrimitive {
            // 根是数组：元素直接用单数名，避免 RootItem 再套一层
            let item: TypeRef
            if let items = shape.items, items.count > 0 {
                item = b.build(items, singularOrItem(rootName), nil)
            } else {
                item = .any
            }
            root = TypeRef(.array(item), nullable: shape.nulls > 0)
        } else {
            root = b.build(shape, rootName, nil)
        }
        var rootNode: ObjNode?
        if case .object(let id) = root.kind { rootNode = b.nodes[id] }
        assignNames(b.nodes, rootName: rootName, rootNode: rootNode)
        let defs = b.nodes.map { ObjectDef(id: $0.id, name: $0.name, fields: $0.fields) }
        let order = b.nodes.sorted { $0.order < $1.order }.map(\.id)
        return Model(rootName: rootName, root: root, defs: defs, order: order)
    }
}
