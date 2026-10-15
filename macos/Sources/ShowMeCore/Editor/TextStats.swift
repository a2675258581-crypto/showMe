import Foundation

// 文本统计：字数（中日韩每字一词）、行数、行列号；LineIndex 用于反复按偏移查行。
// 换行符认 \n、\r\n、\r 三种（\r\n 算一个）。

public enum TextStats {
    /// 字数：每个汉字 / 假名 / 谚文算一个词；连续的字母、数字（含 don't、e-mail、3.14 这类内部连接符）算一个词。
    /// 用于状态栏的「412 字」/「412 words」。
    public static func wordCount(_ text: String) -> Int {
        var count = 0
        var inWord = false
        var joinerPending = false
        var lastWasDigit = false
        for scalar in text.unicodeScalars {
            let v = scalar.value
            if v < 0x80 {
                // ASCII 快速路径
                let isLetter = (v >= 0x61 && v <= 0x7A) || (v >= 0x41 && v <= 0x5A)
                let isDigit = v >= 0x30 && v <= 0x39
                if isLetter || isDigit {
                    if !inWord { count += 1 }
                    inWord = true
                    joinerPending = false
                    lastWasDigit = isDigit
                    continue
                }
                if inWord && !joinerPending && (v == 0x27 || v == 0x2D || v == 0x5F || ((v == 0x2E || v == 0x2C) && lastWasDigit)) {
                    joinerPending = true
                    continue
                }
                inWord = false
                joinerPending = false
                continue
            }
            if isCJK(v) {
                count += 1
                inWord = false
                joinerPending = false
                continue
            }
            let props = scalar.properties
            if props.isAlphabetic || props.numericType != nil {
                if !inWord { count += 1 }
                inWord = true
                joinerPending = false
                lastWasDigit = props.numericType != nil
                continue
            }
            switch props.generalCategory {
            case .nonspacingMark, .spacingMark, .enclosingMark:
                // 组合符号跟随前一个字母
                if inWord { continue }
            default:
                break
            }
            if inWord && !joinerPending && v == 0x2019 { // ’
                joinerPending = true
                continue
            }
            inWord = false
            joinerPending = false
        }
        return count
    }

    /// 汉字（含扩展区、兼容区）、假名、谚文
    public static func isCJK(_ v: UInt32) -> Bool {
        switch v {
        case 0x4E00...0x9FFF, 0x3400...0x4DBF, 0xF900...0xFAFF, 0x20000...0x2FA1F, 0x30000...0x323AF,
             0x3005...0x3007, // 々 〆 〇
             0x3041...0x3096, 0x309D...0x309F, // 平假名
             0x30A1...0x30FA, 0x30FC...0x30FF, 0x31F0...0x31FF, 0xFF66...0xFF9F, // 片假名
             0xAC00...0xD7AF, 0x1100...0x11FF, 0x3131...0x318E, 0xA960...0xA97F, 0xD7B0...0xD7FF: // 谚文
            return true
        default:
            return false
        }
    }

    /// 行数：换行符个数 + 1（空文本算 1 行，末尾换行后的空行也算）
    public static func lineCount(_ text: String) -> Int {
        var lines = 1
        var previousCR = false
        for byte in text.utf8 {
            if byte == 0x0A {
                if !previousCR { lines += 1 }
                previousCR = false
            } else if byte == 0x0D {
                lines += 1
                previousCR = true
            } else {
                previousCR = false
            }
        }
        return lines
    }

    /// 字符数（字素簇，与用户看到的「字」一致）
    public static func characterCount(_ text: String) -> Int {
        text.count
    }

    /// UTF-16 偏移 → 1 起始的行号与列号。列按字素簇计数（emoji、组合字符都算一列）。
    /// 偏移越界时夹到 [0, 长度]。
    public static func lineColumn(in text: String, utf16Offset: Int) -> (line: Int, column: Int) {
        let utf16 = text.utf16
        let target = min(max(utf16Offset, 0), utf16.count)
        var line = 1
        var pos = 0
        var lineStartPos = 0
        var lineStart = utf16.startIndex
        var index = utf16.startIndex
        var previousCR = false
        while pos < target {
            let c = utf16[index]
            index = utf16.index(after: index)
            pos += 1
            if c == 0x0A {
                if !previousCR { line += 1 }
                lineStart = index
                lineStartPos = pos
                previousCR = false
            } else if c == 0x0D {
                line += 1
                lineStart = index
                lineStartPos = pos
                previousCR = true
            } else {
                previousCR = false
            }
        }
        return (line, graphemeColumn(text, lineStart: lineStart, utf16Length: target - lineStartPos))
    }

