import Foundation
import XCTest
@testable import ShowMeCore

final class EditorCoreTextStatsTests: XCTestCase {
    func testWordCount() {
        let cases: [(String, Int)] = [
            ("", 0), ("   \n\t", 0), ("Hello, world!", 2), ("你好世界", 4), ("Hello 世界", 3), ("こんにちは", 5),
            ("カタカナ", 4), ("안녕하세요 world", 6), ("don't stop", 2), ("it’s fine", 2), ("e-mail 3.14 1,000", 3),
            ("café naïve", 2), ("😀 hi 👍", 1), ("foo_bar baz", 2), ("我有3个apple", 5), ("中文，标点。", 4),
            ("a.b", 2), ("end. Next", 2), ("x--y", 2), ("Привет мир", 2), ("e\u{301}cole", 1), ("〇々", 2),
            ("  leading and trailing  ", 3), ("line1\nline2\r\nline3", 3), ("rock 'n' roll", 3),
        ]
        for (text, expected) in cases {
            XCTAssertEqual(TextStats.wordCount(text), expected, text.debugDescription)
        }
        XCTAssertTrue(TextStats.isCJK(0x4E2D))
        XCTAssertTrue(TextStats.isCJK(0x20BB7)) // 扩展 B 区
        XCTAssertFalse(TextStats.isCJK(0x3002)) // 。
        XCTAssertEqual(TextStats.characterCount("e\u{301}😀中"), 3)
    }

    func testWordCountLargeText() {
        let text = String(repeating: "The quick brown fox 跳过了懒狗。\n", count: 20_000)
        XCTAssertEqual(TextStats.wordCount(text), 20_000 * (4 + 5))
    }

    func testLineCount() {
        XCTAssertEqual(TextStats.lineCount(""), 1)
        XCTAssertEqual(TextStats.lineCount("a"), 1)
        XCTAssertEqual(TextStats.lineCount("a\n"), 2)
        XCTAssertEqual(TextStats.lineCount("a\r\nb"), 2)
        XCTAssertEqual(TextStats.lineCount("a\rb\rc"), 3)
        XCTAssertEqual(TextStats.lineCount("a\n\nb"), 3)
        XCTAssertEqual(TextStats.lineCount("a\r\n\r\n"), 3)
    }

    func testLineColumn() {
        let text = "ab\ncd"
        XCTAssertTrue(TextStats.lineColumn(in: text, utf16Offset: 0) == (1, 1))
        XCTAssertTrue(TextStats.lineColumn(in: text, utf16Offset: 2) == (1, 3))
        XCTAssertTrue(TextStats.lineColumn(in: text, utf16Offset: 3) == (2, 1))
        XCTAssertTrue(TextStats.lineColumn(in: text, utf16Offset: 5) == (2, 3))
        // 越界夹紧
        XCTAssertTrue(TextStats.lineColumn(in: text, utf16Offset: -5) == (1, 1))
        XCTAssertTrue(TextStats.lineColumn(in: text, utf16Offset: 999) == (2, 3))
        // emoji 占 2 个 UTF-16 单元但只算 1 列；组合字符同理
        XCTAssertTrue(TextStats.lineColumn(in: "😀x", utf16Offset: 2) == (1, 2))
        XCTAssertTrue(TextStats.lineColumn(in: "😀x", utf16Offset: 3) == (1, 3))
        XCTAssertTrue(TextStats.lineColumn(in: "e\u{301}x", utf16Offset: 2) == (1, 2))
        XCTAssertTrue(TextStats.lineColumn(in: "👨‍👩‍👧z", utf16Offset: ("👨‍👩‍👧" as NSString).length) == (1, 2))
        // 偏移落在 emoji 中间：只算完整的字符
        XCTAssertTrue(TextStats.lineColumn(in: "😀x", utf16Offset: 1) == (1, 1))
        // CRLF / CR
        XCTAssertTrue(TextStats.lineColumn(in: "a\r\nb", utf16Offset: 3) == (2, 1))
        XCTAssertTrue(TextStats.lineColumn(in: "a\r\nb", utf16Offset: 4) == (2, 2))
        XCTAssertTrue(TextStats.lineColumn(in: "a\rb\rc", utf16Offset: 4) == (3, 1))
        XCTAssertTrue(TextStats.lineColumn(in: "中文\n第二行", utf16Offset: 5) == (2, 3))
        XCTAssertTrue(TextStats.lineColumn(in: "", utf16Offset: 0) == (1, 1))
    }

