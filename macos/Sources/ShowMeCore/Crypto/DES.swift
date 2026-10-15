import Foundation

// DES（FIPS 46-3）与 3DES（DES-EDE，2 密钥或 3 密钥）

public struct DES: BlockCipher {
    public let blockSize = 8
    /// 16 轮子密钥，每轮 8 个 6 位组
    let subkeys: [[UInt8]]

    public init(key: [UInt8]) throws {
        guard key.count == 8 else {
            throw CipherError(LocalizedText(
                key.isEmpty ? "密钥不能为空" : "DES 密钥必须是 8 字节，当前 \(key.count) 字节",
                key.isEmpty ? "The key must not be empty" : "A DES key must be 8 bytes, got \(key.count) bytes"
            ), field: .key)
        }
        subkeys = DES.schedule(key)
    }

    static func schedule(_ key: [UInt8]) -> [[UInt8]] {
        var k: UInt64 = 0
        for b in key { k = k << 8 | UInt64(b) }
        let cd = DESTables.permute(k, DESTables.pc1, inputBits: 64)
        var c = UInt32(truncatingIfNeeded: cd >> 28) & 0x0FFF_FFFF
        var d = UInt32(truncatingIfNeeded: cd) & 0x0FFF_FFFF
        var keys: [[UInt8]] = []
        for shift in DESTables.shifts {
            c = (c << shift | c >> (28 - shift)) & 0x0FFF_FFFF
            d = (d << shift | d >> (28 - shift)) & 0x0FFF_FFFF
            let k48 = DESTables.permute(UInt64(c) << 28 | UInt64(d), DESTables.pc2, inputBits: 56)
            keys.append((0..<8).map { UInt8(truncatingIfNeeded: k48 >> (42 - 6 * UInt64($0))) & 0x3F })
        }
        return keys
    }

    @inline(__always) static func feistel(_ r: UInt32, _ k: [UInt8]) -> UInt32 {
        let sp = DESTables.shared.sp
        var out: UInt32 = 0
        for i in 0..<8 {
            // 扩展置换 E：第 i 组取 R 的第 4i … 4i+5 位（首尾环绕）
            let group = (rotl32(r, UInt32((4 * i + 31) % 32)) >> 26) & 0x3F
            out |= sp[i][Int(UInt8(group) ^ k[i])]
        }
        return out
    }

    func crypt(_ data: inout [UInt8], at offset: Int, decrypt: Bool) {
        var block: UInt64 = 0
        for i in 0..<8 { block = block << 8 | UInt64(data[offset + i]) }
        block = DES.crypt64(block, subkeys, decrypt: decrypt)
        for i in 0..<8 { data[offset + i] = UInt8(truncatingIfNeeded: block >> (56 - 8 * UInt64(i))) }
    }

    static func crypt64(_ input: UInt64, _ keys: [[UInt8]], decrypt: Bool) -> UInt64 {
        let t = DESTables.shared
        let ip = t.permuteFast(input, t.ipTable)
        var l = UInt32(truncatingIfNeeded: ip >> 32)
        var r = UInt32(truncatingIfNeeded: ip)
        for round in 0..<16 {
            let k = keys[decrypt ? 15 - round : round]
            let next = l ^ feistel(r, k)
            l = r
            r = next
        }
        return t.permuteFast(UInt64(r) << 32 | UInt64(l), t.fpTable)
    }

    public func encryptBlock(_ data: inout [UInt8], at offset: Int) { crypt(&data, at: offset, decrypt: false) }
    public func decryptBlock(_ data: inout [UInt8], at offset: Int) { crypt(&data, at: offset, decrypt: true) }
}

/// 3DES：密文 = E_K3(D_K2(E_K1(明文)))；16 字节密钥时 K3 = K1
public struct TripleDES: BlockCipher {
    public let blockSize = 8
    let k1: [[UInt8]], k2: [[UInt8]], k3: [[UInt8]]

    public init(key: [UInt8]) throws {
        guard key.count == 16 || key.count == 24 else {
            throw CipherError(LocalizedText(
                key.isEmpty ? "密钥不能为空" : "3DES 密钥必须是 16 字节（双倍长）或 24 字节（三倍长），当前 \(key.count) 字节",
                key.isEmpty ? "The key must not be empty" : "A 3DES key must be 16 bytes (two-key) or 24 bytes (three-key), got \(key.count) bytes"
            ), field: .key)
        }
        k1 = DES.schedule(Array(key[0..<8]))
        k2 = DES.schedule(Array(key[8..<16]))
        k3 = key.count == 24 ? DES.schedule(Array(key[16..<24])) : k1
    }

