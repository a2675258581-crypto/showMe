import Foundation

/// 对比结果的一行
public struct DiffLine: Sendable, Hashable {
    public enum Kind: String, Sendable { case equal, insert, delete }

    public var kind: Kind
    /// 1 起始；新增行为 nil
    public var oldLineNumber: Int?
    /// 1 起始；删除行为 nil
    public var newLineNumber: Int?
    /// 未改动的行取新文本（忽略空白 / 大小写时两边可能不完全相同）
    public var text: String
    /// 行内改动的字符区间（按 Character 计）。只对配上对的删除 / 新增行给出；为空表示整行都算改动
    public var changes: [Range<Int>]

    public init(kind: Kind, oldLineNumber: Int?, newLineNumber: Int?, text: String, changes: [Range<Int>] = []) {
        self.kind = kind
        self.oldLineNumber = oldLineNumber
        self.newLineNumber = newLineNumber
        self.text = text
        self.changes = changes
    }
}

/// 文本对比：行级 Myers 差异（GNU diff 算法：剔除单侧独有行 + 线性空间中点搜索 + 代价过高时的启发式），行内按词对比
public enum TextDiff {
    public enum Op: Sendable, Hashable {
        case equal(Int)
        case delete(Int)
        case insert(Int)
    }

    public struct Stats: Sendable, Hashable {
        public var added = 0
        public var removed = 0
        public var unchanged = 0
        /// 0~1：2 × 相同行 / (左 + 右)
        public var similarity: Double {
            let total = 2 * unchanged + added + removed
            return total == 0 ? 1 : Double(2 * unchanged) / Double(total)
        }
        public var identical: Bool { added == 0 && removed == 0 }
    }

    /// 统一换行后按行切分；末尾换行不产生额外的空行
    public static func splitLines(_ text: String) -> [String] {
        if text.isEmpty { return [] }
        var lines = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        if lines.last == "" { lines.removeLast() }
        return lines
    }

    static func lineKey(_ line: String, ignoreWhitespace: Bool, ignoreCase: Bool) -> String {
        var k = line
        if ignoreWhitespace { k = String(String.UnicodeScalarView(k.unicodeScalars.filter { !$0.properties.isWhitespace })) }
        if ignoreCase { k = k.lowercased() }
        return k
    }

    /// 行级对比，供带颜色的视图使用
    public static func lines(_ old: String, _ new: String, ignoreWhitespace: Bool = false, ignoreCase: Bool = false) -> [DiffLine] {
        let a = splitLines(old)
        let b = splitLines(new)
        let ops = diff(a.map { lineKey($0, ignoreWhitespace: ignoreWhitespace, ignoreCase: ignoreCase) },
                       b.map { lineKey($0, ignoreWhitespace: ignoreWhitespace, ignoreCase: ignoreCase) })
        var out: [DiffLine] = []
        out.reserveCapacity(a.count + b.count)
        var i = 0
        var j = 0
        var pendingDel: [Int] = []
        var pendingIns: [Int] = []
        func flush() {
            guard !pendingDel.isEmpty || !pendingIns.isEmpty else { return }
            var delChanges: [Int: [Range<Int>]] = [:]
            var insChanges: [Int: [Range<Int>]] = [:]
            for pair in align(pendingDel.map { a[$0] }, pendingIns.map { b[$0] }, ignoreCase: ignoreCase) {
                let li = pendingDel[pair.0]
                let ri = pendingIns[pair.1]
                let intra = inlineChanges(a[li], b[ri], ignoreWhitespace: ignoreWhitespace, ignoreCase: ignoreCase)
                if intra.similarity >= 0.3 {
                    delChanges[li] = intra.old
                    insChanges[ri] = intra.new
                }
            }
            for li in pendingDel { out.append(DiffLine(kind: .delete, oldLineNumber: li + 1, newLineNumber: nil, text: a[li], changes: delChanges[li] ?? [])) }
            for ri in pendingIns { out.append(DiffLine(kind: .insert, oldLineNumber: nil, newLineNumber: ri + 1, text: b[ri], changes: insChanges[ri] ?? [])) }
            pendingDel = []
            pendingIns = []
        }
        for op in ops {
            switch op {
            case .delete(let n):
                for _ in 0..<n {
                    pendingDel.append(i)
                    i += 1
                }
            case .insert(let n):
                for _ in 0..<n {
                    pendingIns.append(j)
                    j += 1
                }
            case .equal(let n):
                flush()
                for _ in 0..<n {
                    out.append(DiffLine(kind: .equal, oldLineNumber: i + 1, newLineNumber: j + 1, text: b[j]))
                    i += 1
                    j += 1
                }
            }
        }
        flush()
        return out
    }

