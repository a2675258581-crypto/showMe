import AppKit
import ShowMeCore
import SwiftUI

/// 把当前标签的编辑器（NSScrollView）嵌进 SwiftUI。切换标签时只换子视图，编辑器本身一直保留。
@MainActor
struct EditorView: NSViewRepresentable {
    let tab: DocumentTab

    func makeNSView(context: Context) -> EditorHostView {
        EditorHostView()
    }

    func updateNSView(_ host: EditorHostView, context: Context) {
        host.show(Workspace.shared.editors.controller(for: tab))
    }
}

final class EditorHostView: NSView {
    private weak var current: EditorController?

    override var isFlipped: Bool { true }

    func show(_ controller: EditorController) {
        guard current !== controller else { return }
        subviews.forEach { $0.removeFromSuperview() }
        let scroll = controller.scrollView
        scroll.frame = bounds
        scroll.autoresizingMask = [.width, .height]
        addSubview(scroll)
        current = controller
        MainActor.assumeIsolated { controller.didAppear() }
    }

    override func layout() {
        super.layout()
        subviews.first?.frame = bounds
    }
}

/// 纸面顶部的标题区：文件名（衬线大字）+ 一行元信息。它是编辑器的子视图，会随正文一起滚走。
@MainActor
struct DocHeader: View {
    let tab: DocumentTab
    @State private var words = 0
    @State private var line = 1
    @State private var column = 1

    var body: some View {
        let info = tab.languageInfo
        VStack(alignment: .leading, spacing: 8) {
            Text(tab.headline)
                .font(PaperFont.serif(info.isProse ? 30 : 24))
                .foregroundStyle(Color.ink)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.disabled)
            HStack(spacing: 0) {
                meta(info)
                Spacer(minLength: 12)
                if info.formatter != nil {
                    Button {
                        Workspace.shared.formatActive()
                    } label: {
                        HStack(spacing: 6) {
                            Text(tr("格式化", "Format"))
                            Text("⌥⇧F").foregroundStyle(Color.ink3)
                        }
                    }
                    .buttonStyle(PaperButtonStyle(compact: true))
                    .help(tr("按语言格式化整篇文档", "Format the whole document for its language"))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        .task(id: tab.revision) {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            words = TextStats.wordCount(tab.text)
        }
        .task(id: SelectionKey(revision: tab.revision, location: tab.selection.location)) {
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            let position = TextStats.lineColumn(in: tab.text, utf16Offset: tab.selection.location)
            line = position.line
            column = position.column
        }
    }

    private struct SelectionKey: Equatable {
        var revision: Int
        var location: Int
    }

    @ViewBuilder
    private func meta(_ info: EditorLanguage) -> some View {
        HStack(spacing: 6) {
            if let url = tab.url {
                Text(url.lastPathComponent)
                    .help(url.path)
                dot
            }
            languageMenu(info)
            dot
            Text(tr("\(words) 字", words == 1 ? "1 word" : "\(words) words"))
            dot
            if tab.selection.length > 0 {
                Text(tr("已选 \(tab.selection.length) 字符", "\(tab.selection.length) selected"))
            } else {
                Text(tr("行 \(line)，列 \(column)", "Ln \(line), Col \(column)"))
            }
            dot
            encodingMenu
            lineEndingMenu
            if tab.fileMissing {
                dot
                Text(tr("文件已不在原位置", "File no longer exists"))
                    .foregroundStyle(Color.warningInk)
            }
        }
        .font(.system(size: 12))
        .foregroundStyle(Color.ink3)
        .lineLimit(1)
    }

    private var dot: some View {
        Text("·").foregroundStyle(Color.ink3.opacity(0.7))
    }

    private func languageMenu(_ info: EditorLanguage) -> some View {
        Menu {
            ForEach(EditorLanguage.all) { language in
                Button(language.displayName(AppSettings.shared.lang)) {
                    Workspace.shared.setLanguage(language.id, for: tab)
                }
            }
        } label: {
            Text(info.displayName(AppSettings.shared.lang))
                .font(.system(size: 12))
                .foregroundStyle(Color.ink3)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .help(tr("切换语法高亮的语言", "Change the language mode"))
    }

    private var encodingMenu: some View {
        Menu {
            ForEach([TextEncoding.utf8, .utf8BOM, .utf16LE, .utf16BE, .gb18030, .latin1], id: \.self) { encoding in
                Button(encoding.displayName) {
                    Workspace.shared.setEncoding(encoding, for: tab)
                }
            }
        } label: {
            Text(tab.encoding.displayName)
                .font(.system(size: 12))
                .foregroundStyle(Color.ink3)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .help(tr("保存时使用的文字编码", "Text encoding used when saving"))
    }

    private var lineEndingMenu: some View {
        Menu {
            ForEach([LineEnding.lf, .crlf, .cr], id: \.self) { ending in
                Button(Self.name(of: ending)) {
                    Workspace.shared.setLineEnding(ending, for: tab)
                }
            }
        } label: {
            Text(Self.name(of: tab.lineEnding))
                .font(.system(size: 12))
                .foregroundStyle(Color.ink3)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .help(tr("换行符", "Line endings"))
    }

    private static func name(of ending: LineEnding) -> String {
        switch ending {
        case .lf: "LF"
        case .crlf: "CRLF"
        case .cr: "CR"
        }
    }
}
