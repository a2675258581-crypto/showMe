import Foundation

// 按文件头魔数识别文件类型（Base64 解码结果的提示用）

public struct FileTypeInfo: Sendable, Hashable {
    public enum Kind: String, Sendable { case image, audio, video, document, archive, font, text, executable, binary }

    public var mime: String
    /// 扩展名（不含点）
    public var ext: String
    public var label: LocalizedText
    public var kind: Kind
}

public enum FileTypeSniffer {
    static func t(_ mime: String, _ ext: String, _ zh: String, _ en: String, _ kind: FileTypeInfo.Kind) -> FileTypeInfo {
        FileTypeInfo(mime: mime, ext: ext, label: LocalizedText(zh, en), kind: kind)
    }

    static func at(_ b: [UInt8], _ sig: [UInt8], _ offset: Int = 0) -> Bool {
        b.count >= offset + sig.count && b[offset..<(offset + sig.count)].elementsEqual(sig)
    }

    static func ascii(_ b: [UInt8], _ text: String, _ offset: Int = 0) -> Bool { at(b, Array(text.utf8), offset) }

    static func readASCII(_ b: [UInt8], _ offset: Int, _ len: Int) -> String {
        guard offset < b.count else { return "" }
        return String(decoding: b[offset..<min(b.count, offset + len)].map { $0 < 0x80 ? $0 : 0x3F }, as: UTF8.self)
    }

    /// ISO-BMFF（ftyp 盒子）的品牌 → 类型
    static func ftyp(_ b: [UInt8]) -> FileTypeInfo? {
        guard ascii(b, "ftyp", 4) else { return nil }
        let brand = readASCII(b, 8, 4).replacingOccurrences(of: "\0", with: " ").trimmingCharacters(in: .whitespaces).lowercased()
        if brand == "avif" || brand == "avis" { return t("image/avif", "avif", "AVIF 图片", "AVIF image", .image) }
        if ["heic", "heix", "hevc", "hevx", "heim", "heis"].contains(brand) { return t("image/heic", "heic", "HEIC 图片", "HEIC image", .image) }
        if brand == "mif1" || brand == "msf1" { return t("image/heif", "heif", "HEIF 图片", "HEIF image", .image) }
        if brand == "qt" { return t("video/quicktime", "mov", "QuickTime 视频", "QuickTime video", .video) }
        if brand == "m4a" || brand == "m4b" { return t("audio/mp4", "m4a", "M4A 音频", "M4A audio", .audio) }
        if brand.hasPrefix("3g") { return t("video/3gpp", "3gp", "3GP 视频", "3GP video", .video) }
        return t("video/mp4", "mp4", "MP4 视频", "MP4 video", .video)
    }

    /// ZIP 容器细分：docx / xlsx / pptx / epub / jar / apk
    static func zipFlavor(_ b: [UInt8]) -> FileTypeInfo {
        let head = readASCII(b, 0, min(b.count, 8192))
        if head.contains("mimetypeapplication/epub+zip") { return t("application/epub+zip", "epub", "EPUB 电子书", "EPUB e-book", .document) }
        if head.contains("word/") { return t("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", "Word 文档", "Word document", .document) }
        if head.contains("xl/") { return t("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", "Excel 表格", "Excel spreadsheet", .document) }
        if head.contains("ppt/") { return t("application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx", "PowerPoint 演示文稿", "PowerPoint presentation", .document) }
        if head.contains("AndroidManifest.xml") { return t("application/vnd.android.package-archive", "apk", "Android 安装包", "Android package", .archive) }
        if head.contains("META-INF/MANIFEST.MF") { return t("application/java-archive", "jar", "Java 归档", "Java archive", .archive) }
        return t("application/zip", "zip", "ZIP 压缩包", "ZIP archive", .archive)
    }

