import Foundation

/// 常用正则
public struct RegexPreset: Sendable, Hashable, Identifiable {
    public let id: String
    public let name: LocalizedText
    public let pattern: String
    /// 网页版的 JS 标志（g / i / m / s / u），只有 i、m、s 会影响 NSRegularExpression
    public let flags: String
    public let summary: LocalizedText
    public let sample: String
    /// 替换示例
    public let replacement: String?
}

/// 正则表达式测试：编译、匹配、替换（NSRegularExpression / ICU 语法）
public enum RegexTester {
    public static let matchLimit = 1000

    public struct Flags: Sendable, Hashable {
        public var ignoreCase = false
        /// ^ $ 匹配每一行
        public var multiline = false
        /// . 也匹配换行
        public var dotAll = false
        /// 忽略空白与 # 注释
        public var extended = false

        public init(ignoreCase: Bool = false, multiline: Bool = false, dotAll: Bool = false, extended: Bool = false) {
            self.ignoreCase = ignoreCase
            self.multiline = multiline
            self.dotAll = dotAll
            self.extended = extended
        }

        /// 从 JS 标志串读取（g、u 等忽略）
        public init(js: String) {
            ignoreCase = js.contains("i")
            multiline = js.contains("m")
            dotAll = js.contains("s")
        }

        public var options: NSRegularExpression.Options {
            var o: NSRegularExpression.Options = []
            if ignoreCase { o.insert(.caseInsensitive) }
            if multiline { o.insert(.anchorsMatchLines) }
            if dotAll { o.insert(.dotMatchesLineSeparators) }
            if extended { o.insert(.allowCommentsAndWhitespace) }
            return o
        }

        public static func | (a: Flags, b: Flags) -> Flags {
            Flags(ignoreCase: a.ignoreCase || b.ignoreCase, multiline: a.multiline || b.multiline,
                  dotAll: a.dotAll || b.dotAll, extended: a.extended || b.extended)
        }
    }

    public struct CaptureGroup: Sendable, Hashable {
        /// 从 1 开始的组号
        public var index: Int
        public var name: String?
    }

    public struct Group: Sendable, Hashable {
        public var index: Int
        public var name: String?
        /// 未参与匹配时为 nil
        public var value: String?
        /// UTF-16 区间
        public var range: NSRange?
    }

    public struct Match: Sendable, Hashable {
        /// 第几个匹配（从 0 开始）
        public var number: Int
        /// UTF-16 区间（与 NSString / NSRange 一致）
        public var range: NSRange
        public var text: String
        public var groups: [Group]
        /// 1 起始的行列（列按 Unicode 标量计）
        public var start: (line: Int, column: Int)
        public var end: (line: Int, column: Int)

        public static func == (a: Match, b: Match) -> Bool {
            a.number == b.number && a.range == b.range && a.text == b.text && a.groups == b.groups
        }

        public func hash(into h: inout Hasher) {
            h.combine(number)
            h.combine(range.location)
            h.combine(range.length)
        }
    }

    // MARK: 编译

    /// 编译表达式；语法错误时抛出本地化的 ToolError
    public static func compile(_ pattern: String, flags: Flags, lang: Lang) throws -> NSRegularExpression {
        do {
            // ICU 不接受空表达式；JS 里空表达式匹配每个位置
            return try NSRegularExpression(pattern: pattern.isEmpty ? "(?:)" : pattern, options: flags.options)
        } catch {
            let reason = diagnose(pattern, extended: flags.extended)
            throw ToolError(lang.t("正则表达式无效：", "Invalid regular expression: ") + reason(lang))
        }
    }

