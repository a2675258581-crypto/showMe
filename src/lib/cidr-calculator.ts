/**
 * IPv4 / IPv6 子网计算（纯函数，无 DOM 依赖）。
 * IPv4 用无符号 32 位整数（number）表示，IPv6 用 BigInt；出错时抛出带中文说明的 IpError。
 */

export class IpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IpError'
  }
}

export interface AddrTag {
  id: string
  label: string
  /** 悬停说明，含 RFC 出处 */
  desc: string
  /** CSS 颜色（设计 token 变量） */
  color: string
}

// ═════════════════════════ 输入规范化 ═════════════════════════

/**
 * 中文输入法常见的全角字符转半角：１９２。１６８．１．１／２４ → 192.168.1.1/24。
 * NFKC 负责全角数字 / 字母 / 符号，句号「。」需要单独替换。
 */
export function normalizeIpInput(input: string): string {
  return input.normalize('NFKC').replace(/[。｡]/g, '.')
}

// ═════════════════════════ IPv4 ═════════════════════════

const U32 = 2 ** 32

/** 严格解析点分十进制 IPv4；拒绝前导零（010 可能被当成八进制） */
export function parseIPv4(input: string): number {
  const s = input.trim()
  if (!s) throw new IpError('请输入 IPv4 地址')
  const parts = s.split('.')
  if (parts.length !== 4) {
    throw new IpError(
      `IPv4 地址应为 4 段、用点分隔（如 192.168.1.10），「${s}」有 ${parts.length} 段`,
    )
  }
  let n = 0
  parts.forEach((p, i) => {
    const k = i + 1
    if (p === '') throw new IpError(`第 ${k} 段为空（「${s}」）`)
    if (!/^\d+$/.test(p)) throw new IpError(`第 ${k} 段「${p}」不是十进制数字`)
    if (p.length > 1 && p[0] === '0') {
      throw new IpError(`第 ${k} 段「${p}」有前导零，可能被解析为八进制，请写成 ${Number(p)}`)
    }
    const v = Number(p)
    if (v > 255) throw new IpError(`第 ${k} 段 ${p} 超出范围（每段应为 0–255）`)
    n = n * 256 + v
  })
  return n
}

export function ipv4ToString(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

export function isValidIPv4(s: string): boolean {
  try {
    parseIPv4(s)
    return true
  } catch {
    return false
  }
}

export function prefixToMask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
}

/** 连续的子网掩码 → 前缀长度；不连续返回 null */
export function maskToPrefix(mask: number): number | null {
  const inv = ~mask >>> 0
  // 反码 + 1 必须是 2 的幂（即反码形如 0…01…1）
  if ((inv & (inv + 1)) !== 0) return null
  let p = 32
  let x = inv
  while (x) {
    p--
    x >>>= 1
  }
  return p
}

export function ipv4Binary(n: number): string {
  return (n >>> 0).toString(2).padStart(32, '0')
}

export interface IPv4Input {
  ip: number
  prefix: number
  /** 前缀来源：CIDR 写法、子网掩码、反掩码、未提供 */
  via: 'cidr' | 'mask' | 'wildcard' | 'none'
}

function parsePrefix(s: string, max: number): number {
  if (!/^\d{1,3}$/.test(s)) throw new IpError(`前缀长度「${s}」应为 0–${max} 的整数`)
  const p = Number(s)
  if (p > max) throw new IpError(`前缀长度 /${p} 超出范围（应为 0–${max}）`)
  return p
}

function parseMaskOrWildcard(s: string): { prefix: number; via: 'mask' | 'wildcard' } {
  let m: number
  try {
    m = parseIPv4(s)
  } catch (e) {
    throw new IpError(`掩码「${s}」无效：${(e as Error).message}`)
  }
  const asMask = maskToPrefix(m)
  if (asMask !== null) return { prefix: asMask, via: 'mask' }
  const asWildcard = maskToPrefix(~m >>> 0)
  if (asWildcard !== null) return { prefix: asWildcard, via: 'wildcard' }
  throw new IpError(
    `「${s}」既不是连续的子网掩码（如 255.255.255.0），也不是反掩码（如 0.0.0.255）`,
  )
}

