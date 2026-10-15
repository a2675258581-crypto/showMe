import AppKit
import ShowMeCore
import SwiftUI

/// 底部工具抽屉：一排常用工具 + 当前工具的表单与结果。工具的输入是选中的文字（没有选区时是整篇文档）。
@MainActor
struct ToolDrawer: View {
    @State private var dragStart: Double?

    var body: some View {
        let workspace = Workspace.shared
        let spec = workspace.currentTool
        VStack(alignment: .leading, spacing: 0) {
            resizeHandle(workspace)
            VStack(alignment: .leading, spacing: 12) {
                chipRow(workspace, current: spec)
                ToolPanel(spec: spec)
                    .id(spec.id)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 12)
        }
        .frame(height: workspace.drawerHeight)
        .frame(maxWidth: .infinity)
        .background(Color.drawer)
        .overlay(alignment: .top) {
            Rectangle().fill(Color.rule).frame(height: 1)
        }
    }

    private func resizeHandle(_ workspace: Workspace) -> some View {
        Color.clear
            .frame(height: 8)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .onHover { inside in
                if inside { NSCursor.resizeUpDown.push() } else { NSCursor.pop() }
            }
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { value in
                        let start = dragStart ?? workspace.drawerHeight
                        if dragStart == nil { dragStart = start }
                        let maxHeight = (NSApp.keyWindow?.frame.height ?? 900) - 160
                        workspace.drawerHeight = min(max(start - value.translation.height, 150), max(200, maxHeight))
                    }
                    .onEnded { _ in
                        dragStart = nil
                        workspace.scheduleAutosave()
                    }
            )
    }

    private func chipRow(_ workspace: Workspace, current: ToolSpec) -> some View {
        var ids = workspace.recentTools
        if !ids.contains(current.id) { ids.insert(current.id, at: 0) }
        let tools = ids.prefix(8).compactMap { ToolRegistry.tool($0) }
        return HStack(spacing: 8) {
            Text(tr("工具", "Tools"))
                .font(.system(size: 12))
                .foregroundStyle(Color.ink3)
                .padding(.trailing, 2)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(tools) { tool in
                        Button(tool.name.text) {
                            workspace.openTool(tool.id)
                        }
                        .buttonStyle(ChipStyle(selected: tool.id == current.id))
                        .help(tool.summary.text)
                    }
                }
            }
            Spacer(minLength: 8)
            Button {
                workspace.paletteOpen = true
            } label: {
                Text(tr("全部 \(ToolRegistry.all.count) 个", "All \(ToolRegistry.all.count)"))
                    + Text("  ⌘K").foregroundStyle(Color.ink3)
            }
            .buttonStyle(QuietButtonStyle())
            Button {
                workspace.drawerOpen = false
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(QuietButtonStyle())
            .help(tr("收起（⌘J）", "Hide (⌘J)"))
        }
        .font(.system(size: 12))
    }
}

// MARK: - 通用工具表单

@MainActor
struct ToolPanel: View {
    let spec: ToolSpec

    @State private var result: ToolResult?
    @State private var error: ToolError?
    @State private var emptyInput = false
    @State private var inputWasSelection = false
    @State private var regenerate = 0
    @FocusState private var focusedField: String?

    private struct RunKey: Equatable {
        var options: [String: String]
        var revision: Int
        var selection: NSRange
        var tabID: UUID?
        var lang: Lang
        var regenerate: Int
    }

