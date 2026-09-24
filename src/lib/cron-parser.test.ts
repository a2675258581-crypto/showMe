import { describe, expect, it } from 'vitest'
import {
  analyzeCron,
  buildExpression,
  builderToToken,
  CRON_PRESETS,
  defaultBuilder,
  describeCron,
  explainToken,
  FIELD_ORDER,
  FIELD_SPECS,
  normalizeCron,
  tokenToBuilder,
  translateCronError,
  validateField,
  type FieldBuilder,
  type FieldKey,
} from './cron-parser'

const FROM = Date.UTC(2024, 0, 1) // 2024-01-01 00:00Z（上海 08:00，星期一）

function analysis(expr: string, tz = 'Asia/Shanghai', count = 10) {
  const r = analyzeCron(expr, { tz, from: FROM, count })
  if (!r.ok) throw new Error(r.error)
  return r.value
}

function error(expr: string, tz = 'Asia/Shanghai') {
  const r = analyzeCron(expr, { tz, from: FROM })
  if (r.ok) throw new Error(`expected error for ${expr}`)
  return r.error
}

const iso = (d: Date) => d.toISOString()

describe('normalizeCron', () => {
  it('accepts 5 and 6 fields', () => {
    const five = normalizeCron('*/5  *\t* * *')
    expect(five.ok && five.value).toMatchObject({ hasSeconds: false, expression: '*/5 * * * *' })
    expect(five.ok && five.value.fields.second).toBe('0')
    const six = normalizeCron('30 0 2 * * *')
    expect(six.ok && six.value).toMatchObject({ hasSeconds: true, expression: '30 0 2 * * *' })
    expect(six.ok && six.value.fields.minute).toBe('0')
  })

  it('expands macros', () => {
    const d = normalizeCron('@daily')
    expect(d.ok && d.value).toMatchObject({ macro: '@daily', expression: '0 0 * * *' })
    const h = normalizeCron('@HOURLY')
    expect(h.ok && h.value.expression).toBe('0 * * * *')
  })

  it('separates the command of a crontab line', () => {
    const r = normalizeCron('0 2 * * * /usr/bin/backup.sh --full')
    expect(r.ok && r.value).toMatchObject({
      expression: '0 2 * * *',
      command: '/usr/bin/backup.sh --full',
    })
    const m = normalizeCron('@weekly echo hi')
    expect(m.ok && m.value.command).toBe('echo hi')
  })

  it('rejects bad shapes with helpful messages', () => {
    const cases: [string, string][] = [
      ['', '请输入 Cron 表达式'],
      ['* * * *', '至少需要 5 段'],
      ['@reboot', '系统启动时运行一次'],
      ['@often', '未知的预定义表达式「@often」'],
      ['0 0 12 1 1 ? 2025', '第 7 段（年份'],
      ['0 0 1 1 * 2025', '看起来是年份'],
      ['60 * * * * *', '「秒」字段的值 60 超出范围（0–59）'],
    ]
    for (const [input, msg] of cases) {
      const r = normalizeCron(input)
      expect(!r.ok && r.error).toContain(msg)
    }
  })
})