    public static func stats(_ lines: [DiffLine]) -> Stats {
        var s = Stats()
        for l in lines {
            switch l.kind {
            case .equal: s.unchanged += 1
            case .insert: s.added += 1
            case .delete: s.removed += 1
            }
        }
        return s
    }

    // MARK: - 统一格式补丁

    /// 生成统一格式（unified diff）补丁。总是按原文逐字比较（保留 \r 与末尾换行差异），生成的补丁可以直接应用。
    public static func unifiedPatch(_ old: String, _ new: String, oldName: String = "original.txt", newName: String = "modified.txt", context: Int = 3) -> String {
        let (a, aNoEOL) = rawLines(old)
        let (b, bNoEOL) = rawLines(new)
        // 没有末尾换行的最后一行与有换行的同内容行不相等
        func keys(_ lines: [String], _ noEOL: Bool) -> [String] {
            var k = lines
            if noEOL, let last = k.indices.last { k[last] += "\u{0}\u{1}" }
            return k
        }
        let ops = diff(keys(a, aNoEOL), keys(b, bNoEOL))
        // 展开成逐行记录：(类型, 原文下标, 新文下标)
        var rows: [(DiffLine.Kind, Int, Int)] = []
        var i = 0
        var j = 0
        for op in ops {
            switch op {
            case .equal(let n): for _ in 0..<n { rows.append((.equal, i, j)); i += 1; j += 1 }
            case .delete(let n): for _ in 0..<n { rows.append((.delete, i, j)); i += 1 }
            case .insert(let n): for _ in 0..<n { rows.append((.insert, i, j)); j += 1 }
            }
        }
        let changed = rows.indices.filter { rows[$0].0 != .equal }
        guard !changed.isEmpty else { return "" }
        let ctx = max(0, context)
        var out = ["--- \(oldName)", "+++ \(newName)"]
        var k = 0
        while k < changed.count {
            var end = changed[k]
            var next = k + 1
            while next < changed.count, changed[next] - end <= 2 * ctx + 1 {
                end = changed[next]
                next += 1
            }
            let from = max(0, changed[k] - ctx)
            let to = min(rows.count - 1, end + ctx)
            var oldCount = 0
            var newCount = 0
            for r in rows[from...to] {
                if r.0 != .insert { oldCount += 1 }
                if r.0 != .delete { newCount += 1 }
            }
            let first = rows[from]
            let oldStart = oldCount == 0 ? first.1 : first.1 + 1
            let newStart = newCount == 0 ? first.2 : first.2 + 1
            out.append("@@ -\(oldStart),\(oldCount) +\(newStart),\(newCount) @@")
            for r in rows[from...to] {
                switch r.0 {
                case .equal:
                    out.append(" " + a[r.1])
                    if (aNoEOL && r.1 == a.count - 1) || (bNoEOL && r.2 == b.count - 1) { out.append("\\ No newline at end of file") }
                case .delete:
                    out.append("-" + a[r.1])
                    if aNoEOL, r.1 == a.count - 1 { out.append("\\ No newline at end of file") }
                case .insert:
                    out.append("+" + b[r.2])
                    if bNoEOL, r.2 == b.count - 1 { out.append("\\ No newline at end of file") }
                }
            }
            k = next
        }
        return out.joined(separator: "\n") + "\n"
    }