    /// 相邻子密钥相同时实际退化为单 DES
    public static func isDegenerate(_ key: [UInt8]) -> Bool {
        guard key.count == 16 || key.count == 24 else { return false }
        let a = Array(key[0..<8]), b = Array(key[8..<16])
        let c = key.count == 24 ? Array(key[16..<24]) : a
        return a == b || b == c
    }

    func crypt(_ data: inout [UInt8], at offset: Int, decrypt: Bool) {
        var block: UInt64 = 0
        for i in 0..<8 { block = block << 8 | UInt64(data[offset + i]) }
        if decrypt {
            block = DES.crypt64(block, k3, decrypt: true)
            block = DES.crypt64(block, k2, decrypt: false)
            block = DES.crypt64(block, k1, decrypt: true)
        } else {
            block = DES.crypt64(block, k1, decrypt: false)
            block = DES.crypt64(block, k2, decrypt: true)
            block = DES.crypt64(block, k3, decrypt: false)
        }
        for i in 0..<8 { data[offset + i] = UInt8(truncatingIfNeeded: block >> (56 - 8 * UInt64(i))) }
    }

    public func encryptBlock(_ data: inout [UInt8], at offset: Int) { crypt(&data, at: offset, decrypt: false) }
    public func decryptBlock(_ data: inout [UInt8], at offset: Int) { crypt(&data, at: offset, decrypt: true) }
}

struct DESTables: Sendable {
    static let shared = DESTables()

    // 置换表均为 1 起的位序号，第 1 位是最高位
    static let ip: [Int] = [
        58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
        62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
        57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
        61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
    ]
    static let pc1: [Int] = [
        57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
        10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
        63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
        14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
    ]
    static let pc2: [Int] = [
        14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
        23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
        41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
        44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
    ]
    static let p: [Int] = [
        16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
        2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
    ]
    static let shifts: [UInt32] = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
    static let sboxes: [[UInt8]] = [
        [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
         0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
         4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
         15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
        [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
         3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
         0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
         13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
        [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
         13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
         13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
         1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
        [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
         13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
         10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
         3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
        [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
         14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
         4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
         11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
        [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
         10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
         9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
         4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
        [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
         13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
         1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
         6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
        [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
         1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
         7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
         2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
    ]

    /// 按表置换：输出第 j 位 = 输入第 table[j] 位
    static func permute(_ input: UInt64, _ table: [Int], inputBits: Int) -> UInt64 {
        var out: UInt64 = 0
        for pos in table {
            out = out << 1 | (input >> UInt64(inputBits - pos)) & 1
        }
        return out
    }

    /// S 盒 + P 置换合成的 8 张表
    let sp: [[UInt32]]
    /// 64 位置换按字节查表：table[k][v] 为第 k 个字节取 v 时的贡献
    let ipTable: [[UInt64]]
    let fpTable: [[UInt64]]

    init() {
        var sp: [[UInt32]] = []
        for i in 0..<8 {
            var row = [UInt32](repeating: 0, count: 64)
            for x in 0..<64 {
                let r = (x >> 4 & 2) | (x & 1)
                let c = x >> 1 & 0xF
                let s = UInt64(DESTables.sboxes[i][r * 16 + c]) << UInt64(28 - 4 * i)
                row[x] = UInt32(DESTables.permute(s, DESTables.p, inputBits: 32))
            }
            sp.append(row)
        }
        self.sp = sp
        var fp = [Int](repeating: 0, count: 64)
        for (j, pos) in DESTables.ip.enumerated() { fp[pos - 1] = j + 1 }
        func byteTable(_ table: [Int]) -> [[UInt64]] {
            (0..<8).map { k in
                (0..<256).map { v in DESTables.permute(UInt64(v) << UInt64(56 - 8 * k), table, inputBits: 64) }
            }
        }
        ipTable = byteTable(DESTables.ip)
        fpTable = byteTable(fp)
    }

    @inline(__always) func permuteFast(_ input: UInt64, _ table: [[UInt64]]) -> UInt64 {
        var out: UInt64 = 0
        for k in 0..<8 { out |= table[k][Int(input >> UInt64(56 - 8 * k) & 0xFF)] }
        return out
    }
}
