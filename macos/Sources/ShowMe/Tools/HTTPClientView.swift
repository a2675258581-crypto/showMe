import AppKit
import Observation
import ShowMeCore
import SwiftUI

/// API 调试的状态：当前请求、变量、历史（存在 Application Support/showMe/api-client.json）
@MainActor
@Observable
final class HTTPClientStore {
    static let shared = HTTPClientStore()

    var draft = HTTPRequestDraft() { didSet { scheduleSave() } }
    var variables: [HTTPKeyValue] = [] { didSet { scheduleSave() } }
    var history: [HTTPHistoryEntry] = [] { didSet { scheduleSave() } }
    var response: HTTPResponseSummary?
    var error: String?
    var sending = false

    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private let session = URLSession(configuration: .ephemeral)

    private struct Saved: Codable {
        var draft: HTTPRequestDraft
        var variables: [HTTPKeyValue]
        var history: [HTTPHistoryEntry]
    }

    private static var fileURL: URL { SessionStore.directory.appendingPathComponent("api-client.json") }

    private init() {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let data = try? Data(contentsOf: Self.fileURL), let saved = try? decoder.decode(Saved.self, from: data) {
            draft = saved.draft
            variables = saved.variables
            history = saved.history
        } else {
            draft = HTTPRequestDraft(method: "GET", url: "https://httpbin.org/get", params: [HTTPKeyValue("hello", "showMe")])
        }
    }

    var environment: [String: String] {
        Dictionary(
            variables.filter { $0.enabled && !$0.key.isEmpty }.map { ($0.key, $0.value) },
            uniquingKeysWith: { _, last in last }
        )
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self else { return }
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            guard let data = try? encoder.encode(Saved(draft: draft, variables: variables, history: history)) else { return }
            try? FileManager.default.createDirectory(at: SessionStore.directory, withIntermediateDirectories: true)
            try? data.write(to: Self.fileURL, options: .atomic)
        }
    }

    func send() {
        task?.cancel()
        let draft = self.draft
        let env = environment
        let address = draft.resolvedURL(env: env)
        guard let url = URL(string: address), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            error = tr("地址无效：\(address.isEmpty ? "（空）" : address)", "Invalid URL: \(address.isEmpty ? "(empty)" : address)")
            response = nil
            return
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 30)
        request.httpMethod = draft.method
        for header in draft.effectiveHeaders(env: env) {
            request.addValue(header.value, forHTTPHeaderField: header.name)
        }
        if draft.allowsBody, let body = draft.bodyData(env: env) {
            request.httpBody = body
        }
        sending = true
        error = nil
        let started = Date()
        let session = self.session
        task = Task { [weak self] in
            do {
                let (data, raw) = try await session.data(for: request)
                guard let self else { return }
                let duration = Date().timeIntervalSince(started)
                guard let http = raw as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                let headers = http.allHeaderFields
                    .compactMap { key, value -> HTTPHeader? in
                        guard let name = key as? String else { return nil }
                        return HTTPHeader(name, "\(value)")
                    }
                    .sorted { $0.name.lowercased() < $1.name.lowercased() }
                self.response = HTTPResponseSummary(status: http.statusCode, headers: headers, body: data, duration: duration)
                self.history = HTTPHistoryEntry.adding(
                    HTTPHistoryEntry(draft: draft, status: http.statusCode, duration: duration, date: Date()),
                    to: self.history
                )
            } catch {
                guard let self else { return }
                if (error as? URLError)?.code == .cancelled || error is CancellationError {
                    self.error = tr("已取消", "Cancelled")
                } else {
                    self.error = error.localizedDescription
                    self.response = nil
                    self.history = HTTPHistoryEntry.adding(HTTPHistoryEntry(draft: draft, date: Date()), to: self.history)
                }
            }
            self?.sending = false
        }
    }

    func cancel() {
        task?.cancel()
    }
}

