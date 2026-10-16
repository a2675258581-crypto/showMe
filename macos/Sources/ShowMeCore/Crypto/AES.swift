import Foundation

// AES-128 / 192 / 256（FIPS-197），查表实现；分组模式见 BlockModes.swift。

public struct AES: BlockCipher {
    public let blockSize = 16
    let rounds: Int
    let encKeys: [UInt32]
    let decKeys: [UInt32]

    /// 密钥必须是 16 / 24 / 32 字节，否则抛出 CipherError
    public init(key: [UInt8]) throws {
        guard [16, 24, 32].contains(key.count) else {
            throw CipherError(LocalizedText(
                "AES 密钥必须是 16 / 24 / 32 字节（AES-128 / 192 / 256），当前 \(key.count) 字节",
                "An AES key must be 16, 24 or 32 bytes (AES-128 / 192 / 256), got \(key.count) bytes"
            ), field: .key)
        }
        let t = AESTables.shared
        let nk = key.count / 4
        rounds = nk + 6
        let total = 4 * (rounds + 1)
        var w = [UInt32](repeating: 0, count: total)
        for i in 0..<nk {
            w[i] = UInt32(key[4 * i]) << 24 | UInt32(key[4 * i + 1]) << 16 | UInt32(key[4 * i + 2]) << 8 | UInt32(key[4 * i + 3])
        }
        var rcon: UInt32 = 1
        for i in nk..<total {
            var temp = w[i - 1]
            if i % nk == 0 {
                temp = AES.subWord(rotl32(temp, 8), t.sbox) ^ (rcon << 24)
                rcon = UInt32(AESTables.xtime(UInt8(rcon)))
            } else if nk > 6 && i % nk == 4 {
                temp = AES.subWord(temp, t.sbox)
            }
            w[i] = w[i - nk] ^ temp
        }
        encKeys = w
        // 等价逆密码：轮密钥倒序，中间各轮做 InvMixColumns
        var dk = [UInt32](repeating: 0, count: total)
        for r in 0...rounds {
            for j in 0..<4 {
                let word = w[4 * (rounds - r) + j]
                if r == 0 || r == rounds {
                    dk[4 * r + j] = word
                } else {
                    dk[4 * r + j] = t.td0[Int(t.sbox[Int(word >> 24)])] ^ t.td1[Int(t.sbox[Int(word >> 16 & 255)])]
                        ^ t.td2[Int(t.sbox[Int(word >> 8 & 255)])] ^ t.td3[Int(t.sbox[Int(word & 255)])]
                }
            }
        }
        decKeys = dk
    }

    static func subWord(_ w: UInt32, _ s: [UInt8]) -> UInt32 {
        UInt32(s[Int(w >> 24)]) << 24 | UInt32(s[Int(w >> 16 & 255)]) << 16 | UInt32(s[Int(w >> 8 & 255)]) << 8 | UInt32(s[Int(w & 255)])
    }

    public func encryptBlock(_ data: inout [UInt8], at offset: Int) {
        let t = AESTables.shared
        let rk = encKeys
        var s0 = AES.load(data, offset) ^ rk[0]
        var s1 = AES.load(data, offset + 4) ^ rk[1]
        var s2 = AES.load(data, offset + 8) ^ rk[2]
        var s3 = AES.load(data, offset + 12) ^ rk[3]
        let te0 = t.te0, te1 = t.te1, te2 = t.te2, te3 = t.te3
        for r in 1..<rounds {
            let k = 4 * r
            let t0 = te0[Int(s0 >> 24)] ^ te1[Int(s1 >> 16 & 255)] ^ te2[Int(s2 >> 8 & 255)] ^ te3[Int(s3 & 255)] ^ rk[k]
            let t1 = te0[Int(s1 >> 24)] ^ te1[Int(s2 >> 16 & 255)] ^ te2[Int(s3 >> 8 & 255)] ^ te3[Int(s0 & 255)] ^ rk[k + 1]
            let t2 = te0[Int(s2 >> 24)] ^ te1[Int(s3 >> 16 & 255)] ^ te2[Int(s0 >> 8 & 255)] ^ te3[Int(s1 & 255)] ^ rk[k + 2]
            let t3 = te0[Int(s3 >> 24)] ^ te1[Int(s0 >> 16 & 255)] ^ te2[Int(s1 >> 8 & 255)] ^ te3[Int(s2 & 255)] ^ rk[k + 3]
            s0 = t0; s1 = t1; s2 = t2; s3 = t3
        }
        let s = t.sbox
        let k = 4 * rounds
        func last(_ a: UInt32, _ b: UInt32, _ c: UInt32, _ d: UInt32, _ key: UInt32) -> UInt32 {
            (UInt32(s[Int(a >> 24)]) << 24 | UInt32(s[Int(b >> 16 & 255)]) << 16 | UInt32(s[Int(c >> 8 & 255)]) << 8 | UInt32(s[Int(d & 255)])) ^ key
        }
        AES.store(&data, offset, last(s0, s1, s2, s3, rk[k]))
        AES.store(&data, offset + 4, last(s1, s2, s3, s0, rk[k + 1]))
        AES.store(&data, offset + 8, last(s2, s3, s0, s1, rk[k + 2]))
        AES.store(&data, offset + 12, last(s3, s0, s1, s2, rk[k + 3]))
    }

