import Foundation

/// SQL 美化 / 压缩。
///
/// - 美化：交给 App 内置的 sql-formatter（脚本引擎）；MyBatis 风格的 `#{id}` / `${table}` 占位符
///   先换成安全标识符、格式化后再还原；MySQL 的 `DELIMITER` 脚本按语句分段格式化。
/// - 压缩：原生实现，按方言区分的词法扫描器，去掉注释、合并空白成单行，
///   绝不改动字符串、带引号的标识符、美元符引用（$$…$$）与优化器提示（/*+ … */）。
public enum SQLFormatter {
    /// sql-formatter 的方言名
    public enum Dialect: String, Sendable, Hashable, CaseIterable {
        case sql, mysql, mariadb, postgresql, sqlite, tsql, plsql, bigquery, snowflake, spark, hive, redshift, trino, db2

        public var label: LocalizedText {
            switch self {
            case .sql: LocalizedText("标准 SQL", "Standard SQL")
            case .mysql: LocalizedText("MySQL", "MySQL")
            case .mariadb: LocalizedText("MariaDB", "MariaDB")
            case .postgresql: LocalizedText("PostgreSQL", "PostgreSQL")
            case .sqlite: LocalizedText("SQLite", "SQLite")
            case .tsql: LocalizedText("SQL Server (T-SQL)", "SQL Server (T-SQL)")
            case .plsql: LocalizedText("Oracle PL/SQL", "Oracle PL/SQL")
            case .bigquery: LocalizedText("Google BigQuery", "Google BigQuery")
            case .snowflake: LocalizedText("Snowflake", "Snowflake")
            case .spark: LocalizedText("Spark SQL", "Spark SQL")
            case .hive: LocalizedText("Apache Hive", "Apache Hive")
            case .redshift: LocalizedText("Amazon Redshift", "Amazon Redshift")
            case .trino: LocalizedText("Trino / Presto", "Trino / Presto")
            case .db2: LocalizedText("IBM Db2", "IBM Db2")
            }
        }

        var profile: LexProfile {
            switch self {
            case .sql: LexProfile(bsSingle: true)
            case .mysql, .mariadb: .mysqlLike
            case .postgresql: LexProfile(nestedComments: true, dollarQuotes: true, eStrings: true)
            case .redshift, .trino, .db2: LexProfile()
            case .sqlite: LexProfile(bracketIdents: true)
            case .plsql: LexProfile(qQuotes: true)
            case .tsql: LexProfile(nestedComments: true, bracketIdents: true)
            case .bigquery: LexProfile(hashComments: true, bsSingle: true, bsDouble: true, tripleQuotes: true)
            case .hive, .spark: LexProfile(bsSingle: true, bsDouble: true)
            case .snowflake: LexProfile(slashComments: true, bsSingle: true, dollarQuotes: true)
            }
        }

        var isMySQLLike: Bool { self == .mysql || self == .mariadb }
    }

    public enum LetterCase: String, Sendable, Hashable, CaseIterable {
        case preserve, upper, lower
    }

    public struct Options: Sendable, Hashable {
        public var dialect: Dialect
        public var keywordCase: LetterCase
        /// 缩进单位："  "、"    " 或 "\t"
        public var indent: String
        /// 语句之间的空行数（0…5）
        public var linesBetweenQueries: Int

        public init(dialect: Dialect = .mysql, keywordCase: LetterCase = .upper, indent: String = "  ", linesBetweenQueries: Int = 1) {
            self.dialect = dialect
            self.keywordCase = keywordCase
            self.indent = indent
            self.linesBetweenQueries = linesBetweenQueries
        }

        var gapLines: Int { max(0, min(5, linesBetweenQueries)) }
    }

