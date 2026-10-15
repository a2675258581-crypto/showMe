import Foundation

/// XML 格式化 / 压缩 / 校验。App 的「格式化文档」命令也用它。
public enum XMLFormatter {
    /// 属性换行：auto = 单行超过行宽时每个属性一行
    public enum AttrWrap: String, Sendable, Hashable, CaseIterable {
        case auto, always, never
    }

    public struct Options: Sendable, Hashable {
        /// 缩进单位，如 "  "、"    "、"\t"
        public var indent: String
        /// 压缩为一行
        public var minify: Bool
        public var keepComments: Bool
        /// 没有内容的元素写成 <a/>
        public var selfClose: Bool
        public var attrWrap: AttrWrap
        public var printWidth: Int

        public init(indent: String = "  ", minify: Bool = false, keepComments: Bool = true, selfClose: Bool = true, attrWrap: AttrWrap = .auto, printWidth: Int = 100) {
            self.indent = indent
            self.minify = minify
            self.keepComments = keepComments
            self.selfClose = selfClose
            self.attrWrap = attrWrap
            self.printWidth = printWidth
        }
    }

    public struct Stats: Sendable, Hashable {
        public var elements = 0
        public var attributes = 0
        /// 元素嵌套深度，根元素为 1
        public var maxDepth = 0
        public var comments = 0
        public var cdata = 0
    }

    public struct Output: Sendable, Hashable {
        public var text: String
        public var warnings: [XMLIssue]
        public var stats: Stats
    }

    /// 美化 XML；结构错误抛出带行列的 `ToolError`。
    public static func format(_ xml: String, indent: String = "  ", lang: Lang = .zh) throws -> String {
        try process(xml, options: Options(indent: indent), lang: lang).text
    }

    /// 压缩成一行（去掉标签之间的排版空白）。
    public static func minify(_ xml: String, lang: Lang = .zh) throws -> String {
        try process(xml, options: Options(minify: true), lang: lang).text
    }

    /// 解析并按选项输出，附带警告与统计。
    public static func process(_ xml: String, options: Options, lang: Lang = .zh) throws -> Output {
        let doc: XMLSyntax.Document
        do {
            doc = try XMLSyntax.parse(xml)
        } catch let e as XMLIssueError {
            throw e.issue.toolError(lang)
        }
        let st = stats(doc.children)
        if options.minify {
            var out = ""
            minifyNodes(doc.children, options, into: &out)
            return Output(text: out, warnings: doc.warnings, stats: st)
        }
        var p = PrettyPrinter(options)
        p.printNodes(doc.children, level: 0)
        return Output(text: p.lines.joined(separator: "\n"), warnings: doc.warnings, stats: st)
    }

    /// 只校验结构，返回警告（不合法时抛出 `ToolError`）。
    public static func validate(_ xml: String, lang: Lang = .zh) throws -> [XMLIssue] {
        do {
            return try XMLSyntax.parse(xml).warnings
        } catch let e as XMLIssueError {
            throw e.issue.toolError(lang)
        }
    }

    static func stats(_ nodes: [XMLSyntax.Node]) -> Stats {
        var st = Stats()
        var stack: [(XMLSyntax.Node, Int)] = nodes.map { ($0, 1) }
        while let (n, d) = stack.popLast() {
            switch n {
            case .element(let el):
                st.elements += 1
                st.attributes += el.attrs.count
                st.maxDepth = max(st.maxDepth, d)
                for c in el.children { stack.append((c, d + 1)) }
            case .comment: st.comments += 1
            case .cdata: st.cdata += 1
            default: break
            }
        }
        return st
    }
}

// MARK: - 文本工具

extension XMLFormatter {
    static func isLayoutSpace(_ s: Unicode.Scalar) -> Bool {
        s == " " || s == "\t" || s == "\r" || s == "\n"
    }

    static func isBlank(_ t: String) -> Bool {
        t.unicodeScalars.allSatisfy(isLayoutSpace)
    }

