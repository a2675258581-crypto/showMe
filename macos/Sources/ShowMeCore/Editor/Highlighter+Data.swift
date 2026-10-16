import Foundation

// 数据 / 配置 / 脚本类：YAML、TOML / INI / .env、Shell、Dockerfile、Makefile、CSV、日志、.gitignore。

private enum DataWords {
    static let yamlConstants = WordTable([(.constant, "true false yes no on off null y n")], caseInsensitive: true)
    static let yamlNumbers = WordTable([(.number, ".inf -.inf +.inf .nan")], caseInsensitive: true)
    static let configConstants = WordTable([(.constant, "true false yes no on off null none nil")], caseInsensitive: true)
    static let tomlConstants = WordTable([(.constant, "true false"), (.number, "inf nan +inf -inf +nan -nan")])
    static let docMarker = Ch.units("---")
    static let docEnd = Ch.units("...")
    static let export = Ch.units("export ")
    static let levelEquals = Ch.units("level=")

    static let shell = WordTable([
        (.keyword, """
            if then else elif fi for while until do done case esac in function select time return local export declare \
            readonly typeset unset break continue exit source alias unalias shift trap eval exec set let coproc
            """),
        (.function, """
            echo printf cd pwd read test pushd popd dirs jobs fg bg kill wait umask ulimit getopts hash type command \
            builtin enable help history logout mapfile readarray complete compgen shopt bind caller disown suspend \
            true false sudo
            """),
    ])
    /// 这些词之后仍是「命令位置」（可出现命令名或 NAME=value 赋值）
    static let commandFollows = WordTable([
        (.keyword, "if then else elif while until do time exec eval sudo command builtin export local declare readonly typeset let"),
    ])

    static let docker = WordTable([
        (.keyword, """
            FROM RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK \
            SHELL MAINTAINER
            """),
    ], caseInsensitive: true)
    static let asWord = Ch.units(" as ")

    static let makeDirectives = WordTable([
        (.keyword, """
            include -include sinclude ifeq ifneq ifdef ifndef else endif define endef export unexport override private \
            vpath undefine
            """),
    ])

    static let logLevels = WordTable([
        (.invalid, "ERROR ERR FATAL CRITICAL CRIT PANIC EMERG EMERGENCY ALERT SEVERE FAIL FAILED FAILURE EXCEPTION E"),
        (.keyword, "WARN WARNING W"),
        (.type, "INFO NOTICE I"),
        (.comment, "DEBUG TRACE VERBOSE FINE FINER FINEST D V T"),
    ])
    static let logLevelsLoose = WordTable([
        (.invalid, "error err fatal critical crit panic emerg alert severe fail failed failure exception"),
        (.keyword, "warn warning"),
        (.type, "info notice"),
        (.comment, "debug trace verbose fine finer finest"),
    ], caseInsensitive: true)
}

extension Lexer {
    // MARK: - YAML

    mutating func scanYAML() {
        var i = 0
        var blockIndent = -1 // ≥ 0：处于块标量（| / >）中，记录所在行的缩进
        while i < end {
            let le = lineEnd(i)
            let next = nextLineStart(le)
            defer { i = next }
            let j = skipBlanks(i, le)
            let indent = j - i
            if blockIndent >= 0 {
                if j == le { continue }
                if indent > blockIndent {
                    emit(j, le, .string)
                    continue
                }
                blockIndent = -1
            }
            if j == le { continue }
            let c = b[j]
            if c == Ch.hash {
                emit(j, le, .comment)
                continue
            }
            if indent == 0 {
                if (hasPrefix(j, DataWords.docMarker) || hasPrefix(j, DataWords.docEnd)) && (j + 3 == le || isBlank(at(j + 3))) {
                    emit(j, j + 3, .meta)
                    scanYAMLValue(j + 3, le, indent: indent, blockIndent: &blockIndent)
                    continue
                }
                if c == Ch.percent {
                    emit(j, le, .meta)
                    continue
                }
            }
            var k = j
            // 序列项「- 」与复杂键「? 」
            while k < le && (b[k] == Ch.minus || b[k] == Ch.question) && (k + 1 == le || isBlank(b[k + 1])) {
                emit(k, k + 1, .punctuation)
                k = skipBlanks(k + 1, le)
            }
            if k < le, let key = yamlKey(k, le) {
                emit(k, key.end, .property)
                emit(key.colon, key.colon + 1, .punctuation)
                k = key.colon + 1
            }
            scanYAMLValue(k, le, indent: indent, blockIndent: &blockIndent)
        }
    }