    /// 从行首起 utf16Length 个 UTF-16 单元内完整的字素簇个数 + 1
    static func graphemeColumn(_ text: String, lineStart: String.Index, utf16Length: Int) -> Int {
        guard utf16Length > 0 else { return 1 }
        var column = 1
        var consumed = 0
        for character in text[lineStart...] {
            let n = character.utf16.count
            if consumed + n > utf16Length { break }
            consumed += n
            column += 1
            if consumed == utf16Length { break }
        }
        return column
    }
}

/// 行起点索引（UTF-16 偏移），建一次后按偏移查行是 O(log n)。
public struct LineIndex: Sendable, Hashable {
    /// 每行起点
    public private(set) var lineStarts: [Int]
    /// 每行内容结束位置（不含换行符）
    public private(set) var lineEnds: [Int]
    /// 文本的 UTF-16 长度
    public private(set) var length: Int

    public init(_ text: String) {
        self.init(utf16: text.utf16)
    }

    public init<C: Collection>(utf16: C) where C.Element == UInt16 {
        var starts = [0]
        var ends: [Int] = []
        var pos = 0
        var previousCR = false
        for c in utf16 {
            pos += 1
            if c == 0x0A {
                if previousCR {
                    starts[starts.count - 1] = pos
                } else {
                    ends.append(pos - 1)
                    starts.append(pos)
                }
                previousCR = false
            } else if c == 0x0D {
                ends.append(pos - 1)
                starts.append(pos)
                previousCR = true
            } else {
                previousCR = false
            }
        }
        ends.append(pos)
        lineStarts = starts
        lineEnds = ends
        length = pos
    }

    public var lineCount: Int { lineStarts.count }

    /// 偏移所在的行（1 起始）；越界时夹到首行 / 末行
    public func line(at utf16Offset: Int) -> Int {
        let offset = min(max(utf16Offset, 0), length)
        // 最后一个 start <= offset 的行
        var lo = 0
        var hi = lineStarts.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if lineStarts[mid] <= offset { lo = mid } else { hi = mid - 1 }
        }
        return lo + 1
    }

    private func clampedLine(_ line: Int) -> Int { min(max(line, 1), lineStarts.count) - 1 }

    /// 第 line 行（1 起始）的起点
    public func lineStart(_ line: Int) -> Int { lineStarts[clampedLine(line)] }

    /// 第 line 行内容的范围（不含换行符）
    public func contentRange(ofLine line: Int) -> Range<Int> {
        let k = clampedLine(line)
        return lineStarts[k]..<lineEnds[k]
    }

    /// 第 line 行含换行符的范围
    public func range(ofLine line: Int) -> Range<Int> {
        let k = clampedLine(line)
        let stop = k + 1 < lineStarts.count ? lineStarts[k + 1] : length
        return lineStarts[k]..<stop
    }

    /// 1 起始的行号 + 1 起始的 UTF-16 列 → 偏移（列超出行尾时停在行尾）
    public func offset(line: Int, utf16Column: Int) -> Int {
        let r = contentRange(ofLine: line)
        return min(r.lowerBound + max(utf16Column - 1, 0), r.upperBound)
    }

    /// 1 起始的行号与 UTF-16 列
    public func utf16LineColumn(at utf16Offset: Int) -> (line: Int, column: Int) {
        let offset = min(max(utf16Offset, 0), length)
        let line = line(at: offset)
        return (line, offset - lineStarts[line - 1] + 1)
    }

    /// 行号 + 按字素簇计数的列（需要原文；只遍历所在行）
    public func lineColumn(at utf16Offset: Int, in text: String) -> (line: Int, column: Int) {
        let offset = min(max(utf16Offset, 0), length)
        let line = line(at: offset)
        let start = lineStarts[line - 1]
        let utf16 = text.utf16
        guard start <= utf16.count, let startIndex = utf16.index(utf16.startIndex, offsetBy: start, limitedBy: utf16.endIndex) else {
            return (line, 1)
        }
        return (line, TextStats.graphemeColumn(text, lineStart: startIndex, utf16Length: offset - start))
    }
}
