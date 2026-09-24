import { describe, expect, it } from 'vitest'
import {
  IpError,
  compressIPv6,
  detectFamily,
  expandIPv6,
  formatPow2,
  ipv4Binary,
  ipv4Class,
  ipv4Hex,
  ipv4Info,
  ipv4Mapped,
  ipv4ReverseDns,
  ipv4Tags,
  ipv4ToString,
  ipv6Info,
  ipv6Nibbles,
  ipv6ReverseDns,
  ipv6Tags,
  maskToPrefix,
  normalizeIpInput,
  parseIPv4,
  parseIPv4Input,
  parseIPv4Range,
  parseIPv6,
  parseIPv6Input,
  prefixForHostCount,
  prefixForSubnetCount,
  prefixToMask,
  rangeToCidrs,
  splitIPv4,
} from './cidr-calculator'

const ip = parseIPv4
const s = ipv4ToString

describe('normalizeIpInput', () => {
  it('converts full-width characters typed with a Chinese IME', () => {
    expect(normalizeIpInput('１９２。１６８．１．１／２４')).toBe('192.168.1.1/24')
    expect(normalizeIpInput('２００１：ｄｂ８：：１')).toBe('2001:db8::1')
    expect(normalizeIpInput('10.0.0.1　－　10.0.0.9')).toBe('10.0.0.1 - 10.0.0.9')
    expect(parseIPv4Input(normalizeIpInput('１０。０。０。１ ２５５。０。０。０')).prefix).toBe(8)
  })

  it('leaves ASCII input untouched', () => {
    expect(normalizeIpInput('fe80::1%en0/64')).toBe('fe80::1%en0/64')
  })
})

describe('parseIPv4', () => {
  it('parses dotted decimal', () => {
    expect(ip('192.168.1.10')).toBe(0xc0a8010a)
    expect(ip('0.0.0.0')).toBe(0)
    expect(ip(' 255.255.255.255 ')).toBe(0xffffffff)
    expect(s(0xc0a8010a)).toBe('192.168.1.10')
    expect(s(0xffffffff)).toBe('255.255.255.255')
  })

  it('rejects malformed input with precise Chinese errors', () => {
    expect(() => ip('')).toThrow('请输入 IPv4 地址')
    expect(() => ip('1.2.3')).toThrow('有 3 段')
    expect(() => ip('1..2.3')).toThrow('第 2 段为空')
    expect(() => ip('1.2.3.x')).toThrow('第 4 段「x」不是十进制数字')
    expect(() => ip('1.2.3.256')).toThrow('第 4 段 256 超出范围')
    expect(() => ip('192.168.010.1')).toThrow('前导零')
    expect(() => ip('１.2.3.4')).toThrow(IpError)
  })
})

describe('masks', () => {
  it('converts prefix ⇄ mask', () => {
    expect(prefixToMask(0)).toBe(0)
    expect(prefixToMask(24)).toBe(0xffffff00)
    expect(prefixToMask(32)).toBe(0xffffffff)
    expect(prefixToMask(1)).toBe(0x80000000)
    for (let p = 0; p <= 32; p++) expect(maskToPrefix(prefixToMask(p))).toBe(p)
    expect(maskToPrefix(ip('255.0.255.0'))).toBeNull()
    expect(maskToPrefix(ip('0.0.0.255'))).toBeNull()
  })
})