    /// 按 \n 切分并保留 \r；返回最后一行是否缺少换行
    static func rawLines(_ text: String) -> ([String], Bool) {
        if text.isEmpty { return ([], false) }
        var lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        if lines.last == "" {
            lines.removeLast()
            return (lines, false)
        }
        return (lines, true)
    }

    // MARK: - 差异算法

    /// 两个序列的最短编辑脚本（相邻同类操作已合并；同一处改动先删后增）
    public static func diff<T: Hashable>(_ a: [T], _ b: [T]) -> [Op] {
        var ids: [T: Int] = [:]
        func id(_ x: T) -> Int {
            if let v = ids[x] { return v }
            let v = ids.count
            ids[x] = v
            return v
        }
        let ia = a.map(id)
        let ib = b.map(id)
        let (ca, cb) = changedFlags(ia, ib, idCount: ids.count)
        var ops: [Op] = []
        func push(_ op: Op) {
            switch (ops.last, op) {
            case (.equal(let x)?, .equal(let y)): ops[ops.count - 1] = .equal(x + y)
            case (.delete(let x)?, .delete(let y)): ops[ops.count - 1] = .delete(x + y)
            case (.insert(let x)?, .insert(let y)): ops[ops.count - 1] = .insert(x + y)
            default: ops.append(op)
            }
        }
        var i = 0
        var j = 0
        let n = ia.count
        let m = ib.count
        while i < n || j < m {
            if i < n, j < m, !ca[i], !cb[j] {
                push(.equal(1))
                i += 1
                j += 1
                continue
            }
            let i0 = i
            let j0 = j
            while i < n, ca[i] { i += 1 }
            while j < m, cb[j] { j += 1 }
            if i > i0 { push(.delete(i - i0)) }
            if j > j0 { push(.insert(j - j0)) }
            if i == i0, j == j0 {
                // 理论上不会出现；保证循环前进
                if i < n {
                    push(.delete(1))
                    i += 1
                }
                if j < m {
                    push(.insert(1))
                    j += 1
                }
            }
        }
        return ops
    }

    /// 标记两侧哪些元素不在公共子序列里。只在一侧出现的元素先剔除（与 GNU diff 的 discard 相同）
    static func changedFlags(_ a: [Int], _ b: [Int], idCount: Int) -> ([Bool], [Bool]) {
        var inA = [Bool](repeating: false, count: idCount)
        var inB = [Bool](repeating: false, count: idCount)
        for x in a { inA[x] = true }
        for x in b { inB[x] = true }
        var changedA = [Bool](repeating: true, count: a.count)
        var changedB = [Bool](repeating: true, count: b.count)
        let ai = a.indices.filter { inB[a[$0]] }
        let bi = b.indices.filter { inA[b[$0]] }
        if ai.isEmpty || bi.isEmpty { return (changedA, changedB) }
        var myers = Myers(a: ai.map { a[$0] }, b: bi.map { b[$0] })
        myers.run()
        for (k, idx) in ai.enumerated() { changedA[idx] = myers.changedA[k] }
        for (k, idx) in bi.enumerated() { changedB[idx] = myers.changedB[k] }
        return (changedA, changedB)
    }

    struct Myers {
        let a: [Int]
        let b: [Int]
        var changedA: [Bool]
        var changedB: [Bool]
        var fd: [Int]
        var bd: [Int]
        let offset: Int
        let tooExpensive: Int

        init(a: [Int], b: [Int]) {
            self.a = a
            self.b = b
            changedA = [Bool](repeating: false, count: a.count)
            changedB = [Bool](repeating: false, count: b.count)
            let diags = a.count + b.count + 3
            fd = [Int](repeating: 0, count: diags)
            bd = [Int](repeating: 0, count: diags)
            offset = b.count + 1
            var te = 1
            var d = diags
            while d != 0 {
                te <<= 1
                d >>= 2
            }
            tooExpensive = Swift.max(1024, te)
        }

