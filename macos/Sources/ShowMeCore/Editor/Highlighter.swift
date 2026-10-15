import Foundation

// 语法高亮分词器：零依赖、单遍扫描、按 UTF-16 偏移输出（可直接作为 NSRange 用于 NSTextStorage）。
// - 每种语言一个扫描器；C 系语言共用一个可配置扫描器（见 Highlighter+Code.swift）
// - 输出的 token 按位置排序、互不重叠；相邻同类 token 会合并
// - 未闭合的字符串 / 注释按语言习惯延伸到行尾或文件尾，任何输入都不会崩溃

public enum HighlightKind: UInt8, Sendable, CaseIterable {
    case keyword, type, function, string, number, constant, comment, property,
         tag, attribute, punctuation, `operator`, regex, variable, meta,
         heading, emphasis, strong, code, link, quote, listMarker, inserted, deleted, invalid
}

public struct HighlightToken: Sendable, Hashable {
    /// UTF-16 偏移，与 NSRange 兼容
    public var location: Int
    public var length: Int
    public var kind: HighlightKind

    public init(location: Int, length: Int, kind: HighlightKind) {
        self.location = location
        self.length = length
        self.kind = kind
    }

    public var end: Int { location + length }
    public var range: Range<Int> { location..<(location + length) }
}

public enum Highlighter {
    /// 对整段文本分词。`language` 是 `EditorLanguage.id`（也接受 "js"、"yml" 这类别名）。
    public static func tokens(in text: String, language: String) -> [HighlightToken] {
        tokens(utf16: Array(text.utf16), language: language)
    }

    /// 对一段 UTF-16 分词（App 可只取可见范围附近的若干行）。返回的偏移相对于数组开头。
    public static func tokens(utf16: [UInt16], language: String) -> [HighlightToken] {
        let id = scannerID(language)
        if id == "plain" || utf16.isEmpty { return [] }
        return utf16.withUnsafeBufferPointer { buffer in
            var lexer = Lexer(buffer)
            lexer.run(id)
            return lexer.out
        }
    }

    /// 该语言是否有专门的扫描器（纯文本返回 false）
    public static func supports(_ language: String) -> Bool {
        scannerID(language) != "plain"
    }

    static func scannerID(_ language: String) -> String {
        switch language {
        // 常用 id 直接命中，省去查表
        case "plain", "markdown", "json", "javascript", "typescript", "html", "xml", "css", "yaml", "sql", "shell", "python",
             "swift":
            return language
        default:
            return EditorLanguage.byID(language).id
        }
    }
}

// MARK: - 字符常量

/// ASCII 码位常量（UTF-16）
enum Ch {
    static let tab: UInt16 = 0x09
    static let lf: UInt16 = 0x0A
    static let vt: UInt16 = 0x0B
    static let ff: UInt16 = 0x0C
    static let cr: UInt16 = 0x0D
    static let space: UInt16 = 0x20
    static let excl: UInt16 = 0x21       // !
    static let dquote: UInt16 = 0x22     // "
    static let hash: UInt16 = 0x23       // #
    static let dollar: UInt16 = 0x24     // $
    static let percent: UInt16 = 0x25    // %
    static let amp: UInt16 = 0x26        // &
    static let squote: UInt16 = 0x27     // '
    static let lparen: UInt16 = 0x28     // (
    static let rparen: UInt16 = 0x29     // )
    static let star: UInt16 = 0x2A       // *
    static let plus: UInt16 = 0x2B       // +
    static let comma: UInt16 = 0x2C      // ,
    static let minus: UInt16 = 0x2D      // -
    static let dot: UInt16 = 0x2E        // .
    static let slash: UInt16 = 0x2F      // /
    static let zero: UInt16 = 0x30
    static let nine: UInt16 = 0x39
    static let colon: UInt16 = 0x3A      // :
    static let semicolon: UInt16 = 0x3B  // ;
    static let lt: UInt16 = 0x3C         // <
    static let equal: UInt16 = 0x3D      // =
    static let gt: UInt16 = 0x3E         // >
    static let question: UInt16 = 0x3F   // ?
    static let at: UInt16 = 0x40         // @
    static let lbracket: UInt16 = 0x5B   // [
    static let backslash: UInt16 = 0x5C  // \
    static let rbracket: UInt16 = 0x5D   // ]
    static let caret: UInt16 = 0x5E      // ^
    static let underscore: UInt16 = 0x5F // _
    static let backtick: UInt16 = 0x60   // `
    static let lbrace: UInt16 = 0x7B     // {
    static let pipe: UInt16 = 0x7C       // |
    static let rbrace: UInt16 = 0x7D     // }
    static let tilde: UInt16 = 0x7E      // ~