    /// 「键: 」：返回键的结束位置和冒号位置
    private func yamlKey(_ k: Int, _ le: Int) -> (end: Int, colon: Int)? {
        let c = b[k]
        if c == Ch.dquote || c == Ch.squote {
            let q = c == Ch.dquote ? quotedEnd(k, quote: c) : quotedEnd(k, quote: c, escapes: false, doubled: true)
            let p = skipBlanks(q, le)
            if p < le && b[p] == Ch.colon && (p + 1 == le || isBlank(at(p + 1))) { return (q, p) }
            return nil
        }
        switch c {
        case Ch.lbracket, Ch.lbrace, Ch.pipe, Ch.gt, Ch.excl, Ch.amp, Ch.star, Ch.percent, Ch.at, Ch.backtick:
            return nil
        default:
            break
        }
        var m = k
        while m < le {
            let d = b[m]
            if d == Ch.colon && (m + 1 == le || isBlank(b[m + 1])) {
                let keyEnd = trimEnd(k, m)
                return keyEnd > k ? (keyEnd, m) : nil
            }
            if d == Ch.hash && m > k && isBlank(b[m - 1]) { return nil }
            m += 1
        }
        return nil
    }

    private mutating func scanYAMLValue(_ start: Int, _ le: Int, indent: Int, blockIndent: inout Int) {
        var m = start
        var flow = 0
        var first = true
        while m < le {
            let c = b[m]
            if isBlank(c) { m += 1; continue }
            if c == Ch.hash && (m == start || isBlank(at(m - 1))) {
                emit(m, le, .comment)
                return
            }
            if (c == Ch.amp || c == Ch.star) && m + 1 < le && !isBlank(b[m + 1]) {
                // 锚点 &a、别名 *a
                var j = m + 1
                while j < le && !isBlank(b[j]) && b[j] != Ch.comma && b[j] != Ch.rbracket && b[j] != Ch.rbrace { j += 1 }
                emit(m, j, .variable)
                m = j
                continue
            }
            if c == Ch.excl {
                var j = m + 1
                while j < le && !isBlank(b[j]) { j += 1 }
                emit(m, j, .meta)
                m = j
                continue
            }
            if (c == Ch.pipe || c == Ch.gt) && first && flow == 0 {
                var j = m + 1
                while j < le && (b[j] == Ch.plus || b[j] == Ch.minus || isDigit(b[j])) { j += 1 }
                let p = skipBlanks(j, le)
                if p == le || b[p] == Ch.hash {
                    emit(m, j, .operator)
                    blockIndent = indent
                    m = j
                    first = false
                    continue
                }
            }
            if c == Ch.dquote {
                let j = quotedEnd(m, quote: c)
                emit(m, j, .string)
                m = j
                first = false
                continue
            }
            if c == Ch.squote {
                let j = quotedEnd(m, quote: c, escapes: false, doubled: true)
                emit(m, j, .string)
                m = j
                first = false
                continue
            }
            if c == Ch.lbracket || c == Ch.lbrace {
                flow += 1
                m += 1
                first = false
                continue
            }
            if c == Ch.rbracket || c == Ch.rbrace {
                flow = max(0, flow - 1)
                m += 1
                continue
            }
            if c == Ch.comma && flow > 0 {
                m += 1
                continue
            }
            // 普通标量
            var j = m
            var flowKey = false
            while j < le {
                let d = b[j]
                if d == Ch.hash && j > m && isBlank(b[j - 1]) { break }
                if flow > 0 {
                    if d == Ch.comma || d == Ch.rbracket || d == Ch.rbrace { break }
                    if d == Ch.colon && (j + 1 == le || isBlank(b[j + 1]) || b[j + 1] == Ch.comma) {
                        flowKey = true
                        break
                    }
                }
                j += 1
            }
            let e = trimEnd(m, j)
            if e > m {
                if flowKey {
                    emit(m, e, .property)
                    emit(j, j + 1, .punctuation)
                    j += 1
                } else {
                    emit(m, e, yamlScalarKind(m, e))
                }
            }
            m = max(j, m + 1)
            first = false
        }
    }

    private func yamlScalarKind(_ s: Int, _ e: Int) -> HighlightKind {
        if e - s == 1 && b[s] == Ch.tilde { return .constant }
        if DataWords.yamlConstants.contains(b, s, e) { return .constant }
        if DataWords.yamlNumbers.contains(b, s, e) { return .number }
        if isPlainNumber(s, e) { return .number }
        return .string
    }

    /// [s, e) 整段是一个数字（可带正负号，不带后缀）
    func isPlainNumber(_ s: Int, _ e: Int) -> Bool {
        var k = s
        if k < e && (b[k] == Ch.minus || b[k] == Ch.plus) { k += 1 }
        guard k < e, isDigit(b[k]) || (b[k] == Ch.dot && k + 1 < e && isDigit(b[k + 1])) else { return false }
        return numberEnd(k, suffix: false) == e
    }

