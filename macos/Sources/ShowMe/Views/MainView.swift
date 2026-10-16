import AppKit
import ShowMeCore
import SwiftUI

/// 方案 E：顶栏（红绿灯 + 下划线标签 + 自动留存状态）、居中的纸面正文、底部工具抽屉。
@MainActor
struct MainView: View {
    var body: some View {
        let workspace = Workspace.shared
        VStack(spacing: 0) {
            TopBar()
            content(workspace)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if workspace.drawerOpen, workspace.activeDocument != nil {
                ToolDrawer()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.88), value: workspace.drawerOpen)
        .background(Color.paper)
        .background(WindowConfigurator())
        .ignoresSafeArea(.container, edges: .top)
        .overlay {
            if workspace.paletteOpen {
                ToolPalette()
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .animation(.easeOut(duration: 0.14), value: workspace.paletteOpen)
        .onAppear { workspace.restoreSession() }
        .onChange(of: AppSettings.shared.fontSize) { workspace.editors.settingsDidChange() }
        .onChange(of: AppSettings.shared.wrapLines) { workspace.editors.settingsDidChange() }
        .onChange(of: AppSettings.shared.indentWidth) { workspace.editors.settingsDidChange() }
        .onChange(of: AppSettings.shared.accent) { workspace.editors.settingsDidChange() }
    }

    @ViewBuilder
    private func content(_ workspace: Workspace) -> some View {
        if let tab = workspace.activeTab {
            if tab.isDocument {
                EditorView(tab: tab)
                    .overlay(alignment: .topTrailing) {
                        if FindModel.shared.isVisible {
                            FindBar()
                                .padding(.top, 10)
                                .padding(.trailing, 18)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }
                    }
                    .animation(.easeOut(duration: 0.16), value: FindModel.shared.isVisible)
            } else if let toolID = tab.toolID {
                ToolPage(toolID: toolID)
                    .id(tab.id)
            }
        } else {
            Color.paper
        }
    }
}

// MARK: - 顶栏

@MainActor
struct TopBar: View {
    var body: some View {
        let workspace = Workspace.shared
        HStack(spacing: 0) {
            // 红绿灯的位置
            Color.clear.frame(width: 86, height: 1)
            HStack(spacing: 18) {
                ForEach(workspace.tabs) { tab in
                    TabButton(tab: tab, isActive: tab.id == workspace.activeID)
                }
                Button {
                    workspace.newDocument()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .medium))
                }
                .buttonStyle(QuietButtonStyle())
                .help(tr("新建标签页（⌘N）", "New Tab (⌘N)"))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .clipped()
            StatusLine()
                .padding(.leading, 12)
            Button {
                workspace.drawerOpen.toggle()
            } label: {
                Image(systemName: workspace.drawerOpen ? "rectangle.bottomhalf.filled" : "rectangle.bottomhalf.inset.filled")
                    .font(.system(size: 13))
            }
            .buttonStyle(QuietButtonStyle())
            .help(tr("工具抽屉（⌘J）", "Tool Drawer (⌘J)"))
            .padding(.leading, 6)
            .padding(.trailing, 14)
            .disabled(workspace.activeDocument == nil)
        }
        .frame(height: topBarHeight)
        .background(WindowDragArea())
    }
}

@MainActor
struct TabButton: View {
    let tab: DocumentTab
    let isActive: Bool
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 5) {
            if let toolID = tab.toolID, let tool = ToolRegistry.tool(toolID) {
                Image(systemName: tool.symbol)
                    .font(.system(size: 10.5))
            }
            Text(tab.title)
                .lineLimit(1)
                .truncationMode(.middle)
            ZStack {
                if hovering {
                    Button {
                        Workspace.shared.close(tab)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 8.5, weight: .bold))
                            .frame(width: 14, height: 14)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.ink3)
                    .help(tr("关闭（⌘W）", "Close (⌘W)"))
                } else if tab.isDirty {
                    Text("●")
                        .font(.system(size: 9))
                        .foregroundStyle(Color.accentInk)
                }
            }
            .frame(width: 14, height: 14)
        }
        .font(.system(size: 13, weight: isActive ? .medium : .regular))
        .foregroundStyle(isActive ? Color.ink : Color.ink3)
        .padding(.vertical, 5)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(isActive ? Color.accentInk : Color.clear)
                .frame(height: 2)
                .offset(y: 4)
        }
        .frame(minWidth: 48, maxWidth: 220)
        .fixedSize(horizontal: false, vertical: true)
        .contentShape(Rectangle())
        .onTapGesture { Workspace.shared.activate(tab) }
        .onHover { hovering = $0 }
        .help(tab.url?.path ?? tab.title)
        .draggable(tab.id.uuidString)
        .dropDestination(for: String.self) { items, _ in
            guard let first = items.first, let id = UUID(uuidString: first), id != tab.id else { return false }
            Workspace.shared.moveTab(id, before: tab.id)
            return true
        }
        .contextMenu { TabContextMenu(tab: tab) }
    }
}

@MainActor
struct TabContextMenu: View {
    let tab: DocumentTab

    var body: some View {
        Button(tr("关闭", "Close")) { Workspace.shared.close(tab) }
        Button(tr("关闭其他标签页", "Close Other Tabs")) {
            for other in Workspace.shared.tabs where other.id != tab.id {
                Workspace.shared.close(other)
            }
        }
        if let url = tab.url {
            Divider()
            Button(tr("在访达中显示", "Show in Finder")) {
                NSWorkspace.shared.activateFileViewerSelecting([url])
            }
            Button(tr("拷贝路径", "Copy Path")) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(url.path, forType: .string)
            }
        }
    }
}

/// 右上角：「2 个未保存 · 已自动留存 · 刚刚」，或者一闪而过的提示
@MainActor
struct StatusLine: View {
    var body: some View {
        let workspace = Workspace.shared
        Group {
            if let flash = workspace.flash {
                Text(flash.message)
                    .foregroundStyle(flash.isError ? Color.warningInk : Color.ink2)
                    .transition(.opacity)
                    .id(flash.id)
            } else {
                TimelineView(.periodic(from: .now, by: 20)) { context in
                    Text(status(workspace, now: context.date))
                        .foregroundStyle(Color.ink3)
                }
            }
        }
        .font(.system(size: 12))
        .lineLimit(1)
        .animation(.easeOut(duration: 0.2), value: workspace.flash)
    }

    private func status(_ workspace: Workspace, now: Date) -> String {
        let dirty = workspace.dirtyCount
        guard dirty > 0 else { return tr("全部已保存", "All saved") }
        let when = relative(workspace.lastAutosave, now: now)
        return tr("\(dirty) 个未保存 · 已自动留存 · \(when)", "\(dirty) unsaved · kept safe · \(when)")
    }

    private func relative(_ date: Date?, now: Date) -> String {
        guard let date else { return tr("刚刚", "just now") }
        let seconds = Int(now.timeIntervalSince(date))
        if seconds < 60 { return tr("刚刚", "just now") }
        if seconds < 3600 {
            let m = seconds / 60
            return tr("\(m) 分钟前", m == 1 ? "1 min ago" : "\(m) min ago")
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}
