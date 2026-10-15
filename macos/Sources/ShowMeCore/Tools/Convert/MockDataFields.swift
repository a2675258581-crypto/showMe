import Foundation

// 字段类型、字段列表解析与各类型的生成器。

extension MockData {
    public enum FieldType: String, CaseIterable, Sendable {
        case autoId, name, enName, username, gender, phone, email, idCard, address, zip, company, creditCode, bankCard,
             plate, ipv4, url, uuid, color, int, float, datetime, bool, enumValues, password, sentence, paragraph
    }

    /// 一列：列名、类型与括号里的参数，如 `age:int(18-65)`
    public struct Field: Hashable, Sendable {
        public var name: String
        public var type: FieldType
        public var args: String

        public init(name: String, type: FieldType, args: String = "") {
            self.name = name
            self.type = type
            self.args = args
        }
    }

    /// 类型别名 → (类型, 预设参数)。别名比较时忽略大小写、下划线、连字符与空格。
    static let aliases: [String: (FieldType, String)] = {
        var m: [String: (FieldType, String)] = [:]
        func add(_ type: FieldType, _ args: String = "", names: String) {
            for n in names.split(separator: " ") { m[String(n)] = (type, args) }
        }
        add(.autoId, names: "id autoid seq serial no 序号 编号 自增id")
        add(.name, names: "name fullname realname zhname 姓名 名字 中文姓名")
        add(.enName, names: "enname englishname 英文名 英文姓名")
        add(.enName, "first", names: "firstname givenname 名")
        add(.enName, "last", names: "lastname surname familyname 姓")
        add(.username, names: "username user nickname login account 用户名 昵称 账号")
        add(.gender, names: "gender sex 性别")
        add(.int, "18-65", names: "age 年龄")
        add(.phone, names: "phone mobile tel telephone cell 手机 手机号 电话")
        add(.email, names: "email mail 邮箱 电子邮件")
        add(.idCard, names: "idcard identity ssn 身份证 身份证号")
        add(.address, names: "address addr 地址")
        add(.address, "detail", names: "fulladdress shipaddress 详细地址 收货地址")
        add(.address, "city", names: "city 城市")
        add(.address, "province", names: "province state 省份 省")
        add(.zip, names: "zip zipcode postcode postalcode 邮编")
        add(.company, names: "company corp organization org 公司 公司名 企业")
        add(.creditCode, names: "creditcode uscc ein 信用代码 统一社会信用代码")
        add(.bankCard, names: "bankcard card cardno creditcard 银行卡 银行卡号")
        add(.plate, names: "plate licenseplate 车牌 车牌号")
        add(.ipv4, names: "ip ipv4 ipaddress 地址ip")
        add(.url, names: "url website site homepage link 网址 链接")
        add(.uuid, names: "uuid guid")
        add(.color, names: "color colour 颜色")
        add(.int, names: "int integer number num count quantity qty 整数 数量")
        add(.float, names: "float decimal double amount price money salary 小数 金额 价格")
        add(.datetime, names: "datetime createdat updatedat created updated 日期时间 创建时间 更新时间")
        add(.datetime, "date", names: "date day 日期")
        add(.datetime, "1960-01-01~2005-12-31,date", names: "birthday birthdate dob 生日 出生日期")
        add(.datetime, "time", names: "time 时间")
        add(.datetime, "ts", names: "timestamp ts unixtime 时间戳")
        add(.bool, names: "bool boolean flag active enabled isactive 布尔 是否")
        add(.enumValues, names: "enum choice oneof 枚举")
        add(.enumValues, "status", names: "status 状态")
        add(.password, names: "password pwd pass secret 密码")
        add(.sentence, names: "sentence title subject text 句子 标题")
        add(.paragraph, names: "paragraph content description desc bio intro body 段落 内容 简介")
        return m
    }()

    static func aliasKey(_ s: String) -> String {
        s.lowercased().filter { $0 != "_" && $0 != "-" && $0 != " " }
    }

    /// 默认字段列表（中英文通用）
    public static let defaultFields = "id, name, gender, age, phone, email, address, created_at"

    /// 可用类型的简短列表（报错时提示）
    static let typeHint = "id、name、gender、age、phone、email、id_card、address、city、zip、company、credit_code、bank_card、plate、ip、url、uuid、color、int(1-100)、float(0-1000)、date、datetime、timestamp、bool、enum(a|b)、password、sentence、paragraph"

