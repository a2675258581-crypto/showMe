import AppKit
import SwiftUI

/// 顶栏高度：红绿灯按钮会被挪到这一栏的垂直中线上
let topBarHeight: CGFloat = 44

/// 拿到 SwiftUI 的 NSWindow，配置成「无标题栏的纸面窗口」，并把红绿灯对齐到顶栏中线。
@MainActor
struct WindowConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> ConfiguratorView { ConfiguratorView() }
    func updateNSView(_ nsView: ConfiguratorView, context: Context) {}

    final class ConfiguratorView: NSView {
        private var observers: [NSObjectProtocol] = []

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            observers.forEach { NotificationCenter.default.removeObserver($0) }
            observers = []
            guard let window else { return }
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.styleMask.insert(.fullSizeContentView)
            window.isMovableByWindowBackground = false
            window.backgroundColor = Ink.paper
            window.tabbingMode = .disallowed
            window.minSize = NSSize(width: 720, height: 460)
            layoutTrafficLights(window)
            let names: [Notification.Name] = [
                NSWindow.didResizeNotification,
                NSWindow.didEndLiveResizeNotification,
                NSWindow.didExitFullScreenNotification,
                NSWindow.didBecomeKeyNotification,
                NSWindow.didResignKeyNotification,
            ]
            for name in names {
                observers.append(NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated {
                        guard let window = self?.window else { return }
                        self?.layoutTrafficLights(window)
                    }
                })
            }
        }

        /// 与 Electron 的 trafficLightPosition 同样的做法：加高标题栏容器，再把三个按钮放到中线上
        private func layoutTrafficLights(_ window: NSWindow) {
            guard !window.styleMask.contains(.fullScreen),
                  let close = window.standardWindowButton(.closeButton),
                  let mini = window.standardWindowButton(.miniaturizeButton),
                  let zoom = window.standardWindowButton(.zoomButton),
                  let container = close.superview?.superview
            else { return }
            let height = topBarHeight
            var frame = container.frame
            if frame.height != height || frame.origin.y != window.frame.height - height {
                frame.size.height = height
                frame.origin.y = window.frame.height - height
                container.frame = frame
            }
            let spacing = mini.frame.origin.x - close.frame.origin.x
            let step = spacing > 0 ? spacing : 20
            for (index, button) in [close, mini, zoom].enumerated() {
                let origin = NSPoint(x: 16 + CGFloat(index) * step, y: (height - button.frame.height) / 2)
                if button.frame.origin != origin {
                    button.setFrameOrigin(origin)
                }
            }
        }
    }
}

/// 顶栏空白处：拖动可移动窗口，双击按系统设置缩放或最小化
@MainActor
struct WindowDragArea: NSViewRepresentable {
    func makeNSView(context: Context) -> DragView { DragView() }
    func updateNSView(_ nsView: DragView, context: Context) {}

    final class DragView: NSView {
        override var mouseDownCanMoveWindow: Bool { false }

        override func mouseDown(with event: NSEvent) {
            guard let window else { return }
            if event.clickCount == 2 {
                let action = UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize"
                switch action {
                case "Minimize": window.performMiniaturize(nil)
                case "None": break
                default: window.performZoom(nil)
                }
                return
            }
            window.performDrag(with: event)
        }
    }
}