    static func units(_ s: String) -> [UInt16] { Array(s.utf16) }
}

@inline(__always) func isDigit(_ c: UInt16) -> Bool { c >= 0x30 && c <= 0x39 }
@inline(__always) func isHexDigit(_ c: UInt16) -> Bool {
    (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66)
}
@inline(__always) func isASCIILetter(_ c: UInt16) -> Bool { (c >= 0x61 && c <= 0x7A) || (c >= 0x41 && c <= 0x5A) }
@inline(__always) func isUpper(_ c: UInt16) -> Bool { c >= 0x41 && c <= 0x5A }
@inline(__always) func isLower(_ c: UInt16) -> Bool { c >= 0x61 && c <= 0x7A }
@inline(__always) func isASCIIAlnum(_ c: UInt16) -> Bool { isASCIILetter(c) || isDigit(c) }
@inline(__always) func isBlank(_ c: UInt16) -> Bool { c == 0x20 || c == 0x09 }
@inline(__always) func isNewline(_ c: UInt16) -> Bool { c == 0x0A || c == 0x0D }
@inline(__always) func isSpaceOrNewline(_ c: UInt16) -> Bool { c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D || c == 0x0C || c == 0x0B }

/// 非 ASCII 的空白（不算标识符字符）
@inline(__always) func isUnicodeSpace(_ c: UInt16) -> Bool {
    c == 0x85 || c == 0xA0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200B) || c == 0x2028 || c == 0x2029 || c == 0x202F
        || c == 0x205F || c == 0x3000 || c == 0xFEFF
}

/// 标识符首字符：字母、下划线，或任意非空白的非 ASCII 字符（中文标识符、代理对都算）
@inline(__always) func isIdentStart(_ c: UInt16) -> Bool {
    if c < 0x80 { return isASCIILetter(c) || c == 0x5F }
    return !isUnicodeSpace(c)
}

@inline(__always) func isIdentPart(_ c: UInt16) -> Bool {
    if c < 0x80 { return isASCIIAlnum(c) || c == 0x5F }
    return !isUnicodeSpace(c)
}

// MARK: - 关键字表

/// 关键字查找表：对 UTF-16 片段做 FNV-1a 哈希后查表，扫描时不分配字符串。
struct WordTable: Sendable {
    struct Entry: Sendable {
        let word: [UInt16]
        let kind: HighlightKind
        /// 软关键字（get / set / of …）：后面紧跟 `(` 时按函数处理
        let soft: Bool
    }

    private var buckets: [UInt64: [Entry]] = [:]
    let caseInsensitive: Bool
    private(set) var maxLength = 0

    static let empty = WordTable([])

    /// groups：每组是一个种类 + 空格分隔的单词
    init(_ groups: [(HighlightKind, String)], soft: String = "", caseInsensitive: Bool = false) {
        self.caseInsensitive = caseInsensitive
        for (kind, words) in groups { add(words, kind, soft: false) }
        if !soft.isEmpty { add(soft, .keyword, soft: true) }
    }

    private mutating func add(_ words: String, _ kind: HighlightKind, soft: Bool) {
        for w in words.split(whereSeparator: { $0 == " " || $0 == "\n" }) {
            var units = Array(w.utf16)
            if caseInsensitive { units = units.map(WordTable.lower) }
            let h = WordTable.hash(units)
            // 后加的同名词覆盖先加的
            buckets[h, default: []].removeAll { $0.word == units }
            buckets[h, default: []].append(Entry(word: units, kind: kind, soft: soft))
            maxLength = max(maxLength, units.count)
        }
    }

    @inline(__always) static func lower(_ c: UInt16) -> UInt16 { (c >= 0x41 && c <= 0x5A) ? c + 0x20 : c }

