import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import ImageIO
import ShowMeCore
import SwiftUI
import UniformTypeIdentifiers

private let sharedCIContext = CIContext()

// MARK: - 二维码

@MainActor
struct QRCodeToolView: View {
    @State private var text = ""
    @State private var correction = "M"
    @State private var decoded: [String] = []
    @State private var decodeError: String?

    private static let levels = [
        ToolChoice("L", LocalizedText("低 7%", "Low 7%")),
        ToolChoice("M", LocalizedText("中 15%", "Medium 15%")),
        ToolChoice("Q", LocalizedText("较高 25%", "Quartile 25%")),
        ToolChoice("H", LocalizedText("高 30%", "High 30%")),
    ]

    var body: some View {
        let image = qrImage
        HStack(alignment: .top, spacing: 28) {
            VStack(alignment: .leading, spacing: 12) {
                FieldLabel(text: tr("内容（文字或链接）", "Content (text or link)"))
                TextEditor(text: $text)
                    .font(.system(size: 13))
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(height: 130)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.paper))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.rule, lineWidth: 1))
                HStack(spacing: 10) {
                    FieldLabel(text: tr("容错级别", "Error correction"))
                    PaperSegmented(choices: Self.levels, selection: $correction)
                }
                Button(tr("使用文档中选中的文字", "Use the selected text")) {
                    if let doc = Workspace.shared.lastDocument {
                        text = doc.selectedText ?? doc.text
                    }
                }
                .buttonStyle(PaperButtonStyle(compact: true))

                Rectangle().fill(Color.rule).frame(height: 1).padding(.vertical, 8)

                FieldLabel(text: tr("识别二维码", "Read a QR code"))
                HStack(spacing: 8) {
                    Button(tr("选择图片…", "Choose Image…")) {
                        if let url = ImageIOHelpers.chooseImage(), let image = NSImage(contentsOf: url) { decode(image) }
                    }
                    .buttonStyle(PaperButtonStyle(compact: true))
                    Button(tr("识别剪贴板里的图片", "Read from Clipboard")) {
                        if let image = NSImage(pasteboard: .general) {
                            decode(image)
                        } else {
                            decodeError = tr("剪贴板里没有图片", "There's no image on the clipboard")
                            decoded = []
                        }
                    }
                    .buttonStyle(PaperButtonStyle(compact: true))
                }
                Text(tr("也可以把图片直接拖到右边的预览区。", "You can also drop an image onto the preview."))
                    .font(.system(size: 11.5))
                    .foregroundStyle(Color.ink3)
                ForEach(Array(decoded.enumerated()), id: \.offset) { _, message in
                    DecodedRow(message: message)
                }
                if let decodeError {
                    Text(decodeError)
                        .font(.system(size: 12.5))
                        .foregroundStyle(Color.warningInk)
                }
            }
            .frame(width: 380)

            VStack(spacing: 12) {
                Well {
                    if let image {
                        Image(decorative: image, scale: 1)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .padding(26)
                    } else {
                        Text(tr("输入内容即可生成", "Type something to generate"))
                            .font(.system(size: 12.5))
                            .foregroundStyle(Color.ink3)
                    }
                }
                .frame(width: 320, height: 320)
                .dropDestination(for: URL.self) { urls, _ in
                    guard let url = urls.first, let image = NSImage(contentsOf: url) else { return false }
                    decode(image)
                    return true
                }
                HStack(spacing: 8) {
                    Button(tr("拷贝图片", "Copy Image")) {
                        guard let image else { return }
                        let ns = NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.writeObjects([ns])
                        Workspace.shared.showFlash(tr("已拷贝二维码", "QR code copied"))
                    }
                    Button(tr("存储为 PNG…", "Save as PNG…")) {
                        guard let image, let data = ImageIOHelpers.pngData(image) else { return }
                        ImageIOHelpers.save(data, suggestedName: "qrcode.png")
                    }
                }
                .buttonStyle(PaperButtonStyle(compact: true))
                .disabled(image == nil)
            }
            Spacer(minLength: 0)
        }
        .onAppear {
            if text.isEmpty, let doc = Workspace.shared.lastDocument, let selected = doc.selectedText {
                text = selected
            }
        }
    }

    private var qrImage: CGImage? {
        guard !text.isEmpty else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = correction
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        return sharedCIContext.createCGImage(scaled, from: scaled.extent)
    }

    private func decode(_ image: NSImage) {
        decodeError = nil
        guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            decodeError = tr("无法读取这张图片", "Can't read this image")
            decoded = []
            return
        }
        let detector = CIDetector(
            ofType: CIDetectorTypeQRCode,
            context: sharedCIContext,
            options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]
        )
        let messages = (detector?.features(in: CIImage(cgImage: cg)) ?? [])
            .compactMap { ($0 as? CIQRCodeFeature)?.messageString }
        decoded = messages
        if messages.isEmpty {
            decodeError = tr("没有在图片里找到二维码", "No QR code found in the image")
        }
    }

    @MainActor
    private struct DecodedRow: View {
        let message: String

        var body: some View {
            VStack(alignment: .leading, spacing: 6) {
                Text(message)
                    .font(PaperFont.mono(12.5))
                    .foregroundStyle(Color.ink)
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.well))
                HStack(spacing: 8) {
                    Button(tr("复制", "Copy")) {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(message, forType: .string)
                    }
                    Button(tr("新标签打开", "Open in New Tab")) {
                        Workspace.shared.openInNewTab(message, language: "plain")
                    }
                    if let url = URL(string: message), url.scheme?.hasPrefix("http") == true {
                        Button(tr("在浏览器中打开", "Open in Browser")) {
                            NSWorkspace.shared.open(url)
                        }
                    }
                }
                .buttonStyle(PaperButtonStyle(compact: true))
            }
        }
    }
}