    /// 找出常见的语法错误（ICU 只报告错误码，没有可读的说明）
    public static func diagnose(_ pattern: String, extended: Bool = false) -> LocalizedText {
        let s = Array(pattern.unicodeScalars)
        let n = s.count
        enum Prev { case start, atom, quantifier, modifier }
        var prev = Prev.start
        var groups = 0
        var inClass = 0
        var i = 0
        let nothingToRepeat = LocalizedText("量词前面没有可重复的内容（如开头的 *、+、? 或连续的量词）",
                                            "A quantifier has nothing to repeat (e.g. a leading *, + or ?, or two quantifiers in a row)")
        /// lazyOrPossessive：紧跟在量词后的 ? 或 + 是修饰符（*?、++），其它量词连写是错误
        func quantifier(_ lazyOrPossessive: Bool) -> LocalizedText? {
            switch prev {
            case .start: return nothingToRepeat
            case .atom: prev = .quantifier
            case .quantifier:
                if !lazyOrPossessive { return nothingToRepeat }
                prev = .modifier
            case .modifier: return nothingToRepeat
            }
            return nil
        }
        while i < n {
            let c = s[i]
            if c == "\\" {
                guard i + 1 < n else { return LocalizedText("表达式以单独的 \\ 结尾", "The pattern ends with a lone \\") }
                let e = s[i + 1]
                if e == "Q" {
                    // \Q…\E 原样引用
                    var j = i + 2
                    while j + 1 < n, !(s[j] == "\\" && s[j + 1] == "E") { j += 1 }
                    i = j + 2
                    if inClass == 0 { prev = .atom }
                    continue
                }
                i += 2
                let incomplete = LocalizedText("转义「\\\(e)」不完整", "Incomplete escape “\\\(e)”")
                func hexCount(_ max: Int) -> Int {
                    var k = 0
                    while k < max, i + k < n, Character(s[i + k]).isHexDigit { k += 1 }
                    return k
                }
                // \p{…}、\x{…}、\N{…}、\k<name>、\uXXXX
                if "pPNk".unicodeScalars.contains(e) || (e == "x" && i < n && s[i] == "{") {
                    let open: Unicode.Scalar = e == "k" ? "<" : "{"
                    let close: Unicode.Scalar = e == "k" ? ">" : "}"
                    guard i < n, s[i] == open else { return incomplete }
                    while i < n, s[i] != close { i += 1 }
                    if i >= n { return LocalizedText("转义「\\\(e)」缺少结尾的 \(close)", "The escape “\\\(e)” is missing its closing \(close)") }
                    i += 1
                } else if e == "x" {
                    if hexCount(2) == 0 { return incomplete }
                } else if e == "u" || e == "U" {
                    let need = e == "u" ? 4 : 8
                    if hexCount(need) < need { return incomplete }
                }
                if inClass == 0 { prev = .atom }
                continue
            }
            if inClass > 0 {
                if c == "[" {
                    inClass += 1
                } else if c == "]" {
                    inClass -= 1
                    if inClass == 0 { prev = .atom }
                }
                i += 1
                continue
            }
            if extended, c == "#" {
                while i < n, s[i] != "\n" { i += 1 }
                continue
            }
            if extended, c == " " || c == "\t" || c == "\n" || c == "\r" {
                i += 1
                continue
            }
            switch c {
            case "[":
                inClass = 1
                i += 1
                if i < n, s[i] == "^" { i += 1 }
                continue
            case "(":
                groups += 1
                prev = .start
                i += 1
                // (?:、(?=、(?<name> 等：跳过 ? 及其后的标记
                if i < n, s[i] == "?" {
                    i += 1
                    if i < n, s[i] == "#" {
                        // (?# 注释 )
                        while i < n, s[i] != ")" { i += 1 }
                        groups -= 1
                        if i < n { i += 1 }
                        prev = .atom
                    }
                }
                continue
            case ")":
                if groups == 0 { return LocalizedText("多余的 )：找不到与之配对的 (", "Unmatched ): there is no ( for it") }
                groups -= 1
                prev = .atom
            case "|":
                prev = .start
            case "*", "+", "?":
                if let err = quantifier(c == "?" || c == "+") { return err }
            case "{":
                // {m}、{m,}、{m,n}
                var j = i + 1
                var m = ""
                var hasComma = false
                var nStr = ""
                while j < n, Curl.isDigit(s[j]) {
                    m.unicodeScalars.append(s[j])
                    j += 1
                }
                if j < n, s[j] == "," {
                    hasComma = true
                    j += 1
                    while j < n, Curl.isDigit(s[j]) {
                        nStr.unicodeScalars.append(s[j])
                        j += 1
                    }
                }
                if j < n, s[j] == "}", !m.isEmpty {
                    if hasComma, let a = Int(m), let b = Int(nStr), a > b {
                        return LocalizedText("量词 {m,n} 中 m 不能大于 n", "In the quantifier {m,n}, m can't be greater than n")
                    }
                    if let err = quantifier(false) { return err }
                    i = j + 1
                    continue
                }
                if !m.isEmpty || hasComma { return LocalizedText("量词不完整（如 {2,）", "Incomplete quantifier (e.g. {2,)") }
                prev = .atom
            default:
                prev = .atom
            }
            i += 1
        }
        if inClass > 0 { return LocalizedText("字符集没有闭合：缺少 ]", "Unclosed character class: missing ]") }
        if groups > 0 { return LocalizedText("分组没有闭合：缺少 )", "Unclosed group: missing )") }
        return LocalizedText("语法有误，请检查转义、分组与量词", "Syntax error; check escapes, groups and quantifiers")
    }