    // MARK: - TOML / INI / .env / properties

    mutating func scanConfig(toml: Bool) {
        var i = 0
        while i < end {
            var le = lineEnd(i)
            let j = skipBlanks(i, le)
            if j < le {
                let c = b[j]
                if c == Ch.hash || (!toml && (c == Ch.semicolon || c == Ch.excl)) {
                    emit(j, le, .comment)
                } else if c == Ch.lbracket {
                    // [section] / [[array.of.tables]]
                    var k = j + 1
                    while k < le && b[k] != Ch.rbracket { k += 1 }
                    while k < le && b[k] == Ch.rbracket { k += 1 }
                    emit(j, k, .heading)
                    let p = skipBlanks(k, le)
                    if p < le && (b[p] == Ch.hash || (!toml && b[p] == Ch.semicolon)) { emit(p, le, .comment) }
                } else {
                    var k = j
                    if !toml && hasPrefix(k, DataWords.export) {
                        emit(k, k + 6, .keyword)
                        k = skipBlanks(k + 6, le)
                    }
                    if let sep = configSeparator(k, le, toml: toml) {
                        emit(k, trimEnd(k, sep), .property)
                        emit(sep, sep + 1, .operator)
                        le = toml ? scanTOMLValue(sep + 1, le) : scanINIValue(sep + 1, le)
                    } else if toml {
                        le = scanTOMLValue(k, le)
                    }
                }
            }
            i = nextLineStart(le)
        }
    }

    private func configSeparator(_ k: Int, _ le: Int, toml: Bool) -> Int? {
        var m = k
        while m < le {
            let c = b[m]
            if toml && (c == Ch.dquote || c == Ch.squote) {
                m = quotedEnd(m, quote: c, escapes: c == Ch.dquote)
                continue
            }
            if c == Ch.equal || (!toml && c == Ch.colon) { return m > k ? m : nil }
            if toml && (c == Ch.hash || c == Ch.lbracket || c == Ch.lbrace) { return nil }
            m += 1
        }
        return nil
    }

    /// TOML 值；多行字符串可能跨行，返回值所在（最后）一行的行尾
    private mutating func scanTOMLValue(_ start: Int, _ lineStop: Int) -> Int {
        var m = start
        var le = lineStop
        while m < le {
            let c = b[m]
            if isBlank(c) || c == Ch.comma || c == Ch.lbracket || c == Ch.rbracket || c == Ch.lbrace || c == Ch.rbrace {
                m += 1
                continue
            }
            if c == Ch.hash {
                emit(m, le, .comment)
                return le
            }
            if c == Ch.dquote || c == Ch.squote {
                if at(m + 1) == c && at(m + 2) == c {
                    let delim = [c, c, c]
                    var close = find(delim, from: m + 3, limit: end).map { $0 + 3 } ?? end
                    while close < end && b[close] == c { close += 1 }
                    emit(m, close, .string)
                    m = close
                    if close > le { le = lineEnd(close) }
                    continue
                }
                let j = quotedEnd(m, quote: c, escapes: c == Ch.dquote)
                emit(m, j, .string)
                m = j
                continue
            }
            if c == Ch.equal {
                emit(m, m + 1, .operator)
                m += 1
                continue
            }
            var j = m
            while j < le {
                let d = b[j]
                if isBlank(d) || d == Ch.comma || d == Ch.rbracket || d == Ch.rbrace || d == Ch.equal || d == Ch.hash { break }
                j += 1
            }
            let p = skipBlanks(j, le)
            if p < le && b[p] == Ch.equal {
                emit(m, j, .property) // 内联表的键
            } else if let entry = DataWords.tomlConstants.lookup(b, m, j) {
                emit(m, j, entry.kind)
            } else if isDigit(c) || ((c == Ch.plus || c == Ch.minus) && isDigit(at(m + 1))) {
                emit(m, j, .number) // 数字、日期时间
            }
            m = max(j, m + 1)
        }
        return le
    }

