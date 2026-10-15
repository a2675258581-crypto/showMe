import XCTest
@testable import ShowMeCore

final class NetworkTextDiffTests: XCTestCase {
    /// 简单的补丁应用器（验证生成的统一格式补丁可以还原出新文本）
    func apply(_ old: String, _ patch: String) -> String? {
        var oldLines: [(String, Bool)] = []
        if !old.isEmpty {
            let parts = old.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            for (k, p) in parts.enumerated() {
                if k == parts.count - 1 {
                    if !p.isEmpty { oldLines.append((p, false)) }
                } else {
                    oldLines.append((p, true))
                }
            }
        }
        if patch.isEmpty { return old }
        var out: [(String, Bool)] = []
        var pos = 0
        var lines = patch.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        if lines.last == "" { lines.removeLast() }
        var k = 2
        while k < lines.count {
            let header = lines[k]
            guard header.hasPrefix("@@ -") else { return nil }
            let nums = header.dropFirst(4).split(separator: " ")[0].split(separator: ",")
            guard let start = Int(nums[0]), let count = Int(nums[1]) else { return nil }
            let from = count == 0 ? start : start - 1
            while pos < from {
                out.append(oldLines[pos])
                pos += 1
            }
            k += 1
            while k < lines.count, !lines[k].hasPrefix("@@") {
                let l = lines[k]
                let body = String(l.dropFirst())
                switch l.first {
                case " ":
                    guard pos < oldLines.count, oldLines[pos].0 == body else { return nil }
                    out.append((body, true))
                    pos += 1
                case "-":
                    guard pos < oldLines.count, oldLines[pos].0 == body else { return nil }
                    pos += 1
                case "+":
                    out.append((body, true))
                case "\\":
                    // 前一行没有换行：可能属于原文（删除 / 上下文）或新文
                    if lines[k - 1].first == "-" {
                        break
                    }
                    if let last = out.indices.last { out[last].1 = false }
                default:
                    return nil
                }
                k += 1
            }
        }
        while pos < oldLines.count {
            out.append(oldLines[pos])
            pos += 1
        }
        return out.map { $0.0 + ($0.1 ? "\n" : "") }.joined()
    }

    func kinds(_ lines: [DiffLine]) -> String {
        lines.map { $0.kind == .equal ? "=" : $0.kind == .insert ? "+" : "-" }.joined()
    }

    func testSplitLines() {
        XCTAssertEqual(TextDiff.splitLines(""), [])
        XCTAssertEqual(TextDiff.splitLines("a\nb\n"), ["a", "b"])
        XCTAssertEqual(TextDiff.splitLines("a\r\nb\rc"), ["a", "b", "c"])
        XCTAssertEqual(TextDiff.splitLines("a\n\n"), ["a", ""])
    }

    func testLineDiff() {
        let d = TextDiff.lines("one\ntwo\nthree\n中文", "one\n2\nthree\n中文 😀\nfour")
        XCTAssertEqual(kinds(d), "=-+=-++")
        XCTAssertEqual(d[1].text, "two")
        XCTAssertEqual(d[1].oldLineNumber, 2)
        XCTAssertNil(d[1].newLineNumber)
        XCTAssertEqual(d[2].newLineNumber, 2)
        XCTAssertEqual(d.last?.text, "four")
        XCTAssertEqual(d.last?.newLineNumber, 5)
        let s = TextDiff.stats(d)
        XCTAssertEqual(s.added, 3)
        XCTAssertEqual(s.removed, 2)
        XCTAssertEqual(s.unchanged, 2)
        XCTAssertFalse(s.identical)

        XCTAssertTrue(TextDiff.stats(TextDiff.lines("a\nb", "a\nb\n")).identical)
        XCTAssertEqual(kinds(TextDiff.lines("", "")), "")
        XCTAssertEqual(kinds(TextDiff.lines("", "a\nb")), "++")
        XCTAssertEqual(kinds(TextDiff.lines("a\nb", "")), "--")
        XCTAssertEqual(kinds(TextDiff.lines("x\r\ny", "x\ny")), "==")
    }

    func testIgnoreOptions() {
        XCTAssertEqual(kinds(TextDiff.lines("Hello World\nfoo", "hello   world\nfoo", ignoreWhitespace: true, ignoreCase: true)), "==")
        XCTAssertEqual(kinds(TextDiff.lines("Hello World", "hello world", ignoreCase: true)), "=")
        XCTAssertEqual(kinds(TextDiff.lines("a b", "ab", ignoreWhitespace: true)), "=")
        XCTAssertEqual(kinds(TextDiff.lines("a b", "ab")), "-+")
        // 未改动行显示新文本
        XCTAssertEqual(TextDiff.lines("ABC", "abc", ignoreCase: true).first?.text, "abc")
    }

