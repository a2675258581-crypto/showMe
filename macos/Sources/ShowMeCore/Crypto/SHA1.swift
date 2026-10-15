import Foundation

// SHA-1（FIPS 180-4）

struct SHA1Core: BlockCompressor {
    static let blockSize = 64
    static let lengthFieldSize = 8
    static let bigEndianLength = true

    var h: [UInt32] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]
    var w = [UInt32](repeating: 0, count: 80)

    mutating func compress(_ p: UnsafePointer<UInt8>) {
        for i in 0..<16 { w[i] = loadBE32(p, i * 4) }
        for i in 16..<80 { w[i] = rotl32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1) }
        var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4]
        for i in 0..<80 {
            let f: UInt32
            let k: UInt32
            switch i {
            case 0..<20: f = (b & c) | (~b & d); k = 0x5A827999
            case 20..<40: f = b ^ c ^ d; k = 0x6ED9EBA1
            case 40..<60: f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC
            default: f = b ^ c ^ d; k = 0xCA62C1D6
            }
            let t = rotl32(a, 5) &+ f &+ e &+ k &+ w[i]
            e = d
            d = c
            c = rotl32(b, 30)
            b = a
            a = t
        }
        h[0] = h[0] &+ a; h[1] = h[1] &+ b; h[2] = h[2] &+ c; h[3] = h[3] &+ d; h[4] = h[4] &+ e
    }

    func digest() -> [UInt8] { storeBE32(h) }
}

public struct SHA1: StreamingHash {
    public static let digestSize = 20
    public static let blockSize = 64
    var engine = MDEngine(SHA1Core())

    public init() {}

    public mutating func update(_ data: UnsafeRawBufferPointer) { engine.update(data) }
    public mutating func finalize() -> [UInt8] { engine.finalize() }
}
