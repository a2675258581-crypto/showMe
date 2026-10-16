import Foundation
import ShowMeCore

/// 读写文本文件：自动识别编码（UTF-8 / UTF-16 / GB18030…）与换行符，保存时原样写回。
enum FileIO {
    static let maxFileSize = 50 * 1024 * 1024

    struct Loaded {
        var text: String
        var encoding: TextEncoding
        var lineEnding: LineEnding
    }

    struct Failure: Error, LocalizedError {
        var message: String
        var errorDescription: String? { message }
    }

    static func read(_ url: URL, lang: Lang) throws -> Loaded {
        let name = url.lastPathComponent
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        if let size = (attributes?[.size] as? NSNumber)?.intValue, size > maxFileSize {
            throw Failure(message: lang.t("“\(name)” 太大了（超过 50 MB）", "\"\(name)\" is too large (over 50 MB)"))
        }
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw Failure(message: lang.t("无法读取“\(name)”：\(error.localizedDescription)", "Cannot read \"\(name)\": \(error.localizedDescription)"))
        }
        let bytes = [UInt8](data)
        if TextFile.isProbablyBinary(bytes) {
            throw Failure(message: lang.t("“\(name)” 看起来不是文本文件", "\"\(name)\" doesn't look like a text file"))
        }
        guard let (raw, encoding) = TextFile.decode(bytes) else {
            throw Failure(message: lang.t("无法识别“\(name)”的文字编码", "Cannot detect the text encoding of \"\(name)\""))
        }
        let ending = LineEnding.detect(raw)
        return Loaded(text: LineEnding.normalize(raw), encoding: encoding, lineEnding: ending)
    }

    static func write(_ text: String, to url: URL, encoding: TextEncoding, lineEnding: LineEnding, lang: Lang) throws {
        let output = LineEnding.apply(lineEnding, to: text)
        guard let bytes = TextFile.encode(output, as: encoding) else {
            throw Failure(message: lang.t(
                "有字符无法用 \(encoding.displayName) 保存，请改用 UTF-8",
                "Some characters can't be saved as \(encoding.displayName); use UTF-8 instead"
            ))
        }
        let fm = FileManager.default
        // 原子写入会换掉文件，先记下权限（比如脚本的可执行位）再恢复
        let permissions = (try? fm.attributesOfItem(atPath: url.path))?[.posixPermissions]
        do {
            try Data(bytes).write(to: url, options: .atomic)
        } catch {
            throw Failure(message: lang.t("保存失败：\(error.localizedDescription)", "Save failed: \(error.localizedDescription)"))
        }
        if let permissions {
            try? fm.setAttributes([.posixPermissions: permissions], ofItemAtPath: url.path)
        }
    }
}
