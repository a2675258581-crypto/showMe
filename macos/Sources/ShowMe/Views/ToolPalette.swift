import AppKit
import ShowMeCore
import SwiftUI

/// ⌘K：搜索工具、命令和已打开的标签页（中英文、拼音首字母都能搜）
@MainActor
struct ToolPalette: View {
    @State private var query = ""
    @State private var selection = 0

    struct Item: Identifiable {
        let id: String
        let section: String
        let title: String
        let subtitle: String
        let symbol: String
        let shortcut: String?
        let action: @MainActor () -> Void
    }

    var body: some View {
        let items = makeItems(query)
        ZStack(alignment: .top) {
            Color.black.opacity(0.16)
                .ignoresSafeArea()
                .onTapGesture { close() }
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.ink3)
                    PaletteSearchField(
                        text: $query,
                        placeholder: tr("搜索工具、命令或标签页…", "Search tools, commands or tabs…"),
                        onMove: { delta in
                            guard !items.isEmpty else { return }
                            selection = min(max(selection + delta, 0), items.count - 1)
                        },
                        onSubmit: {
                            if items.indices.contains(selection) { perform(items[selection]) }
                        },
                        onCancel: { close() }
                    )
                    .frame(height: 24)
                }
                .padding(.horizontal, 16)
                .frame(height: 50)
                Rectangle().fill(Color.rule).frame(height: 1)
                if items.isEmpty {
                    Text(tr("没有找到「\(query)」", "Nothing matches \"\(query)\""))
                        .font(.system(size: 13))
                        .foregroundStyle(Color.ink3)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 28)
                } else {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 0) {
                                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                                    if index == 0 || items[index - 1].section != item.section {
                                        Text(item.section)
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundStyle(Color.ink3)
                                            .padding(.horizontal, 16)
                                            .padding(.top, index == 0 ? 10 : 14)
                                            .padding(.bottom, 4)
                                    }
                                    row(item, selected: index == selection)
                                        .id(index)
                                        .onTapGesture { perform(item) }
                                        .onHover { if $0 { selection = index } }
                                }
                            }
                            .padding(.bottom, 8)
                        }
                        .frame(maxHeight: 400)
                        .onChange(of: selection) { _, value in
                            proxy.scrollTo(value)
                        }
                    }
                }
            }
            .frame(width: 600)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.paper))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.rule, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .shadow(color: .black.opacity(0.18), radius: 30, y: 16)
            .padding(.top, 84)
        }
        .onChange(of: query) { selection = 0 }
    }

    private func row(_ item: Item, selected: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: item.symbol)
                .font(.system(size: 13))
                .foregroundStyle(selected ? Color.accentInk : Color.ink3)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.system(size: 13.5, weight: selected ? .medium : .regular))
                    .foregroundStyle(Color.ink)
                if !item.subtitle.isEmpty {
                    Text(item.subtitle)
                        .font(.system(size: 11.5))
                        .foregroundStyle(Color.ink3)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let shortcut = item.shortcut {
                Text(shortcut)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Color.ink3)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 7)
        .background(selected ? Color.hover : Color.clear)
        .contentShape(Rectangle())
    }

    private func close() {
        Workspace.shared.paletteOpen = false
        if let tab = Workspace.shared.activeDocument {
            Workspace.shared.editors.existing(tab.id)?.focus()
        }
    }

    private func perform(_ item: Item) {
        Workspace.shared.paletteOpen = false
        item.action()
    }

    // MARK: - 条目

    private func makeItems(_ raw: String) -> [Item] {
        let q = raw.trimmingCharacters(in: .whitespaces)
        let workspace = Workspace.shared
        var items: [Item] = []

        func toolItem(_ tool: ToolSpec, section: String) -> Item {
            Item(
                id: "\(section)-tool-\(tool.id)",
                section: section,
                title: tool.name.text,
                subtitle: tool.summary.text,
                symbol: tool.symbol,
                shortcut: nil,
                action: { Workspace.shared.openTool(tool.id) }
            )
        }

        if q.isEmpty {
            let recent = workspace.recentTools.compactMap { ToolRegistry.tool($0) }
            items += recent.map { toolItem($0, section: tr("常用", "Frequent")) }
            for category in ToolCategory.allCases {
                let tools = ToolRegistry.tools(in: category).filter { tool in !recent.contains { $0.id == tool.id } }
                items += tools.map { toolItem($0, section: category.name.text) }
            }
            items += commands().map { $0 }
            return items
        }

        let tools = ToolRegistry.search(q)
        items += tools.map { toolItem($0, section: tr("工具", "Tools")) }
        items += commands().filter { $0.title.localizedCaseInsensitiveContains(q) || $0.subtitle.localizedCaseInsensitiveContains(q) }
        let tabs = workspace.tabs.filter { $0.title.localizedCaseInsensitiveContains(q) }
        items += tabs.map { tab in
            Item(
                id: "tab-\(tab.id)",
                section: tr("已打开", "Open Tabs"),
                title: tab.title,
                subtitle: tab.url?.path ?? "",
                symbol: "doc.text",
                shortcut: nil,
                action: { Workspace.shared.activate(tab) }
            )
        }
        return items
    }

    private func commands() -> [Item] {
        let workspace = Workspace.shared
        let settings = AppSettings.shared
        let section = tr("命令", "Commands")
        func command(_ id: String, _ title: String, _ symbol: String, _ shortcut: String? = nil, keywords: String = "", _ action: @escaping @MainActor () -> Void) -> Item {
            Item(id: "cmd-\(id)", section: section, title: title, subtitle: keywords, symbol: symbol, shortcut: shortcut, action: action)
        }
        return [
            command("new", tr("新建标签页", "New Tab"), "plus", "⌘N", keywords: "new untitled xinjian") { workspace.newDocument() },
            command("open", tr("打开文件…", "Open File…"), "folder", "⌘O", keywords: "open file dakai") { workspace.showOpenPanel() },
            command("save", tr("保存", "Save"), "square.and.arrow.down", "⌘S", keywords: "save baocun") { workspace.saveActive() },
            command("format", tr("格式化文档", "Format Document"), "text.alignleft", "⌥⇧F", keywords: "format prettier geshihua") { workspace.formatActive() },
            command("drawer", tr("显示 / 隐藏工具抽屉", "Show / Hide Tool Drawer"), "rectangle.bottomhalf.inset.filled", "⌘J", keywords: "drawer tools") { workspace.drawerOpen.toggle() },
            command("wrap", settings.wrapLines ? tr("关闭自动换行", "Turn Off Word Wrap") : tr("打开自动换行", "Turn On Word Wrap"), "text.word.spacing", "⌥⌘W", keywords: "wrap huanhang") { settings.wrapLines.toggle() },
            command("lang-zh", "切换到中文", "character.bubble", keywords: "language chinese zhongwen") { settings.languagePreference = .zh },
            command("lang-en", "Switch to English", "character.bubble", keywords: "language english yingwen") { settings.languagePreference = .en },
            command("light", tr("外观：浅色", "Appearance: Light"), "sun.max", keywords: "theme light") { settings.appearance = .light },
            command("dark", tr("外观：深色", "Appearance: Dark"), "moon", keywords: "theme dark") { settings.appearance = .dark },
            command("system", tr("外观：跟随系统", "Appearance: System"), "circle.lefthalf.filled", keywords: "theme auto") { settings.appearance = .system },
            command("close", tr("关闭标签页", "Close Tab"), "xmark", "⌘W", keywords: "close guanbi") { workspace.closeActive() },
        ]
    }
}

