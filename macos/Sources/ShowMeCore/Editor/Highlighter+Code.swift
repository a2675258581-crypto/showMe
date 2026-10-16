import Foundation

// 可配置的 C 系代码扫描器：关键字 / 类型 / 常量表、行注释与（可嵌套的）块注释、
// 各种字符串（三引号、原始字符串、模板字符串插值）、数字、函数名、注解、JS 正则字面量。

/// 字符串插值的写法
struct Interpolation: Sendable {
    var dollarBrace = false     // ${expr}：JS 模板、Kotlin、Dart
    var backslashParen = false  // \(expr)：Swift
    var hashBrace = false       // #{expr}：Ruby
    var dollarName = false      // $name：Kotlin、Dart、PHP

    static let none = Interpolation()
    var isEnabled: Bool { dollarBrace || backslashParen || hashBrace || dollarName }
}

struct CodeConfig: Sendable {
    enum Backtick: Sendable {
        case none
        /// JS 模板字符串：多行、可插值
        case template
        /// Go 原始字符串：多行、无转义
        case raw
        /// 反引号标识符（Kotlin / Swift / SQL）；kind 为 nil 时不着色
        case identifier(HighlightKind?)
    }

    enum At: Sendable {
        case none
        /// 注解 / 装饰器：@Override、@property
        case meta
        /// Objective-C：@interface、@"字符串"
        case keyword
        /// 变量：Ruby @ivar、SQL @var
        case variable
    }

    enum Hash: Sendable {
        case none
        /// C 预处理指令：行首 #include
        case preprocessor
        /// Rust 属性：#[derive(Debug)]
        case rustAttribute
        /// Swift：#if、#available、#"原始字符串"#
        case swift
        /// JS 私有字段：#count
        case privateField
    }

    var words: WordTable
    /// 引导词：def / func / fn 之后的名字是函数，class / struct 之后是类型
    var introducers = WordTable.empty
    var lineComments: [[UInt16]] = [Ch.units("//")]
    var blockComment: (open: [UInt16], close: [UInt16])? = (Ch.units("/*"), Ch.units("*/"))
    var nestedComments = false
    var singleQuoteStrings = true
    /// Rust：'a' 是字符，'a 是生命周期
    var rustChars = false
    /// 普通双引号字符串可跨行
    var multilineStrings = false
    var backtick: Backtick = .none
    var tripleQuotes = false
    var stringInterpolation = Interpolation.none
    /// 单引号字符串也插值（Dart）
    var interpolateSingleQuotes = false
    /// 字符串前缀：Python f"…"、Dart r'…'、C++ u8"…"
    var stringPrefixes: Set<String> = []
    /// 原始字符串前缀：C++ R"(…)"、Rust r#"…"#
    var rawPrefixes: Set<String> = []
    var prefixesCaseInsensitive = false
    var swiftRawStrings = false
    var rustRawStrings = false
    var cppRawStrings = false
    var csharpStrings = false
    var at: At = .meta
    var hash: Hash = .none
    /// $name 是变量（PHP、GraphQL、SQL 的 $1）
    var dollarVariables = false
    /// $ 可出现在标识符里（JS）
    var dollarInIdentifiers = false
    /// Postgres 的 $$…$$ 字符串
    var dollarQuotes = false
    var regexLiterals = false
    var capitalizedTypes = true
    /// R：标识符里可以有点（is.na）
    var dotInIdentifiers = false
    /// Ruby：标识符可以 ? / ! 结尾（empty?、save!）
    var rubyIdentifierSuffix = false
    /// Ruby :symbol
    var rubySymbols = false
    var rustMacros = false
    var luaLongBrackets = false
    var phpTags = false
    /// -> 是成员访问（C / C++ / PHP），之后的名字按属性处理；Swift / Rust / Python 里它是返回类型箭头
    var arrowMemberAccess = false
}

