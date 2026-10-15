import Foundation

// XML 分词 + 解析（自研，不依赖 XMLParser，Linux 与 macOS 行为一致）。
// XML 声明、DOCTYPE（含内部子集）、注释、CDATA、处理指令、命名空间、自闭合标签、
// 属性（保留原引号）、实体引用校验；错误与警告带 1 起始的行列。

/// XML 的错误或警告：消息双语，位置 1 起始（列按 Unicode 标量计）。
public struct XMLIssue: Sendable, Hashable {
    public var message: LocalizedText
    /// 修改建议
    public var hint: LocalizedText?
    public var line: Int
    public var column: Int
    /// UTF-8 字节偏移
    public var offset: Int

    public init(message: LocalizedText, hint: LocalizedText? = nil, line: Int, column: Int, offset: Int) {
        self.message = message
        self.hint = hint
        self.line = line
        self.column = column
        self.offset = offset
    }

    /// 「第 3 行第 15 列：…（建议）」
    public func text(_ lang: Lang) -> String {
        var s = lang.t("第 \(line) 行第 \(column) 列：", "Line \(line), column \(column): ") + message(lang)
        if let hint { s += lang.t("（\(hint.zh)）", " (\(hint.en))") }
        return s
    }

    public func toolError(_ lang: Lang) -> ToolError {
        ToolError(text(lang), line: line, column: column)
    }
}

enum XMLSyntax {
    /// 最大嵌套层数：打印是递归的，过深的文档会撑爆调用栈
    static let maxDepth = 1000
    static let maxWarnings = 30

    struct Attribute: Sendable, Hashable {
        var name: String
        /// 原文（实体引用不解码）
        var value: String
        /// `"` 或 `'`
        var quote: Character
        var offset: Int
    }

    struct Element: Sendable, Hashable {
        var name: String
        var attrs: [Attribute]
        var children: [Node]
        /// 原文是否写成 <a/>
        var selfClosing: Bool
        var start: Int
    }

    /// 文本按原文保存（实体不解码）；CDATA、注释、处理指令、DOCTYPE 都是含定界符的原文
    enum Node: Sendable, Hashable {
        case element(Element)
        case text(String)
        case cdata(String)
        case comment(String)
        case pi(String)
        case doctype(String)
    }

    struct Document: Sendable {
        var children: [Node]
        var warnings: [XMLIssue]
    }

    static func parse(_ text: String) throws -> Document {
        var p = Parser(Array(text.utf8))
        return try p.parse()
    }
}

extension XMLSyntax {
    struct Parser {
        let s: [UInt8]
        var i = 0
        var docChildren: [Node] = []
        var stack: [Element] = []
        /// 每层元素声明的命名空间前缀
        var ns: [[String]] = []
        var warnings: [XMLIssue] = []
        var warnedPrefixes = Set<String>()
        var roots = 0
        var sawDoctype = false
        var sawMultiRoot = false
        var sawOuterText = false
        var bom = 0

        init(_ bytes: [UInt8]) {
            s = bytes
        }

        static let commentOpen = Array("<!--".utf8)
        static let commentClose = Array("-->".utf8)
        static let cdataOpen = Array("<![CDATA[".utf8)
        static let cdataClose = Array("]]>".utf8)

        func issue(_ offset: Int, _ message: LocalizedText, _ hint: LocalizedText?) -> XMLIssue {
            let (line, column) = FC.lineColumn(s, offset)
            return XMLIssue(message: message, hint: hint, line: line, column: column, offset: offset)
        }

        func fail(_ offset: Int, _ message: LocalizedText, _ hint: LocalizedText? = nil) -> XMLIssueError {
            XMLIssueError(issue: issue(offset, message, hint))
        }

        mutating func warn(_ offset: Int, _ message: LocalizedText, _ hint: LocalizedText? = nil) {
            guard warnings.count < XMLSyntax.maxWarnings else { return }
            warnings.append(issue(offset, message, hint))
        }

        func whereText(_ offset: Int) -> LocalizedText {
            let (line, column) = FC.lineColumn(s, offset)
            return LocalizedText("第 \(line) 行第 \(column) 列", "line \(line), column \(column)")
        }

        mutating func add(_ node: Node) {
            if stack.isEmpty {
                docChildren.append(node)
            } else {
                stack[stack.count - 1].children.append(node)
            }
        }

        static func isWs(_ b: UInt8) -> Bool { b == 0x20 || b == 0x09 || b == 0x0A || b == 0x0D }

