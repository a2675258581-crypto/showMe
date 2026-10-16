import Foundation

// 「JSON 生成类型」的命名工具：单复数转换、各种命名风格、各语言关键字与合法标识符判断。

extension JSONToTypes {
    public enum Names {
        // MARK: 单数化

        /// 不可数 / 单复同形：单数化后保持原样（类型名会补 Item）
        static let uncountable: Set<String> = [
            "news", "series", "species", "info", "information", "metadata", "data", "media", "equipment", "feedback",
            "software", "hardware", "firmware", "middleware", "advice", "furniture", "luggage", "baggage", "money",
            "music", "traffic", "weather", "sheep", "fish", "deer", "aircraft", "chassis", "sms", "gps", "ios", "macos",
            "os", "aws", "dns", "cms", "css", "js", "ts", "https", "analytics", "physics", "mathematics", "economics",
            "politics", "ethics", "logistics", "headquarters", "means", "kudos", "chaos", "ethos", "cosmos", "this",
            "yes", "alias", "bias", "canvas", "atlas", "gas", "lens", "plus", "bonus", "census", "campus", "virus",
            "status", "apparatus", "octopus", "focus", "corpus", "nexus", "bus", "cactus", "circus", "radius", "genus",
            "thesaurus", "syllabus", "stimulus", "fungus", "iris",
        ]

        static let irregular: [String: String] = [
            "people": "person", "persons": "person", "children": "child", "men": "man", "women": "woman",
            "mice": "mouse", "geese": "goose", "feet": "foot", "teeth": "tooth", "oxen": "ox", "criteria": "criterion",
            "phenomena": "phenomenon", "indices": "index", "matrices": "matrix", "vertices": "vertex",
            "appendices": "appendix", "analyses": "analysis", "crises": "crisis", "diagnoses": "diagnosis",
            "theses": "thesis", "hypotheses": "hypothesis", "parentheses": "parenthesis", "synopses": "synopsis",
            "axes": "axis", "radii": "radius", "cacti": "cactus", "fungi": "fungus", "stimuli": "stimulus",
            "syllabi": "syllabus", "alumni": "alumnus", "curricula": "curriculum", "quizzes": "quiz", "leaves": "leaf",
            "knives": "knife", "wives": "wife", "lives": "life", "halves": "half", "shelves": "shelf", "wolves": "wolf",
            "thieves": "thief", "selves": "self", "calves": "calf", "loaves": "loaf", "scarves": "scarf", "elves": "elf",
            "heroes": "hero", "potatoes": "potato", "tomatoes": "tomato", "echoes": "echo", "vetoes": "veto",
            "torpedoes": "torpedo", "volcanoes": "volcano", "mosquitoes": "mosquito", "dominoes": "domino",
            "embargoes": "embargo", "menus": "menu", "gurus": "guru", "haikus": "haiku", "emus": "emu", "tutus": "tutu",
        ]

        /// 以 -ies 结尾但单数是 -ie 的词
        static let ieWords: Set<String> = [
            "movie", "cookie", "zombie", "rookie", "hoodie", "selfie", "calorie", "pie", "tie", "lie", "die", "brownie",
            "freebie", "genie", "goalie", "smoothie", "techie", "prairie", "auntie", "birdie", "cutie", "newbie",
            "sortie", "lingerie", "eerie", "budgie",
        ]

        /// 以 -ches 结尾但单数是 -che 的词
        static let cheWords: Set<String> = ["cache", "niche", "headache", "moustache", "mustache", "avalanche", "cliche", "creche", "psyche"]

        /// 以 -uses / -ases 结尾、单数去掉 es 的词
        static let esWords: Set<String> = [
            "alias", "bias", "canvas", "atlas", "gas", "lens", "plus", "bonus", "census", "campus", "virus", "genus",
            "status", "apparatus", "octopus", "focus", "corpus", "nexus", "prospectus", "syllabus", "thesaurus", "bus",
            "cactus", "circus", "fungus", "stimulus", "radius", "iris",
        ]

        static func isVowel(_ c: Character) -> Bool { "aeiou".contains(c) }

        /// 英文单词单数化（只处理纯小写 ASCII 单词；无法单数化时原样返回）：
        /// items→item、categories→category、addresses→address、people→person、data→data
        public static func singularize(_ w: String) -> String {
            guard w.count >= 2, w.utf8.allSatisfy({ $0 >= 0x61 && $0 <= 0x7A }) else { return w }
            if uncountable.contains(w) { return w }
            if let s = irregular[w] { return s }
            if w.hasSuffix("s") {
                let stem = String(w.dropLast())
                if ieWords.contains(stem) || cheWords.contains(stem) { return stem }
            }
            if w.hasSuffix("es"), esWords.contains(String(w.dropLast(2))) { return String(w.dropLast(2)) }
            let chars = Array(w)
            if w.hasSuffix("ies"), w.count > 4, !isVowel(chars[chars.count - 4]) { return String(w.dropLast(3)) + "y" }
            for suffix in ["sses", "xes", "ches", "shes", "zzes"] where w.hasSuffix(suffix) { return String(w.dropLast(2)) }
            // -ss / -us 通常是单数；-is 只有 analysis、axis、tennis 这类（emojis、apis 仍是复数）
            for suffix in ["ss", "us", "sis", "xis", "nis", "lis", "tis"] where w.hasSuffix(suffix) { return w }
            if w.hasSuffix("s"), w.count > 2 { return String(w.dropLast()) }
            return w
        }

