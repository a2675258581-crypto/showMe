import AppKit
import Observation
import ShowMeCore
import SwiftUI

/// 查找与替换（⌘F / ⌥⌘F）：作用于当前文档，匹配全部高亮，当前项用强调色。
@MainActor
@Observable
final class FindModel {
    static let shared = FindModel()

    enum Field { case find, replace }

    var isVisible = false
    var showReplace = true
    var query = ""
    var replacement = ""
    var caseSensitive = false
    var wholeWord = false
    var regex = false

    private(set) var matchCount = 0
    private(set) var currentIndex: Int?
    private(set) var errorText: String?
    /// 需要聚焦的输入框；serial 变化时对应的框获得焦点
    private(set) var focusTarget: Field = .find
    private(set) var focusSerial = 0

    @ObservationIgnored private var matches: [NSRange] = []
    /// 边输入边查找时，从这个位置往后找第一个匹配
    @ObservationIgnored private var anchor = 0
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    @ObservationIgnored private weak var highlightedEditor: EditorController?

    static let limit = 10_000

    private init() {}

    var options: TextSearchOptions {
        TextSearchOptions(caseSensitive: caseSensitive, wholeWord: wholeWord, regex: regex)
    }

    private var editor: EditorController? {
        guard let tab = Workspace.shared.activeDocument else { return nil }
        return Workspace.shared.editors.existing(tab.id)
    }

    var statusText: String {
        if let errorText { return errorText }
        if query.isEmpty { return "" }
        if matchCount == 0 { return tr("无结果", "No results") }
        let total = matchCount >= Self.limit ? "\(Self.limit)+" : "\(matchCount)"
        if let currentIndex { return "\(currentIndex + 1) / \(total)" }
        return tr("共 \(total) 处", "\(total) found")
    }

    var hasProblem: Bool { errorText != nil || (!query.isEmpty && matchCount == 0) }

    // MARK: - 打开 / 关闭

    func open(replace: Bool) {
        guard let editor else {
            NSSound.beep()
            return
        }
        let textView = editor.textView
        let selection = textView.selectedRange()
        anchor = selection.location
        // 选中的是单行短文字：直接拿来查找
        if selection.length > 0, selection.length <= 500 {
            let selected = (textView.string as NSString).substring(with: selection)
            if !selected.contains("\n") { query = selected }
        }
        if replace { showReplace = true }
        isVisible = true
        focusTarget = replace ? .replace : .find
        focusSerial += 1
        refresh(selectNearest: false)
    }

    func close() {
        guard isVisible else { return }
        isVisible = false
        refreshTask?.cancel()
        matches = []
        matchCount = 0
        currentIndex = nil
        highlightedEditor?.setSearchHighlights([], current: nil)
        highlightedEditor = nil
        editor?.focus()
    }

    /// ⌘E：用选中的文字作为查找内容
    func useSelection() {
        guard let textView = editor?.textView else { return }
        let selection = textView.selectedRange()
        guard selection.length > 0 else { return }
        query = (textView.string as NSString).substring(with: selection)
        anchor = selection.location
        if isVisible { refresh(selectNearest: false) }
    }

    // MARK: - 匹配

    /// 查找内容或选项变了：稍等一下再找（避免大文件逐字卡顿），并选中光标后的第一个匹配
    func inputChanged() {
        scheduleRefresh(selectNearest: true)
    }

    /// 文档内容变了：只更新高亮和计数
    func documentChanged() {
        guard isVisible else { return }
        scheduleRefresh(selectNearest: false)
    }