extension Lexer {
    /// C 系主循环。closer 非 0 时用于字符串插值内部：遇到未配对的 closer 即返回其位置。
    mutating func scanCode(_ cfg: CodeConfig, from start: Int, closer: UInt16 = 0) -> Int {
        let opener: UInt16 = closer == Ch.rbrace ? Ch.lbrace : (closer == Ch.rparen ? Ch.lparen : 0)
        var i = start
        var nest = 0
        var regexOK = true
        var afterDot = false
        var pendingIntro: HighlightKind? = nil
        var lineStart = true
        /// 本行已有一次正则扫描到行尾都没闭合，之后不再尝试（避免长行退化成平方复杂度）
        var noRegexBefore = -1

        while i < end {
            let c = b[i]
            if c == Ch.lf || c == Ch.cr { lineStart = true; i += 1; continue }
            if c == Ch.space || c == Ch.tab || c == Ch.ff || c == Ch.vt { i += 1; continue }
            let atLineStart = lineStart
            lineStart = false

            if closer != 0 {
                if c == opener {
                    nest += 1
                } else if c == closer {
                    if nest == 0 { return i }
                    nest -= 1
                }
            }

            // 注释
            if cfg.luaLongBrackets, c == Ch.minus, at(i + 1) == Ch.minus, let level = longBracketLevel(i + 2) {
                let j = longBracketEnd(i + 2, level: level)
                emit(i, j, .comment)
                i = j
                continue
            }
            // Ruby 的 =begin 只认行首
            if let bc = cfg.blockComment, c == bc.open[0], hasPrefix(i, bc.open), c != Ch.equal || atLineStart {
                let j = blockCommentEnd(i, open: bc.open, close: bc.close, nested: cfg.nestedComments)
                emit(i, j, .comment)
                i = j
                continue
            }
            var isLineComment = false
            for lc in cfg.lineComments where c == lc[0] && hasPrefix(i, lc) {
                isLineComment = true
                break
            }
            if isLineComment {
                let j = lineEnd(i)
                emit(i, j, .comment)
                i = j
                continue
            }

            // 字符串
            if c == Ch.dquote {
                i = scanCodeString(cfg, tokenStart: i, quoteAt: i)
                regexOK = false; afterDot = false; pendingIntro = nil
                continue
            }
            if c == Ch.squote && cfg.singleQuoteStrings {
                if cfg.rustChars {
                    i = scanRustQuote(i)
                } else {
                    i = scanCodeString(cfg, tokenStart: i, quoteAt: i)
                }
                regexOK = false; afterDot = false; pendingIntro = nil
                continue
            }
            if c == Ch.backtick {
                switch cfg.backtick {
                case .none:
                    break
                case .template:
                    i = scanString(tokenStart: i, quoteAt: i, quote: Ch.backtick, triple: false, raw: false, multiline: true,
                                   interp: Interpolation(dollarBrace: true), cfg: cfg)
                    regexOK = false; afterDot = false; pendingIntro = nil
                    continue
                case .raw:
                    let j = quotedEnd(i, quote: Ch.backtick, escapes: false, multiline: true)
                    emit(i, j, .string)
                    i = j
                    regexOK = false; afterDot = false; pendingIntro = nil
                    continue
                case .identifier(let kind):
                    let j = quotedEnd(i, quote: Ch.backtick, escapes: false, multiline: false)
                    if let kind { emit(i, j, kind) }
                    i = j
                    regexOK = false; afterDot = false; pendingIntro = nil
                    continue
                }
            }
            if cfg.luaLongBrackets, c == Ch.lbracket, let level = longBracketLevel(i) {
                let j = longBracketEnd(i, level: level)
                emit(i, j, .string)
                i = j
                regexOK = false
                continue
            }

            // 数字
            if isDigit(c) || (c == Ch.dot && isDigit(at(i + 1)) && !isIdentPart(at(i - 1))) {
                let j = numberEnd(i)
                emit(i, j, .number)
                i = j
                regexOK = false; afterDot = false; pendingIntro = nil
                continue
            }

            // 标识符 / 关键字
            if isIdentStart(c) || (c == Ch.dollar && cfg.dollarInIdentifiers) {
                var j = i + 1
                while j < end {
                    let d = b[j]
                    if isIdentPart(d) || (d == Ch.dollar && cfg.dollarInIdentifiers)
                        || (d == Ch.dot && cfg.dotInIdentifiers && isIdentPart(at(j + 1))) {
                        j += 1
                    } else {
                        break
                    }
                }
                if cfg.rubyIdentifierSuffix, at(j) == Ch.question || at(j) == Ch.excl, at(j + 1) != Ch.equal {
                    j += 1
                }
                if let k = prefixedString(cfg, i, j) {
                    i = k
                    regexOK = false; afterDot = false; pendingIntro = nil
                    continue
                }
                let next = at(j)
                var kind: HighlightKind? = nil
                var isKeyword = false
                let entry = cfg.words.lookup(b, i, j)
                if afterDot {
                    kind = next == Ch.lparen ? .function : .property
                } else if let entry, !(entry.soft && (pendingIntro != nil || next == Ch.lparen)) {
                    kind = entry.kind
                    isKeyword = entry.kind == .keyword
                } else if let intro = pendingIntro {
                    kind = intro
                } else if next == Ch.lparen {
                    kind = .function
                } else if cfg.rustMacros, next == Ch.excl,
                          at(j + 1) == Ch.lparen || at(j + 1) == Ch.lbracket || at(j + 1) == Ch.lbrace {
                    emit(i, j + 1, .function)
                    i = j + 1
                    regexOK = true; afterDot = false; pendingIntro = nil
                    continue
                } else if cfg.capitalizedTypes {
                    kind = capitalizedKind(i, j)
                }
                if let kind { emit(i, j, kind) }
                pendingIntro = isKeyword ? cfg.introducers.lookup(b, i, j)?.kind : nil
                regexOK = isKeyword
                afterDot = false
                i = j
                continue
            }

            // 其余符号
            switch c {
            case Ch.at:
                if let j = scanAt(cfg, i) {
                    i = j
                    regexOK = false; afterDot = false; pendingIntro = nil
                    continue
                }
            case Ch.hash:
                if let j = scanHash(cfg, i, atLineStart: atLineStart) {
                    i = j
                    regexOK = true; afterDot = false; pendingIntro = nil
                    continue
                }
            case Ch.dollar:
                if let j = scanDollar(cfg, i) {
                    i = j
                    regexOK = false; afterDot = false; pendingIntro = nil
                    continue
                }
            case Ch.colon where cfg.rubySymbols:
                if isIdentStart(at(i + 1)) && at(i - 1) != Ch.colon && !isIdentPart(at(i - 1)) {
                    var j = identEnd(i + 1)
                    if at(j) == Ch.question || at(j) == Ch.excl { j += 1 }
                    emit(i, j, .constant)
                    i = j
                    regexOK = false; afterDot = false; pendingIntro = nil
                    continue
                }
            case Ch.lt where cfg.phpTags:
                if hasPrefixCI(i, CodeConfig.phpOpen) {
                    emit(i, i + 5, .meta); i += 5; continue
                }
                if hasPrefix(i, CodeConfig.phpEcho) {
                    emit(i, i + 3, .meta); i += 3; continue
                }
            case Ch.question where cfg.phpTags:
                if at(i + 1) == Ch.gt {
                    emit(i, i + 2, .meta); i += 2; continue
                }
            case Ch.slash where cfg.regexLiterals && regexOK && i >= noRegexBefore:
                switch regexScan(i) {
                case .regex(let j):
                    emit(i, j, .regex)
                    i = j
                    regexOK = false; afterDot = false; pendingIntro = nil
                    continue
                case .unterminated:
                    noRegexBefore = lineEnd(i)
                case .notRegex:
                    break
                }
            default:
                break
            }

            if c == Ch.dot {
                if at(i + 1) == Ch.dot {
                    var j = i
                    while at(j) == Ch.dot { j += 1 }
                    emit(i, j, .operator)
                    i = j
                    regexOK = true; afterDot = false; pendingIntro = nil
                    continue
                }
                afterDot = true
                regexOK = true
                pendingIntro = nil
                i += 1
                continue
            }

            if isOperatorChar(c) {
                // 运算符连成一段；段中的 / 留给下一轮判断注释
                var j = i + 1
                while j < end && isOperatorChar(b[j]) && b[j] != Ch.slash { j += 1 }
                emit(i, j, .operator)
                afterDot = cfg.arrowMemberAccess && j - i >= 2 && b[j - 1] == Ch.gt && b[j - 2] == Ch.minus
                regexOK = true
                pendingIntro = nil
                i = j
                continue
            }

            // 括号、逗号、分号等
            regexOK = !(c == Ch.rparen || c == Ch.rbracket || c == Ch.rbrace)
            afterDot = false
            pendingIntro = nil
            i += 1
        }
        return i
    }