    struct LexProfile {
        /// # 行注释
        var hashComments = false
        /// // 行注释（Snowflake）
        var slashComments = false
        /// MySQL 规则：-- 后必须跟空白才算注释（否则 1--1 是 1 - -1）
        var dashNeedsSpace = false
        /// 块注释可嵌套
        var nestedComments = false
        /// 单引号字符串支持反斜杠转义
        var bsSingle = false
        /// 双引号支持反斜杠转义
        var bsDouble = false
        /// $$…$$ / $tag$…$tag$
        var dollarQuotes = false
        /// [标识符]（T-SQL / SQLite）
        var bracketIdents = false
        /// ''' / """ 三引号字符串（BigQuery）
        var tripleQuotes = false
        /// Oracle 的 q'[…]' 引用
        var qQuotes = false
        /// PostgreSQL 的 E'…' 支持反斜杠转义
        var eStrings = false

        static let mysqlLike = LexProfile(hashComments: true, dashNeedsSpace: true, bsSingle: true, bsDouble: true)
    }

    // MARK: - 词法

    public enum TokenType: String, Sendable, Hashable {
        case ws, comment, hint, string, ident, placeholder, word, punct, op
    }

    public struct Token: Sendable, Hashable {
        public var type: TokenType
        public var text: String
        /// 在原文中的起始位置（按 Unicode 标量计）
        public var start: Int
        /// 字符串 / 注释没有闭合
        public var unterminated: Bool
    }

    static func isWordChar(_ c: Unicode.Scalar) -> Bool {
        FC.isLetter(c.value) || FC.isNumber(c.value) || c == "_" || c == "$" || c == "@"
    }

    /// 按方言把 SQL 切成词法单元；拼回去（text 相加）与原文完全一致
    public static func tokenize(_ sql: String, dialect: Dialect = .sql) -> [Token] {
        tokenize(Array(sql.unicodeScalars), dialect: dialect)
    }