    /// INI / .env 值：引号字符串、$VAR、行内注释，其余按标量着色
    private mutating func scanINIValue(_ start: Int, _ le: Int) -> Int {
        var m = skipBlanks(start, le)
        let valueStart = m
        var segStart = m
        var segments = 0
        func flush(_ lexer: inout Lexer, _ s: Int, _ e: Int, whole: Bool) {
            let t = lexer.trimEnd(s, e)
            guard t > s else { return }
            if whole && lexer.isPlainNumber(s, t) {
                lexer.emit(s, t, .number)
            } else if whole && DataWords.configConstants.contains(lexer.b, s, t) {
                lexer.emit(s, t, .constant)
            } else {
                lexer.emit(s, t, .string)
            }
        }
        while m < le {
            let c = b[m]
            if (c == Ch.hash || c == Ch.semicolon) && (m == valueStart || isBlank(at(m - 1))) {
                flush(&self, segStart, m, whole: segments == 0)
                emit(m, le, .comment)
                return le
            }
            if c == Ch.dquote || c == Ch.squote {
                flush(&self, segStart, m, whole: false)
                let j = quotedEnd(m, quote: c, escapes: c == Ch.dquote)
                emit(m, j, .string)
                m = j
                segStart = j
                segments += 1
                continue
            }
            if c == Ch.dollar && (isIdentStart(at(m + 1)) || at(m + 1) == Ch.lbrace) {
                flush(&self, segStart, m, whole: false)
                var j = m + 1
                if b[j] == Ch.lbrace {
                    while j < le && b[j] != Ch.rbrace { j += 1 }
                    j = min(j + 1, le)
                } else {
                    j = identEnd(j)
                }
                emit(m, j, .variable)
                m = j
                segStart = j
                segments += 1
                continue
            }
            m += 1
        }
        flush(&self, segStart, le, whole: segments == 0)
        return le
    }

    // MARK: - Shell

    mutating func scanShell(from start: Int) {
        var i = start
        var commandStart = true
        var pendingFunctionName = false
        var heredocs: [(delimiter: [UInt16], stripTabs: Bool)] = []
        while i < end {
            let c = b[i]
            if c == Ch.lf || c == Ch.cr {
                let next = nextLineStart(i)
                if !heredocs.isEmpty {
                    i = scanHeredocBodies(next, heredocs)
                    heredocs.removeAll()
                    continue
                }
                i = next
                commandStart = true
                continue
            }
            if isBlank(c) { i += 1; continue }
            if c == Ch.backslash {
                // 续行符 \ + 换行不结束命令
                i += (at(i + 1) == Ch.cr && at(i + 2) == Ch.lf) ? 3 : 2
                continue
            }
            if c == Ch.hash && (i == start || isSpaceOrNewline(at(i - 1)) || at(i - 1) == Ch.semicolon || at(i - 1) == Ch.lparen) {
                let j = lineEnd(i)
                emit(i, j, .comment)
                i = j
                continue
            }
            if c == Ch.squote {
                let j = quotedEnd(i, quote: c, escapes: false, multiline: true)
                emit(i, j, .string)
                i = j
                commandStart = false
                continue
            }
            if c == Ch.dquote {
                i = scanShellDoubleQuoted(i, tokenStart: i)
                commandStart = false
                continue
            }
            if c == Ch.dollar, let j = scanShellDollar(i) {
                i = j
                commandStart = at(j - 1) == Ch.lparen
                continue
            }
            if c == Ch.backtick {
                emit(i, i + 1, .operator)
                i += 1
                commandStart = true
                continue
            }
            if c == Ch.lt && at(i + 1) == Ch.lt && at(i + 2) != Ch.lt {
                // here-doc：<<EOF、<<-'EOF'
                var k = i + 2
                let strip = at(k) == Ch.minus
                if strip { k += 1 }
                emit(i, k, .operator)
                let le = end // 分隔符遇到换行自然停下，不必先求行尾
                k = skipBlanks(k, le)
                var delimiter: [UInt16] = []
                var de = k
                let q = at(k)
                if q == Ch.squote || q == Ch.dquote {
                    de = quotedEnd(k, quote: q, escapes: false)
                    if de - k >= 2 && at(de - 1) == q { delimiter = Array(b[(k + 1)..<(de - 1)]) }
                } else {
                    var s = k
                    if at(s) == Ch.backslash { s += 1 }
                    de = s
                    while de < le && (isASCIIAlnum(b[de]) || b[de] == Ch.underscore || b[de] == Ch.minus) { de += 1 }
                    delimiter = Array(b[s..<de])
                }
                if !delimiter.isEmpty {
                    emit(k, de, .string)
                    heredocs.append((delimiter, strip))
                }
                i = max(de, i + 2)
                continue
            }
            switch c {
            case Ch.pipe, Ch.amp, Ch.semicolon, Ch.lt, Ch.gt:
                var j = i + 1
                while j < end && (b[j] == Ch.pipe || b[j] == Ch.amp || b[j] == Ch.semicolon || b[j] == Ch.lt || b[j] == Ch.gt) { j += 1 }
                emit(i, j, .operator)
                // > file、2>&1 之后不是命令
                commandStart = !(c == Ch.lt || c == Ch.gt || (c == Ch.amp && at(i - 1) == Ch.gt))
                i = j
                continue
            case Ch.lparen, Ch.lbrace:
                if c == Ch.lbrace && !isSpaceOrNewline(at(i + 1)) && at(i + 1) != 0 {
                    break // 花括号展开 {a,b}，当普通单词处理
                }
                commandStart = true
                i += 1
                continue
            case Ch.rparen, Ch.rbrace:
                i += 1
                continue
            default:
                break
            }

            let j = shellWordEnd(i)
            if j == i { i += 1; continue }
            if commandStart {
                if let eq = assignmentEquals(i, j) {
                    emit(i, eq, .variable)
                    emit(eq, eq + 1, .operator)
                    i = eq + 1
                    if i < j { i = j } // 值部分不着色
                    continue
                }
                if let entry = DataWords.shell.lookup(b, i, j) {
                    emit(i, j, entry.kind)
                    commandStart = DataWords.commandFollows.contains(b, i, j)
                    pendingFunctionName = equals(i, j, "function")
                    i = j
                    continue
                }
                if at(j) == Ch.lparen && at(j + 1) == Ch.rparen {
                    emit(i, j, .function) // name() { … }
                } else if pendingFunctionName {
                    emit(i, j, .function)
                }
                pendingFunctionName = false
                commandStart = false
                i = j
                continue
            }
            if pendingFunctionName {
                emit(i, j, .function)
                pendingFunctionName = false
            } else if equals(i, j, "in") || equals(i, j, "do") || equals(i, j, "then") {
                emit(i, j, .keyword)
                commandStart = !equals(i, j, "in")
            } else if isAllDigits(i, j) {
                emit(i, j, .number)
            }
            i = j
        }
    }