        func skipWs(_ from: Int) -> Int {
            var j = from
            while j < s.count, Parser.isWs(s[j]) { j += 1 }
            return j
        }

        /// 读取 XML 名称，返回字节长度（0 表示不是名称）
        func nameLength(at: Int) -> Int {
            guard at < s.count else { return 0 }
            var j = at
            let (c0, l0) = FC.scalar(s, j)
            guard FC.isLetter(c0) || c0 == 0x5F || c0 == 0x3A else { return 0 }
            j += l0
            while j < s.count {
                let (c, l) = FC.scalar(s, j)
                let ok = FC.isLetter(c) || FC.isNumber(c) || FC.isMark(c)
                    || c == 0x5F || c == 0x3A || c == 0x2E || c == 0x2D || c == 0xB7 || c == 0x203F || c == 0x2040
                guard ok else { break }
                j += l
            }
            return j - at
        }

        func readName(_ at: Int) -> String {
            let n = nameLength(at: at)
            return n == 0 ? "" : FC.text(s, at, at + n)
        }

        /// & 开头的实体引用长度（含 ;）；不合法返回 nil
        func entityLength(at k: Int) -> Int? {
            var j = k + 1
            guard j < s.count else { return nil }
            if s[j] == 0x23 { // #
                j += 1
                if j < s.count, s[j] == 0x78 { // x
                    j += 1
                    let start = j
                    while j < s.count, isHexDigit(s[j]) { j += 1 }
                    guard j > start else { return nil }
                } else {
                    let start = j
                    while j < s.count, s[j] >= 0x30, s[j] <= 0x39 { j += 1 }
                    guard j > start else { return nil }
                }
            } else {
                let (c0, l0) = FC.scalar(s, j)
                guard FC.isLetter(c0) || c0 == 0x5F || c0 == 0x3A else { return nil }
                j += l0
                while j < s.count {
                    let (c, l) = FC.scalar(s, j)
                    guard FC.isLetter(c) || FC.isNumber(c) || c == 0x5F || c == 0x3A || c == 0x2E || c == 0x2D else { break }
                    j += l
                }
            }
            guard j < s.count, s[j] == 0x3B else { return nil }
            return j + 1 - k
        }

        func isHexDigit(_ b: UInt8) -> Bool {
            (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66)
        }

        /// 校验 [from, to) 中的实体引用
        func checkEntities(_ from: Int, _ to: Int, _ place: LocalizedText) throws {
            var k = from
            while k < to {
                if s[k] == 0x26 {
                    guard let len = entityLength(at: k), k + len <= to else {
                        throw fail(
                            k,
                            LocalizedText("\(place.zh)中有未转义的 \"&\"", "Unescaped \"&\" in \(place.en)"),
                            LocalizedText(
                                "\"&\" 要写作 &amp;；实体引用要以 \";\" 结尾，例如 &lt; &#169; &#x4E2D;",
                                "write \"&\" as &amp;; entity references end with \";\", e.g. &lt; &#169; &#x4E2D;"
                            )
                        )
                    }
                    k += len
                } else {
                    k += 1
                }
            }
        }

        func describe(_ at: Int) -> LocalizedText {
            guard at < s.count else { return LocalizedText("文本结尾", "the end of the text") }
            switch s[at] {
            case 0x20: return LocalizedText("空格", "a space")
            case 0x0A, 0x0D: return LocalizedText("换行", "a line break")
            case 0x09: return LocalizedText("制表符", "a tab")
            default:
                let (_, l) = FC.scalar(s, at)
                let ch = FC.text(s, at, at + l)
                return LocalizedText("\"\(ch)\"", "\"\(ch)\"")
            }
        }

