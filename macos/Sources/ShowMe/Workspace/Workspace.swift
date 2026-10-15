import AppKit
import Observation
import ShowMeCore

struct Flash: Identifiable, Equatable {
    let id = UUID()
    var message: String
    var isError: Bool
}

/// App 的全部状态：标签页、工具抽屉、会话存档。只有一个窗口，所以是单例。
@MainActor
@Observable
final class Workspace {
    static let shared = Workspace()

    var tabs: [DocumentTab] = []
    var activeID: UUID? {
        didSet {
            if let tab = activeTab, tab.isDocument { lastDocumentID = tab.id }
        }
    }
    /// 最近一次激活的文档（整页工具用它取「选中的文字」）
    private(set) var lastDocumentID: UUID?

    var drawerOpen = true
    var drawerHeight: Double = 250
    var toolID = "json-formatter"
    var toolOptions: [String: [String: String]] = [:]
    var recentTools: [String] = ToolRegistry.defaultChips
    var paletteOpen = false

    var lastAutosave: Date?
    var flash: Flash?
    /// ⌘⇧T「对选中内容使用工具」时 +1，抽屉据此聚焦
    var drawerFocusRequest = 0

    @ObservationIgnored let editors = EditorRegistry()
    @ObservationIgnored private var autosaveTask: Task<Void, Never>?
    @ObservationIgnored private var flashTask: Task<Void, Never>?
    @ObservationIgnored private var restored = false

    private init() {}

    private var lang: Lang { AppSettings.shared.lang }

    var activeTab: DocumentTab? {
        guard let activeID else { return nil }
        return tabs.first { $0.id == activeID }
    }

    var activeDocument: DocumentTab? {
        guard let tab = activeTab, tab.isDocument else { return nil }
        return tab
    }

    var lastDocument: DocumentTab? {
        tabs.first { $0.id == lastDocumentID && $0.isDocument } ?? tabs.last(where: \.isDocument)
    }

    var dirtyCount: Int { tabs.filter(\.isDirty).count }

    var currentTool: ToolSpec { ToolRegistry.tool(toolID) ?? JSONFormatterTool.spec }

    // MARK: - 会话

    func restoreSession() {
        guard !restored else { return }
        restored = true
        if let snapshot = SessionStore.load() {
            apply(snapshot)
        }
        if tabs.isEmpty {
            newDocument()
        }
    }

    private func apply(_ s: SessionSnapshot) {
        drawerOpen = s.drawer.isOpen
        drawerHeight = min(max(s.drawer.height, 150), 900)
        if ToolRegistry.tool(s.drawer.toolID) != nil { toolID = s.drawer.toolID }
        let recent = s.drawer.recent.filter { ToolRegistry.tool($0) != nil }
        if !recent.isEmpty { recentTools = recent }
        toolOptions = s.drawer.options

        for t in s.tabs {
            if t.kind == "tool" {
                if let toolID = t.toolID, ToolRegistry.tool(toolID) != nil {
                    tabs.append(DocumentTab(id: t.id, kind: .tool(toolID)))
                }
                continue
            }
            let encoding = TextEncoding(rawValue: t.encoding) ?? .utf8
            let ending = LineEnding(rawValue: t.lineEnding) ?? .lf
            let tab: DocumentTab
            if let path = t.path {
                let url = URL(fileURLWithPath: path)
                let disk = try? FileIO.read(url, lang: lang)
                if let text = t.text {
                    // 上次退出时有未保存的修改：恢复修改，磁盘版本作为对照
                    tab = DocumentTab(
                        id: t.id, url: url, language: t.language,
                        encoding: disk?.encoding ?? encoding, lineEnding: disk?.lineEnding ?? ending,
                        text: text, savedText: disk?.text
                    )
                    tab.fileMissing = disk == nil
                } else if let disk {
                    tab = DocumentTab(
                        id: t.id, url: url, language: t.language,
                        encoding: disk.encoding, lineEnding: disk.lineEnding,
                        text: disk.text, savedText: disk.text
                    )
                } else {
                    continue // 干净的文件已经不在了：不再恢复
                }
            } else {
                tab = DocumentTab(
                    id: t.id, untitledIndex: max(1, t.untitledIndex), language: t.language,
                    encoding: encoding, lineEnding: ending, text: t.text ?? ""
                )
            }
            let length = tab.text.utf16.count
            let location = min(max(0, t.selectionLocation), length)
            tab.selection = NSRange(location: location, length: min(max(0, t.selectionLength), length - location))
            tabs.append(tab)
        }
        if let id = s.activeID, tabs.contains(where: { $0.id == id }) {
            activeID = id
        } else {
            activeID = tabs.last?.id
        }
        lastAutosave = s.savedAt
    }