    static func hash(_ units: [UInt16]) -> UInt64 {
        var h: UInt64 = 0xcbf2_9ce4_8422_2325
        for c in units { h = (h ^ UInt64(c)) &* 0x0000_0100_0000_01B3 }
        return h
    }

    func lookup(_ b: UnsafeBufferPointer<UInt16>, _ start: Int, _ end: Int) -> Entry? {
        let len = end - start
        guard len > 0, len <= maxLength, start >= 0, end <= b.count else { return nil }
        var h: UInt64 = 0xcbf2_9ce4_8422_2325
        if caseInsensitive {
            for k in start..<end { h = (h ^ UInt64(WordTable.lower(b[k]))) &* 0x0000_0100_0000_01B3 }
        } else {
            for k in start..<end { h = (h ^ UInt64(b[k])) &* 0x0000_0100_0000_01B3 }
        }
        guard let bucket = buckets[h] else { return nil }
        for entry in bucket where entry.word.count == len {
            var same = true
            for k in 0..<len {
                let c = caseInsensitive ? WordTable.lower(b[start + k]) : b[start + k]
                if c != entry.word[k] { same = false; break }
            }
            if same { return entry }
        }
        return nil
    }

    func contains(_ b: UnsafeBufferPointer<UInt16>, _ start: Int, _ end: Int) -> Bool {
        lookup(b, start, end) != nil
    }
}

// MARK: - 扫描器基础

struct Lexer {
    let b: UnsafeBufferPointer<UInt16>
    /// 当前扫描上限（委托子语言时会临时收窄）
    var end: Int
    var out: [HighlightToken] = []
    /// 递归深度（字符串插值、HTML 内嵌脚本）
    var depth = 0
    /// lineEnd 的缓存：[from, value] 区间内的位置行尾相同（同一行多次插值时避免反复扫描）
    private var memo = (from: -1, value: -1, limit: -1)

    init(_ b: UnsafeBufferPointer<UInt16>) {
        self.b = b
        self.end = b.count
        out.reserveCapacity(min(b.count / 6 + 16, 1 << 20))
    }

    /// 越界返回 0（只用于向前看比较，循环条件仍要检查 `< end`）
    @inline(__always) func at(_ i: Int) -> UInt16 { (i >= 0 && i < end) ? b[i] : 0 }

    /// 追加 token：自动裁掉与上一个重叠的部分，并与相邻同类 token 合并。
    mutating func emit(_ start: Int, _ stop: Int, _ kind: HighlightKind) {
        var s = start
        let e = min(stop, end)
        if let last = out.last {
            let lastEnd = last.location + last.length
            if s < lastEnd { s = lastEnd }
            guard e > s else { return }
            if s == lastEnd && last.kind == kind {
                out[out.count - 1].length = e - last.location
                return
            }
        }
        guard e > s else { return }
        out.append(HighlightToken(location: s, length: e - s, kind: kind))
    }

    // 行

    /// 从 i 起第一个 \n 或 \r 的位置（没有则为 end）
    func lineEnd(_ i: Int) -> Int {
        var j = max(i, 0)
        while j < end {
            let c = b[j]
            if c == Ch.lf || c == Ch.cr { return j }
            j += 1
        }
        return end
    }

    /// 带缓存的 lineEnd
    mutating func memoLineEnd(_ i: Int) -> Int {
        if memo.limit == end && i >= memo.from && i <= memo.value { return memo.value }
        let e = lineEnd(i)
        memo = (i, e, end)
        return e
    }

    /// 行尾 le 之后下一行的开头（\r\n 算一个换行）
    func nextLineStart(_ le: Int) -> Int {
        guard le < end else { return end }
        if b[le] == Ch.cr && le + 1 < end && b[le + 1] == Ch.lf { return le + 2 }
        return le + 1
    }

    func skipBlanks(_ i: Int, _ limit: Int) -> Int {
        var j = i
        while j < limit && isBlank(b[j]) { j += 1 }
        return j
    }

    func skipWhitespace(_ i: Int) -> Int {
        var j = i
        while j < end && isSpaceOrNewline(b[j]) { j += 1 }
        return j
    }

    /// 去掉 [s, e) 末尾的空白后的结束位置
    func trimEnd(_ s: Int, _ e: Int) -> Int {
        var k = e
        while k > s && isBlank(b[k - 1]) { k -= 1 }
        return k
    }

