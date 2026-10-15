import XCTest
@testable import ShowMeCore

/// 测试用的确定性随机源
enum TestRandom {
    static func constant(_ v: UInt8) -> @Sendable (Int) -> [UInt8] {
        { n in [UInt8](repeating: v, count: n) }
    }

    /// 线性同余发生器：每次调用都从同一个种子开始，结果可复现
    static func lcg(_ seed: UInt32) -> @Sendable (Int) -> [UInt8] {
        let state = LCGState(seed)
        return { n in state.next(n) }
    }

    final class LCGState: @unchecked Sendable {
        private var s: UInt32
        private let lock = NSLock()

        init(_ seed: UInt32) { s = seed }

        func next(_ n: Int) -> [UInt8] {
            lock.lock()
            defer { lock.unlock() }
            return (0..<n).map { _ in
                s = s &* 1_664_525 &+ 1_013_904_223
                return UInt8(s >> 24)
            }
        }
    }
}

final class ConvertUUIDTests: XCTestCase {
    let uuidRE = try! NSRegularExpression(pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    let ulidRE = try! NSRegularExpression(pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$")

    func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }

    func gen(_ options: [String: String], random: @escaping @Sendable (Int) -> [UInt8] = TestRandom.lcg(7),
             now: Date = Date(timeIntervalSince1970: 1_700_000_000.123), lang: Lang = .zh) throws -> ToolResult {
        let spec = UUIDGeneratorTool.spec
        return try spec.run(ToolInput(text: "ignored", options: spec.defaults.merging(options) { $1 }, lang: lang, now: now, random: random))
    }

    func ids(_ r: ToolResult) -> [String] { r.primary?.value.components(separatedBy: "\n") ?? [] }

    func testV4() throws {
        XCTAssertEqual(IDGenerator.uuidV4(fromBytes: [UInt8](repeating: 0xFF, count: 16)), "ffffffff-ffff-4fff-bfff-ffffffffffff")
        XCTAssertEqual(IDGenerator.uuidV4(fromBytes: [UInt8](repeating: 0, count: 16)), "00000000-0000-4000-8000-000000000000")
        let r = try gen(["kind": "v4"], random: TestRandom.constant(0xAB))
        XCTAssertEqual(ids(r).first, "abababab-abab-4bab-abab-abababababab")
        let many = ids(try gen(["kind": "v4", "count": "1000"]))
        XCTAssertEqual(many.count, 1000)
        XCTAssertEqual(Set(many).count, 1000)
        for id in many.prefix(50) {
            XCTAssertTrue(matches(uuidRE, id), id)
            XCTAssertEqual(Array(id)[14], "4")
            XCTAssertTrue("89ab".contains(Array(id)[19]))
        }
        // 同一个注入的随机源 → 同样的结果
        XCTAssertEqual(ids(try gen(["kind": "v4", "count": "3"], random: TestRandom.lcg(1))), ids(try gen(["kind": "v4", "count": "3"], random: TestRandom.lcg(1))))
    }

    func testFormatting() throws {
        let id = "017f22e2-79b0-7cc3-98c4-dc0c0c07398f"
        XCTAssertEqual(IDGenerator.formatUuid(id, uppercase: true, noHyphens: false, braces: false), "017F22E2-79B0-7CC3-98C4-DC0C0C07398F")
        XCTAssertEqual(IDGenerator.formatUuid(id, uppercase: false, noHyphens: true, braces: false), "017f22e279b07cc398c4dc0c0c07398f")
        XCTAssertEqual(IDGenerator.formatUuid(id, uppercase: true, noHyphens: true, braces: true), "{017F22E279B07CC398C4DC0C0C07398F}")
        for id in ids(try gen(["kind": "v7", "count": "3", "uppercase": "1", "noHyphens": "1", "braces": "1"])) {
            XCTAssertTrue(id.hasPrefix("{") && id.hasSuffix("}") && id.count == 34 && id == id.uppercased(), id)
        }
    }

    func testV7() throws {
        // RFC 9562 附录 A.6
        let counter: UInt64 = (0xCC3 << 30) | (UInt64(0x18 & 0x3F) << 24) | (0xC4 << 16) | (0xDC << 8) | 0x0C
        XCTAssertEqual(IDGenerator.buildUuidV7(ms: 0x017F_22E2_79B0, counter: counter, tail: [0x0C, 0x07, 0x39, 0x8F]), "017f22e2-79b0-7cc3-98c4-dc0c0c07398f")
        XCTAssertNil(IDGenerator.buildUuidV7(ms: 1 << 48, counter: 0, tail: [0, 0, 0, 0]))
        XCTAssertEqual(IDGenerator.buildUuidV7(ms: (1 << 48) - 1, counter: (1 << 42) - 1, tail: [0xFF, 0xFF, 0xFF, 0xFF]), "ffffffff-ffff-7fff-bfff-ffffffffffff")
        let list = ids(try gen(["kind": "v7", "count": "500"]))
        XCTAssertEqual(list.count, 500)
        XCTAssertEqual(list, list.sorted())
        XCTAssertEqual(Set(list).count, 500)
        let first = try XCTUnwrap(list.first)
        XCTAssertTrue(matches(uuidRE, first))
        XCTAssertEqual(Array(first)[14], "7")
        // 前 48 位就是 input.now 的毫秒数
        XCTAssertEqual(Int64(first.replacingOccurrences(of: "-", with: "").prefix(12), radix: 16), 1_700_000_000_123)
    }

    func testUlid() throws {
        XCTAssertEqual(IDGenerator.encodeUlidTime(1_469_918_176_385), "01ARYZ6S41")
        XCTAssertEqual(IDGenerator.encodeUlidTime(0), "0000000000")
        XCTAssertEqual(IDGenerator.encodeUlidTime((1 << 48) - 1), "7ZZZZZZZZZ")
        XCTAssertNil(IDGenerator.encodeUlidTime(1 << 48))
        XCTAssertNil(IDGenerator.encodeUlidTime(-1))
        let list = ids(try gen(["kind": "ulid", "count": "1000"], now: Date(timeIntervalSince1970: 1_469_918_176.385)))
        for id in list {
            XCTAssertTrue(matches(ulidRE, id), id)
            XCTAssertTrue(id.hasPrefix("01ARYZ6S41"))
        }
        XCTAssertEqual(list, list.sorted())
        XCTAssertEqual(Set(list).count, 1000)

        var g = IDGenerator.UlidGenerator()
        let ff = RandomStream(TestRandom.constant(0xFF))
        let a = try XCTUnwrap(g.next(ms: 1000, random: ff))
        XCTAssertEqual(String(a.dropFirst(10)), String(repeating: "Z", count: 16))
        let b = try XCTUnwrap(g.next(ms: 1000, random: ff))
        XCTAssertEqual(String(b.prefix(10)), IDGenerator.encodeUlidTime(1001))
        XCTAssertGreaterThan(b, a)
        var g2 = IDGenerator.UlidGenerator()
        let zero = RandomStream(TestRandom.constant(0))
        XCTAssertEqual(g2.next(ms: 5, random: zero).map { String($0.dropFirst(10)) }, String(repeating: "0", count: 16))
        XCTAssertEqual(g2.next(ms: 5, random: zero).map { String($0.dropFirst(10)) }, String(repeating: "0", count: 15) + "1")
        let lower = ids(try gen(["kind": "ulid", "count": "2", "lowercase": "1"]))
        XCTAssertEqual(lower.first, lower.first?.lowercased())
    }

    func testNanoID() throws {
        XCTAssertEqual(IDGenerator.nanoid(size: 6, alphabet: ["a", "b"], random: RandomStream(TestRandom.constant(1))), "bbbbbb")
        let def = ids(try gen(["kind": "nanoid", "count": "50"]))
        for id in def {
            XCTAssertEqual(id.count, 21)
            XCTAssertTrue(id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }, id)
        }
        let digits = ids(try gen(["kind": "nanoid", "size": "10", "alphabet": "digits"]))
        XCTAssertTrue(digits.allSatisfy { $0.count == 10 && $0.allSatisfy(\.isNumber) })
        let zh = ids(try gen(["kind": "nanoid", "size": "8", "customAlphabet": "甲乙丙丁戊"]))
        for id in zh {
            XCTAssertEqual(id.count, 8)
            XCTAssertTrue(id.allSatisfy { "甲乙丙丁戊".contains($0) })
        }
        // 3 个字符的字母表：拒绝采样，分布大致均匀
        let s = ids(try gen(["kind": "nanoid", "size": "256", "count": "4", "customAlphabet": "abc"])).joined()
        for c in "abc" {
            XCTAssertLessThan(abs(Double(s.filter { $0 == c }.count) - 1024.0 / 3), 90)
        }
        XCTAssertEqual(IDGenerator.normalizeAlphabet("aab c👍🏽👍🏽").chars, ["a", "b", "c", "👍🏽"])
        XCTAssertEqual(IDGenerator.normalizeAlphabet("aab c👍🏽👍🏽").duplicates, ["a", "👍🏽"])
        for preset in IDGenerator.nanoidAlphabets {
            XCTAssertEqual(IDGenerator.normalizeAlphabet(preset.chars).duplicates, [], preset.id)
        }
        XCTAssertThrowsError(try gen(["kind": "nanoid", "customAlphabet": "aaaa"])) { e in
            XCTAssertEqual((e as? ToolError)?.message, "字母表至少需要 2 个不同的字符")
        }
        XCTAssertThrowsError(try gen(["kind": "nanoid", "customAlphabet": "aaaa"], lang: .en)) { e in
            XCTAssertEqual((e as? ToolError)?.message, "The alphabet needs at least 2 different characters")
        }
        let dup = try gen(["kind": "nanoid", "customAlphabet": "aabc"])
        XCTAssertTrue(dup.notes.contains { $0.level == .warning })
    }