// MARK: - 图片压缩

@MainActor
struct ImageCompressorView: View {
    @State private var sourceName = ""
    @State private var source: CGImage?
    @State private var sourceBytes = 0
    @State private var format = "jpeg"
    @State private var quality = 0.75
    @State private var maxSide = "0"
    @State private var output: Data?
    @State private var outputPixels = CGSize.zero
    @State private var failure: String?

    private static let formats = [
        ToolChoice("jpeg", "JPEG"),
        ToolChoice("png", "PNG"),
        ToolChoice("heic", "HEIC"),
    ]

    private static let sizes = [
        ToolChoice("0", LocalizedText("原尺寸", "Original")),
        ToolChoice("2560", "2560"),
        ToolChoice("1920", "1920"),
        ToolChoice("1280", "1280"),
        ToolChoice("800", "800"),
    ]

    private struct Key: Equatable {
        var name: String
        var format: String
        var quality: Double
        var maxSide: String
    }

    var body: some View {
        HStack(alignment: .top, spacing: 28) {
            VStack(alignment: .leading, spacing: 14) {
                Button(tr("选择图片…", "Choose Image…")) {
                    if let url = ImageIOHelpers.chooseImage() { load(url) }
                }
                .buttonStyle(PaperButtonStyle(prominent: true))
                if source != nil {
                    Text(sourceName)
                        .font(.system(size: 12.5))
                        .foregroundStyle(Color.ink2)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                VStack(alignment: .leading, spacing: 4) {
                    FieldLabel(text: tr("输出格式", "Format"))
                    PaperSegmented(choices: Self.formats, selection: $format)
                }
                if format != "png" {
                    VStack(alignment: .leading, spacing: 4) {
                        FieldLabel(text: tr("质量 \(Int(quality * 100))%", "Quality \(Int(quality * 100))%"))
                        Slider(value: $quality, in: 0.1...1, step: 0.05)
                            .tint(Color.accentInk)
                            .frame(width: 240)
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    FieldLabel(text: tr("最长边（像素）", "Longest side (px)"))
                    PaperMenu(choices: Self.sizes, selection: $maxSide)
                }
                if let failure {
                    Text(failure)
                        .font(.system(size: 12.5))
                        .foregroundStyle(Color.warningInk)
                }
            }
            .frame(width: 280, alignment: .leading)

            VStack(alignment: .leading, spacing: 12) {
                Well {
                    if let output, let preview = NSImage(data: output) {
                        Image(nsImage: preview)
                            .resizable()
                            .scaledToFit()
                            .padding(16)
                    } else {
                        Text(tr("把图片拖到这里，或点「选择图片」", "Drop an image here, or click Choose Image"))
                            .font(.system(size: 12.5))
                            .foregroundStyle(Color.ink3)
                    }
                }
                .frame(minHeight: 320)
                .dropDestination(for: URL.self) { urls, _ in
                    guard let url = urls.first else { return false }
                    load(url)
                    return true
                }
                if let output, let source {
                    let saved = sourceBytes > 0 ? 100 - Int((Double(output.count) / Double(sourceBytes)) * 100) : 0
                    HStack(spacing: 14) {
                        Text(tr("原图 \(ImageIOHelpers.formatBytes(sourceBytes)) · \(source.width)×\(source.height)",
                                "Original \(ImageIOHelpers.formatBytes(sourceBytes)) · \(source.width)×\(source.height)"))
                        Text("→")
                        Text("\(ImageIOHelpers.formatBytes(output.count)) · \(Int(outputPixels.width))×\(Int(outputPixels.height))")
                            .foregroundStyle(Color.ink)
                        Text(saved >= 0 ? tr("节省 \(saved)%", "\(saved)% smaller") : tr("变大了 \(-saved)%", "\(-saved)% larger"))
                            .foregroundStyle(saved >= 0 ? Color.accentInk : Color.warningInk)
                        Spacer()
                        Button(tr("存储…", "Save…")) {
                            let base = (sourceName as NSString).deletingPathExtension
                            let ext = format == "jpeg" ? "jpg" : format
                            ImageIOHelpers.save(output, suggestedName: "\(base)-compressed.\(ext)")
                        }
                        .buttonStyle(PaperButtonStyle(prominent: true, compact: true))
                    }
                    .font(.system(size: 12.5))
                    .foregroundStyle(Color.ink3)
                }
            }
        }
        .task(id: Key(name: sourceName, format: format, quality: quality, maxSide: maxSide)) {
            await compress()
        }
    }

    private func load(_ url: URL) {
        guard let data = try? Data(contentsOf: url),
              let src = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
        else {
            failure = tr("无法读取这张图片", "Can't read this image")
            return
        }
        failure = nil
        source = image
        sourceBytes = data.count
        sourceName = url.lastPathComponent
    }

    private func compress() async {
        guard let source else { return }
        let format = self.format
        let quality = self.quality
        let side = Int(maxSide) ?? 0
        try? await Task.sleep(for: .milliseconds(120))
        guard !Task.isCancelled else { return }
        let result = await Task.detached(priority: .userInitiated) {
            ImageCompressorView.encode(source, format: format, quality: quality, maxSide: side)
        }.value
        guard !Task.isCancelled else { return }
        if let result {
            output = result.data
            outputPixels = result.size
            failure = nil
        } else {
            output = nil
            failure = tr("这台 Mac 不支持导出 \(format.uppercased())", "This Mac can't export \(format.uppercased())")
        }
    }

    nonisolated static func encode(_ image: CGImage, format: String, quality: Double, maxSide: Int) -> (data: Data, size: CGSize)? {
        var target = image
        let longest = max(image.width, image.height)
        if maxSide > 0, longest > maxSide {
            let scale = Double(maxSide) / Double(longest)
            let width = max(1, Int(Double(image.width) * scale))
            let height = max(1, Int(Double(image.height) * scale))
            let space = image.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
            if let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) {
                context.interpolationQuality = .high
                context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
                if let resized = context.makeImage() { target = resized }
            }
        }
        let type: UTType = format == "png" ? .png : format == "heic" ? .heic : .jpeg
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil) else { return nil }
        var properties: [CFString: Any] = [:]
        if format != "png" { properties[kCGImageDestinationLossyCompressionQuality] = quality }
        CGImageDestinationAddImage(destination, target, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return (data as Data, CGSize(width: target.width, height: target.height))
    }
}

// MARK: - 图片 ⇄ Base64

@MainActor
struct ImageBase64View: View {
    @State private var mode = "encode"
    @State private var dataURL = ""
    @State private var imageName = ""
    @State private var imageBytes = 0
    @State private var decodeInput = ""
    @State private var failure: String?

