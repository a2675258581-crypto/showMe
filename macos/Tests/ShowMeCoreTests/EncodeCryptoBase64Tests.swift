import XCTest
@testable import ShowMeCore

final class EncodeCryptoBase64Tests: XCTestCase {
    let tool = Base64Tool.spec

    func encode(_ s: String, _ opts: [String: String] = [:]) throws -> String {
        try tool(s, options: opts).primary?.value ?? ""
    }

    func decode(_ s: String, lang: Lang = .zh) throws -> ToolResult {
        try tool(s, options: ["mode": "decode"], lang: lang)
    }

    func failure(_ s: String) -> Base64Tool.DecodeFailure? {
        if case .failure(let f) = Base64Tool.decodeDetailed(s) { return f }
        return nil
    }

    func testRFC4648Vectors() throws {
        for (plain, b64) in [("f", "Zg=="), ("fo", "Zm8="), ("foo", "Zm9v"), ("foob", "Zm9vYg=="), ("fooba", "Zm9vYmE="), ("foobar", "Zm9vYmFy")] {
            XCTAssertEqual(try encode(plain), b64)
            XCTAssertEqual(try decode(b64).primary?.value, plain)
        }
    }

    func testUnicodeURLSafeAndPadding() throws {
        XCTAssertEqual(try encode("中文"), "5Lit5paH")
        XCTAssertEqual(try encode("你好，世界"), "5L2g5aW977yM5LiW55WM")
        XCTAssertEqual(try encode("😀"), "8J+YgA==")
        XCTAssertEqual(try encode("😀", ["urlSafe": "1"]), "8J-YgA==")
        XCTAssertEqual(try encode("😀", ["urlSafe": "1", "noPadding": "1"]), "8J-YgA")
        XCTAssertEqual(try encode("😀", ["noPadding": "1"]), "8J+YgA")
        let family = "👨\u{200D}👩\u{200D}👧"
        XCTAssertEqual(try encode(family), Data(family.utf8).base64EncodedString())
    }

    func testMIMEWrapAndStats() throws {
        let text = String(repeating: "showMe 编码 ", count: 30)
        let r = try tool(text, options: ["wrap": "1"])
        let out = r.primary?.value ?? ""
        let lines = out.split(separator: "\n")
        XCTAssertGreaterThan(lines.count, 1)
        XCTAssertTrue(lines.dropLast().allSatisfy { $0.count == 76 })
        XCTAssertEqual(lines.joined(), Data(text.utf8).base64EncodedString())
        XCTAssertTrue(r.notes[0].message.contains("体积 +"))
        let en = try tool("abc", options: [:], lang: .en)
        XCTAssertEqual(en.notes[0].message, "3 bytes → 4 characters · +33.3% size")
    }

    func testDecodeToleratesWhitespaceURLSafeAndMissingPadding() throws {
        XCTAssertEqual(try decode("8J-YgA").primary?.value, "😀")
        XCTAssertEqual(try decode(" 5Lit\n5paH \r\n").primary?.value, "中文")
        guard case .success(let (_, v)) = Base64Tool.decodeDetailed("8J-Y\ngA") else { return XCTFail() }
        XCTAssertTrue(v.urlSafe)
        XCTAssertFalse(v.standard)
        XCTAssertFalse(v.padded)
        XCTAssertTrue(v.missingPadding)
        XCTAssertTrue(v.whitespace)
        let notes = try decode("8J-Y\ngA").notes.map(\.message).joined(separator: "\n")
        XCTAssertTrue(notes.contains("URL 安全字符集"))
        XCTAssertTrue(notes.contains("省略了填充"))
    }

    func testDataURLPrefix() throws {
        let r = try decode("data:text/plain;charset=utf-8;base64,5Lit5paH")
        XCTAssertEqual(r.primary?.value, "中文")
        guard case .success(let (_, v)) = Base64Tool.decodeDetailed("data:text/plain;charset=utf-8;base64,5Lit5paH") else { return XCTFail() }
        XCTAssertEqual(v.dataURLMime, "text/plain")
        guard case .success(let (_, png)) = Base64Tool.decodeDetailed("  DATA:image/png;base64,iVBORw0KGgo=") else { return XCTFail() }
        XCTAssertEqual(png.dataURLMime, "image/png")
    }