    private func isAllDigits(_ s: Int, _ e: Int) -> Bool {
        guard e > s else { return false }
        for k in s..<e where !isDigit(b[k]) { return false }
        return true
    }

    /// NAME=value 中等号的位置
    private func assignmentEquals(_ s: Int, _ e: Int) -> Int? {
        guard isIdentStart(b[s]) else { return nil }
        var k = s
        while k < e && (isIdentPart(b[k])) { k += 1 }
        if k < e && b[k] == Ch.plus && at(k + 1) == Ch.equal { return nil }
        return k < e && b[k] == Ch.equal ? k : nil
    }

    private func shellWordEnd(_ i: Int) -> Int {
        var j = i
        while j < end {
            let c = b[j]
            if isSpaceOrNewline(c) { break }
            switch c {
            case Ch.pipe, Ch.amp, Ch.semicolon, Ch.lt, Ch.gt, Ch.lparen, Ch.rparen, Ch.dquote, Ch.squote, Ch.backtick, Ch.dollar:
                return j
            case Ch.backslash:
                j += 2
                continue
            default:
                j += 1
            }
        }
        return min(j, end)
    }

    /// $var、${var}、$(…)、$((…))、$'…'、$1、$@
    private mutating func scanShellDollar(_ i: Int) -> Int? {
        let n = at(i + 1)
        if n == Ch.squote {
            let j = quotedEnd(i + 1, quote: Ch.squote, escapes: true, multiline: true)
            emit(i, j, .string)
            return j
        }
        if n == Ch.dquote {
            return scanShellDoubleQuoted(i + 1, tokenStart: i)
        }
        if n == Ch.lbrace {
            let j = matchingClose(i + 1, open: Ch.lbrace, close: Ch.rbrace)
            emit(i, j, .variable)
            return j
        }
        if n == Ch.lparen {
            let j = at(i + 2) == Ch.lparen ? i + 3 : i + 2
            emit(i, j, .operator)
            return j
        }
        if isASCIILetter(n) || n == Ch.underscore {
            var j = i + 1
            while j < end && (isASCIIAlnum(b[j]) || b[j] == Ch.underscore) { j += 1 }
            emit(i, j, .variable)
            return j
        }
        if isDigit(n) || n == Ch.at || n == Ch.star || n == Ch.hash || n == Ch.question || n == Ch.dollar || n == Ch.excl
            || n == Ch.minus {
            emit(i, i + 2, .variable)
            return i + 2
        }
        return nil
    }

    /// 从 open 位置找配对的 close，返回其后位置（没找到为文件尾）
    private func matchingClose(_ open: Int, open o: UInt16, close cl: UInt16) -> Int {
        var level = 0
        var j = open
        while j < end {
            let c = b[j]
            if c == Ch.backslash { j += 2; continue }
            if c == o { level += 1 }
            else if c == cl {
                level -= 1
                if level == 0 { return j + 1 }
            }
            j += 1
        }
        return end
    }