/// Postman 风格的请求界面
@MainActor
struct HTTPClientView: View {
    @State private var section = "params"
    @State private var responseSection = "body"
    @State private var showImport = false
    @State private var curlText = ""
    @State private var importError: String?

    var body: some View {
        @Bindable var store = HTTPClientStore.shared
        HStack(alignment: .top, spacing: 22) {
            history(store)
                .frame(width: 210)
            VStack(alignment: .leading, spacing: 14) {
                requestBar(store)
                HStack(spacing: 10) {
                    PaperSegmented(choices: [
                        ToolChoice("params", LocalizedText("参数", "Params")),
                        ToolChoice("headers", LocalizedText("请求头", "Headers")),
                        ToolChoice("body", LocalizedText("Body", "Body")),
                        ToolChoice("auth", LocalizedText("鉴权", "Auth")),
                    ], selection: $section)
                    Button(tr("变量", "Variables")) { section = "vars" }
                        .buttonStyle(ChipStyle(selected: section == "vars"))
                    Spacer()
                    Button(tr("导入 cURL", "Import cURL")) { showImport = true }
                        .buttonStyle(PaperButtonStyle(compact: true))
                    Button(tr("复制为 cURL", "Copy as cURL")) {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(store.draft.toCurl(env: store.environment), forType: .string)
                        Workspace.shared.showFlash(tr("已复制 cURL 命令", "cURL command copied"))
                    }
                    .buttonStyle(PaperButtonStyle(compact: true))
                }
                requestSection(store)
                    .frame(minHeight: 120, maxHeight: 220, alignment: .top)
                Rectangle().fill(Color.rule).frame(height: 1)
                responseView(store)
            }
        }
        .sheet(isPresented: $showImport) { importSheet(store) }
    }

    // MARK: 地址栏