    var body: some View {
        let workspace = Workspace.shared
        let options = workspace.options(for: spec)
        let tab = workspace.activeDocument
        let readsDocument = spec.input != .none
        let key = RunKey(
            options: options,
            revision: readsDocument ? (tab?.revision ?? 0) : 0,
            selection: readsDocument ? (tab?.selection ?? NSRange()) : NSRange(),
            tabID: readsDocument ? tab?.id : nil,
            lang: AppSettings.shared.lang,
            regenerate: regenerate
        )
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 12) {
                header(tab)
                fields(options)
                results
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 4)
        }
        .scrollIndicators(.automatic)
        .task(id: key) {
            try? await Task.sleep(for: .milliseconds(140))
            guard !Task.isCancelled else { return }
            await run(options: options)
        }
        .onChange(of: workspace.drawerFocusRequest) {
            focusedField = visibleFields(options).first(where: { if case .text = $0.kind { return true } else { return false } })?.id
        }
    }

    private func header(_ tab: DocumentTab?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(spec.name.text)
                .font(PaperFont.serif(15, weight: .semibold))
                .foregroundStyle(Color.ink)
            Text(spec.summary.text)
                .font(.system(size: 11.5))
                .foregroundStyle(Color.ink3)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 8)
            Text(inputDescription(tab))
                .font(.system(size: 11.5))
                .foregroundStyle(Color.ink3)
                .lineLimit(1)
            if spec.input == .none {
                Button(tr("重新生成", "Regenerate")) { regenerate += 1 }
                    .buttonStyle(PaperButtonStyle(compact: true))
            }
        }
    }

    private func inputDescription(_ tab: DocumentTab?) -> String {
        switch spec.input {
        case .none:
            return tr("无需输入", "No input needed")
        case .required, .optional:
            guard let tab else { return "" }
            if tab.selection.length > 0 {
                return tr("输入：选中的 \(tab.selection.length) 个字符", "Input: \(tab.selection.length) selected characters")
            }
            let label = spec.inputLabel?.text ?? tr("整篇文档", "the whole document")
            return tr("输入：\(label)", "Input: \(label)")
        }
    }

    private func visibleFields(_ options: [String: String]) -> [ToolField] {
        let defaults = spec.defaults
        return spec.fields.filter { $0.visibleWhen?.isSatisfied(by: options, defaults: defaults) ?? true }
    }

    @ViewBuilder
    private func fields(_ options: [String: String]) -> some View {
        let visible = visibleFields(options)
        if !visible.isEmpty {
            FlowLayout(spacing: 14, lineSpacing: 10) {
                ForEach(visible) { field in
                    FieldView(field: field, toolID: spec.id, value: options[field.id] ?? field.defaultValue, focused: $focusedField)
                }
            }
        }
    }

    @ViewBuilder
    private var results: some View {
        if emptyInput {
            Text(tr(
                "在上方文档里选中一段文字（或直接输入内容），这里会实时显示结果。",
                "Select some text in the document above (or just type), and results appear here as you go."
            ))
            .font(.system(size: 12.5))
            .foregroundStyle(Color.ink3)
            .padding(.vertical, 6)
        } else if let error {
            ErrorRow(error: error, canReveal: !inputWasSelection && spec.input != .none)
        } else if let result {
            if spec.customView == "markdown", let html = result.primary?.value {
                MarkdownPreview(html: html)
                    .frame(height: 260)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.paper))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.rule, lineWidth: 1))
            }
            ToolResultView(result: result, isSelection: inputWasSelection)
        }
    }

    private func run(options: [String: String]) async {
        let workspace = Workspace.shared
        let (text, isSelection) = workspace.toolInput(for: spec)
        inputWasSelection = isSelection
        if spec.input == .required, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            emptyInput = true
            result = nil
            error = nil
            return
        }
        emptyInput = false
        let input = ToolInput(text: text, options: options, lang: AppSettings.shared.lang, now: Date())
        let spec = self.spec
        let outcome = await Task.detached(priority: .userInitiated) {
            Result(catching: { try spec.run(input) })
        }.value
        guard !Task.isCancelled else { return }
        switch outcome {
        case .success(let value):
            result = value
            error = nil
        case .failure(let failure):
            error = (failure as? ToolError) ?? ToolError(failure.localizedDescription)
            result = nil
        }
    }
}

// MARK: - 字段

@MainActor
struct FieldView: View {
    let field: ToolField
    let toolID: String
    let value: String
    var focused: FocusState<String?>.Binding

    private var binding: Binding<String> {
        Binding(
            get: { value },
            set: { Workspace.shared.setOption($0, for: field.id, tool: toolID) }
        )
    }

    var body: some View {
        switch field.kind {
        case .toggle:
            PaperCheckbox(
                label: field.label.text,
                isOn: Binding(
                    get: { ["1", "true"].contains(value) },
                    set: { Workspace.shared.setOption($0 ? "1" : "0", for: field.id, tool: toolID) }
                )
            )
            .help(field.help?.text ?? "")
            .padding(.top, 15)
        default:
            VStack(alignment: .leading, spacing: 4) {
                FieldLabel(text: field.label.text)
                    .help(field.help?.text ?? "")
                control
            }
        }
    }

    @ViewBuilder
    private var control: some View {
        switch field.kind {
        case .text(let placeholder, let secret, let mono, let multiline):
            if multiline {
                TextEditor(text: binding)
                    .font(mono ? PaperFont.mono(12.5) : .system(size: 13))
                    .scrollContentBackground(.hidden)
                    .focused(focused, equals: field.id)
                    .padding(6)
                    .frame(width: 420, height: 76)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.paper))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.rule, lineWidth: 1))
            } else if secret {
                SecureField(placeholder?.text ?? "", text: binding)
                    .focused(focused, equals: field.id)
                    .paperField(mono: mono)
                    .frame(width: 240)
            } else {
                TextField(placeholder?.text ?? "", text: binding)
                    .focused(focused, equals: field.id)
                    .paperField(mono: mono)
                    .frame(width: 240)
            }
        case .choice(let choices):
            if choices.count <= 4 {
                PaperSegmented(choices: choices, selection: binding)
            } else {
                PaperMenu(choices: choices, selection: binding)
            }
        case .number(let min, let max, let step):
            let number = Binding<Int>(
                get: { Int(value) ?? min },
                set: { Workspace.shared.setOption(String(Swift.min(Swift.max($0, min), max)), for: field.id, tool: toolID) }
            )
            HStack(spacing: 6) {
                TextField("", value: number, format: .number)
                    .paperField()
                    .frame(width: 72)
                Stepper("", value: number, in: min...max, step: step)
                    .labelsHidden()
            }
        case .toggle:
            EmptyView()
        }
    }
}

