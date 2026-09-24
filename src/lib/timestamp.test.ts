import { describe, expect, it } from 'vitest'
import {
  addToInstant,
  allTimeZones,
  civilFromDays,
  daysFromCivil,
  convertBatch,
  describeInstant,
  detectUnit,
  formatDuration,
  formatHttpDate,
  formatISO,
  formatOffset,
  formatRFC2822,
  formatRelative,
  instantFromNs,
  instantToNs,
  instantToUnit,
  isoWeek,
  isValidTimeZone,
  normalizeTimeZone,
  parseDateInput,
  parseTimestamp,
  parseZoneOffset,
  searchTimeZones,
  toHalfWidth,
  zonedParts,
  zonedToEpoch,
  type Instant,
} from './timestamp'

const at = (ms: number): Instant => ({ epochMs: ms, subMsNs: 0 })
const T2024 = Date.UTC(2024, 0, 1) // 2024-01-01T00:00:00Z，星期一
const NOW = Date.UTC(2024, 5, 15, 4, 0, 0) // 2024-06-15T04:00:00Z，星期六

function parsedMs(input: string, tz = 'Asia/Shanghai', now = NOW): number {
  const r = parseDateInput(input, tz, now)
  if (!r.ok) throw new Error(r.error)
  return r.value.instant.epochMs
}

function parseError(input: string, tz = 'Asia/Shanghai'): string {
  const r = parseDateInput(input, tz, NOW)
  if (r.ok) throw new Error(`expected error for ${input}`)
  return r.error
}

describe('detectUnit / parseTimestamp', () => {
  it.each([
    ['0', 's'],
    ['1704067200', 's'],
    ['99999999999', 's'],
    ['1704067200000', 'ms'],
    ['1704067200000000', 'us'],
    ['1704067200000000000', 'ns'],
    ['-1704067200000', 'ms'],
  ] as const)('%s → %s', (input, unit) => {
    const r = parseTimestamp(input)
    expect(r.ok && r.value.unit).toBe(unit)
    expect(r.ok && r.value.detected).toBe(true)
  })

  it('detectUnit uses absolute magnitude', () => {
    expect(detectUnit(-100_000_000_000n)).toBe('ms')
    expect(detectUnit(0n)).toBe('s')
  })

  it('all four units resolve to the same instant', () => {
    for (const s of ['1704067200', '1704067200000', '1704067200000000', '1704067200000000000']) {
      const r = parseTimestamp(s)
      expect(r.ok && r.value.instant).toEqual({ epochMs: T2024, subMsNs: 0 })
    }
  })

  it('keeps sub-millisecond precision', () => {
    const r = parseTimestamp('1704067200123456789')
    expect(r.ok && r.value.instant).toEqual({ epochMs: T2024 + 123, subMsNs: 456789 })
    const r2 = parseTimestamp('1704067200.5')
    expect(r2.ok && r2.value.instant.epochMs).toBe(T2024 + 500)
  })

  it('handles negatives with floor semantics', () => {
    const r = parseTimestamp('-1.5')
    expect(r.ok && r.value.instant).toEqual({ epochMs: -1500, subMsNs: 0 })
    const r2 = parseTimestamp('-1', 'ns')
    expect(r2.ok && r2.value.instant).toEqual({ epochMs: -1, subMsNs: 999999 })
  })

  it('respects an explicit unit', () => {
    const r = parseTimestamp('1704067200', 'ms')
    expect(r.ok && r.value.instant.epochMs).toBe(1704067200)
    expect(r.ok && r.value.detected).toBe(false)
  })

  it('ignores separators and accepts scientific notation', () => {
    const a = parseTimestamp('1_704_067_200')
    const b = parseTimestamp(' 1,704,067,200 ')
    const c = parseTimestamp('1.7040672e9')
    expect(a.ok && a.value.instant.epochMs).toBe(T2024)
    expect(b.ok && b.value.instant.epochMs).toBe(T2024)
    expect(c.ok && c.value.instant.epochMs).toBe(T2024)
  })

  it('reports precise errors', () => {
    const bad = parseTimestamp('17040x7200')
    expect(!bad.ok && bad.error).toContain('第 6 个字符「x」')
    const dots = parseTimestamp('1.2.3')
    expect(!dots.ok && dots.error).toContain('小数点')
    expect(parseTimestamp('').ok).toBe(false)
    expect(parseTimestamp('-').ok).toBe(false)
    const cn = parseTimestamp('时间')
    expect(!cn.ok && cn.error).toContain('第 1 个字符「时」')
  })

  it('rejects values beyond the Date range', () => {
    const r = parseTimestamp('9'.repeat(40))
    expect(!r.ok && r.error).toContain('超出可表示的范围')
    expect(parseTimestamp('8640000000000000', 'ms').ok).toBe(true)
    expect(parseTimestamp('8640000000000001', 'ms').ok).toBe(false)
  })

  it('round-trips nanoseconds through bigint helpers', () => {
    const ns = -123_456_789_012_345_678n
    expect(instantToNs(instantFromNs(ns))).toBe(ns)
  })
})