    private func requestBar(_ store: HTTPClientStore) -> some View {
        HStack(spacing: 8) {
            Menu {
                ForEach(HTTPRequestDraft.methods, id: \.self) { method in
                    Button(method) { store.draft.method = method }
                }
            } label: {
                Text(store.draft.method)
                    .font(.system(size: 12.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Self.methodColor(store.draft.method))
                    .frame(width: 70, height: 32)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.paper))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.rule, lineWidth: 1))
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            TextField(
                "https://api.example.com/users/{{id}}",
                text: Binding(get: { store.draft.fullURL }, set: { store.draft.setFullURL($0) })
            )
            .paperField()
            .onSubmit { store.send() }
            if store.sending {
                Button(tr("取消", "Cancel")) { store.cancel() }
                    .buttonStyle(PaperButtonStyle())
            }
            Button {
                store.send()
            } label: {
                HStack(spacing: 6) {
                    if store.sending { ProgressView().controlSize(.small).tint(.white) }
                    Text(tr("发送", "Send"))
                }
            }
            .buttonStyle(PaperButtonStyle(prominent: true))
            .keyboardShortcut(.return, modifiers: .command)
            .help("⌘↩")
        }
    }

    static func methodColor(_ method: String) -> Color {
        switch method {
        case "GET": Color(nsColor: Ink.string)
        case "POST": Color(nsColor: Ink.number)
        case "PUT", "PATCH": Color(nsColor: Ink.property)
        case "DELETE": Color(nsColor: Ink.deleted)
        default: Color.ink2
        }
    }

    // MARK: 请求各部分

    @ViewBuilder
    private func requestSection(_ model: HTTPClientStore) -> some View {
        @Bindable var store = model
        switch section {
        case "headers":
            KeyValueEditor(rows: $store.draft.headers, keyPlaceholder: "Content-Type", valuePlaceholder: "application/json")
        case "body":
            bodyEditor(store)
        case "auth":
            authEditor(store)
        case "vars":
            VStack(alignment: .leading, spacing: 8) {
                Text(tr(
                    "在地址、参数、请求头和 Body 里用 {{名字}} 引用变量；内置 {{$timestamp}}、{{$uuid}}。",
                    "Reference variables as {{name}} in the URL, params, headers and body; {{$timestamp}} and {{$uuid}} are built in."
                ))
                .font(.system(size: 12))
                .foregroundStyle(Color.ink3)
                KeyValueEditor(rows: $store.variables, keyPlaceholder: "id", valuePlaceholder: "42")
            }
        default:
            KeyValueEditor(rows: $store.draft.params, keyPlaceholder: "page", valuePlaceholder: "1")
        }
    }

    private func bodyEditor(_ store: HTTPClientStore) -> some View {
        let kind: String
        switch store.draft.body {
        case .none: kind = "none"
        case .json: kind = "json"
        case .text: kind = "text"
        case .formURLEncoded: kind = "form"
        case .multipart: kind = "multipart"
        }
        return VStack(alignment: .leading, spacing: 8) {
            PaperSegmented(choices: [
                ToolChoice("none", LocalizedText("无", "None")),
                ToolChoice("json", "JSON"),
                ToolChoice("text", LocalizedText("文本", "Text")),
                ToolChoice("form", LocalizedText("表单", "Form")),
                ToolChoice("multipart", "Multipart"),
            ], selection: Binding(get: { kind }, set: { store.draft.body = Self.convert(store.draft.body, to: $0) }))
            if !store.draft.allowsBody, kind != "none" {
                Text(tr("\(store.draft.method) 请求不会发送 Body", "\(store.draft.method) requests don't send a body"))
                    .font(.system(size: 12))
                    .foregroundStyle(Color.warningInk)
            }
            switch store.draft.body {
            case .json(let text), .text(let text):
                TextEditor(text: Binding(get: { text }, set: { value in
                    if case .json = store.draft.body { store.draft.body = .json(value) } else { store.draft.body = .text(value) }
                }))
                .font(PaperFont.mono(12.5))
                .scrollContentBackground(.hidden)
                .padding(6)
                .frame(minHeight: 110)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.paper))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.rule, lineWidth: 1))
            case .formURLEncoded(let rows):
                KeyValueEditor(rows: Binding(get: { rows }, set: { store.draft.body = .formURLEncoded($0) }), keyPlaceholder: "name", valuePlaceholder: "value")
            case .multipart(let rows):
                KeyValueEditor(rows: Binding(get: { rows }, set: { store.draft.body = .multipart($0) }), keyPlaceholder: "name", valuePlaceholder: "value")
            case .none:
                EmptyView()
            }
        }
    }

    private static func convert(_ body: HTTPBody, to kind: String) -> HTTPBody {
        var text = ""
        var rows: [HTTPKeyValue] = []
        switch body {
        case .json(let t), .text(let t): text = t
        case .formURLEncoded(let r), .multipart(let r): rows = r
        case .none: break
        }
        switch kind {
        case "json": return .json(text.isEmpty ? "{\n  \n}" : text)
        case "text": return .text(text)
        case "form": return .formURLEncoded(rows.isEmpty ? [HTTPKeyValue()] : rows)
        case "multipart": return .multipart(rows.isEmpty ? [HTTPKeyValue()] : rows)
        default: return .none
        }
    }

    private func authEditor(_ store: HTTPClientStore) -> some View {
        let kind: String
        switch store.draft.auth {
        case .none: kind = "none"
        case .bearer: kind = "bearer"
        case .basic: kind = "basic"
        }
        return VStack(alignment: .leading, spacing: 10) {
            PaperSegmented(choices: [
                ToolChoice("none", LocalizedText("无", "None")),
                ToolChoice("bearer", "Bearer Token"),
                ToolChoice("basic", "Basic Auth"),
            ], selection: Binding(get: { kind }, set: { value in
                switch value {
                case "bearer": store.draft.auth = .bearer("")
                case "basic": store.draft.auth = .basic(user: "", password: "")
                default: store.draft.auth = .none
                }
            }))
            switch store.draft.auth {
            case .bearer(let token):
                TextField("Token", text: Binding(get: { token }, set: { store.draft.auth = .bearer($0) }))
                    .paperField()
            case .basic(let user, let password):
                HStack(spacing: 8) {
                    TextField(tr("用户名", "Username"), text: Binding(get: { user }, set: { store.draft.auth = .basic(user: $0, password: password) }))
                        .paperField()
                    SecureField(tr("密码", "Password"), text: Binding(get: { password }, set: { store.draft.auth = .basic(user: user, password: $0) }))
                        .paperField()
                }
            case .none:
                EmptyView()
            }
        }
    }

    // MARK: 响应

    @ViewBuilder
    private func responseView(_ store: HTTPClientStore) -> some View {
        if let error = store.error {
            Text(error)
                .font(.system(size: 12.5))
                .foregroundStyle(Color.warningInk)
                .textSelection(.enabled)
        }
        if let response = store.response {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Text(response.statusLine(AppSettings.shared.lang))
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .frame(height: 24)
                        .background(Capsule().fill(Self.statusColor(response.statusClass)))
                    Text(response.durationText)
                    Text(response.sizeText)
                    Spacer()
                    PaperSegmented(choices: [
                        ToolChoice("body", LocalizedText("响应体", "Body")),
                        ToolChoice("headers", LocalizedText("响应头 \(response.headers.count)", "Headers \(response.headers.count)")),
                    ], selection: $responseSection)
                    Button(tr("复制", "Copy")) {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(response.prettyBody, forType: .string)
                    }
                    .buttonStyle(PaperButtonStyle(compact: true))
                    Button(tr("新标签打开", "Open in New Tab")) {
                        Workspace.shared.openInNewTab(response.prettyBody, language: response.language)
                    }
                    .buttonStyle(PaperButtonStyle(compact: true))
                }
                .font(.system(size: 12.5))
                .foregroundStyle(Color.ink3)
                Group {
                    if responseSection == "headers" {
                        ScrollView {
                            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                                ForEach(Array(response.headers.enumerated()), id: \.offset) { _, header in
                                    GridRow {
                                        Text(header.name).foregroundStyle(Color(nsColor: Ink.property))
                                        Text(header.value).foregroundStyle(Color.ink).textSelection(.enabled)
                                    }
                                }
                            }
                            .font(PaperFont.mono(12))
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    } else if response.bodyKind == .image, let image = NSImage(data: response.body) {
                        Image(nsImage: image).resizable().scaledToFit().padding(12)
                    } else if response.bodyKind == .binary {
                        Text(tr("二进制内容（\(response.sizeText)）", "Binary content (\(response.sizeText))"))
                            .foregroundStyle(Color.ink3)
                            .padding(12)
                    } else {
                        ScrollView([.vertical, .horizontal]) {
                            Text(String(response.prettyBody.prefix(200_000)))
                                .font(PaperFont.mono(12.5))
                                .foregroundStyle(Color.ink)
                                .textSelection(.enabled)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.well))
            }
        } else if store.error == nil {
            Text(store.sending ? tr("请求中…", "Sending…") : tr("填好地址，按 ⌘↩ 发送。", "Enter a URL and press ⌘↩ to send."))
                .font(.system(size: 12.5))
                .foregroundStyle(Color.ink3)
        }
    }

    static func statusColor(_ statusClass: Int) -> Color {
        switch statusClass {
        case 2: Color(nsColor: Ink.string)
        case 3: Color(nsColor: Ink.property)
        case 4: Color(nsColor: Ink.number)
        case 5: Color(nsColor: Ink.deleted)
        default: Color.ink3
        }
    }

    // MARK: 历史

    private func history(_ store: HTTPClientStore) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                FieldLabel(text: tr("历史", "History"))
                Spacer()
                if !store.history.isEmpty {
                    Button(tr("清空", "Clear")) { store.history = [] }
                        .buttonStyle(QuietButtonStyle())
                        .font(.system(size: 11.5))
                }
            }
            if store.history.isEmpty {
                Text(tr("发送过的请求会出现在这里", "Requests you send show up here"))
                    .font(.system(size: 12))
                    .foregroundStyle(Color.ink3)
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(store.history.enumerated()), id: \.offset) { _, entry in
                        HistoryRow(entry: entry) {
                            store.draft = entry.draft
                        }
                    }
                }
            }
        }
    }

    @MainActor
    private struct HistoryRow: View {
        let entry: HTTPHistoryEntry
        let action: () -> Void
        @State private var hovering = false

        var body: some View {
            Button(action: action) {
                HStack(spacing: 8) {
                    Text(entry.draft.method)
                        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(HTTPClientView.methodColor(entry.draft.method))
                        .frame(width: 44, alignment: .leading)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(entry.draft.label.isEmpty ? entry.draft.url : entry.draft.label)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.ink)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Text(entry.status.map { "\($0)" } ?? tr("失败", "Failed"))
                            .font(.system(size: 10.5))
                            .foregroundStyle(entry.status.map { HTTPClientView.statusColor(min(5, max(1, $0 / 100))) } ?? Color.warningInk)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering ? Color.hover : .clear))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .help(entry.draft.url)
        }
    }

    // MARK: 导入 cURL

    private func importSheet(_ store: HTTPClientStore) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(tr("导入 cURL 命令", "Import a cURL Command"))
                .font(PaperFont.serif(18))
            TextEditor(text: $curlText)
                .font(PaperFont.mono(12))
                .scrollContentBackground(.hidden)
                .padding(6)
                .frame(width: 560, height: 200)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.well))
            if let importError {
                Text(importError)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.warningInk)
            }
            HStack {
                Spacer()
                Button(tr("取消", "Cancel")) { showImport = false }
                    .buttonStyle(PaperButtonStyle())
                    .keyboardShortcut(.cancelAction)
                Button(tr("导入", "Import")) {
                    do {
                        let result = try HTTPRequestDraft.importCurl(curlText)
                        store.draft = result.draft
                        importError = nil
                        showImport = false
                        curlText = ""
                    } catch {
                        importError = error.localizedDescription
                    }
                }
                .buttonStyle(PaperButtonStyle(prominent: true))
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(22)
        .background(Color.paper)
    }
}