describe('parseIPv4Input', () => {
  it('accepts CIDR, mask, wildcard and bare IP', () => {
    expect(parseIPv4Input('192.168.1.10/24')).toEqual({
      ip: ip('192.168.1.10'),
      prefix: 24,
      via: 'cidr',
    })
    expect(parseIPv4Input('192.168.1.10 / 24').prefix).toBe(24)
    expect(parseIPv4Input('192.168.1.10/255.255.255.0')).toMatchObject({ prefix: 24, via: 'mask' })
    expect(parseIPv4Input('172.16.5.4 255.255.240.0')).toMatchObject({ prefix: 20, via: 'mask' })
    expect(parseIPv4Input('10.0.0.1 0.0.0.255')).toMatchObject({ prefix: 24, via: 'wildcard' })
    expect(parseIPv4Input('10.0.0.1, 0.0.15.255')).toMatchObject({ prefix: 20, via: 'wildcard' })
    expect(parseIPv4Input('8.8.8.8')).toMatchObject({ prefix: 32, via: 'none' })
    // 歧义值优先按子网掩码理解
    expect(parseIPv4Input('10.0.0.1 255.255.255.255')).toMatchObject({ prefix: 32, via: 'mask' })
  })

  it('reports errors', () => {
    expect(() => parseIPv4Input('')).toThrow('请输入 IPv4 地址')
    expect(() => parseIPv4Input('10.0.0.1/33')).toThrow('/33 超出范围')
    expect(() => parseIPv4Input('10.0.0.1/abc')).toThrow('前缀长度「abc」')
    expect(() => parseIPv4Input('10.0.0.1/')).toThrow('缺少前缀')
    expect(() => parseIPv4Input('10.0.0.1 255.0.255.0')).toThrow('既不是连续的子网掩码')
    expect(() => parseIPv4Input('10.0.0.1 255.0.0')).toThrow('掩码「255.0.0」无效')
    expect(() => parseIPv4Input('1.1.1.1 2.2.2.2 3.3.3.3')).toThrow('格式应为')
  })
})

describe('ipv4Info', () => {
  it('computes a /24', () => {
    const i = ipv4Info(ip('192.168.1.10'), 24)
    expect(s(i.network)).toBe('192.168.1.0')
    expect(s(i.broadcast)).toBe('192.168.1.255')
    expect(s(i.first)).toBe('192.168.1.1')
    expect(s(i.last)).toBe('192.168.1.254')
    expect(s(i.mask)).toBe('255.255.255.0')
    expect(s(i.wildcard)).toBe('0.0.0.255')
    expect(i.total).toBe(256)
    expect(i.usable).toBe(254)
    expect(i.cls).toBe('C')
    expect(s(i.prev!)).toBe('192.168.0.0')
    expect(s(i.next!)).toBe('192.168.2.0')
  })

  it('handles /31 and /32 per RFC 3021', () => {
    const p31 = ipv4Info(ip('10.0.0.5'), 31)
    expect(s(p31.network)).toBe('10.0.0.4')
    expect(s(p31.first)).toBe('10.0.0.4')
    expect(s(p31.last)).toBe('10.0.0.5')
    expect(p31.usable).toBe(2)
    const p32 = ipv4Info(ip('10.0.0.5'), 32)
    expect(s(p32.first)).toBe('10.0.0.5')
    expect(s(p32.last)).toBe('10.0.0.5')
    expect(p32.total).toBe(1)
    expect(p32.usable).toBe(1)
    const p30 = ipv4Info(ip('10.0.0.5'), 30)
    expect(p30.usable).toBe(2)
    expect(s(p30.first)).toBe('10.0.0.5')
  })

  it('handles /0 and edges of the address space', () => {
    const all = ipv4Info(ip('1.2.3.4'), 0)
    expect(all.total).toBe(2 ** 32)
    expect(all.usable).toBe(2 ** 32 - 2)
    expect(s(all.broadcast)).toBe('255.255.255.255')
    expect(all.prev).toBeNull()
    expect(all.next).toBeNull()
    expect(ipv4Info(ip('0.0.0.1'), 24).prev).toBeNull()
    expect(ipv4Info(ip('255.255.255.1'), 24).next).toBeNull()
    expect(s(ipv4Info(ip('255.255.255.1'), 24).prev!)).toBe('255.255.254.0')
  })

  it('computes an odd prefix', () => {
    const i = ipv4Info(ip('172.20.77.9'), 19)
    expect(s(i.network)).toBe('172.20.64.0')
    expect(s(i.broadcast)).toBe('172.20.95.255')
    expect(i.usable).toBe(8190)
  })
})