    /// 混合内容：子节点里有非空白文本
    static func isMixed(_ nodes: [XMLSyntax.Node]) -> Bool {
        nodes.contains { if case .text(let t) = $0 { return !isBlank(t) } else { return false } }
    }

    /// 内联 / 压缩时的文本：去掉首尾排版空白，内部换行缩进折叠成一个空格；
    /// 混合内容中夹在两个节点之间的纯空白折叠成一个空格保留。
    static func inlineText(_ t: String, first: Bool, last: Bool, mixed: Bool) -> String {
        if isBlank(t) { return mixed && !first && !last ? " " : "" }
        return collapseLayout(trimLayout(t, start: first, end: last))
    }

    /// 含换行的空白（缩进）折叠成一个空格，不含换行的空白保持原样
    static func collapseLayout(_ t: String) -> String {
        var out = ""
        var pending = ""
        var it = t.unicodeScalars.makeIterator()
        var next = it.next()
        while let c = next {
            if c == " " || c == "\t" {
                pending.unicodeScalars.append(c)
                next = it.next()
            } else if c == "\r" || c == "\n" {
                pending = ""
                next = it.next()
                while let d = next, isLayoutSpace(d) { next = it.next() }
                out += " "
            } else {
                if !pending.isEmpty {
                    out += pending
                    pending = ""
                }
                out.unicodeScalars.append(c)
                next = it.next()
            }
        }
        return out + pending
    }

    static func trimLayout(_ t: String, start: Bool, end: Bool) -> String {
        var scalars = Substring(t).unicodeScalars
        if start { scalars = scalars.drop(while: isLayoutSpace) }
        if end {
            while let last = scalars.last, isLayoutSpace(last) { scalars.removeLast() }
        }
        return String(scalars)
    }

    /// \r\n、\r → \n
    static func normalizeNewlines(_ t: String) -> String {
        guard t.utf8.contains(0x0D) else { return t }
        var out: [UInt8] = []
        out.reserveCapacity(t.utf8.count)
        var prevCR = false
        for b in t.utf8 {
            if b == 0x0D {
                out.append(0x0A)
                prevCR = true
            } else {
                if !(b == 0x0A && prevCR) { out.append(b) }
                prevCR = false
            }
        }
        return String(decoding: out, as: UTF8.self)
    }

    static func preserveSpace(_ el: XMLSyntax.Element, inherited: Bool) -> Bool {
        if let a = el.attrs.first(where: { $0.name == "xml:space" }) { return a.value == "preserve" }
        return inherited
    }

    static func attrText(_ a: XMLSyntax.Attribute) -> String {
        "\(a.name)=\(a.quote)\(a.value)\(a.quote)"
    }

    static func openTag(_ el: XMLSyntax.Element, _ close: String) -> String {
        var s = "<" + el.name
        for a in el.attrs { s += " " + attrText(a) }
        return s + close
    }

    static func rawText(_ n: XMLSyntax.Node) -> String {
        switch n {
        case .text(let t), .cdata(let t), .comment(let t), .pi(let t), .doctype(let t): return t
        case .element: return ""
        }
    }

    /// 原样序列化（用于 xml:space="preserve"）。用显式栈代替递归，深层嵌套也不会爆栈。
    static func serializeRaw(_ nodes: [XMLSyntax.Node], into out: inout String) {
        var stack: [(nodes: [XMLSyntax.Node], index: Int, close: String)] = [(nodes, 0, "")]
        while let top = stack.indices.last {
            guard stack[top].index < stack[top].nodes.count else {
                out += stack.removeLast().close
                continue
            }
            let n = stack[top].nodes[stack[top].index]
            stack[top].index += 1
            if case .element(let el) = n {
                if el.children.isEmpty && el.selfClosing {
                    out += openTag(el, "/>")
                } else {
                    out += openTag(el, ">")
                    stack.append((el.children, 0, "</\(el.name)>"))
                }
            } else {
                out += rawText(n)
            }
        }
    }

