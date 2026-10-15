import XCTest
@testable import ShowMeCore

final class NetworkTextStatusCIDRTests: XCTestCase {
    // MARK: HTTP 状态码

    static let iana = [
        100, 101, 102, 103, 200, 201, 202, 203, 204, 205, 206, 207, 208, 226, 300, 301, 302, 303, 304,
        305, 306, 307, 308, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414,
        415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500, 501, 502, 503, 504,
        505, 506, 507, 508, 510, 511,
    ]

    func codes(_ q: String, unofficial: Bool = true, cls: Int? = nil) -> [Int] {
        HTTPStatusCatalog.search(q, includeUnofficial: unofficial, statusClass: cls).map(\.code)
    }

    func testStatusData() {
        let all = HTTPStatusCatalog.all
        XCTAssertEqual(Set(all.map(\.code)).count, all.count)
        XCTAssertEqual(all.filter { $0.flag != .unofficial }.map(\.code), Self.iana)
        for s in all {
            XCTAssertFalse(s.phrase.isEmpty)
            XCTAssertGreaterThan(s.zhDescription.count, 8)
            XCTAssertGreaterThan(s.enDescription.count, 20, "\(s.code)")
            XCTAssertFalse(s.spec.isEmpty)
            if s.flag == .unofficial { XCTAssertNotNil(s.vendor) }
        }
        XCTAssertEqual(HTTPStatusCatalog.status(413)?.phrase, "Content Too Large")
        XCTAssertEqual(HTTPStatusCatalog.status(422)?.phrase, "Unprocessable Content")
        XCTAssertEqual(HTTPStatusCatalog.status(418)?.phrase, "I'm a teapot")
        XCTAssertEqual(HTTPStatusCatalog.status(404)?.specURL, "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.5")
        XCTAssertEqual(all.filter(\.cacheable).map(\.code), [200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, 501])
        XCTAssertEqual(HTTPStatusCatalog.classOf(103), 1)
        XCTAssertEqual(HTTPStatusCatalog.classOf(526), 5)
        XCTAssertNil(HTTPStatusCatalog.status(999))
    }

    func testStatusSearch() {
        XCTAssertEqual(codes("").count, HTTPStatusCatalog.all.count)
        XCTAssertEqual(codes("  ", unofficial: false), Self.iana)
        XCTAssertEqual(codes("404"), [404])
        XCTAssertEqual(codes("40"), [400, 401, 402, 403, 404, 405, 406, 407, 408, 409])
        XCTAssertEqual(codes("1"), [100, 101, 102, 103])
        XCTAssertEqual(codes("52"), [520, 521, 522, 523, 524, 525, 526])
        XCTAssertEqual(codes("52", unofficial: false), [])
        XCTAssertEqual(codes("999"), [])
        XCTAssertEqual(codes("3xx"), [300, 301, 302, 303, 304, 305, 306, 307, 308])
        XCTAssertTrue(codes("2XX").contains(226))
        XCTAssertEqual(codes("50x"), [500, 501, 502, 503, 504, 505, 506, 507, 508])
        XCTAssertEqual(codes("41X"), [410, 411, 412, 413, 414, 415, 416, 417, 418])
        XCTAssertEqual(HTTPStatusCatalog.codeQueryPrefix("4xx"), "4")
        XCTAssertNil(HTTPStatusCatalog.codeQueryPrefix("4x"))
        XCTAssertNil(HTTPStatusCatalog.codeQueryPrefix("6xx"))
        XCTAssertNil(HTTPStatusCatalog.codeQueryPrefix("限流"))
        XCTAssertEqual(codes("not found"), [404])
        XCTAssertEqual(codes("TEAPOT"), [418])
        XCTAssertEqual(codes("茶壶"), [418])
        XCTAssertEqual(codes("限流").first, 429)
        XCTAssertEqual(codes("rate limit").first, 429)
        XCTAssertEqual(codes("websocket").first, 101)
        XCTAssertTrue(Set(codes("断点续传")).isSuperset(of: [206, 416]))
        XCTAssertTrue(Set(codes("retry-after")).isSuperset(of: [429, 503]))
        XCTAssertEqual(codes("超时").prefix(2).sorted(), [408, 504])
        XCTAssertTrue(codes("nginx 超时").contains(504))
        XCTAssertFalse(codes("nginx 超时").contains(408))
        XCTAssertEqual(codes("zzzz 不存在的词"), [])
        XCTAssertEqual(codes("", cls: 1), [100, 101, 102, 103])
        XCTAssertEqual(codes("cloudflare", unofficial: false), [103])
        XCTAssertEqual(codes("cloudflare"), [520, 521, 522, 523, 524, 525, 526, 103])
    }

