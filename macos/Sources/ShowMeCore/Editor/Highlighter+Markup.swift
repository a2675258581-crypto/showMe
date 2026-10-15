import Foundation

// 标记类语言：JSON、XML / HTML（内嵌 script / style 交给 JS / CSS 扫描器）、CSS / SCSS / Less、Markdown、Diff。

private enum MarkupWords {
    static let jsonConstants = WordTable([(.constant, "true false null NaN Infinity undefined")])
    static let commentOpen = Ch.units("<!--")
    static let commentClose = Ch.units("-->")
    static let cdataOpen = Ch.units("<![CDATA[")
    static let cdataClose = Ch.units("]]>")
    static let piClose = Ch.units("?>")
    static let scriptClose = Ch.units("</script")
    static let styleClose = Ch.units("</style")
    static let cBlockOpen = Ch.units("/*")
    static let cBlockClose = Ch.units("*/")
    static let tildes = Ch.units("~~")
    static let diffOld = Ch.units("--- ")
    static let diffNew = Ch.units("+++ ")
    static let hunk = Ch.units("@@")
    static let diffHeaders = ["diff ", "Index: ", "*** "].map(Ch.units)
    static let diffInfo = ["index ", "new file mode", "deleted file mode", "similarity index", "dissimilarity index",
                           "rename ", "copy ", "old mode", "new mode", "Binary files", "====="].map(Ch.units)
}

enum CSSDialect: Sendable { case css, scss, less }

extension Lexer {
    // MARK: - JSON

    /// JSON / JSONC / JSON5：键 → property，值 → string / number / constant，注释 → comment
    mutating func scanJSON(from start: Int) {
        var i = start
        while i < end {
            let c = b[i]
            if c == Ch.dquote || c == Ch.squote {
                let j = quotedEnd(i, quote: c)
                emit(i, j, isFollowedByColon(j) ? .property : .string)
                i = j
                continue
            }
            if c == Ch.slash {
                if at(i + 1) == Ch.slash {
                    let j = lineEnd(i)
                    emit(i, j, .comment)
                    i = j
                    continue
                }
                if at(i + 1) == Ch.star {
                    let j = blockCommentEnd(i, open: MarkupWords.cBlockOpen, close: MarkupWords.cBlockClose, nested: false)
                    emit(i, j, .comment)
                    i = j
                    continue
                }
            }
            if isDigit(c) || c == Ch.minus || c == Ch.plus || c == Ch.dot {
                var k = i
                if c == Ch.minus || c == Ch.plus { k += 1 }
                if isDigit(at(k)) || (at(k) == Ch.dot && isDigit(at(k + 1))) {
                    let j = numberEnd(k)
                    emit(i, j, .number)
                    i = j
                    continue
                }
                if k > i && isIdentStart(at(k)) {
                    // -Infinity
                    let j = identEnd(k)
                    if MarkupWords.jsonConstants.contains(b, k, j) { emit(i, j, .constant) }
                    i = j
                    continue
                }
                i += 1
                continue
            }
            if isIdentStart(c) || c == Ch.dollar {
                var j = i + 1
                while j < end && (isIdentPart(b[j]) || b[j] == Ch.dollar) { j += 1 }
                if isFollowedByColon(j) {
                    emit(i, j, .property)
                } else if MarkupWords.jsonConstants.contains(b, i, j) {
                    emit(i, j, .constant)
                }
                i = j
                continue
            }
            i += 1
        }
    }

    /// 跳过空白后是不是冒号（判断 JSON 键）
    func isFollowedByColon(_ j: Int) -> Bool {
        var k = j
        while k < end && isSpaceOrNewline(b[k]) { k += 1 }
        return at(k) == Ch.colon
    }

    // MARK: - XML / HTML

    mutating func scanMarkup(from start: Int, html: Bool) {
        var i = start
        while i < end {
            let c = b[i]
            if c == Ch.lt {
                i = scanMarkupTag(i, html: html)
            } else if c == Ch.amp {
                if let j = entityEnd(i) {
                    emit(i, j, .constant)
                    i = j
                } else {
                    i += 1
                }
            } else {
                i += 1
            }
        }
    }

