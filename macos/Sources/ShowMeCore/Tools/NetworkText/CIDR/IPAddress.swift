import Foundation

// IPv4 / IPv6 子网计算（纯函数）。IPv4 用 UInt32 表示，IPv6 用两个 UInt64；出错时抛出双语 IPError。

public struct IPError: Error, Sendable, Hashable {
    public var message: LocalizedText

    public init(_ zh: String, _ en: String) {
        message = LocalizedText(zh, en)
    }

    public init(_ message: LocalizedText) {
        self.message = message
    }
}

/// 地址用途标签
public struct IPAddressTag: Sendable, Hashable {
    public var id: String
    public var label: LocalizedText
    /// 说明，含 RFC 出处
    public var detail: LocalizedText

    init(_ id: String, _ label: LocalizedText, _ detail: LocalizedText) {
        self.id = id
        self.label = label
        self.detail = detail
    }
}

public enum IPv4 {
    /// 中文输入法常见的全角字符转半角：１９２。１６８．１．１／２４ → 192.168.1.1/24
    public static func normalizeInput(_ input: String) -> String {
        input.precomposedStringWithCompatibilityMapping
            .replacingOccurrences(of: "\u{3002}", with: ".")
            .replacingOccurrences(of: "\u{FF61}", with: ".")
    }

    /// 严格解析点分十进制 IPv4；拒绝前导零（010 可能被当成八进制）
    public static func parse(_ input: String) throws -> UInt32 {
        let s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { throw IPError("请输入 IPv4 地址", "Enter an IPv4 address") }
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        if parts.count != 4 {
            throw IPError("IPv4 地址应为 4 段、用点分隔（如 192.168.1.10），「\(s)」有 \(parts.count) 段",
                          "An IPv4 address has 4 dot-separated parts (e.g. 192.168.1.10); “\(s)” has \(parts.count)")
        }
        var n: UInt32 = 0
        for (i, p) in parts.enumerated() {
            let k = i + 1
            if p.isEmpty { throw IPError("第 \(k) 段为空（「\(s)」）", "Part \(k) is empty (“\(s)”)") }
            guard p.unicodeScalars.allSatisfy(Curl.isDigit) else {
                throw IPError("第 \(k) 段「\(p)」不是十进制数字", "Part \(k) “\(p)” is not a decimal number")
            }
            let trimmed = p.drop { $0 == "0" }
            if p.count > 1, p.hasPrefix("0") {
                let plain = trimmed.isEmpty ? "0" : String(trimmed)
                throw IPError("第 \(k) 段「\(p)」有前导零，可能被解析为八进制，请写成 \(plain)",
                              "Part \(k) “\(p)” has a leading zero and may be read as octal; write it as \(plain)")
            }
            guard p.count <= 3, let v = UInt32(p), v <= 255 else {
                throw IPError("第 \(k) 段 \(p) 超出范围（每段应为 0–255）", "Part \(k) \(p) is out of range (each part is 0–255)")
            }
            n = n << 8 | v
        }
        return n
    }

    public static func string(_ n: UInt32) -> String {
        "\(n >> 24).\(n >> 16 & 255).\(n >> 8 & 255).\(n & 255)"
    }

    public static func mask(prefix: Int) -> UInt32 {
        prefix <= 0 ? 0 : prefix >= 32 ? .max : UInt32.max << UInt32(32 - prefix)
    }

    /// 连续的子网掩码 → 前缀长度；不连续返回 nil
    public static func prefix(ofMask mask: UInt32) -> Int? {
        let inv = ~mask
        // 反码 + 1 必须是 2 的幂（即反码形如 0…01…1）
        if inv & (inv &+ 1) != 0 { return nil }
        return inv.leadingZeroBitCount
    }

    public static func binary(_ n: UInt32) -> String {
        let s = String(n, radix: 2)
        return String(repeating: "0", count: 32 - s.count) + s
    }

    /// 按 8 位一组用点分隔的二进制
    public static func dottedBinary(_ n: UInt32) -> String {
        let b = Array(binary(n))
        return stride(from: 0, to: 32, by: 8).map { String(b[$0..<($0 + 8)]) }.joined(separator: ".")
    }

    public static func hex(_ n: UInt32) -> String {
        let s = String(n, radix: 16, uppercase: true)
        return "0x" + String(repeating: "0", count: 8 - s.count) + s
    }

    /// 反向解析域名：10.1.168.192.in-addr.arpa
    public static func reverseDNS(_ n: UInt32) -> String {
        string(n).split(separator: ".").reversed().joined(separator: ".") + ".in-addr.arpa"
    }