        mutating func parse() throws -> Document {
            if FC.has(s, [0xEF, 0xBB, 0xBF], at: 0) { i = 3; bom = 3 }
            while i < s.count {
                let lt = FC.find(s, 0x3C, from: i)
                if lt != i {
                    let end = lt ?? s.count
                    try text(i, end)
                    i = end
                    continue
                }
                let next: UInt8 = i + 1 < s.count ? s[i + 1] : 0
                if next == 0x21 { // <!
                    if FC.has(s, Parser.commentOpen, at: i) {
                        try comment()
                    } else if FC.has(s, Parser.cdataOpen, at: i) {
                        try cdata()
                    } else if FC.text(s, i, i + 9).uppercased() == "<!DOCTYPE" {
                        try doctype()
                    } else {
                        throw fail(
                            i,
                            LocalizedText("无法识别的声明 \"<!\"", "Unrecognized declaration \"<!\""),
                            LocalizedText("只支持 <!-- 注释 -->、<![CDATA[ … ]]> 和 <!DOCTYPE …>", "only <!-- comments -->, <![CDATA[ … ]]> and <!DOCTYPE …> are supported")
                        )
                    }
                } else if next == 0x3F { // <?
                    try pi()
                } else if next == 0x2F { // </
                    try closeTag()
                } else {
                    try openTag()
                }
            }
            if let top = stack.last {
                throw fail(
                    top.start,
                    LocalizedText("标签 <\(top.name)> 没有闭合", "Tag <\(top.name)> is not closed"),
                    LocalizedText("直到文档结束都没有找到 </\(top.name)>", "no </\(top.name)> before the end of the document")
                )
            }
            if roots == 0 {
                var first = 0
                for scalar in String(decoding: s, as: UTF8.self).unicodeScalars {
                    guard FC.isJSWhitespace(scalar) else { break }
                    first += String(scalar).utf8.count
                }
                throw fail(
                    first,
                    LocalizedText("没有找到任何 XML 元素", "No XML element found"),
                    LocalizedText("XML 至少需要一个根元素，例如 <root>…</root>", "XML needs at least one root element, e.g. <root>…</root>")
                )
            }
            return Document(children: docChildren, warnings: warnings)
        }

        mutating func text(_ start: Int, _ end: Int) throws {
            if let cd = FC.find(s, Parser.cdataClose, from: start, to: end) {
                throw fail(
                    cd,
                    LocalizedText("文本中不能出现 \"]]>\"", "\"]]>\" is not allowed in text"),
                    LocalizedText("它是 CDATA 的结束标记；如果是正文内容，请把 \">\" 写作 &gt;，即 ]]&gt;", "it ends a CDATA section; in text, write \">\" as &gt;, i.e. ]]&gt;")
                )
            }
            try checkEntities(start, end, LocalizedText("文本", "text"))
            let raw = FC.text(s, start, end)
            if stack.isEmpty {
                if FC.isJSBlank(raw) { return }
                if !sawOuterText {
                    sawOuterText = true
                    var off = start
                    for scalar in raw.unicodeScalars {
                        guard FC.isJSWhitespace(scalar) else { break }
                        off += String(scalar).utf8.count
                    }
                    warn(off, LocalizedText("根元素之外存在文本内容", "Text outside the root element"),
                         LocalizedText("标准 XML 文档中，文本只能出现在根元素内部", "in a well-formed document, text can only appear inside the root element"))
                }
            }
            add(.text(raw))
        }

        mutating func comment() throws {
            let start = i
            guard let end = FC.find(s, Parser.commentClose, from: start + 4) else {
                throw fail(start, LocalizedText("注释没有结束：缺少 \"-->\"", "Unterminated comment: missing \"-->\""))
            }
            if let dd = FC.find(s, [0x2D, 0x2D], from: start + 4, to: end) {
                warn(dd, LocalizedText("注释内容中不应出现 \"--\"", "\"--\" should not appear inside a comment"),
                     LocalizedText("XML 规范不允许注释里有连续两个减号", "XML does not allow two consecutive hyphens in comments"))
            }
            add(.comment(FC.text(s, start, end + 3)))
            i = end + 3
        }

        mutating func cdata() throws {
            let start = i
            if stack.isEmpty {
                throw fail(start, LocalizedText("CDATA 只能出现在元素内部", "CDATA can only appear inside an element"))
            }
            guard let end = FC.find(s, Parser.cdataClose, from: start + 9) else {
                throw fail(start, LocalizedText("CDATA 没有结束：缺少 \"]]>\"", "Unterminated CDATA section: missing \"]]>\""))
            }
            add(.cdata(FC.text(s, start, end + 3)))
            i = end + 3
        }