    func testStatusTool() throws {
        let tool = HTTPStatusTool.spec
        let one = try tool("404")
        XCTAssertEqual(one.table?.rows, [["404", "未找到", "Not Found", "服务器找不到请求的资源。"]])
        XCTAssertEqual(one.outputs.first?.value, "404 Not Found")
        XCTAssertTrue(one.outputs.contains { $0.label == "开发建议" })
        let en = try tool("teapot", lang: .en)
        XCTAssertEqual(en.table?.columns, ["Code", "Reason phrase", "Description"])
        XCTAssertEqual(en.table?.rows.first?[1], "I'm a teapot (Reserved)")
        XCTAssertFalse(en.outputs.contains { $0.label == "开发建议" })
        let all = try tool("4xx", options: ["unofficial": "0"])
        XCTAssertEqual(all.table?.rows.count, 29)
        XCTAssertEqual(all.notes.first?.message, "共 29 个状态码")
        XCTAssertEqual(try tool("").table?.rows.count, HTTPStatusCatalog.all.count)
        let none = try tool("zzzz", lang: .en)
        XCTAssertNil(none.table)
        XCTAssertEqual(none.notes.first?.level, .warning)
        XCTAssertEqual(try tool("444").table?.rows.first?[1], "无响应（非标准（Nginx））")
    }

    // MARK: IPv4

    func ip(_ s: String) -> UInt32 { (try? IPv4.parse(s)) ?? 0 }

    func err(_ f: () throws -> Any) -> IPError? {
        do {
            _ = try f()
            return nil
        } catch {
            return error as? IPError
        }
    }

    func testNormalizeAndParse() throws {
        XCTAssertEqual(IPv4.normalizeInput("１９２。１６８．１．１／２４"), "192.168.1.1/24")
        XCTAssertEqual(IPv4.normalizeInput("２００１：ｄｂ８：：１"), "2001:db8::1")
        XCTAssertEqual(IPv4.normalizeInput("10.0.0.1\u{3000}－\u{3000}10.0.0.9"), "10.0.0.1 - 10.0.0.9")
        XCTAssertEqual(try IPv4.parseInput(IPv4.normalizeInput("１０。０。０。１ ２５５。０。０。０")).prefix, 8)
        XCTAssertEqual(ip("192.168.1.10"), 0xC0A8_010A)
        XCTAssertEqual(ip(" 255.255.255.255 "), 0xFFFF_FFFF)
        XCTAssertEqual(IPv4.string(0xC0A8_010A), "192.168.1.10")
        XCTAssertEqual(err { try IPv4.parse("") }?.message.zh, "请输入 IPv4 地址")
        XCTAssertTrue(err { try IPv4.parse("1.2.3") }?.message.zh.contains("有 3 段") ?? false)
        XCTAssertTrue(err { try IPv4.parse("1..2.3") }?.message.zh.contains("第 2 段为空") ?? false)
        XCTAssertTrue(err { try IPv4.parse("1.2.3.x") }?.message.zh.contains("第 4 段「x」不是十进制数字") ?? false)
        XCTAssertTrue(err { try IPv4.parse("1.2.3.256") }?.message.zh.contains("第 4 段 256 超出范围") ?? false)
        XCTAssertTrue(err { try IPv4.parse("192.168.010.1") }?.message.zh.contains("前导零") ?? false)
        XCTAssertEqual(err { try IPv4.parse("192.168.010.1") }?.message.en, "Part 3 “010” has a leading zero and may be read as octal; write it as 10")
        XCTAssertNotNil(err { try IPv4.parse("１.2.3.4") })
        XCTAssertNotNil(err { try IPv4.parse("99999999999999999999.1.1.1") })
    }

