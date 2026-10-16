import Foundation

/// 编辑器的查找与替换（⌘F）：普通文本 / 全词 / 正则，返回 UTF-16 范围（与 NSTextView 一致）。
public struct TextSearchOptions: Hashable, Sendable {
    public var caseSensitive: Bool
    public var wholeWord: Bool
    public var regex: Bool

    public init(caseSensitive: Bool = false, wholeWord: Bool = false, regex: Bool = false) {
        self.caseSensitive = caseSensitive
        self.wholeWord = wholeWord
        self.regex = regex
    }
}

public struct TextSearchError: Error, Hashable, Sendable {
    public var message: LocalizedText
}

public enum TextSearch {
    /// 把查找内容编译成正则；普通文本会先转义。
    public static func expression(for query: String, options: TextSearchOptions) throws -> NSRegularExpression {
        var pattern = options.regex ? query : NSRegularExpression.escapedPattern(for: query)
        if options.wholeWord {
            // 前后不能紧挨着字母、数字或下划线（比 \b 更适合中英文混排）
            pattern = "(?<![\\p{L}\\p{N}_])(?:" + pattern + ")(?![\\p{L}\\p{N}_])"
        }
        var flags: NSRegularExpression.Options = [.anchorsMatchLines]
        if !options.caseSensitive { flags.insert(.caseInsensitive) }
        do {
            return try NSRegularExpression(pattern: pattern, options: flags)
        } catch {
            throw TextSearchError(message: LocalizedText("正则表达式有误", "Invalid regular expression"))
        }
    }

    /// 全部匹配（最多 limit 个）
    public static func matches(in text: String, query: String, options: TextSearchOptions, limit: Int = 10_000) throws -> [NSRange] {
        guard !query.isEmpty else { return [] }
        let regex = try expression(for: query, options: options)
        var result: [NSRange] = []
        let full = NSRange(location: 0, length: (text as NSString).length)
        regex.enumerateMatches(in: text, options: [], range: full) { match, _, stop in
            guard let range = match?.range, range.location != NSNotFound else { return }
            result.append(range)
            if result.count >= limit { stop.pointee = true }
        }
        return result
    }

    /// 某一处匹配替换成什么：正则模式支持 $0、$1…、\n、\t；普通模式按字面替换。
    public static func replacement(
        for range: NSRange,
        in text: String,
        query: String,
        template: String,
        options: TextSearchOptions
    ) throws -> String {
        guard options.regex else { return template }
        let regex = try expression(for: query, options: options)
        let length = (text as NSString).length
        guard range.location != NSNotFound, NSMaxRange(range) <= length else { return template }
        let searchRange = NSRange(location: range.location, length: length - range.location)
        guard let match = regex.firstMatch(
            in: text,
            options: [.withTransparentBounds, .withoutAnchoringBounds],
            range: searchRange
        ), match.range == range else {
            return template
        }
        return regex.replacementString(for: match, in: text, offset: 0, template: regexTemplate(template))
    }

    /// 全部替换，返回新文本与替换次数
    public static func replaceAll(
        in text: String,
        query: String,
        template: String,
        options: TextSearchOptions
    ) throws -> (text: String, count: Int) {
        guard !query.isEmpty else { return (text, 0) }
        let regex = try expression(for: query, options: options)
        let full = NSRange(location: 0, length: (text as NSString).length)
        let count = regex.numberOfMatches(in: text, options: [], range: full)
        guard count > 0 else { return (text, 0) }
        let tmpl = options.regex ? regexTemplate(template) : NSRegularExpression.escapedTemplate(for: template)
        return (regex.stringByReplacingMatches(in: text, options: [], range: full, withTemplate: tmpl), count)
    }

    /// 正则替换模板：\n、\t 转成真正的换行和制表符，其余（$1、\$、\\）交给 NSRegularExpression。
    static func regexTemplate(_ template: String) -> String {
        var out = ""
        var escaping = false
        for ch in template {
            if escaping {
                switch ch {
                case "n": out.append("\n")
                case "t": out.append("\t")
                default:
                    out.append("\\")
                    out.append(ch)
                }
                escaping = false
            } else if ch == "\\" {
                escaping = true
            } else {
                out.append(ch)
            }
        }
        if escaping { out.append("\\\\") }
        return out
    }
}