    func scheduleRefresh(selectNearest: Bool) {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(90))
            guard !Task.isCancelled else { return }
            self?.refresh(selectNearest: selectNearest)
        }
    }

    func refresh(selectNearest: Bool) {
        guard isVisible, let editor else {
            matches = []
            matchCount = 0
            currentIndex = nil
            return
        }
        if highlightedEditor !== editor {
            highlightedEditor?.setSearchHighlights([], current: nil)
            highlightedEditor = editor
        }
        if query.isEmpty {
            matches = []
            errorText = nil
        } else {
            do {
                matches = try TextSearch.matches(in: editor.textView.string, query: query, options: options, limit: Self.limit)
                errorText = nil
            } catch let error as TextSearchError {
                matches = []
                errorText = error.message.text
            } catch {
                matches = []
                errorText = error.localizedDescription
            }
        }
        matchCount = matches.count
        if selectNearest, !matches.isEmpty {
            let index = matches.firstIndex { $0.location >= anchor } ?? 0
            select(index, indicate: false)
        } else {
            let selection = editor.textView.selectedRange()
            currentIndex = matches.firstIndex(of: selection)
            highlight()
        }
    }

    private func highlight() {
        let current = currentIndex.flatMap { matches.indices.contains($0) ? matches[$0] : nil }
        editor?.setSearchHighlights(matches, current: current)
    }

    private func select(_ index: Int, indicate: Bool) {
        guard let textView = editor?.textView, matches.indices.contains(index) else { return }
        currentIndex = index
        let range = matches[index]
        textView.setSelectedRange(range)
        textView.scrollRangeToVisible(range)
        highlight()
        if indicate, range.length > 0 {
            textView.showFindIndicator(for: range)
        }
    }

    // MARK: - 跳转

    func next() {
        if !isVisible { open(replace: false) }
        if matches.isEmpty { refresh(selectNearest: false) }
        guard let textView = editor?.textView, !matches.isEmpty else {
            NSSound.beep()
            return
        }
        let selection = textView.selectedRange()
        let start = NSMaxRange(selection)
        let index = matches.firstIndex { $0.location >= start && $0 != selection } ?? 0
        anchor = matches[index].location
        select(index, indicate: true)
    }

    func previous() {
        if !isVisible { open(replace: false) }
        if matches.isEmpty { refresh(selectNearest: false) }
        guard let textView = editor?.textView, !matches.isEmpty else {
            NSSound.beep()
            return
        }
        let selection = textView.selectedRange()
        let index = matches.lastIndex { $0.location < selection.location } ?? matches.count - 1
        anchor = matches[index].location
        select(index, indicate: true)
    }

    // MARK: - 替换

    /// 当前选中的是一个匹配：替换它并跳到下一个；否则先跳到下一个匹配
    func replaceCurrent() {
        guard let editor, !query.isEmpty else { return }
        let textView = editor.textView
        let selection = textView.selectedRange()
        guard matches.contains(selection) else {
            next()
            return
        }
        do {
            let text = textView.string
            let value = try TextSearch.replacement(for: selection, in: text, query: query, template: replacement, options: options)
            editor.replace(range: selection, with: value, actionName: tr("替换", "Replace"))
            let after = selection.location + (value as NSString).length
            textView.setSelectedRange(NSRange(location: after, length: 0))
            anchor = after
            refresh(selectNearest: true)
        } catch let error as TextSearchError {
            errorText = error.message.text
        } catch {
            errorText = error.localizedDescription
        }
    }

    func replaceAll() {
        guard let editor, !query.isEmpty else { return }
        do {
            let result = try TextSearch.replaceAll(in: editor.textView.string, query: query, template: replacement, options: options)
            guard result.count > 0 else {
                NSSound.beep()
                return
            }
            editor.replaceAll(with: result.text, actionName: tr("全部替换", "Replace All"))
            Workspace.shared.showFlash(tr("已替换 \(result.count) 处", "Replaced \(result.count) occurrences"))
            refresh(selectNearest: false)
        } catch let error as TextSearchError {
            errorText = error.message.text
        } catch {
            errorText = error.localizedDescription
        }
    }
}

// MARK: - 查找栏