    /// &amp; &#123; &#x1F600;
    func entityEnd(_ i: Int) -> Int? {
        var k = i + 1
        if at(k) == Ch.hash {
            k += 1
            let hex = (at(k) | 0x20) == 0x78
            if hex { k += 1 }
            let digitsStart = k
            while k < end && k - i < 12 && (hex ? isHexDigit(b[k]) : isDigit(b[k])) { k += 1 }
            guard k > digitsStart, at(k) == Ch.semicolon else { return nil }
            return k + 1
        }
        let nameStart = k
        while k < end && k - i < 40 && isASCIIAlnum(b[k]) { k += 1 }
        guard k > nameStart, at(k) == Ch.semicolon else { return nil }
        return k + 1
    }

    @inline(__always) func isXMLNameStart(_ c: UInt16) -> Bool {
        isASCIILetter(c) || c == Ch.underscore || c == Ch.colon || (c >= 0x80 && !isUnicodeSpace(c))
    }

    @inline(__always) func isXMLNamePart(_ c: UInt16) -> Bool {
        isXMLNameStart(c) || isDigit(c) || c == Ch.minus || c == Ch.dot
    }

    /// i 指向 <，返回标签之后的位置
    private mutating func scanMarkupTag(_ i: Int, html: Bool) -> Int {
        let n = at(i + 1)
        if n == Ch.excl {
            if hasPrefix(i, MarkupWords.commentOpen) {
                let j = find(MarkupWords.commentClose, from: i + 4, limit: end).map { $0 + 3 } ?? end
                emit(i, j, .comment)
                return j
            }
            if hasPrefix(i, MarkupWords.cdataOpen) {
                emit(i, i + 9, .meta)
                guard let close = find(MarkupWords.cdataClose, from: i + 9, limit: end) else {
                    emit(i + 9, end, .string)
                    return end
                }
                emit(i + 9, close, .string)
                emit(close, close + 3, .meta)
                return close + 3
            }
            // <!DOCTYPE …>（内部子集 […] 里的 > 不算结束）
            var j = i + 2
            var bracket = 0
            while j < end {
                let c = b[j]
                if c == Ch.lbracket { bracket += 1 }
                else if c == Ch.rbracket { bracket -= 1 }
                else if c == Ch.gt && bracket <= 0 { j += 1; break }
                j += 1
            }
            emit(i, j, .meta)
            return j
        }
        if n == Ch.question {
            let j = find(MarkupWords.piClose, from: i + 2, limit: end).map { $0 + 2 } ?? end
            emit(i, j, .meta)
            return j
        }

        var k = i + 1
        let closing = n == Ch.slash
        if closing { k += 1 }
        guard isXMLNameStart(at(k)) && at(k) != Ch.colon else { return i + 1 }
        let nameStart = k
        while k < end && isXMLNamePart(b[k]) { k += 1 }
        let nameEnd = k
        emit(i, nameStart, .punctuation)
        emit(nameStart, nameEnd, .tag)

        var j = nameEnd
        var lastAttr = (0, 0)
        var typeValue: String? = nil
        var finished = false
        var selfClosing = false
        while j < end {
            let d = b[j]
            if isSpaceOrNewline(d) { j += 1; continue }
            if d == Ch.gt {
                emit(j, j + 1, .punctuation)
                j += 1
                finished = true
                break
            }
            if d == Ch.slash && at(j + 1) == Ch.gt {
                emit(j, j + 2, .punctuation)
                j += 2
                finished = true
                selfClosing = true
                break
            }
            if d == Ch.lt { break } // 标签没写完，下一个标签开始了
            if d == Ch.equal {
                emit(j, j + 1, .punctuation)
                j = skipWhitespace(j + 1)
                guard j < end else { break }
                let q = b[j]
                let valueStart: Int
                let valueEnd: Int
                if q == Ch.dquote || q == Ch.squote {
                    let e = quotedEnd(j, quote: q, escapes: false, multiline: true)
                    emit(j, e, .string)
                    valueStart = j + 1
                    valueEnd = (e > j + 1 && at(e - 1) == q) ? e - 1 : e
                    j = e
                } else {
                    var e = j
                    while e < end && !isSpaceOrNewline(b[e]) && b[e] != Ch.gt && !(b[e] == Ch.slash && at(e + 1) == Ch.gt) { e += 1 }
                    emit(j, e, .string)
                    valueStart = j
                    valueEnd = e
                    j = e
                }
                if html && (equalsCI(lastAttr.0, lastAttr.1, "type") || equalsCI(lastAttr.0, lastAttr.1, "lang")) {
                    typeValue = string(valueStart, valueEnd).lowercased()
                }
                continue
            }
            if d == Ch.dquote || d == Ch.squote {
                let e = quotedEnd(j, quote: d, escapes: false, multiline: true)
                emit(j, e, .string)
                j = e
                continue
            }
            let a = j
            while j < end {
                let e = b[j]
                if isSpaceOrNewline(e) || e == Ch.equal || e == Ch.gt || e == Ch.lt || e == Ch.dquote || e == Ch.squote
                    || (e == Ch.slash && at(j + 1) == Ch.gt) { break }
                j += 1
            }
            if j == a { j += 1; continue }
            emit(a, j, .attribute)
            lastAttr = (a, j)
        }

        // HTML 的 <script> / <style>：内容交给对应扫描器
        if html && finished && !closing && !selfClosing {
            let isScript = equalsCI(nameStart, nameEnd, "script")
            let isStyle = !isScript && equalsCI(nameStart, nameEnd, "style")
            if isScript || isStyle {
                let closeTag = isScript ? MarkupWords.scriptClose : MarkupWords.styleClose
                let stop = findCI(closeTag, from: j, limit: end) ?? end
                if let lang = isScript ? scriptLanguage(typeValue) : styleLanguage(typeValue) {
                    delegate(lang, j, stop)
                }
                return stop
            }
        }
        return j
    }