describe('validateField', () => {
  const v = (token: string, key: FieldKey) => validateField(token, FIELD_SPECS[key])
  it('accepts standard syntax', () => {
    for (const [t, k] of [
      ['*', 'minute'],
      ['?', 'dayOfMonth'],
      ['*/15', 'minute'],
      ['5/15', 'minute'],
      ['1-5', 'dayOfWeek'],
      ['MON-FRI', 'dayOfWeek'],
      ['jan,mar', 'month'],
      ['0,30', 'minute'],
      ['9-17/2', 'hour'],
      ['L', 'dayOfMonth'],
      ['5L', 'dayOfWeek'],
      ['1#2', 'dayOfWeek'],
      ['7', 'dayOfWeek'],
      ['H', 'minute'],
      ['H(0-29)/5', 'minute'],
    ] as [string, FieldKey][]) {
      expect(v(t, k), `${k}: ${t}`).toBeNull()
    }
  })

  it('explains what is wrong', () => {
    expect(v('61', 'minute')).toBe('「分」字段的值 61 超出范围（0–59）')
    expect(v('24', 'hour')).toContain('超出范围（0–23）')
    expect(v('0', 'dayOfMonth')).toContain('超出范围（1–31）')
    expect(v('13', 'month')).toContain('超出范围（1–12）')
    expect(v('8', 'dayOfWeek')).toContain('超出范围（0–7）')
    expect(v('abc', 'month')).toContain('可用 1–12 或 JAN–DEC')
    expect(v('xyz', 'dayOfWeek')).toContain('SUN–SAT')
    expect(v('*/0', 'minute')).toContain('步长不能为 0')
    expect(v('*/x', 'minute')).toContain('步长「x」必须是正整数')
    expect(v('/5', 'minute')).toContain('缺少起始值')
    expect(v('22-2', 'hour')).toContain('起点大于终点')
    expect(v('1,,2', 'minute')).toContain('多余的逗号')
    expect(v('1-2-3', 'minute')).toContain('格式不正确')
    expect(v('*/5/2', 'minute')).toContain('多个「/」')
    expect(v('15W', 'dayOfMonth')).toContain('暂不支持')
    expect(v('L', 'minute')).toContain('只能用于日或周字段')
    expect(v('1#6', 'dayOfWeek')).toContain('序号应为 1–5')
    expect(v('1#2,3', 'dayOfWeek')).toContain('不能与逗号列表一起使用')
    expect(v('五', 'minute')).toContain('无法识别「五」')
  })
})

describe('describeCron', () => {
  const d = (expr: string) => {
    const n = normalizeCron(expr)
    if (!n.ok) throw new Error(n.error)
    return describeCron(n.value)
  }
  it('uses cronstrue zh_CN and polishes spacing', () => {
    expect(d('*/5 * * * *')).toBe('每隔 5 分钟')
    expect(d('0 2 * * *')).toBe('每天 02:00')
    expect(d('@daily')).toBe('每天 00:00')
    expect(d('0 9 * * 1-5')).toBe('在 09:00，星期一至星期五')
    expect(d('* * * * * *')).toBe('每秒')
    expect(d('0 8 * * 0,6')).toBe('在 08:00，仅星期日和星期六')
    expect(d('0 0 * * 1#2')).toBe('在 00:00，限每月的第二个星期一')
    expect(d('0 0 1 1,4,7,10 *')).toBe('在 00:00，限每月 1 号，仅于一月，四月，七月和十月份')
    expect(d('*/15 9-18 1,15 * 1-5')).toContain('限每月 1 号和 15 号，和星期一至星期五')
  })

  it('falls back to field explanations when cronstrue cannot describe', () => {
    expect(d('H * * * *')).toContain('分：随机取值')
  })
})

describe('explainToken', () => {
  const e = (token: string, key: FieldKey) => explainToken(token, FIELD_SPECS[key])
  it.each([
    ['*', 'minute', '每分钟'],
    ['*/5', 'minute', '每隔 5 分钟'],
    ['5/15', 'minute', '从 5 分起每隔 15 分钟'],
    ['0,30', 'minute', '0 分、30 分'],
    ['9-17', 'hour', '9 点到 17 点'],
    ['9-17/2', 'hour', '9 点到 17 点之间每隔 2 小时'],
    ['*/2', 'dayOfMonth', '从 1 号起每隔 2 天'],
    ['L', 'dayOfMonth', '每月最后一天'],
    ['1-5', 'dayOfWeek', '周一到周五'],
    ['MON,FRI', 'dayOfWeek', '周一、周五'],
    ['7', 'dayOfWeek', '周日'],
    ['5L', 'dayOfWeek', '每月最后一个周五'],
    ['1#2', 'dayOfWeek', '每月第 2 个周一'],
    ['JAN-MAR', 'month', '1 月到 3 月'],
    ['*/3', 'month', '从 1 月起每隔 3 个月'],
    ['?', 'dayOfWeek', '不指定'],
  ] as [string, FieldKey, string][])('%s (%s) → %s', (token, key, expected) => {
    expect(e(token, key)).toBe(expected)
  })
})