    static func tokenize(_ s: [Unicode.Scalar], dialect: Dialect) -> [Token] {
        let p = dialect.profile
        let n = s.count
        var tokens: [Token] = []
        var i = 0
        func at(_ k: Int) -> Unicode.Scalar? { k >= 0 && k < n ? s[k] : nil }
        func push(_ type: TokenType, _ end: Int, _ unterminated: Bool = false) {
            let e = min(max(end, i + 1), n)
            tokens.append(Token(type: type, text: String(String.UnicodeScalarView(s[i..<e])), start: i, unterminated: unterminated))
            i = e
        }
        func lineEnd(_ from: Int) -> Int {
            var j = from
            while j < n, s[j] != "\n", s[j] != "\r" { j += 1 }
            return j
        }
        func starts(_ q: [Unicode.Scalar], _ k: Int) -> Bool {
            guard k + q.count <= n else { return false }
            for (o, c) in q.enumerated() where s[k + o] != c { return false }
            return true
        }
        func find(_ q: [Unicode.Scalar], _ from: Int, _ limit: Int? = nil) -> Int? {
            var k = from
            let end = Swift.min(limit ?? n, n)
            while k + q.count <= end {
                if starts(q, k) { return k }
                k += 1
            }
            return nil
        }
        /// 引号字符串：'' / "" 双写转义；bs = 反斜杠转义
        func quoted(_ type: TokenType, _ open: Int, _ q: [Unicode.Scalar], _ bs: Bool) {
            var j = open + q.count
            while j < n {
                if bs && s[j] == "\\" {
                    j += 2
                    continue
                }
                if starts(q, j) {
                    if q.count == 1, at(j + 1) == q[0] {
                        j += 2
                        continue
                    }
                    push(type, j + q.count)
                    return
                }
                j += 1
            }
            push(type, n, true)
        }
        while i < n {
            let c = s[i]
            let c2 = at(i + 1)

            // 空白（含全角空格等 Unicode 空白）
            if FC.isJSWhitespace(c) {
                var j = i + 1
                while j < n, FC.isJSWhitespace(s[j]) { j += 1 }
                push(.ws, j)
                continue
            }
            // MyBatis / 模板占位符 #{…} ${…}
            if c == "#" || c == "$", c2 == "{" {
                if let close = find(["}"], i + 2, lineEnd(i)) {
                    push(.placeholder, close + 1)
                    continue
                }
            }
            // 行注释
            let dash = c == "-" && c2 == "-" && (!p.dashNeedsSpace || i + 2 >= n || FC.isJSWhitespace(s[i + 2]))
            if dash || (c == "#" && p.hashComments) || (c == "/" && c2 == "/" && p.slashComments) {
                push(.comment, lineEnd(i))
                continue
            }
            // 块注释（/*+ 优化器提示与 MySQL 的 /*! 可执行注释要保留）
            if c == "/", c2 == "*" {
                let keep = at(i + 2) == "+" || at(i + 2) == "!"
                var depth = 1
                var j = i + 2
                while j < n, depth > 0 {
                    if s[j] == "*", at(j + 1) == "/" {
                        depth -= 1
                        j += 2
                    } else if p.nestedComments, s[j] == "/", at(j + 1) == "*" {
                        depth += 1
                        j += 2
                    } else {
                        j += 1
                    }
                }
                push(keep ? .hint : .comment, j, depth > 0)
                continue
            }
            // 三引号（BigQuery）
            if p.tripleQuotes, starts(["'", "'", "'"], i) || starts(["\"", "\"", "\""], i) {
                quoted(.string, i, [c, c, c], true)
                continue
            }
            if c == "'" {
                var eString = false
                if p.eStrings, let prev = at(i - 1), prev == "e" || prev == "E" {
                    eString = !(at(i - 2).map(isWordChar) ?? false)
                }
                quoted(.string, i, ["'"], p.bsSingle || eString)
                continue
            }
            if c == "\"" { quoted(.ident, i, ["\""], p.bsDouble); continue }
            if c == "`" { quoted(.ident, i, ["`"], false); continue }
            if c == "[", p.bracketIdents { quoted(.ident, i, ["]"], false); continue }
            // 美元符引用 $$…$$ / $tag$…$tag$
            if c == "$", p.dollarQuotes {
                var j = i + 1
                if j < n, s[j].value >= 0x80 || ("A"..."Z").contains(s[j]) || ("a"..."z").contains(s[j]) || s[j] == "_" {
                    j += 1
                    while j < n, j - i < 127, s[j].value >= 0x80 || ("A"..."Z").contains(s[j]) || ("a"..."z").contains(s[j]) || ("0"..."9").contains(s[j]) || s[j] == "_" { j += 1 }
                }
                if j < n, s[j] == "$" {
                    let tag = Array(s[i...j])
                    let close = find(tag, j + 1)
                    push(.string, close.map { $0 + tag.count } ?? n, close == nil)
                    continue
                }
            }
            // Oracle q'[…]'
            if p.qQuotes, !(at(i - 1).map(isWordChar) ?? false) {
                var k = i
                if s[k] == "n" || s[k] == "N" { k += 1 }
                if let q = at(k), q == "q" || q == "Q", at(k + 1) == "'", let open = at(k + 2), !FC.isJSWhitespace(open) {
                    let closeChar: Unicode.Scalar = ["[": "]", "(": ")", "{": "}", "<": ">"][open] ?? open
                    let end = find([closeChar, "'"], k + 3)
                    push(.string, end.map { $0 + 2 } ?? n, end == nil)
                    continue
                }
            }
            if isWordChar(c) || (c == "#" && !p.hashComments) {
                var j = i + 1
                while j < n, isWordChar(s[j]) || (s[j] == "#" && !p.hashComments) { j += 1 }
                push(.word, j)
                continue
            }
            if c == "(" || c == ")" || c == "," || c == ";" || c == "." {
                push(.punct, i + 1)
                continue
            }
            // 其余字符（运算符等）逐个输出
            push(.op, i + 1)
        }
        return tokens
    }

