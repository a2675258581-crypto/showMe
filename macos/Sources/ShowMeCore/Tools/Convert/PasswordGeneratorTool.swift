import Foundation

/// 密码 / 助记口令生成：取整用拒绝采样消除取模偏差；强度按信息熵估算。
public enum PasswordGenerator {
    public enum CharClass: String, CaseIterable, Sendable {
        case upper, lower, digit, symbol

        public func label(_ lang: Lang) -> String {
            switch self {
            case .upper: lang.t("大写", "uppercase")
            case .lower: lang.t("小写", "lowercase")
            case .digit: lang.t("数字", "digits")
            case .symbol: lang.t("符号", "symbols")
            }
        }
    }

    public static let upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    public static let lower = "abcdefghijklmnopqrstuvwxyz"
    public static let digits = "0123456789"
    public static let defaultSymbols = "!@#$%^&*()-_=+[]{};:,.<>/?~"
    /// 容易看错的字符：大写 I、小写 l、数字 1、大写 O、数字 0、小写 o
    public static let lookAlikes = "Il1O0o"
    public static let lengthRange = 4...128

    public struct Options: Sendable {
        public var length = 20
        public var upper = true
        public var lower = true
        public var digits = true
        public var symbols = true
        public var excludeLookAlikes = false
        public var symbolSet = PasswordGenerator.defaultSymbols
        /// 每种选中的字符类至少出现一次
        public var requireEach = true

        public init() {}
    }

    public struct Pool: Sendable {
        /// 选中且非空的字符类（彼此不相交）
        public var classes: [(id: CharClass, chars: [String])]
        public var all: [String]
        /// 自定义符号里被忽略的字母 / 数字
        public var ignoredSymbols: [String]
        /// 开启了但因排除 / 为空而没有可用字符的类
        public var emptyClasses: [CharClass]
    }

    /// 字符属于哪一类（按 ASCII 字母数字判断，其余一律算符号）
    public static func classify(_ ch: String) -> CharClass {
        guard ch.unicodeScalars.count == 1, let u = ch.unicodeScalars.first else { return .symbol }
        switch u.value {
        case 65...90: return .upper
        case 97...122: return .lower
        case 48...57: return .digit
        default: return .symbol
        }
    }

    public static func buildPool(_ o: Options) -> Pool {
        let exclude: Set<String> = o.excludeLookAlikes ? Set(lookAlikes.map(String.init)) : []
        func pick(_ s: String) -> [String] { s.map(String.init).filter { !exclude.contains($0) } }
        var classes: [(id: CharClass, chars: [String])] = []
        var empty: [CharClass] = []
        var ignored: [String] = []
        func add(_ id: CharClass, _ on: Bool, _ chars: [String]) {
            guard on else { return }
            if chars.isEmpty { empty.append(id) } else { classes.append((id, chars)) }
        }
        add(.upper, o.upper, pick(upper))
        add(.lower, o.lower, pick(lower))
        add(.digit, o.digits, pick(digits))
        if o.symbols {
            var seen = Set<String>()
            var syms: [String] = []
            // Swift 的 Character 就是字素簇，带肤色 / ZWJ 的 emoji 不会被拆开
            for c in o.symbolSet {
                let s = String(c)
                if c.isWhitespace || seen.contains(s) { continue }
                seen.insert(s)
                if classify(s) != .symbol { ignored.append(s) } else if !exclude.contains(s) { syms.append(s) }
            }
            add(.symbol, true, syms)
        }
        return Pool(classes: classes, all: classes.flatMap(\.chars), ignoredSymbols: ignored, emptyClasses: empty)
    }

    /// Fisher–Yates 原地洗牌
    static func shuffle<T>(_ a: inout [T], _ rng: RandomStream) {
        guard a.count > 1 else { return }
        for i in stride(from: a.count - 1, to: 0, by: -1) {
            a.swapAt(i, rng.int(i + 1))
        }
    }

    static func draw(_ chars: [String], _ n: Int, _ rng: RandomStream) -> [String] {
        (0..<max(0, n)).map { _ in chars[rng.int(chars.count)] }
    }

