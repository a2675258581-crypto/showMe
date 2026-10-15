import Foundation

// BLAKE3（默认哈希模式，32 字节输出），按官方参考实现移植：1 KB 分块 + 二叉树合并。

public struct BLAKE3: StreamingHash {
    public static let digestSize = 32
    public static let blockSize = 64

    static let iv: [UInt32] = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]
    static let permutation: [Int] = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8]
    static let chunkStart: UInt32 = 1
    static let chunkEnd: UInt32 = 2
    static let parent: UInt32 = 4
    static let root: UInt32 = 8
    static let chunkLen = 1024

    @inline(__always) static func g(_ s: inout [UInt32], _ a: Int, _ b: Int, _ c: Int, _ d: Int, _ mx: UInt32, _ my: UInt32) {
        s[a] = s[a] &+ s[b] &+ mx
        s[d] = rotr32(s[d] ^ s[a], 16)
        s[c] = s[c] &+ s[d]
        s[b] = rotr32(s[b] ^ s[c], 12)
        s[a] = s[a] &+ s[b] &+ my
        s[d] = rotr32(s[d] ^ s[a], 8)
        s[c] = s[c] &+ s[d]
        s[b] = rotr32(s[b] ^ s[c], 7)
    }

    static func compress(_ cv: [UInt32], _ block: [UInt32], _ counter: UInt64, _ blockLen: UInt32, _ flags: UInt32) -> [UInt32] {
        var s: [UInt32] = [
            cv[0], cv[1], cv[2], cv[3], cv[4], cv[5], cv[6], cv[7],
            iv[0], iv[1], iv[2], iv[3],
            UInt32(truncatingIfNeeded: counter), UInt32(truncatingIfNeeded: counter >> 32), blockLen, flags,
        ]
        var m = block
        for r in 0..<7 {
            g(&s, 0, 4, 8, 12, m[0], m[1])
            g(&s, 1, 5, 9, 13, m[2], m[3])
            g(&s, 2, 6, 10, 14, m[4], m[5])
            g(&s, 3, 7, 11, 15, m[6], m[7])
            g(&s, 0, 5, 10, 15, m[8], m[9])
            g(&s, 1, 6, 11, 12, m[10], m[11])
            g(&s, 2, 7, 8, 13, m[12], m[13])
            g(&s, 3, 4, 9, 14, m[14], m[15])
            if r < 6 { m = permutation.map { m[$0] } }
        }
        for i in 0..<8 {
            s[i] ^= s[i + 8]
            s[i + 8] ^= cv[i]
        }
        return s
    }

    static func words(_ block: [UInt8]) -> [UInt32] {
        var w = [UInt32](repeating: 0, count: 16)
        for i in 0..<16 {
            var v: UInt32 = 0
            for k in 0..<4 where i * 4 + k < block.count { v |= UInt32(block[i * 4 + k]) << (8 * UInt32(k)) }
            w[i] = v
        }
        return w
    }

    struct Output {
        var cv: [UInt32]
        var block: [UInt32]
        var counter: UInt64
        var blockLen: UInt32
        var flags: UInt32

        func chainingValue() -> [UInt32] {
            Array(BLAKE3.compress(cv, block, counter, blockLen, flags).prefix(8))
        }

        func rootBytes(_ count: Int) -> [UInt8] {
            var out: [UInt8] = []
            var blockCounter: UInt64 = 0
            while out.count < count {
                let words = BLAKE3.compress(cv, block, blockCounter, blockLen, flags | BLAKE3.root)
                for b in storeLE32(words) where out.count < count { out.append(b) }
                blockCounter += 1
            }
            return out
        }
    }

    struct ChunkState {
        var cv: [UInt32]
        var chunkCounter: UInt64
        var block = [UInt8]()
        var blocksCompressed = 0

        var length: Int { blocksCompressed * 64 + block.count }
        var startFlag: UInt32 { blocksCompressed == 0 ? BLAKE3.chunkStart : 0 }

        mutating func update(_ bytes: ArraySlice<UInt8>) {
            var input = bytes
            while !input.isEmpty {
                if block.count == 64 {
                    let out = BLAKE3.compress(cv, BLAKE3.words(block), chunkCounter, 64, startFlag)
                    cv = Array(out.prefix(8))
                    blocksCompressed += 1
                    block.removeAll(keepingCapacity: true)
                }
                let take = min(64 - block.count, input.count)
                block.append(contentsOf: input.prefix(take))
                input = input.dropFirst(take)
            }
        }

        func output() -> Output {
            Output(cv: cv, block: BLAKE3.words(block), counter: chunkCounter, blockLen: UInt32(block.count),
                   flags: startFlag | BLAKE3.chunkEnd)
        }
    }

    var chunk = ChunkState(cv: BLAKE3.iv, chunkCounter: 0)
    var stack: [[UInt32]] = []

    public init() {}

    static func parentOutput(_ left: [UInt32], _ right: [UInt32]) -> Output {
        Output(cv: iv, block: left + right, counter: 0, blockLen: 64, flags: parent)
    }

    mutating func addChunkCV(_ newCV: [UInt32], _ totalChunks: UInt64) {
        var cv = newCV
        var total = totalChunks
        while total & 1 == 0, let left = stack.popLast() {
            cv = BLAKE3.parentOutput(left, cv).chainingValue()
            total >>= 1
        }
        stack.append(cv)
    }

    public mutating func update(_ data: UnsafeRawBufferPointer) {
        var input = ArraySlice(data.bindMemory(to: UInt8.self))
        while !input.isEmpty {
            if chunk.length == BLAKE3.chunkLen {
                let cv = chunk.output().chainingValue()
                let total = chunk.chunkCounter + 1
                addChunkCV(cv, total)
                chunk = ChunkState(cv: BLAKE3.iv, chunkCounter: total)
            }
            let take = min(BLAKE3.chunkLen - chunk.length, input.count)
            chunk.update(input.prefix(take))
            input = input.dropFirst(take)
        }
    }

    public mutating func finalize() -> [UInt8] {
        var output = chunk.output()
        var remaining = stack.count
        while remaining > 0 {
            remaining -= 1
            output = BLAKE3.parentOutput(stack[remaining], output.chainingValue())
        }
        return output.rootBytes(BLAKE3.digestSize)
    }
}
