import AppKit
import SwiftUI
import WebKit

/// 抽屉里的 Markdown 预览：把引擎生成的 HTML 套上纸面样式，用 WKWebView 渲染（禁用脚本、不加载外部链接）。
@MainActor
struct MarkdownPreview: NSViewRepresentable {
    let html: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.setValue(false, forKey: "drawsBackground")
        view.navigationDelegate = context.coordinator
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        let page = Self.page(html)
        guard context.coordinator.lastHTML != page else { return }
        context.coordinator.lastHTML = page
        view.loadHTMLString(page, baseURL: nil)
    }

    static func page(_ body: String) -> String {
        """
        <!doctype html><html><head><meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'">
        <style>
        :root { color-scheme: light dark; --text:#211d18; --text3:#7a7266; --well:#efe9de; --rule:#ddd5c7; --accent:#b5452a; }
        @media (prefers-color-scheme: dark) { :root { --text:#f1ebe1; --text3:#9b9183; --well:#2a2621; --rule:#3a342d; --accent:#e0795c; } }
        html, body { background: transparent; }
        body { margin: 0; padding: 4px 6px 24px; color: var(--text); font: 14px/1.75 -apple-system, "PingFang SC", sans-serif; }
        h1, h2, h3, h4 { font-family: "New York", "Songti SC", Georgia, serif; line-height: 1.3; margin: 1.2em 0 .5em; }
        h1 { font-size: 1.7em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; }
        a { color: var(--accent); }
        code, pre { font: 12.5px/1.6 ui-monospace, "SF Mono", Menlo, monospace; background: var(--well); border-radius: 5px; }
        code { padding: 1px 5px; } pre { padding: 12px 14px; overflow: auto; } pre code { padding: 0; background: none; }
        blockquote { margin: 0; padding-left: 14px; border-left: 3px solid var(--rule); color: var(--text3); }
        table { border-collapse: collapse; } th, td { border: 1px solid var(--rule); padding: 5px 10px; }
        hr { border: 0; border-top: 1px solid var(--rule); }
        img { max-width: 100%; }
        </style></head><body>\(body)</body></html>
        """
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var lastHTML = ""

        // 预览里点链接：交给浏览器，不在预览里跳转
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