    func snapshot() -> SessionSnapshot {
        let secretKeys: [String: Set<String>] = Dictionary(
            uniqueKeysWithValues: ToolRegistry.all.map { ($0.id, Set($0.fields.filter(\.isSecret).map(\.id))) }
        )
        let options = toolOptions.reduce(into: [String: [String: String]]()) { result, entry in
            let hidden = secretKeys[entry.key] ?? []
            result[entry.key] = entry.value.filter { !hidden.contains($0.key) }
        }
        let savedTabs: [SessionSnapshot.Tab] = tabs.map { tab in
            SessionSnapshot.Tab(
                id: tab.id,
                kind: tab.isDocument ? "document" : "tool",
                toolID: tab.toolID,
                path: tab.url?.path,
                untitledIndex: tab.untitledIndex,
                language: tab.language,
                encoding: tab.encoding.rawValue,
                lineEnding: tab.lineEnding.rawValue,
                text: tab.isDocument && (tab.isDirty || tab.url == nil) ? tab.text : nil,
                selectionLocation: tab.selection.location,
                selectionLength: tab.selection.length
            )
        }
        return SessionSnapshot(
            tabs: savedTabs,
            activeID: activeID,
            drawer: .init(isOpen: drawerOpen, height: drawerHeight, toolID: toolID, recent: recentTools, options: options),
            savedAt: Date()
        )
    }

