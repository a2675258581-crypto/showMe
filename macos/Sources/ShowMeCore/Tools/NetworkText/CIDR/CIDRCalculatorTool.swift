import Foundation

public enum CIDRCalculatorTool {
    static let splitLimit = 256

    public static let spec = ToolSpec(
        id: "cidr-calculator",
        name: LocalizedText("IP 子网计算", "IP Subnet Calculator"),
        summary: LocalizedText(
            "根据 CIDR 计算网络地址、广播地址、掩码与可用主机范围。",
            "Work out the network, broadcast, mask and usable host range from a CIDR."
        ),
        category: .network,
        keywords: ["ip", "cidr", "subnet", "mask", "ipv4", "ipv6", "network", "子网", "掩码", "zwjs"],
        symbol: "network",
        input: .required,
        inputLabel: LocalizedText("IP / CIDR，如 192.168.1.10/24、10.0.0.1 255.255.255.0、起始 - 结束、2001:db8::/32",
                                  "IP / CIDR, e.g. 192.168.1.10/24, 10.0.0.1 255.255.255.0, start - end, 2001:db8::/32"),
        fields: [
            ToolField("prefix", LocalizedText("前缀 / 掩码", "Prefix / mask"),
                      .text(placeholder: LocalizedText("24 或 255.255.255.0", "24 or 255.255.255.0")),
                      help: LocalizedText("输入里没有写前缀时使用", "Used when the input has no prefix")),
            ToolField("split", LocalizedText("划分子网", "Split into subnets"), .choice([
                ToolChoice("none", LocalizedText("不划分", "Off")),
                ToolChoice("count", LocalizedText("按子网数", "By count")),
                ToolChoice("hosts", LocalizedText("按主机数", "By hosts")),
                ToolChoice("prefix", LocalizedText("按新前缀", "By prefix")),
            ]), default: "none"),
            ToolField("splitCount", LocalizedText("需要的子网数", "Number of subnets"), .number(min: 1, max: 65536), default: "4",
                      visibleWhen: ToolCondition("split", is: "count")),
            ToolField("splitHosts", LocalizedText("每个子网的主机数", "Hosts per subnet"), .number(min: 1, max: 16_777_216), default: "50",
                      visibleWhen: ToolCondition("split", is: "hosts")),
            ToolField("splitPrefix", LocalizedText("新前缀", "New prefix"), .number(min: 0, max: 32), default: "26",
                      visibleWhen: ToolCondition("split", is: "prefix")),
        ],
        run: { try run($0) }
    )