describe('analyzeCron', () => {
  it('lists the next runs in the selected zone', () => {
    const a = analysis('0 2 * * *')
    expect(a.runs).toHaveLength(10)
    // 上海凌晨 2 点 = 前一天 18:00Z
    expect(iso(a.runs[0])).toBe('2024-01-01T18:00:00.000Z')
    expect(iso(a.runs[1])).toBe('2024-01-02T18:00:00.000Z')
    const ny = analysis('0 2 * * *', 'America/New_York')
    expect(iso(ny.runs[0])).toBe('2024-01-01T07:00:00.000Z')
    const utc = analysis('0 2 * * *', 'UTC')
    expect(iso(utc.runs[0])).toBe('2024-01-01T02:00:00.000Z')
  })

  it('supports seconds, weekdays, L and #', () => {
    expect(analysis('*/30 * * * * *').runs.slice(0, 2).map(iso)).toEqual([
      '2024-01-01T00:00:30.000Z',
      '2024-01-01T00:01:00.000Z',
    ])
    // 2024-01-06 是周六
    expect(iso(analysis('0 8 * * 0,6').runs[0])).toBe('2024-01-06T00:00:00.000Z')
    expect(iso(analysis('0 0 L * *', 'UTC').runs[1])).toBe('2024-02-29T00:00:00.000Z')
    expect(iso(analysis('0 0 * * 5L', 'UTC').runs[0])).toBe('2024-01-26T00:00:00.000Z')
    expect(iso(analysis('0 0 * * 1#2', 'UTC').runs[0])).toBe('2024-01-08T00:00:00.000Z')
    expect(iso(analysis('0 0 1 1,4,7,10 *', 'UTC').runs[0])).toBe('2024-04-01T00:00:00.000Z')
  })

  it('handles DST in America/New_York', () => {
    // 2024-03-10 02:30 在纽约不存在
    const r = analyzeCron('30 2 * * *', { tz: 'America/New_York', from: Date.UTC(2024, 2, 9, 12) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.runs.length).toBe(10)
      for (let i = 1; i < r.value.runs.length; i++) {
        expect(r.value.runs[i].getTime()).toBeGreaterThan(r.value.runs[i - 1].getTime())
      }
    }
  })

  it('returns field breakdown with expanded values', () => {
    const a = analysis('0,30 9-11 * * 1-5')
    const byKey = Object.fromEntries(a.fields.map((f) => [f.key, f]))
    expect(a.fields.map((f) => f.label)).toEqual(['秒', '分', '时', '日', '月', '周'])
    expect(byKey.second.implicit).toBe(true)
    expect(byKey.minute.values).toEqual([0, 30])
    expect(byKey.hour.values).toEqual([9, 10, 11])
    expect(byKey.dayOfWeek.values).toEqual([1, 2, 3, 4, 5])
    expect(byKey.dayOfMonth.wildcard).toBe(true)
    // 7 与 0 都是周日，去重
    expect(analysis('0 0 * * *').fields[5].values).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('adds notes for OR semantics, big steps and commands', () => {
    expect(analysis('0 0 1,15 * 1').notes.join()).toContain('满足其中任意一个')
    expect(analysis('*/60 * * * *').notes.join()).toContain('步长 60 超过取值范围')
    expect(analysis('0 2 * * * /bin/job').notes.join()).toContain('/bin/job')
  })

  it('reports impossible dates and bad zones', () => {
    expect(error('0 0 30 2 *')).toContain('永远不会执行')
    expect(error('0 0 * * *', 'Mars/Base')).toContain('无效的时区')
  })

  it('Feb 29 only runs in leap years', () => {
    const a = analysis('0 0 29 2 *', 'UTC', 3)
    expect(a.runs.map((d) => d.getUTCFullYear())).toEqual([2024, 2028, 2032])
  })

  it('every preset is valid', () => {
    for (const p of CRON_PRESETS) {
      const r = analyzeCron(p.expr, { tz: 'Asia/Shanghai', from: FROM })
      expect(r.ok, p.expr).toBe(true)
    }
  })
})

describe('translateCronError', () => {
  it('translates known messages', () => {
    expect(translateCronError('Constraint error, got value 61 expected range 0-59')).toBe(
      '数值 61 超出范围（0–59）',
    )
    expect(translateCronError('Invalid characters, got value: 1W')).toContain('1W')
    expect(translateCronError('something else')).toBe('表达式无效：something else')
  })
})

describe('builder', () => {
  it('parses tokens into builder state', () => {
    expect(tokenToBuilder('*', 'minute').mode).toBe('every')
    expect(tokenToBuilder('*/5', 'minute')).toMatchObject({ mode: 'step', step: 5, start: 0 })
    expect(tokenToBuilder('10/15', 'minute')).toMatchObject({ mode: 'step', step: 15, start: 10 })
    expect(tokenToBuilder('9-17', 'hour')).toMatchObject({ mode: 'range', from: 9, to: 17 })
    expect(tokenToBuilder('MON-FRI', 'dayOfWeek')).toMatchObject({ mode: 'range', from: 1, to: 5 })
    expect(tokenToBuilder('30,0,30', 'minute')).toMatchObject({ mode: 'specific', values: [0, 30] })
    expect(tokenToBuilder('7', 'dayOfWeek')).toMatchObject({ mode: 'specific', values: [0] })
    expect(tokenToBuilder('5L', 'dayOfWeek')).toMatchObject({ mode: 'custom', custom: '5L' })
    expect(tokenToBuilder('1-5/2', 'hour')).toMatchObject({ mode: 'custom' })
  })

  it('serializes builder state', () => {
    const b = (patch: Partial<FieldBuilder>, key: FieldKey = 'minute') =>
      builderToToken({ ...defaultBuilder(key), ...patch }, key)
    expect(b({ mode: 'every' })).toBe('*')
    expect(b({ mode: 'step', step: 10, start: 0 })).toBe('*/10')
    expect(b({ mode: 'step', step: 10, start: 5 })).toBe('5/10')
    expect(b({ mode: 'range', from: 17, to: 9 }, 'hour')).toBe('9-17')
    expect(b({ mode: 'range', from: 3, to: 3 }, 'hour')).toBe('3')
    expect(b({ mode: 'specific', values: [30, 0, 15] })).toBe('0,15,30')
    expect(b({ mode: 'specific', values: [] })).toBe('*')
    expect(b({ mode: 'custom', custom: ' 5L ' }, 'dayOfWeek')).toBe('5L')
    expect(b({ mode: 'step', step: 2, start: 1 }, 'dayOfMonth')).toBe('*/2')
  })

  it('round-trips presets through the builder', () => {
    for (const p of CRON_PRESETS) {
      const n = normalizeCron(p.expr)
      if (!n.ok) throw new Error(n.error)
      const builders = Object.fromEntries(
        FIELD_ORDER.map((k) => [k, tokenToBuilder(n.value.fields[k], k)]),
      ) as Record<FieldKey, FieldBuilder>
      const rebuilt = buildExpression(builders, n.value.hasSeconds)
      const a = analyzeCron(rebuilt, { tz: 'UTC', from: FROM })
      const b = analyzeCron(p.expr, { tz: 'UTC', from: FROM })
      expect(a.ok && a.value.runs.map(iso), p.expr).toEqual(b.ok && b.value.runs.map(iso))
    }
  })
})

describe('regressions', () => {
  it('H fields give stable run times across re-parses (was random per parse)', () => {
    const a = analysis('H H * * *').runs.map(iso)
    const b = analysis('H H * * *').runs.map(iso)
    expect(a).toEqual(b)
    expect(analysis('H/15 * * * *').notes.some((n) => n.includes('「H」'))).toBe(true)
  })

  it('recognises a trailing year range / list, not just a single year', () => {
    expect(error('0 0 1 1 * 2025-2030')).toContain('看起来是年份')
    expect(error('0 0 1 1 * 2025,2026')).toContain('看起来是年份')
  })

  it('maps day-of-week ranges ending in 7 correctly in the builder', () => {
    expect(tokenToBuilder('0-7', 'dayOfWeek').mode).toBe('every')
    expect(tokenToBuilder('1-7', 'dayOfWeek').mode).toBe('every')
    expect(tokenToBuilder('5-7', 'dayOfWeek')).toMatchObject({ mode: 'custom', custom: '5-7' })
  })
})