    /// 标量偏移 → 1 起始的行列
    static func lineColumn(_ s: [Unicode.Scalar], _ offset: Int) -> (line: Int, column: Int) {
        var line = 1, col = 1
        var i = 0
        let end = min(max(0, offset), s.count)
        while i < end {
            if s[i] == "\n" {
                line += 1; col = 1
            } else if s[i] == "\r" {
                if i + 1 < end, s[i + 1] == "\n" { i += 1 }
                line += 1; col = 1
            } else {
                col += 1
            }
            i += 1
        }
        return (line, col)
    }

    /// 1 起始的行列 → 标量偏移（只认 \n 换行，与 sql-formatter 一致）
    static func offset(_ s: [Unicode.Scalar], line: Int, column: Int) -> Int {
        var i = 0, l = 1
        while l < line, i < s.count {
            if s[i] == "\n" { l += 1 }
            i += 1
        }
        return min(s.count, i + max(0, column - 1))
    }

    // MARK: - 压缩

    public struct MinifyResult: Sendable, Hashable {
        public var output: String
        public var warnings: [String]
        /// 去掉的注释数量
        public var commentsRemoved: Int
    }

    /// 压缩成单行：去掉注释，连续空白合并成一个空格，括号 / 逗号 / 分号两侧不留空格。
    /// 字符串与带引号的标识符原样保留；必须独占一行的客户端命令（T-SQL 的 GO、
    /// Oracle 的 /、MySQL 的 DELIMITER）保留各自的换行。
    public static func minify(_ sql: String, dialect: Dialect = .sql, lang: Lang = .zh) -> MinifyResult {
        let scalars = Array(sql.unicodeScalars)
        let tokens = tokenize(scalars, dialect: dialect)
        var warnings: [String] = []
        var commentsRemoved = 0
        // 只保留有意义的 token，并记录它前面是否出现过换行
        var sig: [(tok: Token, nlBefore: Bool, gap: Bool)] = []
        var nl = true, gap = false
        for t in tokens {
            if t.unterminated {
                let (line, column) = lineColumn(scalars, t.start)
                let what: LocalizedText
                switch t.type {
                case .comment, .hint: what = LocalizedText("块注释", "block comment")
                case .ident: what = LocalizedText("带引号的标识符", "quoted identifier")
                default: what = LocalizedText("字符串", "string")
                }
                warnings.append(lang.t("第 \(line) 行第 \(column) 列的\(what.zh)没有闭合，之后的内容已原样保留。",
                                       "The \(what.en) at line \(line), column \(column) is not closed; the rest is kept as is."))
            }
            if t.type == .ws {
                if t.text.unicodeScalars.contains(where: { $0 == "\n" || $0 == "\r" }) { nl = true }
                gap = true
                continue
            }
            if t.type == .comment && !t.unterminated {
                commentsRemoved += 1
                gap = true
                continue
            }
            sig.append((t, nl, gap))
            nl = false
            gap = false
        }
        func nlAfter(_ k: Int) -> Bool { k + 1 >= sig.count || sig[k + 1].nlBefore }
        /// 该位置的客户端命令占用的 token 数（0 表示不是）
        func lineCommand(_ k: Int) -> Int {
            let (tok, nlBefore, _) = sig[k]
            guard nlBefore else { return 0 }
            let word = tok.text.uppercased()
            if dialect == .tsql, tok.type == .word, word == "GO" {
                if nlAfter(k) { return 1 }
                if k + 1 < sig.count, sig[k + 1].tok.type == .word, sig[k + 1].tok.text.allSatisfy({ $0.isASCII && $0.isNumber }), nlAfter(k + 1) { return 2 }
            }
            if dialect == .plsql, tok.text == "/", nlAfter(k) { return 1 }
            if dialect.isMySQLLike, tok.type == .word, word == "DELIMITER" {
                var j = k + 1
                while j < sig.count, !sig[j].nlBefore { j += 1 }
                return j - k
            }
            return 0
        }
        let tightAfter: Set<String> = ["(", ","]
        let tightBefore: Set<String> = [")", ",", ";"]
        var out = ""
        var prev: Token?
        var forceBreak = false
        var k = 0
        while k < sig.count {
            let cmd = lineCommand(k)
            if cmd > 0 {
                if !out.isEmpty { out += "\n" }
                for (idx, s) in sig[k..<(k + cmd)].enumerated() { out += (idx > 0 && s.gap ? " " : "") + s.tok.text }
                k += cmd
                prev = nil
                forceBreak = true
                continue
            }
            let (tok, _, hadGap) = sig[k]
            if forceBreak {
                out += "\n"
                forceBreak = false
            } else if let pv = prev, hadGap, !tightAfter.contains(pv.text), !tightBefore.contains(tok.text), pv.text != ";" {
                out += " "
            }
            out += tok.text
            prev = tok
            k += 1
        }
        return MinifyResult(output: out, warnings: warnings, commentsRemoved: commentsRemoved)
    }

