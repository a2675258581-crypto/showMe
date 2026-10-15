import Foundation

// SHA3-256 / SHA3-512（FIPS 202）与以太坊使用的 Keccak-256（原始填充 0x01）

struct KeccakSponge: Sendable {
    static let roundConstants: [UInt64] = [
        0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
        0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
        0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
        0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
        0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
        0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
    ]
    /// 下标 x + 5y 的旋转位数
    static let rotations: [UInt64] = [
        0, 1, 62, 28, 27,
        36, 44, 6, 55, 20,
        3, 10, 43, 25, 39,
        41, 45, 15, 21, 8,
        18, 2, 61, 56, 14,
    ]

    var state = [UInt64](repeating: 0, count: 25)
    var buffer: [UInt8]
    var bufferCount = 0
    /// 吸收速率（字节）
    let rate: Int
    let outputSize: Int
    /// 域分隔后缀：SHA-3 为 0x06，Keccak 为 0x01
    let suffix: UInt8

    init(outputSize: Int, suffix: UInt8) {
        self.outputSize = outputSize
        self.rate = 200 - 2 * outputSize
        self.suffix = suffix
        self.buffer = [UInt8](repeating: 0, count: 200 - 2 * outputSize)
    }

    static func permute(_ a: inout [UInt64]) {
        var b = [UInt64](repeating: 0, count: 25)
        var c = [UInt64](repeating: 0, count: 5)
        for round in 0..<24 {
            // θ
            for x in 0..<5 { c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20] }
            for x in 0..<5 {
                let d = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1)
                for y in stride(from: 0, to: 25, by: 5) { a[x + y] ^= d }
            }
            // ρ 与 π
            for x in 0..<5 {
                for y in 0..<5 {
                    let i = x + 5 * y
                    b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(a[i], rotations[i])
                }
            }
            // χ
            for y in stride(from: 0, to: 25, by: 5) {
                for x in 0..<5 {
                    a[x + y] = b[x + y] ^ (~b[(x + 1) % 5 + y] & b[(x + 2) % 5 + y])
                }
            }
            // ι
            a[0] ^= roundConstants[round]
        }
    }

    mutating func absorbBlock(_ p: UnsafePointer<UInt8>) {
        for i in 0..<(rate / 8) { state[i] ^= loadLE64(p, i * 8) }
        KeccakSponge.permute(&state)
    }

    mutating func update(_ data: UnsafeRawBufferPointer) {
        guard data.count > 0, let base = data.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
        let count = data.count
        var offset = 0
        if bufferCount > 0 {
            let take = min(rate - bufferCount, count)
            for i in 0..<take { buffer[bufferCount + i] = base[i] }
            bufferCount += take
            offset = take
            if bufferCount == rate {
                let block = buffer
                block.withUnsafeBufferPointer { absorbBlock($0.baseAddress!) }
                bufferCount = 0
            }
        }
        while count - offset >= rate {
            absorbBlock(base + offset)
            offset += rate
        }
        let rest = count - offset
        if rest > 0 {
            for i in 0..<rest { buffer[i] = base[offset + i] }
            bufferCount = rest
        }
    }

    mutating func finalize() -> [UInt8] {
        var block = [UInt8](repeating: 0, count: rate)
        for i in 0..<bufferCount { block[i] = buffer[i] }
        block[bufferCount] ^= suffix
        block[rate - 1] ^= 0x80
        block.withUnsafeBufferPointer { absorbBlock($0.baseAddress!) }
        var out: [UInt8] = []
        out.reserveCapacity(outputSize)
        // 输出长度都小于 rate，挤压一次即可
        for lane in state {
            for k in 0..<8 where out.count < outputSize {
                out.append(UInt8(truncatingIfNeeded: lane >> (8 * UInt64(k))))
            }
            if out.count >= outputSize { break }
        }
        return out
    }
}

public struct SHA3_256: StreamingHash {
    public static let digestSize = 32
    public static let blockSize = 136
    var sponge = KeccakSponge(outputSize: 32, suffix: 0x06)
    public init() {}
    public mutating func update(_ data: UnsafeRawBufferPointer) { sponge.update(data) }
    public mutating func finalize() -> [UInt8] { sponge.finalize() }
}

public struct SHA3_512: StreamingHash {
    public static let digestSize = 64
    public static let blockSize = 72
    var sponge = KeccakSponge(outputSize: 64, suffix: 0x06)
    public init() {}
    public mutating func update(_ data: UnsafeRawBufferPointer) { sponge.update(data) }
    public mutating func finalize() -> [UInt8] { sponge.finalize() }
}

public struct Keccak256: StreamingHash {
    public static let digestSize = 32
    public static let blockSize = 136
    var sponge = KeccakSponge(outputSize: 32, suffix: 0x01)
    public init() {}
    public mutating func update(_ data: UnsafeRawBufferPointer) { sponge.update(data) }
    public mutating func finalize() -> [UInt8] { sponge.finalize() }
}
