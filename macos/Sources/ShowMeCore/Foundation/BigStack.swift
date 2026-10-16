import Foundation

/// 在 16 MB 栈的专用线程上运行：JSON / XML 等递归解析在深层嵌套时需要比默认 512 KB 更大的栈。
/// App 里工具运行、格式化文档都走这里，而不是 Swift 并发的协作线程池。
public enum BigStack {
    public static let stackSize = 16 << 20

    public static func run<T: Sendable>(_ body: @escaping @Sendable () -> T) async -> T {
        await withCheckedContinuation { continuation in
            let thread = Thread {
                continuation.resume(returning: body())
            }
            thread.stackSize = stackSize
            thread.qualityOfService = .userInitiated
            thread.start()
        }
    }
}