    private mutating func scanShellDoubleQuoted(_ q: Int, tokenStart: Int) -> Int {
        var j = q + 1
        var seg = tokenStart
        while j < end {
            let c = b[j]
            if c == Ch.dquote {
                emit(seg, j + 1, .string)
                return j + 1
            }
            if c == Ch.backslash { j += 2; continue }
            if c == Ch.dollar {
                let n = at(j + 1)
                var k = j
                if n == Ch.lbrace {
                    k = matchingClose(j + 1, open: Ch.lbrace, close: Ch.rbrace)
                } else if n == Ch.lparen {
                    k = matchingClose(j + 1, open: Ch.lparen, close: Ch.rparen)
                } else if isASCIILetter(n) || n == Ch.underscore {
                    k = j + 1
                    while k < end && (isASCIIAlnum(b[k]) || b[k] == Ch.underscore) { k += 1 }
                } else if isDigit(n) || n == Ch.at || n == Ch.star || n == Ch.hash || n == Ch.question || n == Ch.excl {
                    k = j + 2
                }
                if k > j {
                    emit(seg, j, .string)
                    emit(j, k, .variable)
                    j = k
                    seg = k
                    continue
                }
            }
            j += 1
        }
        emit(seg, end, .string)
        return end
    }

    /// here-doc 正文直到结束标记行；返回结束标记行的行尾
    private mutating func scanHeredocBodies(_ start: Int, _ docs: [(delimiter: [UInt16], stripTabs: Bool)]) -> Int {
        var ls = start
        for (n, doc) in docs.enumerated() {
            let bodyStart = ls
            var closed = false
            while ls < end {
                let le = lineEnd(ls)
                var s = ls
                if doc.stripTabs { while s < le && b[s] == Ch.tab { s += 1 } }
                if le - s == doc.delimiter.count && hasPrefix(s, doc.delimiter) {
                    emit(bodyStart, le, .string)
                    ls = le
                    closed = true
                    break
                }
                ls = nextLineStart(le)
            }
            if !closed {
                emit(bodyStart, end, .string)
                return end
            }
            // 下一个 here-doc 从下一行开始
            if n < docs.count - 1 { ls = nextLineStart(ls) }
        }
        return ls
    }

    // MARK: - Dockerfile

    mutating func scanDockerfile() {
        var i = 0
        var continued = false
        while i < end {
            let le = lineEnd(i)
            let j = skipBlanks(i, le)
            if j < le {
                if b[j] == Ch.hash {
                    emit(j, le, .comment)
                } else if !continued {
                    var k = j
                    while k < le && isASCIILetter(b[k]) { k += 1 }
                    if DataWords.docker.contains(b, j, k) {
                        emit(j, k, .keyword)
                        if equalsCI(j, k, "from"), let asAt = findCI(DataWords.asWord, from: k, limit: le) {
                            delegate("shell", k, asAt + 1)
                            emit(asAt + 1, asAt + 3, .keyword)
                            delegate("shell", asAt + 3, le)
                        } else {
                            delegate("shell", k, le)
                        }
                    } else {
                        delegate("shell", j, le)
                    }
                } else {
                    delegate("shell", j, le)
                }
                let t = trimEnd(j, le)
                continued = t > j && b[t - 1] == Ch.backslash
            }
            i = nextLineStart(le)
        }
    }

    // MARK: - Makefile

    mutating func scanMakefile() {
        var i = 0
        while i < end {
            let le = lineEnd(i)
            if i < le {
                if b[i] == Ch.tab {
                    // 命令行：@ / - / + 前缀
                    var k = skipBlanks(i, le)
                    let p = k
                    while k < le && (b[k] == Ch.at || b[k] == Ch.minus || b[k] == Ch.plus) { k += 1 }
                    emit(p, k, .operator)
                    scanMakeText(k, le)
                } else {
                    let j = skipBlanks(i, le)
                    if j < le && b[j] == Ch.hash {
                        emit(j, le, .comment)
                    } else if j < le {
                        scanMakeLine(j, le)
                    }
                }
            }
            i = nextLineStart(le)
        }
    }