    @inline(__always) func isOperatorChar(_ c: UInt16) -> Bool {
        switch c {
        case Ch.plus, Ch.minus, Ch.star, Ch.slash, Ch.percent, Ch.equal, Ch.lt, Ch.gt, Ch.excl, Ch.amp, Ch.pipe,
             Ch.caret, Ch.tilde, Ch.question, Ch.colon:
            return true
        default:
            return false
        }
    }

    /// 首字母大写 → 类型；全大写（含下划线 / 数字，或较长）→ 常量
    func capitalizedKind(_ s: Int, _ e: Int) -> HighlightKind? {
        guard isUpper(b[s]) else { return nil }
        var hasLower = false
        var hasUnderscoreOrDigit = false
        for k in s..<e {
            let c = b[k]
            if isLower(c) { hasLower = true; break }
            if c == Ch.underscore || isDigit(c) { hasUnderscoreOrDigit = true }
        }
        if hasLower { return .type }
        if e - s >= 2 && (hasUnderscoreOrDigit || e - s >= 5) { return .constant }
        return .type
    }

    // MARK: 字符串

    /// 普通双 / 单引号字符串（含三引号）
    mutating func scanCodeString(_ cfg: CodeConfig, tokenStart: Int, quoteAt q: Int) -> Int {
        let quote = b[q]
        let triple = cfg.tripleQuotes && at(q + 1) == quote && at(q + 2) == quote
        let interp = (quote == Ch.dquote || cfg.interpolateSingleQuotes) ? cfg.stringInterpolation : .none
        return scanString(tokenStart: tokenStart, quoteAt: q, quote: quote, triple: triple, raw: false,
                          multiline: cfg.multilineStrings, interp: interp, cfg: cfg)
    }

    /// 通用字符串扫描。hashes：Swift 原始字符串的 # 个数；doubled：C# 逐字字符串里 "" 表示引号。
    mutating func scanString(
        tokenStart: Int, quoteAt q: Int, quote: UInt16, triple: Bool, raw: Bool, multiline: Bool,
        interp: Interpolation, cfg: CodeConfig, hashes: Int = 0, doubled: Bool = false
    ) -> Int {
        var j = q + (triple ? 3 : 1)
        var segStart = tokenStart
        let canInterpolate = interp.isEnabled && !raw && depth < 12
        let singleLine = !multiline && !triple
        while j < end {
            let c = b[j]
            if c == quote {
                if doubled && at(j + 1) == quote { j += 2; continue }
                var close = j + 1
                if triple {
                    guard at(j + 1) == quote, at(j + 2) == quote else { j += 1; continue }
                    close = j + 3
                    // """" 结尾：多余的引号归入内容
                    while at(close) == quote && hashes == 0 { close += 1 }
                }
                if hashes > 0 {
                    var k = 0
                    while k < hashes && at(close + k) == Ch.hash { k += 1 }
                    guard k == hashes else { j += 1; continue }
                    close += hashes
                }
                emit(segStart, close, .string)
                return close
            }
            if c == Ch.backslash && !raw {
                let n = at(j + 1)
                if canInterpolate && interp.backslashParen && n == Ch.lparen {
                    if let k = interpolate(cfg, segStart: segStart, at: j, openLength: 2, closer: Ch.rparen, singleLine: singleLine) {
                        j = k; segStart = k; continue
                    }
                    return lineOrEnd(j, singleLine)
                }
                j += (n == Ch.cr && at(j + 2) == Ch.lf) ? 3 : 2
                continue
            }
            if canInterpolate {
                if (c == Ch.dollar && interp.dollarBrace && at(j + 1) == Ch.lbrace)
                    || (c == Ch.hash && interp.hashBrace && at(j + 1) == Ch.lbrace) {
                    if let k = interpolate(cfg, segStart: segStart, at: j, openLength: 2, closer: Ch.rbrace, singleLine: singleLine) {
                        j = k; segStart = k; continue
                    }
                    return lineOrEnd(j, singleLine)
                }
                if c == Ch.dollar && interp.dollarName && isIdentStart(at(j + 1)) {
                    var k = j + 1
                    while k < end && isIdentPart(b[k]) { k += 1 }
                    emit(segStart, j, .string)
                    emit(j, k, .variable)
                    j = k; segStart = k
                    continue
                }
            }
            if singleLine && (c == Ch.lf || c == Ch.cr) {
                emit(segStart, j, .string)
                return j
            }
            j += 1
        }
        emit(segStart, end, .string)
        return end
    }

