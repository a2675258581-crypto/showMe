import Foundation
import JavaScriptCore
import ShowMeCore

/// 在 JavaScriptCore 里运行打包好的 prettier / sql-formatter / js-yaml / marked / cronstrue。
/// 第一次调用时才加载（约 2 MB 脚本，150 ms 左右）；所有调用串行在一个专用队列上。
final class JSEngine: ScriptEngine, @unchecked Sendable {
    static let shared = JSEngine()

    private let queue = DispatchQueue(label: "app.showme.js-engine", qos: .userInitiated)
    private var context: JSContext?
    private var counter = 0

    func call(_ function: String, _ args: [String: String]) throws -> String {
        try queue.sync { try callOnQueue(function, args) }
    }

    /// 后台预热，第一次格式化不卡顿
    func warmUp() {
        queue.async { [self] in _ = try? loadContext() }
    }

    static func bundleURL() -> URL? {
        if let url = Bundle.main.url(forResource: "showme-engine", withExtension: "js", subdirectory: "engine") {
            return url
        }
        // swift run / Xcode 直接运行可执行文件时：从源码目录找
        let source = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // Engine
            .deletingLastPathComponent() // ShowMe
            .deletingLastPathComponent() // Sources
            .deletingLastPathComponent() // macos
            .appendingPathComponent("Resources/engine/showme-engine.js")
        return FileManager.default.fileExists(atPath: source.path) ? source : nil
    }

    private func loadContext() throws -> JSContext {
        if let context { return context }
        guard let url = Self.bundleURL(), let source = try? String(contentsOf: url, encoding: .utf8) else {
            throw ScriptError(message: "找不到格式化引擎（engine/showme-engine.js）/ Formatting engine not found")
        }
        guard let ctx = JSContext() else {
            throw ScriptError(message: "无法创建 JavaScript 环境 / Cannot create a JavaScript context")
        }
        ctx.name = "showMe engine"
        var loadError: String?
        ctx.exceptionHandler = { _, exception in
            loadError = exception?.toString()
        }
        ctx.evaluateScript(source, withSourceURL: url)
        if let loadError {
            throw ScriptError(message: "格式化引擎加载失败 / Engine failed to load: \(loadError)")
        }
        ctx.exceptionHandler = { _, _ in }
        context = ctx
        return ctx
    }

    private func callOnQueue(_ function: String, _ args: [String: String]) throws -> String {
        let ctx = try loadContext()
        counter += 1
        let token = "t\(counter)"
        let data = try JSONSerialization.data(withJSONObject: args, options: [])
        let argsJSON = String(decoding: data, as: UTF8.self)
        guard let entry = ctx.objectForKeyedSubscript("__showmeCall"), entry.isObject,
              let results = ctx.objectForKeyedSubscript("__showmeResults")
        else {
            throw ScriptError(message: "格式化引擎不完整 / Engine is incomplete")
        }
        entry.call(withArguments: [function, argsJSON, token])
        // Promise 的回调在 JavaScriptCore 退出调用时执行；个别情况下需要再给它几次机会
        for _ in 0..<50 {
            if let result = results.objectForKeyedSubscript(token), !result.isUndefined, !result.isNull {
                ctx.evaluateScript("delete __showmeResults['\(token)']")
                if let ok = result.objectForKeyedSubscript("ok"), ok.isString {
                    return ok.toString()
                }
                let error = result.objectForKeyedSubscript("error")
                let message = error?.objectForKeyedSubscript("message")?.toString() ?? "Unknown error"
                func int(_ key: String) -> Int? {
                    guard let v = error?.objectForKeyedSubscript(key), v.isNumber else { return nil }
                    return Int(v.toInt32())
                }
                throw ScriptError(message: message, line: int("line"), column: int("column"))
            }
            ctx.evaluateScript("void 0")
        }
        ctx.evaluateScript("delete __showmeResults['\(token)']")
        throw ScriptError(message: "格式化超时 / Formatting timed out")
    }
}