    /// IPv4 映射的 IPv6 地址：::ffff:192.168.1.10
    public static func mapped(_ n: UInt32) -> String { "::ffff:" + string(n) }

    public enum PrefixSource: Sendable, Hashable { case cidr, mask, wildcard, none }

    public struct Input: Sendable, Hashable {
        public var ip: UInt32
        public var prefix: Int
        public var via: PrefixSource
    }

    static func parsePrefix(_ s: String, max: Int) throws -> Int {
        guard (1...3).contains(s.count), s.unicodeScalars.allSatisfy(Curl.isDigit), let p = Int(s) else {
            throw IPError("前缀长度「\(s)」应为 0–\(max) 的整数", "The prefix length “\(s)” must be an integer from 0 to \(max)")
        }
        if p > max { throw IPError("前缀长度 /\(p) 超出范围（应为 0–\(max)）", "The prefix /\(p) is out of range (0–\(max))") }
        return p
    }

    static func parseMaskOrWildcard(_ s: String) throws -> (Int, PrefixSource) {
        let m: UInt32
        do {
            m = try parse(s)
        } catch let e as IPError {
            throw IPError("掩码「\(s)」无效：\(e.message.zh)", "Invalid mask “\(s)”: \(e.message.en)")
        }
        if let p = prefix(ofMask: m) { return (p, .mask) }
        if let p = prefix(ofMask: ~m) { return (p, .wildcard) }
        throw IPError("「\(s)」既不是连续的子网掩码（如 255.255.255.0），也不是反掩码（如 0.0.0.255）",
                      "“\(s)” is neither a contiguous subnet mask (like 255.255.255.0) nor a wildcard mask (like 0.0.0.255)")
    }

    /// 解析前缀写法：24、/24、255.255.255.0、0.0.0.255
    public static func parsePrefixOrMask(_ s: String) throws -> (prefix: Int, via: PrefixSource) {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.hasPrefix("/") { t = String(t.dropFirst()).trimmingCharacters(in: .whitespaces) }
        if t.contains(".") { return try parseMaskOrWildcard(t) }
        return (try parsePrefix(t, max: 32), .cidr)
    }

    /// 解析 IPv4 输入：192.168.1.10/24、192.168.1.10/255.255.255.0、192.168.1.10 255.255.255.0（掩码）、
    /// 10.0.0.1 0.0.0.255（反掩码）、单个 IP（按 /32）。0.0.0.0 与 255.255.255.255 优先按子网掩码理解。
    public static func parseInput(_ input: String) throws -> Input {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { throw IPError("请输入 IPv4 地址，如 192.168.1.10/24", "Enter an IPv4 address, e.g. 192.168.1.10/24") }
        if let slash = s.firstIndex(of: "/") {
            let ip = try parse(String(s[..<slash]))
            let rest = s[s.index(after: slash)...].trimmingCharacters(in: .whitespaces)
            if rest.isEmpty { throw IPError("「/」后缺少前缀长度或掩码", "Missing prefix length or mask after “/”") }
            if rest.contains(".") {
                let (p, via) = try parseMaskOrWildcard(rest)
                return Input(ip: ip, prefix: p, via: via)
            }
            return Input(ip: ip, prefix: try parsePrefix(rest, max: 32), via: .cidr)
        }
        s = s.replacingOccurrences(of: ",", with: " ")
        let parts = s.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !parts.isEmpty else { throw IPError("请输入 IPv4 地址，如 192.168.1.10/24", "Enter an IPv4 address, e.g. 192.168.1.10/24") }
        if parts.count > 2 { throw IPError("格式应为「IP/前缀」「IP 掩码」或「IP 反掩码」", "Use “IP/prefix”, “IP mask” or “IP wildcard”") }
        let ip = try parse(parts[0])
        if parts.count == 1 { return Input(ip: ip, prefix: 32, via: .none) }
        let (p, via) = try parseMaskOrWildcard(parts[1])
        return Input(ip: ip, prefix: p, via: via)
    }

