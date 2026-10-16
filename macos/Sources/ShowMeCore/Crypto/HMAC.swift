import Foundation

// HMAC（RFC 2104）与密钥派生：PBKDF2（RFC 8018）、OpenSSL EVP_BytesToKey。

public enum HMAC {
    /// 计算 HMAC。超过分组长度的密钥会先被哈希。
    public static func mac(_ algorithm: HashAlgorithm, key: [UInt8], message: [UInt8]) -> [UInt8] {
        var ctx = Context(algorithm, key: key)
        ctx.update(message)
        return ctx.finalize()
    }

    public static func mac(_ algorithm: HashAlgorithm, key: String, message: String) -> [UInt8] {
        mac(algorithm, key: Array(key.utf8), message: Array(message.utf8))
    }

    /// 常数时间校验
    public static func verify(_ algorithm: HashAlgorithm, key: [UInt8], message: [UInt8], mac expected: [UInt8]) -> Bool {
        ByteUtil.constantTimeEqual(mac(algorithm, key: key, message: message), expected)
    }

    /// 可增量计算的 HMAC
    public struct Context: Sendable {
        var inner: HashContext
        var outer: HashContext

        public init(_ algorithm: HashAlgorithm, key: [UInt8]) {
            let bs = algorithm.blockSize
            var k = key.count > bs ? Hash.digest(algorithm, key) : key
            k += [UInt8](repeating: 0, count: bs - k.count)
            inner = HashContext(algorithm)
            outer = HashContext(algorithm)
            inner.update(k.map { $0 ^ 0x36 })
            outer.update(k.map { $0 ^ 0x5C })
        }

        public mutating func update(_ bytes: [UInt8]) { inner.update(bytes) }

        public mutating func finalize() -> [UInt8] {
            outer.update(inner.finalize())
            return outer.finalize()
        }
    }
}

public enum KDF {
    /// PBKDF2-HMAC：迭代次数应 ≥ 1
    public static func pbkdf2(_ algorithm: HashAlgorithm, password: [UInt8], salt: [UInt8], iterations: Int, keyLength: Int) -> [UInt8] {
        let rounds = max(1, iterations)
        let base = HMAC.Context(algorithm, key: password)
        var out: [UInt8] = []
        out.reserveCapacity(keyLength)
        var blockIndex: UInt32 = 1
        while out.count < keyLength {
            var ctx = base
            ctx.update(salt + [UInt8(blockIndex >> 24), UInt8(blockIndex >> 16 & 255), UInt8(blockIndex >> 8 & 255), UInt8(blockIndex & 255)])
            var u = ctx.finalize()
            var t = u
            if rounds > 1 {
                for _ in 1..<rounds {
                    var c = base
                    c.update(u)
                    u = c.finalize()
                    for i in 0..<t.count { t[i] ^= u[i] }
                }
            }
            out += t.prefix(keyLength - out.count)
            blockIndex += 1
        }
        return out
    }

    /// OpenSSL EVP_BytesToKey（count = 1）：D_i = H(D_{i-1} || 口令 || 盐)，CryptoJS 口令模式默认用 MD5
    public static func evpBytesToKey(_ algorithm: HashAlgorithm = .md5, password: [UInt8], salt: [UInt8], keyLength: Int, ivLength: Int) -> (key: [UInt8], iv: [UInt8]) {
        let total = keyLength + ivLength
        var bytes: [UInt8] = []
        var prev: [UInt8] = []
        while bytes.count < total {
            prev = Hash.digest(algorithm, prev + password + salt)
            bytes += prev
        }
        return (Array(bytes[0..<keyLength]), Array(bytes[keyLength..<total]))
    }
}