// MARK: - 结果

@MainActor
struct ToolResultView: View {
    let result: ToolResult
    let isSelection: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(result.notes.enumerated()), id: \.offset) { _, note in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: note.level == .warning ? "exclamationmark.triangle" : "info.circle")
                        .font(.system(size: 11))
                    Text(note.message)
                        .font(.system(size: 12))
                        .textSelection(.enabled)
                }
                .foregroundStyle(note.level == .warning ? Color.warningInk : Color.ink3)
            }
            ForEach(result.outputs) { output in
                OutputRow(output: output, isSelection: isSelection)
            }
            if let table = result.table {
                ToolTableView(table: table)
            }
        }
    }
}

@MainActor
struct OutputRow: View {
    let output: ToolOutput
    let isSelection: Bool
    @State private var copied = false

    private static let previewLimit = 20_000

    var body: some View {
        let isLong = output.value.contains("\n") || output.value.count > 96
        let preview = output.value.count > Self.previewLimit
            ? String(output.value.prefix(Self.previewLimit))
            : output.value
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                FieldLabel(text: output.label)
                Spacer(minLength: 8)
                if output.isPrimary {
                    Button(isSelection ? tr("替换选中", "Replace Selection") : tr("替换全文", "Replace Document")) {
                        Workspace.shared.replaceWithToolOutput(output.value)
                    }
                    .buttonStyle(PaperButtonStyle(compact: true))
                    Button(tr("新标签打开", "Open in New Tab")) {
                        Workspace.shared.openInNewTab(output.value, language: output.language)
                    }
                    .buttonStyle(PaperButtonStyle(compact: true))
                }
                Button(copied ? tr("已复制", "Copied") : tr("复制", "Copy")) {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(output.value, forType: .string)
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.4))
                        copied = false
                    }
                }
                .buttonStyle(PaperButtonStyle(compact: true))
            }
            Group {
                if isLong {
                    ScrollView([.vertical, .horizontal]) {
                        valueText(preview)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                    .frame(maxHeight: 220)
                } else {
                    valueText(preview)
                        .padding(.horizontal, 10)
                        .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                }
            }
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.well))
            if output.value.count > Self.previewLimit {
                Text(tr(
                    "只预览了前 \(Self.previewLimit) 个字符；复制或在新标签打开可以拿到完整结果",
                    "Showing the first \(Self.previewLimit) characters; copy or open in a new tab for the full result"
                ))
                .font(.system(size: 11))
                .foregroundStyle(Color.ink3)
            }
        }
    }

    private func valueText(_ text: String) -> some View {
        Text(text)
            .font(output.style == .mono ? PaperFont.mono(12.5) : .system(size: 13))
            .foregroundStyle(Color.ink)
            .lineSpacing(3)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }
}

@MainActor
struct ErrorRow: View {
    let error: ToolError
    let canReveal: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.circle")
            Text(error.message)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if canReveal, let line = error.line {
                Button(tr("定位到第 \(line) 行", "Go to line \(line)")) {
                    Workspace.shared.revealInActive(line: line, column: error.column ?? 1)
                }
                .buttonStyle(PaperButtonStyle(compact: true))
            }
        }
        .font(.system(size: 12.5))
        .foregroundStyle(Color.warningInk)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.mark.opacity(0.45)))
    }
}

@MainActor
struct ToolTableView: View {
    let table: ToolTable
    private static let rowLimit = 300

    var body: some View {
        let rows = Array(table.rows.prefix(Self.rowLimit))
        VStack(alignment: .leading, spacing: 4) {
            ScrollView([.horizontal, .vertical]) {
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 6) {
                    GridRow {
                        ForEach(Array(table.columns.enumerated()), id: \.offset) { _, column in
                            Text(column)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.ink3)
                        }
                    }
                    Divider().gridCellUnsizedAxes(.horizontal)
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                Text(cell)
                                    .font(PaperFont.mono(12))
                                    .foregroundStyle(Color.ink)
                                    .textSelection(.enabled)
                                    .lineLimit(3)
                            }
                        }
                    }
                }
                .padding(10)
            }
            .frame(maxHeight: 240)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.well))
            if table.rows.count > Self.rowLimit {
                Text(tr("共 \(table.rows.count) 行，只显示前 \(Self.rowLimit) 行", "\(table.rows.count) rows; showing the first \(Self.rowLimit)"))
                    .font(.system(size: 11))
                    .foregroundStyle(Color.ink3)
            }
        }
    }
}

// MARK: - 自动换行的横向布局（字段多时折到下一行）

struct FlowLayout: Layout {
    var spacing: CGFloat = 12
    var lineSpacing: CGFloat = 10

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                y += lineHeight + lineSpacing
                x = 0
                lineHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: proposal.width ?? widest, height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var lineHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += lineHeight + lineSpacing
                x = bounds.minX
                lineHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