    private mutating func lineOrEnd(_ j: Int, _ singleLine: Bool) -> Int {
        singleLine ? memoLineEnd(j) : end
    }

    /// 插值：字符串片段 → 开符号 → 内部代码 → 闭符号。成功返回闭符号之后的位置。
    private mutating func interpolate(
        _ cfg: CodeConfig, segStart: Int, at j: Int, openLength: Int, closer: UInt16, singleLine: Bool
    ) -> Int? {
        emit(segStart, j, .string)
        emit(j, j + openLength, .punctuation)
        let saved = end
        if singleLine { end = memoLineEnd(j) }
        depth += 1
        let k = scanCode(cfg, from: j + openLength, closer: closer)
        depth -= 1
        let found = k < end && b[k] == closer
        end = saved
        guard found else { return nil }
        emit(k, k + 1, .punctuation)
        return k + 1
    }

    /// Rust：'a'、'\n' 是字符，'a 是生命周期
    private mutating func scanRustQuote(_ i: Int) -> Int {
        let n = at(i + 1)
        if n == Ch.backslash {
            let j = quotedEnd(i, quote: Ch.squote)
            emit(i, j, .string)
            return j
        }
        if n != 0 && n != Ch.squote && !isNewline(n) && at(i + 2) == Ch.squote {
            emit(i, i + 3, .string)
            return i + 3
        }
        if n >= 0xD800 && n <= 0xDBFF && at(i + 3) == Ch.squote {
            emit(i, i + 4, .string)
            return i + 4
        }
        if isIdentStart(n) {
            let j = identEnd(i + 1)
            emit(i, j, .variable)
            return j
        }
        let j = quotedEnd(i, quote: Ch.squote)
        emit(i, j, .string)
        return j
    }

    /// 标识符 [s, e) 后紧跟引号且是合法前缀时，扫描带前缀的字符串
    private mutating func prefixedString(_ cfg: CodeConfig, _ s: Int, _ e: Int) -> Int? {
        let next = at(e)
        guard e - s <= 3, next == Ch.dquote || next == Ch.squote || next == Ch.hash else { return nil }
        if cfg.stringPrefixes.isEmpty && cfg.rawPrefixes.isEmpty { return nil }
        var word = string(s, e)
        if cfg.prefixesCaseInsensitive { word = word.lowercased() }

        if cfg.rustRawStrings && cfg.rawPrefixes.contains(word) && (next == Ch.dquote || next == Ch.hash) {
            var k = e
            while at(k) == Ch.hash { k += 1 }
            guard at(k) == Ch.dquote else { return nil }
            return scanString(tokenStart: s, quoteAt: k, quote: Ch.dquote, triple: false, raw: true, multiline: true,
                              interp: .none, cfg: cfg, hashes: k - e)
        }
        if cfg.cppRawStrings && cfg.rawPrefixes.contains(word) && next == Ch.dquote {
            // R"delim( … )delim"
            var k = e + 1
            while k < end && k - e <= 17 && b[k] != Ch.lparen && !isSpaceOrNewline(b[k]) && b[k] != Ch.dquote { k += 1 }
            guard at(k) == Ch.lparen else { return nil }
            var closing: [UInt16] = [Ch.rparen]
            closing.append(contentsOf: b[(e + 1)..<k])
            closing.append(Ch.dquote)
            let close = find(closing, from: k + 1, limit: end).map { $0 + closing.count } ?? end
            emit(s, close, .string)
            return close
        }
        guard next != Ch.hash, cfg.stringPrefixes.contains(word) || cfg.rawPrefixes.contains(word) else { return nil }
        if next == Ch.squote && !cfg.singleQuoteStrings && !cfg.rustChars {
            return nil
        }
        let raw = cfg.rawPrefixes.contains(word)
        let quote = next
        let triple = cfg.tripleQuotes && at(e + 1) == quote && at(e + 2) == quote
        let interp = (quote == Ch.dquote || cfg.interpolateSingleQuotes) && !raw ? cfg.stringInterpolation : .none
        return scanString(tokenStart: s, quoteAt: e, quote: quote, triple: triple, raw: raw,
                          multiline: cfg.multilineStrings, interp: interp, cfg: cfg)
    }

    // MARK: @ # $