    static let specialRanges: [(net: UInt32, prefix: Int, tag: IPAddressTag)] = {
        func t(_ net: String, _ prefix: Int, _ id: String, _ label: LocalizedText, _ zh: String, _ en: String) -> (UInt32, Int, IPAddressTag) {
            ((try? parse(net)) ?? 0, prefix, IPAddressTag(id, label, LocalizedText(zh, en)))
        }
        let privateLabel = LocalizedText("私有", "Private")
        let docLabel = LocalizedText("文档示例", "Documentation")
        let reserved = LocalizedText("保留", "Reserved")
        return [
            t("255.255.255.255", 32, "broadcast", LocalizedText("受限广播", "Limited broadcast"), "本网段广播地址（RFC 919）", "Limited broadcast address (RFC 919)"),
            t("0.0.0.0", 8, "this-network", LocalizedText("本网络", "This network"), "0.0.0.0/8「本网络」，不可作为目的地址（RFC 1122）", "0.0.0.0/8 “this network”, not valid as a destination (RFC 1122)"),
            t("10.0.0.0", 8, "private", privateLabel, "私有地址 10.0.0.0/8（RFC 1918）", "Private range 10.0.0.0/8 (RFC 1918)"),
            t("172.16.0.0", 12, "private", privateLabel, "私有地址 172.16.0.0/12（RFC 1918）", "Private range 172.16.0.0/12 (RFC 1918)"),
            t("192.168.0.0", 16, "private", privateLabel, "私有地址 192.168.0.0/16（RFC 1918）", "Private range 192.168.0.0/16 (RFC 1918)"),
            t("100.64.0.0", 10, "cgnat", LocalizedText("CGNAT", "CGNAT"), "运营商级 NAT 共享地址 100.64.0.0/10（RFC 6598）", "Carrier-grade NAT shared space 100.64.0.0/10 (RFC 6598)"),
            t("127.0.0.0", 8, "loopback", LocalizedText("回环", "Loopback"), "本机回环地址 127.0.0.0/8（RFC 1122）", "Loopback 127.0.0.0/8 (RFC 1122)"),
            t("169.254.0.0", 16, "link-local", LocalizedText("链路本地", "Link-local"), "无 DHCP 时自动分配的链路本地地址（RFC 3927）", "Link-local address self-assigned without DHCP (RFC 3927)"),
            t("192.0.0.0", 24, "reserved", reserved, "IETF 协议分配 192.0.0.0/24（RFC 6890）", "IETF protocol assignments 192.0.0.0/24 (RFC 6890)"),
            t("192.0.2.0", 24, "documentation", docLabel, "TEST-NET-1，仅用于文档示例（RFC 5737）", "TEST-NET-1, for documentation only (RFC 5737)"),
            t("198.51.100.0", 24, "documentation", docLabel, "TEST-NET-2，仅用于文档示例（RFC 5737）", "TEST-NET-2, for documentation only (RFC 5737)"),
            t("203.0.113.0", 24, "documentation", docLabel, "TEST-NET-3，仅用于文档示例（RFC 5737）", "TEST-NET-3, for documentation only (RFC 5737)"),
            t("192.88.99.0", 24, "reserved", reserved, "已废弃的 6to4 中继任播地址（RFC 7526）", "Deprecated 6to4 relay anycast (RFC 7526)"),
            t("198.18.0.0", 15, "benchmark", LocalizedText("基准测试", "Benchmarking"), "网络设备基准测试专用（RFC 2544）", "Reserved for network device benchmarking (RFC 2544)"),
            t("224.0.0.0", 4, "multicast", LocalizedText("组播", "Multicast"), "D 类组播地址 224.0.0.0/4（RFC 5771）", "Class D multicast 224.0.0.0/4 (RFC 5771)"),
            t("240.0.0.0", 4, "reserved", reserved, "E 类保留地址 240.0.0.0/4（RFC 1112）", "Class E reserved 240.0.0.0/4 (RFC 1112)"),
        ]
    }()

    static let publicTag = IPAddressTag("public", LocalizedText("公网", "Public"), LocalizedText("可在互联网上路由的公网地址", "Publicly routable on the internet"))

    /// 地址用途标签（取第一个匹配的特殊网段，都不匹配则为公网）
    public static func tags(_ ip: UInt32) -> [IPAddressTag] {
        let hit = specialRanges.first { ip & mask(prefix: $0.prefix) == $0.net & mask(prefix: $0.prefix) }
        return [hit?.tag ?? publicTag]
    }

    /// 传统分类：A–E 与说明
    public static func addressClass(_ ip: UInt32) -> (cls: String, note: LocalizedText) {
        let a = ip >> 24
        if a < 128 { return ("A", LocalizedText("默认掩码 /8", "default mask /8")) }
        if a < 192 { return ("B", LocalizedText("默认掩码 /16", "default mask /16")) }
        if a < 224 { return ("C", LocalizedText("默认掩码 /24", "default mask /24")) }
        if a < 240 { return ("D", LocalizedText("组播", "multicast")) }
        return ("E", LocalizedText("实验 / 保留", "experimental / reserved"))
    }

