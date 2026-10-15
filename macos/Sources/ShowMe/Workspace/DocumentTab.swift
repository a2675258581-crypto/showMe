import Foundation
import Observation
import ShowMeCore

/// 一个标签页：文档（文件或未命名），或者一个需要整页界面的工具（API 调试、二维码……）。
@MainActor
@Observable
final class DocumentTab: Identifiable {
    enum Kind: Equatable {
        case document
        case tool(String)
    }

    let id: UUID
    let kind: Kind
    var url: URL?
    /// 未命名文档的序号（显示为「未命名 2」/ "Untitled 2"）
    var untitledIndex: Int
    var language: String
    var encoding: TextEncoding
    var lineEnding: LineEnding
    /// 当前内容；编辑器每次修改后同步过来
    var text: String
    /// 磁盘上的版本（未命名 / 文件已被删除时为 nil）
    var savedText: String?
    var isDirty = false
    /// 每次内容变化 +1，界面用它触发防抖计算，而不是直接观察 text
    var revision = 0
    /// UTF-16 选区
    var selection = NSRange(location: 0, length: 0)
    var fileMissing = false
    /// 改了编码或换行符（内容没变也需要保存）
    var formatChanged = false

    init(
        id: UUID = UUID(),
        kind: Kind = .document,
        url: URL? = nil,
        untitledIndex: Int = 0,
        language: String = "plain",
        encoding: TextEncoding = .utf8,
        lineEnding: LineEnding = .lf,
        text: String = "",
        savedText: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.url = url
        self.untitledIndex = untitledIndex
        self.language = language
        self.encoding = encoding
        self.lineEnding = lineEnding
        self.text = text
        self.savedText = savedText
        refreshDirty()
    }

    var isDocument: Bool { kind == .document }

    var toolID: String? {
        if case .tool(let id) = kind { return id }
        return nil
    }

    var title: String {
        if let toolID, let tool = ToolRegistry.tool(toolID) { return tool.name.text }
        if let url { return url.lastPathComponent }
        let base = tr("未命名", "Untitled")
        return untitledIndex > 1 ? "\(base) \(untitledIndex)" : base
    }

    /// 文档标题（去掉扩展名），显示在纸面顶部
    var headline: String {
        guard let url else { return title }
        let name = url.deletingPathExtension().lastPathComponent
        return name.isEmpty ? url.lastPathComponent : name
    }

    var languageInfo: EditorLanguage { EditorLanguage.byID(language) }

    func refreshDirty() {
        if !isDocument {
            isDirty = false
        } else if let savedText {
            isDirty = formatChanged || text.utf16.count != savedText.utf16.count || text != savedText
        } else {
            // 未命名：有内容就算未保存
            isDirty = !text.isEmpty
        }
    }

    /// 选中的文字；没有选区时为 nil
    var selectedText: String? {
        guard selection.length > 0 else { return nil }
        let ns = text as NSString
        guard NSMaxRange(selection) <= ns.length else { return nil }
        return ns.substring(with: selection)
    }
}