    private static let modes = [
        ToolChoice("encode", LocalizedText("图片 → Base64", "Image → Base64")),
        ToolChoice("decode", LocalizedText("Base64 → 图片", "Base64 → Image")),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PaperSegmented(choices: Self.modes, selection: $mode)
            if mode == "encode" { encodeView } else { decodeView }
            if let failure {
                Text(failure)
                    .font(.system(size: 12.5))
                    .foregroundStyle(Color.warningInk)
            }
        }
        .onChange(of: mode) { failure = nil }
    }

    private var encodeView: some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(alignment: .leading, spacing: 10) {
                Button(tr("选择图片…", "Choose Image…")) {
                    if let url = ImageIOHelpers.chooseImage() { encode(url) }
                }
                .buttonStyle(PaperButtonStyle(prominent: true))
                Well {
                    if let image = previewImage(dataURL) {
                        Image(nsImage: image).resizable().scaledToFit().padding(14)
                    } else {
                        Text(tr("拖入图片", "Drop an image"))
                            .font(.system(size: 12.5))
                            .foregroundStyle(Color.ink3)
                    }
                }
                .frame(width: 260, height: 220)
                .dropDestination(for: URL.self) { urls, _ in
                    guard let url = urls.first else { return false }
                    encode(url)
                    return true
                }
                if !imageName.isEmpty {
                    Text("\(imageName) · \(ImageIOHelpers.formatBytes(imageBytes))")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.ink3)
                }
            }
            if !dataURL.isEmpty {
                let base64 = dataURL.components(separatedBy: ",").last ?? ""
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        OutputRow(output: ToolOutput(id: "url", label: "Data URL", value: dataURL), isSelection: false)
                        OutputRow(output: ToolOutput(id: "b64", label: "Base64", value: base64), isSelection: false)
                        OutputRow(output: ToolOutput(id: "img", label: "HTML", value: "<img src=\"\(dataURL)\" alt=\"\(imageName)\">"), isSelection: false)
                        OutputRow(output: ToolOutput(id: "css", label: "CSS", value: "background-image: url(\"\(dataURL)\");"), isSelection: false)
                        OutputRow(output: ToolOutput(id: "md", label: "Markdown", value: "![\(imageName)](\(dataURL))"), isSelection: false)
                    }
                }
            }
        }
    }

    private var decodeView: some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: tr("Base64 或 Data URL", "Base64 or Data URL"))
                TextEditor(text: $decodeInput)
                    .font(PaperFont.mono(12))
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(width: 380, height: 220)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.paper))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.rule, lineWidth: 1))
                Button(tr("使用文档中选中的文字", "Use the selected text")) {
                    if let doc = Workspace.shared.lastDocument {
                        decodeInput = doc.selectedText ?? doc.text
                    }
                }
                .buttonStyle(PaperButtonStyle(compact: true))
            }
            VStack(alignment: .leading, spacing: 10) {
                let decoded = decodeData(decodeInput)
                Well {
                    if let decoded, let image = NSImage(data: decoded) {
                        Image(nsImage: image).resizable().scaledToFit().padding(14)
                    } else {
                        Text(decodeInput.isEmpty ? tr("粘贴 Base64 后在这里预览", "Paste Base64 to preview it here") : tr("这段内容不是图片", "This isn't an image"))
                            .font(.system(size: 12.5))
                            .foregroundStyle(Color.ink3)
                    }
                }
                .frame(width: 320, height: 260)
                if let decoded, NSImage(data: decoded) != nil {
                    HStack {
                        Text(ImageIOHelpers.formatBytes(decoded.count))
                            .font(.system(size: 12))
                            .foregroundStyle(Color.ink3)
                        Button(tr("存储图片…", "Save Image…")) {
                            ImageIOHelpers.save(decoded, suggestedName: "image.\(Self.fileExtension(for: decoded))")
                        }
                        .buttonStyle(PaperButtonStyle(compact: true))
                    }
                }
            }
        }
        .onAppear {
            if decodeInput.isEmpty, let selected = Workspace.shared.lastDocument?.selectedText {
                decodeInput = selected
            }
        }
    }

    private func encode(_ url: URL) {
        guard let data = try? Data(contentsOf: url), NSImage(data: data) != nil else {
            failure = tr("无法读取这张图片", "Can't read this image")
            return
        }
        failure = nil
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "image/png"
        dataURL = "data:\(mime);base64," + data.base64EncodedString()
        imageName = url.lastPathComponent
        imageBytes = data.count
    }

    private func previewImage(_ dataURL: String) -> NSImage? {
        guard let data = decodeData(dataURL) else { return nil }
        return NSImage(data: data)
    }

    private func decodeData(_ text: String) -> Data? {
        var body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return nil }
        if body.hasPrefix("data:"), let comma = body.firstIndex(of: ",") {
            body = String(body[body.index(after: comma)...])
        }
        body = body.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let padding = (4 - body.filter { !$0.isWhitespace }.count % 4) % 4
        body += String(repeating: "=", count: padding)
        return Data(base64Encoded: body, options: .ignoreUnknownCharacters)
    }

    private static func fileExtension(for data: Data) -> String {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "png" }
        if bytes.starts(with: [0xFF, 0xD8]) { return "jpg" }
        if bytes.starts(with: [0x47, 0x49, 0x46]) { return "gif" }
        if bytes.count >= 12, Array(bytes[8...11]) == [0x57, 0x45, 0x42, 0x50] { return "webp" }
        return "png"
    }
}