/// AppKit 输入框：方向键选择、回车执行、Esc 关闭
@MainActor
struct PaletteSearchField: NSViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var onMove: (Int) -> Void
    var onSubmit: () -> Void
    var onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSTextField {
        let field = NSTextField()
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 16)
        field.textColor = Ink.text
        field.delegate = context.coordinator
        field.cell?.usesSingleLineMode = true
        field.cell?.lineBreakMode = .byTruncatingTail
        DispatchQueue.main.async {
            field.window?.makeFirstResponder(field)
        }
        return field
    }

    func updateNSView(_ field: NSTextField, context: Context) {
        context.coordinator.parent = self
        if field.stringValue != text { field.stringValue = text }
        field.placeholderAttributedString = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: Ink.text3, .font: NSFont.systemFont(ofSize: 16)]
        )
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: PaletteSearchField

        init(_ parent: PaletteSearchField) {
            self.parent = parent
        }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSTextField else { return }
            parent.text = field.stringValue
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            switch selector {
            case #selector(NSResponder.moveDown(_:)):
                parent.onMove(1)
                return true
            case #selector(NSResponder.moveUp(_:)):
                parent.onMove(-1)
                return true
            case #selector(NSResponder.insertNewline(_:)):
                parent.onSubmit()
                return true
            case #selector(NSResponder.cancelOperation(_:)):
                parent.onCancel()
                return true
            default:
                return false
            }
        }
    }
}