        mutating func markAll(_ xoff: Int, _ xlim: Int, _ yoff: Int, _ ylim: Int) {
            var x = xoff
            while x < xlim { changedA[x] = true; x += 1 }
            var y = yoff
            while y < ylim { changedB[y] = true; y += 1 }
        }

        mutating func run() {
            var stack: [(Int, Int, Int, Int, Bool)] = [(0, a.count, 0, b.count, false)]
            while let (x0, x1, y0, y1, minimal) = stack.popLast() {
                var xoff = x0, xlim = x1, yoff = y0, ylim = y1
                while xoff < xlim, yoff < ylim, a[xoff] == b[yoff] {
                    xoff += 1
                    yoff += 1
                }
                while xlim > xoff, ylim > yoff, a[xlim - 1] == b[ylim - 1] {
                    xlim -= 1
                    ylim -= 1
                }
                if xoff == xlim || yoff == ylim {
                    markAll(xoff, xlim, yoff, ylim)
                    continue
                }
                let p = diag(xoff, xlim, yoff, ylim, minimal)
                if (p.xmid == xoff && p.ymid == yoff) || (p.xmid == xlim && p.ymid == ylim) {
                    markAll(xoff, xlim, yoff, ylim)
                    continue
                }
                stack.append((p.xmid, xlim, p.ymid, ylim, p.hiMinimal))
                stack.append((xoff, p.xmid, yoff, p.ymid, p.loMinimal))
            }
        }

        /// 找出最短编辑路径的中点（同时从两端搜索）
        mutating func diag(_ xoff: Int, _ xlim: Int, _ yoff: Int, _ ylim: Int, _ findMinimal: Bool) -> (xmid: Int, ymid: Int, loMinimal: Bool, hiMinimal: Bool) {
            let o = offset
            let dmin = xoff - ylim
            let dmax = xlim - yoff
            let fmid = xoff - yoff
            let bmid = xlim - ylim
            var fmin = fmid, fmax = fmid, bmin = bmid, bmax = bmid
            let odd = (fmid - bmid) & 1 != 0
            fd[fmid + o] = xoff
            bd[bmid + o] = xlim
            var c = 1
            while true {
                if fmin > dmin {
                    fmin -= 1
                    fd[fmin - 1 + o] = -1
                } else {
                    fmin += 1
                }
                if fmax < dmax {
                    fmax += 1
                    fd[fmax + 1 + o] = -1
                } else {
                    fmax -= 1
                }
                var d = fmax
                while d >= fmin {
                    let tlo = fd[d - 1 + o]
                    let thi = fd[d + 1 + o]
                    var x = tlo >= thi ? tlo + 1 : thi
                    var y = x - d
                    while x < xlim, y < ylim, a[x] == b[y] {
                        x += 1
                        y += 1
                    }
                    fd[d + o] = x
                    if odd, bmin <= d, d <= bmax, bd[d + o] <= x { return (x, y, true, true) }
                    d -= 2
                }
                if bmin > dmin {
                    bmin -= 1
                    bd[bmin - 1 + o] = Int.max
                } else {
                    bmin += 1
                }
                if bmax < dmax {
                    bmax += 1
                    bd[bmax + 1 + o] = Int.max
                } else {
                    bmax -= 1
                }
                d = bmax
                while d >= bmin {
                    let tlo = bd[d - 1 + o]
                    let thi = bd[d + 1 + o]
                    var x = tlo < thi ? tlo : thi - 1
                    var y = x - d
                    while x > xoff, y > yoff, a[x - 1] == b[y - 1] {
                        x -= 1
                        y -= 1
                    }
                    bd[d + o] = x
                    if !odd, fmin <= d, d <= fmax, x <= fd[d + o] { return (x, y, true, true) }
                    d -= 2
                }
                if !findMinimal, c >= tooExpensive {
                    // 代价太高：取两端走得最远的对角线作为近似中点
                    var fxybest = -1
                    var fxbest = xoff
                    d = fmax
                    while d >= fmin {
                        var x = Swift.min(fd[d + o], xlim)
                        var y = x - d
                        if ylim < y {
                            x = ylim + d
                            y = ylim
                        }
                        if fxybest < x + y {
                            fxybest = x + y
                            fxbest = x
                        }
                        d -= 2
                    }
                    var bxybest = Int.max
                    var bxbest = xlim
                    d = bmax
                    while d >= bmin {
                        var x = Swift.max(xoff, bd[d + o])
                        var y = x - d
                        if y < yoff {
                            x = yoff + d
                            y = yoff
                        }
                        if x + y < bxybest {
                            bxybest = x + y
                            bxbest = x
                        }
                        d -= 2
                    }
                    if (xlim + ylim) - bxybest < fxybest - (xoff + yoff) {
                        return (fxbest, fxybest - fxbest, true, false)
                    }
                    return (bxbest, bxybest - bxbest, false, true)
                }
                c += 1
            }
        }
    }