        mutating func doctype() throws {
            let start = i
            if roots > 0 || !stack.isEmpty {
                throw fail(start, LocalizedText("DOCTYPE 必须位于根元素之前", "DOCTYPE must come before the root element"))
            }
            if sawDoctype {
                throw fail(start, LocalizedText("一个文档只能有一个 DOCTYPE 声明", "A document can only have one DOCTYPE declaration"))
            }
            sawDoctype = true
            var j = start + 9
            var depth = 0
            var quote: UInt8 = 0
            while j < s.count {
                let ch = s[j]
                if quote != 0 {
                    if ch == quote { quote = 0 }
                } else if ch == 0x22 || ch == 0x27 {
                    quote = ch
                } else if FC.has(s, Parser.commentOpen, at: j) {
                    guard let e = FC.find(s, Parser.commentClose, from: j + 4) else {
                        throw fail(j, LocalizedText("注释没有结束：缺少 \"-->\"", "Unterminated comment: missing \"-->\""))
                    }
                    j = e + 2
                } else if ch == 0x5B {
                    depth += 1
                } else if ch == 0x5D {
                    depth -= 1
                } else if ch == 0x3E && depth <= 0 {
                    break
                }
                j += 1
            }
            if j >= s.count {
                throw fail(start, LocalizedText("DOCTYPE 没有结束：缺少 \">\"", "Unterminated DOCTYPE: missing \">\""))
            }
            add(.doctype(FC.text(s, start, j + 1)))
            i = j + 1
        }

        mutating func pi() throws {
            let start = i
            guard let end = FC.find(s, [0x3F, 0x3E], from: start + 2) else {
                throw fail(start, LocalizedText("处理指令没有结束：缺少 \"?>\"", "Unterminated processing instruction: missing \"?>\""))
            }
            let target = readName(start + 2)
            if target.isEmpty {
                throw fail(start + 2, LocalizedText("处理指令缺少名称", "The processing instruction has no target name"),
                           LocalizedText("例如 <?xml-stylesheet href=\"style.xsl\"?>", "e.g. <?xml-stylesheet href=\"style.xsl\"?>"))
            }
            if target.lowercased() == "xml" {
                if target != "xml" {
                    throw fail(start, LocalizedText("XML 声明必须小写：应为 <?xml，而不是 <?\(target)", "The XML declaration must be lowercase: <?xml, not <?\(target)"))
                }
                let before = FC.text(s, bom, start)
                if !FC.isJSBlank(before) || !docChildren.isEmpty || !stack.isEmpty {
                    throw fail(start, LocalizedText("XML 声明 <?xml …?> 只能出现在文档最开头", "The XML declaration <?xml …?> must be at the very start of the document"),
                               LocalizedText("把它移到第一行，或者删掉它", "move it to the first line or remove it"))
                }
                if !before.isEmpty {
                    warn(start, LocalizedText("XML 声明前面有空白", "Whitespace before the XML declaration"),
                         LocalizedText("严格的解析器要求 <?xml 必须是文件的第一个字符", "strict parsers require <?xml to be the very first characters of the file"))
                }
                if !hasVersion(start, end) {
                    throw fail(start, LocalizedText("XML 声明缺少 version 属性", "The XML declaration is missing the version attribute"),
                               LocalizedText("例如 <?xml version=\"1.0\" encoding=\"UTF-8\"?>", "e.g. <?xml version=\"1.0\" encoding=\"UTF-8\"?>"))
                }
            }
            add(.pi(FC.text(s, start, end + 2)))
            i = end + 2
        }

        /// 声明里是否有 version="1.x"
        func hasVersion(_ from: Int, _ to: Int) -> Bool {
            let word = Array("version".utf8)
            var k = from
            while let at = FC.find(s, word, from: k, to: to) {
                k = at + 1
                guard at > from, Parser.isWs(s[at - 1]) else { continue }
                var j = skipWs(at + word.count)
                guard j < to, s[j] == 0x3D else { continue }
                j = skipWs(j + 1)
                guard j < to, s[j] == 0x22 || s[j] == 0x27 else { continue }
                let q = s[j]
                j += 1
                guard j + 1 < to, s[j] == 0x31, s[j + 1] == 0x2E else { continue }
                j += 2
                let digits = j
                while j < to, s[j] >= 0x30, s[j] <= 0x39 { j += 1 }
                if j > digits, j < to, s[j] == q { return true }
            }
            return false
        }