    func testLineIndex() {
        let text = "第一行\r\n😀 two\rthree\n\nlast"
        let index = LineIndex(text)
        XCTAssertEqual(index.lineCount, 5)
        XCTAssertEqual(index.lineCount, TextStats.lineCount(text))
        XCTAssertEqual(index.length, (text as NSString).length)
        XCTAssertEqual(index.lineStart(2), 5)
        XCTAssertEqual(index.contentRange(ofLine: 1), 0..<3)
        XCTAssertEqual(index.range(ofLine: 1), 0..<5)
        XCTAssertEqual(index.contentRange(ofLine: 4), index.lineStart(4)..<index.lineStart(4))
        XCTAssertEqual(index.line(at: 0), 1)
        XCTAssertEqual(index.line(at: 4), 1) // \r 与 \n 之间仍属第一行
        XCTAssertEqual(index.line(at: 5), 2)
        XCTAssertEqual(index.line(at: -1), 1)
        XCTAssertEqual(index.line(at: 10_000), 5)
        XCTAssertEqual(index.offset(line: 2, utf16Column: 3), 7)
        XCTAssertEqual(index.offset(line: 2, utf16Column: 999), index.contentRange(ofLine: 2).upperBound)
        XCTAssertTrue(index.utf16LineColumn(at: 7) == (2, 3))
        // 与逐字遍历的实现逐个偏移比对（跳过 \r\n 中间那个位置）
        let ns = text as NSString
        for offset in 0...ns.length {
            if offset > 0 && offset < ns.length && ns.character(at: offset - 1) == 0x0D && ns.character(at: offset) == 0x0A {
                continue
            }
            let a = index.lineColumn(at: offset, in: text)
            let b = TextStats.lineColumn(in: text, utf16Offset: offset)
            XCTAssertTrue(a == b, "offset \(offset): \(a) vs \(b)")
        }
        let empty = LineIndex("")
        XCTAssertEqual(empty.lineCount, 1)
        XCTAssertEqual(empty.contentRange(ofLine: 1), 0..<0)
        XCTAssertEqual(LineIndex(utf16: Array("a\nb".utf16)).lineStarts, [0, 2])
    }

    func testLineIndexLargeText() {
        let text = String(repeating: "0123456789\n", count: 100_000)
        let index = LineIndex(text)
        XCTAssertEqual(index.lineCount, 100_001)
        XCTAssertEqual(index.line(at: 11 * 54_321 + 3), 54_322)
        XCTAssertTrue(index.lineColumn(at: 11 * 99_999 + 4, in: text) == (100_000, 5))
    }
}

final class EditorCoreTextFileTests: XCTestCase {
    func testLineEndingDetect() {
        XCTAssertEqual(LineEnding.detect("a\nb"), .lf)
        XCTAssertEqual(LineEnding.detect("a\r\nb\r\n"), .crlf)
        XCTAssertEqual(LineEnding.detect("a\rb"), .cr)
        XCTAssertEqual(LineEnding.detect("a\r\nb\nc\n"), .lf) // 多数
        XCTAssertEqual(LineEnding.detect("a\r\nb\nc"), .crlf) // 并列取先出现的
        XCTAssertEqual(LineEnding.detect("a\nb\r\nc"), .lf)
        XCTAssertEqual(LineEnding.detect(""), .lf)
        XCTAssertEqual(LineEnding.detect("no newline"), .lf)
        XCTAssertTrue(LineEnding.isMixed("a\r\nb\n"))
        XCTAssertFalse(LineEnding.isMixed("a\r\nb\r\n"))
        XCTAssertTrue(LineEnding.counts("a\r\nb\nc\r") == (1, 1, 1))
        XCTAssertEqual(LineEnding.crlf.displayName, "CRLF")
        XCTAssertEqual(LineEnding.crlf.sequence, "\r\n")
        XCTAssertEqual(LineEnding.cr.description(.zh), "CR（经典 Mac OS）")
    }

