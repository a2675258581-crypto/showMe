import Foundation

// 非加密校验 / 哈希：CRC32（IEEE 802.3，ZIP / PNG 使用）与 xxHash64（种子 0）

public struct CRC32: StreamingHash {
    public static let digestSize = 4
    public static let blockSize = 64

    static let table: [UInt32] = (0..<256).map { i -> UInt32 in
        var c = UInt32(i)
        for _ in 0..<8 { c = c & 1 != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1 }
        return c
    }

    var crc: UInt32 = 0xFFFF_FFFF

    public init() {}

    public mutating func update(_ data: UnsafeRawBufferPointer) {
        let t = CRC32.table
        var c = crc
        for b in data { c = t[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        crc = c
    }

    public mutating func finalize() -> [UInt8] { storeBE32([crc ^ 0xFFFF_FFFF]) }

    /// 直接得到数值
    public static func checksum(_ bytes: [UInt8]) -> UInt32 {
        var h = CRC32()
        h.update(bytes)
        return h.crc ^ 0xFFFF_FFFF
    }
}

public struct XXHash64: StreamingHash {
    public static let digestSize = 8
    public static let blockSize = 32

    static let p1: UInt64 = 0x9E3779B185EBCA87
    static let p2: UInt64 = 0xC2B2AE3D27D4EB4F
    static let p3: UInt64 = 0x165667B19E3779F9
    static let p4: UInt64 = 0x85EBCA77C2B2AE63
    static let p5: UInt64 = 0x27D4EB2F165667C5

    let seed: UInt64
    var v1: UInt64, v2: UInt64, v3: UInt64, v4: UInt64
    var buffer = [UInt8](repeating: 0, count: 32)
    var bufferCount = 0
    var total: UInt64 = 0

    public init() { self.init(seed: 0) }

    public init(seed: UInt64) {
        self.seed = seed
        v1 = seed &+ XXHash64.p1 &+ XXHash64.p2
        v2 = seed &+ XXHash64.p2
        v3 = seed
        v4 = seed &- XXHash64.p1
    }

    @inline(__always) static func round(_ acc: UInt64, _ input: UInt64) -> UInt64 {
        rotl64(acc &+ input &* p2, 31) &* p1
    }

    @inline(__always) static func merge(_ acc: UInt64, _ val: UInt64) -> UInt64 {
        (acc ^ round(0, val)) &* p1 &+ p4
    }

    mutating func stripe(_ p: UnsafePointer<UInt8>) {
        v1 = XXHash64.round(v1, loadLE64(p, 0))
        v2 = XXHash64.round(v2, loadLE64(p, 8))
        v3 = XXHash64.round(v3, loadLE64(p, 16))
        v4 = XXHash64.round(v4, loadLE64(p, 24))
    }

    public mutating func update(_ data: UnsafeRawBufferPointer) {
        guard data.count > 0, let base = data.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
        let count = data.count
        total &+= UInt64(count)
        var offset = 0
        if bufferCount > 0 {
            let take = min(32 - bufferCount, count)
            for i in 0..<take { buffer[bufferCount + i] = base[i] }
            bufferCount += take
            offset = take
            if bufferCount == 32 {
                let block = buffer
                block.withUnsafeBufferPointer { stripe($0.baseAddress!) }
                bufferCount = 0
            }
        }
        while count - offset >= 32 {
            stripe(base + offset)
            offset += 32
        }
        let rest = count - offset
        if rest > 0 {
            for i in 0..<rest { buffer[i] = base[offset + i] }
            bufferCount = rest
        }
    }

    public mutating func finalize() -> [UInt8] {
        typealias X = XXHash64
        var h: UInt64
        if total >= 32 {
            h = rotl64(v1, 1) &+ rotl64(v2, 7) &+ rotl64(v3, 12) &+ rotl64(v4, 18)
            h = X.merge(h, v1)
            h = X.merge(h, v2)
            h = X.merge(h, v3)
            h = X.merge(h, v4)
        } else {
            h = seed &+ X.p5
        }
        h = h &+ total
        let tail = Array(buffer.prefix(bufferCount))
        tail.withUnsafeBufferPointer { b in
            guard let p = b.baseAddress else { return }
            var i = 0
            while i + 8 <= b.count {
                h ^= X.round(0, loadLE64(p, i))
                h = rotl64(h, 27) &* X.p1 &+ X.p4
                i += 8
            }
            if i + 4 <= b.count {
                h ^= UInt64(loadLE32(p, i)) &* X.p1
                h = rotl64(h, 23) &* X.p2 &+ X.p3
                i += 4
            }
            while i < b.count {
                h ^= UInt64(p[i]) &* X.p5
                h = rotl64(h, 11) &* X.p1
                i += 1
            }
        }
        h ^= h >> 33
        h = h &* X.p2
        h ^= h >> 29
        h = h &* X.p3
        h ^= h >> 32
        return storeBE64([h])
    }
}