describe('time zones', () => {
  it('computes wall time and offsets in several zones', () => {
    expect(zonedParts(T2024, 'Asia/Shanghai')).toMatchObject({
      year: 2024,
      month: 1,
      day: 1,
      hour: 8,
      weekday: 1,
      offsetSeconds: 8 * 3600,
    })
    expect(zonedParts(T2024, 'America/New_York')).toMatchObject({
      year: 2023,
      month: 12,
      day: 31,
      hour: 19,
      weekday: 0,
      offsetSeconds: -5 * 3600,
    })
    expect(zonedParts(T2024, 'Asia/Kolkata').offsetSeconds).toBe(5.5 * 3600)
    expect(zonedParts(T2024, 'Australia/Sydney')).toMatchObject({ day: 1, hour: 11 })
    expect(zonedParts(T2024, 'UTC').offsetSeconds).toBe(0)
    // 夏令时
    expect(zonedParts(Date.UTC(2024, 6, 1), 'Europe/London').offsetSeconds).toBe(3600)
    expect(zonedParts(Date.UTC(2024, 6, 1), 'America/Los_Angeles').offsetSeconds).toBe(-7 * 3600)
  })

  it('handles years before 100 and BC', () => {
    const ms = Date.UTC(2000, 0, 1) - 2000 * 365.2425 * 86_400_000
    const p = zonedParts(ms, 'UTC')
    expect(p.year).toBeLessThanOrEqual(1)
    const y50 = zonedToEpoch(
      { year: 50, month: 3, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 },
      'UTC',
    )
    expect(new Date(y50.epochMs).getUTCFullYear()).toBe(50)
  })

  it('converts wall time to epoch with DST disambiguation', () => {
    const ny = (month: number, day: number, hour: number, minute = 0) =>
      zonedToEpoch(
        { year: 2024, month, day, hour, minute, second: 0, millisecond: 0 },
        'America/New_York',
      )
    expect(ny(1, 1, 0)).toEqual({ epochMs: Date.UTC(2024, 0, 1, 5), kind: 'exact' })
    // 2024-03-10 02:30 不存在 → 顺延到 03:30 EDT (07:30Z)
    expect(ny(3, 10, 2, 30)).toEqual({ epochMs: Date.UTC(2024, 2, 10, 7, 30), kind: 'gap' })
    // 2024-11-03 01:30 出现两次 → 取较早的 EDT (05:30Z)
    expect(ny(11, 3, 1, 30)).toEqual({ epochMs: Date.UTC(2024, 10, 3, 5, 30), kind: 'overlap' })
  })

  it('validates and normalizes zone names', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(normalizeTimeZone('Mars/Olympus')).toBe('Asia/Shanghai')
    expect(normalizeTimeZone('Europe/Berlin')).toBe('Europe/Berlin')
  })

  it('lists and searches zones', () => {
    const zones = allTimeZones()
    expect(zones).toContain('UTC')
    expect(zones).toContain('Asia/Shanghai')
    expect(zones.length).toBeGreaterThan(100)
    expect(searchTimeZones('tokyo', zones, NOW)[0]).toBe('Asia/Tokyo')
    expect(searchTimeZones('纽约', zones, NOW)[0]).toBe('America/New_York')
    expect(searchTimeZones('+8', zones, NOW)[0]).toBe('Asia/Shanghai')
    const india = searchTimeZones('UTC+05:30', zones, NOW)
    expect(india.some((z) => z === 'Asia/Kolkata' || z === 'Asia/Calcutta')).toBe(true)
    expect(searchTimeZones('', zones, NOW)).toBe(zones)
    expect(searchTimeZones('zzzz', zones, NOW)).toEqual([])
  })
})

