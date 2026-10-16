import Foundation

/// App 内置的 JavaScript 引擎（JavaScriptCore + 打包好的 prettier / sql-formatter / js-yaml / marked / cronstrue）。
/// Core 只定义接口；macOS App 启动时注入实现。Linux 上测试时为 nil，依赖它的工具会报「不可用」。
public protocol ScriptEngine: Sendable {
    /// 调用 `ShowMeEngine[function](args)`，返回字符串结果；JS 侧抛错时抛出 `ScriptError`。
    func call(_ function: String, _ args: [String: String]) throws -> String
}

public struct ScriptError: Error, Sendable, Hashable {
    public var message: String
    public var line: Int?
    public var column: Int?

    public init(message: String, line: Int? = nil, column: Int? = nil) {
        self.message = message
        self.line = line
        self.column = column
    }
}

public enum ToolEnvironment {
    nonisolated(unsafe) public static var script: ScriptEngine?

    /// 调用脚本引擎；引擎缺失或出错时转换成本地化的 `ToolError`。
    public static func runScript(_ function: String, _ args: [String: String], lang: Lang) throws -> String {
        guard let engine = script else {
            throw ToolError(lang.t("格式化引擎不可用", "The formatting engine is unavailable"))
        }
        do {
            return try engine.call(function, args)
        } catch let e as ScriptError {
            throw ToolError(e.message, line: e.line, column: e.column)
        }
    }
}