    func testLineEndingConvert() {
        XCTAssertEqual(LineEnding.normalize("a\r\nb\rc\nd"), "a\nb\nc\nd")
        XCTAssertEqual(LineEnding.normalize("纯\n文本"), "纯\n文本")
        XCTAssertEqual(LineEnding.normalize("\r\r\n"), "\n\n")
        XCTAssertEqual(LineEnding.apply(.crlf, to: "a\nb\n"), "a\r\nb\r\n")
        XCTAssertEqual(LineEnding.apply(.cr, to: "a\nb"), "a\rb")
        XCTAssertEqual(LineEnding.apply(.crlf, to: "a\r\nb\nc\r"), "a\r\nb\r\nc\r\n")
        XCTAssertEqual(LineEnding.apply(.lf, to: "a\r\nb"), "a\nb")
        XCTAssertEqual(LineEnding.crlf.apply(to: "中\n文"), "中\r\n文")
        let original = "第一行\r\n😀\r\n"
        XCTAssertEqual(LineEnding.apply(LineEnding.detect(original), to: LineEnding.normalize(original)), original)
    }

    func testEncodingNames() {
        XCTAssertEqual(TextEncoding.utf8.displayName, "UTF-8")
        XCTAssertEqual(TextEncoding.utf8BOM.displayName, "UTF-8 with BOM")
        XCTAssertEqual(TextEncoding.utf16LE.displayName, "UTF-16 LE")
        XCTAssertEqual(TextEncoding.utf8BOM.displayName(.zh), "UTF-8（带 BOM）")
        XCTAssertEqual(TextEncoding.gb18030.displayName(.en), "GB18030 (Simplified Chinese)")
        XCTAssertEqual(TextEncoding(rawValue: "utf16BE"), .utf16BE)
        let data = try? JSONEncoder().encode([TextEncoding.gb18030])
        XCTAssertEqual(data.flatMap { String(data: $0, encoding: .utf8) }, #"["gb18030"]"#)
    }

    func testDecodeBOMsAndUTF8() {
        XCTAssertTrue(TextFile.decode([])! == ("", .utf8))
        let text = "中文 abc 😀"
        XCTAssertTrue(TextFile.decode(Array(text.utf8))! == (text, .utf8))
        XCTAssertTrue(TextFile.decode([0xEF, 0xBB, 0xBF] + Array(text.utf8))! == (text, .utf8BOM))
        let le: [UInt8] = [0xFF, 0xFE, 0x2D, 0x4E, 0x3D, 0xD8, 0x00, 0xDE, 0x41, 0x00] // 中😀A
        XCTAssertTrue(TextFile.decode(le)! == ("中😀A", .utf16LE))
        let be: [UInt8] = [0xFE, 0xFF, 0x4E, 0x2D, 0xD8, 0x3D, 0xDE, 0x00, 0x00, 0x41]
        XCTAssertTrue(TextFile.decode(be)! == ("中😀A", .utf16BE))
        XCTAssertTrue(TextFile.decode([0xFF, 0xFE])! == ("", .utf16LE))
    }

    func testUTF8Validation() {
        XCTAssertTrue(TextFile.isValidUTF8(Array("ASCII 中文 😀 é".utf8)))
        XCTAssertTrue(TextFile.isValidUTF8([UInt8]()))
        XCTAssertTrue(TextFile.isValidUTF8([0xF4, 0x8F, 0xBF, 0xBF])) // U+10FFFF
        XCTAssertFalse(TextFile.isValidUTF8([0xC0, 0xAF]))             // 过长编码
        XCTAssertFalse(TextFile.isValidUTF8([0xE0, 0x80, 0xAF]))       // 过长编码
        XCTAssertFalse(TextFile.isValidUTF8([0xED, 0xA0, 0x80]))       // 代理区
        XCTAssertFalse(TextFile.isValidUTF8([0xF4, 0x90, 0x80, 0x80])) // 超过 U+10FFFF
        XCTAssertFalse(TextFile.isValidUTF8([0xE4, 0xB8]))             // 截断
        XCTAssertFalse(TextFile.isValidUTF8([0x80]))                   // 孤立续字节
        XCTAssertFalse(TextFile.isValidUTF8([0xE4, 0x41, 0xAD]))       // 续字节不对
        XCTAssertFalse(TextFile.isValidUTF8([0xFF]))
        XCTAssertTrue(TextFile.isValidUTF8(Array("ab".utf8)[...]))
    }

    func testInvalidUTF8FallsBack() {
        // "café" 的 Latin-1 字节：E9 后面没有续字节，不是 UTF-8，也不是合法 GB18030
        let latin: [UInt8] = [0x63, 0x61, 0x66, 0xE9]
        XCTAssertTrue(TextFile.decode(latin)! == ("café", .latin1))
        XCTAssertTrue(TextFile.decode([0x41, 0xFF, 0x42])! == ("A\u{FF}B", .latin1))
        // "中文" 的 GB18030 字节
        let gb: [UInt8] = [0xD6, 0xD0, 0xCE, 0xC4]
        #if canImport(Darwin)
        XCTAssertTrue(TextFile.decode(gb)! == ("中文", .gb18030))
        XCTAssertEqual(TextFile.encode("中文", as: .gb18030), gb)
        #else
        XCTAssertTrue(TextFile.decode(gb)! == ("\u{D6}\u{D0}\u{CE}\u{C4}", .latin1))
        XCTAssertNil(TextFile.encode("中文", as: .gb18030))
        XCTAssertFalse(TextEncoding.gb18030.isAvailable)
        #endif
    }

    func testEncodeRoundTrips() {
        let text = "Hello 中文 😀\nline2"
        for encoding in TextEncoding.allCases where encoding != .latin1 && encoding.isAvailable {
            guard let bytes = TextFile.encode(text, as: encoding) else {
                XCTFail("\(encoding) 编码失败")
                continue
            }
            let decoded = TextFile.decode(bytes)
            XCTAssertEqual(decoded?.0, text, "\(encoding)")
            XCTAssertEqual(decoded?.1, encoding, "\(encoding)")
        }
        XCTAssertEqual(TextFile.encode("A", as: .utf16LE), [0xFF, 0xFE, 0x41, 0x00])
        XCTAssertEqual(TextFile.encode("A", as: .utf16BE), [0xFE, 0xFF, 0x00, 0x41])
        XCTAssertEqual(TextFile.encode("A", as: .utf8BOM), [0xEF, 0xBB, 0xBF, 0x41])
        // Latin-1：能表示的往返，不能表示的返回 nil
        XCTAssertEqual(TextFile.encode("café ÿ", as: .latin1), [0x63, 0x61, 0x66, 0xE9, 0x20, 0xFF])
        XCTAssertTrue(TextFile.decode([0x63, 0x61, 0x66, 0xE9, 0x20, 0xFF])! == ("café ÿ", .latin1))
        XCTAssertNil(TextFile.encode("中", as: .latin1))
    }

    func testReadWriteKeepsFormat() {
        let bytes: [UInt8] = [0xEF, 0xBB, 0xBF] + Array("第一行\r\n第二行\r\n".utf8)
        guard let contents = TextFile.read(bytes) else { return XCTFail("读取失败") }
        XCTAssertEqual(contents, TextFile.Contents(text: "第一行\n第二行\n", encoding: .utf8BOM, lineEnding: .crlf))
        XCTAssertEqual(TextFile.write(contents.text, encoding: contents.encoding, lineEnding: contents.lineEnding), bytes)
        // UTF-16 + CR
        let utf16 = TextFile.encode("a\rb", as: .utf16LE)!
        let c2 = TextFile.read(utf16)
        XCTAssertEqual(c2, TextFile.Contents(text: "a\nb", encoding: .utf16LE, lineEnding: .cr))
        XCTAssertEqual(TextFile.write("a\nb", encoding: .utf16LE, lineEnding: .cr), utf16)
        XCTAssertNil(TextFile.write("中", encoding: .latin1, lineEnding: .lf))
    }

    func testIsProbablyBinary() {
        let png: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]
        XCTAssertTrue(TextFile.isProbablyBinary(png))
        XCTAssertFalse(TextFile.isProbablyBinary([]))
        XCTAssertFalse(TextFile.isProbablyBinary(Array("普通文本\n\tTabs and CRLF\r\n".utf8)))
        XCTAssertFalse(TextFile.isProbablyBinary(TextFile.encode("hi 中文", as: .utf16LE)!)) // 有 NUL 但带 BOM
        XCTAssertFalse(TextFile.isProbablyBinary(TextFile.encode("hi", as: .utf16BE)!))
        XCTAssertFalse(TextFile.isProbablyBinary(Array("\u{1B}[31mred\u{1B}[0m log line\n".utf8))) // 终端颜色码
        XCTAssertTrue(TextFile.isProbablyBinary([0x01, 0x02, 0x03, 0x04, 0x41, 0x42, 0x43, 0x44, 0x45]))
        XCTAssertFalse(TextFile.isProbablyBinary([0x01] + Array(repeating: UInt8(0x41), count: 100)))
        // NUL 在 8 KB 之后不看
        XCTAssertFalse(TextFile.isProbablyBinary(Array(repeating: UInt8(0x41), count: 9000) + [0x00]))
        XCTAssertFalse(TextFile.isProbablyBinary([0xD6, 0xD0, 0xCE, 0xC4])) // GB18030 文本
    }

