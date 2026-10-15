import AppKit
import ShowMeCore
import SwiftUI

/// 设置（⌘,）
@MainActor
struct SettingsView: View {
    var body: some View {
        @Bindable var settings = AppSettings.shared
        Form {
            Section {
                Picker(tr("界面语言", "Language"), selection: $settings.languagePreference) {
                    Text(tr("跟随系统", "System")).tag(AppSettings.LanguagePreference.system)
                    Text("中文").tag(AppSettings.LanguagePreference.zh)
                    Text("English").tag(AppSettings.LanguagePreference.en)
                }
                Picker(tr("外观", "Appearance"), selection: $settings.appearance) {
                    Text(tr("跟随系统", "System")).tag(AppSettings.Appearance.system)
                    Text(tr("浅色", "Light")).tag(AppSettings.Appearance.light)
                    Text(tr("深色", "Dark")).tag(AppSettings.Appearance.dark)
                }
                LabeledContent(tr("强调色", "Accent")) {
                    HStack(spacing: 10) {
                        ForEach(PaperAccent.allCases) { accent in
                            Button {
                                settings.accent = accent
                            } label: {
                                Circle()
                                    .fill(Color(nsColor: .paper(accent.light, accent.dark)))
                                    .frame(width: 18, height: 18)
                                    .overlay(
                                        Circle()
                                            .strokeBorder(Color.primary.opacity(settings.accent == accent ? 0.55 : 0), lineWidth: 2)
                                            .padding(-4)
                                    )
                                    .padding(4)
                            }
                            .buttonStyle(.plain)
                            .help(accent.name.text)
                        }
                    }
                }
            } footer: {
                Text(tr("菜单栏里系统自带的菜单项（如“退出”）在下次启动时切换语言。", "System menu items such as \"Quit\" switch language on the next launch."))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section(tr("编辑器", "Editor")) {
                LabeledContent(tr("字号", "Font size")) {
                    HStack {
                        Slider(value: $settings.fontSize, in: 11...22, step: 1)
                            .frame(width: 180)
                        Text("\(Int(settings.fontSize)) pt")
                            .monospacedDigit()
                            .frame(width: 44, alignment: .trailing)
                    }
                }
                Toggle(tr("自动换行", "Wrap lines"), isOn: $settings.wrapLines)
                Picker(tr("缩进", "Indentation"), selection: $settings.indentWidth) {
                    Text(tr("2 个空格", "2 spaces")).tag(2)
                    Text(tr("4 个空格", "4 spaces")).tag(4)
                    Text("Tab").tag(0)
                }
            }

            Section(tr("数据", "Data")) {
                LabeledContent(tr("未保存的内容", "Unsaved changes")) {
                    Text(tr("自动留存，退出后再打开会原样恢复", "Kept automatically and restored when you reopen the app"))
                        .foregroundStyle(.secondary)
                }
                Button(tr("在访达中显示会话存档", "Show Session File in Finder")) {
                    let url = SessionStore.fileURL
                    if FileManager.default.fileExists(atPath: url.path) {
                        NSWorkspace.shared.activateFileViewerSelecting([url])
                    } else {
                        NSWorkspace.shared.open(SessionStore.directory.deletingLastPathComponent())
                    }
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 520)
        .fixedSize(horizontal: false, vertical: true)
    }
}