    // MARK: - 美化（脚本引擎）

    /// sql-formatter 在部分方言（如 MySQL）里把 IS / NULL / LIKE 等运算符关键字当成普通单词，
    /// 「关键字大写」时它们仍是小写：这里按词法单元补上大小写（跳过字符串、注释与 `a.like` 这类属性访问）。
    static let operatorKeywords: Set<String> = ["IS", "NOT", "NULL", "LIKE", "ILIKE", "RLIKE", "REGEXP", "XOR"]

    public static func applyOperatorKeywordCase(_ sql: String, dialect: Dialect, keywordCase: LetterCase) -> String {
        guard keywordCase != .preserve else { return sql }
        var tokens = tokenize(sql, dialect: dialect)
        var changed = false
        var prevSig: String?
        for k in tokens.indices {
            let t = tokens[k]
            if t.type == .word, operatorKeywords.contains(t.text.uppercased()), prevSig != "." {
                let next = keywordCase == .upper ? t.text.uppercased() : t.text.lowercased()
                if next != t.text {
                    tokens[k].text = next
                    changed = true
                }
            }
            if t.type != .ws && t.type != .comment { prevSig = t.text }
        }
        return changed ? tokens.map(\.text).joined() : sql
    }

    /// 把 #{…} / ${…} 换成不会与原文冲突的标识符，格式化后再换回来
    static func protectPlaceholders(_ sql: String) -> (text: String, restore: (String) -> String) {
        let s = Array(sql.unicodeScalars)
        var found: [String] = []
        var salt = 0
        let bytes = Array(sql.utf8)
        while FC.find(bytes, Array("zqph\(salt)x".utf8), from: 0) != nil { salt += 1 }
        var out = ""
        var i = 0
        while i < s.count {
            if (s[i] == "#" || s[i] == "$"), i + 1 < s.count, s[i + 1] == "{" {
                var j = i + 2
                while j < s.count, s[j] != "{", s[j] != "}", s[j] != "\n" { j += 1 }
                if j < s.count, s[j] == "}" {
                    found.append(String(String.UnicodeScalarView(s[i...j])))
                    out += "zqph\(salt)x\(found.count - 1)q"
                    i = j + 1
                    continue
                }
            }
            out.unicodeScalars.append(s[i])
            i += 1
        }
        guard !found.isEmpty else { return (sql, { $0 }) }
        let marker = "zqph\(salt)x"
        /// ASCII 小写（占位符标记只含 ASCII）
        func lower(_ c: Unicode.Scalar) -> UInt32 { (0x41...0x5A).contains(c.value) ? c.value + 0x20 : c.value }
        let restore: (String) -> String = { formatted in
            let u = Array(formatted.unicodeScalars)
            let m = Array(marker.unicodeScalars)
            var r = ""
            var i = 0
            while i < u.count {
                if lower(u[i]) == 0x7A, i + m.count < u.count, zip(m, u[i..<(i + m.count)]).allSatisfy({ lower($0) == lower($1) }) {
                    var j = i + m.count
                    var digits = ""
                    while j < u.count, ("0"..."9").contains(u[j]) { digits.unicodeScalars.append(u[j]); j += 1 }
                    if !digits.isEmpty, j < u.count, u[j] == "q" || u[j] == "Q", let idx = Int(digits), idx < found.count {
                        r += found[idx]
                        i = j + 1
                        continue
                    }
                }
                r.unicodeScalars.append(u[i])
                i += 1
            }
            return r
        }
        return (out, restore)
    }