    func testErrorsWithLineAndColumn() throws {
        let f = failure("Zm9v\nYm*y")
        XCTAssertEqual(f?.line, 2)
        XCTAssertEqual(f?.column, 3)
        XCTAssertEqual(f?.index, 7)
        XCTAssertTrue(f?.message.zh.contains("“*”（U+002A）") ?? false)
        XCTAssertThrowsError(try decode("Zm9v\nYm*y")) { e in
            let te = e as? ToolError
            XCTAssertEqual(te?.line, 2)
            XCTAssertEqual(te?.column, 3)
            XCTAssertTrue(te?.message.hasPrefix("第 2 行第 3 列：") ?? false)
        }
        XCTAssertThrowsError(try decode("Zm9v\nYm*y", lang: .en)) { e in
            XCTAssertTrue((e as? ToolError)?.message.hasPrefix("Line 2, column 3: Invalid character “*” (U+002A)") ?? false)
        }
        XCTAssertTrue(failure("Zm9v中")?.message.zh.contains("“中”（U+4E2D）") ?? false)
        XCTAssertTrue(failure("Zm9v\u{200B}")?.message.zh.contains("U+200B（不可见字符）") ?? false)
        let concat = failure("Zg==Zg==")
        XCTAssertTrue(concat?.message.zh.contains("拼在了一起") ?? false)
        XCTAssertEqual(concat?.column, 3)
        XCTAssertNotNil(failure("Zg==="))
        XCTAssertTrue(failure("Zm9vY")?.message.zh.contains("余数不能为 1") ?? false)
        XCTAssertTrue(failure("Zm9v=")?.message.zh.contains("不需要填充") ?? false)
        XCTAssertTrue(failure("Zg=")?.message.zh.contains("应补 2 个 =") ?? false)
        // 列按 Unicode 字符计
        var loc = LineLocator("😀a\nb😀c")
        XCTAssertTrue(loc.locate(5) == (2, 3))
    }

    func testEmptyAndBinaryDecode() throws {
        XCTAssertEqual(try decode("   ").outputs.count, 0)
        // PNG 文件头：二进制，显示十六进制并识别类型
        let png = Base64Codec.encode([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D])
        let r = try decode(png)
        XCTAssertTrue(r.primary?.value.hasPrefix("00000000  89 50 4e 47") ?? false)
        XCTAssertTrue(r.notes.contains { $0.level == .warning && $0.message.contains("看起来是 PNG 图片（image/png）") })
        XCTAssertEqual(r.outputs.first { $0.id == "hex" }?.value, "89504e470d0a1a0a0000000d")
        let en = try decode(png, lang: .en)
        XCTAssertTrue(en.notes.contains { $0.message.contains("looks like a PNG image") })
        // JSON 文本：高亮语言
        XCTAssertEqual(try decode(Base64Codec.encode(Array("{\"a\":1}".utf8))).primary?.language, "json")
        // BOM
        let bom = try decode(Base64Codec.encode([0xEF, 0xBB, 0xBF, 0x61]))
        XCTAssertEqual(bom.primary?.value, "a")
        XCTAssertTrue(bom.notes[0].message.contains("UTF-8 BOM"))
    }

    func testLargeRoundTrip() throws {
        let big = String(repeating: "中文 test 😀\n", count: 30_000)
        let enc = try encode(big)
        XCTAssertEqual(enc, Data(big.utf8).base64EncodedString())
        XCTAssertEqual(try decode(enc).primary?.value, big)
    }
}

final class EncodeCryptoFileTypeTests: XCTestCase {
    func bytes(_ parts: Any...) -> [UInt8] {
        parts.flatMap { p -> [UInt8] in
            if let s = p as? String { return Array(s.utf8) }
            return p as? [UInt8] ?? []
        }
    }

    func pad(_ n: Int) -> [UInt8] { [UInt8](repeating: 0, count: n) }