        // MARK: 命名风格

        static func cap(_ w: String) -> String { w.isEmpty ? w : w.prefix(1).uppercased() + w.dropFirst() }

        static func category(_ s: Unicode.Scalar) -> Unicode.GeneralCategory { s.properties.generalCategory }

        static func isLetterOrNumber(_ s: Unicode.Scalar) -> Bool {
            switch category(s) {
            case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
                 .decimalNumber, .letterNumber, .otherNumber:
                return true
            default:
                return false
            }
        }

        /// 把 JSON 键拆成小写单词：按驼峰与分隔符拆分，字母与数字之间不拆
        /// （base64Data → base64、data；2fa-enabled → 2fa、enabled）。emoji、标点等会被丢弃。
        public static func keyWords(_ key: String) -> [String] {
            let s = Array(key.unicodeScalars)
            // 小写或数字后跟大写：userName → user Name
            var a: [Unicode.Scalar] = []
            var i = 0
            while i < s.count {
                if i + 1 < s.count, category(s[i]) == .lowercaseLetter || ("0"..."9").contains(s[i]), category(s[i + 1]) == .uppercaseLetter {
                    a += [s[i], " ", s[i + 1]]
                    i += 2
                } else {
                    a.append(s[i])
                    i += 1
                }
            }
            // 连续大写后跟小写：XMLHttp → XML Http
            var b: [Unicode.Scalar] = []
            i = 0
            while i < a.count {
                if i + 2 < a.count, category(a[i]) == .uppercaseLetter, category(a[i + 1]) == .uppercaseLetter, category(a[i + 2]) == .lowercaseLetter {
                    b += [a[i], " ", a[i + 1], a[i + 2]]
                    i += 3
                } else {
                    b.append(a[i])
                    i += 1
                }
            }
            var words: [String] = []
            var cur = String.UnicodeScalarView()
            for c in b {
                if isLetterOrNumber(c) {
                    cur.append(c)
                } else if !cur.isEmpty {
                    words.append(String(cur).lowercased())
                    cur = String.UnicodeScalarView()
                }
            }
            if !cur.isEmpty { words.append(String(cur).lowercased()) }
            return words
        }

        public static func pascalCase(_ key: String) -> String { keyWords(key).map(cap).joined() }

        public static func camelCase(_ key: String) -> String {
            let w = keyWords(key)
            guard let first = w.first else { return "" }
            return first + w.dropFirst().map(cap).joined()
        }

        public static func snakeCase(_ key: String) -> String { keyWords(key).joined(separator: "_") }

        /// Go 常见缩写（golint 列表），整词大写：userId → UserID
        static let goInitialisms: Set<String> = [
            "acl", "api", "ascii", "cpu", "css", "dns", "eof", "guid", "html", "http", "https", "id", "ip", "json", "lhs",
            "qps", "ram", "rhs", "rpc", "sla", "smtp", "sql", "ssh", "tcp", "tls", "ttl", "udp", "ui", "uid", "uuid", "uri",
            "url", "utf8", "vm", "xml", "xmpp", "xsrf", "xss",
        ]

        static func goWord(_ w: String) -> String {
            if goInitialisms.contains(w) { return w.uppercased() }
            // 缩写的复数：ids → IDs、urls → URLs
            if w.count > 2, w.hasSuffix("s"), goInitialisms.contains(String(w.dropLast())) { return w.dropLast().uppercased() + "s" }
            return cap(w)
        }

        public static func goPascalCase(_ key: String) -> String { keyWords(key).map(goWord).joined() }

        /// 类型名：PascalCase，保证以字母开头（数字开头补 T）。
        /// plural 时把最后一个单词单数化，无法单数化则补 Item（data → DataItem）。
        public static func typeName(fromKey key: String, plural: Bool = false) -> String {
            var words = keyWords(key)
            if words.isEmpty { return plural ? "Item" : "" }
            if plural, let last = words.last {
                let single = singularize(last)
                if single != last { words[words.count - 1] = single } else { words.append("item") }
            }
            let name = words.map(cap).joined()
            return startsWithDigit(name) ? "T" + name : name
        }

        static func startsWithDigit(_ s: String) -> Bool {
            guard let f = s.unicodeScalars.first else { return false }
            return ("0"..."9").contains(f)
        }