    /// 生成一个随机密码。「每类至少一个」用整体重抽实现，结果在所有合规密码中均匀分布；
    /// 极端情况下 1000 次仍不满足才退回「先各放一个再洗牌」。
    public static func generatePassword(_ o: Options, rng: RandomStream, lang: Lang = .zh) throws -> String {
        let pool = buildPool(o)
        if pool.all.isEmpty { throw ToolError(lang.t("请至少选择一种字符类型", "Choose at least one character type")) }
        let length = min(lengthRange.upperBound, max(lengthRange.lowerBound, o.length))
        let need = o.requireEach && pool.classes.count > 1 && length >= pool.classes.count
        if !need { return draw(pool.all, length, rng).joined() }
        let sets = pool.classes.map { Set($0.chars) }
        for _ in 0..<1000 {
            let chars = draw(pool.all, length, rng)
            if sets.allSatisfy({ s in chars.contains { s.contains($0) } }) { return chars.joined() }
        }
        var chars = pool.classes.map { $0.chars[rng.int($0.chars.count)] } + draw(pool.all, length - pool.classes.count, rng)
        shuffle(&chars, rng)
        return chars.joined()
    }

    /// 随机密码的熵（位）：log2(可能的密码总数)。要求每类都出现时用容斥原理扣除「缺某一类」的组合，
    /// 在比例空间里计算，长度 128、上千个字符也不会溢出。
    public static func passwordEntropy(_ o: Options) -> Double {
        let pool = buildPool(o)
        let n = Double(pool.all.count)
        guard n > 0 else { return 0 }
        let length = Double(min(lengthRange.upperBound, max(lengthRange.lowerBound, o.length)))
        let k = pool.classes.count
        if !o.requireEach || k <= 1 || Int(length) < k { return length * log2(n) }
        let sizes = pool.classes.map { Double($0.chars.count) }
        var sum = 0.0
        for mask in 0..<(1 << k) {
            var removed = 0.0
            var bits = 0
            for i in 0..<k where mask & (1 << i) != 0 {
                removed += sizes[i]
                bits += 1
            }
            let term = pow((n - removed) / n, length)
            sum += bits % 2 == 1 ? -term : term
        }
        return sum > 0 ? length * log2(n) + log2(sum) : 0
    }

    public static let passphraseWordsRange = 3...12
    public static let passphraseNumberRange = 100

    public static func generatePassphrase(words: Int, separator: String, capitalize: Bool, appendNumber: Bool,
                                          rng: RandomStream, list: [String] = PassphraseWords.list) -> String {
        guard !list.isEmpty else { return "" }
        let count = min(passphraseWordsRange.upperBound, max(passphraseWordsRange.lowerBound, words))
        var parts: [String] = []
        for _ in 0..<count {
            let w = list[rng.int(list.count)]
            parts.append(capitalize ? w.capitalizedFirst : w)
        }
        if appendNumber { parts.append(String(rng.int(passphraseNumberRange))) }
        return parts.joined(separator: separator)
    }

    /// 口令熵：单词数 × log2(词表大小)，追加数字再加 log2(100)；大小写与分隔符是固定的，不增加熵
    public static func passphraseEntropy(words: Int, appendNumber: Bool, listSize: Int = PassphraseWords.list.count) -> Double {
        guard listSize > 0 else { return 0 }
        let count = Double(min(passphraseWordsRange.upperBound, max(passphraseWordsRange.lowerBound, words)))
        return count * log2(Double(listSize)) + (appendNumber ? log2(Double(passphraseNumberRange)) : 0)
    }

    /// 强度分级的熵阈值（位）：< 50 弱，< 72 一般，< 100 强，其余极强
    public static let strengthThresholds: [Double] = [50, 72, 100]

    public static func strength(_ bits: Double) -> (level: Int, label: LocalizedText) {
        let labels = [LocalizedText("弱", "Weak"), LocalizedText("一般", "Fair"), LocalizedText("强", "Strong"), LocalizedText("极强", "Very strong")]
        var level = 0
        while level < strengthThresholds.count && bits >= strengthThresholds[level] { level += 1 }
        return (level, labels[level])
    }

    /// 离线暴力破解的假设速度：每秒 100 亿次猜测
    public static let guessesPerSecond = 1e10

