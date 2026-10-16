import Foundation
import ShowMeCore

/// 会话存档：打开的标签页、未保存的内容、工具抽屉的状态。
/// 存在 ~/Library/Application Support/showMe/session.json，任何改动后约 0.8 秒写一次，退出时再写一次。
struct SessionSnapshot: Codable {
    struct Tab: Codable {
        var id: UUID
        /// "document" 或 "tool"
        var kind: String
        var toolID: String?
        var path: String?
        var untitledIndex: Int
        var language: String
        var encoding: String
        var lineEnding: String
        /// 只在有未保存修改（或未命名）时存内容；干净的文件下次从磁盘重新读
        var text: String?
        var selectionLocation: Int
        var selectionLength: Int
    }

    struct Drawer: Codable {
        var isOpen: Bool
        var height: Double
        var toolID: String
        var recent: [String]
        /// 各工具的选项（不含密钥类字段）
        var options: [String: [String: String]]
    }

    var version = 1
    var tabs: [Tab]
    var activeID: UUID?
    var drawer: Drawer
    var savedAt: Date
}

enum SessionStore {
    static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent("showMe", isDirectory: true)
    }

    static var fileURL: URL { directory.appendingPathComponent("session.json") }

    private static let queue = DispatchQueue(label: "app.showme.session", qos: .utility)

    static func load() -> SessionSnapshot? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(SessionSnapshot.self, from: data)
    }

    /// 编码在主线程完成（快照是值类型），写盘放到后台队列
    static func save(_ snapshot: SessionSnapshot, synchronously: Bool = false) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(snapshot) else { return }
        let write = {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try? data.write(to: fileURL, options: .atomic)
        }
        if synchronously {
            queue.sync(execute: write)
        } else {
            queue.async(execute: write)
        }
    }
}