    /// 解析「列名:类型(参数)」的逗号 / 换行分隔列表；只写类型时类型名就是列名
    public static func parseFields(_ text: String, lang: Lang) -> (fields: [Field], warnings: [String]) {
        var tokens: [String] = []
        var current = ""
        var depth = 0
        for ch in text {
            if ch == "(" || ch == "（" { depth += 1 }
            if ch == ")" || ch == "）" { depth = max(0, depth - 1) }
            if depth == 0 && (ch == "," || ch == "，" || ch == "、" || ch == "\n" || ch == "\r\n" || ch == ";" || ch == "；") {
                tokens.append(current)
                current = ""
            } else {
                current.append(ch)
            }
        }
        tokens.append(current)
        var fields: [Field] = []
        var warnings: [String] = []
        for raw in tokens {
            let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if token.isEmpty { continue }
            var name: String?
            var typeText = token
            // 冒号在括号外才是「列名:类型」
            if let colon = token.firstIndex(where: { $0 == ":" || $0 == "：" }),
               !token[..<colon].contains("(") && !token[..<colon].contains("（") {
                name = token[..<colon].trimmingCharacters(in: .whitespaces)
                typeText = token[token.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            }
            var args: String?
            if let open = typeText.firstIndex(where: { $0 == "(" || $0 == "（" }) {
                var inner = String(typeText[typeText.index(after: open)...])
                if inner.hasSuffix(")") || inner.hasSuffix("）") { inner.removeLast() }
                args = inner.trimmingCharacters(in: .whitespaces)
                typeText = typeText[..<open].trimmingCharacters(in: .whitespaces)
            }
            guard let (type, preset) = aliases[aliasKey(typeText)] else {
                warnings.append(lang.t(
                    "未知的字段类型「\(typeText)」，已跳过。可用：\(typeHint)",
                    "Unknown field type “\(typeText)”, skipped. Available: \(typeHint.replacingOccurrences(of: "、", with: ", "))"
                ))
                continue
            }
            let column = (name?.isEmpty == false ? name : nil) ?? typeText
            fields.append(Field(name: column, type: type, args: args ?? preset))
        }
        return (fields, warnings)
    }

    /// 字段名：空名补 field_N，重复名自动加后缀
    public static func resolveColumnNames(_ names: [String], lang: Lang) -> (columns: [String], warnings: [String]) {
        var used = Set<String>()
        var warnings: [String] = []
        var columns: [String] = []
        for (i, raw) in names.enumerated() {
            var name = raw.trimmingCharacters(in: .whitespaces)
            if name.isEmpty {
                name = "field_\(i + 1)"
                warnings.append(lang.t("第 \(i + 1) 个字段没有名称，已使用「\(name)」", "Field \(i + 1) has no name; using “\(name)”"))
            }
            if used.contains(name) {
                var k = 2
                while used.contains("\(name)_\(k)") { k += 1 }
                warnings.append(lang.t("字段名「\(name)」重复，已改为「\(name)_\(k)」", "Duplicate field name “\(name)” renamed to “\(name)_\(k)”"))
                name = "\(name)_\(k)"
            }
            used.insert(name)
            columns.append(name)
        }
        return (columns, warnings)
    }

    // MARK: 参数

    private static let rangePattern = Pattern(#"^\s*(-?[0-9]+(?:\.[0-9]+)?)\s*(?:~|～|\.\.|-|,|，|到|至)\s*(-?[0-9]+(?:\.[0-9]+)?)\s*(?:[,，;；]\s*([0-9]+))?\s*$"#)
    private static let singleNumber = Pattern(#"^\s*(-?[0-9]+(?:\.[0-9]+)?)\s*$"#)

    /// 「min-max[,小数位]」形式的参数
    static func range(_ args: String) -> (lo: Double, hi: Double, decimals: Int?)? {
        guard let m = rangePattern.match(args), let lo = Double(m[1] ?? ""), let hi = Double(m[2] ?? "") else { return nil }
        return (lo, hi, m[3].flatMap { Int($0) })
    }

    static func words(_ args: String) -> [String] {
        args.split(whereSeparator: { ",，|/、;； ".contains($0) }).map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
    }

    /// 枚举值：支持英文 / 中文逗号、竖线和换行
    public static func parseEnumValues(_ text: String) -> [String] {
        text.split(whereSeparator: { ",，|\n".contains($0) || $0 == "\r\n" }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    // MARK: 生成器

    struct Context {
        let locale: Locale
        let lang: Lang
        let nowMs: Int64
    }

    typealias Generator = (Rng, Int) -> Cell

    static let allDistricts: [(p: MockDict.Province, c: MockDict.City, d: MockDict.District)] =
        MockDict.regions.flatMap { p in p.cities.flatMap { c in c.districts.map { (p, c, $0) } } }
    static let allCities: [(p: MockDict.Province, c: MockDict.City)] = MockDict.regions.flatMap { p in p.cities.map { (p, $0) } }
    static let lettersNoIO = Array("ABCDEFGHJKLMNPQRSTUVWXYZ").map(String.init)
    static let cityLetters = Array("ABCDEFGH").map(String.init)

    static func gender(_ rng: Rng, _ args: [String]) -> Bool {
        if args.contains(where: { ["male", "m", "男"].contains($0) }) { return true }
        if args.contains(where: { ["female", "f", "女"].contains($0) }) { return false }
        return rng.chance(0.5)
    }

    static func zhName(_ rng: Rng, male: Bool) -> String {
        let pool = male ? MockDict.givenMale : MockDict.givenFemale
        let surname = rng.weighted(MockDict.surnames)
        if rng.chance(0.2) { return surname + rng.pick(pool) }
        let a = rng.pick(pool)
        var b = rng.pick(pool)
        // 叠字名（婷婷、欢欢）偶尔出现在女名里，其它情况避免重复
        if b == a && !(!male && rng.chance(0.3)) { b = rng.pick(pool) }
        return surname + a + b
    }

    static func enFirst(_ rng: Rng, male: Bool) -> String { rng.pick(male ? MockDict.enFirstMale : MockDict.enFirstFemale) }

    static func zhSentence(_ rng: Rng, withTime: Bool = true) -> String {
        let time = withTime && rng.chance(0.4) ? rng.pick(MockDict.sentenceTimes) + "，" : ""
        let (verb, obj) = rng.pick(MockDict.sentenceActions)
        let body = rng.chance(0.5) ? "\(rng.pick(MockDict.advDone))\(verb)了\(obj)" : "\(rng.pick(MockDict.advTodo))\(verb)\(obj)"
        return "\(time)\(rng.pick(MockDict.sentenceSubjects))\(body)\(rng.chance(0.9) ? "。" : "！")"
    }

    static func enSentence(_ rng: Rng, withTime: Bool = true) -> String {
        var subject = rng.pick(MockDict.enSubjects)
        var time = ""
        if withTime && rng.chance(0.4) {
            time = rng.pick(MockDict.enTimes) + ", "
            subject = subject.prefix(1).lowercased() + subject.dropFirst()
        }
        let (past, base) = rng.pick(MockDict.enVerbs)
        let verb = rng.chance(0.5)
            ? (rng.chance(0.4) ? rng.pick(MockDict.enAdverbsDone) + " " : "") + past
            : rng.pick(MockDict.enModals) + " " + base
        return "\(time)\(subject) \(verb) \(rng.pick(MockDict.enObjects))\(rng.chance(0.9) ? "." : "!")"
    }

    static func regionText(_ p: MockDict.Province, _ c: MockDict.City, _ d: MockDict.District) -> String {
        p.municipality ? p.name + d.name : p.name + c.name + d.name
    }

    static func isPrivateOrReserved(_ a: Int, _ b: Int) -> Bool {
        a == 0 || a == 10 || a == 127 || a >= 224 || (a == 100 && (64...127).contains(b)) || (a == 169 && b == 254)
            || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168) || (a == 198 && (b == 18 || b == 19))
    }

    static func uuid(_ rng: Rng) -> String {
        var bytes = (0..<16).map { _ in UInt8(rng.int(0, 255)) }
        bytes[6] = (bytes[6] & 0x0F) | 0x40
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        return IDGenerator.bytesToUuid(bytes)
    }

    static func hslToRgb(_ h: Double, _ s: Double, _ l: Double) -> (Int, Int, Int) {
        let c = ColorConverter.hslToRgb(h, s, l)
        return (ColorConverter.jsRound(c.r * 255), ColorConverter.jsRound(c.g * 255), ColorConverter.jsRound(c.b * 255))
    }

    static func shuffle<T>(_ rng: Rng, _ list: inout [T]) {
        guard list.count > 1 else { return }
        for i in stride(from: list.count - 1, to: 0, by: -1) { list.swapAt(i, rng.int(0, i)) }
    }

    /// 为一列生成器；参数有问题时通过 warn 报告并回退默认值，永不抛错
    static func maker(_ f: Field, _ ctx: Context, _ warn: (String) -> Void) -> Generator {
        let zh = ctx.locale == .zh
        let lang = ctx.lang
        let w = words(f.args)
        switch f.type {
        case .autoId:
            let nums = f.args.split(whereSeparator: { ",，~ ".contains($0) }).compactMap { Int64($0) }
            let start = nums.first ?? 1
            let step = nums.count > 1 ? nums[1] : 1
            return { _, i in .int(start &+ Int64(i) &* step) }

        case .name:
            return { rng, _ in
                let male = gender(rng, w)
                return .string(zh ? zhName(rng, male: male) : "\(enFirst(rng, male: male)) \(rng.pick(MockDict.enLast))")
            }

        case .enName:
            return { rng, _ in
                let first = enFirst(rng, male: gender(rng, w))
                let last = rng.pick(MockDict.enLast)
                return .string(w.contains("first") ? first : w.contains("last") ? last : "\(first) \(last)")
            }

        case .username:
            return { rng, _ in
                let adj = rng.pick(MockDict.userAdj)
                let noun = rng.pick(MockDict.userNoun)
                let py = zh ? rng.pick(MockDict.pinyinNames) : rng.pick(MockDict.enFirstMale + MockDict.enFirstFemale).lowercased()
                switch rng.int(0, 4) {
                case 0: return .string("\(adj)_\(noun)")
                case 1: return .string("\(adj)\(noun.capitalizedFirst)\(rng.int(1, 9999))")
                case 2: return .string("\(py)\(rng.int(10, 9999))")
                case 3: return .string("\(noun).\(py)")
                default: return .string("\(py)_\(noun)")
                }
            }

        case .gender:
            let values = parseEnumValues(f.args)
            let list = values.isEmpty ? (zh ? ["男", "女"] : ["Male", "Female"]) : values
            return { rng, _ in .string(rng.pick(list)) }

        case .phone:
            let fmt = w.first { ["plain", "space", "dash", "intl", "paren"].contains($0) }
            if zh {
                return { rng, _ in
                    let p = rng.weighted(MockDict.phonePrefixes)
                    let a = rng.digits(4), b = rng.digits(4)
                    switch fmt {
                    case "space": return .string("\(p) \(a) \(b)")
                    case "dash": return .string("\(p)-\(a)-\(b)")
                    case "intl": return .string("+86 \(p)\(a)\(b)")
                    default: return .string(p + a + b)
                    }
                }
            }
            // 北美 555-0100 至 555-0199 是保留给虚构作品的号码
            return { rng, _ in
                let area = rng.pick(MockDict.usCities).area
                let line = "01" + rng.digits(2)
                switch fmt {
                case "plain": return .string("\(area)555\(line)")
                case "space": return .string("\(area) 555 \(line)")
                case "dash": return .string("\(area)-555-\(line)")
                case "intl": return .string("+1 \(area)-555-\(line)")
                default: return .string("(\(area)) 555-\(line)")
                }
            }

        case .email:
            var fixed: String?
            if let d = w.first(where: { $0.contains(".") }) {
                let domain = d.hasPrefix("@") ? String(d.dropFirst()) : d
                if Pattern(#"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$"#).test(domain) {
                    fixed = domain
                } else {
                    warn(lang.t("邮箱：自定义域名「\(d)」无效，已改用 example.com", "Email: the custom domain “\(d)” is invalid; using example.com"))
                    fixed = "example.com"
                }
            }
            let safe = w.contains("safe") || w.contains("example")
            return { rng, _ in
                let domain = fixed ?? (safe ? rng.pick(MockDict.safeEmailDomains) : rng.pick(zh ? MockDict.emailDomains : MockDict.enEmailDomains))
                if zh && domain == "qq.com" && rng.chance(0.6) {
                    return .string("\(rng.int(1, 9))\(rng.digits(rng.int(5, 9)))@\(domain)")
                }
                let first = rng.pick(rng.chance(0.5) ? MockDict.enFirstMale : MockDict.enFirstFemale).lowercased()
                let local: String
                switch rng.int(0, 3) {
                case 0: local = zh ? "\(rng.pick(MockDict.pinyinNames))\(rng.int(1, 9999))" : "\(first)\(rng.int(1, 99))"
                case 1: local = "\(first).\(rng.pick(MockDict.enLast).lowercased())"
                case 2: local = "\(rng.pick(MockDict.userAdj))_\(rng.pick(MockDict.userNoun))"
                default: local = zh ? "\(rng.pick(MockDict.pinyinNames)).\(rng.pick(MockDict.userNoun))" : "\(first.prefix(1)).\(rng.pick(MockDict.enLast).lowercased())"
                }
                return .string("\(local)@\(domain)")
            }

        case .idCard:
            if !zh {
                // 9 开头、组号 01–49 的 SSN 格式：既不是有效的 SSN，也不是有效的 ITIN
                return { rng, _ in .string("9\(rng.digits(2))-\(NumberText.pad(rng.int(1, 49)))-\(rng.digits(4))") }
            }
            var minAge = 18, maxAge = 60
            if let r = range(f.args) {
                minAge = Int(r.lo)
                maxAge = Int(r.hi)
            }
            minAge = min(120, max(0, minAge))
            maxAge = min(120, max(0, maxAge))
            if minAge > maxAge {
                warn(lang.t("身份证：最小年龄大于最大年龄，已自动交换", "ID card: the minimum age is above the maximum; swapped"))
                swap(&minAge, &maxAge)
            }
            let today = Timestamp.civilFromDays(Timestamp.floorDiv(ctx.nowMs, 86_400_000))
            let latest = Timestamp.daysFromCivil(today.year - Int64(minAge), today.month, min(today.day, Timestamp.daysInMonth(today.year - Int64(minAge), today.month)))
            let earliest = Timestamp.daysFromCivil(today.year - Int64(maxAge) - 1, today.month, min(today.day, Timestamp.daysInMonth(today.year - Int64(maxAge) - 1, today.month))) + 1
            let span = max(0, latest - earliest)
            return { rng, _ in
                let d = rng.pick(allDistricts).d
                let birth = Timestamp.civilFromDays(earliest + rng.int(0, span))
                let ymd = "\(birth.year)\(NumberText.pad(birth.month))\(NumberText.pad(birth.day))"
                // 顺序码 3 位，末位奇数为男、偶数为女
                let male = gender(rng, w)
                let order = NumberText.pad(rng.int(0, 99)) + String(rng.int(0, 4) * 2 + (male ? 1 : 0))
                let first17 = d.code + ymd + order
                return .string(first17 + idCardCheckDigit(first17))
            }

        case .address:
            let level = w.first { ["full", "detail", "region", "province", "city"].contains($0) } ?? "full"
            if zh {
                return { rng, _ in
                    let (p, c, d) = rng.pick(allDistricts)
                    switch level {
                    case "province": return .string(p.name)
                    case "city": return .string(c.name)
                    case "region": return .string(regionText(p, c, d))
                    case "detail":
                        return .string("\(regionText(p, c, d))\(rng.pick(MockDict.streets))\(rng.int(1, 999))号\(rng.pick(MockDict.communities))\(rng.int(1, 30))栋\(rng.int(1, 6))单元\(rng.int(1, 33))\(NumberText.pad(rng.int(1, 8)))室")
                    default: return .string("\(regionText(p, c, d))\(rng.pick(MockDict.streets))\(rng.int(1, 999))号")
                    }
                }
            }
            return { rng, _ in
                let c = rng.pick(MockDict.usCities)
                let street = "\(rng.int(1, 9999)) \(rng.pick(MockDict.enStreets)) \(rng.pick(MockDict.enStreetSuffixes))"
                let zip = c.zip + rng.digits(2)
                switch level {
                case "province": return .string(c.stateName)
                case "city": return .string(c.name)
                case "region": return .string("\(c.name), \(c.state)")
                case "detail": return .string("\(street) Apt \(rng.int(1, 30))\(rng.pick(["A", "B", "C", "D"])), \(c.name), \(c.state) \(zip)")
                default: return .string("\(street), \(c.name), \(c.state) \(zip)")
                }
            }

        case .zip:
            return zh
                ? { rng, _ in .string(String(rng.pick(allCities).c.zip.prefix(4)) + rng.digits(2)) }
                : { rng, _ in .string(rng.pick(MockDict.usCities).zip + rng.digits(2)) }

        case .company:
            let withCity = !w.contains("nocity")
            if !zh {
                return { rng, _ in
                    .string("\(rng.pick(MockDict.enCompanyBrands)) \(rng.pick(MockDict.enCompanyIndustries)) \(rng.weighted(MockDict.enCompanySuffixes))")
                }
            }
            return { rng, _ in
                let c = rng.pick(allCities).c
                let city = withCity ? (rng.chance(0.5) ? c.name : String(c.name.hasSuffix("市") ? c.name.dropLast() : Substring(c.name))) : ""
                let x = rng.next()
                let suffix = x < 0.7 ? "有限公司" : x < 0.85 ? "股份有限公司" : x < 0.95 ? "有限责任公司" : "集团有限公司"
                return .string("\(city)\(rng.pick(MockDict.companyBrands))\(rng.pick(MockDict.companyIndustries))\(suffix)")
            }

        case .creditCode:
            if !zh { return { rng, _ in .string("\(rng.int(10, 99))-\(rng.digits(7))") } }
            return { rng, _ in
                let x = rng.next()
                let head = x < 0.85 ? "91" : x < 0.92 ? "92" : x < 0.96 ? "52" : "12"
                let region = rng.pick(allDistricts).d.code
                let body = rng.chance(0.6) ? "MA" + String((0..<6).map { _ in rng.pick(creditCodeChars) }) : rng.digits(8)
                let first17 = head + region + body + orgCodeCheckChar(body)
                return .string(first17 + (creditCodeCheckChar(first17) ?? "0"))
            }

        case .bankCard:
            let len = w.contains("16") ? 16 : w.contains("19") ? 19 : (zh ? 19 : 16)
            let spaced = w.contains("spaced") || w.contains("space")
            return { rng, _ in
                // 中文用以 62 开头的银联 BIN，英文用 4 开头（Visa 号段）
                let bin = zh ? rng.pick(MockDict.bankBins) : "4" + rng.digits(5)
                let payload = bin + rng.digits(len - bin.count - 1)
                let card = payload + luhnCheckDigit(payload)
                guard spaced else { return .string(card) }
                let chars = Array(card)
                return .string(stride(from: 0, to: chars.count, by: 4).map { String(chars[$0..<min($0 + 4, chars.count)]) }.joined(separator: " "))
            }

        case .plate:
            if !zh {
                return { rng, _ in .string("\(rng.int(1, 9))\((0..<3).map { _ in rng.pick(lettersNoIO) }.joined())\(rng.digits(3))") }
            }
            let kind = w.first { ["normal", "ev", "mixed"].contains($0) } ?? "normal"
            return { rng, _ in
                let ev = kind == "ev" || (kind == "mixed" && rng.chance(0.3))
                let prefix = rng.pick(MockDict.regions).short + rng.pick(cityLetters)
                if ev {
                    let second = rng.chance(0.5) ? String(rng.int(0, 9)) : rng.pick(lettersNoIO)
                    return .string("\(prefix)\(rng.pick(["D", "F"]))\(second)\(rng.digits(4))")
                }
                var s = ""
                var letters = 0
                for _ in 0..<5 {
                    if letters < 2 && rng.chance(0.2) {
                        s += rng.pick(lettersNoIO)
                        letters += 1
                    } else {
                        s += String(rng.int(0, 9))
                    }
                }
                return .string(prefix + s)
            }

        case .ipv4:
            let kind = w.first { ["public", "private", "any"].contains($0) } ?? "public"
            return { rng, _ in
                let tail = { "\(rng.int(0, 255)).\(rng.int(1, 254))" }
                switch kind {
                case "private":
                    switch rng.int(0, 2) {
                    case 0: return .string("10.\(rng.int(0, 255)).\(tail())")
                    case 1: return .string("172.\(rng.int(16, 31)).\(tail())")
                    default: return .string("192.168.\(tail())")
                    }
                case "any": return .string("\(rng.int(1, 223)).\(rng.int(0, 255)).\(tail())")
                default:
                    for _ in 0..<1000 {
                        let a = rng.int(1, 223), b = rng.int(0, 255)
                        if !isPrivateOrReserved(a, b) { return .string("\(a).\(b).\(tail())") }
                    }
                    return .string("8.8.\(tail())")
                }
            }

        case .url:
            return { rng, _ in
                let word = rng.pick(zh ? MockDict.urlWords : MockDict.enUrlWords)
                let host = "\(rng.chance(0.7) ? "www." : "")\(word)\(rng.chance(0.3) ? "-tech" : "").\(rng.pick(zh ? MockDict.urlTlds : MockDict.enUrlTlds))"
                switch rng.int(0, 3) {
                case 0: return .string("https://\(host)")
                case 1: return .string("https://\(host)/\(rng.pick(MockDict.urlPaths))")
                case 2: return .string("https://\(host)/\(rng.pick(MockDict.urlPaths))/\(rng.int(1, 99999))")
                default: return .string("https://\(host)/\(rng.pick(MockDict.urlPaths))?id=\(rng.int(1, 99999))")
                }
            }

        case .uuid:
            return { rng, _ in
                let u = uuid(rng)
                return .string(w.contains("upper") ? u.uppercased() : w.contains("compact") ? u.replacingOccurrences(of: "-", with: "") : u)
            }

        case .color:
            return { rng, _ in
                let h = rng.int(0, 359), s = rng.int(35, 95), l = rng.int(30, 75)
                if w.contains("hsl") { return .string("hsl(\(h), \(s)%, \(l)%)") }
                let (r, g, b) = hslToRgb(Double(h), Double(s) / 100, Double(l) / 100)
                if w.contains("rgb") { return .string("rgb(\(r), \(g), \(b))") }
                return .string("#" + [r, g, b].map { ($0 < 16 ? "0" : "") + String($0, radix: 16) }.joined())
            }

        case .int:
            var lo = 0.0, hi = 100.0
            if let r = range(f.args) {
                (lo, hi) = (max(-1e15, min(1e15, r.lo)), max(-1e15, min(1e15, r.hi)))
            } else if !f.args.isEmpty {
                warn(lang.t("整数：参数「\(f.args)」无法识别，请写成 int(1-100)", "Integer: can’t read “\(f.args)”; write int(1-100)"))
            }
            if lo > hi {
                warn(lang.t("整数：最小值大于最大值，已自动交换", "Integer: the minimum is above the maximum; swapped"))
                swap(&lo, &hi)
            }
            var a = Int64(lo.rounded(.up)), b = Int64(hi.rounded(.down))
            if a > b {
                a = Int64(lo.rounded())
                b = a
                warn(lang.t("整数：\(NumberText.js(lo))–\(NumberText.js(hi)) 之间没有整数，已固定为 \(a)",
                            "Integer: there’s no integer between \(NumberText.js(lo)) and \(NumberText.js(hi)); using \(a)"))
            }
            return { rng, _ in .int(rng.int(a, b)) }

        case .float:
            var lo = 0.0, hi = 1000.0, dec = 2
            if let r = range(f.args) {
                (lo, hi) = (max(-1e15, min(1e15, r.lo)), max(-1e15, min(1e15, r.hi)))
                dec = min(10, max(0, r.decimals ?? 2))
            } else if !f.args.isEmpty {
                warn(lang.t("小数：参数「\(f.args)」无法识别，请写成 float(0-1000,2)", "Decimal: can’t read “\(f.args)”; write float(0-1000,2)"))
            }
            if lo > hi {
                warn(lang.t("小数：最小值大于最大值，已自动交换", "Decimal: the minimum is above the maximum; swapped"))
                swap(&lo, &hi)
            }
            return { rng, _ in
                let v = Double(String(format: "%.\(dec)f", lo + rng.next() * (hi - lo))) ?? lo
                return .number(NumberText.js(min(hi, max(lo, v))))
            }

        case .datetime:
            var start = parseWallTime("2020-01-01 00:00:00") ?? 0
            var end = parseWallTime("2025-12-31 23:59:59") ?? 0
            var format = DateFormat.datetime
            for part in f.args.split(whereSeparator: { $0 == "," || $0 == "，" }) {
                let p = part.trimmingCharacters(in: .whitespaces)
                if let fm = DateFormat(rawValue: p.lowercased()) {
                    format = fm
                    continue
                }
                let bounds = p.components(separatedBy: "~").flatMap { $0.components(separatedBy: "～") }
                if bounds.count == 2 {
                    if let s = parseWallTime(bounds[0]) { start = s } else {
                        warn(lang.t("日期时间：开始时间「\(bounds[0])」无法识别，请用 2024-01-31 或 2024-01-31 08:00:00",
                                    "Date: can’t read the start “\(bounds[0])”; use 2024-01-31 or 2024-01-31 08:00:00"))
                    }
                    if let e = parseWallTime(bounds[1]) { end = e } else {
                        warn(lang.t("日期时间：结束时间「\(bounds[1])」无法识别，请用 2024-12-31 或 2024-12-31 23:59:59",
                                    "Date: can’t read the end “\(bounds[1])”; use 2024-12-31 or 2024-12-31 23:59:59"))
                    }
                } else if !p.isEmpty {
                    warn(lang.t("日期时间：参数「\(p)」无法识别，可写格式（date / time / iso / ts / tsms）或范围 2024-01-01~2024-12-31",
                                "Date: can’t read “\(p)”; use a format (date / time / iso / ts / tsms) or a range like 2024-01-01~2024-12-31"))
                }
            }
            if start > end {
                warn(lang.t("日期时间：开始晚于结束，已自动交换", "Date: the start is after the end; swapped"))
                swap(&start, &end)
            }
            let (s0, s1) = (Timestamp.floorDiv(start, 1000), Timestamp.floorDiv(end, 1000))
            let offset = zh ? 8 : 0
            return { rng, _ in formatWallTime(rng.int(s0, s1) * 1000, format, offsetHours: offset) }

        case .bool:
            let ratio = range(f.args).map(\.lo) ?? w.compactMap { Double($0.replacingOccurrences(of: "%", with: "")) }.first ?? 50
            let p = min(100, max(0, ratio)) / 100
            let style = w.first { ["number", "zh", "yesno", "text"].contains($0) }
            return { rng, _ in
                let v = rng.next() < p
                switch style {
                case "number": return .int(v ? 1 : 0)
                case "zh", "yesno", "text": return .string(zh ? (v ? "是" : "否") : (v ? "Yes" : "No"))
                default: return .bool(v)
                }
            }

        case .enumValues:
            var values = parseEnumValues(f.args)
            if values == ["status"] { values = zh ? ["待处理", "进行中", "已完成", "已取消"] : ["pending", "active", "done", "cancelled"] }
            if values.isEmpty {
                warn(lang.t("枚举「\(f.name)」：没有可选值，请写成 enum(男|女)", "Enum “\(f.name)”: no values; write enum(a|b|c)"))
            }
            return { rng, _ in values.isEmpty ? .string("") : .string(rng.pick(values)) }

        case .password:
            let len = min(128, max(4, Int(range(f.args)?.lo ?? w.compactMap { Double($0) }.first ?? 12)))
            let classes = w.contains("nosymbols") || w.contains("nosymbol")
                ? ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789"]
                : ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*-_=+?"]
            let groups = classes.map { $0.map(String.init) }
            let all = groups.flatMap { $0 }
            return { rng, _ in
                var chars = groups.map { rng.pick($0) }
                while chars.count < len { chars.append(rng.pick(all)) }
                shuffle(rng, &chars)
                return .string(chars.prefix(len).joined())
            }

        case .sentence:
            return { rng, _ in .string(zh ? zhSentence(rng) : enSentence(rng)) }

        case .paragraph:
            var lo = 3, hi = 6
            if let r = range(f.args) {
                lo = min(30, max(1, Int(r.lo)))
                hi = min(30, max(1, Int(r.hi)))
            }
            if lo > hi {
                warn(lang.t("段落：最少句数大于最多句数，已自动交换", "Paragraph: the minimum sentence count is above the maximum; swapped"))
                swap(&lo, &hi)
            }
            return { rng, _ in
                let n = rng.int(lo, hi)
                var parts: [String] = []
                for i in 0..<n {
                    if i > 0 && rng.chance(0.3) {
                        if zh {
                            parts.append(rng.pick(MockDict.sentenceConnectors) + zhSentence(rng, withTime: false))
                        } else {
                            let connector = rng.pick(MockDict.enConnectors)
                            let sentence = enSentence(rng, withTime: false)
                            parts.append(connector + sentence.prefix(1).lowercased() + sentence.dropFirst())
                        }
                    } else {
                        parts.append(zh ? zhSentence(rng) : enSentence(rng))
                    }
                }
                return .string(parts.joined(separator: zh ? "" : " "))
            }
        }
    }

    public struct Generated: Sendable {
        public var columns: [String]
        public var rows: [[Cell]]
        public var warnings: [String]
    }

    public static let maxRows = 1000

    /// 生成 count 行数据（1–1000），永不抛错
    public static func generate(_ fields: [Field], count: Int, seed: UInt32, locale: Locale, nowMs: Int64, lang: Lang) -> Generated {
        let resolved = resolveColumnNames(fields.map(\.name), lang: lang)
        let columns = resolved.columns
        var warnings = resolved.warnings
        let n = min(maxRows, max(1, count))
        let ctx = Context(locale: locale, lang: lang, nowMs: nowMs)
        let gens: [(Generator, Rng)] = zip(fields, columns).map { f, col in
            (maker(f, ctx, { warnings.append($0) }), Rng(seed: hashString("\(seed):\(col)")))
        }
        var rows: [[Cell]] = []
        rows.reserveCapacity(n)
        for i in 0..<n { rows.append(gens.map { gen, rng in gen(rng, i) }) }
        var seen = Set<String>()
        return Generated(columns: columns, rows: rows, warnings: warnings.filter { seen.insert($0).inserted })
    }
}