    private func scriptLanguage(_ type: String?) -> String? {
        guard let type, !type.isEmpty else { return "javascript" }
        if type.contains("json") { return "json" }
        if type == "ts" || type == "tsx" || type.contains("typescript") { return "typescript" }
        if type.contains("template") || type.contains("html") { return "html" }
        if type == "module" || type == "js" || type == "jsx" || type.contains("javascript") || type.contains("ecmascript")
            || type.contains("babel") {
            return "javascript"
        }
        return nil
    }

    private func styleLanguage(_ lang: String?) -> String? {
        switch lang {
        case "scss", "sass": return "scss"
        case "less": return "less"
        default: return "css"
        }
    }

    /// [s, e) 是否等于 ASCII 单词（不区分大小写，word 须为小写）
    func equalsCI(_ s: Int, _ e: Int, _ word: String) -> Bool {
        let units = word.utf16
        guard e - s == units.count, s >= 0, e <= end else { return false }
        var k = s
        for u in units {
            if WordTable.lower(b[k]) != u { return false }
            k += 1
        }
        return true
    }

    /// 不区分大小写查找（s 须为小写）
    func findCI(_ s: [UInt16], from: Int, limit: Int) -> Int? {
        guard let first = s.first else { return nil }
        let stop = min(limit, end) - s.count
        var j = from
        while j <= stop {
            if WordTable.lower(b[j]) == first && hasPrefixCI(j, s) { return j }
            j += 1
        }
        return nil
    }

    // MARK: - CSS / SCSS / Less