    func testStats() throws {
        XCTAssertEqual(IDGenerator.randomBits(.v4, nanoidSize: 21, alphabetCount: 64), 122)
        XCTAssertEqual(IDGenerator.randomBits(.nanoid, nanoidSize: 21, alphabetCount: 64), 126, accuracy: 1e-9)
        XCTAssertEqual(IDGenerator.collisionLog10(bits: 122), log10(3.26e17), accuracy: 0.01)
        XCTAssertEqual(IDGenerator.formatLog10Count(IDGenerator.collisionLog10(bits: 122), .zh), "3.3×10¹⁷")
        XCTAssertEqual(IDGenerator.formatLog10Count(log10(12345), .zh), "1.2 万")
        XCTAssertEqual(IDGenerator.formatLog10Count(log10(250_000_000), .zh), "2.5 亿")
        XCTAssertEqual(IDGenerator.formatLog10Count(log10(999), .zh), "999")
        XCTAssertEqual(IDGenerator.formatLog10Count(log10(250_000_000), .en), "250 million")
        let r = try gen(["kind": "v4", "count": "0"], lang: .en)
        XCTAssertEqual(ids(r).count, 1)
        XCTAssertTrue(r.notes.last?.message.hasPrefix("122 random bits per ID") ?? false)
        XCTAssertEqual(try gen(["kind": "v4", "count": "5000"]).primary?.value.components(separatedBy: "\n").count, 1000)
    }
}
