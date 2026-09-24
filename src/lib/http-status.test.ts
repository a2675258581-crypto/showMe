import { describe, expect, it } from 'vitest'
import {
  HTTP_STATUSES,
  STATUS_CLASSES,
  classInfo,
  codeQueryPrefix,
  getStatus,
  searchStatuses,
  statusClassOf,
} from './http-status'

/** IANA 注册表中的全部标准状态码（不含未分配的编号） */
const IANA = [
  100, 101, 102, 103, 200, 201, 202, 203, 204, 205, 206, 207, 208, 226, 300, 301, 302, 303, 304,
  305, 306, 307, 308, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414,
  415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500, 501, 502, 503, 504,
  505, 506, 507, 508, 510, 511,
]

describe('data', () => {
  it('contains every IANA-registered code exactly once', () => {
    const codes = HTTP_STATUSES.map((s) => s.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const c of IANA) expect(codes, `missing ${c}`).toContain(c)
    const standard = HTTP_STATUSES.filter((s) => s.status !== 'unofficial').map((s) => s.code)
    expect(standard).toEqual(IANA)
  })

  it('is sorted and every entry is complete', () => {
    const codes = HTTP_STATUSES.map((s) => s.code)
    expect([...codes].sort((a, b) => a - b)).toEqual(codes)
    for (const s of HTTP_STATUSES) {
      expect(s.phrase, `${s.code}`).toBeTruthy()
      expect(s.name).toMatch(/\p{Script=Han}/u)
      expect(s.desc.length).toBeGreaterThan(8)
      expect(s.scenario.length).toBeGreaterThan(1)
      expect(s.tip.length).toBeGreaterThan(3)
      expect(s.spec).toBeTruthy()
      if (s.specUrl) expect(s.specUrl).toMatch(/^https:\/\//)
      if (s.status === 'unofficial') expect(s.vendor).toBeTruthy()
    }
  })

  it('uses the RFC 9110 reason phrases', () => {
    expect(getStatus(413)!.phrase).toBe('Content Too Large')
    expect(getStatus(422)!.phrase).toBe('Unprocessable Content')
    expect(getStatus(418)!.phrase).toBe("I'm a teapot")
    expect(getStatus(404)!.specUrl).toBe('https://www.rfc-editor.org/rfc/rfc9110#section-15.5.5')
  })

  it('marks heuristically cacheable codes (RFC 9110 §15.1)', () => {
    const cacheable = HTTP_STATUSES.filter((s) => s.cacheable).map((s) => s.code)
    expect(cacheable).toEqual([200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, 501])
  })

  it('maps classes and colors', () => {
    expect(statusClassOf(103)).toBe(1)
    expect(statusClassOf(451)).toBe(4)
    expect(statusClassOf(526)).toBe(5)
    expect(classInfo(302).range).toBe('3xx')
    expect(STATUS_CLASSES).toHaveLength(5)
    expect(getStatus(999)).toBeUndefined()
  })
})

describe('searchStatuses', () => {
  const codes = (q: string, o?: Parameters<typeof searchStatuses>[1]) =>
    searchStatuses(q, o).map((s) => s.code)

  it('returns everything for an empty query', () => {
    expect(codes('')).toHaveLength(HTTP_STATUSES.length)
    expect(codes('  ', { includeUnofficial: false })).toEqual(IANA)
  })

  it('matches numbers by prefix', () => {
    expect(codes('404')).toEqual([404])
    expect(codes('40')).toEqual([400, 401, 402, 403, 404, 405, 406, 407, 408, 409])
    expect(codes('1')).toEqual([100, 101, 102, 103])
    expect(codes('52')).toEqual([520, 521, 522, 523, 524, 525, 526])
    expect(codes('52', { includeUnofficial: false })).toEqual([])
    expect(codes('999')).toEqual([])
  })

  it('matches class syntax', () => {
    expect(codes('3xx')).toEqual([300, 301, 302, 303, 304, 305, 306, 307, 308])
    expect(codes('2XX')).toContain(226)
  })

  it('matches wildcard prefixes like 50x / 41X', () => {
    expect(codes('50x')).toEqual([500, 501, 502, 503, 504, 505, 506, 507, 508])
    expect(codes('41X')).toEqual([410, 411, 412, 413, 414, 415, 416, 417, 418])
    expect(codes(' 52x ')).toEqual([520, 521, 522, 523, 524, 525, 526])
    expect(codeQueryPrefix('4xx')).toBe('4')
    expect(codeQueryPrefix('404')).toBe('404')
    expect(codeQueryPrefix('4x')).toBeNull()
    expect(codeQueryPrefix('6xx')).toBeNull()
    expect(codeQueryPrefix('xxx')).toBeNull()
    expect(codeQueryPrefix('限流')).toBeNull()
  })

  it('matches English and Chinese text, case-insensitively', () => {
    expect(codes('not found')).toEqual([404])
    expect(codes('TEAPOT')).toEqual([418])
    expect(codes('茶壶')).toEqual([418])
    expect(codes('限流')[0]).toBe(429)
    expect(codes('websocket')[0]).toBe(101)
    expect(codes('断点续传')).toEqual(expect.arrayContaining([206, 416]))
    expect(codes('retry-after')).toEqual(expect.arrayContaining([429, 503]))
  })

  it('ranks title matches first and requires every term', () => {
    const r = codes('超时')
    expect(r.slice(0, 2).sort()).toEqual([408, 504])
    expect(codes('nginx 超时')).toEqual(expect.arrayContaining([504]))
    expect(codes('nginx 超时')).not.toContain(408)
    expect(codes('zzzz 不存在的词')).toEqual([])
  })

  it('filters by class and unofficial flag', () => {
    expect(codes('', { cls: 1 })).toEqual([100, 101, 102, 103])
    // 103 的开发建议里提到了 Cloudflare，排在名称直接命中的 52x 之后
    expect(codes('cloudflare', { includeUnofficial: false })).toEqual([103])
    expect(codes('cloudflare')).toEqual([520, 521, 522, 523, 524, 525, 526, 103])
    expect(codes('超时', { cls: 5 })).not.toContain(408)
  })
})
