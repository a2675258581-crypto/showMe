import AppKit
import ShowMeCore
import SwiftUI

@main
struct ShowMeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Window("showMe", id: "main") {
            MainView()
                .frame(minWidth: 720, minHeight: 460)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1120, height: 760)
        .commands {
            AppCommands(workspace: .shared, settings: .shared)
        }

        Settings {
            SettingsView()
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        ToolEnvironment.script = JSEngine.shared
        // swift run / Xcode 直接运行可执行文件时也要有 Dock 图标和菜单栏
        NSApp.setActivationPolicy(.regular)
        AppSettings.shared.applyAppearance()
        Workspace.shared.restoreSession()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            JSEngine.shared.warmUp()
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        Workspace.shared.restoreSession()
        Workspace.shared.open(urls: urls)
        NSApp.activate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let workspace = Workspace.shared
        for tab in workspace.tabs where tab.isDocument {
            workspace.editors.existing(tab.id)?.syncText()
        }
        workspace.autosaveNow(synchronously: true)
        return .terminateNow
    }

    func applicationDidResignActive(_ notification: Notification) {
        Workspace.shared.autosaveNow()
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        Workspace.shared.reloadChangedFiles()
    }
}