    private mutating func scanMakeLine(_ j: Int, _ le: Int) {
        var w = j
        while w < le && (isASCIIAlnum(b[w]) || b[w] == Ch.minus || b[w] == Ch.underscore) { w += 1 }
        if w > j && (w == le || isBlank(b[w]) || b[w] == Ch.lparen) && DataWords.makeDirectives.contains(b, j, w) {
            emit(j, w, .keyword)
            let k = skipBlanks(w, le)
            if !makeAssignment(k, le) { scanMakeText(k, le) }
            return
        }
        if makeAssignment(j, le) { return }
        // 规则：targets: prerequisites
        var m = j
        var parens = 0
        while m < le {
            let c = b[m]
            if c == Ch.lparen || c == Ch.lbrace { parens += 1 }
            else if c == Ch.rparen || c == Ch.rbrace { parens -= 1 }
            else if c == Ch.colon && parens <= 0 && at(m + 1) != Ch.equal { break }
            else if c == Ch.hash || c == Ch.equal { m = le; break }
            m += 1
        }
        if m < le {
            let targetEnd = trimEnd(j, m)
            var hasDollar = false
            for k in j..<targetEnd where b[k] == Ch.dollar { hasDollar = true; break }
            if hasDollar {
                scanMakeText(j, targetEnd)
            } else {
                emit(j, targetEnd, b[j] == Ch.dot && isUpper(at(j + 1)) ? .keyword : .function)
            }
            let opEnd = at(m + 1) == Ch.colon ? m + 2 : m + 1
            emit(m, opEnd, .operator)
            scanMakeText(opEnd, le)
        } else {
            scanMakeText(j, le)
        }
    }

    /// VAR = / := / ::= / ?= / += / != value
    private mutating func makeAssignment(_ j: Int, _ le: Int) -> Bool {
        var n = j
        while n < le && !isBlank(b[n]) && b[n] != Ch.equal && b[n] != Ch.colon && b[n] != Ch.question && b[n] != Ch.plus
            && b[n] != Ch.excl && b[n] != Ch.hash {
            n += 1
        }
        guard n > j else { return false }
        let p = skipBlanks(n, le)
        var q = p
        if at(q) == Ch.colon && at(q + 1) == Ch.colon { q += 2 }
        else if at(q) == Ch.colon || at(q) == Ch.question || at(q) == Ch.plus || at(q) == Ch.excl { q += 1 }
        guard q < le, b[q] == Ch.equal else { return false }
        emit(j, n, .variable)
        emit(p, q + 1, .operator)
        scanMakeText(q + 1, le)
        return true
    }

    /// $(VAR)、${VAR}、$@、字符串、注释
    private mutating func scanMakeText(_ start: Int, _ stop: Int) {
        var m = start
        while m < stop {
            let c = b[m]
            if c == Ch.dollar {
                let n = at(m + 1)
                if n == Ch.lparen || n == Ch.lbrace {
                    let close: UInt16 = n == Ch.lparen ? Ch.rparen : Ch.rbrace
                    var k = m + 2
                    var level = 1
                    while k < stop {
                        if b[k] == n { level += 1 }
                        else if b[k] == close {
                            level -= 1
                            if level == 0 { k += 1; break }
                        }
                        k += 1
                    }
                    emit(m, min(k, stop), .variable)
                    m = min(k, stop)
                    continue
                }
                if m + 1 < stop && !isBlank(n) {
                    emit(m, m + 2, .variable)
                    m += 2
                    continue
                }
            }
            if c == Ch.hash && (m == start || isBlank(at(m - 1))) {
                emit(m, stop, .comment)
                return
            }
            if c == Ch.dquote || c == Ch.squote {
                let j = min(quotedEnd(m, quote: c, escapes: c == Ch.dquote), stop)
                emit(m, j, .string)
                m = max(j, m + 1)
                continue
            }
            m += 1
        }
    }

    // MARK: - CSV

    /// 隔列着色（奇数列 → property），支持引号字段（可跨行、"" 转义）
    mutating func scanCSV() {
        let delimiter = csvDelimiter()
        var i = 0
        var column = 0
        var fieldStart = 0
        while i < end {
            let c = b[i]
            if c == Ch.dquote && i == fieldStart {
                var j = i + 1
                while j < end {
                    if b[j] == Ch.dquote {
                        if at(j + 1) == Ch.dquote { j += 2; continue }
                        j += 1
                        break
                    }
                    j += 1
                }
                i = min(j, end)
                if i >= end { break }
                continue
            }
            if c == delimiter || c == Ch.lf || c == Ch.cr {
                if column % 2 == 1 { emit(fieldStart, i, .property) }
                column = c == delimiter ? column + 1 : 0
                if c == Ch.cr && at(i + 1) == Ch.lf { i += 1 }
                i += 1
                fieldStart = i
                continue
            }
            i += 1
        }
        if column % 2 == 1 { emit(fieldStart, end, .property) }
    }

    /// 看首行哪种分隔符最多：逗号、制表符、分号、竖线
    private func csvDelimiter() -> UInt16 {
        let candidates: [UInt16] = [Ch.comma, Ch.tab, Ch.semicolon, Ch.pipe]
        var counts = [0, 0, 0, 0]
        var inQuotes = false
        var i = 0
        let limit = min(end, 64 * 1024)
        while i < limit {
            let c = b[i]
            if c == Ch.dquote { inQuotes.toggle() }
            else if !inQuotes {
                if c == Ch.lf || c == Ch.cr { break }
                if let idx = candidates.firstIndex(of: c) { counts[idx] += 1 }
            }
            i += 1
        }
        var best = 0
        for k in 1..<4 where counts[k] > counts[best] { best = k }
        return candidates[best]
    }

