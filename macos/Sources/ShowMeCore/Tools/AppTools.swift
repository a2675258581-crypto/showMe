import Foundation

/// 需要 App 专属界面（网络请求、图片处理）的工具：这里只登记元信息，界面与实现在 macOS App 里。
public enum AppTools {
    public static let all: [ToolSpec] = [
        ToolSpec(
            id: "api-client",
            name: LocalizedText("API 调试", "API Client"),
            summary: LocalizedText(
                "像 Postman 一样发 HTTP 请求：参数、请求头、Body、鉴权，查看格式化后的响应。",
                "Send HTTP requests like Postman: params, headers, body and auth, with a formatted response."
            ),
            category: .network,
            keywords: ["postman", "http", "rest", "request", "api", "curl", "接口", "请求", "jktz"],
            symbol: "paperplane",
            input: .none,
            customView: "http-client",
            run: { _ in ToolResult() }
        ),
        ToolSpec(
            id: "image-base64",
            name: LocalizedText("图片 ⇄ Base64", "Image ⇄ Base64"),
            summary: LocalizedText(
                "把图片转成 Data URL / Base64，或把 Base64 还原成图片预览与保存。",
                "Turn an image into a Data URL / Base64, or preview and save Base64 as an image."
            ),
            category: .encode,
            keywords: ["image", "base64", "data url", "dataurl", "图片", "tp"],
            symbol: "photo",
            input: .optional,
            customView: "image-base64",
            run: { _ in ToolResult() }
        ),
        ToolSpec(
            id: "qrcode",
            name: LocalizedText("二维码", "QR Code"),
            summary: LocalizedText(
                "把文字或链接生成二维码，或从图片里识别二维码内容。",
                "Generate a QR code from text or a link, or read one from an image."
            ),
            category: .image,
            keywords: ["qr", "qrcode", "barcode", "二维码", "扫码", "ewm"],
            symbol: "qrcode",
            input: .optional,
            customView: "qrcode",
            run: { _ in ToolResult() }
        ),
        ToolSpec(
            id: "image-compressor",
            name: LocalizedText("图片压缩", "Image Compressor"),
            summary: LocalizedText(
                "调节质量与尺寸，把图片压缩或转换成 JPEG / PNG / HEIC。",
                "Compress or convert images to JPEG / PNG / HEIC with adjustable quality and size."
            ),
            category: .image,
            keywords: ["image", "compress", "jpeg", "png", "heic", "resize", "压缩", "tpys"],
            symbol: "photo.stack",
            input: .none,
            customView: "image-compressor",
            run: { _ in ToolResult() }
        ),
    ]
}