/**
 * 解析 IPv4 输入：192.168.1.10/24、192.168.1.10/255.255.255.0、
 * 192.168.1.10 255.255.255.0（掩码）、10.0.0.1 0.0.0.255（反掩码）、单个 IP（按 /32）。
 * 0.0.0.0 与 255.255.255.255 既可当掩码也可当反掩码，优先按子网掩码理解。
 */
export function parseIPv4Input(input: string): IPv4Input {
  const s = input.trim().replace(/\s*\/\s*/, '/')
  if (!s) throw new IpError('请输入 IPv4 地址，如 192.168.1.10/24')
  const slash = s.indexOf('/')
  if (slash >= 0) {
    const ip = parseIPv4(s.slice(0, slash))
    const rest = s.slice(slash + 1).trim()
    if (!rest) throw new IpError('「/」后缺少前缀长度或掩码')
    if (rest.includes('.')) return { ip, ...parseMaskOrWildcard(rest) }
    return { ip, prefix: parsePrefix(rest, 32), via: 'cidr' }
  }
  const parts = s.split(/[\s,]+/).filter(Boolean)
  if (parts.length > 2) throw new IpError('格式应为「IP/前缀」「IP 掩码」或「IP 反掩码」')
  const ip = parseIPv4(parts[0])
  if (parts.length === 1) return { ip, prefix: 32, via: 'none' }
  return { ip, ...parseMaskOrWildcard(parts[1]) }
}

const V4_TAGS: { net: string; prefix: number; tag: AddrTag }[] = [
  {
    net: '255.255.255.255',
    prefix: 32,
    tag: {
      id: 'broadcast',
      label: '受限广播',
      desc: '本网段广播地址（RFC 919）',
      color: 'var(--sys-red)',
    },
  },
  {
    net: '0.0.0.0',
    prefix: 8,
    tag: {
      id: 'this-network',
      label: '本网络',
      desc: '0.0.0.0/8「本网络」，不可作为目的地址（RFC 1122）',
      color: 'var(--fg-2)',
    },
  },
  {
    net: '10.0.0.0',
    prefix: 8,
    tag: {
      id: 'private',
      label: '私有',
      desc: '私有地址 10.0.0.0/8（RFC 1918）',
      color: 'var(--sys-green)',
    },
  },
  {
    net: '172.16.0.0',
    prefix: 12,
    tag: {
      id: 'private',
      label: '私有',
      desc: '私有地址 172.16.0.0/12（RFC 1918）',
      color: 'var(--sys-green)',
    },
  },
  {
    net: '192.168.0.0',
    prefix: 16,
    tag: {
      id: 'private',
      label: '私有',
      desc: '私有地址 192.168.0.0/16（RFC 1918）',
      color: 'var(--sys-green)',
    },
  },
  {
    net: '100.64.0.0',
    prefix: 10,
    tag: {
      id: 'cgnat',
      label: 'CGNAT',
      desc: '运营商级 NAT 共享地址 100.64.0.0/10（RFC 6598）',
      color: 'var(--sys-orange)',
    },
  },
  {
    net: '127.0.0.0',
    prefix: 8,
    tag: {
      id: 'loopback',
      label: '回环',
      desc: '本机回环地址 127.0.0.0/8（RFC 1122）',
      color: 'var(--sys-purple)',
    },
  },
  {
    net: '169.254.0.0',
    prefix: 16,
    tag: {
      id: 'link-local',
      label: '链路本地',
      desc: '无 DHCP 时自动分配的链路本地地址（RFC 3927）',
      color: 'var(--sys-teal)',
    },
  },
  {
    net: '192.0.0.0',
    prefix: 24,
    tag: {
      id: 'reserved',
      label: '保留',
      desc: 'IETF 协议分配 192.0.0.0/24（RFC 6890）',
      color: 'var(--fg-2)',
    },
  },
  {
    net: '192.0.2.0',
    prefix: 24,
    tag: {
      id: 'documentation',
      label: '文档示例',
      desc: 'TEST-NET-1，仅用于文档示例（RFC 5737）',
      color: 'var(--sys-indigo)',
    },
  },
  {
    net: '198.51.100.0',
    prefix: 24,
    tag: {
      id: 'documentation',
      label: '文档示例',
      desc: 'TEST-NET-2，仅用于文档示例（RFC 5737）',
      color: 'var(--sys-indigo)',
    },
  },
  {
    net: '203.0.113.0',
    prefix: 24,
    tag: {
      id: 'documentation',
      label: '文档示例',
      desc: 'TEST-NET-3，仅用于文档示例（RFC 5737）',
      color: 'var(--sys-indigo)',
    },
  },
  {
    net: '192.88.99.0',
    prefix: 24,
    tag: {
      id: 'reserved',
      label: '保留',
      desc: '已废弃的 6to4 中继任播地址（RFC 7526）',
      color: 'var(--fg-2)',
    },
  },
  {
    net: '198.18.0.0',
    prefix: 15,
    tag: {
      id: 'benchmark',
      label: '基准测试',
      desc: '网络设备基准测试专用（RFC 2544）',
      color: 'var(--sys-cyan)',
    },
  },
  {
    net: '224.0.0.0',
    prefix: 4,
    tag: {
      id: 'multicast',
      label: '组播',
      desc: 'D 类组播地址 224.0.0.0/4（RFC 5771）',
      color: 'var(--sys-pink)',
    },
  },
  {
    net: '240.0.0.0',
    prefix: 4,
    tag: {
      id: 'reserved',
      label: '保留',
      desc: 'E 类保留地址 240.0.0.0/4（RFC 1112）',
      color: 'var(--fg-2)',
    },
  },
]