    private mutating func scanAt(_ cfg: CodeConfig, _ i: Int) -> Int? {
        let n = at(i + 1)
        if cfg.csharpStrings {
            // @"逐字字符串"、@$"…"
            if n == Ch.dquote {
                return scanString(tokenStart: i, quoteAt: i + 1, quote: Ch.dquote, triple: false, raw: true, multiline: true,
                                  interp: .none, cfg: cfg, doubled: true)
            }
            if n == Ch.dollar && at(i + 2) == Ch.dquote {
                return scanString(tokenStart: i, quoteAt: i + 2, quote: Ch.dquote, triple: false, raw: true, multiline: true,
                                  interp: .none, cfg: cfg, doubled: true)
            }
            return nil
        }
        switch cfg.at {
        case .none:
            return nil
        case .meta:
            guard isIdentStart(n) else { return nil }
            var j = identEnd(i + 1)
            while at(j) == Ch.dot && isIdentStart(at(j + 1)) { j = identEnd(j + 1) }
            emit(i, j, .meta)
            return j
        case .keyword:
            if n == Ch.dquote {
                return scanString(tokenStart: i, quoteAt: i + 1, quote: Ch.dquote, triple: false, raw: false,
                                  multiline: false, interp: .none, cfg: cfg)
            }
            guard isIdentStart(n) else { return nil }
            let j = identEnd(i + 1)
            emit(i, j, .keyword)
            return j
        case .variable:
            var k = i + 1
            if at(k) == Ch.at { k += 1 }
            guard isIdentStart(at(k)) else { return nil }
            let j = identEnd(k)
            emit(i, j, .variable)
            return j
        }
    }

    private mutating func scanHash(_ cfg: CodeConfig, _ i: Int, atLineStart: Bool) -> Int? {
        switch cfg.hash {
        case .none:
            return nil
        case .preprocessor:
            guard atLineStart else { return nil }
            let k = skipBlanks(i + 1, end)
            let j = identEnd(k)
            emit(i, j, .meta)
            // #include <stdio.h>
            if equals(k, j, "include") || equals(k, j, "import") || equals(k, j, "include_next") {
                let p = skipBlanks(j, end)
                if at(p) == Ch.lt {
                    let le = lineEnd(p)
                    var q = p + 1
                    while q < le && b[q] != Ch.gt { q += 1 }
                    if q < le {
                        emit(p, q + 1, .string)
                        return q + 1
                    }
                }
            }
            return j
        case .rustAttribute:
            var k = i + 1
            if at(k) == Ch.excl { k += 1 }
            guard at(k) == Ch.lbracket else { return nil }
            var level = 0
            var j = k
            while j < end {
                let c = b[j]
                if c == Ch.lbracket { level += 1 }
                else if c == Ch.rbracket {
                    level -= 1
                    if level == 0 { j += 1; break }
                } else if c == Ch.dquote {
                    j = quotedEnd(j, quote: Ch.dquote, multiline: true)
                    continue
                }
                j += 1
            }
            emit(i, j, .meta)
            return j
        case .swift:
            // #"原始字符串"#、##"…"##
            var k = i
            while at(k) == Ch.hash { k += 1 }
            if at(k) == Ch.dquote {
                let hashes = k - i
                let triple = at(k + 1) == Ch.dquote && at(k + 2) == Ch.dquote
                return scanString(tokenStart: i, quoteAt: k, quote: Ch.dquote, triple: triple, raw: true, multiline: false,
                                  interp: .none, cfg: cfg, hashes: hashes)
            }
            guard k == i + 1, isIdentStart(at(k)) else { return nil }
            let j = identEnd(k)
            emit(i, j, .meta)
            return j
        case .privateField:
            guard isIdentStart(at(i + 1)) else { return nil }
            let j = identEnd(i + 1)
            emit(i, j, .property)
            return j
        }
    }

    private mutating func scanDollar(_ cfg: CodeConfig, _ i: Int) -> Int? {
        let n = at(i + 1)
        if cfg.csharpStrings {
            if n == Ch.dquote {
                let triple = at(i + 2) == Ch.dquote && at(i + 3) == Ch.dquote
                return scanString(tokenStart: i, quoteAt: i + 1, quote: Ch.dquote, triple: triple, raw: false,
                                  multiline: false, interp: .none, cfg: cfg)
            }
            if n == Ch.at && at(i + 2) == Ch.dquote {
                return scanString(tokenStart: i, quoteAt: i + 2, quote: Ch.dquote, triple: false, raw: true, multiline: true,
                                  interp: .none, cfg: cfg, doubled: true)
            }
            return nil
        }
        if cfg.dollarQuotes {
            // $$…$$、$tag$…$tag$
            var k = i + 1
            while k < end && (isASCIIAlnum(b[k]) || b[k] == Ch.underscore) && !isDigit(b[i + 1]) { k += 1 }
            if at(k) == Ch.dollar {
                let delim = Array(b[i...k])
                let close = find(delim, from: k + 1, limit: end).map { $0 + delim.count } ?? end
                emit(i, close, .string)
                return close
            }
        }
        if cfg.dollarVariables && (isIdentStart(n) || isDigit(n)) {
            let j = identEnd(i + 1)
            emit(i, j, .variable)
            return j
        }
        return nil
    }

    // MARK: 正则 / Lua 长括号

    private enum RegexScan {
        case regex(Int)
        case notRegex
        /// 扫到行尾（或长度上限）也没闭合
        case unterminated
    }

    /// JS 正则字面量 /…/flags；同一行内没闭合就不算
    private func regexScan(_ i: Int) -> RegexScan {
        let n = at(i + 1)
        if n == Ch.space || (n == Ch.equal && at(i + 2) == Ch.space) { return .notRegex }
        var j = i + 1
        var inClass = false
        let limit = min(end, i + 4096)
        while j < limit {
            let c = b[j]
            if c == Ch.lf || c == Ch.cr { return .unterminated }
            if c == Ch.backslash { j += 2; continue }
            if c == Ch.lbracket {
                inClass = true
            } else if c == Ch.rbracket {
                inClass = false
            } else if c == Ch.slash && !inClass {
                j += 1
                while j < end && isASCIILetter(b[j]) { j += 1 }
                return .regex(j)
            }
            j += 1
        }
        return .unterminated
    }