    mutating func scanCSS(from start: Int, dialect: CSSDialect) {
        var i = start
        var depth = 0
        var statementStart = true
        var inDeclaration = false
        var inValue = false
        var parens = 0
        let slashComments = dialect != .css
        while i < end {
            let c = b[i]
            if isSpaceOrNewline(c) { i += 1; continue }
            if c == Ch.slash && at(i + 1) == Ch.star {
                let j = blockCommentEnd(i, open: MarkupWords.cBlockOpen, close: MarkupWords.cBlockClose, nested: false)
                emit(i, j, .comment)
                i = j
                continue
            }
            if slashComments && c == Ch.slash && at(i + 1) == Ch.slash && parens == 0 {
                let j = lineEnd(i)
                emit(i, j, .comment)
                i = j
                continue
            }
            if statementStart && c != Ch.lbrace && c != Ch.rbrace && c != Ch.semicolon {
                statementStart = false
                inValue = false
                inDeclaration = looksLikeDeclaration(i, depth: depth, dialect: dialect)
            }

            switch c {
            case Ch.lbrace:
                depth += 1
                statementStart = true; inDeclaration = false; inValue = false; parens = 0
                i += 1
            case Ch.rbrace:
                depth = max(0, depth - 1)
                statementStart = true; inDeclaration = false; inValue = false; parens = 0
                i += 1
            case Ch.semicolon:
                statementStart = true; inDeclaration = false; inValue = false; parens = 0
                i += 1
            case Ch.dquote, Ch.squote:
                let j = quotedEnd(i, quote: c)
                emit(i, j, .string)
                i = j
            case Ch.lparen:
                parens += 1
                i += 1
            case Ch.rparen:
                parens = max(0, parens - 1)
                i += 1
            case Ch.at:
                let j = cssIdentEnd(i + 1)
                if j == i + 1 { i += 1; continue }
                if dialect == .less && (inValue || at(skipBlanks(j, end)) == Ch.colon) {
                    emit(i, j, .variable)
                } else {
                    emit(i, j, .keyword)
                    // @media / @include 之后的参数按「值」处理
                    inDeclaration = true
                    inValue = true
                }
                i = j
            case Ch.dollar where dialect == .scss:
                let j = cssIdentEnd(i + 1)
                if j > i + 1 { emit(i, j, .variable) }
                i = max(j, i + 1)
            case Ch.hash:
                if at(i + 1) == Ch.lbrace {
                    // SCSS 插值 #{…}
                    var k = i + 2
                    while k < end && b[k] != Ch.rbrace && !isNewline(b[k]) { k += 1 }
                    let j = k < end && b[k] == Ch.rbrace ? k + 1 : k
                    emit(i, j, .variable)
                    i = j
                } else if inValue {
                    var j = i + 1
                    while j < end && isASCIIAlnum(b[j]) { j += 1 }
                    emit(i, j, .number)
                    i = j
                } else {
                    let j = cssIdentEnd(i + 1)
                    emit(i, j, .tag)
                    i = max(j, i + 1)
                }
            case Ch.dot where isDigit(at(i + 1)):
                i = cssNumber(i)
            case Ch.dot where !inValue:
                let j = cssIdentEnd(i + 1)
                emit(i, j, .tag)
                i = max(j, i + 1)
            case Ch.colon:
                if inDeclaration && !inValue {
                    inValue = true
                    i += 1
                } else if !inValue {
                    // 伪类 / 伪元素
                    var k = i + 1
                    if at(k) == Ch.colon { k += 1 }
                    let j = cssIdentEnd(k)
                    emit(i, j, .attribute)
                    i = max(j, i + 1)
                } else {
                    i += 1
                }
            case Ch.excl:
                let j = cssIdentEnd(skipBlanks(i + 1, end))
                if j > i + 1 { emit(i, j, .keyword) }
                i = max(j, i + 1)
            case Ch.lbracket where !inValue:
                // 属性选择器 [type="text"]
                var j = i + 1
                let nameStart = skipBlanks(j, end)
                let nameEnd = cssIdentEnd(nameStart)
                emit(nameStart, nameEnd, .attribute)
                j = nameEnd
                while j < end && b[j] != Ch.rbracket && !isNewline(b[j]) {
                    if b[j] == Ch.dquote || b[j] == Ch.squote {
                        let e = quotedEnd(j, quote: b[j])
                        emit(j, e, .string)
                        j = e
                    } else {
                        j += 1
                    }
                }
                i = j < end && b[j] == Ch.rbracket ? j + 1 : max(j, i + 1)
            case Ch.amp, Ch.gt, Ch.plus, Ch.tilde, Ch.star:
                if c == Ch.plus && inValue && (isDigit(at(i + 1)) || at(i + 1) == Ch.dot) {
                    i = cssNumber(i)
                } else {
                    emit(i, i + 1, .operator)
                    i += 1
                }
            case Ch.minus where isDigit(at(i + 1)) || (at(i + 1) == Ch.dot && isDigit(at(i + 2))):
                i = cssNumber(i)
            default:
                if isDigit(c) {
                    i = cssNumber(i)
                } else if isCSSIdentStart(c) {
                    let j = cssIdentEnd(i)
                    if inDeclaration && !inValue {
                        emit(i, j, .property)
                    } else if inValue || parens > 0 {
                        if at(j) == Ch.lparen {
                            emit(i, j, .function)
                            if equalsCI(i, j, "url") {
                                // url(不带引号的地址)
                                let k = skipBlanks(j + 1, end)
                                if at(k) != Ch.dquote && at(k) != Ch.squote {
                                    var e = k
                                    while e < end && b[e] != Ch.rparen && !isNewline(b[e]) { e += 1 }
                                    emit(k, e, .string)
                                    i = e
                                    continue
                                }
                            }
                        }
                    } else {
                        emit(i, j, at(j) == Ch.lparen ? .function : .tag)
                    }
                    i = j
                } else {
                    i += 1
                }
            }
        }
    }

