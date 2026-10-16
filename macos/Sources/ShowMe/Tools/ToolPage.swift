import AppKit
import ShowMeCore
import SwiftUI
import UniformTypeIdentifiers

/// 整页工具（以标签页形式打开）：API 调试、二维码、图片压缩、图片 ⇄ Base64
@MainActor
struct ToolPage: View {
    let toolID: String

    var body: some View {
        if let spec = ToolRegistry.tool(toolID) {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(spec.name.text)
                        .font(PaperFont.serif(28))
                        .foregroundStyle(Color.ink)
                    Text(spec.summary.text)
                        .font(.system(size: 12.5))
                        .foregroundStyle(Color.ink3)
                }
                .padding(.top, 26)
                .padding(.bottom, 18)
                content(spec)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .padding(.horizontal, 36)
            .frame(maxWidth: 1080)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    @ViewBuilder
    private func content(_ spec: ToolSpec) -> some View {
        switch spec.customView ?? "" {
        case "http-client": HTTPClientView()
        case "qrcode": QRCodeToolView()
        case "image-compressor": ImageCompressorView()
        case "image-base64": ImageBase64View()
        default: Text(tr("这个工具在抽屉里使用", "Use this tool from the drawer"))
            .foregroundStyle(Color.ink3)
        }
    }
}

// MARK: - 共用的小部件

/// 一块浅色的「井」：图片预览、结果展示
@MainActor
struct Well<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.well))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.rule, lineWidth: 1))
    }
}

enum ImageIOHelpers {
    static func formatBytes(_ count: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(count))
    }

    @MainActor
    static func chooseImage() -> URL? {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        return panel.runModal() == .OK ? panel.url : nil
    }

    @MainActor
    static func save(_ data: Data, suggestedName: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try data.write(to: url, options: .atomic)
            Workspace.shared.showFlash(tr("已保存到 \(url.lastPathComponent)", "Saved to \(url.lastPathComponent)"))
        } catch {
            Workspace.shared.showFlash(error.localizedDescription, isError: true)
        }
    }

    static func pngData(_ image: CGImage) -> Data? {
        let rep = NSBitmapImageRep(cgImage: image)
        return rep.representation(using: .png, properties: [:])
    }
}