    func testIndentationHelpers() {
        XCTAssertEqual(TextFile.indentation(of: "    foo"), "    ")
        XCTAssertEqual(TextFile.indentation(of: "\t\tbar"), "\t\t")
        XCTAssertEqual(TextFile.indentation(of: " \t mixed"), " \t ")
        XCTAssertEqual(TextFile.indentation(of: "x"), "")
        XCTAssertEqual(TextFile.indentation(of: Substring("  sub")), "  ")
        XCTAssertEqual(TextFile.indentUnit(useTabs: true, width: 4), "\t")
        XCTAssertEqual(TextFile.indentUnit(useTabs: false, width: 2), "  ")
        XCTAssertEqual(TextFile.nextLineIndentation(after: "  if x {", unit: "  "), "    ")
        XCTAssertEqual(TextFile.nextLineIndentation(after: "  call(  ", unit: "    "), "      ")
        XCTAssertEqual(TextFile.nextLineIndentation(after: "  foo", unit: "  "), "  ")
        XCTAssertEqual(TextFile.nextLineIndentation(after: "def f():", unit: "    ", increaseAfterColon: true), "    ")
        XCTAssertEqual(TextFile.nextLineIndentation(after: "def f():", unit: "    "), "")
        XCTAssertEqual(TextFile.nextLineIndentation(after: "   ", unit: "  "), "   ")
    }

    func testDetectIndent() {
        let js2 = "function f() {\n  if (x) {\n    y();\n  }\n}\n/**\n * 文档\n */\n"
        XCTAssertTrue(TextFile.detectIndent(js2) == (false, 2))
        let py4 = "class A:\n    def f(self):\n        return 1\n\n    def g(self):\n        pass\n"
        XCTAssertTrue(TextFile.detectIndent(py4) == (false, 4))
        let go = "func main() {\n\tif x {\n\t\treturn\n\t}\n}\n"
        XCTAssertTrue(TextFile.detectIndent(go).useTabs)
        XCTAssertTrue(TextFile.detectIndent("") == (false, 4))
        XCTAssertTrue(TextFile.detectIndent("no indent\nat all\n") == (false, 4))
        let yaml = "a:\n  b:\n    c: 1\n  d: 2\r\ne:\r\n  - x\r\n"
        XCTAssertTrue(TextFile.detectIndent(yaml) == (false, 2))
        let eight = "a {\n        b\n}\nc {\n        d\n}\n"
        XCTAssertTrue(TextFile.detectIndent(eight) == (false, 8))
    }
}