describe('classification', () => {
  const tag = (a: string) => ipv4Tags(ip(a))[0].id
  it('tags special ranges', () => {
    expect(tag('10.1.2.3')).toBe('private')
    expect(tag('172.16.0.1')).toBe('private')
    expect(tag('172.31.255.255')).toBe('private')
    expect(tag('172.32.0.1')).toBe('public')
    expect(tag('192.168.0.1')).toBe('private')
    expect(tag('8.8.8.8')).toBe('public')
    expect(tag('127.0.0.1')).toBe('loopback')
    expect(tag('169.254.10.1')).toBe('link-local')
    expect(tag('100.64.0.1')).toBe('cgnat')
    expect(tag('100.128.0.1')).toBe('public')
    expect(tag('224.0.0.251')).toBe('multicast')
    expect(tag('240.0.0.1')).toBe('reserved')
    expect(tag('255.255.255.255')).toBe('broadcast')
    expect(tag('0.1.2.3')).toBe('this-network')
    expect(tag('192.0.2.7')).toBe('documentation')
    expect(tag('198.51.100.1')).toBe('documentation')
    expect(tag('203.0.113.200')).toBe('documentation')
    expect(tag('198.19.1.1')).toBe('benchmark')
    expect(ipv4Tags(ip('10.0.0.1'))[0].label).toBe('私有')
  })

  it('assigns classful classes', () => {
    expect(ipv4Class(ip('10.0.0.1')).cls).toBe('A')
    expect(ipv4Class(ip('128.0.0.1')).cls).toBe('B')
    expect(ipv4Class(ip('223.255.255.255')).cls).toBe('C')
    expect(ipv4Class(ip('239.1.1.1')).cls).toBe('D')
    expect(ipv4Class(ip('250.1.1.1')).cls).toBe('E')
  })

  it('formats helpers', () => {
    expect(ipv4Binary(ip('192.168.1.10'))).toBe('11000000101010000000000100001010')
    expect(ipv4Binary(0)).toHaveLength(32)
    expect(ipv4Hex(ip('192.168.1.10'))).toBe('0xC0A8010A')
    expect(ipv4ReverseDns(ip('192.168.1.10'))).toBe('10.1.168.192.in-addr.arpa')
    expect(ipv4Mapped(ip('192.168.1.10'))).toBe('::ffff:192.168.1.10')
  })
})

describe('subnet splitting', () => {
  it('splits into N subnets (rounded up to a power of two)', () => {
    expect(prefixForSubnetCount(24, 4)).toBe(26)
    expect(prefixForSubnetCount(24, 5)).toBe(27)
    expect(prefixForSubnetCount(24, 1)).toBe(24)
    expect(() => prefixForSubnetCount(24, 512)).toThrow('最多只能划分为 256 个子网')
    expect(() => prefixForSubnetCount(24, 0)).toThrow('正整数')
    const { total, rows } = splitIPv4(ip('192.168.1.77'), 24, 26)
    expect(total).toBe(4)
    expect(rows.map((r) => `${s(r.network)}/${r.prefix}`)).toEqual([
      '192.168.1.0/26',
      '192.168.1.64/26',
      '192.168.1.128/26',
      '192.168.1.192/26',
    ])
    expect(s(rows[1].first)).toBe('192.168.1.65')
    expect(s(rows[1].last)).toBe('192.168.1.126')
    expect(s(rows[1].broadcast)).toBe('192.168.1.127')
    expect(rows[1].usable).toBe(62)
  })

  it('picks a prefix by host count', () => {
    expect(prefixForHostCount(16, 50)).toBe(26)
    expect(prefixForHostCount(16, 62)).toBe(26)
    expect(prefixForHostCount(16, 63)).toBe(25)
    expect(prefixForHostCount(24, 2)).toBe(31)
    expect(prefixForHostCount(24, 1)).toBe(32)
    expect(() => prefixForHostCount(24, 300)).toThrow('超出 /24 的容量（254 台）')
  })

  it('limits rows for huge splits', () => {
    const { total, rows } = splitIPv4(ip('10.0.0.0'), 8, 30, 100)
    expect(total).toBe(2 ** 22)
    expect(rows).toHaveLength(100)
    expect(s(rows[99].network)).toBe('10.0.1.140')
    expect(() => splitIPv4(ip('10.0.0.0'), 8, 7)).toThrow('新前缀应在 /8 到 /32 之间')
  })
})