    // MARK: - 日志

    /// 日志级别、时间戳、引号字符串、URL
    mutating func scanLog() {
        var i = 0
        while i < end {
            let c = b[i]
            if isDigit(c) && !isASCIIAlnum(at(i - 1)) {
                if let j = timestampEnd(i) {
                    emit(i, j, .number)
                    i = j
                    continue
                }
                var k = i
                while k < end && (isASCIIAlnum(b[k]) || b[k] == Ch.dot || b[k] == Ch.colon) { k += 1 }
                i = k
                continue
            }
            if isASCIILetter(c) && !isASCIIAlnum(at(i - 1)) && at(i - 1) != Ch.underscore {
                if c == 0x68, let u = urlEnd(i, end) {
                    emit(i, u, .link)
                    i = u
                    continue
                }
                var j = i
                while j < end && (isASCIIAlnum(b[j]) || b[j] == Ch.underscore) { j += 1 }
                // 单字母级别（E / W / I / D）只认 [E]、<W> 这类位置
                if let entry = DataWords.logLevels.lookup(b, i, j), j - i > 1 || isLevelContext(i, j) {
                    emit(i, j, entry.kind)
                } else if let entry = DataWords.logLevelsLoose.lookup(b, i, j), isLevelContext(i, j) {
                    emit(i, j, entry.kind)
                }
                i = j
                continue
            }
            if c == Ch.dquote {
                let j = quotedEnd(i, quote: c)
                emit(i, j, .string)
                i = j
                continue
            }
            i += 1
        }
    }

    /// [error]、level=warn、"level":"info"、<E> 这类明确的级别位置
    private func isLevelContext(_ s: Int, _ e: Int) -> Bool {
        let before = at(s - 1)
        let after = at(e)
        if (before == Ch.lbracket && after == Ch.rbracket) || (before == Ch.lt && after == Ch.gt) || (before == Ch.lparen && after == Ch.rparen) {
            return true
        }
        if before == Ch.equal && s >= 6 && hasPrefixCI(s - 6, DataWords.levelEquals) { return true }
        if before == Ch.dquote && after == Ch.dquote {
            // "level":"info"
            var k = s - 2
            while k >= 0 && isBlank(b[k]) { k -= 1 }
            return k >= 0 && b[k] == Ch.colon
        }
        return false
    }

    /// 2024-01-02、2024/01/02、2024-01-02T03:04:05.123Z、12:34:56,789
    private func timestampEnd(_ i: Int) -> Int? {
        func digits(_ k: Int) -> Int {
            var n = 0
            while isDigit(at(k + n)) { n += 1 }
            return n
        }
        func isTime(_ k: Int) -> Bool {
            let d = digits(k)
            return (d == 1 || d == 2) && at(k + d) == Ch.colon && digits(k + d + 1) == 2
        }
        func timeEnd(_ k: Int) -> Int {
            var j = k + digits(k) + 1 + 2
            if at(j) == Ch.colon && digits(j + 1) == 2 { j += 3 }
            if (at(j) == Ch.dot || at(j) == Ch.comma) && digits(j + 1) > 0 { j += 1 + digits(j + 1) }
            return j
        }
        func zoneEnd(_ k: Int) -> Int {
            if at(k) == 0x5A { return k + 1 } // Z
            if (at(k) == Ch.plus || at(k) == Ch.minus) && digits(k + 1) == 2 {
                var j = k + 3
                if at(j) == Ch.colon && digits(j + 1) == 2 { j += 3 }
                else if digits(j) == 2 { j += 2 }
                return j
            }
            return k
        }
        let sep = at(i + 4)
        if digits(i) == 4 && (sep == Ch.minus || sep == Ch.slash) && digits(i + 5) == 2 && at(i + 7) == sep && digits(i + 8) == 2 {
            var k = i + 10
            if (at(k) == 0x54 || at(k) == Ch.space) && isTime(k + 1) { // T 或空格
                k = zoneEnd(timeEnd(k + 1))
            }
            return k
        }
        if isTime(i) { return zoneEnd(timeEnd(i)) }
        return nil
    }

    // MARK: - .gitignore

    mutating func scanIgnore() {
        var i = 0
        while i < end {
            let le = lineEnd(i)
            let j = skipBlanks(i, le)
            if j < le {
                if b[j] == Ch.hash {
                    emit(j, le, .comment)
                } else if b[j] == Ch.excl {
                    emit(j, j + 1, .operator)
                }
            }
            i = nextLineStart(le)
        }
    }
}