    /// 扫描正则源码，按出现顺序列出捕获组（跳过转义、字符集、非捕获组与断言）
    public static func captureGroups(_ pattern: String) -> [CaptureGroup] {
        let s = Array(pattern.unicodeScalars)
        var out: [CaptureGroup] = []
        var inClass = 0
        var i = 0
        while i < s.count {
            let c = s[i]
            if c == "\\" {
                if i + 1 < s.count, s[i + 1] == "Q" {
                    var j = i + 2
                    while j + 1 < s.count, !(s[j] == "\\" && s[j + 1] == "E") { j += 1 }
                    i = j + 2
                    continue
                }
                i += 2
                continue
            }
            if inClass > 0 {
                if c == "[" { inClass += 1 } else if c == "]" { inClass -= 1 }
                i += 1
                continue
            }
            if c == "[" {
                inClass = 1
                i += 1
                if i < s.count, s[i] == "^" { i += 1 }
                if i < s.count, s[i] == "]" { i += 1 }
                continue
            }
            if c == "(" {
                if i + 1 >= s.count || s[i + 1] != "?" {
                    out.append(CaptureGroup(index: out.count + 1, name: nil))
                } else if i + 2 < s.count, s[i + 2] == "<", i + 3 < s.count, s[i + 3] != "=", s[i + 3] != "!" {
                    var j = i + 3
                    var name = ""
                    while j < s.count, s[j] != ">" {
                        name.unicodeScalars.append(s[j])
                        j += 1
                    }
                    out.append(CaptureGroup(index: out.count + 1, name: j < s.count ? name : nil))
                }
            }
            i += 1
        }
        return out
    }

    // MARK: 匹配

    /// 单次运行的时间上限（秒），防止灾难性回溯卡死
    public static let timeLimit: TimeInterval = 2

    /// 找出所有匹配（最多 limit 个）；超过上限时 truncated = true，超时时 timedOut = true
    public static func matches(_ regex: NSRegularExpression, in text: String, limit: Int = matchLimit, timeLimit: TimeInterval = timeLimit) -> (matches: [Match], truncated: Bool, timedOut: Bool) {
        let ns = text as NSString
        let names = captureGroups(regex.pattern)
        var raw: [NSTextCheckingResult] = []
        var truncated = false
        var timedOut = false
        let start = ProcessInfo.processInfo.systemUptime
        regex.enumerateMatches(in: text, options: [.reportProgress], range: NSRange(location: 0, length: ns.length)) { result, _, stop in
            if ProcessInfo.processInfo.systemUptime - start > timeLimit {
                timedOut = true
                stop.pointee = true
                return
            }
            guard let result else { return }
            if raw.count >= limit {
                truncated = true
                stop.pointee = true
                return
            }
            raw.append(result)
        }
        var locator = PositionLocator(text)
        let out = raw.enumerated().map { k, r -> Match in
            var groups: [Group] = []
            if r.numberOfRanges > 1 {
                for g in 1..<r.numberOfRanges {
                    let gr = r.range(at: g)
                    let found = gr.location != NSNotFound
                    groups.append(Group(index: g, name: g - 1 < names.count ? names[g - 1].name : nil,
                                        value: found ? ns.substring(with: gr) : nil, range: found ? gr : nil))
                }
            }
            let start = locator.position(r.range.location)
            let end = locator.position(r.range.location + r.range.length)
            return Match(number: k, range: r.range, text: ns.substring(with: r.range), groups: groups, start: start, end: end)
        }
        return (out, truncated, timedOut)
    }