const PUBLIC_V4: AddrTag = {
  id: 'public',
  label: '公网',
  desc: '可在互联网上路由的公网地址',
  color: 'var(--sys-blue)',
}

function inV4(ip: number, net: string, prefix: number): boolean {
  const mask = prefixToMask(prefix)
  return (ip & mask) >>> 0 === (parseIPv4(net) & mask) >>> 0
}

/** 地址用途标签（取第一个匹配的特殊网段，都不匹配则为公网） */
export function ipv4Tags(ip: number): AddrTag[] {
  const hit = V4_TAGS.find((t) => inV4(ip, t.net, t.prefix))
  return [hit ? hit.tag : PUBLIC_V4]
}

export type IPv4Class = 'A' | 'B' | 'C' | 'D' | 'E'

export function ipv4Class(ip: number): { cls: IPv4Class; note: string } {
  const a = ip >>> 24
  if (a < 128) return { cls: 'A', note: '默认掩码 /8' }
  if (a < 192) return { cls: 'B', note: '默认掩码 /16' }
  if (a < 224) return { cls: 'C', note: '默认掩码 /24' }
  if (a < 240) return { cls: 'D', note: '组播' }
  return { cls: 'E', note: '实验 / 保留' }
}

export interface IPv4Info {
  ip: number
  prefix: number
  mask: number
  wildcard: number
  network: number
  broadcast: number
  /** 首个 / 最后一个可用主机（/31 为两端，/32 为地址本身） */
  first: number
  last: number
  total: number
  usable: number
  cls: IPv4Class
  classNote: string
  tags: AddrTag[]
  /** 相邻的同尺寸子网；越界为 null */
  prev: number | null
  next: number | null
}

export function ipv4Info(ip: number, prefix: number): IPv4Info {
  const mask = prefixToMask(prefix)
  const wildcard = ~mask >>> 0
  const network = (ip & mask) >>> 0
  const broadcast = (network | wildcard) >>> 0
  const total = 2 ** (32 - prefix)
  let first = network
  let last = broadcast
  let usable = total
  if (prefix <= 30) {
    first = network + 1
    last = broadcast - 1
    usable = total - 2
  }
  const { cls, note } = ipv4Class(ip)
  return {
    ip,
    prefix,
    mask,
    wildcard,
    network,
    broadcast,
    first,
    last,
    total,
    usable,
    cls,
    classNote: note,
    tags: ipv4Tags(ip),
    prev: network - total >= 0 ? network - total : null,
    next: network + total < U32 ? network + total : null,
  }
}

