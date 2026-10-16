import AppKit
import ShowMeCore
import SwiftUI

/// 菜单栏。所有标题都走 tr()，切换语言后立即更新。
@MainActor
struct AppCommands: Commands {
    let workspace: Workspace
    let settings: AppSettings

    private var textView: PaperTextView? {
        guard let tab = workspace.activeDocument else { return nil }
        return workspace.editors.existing(tab.id)?.textView
    }

    var body: some Commands {
        // 读一次，确保语言变化时菜单重新生成
        let _ = settings.lang

        CommandGroup(replacing: .newItem) {
            Button(tr("新建标签页", "New Tab")) { workspace.newDocument() }
                .keyboardShortcut("n")
            Button(tr("打开…", "Open…")) { workspace.showOpenPanel() }
                .keyboardShortcut("o")
        }

        CommandGroup(replacing: .saveItem) {
            Button(tr("保存", "Save")) { workspace.saveActive() }
                .keyboardShortcut("s")
            Button(tr("另存为…", "Save As…")) { workspace.saveActiveAs() }
                .keyboardShortcut("s", modifiers: [.command, .shift])
            Button(tr("全部保存", "Save All")) { workspace.saveAll() }
                .keyboardShortcut("s", modifiers: [.command, .option])
            Divider()
            Button(tr("关闭标签页", "Close Tab")) { workspace.closeActive() }
                .keyboardShortcut("w")
            Button(tr("关闭窗口", "Close Window")) { NSApp.keyWindow?.performClose(nil) }
                .keyboardShortcut("w", modifiers: [.command, .shift])
        }

        // 用自己的查找栏替换系统的「查找」子菜单
        CommandGroup(replacing: .textEditing) {
            Menu(tr("查找", "Find")) {
                Button(tr("查找…", "Find…")) { FindModel.shared.open(replace: false) }
                    .keyboardShortcut("f")
                Button(tr("查找和替换…", "Find and Replace…")) { FindModel.shared.open(replace: true) }
                    .keyboardShortcut("f", modifiers: [.command, .option])
                Divider()
                Button(tr("查找下一个", "Find Next")) { FindModel.shared.next() }
                    .keyboardShortcut("g")
                Button(tr("查找上一个", "Find Previous")) { FindModel.shared.previous() }
                    .keyboardShortcut("g", modifiers: [.command, .shift])
                Button(tr("用所选内容查找", "Use Selection for Find")) { FindModel.shared.useSelection() }
                    .keyboardShortcut("e")
            }
        }

        CommandGroup(after: .textEditing) {
            Divider()
            Button(tr("格式化文档", "Format Document")) { workspace.formatActive() }
                .keyboardShortcut("f", modifiers: [.option, .shift])
            Button(tr("切换行注释", "Toggle Line Comment")) { textView?.toggleLineComment() }
                .keyboardShortcut("/")
            Button(tr("增加缩进", "Indent Lines")) { textView?.shiftSelectedLines(outdent: false) }
                .keyboardShortcut("]")
            Button(tr("减少缩进", "Outdent Lines")) { textView?.shiftSelectedLines(outdent: true) }
                .keyboardShortcut("[")
        }

        CommandGroup(after: .toolbar) {
            Button(tr("放大字号", "Bigger")) { settings.fontSize = min(settings.fontSize + 1, 22) }
                .keyboardShortcut("=")
            Button(tr("缩小字号", "Smaller")) { settings.fontSize = max(settings.fontSize - 1, 11) }
                .keyboardShortcut("-")
            Button(tr("默认字号", "Actual Size")) { settings.fontSize = 14 }
                .keyboardShortcut("0")
            Divider()
            Toggle(tr("自动换行", "Word Wrap"), isOn: Binding(get: { settings.wrapLines }, set: { settings.wrapLines = $0 }))
                .keyboardShortcut("w", modifiers: [.command, .option])
            Picker(tr("外观", "Appearance"), selection: Binding(get: { settings.appearance }, set: { settings.appearance = $0 })) {
                Text(tr("跟随系统", "System")).tag(AppSettings.Appearance.system)
                Text(tr("浅色", "Light")).tag(AppSettings.Appearance.light)
                Text(tr("深色", "Dark")).tag(AppSettings.Appearance.dark)
            }
            Picker(tr("界面语言", "Language"), selection: Binding(get: { settings.languagePreference }, set: { settings.languagePreference = $0 })) {
                Text(tr("跟随系统", "System")).tag(AppSettings.LanguagePreference.system)
                Text("中文").tag(AppSettings.LanguagePreference.zh)
                Text("English").tag(AppSettings.LanguagePreference.en)
            }
            Divider()
        }

        CommandMenu(tr("工具", "Tools")) {
            Button(tr("全部工具…", "All Tools…")) { workspace.paletteOpen = true }
                .keyboardShortcut("k")
            Button(tr("对选中内容使用工具", "Use Tool on Selection")) {
                workspace.drawerOpen = true
                workspace.drawerFocusRequest += 1
            }
            .keyboardShortcut("t", modifiers: [.command, .shift])
            Button(workspace.drawerOpen ? tr("隐藏工具抽屉", "Hide Tool Drawer") : tr("显示工具抽屉", "Show Tool Drawer")) {
                workspace.drawerOpen.toggle()
            }
            .keyboardShortcut("j")
            Divider()
            ForEach(ToolCategory.allCases, id: \.self) { category in
                Menu(category.name.text) {
                    ForEach(ToolRegistry.tools(in: category)) { tool in
                        Button(tool.name.text) { workspace.openTool(tool.id) }
                    }
                }
            }
        }

        CommandGroup(before: .windowArrangement) {
            Button(tr("下一个标签页", "Next Tab")) { workspace.selectTab(offset: 1) }
                .keyboardShortcut(.tab, modifiers: [.control])
            Button(tr("上一个标签页", "Previous Tab")) { workspace.selectTab(offset: -1) }
                .keyboardShortcut(.tab, modifiers: [.control, .shift])
            Menu(tr("切换到标签页", "Go to Tab")) {
                ForEach(1...9, id: \.self) { number in
                    Button(number == 9 ? tr("最后一个", "Last") : tr("第 \(number) 个", "Tab \(number)")) {
                        workspace.selectTab(number: number)
                    }
                    .keyboardShortcut(KeyEquivalent(Character(String(number))))
                }
            }
            Divider()
        }

        CommandGroup(replacing: .help) {
            Button(tr("showMe 使用说明", "showMe Help")) {
                workspace.openInNewTab(HelpText.markdown(settings.lang), language: "markdown")
            }
        }
    }
}

