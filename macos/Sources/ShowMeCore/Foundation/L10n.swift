import Foundation

/// 界面语言。App 里由设置决定；工具运行时通过 `ToolInput.lang` 拿到。
public enum Lang: String, Codable, Sendable, CaseIterable {
    case zh
    case en

    /// 按系统首选语言推断：中文（任何地区）→ zh，其余 → en。
    public static func preferred(_ languages: [String] = Locale.preferredLanguages) -> Lang {
        guard let first = languages.first?.lowercased() else { return .zh }
        return first.hasPrefix("zh") ? .zh : .en
    }
}

/// 一段中英双语文案。界面层用 `text(lang)` 取值。
public struct LocalizedText: Hashable, Sendable, Codable {
    public var zh: String
    public var en: String

    public init(_ zh: String, _ en: String) {
        self.zh = zh
        self.en = en
    }

    public func callAsFunction(_ lang: Lang) -> String {
        lang == .zh ? zh : en
    }

    /// 中英文任一包含关键词即命中（不区分大小写）。
    public func matches(_ query: String) -> Bool {
        zh.localizedCaseInsensitiveContains(query) || en.localizedCaseInsensitiveContains(query)
    }
}

extension Lang {
    /// 在工具实现里写双语文案：`input.lang.t("已复制", "Copied")`
    public func t(_ zh: String, _ en: String) -> String {
        self == .zh ? zh : en
    }
}