        /// 若干候选名的公共「尾部单词」：BillingAddress + ShippingAddress → Address
        public static func commonSuffixName(_ names: [String]) -> String? {
            guard !names.isEmpty else { return nil }
            let split = names.map(keyWords)
            var out: [String] = []
            var i = 1
            while i <= split[0].count {
                let w = split[0][split[0].count - i]
                guard split.allSatisfy({ $0.count >= i && $0[$0.count - i] == w }) else { break }
                out.insert(w, at: 0)
                i += 1
            }
            guard !out.isEmpty else { return nil }
            let name = out.map(cap).joined()
            return startsWithDigit(name) ? nil : name
        }

        // MARK: 标识符

        /// JavaScript / TypeScript 合法标识符（Unicode）
        public static func isJSIdentifier(_ s: String) -> Bool {
            let u = Array(s.unicodeScalars)
            guard let f = u.first, f.properties.isIDStart || f == "$" || f == "_" else { return false }
            return u.dropFirst().allSatisfy { $0.properties.isIDContinue || $0 == "$" || $0.value == 0x200C || $0.value == 0x200D }
        }

        /// 大多数语言通用的标识符规则（字母或下划线开头，字母数字下划线组成）
        public static func isPlainIdentifier(_ s: String) -> Bool {
            let u = Array(s.unicodeScalars)
            guard let f = u.first, FC.isLetter(f.value) || f == "_" else { return false }
            return u.dropFirst().allSatisfy { FC.isLetter($0.value) || FC.isNumber($0.value) || $0 == "_" }
        }

        /// Go 导出名必须以大写字母开头：中文等无大小写的名称补 X
        public static func goExport(_ name: String) -> String {
            guard let f = name.unicodeScalars.first else { return "X" }
            if category(f) == .uppercaseLetter { return name }
            if f.isASCII, category(f) == .lowercaseLetter { return cap(name) }
            return "X" + name
        }

        /// 在已用集合里取一个不冲突的名字：name、name2、name3…
        static func uniqueName(_ name: String, _ used: inout Set<String>, fold: Bool = false) -> String {
            func k(_ s: String) -> String { fold ? s.lowercased() : s }
            var out = name
            var i = 2
            while used.contains(k(out)) { out = "\(name)\(i)"; i += 1 }
            used.insert(k(out))
            return out
        }

        // MARK: 关键字

        static func words(_ s: String) -> Set<String> { Set(s.split(whereSeparator: { $0 == " " || $0 == "\n" }).map(String.init)) }

        static let javaKeywords = words("""
        abstract assert boolean break byte case catch char class const continue default do double \
        else enum extends final finally float for goto if implements import instanceof int interface \
        long native new package private protected public return short static strictfp super switch \
        synchronized this throw throws transient try void volatile while true false null var record \
        yield sealed permits _
        """)

        static let kotlinKeywords = words("""
        as break class continue do else false for fun if in interface is null object package return \
        super this throw true try typealias typeof val var when while
        """)

        static let rustKeywords = words("""
        as async await break const continue crate dyn else enum extern false fn for if impl in let \
        loop match mod move mut pub ref return self Self static struct super trait true type unsafe \
        use where while abstract become box do final macro override priv typeof unsized virtual yield \
        try gen
        """)

        /// 这些 Rust 关键字不能写成 r#xxx
        static let rustNoRaw: Set<String> = ["self", "Self", "super", "crate", "_"]

        static let swiftKeywords = words("""
        associatedtype class deinit enum extension fileprivate func import init inout internal let \
        open operator private precedencegroup protocol public rethrows static struct subscript \
        typealias var break case catch continue default defer do else fallthrough for guard if in \
        repeat return throw switch where while Any as await false is nil self Self super throws true \
        try _
        """)

        static let pythonKeywords = words("""
        False None True and as assert async await break class continue def del elif else except \
        finally for from global if import in is lambda nonlocal not or pass raise return try while \
        with yield match case type
        """)

        static let csharpKeywords = words("""
        abstract as base bool break byte case catch char checked class const continue decimal default \
        delegate do double else enum event explicit extern false finally fixed float for foreach goto \
        if implicit in int interface internal is lock long namespace new null object operator out \
        override params private protected public readonly ref return sbyte sealed short sizeof \
        stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe \
        ushort using virtual void volatile while
        """)

        /// 不宜直接用作类型名的名字（与各语言内置类型、生成代码里用到的库类型冲突）
        static let reservedTypeNames: Set<String> = [
            "Any", "Array", "Bool", "Boolean", "Box", "Byte", "Char", "Character", "Codable", "CodingKey", "CodingKeys",
            "Data", "Date", "Decimal", "Decoder", "Dict", "Dictionary", "Double", "Encoder", "Error", "Float", "Function",
            "HashMap", "Int", "Integer", "JSONValue", "JsonElement", "JsonProperty", "JsonPropertyName", "List", "Long",
            "Map", "Nil", "None", "NotRequired", "Nothing", "Null", "Number", "Object", "Option", "Optional", "Promise",
            "Record", "Result", "Self", "SerialName", "Serializable", "Set", "Short", "String", "Symbol", "Type",
            "TypedDict", "Union", "Unit", "Unknown", "Value", "Vec", "Void",
        ]
    }
}