    func testMinimalDiff() {
        // 插入一行时不应把后面的所有行都标成改动
        let a = (1...50).map { "line \($0)" }.joined(separator: "\n")
        var bl = (1...50).map { "line \($0)" }
        bl.insert("inserted", at: 25)
        bl[40] = "changed"
        let d = TextDiff.lines(a, bl.joined(separator: "\n"))
        XCTAssertEqual(TextDiff.stats(d).added, 2)
        XCTAssertEqual(TextDiff.stats(d).removed, 1)
        XCTAssertEqual(TextDiff.stats(d).unchanged, 49)
        // 重复行
        func common<T: Hashable>(_ x: [T], _ y: [T]) -> Int {
            TextDiff.diff(x, y).reduce(0) { n, op in
                if case .equal(let k) = op { return n + k }
                return n
            }
        }
        XCTAssertEqual(common(["a", "a", "b", "a"], ["a", "b", "a", "a"]), 3)
        XCTAssertEqual(common(Array("abcabba"), Array("cbabac")), 4)
        // 与动态规划求出的最长公共子序列长度一致（结果是最短编辑）
        func lcs(_ x: [Character], _ y: [Character]) -> Int {
            var dp = [[Int]](repeating: [Int](repeating: 0, count: y.count + 1), count: x.count + 1)
            for i in 0..<x.count {
                for j in 0..<y.count {
                    dp[i + 1][j + 1] = x[i] == y[j] ? dp[i][j] + 1 : max(dp[i][j + 1], dp[i + 1][j])
                }
            }
            return dp[x.count][y.count]
        }
        var seed: UInt64 = 99
        func rnd(_ n: Int) -> Int {
            seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return Int((seed >> 33) % UInt64(n))
        }
        let alphabet = Array("abcd")
        for _ in 0..<300 {
            let x = (0..<rnd(30)).map { _ in alphabet[rnd(4)] }
            let y = (0..<rnd(30)).map { _ in alphabet[rnd(4)] }
            XCTAssertEqual(common(x, y), lcs(x, y), "\(String(x)) / \(String(y))")
        }
    }

    func testInlineChanges() {
        let d = TextDiff.lines("the quick brown fox", "the quick red fox")
        XCTAssertEqual(kinds(d), "-+")
        XCTAssertEqual(d[0].changes, [10..<15])
        XCTAssertEqual(d[1].changes, [10..<13])
        let cjk = TextDiff.inlineChanges("我爱北京", "我爱上海")
        XCTAssertEqual(cjk.old, [2..<4])
        XCTAssertEqual(cjk.new, [2..<4])
        // 两个改动词之间的空白也算改动
        XCTAssertEqual(TextDiff.inlineChanges("a b c d", "a x y d").new, [2..<5])
        // 完全不同的两行不给行内高亮
        let diff = TextDiff.lines("completely different", "nothing alike here")
        XCTAssertTrue(diff.allSatisfy { $0.changes.isEmpty })
        // 插入一行 + 修改一行：修改的那一行要对上
        let aligned = TextDiff.lines("alpha\nbeta gamma\nomega", "alpha\nnew line\nbeta gamma!\nomega")
        XCTAssertEqual(kinds(aligned), "=-++=")
        XCTAssertEqual(aligned[3].text, "beta gamma!")
        XCTAssertEqual(aligned[3].changes, [10..<11])
        XCTAssertTrue(aligned[2].changes.isEmpty)
        XCTAssertEqual(TextDiff.inlineChanges("👨‍👩‍👧 a", "👨‍👩‍👧 b").new, [2..<3])
    }

    func testUnifiedPatch() throws {
        let a = "one\ntwo\nthree\n中文\n"
        let b = "one\n2\nthree\n中文 😀\nfour\n"
        let patch = TextDiff.unifiedPatch(a, b)
        XCTAssertTrue(patch.hasPrefix("--- original.txt\n+++ modified.txt\n@@ -1,4 +1,5 @@\n"))
        XCTAssertTrue(patch.contains("\n-two\n+2\n"))
        XCTAssertEqual(apply(a, patch), b)
        XCTAssertTrue(TextDiff.unifiedPatch("a", "b", oldName: "x.md", newName: "y.md").hasPrefix("--- x.md\n+++ y.md\n"))
        XCTAssertEqual(TextDiff.unifiedPatch("same\n", "same\n"), "")
        // 空白差异、CRLF、末尾换行都要精确
        let pairs = [
            ("a\n  b\nc\n", "a\nb\nc\n"), ("x\r\ny\r\n", "x\r\nz\r\n"), ("a\nb", "a\nb\n"), ("a\nb\n", "a\nb"), ("a", "b"),
            ("", "new\n"), ("old\n", ""), ("1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n", "1\nX\n3\n4\n5\n6\n7\n8\n9\n10\nY\n12\n"),
        ]
        for (x, y) in pairs {
            let p = TextDiff.unifiedPatch(x, y)
            XCTAssertEqual(apply(x, p), y, "patch:\n\(p)")
        }
        let far = TextDiff.unifiedPatch("1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n", "1\nX\n3\n4\n5\n6\n7\n8\n9\n10\nY\n12\n")
        XCTAssertEqual(far.components(separatedBy: "\n@@").count, 3)
        XCTAssertTrue(TextDiff.unifiedPatch("", "new\n").contains("@@ -0,0 +1,1 @@"))
        XCTAssertTrue(TextDiff.unifiedPatch("a", "b").contains("\\ No newline at end of file"))
    }