    func testMasks() throws {
        XCTAssertEqual(IPv4.mask(prefix: 0), 0)
        XCTAssertEqual(IPv4.mask(prefix: 24), 0xFFFF_FF00)
        XCTAssertEqual(IPv4.mask(prefix: 32), 0xFFFF_FFFF)
        for p in 0...32 { XCTAssertEqual(IPv4.prefix(ofMask: IPv4.mask(prefix: p)), p) }
        XCTAssertNil(IPv4.prefix(ofMask: ip("255.0.255.0")))
        XCTAssertNil(IPv4.prefix(ofMask: ip("0.0.0.255")))
        let cidr = try IPv4.parseInput("192.168.1.10/24")
        XCTAssertEqual(cidr.ip, ip("192.168.1.10"))
        XCTAssertEqual(cidr.prefix, 24)
        XCTAssertEqual(cidr.via, .cidr)
        XCTAssertEqual(try IPv4.parseInput("192.168.1.10 / 24").prefix, 24)
        XCTAssertEqual(try IPv4.parseInput("192.168.1.10/255.255.255.0").via, .mask)
        XCTAssertEqual(try IPv4.parseInput("172.16.5.4 255.255.240.0").prefix, 20)
        let wc = try IPv4.parseInput("10.0.0.1 0.0.0.255")
        XCTAssertEqual(wc.prefix, 24)
        XCTAssertEqual(wc.via, .wildcard)
        XCTAssertEqual(try IPv4.parseInput("10.0.0.1, 0.0.15.255").prefix, 20)
        XCTAssertEqual(try IPv4.parseInput("8.8.8.8").via, .none)
        XCTAssertEqual(try IPv4.parseInput("10.0.0.1 255.255.255.255").via, .mask)
        XCTAssertTrue(err { try IPv4.parseInput("10.0.0.1/33") }?.message.zh.contains("/33 超出范围") ?? false)
        XCTAssertTrue(err { try IPv4.parseInput("10.0.0.1/abc") }?.message.zh.contains("前缀长度「abc」") ?? false)
        XCTAssertTrue(err { try IPv4.parseInput("10.0.0.1/") }?.message.zh.contains("缺少前缀") ?? false)
        XCTAssertTrue(err { try IPv4.parseInput("10.0.0.1 255.0.255.0") }?.message.zh.contains("既不是连续的子网掩码") ?? false)
        XCTAssertTrue(err { try IPv4.parseInput("10.0.0.1 255.0.0") }?.message.zh.contains("掩码「255.0.0」无效") ?? false)
        XCTAssertTrue(err { try IPv4.parseInput("1.1.1.1 2.2.2.2 3.3.3.3") }?.message.zh.contains("格式应为") ?? false)
    }

    func testIPv4Info() {
        let i = IPv4.info(ip("192.168.1.10"), prefix: 24)
        XCTAssertEqual(IPv4.string(i.network), "192.168.1.0")
        XCTAssertEqual(IPv4.string(i.broadcast), "192.168.1.255")
        XCTAssertEqual(IPv4.string(i.first), "192.168.1.1")
        XCTAssertEqual(IPv4.string(i.last), "192.168.1.254")
        XCTAssertEqual(IPv4.string(i.wildcard), "0.0.0.255")
        XCTAssertEqual(i.total, 256)
        XCTAssertEqual(i.usable, 254)
        XCTAssertEqual(i.previous.map(IPv4.string), "192.168.0.0")
        XCTAssertEqual(i.next.map(IPv4.string), "192.168.2.0")
        let p31 = IPv4.info(ip("10.0.0.5"), prefix: 31)
        XCTAssertEqual(IPv4.string(p31.first), "10.0.0.4")
        XCTAssertEqual(p31.usable, 2)
        let p32 = IPv4.info(ip("10.0.0.5"), prefix: 32)
        XCTAssertEqual(IPv4.string(p32.last), "10.0.0.5")
        XCTAssertEqual(p32.usable, 1)
        let all = IPv4.info(ip("1.2.3.4"), prefix: 0)
        XCTAssertEqual(all.total, 1 << 32)
        XCTAssertEqual(all.usable, (1 << 32) - 2)
        XCTAssertNil(all.previous)
        XCTAssertNil(all.next)
        XCTAssertNil(IPv4.info(ip("0.0.0.1"), prefix: 24).previous)
        XCTAssertNil(IPv4.info(ip("255.255.255.1"), prefix: 24).next)
        XCTAssertEqual(IPv4.info(ip("172.20.77.9"), prefix: 19).usable, 8190)
        XCTAssertEqual(IPv4.string(IPv4.info(ip("172.20.77.9"), prefix: 19).broadcast), "172.20.95.255")
    }