    /// 看起来像文本：合法 UTF-8 且没有除 \t \n \r \f 外的控制字符
    static func sniffText(_ b: [UInt8]) -> FileTypeInfo? {
        let sample = Array(b.prefix(4096))
        guard !sample.isEmpty else { return nil }
        for c in sample where (c < 0x20 && c != 9 && c != 10 && c != 13 && c != 12) || c == 0x7F { return nil }
        // 截断处可能切开多字节字符：允许末尾最多 3 字节不完整
        var valid = sample
        if let bad = UTF8Check.firstInvalid(valid) {
            if bad < sample.count - 3 { return nil }
            valid = Array(sample[0..<bad])
            if b.count == sample.count { return nil }
        }
        var text = String(decoding: valid, as: UTF8.self)
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
        let trimmed = text.drop(while: { $0.isWhitespace })
        let lower = String(trimmed.prefix(1024)).lowercased()
        var body = Substring(lower)
        if body.hasPrefix("<?xml"), let end = body.range(of: "?>") { body = body[end.upperBound...].drop(while: { $0.isWhitespace }) }
        while body.hasPrefix("<!--"), let end = body.range(of: "-->") { body = body[end.upperBound...].drop(while: { $0.isWhitespace }) }
        if body.hasPrefix("<!doctype svg"), let end = body.firstIndex(of: ">") { body = body[body.index(after: end)...].drop(while: { $0.isWhitespace }) }
        if body.hasPrefix("<svg"), body.dropFirst(4).first.map({ $0.isWhitespace || $0 == ">" }) ?? false {
            return t("image/svg+xml", "svg", "SVG 矢量图", "SVG image", .image)
        }
        if body.hasPrefix("<!doctype html") || (body.hasPrefix("<html") && (body.dropFirst(5).first.map { $0.isWhitespace || $0 == ">" } ?? false)) {
            return t("text/html", "html", "HTML", "HTML", .text)
        }
        if lower.hasPrefix("<?xml") { return t("application/xml", "xml", "XML", "XML", .text) }
        if let f = trimmed.first, f == "{" || f == "[", b.count <= 1 << 20, (try? JSON.value(String(decoding: b, as: UTF8.self))) != nil {
            return t("application/json", "json", "JSON", "JSON", .text)
        }
        if lower.hasPrefix("%!ps") { return t("application/postscript", "ps", "PostScript", "PostScript", .document) }
        if lower.hasPrefix("{\\rtf") { return t("application/rtf", "rtf", "RTF 文档", "RTF document", .document) }
        return t("text/plain", "txt", "纯文本", "Plain text", .text)
    }