/// 键值对编辑表（参数、请求头、表单、变量）
@MainActor
struct KeyValueEditor: View {
    @Binding var rows: [HTTPKeyValue]
    var keyPlaceholder: String
    var valuePlaceholder: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(rows.indices), id: \.self) { index in
                    HStack(spacing: 8) {
                        PaperCheckbox(label: "", isOn: Binding(
                            get: { rows.indices.contains(index) ? rows[index].enabled : false },
                            set: { if rows.indices.contains(index) { rows[index].enabled = $0 } }
                        ))
                        TextField(keyPlaceholder, text: field(index, \.key))
                            .paperField()
                            .frame(width: 220)
                        TextField(valuePlaceholder, text: field(index, \.value))
                            .paperField()
                        Button {
                            if rows.indices.contains(index) { rows.remove(at: index) }
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .buttonStyle(QuietButtonStyle())
                    }
                }
                Button(tr("＋ 添加一行", "＋ Add Row")) { rows.append(HTTPKeyValue()) }
                    .buttonStyle(QuietButtonStyle())
                    .font(.system(size: 12))
            }
        }
    }

    private func field(_ index: Int, _ keyPath: WritableKeyPath<HTTPKeyValue, String>) -> Binding<String> {
        Binding(
            get: { rows.indices.contains(index) ? rows[index][keyPath: keyPath] : "" },
            set: { if rows.indices.contains(index) { rows[index][keyPath: keyPath] = $0 } }
        )
    }
}