    public struct Info: Sendable, Hashable {
        public var ip: UInt32
        public var prefix: Int
        public var mask: UInt32
        public var wildcard: UInt32
        public var network: UInt32
        public var broadcast: UInt32
        /// 首个 / 最后一个可用主机（/31 为两端，/32 为地址本身）
        public var first: UInt32
        public var last: UInt32
        public var total: UInt64
        public var usable: UInt64
        /// 相邻的同尺寸子网；越界为 nil
        public var previous: UInt32?
        public var next: UInt32?
        public var cidr: String { "\(IPv4.string(network))/\(prefix)" }
    }

    public static func info(_ ip: UInt32, prefix: Int) -> Info {
        let p = min(32, max(0, prefix))
        let m = mask(prefix: p)
        let network = ip & m
        let broadcast = network | ~m
        let total = UInt64(1) << UInt64(32 - p)
        var first = network
        var last = broadcast
        var usable = total
        if p <= 30 {
            first = network + 1
            last = broadcast - 1
            usable = total - 2
        }
        let prev: UInt32? = UInt64(network) >= total ? UInt32(UInt64(network) - total) : nil
        let next: UInt32? = UInt64(network) + total < (UInt64(1) << 32) ? UInt32(UInt64(network) + total) : nil
        return Info(ip: ip, prefix: p, mask: m, wildcard: ~m, network: network, broadcast: broadcast,
                    first: first, last: last, total: total, usable: usable, previous: prev, next: next)
    }

    /// 划分 N 个子网所需的新前缀（向上取到 2 的幂）
    public static func prefix(forSubnetCount count: Int, from prefix: Int) throws -> Int {
        if count < 1 { throw IPError("子网数量应为正整数", "The subnet count must be a positive integer") }
        var extra = 0
        while extra < 40, (1 << extra) < count { extra += 1 }
        let p = prefix + extra
        if p > 32 {
            let maxCount = formatGrouped(UInt64(1) << UInt64(32 - prefix))
            throw IPError("/\(prefix) 最多只能划分为 \(maxCount) 个子网", "/\(prefix) can be split into at most \(maxCount) subnets")
        }
        return p
    }

    /// 每个子网至少容纳 hosts 台主机所需的前缀（/31、/32 按 RFC 3021 处理）
    public static func prefix(forHostCount hosts: Int, from prefix: Int) throws -> Int {
        if hosts < 1 { throw IPError("主机数应为正整数", "The host count must be a positive integer") }
        var p: Int
        if hosts == 1 {
            p = 32
        } else if hosts == 2 {
            p = 31
        } else {
            var bits = 0
            while bits < 40, (UInt64(1) << UInt64(bits)) < UInt64(hosts) + 2 { bits += 1 }
            p = 32 - bits
        }
        if p < prefix {
            let cap = formatGrouped(info(0, prefix: prefix).usable)
            let h = formatGrouped(UInt64(hosts))
            throw IPError("每个子网需要 \(h) 台主机，超出 /\(prefix) 的容量（\(cap) 台）", "\(h) hosts per subnet exceeds the capacity of /\(prefix) (\(cap) hosts)")
        }
        return p
    }

    public struct Subnet: Sendable, Hashable {
        public var network: UInt32
        public var prefix: Int
        public var first: UInt32
        public var last: UInt32
        public var broadcast: UInt32
        public var usable: UInt64
    }

    /// 把 network/prefix 均分为 /newPrefix 的子网，最多返回 limit 行
    public static func split(_ network: UInt32, prefix: Int, into newPrefix: Int, limit: Int = 256) throws -> (total: UInt64, rows: [Subnet]) {
        if newPrefix < prefix || newPrefix > 32 {
            throw IPError("新前缀应在 /\(prefix) 到 /32 之间", "The new prefix must be between /\(prefix) and /32")
        }
        let base = network & mask(prefix: prefix)
        let total = UInt64(1) << UInt64(newPrefix - prefix)
        let size = UInt64(1) << UInt64(32 - newPrefix)
        var rows: [Subnet] = []
        let n = min(total, UInt64(max(0, limit)))
        var i: UInt64 = 0
        while i < n {
            let net = UInt32(truncatingIfNeeded: UInt64(base) + i * size)
            let x = info(net, prefix: newPrefix)
            rows.append(Subnet(network: net, prefix: newPrefix, first: x.first, last: x.last, broadcast: x.broadcast, usable: x.usable))
            i += 1
        }
        return (total, rows)
    }