    // MARK: - 行内差异

    struct Token {
        var text: String
        var isSpace: Bool
        /// 在行内的 Character 偏移
        var start: Int
        var length: Int
    }

    static func isCJK(_ c: Character) -> Bool {
        guard let v = c.unicodeScalars.first?.value else { return false }
        return (0x4E00...0x9FFF).contains(v) || (0x3400...0x4DBF).contains(v) || (0x20000...0x323AF).contains(v)
            || (0xF900...0xFAFF).contains(v) || (0x3040...0x30FF).contains(v) || (0x31F0...0x31FF).contains(v)
            || (0xAC00...0xD7AF).contains(v) || (0x1100...0x11FF).contains(v) || (0x3130...0x318F).contains(v)
    }

    /// 中日韩文字逐字成词，其余按「字母数字串 / 空白串 / 单个符号」切分
    static func tokenize(_ line: String) -> [Token] {
        var out: [Token] = []
        var cur = ""
        var curStart = 0
        var curLen = 0
        var curKind = 0 // 0 无，1 单词，2 空白
        func flush() {
            if curLen > 0 { out.append(Token(text: cur, isSpace: curKind == 2, start: curStart, length: curLen)) }
            cur = ""
            curLen = 0
            curKind = 0
        }
        var pos = 0
        for ch in line {
            let kind: Int
            if isCJK(ch) {
                kind = 3
            } else if ch.isWhitespace {
                kind = 2
            } else if ch.isLetter || ch.isNumber || ch == "_" || ch.unicodeScalars.first?.properties.generalCategory == .nonspacingMark {
                kind = 1
            } else {
                kind = 4
            }
            if kind == 1 || kind == 2 {
                if curKind != kind {
                    flush()
                    curKind = kind
                    curStart = pos
                }
                cur.append(ch)
                curLen += 1
            } else {
                flush()
                out.append(Token(text: String(ch), isSpace: false, start: pos, length: 1))
            }
            pos += 1
        }
        flush()
        return out
    }