        mutating func openTag() throws {
            let start = i
            let name = readName(start + 1)
            if name.isEmpty {
                if start + 1 >= s.count {
                    throw fail(start, LocalizedText("文档末尾多了一个 \"<\"", "Stray \"<\" at the end of the document"))
                }
                let d = describe(start + 1)
                throw fail(start, LocalizedText("意外的 \"<\"：后面应紧跟标签名，却是 \(d.zh)", "Unexpected \"<\": expected a tag name but found \(d.en)"),
                           LocalizedText("如果这是文本中的小于号，请写作 &lt;", "if this is a less-than sign in text, write it as &lt;"))
            }
            if stack.isEmpty && roots > 0 && !sawMultiRoot {
                sawMultiRoot = true
                warn(start, LocalizedText("发现多个根元素 <\(name)>", "Multiple root elements: <\(name)>"),
                     LocalizedText("标准 XML 文档只能有一个根元素；这里按 XML 片段处理", "a well-formed document has only one root element; treating the input as a fragment"))
            }
            var j = start + 1 + name.utf8.count
            var attrs: [Attribute] = []
            var seen = Set<String>()
            var selfClosing = false
            while true {
                let ws = j
                j = skipWs(j)
                guard j < s.count else {
                    throw fail(start, LocalizedText("标签 <\(name)> 没有结束：缺少 \">\"", "Tag <\(name)> is not finished: missing \">\""))
                }
                let ch = s[j]
                if ch == 0x3E { j += 1; break }
                if ch == 0x2F {
                    guard j + 1 < s.count, s[j + 1] == 0x3E else {
                        throw fail(j, LocalizedText("\"/\" 后面应紧跟 \">\"", "\"/\" must be followed by \">\""),
                                   LocalizedText("自闭合标签的写法是 <tag />", "a self-closing tag is written <tag />"))
                    }
                    selfClosing = true
                    j += 2
                    break
                }
                if ch == 0x3C {
                    throw fail(j, LocalizedText("标签 <\(name)> 没有结束：缺少 \">\"", "Tag <\(name)> is not finished: missing \">\""))
                }
                let attrName = readName(j)
                if attrName.isEmpty {
                    if ch == 0x22 || ch == 0x27 {
                        throw fail(j, LocalizedText("属性值前面缺少属性名和 \"=\"", "An attribute value has no name and \"=\" before it"))
                    }
                    let d = describe(j)
                    throw fail(j, LocalizedText("标签 <\(name)> 中有意外的字符 \(d.zh)", "Unexpected \(d.en) in tag <\(name)>"),
                               LocalizedText("这里应是属性名、\">\" 或 \"/>\"", "expected an attribute name, \">\" or \"/>\""))
                }
                if j == ws {
                    throw fail(j, LocalizedText("属性 \(attrName) 前面缺少空格", "Missing space before attribute \(attrName)"),
                               LocalizedText("属性之间需要用空格分隔", "attributes must be separated by whitespace"))
                }
                let aStart = j
                j = skipWs(j + attrName.utf8.count)
                guard j < s.count, s[j] == 0x3D else {
                    throw fail(aStart, LocalizedText("属性 \(attrName) 缺少 \"=\" 和属性值", "Attribute \(attrName) is missing \"=\" and a value"),
                               LocalizedText("例如 \(attrName)=\"…\"；XML 不支持 HTML 那样只写属性名的布尔属性", "e.g. \(attrName)=\"…\"; XML has no HTML-style boolean attributes"))
                }
                j = skipWs(j + 1)
                guard j < s.count, s[j] == 0x22 || s[j] == 0x27 else {
                    var e = j
                    while e < s.count, !Parser.isWs(s[e]), s[e] != 0x2F, s[e] != 0x3E { e += 1 }
                    let word = FC.text(s, j, e)
                    let example = word.isEmpty ? "…" : word
                    throw fail(j, LocalizedText("属性 \(attrName) 的值必须用引号包裹", "The value of attribute \(attrName) must be quoted"),
                               LocalizedText("例如 \(attrName)=\"\(example)\"", "e.g. \(attrName)=\"\(example)\""))
                }
                let q = s[j]
                let qs = q == 0x22 ? "\"" : "'"
                guard let vEnd = FC.find(s, q, from: j + 1) else {
                    throw fail(j, LocalizedText("属性 \(attrName) 的值缺少结束引号 \(qs)", "The value of attribute \(attrName) is missing its closing quote \(qs)"))
                }
                if let lt = FC.find(s, 0x3C, from: j + 1, to: vEnd) {
                    throw fail(lt, LocalizedText("属性 \(attrName) 的值中出现了 \"<\"", "\"<\" in the value of attribute \(attrName)"),
                               LocalizedText("可能是缺少结束引号 \(qs)；如果确实需要小于号，请写作 &lt;", "maybe the closing quote \(qs) is missing; to use a less-than sign, write &lt;"))
                }
                try checkEntities(j + 1, vEnd, LocalizedText("属性 \(attrName) 的值", "the value of attribute \(attrName)"))
                if seen.contains(attrName) {
                    throw fail(aStart, LocalizedText("属性 \(attrName) 重复", "Duplicate attribute \(attrName)"),
                               LocalizedText("同一个元素上的属性名不能重复", "attribute names must be unique within an element"))
                }
                seen.insert(attrName)
                attrs.append(Attribute(name: attrName, value: FC.text(s, j + 1, vEnd), quote: q == 0x22 ? "\"" : "'", offset: aStart))
                j = vEnd + 1
            }
            if stack.count >= XMLSyntax.maxDepth {
                throw fail(start, LocalizedText("嵌套层级过深：超过 \(XMLSyntax.maxDepth) 层", "Nesting is too deep: more than \(XMLSyntax.maxDepth) levels"),
                           LocalizedText("请检查是否有大量标签没有闭合", "check for many unclosed tags"))
            }
            if stack.isEmpty { roots += 1 }
            let el = Element(name: name, attrs: attrs, children: [], selfClosing: selfClosing, start: start)
            enterNamespaces(el)
            if selfClosing {
                ns.removeLast()
                add(.element(el))
            } else {
                stack.append(el)
            }
            i = j
        }