    func testClassification() {
        func tag(_ a: String) -> String { IPv4.tags(ip(a))[0].id }
        XCTAssertEqual(tag("10.1.2.3"), "private")
        XCTAssertEqual(tag("172.31.255.255"), "private")
        XCTAssertEqual(tag("172.32.0.1"), "public")
        XCTAssertEqual(tag("127.0.0.1"), "loopback")
        XCTAssertEqual(tag("169.254.10.1"), "link-local")
        XCTAssertEqual(tag("100.64.0.1"), "cgnat")
        XCTAssertEqual(tag("100.128.0.1"), "public")
        XCTAssertEqual(tag("224.0.0.251"), "multicast")
        XCTAssertEqual(tag("240.0.0.1"), "reserved")
        XCTAssertEqual(tag("255.255.255.255"), "broadcast")
        XCTAssertEqual(tag("0.1.2.3"), "this-network")
        XCTAssertEqual(tag("203.0.113.200"), "documentation")
        XCTAssertEqual(tag("198.19.1.1"), "benchmark")
        XCTAssertEqual(IPv4.tags(ip("10.0.0.1"))[0].label.zh, "私有")
        XCTAssertEqual(IPv4.addressClass(ip("10.0.0.1")).cls, "A")
        XCTAssertEqual(IPv4.addressClass(ip("128.0.0.1")).cls, "B")
        XCTAssertEqual(IPv4.addressClass(ip("223.255.255.255")).cls, "C")
        XCTAssertEqual(IPv4.addressClass(ip("239.1.1.1")).cls, "D")
        XCTAssertEqual(IPv4.addressClass(ip("250.1.1.1")).cls, "E")
        XCTAssertEqual(IPv4.binary(ip("192.168.1.10")), "11000000101010000000000100001010")
        XCTAssertEqual(IPv4.dottedBinary(ip("192.168.1.10")), "11000000.10101000.00000001.00001010")
        XCTAssertEqual(IPv4.hex(ip("192.168.1.10")), "0xC0A8010A")
        XCTAssertEqual(IPv4.reverseDNS(ip("192.168.1.10")), "10.1.168.192.in-addr.arpa")
        XCTAssertEqual(IPv4.mapped(ip("192.168.1.10")), "::ffff:192.168.1.10")
    }