    /// 估算平均破解时间（遍历一半密码空间），全程在对数空间计算，熵上千位也不会溢出
    public static func formatCrackTime(_ bits: Double, guessesPerSecond rate: Double = guessesPerSecond, lang: Lang = .zh) -> String {
        guard bits > 0 else { return lang.t("瞬间", "instantly") }
        let log10s = (bits - 1) * log10(2) - log10(rate)
        if log10s < 0 { return lang.t("不到 1 秒", "less than a second") }
        func num(_ v: Double) -> String { v < 10 ? NumberText.fixed(v, 1) : NumberText.grouped(Int(v.rounded())) }
        let minute = 60.0, hour = 3600.0, day = 86400.0, year = 365.2425 * 86400, century = 100 * year
        let s = pow(10, min(log10s, 12))
        if s < minute { return lang.t("\(num(s)) 秒", "\(num(s)) seconds") }
        if s < hour { return lang.t("\(num(s / minute)) 分钟", "\(num(s / minute)) minutes") }
        if s < day { return lang.t("\(num(s / hour)) 小时", "\(num(s / hour)) hours") }
        if s < year { return lang.t("\(num(s / day)) 天", "\(num(s / day)) days") }
        let log10y = log10s - log10(year)
        if log10y < 2 { return lang.t("\(num(pow(10, log10y))) 年", "\(num(pow(10, log10y))) years") }
        let log10c = log10s - log10(century)
        if log10c < 4 { return lang.t("\(num(pow(10, log10c))) 世纪", "\(num(pow(10, log10c))) centuries") }
        if lang == .zh {
            if log10c < 8 { return "\(num(pow(10, log10c - 4))) 万世纪" }
            if log10c < 12 { return "\(num(pow(10, log10c - 8))) 亿世纪" }
        }
        let exp = Int(log10c.rounded(.down))
        let mant = String(format: "%.1f", pow(10, log10c - Double(exp)))
        return lang.t("\(mant)×10\(NumberText.superscript(exp)) 世纪", "\(mant)×10\(NumberText.superscript(exp)) centuries")
    }
}

public enum PasswordGeneratorTool {
    static let charsets: [(id: String, label: LocalizedText, classes: Set<PasswordGenerator.CharClass>)] = [
        ("all", LocalizedText("大小写 + 数字 + 符号", "Letters, digits, symbols"), [.upper, .lower, .digit, .symbol]),
        ("alnum", LocalizedText("大小写 + 数字", "Letters and digits"), [.upper, .lower, .digit]),
        ("letters", LocalizedText("仅字母", "Letters only"), [.upper, .lower]),
        ("lowerDigits", LocalizedText("小写 + 数字", "Lowercase and digits"), [.lower, .digit]),
        ("digits", LocalizedText("仅数字（PIN）", "Digits only (PIN)"), [.digit]),
    ]