    public static func run(_ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        // 多行时只看第一行非空内容
        let normalized = IPv4.normalizeInput(input.text)
        let line = normalized.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty } ?? ""
        do {
            if let range = try IPv4.parseRange(line) { return try rangeResult(range.start, range.end, lang) }
            let addr = line.split(separator: "/").first.map(String.init) ?? line
            if addr.contains(":") { return try v6Result(line, input) }
            return try v4Result(line, input)
        } catch let e as IPError {
            throw ToolError(e.message(lang))
        }
    }

    static func t(_ lang: Lang, _ zh: String, _ en: String) -> String { lang.t(zh, en) }

    static func tagText(_ tags: [IPAddressTag], _ lang: Lang) -> String {
        tags.map { "\($0.label(lang)) — \($0.detail(lang))" }.joined(separator: "\n")
    }

    // MARK: IPv4

    static func v4Result(_ line: String, _ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        var parsed = try IPv4.parseInput(line)
        let extra = IPv4.normalizeInput(input.string("prefix")).trimmingCharacters(in: .whitespacesAndNewlines)
        if parsed.via == .none, !extra.isEmpty {
            let p = try IPv4.parsePrefixOrMask(extra)
            parsed.prefix = p.prefix
            parsed.via = p.via
        }
        let info = IPv4.info(parsed.ip, prefix: parsed.prefix)
        let s = IPv4.string
        let n = IPv4.formatGrouped
        var notes: [ToolNote] = []
        switch parsed.via {
        case .mask: notes.append(ToolNote(.info, t(lang, "已按子网掩码 \(s(info.mask)) 识别为 /\(info.prefix)", "Read the subnet mask \(s(info.mask)) as /\(info.prefix)")))
        case .wildcard: notes.append(ToolNote(.info, t(lang, "已按反掩码（通配符）\(s(info.wildcard)) 识别为 /\(info.prefix)", "Read the wildcard mask \(s(info.wildcard)) as /\(info.prefix)")))
        case .none: notes.append(ToolNote(.info, t(lang, "未指定前缀，按单个主机 /32 计算", "No prefix given; calculated as a single host /32")))
        case .cidr: break
        }
        let hostNote = info.prefix == 32
            ? t(lang, "单个主机地址", "a single host address")
            : info.prefix == 31 ? t(lang, "点对点链路，两端都可用（RFC 3021）", "point-to-point link, both ends usable (RFC 3021)")
            : t(lang, "不含网络地址与广播地址", "excluding the network and broadcast addresses")
        let cls = IPv4.addressClass(info.ip)
        let none = t(lang, "无", "None")
        var outputs: [ToolOutput] = [
            .primary(t(lang, "所在网段", "Network (CIDR)"), info.cidr, language: "plain"),
            ToolOutput(id: "network", label: t(lang, "网络地址", "Network address"), value: s(info.network)),
            ToolOutput(id: "broadcast", label: t(lang, "广播地址", "Broadcast address"),
                       value: info.prefix >= 31 ? t(lang, "无（/31、/32 没有广播地址）", "None (/31 and /32 have no broadcast address)") : s(info.broadcast)),
            ToolOutput(id: "mask", label: t(lang, "子网掩码", "Netmask"), value: "\(s(info.mask)) (/\(info.prefix) · \(IPv4.hex(info.mask)))"),
            ToolOutput(id: "wildcard", label: t(lang, "反掩码（通配符）", "Wildcard mask"), value: s(info.wildcard)),
            ToolOutput(id: "first", label: t(lang, "首个可用地址", "First host"), value: s(info.first)),
            ToolOutput(id: "last", label: t(lang, "最后可用地址", "Last host"), value: s(info.last)),
            ToolOutput(id: "range", label: t(lang, "可用范围", "Host range"), value: "\(s(info.first)) - \(s(info.last))"),
            ToolOutput(id: "hosts", label: t(lang, "可用主机数", "Usable hosts"),
                       value: t(lang, "\(n(info.usable))（共 \(n(info.total)) 个地址，\(hostNote)）", "\(n(info.usable)) (\(n(info.total)) addresses in total, \(hostNote))"), style: .prose),
            ToolOutput(id: "class", label: t(lang, "地址类别", "Address class"),
                       value: t(lang, "\(cls.cls) 类 · \(cls.note.zh)", "Class \(cls.cls) · \(cls.note.en)"), style: .prose),
            ToolOutput(id: "type", label: t(lang, "地址类型", "Address type"), value: tagText(IPv4.tags(info.ip), lang), style: .prose),
            ToolOutput(id: "binary", label: t(lang, "二进制", "Binary"), value: [
                "IP        " + IPv4.dottedBinary(info.ip),
                t(lang, "掩码      ", "Mask      ") + IPv4.dottedBinary(info.mask),
                t(lang, "网络      ", "Network   ") + IPv4.dottedBinary(info.network),
                t(lang, "广播      ", "Broadcast ") + IPv4.dottedBinary(info.broadcast),
            ].joined(separator: "\n")),
            ToolOutput(id: "hex", label: t(lang, "十六进制", "Hex"), value: IPv4.hex(info.ip)),
            ToolOutput(id: "integer", label: t(lang, "32 位整数", "32-bit integer"), value: String(info.ip)),
            ToolOutput(id: "ptr", label: t(lang, "反向解析（PTR）", "Reverse DNS (PTR)"), value: IPv4.reverseDNS(info.ip)),
            ToolOutput(id: "mapped", label: t(lang, "IPv4 映射的 IPv6", "IPv4-mapped IPv6"), value: IPv4.mapped(info.ip)),
            ToolOutput(id: "previous", label: t(lang, "上一个子网", "Previous subnet"), value: info.previous.map { "\(s($0))/\(info.prefix)" } ?? none),
            ToolOutput(id: "next", label: t(lang, "下一个子网", "Next subnet"), value: info.next.map { "\(s($0))/\(info.prefix)" } ?? none),
        ]
        var table: ToolTable?
        let mode = input.string("split")
        if mode != "none", !mode.isEmpty {
            let newPrefix: Int
            switch mode {
            case "count": newPrefix = try IPv4.prefix(forSubnetCount: input.int("splitCount", default: 4), from: info.prefix)
            case "hosts": newPrefix = try IPv4.prefix(forHostCount: input.int("splitHosts", default: 50), from: info.prefix)
            default: newPrefix = input.int("splitPrefix", default: min(32, info.prefix + 2))
            }
            let res = try IPv4.split(info.network, prefix: info.prefix, into: newPrefix, limit: splitLimit)
            table = ToolTable(
                columns: lang == .zh ? ["#", "子网", "首个可用", "最后可用", "广播地址", "可用主机"] : ["#", "Subnet", "First host", "Last host", "Broadcast", "Usable"],
                rows: res.rows.enumerated().map { i, r in
                    [String(i + 1), "\(s(r.network))/\(r.prefix)", s(r.first), s(r.last), r.prefix >= 31 ? "—" : s(r.broadcast), n(r.usable)]
                }
            )
            outputs.append(ToolOutput(id: "subnets", label: t(lang, "子网列表", "Subnets"), value: res.rows.map { "\(s($0.network))/\($0.prefix)" }.joined(separator: "\n")))
            notes.append(ToolNote(.info, t(lang, "划分为 \(n(res.total)) 个 /\(newPrefix) 子网，每个可用 \(n(res.rows.first?.usable ?? 0)) 台主机",
                                           "Split into \(n(res.total)) /\(newPrefix) subnets with \(n(res.rows.first?.usable ?? 0)) usable hosts each")))
            if res.total > UInt64(splitLimit) {
                notes.append(ToolNote(.warning, t(lang, "子网太多，只列出前 \(splitLimit) 个", "Too many subnets; only the first \(splitLimit) are listed")))
            }
        }
        return ToolResult(outputs: outputs, notes: notes, table: table)
    }

    // MARK: 范围

    static func rangeResult(_ start: UInt32, _ end: UInt32, _ lang: Lang) throws -> ToolResult {
        let blocks = try IPv4.rangeToCIDRs(start, end)
        let s = IPv4.string
        let count = UInt64(end) - UInt64(start) + 1
        let rows = blocks.enumerated().map { i, b -> [String] in
            let info = IPv4.info(b.network, prefix: b.prefix)
            return [String(i + 1), "\(s(b.network))/\(b.prefix)", s(info.network), s(info.broadcast), IPv4.formatGrouped(info.total)]
        }
        return ToolResult(
            outputs: [
                .primary(t(lang, "CIDR 列表", "CIDR blocks"), blocks.map { "\(s($0.network))/\($0.prefix)" }.joined(separator: "\n"), language: "plain"),
                ToolOutput(id: "start", label: t(lang, "起始地址", "Start"), value: s(start)),
                ToolOutput(id: "end", label: t(lang, "结束地址", "End"), value: s(end)),
                ToolOutput(id: "count", label: t(lang, "地址数量", "Addresses"), value: IPv4.formatGrouped(count)),
            ],
            notes: [ToolNote(.info, t(lang, "这个范围最少需要 \(blocks.count) 个 CIDR 块", "This range needs at least \(blocks.count) CIDR blocks"))],
            table: ToolTable(columns: lang == .zh ? ["#", "CIDR", "起始", "结束", "地址数"] : ["#", "CIDR", "From", "To", "Addresses"], rows: rows)
        )
    }

    // MARK: IPv6

    static func v6Result(_ line: String, _ input: ToolInput) throws -> ToolResult {
        let lang = input.lang
        var parsed = try IPv6.parseInput(line)
        var notes: [ToolNote] = []
        let extra = IPv4.normalizeInput(input.string("prefix")).trimmingCharacters(in: .whitespacesAndNewlines)
        if !parsed.hasPrefix {
            if !extra.isEmpty {
                let p = extra.hasPrefix("/") ? String(extra.dropFirst()) : extra
                parsed.prefix = try IPv4.parsePrefix(p.trimmingCharacters(in: .whitespaces), max: 128)
            } else {
                notes.append(ToolNote(.info, t(lang, "未指定前缀，按 /128 计算", "No prefix given; calculated as /128")))
            }
        }
        let info = IPv6.info(parsed.address, prefix: parsed.prefix)
        let a = info.address
        var outputs: [ToolOutput] = [
            .primary(t(lang, "网络前缀", "Network prefix"), info.cidr, language: "plain"),
            ToolOutput(id: "compressed", label: t(lang, "压缩格式（RFC 5952）", "Compressed (RFC 5952)"), value: a.compressed),
            ToolOutput(id: "expanded", label: t(lang, "完整格式", "Expanded"), value: a.expanded),
            ToolOutput(id: "first", label: t(lang, "起始地址", "First address"), value: info.network.compressed),
            ToolOutput(id: "last", label: t(lang, "结束地址", "Last address"), value: info.last.compressed),
            ToolOutput(id: "count", label: t(lang, "地址数量", "Addresses"),
                       value: info.hostBits <= 20 ? IPv6.pow2(info.hostBits) : "\(IPv6.pow2Short(info.hostBits)) = \(IPv6.pow2(info.hostBits))"),
        ]
        if info.prefix <= 64 {
            let bits = 64 - info.prefix
            outputs.append(ToolOutput(id: "subnets64", label: t(lang, "可划分的 /64 子网", "/64 subnets"),
                                      value: bits <= 20 ? IPv6.pow2(bits) : "\(IPv6.pow2Short(bits)) = \(IPv6.pow2(bits))"))
        } else {
            outputs.append(ToolOutput(id: "hostBits", label: t(lang, "主机位", "Host bits"), value: t(lang, "\(info.hostBits) 位", "\(info.hostBits) bits")))
        }
        outputs.append(ToolOutput(id: "type", label: t(lang, "地址类型", "Address type"), value: tagText(IPv6.tags(a), lang), style: .prose))
        if let zone = parsed.zone { outputs.append(ToolOutput(id: "zone", label: t(lang, "区域 ID", "Zone ID"), value: "%" + zone)) }
        outputs.append(ToolOutput(id: "binary", label: t(lang, "二进制", "Binary"), value: a.binary))
        outputs.append(ToolOutput(id: "ptr", label: t(lang, "反向解析（PTR）", "Reverse DNS (PTR)"), value: a.reverseDNS()))
        if info.prefix % 4 == 0, info.prefix > 0, info.prefix < 128 {
            outputs.append(ToolOutput(id: "zone-ptr", label: t(lang, "反向解析区域", "Reverse zone"), value: info.network.reverseDNS(prefix: info.prefix)))
        }
        if input.string("split") != "none", !input.string("split").isEmpty {
            notes.append(ToolNote(.warning, t(lang, "子网划分只支持 IPv4", "Subnet splitting only supports IPv4")))
        }
        return ToolResult(outputs: outputs, notes: notes)
    }
}