/// 浮在编辑区右上角的查找替换栏（纸面风格）
@MainActor
struct FindBar: View {
    var body: some View {
        @Bindable var find = FindModel.shared
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Button {
                    find.showReplace.toggle()
                } label: {
                    Image(systemName: find.showReplace ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .frame(width: 16, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.ink3)
                .help(find.showReplace ? tr("收起替换", "Hide Replace") : tr("展开替换（⌥⌘F）", "Show Replace (⌥⌘F)"))

                inputBox(problem: find.hasProblem) {
                    FindField(
                        text: $find.query,
                        placeholder: tr("查找", "Find"),
                        role: .find,
                        focusTarget: find.focusTarget,
                        focusSerial: find.focusSerial,
                        onSubmit: { backwards in backwards ? find.previous() : find.next() },
                        onAlternateSubmit: nil,
                        onCancel: { find.close() }
                    )
                }
                OptionToggle(label: "Aa", help: tr("区分大小写", "Match Case"), isOn: $find.caseSensitive)
                OptionToggle(label: "W", help: tr("全词匹配", "Whole Word"), isOn: $find.wholeWord)
                OptionToggle(label: ".*", help: tr("正则表达式", "Regular Expression"), isOn: $find.regex)
                Text(find.statusText)
                    .font(.system(size: 11.5).monospacedDigit())
                    .foregroundStyle(find.hasProblem ? Color.warningInk : Color.ink3)
                    .lineLimit(1)
                    .frame(width: 84, alignment: .trailing)
                iconButton("chevron.up", help: tr("上一个（⇧⌘G）", "Previous (⇧⌘G)")) { find.previous() }
                iconButton("chevron.down", help: tr("下一个（⌘G）", "Next (⌘G)")) { find.next() }
                iconButton("xmark", help: tr("关闭（Esc）", "Close (Esc)")) { find.close() }
            }
            if find.showReplace {
                HStack(spacing: 6) {
                    Color.clear.frame(width: 16, height: 1)
                    inputBox(problem: false) {
                        FindField(
                            text: $find.replacement,
                            placeholder: find.regex ? tr("替换为（可用 $1、\\n）", "Replace ($1, \\n allowed)") : tr("替换为", "Replace"),
                            role: .replace,
                            focusTarget: find.focusTarget,
                            focusSerial: find.focusSerial,
                            onSubmit: { _ in find.replaceCurrent() },
                            onAlternateSubmit: { find.replaceAll() },
                            onCancel: { find.close() }
                        )
                    }
                    Button(tr("替换", "Replace")) { find.replaceCurrent() }
                        .buttonStyle(PaperButtonStyle(compact: true))
                        .help(tr("替换当前匹配并跳到下一个（↩）", "Replace this match and go to the next (↩)"))
                    Button(tr("全部替换", "Replace All")) { find.replaceAll() }
                        .buttonStyle(PaperButtonStyle(compact: true))
                        .help(tr("全部替换（⌘↩），可撤销", "Replace all (⌘↩); undoable"))
                }
                .disabled(find.query.isEmpty)
            }
        }
        .padding(8)
        .frame(width: 600)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.drawer))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.rule, lineWidth: 1))
        .shadow(color: .black.opacity(0.1), radius: 14, y: 6)
        .onChange(of: find.query) { find.inputChanged() }
        .onChange(of: find.caseSensitive) { find.inputChanged() }
        .onChange(of: find.wholeWord) { find.inputChanged() }
        .onChange(of: find.regex) { find.inputChanged() }
        .onChange(of: Workspace.shared.activeDocument?.revision) { find.documentChanged() }
        .onChange(of: Workspace.shared.activeID) { find.refresh(selectNearest: false) }
    }

    private func inputBox<Content: View>(problem: Bool, @ViewBuilder content: () -> Content) -> some View {
        content()
            .frame(height: 20)
            .padding(.horizontal, 8)
            .frame(height: 28)
            .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Color.paper))
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .strokeBorder(problem ? Color.warningInk.opacity(0.6) : Color.rule, lineWidth: 1)
            )
    }

    private func iconButton(_ symbol: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(QuietButtonStyle())
        .help(help)
    }
}

/// 查找选项的小开关：Aa / W / .*
@MainActor
private struct OptionToggle: View {
    let label: String
    let help: String
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            Text(label)
                .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(isOn ? Color.white : Color.ink3)
                .frame(width: 26, height: 24)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(isOn ? Color.accentInk : Color.clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
    }
}

/// AppKit 输入框：↩ 下一个 / ⇧↩ 上一个、⌘↩ 全部替换、Esc 关闭
@MainActor
struct FindField: NSViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var role: FindModel.Field
    var focusTarget: FindModel.Field
    var focusSerial: Int
    /// 参数：是否按住了 Shift（反向）
    var onSubmit: (Bool) -> Void
    /// ⌘↩ / ⌥↩
    var onAlternateSubmit: (() -> Void)?
    var onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSTextField {
        let field = NSTextField()
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 13)
        field.textColor = Ink.text
        field.delegate = context.coordinator
        field.usesSingleLineMode = true
        field.cell?.isScrollable = true
        field.cell?.wraps = false
        field.lineBreakMode = .byClipping
        return field
    }

    func updateNSView(_ field: NSTextField, context: Context) {
        context.coordinator.parent = self
        if field.stringValue != text {
            field.stringValue = text
        }
        field.placeholderAttributedString = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: Ink.text3, .font: NSFont.systemFont(ofSize: 13)]
        )
        if context.coordinator.lastFocusSerial != focusSerial {
            context.coordinator.lastFocusSerial = focusSerial
            if focusTarget == role {
                DispatchQueue.main.async {
                    field.window?.makeFirstResponder(field)
                    field.currentEditor()?.selectAll(nil)
                }
            }
        }
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: FindField
        var lastFocusSerial = 0

        init(_ parent: FindField) {
            self.parent = parent
        }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSTextField else { return }
            parent.text = field.stringValue
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            let flags = NSApp.currentEvent?.modifierFlags ?? []
            switch selector {
            case #selector(NSResponder.insertNewline(_:)):
                if flags.contains(.command), let alternate = parent.onAlternateSubmit {
                    alternate()
                } else {
                    parent.onSubmit(flags.contains(.shift))
                }
                return true
            case #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)):
                if let alternate = parent.onAlternateSubmit {
                    alternate()
                } else {
                    parent.onSubmit(flags.contains(.shift))
                }
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