    func testMagicBytes() {
        let cases: [(String, [UInt8], String)] = [
            ("png", bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] as [UInt8], pad(8)), "image/png"),
            ("jpg", bytes([0xFF, 0xD8, 0xFF, 0xE0] as [UInt8], pad(8)), "image/jpeg"),
            ("gif", bytes("GIF89a", pad(6)), "image/gif"),
            ("webp", bytes("RIFF", pad(4), "WEBPVP8 "), "image/webp"),
            ("ico", bytes([0, 0, 1, 0, 1, 0] as [UInt8], pad(10)), "image/x-icon"),
            ("bmp", bytes("BM", pad(12), [40, 0, 0, 0] as [UInt8], pad(10)), "image/bmp"),
            ("tiff", [0x49, 0x49, 0x2A, 0x00], "image/tiff"),
            ("avif", bytes([0, 0, 0, 0x1C] as [UInt8], "ftypavif"), "image/avif"),
            ("heic", bytes([0, 0, 0, 0x18] as [UInt8], "ftypheic"), "image/heic"),
            ("pdf", bytes("%PDF-1.7\n"), "application/pdf"),
            ("zip", bytes([0x50, 0x4B, 0x03, 0x04] as [UInt8], pad(26), "hello.txt"), "application/zip"),
            ("gz", [0x1F, 0x8B, 0x08], "application/gzip"),
            ("7z", [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C], "application/x-7z-compressed"),
            ("rar", bytes("Rar!", [0x1A, 0x07, 0x01, 0x00] as [UInt8]), "application/vnd.rar"),
            ("tar", bytes(pad(257), "ustar", [0] as [UInt8]), "application/x-tar"),
            ("wav", bytes("RIFF", pad(4), "WAVEfmt "), "audio/wav"),
            ("mp3", bytes("ID3", [4, 0] as [UInt8]), "audio/mpeg"),
            ("mp3 frame", [0xFF, 0xFB, 0x90, 0x00], "audio/mpeg"),
            ("ogg", bytes("OggS"), "audio/ogg"),
            ("flac", bytes("fLaC"), "audio/flac"),
            ("mp4", bytes([0, 0, 0, 0x20] as [UInt8], "ftypisom"), "video/mp4"),
            ("mov", bytes([0, 0, 0, 0x14] as [UInt8], "ftypqt  "), "video/quicktime"),
            ("webm", bytes([0x1A, 0x45, 0xDF, 0xA3] as [UInt8], pad(20), "webm"), "video/webm"),
            ("woff2", bytes("wOF2"), "font/woff2"),
            ("ttf", [0, 1, 0, 0, 0, 0x10], "font/ttf"),
            ("wasm", [0, 0x61, 0x73, 0x6D, 1, 0, 0, 0], "application/wasm"),
            ("elf", [0x7F, 0x45, 0x4C, 0x46], "application/x-elf"),
            ("exe", bytes("MZ", [0x90, 0] as [UInt8]), "application/vnd.microsoft.portable-executable"),
            ("sqlite", bytes("SQLite format 3", [0] as [UInt8]), "application/vnd.sqlite3"),
        ]
        for (name, b, mime) in cases { XCTAssertEqual(FileTypeSniffer.detect(b)?.mime, mime, name) }
    }

    func testZipFlavorsAndText() {
        XCTAssertEqual(FileTypeSniffer.detect(bytes([0x50, 0x4B, 0x03, 0x04] as [UInt8], pad(26), "[Content_Types].xml", pad(10), "word/document.xml"))?.ext, "docx")
        XCTAssertEqual(FileTypeSniffer.detect(bytes([0x50, 0x4B, 0x03, 0x04] as [UInt8], pad(26), "xl/workbook.xml"))?.ext, "xlsx")
        XCTAssertEqual(FileTypeSniffer.detect(bytes([0x50, 0x4B, 0x03, 0x04] as [UInt8], pad(26), "mimetypeapplication/epub+zip"))?.ext, "epub")
        XCTAssertEqual(FileTypeSniffer.detect(Array("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>".utf8))?.mime, "image/svg+xml")
        XCTAssertEqual(FileTypeSniffer.detect(Array("\u{FEFF}<?xml version=\"1.0\"?>\n<!-- c -->\n<svg viewBox=\"0 0 1 1\"/>".utf8))?.ext, "svg")
        XCTAssertEqual(FileTypeSniffer.detect(Array("<!DOCTYPE html><html></html>".utf8))?.ext, "html")
        XCTAssertEqual(FileTypeSniffer.detect(Array("<?xml version=\"1.0\"?><root/>".utf8))?.ext, "xml")
        XCTAssertEqual(FileTypeSniffer.detect(Array("{\"a\": [1, \"中文\"]}".utf8))?.ext, "json")
        XCTAssertEqual(FileTypeSniffer.detect(Array("{not json".utf8))?.ext, "txt")
        XCTAssertEqual(FileTypeSniffer.detect(Array("你好，世界 😀\n".utf8))?.mime, "text/plain")
        XCTAssertNil(FileTypeSniffer.detect([]))
        XCTAssertNil(FileTypeSniffer.detect([0x00, 0x13, 0x37, 0xFF]))
        XCTAssertNil(FileTypeSniffer.detect([0xC3, 0x28]))
        // 4096 字节处切开一个汉字
        XCTAssertEqual(FileTypeSniffer.detect(Array(String(repeating: "中", count: 3000).utf8))?.ext, "txt")
        XCTAssertEqual(FileTypeSniffer.detect(Array("%PDF-1.7".utf8))?.label.en, "PDF document")
    }
}