    func scheduleAutosave() {
        autosaveTask?.cancel()
        autosaveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            self?.autosaveNow()
        }
    }

    func autosaveNow(synchronously: Bool = false) {
        autosaveTask?.cancel()
        SessionStore.save(snapshot(), synchronously: synchronously)
        lastAutosave = Date()
    }

    // MARK: - 标签页

    @discardableResult
    func newDocument(text: String = "", language: String = "plain") -> DocumentTab {
        let used = tabs.filter { $0.isDocument && $0.url == nil }.map(\.untitledIndex)
        let tab = DocumentTab(untitledIndex: (used.max() ?? 0) + 1, language: language, text: text)
        insert(tab)
        return tab
    }

    private func insert(_ tab: DocumentTab) {
        if let active = activeTab, let index = tabs.firstIndex(where: { $0.id == active.id }) {
            tabs.insert(tab, at: index + 1)
        } else {
            tabs.append(tab)
        }
        activate(tab)
    }

    func activate(_ tab: DocumentTab) {
        guard activeID != tab.id else { return }
        activeID = tab.id
        scheduleAutosave()
    }

    func selectTab(offset: Int) {
        guard !tabs.isEmpty else { return }
        let index = tabs.firstIndex(where: { $0.id == activeID }) ?? 0
        let next = (index + offset + tabs.count) % tabs.count
        activate(tabs[next])
    }

    /// ⌘1…⌘8 选第 n 个，⌘9 选最后一个
    func selectTab(number: Int) {
        guard !tabs.isEmpty else { return }
        let index = number >= 9 ? tabs.count - 1 : number - 1
        if tabs.indices.contains(index) { activate(tabs[index]) }
    }

    func moveTab(_ id: UUID, before target: UUID?) {
        guard let from = tabs.firstIndex(where: { $0.id == id }) else { return }
        let tab = tabs.remove(at: from)
        if let target, let to = tabs.firstIndex(where: { $0.id == target }) {
            tabs.insert(tab, at: to)
        } else {
            tabs.append(tab)
        }
        scheduleAutosave()
    }

    func close(_ tab: DocumentTab) {
        if tab.isDirty {
            let alert = NSAlert()
            alert.messageText = tr("要保存对“\(tab.title)”的更改吗？", "Do you want to save the changes made to \"\(tab.title)\"?")
            alert.informativeText = tr("不保存的话，这些更改会丢失。", "Your changes will be lost if you don't save them.")
            alert.addButton(withTitle: tr("保存", "Save"))
            alert.addButton(withTitle: tr("取消", "Cancel"))
            alert.addButton(withTitle: tr("不保存", "Don't Save"))
            switch alert.runModal() {
            case .alertFirstButtonReturn:
                guard save(tab) else { return }
            case .alertThirdButtonReturn:
                break
            default:
                return
            }
        }
        remove(tab)
    }

    func closeActive() {
        if let tab = activeTab { close(tab) }
    }

    private func remove(_ tab: DocumentTab) {
        guard let index = tabs.firstIndex(where: { $0.id == tab.id }) else { return }
        tabs.remove(at: index)
        editors.remove(tab.id)
        if activeID == tab.id {
            activeID = tabs.isEmpty ? nil : tabs[min(index, tabs.count - 1)].id
        }
        if tabs.isEmpty {
            newDocument()
        }
        scheduleAutosave()
    }

    // MARK: - 打开 / 保存

    func showOpenPanel() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.prompt = tr("打开", "Open")
        if let dir = activeDocument?.url?.deletingLastPathComponent() {
            panel.directoryURL = dir
        }
        if panel.runModal() == .OK {
            open(urls: panel.urls)
        }
    }

    func open(urls: [URL]) {
        var last: DocumentTab?
        for raw in urls {
            let url = raw.standardizedFileURL
            if let existing = tabs.first(where: { $0.url?.standardizedFileURL == url }) {
                last = existing
                continue
            }
            var isDirectory: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue {
                showFlash(tr("暂不支持打开文件夹：\(url.lastPathComponent)", "Folders can't be opened: \(url.lastPathComponent)"), isError: true)
                continue
            }
            do {
                let loaded = try FileIO.read(url, lang: lang)
                let language = EditorLanguage.detect(fileName: url.lastPathComponent, content: loaded.text)
                let tab = DocumentTab(
                    url: url, language: language.id, encoding: loaded.encoding,
                    lineEnding: loaded.lineEnding, text: loaded.text, savedText: loaded.text
                )
                // 当前是一个空白的未命名标签：直接用它的位置
                if let blank = activeDocument, blank.url == nil, blank.text.isEmpty,
                   let index = tabs.firstIndex(where: { $0.id == blank.id }) {
                    tabs[index] = tab
                    editors.remove(blank.id)
                    activeID = tab.id
                } else {
                    insert(tab)
                }
                NSDocumentController.shared.noteNewRecentDocumentURL(url)
                last = tab
            } catch {
                showFlash(error.localizedDescription, isError: true)
            }
        }
        if let last {
            activate(last)
        }
        scheduleAutosave()
    }

    @discardableResult
    func save(_ tab: DocumentTab) -> Bool {
        guard tab.isDocument else { return false }
        guard let url = tab.url else { return saveAs(tab) }
        editors.existing(tab.id)?.syncText()
        do {
            try FileIO.write(tab.text, to: url, encoding: tab.encoding, lineEnding: tab.lineEnding, lang: lang)
            tab.savedText = tab.text
            tab.fileMissing = false
            tab.formatChanged = false
            tab.refreshDirty()
            NSDocumentController.shared.noteNewRecentDocumentURL(url)
            scheduleAutosave()
            return true
        } catch {
            showFlash(error.localizedDescription, isError: true)
            return false
        }
    }

    @discardableResult
    func saveAs(_ tab: DocumentTab) -> Bool {
        guard tab.isDocument else { return false }
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.nameFieldStringValue = suggestedFileName(for: tab)
        if let dir = tab.url?.deletingLastPathComponent() {
            panel.directoryURL = dir
        }
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        let wasUntitled = tab.url == nil
        tab.url = url
        if wasUntitled || tab.language == "plain" {
            let detected = EditorLanguage.detect(fileName: url.lastPathComponent, content: tab.text)
            if detected.id != tab.language {
                tab.language = detected.id
                editors.existing(tab.id)?.languageDidChange()
            }
        }
        return save(tab)
    }

    func saveActive() {
        if let tab = activeDocument { save(tab) }
    }

    func saveActiveAs() {
        if let tab = activeDocument { saveAs(tab) }
    }

    func saveAll() {
        for tab in tabs where tab.isDirty && tab.url != nil {
            save(tab)
        }
    }

    private func suggestedFileName(for tab: DocumentTab) -> String {
        if let url = tab.url { return url.lastPathComponent }
        let ext = tab.languageInfo.extensions.first ?? "txt"
        return "\(tab.title).\(ext)"
    }

    /// 回到 App 时：干净的文件如果在外部被改过，就重新载入
    func reloadChangedFiles() {
        for tab in tabs where tab.isDocument && !tab.isDirty {
            guard let url = tab.url else { continue }
            guard let disk = try? FileIO.read(url, lang: lang) else {
                tab.fileMissing = !FileManager.default.fileExists(atPath: url.path)
                continue
            }
            tab.fileMissing = false
            if disk.text != tab.savedText {
                tab.encoding = disk.encoding
                tab.lineEnding = disk.lineEnding
                tab.savedText = disk.text
                if let editor = editors.existing(tab.id) {
                    editor.reload(with: disk.text)
                } else {
                    tab.text = disk.text
                    tab.revision += 1
                }
                tab.refreshDirty()
            }
        }
    }

    // MARK: - 编辑器回调

    func textDidChange(_ tab: DocumentTab, text: String) {
        tab.text = text
        tab.revision += 1
        tab.refreshDirty()
        scheduleAutosave()
    }

    func selectionDidChange(_ tab: DocumentTab, range: NSRange) {
        if tab.selection != range {
            tab.selection = range
        }
    }

    func setLanguage(_ language: String, for tab: DocumentTab) {
        guard tab.language != language else { return }
        tab.language = language
        editors.existing(tab.id)?.languageDidChange()
        scheduleAutosave()
    }

    func setLineEnding(_ ending: LineEnding, for tab: DocumentTab) {
        guard tab.lineEnding != ending else { return }
        tab.lineEnding = ending
        // 换行符变化算作修改：保存时才会写入磁盘
        tab.formatChanged = tab.url != nil
        tab.refreshDirty()
        scheduleAutosave()
    }

    func setEncoding(_ encoding: TextEncoding, for tab: DocumentTab) {
        guard tab.encoding != encoding else { return }
        tab.encoding = encoding
        tab.formatChanged = tab.url != nil
        tab.refreshDirty()
        scheduleAutosave()
    }

    // MARK: - 格式化

    func formatActive() {
        guard let tab = activeDocument else { return }
        let info = tab.languageInfo
        guard info.formatter(forFileName: tab.url?.lastPathComponent) != nil else {
            showFlash(tr("\(info.displayName(.zh)) 暂不支持格式化", "Formatting isn't available for \(info.displayName(.en))"), isError: true)
            return
        }
        editors.existing(tab.id)?.syncText()
        let text = tab.text
        let revision = tab.revision
        let languageID = tab.language
        let fileName = tab.url?.lastPathComponent
        let indent = AppSettings.shared.indentWidth
        let lang = self.lang
        Task {
            let result = await BigStack.run {
                Result(catching: { try DocumentFormatter.format(text, languageID: languageID, fileName: fileName, indentWidth: indent, lang: lang) })
            }
            guard tab.revision == revision else { return } // 格式化期间又改动了：放弃这次结果
            switch result {
            case .success(let formatted):
                if formatted == text {
                    showFlash(tr("已经很整齐了", "Already formatted"))
                } else {
                    editors.existing(tab.id)?.replaceAll(with: formatted, actionName: tr("格式化", "Format"))
                    showFlash(tr("已格式化", "Formatted"))
                }
            case .failure(let error):
                if let toolError = error as? ToolError, let line = toolError.line {
                    editors.existing(tab.id)?.reveal(line: line, column: toolError.column ?? 1)
                }
                showFlash(error.localizedDescription, isError: true)
            }
        }
    }

    // MARK: - 工具

    func openTool(_ id: String) {
        guard let spec = ToolRegistry.tool(id) else { return }
        noteRecent(id)
        if let view = spec.customView, view != "markdown" {
            if let existing = tabs.first(where: { $0.toolID == id }) {
                activate(existing)
            } else {
                insert(DocumentTab(kind: .tool(id)))
            }
        } else {
            toolID = id
            drawerOpen = true
            drawerFocusRequest += 1
            // 从工具页切回来：回到最近的文档
            if activeDocument == nil, let doc = tabs.last(where: \.isDocument) {
                activate(doc)
            }
        }
        scheduleAutosave()
    }

    func noteRecent(_ id: String) {
        guard ToolRegistry.tool(id)?.customView == nil || ToolRegistry.tool(id)?.customView == "markdown" else { return }
        if recentTools.contains(id) { return }
        recentTools.insert(id, at: 0)
        if recentTools.count > 7 { recentTools.removeLast(recentTools.count - 7) }
    }

    func options(for spec: ToolSpec) -> [String: String] {
        spec.defaults.merging(toolOptions[spec.id] ?? [:]) { _, new in new }
    }

    func setOption(_ value: String, for key: String, tool: String) {
        var current = toolOptions[tool] ?? [:]
        guard current[key] != value else { return }
        current[key] = value
        toolOptions[tool] = current
        scheduleAutosave()
    }

    /// 工具的输入：选区，没有选区时用整篇文档
    func toolInput(for spec: ToolSpec) -> (text: String, isSelection: Bool) {
        guard spec.input != .none, let tab = activeDocument else { return ("", false) }
        if let selected = tab.selectedText, !selected.isEmpty {
            return (selected, true)
        }
        return (tab.text, false)
    }

    /// 用工具结果替换选区（没有选区时替换整篇）
    func replaceWithToolOutput(_ value: String) {
        guard let tab = activeDocument, let editor = editors.existing(tab.id) else { return }
        if tab.selection.length > 0 {
            editor.replace(range: tab.selection, with: value, actionName: tr("替换选中", "Replace Selection"))
        } else {
            editor.replaceAll(with: value, actionName: tr("替换全文", "Replace Document"))
        }
    }

    func openInNewTab(_ value: String, language: String?) {
        let detected = language ?? EditorLanguage.detect(fileName: nil, content: value).id
        newDocument(text: value, language: detected)
    }

    func revealInActive(line: Int, column: Int) {
        guard let tab = activeDocument else { return }
        editors.existing(tab.id)?.reveal(line: line, column: column)
    }

    // MARK: - 提示

    func showFlash(_ message: String, isError: Bool = false) {
        flash = Flash(message: message, isError: isError)
        flashTask?.cancel()
        flashTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(isError ? 4 : 2))
            guard !Task.isCancelled else { return }
            self?.flash = nil
        }
    }
}