    @inline(__always) func isCSSIdentStart(_ c: UInt16) -> Bool {
        isASCIILetter(c) || c == Ch.underscore || c == Ch.minus || (c >= 0x80 && !isUnicodeSpace(c)) || c == Ch.backslash
    }

    func cssIdentEnd(_ i: Int) -> Int {
        var j = i
        while j < end {
            let c = b[j]
            if c == Ch.backslash { j += 2; continue }
            if isASCIIAlnum(c) || c == Ch.minus || c == Ch.underscore || (c >= 0x80 && !isUnicodeSpace(c)) {
                j += 1
            } else {
                break
            }
        }
        return min(j, end)
    }

    /// 数字加单位：10px、1.5em、50%、-2rem
    private mutating func cssNumber(_ i: Int) -> Int {
        var k = i
        if b[k] == Ch.minus || b[k] == Ch.plus { k += 1 }
        var j = k
        while isDigit(at(j)) { j += 1 }
        if at(j) == Ch.dot && isDigit(at(j + 1)) {
            j += 1
            while isDigit(at(j)) { j += 1 }
        }
        if (at(j) | 0x20) == 0x65 && (isDigit(at(j + 1)) || ((at(j + 1) == Ch.minus || at(j + 1) == Ch.plus) && isDigit(at(j + 2)))) {
            j += 2
            while isDigit(at(j)) { j += 1 }
        }
        if at(j) == Ch.percent {
            j += 1
        } else {
            while isASCIILetter(at(j)) { j += 1 }
        }
        let stop = max(j, i + 1)
        emit(i, stop, .number)
        return stop
    }

    /// 语句开头向前看：先遇到 ; 或 } 是声明（属性: 值），先遇到 { 是选择器
    private func looksLikeDeclaration(_ i: Int, depth: Int, dialect: CSSDialect) -> Bool {
        if depth == 0 && dialect == .css { return false }
        var k = i
        while k < end {
            let c = b[k]
            if c == Ch.dquote || c == Ch.squote {
                k = quotedEnd(k, quote: c)
                continue
            }
            if c == Ch.slash && at(k + 1) == Ch.star {
                k = blockCommentEnd(k, open: MarkupWords.cBlockOpen, close: MarkupWords.cBlockClose, nested: false)
                continue
            }
            if c == Ch.hash && at(k + 1) == Ch.lbrace {
                while k < end && b[k] != Ch.rbrace { k += 1 }
                k += 1
                continue
            }
            if c == Ch.lbrace { return false }
            if c == Ch.semicolon || c == Ch.rbrace { return true }
            k += 1
        }
        return true
    }

    // MARK: - Markdown

