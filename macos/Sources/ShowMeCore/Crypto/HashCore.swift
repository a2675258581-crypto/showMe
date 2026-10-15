import Foundation

// 哈希算法的公共骨架：可增量计算的 StreamingHash 协议，
// 以及 MD5 / SHA-1 / SHA-2 / SM3 共用的 Merkle–Damgård 分组缓冲。

/// 可增量计算的哈希
public protocol StreamingHash: Sendable {
    /// 摘要长度（字节）
    static var digestSize: Int { get }
    /// HMAC 使用的分组长度（字节）
    static var blockSize: Int { get }
    init()
    mutating func update(_ data: UnsafeRawBufferPointer)
    /// 结束并返回摘要（之后不应再 update）
    mutating func finalize() -> [UInt8]
}

extension StreamingHash {
    public mutating func update(_ bytes: [UInt8]) {
        bytes.withUnsafeBytes { update($0) }
    }

    public mutating func update(_ text: String) {
        update(Array(text.utf8))
    }

    /// 一次性计算
    public static func hash(_ bytes: [UInt8]) -> [UInt8] {
        var h = Self()
        h.update(bytes)
        return h.finalize()
    }
}

/// Merkle–Damgård 结构的压缩函数
protocol BlockCompressor: Sendable {
    static var blockSize: Int { get }
    /// 长度字段的字节数（SHA-512 为 16，其余为 8）
    static var lengthFieldSize: Int { get }
    /// 长度字段是否大端（MD5 为小端）
    static var bigEndianLength: Bool { get }
    mutating func compress(_ block: UnsafePointer<UInt8>)
    func digest() -> [UInt8]
}

/// 分组缓冲 + 补位，具体算法只需实现压缩函数
struct MDEngine<C: BlockCompressor>: Sendable {
    var core: C
    var buffer: [UInt8]
    var bufferCount = 0
    var totalBytes: UInt64 = 0

    init(_ core: C) {
        self.core = core
        self.buffer = [UInt8](repeating: 0, count: C.blockSize)
    }

    mutating func update(_ data: UnsafeRawBufferPointer) {
        guard data.count > 0, let base = data.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
        let bs = C.blockSize
        let count = data.count
        totalBytes &+= UInt64(count)
        var offset = 0
        if bufferCount > 0 {
            let take = min(bs - bufferCount, count)
            for i in 0..<take { buffer[bufferCount + i] = base[i] }
            bufferCount += take
            offset = take
            if bufferCount == bs {
                let block = buffer
                block.withUnsafeBufferPointer { core.compress($0.baseAddress!) }
                bufferCount = 0
            }
        }
        while count - offset >= bs {
            core.compress(base + offset)
            offset += bs
        }
        let rest = count - offset
        if rest > 0 {
            for i in 0..<rest { buffer[i] = base[offset + i] }
            bufferCount = rest
        }
    }

    mutating func finalize() -> [UInt8] {
        let bs = C.blockSize
        let lenSize = C.lengthFieldSize
        let bitLength = totalBytes &* 8
        var tail: [UInt8] = [0x80]
        let used = (bufferCount + 1) % bs
        let zeros = used <= bs - lenSize ? bs - lenSize - used : bs - used + bs - lenSize
        tail.append(contentsOf: [UInt8](repeating: 0, count: zeros))
        var lengthBytes = [UInt8](repeating: 0, count: lenSize)
        for i in 0..<8 {
            let b = UInt8(truncatingIfNeeded: bitLength >> (8 * UInt64(i)))
            if C.bigEndianLength { lengthBytes[lenSize - 1 - i] = b } else { lengthBytes[i] = b }
        }
        tail.append(contentsOf: lengthBytes)
        let saved = totalBytes
        tail.withUnsafeBytes { update($0) }
        totalBytes = saved
        return core.digest()
    }
}

@inline(__always) func rotl32(_ x: UInt32, _ n: UInt32) -> UInt32 { x &<< n | x &>> (32 &- n) }
@inline(__always) func rotr32(_ x: UInt32, _ n: UInt32) -> UInt32 { x &>> n | x &<< (32 &- n) }
@inline(__always) func rotl64(_ x: UInt64, _ n: UInt64) -> UInt64 { x &<< n | x &>> (64 &- n) }
@inline(__always) func rotr64(_ x: UInt64, _ n: UInt64) -> UInt64 { x &>> n | x &<< (64 &- n) }

@inline(__always) func loadBE32(_ p: UnsafePointer<UInt8>, _ i: Int) -> UInt32 {
    UInt32(p[i]) << 24 | UInt32(p[i + 1]) << 16 | UInt32(p[i + 2]) << 8 | UInt32(p[i + 3])
}

@inline(__always) func loadLE32(_ p: UnsafePointer<UInt8>, _ i: Int) -> UInt32 {
    UInt32(p[i]) | UInt32(p[i + 1]) << 8 | UInt32(p[i + 2]) << 16 | UInt32(p[i + 3]) << 24
}

@inline(__always) func loadBE64(_ p: UnsafePointer<UInt8>, _ i: Int) -> UInt64 {
    var v: UInt64 = 0
    for k in 0..<8 { v = v << 8 | UInt64(p[i + k]) }
    return v
}

@inline(__always) func loadLE64(_ p: UnsafePointer<UInt8>, _ i: Int) -> UInt64 {
    var v: UInt64 = 0
    for k in (0..<8).reversed() { v = v << 8 | UInt64(p[i + k]) }
    return v
}

func storeBE32(_ words: [UInt32]) -> [UInt8] {
    var out: [UInt8] = []
    out.reserveCapacity(words.count * 4)
    for w in words {
        out.append(UInt8(w >> 24)); out.append(UInt8(w >> 16 & 255)); out.append(UInt8(w >> 8 & 255)); out.append(UInt8(w & 255))
    }
    return out
}

func storeLE32(_ words: [UInt32]) -> [UInt8] {
    var out: [UInt8] = []
    out.reserveCapacity(words.count * 4)
    for w in words {
        out.append(UInt8(w & 255)); out.append(UInt8(w >> 8 & 255)); out.append(UInt8(w >> 16 & 255)); out.append(UInt8(w >> 24))
    }
    return out
}

func storeBE64(_ words: [UInt64]) -> [UInt8] {
    var out: [UInt8] = []
    out.reserveCapacity(words.count * 8)
    for w in words {
        for k in (0..<8).reversed() { out.append(UInt8(truncatingIfNeeded: w >> (8 * UInt64(k)))) }
    }
    return out
}
