import AppKit
import Observation
import ShowMeCore

/// 用户偏好（UserDefaults 持久化）。界面语言切换即时生效，无需重启。
@MainActor
@Observable
final class AppSettings {
    static let shared = AppSettings()

    enum LanguagePreference: String, CaseIterable, Identifiable {
        case system, zh, en
        var id: String { rawValue }
    }

    enum Appearance: String, CaseIterable, Identifiable {
        case system, light, dark
        var id: String { rawValue }
    }

    var languagePreference: LanguagePreference {
        didSet { save(languagePreference.rawValue, "language"); applyLanguage() }
    }

    var appearance: Appearance {
        didSet { save(appearance.rawValue, "appearance"); applyAppearance() }
    }

    var accent: PaperAccent {
        didSet { save(accent.rawValue, "accent") }
    }

    /// 编辑器基础字号（代码；正文在此基础上 +2）
    var fontSize: Double {
        didSet { save(fontSize, "fontSize") }
    }

    var wrapLines: Bool {
        didSet { save(wrapLines, "wrapLines") }
    }

    /// 缩进：2 / 4 个空格，0 表示 Tab
    var indentWidth: Int {
        didSet { save(indentWidth, "indentWidth") }
    }

    /// 当前生效的界面语言
    private(set) var lang: Lang = .zh

    private let defaults = UserDefaults.standard

    private init() {
        languagePreference = LanguagePreference(rawValue: defaults.string(forKey: "language") ?? "") ?? .system
        appearance = Appearance(rawValue: defaults.string(forKey: "appearance") ?? "") ?? .system
        accent = PaperAccent(rawValue: defaults.string(forKey: "accent") ?? "") ?? .terracotta
        let size = defaults.double(forKey: "fontSize")
        fontSize = size >= 10 && size <= 28 ? size : 14
        wrapLines = defaults.object(forKey: "wrapLines") as? Bool ?? true
        let indent = defaults.object(forKey: "indentWidth") as? Int ?? 2
        indentWidth = [0, 2, 4].contains(indent) ? indent : 2
        applyLanguage()
    }

    private func save(_ value: Any, _ key: String) {
        defaults.set(value, forKey: key)
    }

    private func applyLanguage() {
        switch languagePreference {
        case .system: lang = Lang.preferred(systemLanguages())
        case .zh: lang = .zh
        case .en: lang = .en
        }
        // 系统提供的菜单项（隐藏、退出、编辑菜单等）跟随 AppleLanguages，下次启动生效
        switch languagePreference {
        case .system: defaults.removeObject(forKey: "AppleLanguages")
        case .zh: defaults.set(["zh-Hans"], forKey: "AppleLanguages")
        case .en: defaults.set(["en"], forKey: "AppleLanguages")
        }
    }

    /// 不受本 App 的 AppleLanguages 覆盖影响的系统首选语言
    private func systemLanguages() -> [String] {
        let global = UserDefaults(suiteName: UserDefaults.globalDomain)?.stringArray(forKey: "AppleLanguages")
        return global ?? Locale.preferredLanguages
    }

    func applyAppearance() {
        switch appearance {
        case .system: NSApp?.appearance = nil
        case .light: NSApp?.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp?.appearance = NSAppearance(named: .darkAqua)
        }
    }

    var indentUnit: String {
        indentWidth == 0 ? "\t" : String(repeating: " ", count: indentWidth)
    }
}

/// 界面文案：`tr("保存", "Save")`。在 SwiftUI body 里调用时会随语言切换自动刷新。
@MainActor
func tr(_ zh: String, _ en: String) -> String {
    AppSettings.shared.lang == .zh ? zh : en
}

extension LocalizedText {
    @MainActor
    var text: String { self(AppSettings.shared.lang) }
}