    /// [[ 或 [==[ 的等号个数；不是长括号返回 nil
    func longBracketLevel(_ i: Int) -> Int? {
        guard at(i) == Ch.lbracket else { return nil }
        var k = i + 1
        while at(k) == Ch.equal { k += 1 }
        return at(k) == Ch.lbracket ? k - i - 1 : nil
    }

    func longBracketEnd(_ i: Int, level: Int) -> Int {
        var close: [UInt16] = [Ch.rbracket]
        close.append(contentsOf: repeatElement(Ch.equal, count: level))
        close.append(Ch.rbracket)
        let start = i + level + 2
        return find(close, from: start, limit: end).map { $0 + close.count } ?? end
    }
}

// MARK: - 各语言配置

extension CodeConfig {
    static let phpOpen = Ch.units("<?php")
    static let phpEcho = Ch.units("<?=")

    static func forLanguage(_ id: String) -> CodeConfig? {
        switch id {
        case "javascript": return javascript
        case "typescript": return typescript
        case "python": return python
        case "go": return go
        case "java": return java
        case "kotlin": return kotlin
        case "swift": return swift
        case "rust": return rust
        case "c": return c
        case "cpp": return cpp
        case "objective-c": return objc
        case "csharp": return csharp
        case "php": return php
        case "ruby": return ruby
        case "lua": return lua
        case "dart": return dart
        case "scala": return scala
        case "r": return r
        case "sql": return sql
        case "graphql": return graphql
        default: return nil
        }
    }

    private static let jsKeywords = """
        break case catch class const continue debugger default delete do else export extends finally for function if \
        import in instanceof let new return super switch this throw try typeof var void while with yield async await
        """
    private static let jsSoft = "of get set static from as"
    private static let jsConstants = "true false null undefined NaN Infinity"

    static let javascript: CodeConfig = {
        var c = CodeConfig(words: WordTable([(.keyword, jsKeywords), (.constant, jsConstants)], soft: jsSoft))
        c.introducers = WordTable([(.function, "function"), (.type, "class extends")])
        c.backtick = .template
        c.regexLiterals = true
        c.hash = .privateField
        c.dollarInIdentifiers = true
        return c
    }()

    static let typescript: CodeConfig = {
        var c = javascript
        c.words = WordTable([
            (.keyword, jsKeywords + " enum implements interface private protected public readonly abstract declare namespace"
                + " module keyof infer is asserts satisfies override type"),
            (.type, "any unknown never string number boolean symbol bigint object"),
            (.constant, jsConstants),
        ], soft: jsSoft + " unique accessor")
        c.introducers = WordTable([(.function, "function"), (.type, "class interface type enum extends implements namespace")])
        return c
    }()