    mutating func scanMarkdown() {
        var i = 0
        // YAML front matter
        if hasPrefix(0, Ch.units("---")) && (isNewline(at(3)) || 3 == end) {
            var ls = nextLineStart(lineEnd(0))
            while ls < end {
                let le = lineEnd(ls)
                let te = trimEnd(ls, le)
                if equals(ls, te, "---") || equals(ls, te, "...") {
                    emit(0, le, .meta)
                    i = nextLineStart(le)
                    break
                }
                ls = nextLineStart(le)
            }
        }

        var fenceChar: UInt16 = 0
        var fenceCount = 0
        while i < end {
            let le = lineEnd(i)
            let next = nextLineStart(le)
            defer { i = next }
            let j = skipBlanks(i, le)
            let indent = j - i

            if fenceChar != 0 {
                // 代码块连同换行符一起标成 code，便于 App 画整块背景；结束围栏不含行尾换行
                var closes = false
                if indent < 4 {
                    var k = j
                    while k < le && b[k] == fenceChar { k += 1 }
                    closes = k - j >= fenceCount && skipBlanks(k, le) == le
                }
                emit(i, closes ? le : next, .code)
                if closes { fenceChar = 0 }
                continue
            }
            if j == le { continue }
            let c = b[j]

            // 代码围栏 ``` / ~~~
            if indent < 4 && (c == Ch.backtick || c == Ch.tilde) {
                var k = j
                while k < le && b[k] == c { k += 1 }
                if k - j >= 3 {
                    var infoHasBacktick = false
                    if c == Ch.backtick {
                        for q in k..<le where b[q] == Ch.backtick { infoHasBacktick = true; break }
                    }
                    if !infoHasBacktick {
                        fenceChar = c
                        fenceCount = k - j
                        emit(i, next, .code)
                        continue
                    }
                }
            }
            // ATX 标题
            if indent < 4 && c == Ch.hash {
                var k = j
                while k < le && b[k] == Ch.hash { k += 1 }
                if k - j <= 6 && (k == le || isBlank(b[k])) {
                    emit(j, le, .heading)
                    continue
                }
            }
            if c == Ch.gt {
                emit(j, le, .quote)
                continue
            }
            if indent < 4 && isThematicBreak(j, le) {
                emit(j, le, .meta)
                continue
            }
            // Setext 标题下划线 ===
            if indent < 4 && c == Ch.equal {
                var k = j
                while k < le && b[k] == Ch.equal { k += 1 }
                if skipBlanks(k, le) == le {
                    emit(j, le, .heading)
                    continue
                }
            }

            var k = j
            if (c == Ch.minus || c == Ch.star || c == Ch.plus) && (j + 1 == le || isBlank(at(j + 1))) {
                emit(j, j + 1, .listMarker)
                k = j + 1
            } else if isDigit(c) {
                var d = j
                while d < le && isDigit(b[d]) && d - j < 9 { d += 1 }
                if (at(d) == Ch.dot || at(d) == Ch.rparen) && (d + 1 == le || isBlank(at(d + 1))) {
                    emit(j, d + 1, .listMarker)
                    k = d + 1
                }
            } else if c == Ch.lbracket && indent < 4, isLinkDefinition(j, le) {
                emit(j, le, .link)
                continue
            }
            if k > j {
                // 任务列表 [ ] / [x]
                let t = skipBlanks(k, le)
                let mark = at(t + 1)
                if at(t) == Ch.lbracket && (mark == Ch.space || mark == 0x78 || mark == 0x58) && at(t + 2) == Ch.rbracket {
                    emit(t, t + 3, .listMarker)
                    k = t + 3
                }
            }
            scanInline(k, le)
        }
    }

    private func isThematicBreak(_ j: Int, _ le: Int) -> Bool {
        let c = b[j]
        guard c == Ch.minus || c == Ch.star || c == Ch.underscore else { return false }
        var count = 0
        for k in j..<le {
            let d = b[k]
            if d == c { count += 1 } else if !isBlank(d) { return false }
        }
        return count >= 3
    }

    /// [label]: url
    private func isLinkDefinition(_ j: Int, _ le: Int) -> Bool {
        var k = j + 1
        while k < le && b[k] != Ch.rbracket { k += 1 }
        return k > j + 1 && k < le && at(k + 1) == Ch.colon
    }