export function ipv4Hex(n: number): string {
  return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

/** 反向解析域名：10.1.168.192.in-addr.arpa */
export function ipv4ReverseDns(n: number): string {
  return ipv4ToString(n).split('.').reverse().join('.') + '.in-addr.arpa'
}

/** IPv4 映射的 IPv6 地址：::ffff:192.168.1.10 */
export function ipv4Mapped(n: number): string {
  return `::ffff:${ipv4ToString(n)}`
}

export interface SubnetRow {
  network: number
  prefix: number
  first: number
  last: number
  broadcast: number
  usable: number
}

export function subnetRow(network: number, prefix: number): SubnetRow {
  const i = ipv4Info(network, prefix)
  return { network, prefix, first: i.first, last: i.last, broadcast: i.broadcast, usable: i.usable }
}

/** 划分 N 个子网所需的新前缀（向上取到 2 的幂） */
export function prefixForSubnetCount(prefix: number, count: number): number {
  if (!Number.isInteger(count) || count < 1) throw new IpError('子网数量应为正整数')
  const extra = Math.ceil(Math.log2(count))
  const p = prefix + extra
  if (p > 32) {
    throw new IpError(
      `/${prefix} 最多只能划分为 ${(2 ** (32 - prefix)).toLocaleString('en-US')} 个子网`,
    )
  }
  return p
}

/** 每个子网至少容纳 hosts 台主机所需的前缀（/31、/32 按 RFC 3021 处理） */
export function prefixForHostCount(prefix: number, hosts: number): number {
  if (!Number.isInteger(hosts) || hosts < 1) throw new IpError('主机数应为正整数')
  const p = hosts === 1 ? 32 : hosts === 2 ? 31 : 32 - Math.ceil(Math.log2(hosts + 2))
  if (p < prefix) {
    const cap = ipv4Info(0, prefix).usable
    throw new IpError(
      `每个子网需要 ${hosts.toLocaleString('en-US')} 台主机，超出 /${prefix} 的容量（${cap.toLocaleString('en-US')} 台）`,
    )
  }
  return p
}

/** 把 network/prefix 均分为 /newPrefix 的子网，最多返回 limit 行 */
export function splitIPv4(
  network: number,
  prefix: number,
  newPrefix: number,
  limit = 256,
): { total: number; rows: SubnetRow[] } {
  if (newPrefix < prefix || newPrefix > 32) {
    throw new IpError(`新前缀应在 /${prefix} 到 /32 之间`)
  }
  const base = (network & prefixToMask(prefix)) >>> 0
  const total = 2 ** (newPrefix - prefix)
  const size = 2 ** (32 - newPrefix)
  const rows: SubnetRow[] = []
  for (let i = 0; i < Math.min(total, limit); i++) rows.push(subnetRow(base + i * size, newPrefix))
  return { total, rows }
}

/** IP 范围 → 最少的 CIDR 块 */
export function rangeToCidrs(start: number, end: number): { network: number; prefix: number }[] {
  if (start > end) throw new IpError('起始地址不能大于结束地址')
  const out: { network: number; prefix: number }[] = []
  let cur = start
  while (cur <= end) {
    let bits = 0
    while (bits < 32 && cur % 2 ** (bits + 1) === 0 && cur + 2 ** (bits + 1) - 1 <= end) bits++
    out.push({ network: cur, prefix: 32 - bits })
    cur += 2 ** bits
  }
  return out
}

/** 「a.b.c.d - e.f.g.h」形式的范围；不是范围返回 null */
export function parseIPv4Range(input: string): { start: number; end: number } | null {
  const m = input.trim().match(/^(\S+)\s*[-–~]\s*(\S+)$/)
  if (!m || !m[1].includes('.') || !m[2].includes('.')) return null
  const start = parseIPv4(m[1])
  const end = parseIPv4(m[2])
  if (start > end) throw new IpError(`起始地址 ${m[1]} 大于结束地址 ${m[2]}`)
  return { start, end }
}

// ═════════════════════════ IPv6 ═════════════════════════

const V6_MAX = (1n << 128n) - 1n
/** 64:ff9b::/96 */
const V6_WELL_KNOWN_NAT64 = 0x0064ff9bn << 96n

export interface IPv6Address {
  value: bigint
  /** %eth0 之类的区域 ID */
  zone?: string
}

/** 解析 IPv6（支持 ::、内嵌 IPv4、%zone、[方括号]） */
export function parseIPv6(input: string): IPv6Address {
  let s = input.trim()
  if (!s) throw new IpError('请输入 IPv6 地址')
  const port = /^\[[^\]]*\](:\d*)$/.exec(s)
  if (port) throw new IpError(`地址后面带了端口号「${port[1]}」，请去掉端口，只保留方括号里的地址`)
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)
  let zone: string | undefined
  const pct = s.indexOf('%')
  if (pct >= 0) {
    zone = s.slice(pct + 1)
    s = s.slice(0, pct)
    if (!zone) throw new IpError('「%」后缺少区域 ID（如 %eth0）')
  }
  if (!s.includes(':')) throw new IpError(`「${s}」不含冒号，不是 IPv6 地址`)
  if (s.split('::').length > 2) throw new IpError('「::」在一个地址里只能出现一次')
  if (/:::/.test(s)) throw new IpError('出现了连续三个冒号「:::」')

  let v4Tail: number[] = []
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    let v4: number
    try {
      v4 = parseIPv4(tail)
    } catch (e) {
      throw new IpError(`末尾内嵌的 IPv4「${tail}」无效：${(e as Error).message}`)
    }
    v4Tail = [v4 >>> 16, v4 & 0xffff]
    // 去掉 IPv4 部分，保留「::」或去掉末尾单个冒号
    s = s.slice(0, lastColon + 1)
    if (!s.endsWith('::')) s = s.slice(0, -1)
  }

  /** withIndex：「::」之前（或没有「::」）的分组序号才有意义 */
  const parseGroups = (part: string, withIndex: boolean): number[] => {
    if (part === '') return []
    return part.split(':').map((g, i) => {
      if (g === '') throw new IpError('存在空的分组（单个冒号开头 / 结尾，或连续冒号）')
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) {
        const where = withIndex ? `第 ${i + 1} 组` : '分组'
        throw new IpError(`${where}「${g}」不是 1–4 位十六进制数`)
      }
      return parseInt(g, 16)
    })
  }

  const slots = 8 - v4Tail.length
  let groups: number[]
  const dbl = s.indexOf('::')
  if (dbl >= 0) {
    const head = parseGroups(s.slice(0, dbl), true)
    const tailGroups = parseGroups(s.slice(dbl + 2), false)
    if (head.length + tailGroups.length >= slots) {
      throw new IpError(
        `「::」至少要代表一组 0，但地址已有 ${head.length + tailGroups.length + v4Tail.length} 组`,
      )
    }
    groups = [...head, ...new Array(slots - head.length - tailGroups.length).fill(0), ...tailGroups]
  } else {
    groups = parseGroups(s, true)
    if (groups.length !== slots) {
      throw new IpError(
        `IPv6 地址应有 8 组（每组 1–4 位十六进制），当前 ${groups.length + v4Tail.length} 组；可用「::」省略连续的 0`,
      )
    }
  }
  groups = [...groups, ...v4Tail]
  let value = 0n
  for (const g of groups) value = (value << 16n) | BigInt(g)
  return { value, zone }
}