    struct DelimiterCommand {
        var start: Int
        var end: Int
        var text: String
        var delimiter: String
    }

    /// 找出 MySQL 客户端的 DELIMITER 命令（跳过字符串与注释里的同名单词）
    static func delimiterCommands(_ s: [Unicode.Scalar], dialect: Dialect) -> [DelimiterCommand] {
        var out: [DelimiterCommand] = []
        var lineStart = true
        for t in tokenize(s, dialect: dialect) {
            if t.type == .ws {
                if t.text.unicodeScalars.contains(where: { $0 == "\n" || $0 == "\r" }) { lineStart = true }
                continue
            }
            if lineStart, t.type == .word, t.text.uppercased() == "DELIMITER" {
                let afterWord = t.start + t.text.unicodeScalars.count
                var end = afterWord
                while end < s.count, s[end] != "\n", s[end] != "\r" { end += 1 }
                // mysql 客户端取 DELIMITER 后的第一个词作为新分隔符
                let rest = String(String.UnicodeScalarView(s[afterWord..<end]))
                if let delimiter = rest.split(whereSeparator: { $0 == " " || $0 == "\t" }).first.map(String.init), !delimiter.isEmpty {
                    let text = String(String.UnicodeScalarView(s[t.start..<end]))
                    out.append(DelimiterCommand(start: t.start, end: end, text: FC.trimTrailingSpace(text), delimiter: delimiter))
                }
            }
            if let last = out.last, last.end > t.start { continue }
            lineStart = false
        }
        return out
    }

    /// 按自定义分隔符切分语句（分隔符出现在字符串、注释、带引号的标识符里时不算）
    static func split(_ piece: [Unicode.Scalar], by delimiter: String, dialect: Dialect) -> [(text: [Unicode.Scalar], start: Int, terminated: Bool)] {
        var shielded = [Bool](repeating: false, count: piece.count)
        for t in tokenize(piece, dialect: dialect) where [.string, .ident, .comment, .hint].contains(t.type) {
            for k in t.start..<min(piece.count, t.start + t.text.unicodeScalars.count) { shielded[k] = true }
        }
        let d = Array(delimiter.unicodeScalars)
        var parts: [(text: [Unicode.Scalar], start: Int, terminated: Bool)] = []
        var from = 0
        var i = 0
        func matches(_ i: Int) -> Bool {
            for k in 0..<d.count where piece[i + k] != d[k] { return false }
            return true
        }
        while i + d.count <= piece.count, !d.isEmpty {
            if !shielded[i], matches(i) {
                parts.append((Array(piece[from..<i]), from, true))
                from = i + d.count
                i = from
            } else {
                i += 1
            }
        }
        parts.append((Array(piece[from...]), from, false))
        return parts.filter { !FC.isJSBlank(String(String.UnicodeScalarView($0.text))) }
    }

    /// 美化 SQL；需要脚本引擎（`ToolEnvironment.script`）。错误带行列与中英文说明。
    public static func format(_ sql: String, options o: Options = Options(), lang: Lang = .zh) throws -> String {
        if FC.isJSBlank(sql) { return "" }
        let s = Array(sql.unicodeScalars)
        if o.dialect.isMySQLLike, sql.range(of: "delimiter", options: .caseInsensitive) != nil {
            let commands = delimiterCommands(s, dialect: o.dialect)
            if !commands.isEmpty { return try formatDelimiterScript(s, o, commands, lang) }
        }
        return try formatPiece(s, o, source: s, base: 0, lang)
    }