    /// IP 范围 → 最少的 CIDR 块
    public static func rangeToCIDRs(_ start: UInt32, _ end: UInt32) throws -> [(network: UInt32, prefix: Int)] {
        if start > end { throw IPError("起始地址不能大于结束地址", "The start address can't be greater than the end address") }
        var out: [(UInt32, Int)] = []
        var cur = UInt64(start)
        let e = UInt64(end)
        while cur <= e {
            var bits: UInt64 = 0
            while bits < 32, cur % (UInt64(1) << (bits + 1)) == 0, cur + (UInt64(1) << (bits + 1)) - 1 <= e { bits += 1 }
            out.append((UInt32(cur), 32 - Int(bits)))
            cur += UInt64(1) << bits
        }
        return out
    }

    /// 「a.b.c.d - e.f.g.h」形式的范围；不是范围返回 nil
    public static func parseRange(_ input: String) throws -> (start: UInt32, end: UInt32)? {
        let s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let re = try? NSRegularExpression(pattern: "^(\\S+)\\s*[-\u{2013}~]\\s*(\\S+)$"),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
              let r1 = Range(m.range(at: 1), in: s), let r2 = Range(m.range(at: 2), in: s) else { return nil }
        let a = String(s[r1])
        let b = String(s[r2])
        guard a.contains("."), b.contains(".") else { return nil }
        let start = try parse(a)
        let end = try parse(b)
        if start > end { throw IPError("起始地址 \(a) 大于结束地址 \(b)", "The start address \(a) is greater than the end address \(b)") }
        return (start, end)
    }

    /// 千分位：1234567 → 1,234,567
    public static func formatGrouped(_ n: UInt64) -> String {
        groupDigits(String(n))
    }

    static func groupDigits(_ digits: String) -> String {
        let chars = Array(digits)
        var out = ""
        for (i, c) in chars.enumerated() {
            if i > 0, (chars.count - i) % 3 == 0 { out += "," }
            out.append(c)
        }
        return out
    }
}

// MARK: - IPv6

public struct IPv6Address: Sendable, Hashable, Comparable {
    public var hi: UInt64
    public var lo: UInt64

    public init(hi: UInt64, lo: UInt64) {
        self.hi = hi
        self.lo = lo
    }

    public init(groups: [UInt16]) {
        var h: UInt64 = 0
        var l: UInt64 = 0
        for (i, g) in groups.prefix(8).enumerated() {
            if i < 4 { h = h << 16 | UInt64(g) } else { l = l << 16 | UInt64(g) }
        }
        hi = h
        lo = l
    }

    public static let zero = IPv6Address(hi: 0, lo: 0)
    public static let max = IPv6Address(hi: .max, lo: .max)

    public var groups: [UInt16] {
        (0..<8).map { i in
            let word = i < 4 ? hi : lo
            return UInt16(truncatingIfNeeded: word >> UInt64(48 - 16 * (i % 4)))
        }
    }

    public static func mask(prefix: Int) -> IPv6Address {
        let p = Swift.min(128, Swift.max(0, prefix))
        if p == 0 { return .zero }
        if p <= 64 { return IPv6Address(hi: UInt64.max << UInt64(64 - p), lo: 0) }
        return IPv6Address(hi: .max, lo: p == 128 ? .max : UInt64.max << UInt64(128 - p))
    }

    public static func & (a: IPv6Address, b: IPv6Address) -> IPv6Address { IPv6Address(hi: a.hi & b.hi, lo: a.lo & b.lo) }
    public static func | (a: IPv6Address, b: IPv6Address) -> IPv6Address { IPv6Address(hi: a.hi | b.hi, lo: a.lo | b.lo) }
    public static prefix func ~ (a: IPv6Address) -> IPv6Address { IPv6Address(hi: ~a.hi, lo: ~a.lo) }
    public static func < (a: IPv6Address, b: IPv6Address) -> Bool { a.hi != b.hi ? a.hi < b.hi : a.lo < b.lo }

    public func isIn(_ net: IPv6Address, prefix: Int) -> Bool {
        let m = IPv6Address.mask(prefix: prefix)
        return self & m == net & m
    }

    /// 完整格式：8 组、每组 4 位、小写
    public var expanded: String {
        groups.map { CodeEscape.hex(UInt32($0), 4) }.joined(separator: ":")
    }

    /// 32 个十六进制半字节
    public var nibbles: String { groups.map { CodeEscape.hex(UInt32($0), 4) }.joined() }

    /// 二进制：16 位一组，冒号分隔
    public var binary: String {
        groups.map { g -> String in
            let s = String(g, radix: 2)
            return String(repeating: "0", count: 16 - s.count) + s
        }.joined(separator: ":")
    }

    static let wellKnownNAT64 = IPv6Address(hi: 0x0064_ff9b_0000_0000, lo: 0)
    static let mappedPrefix = IPv6Address(hi: 0, lo: 0x0000_ffff_0000_0000)