describe('formatting', () => {
  it('formats offsets', () => {
    expect(formatOffset(28800)).toBe('+08:00')
    expect(formatOffset(-18000, '')).toBe('-0500')
    expect(formatOffset(0)).toBe('+00:00')
    expect(formatOffset(19800)).toBe('+05:30')
    expect(formatOffset(29143)).toBe('+08:05:43')
  })

  it('formats ISO 8601 with offset and precision', () => {
    expect(formatISO(at(T2024), 'Asia/Shanghai')).toBe('2024-01-01T08:00:00+08:00')
    expect(formatISO(at(T2024 + 5), 'UTC')).toBe('2024-01-01T00:00:00.005+00:00')
    expect(formatISO({ epochMs: T2024, subMsNs: 1000 }, 'UTC')).toBe(
      '2024-01-01T00:00:00.000001+00:00',
    )
    expect(formatISO({ epochMs: T2024, subMsNs: 1 }, 'UTC')).toBe(
      '2024-01-01T00:00:00.000000001+00:00',
    )
    expect(formatISO(at(T2024), 'America/New_York')).toBe('2023-12-31T19:00:00-05:00')
  })

  it('formats RFC 2822 and HTTP dates', () => {
    expect(formatRFC2822(T2024, 'Asia/Shanghai')).toBe('Mon, 01 Jan 2024 08:00:00 +0800')
    expect(formatRFC2822(T2024, 'America/Los_Angeles')).toBe('Sun, 31 Dec 2023 16:00:00 -0800')
    expect(formatHttpDate(T2024)).toBe('Mon, 01 Jan 2024 00:00:00 GMT')
    expect(formatHttpDate(T2024)).toBe(new Date(T2024).toUTCString())
  })

  it('computes ISO week numbers', () => {
    expect(isoWeek(2024, 1, 1)).toEqual({ year: 2024, week: 1 })
    expect(isoWeek(2021, 1, 3)).toEqual({ year: 2020, week: 53 })
    expect(isoWeek(2024, 12, 30)).toEqual({ year: 2025, week: 1 })
    expect(isoWeek(2026, 9, 24)).toEqual({ year: 2026, week: 39 })
  })

  it('formats relative time and durations in Chinese', () => {
    expect(formatRelative(NOW - 3 * 3600_000, NOW)).toBe('3小时前')
    expect(formatRelative(NOW + 2 * 86_400_000, NOW)).toBe('2天后')
    expect(formatRelative(NOW + 400, NOW)).toBe('现在')
    expect(formatRelative(NOW - 400 * 86_400_000, NOW)).toBe('1年前')
    expect(formatRelative(NOW - 45_000, NOW)).toBe('45秒钟前')
    expect(formatDuration(95 * 86_400_000 + 3 * 3600_000 + 5000)).toBe('95 天 3 小时')
    expect(formatDuration(500)).toBe('不到 1 秒')
    expect(formatDuration(3_725_000)).toBe('1 小时 2 分 5 秒')
  })

  it('describes an instant in the selected zone', () => {
    const d = describeInstant({ epochMs: T2024 + 123, subMsNs: 456000 }, 'Asia/Shanghai', NOW)
    expect(d.local).toBe('2024-01-01 08:00:00.123456')
    expect(d.iso).toBe('2024-01-01T08:00:00.123456+08:00')
    expect(d.isoUtc).toBe('2024-01-01T00:00:00.123Z')
    expect(d.chinese).toBe('2024年1月1日 星期一 08:00:00')
    expect(d.weekday).toBe('星期一')
    expect(d.dayOfYear).toBe(1)
    expect(d.daysInYear).toBe(366)
    expect(d.offset).toBe('UTC+08:00')
    expect(d.seconds).toBe('1704067200')
    expect(d.millis).toBe('1704067200123')
    expect(d.micros).toBe('1704067200123456')
    expect(d.nanos).toBe('1704067200123456000')
    expect(d.relative).toBe('5个月前')
  })

  it('outputs timestamps per unit with floor for negatives', () => {
    expect(instantToUnit({ epochMs: -1500, subMsNs: 0 }, 's')).toBe('-2')
    expect(instantToUnit({ epochMs: -1500, subMsNs: 0 }, 'ms')).toBe('-1500')
  })
})