    public static let spec = ToolSpec(
        id: "password-generator",
        name: LocalizedText("密码生成器", "Password Generator"),
        summary: LocalizedText(
            "生成高强度随机密码，评估强度与破解时间。",
            "Generate strong random passwords and passphrases, with strength and crack-time estimates."
        ),
        category: .crypto,
        keywords: ["password", "generator", "random", "strength", "密码", "随机", "passphrase", "mmsc"],
        symbol: "key",
        input: .none,
        fields: [
            ToolField("mode", LocalizedText("类型", "Type"), .choice([
                ToolChoice("password", LocalizedText("随机密码", "Password")),
                ToolChoice("passphrase", LocalizedText("助记口令", "Passphrase")),
            ]), default: "password"),
            ToolField("length", LocalizedText("长度", "Length"), .number(min: 4, max: 128), default: "20", visibleWhen: ToolCondition("mode", is: "password")),
            ToolField("charset", LocalizedText("字符类型", "Characters"), .choice(charsets.map { ToolChoice($0.id, $0.label) }), default: "all",
                      help: LocalizedText("选中的每种类型至少出现一次", "Every chosen type appears at least once"),
                      visibleWhen: ToolCondition("mode", is: "password")),
            ToolField("symbolSet", LocalizedText("符号集", "Symbols"), .text(placeholder: LocalizedText(PasswordGenerator.defaultSymbols, PasswordGenerator.defaultSymbols)),
                      default: PasswordGenerator.defaultSymbols,
                      help: LocalizedText("字符类型含符号时使用；可以放中文或 emoji", "Used when symbols are included; CJK and emoji are fine"),
                      visibleWhen: ToolCondition("mode", is: "password")),
            ToolField("excludeAmbiguous", LocalizedText("排除易混淆字符 Il1O0o", "Exclude look-alikes Il1O0o"), .toggle, default: "0",
                      visibleWhen: ToolCondition("mode", is: "password")),
            ToolField("words", LocalizedText("单词数", "Words"), .number(min: 3, max: 12), default: "5", visibleWhen: ToolCondition("mode", is: "passphrase")),
            ToolField("separator", LocalizedText("分隔符", "Separator"), .choice([
                ToolChoice("-", "-"), ToolChoice("_", "_"), ToolChoice(".", "."),
                ToolChoice("space", LocalizedText("空格", "Space")), ToolChoice("none", LocalizedText("无", "None")),
            ]), default: "-", visibleWhen: ToolCondition("mode", is: "passphrase")),
            ToolField("capitalize", LocalizedText("单词首字母大写", "Capitalize words"), .toggle, default: "1", visibleWhen: ToolCondition("mode", is: "passphrase")),
            ToolField("appendNumber", LocalizedText("末尾追加数字（0–99）", "Append a number (0–99)"), .toggle, default: "1", visibleWhen: ToolCondition("mode", is: "passphrase")),
            ToolField("count", LocalizedText("数量", "Count"), .number(min: 1, max: 50), default: "1"),
        ],
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        let rng = RandomStream(input.random)
        let count = min(50, max(1, input.int("count", default: 1)))
        var list: [String] = []
        var notes: [ToolNote] = []
        let bits: Double
        let isPassphrase = input.string("mode") == "passphrase"
        if isPassphrase {
            let words = input.int("words", default: 5)
            let sep: String
            switch input.string("separator") {
            case "space": sep = " "
            case "none": sep = ""
            case "": sep = "-"
            default: sep = input.string("separator")
            }
            let append = input.bool("appendNumber")
            for _ in 0..<count {
                list.append(PasswordGenerator.generatePassphrase(words: words, separator: sep, capitalize: input.bool("capitalize"), appendNumber: append, rng: rng))
            }
            bits = PasswordGenerator.passphraseEntropy(words: words, appendNumber: append)
            notes.append(ToolNote(.info, lang.t("单词表共 \(PassphraseWords.list.count) 个常见英文单词，每个词贡献 10 位熵",
                                                "The word list has \(PassphraseWords.list.count) common English words, 10 bits each")))
        } else {
            let classes = charsets.first { $0.id == input.string("charset") }?.classes ?? charsets[0].classes
            var o = PasswordGenerator.Options()
            o.length = input.int("length", default: 20)
            o.upper = classes.contains(.upper)
            o.lower = classes.contains(.lower)
            o.digits = classes.contains(.digit)
            o.symbols = classes.contains(.symbol)
            o.excludeLookAlikes = input.bool("excludeAmbiguous")
            o.symbolSet = input.options["symbolSet"] ?? PasswordGenerator.defaultSymbols
            let pool = PasswordGenerator.buildPool(o)
            if !pool.ignoredSymbols.isEmpty {
                notes.append(ToolNote(.warning, lang.t("符号集中的字母和数字已忽略：", "Letters and digits in the symbol set were ignored: ")
                    + pool.ignoredSymbols.joined(separator: lang.t("、", ", "))))
            }
            if !pool.emptyClasses.isEmpty {
                notes.append(ToolNote(.warning, lang.t("没有可用字符的类型：", "These types have no usable characters: ")
                    + pool.emptyClasses.map { $0.label(lang) }.joined(separator: lang.t("、", ", "))))
            }
            for _ in 0..<count { list.append(try PasswordGenerator.generatePassword(o, rng: rng, lang: lang)) }
            bits = PasswordGenerator.passwordEntropy(o)
        }
        let s = PasswordGenerator.strength(bits)
        let strengthText = lang.t(
            "\(s.label.zh) · 熵 \(NumberText.fixed(bits, 1)) 位 · 离线暴力破解平均约需 \(PasswordGenerator.formatCrackTime(bits, lang: .zh))（按每秒 100 亿次猜测）",
            "\(s.label.en) · \(NumberText.fixed(bits, 1)) bits of entropy · about \(PasswordGenerator.formatCrackTime(bits, lang: .en)) to crack offline on average (10 billion guesses per second)"
        )
        let label = isPassphrase ? lang.t("口令", "Passphrase") : lang.t("密码", "Password")
        return ToolResult(
            outputs: [
                .primary(count > 1 ? lang.t("\(label) · \(count) 个", "\(label) · \(count)") : label, list.joined(separator: "\n"), language: "plain"),
                ToolOutput(id: "strength", label: lang.t("强度", "Strength"), value: strengthText, style: .prose),
            ],
            notes: notes
        )
    }
}