    /// RFC 5952 规范压缩格式：去前导零、最长（≥2 组）的 0 串换成 ::、小写；IPv4 映射用混合写法
    public var compressed: String {
        let g = groups
        let mixed = isIn(Self.mappedPrefix, prefix: 96) || isIn(Self.wellKnownNAT64, prefix: 96)
        let hexGroups = mixed ? Array(g[0..<6]) : g
        var bestStart = -1
        var bestLen = 0
        var i = 0
        while i < hexGroups.count {
            if hexGroups[i] != 0 {
                i += 1
                continue
            }
            var j = i
            while j < hexGroups.count, hexGroups[j] == 0 { j += 1 }
            if j - i > bestLen, j - i >= 2 {
                bestStart = i
                bestLen = j - i
            }
            i = j
        }
        let hex = hexGroups.map { String($0, radix: 16) }
        var out: String
        if bestStart < 0 {
            out = hex.joined(separator: ":")
        } else {
            out = hex[0..<bestStart].joined(separator: ":") + "::" + hex[(bestStart + bestLen)...].joined(separator: ":")
        }
        if mixed {
            let v4 = IPv4.string(UInt32(truncatingIfNeeded: lo))
            out = out.hasSuffix("::") ? out + v4 : out + ":" + v4
        }
        return out
    }

    /// 反向解析域名（按半字节倒序）；传入前缀时只取前缀覆盖的完整半字节（用于委派区域）
    public func reverseDNS(prefix: Int = 128) -> String {
        let n = Array(nibbles.prefix(Swift.max(0, Swift.min(128, prefix)) / 4))
        return (n.reversed().map(String.init) + ["ip6.arpa"]).joined(separator: ".")
    }
}

public enum IPv6 {
    /// 解析 IPv6（支持 ::、内嵌 IPv4、%zone、[方括号]）
    public static func parse(_ input: String) throws -> (address: IPv6Address, zone: String?) {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { throw IPError("请输入 IPv6 地址", "Enter an IPv6 address") }
        if s.hasPrefix("["), let close = s.firstIndex(of: "]"), close != s.index(before: s.endIndex) {
            let tail = s[s.index(after: close)...]
            if tail.hasPrefix(":"), tail.dropFirst().allSatisfy({ $0.isASCII && $0.isNumber }) {
                throw IPError("地址后面带了端口号「\(tail)」，请去掉端口，只保留方括号里的地址",
                              "The address ends with a port “\(tail)”; remove it and keep only the address in brackets")
            }
        }
        if s.hasPrefix("["), s.hasSuffix("]") { s = String(s.dropFirst().dropLast()) }
        var zone: String?
        if let pct = s.firstIndex(of: "%") {
            zone = String(s[s.index(after: pct)...])
            s = String(s[..<pct])
            if zone?.isEmpty ?? true { throw IPError("「%」后缺少区域 ID（如 %eth0）", "Missing zone ID after “%” (e.g. %eth0)") }
        }
        if !s.contains(":") { throw IPError("「\(s)」不含冒号，不是 IPv6 地址", "“\(s)” has no colon, so it isn't an IPv6 address") }
        if s.components(separatedBy: "::").count > 2 { throw IPError("「::」在一个地址里只能出现一次", "“::” can appear only once in an address") }
        if s.contains(":::") { throw IPError("出现了连续三个冒号「:::」", "Found three colons in a row “:::”") }

        var v4Tail: [UInt16] = []
        if let lastColon = s.lastIndex(of: ":") {
            let tail = String(s[s.index(after: lastColon)...])
            if tail.contains(".") {
                let v4: UInt32
                do {
                    v4 = try IPv4.parse(tail)
                } catch let e as IPError {
                    throw IPError("末尾内嵌的 IPv4「\(tail)」无效：\(e.message.zh)", "The embedded IPv4 “\(tail)” is invalid: \(e.message.en)")
                }
                v4Tail = [UInt16(v4 >> 16), UInt16(v4 & 0xFFFF)]
                // 去掉 IPv4 部分，保留「::」或去掉末尾单个冒号
                s = String(s[...lastColon])
                if !s.hasSuffix("::") { s.removeLast() }
            }
        }

        func parseGroups(_ part: String, withIndex: Bool) throws -> [UInt16] {
            if part.isEmpty { return [] }
            return try part.split(separator: ":", omittingEmptySubsequences: false).enumerated().map { i, g in
                if g.isEmpty { throw IPError("存在空的分组（单个冒号开头 / 结尾，或连续冒号）", "Empty group (a single colon at the start or end, or consecutive colons)") }
                guard (1...4).contains(g.count), let v = UInt16(g, radix: 16), g.allSatisfy(\.isHexDigit) else {
                    if withIndex { throw IPError("第 \(i + 1) 组「\(g)」不是 1–4 位十六进制数", "Group \(i + 1) “\(g)” is not 1–4 hex digits") }
                    throw IPError("分组「\(g)」不是 1–4 位十六进制数", "Group “\(g)” is not 1–4 hex digits")
                }
                return v
            }
        }

        let slots = 8 - v4Tail.count
        var groups: [UInt16]
        if let dbl = s.range(of: "::") {
            let head = try parseGroups(String(s[..<dbl.lowerBound]), withIndex: true)
            let tail = try parseGroups(String(s[dbl.upperBound...]), withIndex: false)
            if head.count + tail.count >= slots {
                let n = head.count + tail.count + v4Tail.count
                throw IPError("「::」至少要代表一组 0，但地址已有 \(n) 组", "“::” must stand for at least one zero group, but the address already has \(n) groups")
            }
            groups = head + Array(repeating: 0, count: slots - head.count - tail.count) + tail
        } else {
            groups = try parseGroups(s, withIndex: true)
            if groups.count != slots {
                let n = groups.count + v4Tail.count
                throw IPError("IPv6 地址应有 8 组（每组 1–4 位十六进制），当前 \(n) 组；可用「::」省略连续的 0",
                              "An IPv6 address needs 8 groups of 1–4 hex digits, but has \(n); use “::” to skip consecutive zeros")
            }
        }
        return (IPv6Address(groups: groups + v4Tail), zone)
    }