describe('parseDateInput', () => {
  it.each([
    ['2024-01-01 08:00:00', 'Asia/Shanghai', T2024],
    ['2024-01-01 08:00', 'Asia/Shanghai', T2024],
    ['2024-01-01T08:00:00', 'Asia/Shanghai', T2024],
    ['2024-01-01', 'UTC', T2024],
    ['2024/1/1', 'UTC', T2024],
    ['2024/1/1 8:00', 'Asia/Shanghai', T2024],
    ['2024.01.01', 'UTC', T2024],
    ['2024-01', 'UTC', T2024],
    ['2023-12-31 19:00:00', 'America/New_York', T2024],
    ['2024-01-01T00:00:00Z', 'Asia/Tokyo', T2024],
    ['2024-01-01T08:00:00+08:00', 'UTC', T2024],
    ['2024-01-01T08:00:00+0800', 'UTC', T2024],
    ['2024-01-01 08:00:00 GMT+8', 'UTC', T2024],
    ['2023-12-31T19:00:00-05:00', 'Asia/Shanghai', T2024],
    ['Mon, 01 Jan 2024 08:00:00 +0800', 'UTC', T2024],
    ['01 Jan 2024 00:00:00 GMT', 'Asia/Shanghai', T2024],
    ['Sun, 31 Dec 2023 14:00:00 EST', 'UTC', Date.UTC(2023, 11, 31, 19)],
    ['Mon Jan 01 2024 08:00:00 GMT+0800 (中国标准时间)', 'UTC', T2024],
    ['Jan 1, 2024 8:00 AM', 'Asia/Shanghai', T2024],
    ['January 1st, 2024', 'UTC', T2024],
    ['2024年1月1日 08:00', 'Asia/Shanghai', T2024],
    ['2024年1月1日 8时', 'Asia/Shanghai', T2024],
    ['2024年1月1日', 'UTC', T2024],
    ['2023年12月31日 下午7点', 'America/New_York', T2024],
    ['20240101', 'UTC', T2024],
    ['20240101080000', 'Asia/Shanghai', T2024],
    ['1704067200', 'UTC', T2024],
    ['1704067200000', 'UTC', T2024],
  ] as const)('%s (%s)', (input, tz, expected) => {
    expect(parsedMs(input, tz)).toBe(expected)
  })

  it('keeps fractional seconds', () => {
    const r = parseDateInput('2024-01-01T00:00:00.123456789Z', 'UTC', NOW)
    expect(r.ok && r.value.instant).toEqual({ epochMs: T2024 + 123, subMsNs: 456789 })
  })

  it('reports the recognised format and zone source', () => {
    const a = parseDateInput('2024-01-01T08:00:00+08:00', 'UTC', NOW)
    expect(a.ok && a.value.zoneFromInput).toBe(true)
    expect(a.ok && a.value.format).toBe('ISO 8601')
    const b = parseDateInput('2024-01-01 08:00:00', 'UTC', NOW)
    expect(b.ok && b.value.zoneFromInput).toBe(false)
    const c = parseDateInput('2024-03-10 02:30', 'America/New_York', NOW)
    expect(c.ok && c.value.kind).toBe('gap')
  })

  it('understands keywords and relative expressions', () => {
    expect(parsedMs('now')).toBe(NOW)
    expect(parsedMs('现在')).toBe(NOW)
    // NOW 在上海是 2024-06-15 12:00
    expect(parsedMs('today')).toBe(Date.UTC(2024, 5, 14, 16))
    expect(parsedMs('昨天')).toBe(Date.UTC(2024, 5, 13, 16))
    expect(parsedMs('明天')).toBe(Date.UTC(2024, 5, 15, 16))
    expect(parsedMs('+1d')).toBe(NOW + 86_400_000)
    expect(parsedMs('now-2h')).toBe(NOW - 7_200_000)
    expect(parsedMs('now + 1d2h')).toBe(NOW + 86_400_000 + 7_200_000)
    expect(parsedMs('-30m')).toBe(NOW - 1_800_000)
    expect(parsedMs('+1M')).toBe(Date.UTC(2024, 6, 15, 4))
    expect(parsedMs('+1y')).toBe(Date.UTC(2025, 5, 15, 4))
    expect(parsedMs('+1w')).toBe(NOW + 7 * 86_400_000)
    expect(parsedMs('2 days ago')).toBe(NOW - 2 * 86_400_000)
    expect(parsedMs('in 3 hours')).toBe(NOW + 3 * 3_600_000)
    expect(parsedMs('3天前')).toBe(NOW - 3 * 86_400_000)
    expect(parsedMs('2 小时后')).toBe(NOW + 2 * 3_600_000)
    expect(parsedMs('半小时后')).toBe(NOW + 1_800_000)
    expect(parsedMs('12:30')).toBe(Date.UTC(2024, 5, 15, 4, 30))
  })

  it('adds months with end-of-month clamping', () => {
    const jan31 = Date.UTC(2024, 0, 31, 12)
    expect(addToInstant(jan31, 'UTC', 1, 'M')).toBe(Date.UTC(2024, 1, 29, 12))
    expect(addToInstant(jan31, 'UTC', -2, 'M')).toBe(Date.UTC(2023, 10, 30, 12))
    expect(addToInstant(Date.UTC(2024, 1, 29), 'UTC', 1, 'y')).toBe(Date.UTC(2025, 1, 28))
  })

  it('adds days by wall clock across DST', () => {
    // 纽约 2024-03-09 12:00 EST → +1d → 2024-03-10 12:00 EDT（只过了 23 小时）
    const start = Date.UTC(2024, 2, 9, 17)
    expect(addToInstant(start, 'America/New_York', 1, 'd')).toBe(Date.UTC(2024, 2, 10, 16))
    expect(addToInstant(start, 'America/New_York', 24, 'h')).toBe(Date.UTC(2024, 2, 10, 17))
  })

  it('gives helpful errors', () => {
    expect(parseError('2024-13-01')).toContain('月份「13」无效')
    expect(parseError('2023-02-29')).toContain('2023 年 2 月只有 28 天')
    expect(parseError('2024-01-01 25:00')).toContain('小时「25」无效')
    expect(parseError('2024-01-01 10:61')).toContain('分钟「61」无效')
    expect(parseError('hello world')).toContain('无法识别「hello world」')
    expect(parseError('+1q')).toContain('无法识别的时间单位「q」')
    expect(parseError('')).toBe('请输入日期时间')
  })

  it('accepts leap days', () => {
    expect(parsedMs('2024-02-29', 'UTC')).toBe(Date.UTC(2024, 1, 29))
    expect(parsedMs('2000-02-29', 'UTC')).toBe(Date.UTC(2000, 1, 29))
    expect(parseError('1900-02-29', 'UTC')).toContain('只有 28 天')
  })

  it('parses zone offsets', () => {
    expect(parseZoneOffset('+08:00')).toBe(480)
    expect(parseZoneOffset('-0530')).toBe(-330)
    expect(parseZoneOffset('GMT+8')).toBe(480)
    expect(parseZoneOffset('Z')).toBe(0)
    expect(parseZoneOffset('PDT')).toBe(-420)
    expect(parseZoneOffset('+25')).toBeNull()
  })
})

