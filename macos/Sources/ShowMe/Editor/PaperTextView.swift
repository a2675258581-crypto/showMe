import AppKit
import ShowMeCore

/// 纸面编辑器：正文居中成一栏、顶部留出标题区；补上代码编辑常用的按键行为。
final class PaperTextView: NSTextView {
    weak var controller: EditorController?
    var headerView: NSView?

    static let headerHeight: CGFloat = 92
    static let topPadding: CGFloat = 26

    /// 一栏的最大宽度（正文窄、代码宽）
    var columnWidth: CGFloat = 760 {
        didSet { if columnWidth != oldValue { updateInsets() } }
    }

    var wrapsLines = true {
        didSet { if wrapsLines != oldValue { updateInsets() } }
    }

    private var visibleWidth: CGFloat {
        enclosingScrollView?.contentSize.width ?? frame.width
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        updateInsets()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        updateInsets()
    }

    func updateInsets() {
        let width = visibleWidth
        let side: CGFloat = wrapsLines ? max(32, floor((width - columnWidth) / 2)) : 40
        let inset = NSSize(width: side, height: Self.headerHeight + Self.topPadding + 8)
        if textContainerInset != inset {
            textContainerInset = inset
        }
        layoutHeader()
    }

    func layoutHeader() {
        guard let header = headerView else { return }
        let x = textContainerInset.width
        let width = wrapsLines ? min(columnWidth, visibleWidth - 2 * x) : visibleWidth - 2 * x
        let frame = NSRect(x: x, y: Self.topPadding, width: max(200, width), height: Self.headerHeight)
        if header.frame != frame {
            header.frame = frame
        }
    }

    private var indentUnit: String {
        MainActor.assumeIsolated { AppSettings.shared.indentUnit }
    }

    private var language: EditorLanguage? {
        MainActor.assumeIsolated { controller?.tab.languageInfo }
    }

    // MARK: - Esc：查找栏开着时先关掉查找栏

    override func cancelOperation(_ sender: Any?) {
        let handled = MainActor.assumeIsolated { () -> Bool in
            guard FindModel.shared.isVisible else { return false }
            FindModel.shared.close()
            return true
        }
        if !handled { super.cancelOperation(sender) }
    }

    // MARK: - 换行自动缩进

    override func insertNewline(_ sender: Any?) {
        let ns = string as NSString
        let selection = selectedRange()
        guard selection.location <= ns.length else { return super.insertNewline(sender) }
        let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        let before = ns.substring(with: NSRange(location: lineRange.location, length: selection.location - lineRange.location))
        var indent = String(before.prefix { $0 == " " || $0 == "\t" })
        let trimmed = before.trimmingCharacters(in: .whitespaces)
        let isProse = language?.isProse ?? true

        if isProse, language?.id == "markdown", let marker = Self.listMarker(in: trimmed) {
            if trimmed == marker.trimmingCharacters(in: .whitespaces) {
                // 空的列表项上回车：结束列表
                let range = NSRange(location: lineRange.location, length: selection.location - lineRange.location)
                insertText("", replacementRange: range)
                return
            }
            insertText("\n" + indent + Self.nextListMarker(marker), replacementRange: selection)
            return
        }

        if !isProse, let last = trimmed.last, "{[(".contains(last) || (last == ":" && ["python", "yaml"].contains(language?.id ?? "")) {
            let unit = indentUnit
            let after = ns.substring(with: NSRange(location: selection.location, length: max(0, NSMaxRange(lineRange) - selection.location)))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let closing: [Character: Character] = ["{": "}", "[": "]", "(": ")"]
            if let close = closing[last], after.first == close {
                // 光标在一对括号中间：展开成三行
                insertText("\n" + indent + unit + "\n" + indent, replacementRange: selection)
                setSelectedRange(NSRange(location: selection.location + 1 + (indent + unit as NSString).length, length: 0))
                return
            }
            indent += unit
        }
        insertText("\n" + indent, replacementRange: selection)
    }

    private static func listMarker(in line: String) -> String? {
        for bullet in ["- [ ] ", "- [x] ", "- ", "* ", "+ ", "> "] where line.hasPrefix(bullet) {
            return bullet
        }
        let digits = line.prefix { $0.isNumber }
        if !digits.isEmpty, line.dropFirst(digits.count).hasPrefix(". ") {
            return String(digits) + ". "
        }
        return nil
    }

    private static func nextListMarker(_ marker: String) -> String {
        if marker == "- [x] " { return "- [ ] " }
        let digits = marker.prefix { $0.isNumber }
        if let n = Int(digits) { return "\(n + 1). " }
        return marker
    }

    // MARK: - 输入右括号时自动回退一级缩进