    /// 根据文件头识别类型，无法识别返回 nil
    public static func detect(_ b: [UInt8]) -> FileTypeInfo? {
        if b.isEmpty { return nil }
        // 图片
        if at(b, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) { return t("image/png", "png", "PNG 图片", "PNG image", .image) }
        if at(b, [0xFF, 0xD8, 0xFF]) { return t("image/jpeg", "jpg", "JPEG 图片", "JPEG image", .image) }
        if ascii(b, "GIF87a") || ascii(b, "GIF89a") { return t("image/gif", "gif", "GIF 动图", "GIF image", .image) }
        if ascii(b, "RIFF") && ascii(b, "WEBP", 8) { return t("image/webp", "webp", "WebP 图片", "WebP image", .image) }
        if at(b, [0, 0, 1, 0]) && b.count >= 6 && Int(b[4]) + Int(b[5]) > 0 { return t("image/x-icon", "ico", "ICO 图标", "ICO icon", .image) }
        if at(b, [0, 0, 2, 0]) && b.count >= 6 && Int(b[4]) + Int(b[5]) > 0 { return t("image/x-icon", "cur", "CUR 光标", "CUR cursor", .image) }
        if ascii(b, "BM") && b.count >= 26 && b[14] >= 12 && b[15] == 0 && b[6] == 0 && b[7] == 0 { return t("image/bmp", "bmp", "BMP 位图", "BMP image", .image) }
        if at(b, [0x49, 0x49, 0x2A, 0x00]) || at(b, [0x4D, 0x4D, 0x00, 0x2A]) { return t("image/tiff", "tiff", "TIFF 图片", "TIFF image", .image) }
        if ascii(b, "8BPS") { return t("image/vnd.adobe.photoshop", "psd", "Photoshop 文档", "Photoshop document", .image) }
        if at(b, [0xFF, 0x0A]) || at(b, [0, 0, 0, 0x0C, 0x4A, 0x58, 0x4C, 0x20]) { return t("image/jxl", "jxl", "JPEG XL 图片", "JPEG XL image", .image) }
        if ascii(b, "icns") { return t("image/icns", "icns", "macOS 图标", "macOS icon", .image) }
        // 文档
        if ascii(b, "%PDF-") { return t("application/pdf", "pdf", "PDF 文档", "PDF document", .document) }
        if at(b, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) { return t("application/x-cfb", "doc", "Office 97-2003 文档", "Office 97-2003 document", .document) }
        if ascii(b, "SQLite format 3\0") { return t("application/vnd.sqlite3", "sqlite", "SQLite 数据库", "SQLite database", .binary) }
        // 压缩包
        if at(b, [0x50, 0x4B, 0x03, 0x04]) || at(b, [0x50, 0x4B, 0x05, 0x06]) { return zipFlavor(b) }
        if at(b, [0x1F, 0x8B]) { return t("application/gzip", "gz", "GZIP 压缩包", "GZIP archive", .archive) }
        if at(b, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) { return t("application/x-7z-compressed", "7z", "7-Zip 压缩包", "7-Zip archive", .archive) }
        if at(b, [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]) { return t("application/vnd.rar", "rar", "RAR 压缩包", "RAR archive", .archive) }
        if at(b, [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00]) { return t("application/x-xz", "xz", "XZ 压缩包", "XZ archive", .archive) }
        if ascii(b, "BZh") { return t("application/x-bzip2", "bz2", "BZIP2 压缩包", "BZIP2 archive", .archive) }
        if at(b, [0x28, 0xB5, 0x2F, 0xFD]) { return t("application/zstd", "zst", "Zstandard 压缩包", "Zstandard archive", .archive) }
        if ascii(b, "ustar", 257) { return t("application/x-tar", "tar", "TAR 归档", "TAR archive", .archive) }
        // 音视频
        if ascii(b, "RIFF") && ascii(b, "WAVE", 8) { return t("audio/wav", "wav", "WAV 音频", "WAV audio", .audio) }
        if ascii(b, "RIFF") && ascii(b, "AVI ", 8) { return t("video/x-msvideo", "avi", "AVI 视频", "AVI video", .video) }
        if ascii(b, "OggS") { return t("audio/ogg", "ogg", "Ogg 音频", "Ogg audio", .audio) }
        if ascii(b, "fLaC") { return t("audio/flac", "flac", "FLAC 音频", "FLAC audio", .audio) }
        if ascii(b, "ID3") || (b.count > 1 && b[0] == 0xFF && b[1] & 0xE6 == 0xE2) { return t("audio/mpeg", "mp3", "MP3 音频", "MP3 audio", .audio) }
        if at(b, [0xFF, 0xF1]) || at(b, [0xFF, 0xF9]) { return t("audio/aac", "aac", "AAC 音频", "AAC audio", .audio) }
        if ascii(b, "MThd") { return t("audio/midi", "mid", "MIDI 音乐", "MIDI music", .audio) }
        if at(b, [0x1A, 0x45, 0xDF, 0xA3]) {
            return readASCII(b, 0, 64).contains("webm")
                ? t("video/webm", "webm", "WebM 视频", "WebM video", .video)
                : t("video/x-matroska", "mkv", "Matroska 视频", "Matroska video", .video)
        }
        if let box = ftyp(b) { return box }
        if ascii(b, "FLV") { return t("video/x-flv", "flv", "FLV 视频", "FLV video", .video) }
        // 字体
        if ascii(b, "wOFF") { return t("font/woff", "woff", "WOFF 字体", "WOFF font", .font) }
        if ascii(b, "wOF2") { return t("font/woff2", "woff2", "WOFF2 字体", "WOFF2 font", .font) }
        if ascii(b, "OTTO") { return t("font/otf", "otf", "OpenType 字体", "OpenType font", .font) }
        if at(b, [0x00, 0x01, 0x00, 0x00, 0x00]) { return t("font/ttf", "ttf", "TrueType 字体", "TrueType font", .font) }
        // 可执行 / 字节码
        if at(b, [0x00, 0x61, 0x73, 0x6D]) { return t("application/wasm", "wasm", "WebAssembly 模块", "WebAssembly module", .executable) }
        if at(b, [0x7F, 0x45, 0x4C, 0x46]) { return t("application/x-elf", "elf", "ELF 可执行文件", "ELF executable", .executable) }
        if ascii(b, "MZ") { return t("application/vnd.microsoft.portable-executable", "exe", "Windows 可执行文件", "Windows executable", .executable) }
        if at(b, [0xCA, 0xFE, 0xBA, 0xBE]) { return t("application/java-vm", "class", "Java 字节码", "Java class file", .executable) }
        if at(b, [0xCF, 0xFA, 0xED, 0xFE]) || at(b, [0xCE, 0xFA, 0xED, 0xFE]) || at(b, [0xFE, 0xED, 0xFA, 0xCF]) {
            return t("application/x-mach-binary", "macho", "Mach-O 可执行文件", "Mach-O executable", .executable)
        }
        return sniffText(b)
    }
}