    static func engineArgs(_ code: String, _ o: Options) -> [String: String] {
        [
            "code": code,
            "language": o.dialect.rawValue,
            "keywordCase": o.keywordCase.rawValue,
            "tabWidth": o.indent == "    " ? "4" : "2",
            "useTabs": o.indent == "\t" ? "1" : "0",
            "linesBetweenQueries": String(o.gapLines),
        ]
    }

    /// 美化一段 SQL；base 为这段在 source 中的起始偏移（用于报错定位）
    static func formatPiece(_ piece: [Unicode.Scalar], _ o: Options, source: [Unicode.Scalar], base: Int, _ lang: Lang) throws -> String {
        let pieceText = String(String.UnicodeScalarView(piece))
        let (text, restore) = protectPlaceholders(pieceText)
        do {
            let formatted = try ToolEnvironment.runScript("sql", engineArgs(text, o), lang: lang)
            return restore(applyOperatorKeywordCase(formatted, dialect: o.dialect, keywordCase: o.keywordCase))
        } catch var error as ToolError {
            if ToolEnvironment.script == nil { throw error }
            // 占位符替换后的报错位置与原文不同，用原文重新定位一次
            if text != pieceText {
                do {
                    _ = try ToolEnvironment.runScript("sql", engineArgs(pieceText, o), lang: lang)
                } catch let e as ToolError {
                    error = e
                }
            }
            throw describe(error, piece: piece, source: source, base: base, dialect: o.dialect, lang: lang)
        }
    }

    /// 含 DELIMITER 命令的 MySQL 脚本：命令行原样保留，其余部分按当前分隔符切成语句逐条美化
    static func formatDelimiterScript(_ s: [Unicode.Scalar], _ o: Options, _ commands: [DelimiterCommand], _ lang: Lang) throws -> String {
        var blocks: [(text: String, isCommand: Bool)] = []
        var delimiter = ";"
        var pos = 0
        func flush(_ end: Int) throws {
            let piece = Array(s[pos..<end])
            if FC.isJSBlank(String(String.UnicodeScalarView(piece))) { return }
            if delimiter == ";" {
                blocks.append((try formatPiece(piece, o, source: s, base: pos, lang), false))
                return
            }
            for part in split(piece, by: delimiter, dialect: o.dialect) {
                let r = try formatPiece(part.text, o, source: s, base: pos + part.start, lang)
                blocks.append((part.terminated ? r + delimiter : r, false))
            }
        }
        for cmd in commands {
            try flush(cmd.start)
            blocks.append((cmd.text, true))
            delimiter = cmd.delimiter
            pos = cmd.end
        }
        try flush(s.count)
        // DELIMITER 命令紧贴前后的语句，语句之间按「语句间空行」分隔
        let gap = String(repeating: "\n", count: 1 + o.gapLines)
        var out = ""
        for (i, b) in blocks.enumerated() {
            if i > 0 { out += b.isCommand || blocks[i - 1].isCommand ? "\n" : gap }
            out += b.text
        }
        return out
    }

    // MARK: - 错误说明

    /// sql-formatter 按 UTF-16 计列：换算成按码点计
    static func pointColumn(_ s: [Unicode.Scalar], line: Int, unitColumn: Int) -> Int {
        var l = 1, i = 0
        while l < line, i < s.count {
            if s[i] == "\n" { l += 1 }
            i += 1
        }
        var units = 0, col = 1
        while i < s.count, s[i] != "\n", units < unitColumn - 1 {
            units += s[i].utf16.count
            col += 1
            i += 1
        }
        return col
    }

    /// 从 sql-formatter 的英文报错里取出片段：`Parse error: Unexpected "xxx" at line 3 column 5`
    static func match(_ text: String, prefix: String, suffix: String) -> String? {
        guard let a = text.range(of: prefix), let b = text.range(of: suffix, range: a.upperBound..<text.endIndex) else { return nil }
        return String(text[a.upperBound..<b.lowerBound])
    }