    struct MinifyFrame {
        var kept: [XMLSyntax.Node]
        var mixed: Bool
        var preserve: Bool
        var index = 0
        /// 结束标签；文档顶层为 nil
        var close: String?
        /// 写下开始标签后的输出长度，用来判断元素有没有内容
        var mark = 0
        var selfClosable = false
    }

    static func minifyNodes(_ nodes: [XMLSyntax.Node], _ o: Options, into out: inout String) {
        func frame(_ nodes: [XMLSyntax.Node], preserve: Bool) -> MinifyFrame {
            let kept = o.keepComments ? nodes : nodes.filter { if case .comment = $0 { return false } else { return true } }
            return MinifyFrame(kept: kept, mixed: isMixed(kept), preserve: preserve)
        }
        var stack = [frame(nodes, preserve: false)]
        while let top = stack.indices.last {
            let f = stack[top]
            guard f.index < f.kept.count else {
                stack.removeLast()
                if let close = f.close {
                    if out.utf8.count == f.mark && f.selfClosable {
                        // 没有内容：把刚写下的 ">" 改成 "/>"
                        out.removeLast()
                        out += "/>"
                    } else {
                        out += close
                    }
                }
                continue
            }
            let i = f.index
            stack[top].index += 1
            switch f.kept[i] {
            case .text(let t):
                out += f.preserve ? t : inlineText(t, first: i == 0, last: i == f.kept.count - 1, mixed: f.mixed)
            case .element(let el):
                out += openTag(el, ">")
                var child = frame(el.children, preserve: preserveSpace(el, inherited: f.preserve))
                child.close = "</\(el.name)>"
                child.mark = out.utf8.count
                child.selfClosable = el.selfClosing || o.selfClose
                stack.append(child)
            case let n:
                out += rawText(n)
            }
        }
    }
}

// MARK: - 美化

extension XMLFormatter {
    struct PrettyPrinter {
        var lines: [String] = []
        let o: Options
        let unit: String
        let unitWidth: Int
        let width: Int
        var indents: [String] = [""]

        init(_ o: Options) {
            self.o = o
            unit = o.indent
            unitWidth = o.indent == "\t" ? 4 : max(0, o.indent.count)
            width = o.printWidth
        }

        mutating func ind(_ level: Int) -> String {
            while indents.count <= level { indents.append(indents[indents.count - 1] + unit) }
            return indents[level]
        }

        func keep(_ n: XMLSyntax.Node) -> Bool {
            switch n {
            case .text(let t): return !XMLFormatter.isBlank(t)
            case .comment: return o.keepComments
            default: return true
            }
        }

        struct Frame {
            var kids: [XMLSyntax.Node]
            var level: Int
            var index = 0
            /// 子节点打印完后要追加的结束标签行
            var close: String?
        }

        /// 用显式栈代替递归，深层嵌套也不会爆栈
        mutating func printNodes(_ nodes: [XMLSyntax.Node], level: Int) {
            var stack = [Frame(kids: nodes.filter(keep), level: level)]
            while let top = stack.indices.last {
                let f = stack[top]
                guard f.index < f.kids.count else {
                    if let close = stack.removeLast().close { lines.append(close) }
                    continue
                }
                stack[top].index += 1
                if case .element(let el) = f.kids[f.index] {
                    if let child = printElement(el, level: f.level) { stack.append(child) }
                } else {
                    printNode(f.kids[f.index], level: f.level)
                }
            }
        }

        /// 文本、注释、CDATA、PI、DOCTYPE
        mutating func printNode(_ n: XMLSyntax.Node, level: Int) {
            switch n {
            case .element:
                printNodes([n], level: level)
            case .text(let t):
                let prefix = ind(level)
                for line in XMLFormatter.normalizeNewlines(t).split(separator: "\n", omittingEmptySubsequences: false) {
                    let trimmed = FC.jsTrim(String(line))
                    if !trimmed.isEmpty { lines.append(prefix + trimmed) }
                }
            default:
                // 原样输出，统一换行符
                lines.append(ind(level) + XMLFormatter.normalizeNewlines(XMLFormatter.rawText(n)))
            }
        }