    /// 两行之间按词的差异：返回两侧改动的字符区间与相似度（0~1）
    public static func inlineChanges(_ a: String, _ b: String, ignoreWhitespace: Bool = false, ignoreCase: Bool = false) -> (old: [Range<Int>], new: [Range<Int>], similarity: Double) {
        let ta = tokenize(a).filter { !(ignoreWhitespace && $0.isSpace) }
        let tb = tokenize(b).filter { !(ignoreWhitespace && $0.isSpace) }
        let key: (Token) -> String = { ignoreCase ? $0.text.lowercased() : $0.text }
        let ops = diff(ta.map(key), tb.map(key))
        var changedA = [Bool](repeating: false, count: ta.count)
        var changedB = [Bool](repeating: false, count: tb.count)
        var i = 0
        var j = 0
        for op in ops {
            switch op {
            case .equal(let n):
                i += n
                j += n
            case .delete(let n):
                for _ in 0..<n { changedA[i] = true; i += 1 }
            case .insert(let n):
                for _ in 0..<n { changedB[j] = true; j += 1 }
            }
        }
        // 夹在两段改动之间的纯空白也算作改动，高亮更连贯
        func bridge(_ tokens: [Token], _ changed: inout [Bool]) {
            guard tokens.count > 2 else { return }
            for k in 1..<(tokens.count - 1) where !changed[k] && tokens[k].isSpace && changed[k - 1] && changed[k + 1] {
                changed[k] = true
            }
        }
        func count(_ tokens: [Token], _ changed: [Bool]) -> (common: Int, diff: Int) {
            var c = 0
            var d = 0
            for (k, t) in tokens.enumerated() where !t.isSpace {
                if changed[k] { d += 1 } else { c += 1 }
            }
            return (c, d)
        }
        let ca = count(ta, changedA)
        let cb = count(tb, changedB)
        let total = ca.common + ca.diff + cb.common + cb.diff
        let similarity = total == 0 ? 1 : Double(ca.common + cb.common) / Double(total)
        bridge(ta, &changedA)
        bridge(tb, &changedB)
        func ranges(_ tokens: [Token], _ changed: [Bool]) -> [Range<Int>] {
            var out: [Range<Int>] = []
            for (k, t) in tokens.enumerated() where changed[k] {
                let r = t.start..<(t.start + t.length)
                if let last = out.last, last.upperBound == r.lowerBound {
                    out[out.count - 1] = last.lowerBound..<r.upperBound
                } else {
                    out.append(r)
                }
            }
            return out
        }
        return (ranges(ta, changedA), ranges(tb, changedB), similarity)
    }

    /// 差异块内把删除行与新增行按相似度做保序配对（动态规划，最大化相似度之和）；块太大时按顺序配对
    static func align(_ left: [String], _ right: [String], ignoreCase: Bool) -> [(Int, Int)] {
        let n = left.count
        let m = right.count
        if n == 0 || m == 0 { return [] }
        if n * m > 40_000 { return (0..<min(n, m)).map { ($0, $0) } }
        func norm(_ s: String) -> [Character] {
            let t = s.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            return Array(ignoreCase ? t.lowercased() : t)
        }
        func bigrams(_ c: [Character]) -> [String: Int] {
            var out: [String: Int] = [:]
            if c.count > 1 { for k in 0..<(c.count - 1) { out[String(c[k]) + String(c[k + 1]), default: 0] += 1 } }
            return out
        }
        let ln = left.map(norm)
        let rn = right.map(norm)
        let lg = ln.map(bigrams)
        let rg = rn.map(bigrams)
        func dice(_ x: Int, _ y: Int) -> Double {
            let na = lg[x].values.reduce(0, +)
            let nb = rg[y].values.reduce(0, +)
            if na == 0 || nb == 0 { return ln[x] == rn[y] ? 1 : 0 }
            var common = 0
            for (k, v) in lg[x] { if let w = rg[y][k] { common += min(v, w) } }
            return Double(2 * common) / Double(na + nb)
        }
        let w = m + 1
        var score = [Double](repeating: 0, count: (n + 1) * w)
        // 0 = 配对，1 = 跳过左侧，2 = 跳过右侧
        var move = [UInt8](repeating: 2, count: (n + 1) * w)
        for x in 1...n {
            move[x * w] = 1
            for y in 1...m {
                let s = dice(x - 1, y - 1)
                var best = score[x * w + y - 1]
                var mv: UInt8 = 2
                if score[(x - 1) * w + y] > best {
                    best = score[(x - 1) * w + y]
                    mv = 1
                }
                if s >= 0.35, score[(x - 1) * w + y - 1] + s > best {
                    best = score[(x - 1) * w + y - 1] + s
                    mv = 0
                }
                score[x * w + y] = best
                move[x * w + y] = mv
            }
        }
        var pairs: [(Int, Int)] = []
        var x = n
        var y = m
        while x > 0 || y > 0 {
            let mv = x == 0 ? 2 : y == 0 ? 1 : move[x * w + y]
            if mv == 0 {
                pairs.append((x - 1, y - 1))
                x -= 1
                y -= 1
            } else if mv == 1 {
                x -= 1
            } else {
                y -= 1
            }
        }
        return pairs.reversed()
    }
}