    override func insertText(_ insertString: Any, replacementRange: NSRange) {
        if let s = insertString as? String, s.count == 1, "}])".contains(s), !(language?.isProse ?? true) {
            let ns = string as NSString
            let selection = replacementRange.location == NSNotFound ? selectedRange() : replacementRange
            if selection.length == 0, selection.location <= ns.length {
                let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
                let before = ns.substring(with: NSRange(location: lineRange.location, length: selection.location - lineRange.location))
                if !before.isEmpty, before.allSatisfy({ $0 == " " || $0 == "\t" }) {
                    let unit = indentUnit
                    var reduced = before
                    if reduced.hasSuffix(unit) {
                        reduced.removeLast(unit.count)
                    } else if reduced.hasSuffix("\t") {
                        reduced.removeLast()
                    }
                    if reduced != before {
                        let range = NSRange(location: lineRange.location, length: (before as NSString).length)
                        super.insertText(reduced + s, replacementRange: range)
                        return
                    }
                }
            }
        }
        super.insertText(insertString, replacementRange: replacementRange)
    }

    // MARK: - Tab / Shift-Tab：多行时整体缩进

    override func insertTab(_ sender: Any?) {
        let selection = selectedRange()
        let ns = string as NSString
        if selection.length > 0, ns.substring(with: selection).contains("\n") {
            shiftSelectedLines(outdent: false)
        } else {
            insertText(indentUnit, replacementRange: selection)
        }
    }

    override func insertBacktab(_ sender: Any?) {
        shiftSelectedLines(outdent: true)
    }

    func shiftSelectedLines(outdent: Bool) {
        let unit = indentUnit
        transformSelectedLines { lines in
            lines.map { line in
                if outdent {
                    if line.hasPrefix("\t") { return String(line.dropFirst()) }
                    let spaces = line.prefix { $0 == " " }.count
                    return String(line.dropFirst(min(spaces, max(unit.count, 1))))
                }
                return line.isEmpty ? line : unit + line
            }
        }
    }

    /// ⌘/：按语言的行注释符号注释 / 取消注释选中的行
    func toggleLineComment() {
        guard let language else { return }
        guard let token = language.lineComment else {
            NSSound.beep()
            return
        }
        transformSelectedLines { lines in
            let content = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            let allCommented = !content.isEmpty && content.allSatisfy {
                $0.trimmingCharacters(in: .whitespaces).hasPrefix(token)
            }
            if allCommented {
                return lines.map { line in
                    guard let range = line.range(of: token) else { return line }
                    var after = line[range.upperBound...]
                    if after.hasPrefix(" ") { after = after.dropFirst() }
                    return String(line[..<range.lowerBound]) + after
                }
            }
            let minIndent = content.map { $0.prefix { $0 == " " || $0 == "\t" }.count }.min() ?? 0
            return lines.map { line in
                guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { return line }
                let index = line.index(line.startIndex, offsetBy: minIndent)
                return String(line[..<index]) + token + " " + String(line[index...])
            }
        }
    }

    private func transformSelectedLines(_ transform: ([String]) -> [String]) {
        let ns = string as NSString
        let selection = selectedRange()
        var linesRange = ns.lineRange(for: selection)
        // 选区刚好停在下一行行首时，不算那一行
        if selection.length > 0, NSMaxRange(selection) == linesRange.location + linesRange.length,
           NSMaxRange(selection) > 0, ns.character(at: NSMaxRange(selection) - 1) == 0x0A {
            linesRange = ns.lineRange(for: NSRange(location: selection.location, length: selection.length - 1))
        }
        let block = ns.substring(with: linesRange)
        let endsWithNewline = block.hasSuffix("\n")
        var lines = block.components(separatedBy: "\n")
        if endsWithNewline { lines.removeLast() }
        var result = transform(lines).joined(separator: "\n")
        if endsWithNewline { result += "\n" }
        guard result != block, shouldChangeText(in: linesRange, replacementString: result) else { return }
        textStorage?.replaceCharacters(in: linesRange, with: result)
        didChangeText()
        let length = (result as NSString).length - (endsWithNewline ? 1 : 0)
        setSelectedRange(NSRange(location: linesRange.location, length: max(0, length)))
    }

    // MARK: - 拖入文件 = 打开文件

    override var acceptableDragTypes: [NSPasteboard.PasteboardType] {
        var types = super.acceptableDragTypes
        if !types.contains(.fileURL) { types.append(.fileURL) }
        return types
    }

    private func droppedFileURLs(_ info: NSDraggingInfo) -> [URL] {
        let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
        let objects = info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: options) ?? []
        return objects.compactMap { $0 as? URL }
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        droppedFileURLs(sender).isEmpty ? super.draggingEntered(sender) : .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        droppedFileURLs(sender).isEmpty ? super.draggingUpdated(sender) : .copy
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = droppedFileURLs(sender)
        guard !urls.isEmpty else { return super.performDragOperation(sender) }
        MainActor.assumeIsolated { controller?.openDropped(urls) }
        return true
    }
}