    func testSplittingAndRanges() throws {
        XCTAssertEqual(try IPv4.prefix(forSubnetCount: 4, from: 24), 26)
        XCTAssertEqual(try IPv4.prefix(forSubnetCount: 5, from: 24), 27)
        XCTAssertEqual(try IPv4.prefix(forSubnetCount: 1, from: 24), 24)
        XCTAssertTrue(err { try IPv4.prefix(forSubnetCount: 512, from: 24) }?.message.zh.contains("最多只能划分为 256 个子网") ?? false)
        XCTAssertTrue(err { try IPv4.prefix(forSubnetCount: 0, from: 24) }?.message.zh.contains("正整数") ?? false)
        let s = try IPv4.split(ip("192.168.1.77"), prefix: 24, into: 26)
        XCTAssertEqual(s.total, 4)
        XCTAssertEqual(s.rows.map { "\(IPv4.string($0.network))/\($0.prefix)" }, ["192.168.1.0/26", "192.168.1.64/26", "192.168.1.128/26", "192.168.1.192/26"])
        XCTAssertEqual(IPv4.string(s.rows[1].first), "192.168.1.65")
        XCTAssertEqual(IPv4.string(s.rows[1].broadcast), "192.168.1.127")
        XCTAssertEqual(s.rows[1].usable, 62)
        XCTAssertEqual(try IPv4.prefix(forHostCount: 50, from: 16), 26)
        XCTAssertEqual(try IPv4.prefix(forHostCount: 62, from: 16), 26)
        XCTAssertEqual(try IPv4.prefix(forHostCount: 63, from: 16), 25)
        XCTAssertEqual(try IPv4.prefix(forHostCount: 2, from: 24), 31)
        XCTAssertEqual(try IPv4.prefix(forHostCount: 1, from: 24), 32)
        XCTAssertTrue(err { try IPv4.prefix(forHostCount: 300, from: 24) }?.message.zh.contains("超出 /24 的容量（254 台）") ?? false)
        let huge = try IPv4.split(ip("10.0.0.0"), prefix: 8, into: 30, limit: 100)
        XCTAssertEqual(huge.total, 1 << 22)
        XCTAssertEqual(huge.rows.count, 100)
        XCTAssertEqual(IPv4.string(huge.rows[99].network), "10.0.1.140")
        XCTAssertTrue(err { try IPv4.split(ip("10.0.0.0"), prefix: 8, into: 7) }?.message.zh.contains("新前缀应在 /8 到 /32 之间") ?? false)

        let r = try IPv4.rangeToCIDRs(ip("10.0.0.1"), ip("10.0.0.10")).map { "\(IPv4.string($0.network))/\($0.prefix)" }
        XCTAssertEqual(r, ["10.0.0.1/32", "10.0.0.2/31", "10.0.0.4/30", "10.0.0.8/31", "10.0.0.10/32"])
        let full = try IPv4.rangeToCIDRs(0, 0xFFFF_FFFF)
        XCTAssertEqual(full.count, 1)
        XCTAssertEqual(full.first?.prefix, 0)
        XCTAssertNotNil(err { try IPv4.rangeToCIDRs(5, 1) })
        let pr = try IPv4.parseRange("10.0.0.1 - 10.0.0.10")
        XCTAssertEqual(pr?.start, ip("10.0.0.1"))
        XCTAssertEqual(pr?.end, ip("10.0.0.10"))
        XCTAssertNotNil(try IPv4.parseRange("10.0.0.1~10.0.0.10"))
        XCTAssertNil(try IPv4.parseRange("10.0.0.1/24"))
        XCTAssertTrue(err { try IPv4.parseRange("10.0.0.9 - 10.0.0.1") as Any }?.message.zh.contains("大于结束地址") ?? false)
    }

    // MARK: IPv6

    func v6(_ s: String) -> IPv6Address { (try? IPv6.parse(s).address) ?? .zero }

    func testIPv6Format() throws {
        let a = v6("2001:db8::1")
        XCTAssertEqual(a.expanded, "2001:0db8:0000:0000:0000:0000:0000:0001")
        XCTAssertEqual(a.compressed, "2001:db8::1")
        XCTAssertEqual(v6("2001:0DB8:0000:0000:0001:0000:0000:0001").compressed, "2001:db8::1:0:0:1")
        XCTAssertEqual(v6("2001:db8:0:1:1:1:1:1").compressed, "2001:db8:0:1:1:1:1:1")
        XCTAssertEqual(v6("2001:0:0:1:0:0:0:1").compressed, "2001:0:0:1::1")
        XCTAssertEqual(IPv6Address.zero.compressed, "::")
        XCTAssertEqual(IPv6Address(hi: 0, lo: 1).compressed, "::1")
        XCTAssertEqual(v6("fe80::").compressed, "fe80::")
        XCTAssertEqual(IPv6Address.max.compressed, "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")
        XCTAssertEqual(v6("::ffff:192.168.1.1").expanded, "0000:0000:0000:0000:0000:ffff:c0a8:0101")
        XCTAssertEqual(v6("::ffff:c0a8:101").compressed, "::ffff:192.168.1.1")
        XCTAssertEqual(v6("64:ff9b::192.0.2.33").compressed, "64:ff9b::192.0.2.33")
        XCTAssertEqual(v6("1:2:3:4:5:6:1.2.3.4").expanded, "0001:0002:0003:0004:0005:0006:0102:0304")
        XCTAssertEqual(v6("::1.2.3.4"), IPv6Address(hi: 0, lo: 0x0102_0304))
        XCTAssertEqual(try IPv6.parse("fe80::1%eth0").zone, "eth0")
        XCTAssertEqual(v6("[2001:db8::1]"), v6("2001:db8::1"))
        XCTAssertEqual(v6("1:2:3:4:5:6:7::"), v6("1:2:3:4:5:6:7:0"))
    }

