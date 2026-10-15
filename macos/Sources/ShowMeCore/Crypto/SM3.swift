import Foundation

// SM3 国密杂凑算法（GB/T 32905-2016）

struct SM3Core: BlockCompressor {
    static let blockSize = 64
    static let lengthFieldSize = 8
    static let bigEndianLength = true

    var v: [UInt32] = [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e]
    var w = [UInt32](repeating: 0, count: 68)

    @inline(__always) static func p0(_ x: UInt32) -> UInt32 { x ^ rotl32(x, 9) ^ rotl32(x, 17) }
    @inline(__always) static func p1(_ x: UInt32) -> UInt32 { x ^ rotl32(x, 15) ^ rotl32(x, 23) }

    mutating func compress(_ p: UnsafePointer<UInt8>) {
        for i in 0..<16 { w[i] = loadBE32(p, i * 4) }
        for j in 16..<68 {
            w[j] = SM3Core.p1(w[j - 16] ^ w[j - 9] ^ rotl32(w[j - 3], 15)) ^ rotl32(w[j - 13], 7) ^ w[j - 6]
        }
        var a = v[0], b = v[1], c = v[2], d = v[3], e = v[4], f = v[5], g = v[6], h = v[7]
        for j in 0..<64 {
            let t: UInt32 = j < 16 ? 0x79cc4519 : 0x7a879d8a
            let a12 = rotl32(a, 12)
            let ss1 = rotl32(a12 &+ e &+ rotl32(t, UInt32(j % 32)), 7)
            let ss2 = ss1 ^ a12
            let ff: UInt32 = j < 16 ? a ^ b ^ c : (a & b) | (a & c) | (b & c)
            let gg: UInt32 = j < 16 ? e ^ f ^ g : (e & f) | (~e & g)
            let tt1 = ff &+ d &+ ss2 &+ (w[j] ^ w[j + 4])
            let tt2 = gg &+ h &+ ss1 &+ w[j]
            d = c
            c = rotl32(b, 9)
            b = a
            a = tt1
            h = g
            g = rotl32(f, 19)
            f = e
            e = SM3Core.p0(tt2)
        }
        v[0] ^= a; v[1] ^= b; v[2] ^= c; v[3] ^= d
        v[4] ^= e; v[5] ^= f; v[6] ^= g; v[7] ^= h
    }

    func digest() -> [UInt8] { storeBE32(v) }
}

public struct SM3: StreamingHash {
    public static let digestSize = 32
    public static let blockSize = 64
    var engine = MDEngine(SM3Core())
    public init() {}
    public mutating func update(_ data: UnsafeRawBufferPointer) { engine.update(data) }
    public mutating func finalize() -> [UInt8] { engine.finalize() }
}