describe('ranges', () => {
  it('converts ranges to minimal CIDR blocks', () => {
    const r = rangeToCidrs(ip('192.168.1.0'), ip('192.168.1.255'))
    expect(r).toEqual([{ network: ip('192.168.1.0'), prefix: 24 }])
    const r2 = rangeToCidrs(ip('10.0.0.1'), ip('10.0.0.10')).map(
      (c) => `${s(c.network)}/${c.prefix}`,
    )
    expect(r2).toEqual(['10.0.0.1/32', '10.0.0.2/31', '10.0.0.4/30', '10.0.0.8/31', '10.0.0.10/32'])
    expect(rangeToCidrs(0, 0xffffffff)).toEqual([{ network: 0, prefix: 0 }])
    expect(() => rangeToCidrs(5, 1)).toThrow('起始地址不能大于结束地址')
  })

  it('parses range syntax', () => {
    expect(parseIPv4Range('10.0.0.1 - 10.0.0.10')).toEqual({
      start: ip('10.0.0.1'),
      end: ip('10.0.0.10'),
    })
    expect(parseIPv4Range('10.0.0.1~10.0.0.10')).not.toBeNull()
    expect(parseIPv4Range('10.0.0.1/24')).toBeNull()
    expect(() => parseIPv4Range('10.0.0.9 - 10.0.0.1')).toThrow('大于结束地址')
  })
})

const v6 = (a: string) => parseIPv6(a).value

