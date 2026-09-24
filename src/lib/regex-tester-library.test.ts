import { describe, expect, it } from 'vitest'
import { compileRegex, findMatches, replaceWithSpans } from './regex-tester'
import { REGEX_PRESETS } from './regex-tester-library'

/** 各预设的正例 / 反例（整行匹配类） */
const VECTORS: Record<string, { valid: string[]; invalid: string[] }> = {
  'cn-mobile': {
    valid: ['13800138000', '19912345678', '15612345678'],
    invalid: ['12345678901', '1380013800', '+8613800138000', '138001380001'],
  },
  email: {
    valid: ['alice@example.com', 'bob.smith+news@mail.co.uk', 'user_01@sub.domain.cn'],
    invalid: ['not-an-email', 'missing@tld', '@example.com', 'space in@example.com'],
  },
  'cn-id': {
    valid: ['11010519491231002X', '440524188001010014', '11010520001231002x'],
    invalid: [
      '110105194913310021',
      '12345678901234567',
      '010105199001011234',
      '11010517001231002X',
    ],
  },
  ipv4: {
    valid: ['192.168.1.1', '10.0.0.255', '255.255.255.255', '0.0.0.0'],
    invalid: ['256.1.1.1', '192.168.01.1', '1.2.3', '1.2.3.4.5'],
  },
  ipv6: {
    valid: [
      '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      '2001:db8::1',
      '::1',
      '::',
      'fe80::1ff:fe23:4567:890a',
      'FE80::1',
    ],
    invalid: ['2001:db8::1::1', '12345::', 'gggg::1', '1:2:3:4:5:6:7:8:9'],
  },
  date: {
    valid: ['2024-01-31', '2024-12-01', '1999-02-28'],
    invalid: ['2024-13-01', '2024-1-5', '2024/01/31', '2024-00-10', '2024-01-32'],
  },
  time: {
    valid: ['09:30', '23:59:59', '00:00:00'],
    invalid: ['24:00', '12:60', '7:05', '12:30:60'],
  },
  postcode: { valid: ['100000', '518000'], invalid: ['012345', '10000', '1000000'] },
  plate: {
    valid: ['京A12345', '粤B8F9Z1', '沪AD12345', '浙A12345F'],
    invalid: ['京I12345', '京A1234', 'A12345', '京A123456'],
  },
  'strong-password': {
    valid: ['Passw0rd!', 'Abcdef1@2024'],
    invalid: ['password', 'PASSWORD123!', 'Pass1!', 'NoSymbol123'],
  },
  qq: { valid: ['10000', '123456789'], invalid: ['01234567', '1234', '123456789012'] },
  username: {
    valid: ['alice', 'user_2024', 'A1b2'],
    invalid: ['1user', 'ab', 'this_name_is_way_too_long'],
  },
  'cn-landline': {
    valid: ['010-12345678', '0755-1234567', '02112345678'],
    invalid: ['123-12345678', '010-123456'],
  },
  number: { valid: ['42', '-3.14', '0.5'], invalid: ['1e10', '.5', '12.'] },
  domain: {
    valid: ['example.com', 'sub.domain.co.uk', 'my-site.cn'],
    invalid: ['-bad.com', 'localhost', 'example..com'],
  },
  mac: {
    valid: ['00:1A:2B:3C:4D:5E', '00-1a-2b-3c-4d-5e'],
    invalid: ['001A2B3C4D5E', '00:1A:2B:3C:4D'],
  },
  semver: {
    valid: ['1.0.0', '2.10.3-beta.1', '1.0.0-rc.1+build.5'],
    invalid: ['01.0.0', '1.0', 'v1.2.3'],
  },
  'bank-card': {
    valid: ['6222021234567890123', '6228480402564890018'],
    invalid: ['622202123456789', '0222021234567890'],
  },
}

describe('REGEX_PRESETS', () => {
  it('has unique ids and compiles every pattern', () => {
    const ids = new Set(REGEX_PRESETS.map((p) => p.id))
    expect(ids.size).toBe(REGEX_PRESETS.length)
    for (const p of REGEX_PRESETS) {
      expect(compileRegex(p.pattern, p.flags).ok, p.id).toBe(true)
      expect(p.sample.length, p.id).toBeGreaterThan(0)
    }
  })

  it('covers the required categories', () => {
    for (const id of [
      'cn-mobile',
      'email',
      'cn-id',
      'url',
      'ipv4',
      'ipv6',
      'date',
      'time',
      'chinese',
      'postcode',
      'plate',
      'hex-color',
      'strong-password',
      'qq',
      'username',
      'html-tag',
    ]) {
      expect(
        REGEX_PRESETS.some((p) => p.id === id),
        id,
      ).toBe(true)
    }
  })

  it.each(Object.entries(VECTORS))('%s accepts valid and rejects invalid input', (id, v) => {
    const preset = REGEX_PRESETS.find((p) => p.id === id)!
    const re = new RegExp(preset.pattern, preset.flags.replace(/[gmy]/g, ''))
    for (const s of v.valid) expect(re.test(s), `${id} should match ${s}`).toBe(true)
    for (const s of v.invalid) expect(re.test(s), `${id} should not match ${s}`).toBe(false)
  })

  it('every sample produces at least one match', () => {
    for (const p of REGEX_PRESETS) {
      const c = compileRegex(p.pattern, p.flags)
      if (!c.ok) throw new Error(p.id)
      expect(findMatches(c.re, p.sample).matches.length, p.id).toBeGreaterThan(0)
    }
  })

  it('search-style presets find the right substrings', () => {
    const get = (id: string) => {
      const p = REGEX_PRESETS.find((x) => x.id === id)!
      const c = compileRegex(p.pattern, p.flags)
      if (!c.ok) throw new Error(id)
      return findMatches(c.re, p.sample).matches.map((m) => m.text)
    }
    expect(get('url')).toEqual([
      'https://www.example.com/docs?page=2#intro',
      'http://api.test.cn:8080/v1/users',
    ])
    expect(get('hex-color')).toEqual(['#fff', '#1D1D1F', '#0071e3cc'])
    expect(get('chinese')).toEqual(['世界', '正则表达式', '很强大', '𠮷野家也能匹配'])
    expect(get('duplicate-words')).toEqual(['is is', 'The the', 'fox fox'])
    expect(get('html-tag')).toHaveLength(9)
  })

  it('replacement presets produce the expected output', () => {
    const run = (id: string) => {
      const p = REGEX_PRESETS.find((x) => x.id === id)!
      const c = compileRegex(p.pattern, p.flags)
      if (!c.ok) throw new Error(id)
      return replaceWithSpans(c.re, p.sample, p.replacement ?? '').output
    }
    expect(run('thousands')).toBe('1,234,567\n1,000\n987,654,321.5')
    expect(run('date-format')).toBe('发布日期：31/01/2024，更新于 25/12/2024。')
    expect(run('camel-to-snake')).toBe('user_Name\nget_Http_Response_Code\nis_Valid2_Go')
    expect(run('blank-lines')).toBe('第一行\n第二行\n第三行')
    expect(run('trim')).toBe('前面有空格\n后面有空格\n两边都有')
  })
})