    func testRandomPatchesApply() {
        var seed: UInt64 = 7
        func rnd(_ n: Int) -> Int {
            seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return Int((seed >> 33) % UInt64(n))
        }
        let words = ["a", "b", "c", "中", "", " ", "x y"]
        for _ in 0..<200 {
            let a = (0..<rnd(15)).map { _ in words[rnd(words.count)] }.joined(separator: "\n") + (rnd(2) == 0 ? "\n" : "")
            let b = (0..<rnd(15)).map { _ in words[rnd(words.count)] }.joined(separator: "\n") + (rnd(2) == 0 ? "\n" : "")
            let p = TextDiff.unifiedPatch(a, b, context: rnd(4))
            XCTAssertEqual(apply(a, p), b, "a=\(a.debugDescription) b=\(b.debugDescription)\n\(p)")
            // 行级对比的两侧都能还原
            let lines = TextDiff.lines(a, b)
            XCTAssertEqual(lines.filter { $0.kind != .insert }.count, TextDiff.splitLines(a).count)
            XCTAssertEqual(lines.filter { $0.kind != .delete }.map(\.text), TextDiff.splitLines(b))
        }
    }

    func testLargeInputs() {
        // 1 万行，零散修改
        var a: [String] = []
        for i in 0..<10_000 { a.append("line \(i) " + String(repeating: "x", count: i % 7)) }
        var b = a
        for i in stride(from: 5, to: 10_000, by: 97) { b[i] = "changed \(i)" }
        b.insert(contentsOf: ["new 1", "new 2"], at: 5000)
        b.removeSubrange(8000..<8010)
        var start = Date()
        let d = TextDiff.lines(a.joined(separator: "\n"), b.joined(separator: "\n"))
        XCTAssertLessThan(Date().timeIntervalSince(start), 20)
        let s = TextDiff.stats(d)
        XCTAssertEqual(s.unchanged + s.removed, 10_000)
        XCTAssertEqual(s.unchanged + s.added, b.count)
        XCTAssertLessThan(s.removed, 130)
        // 完全不同的两段大文本
        let x = (0..<10_000).map { "a\($0)" }.joined(separator: "\n")
        let y = (0..<10_000).map { "b\($0)" }.joined(separator: "\n")
        start = Date()
        let dd = TextDiff.lines(x, y)
        XCTAssertLessThan(Date().timeIntervalSince(start), 20)
        XCTAssertEqual(TextDiff.stats(dd).removed, 10_000)
        // 大量重复行重新排序
        let r1 = (0..<4000).map { "v\($0 % 50)" }
        let r2 = r1.reversed().map { $0 }
        start = Date()
        let rd = TextDiff.diff(r1, r2)
        XCTAssertLessThan(Date().timeIntervalSince(start), 20)
        var i = 0
        var j = 0
        for op in rd {
            switch op {
            case .equal(let n):
                XCTAssertEqual(Array(r1[i..<(i + n)]), Array(r2[j..<(j + n)]))
                i += n
                j += n
            case .delete(let n): i += n
            case .insert(let n): j += n
            }
        }
        XCTAssertEqual(i, r1.count)
        XCTAssertEqual(j, r2.count)
    }

    func testTool() throws {
        let tool = TextDiffTool.spec
        let r = try tool("one\ntwo\nthree\n", options: ["against": "one\n2\nthree\n"])
        XCTAssertEqual(r.primary?.language, "diff")
        XCTAssertEqual(r.primary?.value, "--- original.txt\n+++ modified.txt\n@@ -1,3 +1,3 @@\n one\n-two\n+2\n three\n")
        func value(_ id: String) -> String? { r.outputs.first { $0.id == id }?.value }
        XCTAssertEqual(value("added"), "1")
        XCTAssertEqual(value("removed"), "1")
        XCTAssertEqual(value("unchanged"), "2")
        XCTAssertEqual(r.notes.first?.message, "新增 1 行，删除 1 行")
        let same = try tool("a\nb", options: ["against": "a\nb"], lang: .en)
        XCTAssertEqual(same.notes.first?.message, "The two texts are identical")
        XCTAssertEqual(same.primary?.value, "")
        let ws = try tool("a  b", options: ["against": "a b", "ignoreWhitespace": "1"], lang: .en)
        XCTAssertEqual(ws.notes.first?.message, "No differences after ignoring whitespace / case")
        XCTAssertTrue(ws.primary?.value.contains("-a  b") ?? false)
        let ctx = try tool("1\n2\n3\n4\n5\n6\n7\n", options: ["against": "1\n2\n3\nX\n5\n6\n7\n", "context": "1"])
        XCTAssertTrue(ctx.primary?.value.contains("@@ -3,3 +3,3 @@") ?? false)
        let empty = try tool("a\nb", options: [:])
        XCTAssertTrue(empty.notes.contains { $0.level == .warning })
    }
}