enum HelpText {
    static func markdown(_ lang: Lang) -> String {
        lang == .zh ? zh : en
    }

    private static let zh = """
    # showMe 使用说明

    一个纸面风格的文本编辑器，底部抽屉里有 36 个开发者小工具。

    ## 文件
    - ⌘N 新建标签页，⌘O 打开（也可以把文件拖进窗口），每个文件一个标签页
    - ⌘S 保存，⇧⌘S 另存为，⌘W 关闭标签页
    - 没保存的内容会自动留存：直接退出 App，下次打开原样恢复

    ## 编辑
    - ⌥⇧F 格式化整篇文档（JSON、XML、JS/TS、CSS、HTML、Markdown、YAML、SQL、GraphQL…）
    - ⌘F 查找替换（支持区分大小写、全词、正则；⌘G / ⇧⌘G 下一个 / 上一个，⌘↩ 全部替换）
    - ⌘/ 注释，Tab / ⇧Tab 整块缩进
    - 点标题下面那一行可以切换语言、编码和换行符

    ## 工具
    - ⌘K 搜索全部工具和命令（拼音首字母也行）
    - 选中一段文字，按 ⇧⌘T 交给下方工具处理；没有选区时处理整篇文档
    - 结果可以复制、替换选中内容，或在新标签页打开
    - ⌘J 显示 / 隐藏工具抽屉
    """

    private static let en = """
    # showMe Help

    A paper-style text editor with 36 developer tools in a drawer at the bottom.

    ## Files
    - ⌘N new tab, ⌘O open (or drop files onto the window); every file gets its own tab
    - ⌘S save, ⇧⌘S save as, ⌘W close tab
    - Unsaved changes are kept automatically: quit any time and they come back next launch

    ## Editing
    - ⌥⇧F formats the whole document (JSON, XML, JS/TS, CSS, HTML, Markdown, YAML, SQL, GraphQL…)
    - ⌘F find and replace (match case, whole word, regex; ⌘G / ⇧⌘G next / previous, ⌘↩ replace all)
    - ⌘/ toggles comments, Tab / ⇧Tab indents blocks
    - Click the line under the title to change the language mode, encoding or line endings

    ## Tools
    - ⌘K searches every tool and command
    - Select some text and press ⇧⌘T to run a tool on it; with no selection the whole document is used
    - Copy a result, replace the selection with it, or open it in a new tab
    - ⌘J shows or hides the tool drawer
    """
}