    /// 一行内的查找缓存：失败过的查找不再重复，括号配对一次算好，保证长行也是线性时间
    private struct InlineCache {
        /// 已确认找不到闭合的强调符号（* / _ × 长度）
        var failedEmphasis: UInt16 = 0
        /// 已确认找不到闭合的反引号串长度
        var failedTicks: Set<Int> = []
        var failedStrike = false
        /// [ → ] 与 ( → ) 的配对位置
        var brackets: [Int: Int]? = nil
        var parens: [Int: Int]? = nil
    }

    /// 行内元素：代码、强调、删除线、链接、图片、自动链接、HTML 标签
    private mutating func scanInline(_ start: Int, _ le: Int) {
        var cache = InlineCache()
        var k = start
        while k < le {
            let c = b[k]
            switch c {
            case Ch.backslash:
                k += 2
            case Ch.backtick:
                var n = k
                while n < le && b[n] == Ch.backtick { n += 1 }
                let run = n - k
                var close = -1
                if !cache.failedTicks.contains(run) {
                    var m = n
                    while m < le {
                        if b[m] == Ch.backtick {
                            var r = m
                            while r < le && b[r] == Ch.backtick { r += 1 }
                            if r - m == run { close = r; break }
                            m = r
                        } else {
                            m += 1
                        }
                    }
                    if close < 0 { cache.failedTicks.insert(run) }
                }
                if close > 0 {
                    emit(k, close, .code)
                    k = close
                } else {
                    k = n
                }
            case Ch.star, Ch.underscore:
                k = scanEmphasis(k, le, &cache)
            case Ch.tilde where at(k + 1) == Ch.tilde:
                if !cache.failedStrike && !isBlank(at(k + 2)) {
                    if let close = find(MarkupWords.tildes, from: k + 2, limit: le), close > k + 2 {
                        emit(k, close + 2, .deleted)
                        k = close + 2
                        continue
                    }
                    cache.failedStrike = true
                }
                k += 2
            case Ch.excl where at(k + 1) == Ch.lbracket:
                if let e = linkEnd(k + 1, le, &cache) {
                    emit(k, e, .link)
                    k = e
                } else {
                    k += 1
                }
            case Ch.lbracket:
                if let e = linkEnd(k, le, &cache) {
                    emit(k, e, .link)
                    k = e
                } else {
                    k += 1
                }
            case Ch.lt:
                if hasPrefix(k, MarkupWords.commentOpen) {
                    let e = find(MarkupWords.commentClose, from: k + 4, limit: le).map { $0 + 3 } ?? le
                    emit(k, e, .comment)
                    k = e
                } else if let e = angleEnd(k, le) {
                    emit(k, e.end, e.isLink ? .link : .tag)
                    k = e.end
                } else {
                    k += 1
                }
            case 0x68: // h → http(s)://
                if !isASCIIAlnum(at(k - 1)), let e = urlEnd(k, le) {
                    emit(k, e, .link)
                    k = e
                } else {
                    k += 1
                }
            default:
                k += 1
            }
        }
    }

    /// *斜体*、**粗体**、***粗斜体***、_x_、__x__；闭合符号须与开头等长、紧贴文字
    private mutating func scanEmphasis(_ k: Int, _ le: Int, _ cache: inout InlineCache) -> Int {
        let c = b[k]
        var n = k
        while n < le && b[n] == c { n += 1 }
        let run = n - k
        guard n < le, !isBlank(b[n]) else { return n }
        if c == Ch.underscore && isASCIIAlnum(at(k - 1)) { return n }
        let bit: UInt16 = 1 << UInt16((c == Ch.star ? 0 : 4) + min(run, 4) - 1)
        if cache.failedEmphasis & bit != 0 { return n }
        var m = n
        while m < le {
            let d = b[m]
            if d == Ch.backslash { m += 2; continue }
            if d == c {
                var r = m
                while r < le && b[r] == c { r += 1 }
                let closes = run <= 3 ? r - m == run : r - m >= 3
                if closes && !isBlank(b[m - 1]) && (c != Ch.underscore || !isASCIIAlnum(at(r))) {
                    let close = m + min(run, r - m)
                    emit(k, close, run >= 2 ? .strong : .emphasis)
                    return close
                }
                m = r
                continue
            }
            m += 1
        }
        cache.failedEmphasis |= bit
        return n
    }