    func hasPrefix(_ i: Int, _ s: [UInt16]) -> Bool {
        guard i >= 0, i + s.count <= end else { return false }
        for k in 0..<s.count where b[i + k] != s[k] { return false }
        return true
    }

    /// 不区分 ASCII 大小写的前缀判断；s 须为小写
    func hasPrefixCI(_ i: Int, _ s: [UInt16]) -> Bool {
        guard i >= 0, i + s.count <= end else { return false }
        for k in 0..<s.count where WordTable.lower(b[i + k]) != s[k] { return false }
        return true
    }

    /// 在 [from, limit) 中找 s，返回其起点
    func find(_ s: [UInt16], from: Int, limit: Int) -> Int? {
        guard let first = s.first else { return nil }
        let stop = min(limit, end) - s.count
        var j = from
        while j <= stop {
            if b[j] == first && hasPrefix(j, s) { return j }
            j += 1
        }
        return nil
    }

    func identEnd(_ i: Int) -> Int {
        var j = i
        while j < end && isIdentPart(b[j]) { j += 1 }
        return j
    }

    /// [s, e) 是否等于 ASCII 字符串（区分大小写）
    func equals(_ s: Int, _ e: Int, _ word: String) -> Bool {
        let units = word.utf16
        guard e - s == units.count else { return false }
        var k = s
        for u in units {
            if b[k] != u { return false }
            k += 1
        }
        return true
    }

    func string(_ s: Int, _ e: Int) -> String {
        guard s < e, s >= 0, e <= b.count else { return "" }
        return String(decoding: UnsafeBufferPointer(rebasing: b[s..<e]), as: UTF16.self)
    }

    // 数字

    /// 数字字面量的结束位置：十六进制 / 二进制 / 八进制 / 十进制、小数、指数、下划线、类型后缀（n、L、f、u8…）
    func numberEnd(_ i: Int, suffix: Bool = true) -> Int {
        let j = numberBodyEnd(i)
        return suffix ? suffixEnd(j) : j
    }

    private func numberBodyEnd(_ i: Int) -> Int {
        var j = i
        if at(j) == Ch.zero {
            let x = at(j + 1) | 0x20
            if x == 0x78 { // 0x
                j += 2
                while isHexDigit(at(j)) || at(j) == Ch.underscore { j += 1 }
                if at(j) == Ch.dot && isHexDigit(at(j + 1)) {
                    j += 1
                    while isHexDigit(at(j)) || at(j) == Ch.underscore { j += 1 }
                }
                if (at(j) | 0x20) == 0x70 { j = exponentEnd(j) } // p 指数（十六进制浮点）
                return j
            }
            if x == 0x62 || x == 0x6F { // 0b 0o
                j += 2
                while isHexDigit(at(j)) || at(j) == Ch.underscore { j += 1 }
                return j
            }
        }
        while isDigit(at(j)) || at(j) == Ch.underscore { j += 1 }
        if at(j) == Ch.dot && isDigit(at(j + 1)) {
            j += 1
            while isDigit(at(j)) || at(j) == Ch.underscore { j += 1 }
        }
        if (at(j) | 0x20) == 0x65 { j = exponentEnd(j) }
        return j
    }

    /// j 指向 e/E/p/P：后面是合法指数才吞掉
    private func exponentEnd(_ j: Int) -> Int {
        var k = j + 1
        if at(k) == Ch.plus || at(k) == Ch.minus { k += 1 }
        guard isDigit(at(k)) else { return j }
        while isDigit(at(k)) || at(k) == Ch.underscore { k += 1 }
        return k
    }

    private func suffixEnd(_ j: Int) -> Int {
        var k = j
        while isASCIIAlnum(at(k)) || at(k) == Ch.underscore { k += 1 }
        return k
    }

    // 字符串与注释

    /// 从开引号 i 扫到闭引号之后；遇到未转义换行（非多行）或文件尾即止。
    func quotedEnd(_ i: Int, quote q: UInt16, escapes: Bool = true, multiline: Bool = false, doubled: Bool = false) -> Int {
        var j = i + 1
        while j < end {
            let c = b[j]
            if c == q {
                if doubled && at(j + 1) == q { j += 2; continue }
                return j + 1
            }
            if c == Ch.backslash && escapes {
                j += (at(j + 1) == Ch.cr && at(j + 2) == Ch.lf) ? 3 : 2
                continue
            }
            if (c == Ch.lf || c == Ch.cr) && !multiline { return j }
            j += 1
        }
        return end
    }