    static func describe(_ e: ToolError, piece: [Unicode.Scalar], source: [Unicode.Scalar], base: Int, dialect: Dialect, lang: Lang) -> ToolError {
        let raw = e.message
        var line = e.line, column = e.column
        if let at = raw.range(of: "at line ") {
            let nums = raw[at.upperBound...].split(whereSeparator: { !($0.isASCII && $0.isNumber) }).prefix(2).compactMap { Int($0) }
            if nums.count == 2 {
                line = nums[0]
                column = pointColumn(piece, line: nums[0], unitColumn: nums[1])
            }
        }
        let hint = LocalizedText("当前方言：\(dialect.label.zh)。若语句属于其他数据库，可尝试切换方言。",
                                 "Current dialect: \(dialect.label.en). If the statement is for another database, try switching the dialect.")
        var message: LocalizedText
        if let unexpected = match(raw, prefix: "Parse error: Unexpected \"", suffix: "\" at line") {
            let text = String(unexpected.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" || $0 == "\r\n" }).first ?? "")
            let first = FC.jsTrim(text).first
            if first == "'" || first == "\"" || first == "`" {
                let shown = FC.trimTrailingSpace(text)
                message = LocalizedText("无法识别从这里开始的内容：\(shown)…（字符串或带引号的标识符可能没有闭合）",
                                        "Cannot parse the text starting here: \(shown)… (a string or quoted identifier may be unclosed)")
            } else {
                let word = FC.jsTrim(text).split(whereSeparator: { $0.isWhitespace }).first.map(String.init) ?? ""
                message = LocalizedText("无法识别的内容：\(word)", "Unrecognized text: \(word)")
            }
        } else if let token = match(raw, prefix: "Parse error at token: ", suffix: " at line") {
            switch token {
            case "«EOF»":
                message = LocalizedText("SQL 意外结束：语句不完整，可能缺少右括号或关键字后面的内容",
                                        "Unexpected end of SQL: the statement is incomplete (maybe a closing parenthesis or what follows a keyword is missing)")
            case ")":
                message = LocalizedText("意外的右括号 )：括号不匹配，或括号前的表达式不完整", "Unexpected ): the parentheses do not match, or the expression before it is incomplete")
            case "(":
                message = LocalizedText("意外的左括号 (", "Unexpected (")
            case ",":
                message = LocalizedText("意外的逗号：逗号前后可能缺少内容", "Unexpected comma: something may be missing around it")
            default:
                message = LocalizedText("语法解析失败：此处不应出现 \(token)", "Syntax error: \(token) is not expected here")
            }
        } else if raw.contains("Unsupported SQL dialect") {
            return ToolError(lang.t("不支持的 SQL 方言：\(dialect.rawValue)", "Unsupported SQL dialect: \(dialect.rawValue)"))
        } else {
            let first = raw.split(whereSeparator: { $0 == "\n" || $0 == "\r\n" }).first.map(String.init) ?? raw
            message = LocalizedText("格式化失败：\(first)", "Formatting failed: \(first)")
        }
        var text = message(lang) + lang.t("（\(hint.zh)）", " (\(hint.en))")
        guard let l = line, let c = column else { return ToolError(text) }
        // 换算成整段原文里的行列
        let abs = base + offset(piece, line: l, column: c)
        let (absLine, absColumn) = lineColumn(source, abs)
        text = lang.t("第 \(absLine) 行第 \(absColumn) 列：", "Line \(absLine), column \(absColumn): ") + text
        return ToolError(text, line: absLine, column: absColumn)
    }
}

extension FC {
    static func trimTrailingSpace(_ s: String) -> String {
        var scalars = Substring(s).unicodeScalars
        while let last = scalars.last, isJSWhitespace(last) { scalars.removeLast() }
        return String(scalars)
    }
}