describe('convertBatch', () => {
  it('converts mixed lines both ways and keeps blanks', () => {
    const lines = convertBatch('1704067200\n\n2024-01-01 08:00:00\n1704067200000\nfoo\n-1', {
      tz: 'Asia/Shanghai',
      nowMs: NOW,
      dateFormat: 'local',
      tsUnit: 's',
    })
    expect(lines.map((l) => l.kind)).toEqual([
      'ts2date',
      'empty',
      'date2ts',
      'ts2date',
      'date2ts',
      'ts2date',
    ])
    expect(lines[0].output).toBe('2024-01-01 08:00:00')
    expect(lines[0].unit).toBe('s')
    expect(lines[2].output).toBe('1704067200')
    expect(lines[3].unit).toBe('ms')
    expect(lines[4].error).toContain('无法识别')
    expect(lines[5].output).toBe('1970-01-01 07:59:59')
  })

  it('supports other output formats and units', () => {
    const [a, b] = convertBatch('1704067200\n2024-01-01T00:00:00Z', {
      tz: 'UTC',
      nowMs: NOW,
      dateFormat: 'iso',
      tsUnit: 'ms',
    })
    expect(a.output).toBe('2024-01-01T00:00:00+00:00')
    expect(b.output).toBe('1704067200000')
  })

  it('treats dotted dates as dates, not numbers', () => {
    const [a] = convertBatch('2024.01.01', {
      tz: 'UTC',
      nowMs: NOW,
      dateFormat: 'local',
      tsUnit: 's',
    })
    expect(a.kind).toBe('date2ts')
    expect(a.output).toBe('1704067200')
  })

  it('handles large batches quickly', () => {
    const text = Array.from({ length: 5000 }, (_, i) => String(1704067200 + i * 3600)).join('\n')
    const t0 = performance.now()
    const out = convertBatch(text, {
      tz: 'Asia/Shanghai',
      nowMs: NOW,
      dateFormat: 'iso',
      tsUnit: 's',
    })
    expect(out).toHaveLength(5000)
    expect(out.every((l) => !l.error)).toBe(true)
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})

describe('regressions', () => {
  it('never throws near or beyond the Date range (was RangeError)', () => {
    for (const input of [
      '999999-01-01',
      '+275760-09-13',
      '275760-09-13',
      '-271821-04-20',
      '+1000000y',
      '+99999999999d',
      '+100000000000000000000M',
      '999999999999天前',
      `+${'9'.repeat(400)}d`,
    ]) {
      for (const tz of ['UTC', 'Asia/Shanghai', 'America/New_York']) {
        expect(() => parseDateInput(input, tz, NOW)).not.toThrow()
      }
    }
    expect(parseError('999999-01-01')).toContain('超出可表示的范围')
    expect(parseError('+1000000y')).toContain('超出可表示的范围')
    expect(parsedMs('275760-09-13', 'UTC')).toBe(8.64e15)
    expect(() =>
      convertBatch('999999-01-01\n+1000000y', {
        tz: 'UTC',
        nowMs: NOW,
        dateFormat: 'local',
        tsUnit: 's',
      }),
    ).not.toThrow()
  })

  it('describes instants at the edge of the Date range without NaN', () => {
    const max = describeInstant(at(8.64e15), 'Asia/Shanghai', NOW)
    expect(max.local).toBe('275760-09-13 08:00:00')
    expect(max.iso).toBe('+275760-09-13T08:00:00+08:00')
    expect(max.rfc2822).toBe('Sat, 13 Sep 275760 08:00:00 +0800')
    expect(max.weekday).toBe('星期六')
    const min = describeInstant(at(-8.64e15), 'America/New_York', NOW)
    expect(min.iso).toBe('-271821-04-19T19:03:58-04:56:02')
    expect(JSON.stringify(min)).not.toMatch(/NaN|undefined/)
    expect(JSON.stringify(max)).not.toMatch(/NaN|undefined/)
  })

  it('pure calendar arithmetic matches Date', () => {
    for (const ms of [0, -1, T2024, Date.UTC(1600, 1, 29), Date.UTC(-500, 6, 4), 8.64e15]) {
      const d = new Date(ms)
      const days = Math.floor(ms / 86_400_000)
      expect(civilFromDays(days)).toEqual({
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
      })
      expect(daysFromCivil(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())).toBe(days)
    }
  })

  it('relative keywords are case-insensitive', () => {
    expect(parsedMs('Now+1d')).toBe(NOW + 86_400_000)
    expect(parsedMs('NOW - 2H')).toBe(NOW - 7_200_000)
    expect(parsedMs('2 Days Ago')).toBe(NOW - 2 * 86_400_000)
  })

  it('reports emoji as a whole character', () => {
    const r = parseTimestamp('1😀')
    expect(!r.ok && r.error).toBe('第 2 个字符「😀」不是数字：时间戳只能包含数字、负号和小数点')
  })

  it('accepts full-width digits typed with a Chinese IME', () => {
    expect(toHalfWidth('１７０４０６７２００')).toBe('1704067200')
    const r = parseTimestamp('１７０４０６７２００')
    expect(r.ok && r.value.instant.epochMs).toBe(T2024)
    expect(parsedMs('２０２４－０１－０１　０８：００', 'Asia/Shanghai')).toBe(T2024)
  })

  it('falls back to auto for an unknown unit instead of throwing', () => {
    const r = parseTimestamp('1704067200', 'bogus' as never)
    expect(r.ok && r.value.unit).toBe('s')
  })
})