    func testIPv6Errors() {
        func e(_ s: String) -> String { err { try IPv6.parse(s) }?.message.zh ?? "" }
        XCTAssertEqual(e(""), "请输入 IPv6 地址")
        XCTAssertTrue(e("1::2::3").contains("只能出现一次"))
        XCTAssertTrue(e("1:::2").contains(":::"))
        XCTAssertTrue(e("12345::1").contains("第 1 组「12345」"))
        XCTAssertTrue(e("2001:db8::xyz").contains("分组「xyz」"))
        XCTAssertTrue(e("1:2:3:4:5:6:7").contains("当前 7 组"))
        XCTAssertTrue(e("1:2:3:4:5:6:7:8:9").contains("当前 9 组"))
        XCTAssertTrue(e("1:2:3:4:5:6:7:8::").contains("至少要代表一组 0"))
        XCTAssertTrue(e(":1::2").contains("空的分组"))
        XCTAssertTrue(e("::ffff:1.2.3.999").contains("内嵌的 IPv4"))
        XCTAssertTrue(e("fe80::1%").contains("区域 ID"))
        XCTAssertFalse(e("中文").isEmpty)
        XCTAssertTrue(e("[2001:db8::1]:443").contains("端口号「:443」"))
        XCTAssertEqual(err { try IPv6.parse("1:::2") }?.message.en, "Found three colons in a row “:::”")
        XCTAssertTrue(err { try IPv6.parseInput("::1/129") }?.message.zh.contains("/129 超出范围") ?? false)
    }

    func testIPv6Info() throws {
        let p = try IPv6.parseInput("fe80::1%en0/64")
        XCTAssertEqual(p.prefix, 64)
        XCTAssertEqual(p.zone, "en0")
        XCTAssertFalse(try IPv6.parseInput("::1").hasPrefix)
        let i = IPv6.info(v6("2001:db8:abcd:12::1"), prefix: 48)
        XCTAssertEqual(i.network.compressed, "2001:db8:abcd::")
        XCTAssertEqual(i.last.compressed, "2001:db8:abcd:ffff:ffff:ffff:ffff:ffff")
        XCTAssertEqual(IPv6.info(v6("2001:db8::"), prefix: 33).last.compressed, "2001:db8:7fff:ffff:ffff:ffff:ffff:ffff")
        XCTAssertEqual(IPv6.info(v6("::1"), prefix: 0).network, .zero)
        XCTAssertEqual(IPv6.pow2(128), "340,282,366,920,938,463,463,374,607,431,768,211,456")
        XCTAssertEqual(IPv6.pow2(64), "18,446,744,073,709,551,616")
        XCTAssertEqual(IPv6.pow2(8), "256")
        XCTAssertEqual(IPv6.pow2Short(64), "2⁶⁴")
        XCTAssertEqual(IPv6.pow2Short(8), "256")
        func t(_ a: String) -> [String] { IPv6.tags(v6(a)).map(\.id) }
        XCTAssertEqual(t("::"), ["unspecified"])
        XCTAssertEqual(t("::1"), ["loopback"])
        XCTAssertEqual(t("::ffff:10.0.0.1"), ["ipv4-mapped"])
        XCTAssertEqual(t("64:ff9b::1.2.3.4"), ["nat64"])
        XCTAssertEqual(t("2001:db8::1"), ["documentation"])
        XCTAssertEqual(t("2001:0::1"), ["teredo"])
        XCTAssertEqual(t("2002:c000:204::1"), ["6to4"])
        XCTAssertEqual(t("fd12:3456::1"), ["ula"])
        XCTAssertEqual(t("fe80::1"), ["link-local"])
        XCTAssertEqual(t("ff02::1"), ["multicast", "scope"])
        XCTAssertEqual(IPv6.tags(v6("ff02::1"))[1].label.zh, "链路本地范围")
        XCTAssertEqual(t("2606:4700:4700::1111"), ["global"])
        XCTAssertEqual(t("4000::1"), ["reserved"])
        XCTAssertEqual(v6("2001:db8::567:89ab").reverseDNS(), "b.a.9.8.7.6.5.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa")
        XCTAssertEqual(v6("2001:db8::").reverseDNS(prefix: 32), "8.b.d.0.1.0.0.2.ip6.arpa")
        XCTAssertEqual(IPv6Address(hi: 0, lo: 1).nibbles, String(repeating: "0", count: 31) + "1")
    }