function groupsOf(v: bigint): number[] {
  const out: number[] = []
  for (let i = 7; i >= 0; i--) out.push(Number((v >> BigInt(i * 16)) & 0xffffn))
  return out
}

/** 完整格式：8 组、每组 4 位、小写 */
export function expandIPv6(v: bigint): string {
  return groupsOf(v)
    .map((g) => g.toString(16).padStart(4, '0'))
    .join(':')
}

function inV6(v: bigint, net: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix)
  return v >> shift === net >> shift
}

/** RFC 5952 规范压缩格式：去前导零、最长（≥2 组）的 0 串换成 ::、小写；IPv4 映射用混合写法 */
export function compressIPv6(v: bigint): string {
  const g = groupsOf(v)
  const mixed = inV6(v, 0xffffn << 32n, 96) || inV6(v, V6_WELL_KNOWN_NAT64, 96)
  const hexGroups = mixed ? g.slice(0, 6) : g
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < hexGroups.length;) {
    if (hexGroups[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < hexGroups.length && hexGroups[j] === 0) j++
    if (j - i > bestLen && j - i >= 2) {
      bestStart = i
      bestLen = j - i
    }
    i = j
  }
  const hex = hexGroups.map((x) => x.toString(16))
  let out: string
  if (bestStart < 0) out = hex.join(':')
  else {
    const left = hex.slice(0, bestStart).join(':')
    const right = hex.slice(bestStart + bestLen).join(':')
    out = `${left}::${right}`
  }
  if (mixed) {
    const v4 = ipv4ToString(Number(v & 0xffffffffn))
    out = out.endsWith('::') ? out + v4 : `${out}:${v4}`
  }
  return out
}

