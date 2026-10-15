import Foundation

/// 任意精度的非负整数（小端存放的 32 位分段），只实现进制转换与时间戳需要的运算。
public struct BigUInt: Hashable, Sendable, Comparable, CustomStringConvertible {
    /// 小端分段，末尾没有多余的 0；零为空数组
    public private(set) var limbs: [UInt32]

    public init() { limbs = [] }

    public init(_ value: UInt64) {
        limbs = [UInt32(truncatingIfNeeded: value), UInt32(truncatingIfNeeded: value >> 32)]
        normalize()
    }

    public var isZero: Bool { limbs.isEmpty }

    private mutating func normalize() {
        while let last = limbs.last, last == 0 { limbs.removeLast() }
    }

    /// self = self * m + a
    public mutating func multiply(by m: UInt32, adding a: UInt32 = 0) {
        var carry = UInt64(a)
        let m64 = UInt64(m)
        for i in limbs.indices {
            let v = UInt64(limbs[i]) * m64 + carry
            limbs[i] = UInt32(truncatingIfNeeded: v)
            carry = v >> 32
        }
        if carry > 0 { limbs.append(UInt32(carry)) }
        normalize()
    }

    public mutating func add(_ a: UInt64) {
        var carry = a
        var i = 0
        while carry > 0 {
            if i == limbs.count { limbs.append(0) }
            let v = UInt64(limbs[i]) + (carry & 0xFFFF_FFFF)
            limbs[i] = UInt32(truncatingIfNeeded: v)
            carry = (carry >> 32) + (v >> 32)
            i += 1
        }
    }

    /// self -= a（调用方保证 self ≥ a）
    public mutating func subtract(_ a: UInt64) {
        var borrow = a
        var i = 0
        while borrow > 0, i < limbs.count {
            let low = borrow & 0xFFFF_FFFF
            let cur = UInt64(limbs[i])
            if cur >= low {
                limbs[i] = UInt32(cur - low)
                borrow >>= 32
            } else {
                limbs[i] = UInt32(cur + (1 << 32) - low)
                borrow = (borrow >> 32) + 1
            }
            i += 1
        }
        normalize()
    }

    /// self /= d，返回余数
    @discardableResult
    public mutating func divide(by d: UInt32) -> UInt32 {
        guard d > 0 else { return 0 }
        var rem: UInt64 = 0
        let d64 = UInt64(d)
        for i in limbs.indices.reversed() {
            let cur = (rem << 32) | UInt64(limbs[i])
            limbs[i] = UInt32(cur / d64)
            rem = cur % d64
        }
        normalize()
        return UInt32(rem)
    }

    /// 低 64 位
    public var low64: UInt64 {
        let a = limbs.first.map(UInt64.init) ?? 0
        let b = limbs.count > 1 ? UInt64(limbs[1]) : 0
        return a | (b << 32)
    }

    /// 能否放进 UInt64
    public var fitsUInt64: Bool { limbs.count <= 2 }

    /// 二进制位数（0 → 0）
    public var bitWidth: Int {
        guard let last = limbs.last else { return 0 }
        return (limbs.count - 1) * 32 + (32 - last.leadingZeroBitCount)
    }

    public var popCount: Int { limbs.reduce(0) { $0 + $1.nonzeroBitCount } }

    public var isOdd: Bool { (limbs.first ?? 0) & 1 == 1 }

    public var isPowerOfTwo: Bool { popCount == 1 }

    // MARK: 进制

    /// radix^k ≤ UInt32.max 的最大 k 与 radix^k
    private static func chunk(_ radix: Int) -> (count: Int, power: UInt32) {
        var k = 0
        var p: UInt64 = 1
        while p * UInt64(radix) <= UInt64(UInt32.max) {
            p *= UInt64(radix)
            k += 1
        }
        return (k, UInt32(p))
    }

    /// 由 0…radix-1 的数字序列（高位在前）构造；按块累加，避免逐位乘法
    public init(digits: [UInt8], radix: Int) {
        self.init()
        guard radix >= 2, radix <= 36 else { return }
        // 2 的幂进制直接按位拼接，线性时间
        if radix & (radix - 1) == 0 {
            let k = radix.trailingZeroBitCount
            var acc: UInt64 = 0
            var bits = 0
            limbs.reserveCapacity(digits.count * k / 32 + 1)
            for d in digits.reversed() {
                acc |= UInt64(d & UInt8(radix - 1)) << UInt64(bits)
                bits += k
                if bits >= 32 {
                    limbs.append(UInt32(truncatingIfNeeded: acc))
                    acc >>= 32
                    bits -= 32
                }
            }
            if bits > 0 { limbs.append(UInt32(truncatingIfNeeded: acc)) }
            normalize()
            return
        }
        let (k, _) = Self.chunk(radix)
        var i = 0
        let first = digits.count % k == 0 ? k : digits.count % k
        var take = first
        while i < digits.count {
            var value: UInt32 = 0
            var mul: UInt32 = 1
            for j in i..<min(digits.count, i + take) {
                value = value * UInt32(radix) + UInt32(digits[j] % UInt8(radix))
                mul *= UInt32(radix)
            }
            multiply(by: mul, adding: value)
            i += take
            take = k
        }
    }

    private static let digitChars: [Character] = Array("0123456789abcdefghijklmnopqrstuvwxyz")

    /// 按进制输出（小写字母）
    public func toString(radix: Int = 10) -> String {
        guard radix >= 2, radix <= 36 else { return "" }
        if isZero { return "0" }
        if radix & (radix - 1) == 0 { return powerOfTwoString(radix) }
        let (k, power) = Self.chunk(radix)
        var n = self
        var chunks: [UInt32] = []
        while !n.isZero { chunks.append(n.divide(by: power)) }
        var out = ""
        out.reserveCapacity(chunks.count * k)
        for (idx, c) in chunks.reversed().enumerated() {
            var digits: [Character] = []
            var v = c
            while v > 0 {
                digits.append(Self.digitChars[Int(v % UInt32(radix))])
                v /= UInt32(radix)
            }
            // 除最高块外，每块补足 k 位
            if idx > 0 { while digits.count < k { digits.append("0") } }
            out.append(contentsOf: digits.reversed())
        }
        return out
    }

    /// 2 的幂进制：每次取 k 位，线性时间
    private func powerOfTwoString(_ radix: Int) -> String {
        let k = radix.trailingZeroBitCount
        let width = bitWidth
        var chars: [Character] = []
        chars.reserveCapacity(width / k + 1)
        var pos = 0
        while pos < width {
            let limb = pos / 32
            let off = pos % 32
            var v = UInt64(limbs[limb]) >> UInt64(off)
            if off + k > 32, limb + 1 < limbs.count { v |= UInt64(limbs[limb + 1]) << UInt64(32 - off) }
            chars.append(Self.digitChars[Int(v & UInt64(radix - 1))])
            pos += k
        }
        return String(chars.reversed())
    }

    public var description: String { toString() }

    public static func < (a: BigUInt, b: BigUInt) -> Bool {
        if a.limbs.count != b.limbs.count { return a.limbs.count < b.limbs.count }
        for i in a.limbs.indices.reversed() where a.limbs[i] != b.limbs[i] {
            return a.limbs[i] < b.limbs[i]
        }
        return false
    }

    /// 10 的 n 次方
    public static func pow10(_ n: Int) -> BigUInt {
        var v = BigUInt(1)
        for _ in 0..<max(0, n) { v.multiply(by: 10) }
        return v
    }
}