        /// 开始标签（可能按属性换行成多行），返回各行（已缩进）
        mutating func openLines(_ el: XMLSyntax.Element, level: Int, close: String) -> [String] {
            let tag = XMLFormatter.openTag(el, close)
            let wrap = el.attrs.count > 1 && (o.attrWrap == .always
                || (o.attrWrap == .auto && level * unitWidth + tag.utf16.count > width))
            if !wrap { return [ind(level) + tag] }
            // 每个属性一行，结尾的 > 或 /> 单独一行，与子元素区分开
            var out = [ind(level) + "<" + el.name]
            let inner = ind(level + 1)
            for a in el.attrs { out.append(inner + XMLFormatter.attrText(a)) }
            out.append(ind(level) + close)
            return out
        }

        /// 尝试把元素及其内容排在一行里；不能内联或超过 limit 个字符时返回 nil
        func inline(_ el: XMLSyntax.Element, preserve: Bool, limit: Int) -> String? {
            if XMLFormatter.preserveSpace(el, inherited: preserve) {
                var raw = ""
                XMLFormatter.serializeRaw([.element(el)], into: &raw)
                return FC.hasNewline(raw) || raw.utf16.count > limit ? nil : raw
            }
            if !el.children.contains(where: keep) {
                let s = el.selfClosing || o.selfClose ? XMLFormatter.openTag(el, "/>") : XMLFormatter.openTag(el, ">") + "</\(el.name)>"
                return s.utf16.count > limit ? nil : s
            }
            let open = XMLFormatter.openTag(el, ">")
            let close = "</\(el.name)>"
            var length = open.utf16.count + close.utf16.count
            guard length <= limit else { return nil }
            // 混合内容保留节点之间的空白，所以这里只去掉被丢弃的注释，不去掉空白文本
            let kids = o.keepComments ? el.children : el.children.filter { if case .comment = $0 { return false } else { return true } }
            let mixed = XMLFormatter.isMixed(kids)
            var body = ""
            for (i, k) in kids.enumerated() {
                let piece: String
                switch k {
                case .text(let t):
                    piece = XMLFormatter.inlineText(t, first: i == 0, last: i == kids.count - 1, mixed: mixed)
                case .cdata(let t), .comment(let t):
                    if FC.hasNewline(t) { return nil }
                    piece = t
                case .element(let child):
                    guard let s = inline(child, preserve: false, limit: limit - length) else { return nil }
                    piece = s
                default:
                    return nil
                }
                length += piece.utf16.count
                if length > limit { return nil }
                body += piece
            }
            return open + body + close
        }

        /// 打印一个元素；需要逐个打印子节点时返回子节点的帧
        mutating func printElement(_ el: XMLSyntax.Element, level: Int) -> Frame? {
            let indent = ind(level)
            if XMLFormatter.preserveSpace(el, inherited: false) {
                // 内容原样保留
                var raw = ""
                XMLFormatter.serializeRaw([.element(el)], into: &raw)
                lines.append(indent + XMLFormatter.normalizeNewlines(raw))
                return nil
            }
            let kids = el.children.filter(keep)
            if kids.isEmpty {
                if el.selfClosing || o.selfClose {
                    lines.append(contentsOf: openLines(el, level: level, close: "/>"))
                } else {
                    var open = openLines(el, level: level, close: ">")
                    open[open.count - 1] += "</\(el.name)>"
                    lines.append(contentsOf: open)
                }
                return nil
            }
            // 有文本内容（纯文本或混合内容）时，短的整体放在一行
            let hasText = kids.contains { switch $0 { case .text, .cdata: return true; default: return false } }
            if hasText, let one = inline(el, preserve: false, limit: width - level * unitWidth) {
                lines.append(indent + one)
                return nil
            }
            lines.append(contentsOf: openLines(el, level: level, close: ">"))
            return Frame(kids: kids, level: level + 1, close: indent + "</\(el.name)>")
        }
    }
}