public enum TextDiffTool {
    public static let spec = ToolSpec(
        id: "text-diff",
        name: LocalizedText("文本对比", "Text Diff"),
        summary: LocalizedText("逐行 / 逐词对比两段文本，并排或行内高亮差异。", "Compare two texts line by line and word by word, with highlighted differences."),
        category: .text,
        keywords: ["diff", "compare", "merge", "patch", "对比", "比较", "差异", "wbdb"],
        symbol: "arrow.left.arrow.right",
        input: .optional,
        inputLabel: LocalizedText("原文（左侧）", "Original text (left)"),
        fields: [
            ToolField("against", LocalizedText("对比文本（右侧）", "Changed text (right)"),
                      .text(placeholder: LocalizedText("粘贴修改后的文本", "Paste the changed text"), mono: true, multiline: true)),
            ToolField("ignoreWhitespace", LocalizedText("忽略空白", "Ignore whitespace"), .toggle, default: "0"),
            ToolField("ignoreCase", LocalizedText("忽略大小写", "Ignore case"), .toggle, default: "0"),
            ToolField("context", LocalizedText("上下文行数", "Context lines"), .number(min: 0, max: 20), default: "3"),
        ],
        customView: nil,
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let old = input.text
        let new = input.string("against")
        let ignoreWs = input.bool("ignoreWhitespace")
        let ignoreCase = input.bool("ignoreCase")
        let lines = TextDiff.lines(old, new, ignoreWhitespace: ignoreWs, ignoreCase: ignoreCase)
        let stats = TextDiff.stats(lines)
        let patch = TextDiff.unifiedPatch(old, new, context: input.int("context", default: 3))
        var notes: [ToolNote] = []
        if stats.identical {
            notes.append(ToolNote(.info, patch.isEmpty
                ? lang.t("两段文本完全相同", "The two texts are identical")
                : lang.t("忽略空白 / 大小写后没有差异", "No differences after ignoring whitespace / case")))
        } else {
            notes.append(ToolNote(.info, lang.t("新增 \(stats.added) 行，删除 \(stats.removed) 行", "\(stats.added) lines added, \(stats.removed) removed")))
        }
        if (ignoreWs || ignoreCase), !patch.isEmpty {
            notes.append(ToolNote(.info, lang.t("补丁始终按原文逐字比较，「忽略」选项只影响统计", "The patch always compares the exact text; the ignore options only affect the counts")))
        }
        if new.isEmpty, !old.isEmpty {
            notes.append(ToolNote(.warning, lang.t("对比文本为空，所有行都算作删除", "The changed text is empty, so every line counts as removed")))
        }
        let similarity = Int((stats.similarity * 100).rounded())
        return ToolResult(outputs: [
            .primary(lang.t("统一格式补丁", "Unified diff"), patch, language: "diff"),
            ToolOutput(id: "added", label: lang.t("新增行", "Added"), value: String(stats.added)),
            ToolOutput(id: "removed", label: lang.t("删除行", "Removed"), value: String(stats.removed)),
            ToolOutput(id: "unchanged", label: lang.t("未改动行", "Unchanged"), value: String(stats.unchanged)),
            ToolOutput(id: "similarity", label: lang.t("相似度", "Similarity"), value: "\(similarity)%"),
        ], notes: notes)
    }
}