    func testCIDRTool() throws {
        let tool = CIDRCalculatorTool.spec
        let r = try tool("192.168.1.10/24")
        XCTAssertEqual(r.primary?.value, "192.168.1.0/24")
        func value(_ res: ToolResult, _ id: String) -> String? { res.outputs.first { $0.id == id }?.value }
        XCTAssertEqual(value(r, "broadcast"), "192.168.1.255")
        XCTAssertEqual(value(r, "hosts"), "254（共 256 个地址，不含网络地址与广播地址）")
        XCTAssertEqual(value(r, "mask"), "255.255.255.0 (/24 · 0xFFFFFF00)")
        XCTAssertTrue(value(r, "type")?.hasPrefix("私有 — ") ?? false)
        XCTAssertNil(r.table)
        // 单独的前缀字段
        let mask = try tool("10.1.2.3", options: ["prefix": "255.255.0.0"], lang: .en)
        XCTAssertEqual(mask.primary?.value, "10.1.0.0/16")
        XCTAssertEqual(mask.notes.first?.message, "Read the subnet mask 255.255.0.0 as /16")
        XCTAssertEqual(try tool("10.1.2.3", options: ["prefix": "/8"]).primary?.value, "10.0.0.0/8")
        XCTAssertEqual(try tool("１０。１。２。３／１６").primary?.value, "10.1.0.0/16")
        // 划分子网
        let split = try tool("192.168.1.0/24", options: ["split": "count", "splitCount": "4"])
        XCTAssertEqual(split.table?.rows.count, 4)
        XCTAssertEqual(split.table?.rows[1], ["2", "192.168.1.64/26", "192.168.1.65", "192.168.1.126", "192.168.1.127", "62"])
        let big = try tool("10.0.0.0/8", options: ["split": "prefix", "splitPrefix": "24"], lang: .en)
        XCTAssertEqual(big.table?.rows.count, 256)
        XCTAssertTrue(big.notes.contains { $0.level == .warning })
        XCTAssertThrowsError(try tool("10.0.0.0/24", options: ["split": "hosts", "splitHosts": "1000"], lang: .en)) { e in
            XCTAssertEqual((e as? ToolError)?.message, "1,000 hosts per subnet exceeds the capacity of /24 (254 hosts)")
        }
        // 范围
        let range = try tool("10.0.0.1 - 10.0.0.10")
        XCTAssertEqual(range.primary?.value, "10.0.0.1/32\n10.0.0.2/31\n10.0.0.4/30\n10.0.0.8/31\n10.0.0.10/32")
        XCTAssertEqual(range.table?.rows.count, 5)
        // IPv6
        let v6r = try tool("2001:db8:abcd:12::1/48")
        XCTAssertEqual(v6r.primary?.value, "2001:db8:abcd::/48")
        XCTAssertEqual(value(v6r, "count"), "2⁸⁰ = 1,208,925,819,614,629,174,706,176")
        XCTAssertEqual(value(v6r, "subnets64"), "65,536")
        XCTAssertEqual(value(v6r, "zone-ptr"), "d.c.b.a.8.b.d.0.1.0.0.2.ip6.arpa")
        let bare = try tool("fe80::1%en0", options: ["prefix": "64"])
        XCTAssertEqual(bare.primary?.value, "fe80::/64")
        XCTAssertEqual(value(bare, "zone"), "%en0")
        XCTAssertThrowsError(try tool("300.1.1.1/24", lang: .en)) { e in
            XCTAssertEqual((e as? ToolError)?.message, "Part 1 300 is out of range (each part is 0–255)")
        }
        XCTAssertThrowsError(try tool("10.0.0.1/40"))
        XCTAssertThrowsError(try tool(",,,"))
        XCTAssertThrowsError(try tool("10.0.0.0/8", options: ["split": "count", "splitCount": String(Int.max)]))
        XCTAssertThrowsError(try tool("10.0.0.0/8", options: ["split": "hosts", "splitHosts": String(Int.max)]))
        XCTAssertThrowsError(try tool("10.0.0.0/8", options: ["split": "hosts", "splitHosts": "-5"]))
        XCTAssertThrowsError(try tool("10.0.0.0/8", options: ["split": "prefix", "splitPrefix": "99"]))
    }
}