    public func decryptBlock(_ data: inout [UInt8], at offset: Int) {
        let t = AESTables.shared
        let dk = decKeys
        var s0 = AES.load(data, offset) ^ dk[0]
        var s1 = AES.load(data, offset + 4) ^ dk[1]
        var s2 = AES.load(data, offset + 8) ^ dk[2]
        var s3 = AES.load(data, offset + 12) ^ dk[3]
        let td0 = t.td0, td1 = t.td1, td2 = t.td2, td3 = t.td3
        for r in 1..<rounds {
            let k = 4 * r
            let t0 = td0[Int(s0 >> 24)] ^ td1[Int(s3 >> 16 & 255)] ^ td2[Int(s2 >> 8 & 255)] ^ td3[Int(s1 & 255)] ^ dk[k]
            let t1 = td0[Int(s1 >> 24)] ^ td1[Int(s0 >> 16 & 255)] ^ td2[Int(s3 >> 8 & 255)] ^ td3[Int(s2 & 255)] ^ dk[k + 1]
            let t2 = td0[Int(s2 >> 24)] ^ td1[Int(s1 >> 16 & 255)] ^ td2[Int(s0 >> 8 & 255)] ^ td3[Int(s3 & 255)] ^ dk[k + 2]
            let t3 = td0[Int(s3 >> 24)] ^ td1[Int(s2 >> 16 & 255)] ^ td2[Int(s1 >> 8 & 255)] ^ td3[Int(s0 & 255)] ^ dk[k + 3]
            s0 = t0; s1 = t1; s2 = t2; s3 = t3
        }
        let s = t.invSbox
        let k = 4 * rounds
        func last(_ a: UInt32, _ b: UInt32, _ c: UInt32, _ d: UInt32, _ key: UInt32) -> UInt32 {
            (UInt32(s[Int(a >> 24)]) << 24 | UInt32(s[Int(b >> 16 & 255)]) << 16 | UInt32(s[Int(c >> 8 & 255)]) << 8 | UInt32(s[Int(d & 255)])) ^ key
        }
        AES.store(&data, offset, last(s0, s3, s2, s1, dk[k]))
        AES.store(&data, offset + 4, last(s1, s0, s3, s2, dk[k + 1]))
        AES.store(&data, offset + 8, last(s2, s1, s0, s3, dk[k + 2]))
        AES.store(&data, offset + 12, last(s3, s2, s1, s0, dk[k + 3]))
    }

    @inline(__always) static func load(_ d: [UInt8], _ i: Int) -> UInt32 {
        UInt32(d[i]) << 24 | UInt32(d[i + 1]) << 16 | UInt32(d[i + 2]) << 8 | UInt32(d[i + 3])
    }

    @inline(__always) static func store(_ d: inout [UInt8], _ i: Int, _ v: UInt32) {
        d[i] = UInt8(v >> 24)
        d[i + 1] = UInt8(v >> 16 & 255)
        d[i + 2] = UInt8(v >> 8 & 255)
        d[i + 3] = UInt8(v & 255)
    }
}

/// S 盒与 T 表：启动时按 GF(2^8) 运算生成，避免手抄常量出错
struct AESTables: Sendable {
    static let shared = AESTables()

    let sbox: [UInt8]
    let invSbox: [UInt8]
    let te0: [UInt32], te1: [UInt32], te2: [UInt32], te3: [UInt32]
    let td0: [UInt32], td1: [UInt32], td2: [UInt32], td3: [UInt32]

    static func xtime(_ x: UInt8) -> UInt8 { x << 1 ^ (x & 0x80 != 0 ? 0x1B : 0) }

    static func mul(_ a: UInt8, _ b: UInt8) -> UInt8 {
        var a = a, b = b, p: UInt8 = 0
        while b != 0 {
            if b & 1 != 0 { p ^= a }
            a = xtime(a)
            b >>= 1
        }
        return p
    }

    init() {
        var s = [UInt8](repeating: 0, count: 256)
        var p: UInt8 = 1, q: UInt8 = 1
        repeat {
            // p 乘 3，q 除以 3（乘 3 的逆元），始终保持 q = p⁻¹
            p = p ^ (p << 1) ^ (p & 0x80 != 0 ? 0x1B : 0)
            q ^= q << 1
            q ^= q << 2
            q ^= q << 4
            if q & 0x80 != 0 { q ^= 0x09 }
            let r = q ^ (q << 1 | q >> 7) ^ (q << 2 | q >> 6) ^ (q << 3 | q >> 5) ^ (q << 4 | q >> 4)
            s[Int(p)] = r ^ 0x63
        } while p != 1
        s[0] = 0x63
        var inv = [UInt8](repeating: 0, count: 256)
        for i in 0..<256 { inv[Int(s[i])] = UInt8(i) }
        sbox = s
        invSbox = inv

        var e0 = [UInt32](repeating: 0, count: 256), d0 = [UInt32](repeating: 0, count: 256)
        for i in 0..<256 {
            let x = s[i]
            e0[i] = UInt32(AESTables.mul(x, 2)) << 24 | UInt32(x) << 16 | UInt32(x) << 8 | UInt32(AESTables.mul(x, 3))
            let y = inv[i]
            d0[i] = UInt32(AESTables.mul(y, 14)) << 24 | UInt32(AESTables.mul(y, 9)) << 16 | UInt32(AESTables.mul(y, 13)) << 8 | UInt32(AESTables.mul(y, 11))
        }
        te0 = e0
        te1 = e0.map { rotr32($0, 8) }
        te2 = e0.map { rotr32($0, 16) }
        te3 = e0.map { rotr32($0, 24) }
        td0 = d0
        td1 = d0.map { rotr32($0, 8) }
        td2 = d0.map { rotr32($0, 16) }
        td3 = d0.map { rotr32($0, 24) }
    }
}