describe('IPv6 parsing & formatting', () => {
  it('expands and compresses (RFC 5952)', () => {
    const a = v6('2001:db8::1')
    expect(expandIPv6(a)).toBe('2001:0db8:0000:0000:0000:0000:0000:0001')
    expect(compressIPv6(a)).toBe('2001:db8::1')
    expect(compressIPv6(v6('2001:0DB8:0000:0000:0001:0000:0000:0001'))).toBe('2001:db8::1:0:0:1')
    // 只有一组 0 时不压缩
    expect(compressIPv6(v6('2001:db8:0:1:1:1:1:1'))).toBe('2001:db8:0:1:1:1:1:1')
    // 等长时压缩第一段
    expect(compressIPv6(v6('2001:0:0:1:0:0:0:1'))).toBe('2001:0:0:1::1')
    expect(compressIPv6(v6('2001:db8:0:0:1:0:0:1'))).toBe('2001:db8::1:0:0:1')
    expect(compressIPv6(0n)).toBe('::')
    expect(compressIPv6(1n)).toBe('::1')
    expect(compressIPv6(v6('fe80::'))).toBe('fe80::')
    expect(compressIPv6((1n << 128n) - 1n)).toBe('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
  })

  it('handles embedded IPv4, zones and brackets', () => {
    expect(expandIPv6(v6('::ffff:192.168.1.1'))).toBe('0000:0000:0000:0000:0000:ffff:c0a8:0101')
    expect(compressIPv6(v6('::ffff:c0a8:101'))).toBe('::ffff:192.168.1.1')
    expect(compressIPv6(v6('64:ff9b::192.0.2.33'))).toBe('64:ff9b::192.0.2.33')
    expect(expandIPv6(v6('1:2:3:4:5:6:1.2.3.4'))).toBe('0001:0002:0003:0004:0005:0006:0102:0304')
    expect(v6('::1.2.3.4')).toBe(0x01020304n)
    expect(parseIPv6('fe80::1%eth0')).toEqual({ value: v6('fe80::1'), zone: 'eth0' })
    expect(v6('[2001:db8::1]')).toBe(v6('2001:db8::1'))
    expect(v6('1:2:3:4:5:6:7::')).toBe(v6('1:2:3:4:5:6:7:0'))
  })

  it('rejects malformed addresses', () => {
    expect(() => parseIPv6('')).toThrow('请输入 IPv6 地址')
    expect(() => parseIPv6('1::2::3')).toThrow('只能出现一次')
    expect(() => parseIPv6('1:::2')).toThrow(':::')
    expect(() => parseIPv6('12345::1')).toThrow('第 1 组「12345」')
    expect(() => parseIPv6('2001:db8::xyz')).toThrow('分组「xyz」')
    expect(() => parseIPv6('1:2:3:4:5:6:7')).toThrow('当前 7 组')
    expect(() => parseIPv6('1:2:3:4:5:6:7:8:9')).toThrow('当前 9 组')
    expect(() => parseIPv6('1:2:3:4:5:6:7:8::')).toThrow('至少要代表一组 0')
    expect(() => parseIPv6(':1::2')).toThrow('空的分组')
    expect(() => parseIPv6('::ffff:1.2.3.999')).toThrow('内嵌的 IPv4')
    expect(() => parseIPv6('fe80::1%')).toThrow('区域 ID')
    expect(() => parseIPv6('中文')).toThrow(IpError)
    expect(() => parseIPv6('[2001:db8::1]:443')).toThrow('端口号「:443」')
  })

  it('parses prefix input', () => {
    expect(parseIPv6Input('2001:db8::/32')).toMatchObject({ prefix: 32, hasPrefix: true })
    expect(parseIPv6Input('fe80::1%en0/64')).toMatchObject({ prefix: 64, zone: 'en0' })
    expect(parseIPv6Input('::1')).toMatchObject({ prefix: 128, hasPrefix: false })
    expect(() => parseIPv6Input('::1/129')).toThrow('/129 超出范围')
  })
})

describe('IPv6 ranges and types', () => {
  it('computes the network range', () => {
    const i = ipv6Info(v6('2001:db8:abcd:12::1'), 48)
    expect(compressIPv6(i.network)).toBe('2001:db8:abcd::')
    expect(compressIPv6(i.last)).toBe('2001:db8:abcd:ffff:ffff:ffff:ffff:ffff')
    expect(i.total).toBe(1n << 80n)
    const odd = ipv6Info(v6('2001:db8::'), 33)
    expect(compressIPv6(odd.last)).toBe('2001:db8:7fff:ffff:ffff:ffff:ffff:ffff')
    const all = ipv6Info(v6('::1'), 0)
    expect(all.network).toBe(0n)
    expect(all.total).toBe(1n << 128n)
    expect(ipv6Info(v6('::1'), 128).total).toBe(1n)
  })

  it('classifies address types', () => {
    const t = (a: string) => ipv6Tags(v6(a)).map((x) => x.id)
    expect(t('::')).toEqual(['unspecified'])
    expect(t('::1')).toEqual(['loopback'])
    expect(t('::ffff:10.0.0.1')).toEqual(['ipv4-mapped'])
    expect(t('64:ff9b::1.2.3.4')).toEqual(['nat64'])
    expect(t('2001:db8::1')).toEqual(['documentation'])
    expect(t('2001:0::1')).toEqual(['teredo'])
    expect(t('2002:c000:204::1')).toEqual(['6to4'])
    expect(t('fd12:3456::1')).toEqual(['ula'])
    expect(t('fe80::1')).toEqual(['link-local'])
    expect(t('ff02::1')).toEqual(['multicast', 'scope'])
    expect(ipv6Tags(v6('ff02::1'))[1].label).toBe('链路本地范围')
    expect(t('2606:4700:4700::1111')).toEqual(['global'])
    expect(t('4000::1')).toEqual(['reserved'])
  })

  it('builds reverse DNS names and nibbles', () => {
    expect(ipv6ReverseDns(v6('2001:db8::567:89ab'))).toBe(
      'b.a.9.8.7.6.5.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa',
    )
    expect(ipv6ReverseDns(v6('2001:db8::'), 32)).toBe('8.b.d.0.1.0.0.2.ip6.arpa')
    expect(ipv6Nibbles(1n)).toBe('0'.repeat(31) + '1')
  })

  it('formats powers of two', () => {
    expect(formatPow2(8)).toEqual({ short: '256', exact: '256' })
    expect(formatPow2(64).short).toBe('2⁶⁴')
    expect(formatPow2(64).exact).toBe('18,446,744,073,709,551,616')
  })

  it('detects the family', () => {
    expect(detectFamily('10.0.0.1/8')).toBe(4)
    expect(detectFamily('::1')).toBe(6)
    expect(detectFamily('  fe80::1%eth0/64')).toBe(6)
  })
})
