import AppKit
import ShowMeCore
import SwiftUI

/// 每个文档标签一个编辑器（各自保留撤销栈、滚动位置）。
@MainActor
final class EditorRegistry {
    private var controllers: [UUID: EditorController] = [:]

    func controller(for tab: DocumentTab) -> EditorController {
        if let existing = controllers[tab.id] { return existing }
        let controller = EditorController(tab: tab)
        controllers[tab.id] = controller
        return controller
    }

    func existing(_ id: UUID) -> EditorController? { controllers[id] }

    func remove(_ id: UUID) {
        controllers.removeValue(forKey: id)
    }

    /// 字号、换行、强调色等设置变了
    func settingsDidChange() {
        for controller in controllers.values {
            controller.applySettings()
        }
    }
}

/// NSTextView（TextKit 1）+ 纸面排版：内容居中成一栏，顶部是随正文滚动的标题区。
@MainActor
final class EditorController: NSObject, NSTextViewDelegate {
    let tab: DocumentTab
    let scrollView = NSScrollView()
    let textView: PaperTextView
    private let header: NSHostingView<DocHeader>
    private var highlightTask: Task<Void, Never>?
    private(set) var baseAttributes: [NSAttributedString.Key: Any] = [:]
    private var baseFont = NSFont.systemFont(ofSize: 14)

    init(tab: DocumentTab) {
        self.tab = tab
        let storage = NSTextStorage(string: tab.text)
        let layout = NSLayoutManager()
        layout.allowsNonContiguousLayout = true
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: NSSize(width: 600, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        container.lineFragmentPadding = 0
        layout.addTextContainer(container)
        textView = PaperTextView(frame: NSRect(x: 0, y: 0, width: 600, height: 400), textContainer: container)
        header = NSHostingView(rootView: DocHeader(tab: tab))
        super.init()
        configure()
    }

    private func configure() {
        let tv = textView
        tv.controller = self
        tv.delegate = self
        tv.isRichText = false
        tv.importsGraphics = false
        tv.allowsUndo = true
        tv.usesFindBar = true
        tv.isIncrementalSearchingEnabled = true
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.isAutomaticTextReplacementEnabled = false
        tv.isAutomaticSpellingCorrectionEnabled = false
        tv.isContinuousSpellCheckingEnabled = false
        tv.isGrammarCheckingEnabled = false
        tv.isAutomaticLinkDetectionEnabled = false
        tv.isAutomaticDataDetectionEnabled = false
        tv.smartInsertDeleteEnabled = false
        tv.usesFontPanel = false
        tv.usesRuler = false
        tv.drawsBackground = false
        tv.allowsDocumentBackgroundColorChange = false
        tv.isVerticallyResizable = true
        tv.isHorizontallyResizable = false
        tv.autoresizingMask = [.width]
        tv.minSize = NSSize(width: 0, height: 0)
        tv.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        tv.selectedTextAttributes = [.backgroundColor: Ink.mark]
        tv.updateDragTypeRegistration()

        scrollView.documentView = tv
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.automaticallyAdjustsContentInsets = false
        scrollView.contentInsets = NSEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)

        header.sizingOptions = []
        tv.headerView = header
        tv.addSubview(header)

        applySettings()
        let length = (tab.text as NSString).length
        let location = min(tab.selection.location, length)
        tv.setSelectedRange(NSRange(location: location, length: min(tab.selection.length, length - location)))
    }

    // MARK: - 外观

    func applySettings() {
        let settings = AppSettings.shared
        let info = tab.languageInfo
        let size = CGFloat(settings.fontSize)
        let font: NSFont = info.isProse
            ? NSFont.systemFont(ofSize: size + 1)
            : NSFont.monospacedSystemFont(ofSize: size - 1, weight: .regular)
        baseFont = font
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = info.isProse ? round(size * 0.72) : round(size * 0.48)
        let spaceWidth = (" " as NSString).size(withAttributes: [.font: font]).width
        paragraph.defaultTabInterval = spaceWidth * CGFloat(settings.indentWidth == 0 ? 4 : settings.indentWidth)
        paragraph.tabStops = []
        baseAttributes = [.font: font, .foregroundColor: Ink.text, .paragraphStyle: paragraph]

        textView.font = font
        textView.textColor = Ink.text
        textView.defaultParagraphStyle = paragraph
        textView.typingAttributes = baseAttributes
        textView.insertionPointColor = Ink.accent
        if let storage = textView.textStorage, storage.length > 0 {
            storage.beginEditing()
            storage.setAttributes(baseAttributes, range: NSRange(location: 0, length: storage.length))
            storage.endEditing()
        }
        textView.columnWidth = info.isProse ? 680 : 860
        setWrap(settings.wrapLines)
        highlightNow()
    }