function v6(s: string): bigint {
  return parseIPv6(s).value
}

interface V6Rule {
  net: string
  prefix: number
  tag: AddrTag
}

const V6_RULES: V6Rule[] = [
  {
    net: '::',
    prefix: 128,
    tag: {
      id: 'unspecified',
      label: '未指定',
      desc: '未指定地址 ::（RFC 4291）',
      color: 'var(--fg-2)',
    },
  },
  {
    net: '::1',
    prefix: 128,
    tag: {
      id: 'loopback',
      label: '回环',
      desc: '本机回环地址 ::1（RFC 4291）',
      color: 'var(--sys-purple)',
    },
  },
  {
    net: '::ffff:0:0',
    prefix: 96,
    tag: {
      id: 'ipv4-mapped',
      label: 'IPv4 映射',
      desc: 'IPv4 映射地址 ::ffff:0:0/96（RFC 4291）',
      color: 'var(--sys-cyan)',
    },
  },
  {
    net: '64:ff9b::',
    prefix: 96,
    tag: {
      id: 'nat64',
      label: 'NAT64',
      desc: 'IPv4/IPv6 转换知名前缀 64:ff9b::/96（RFC 6052）',
      color: 'var(--sys-cyan)',
    },
  },
  {
    net: '64:ff9b:1::',
    prefix: 48,
    tag: {
      id: 'nat64',
      label: 'NAT64',
      desc: '本地使用的 IPv4/IPv6 转换前缀（RFC 8215）',
      color: 'var(--sys-cyan)',
    },
  },
  {
    net: '100::',
    prefix: 64,
    tag: {
      id: 'discard',
      label: '丢弃',
      desc: '仅丢弃前缀 100::/64（RFC 6666）',
      color: 'var(--fg-2)',
    },
  },
  {
    net: '2001:db8::',
    prefix: 32,
    tag: {
      id: 'documentation',
      label: '文档示例',
      desc: '文档示例地址 2001:db8::/32（RFC 3849）',
      color: 'var(--sys-indigo)',
    },
  },
  {
    net: '3fff::',
    prefix: 20,
    tag: {
      id: 'documentation',
      label: '文档示例',
      desc: '文档示例地址 3fff::/20（RFC 9637）',
      color: 'var(--sys-indigo)',
    },
  },
  {
    net: '2001::',
    prefix: 32,
    tag: {
      id: 'teredo',
      label: 'Teredo',
      desc: 'Teredo 隧道地址 2001::/32（RFC 4380）',
      color: 'var(--sys-orange)',
    },
  },
  {
    net: '2002::',
    prefix: 16,
    tag: {
      id: '6to4',
      label: '6to4',
      desc: '6to4 隧道地址 2002::/16（RFC 3056）',
      color: 'var(--sys-orange)',
    },
  },
  {
    net: 'fc00::',
    prefix: 7,
    tag: {
      id: 'ula',
      label: '唯一本地',
      desc: '唯一本地地址 ULA fc00::/7，相当于 IPv6 的私有地址（RFC 4193）',
      color: 'var(--sys-green)',
    },
  },
  {
    net: 'fe80::',
    prefix: 10,
    tag: {
      id: 'link-local',
      label: '链路本地',
      desc: '链路本地地址 fe80::/10（RFC 4291）',
      color: 'var(--sys-teal)',
    },
  },
  {
    net: 'fec0::',
    prefix: 10,
    tag: {
      id: 'site-local',
      label: '站点本地（已废弃）',
      desc: '站点本地地址 fec0::/10，已被 RFC 3879 废弃',
      color: 'var(--fg-2)',
    },
  },
  {
    net: 'ff00::',
    prefix: 8,
    tag: {
      id: 'multicast',
      label: '组播',
      desc: '组播地址 ff00::/8（RFC 4291）',
      color: 'var(--sys-pink)',
    },
  },
  {
    net: '2000::',
    prefix: 3,
    tag: {
      id: 'global',
      label: '全球单播',
      desc: '全球单播地址 2000::/3，即 IPv6 公网地址',
      color: 'var(--sys-blue)',
    },
  },
]