    public struct Input: Sendable, Hashable {
        public var address: IPv6Address
        public var prefix: Int
        public var zone: String?
        /// 是否写了前缀（没写按 /128）
        public var hasPrefix: Bool
    }

    public static func parseInput(_ input: String) throws -> Input {
        let s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let slash = s.lastIndex(of: "/") else {
            let a = try parse(s)
            return Input(address: a.address, prefix: 128, zone: a.zone, hasPrefix: false)
        }
        let a = try parse(String(s[..<slash]))
        let rest = s[s.index(after: slash)...].trimmingCharacters(in: .whitespaces)
        if rest.isEmpty { throw IPError("「/」后缺少前缀长度", "Missing prefix length after “/”") }
        return Input(address: a.address, prefix: try IPv4.parsePrefix(rest, max: 128), zone: a.zone, hasPrefix: true)
    }

    static func v6(_ s: String) -> IPv6Address { (try? parse(s).address) ?? .zero }

    static let rules: [(net: IPv6Address, prefix: Int, tag: IPAddressTag)] = {
        func t(_ net: String, _ prefix: Int, _ id: String, _ label: LocalizedText, _ zh: String, _ en: String) -> (IPv6Address, Int, IPAddressTag) {
            (v6(net), prefix, IPAddressTag(id, label, LocalizedText(zh, en)))
        }
        let loopback = LocalizedText("回环", "Loopback")
        let nat64 = LocalizedText("NAT64", "NAT64")
        let doc = LocalizedText("文档示例", "Documentation")
        return [
            t("::", 128, "unspecified", LocalizedText("未指定", "Unspecified"), "未指定地址 ::（RFC 4291）", "Unspecified address :: (RFC 4291)"),
            t("::1", 128, "loopback", loopback, "本机回环地址 ::1（RFC 4291）", "Loopback ::1 (RFC 4291)"),
            t("::ffff:0:0", 96, "ipv4-mapped", LocalizedText("IPv4 映射", "IPv4-mapped"), "IPv4 映射地址 ::ffff:0:0/96（RFC 4291）", "IPv4-mapped address ::ffff:0:0/96 (RFC 4291)"),
            t("64:ff9b::", 96, "nat64", nat64, "IPv4/IPv6 转换知名前缀 64:ff9b::/96（RFC 6052）", "Well-known IPv4/IPv6 translation prefix 64:ff9b::/96 (RFC 6052)"),
            t("64:ff9b:1::", 48, "nat64", nat64, "本地使用的 IPv4/IPv6 转换前缀（RFC 8215）", "Local-use IPv4/IPv6 translation prefix (RFC 8215)"),
            t("100::", 64, "discard", LocalizedText("丢弃", "Discard"), "仅丢弃前缀 100::/64（RFC 6666）", "Discard-only prefix 100::/64 (RFC 6666)"),
            t("2001:db8::", 32, "documentation", doc, "文档示例地址 2001:db8::/32（RFC 3849）", "Documentation prefix 2001:db8::/32 (RFC 3849)"),
            t("3fff::", 20, "documentation", doc, "文档示例地址 3fff::/20（RFC 9637）", "Documentation prefix 3fff::/20 (RFC 9637)"),
            t("2001::", 32, "teredo", LocalizedText("Teredo", "Teredo"), "Teredo 隧道地址 2001::/32（RFC 4380）", "Teredo tunneling 2001::/32 (RFC 4380)"),
            t("2002::", 16, "6to4", LocalizedText("6to4", "6to4"), "6to4 隧道地址 2002::/16（RFC 3056）", "6to4 tunneling 2002::/16 (RFC 3056)"),
            t("fc00::", 7, "ula", LocalizedText("唯一本地", "Unique local"), "唯一本地地址 ULA fc00::/7，相当于 IPv6 的私有地址（RFC 4193）", "Unique local address fc00::/7, the IPv6 counterpart of private space (RFC 4193)"),
            t("fe80::", 10, "link-local", LocalizedText("链路本地", "Link-local"), "链路本地地址 fe80::/10（RFC 4291）", "Link-local fe80::/10 (RFC 4291)"),
            t("fec0::", 10, "site-local", LocalizedText("站点本地（已废弃）", "Site-local (deprecated)"), "站点本地地址 fec0::/10，已被 RFC 3879 废弃", "Site-local fec0::/10, deprecated by RFC 3879"),
            t("ff00::", 8, "multicast", LocalizedText("组播", "Multicast"), "组播地址 ff00::/8（RFC 4291）", "Multicast ff00::/8 (RFC 4291)"),
            t("2000::", 3, "global", LocalizedText("全球单播", "Global unicast"), "全球单播地址 2000::/3，即 IPv6 公网地址", "Global unicast 2000::/3, i.e. public IPv6 space"),
        ]
    }()

