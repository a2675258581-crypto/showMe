import Foundation

/// 文本处理：统计与各种批量操作（纯函数）。结果里的 info 已按 lang 本地化。
public enum TextToolkit {
    public struct OpResult: Sendable, Hashable {
        public var output: String
        public var info: String?
    }

    // MARK: - 统计

    public struct Stats: Sendable, Hashable {
        /// 字符数（按字素簇计，emoji 算 1 个）
        public var chars = 0
        public var charsNoSpace = 0
        /// 汉字数
        public var cjk = 0
        /// 英文单词数
        public var words = 0
        /// 行数（空文本为 0）
        public var lines = 0
        /// 段落数（以空行分隔的非空文本块）
        public var paragraphs = 0
        public var bytes = 0
        /// 预计阅读时间（秒）：中文约 300 字 / 分钟，英文约 200 词 / 分钟
        public var readingSeconds = 0
    }

    static func isSpace(_ ch: Character) -> Bool {
        ch.isWhitespace || ch == "\u{FEFF}"
    }

    /// \p{Script=Han}（常用区段）
    public static func isHan(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x2E80...0x2FDF, 0x3005, 0x3007, 0x3021...0x3029, 0x3038...0x303B, 0x3400...0x4DBF, 0x4E00...0x9FFF,
             0xF900...0xFAFF, 0x16FE2, 0x16FE3, 0x16FF0, 0x16FF1, 0x20000...0x323AF:
            return true
        default:
            return false
        }
    }

    static func isASCIILetter(_ s: Unicode.Scalar) -> Bool {
        (s.value >= 65 && s.value <= 90) || (s.value >= 97 && s.value <= 122)
    }

    /// 英文单词：[A-Za-z]+(?:['’-][A-Za-z]+)*
    public static func countWords(_ text: String) -> Int {
        let s = Array(text.unicodeScalars)
        var n = 0
        var i = 0
        while i < s.count {
            guard isASCIILetter(s[i]) else {
                i += 1
                continue
            }
            n += 1
            while i < s.count {
                while i < s.count, isASCIILetter(s[i]) { i += 1 }
                if i + 1 < s.count, s[i] == "'" || s[i] == "\u{2019}" || s[i] == "-", isASCIILetter(s[i + 1]) {
                    i += 1
                    continue
                }
                break
            }
        }
        return n
    }

    public static func countLines(_ text: String) -> Int {
        text.isEmpty ? 0 : text.utf8.reduce(1) { $1 == 10 ? $0 + 1 : $0 }
    }

    public static func countParagraphs(_ text: String) -> Int {
        var count = 0
        var inPara = false
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.hasSuffix("\r") ? raw.dropLast() : raw
            let separator = line.unicodeScalars.allSatisfy { $0 == " " || $0 == "\t" || $0 == "\u{3000}" }
            if separator {
                inPara = false
                continue
            }
            if !inPara, line.contains(where: { !isSpace($0) }) {
                count += 1
                inPara = true
            }
        }
        return count
    }

    public static func readingSeconds(cjk: Int, words: Int) -> Int {
        Int(((Double(cjk) / 300 + Double(words) / 200) * 60).rounded())
    }

    /// 12 → "12 秒"，95 → "约 2 分钟"
    public static func formatReadingTime(_ seconds: Int, _ lang: Lang) -> String {
        if seconds <= 0 { return lang.t("0 秒", "0 s") }
        if seconds < 60 { return lang.t("\(seconds) 秒", "\(seconds) s") }
        let min = Int((Double(seconds) / 60).rounded())
        if min < 60 { return lang.t("约 \(min) 分钟", "about \(min) min") }
        let h = min / 60
        let m = min % 60
        if m == 0 { return lang.t("约 \(h) 小时", "about \(h) h") }
        return lang.t("约 \(h) 小时 \(m) 分钟", "about \(h) h \(m) min")
    }

    public static func stats(_ text: String) -> Stats {
        var s = Stats()
        for ch in text {
            s.chars += 1
            if !isSpace(ch) { s.charsNoSpace += 1 }
        }
        for u in text.unicodeScalars where isHan(u) { s.cjk += 1 }
        s.words = countWords(text)
        s.lines = countLines(text)
        s.paragraphs = countParagraphs(text)
        s.bytes = text.utf8.count
        s.readingSeconds = readingSeconds(cjk: s.cjk, words: s.words)
        return s
    }

    // MARK: - 行工具

    /// 统一换行符后按行切分；空文本返回 []
    public static func splitLines(_ text: String) -> [String] {
        if text.isEmpty { return [] }
        return text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    static func join(_ lines: [String]) -> String { lines.joined(separator: "\n") }

    static func isBlank(_ s: String) -> Bool { !s.contains { !isSpace($0) } }

    static func trim(_ s: String) -> String {
        guard let a = s.firstIndex(where: { !isSpace($0) }), let b = s.lastIndex(where: { !isSpace($0) }) else { return "" }
        return String(s[a...b])
    }

    public static func dedupe(_ text: String, ignoreCase: Bool = false, trimmed: Bool = false, keepEmpty: Bool = false, lang: Lang = .zh) -> OpResult {
        let lines = splitLines(text)
        var seen = Set<String>()
        var out: [String] = []
        for line in lines {
            if keepEmpty, isBlank(line) {
                out.append(line)
                continue
            }
            var key = trimmed ? trim(line) : line
            if ignoreCase { key = key.lowercased() }
            if seen.insert(key).inserted { out.append(line) }
        }
        let removed = lines.count - out.count
        return OpResult(output: join(out), info: removed > 0 ? lang.t("删除了 \(removed) 行重复", "Removed \(removed) duplicate lines") : lang.t("没有重复行", "No duplicate lines"))
    }

    public enum SortMode: String, Sendable, CaseIterable { case asc, desc, natural, length, reverse, shuffle }

    static let collationLocale = Locale(identifier: "zh_Hans_CN")

    /// 排序：升 / 降序按中文拼音与字母顺序，自然排序识别数字，按长度稳定排序，随机打乱用 random 提供的随机字节
    public static func sort(_ text: String, mode: SortMode, random: (Int) -> [UInt8] = ToolInput.systemRandom, lang: Lang = .zh) -> OpResult {
        let lines = splitLines(text)
        let indexed = Array(lines.enumerated())
        func ordered(_ cmp: (String, String) -> ComparisonResult) -> [String] {
            indexed.sorted { a, b in
                let r = cmp(a.element, b.element)
                return r == .orderedSame ? a.offset < b.offset : r == .orderedAscending
            }.map(\.element)
        }
        let out: [String]
        let label: String
        switch mode {
        case .asc:
            out = ordered { $0.compare($1, locale: collationLocale) }
            label = lang.t("升序", "Ascending")
        case .desc:
            out = ordered { $1.compare($0, locale: collationLocale) }
            label = lang.t("降序", "Descending")
        case .natural:
            out = ordered { $0.compare($1, options: [.numeric, .caseInsensitive, .diacriticInsensitive], locale: collationLocale) }
            label = lang.t("自然排序", "Natural order")
        case .length:
            let lengths = lines.map(\.count)
            out = indexed.sorted { lengths[$0.offset] != lengths[$1.offset] ? lengths[$0.offset] < lengths[$1.offset] : $0.offset < $1.offset }.map(\.element)
            label = lang.t("按长度", "By length")
        case .reverse:
            out = lines.reversed()
            label = lang.t("反转", "Reversed")
        case .shuffle:
            var a = lines
            if a.count > 1 {
                let bytes = random(4 * a.count)
                for i in stride(from: a.count - 1, to: 0, by: -1) {
                    let k = 4 * i
                    var r: UInt32 = 0
                    if k + 3 < bytes.count {
                        r = UInt32(bytes[k]) << 24 | UInt32(bytes[k + 1]) << 16 | UInt32(bytes[k + 2]) << 8 | UInt32(bytes[k + 3])
                    }
                    let j = Int(r % UInt32(i + 1))
                    a.swapAt(i, j)
                }
            }
            out = a
            label = lang.t("随机打乱", "Shuffled")
        }
        return OpResult(output: join(out), info: lang.t("\(label)：\(lines.count) 行", "\(label): \(lines.count) lines"))
    }

    // MARK: - 空白处理

    public static func removeEmptyLines(_ text: String, lang: Lang = .zh) -> OpResult {
        let lines = splitLines(text)
        let out = lines.filter { !isBlank($0) }
        let n = lines.count - out.count
        return OpResult(output: join(out), info: n > 0 ? lang.t("删除了 \(n) 个空行", "Removed \(n) empty lines") : lang.t("没有空行", "No empty lines"))
    }

    public static func trimLines(_ text: String, lang: Lang = .zh) -> OpResult {
        var changed = 0
        let out = splitLines(text).map { l -> String in
            let t = trim(l)
            if t != l { changed += 1 }
            return t
        }
        return OpResult(output: join(out), info: changed > 0 ? lang.t("修整了 \(changed) 行", "Trimmed \(changed) lines") : lang.t("没有首尾空白", "No leading or trailing whitespace"))
    }

    /// 把连续的空格 / 制表符（含全角空格、不换行空格）合并成一个半角空格，不影响换行
    public static func collapseSpaces(_ text: String, lang: Lang = .zh) -> OpResult {
        func blank(_ s: Unicode.Scalar) -> Bool { s == " " || s == "\t" || s == "\u{3000}" || s == "\u{A0}" }
        let s = Array(text.unicodeScalars)
        var out = String.UnicodeScalarView()
        var n = 0
        var i = 0
        while i < s.count {
            guard blank(s[i]) else {
                out.append(s[i])
                i += 1
                continue
            }
            var j = i
            while j < s.count, blank(s[j]) { j += 1 }
            if j - i >= 2 || s[i] != " " {
                n += 1
                out.append(" ")
            } else {
                out.append(" ")
            }
            i = j
        }
        return OpResult(output: String(out), info: n > 0 ? lang.t("合并了 \(n) 处空白", "Collapsed \(n) runs of whitespace") : lang.t("没有连续空白", "No repeated whitespace"))
    }

    // MARK: - 行号 / 前后缀

    public static func addLineNumbers(_ text: String, start: Int = 1, separator: String = ". ", pad: Bool = false, numberEmpty: Bool = true, lang: Lang = .zh) -> OpResult {
        let lines = splitLines(text)
        let total = numberEmpty ? lines.count : lines.filter { !isBlank($0) }.count
        let width = String(start + max(total - 1, 0)).count
        var n = start
        let out = lines.map { l -> String in
            if !numberEmpty, isBlank(l) { return l }
            var num = String(n)
            if pad, num.count < width { num = String(repeating: " ", count: width - num.count) + num }
            n += 1
            return num + separator + l
        }
        return OpResult(output: join(out), info: lang.t("已为 \(total) 行编号", "Numbered \(total) lines"))
    }

    /// 去掉行首的「12. 」「12) 」「12、」「(12) 」「[12] 」「12: 」「12 | 」「12\t」等行号；3.14、12:30、2024-01-01 保持原样
    static let lineNumberRegex = try? NSRegularExpression(pattern:
        "^\\s*(?:[(\u{FF08}]\\d+[)\u{FF09}]|\\[\\d+\\]|\\d+(?=[ \\t]|[.\u{FF0E})\u{FF09}\u{3001}:\u{FF1A}\\]|\u{FF5C}-](?!\\d)))[ \\t]*(?:[.\u{FF0E})\u{FF09}\u{3001}:\u{FF1A}\\]|\u{FF5C}-](?!\\d)[ \\t]*)?")

    public static func removeLineNumbers(_ text: String, lang: Lang = .zh) -> OpResult {
        var n = 0
        let out = splitLines(text).map { l -> String in
            guard let re = lineNumberRegex else { return l }
            let ns = l as NSString
            guard let m = re.firstMatch(in: l, range: NSRange(location: 0, length: ns.length)), m.range.length > 0 else { return l }
            n += 1
            return ns.substring(from: m.range.length)
        }
        return OpResult(output: join(out), info: n > 0 ? lang.t("去除了 \(n) 个行号", "Removed \(n) line numbers") : lang.t("没有识别到行号", "No line numbers found"))
    }

    public static func addPrefixSuffix(_ text: String, prefix: String, suffix: String, skipEmpty: Bool = true, lang: Lang = .zh) -> OpResult {
        var n = 0
        let out = splitLines(text).map { l -> String in
            if skipEmpty, isBlank(l) { return l }
            n += 1
            return prefix + l + suffix
        }
        return OpResult(output: join(out), info: lang.t("处理了 \(n) 行", "Updated \(n) lines"))
    }

    // MARK: - 全角 / 半角、大小写

    /// 全角 ASCII（！到 ～）与全角空格 → 半角
    public static func toHalfWidth(_ text: String, lang: Lang = .zh) -> OpResult {
        var n = 0
        var out = String.UnicodeScalarView()
        for s in text.unicodeScalars {
            if s.value == 0x3000 {
                out.append(" ")
                n += 1
            } else if (0xFF01...0xFF5E).contains(s.value), let h = Unicode.Scalar(s.value - 0xFEE0) {
                out.append(h)
                n += 1
            } else {
                out.append(s)
            }
        }
        return OpResult(output: String(out), info: n > 0 ? lang.t("转换了 \(n) 个字符", "Converted \(n) characters") : lang.t("没有全角字符", "No full-width characters"))
    }

    /// 半角 ASCII 可见字符与空格 → 全角
    public static func toFullWidth(_ text: String, lang: Lang = .zh) -> OpResult {
        var n = 0
        var out = String.UnicodeScalarView()
        for s in text.unicodeScalars {
            if s == " " {
                out.append("\u{3000}")
                n += 1
            } else if (0x21...0x7E).contains(s.value), let f = Unicode.Scalar(s.value + 0xFEE0) {
                out.append(f)
                n += 1
            } else {
                out.append(s)
            }
        }
        return OpResult(output: String(out), info: n > 0 ? lang.t("转换了 \(n) 个字符", "Converted \(n) characters") : lang.t("没有半角字符", "No half-width characters"))
    }

    public enum CaseMode: String, Sendable, CaseIterable { case upper, lower, title, sentence }

    static let sentenceRegex = try? NSRegularExpression(pattern: "(^\\s*|[.!?\u{3002}\u{FF01}\u{FF1F}]\\s+|\\n\\s*)(\\p{Ll})")

    public static func changeCase(_ text: String, _ mode: CaseMode) -> String {
        switch mode {
        case .upper:
            return text.uppercased()
        case .lower:
            return text.lowercased()
        case .title:
            // 每个单词首字母大写，其余小写（撇号后的字母不算新词：don't → Don't）
            var out = ""
            var inWord = false
            for ch in text {
                let wordChar = ch.isLetter || ch.isNumber || ch == "'" || ch == "\u{2019}"
                    || ch.unicodeScalars.first?.properties.generalCategory == .nonspacingMark
                if !inWord, ch.isLetter {
                    out += String(ch).uppercased()
                    inWord = true
                } else if inWord, wordChar {
                    out += String(ch).lowercased()
                } else {
                    out.append(ch)
                    inWord = false
                }
            }
            return out
        case .sentence:
            let lower = text.lowercased()
            guard let re = sentenceRegex else { return lower }
            let ns = lower as NSString
            var out = ""
            var last = 0
            re.enumerateMatches(in: lower, range: NSRange(location: 0, length: ns.length)) { m, _, _ in
                guard let m else { return }
                let letter = m.range(at: 2)
                out += ns.substring(with: NSRange(location: last, length: letter.location - last))
                out += ns.substring(with: letter).uppercased()
                last = letter.location + letter.length
            }
            return out + ns.substring(from: last)
        }
    }

    // MARK: - 提取

    public enum ExtractKind: String, Sendable, CaseIterable { case email, url, number, phone, ip }

    static let ipv4Octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)"
    static let ipv6Pattern: String = {
        let h = "[0-9A-Fa-f]{1,4}"
        return [
            "(?:\(h):){7}\(h)", "(?:\(h):){1,7}:", "(?:\(h):){1,6}:\(h)", "(?:\(h):){1,5}(?::\(h)){1,2}",
            "(?:\(h):){1,4}(?::\(h)){1,3}", "(?:\(h):){1,3}(?::\(h)){1,4}", "(?:\(h):){1,2}(?::\(h)){1,5}",
            "\(h):(?::\(h)){1,6}", ":(?:(?::\(h)){1,7}|:)",
        ].joined(separator: "|")
    }()

    static let extractors: [ExtractKind: NSRegularExpression] = {
        let stop = "\\s<>\"'`\u{FF0C}\u{3002}\u{FF1B}\u{FF01}\u{FF1F}\u{3001}\u{FF09}\u{3011}\u{300B}"
        let patterns: [ExtractKind: (String, NSRegularExpression.Options)] = [
            .email: ("[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}", []),
            // URL 结尾的标点（句号、逗号、右括号、中文标点）通常不属于链接
            .url: ("\\b(?:https?|ftp)://[^\(stop)]+[^\(stop).,;:!?)\\]]", [.caseInsensitive]),
            // 后面紧跟「.数字」的不算（IP 地址、版本号不会被拆成假数字）
            .number: ("(?<![0-9.])-?[0-9]+(?:,[0-9]{3})*(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?(?!\\.?[0-9])", []),
            .phone: ("(?<![0-9])(?:\\+?86[-\\s]?)?1[3-9][0-9](?:[-\\s]?[0-9]{4}){2}(?![0-9])", []),
            .ip: ("(?<![0-9.])\(ipv4Octet)(?:\\.\(ipv4Octet)){3}(?![0-9.]*[0-9])|(?<![0-9A-Fa-f:])(?:\(ipv6Pattern))(?![0-9A-Fa-f:])", []),
        ]
        var out: [ExtractKind: NSRegularExpression] = [:]
        for (k, p) in patterns { out[k] = try? NSRegularExpression(pattern: p.0, options: p.1) }
        return out
    }()

    static func extractLabel(_ kind: ExtractKind, _ lang: Lang) -> String {
        switch kind {
        case .email: lang.t("邮箱", "emails")
        case .url: lang.t("URL", "URLs")
        case .number: lang.t("数字", "numbers")
        case .phone: lang.t("手机号", "phone numbers")
        case .ip: lang.t("IP", "IP addresses")
        }
    }

    public static func extract(_ text: String, kind: ExtractKind, unique: Bool = true, lang: Lang = .zh) -> OpResult {
        guard let re = extractors[kind] else { return OpResult(output: "", info: nil) }
        let ns = text as NSString
        var found = re.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) }
        if kind == .phone {
            // 手机号统一成 11 位纯数字
            found = found.map { p in
                var d = p.replacingOccurrences(of: "-", with: "").filter { !$0.isWhitespace }
                if d.hasPrefix("+86") { d.removeFirst(3) } else if d.hasPrefix("86"), d.count > 11 { d.removeFirst(2) }
                return d
            }
        }
        if kind == .ip {
            // IPv6 候选里去掉 "::"、"dead::beef" 这类不含数字的误报（如 C++ 的 std::vector）
            found = found.filter { !$0.contains(":") || $0.contains(where: { $0.isASCII && $0.isNumber }) }
        }
        var list = found
        if unique {
            var seen = Set<String>()
            list = found.filter { seen.insert($0).inserted }
        }
        let label = extractLabel(kind, lang)
        return OpResult(output: list.joined(separator: "\n"),
                        info: list.isEmpty ? lang.t("没有找到\(label)", "No \(label) found") : lang.t("提取到 \(list.count) 个\(label)", "Found \(list.count) \(label)"))
    }

    // MARK: - 查找替换

    public static func findReplace(_ text: String, find: String, replacement: String, regex: Bool = false, caseSensitive: Bool = false, lang: Lang = .zh) throws -> OpResult {
        if find.isEmpty { return OpResult(output: text, info: lang.t("请输入要查找的内容", "Enter the text to find")) }
        var options: NSRegularExpression.Options = []
        if !caseSensitive { options.insert(.caseInsensitive) }
        if regex { options.insert(.anchorsMatchLines) }
        let re: NSRegularExpression
        do {
            re = try NSRegularExpression(pattern: regex ? find : NSRegularExpression.escapedPattern(for: find), options: options)
        } catch {
            throw ToolError(lang.t("正则表达式无效：", "Invalid regular expression: ") + RegexTester.diagnose(find)(lang))
        }
        // 普通文本模式下替换串按字面量使用（不解析 $1 之类）
        let template = regex ? replacement : replacement.replacingOccurrences(of: "$", with: "$$")
        let r = RegexTester.replace(re, in: text, template: template)
        return OpResult(output: r.output, info: r.count > 0 ? lang.t("替换了 \(r.count) 处", "Replaced \(r.count) matches") : lang.t("没有找到匹配项", "No matches found"))
    }

    // MARK: - 列表转换

    public enum QuoteStyle: String, Sendable, CaseIterable { case none, single, double, backtick }
    public enum Wrap: String, Sendable, CaseIterable { case none, paren, bracket, brace }

    /// 多行 → 逗号列表，如 SQL 的 IN ('a', 'b')
    public static func linesToList(_ text: String, quote: QuoteStyle = .none, separator: String = ", ", wrap: Wrap = .none,
                                   skipEmpty: Bool = true, trimmed: Bool = true, unique: Bool = false, lang: Lang = .zh) -> OpResult {
        var items = splitLines(text).map { trimmed ? trim($0) : $0 }
        if skipEmpty { items = items.filter { !$0.isEmpty } }
        if unique {
            var seen = Set<String>()
            items = items.filter { seen.insert($0).inserted }
        }
        let q: String = switch quote {
        case .none: ""
        case .single: "'"
        case .double: "\""
        case .backtick: "`"
        }
        let quoted = items.map { it -> String in
            if q.isEmpty { return it }
            // 单引号按 SQL 习惯写成 ''，其它引号用反斜杠转义
            let escaped = quote == .single
                ? it.replacingOccurrences(of: "'", with: "''")
                : it.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: q, with: "\\" + q)
            return q + escaped + q
        }
        let (l, r): (String, String) = switch wrap {
        case .none: ("", "")
        case .paren: ("(", ")")
        case .bracket: ("[", "]")
        case .brace: ("{", "}")
        }
        return OpResult(output: l + quoted.joined(separator: separator) + r, info: lang.t("共 \(items.count) 项", "\(items.count) items"))
    }

    /// 逗号（或其它分隔符）列表 → 多行；会去掉外层括号与每项的引号
    public static func listToLines(_ text: String, separator: String = ",", lang: Lang = .zh) -> OpResult {
        var src = trim(text)
        for (l, r) in [("(", ")"), ("[", "]"), ("{", "}")] where src.hasPrefix(l) && src.hasSuffix(r) && src.count >= 2 {
            src = String(src.dropFirst().dropLast())
            break
        }
        if isBlank(src) { return OpResult(output: "", info: lang.t("共 0 项", "0 items")) }
        let items = splitRespectingQuotes(src, separator.isEmpty ? "," : separator).map(unquote)
        return OpResult(output: items.joined(separator: "\n"), info: lang.t("共 \(items.count) 项", "\(items.count) items"))
    }

    static func splitRespectingQuotes(_ src: String, _ sep: String) -> [String] {
        let s = Array(src.unicodeScalars)
        let sepScalars = Array(sep.unicodeScalars)
        var out: [String] = []
        var cur = String.UnicodeScalarView()
        var quote: Unicode.Scalar?
        // 分隔符为 "," 时同时接受中文逗号和换行
        func sepLength(_ i: Int) -> Int {
            if i + sepScalars.count <= s.count, Array(s[i..<(i + sepScalars.count)]) == sepScalars { return sepScalars.count }
            if sep == ",", s[i] == "\u{FF0C}" || s[i] == "\n" { return 1 }
            return 0
        }
        var i = 0
        while i < s.count {
            let ch = s[i]
            if let q = quote {
                cur.append(ch)
                if ch == "\\", i + 1 < s.count {
                    cur.append(s[i + 1])
                    i += 2
                    continue
                }
                if ch == q {
                    if q == "'", i + 1 < s.count, s[i + 1] == "'" {
                        cur.append("'")
                        i += 2
                        continue
                    }
                    quote = nil
                }
                i += 1
                continue
            }
            if ch == "\"" || ch == "'" || ch == "`" {
                quote = ch
                cur.append(ch)
                i += 1
                continue
            }
            let n = sepLength(i)
            if n > 0 {
                out.append(String(cur))
                cur = String.UnicodeScalarView()
                i += n
                continue
            }
            cur.append(ch)
            i += 1
        }
        out.append(String(cur))
        return out.map(trim).filter { !$0.isEmpty }
    }

    static func unquote(_ s: String) -> String {
        let c = Array(s.unicodeScalars)
        guard c.count >= 2, let q = c.first, q == "\"" || q == "'" || q == "`", c.last == q else { return s }
        let inner = String(String.UnicodeScalarView(c[1..<(c.count - 1)]))
        if q == "'" { return inner.replacingOccurrences(of: "''", with: "'").replacingOccurrences(of: "\\'", with: "'") }
        // \x → x
        var out = String.UnicodeScalarView()
        var esc = false
        for u in inner.unicodeScalars {
            if esc {
                out.append(u)
                esc = false
            } else if u == "\\" {
                esc = true
            } else {
                out.append(u)
            }
        }
        if esc { out.append("\\") }
        return String(out)
    }
}