const RESERVED_V6: AddrTag = {
  id: 'reserved',
  label: '保留',
  desc: 'IANA 尚未分配用途的地址空间',
  color: 'var(--fg-2)',
}

const MULTICAST_SCOPES: Record<number, string> = {
  1: '接口本地',
  2: '链路本地',
  3: '领域本地',
  4: '管理本地',
  5: '站点本地',
  8: '组织本地',
  14: '全球',
}

let v6RuleCache: { net: bigint; prefix: number; tag: AddrTag }[] | null = null

export function ipv6Tags(v: bigint): AddrTag[] {
  v6RuleCache ??= V6_RULES.map((r) => ({ net: v6(r.net), prefix: r.prefix, tag: r.tag }))
  const hit = v6RuleCache.find((r) => inV6(v, r.net, r.prefix))
  if (!hit) return [RESERVED_V6]
  if (hit.tag.id === 'multicast') {
    const scope = Number((v >> 112n) & 0xfn)
    const name = MULTICAST_SCOPES[scope]
    if (name)
      return [
        hit.tag,
        {
          id: 'scope',
          label: `${name}范围`,
          desc: `组播范围字段 = ${scope.toString(16)}`,
          color: 'var(--sys-pink)',
        },
      ]
  }
  return [hit.tag]
}

export interface IPv6Input {
  value: bigint
  prefix: number
  zone?: string
  /** 是否写了前缀（没写按 /128） */
  hasPrefix: boolean
}

export function parseIPv6Input(input: string): IPv6Input {
  const s = input.trim()
  const slash = s.lastIndexOf('/')
  if (slash < 0) return { ...parseIPv6(s), prefix: 128, hasPrefix: false }
  const addr = parseIPv6(s.slice(0, slash))
  const rest = s.slice(slash + 1).trim()
  if (!rest) throw new IpError('「/」后缺少前缀长度')
  return { ...addr, prefix: parsePrefix(rest, 128), hasPrefix: true }
}

export interface IPv6Info {
  value: bigint
  prefix: number
  network: bigint
  last: bigint
  /** 地址总数 2^(128-prefix) */
  total: bigint
  tags: AddrTag[]
}

export function ipv6Info(value: bigint, prefix: number): IPv6Info {
  const hostBits = BigInt(128 - prefix)
  const hostMask = (1n << hostBits) - 1n
  const network = value & (V6_MAX ^ hostMask)
  return {
    value,
    prefix,
    network,
    last: network | hostMask,
    total: 1n << hostBits,
    tags: ipv6Tags(value),
  }
}

/** 反向解析域名（按半字节倒序）；传入前缀时只取前缀覆盖的完整半字节（用于委派区域） */
export function ipv6ReverseDns(v: bigint, prefix = 128): string {
  const nibbles = expandIPv6(v)
    .replace(/:/g, '')
    .slice(0, Math.floor(prefix / 4))
  const labels = nibbles.split('').reverse()
  return [...labels, 'ip6.arpa'].join('.')
}

/** 32 个十六进制半字节 */
export function ipv6Nibbles(v: bigint): string {
  return expandIPv6(v).replace(/:/g, '')
}

/** 2^n 的中文展示：小于 2^53 给出精确千分位，否则给出 2 的幂与完整十进制 */
export function formatPow2(bits: number): { short: string; exact: string } {
  const n = 1n << BigInt(bits)
  const exact = n.toLocaleString('en-US')
  const sup = String(bits)
    .split('')
    .map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)])
    .join('')
  return { short: bits <= 20 ? exact : `2${sup}`, exact }
}

// ═════════════════════════ 统一入口 ═════════════════════════

export type IpFamily = 4 | 6

/** 根据有无冒号判断地址族 */
export function detectFamily(input: string): IpFamily {
  const s = input.trim()
  const addr = s.split('/')[0]
  return addr.includes(':') ? 6 : 4
}