    private func setWrap(_ wrap: Bool) {
        guard let container = textView.textContainer else { return }
        textView.wrapsLines = wrap
        if wrap {
            container.widthTracksTextView = true
            textView.isHorizontallyResizable = false
            scrollView.hasHorizontalScroller = false
            let width = scrollView.contentSize.width
            if width > 0 { textView.setFrameSize(NSSize(width: width, height: textView.frame.height)) }
        } else {
            container.widthTracksTextView = false
            container.size = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
            textView.isHorizontallyResizable = true
            scrollView.hasHorizontalScroller = true
        }
        textView.updateInsets()
    }

    func languageDidChange() {
        applySettings()
    }

    // MARK: - 焦点与定位

    func focus() {
        guard let window = textView.window else { return }
        if window.firstResponder !== textView {
            window.makeFirstResponder(textView)
        }
    }

    func didAppear() {
        textView.updateInsets()
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.focus()
            self.textView.scrollRangeToVisible(self.textView.selectedRange())
        }
    }

    /// 跳到第 line 行第 column 列（都从 1 开始）
    func reveal(line: Int, column: Int) {
        let ns = textView.string as NSString
        var location = 0
        var current = 1
        while current < line, location < ns.length {
            location = NSMaxRange(ns.lineRange(for: NSRange(location: location, length: 0)))
            current += 1
        }
        let lineRange = ns.lineRange(for: NSRange(location: min(location, ns.length), length: 0))
        var contentEnd = NSMaxRange(lineRange)
        while contentEnd > lineRange.location {
            let ch = ns.character(at: contentEnd - 1)
            if ch == 0x0A || ch == 0x0D { contentEnd -= 1 } else { break }
        }
        var position = lineRange.location
        var col = 1
        while col < column, position < contentEnd {
            position = NSMaxRange(ns.rangeOfComposedCharacterSequence(at: position))
            col += 1
        }
        let target = NSRange(location: min(position, ns.length), length: 0)
        textView.setSelectedRange(target)
        textView.scrollRangeToVisible(target)
        if lineRange.length > 0 {
            textView.showFindIndicator(for: NSRange(location: lineRange.location, length: contentEnd - lineRange.location))
        }
        focus()
    }

    // MARK: - 修改内容（全部走 shouldChangeText / didChangeText，可撤销）

    func syncText() {
        let current = textView.string
        if current != tab.text {
            Workspace.shared.textDidChange(tab, text: current)
        }
    }

    func replace(range: NSRange, with text: String, actionName: String) {
        let ns = textView.string as NSString
        guard NSMaxRange(range) <= ns.length else { return }
        guard textView.shouldChangeText(in: range, replacementString: text) else { return }
        textView.textStorage?.replaceCharacters(in: range, with: NSAttributedString(string: text, attributes: baseAttributes))
        textView.didChangeText()
        textView.undoManager?.setActionName(actionName)
        let inserted = NSRange(location: range.location, length: (text as NSString).length)
        textView.setSelectedRange(inserted)
        textView.scrollRangeToVisible(inserted)
    }

    func replaceAll(with text: String, actionName: String) {
        let ns = textView.string as NSString
        let caret = textView.selectedRange().location
        let full = NSRange(location: 0, length: ns.length)
        guard textView.shouldChangeText(in: full, replacementString: text) else { return }
        textView.textStorage?.replaceCharacters(in: full, with: NSAttributedString(string: text, attributes: baseAttributes))
        textView.didChangeText()
        textView.undoManager?.setActionName(actionName)
        let target = NSRange(location: min(caret, (text as NSString).length), length: 0)
        textView.setSelectedRange(target)
        textView.scrollRangeToVisible(target)
    }

    /// 文件在外部被改：直接载入新内容（不进撤销栈）
    func reload(with text: String) {
        let selection = textView.selectedRange()
        textView.textStorage?.setAttributedString(NSAttributedString(string: text, attributes: baseAttributes))
        textView.undoManager?.removeAllActions()
        let length = (text as NSString).length
        let location = min(selection.location, length)
        textView.setSelectedRange(NSRange(location: location, length: 0))
        Workspace.shared.textDidChange(tab, text: text)
        highlightNow()
    }

    // MARK: - NSTextViewDelegate

    func textDidChange(_ notification: Notification) {
        Workspace.shared.textDidChange(tab, text: textView.string)
        scheduleHighlight()
    }

    func textViewDidChangeSelection(_ notification: Notification) {
        Workspace.shared.selectionDidChange(tab, range: textView.selectedRange())
    }

    // MARK: - 语法高亮

    private func scheduleHighlight() {
        highlightTask?.cancel()
        highlightTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            self?.highlightNow()
        }
    }

    /// 颜色用 NSLayoutManager 的临时属性（不触发重新排版）；Markdown 的标题字号要改字体，直接写进 textStorage。
    func highlightNow() {
        guard let storage = textView.textStorage else { return }
        // 输入法正在组字时不要动属性，否则会打断拼音输入
        if textView.hasMarkedText() {
            scheduleHighlight()
            return
        }
        let language = tab.languageInfo.id
        let length = storage.length
        if length == 0 || length > 800_000 || language == "plain" || language == "log" && length > 300_000 {
            apply(tokens: [], length: length)
            return
        }
        let text = storage.string
        if length < 60_000 {
            apply(tokens: Highlighter.tokens(in: text, language: language), length: length)
        } else {
            let revision = tab.revision
            Task { [weak self] in
                let tokens = await Task.detached(priority: .utility) {
                    Highlighter.tokens(in: text, language: language)
                }.value
                guard let self, self.tab.revision == revision else { return }
                self.apply(tokens: tokens, length: length)
            }
        }
    }

    private func apply(tokens: [HighlightToken], length: Int) {
        guard let storage = textView.textStorage, let layout = textView.layoutManager, storage.length == length else { return }
        let full = NSRange(location: 0, length: length)
        layout.removeTemporaryAttribute(.foregroundColor, forCharacterRange: full)
        layout.removeTemporaryAttribute(.backgroundColor, forCharacterRange: full)
        layout.removeTemporaryAttribute(.underlineStyle, forCharacterRange: full)
        if tab.language == "markdown" && length <= 200_000 {
            applyMarkdownFonts(tokens: tokens, storage: storage)
        }
        for token in tokens {
            let range = NSRange(location: token.location, length: token.length)
            guard token.length > 0, NSMaxRange(range) <= length else { continue }
            let attributes = colorAttributes(for: token.kind)
            if !attributes.isEmpty {
                layout.addTemporaryAttributes(attributes, forCharacterRange: range)
            }
        }
    }

    private func applyMarkdownFonts(tokens: [HighlightToken], storage: NSTextStorage) {
        let ns = storage.string as NSString
        let full = NSRange(location: 0, length: storage.length)
        let size = baseFont.pointSize
        storage.beginEditing()
        storage.addAttribute(.font, value: baseFont, range: full)
        for token in tokens {
            let range = NSRange(location: token.location, length: token.length)
            guard token.length > 0, NSMaxRange(range) <= full.length else { continue }
            switch token.kind {
            case .heading:
                var level = 0
                var i = range.location
                while i < NSMaxRange(range), ns.character(at: i) == 0x23 { level += 1; i += 1 } // '#'
                let scale: CGFloat = [1.15, 1.6, 1.35, 1.18, 1.08, 1.0, 1.0][min(level, 6)]
                storage.addAttribute(.font, value: PaperFont.nsSerif(round(size * scale)), range: range)
            case .strong:
                storage.addAttribute(.font, value: NSFont.systemFont(ofSize: size, weight: .semibold), range: range)
            case .emphasis:
                let italic = NSFontManager.shared.convert(baseFont, toHaveTrait: .italicFontMask)
                storage.addAttribute(.font, value: italic, range: range)
            case .code:
                storage.addAttribute(.font, value: NSFont.monospacedSystemFont(ofSize: size - 1.5, weight: .regular), range: range)
            default:
                break
            }
        }
        storage.endEditing()
    }

    private func colorAttributes(for kind: HighlightKind) -> [NSAttributedString.Key: Any] {
        switch kind {
        case .keyword: [.foregroundColor: Ink.keyword]
        case .type, .variable: [.foregroundColor: Ink.type]
        case .function: [.foregroundColor: Ink.function]
        case .string, .regex: [.foregroundColor: Ink.string]
        case .number, .constant, .attribute: [.foregroundColor: Ink.number]
        case .comment: [.foregroundColor: Ink.comment]
        case .property, .tag: [.foregroundColor: Ink.property]
        case .punctuation: [.foregroundColor: Ink.punctuation]
        case .meta: [.foregroundColor: Ink.meta]
        case .heading: [.foregroundColor: Ink.text]
        case .emphasis, .strong: [:]
        case .code: [.foregroundColor: Ink.string, .backgroundColor: Ink.well]
        case .link: [.foregroundColor: Ink.property, .underlineStyle: NSUnderlineStyle.single.rawValue]
        case .quote: [.foregroundColor: Ink.text3]
        case .listMarker: [.foregroundColor: Ink.accent]
        case .inserted: [.foregroundColor: Ink.inserted]
        case .deleted: [.foregroundColor: Ink.deleted]
        case .invalid: [.foregroundColor: Ink.invalid, .underlineStyle: NSUnderlineStyle.single.rawValue]
        default: [.foregroundColor: Ink.punctuation]
        }
    }

    // MARK: - 拖入文件

    func openDropped(_ urls: [URL]) {
        Workspace.shared.open(urls: urls)
    }
}