        /// 登记本元素声明的前缀，并检查用到的前缀是否已声明
        mutating func enterNamespaces(_ el: Element) {
            var declared: [String] = []
            for a in el.attrs where a.name.hasPrefix("xmlns:") {
                declared.append(String(a.name.dropFirst(6)))
            }
            ns.append(declared)
            check(el.name, el.start + 1)
            for a in el.attrs { check(a.name, a.offset) }
        }

        mutating func check(_ qname: String, _ offset: Int) {
            guard let c = qname.firstIndex(of: ":"), c != qname.startIndex else { return }
            let prefix = String(qname[..<c])
            if prefix == "xml" || prefix == "xmlns" || warnedPrefixes.contains(prefix) { return }
            for level in ns.reversed() where level.contains(prefix) { return }
            warnedPrefixes.insert(prefix)
            warn(offset, LocalizedText("命名空间前缀 \"\(prefix)\" 未声明", "Namespace prefix \"\(prefix)\" is not declared"),
                 LocalizedText(
                    "需要在当前或外层元素上声明 xmlns:\(prefix)=\"…\"；如果这是从完整文档里截取的片段，可以忽略",
                    "declare xmlns:\(prefix)=\"…\" on this or an outer element; ignore this if the input is a fragment"
                 ))
        }

        mutating func closeTag() throws {
            let start = i
            let name = readName(start + 2)
            if name.isEmpty {
                let d = describe(start + 2)
                throw fail(start + 2, LocalizedText("闭合标签缺少标签名，却是 \(d.zh)", "The closing tag has no name; found \(d.en)"))
            }
            let j = skipWs(start + 2 + name.utf8.count)
            guard j < s.count, s[j] == 0x3E else {
                throw fail(j, LocalizedText("闭合标签 </\(name)> 缺少 \">\"", "Closing tag </\(name)> is missing \">\""))
            }
            guard let top = stack.last else {
                throw fail(start, LocalizedText("多余的闭合标签 </\(name)>：前面没有对应的开始标签 <\(name)>", "Extra closing tag </\(name)>: there is no matching <\(name)> before it"))
            }
            if top.name != name {
                let at = whereText(top.start)
                if stack.contains(where: { $0.name == name }) {
                    throw fail(start, LocalizedText("标签 <\(top.name)>（\(at.zh)）没有闭合，就遇到了 </\(name)>", "Tag <\(top.name)> (\(at.en)) is not closed before </\(name)>"),
                               LocalizedText("在这里之前补上 </\(top.name)>", "add </\(top.name)> before this point"))
                }
                throw fail(start, LocalizedText("闭合标签 </\(name)> 与开始标签 <\(top.name)>（\(at.zh)）不匹配", "Closing tag </\(name)> does not match the opening tag <\(top.name)> (\(at.en))"),
                           LocalizedText("应为 </\(top.name)>", "expected </\(top.name)>"))
            }
            let el = stack.removeLast()
            ns.removeLast()
            add(.element(el))
            i = j + 1
        }
    }
}

struct XMLIssueError: Error {
    var issue: XMLIssue
}