    /// 块注释结束位置（支持嵌套）；未闭合到文件尾
    func blockCommentEnd(_ i: Int, open: [UInt16], close: [UInt16], nested: Bool) -> Int {
        var j = i + open.count
        var level = 1
        guard let closeFirst = close.first else { return end }
        let openFirst = open.first ?? 0
        while j < end {
            let c = b[j]
            if c == closeFirst && hasPrefix(j, close) {
                level -= 1
                j += close.count
                if level == 0 { return j }
                continue
            }
            if nested && c == openFirst && hasPrefix(j, open) {
                level += 1
                j += open.count
                continue
            }
            j += 1
        }
        return end
    }

    /// i 处是 http(s):// 开头的 URL 时返回其结束位置（不含末尾标点）
    func urlEnd(_ i: Int, _ limit: Int) -> Int? {
        let http: [UInt16] = [0x68, 0x74, 0x74, 0x70]
        guard hasPrefix(i, http) else { return nil }
        var j = i + 4
        if at(j) == 0x73 { j += 1 } // s
        guard at(j) == Ch.colon, at(j + 1) == Ch.slash, at(j + 2) == Ch.slash else { return nil }
        j += 3
        let start = j
        while j < limit {
            let c = b[j]
            if isSpaceOrNewline(c) || c == Ch.lt || c == Ch.gt || c == Ch.dquote || c == Ch.backtick || c == Ch.squote { break }
            j += 1
        }
        // 去掉末尾标点
        while j > start {
            let last = b[j - 1]
            guard last == Ch.dot || last == Ch.comma || last == Ch.semicolon || last == Ch.colon || last == Ch.excl
                || last == Ch.question || last == Ch.rparen || last == Ch.rbracket else { break }
            j -= 1
        }
        return j > start ? j : nil
    }

    // MARK: 分发

    mutating func run(_ id: String) {
        switch id {
        case "plain": return
        case "json": scanJSON(from: 0)
        case "xml": scanMarkup(from: 0, html: false)
        case "html": scanMarkup(from: 0, html: true)
        case "css": scanCSS(from: 0, dialect: .css)
        case "scss": scanCSS(from: 0, dialect: .scss)
        case "less": scanCSS(from: 0, dialect: .less)
        case "markdown": scanMarkdown()
        case "yaml": scanYAML()
        case "toml": scanConfig(toml: true)
        case "ini": scanConfig(toml: false)
        case "diff": scanDiff()
        case "shell": scanShell(from: shebang())
        case "dockerfile": scanDockerfile()
        case "makefile": scanMakefile()
        case "csv": scanCSV()
        case "log": scanLog()
        case "ignore": scanIgnore()
        default:
            if let config = CodeConfig.forLanguage(id) {
                let start = shebang()
                _ = scanCode(config, from: start)
            }
        }
    }

    /// 首行 `#!` 标成 meta，返回正文起点
    mutating func shebang() -> Int {
        guard at(0) == Ch.hash, at(1) == Ch.excl else { return 0 }
        let le = lineEnd(0)
        emit(0, le, .meta)
        return le
    }

    /// 在 [start, stop) 上运行另一种语言的扫描器（HTML 里的 script/style、Dockerfile 的 shell 片段）
    mutating func delegate(_ id: String, _ start: Int, _ stop: Int) {
        guard stop > start, depth < 8 else { return }
        let saved = end
        end = min(stop, saved)
        depth += 1
        switch id {
        case "json": scanJSON(from: start)
        case "css": scanCSS(from: start, dialect: .css)
        case "scss": scanCSS(from: start, dialect: .scss)
        case "less": scanCSS(from: start, dialect: .less)
        case "shell": scanShell(from: start)
        case "html": scanMarkup(from: start, html: true)
        default:
            if let config = CodeConfig.forLanguage(id) { _ = scanCode(config, from: start) }
        }
        depth -= 1
        end = saved
    }
}