    static let reservedTag = IPAddressTag("reserved", LocalizedText("保留", "Reserved"), LocalizedText("IANA 尚未分配用途的地址空间", "Space not yet allocated by IANA"))

    static let multicastScopes: [Int: LocalizedText] = [
        1: LocalizedText("接口本地", "Interface-local"), 2: LocalizedText("链路本地", "Link-local"),
        3: LocalizedText("领域本地", "Realm-local"), 4: LocalizedText("管理本地", "Admin-local"),
        5: LocalizedText("站点本地", "Site-local"), 8: LocalizedText("组织本地", "Organization-local"),
        14: LocalizedText("全球", "Global"),
    ]

    public static func tags(_ v: IPv6Address) -> [IPAddressTag] {
        guard let hit = rules.first(where: { v.isIn($0.net, prefix: $0.prefix) }) else { return [reservedTag] }
        if hit.tag.id == "multicast" {
            let scope = Int(v.hi >> 48 & 0xF)
            if let name = multicastScopes[scope] {
                let hex = String(scope, radix: 16)
                return [hit.tag, IPAddressTag("scope", LocalizedText("\(name.zh)范围", "\(name.en) scope"),
                                              LocalizedText("组播范围字段 = \(hex)", "Multicast scope field = \(hex)"))]
            }
        }
        return [hit.tag]
    }

    public struct Info: Sendable, Hashable {
        public var address: IPv6Address
        public var prefix: Int
        public var network: IPv6Address
        public var last: IPv6Address
        /// 主机位数：地址总数 = 2^hostBits
        public var hostBits: Int { 128 - prefix }
        public var cidr: String { "\(network.compressed)/\(prefix)" }
    }

    public static func info(_ v: IPv6Address, prefix: Int) -> Info {
        let p = min(128, max(0, prefix))
        let m = IPv6Address.mask(prefix: p)
        let network = v & m
        return Info(address: v, prefix: p, network: network, last: network | ~m)
    }

    /// 2^bits 的精确十进制（千分位）
    public static func pow2(_ bits: Int) -> String {
        var digits: [UInt8] = [1]
        for _ in 0..<max(0, bits) {
            var carry: UInt8 = 0
            for i in 0..<digits.count {
                let d = digits[i] * 2 + carry
                digits[i] = d % 10
                carry = d / 10
            }
            if carry > 0 { digits.append(carry) }
        }
        return IPv4.groupDigits(String(digits.reversed().map { Character(String($0)) }))
    }

    /// 2^n 的简写：不超过 2^20 给出精确数字，否则写成 2ⁿ
    public static func pow2Short(_ bits: Int) -> String {
        if bits <= 20 { return pow2(bits) }
        let sup = Array("⁰¹²³⁴⁵⁶⁷⁸⁹")
        return "2" + String(String(bits).compactMap { $0.wholeNumberValue.map { sup[$0] } })
    }
}
