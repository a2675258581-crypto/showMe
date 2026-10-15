import Foundation

// 统一的哈希入口：`Hash.digest(.sha256, bytes)`、可增量的 `HashContext`。

public enum HashAlgorithm: String, CaseIterable, Sendable, Hashable {
    case md5
    case sha1
    case sha224
    case sha256
    case sha384
    case sha512
    case sha3_256 = "sha3-256"
    case sha3_512 = "sha3-512"
    case keccak256
    case sm3
    case crc32
    case xxhash64
    case blake3

    /// 展示名，如 "SHA-256"
    public var label: String {
        switch self {
        case .md5: "MD5"
        case .sha1: "SHA-1"
        case .sha224: "SHA-224"
        case .sha256: "SHA-256"
        case .sha384: "SHA-384"
        case .sha512: "SHA-512"
        case .sha3_256: "SHA3-256"
        case .sha3_512: "SHA3-512"
        case .keccak256: "Keccak-256"
        case .sm3: "SM3"
        case .crc32: "CRC32"
        case .xxhash64: "xxHash64"
        case .blake3: "BLAKE3"
        }
    }

    public var digestSize: Int { type.digestSize }

    /// HMAC 分组长度（字节）
    public var blockSize: Int { type.blockSize }

    /// 不安全 / 只适合做校验
    public var isWeak: Bool { [.md5, .sha1, .crc32, .xxhash64].contains(self) }

    /// 能否用作 HMAC 的底层哈希（非加密校验和不行）
    public var supportsHMAC: Bool { ![.crc32, .xxhash64, .blake3].contains(self) }

    var type: any StreamingHash.Type {
        switch self {
        case .md5: MD5.self
        case .sha1: SHA1.self
        case .sha224: SHA224.self
        case .sha256: SHA256.self
        case .sha384: SHA384.self
        case .sha512: SHA512.self
        case .sha3_256: SHA3_256.self
        case .sha3_512: SHA3_512.self
        case .keccak256: Keccak256.self
        case .sm3: SM3.self
        case .crc32: CRC32.self
        case .xxhash64: XXHash64.self
        case .blake3: BLAKE3.self
        }
    }
}

/// 可增量计算的任意哈希（大文件分块读取时用）
public struct HashContext: Sendable {
    public let algorithm: HashAlgorithm
    var state: any StreamingHash

    public init(_ algorithm: HashAlgorithm) {
        self.algorithm = algorithm
        self.state = algorithm.type.init()
    }

    public mutating func update(_ data: UnsafeRawBufferPointer) {
        state.update(data)
    }

    public mutating func update(_ bytes: [UInt8]) {
        bytes.withUnsafeBytes { state.update($0) }
    }

    public mutating func finalize() -> [UInt8] {
        state.finalize()
    }
}

public enum Hash {
    public static func digest(_ algorithm: HashAlgorithm, _ bytes: [UInt8]) -> [UInt8] {
        var ctx = HashContext(algorithm)
        ctx.update(bytes)
        return ctx.finalize()
    }

    /// 文本按 UTF-8 计算
    public static func digest(_ algorithm: HashAlgorithm, _ text: String) -> [UInt8] {
        digest(algorithm, Array(text.utf8))
    }

    /// 小写十六进制摘要
    public static func hex(_ algorithm: HashAlgorithm, _ bytes: [UInt8]) -> String {
        HexCodec.encode(digest(algorithm, bytes))
    }

    public static func hex(_ algorithm: HashAlgorithm, _ text: String) -> String {
        HexCodec.encode(digest(algorithm, text))
    }

    /// 一次计算多种摘要
    public static func digests(_ algorithms: [HashAlgorithm], _ bytes: [UInt8]) -> [HashAlgorithm: [UInt8]] {
        var out: [HashAlgorithm: [UInt8]] = [:]
        for a in algorithms { out[a] = digest(a, bytes) }
        return out
    }
}
