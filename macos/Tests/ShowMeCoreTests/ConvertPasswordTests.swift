import XCTest
@testable import ShowMeCore

final class ConvertPasswordTests: XCTestCase {
    typealias P = PasswordGenerator

    final class Cursor: @unchecked Sendable { var i = 0 }

    /// 依次吐出给定 32 位数（大端字节）的随机源，用完从头循环
    func seq(_ values: [UInt32]) -> @Sendable (Int) -> [UInt8] {
        let bytes = values.flatMap { v in [UInt8(v >> 24), UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF)] }
        let cursor = Cursor()
        return { n in
            (0..<n).map { _ in
                defer { cursor.i += 1 }
                return bytes[cursor.i % bytes.count]
            }
        }
    }

    func opts(_ patch: (inout P.Options) -> Void = { _ in }) -> P.Options {
        var o = P.Options()
        patch(&o)
        return o
    }

    func testRejectionSampling() {
        // n = 3：limit = 2^32 - (2^32 mod 3) = 4294967295，0xFFFFFFFF 必须被丢弃
        XCTAssertEqual(RandomStream(seq([0xFFFF_FFFF, 0xFFFF_FFFF, 5])).int(3), 2)
        XCTAssertEqual(RandomStream(seq([0x8000_0001, 7])).int(0x8000_0001), 7)
        XCTAssertEqual(RandomStream(seq([123])).int(1), 0)
        let rng = RandomStream(TestRandom.lcg(9))
        var counts = [Int](repeating: 0, count: 7)
        for _ in 0..<70_000 { counts[rng.int(7)] += 1 }
        let expected = 10_000.0
        let chi2 = counts.reduce(0.0) { $0 + pow(Double($1) - expected, 2) / expected }
        XCTAssertLessThan(chi2, 27.9)
        var arr = Array(0..<50)
        P.shuffle(&arr, RandomStream(TestRandom.lcg(1)))
        XCTAssertEqual(arr.sorted(), Array(0..<50))
        XCTAssertNotEqual(arr, Array(0..<50))
    }

    func testClassifyAndPool() {
        XCTAssertEqual(P.classify("A"), .upper)
        XCTAssertEqual(P.classify("z"), .lower)
        XCTAssertEqual(P.classify("7"), .digit)
        XCTAssertEqual(P.classify("#"), .symbol)
        XCTAssertEqual(P.classify("中"), .symbol)
        XCTAssertEqual(P.classify("😀"), .symbol)
        let pool = P.buildPool(opts())
        XCTAssertEqual(pool.classes.map(\.id), [.upper, .lower, .digit, .symbol])
        XCTAssertEqual(pool.all.count, 26 + 26 + 10 + P.defaultSymbols.count)
        XCTAssertEqual(Set(pool.all).count, pool.all.count)
        let ex = P.buildPool(opts { $0.excludeLookAlikes = true })
        for c in P.lookAlikes { XCTAssertFalse(ex.all.contains(String(c))) }
        XCTAssertEqual(ex.classes.map(\.chars.count), [24, 24, 8, P.defaultSymbols.count])
        let custom = P.buildPool(opts { $0.symbolSet = "!! @ a1 ¥€😀👍🏽" })
        XCTAssertEqual(custom.classes.last?.chars, ["!", "@", "¥", "€", "😀", "👍🏽"])
        XCTAssertEqual(custom.ignoredSymbols, ["a", "1"])
        let empty = P.buildPool(opts { $0.symbolSet = "   "; $0.upper = false })
        XCTAssertEqual(empty.emptyClasses, [.symbol])
        XCTAssertEqual(empty.classes.map(\.id), [.lower, .digit])
    }

    func testGeneratePassword() throws {
        let rng = RandomStream(TestRandom.lcg(42))
        XCTAssertEqual(try P.generatePassword(opts { $0.length = 1 }, rng: rng).count, 4)
        XCTAssertEqual(try P.generatePassword(opts { $0.length = 999 }, rng: rng).count, 128)
        XCTAssertEqual(try P.generatePassword(opts { $0.length = 33 }, rng: rng).count, 33)
        for _ in 0..<50 {
            let pw = try P.generatePassword(opts { $0.upper = false; $0.lower = false; $0.symbols = false; $0.length = 16 }, rng: rng)
            XCTAssertTrue(pw.count == 16 && pw.allSatisfy(\.isNumber))
        }
        for _ in 0..<300 {
            let pw = try P.generatePassword(opts { $0.length = 4 }, rng: rng)
            XCTAssertEqual(Set(pw.map { P.classify(String($0)) }).count, 4, pw)
        }
        for _ in 0..<50 { XCTAssertTrue(try P.generatePassword(opts { $0.length = 4; $0.symbolSet = "_" }, rng: rng).contains("_")) }
        let noLook = try (0..<40).map { _ in try P.generatePassword(opts { $0.length = 64; $0.excludeLookAlikes = true }, rng: rng) }.joined()
        for c in P.lookAlikes { XCTAssertFalse(noLook.contains(c)) }
        let uni = try P.generatePassword(opts { $0.upper = false; $0.lower = false; $0.digits = false; $0.symbolSet = "中文😀👍🏽"; $0.length = 12 }, rng: rng)
        XCTAssertEqual(uni.count, 12)
        XCTAssertTrue(uni.allSatisfy { ["中", "文", "😀", "👍🏽"].contains(String($0)) })
        let none = opts { $0.upper = false; $0.lower = false; $0.digits = false; $0.symbols = false }
        XCTAssertThrowsError(try P.generatePassword(none, rng: rng)) { e in
            XCTAssertEqual((e as? ToolError)?.message, "请至少选择一种字符类型")
        }
        // 字符频率大致均匀
        var counts: [Character: Int] = [:]
        for _ in 0..<400 {
            for c in try P.generatePassword(opts { $0.upper = false; $0.lower = false; $0.symbols = false; $0.length = 128 }, rng: rng) { counts[c, default: 0] += 1 }
        }
        XCTAssertEqual(counts.count, 10)
        for v in counts.values { XCTAssertLessThan(abs(Double(v) - 5120) / 5120, 0.06) }
    }

    func testEntropy() {
        XCTAssertEqual(P.passwordEntropy(opts { $0.requireEach = false; $0.length = 20 }), 20 * log2(89), accuracy: 1e-10)
        // 容斥原理与穷举计数一致：12^4 - 10^4 - 2^4
        let o = opts { $0.upper = false; $0.lower = false; $0.symbolSet = "!@"; $0.length = 4 }
        XCTAssertEqual(P.passwordEntropy(o), log2(Double(20736 - 10000 - 16)), accuracy: 1e-10)
        let big = String((0..<2000).compactMap { Unicode.Scalar(0x4E00 + $0).map(Character.init) })
        let bits = P.passwordEntropy(opts { $0.symbolSet = big; $0.length = 128 })
        XCTAssertTrue(bits.isFinite)
        XCTAssertGreaterThan(bits, 1300)
        XCTAssertEqual(P.passwordEntropy(opts { $0.upper = false; $0.lower = false; $0.digits = false; $0.symbols = false }), 0)
    }

    func testPassphrase() {
        XCTAssertEqual(PassphraseWords.list.count, 1024)
        XCTAssertEqual(Set(PassphraseWords.list).count, 1024)
        XCTAssertTrue(PassphraseWords.list.allSatisfy { (3...8).contains($0.count) && $0.allSatisfy { $0.isASCII && $0.isLowercase } })
        let rng = RandomStream(TestRandom.lcg(3))
        let p = P.generatePassphrase(words: 5, separator: "-", capitalize: true, appendNumber: true, rng: rng)
        let parts = p.components(separatedBy: "-")
        XCTAssertEqual(parts.count, 6)
        for w in parts.prefix(5) {
            XCTAssertTrue(w.first?.isUppercase ?? false)
            XCTAssertTrue(PassphraseWords.list.contains(w.lowercased()))
        }
        XCTAssertTrue((0..<100).contains(Int(parts[5]) ?? -1))
        let lower = P.generatePassphrase(words: 3, separator: " · ", capitalize: false, appendNumber: false, rng: rng)
        XCTAssertEqual(lower.components(separatedBy: " · ").count, 3)
        XCTAssertEqual(lower, lower.lowercased())
        XCTAssertEqual(P.generatePassphrase(words: 99, separator: "-", capitalize: true, appendNumber: false, rng: rng).components(separatedBy: "-").count, 12)
        XCTAssertEqual(P.passphraseEntropy(words: 5, appendNumber: false), 50, accuracy: 1e-10)
        XCTAssertEqual(P.passphraseEntropy(words: 5, appendNumber: true), 50 + log2(100), accuracy: 1e-10)
        XCTAssertEqual(P.generatePassphrase(words: 5, separator: "-", capitalize: true, appendNumber: true, rng: rng, list: []), "")
    }

    func testStrengthAndCrackTime() {
        XCTAssertEqual(P.strength(30).label.zh, "弱")
        XCTAssertEqual(P.strength(50).label.zh, "一般")
        XCTAssertEqual(P.strength(71.9).level, 1)
        XCTAssertEqual(P.strength(72).label.zh, "强")
        XCTAssertEqual(P.strength(100).label.en, "Very strong")
        func bitsFor(_ seconds: Double) -> Double { 1 + log2(seconds) }
        let year = 365.2425 * 86400
        XCTAssertEqual(P.formatCrackTime(0), "瞬间")
        XCTAssertEqual(P.formatCrackTime(1), "不到 1 秒")
        XCTAssertEqual(P.formatCrackTime(bitsFor(42), guessesPerSecond: 1), "42 秒")
        XCTAssertEqual(P.formatCrackTime(bitsFor(90), guessesPerSecond: 1), "1.5 分钟")
        XCTAssertEqual(P.formatCrackTime(bitsFor(7200), guessesPerSecond: 1), "2 小时")
        XCTAssertEqual(P.formatCrackTime(bitsFor(3 * 86400), guessesPerSecond: 1), "3 天")
        XCTAssertEqual(P.formatCrackTime(bitsFor(200 * 86400), guessesPerSecond: 1), "200 天")
        XCTAssertEqual(P.formatCrackTime(bitsFor(5 * year), guessesPerSecond: 1), "5 年")
        XCTAssertEqual(P.formatCrackTime(bitsFor(300 * year), guessesPerSecond: 1), "3 世纪")
        XCTAssertEqual(P.formatCrackTime(bitsFor(5e6 * year), guessesPerSecond: 1), "5 万世纪")
        XCTAssertEqual(P.formatCrackTime(bitsFor(3e10 * year), guessesPerSecond: 1), "3 亿世纪")
        XCTAssertEqual(P.formatCrackTime(41), "1.8 分钟")
        XCTAssertEqual(P.formatCrackTime(40), "55 秒")
        XCTAssertEqual(P.formatCrackTime(40, lang: .en), "55 seconds")
        let huge = P.formatCrackTime(5000)
        XCTAssertTrue(huge.hasSuffix(" 世纪") && huge.contains("×10"), huge)
        XCTAssertFalse(huge.contains("nan") || huge.contains("inf"))
    }

    func testTool() throws {
        let spec = PasswordGeneratorTool.spec
        func gen(_ options: [String: String], lang: Lang = .zh) throws -> ToolResult {
            try spec.run(ToolInput(text: "", options: spec.defaults.merging(options) { $1 }, lang: lang, random: TestRandom.lcg(5)))
        }
        let r = try gen([:])
        XCTAssertEqual(r.primary?.value.count, 20)
        XCTAssertTrue(r.outputs[1].value.hasPrefix("极强 · 熵"))
        XCTAssertEqual(try gen([:]).primary?.value, r.primary?.value)
        let pins = try gen(["charset": "digits", "length": "6", "count": "5"], lang: .en)
        let list = pins.primary?.value.components(separatedBy: "\n") ?? []
        XCTAssertEqual(list.count, 5)
        XCTAssertTrue(list.allSatisfy { $0.count == 6 && $0.allSatisfy(\.isNumber) })
        XCTAssertTrue(pins.outputs[1].value.hasPrefix("Weak"))
        let phrase = try gen(["mode": "passphrase", "separator": "space"])
        XCTAssertEqual(phrase.primary?.value.components(separatedBy: " ").count, 6)
        XCTAssertEqual(phrase.primary?.label, "口令")
        let ignored = try gen(["symbolSet": "ab#"])
        XCTAssertTrue(ignored.notes.contains { $0.message.contains("a、b") })
    }
}