    static let python: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                and as assert async await break class continue def del elif else except finally for from global if import \
                in is lambda nonlocal not or pass raise return try while with yield
                """),
            (.type, "int float str bytes bool list dict set tuple object complex frozenset bytearray memoryview"),
            (.constant, "True False None NotImplemented Ellipsis __name__ __file__"),
            (.variable, "self cls"),
        ], soft: "match case type print"))
        c.introducers = WordTable([(.function, "def"), (.type, "class")])
        c.lineComments = [Ch.units("#")]
        c.blockComment = nil
        c.tripleQuotes = true
        c.stringPrefixes = ["r", "u", "b", "f", "br", "rb", "fr", "rf", "t", "tr", "rt"]
        c.prefixesCaseInsensitive = true
        return c
    }()

    static let go: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                break case chan const continue default defer else fallthrough for func go goto if import interface map \
                package range return select struct switch type var
                """),
            (.type, """
                bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 \
                uint16 uint32 uint64 uintptr any comparable
                """),
            (.constant, "true false nil iota"),
        ]))
        c.introducers = WordTable([(.function, "func"), (.type, "type")])
        c.backtick = .raw
        c.at = .none
        return c
    }()

    static let java: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                abstract assert break case catch class const continue default do else enum extends final finally for goto \
                if implements import instanceof interface native new package private protected public return static \
                strictfp super switch synchronized this throw throws transient try volatile while var record sealed \
                permits yield
                """),
            (.type, "boolean byte char double float int long short void"),
            (.constant, "true false null"),
        ]))
        c.introducers = WordTable([(.type, "class interface enum record extends implements")])
        c.tripleQuotes = true
        return c
    }()

    static let kotlin: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                as break class continue do else for fun if in interface is object package return super this throw try \
                typealias typeof val var when while by catch constructor finally import init where abstract actual \
                annotation companion const crossinline data enum expect external final infix inline inner internal \
                lateinit noinline open operator out override private protected public reified sealed suspend tailrec \
                vararg
                """),
            (.constant, "true false null"),
        ], soft: "get set field value"))
        c.introducers = WordTable([(.function, "fun"), (.type, "class interface object typealias")])
        c.tripleQuotes = true
        c.stringInterpolation = Interpolation(dollarBrace: true, dollarName: true)
        c.backtick = .identifier(nil)
        return c
    }()

    static let swift: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                associatedtype class deinit enum extension fileprivate func import init inout internal let open operator \
                private precedencegroup protocol public rethrows static struct subscript typealias var break case catch \
                continue default defer do else fallthrough for guard if in repeat return throw switch where while as is \
                super self Self throws try async await actor nonisolated isolated some any macro package convenience \
                dynamic final lazy mutating nonmutating optional override required unowned weak indirect consume \
                borrowing consuming sending
                """),
            (.type, "Any AnyObject"),
            (.constant, "true false nil"),
        ], soft: "get set willSet didSet"))
        c.introducers = WordTable([
            (.function, "func"),
            (.type, "class struct enum protocol extension actor typealias associatedtype"),
        ])
        c.nestedComments = true
        c.singleQuoteStrings = false
        c.tripleQuotes = true
        c.stringInterpolation = Interpolation(backslashParen: true)
        c.swiftRawStrings = true
        c.hash = .swift
        c.backtick = .identifier(nil)
        return c
    }()

    static let rust: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move \
                mut pub ref return self Self static struct super trait type unsafe use where while union yield
                """),
            (.type, """
                i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box
                """),
            (.constant, "true false None Some Ok Err"),
        ], soft: "macro_rules"))
        c.introducers = WordTable([(.function, "fn"), (.type, "struct enum trait type union")])
        c.nestedComments = true
        c.rustChars = true
        c.multilineStrings = true
        c.rustRawStrings = true
        c.stringPrefixes = ["b", "c"]
        c.rawPrefixes = ["r", "br", "cr"]
        c.hash = .rustAttribute
        c.rustMacros = true
        c.at = .none
        return c
    }()

    private static let cKeywords = """
        auto break case const continue default do else enum extern for goto if inline register restrict return sizeof \
        static struct switch typedef union volatile while _Alignas _Alignof _Atomic _Generic _Noreturn _Static_assert \
        _Thread_local
        """
    private static let cTypes = """
        char double float int long short signed unsigned void bool _Bool _Complex size_t ssize_t ptrdiff_t intptr_t \
        uintptr_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t wchar_t FILE
        """

    static let c: CodeConfig = {
        var c = CodeConfig(words: WordTable([(.keyword, cKeywords), (.type, cTypes), (.constant, "NULL true false")]))
        c.introducers = WordTable([(.type, "struct enum union")])
        c.hash = .preprocessor
        c.at = .none
        c.arrowMemberAccess = true
        return c
    }()

    static let cpp: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, cKeywords + """
                 alignas alignof and and_eq asm bitand bitor catch class compl concept consteval constexpr constinit \
                const_cast co_await co_return co_yield decltype delete dynamic_cast explicit export friend mutable \
                namespace new noexcept not not_eq operator or or_eq private protected public reinterpret_cast requires \
                static_assert static_cast template this thread_local throw try typeid typename using virtual xor xor_eq
                """),
            (.type, cTypes + " char8_t char16_t char32_t"),
            (.constant, "nullptr NULL true false"),
        ], soft: "override final"))
        c.introducers = WordTable([(.type, "struct enum union class namespace concept")])
        c.hash = .preprocessor
        c.at = .none
        c.arrowMemberAccess = true
        c.cppRawStrings = true
        c.stringPrefixes = ["L", "u", "U", "u8"]
        c.rawPrefixes = ["R", "LR", "uR", "UR", "u8R"]
        return c
    }()

    static let objc: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, cKeywords + """
                 self super in out inout oneway bycopy byref nonatomic atomic strong weak copy assign retain readonly \
                readwrite nullable nonnull __block __weak __strong __unsafe_unretained instancetype
                """),
            (.type, cTypes + " id BOOL SEL IMP Class NSInteger NSUInteger CGFloat"),
            (.constant, "nil Nil NULL YES NO true false"),
        ]))
        c.introducers = WordTable([(.type, "struct enum union")])
        c.hash = .preprocessor
        c.at = .keyword
        c.arrowMemberAccess = true
        return c
    }()

    static let csharp: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                abstract as base break case catch checked class const continue default delegate do else enum event \
                explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace new \
                operator out override params private protected public readonly ref return sealed sizeof stackalloc \
                static struct switch this throw try typeof unchecked unsafe using virtual volatile while async await \
                record required scoped
                """),
            (.type, "bool byte char decimal double float int long object sbyte short string uint ulong ushort void dynamic nint nuint"),
            (.constant, "true false null"),
        ], soft: "var get set init value add remove partial where when yield nameof global from select let orderby group into join on equals by with not and or file"))
        c.introducers = WordTable([(.type, "class struct interface enum record namespace")])
        c.hash = .preprocessor
        c.tripleQuotes = true
        c.csharpStrings = true
        c.at = .none
        return c
    }()

    static let php: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                abstract and array as break callable case catch class clone const continue declare default do echo else \
                elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for \
                foreach function global goto if implements include include_once instanceof insteadof interface isset \
                list match namespace new or print private protected public readonly require require_once return static \
                switch throw trait try unset use var while xor yield enum
                """),
            (.type, "int float bool string object mixed void never iterable self parent"),
            (.constant, "true false null __CLASS__ __DIR__ __FILE__ __FUNCTION__ __LINE__ __METHOD__ __NAMESPACE__"),
        ], caseInsensitive: true))
        c.introducers = WordTable([(.function, "function fn"), (.type, "class interface trait enum extends implements")],
                                  caseInsensitive: true)
        c.lineComments = [Ch.units("//"), Ch.units("#")]
        c.dollarVariables = true
        c.phpTags = true
        c.arrowMemberAccess = true
        c.multilineStrings = true
        c.stringInterpolation = Interpolation(dollarName: true)
        c.at = .none
        return c
    }()

    static let ruby: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                BEGIN END alias and begin break case class def defined? do else elsif end ensure for if in module next not \
                or redo rescue retry return super then undef unless until when while yield __FILE__ __LINE__ __method__
                """),
            (.constant, "true false nil"),
            (.variable, "self"),
        ], soft: "require require_relative include extend attr_accessor attr_reader attr_writer private protected public raise lambda proc puts loop"))
        c.introducers = WordTable([(.function, "def"), (.type, "class module")])
        c.lineComments = [Ch.units("#")]
        c.blockComment = (Ch.units("=begin"), Ch.units("=end"))
        c.multilineStrings = true
        c.stringInterpolation = Interpolation(hashBrace: true)
        c.at = .variable
        c.dollarVariables = true
        c.rubySymbols = true
        c.rubyIdentifierSuffix = true
        c.regexLiterals = true
        return c
    }()

    static let lua: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, "and break do else elseif end for function goto if in local not or repeat return then until while"),
            (.constant, "true false nil"),
            (.variable, "self"),
        ]))
        c.introducers = WordTable([(.function, "function")])
        c.lineComments = [Ch.units("--")]
        c.blockComment = nil
        c.luaLongBrackets = true
        c.capitalizedTypes = false
        c.at = .none
        return c
    }()

    static let dart: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                abstract as assert async await base break case catch class const continue covariant default deferred do \
                else enum export extends extension external factory final finally for if implements import in interface \
                is late library mixin new on operator part required rethrow return sealed static super switch sync this \
                throw try typedef var when while with yield
                """),
            (.type, "int double num bool dynamic void Function"),
            (.constant, "true false null"),
        ], soft: "get set hide show"))
        c.introducers = WordTable([(.type, "class mixin enum extension typedef")])
        c.tripleQuotes = true
        c.stringInterpolation = Interpolation(dollarBrace: true, dollarName: true)
        c.interpolateSingleQuotes = true
        c.rawPrefixes = ["r"]
        return c
    }()

    static let scala: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                abstract case catch class def do else enum export extends final finally for forSome given if implicit \
                import lazy match new object override package private protected return sealed super then this throw \
                trait try type using val var while with yield
                """),
            (.constant, "true false null"),
        ]))
        c.introducers = WordTable([(.function, "def"), (.type, "class object trait type enum")])
        c.nestedComments = true
        c.tripleQuotes = true
        c.backtick = .identifier(nil)
        c.stringPrefixes = ["s", "f", "raw"]
        return c
    }()

    static let r: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, "if else repeat while function for in next break return library require"),
            (.constant, "TRUE FALSE NULL Inf NaN NA NA_integer_ NA_real_ NA_character_ T F"),
        ]))
        c.lineComments = [Ch.units("#")]
        c.blockComment = nil
        c.multilineStrings = true
        c.dotInIdentifiers = true
        c.capitalizedTypes = false
        c.backtick = .identifier(nil)
        c.at = .none
        return c
    }()

    static let sql: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                select from where and or not insert into values update set delete create table drop alter add column \
                index view on join left right inner outer full cross natural using group by order having limit offset \
                union all distinct as is like ilike in between exists case when then else end primary key foreign \
                references unique default check constraint if begin commit rollback transaction with recursive returning \
                explain analyze desc asc grant revoke database schema trigger procedure function returns declare replace \
                truncate cascade restrict over partition window rows range lateral fetch next only top any some escape \
                collate temporary temp materialized sequence language return execute exec do loop while for each row \
                after before instead of conflict nothing upsert merge matched vacuum show use describe auto_increment \
                identity generated always stored virtual unsigned zerofill engine charset comment rename to modify \
                change first last nulls
                """),
            (.type, """
                int integer smallint bigint tinyint mediumint decimal numeric real float double precision char varchar \
                text nchar nvarchar ntext tinytext mediumtext longtext blob clob bytea date time timestamp timestamptz \
                datetime year boolean bool serial bigserial smallserial uuid json jsonb xml money interval bit varbinary \
                binary enum inet cidr macaddr
                """),
            (.function, """
                count sum avg min max coalesce nullif cast convert now current_date current_time current_timestamp \
                lower upper length char_length substring substr trim ltrim rtrim concat concat_ws round floor ceil \
                ceiling abs ifnull isnull nvl row_number rank dense_rank ntile lead lag first_value last_value date_trunc \
                extract to_char to_date to_timestamp greatest least string_agg array_agg group_concat json_agg \
                jsonb_agg json_build_object jsonb_build_object date_format datediff dateadd strftime random rand md5 \
                replace position strpos split_part regexp_replace generate_series unnest
                """),
            (.constant, "null true false unknown"),
        ], caseInsensitive: true))
        c.lineComments = [Ch.units("--")]
        c.multilineStrings = true
        c.backtick = .identifier(.variable)
        c.at = .variable
        c.dollarVariables = true
        c.dollarQuotes = true
        c.capitalizedTypes = false
        return c
    }()

    static let graphql: CodeConfig = {
        var c = CodeConfig(words: WordTable([
            (.keyword, """
                query mutation subscription fragment on type interface union enum input scalar schema extend directive \
                implements repeatable
                """),
            (.type, "Int Float String Boolean ID"),
            (.constant, "true false null"),
        ]))
        c.introducers = WordTable([(.type, "type interface union enum input scalar fragment")])
        c.lineComments = [Ch.units("#")]
        c.blockComment = nil
        c.singleQuoteStrings = false
        c.tripleQuotes = true
        c.dollarVariables = true
        return c
    }()
}