    /// 按 JS（String.prototype.replace）语义替换全部匹配，返回结果与替换次数
    /// 超时（timedOut）时只替换已经找到的匹配
    public static func replace(_ regex: NSRegularExpression, in text: String, template: String, timeLimit: TimeInterval = timeLimit) -> (output: String, count: Int, timedOut: Bool) {
        let ns = text as NSString
        let names = captureGroups(regex.pattern)
        let hasNames = names.contains { $0.name != nil }
        var out = ""
        var last = 0
        var count = 0
        var timedOut = false
        let start = ProcessInfo.processInfo.systemUptime
        regex.enumerateMatches(in: text, options: [.reportProgress], range: NSRange(location: 0, length: ns.length)) { result, _, stop in
            if ProcessInfo.processInfo.systemUptime - start > timeLimit {
                timedOut = true
                stop.pointee = true
                return
            }
            guard let r = result else { return }
            var captures: [String?] = []
            if r.numberOfRanges > 1 {
                for g in 1..<r.numberOfRanges {
                    let gr = r.range(at: g)
                    captures.append(gr.location == NSNotFound ? nil : ns.substring(with: gr))
                }
            }
            var named: [String: String?]?
            if hasNames {
                var dict: [String: String?] = [:]
                for g in names {
                    if let name = g.name, g.index - 1 < captures.count { dict[name] = captures[g.index - 1] }
                }
                named = dict
            }
            out += ns.substring(with: NSRange(location: last, length: r.range.location - last))
            out += expandReplacement(template, matched: ns.substring(with: r.range), position: r.range.location,
                                     in: ns, captures: captures, named: named)
            last = r.range.location + r.range.length
            count += 1
        }
        out += ns.substring(from: last)
        return (out, count, timedOut)
    }

    /// 替换模板展开（ECMAScript GetSubstitution）：
    /// $$ → $，$& 整个匹配，$` 匹配前的文本，$' 匹配后的文本，$1~$99 编号组，$<name> 命名组
    public static func expandReplacement(
        _ template: String, matched: String, position: Int, in str: NSString,
        captures: [String?], named: [String: String?]?
    ) -> String {
        guard template.contains("$") else { return template }
        let t = Array(template.unicodeScalars)
        let m = captures.count
        var out = String.UnicodeScalarView()
        var i = 0
        func digit(_ k: Int) -> Int? {
            guard k < t.count, Curl.isDigit(t[k]) else { return nil }
            return Int(t[k].value - 48)
        }
        while i < t.count {
            let c = t[i]
            if c != "$" || i + 1 >= t.count {
                out.append(c)
                i += 1
                continue
            }
            let next = t[i + 1]
            switch next {
            case "$":
                out.append("$")
                i += 2
            case "&":
                out.append(contentsOf: matched.unicodeScalars)
                i += 2
            case "`":
                out.append(contentsOf: str.substring(to: min(position, str.length)).unicodeScalars)
                i += 2
            case "'":
                out.append(contentsOf: str.substring(from: min(position + (matched as NSString).length, str.length)).unicodeScalars)
                i += 2
            case "<":
                guard let named, let close = t[(i + 2)...].firstIndex(of: ">") else {
                    out.append(contentsOf: "$<".unicodeScalars)
                    i += 2
                    continue
                }
                let name = String(String.UnicodeScalarView(t[(i + 2)..<close]))
                if let v = named[name], let v { out.append(contentsOf: v.unicodeScalars) }
                i = close + 1
            default:
                guard let d1 = digit(i + 1) else {
                    out.append("$")
                    i += 1
                    continue
                }
                var index = d1
                var len = 1
                if let d2 = digit(i + 2), d1 * 10 + d2 <= m, d1 * 10 + d2 >= 1 {
                    index = d1 * 10 + d2
                    len = 2
                }
                if index >= 1, index <= m {
                    if let v = captures[index - 1] { out.append(contentsOf: v.unicodeScalars) }
                } else {
                    out.append("$")
                    out.append(contentsOf: t[(i + 1)...(i + len)])
                }
                i += 1 + len
            }
        }
        return String(out)
    }

    /// UTF-16 下标 → 1 起始的行列（列按 Unicode 标量计）。要求按递增顺序查询，整体 O(n)。
    struct PositionLocator {
        let units: [UInt16]
        var offset = 0
        var line = 1
        var column = 1

        init(_ text: String) {
            units = Array(text.utf16)
        }

        mutating func position(_ target: Int) -> (line: Int, column: Int) {
            if target < offset {
                offset = 0
                line = 1
                column = 1
            }
            while offset < min(target, units.count) {
                let u = units[offset]
                if u == 0x0A {
                    line += 1
                    column = 1
                } else if !(0xDC00...0xDFFF).contains(u) {
                    column += 1
                }
                offset += 1
            }
            return (line, column)
        }
    }
}