    /// 一行里 open → close 的配对位置（跳过反斜杠转义）
    private func pairs(_ start: Int, _ le: Int, open: UInt16, close: UInt16) -> [Int: Int] {
        var stack: [Int] = []
        var map: [Int: Int] = [:]
        var k = start
        while k < le {
            let c = b[k]
            if c == Ch.backslash { k += 2; continue }
            if c == open {
                stack.append(k)
            } else if c == close, let o = stack.popLast() {
                map[o] = k
            }
            k += 1
        }
        return map
    }

    /// [文字](地址)、[文字][引用]；k 指向 [
    private func linkEnd(_ k: Int, _ le: Int, _ cache: inout InlineCache) -> Int? {
        if cache.brackets == nil { cache.brackets = pairs(k, le, open: Ch.lbracket, close: Ch.rbracket) }
        guard let close = cache.brackets?[k] else { return nil }
        let after = at(close + 1)
        if after == Ch.lparen {
            if cache.parens == nil { cache.parens = pairs(close + 1, le, open: Ch.lparen, close: Ch.rparen) }
            return cache.parens?[close + 1].map { $0 + 1 }
        }
        if after == Ch.lbracket {
            return cache.brackets?[close + 1].map { $0 + 1 }
        }
        return nil
    }

    /// <https://…>、<a@b.c> → 链接；<tag …> → 标签
    private func angleEnd(_ k: Int, _ le: Int) -> (end: Int, isLink: Bool)? {
        let n = at(k + 1)
        let tagLike = isASCIILetter(n) || (n == Ch.slash && isASCIILetter(at(k + 2)))
        var m = k + 1
        var hasSpace = false
        var hasColonOrAt = false
        let limit = min(le, k + 2048)
        while m < limit {
            let d = b[m]
            if d == Ch.gt { break }
            if d == Ch.lt { return nil }
            if isBlank(d) { hasSpace = true }
            if d == Ch.colon || d == Ch.at { hasColonOrAt = true }
            m += 1
        }
        guard m < limit, b[m] == Ch.gt, m > k + 1 else { return nil }
        if !hasSpace && hasColonOrAt && isASCIILetter(n) { return (m + 1, true) }
        return tagLike ? (m + 1, false) : nil
    }

    // MARK: - Diff

    mutating func scanDiff() {
        var i = 0
        while i < end {
            let le = lineEnd(i)
            let next = nextLineStart(le)
            if i < le {
                let c = b[i]
                if c == Ch.minus && hasPrefix(i, MarkupWords.diffOld) && hasPrefix(next, MarkupWords.diffNew) {
                    // 文件头 --- a/x 与 +++ b/x
                    let le2 = lineEnd(next)
                    emit(i, le, .meta)
                    emit(next, le2, .meta)
                    i = nextLineStart(le2)
                    continue
                }
                switch c {
                case Ch.plus, Ch.gt:
                    emit(i, le, hasPrefix(i, MarkupWords.diffNew) ? .meta : .inserted)
                case Ch.minus, Ch.lt:
                    emit(i, le, .deleted)
                case Ch.at where at(i + 1) == Ch.at:
                    // @@ -1,2 +1,3 @@ 后面的函数名不着色
                    let close = find(MarkupWords.hunk, from: i + 2, limit: le).map { $0 + 2 } ?? le
                    emit(i, close, .meta)
                case Ch.backslash:
                    emit(i, le, .comment)
                default:
                    if MarkupWords.diffHeaders.contains(where: { hasPrefix(i, $0) }) {
                        emit(i, le, .meta)
                    } else if MarkupWords.diffInfo.contains(where: { hasPrefix(i, $0) }) {
                        emit(i, le, .comment)
                    }
                }
            }
            i = next
        }
    }
}
