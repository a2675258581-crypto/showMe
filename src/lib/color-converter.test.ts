import { describe, expect, it } from 'vitest'
import {
  BLACK,
  WHITE,
  contrastRatio,
  describeColor,
  fmt,
  gamutMap,
  generateScale,
  inGamut,
  NAMED_COLORS,
  nearestNamed,
  parseColor,
  randomColor,
  readableOn,
  rgbToLab,
  rgbToOklch,
  suggestName,
  toHex,
  wcag,
  type RGBA,
} from './color-converter'

function rgb(input: string): RGBA {
  const r = parseColor(input)
  if (!r.ok) throw new Error(r.error)
  return r.value.rgb
}

function hex(input: string): string {
  return toHex(gamutMap(rgb(input)), rgb(input).alpha < 1)
}

function err(input: string): string {
  const r = parseColor(input)
  if (r.ok) throw new Error(`expected error for ${input}`)
  return r.error
}

function info(input: string, opts = {}) {
  const r = parseColor(input)
  if (!r.ok) throw new Error(r.error)
  return describeColor(r.value, opts)
}

describe('parseColor', () => {
  it.each([
    ['#f00', '#ff0000'],
    ['#F00', '#ff0000'],
    ['#ff000080', '#ff000080'],
    ['#f008', '#ff000088'],
    ['ff8800', '#ff8800'],
    ['red', '#ff0000'],
    ['RebeccaPurple', '#663399'],
    ['rgb(255, 0, 0)', '#ff0000'],
    ['rgba(255,0,0,0.5)', '#ff000080'],
    ['rgb(255 0 0 / 50%)', '#ff000080'],
    ['rgb(100% 0% 0%)', '#ff0000'],
    ['rgb(300 -20 0)', '#ff0000'],
    ['rgb(none 128 0)', '#008000'],
    ['255, 136, 0', '#ff8800'],
    ['hsl(120, 100%, 25%)', '#008000'],
    ['hsl(120deg 100% 25%)', '#008000'],
    ['hsl(120 100 25)', '#008000'],
    ['hsla(0, 100%, 50%, .25)', '#ff000040'],
    ['hsl(0.5turn 100% 50%)', '#00ffff'],
    ['hsl(3.14159rad 100% 50%)', '#00ffff'],
    ['hsl(200grad 100% 50%)', '#00ffff'],
    ['hwb(0 0% 0%)', '#ff0000'],
    ['hwb(0 50% 50%)', '#808080'],
    ['hwb(120 20% 30%)', '#33b333'],
    ['lab(54.29% 80.8 69.89)', '#ff0000'],
    ['lab(100 0 0)', '#ffffff'],
    ['lch(54.29 106.84 40.85)', '#ff0000'],
    ['oklab(0.62796 0.22486 0.12585)', '#ff0000'],
    ['oklab(62.796% 56.2% 31.46%)', '#ff0000'],
    ['oklch(0.62796 0.25768 29.23)', '#ff0000'],
    ['oklch(62.8% 0.2577 29.23 / 0.5)', '#ff000080'],
    ['oklch(1 0 0)', '#ffffff'],
    ['oklch(0 0 0)', '#000000'],
    ['color(srgb 1 0.5 0)', '#ff8000'],
    ['color(srgb-linear 1 0.2159 0)', '#ff8000'],
    ['color(display-p3 0.5 0.5 0.5)', '#808080'],
    ['color(xyz-d65 0.9505 1 1.089)', '#ffffff'],
    ['transparent', '#00000000'],
    ['  #abc;  ', '#aabbcc'],
  ])('%s → %s', (input, expected) => {
    expect(hex(input)).toBe(expected)
  })

  it('detects the input format', () => {
    const fmtOf = (s: string) => {
      const r = parseColor(s)
      return r.ok ? r.value.format : null
    }
    expect(fmtOf('#fff')).toBe('hex')
    expect(fmtOf('navy')).toBe('named')
    expect(fmtOf('rgba(0,0,0,.1)')).toBe('rgb')
    expect(fmtOf('hsla(0,0%,0%,1)')).toBe('hsl')
    expect(fmtOf('oklch(0.5 0.1 200)')).toBe('oklch')
  })

  it('includes the full CSS named color table', () => {
    expect(Object.keys(NAMED_COLORS)).toHaveLength(148)
    for (const [name, value] of Object.entries(NAMED_COLORS)) {
      expect(hex(name)).toBe(value)
    }
  })

  it('reports precise errors', () => {
    expect(err('')).toBe('请输入颜色')
    expect(err('#12345')).toContain('3、4、6 或 8 位，实际是 5 位')
    expect(err('#ggg')).toContain('「g」不是十六进制数字')
    expect(err('rgb(255 0)')).toContain('需要 3 个分量（红、绿、蓝）')
    expect(err('rgb(255 0 abc)')).toContain('蓝「abc」不是有效的数值')
    expect(err('rgb(255, 0%, 0)')).toContain('不能混用数字和百分比')
    expect(err('hsl(10%, 50%, 50%)')).toContain('色相「10%」不能使用百分比')
    expect(err('hsl(10, 50, 50)')).toContain('需要带 %')
    expect(err('hwb(10, 50%, 50%)')).toContain('不支持逗号分隔')
    expect(err('rgb(1 2 3 / )')).toContain('缺少透明度')
    expect(err('rgb(1 2 3 / x)')).toContain('透明度「x」无效')
    expect(err('rgb(1 2 3')).toContain('缺少右括号')
    expect(err('foo(1 2 3)')).toContain('不支持的颜色函数「foo()」')
    expect(err('color(rec2020 1 0 0)')).toContain('不支持的色彩空间')
    expect(err('bleu')).toContain('是不是想输入「blue」')
    expect(err('颜色')).toContain('无法识别「颜色」')
    expect(err('🎨')).toContain('无法识别')
  })

  it('suggests close names', () => {
    expect(suggestName('grean')).toBe('green')
    expect(suggestName('rebecca')).toBe('rebeccapurple')
    expect(suggestName('zzzzzzzz')).toBeUndefined()
  })
})

describe('conversions', () => {
  it('converts red to every format', () => {
    const f = info('#ff0000').formats
    expect(f.hex).toBe('#ff0000')
    expect(f.hex8).toBe('#ff0000ff')
    expect(f.rgb).toBe('rgb(255 0 0)')
    expect(f.hsl).toBe('hsl(0 100% 50%)')
    expect(f.hsv).toBe('hsv(0, 100%, 100%)')
    expect(f.hwb).toBe('hwb(0 0% 0%)')
    expect(f.cmyk).toBe('cmyk(0%, 100%, 100%, 0%)')
    expect(f.oklch).toBe('oklch(62.8% 0.25768 29.23)')
    expect(f.oklab).toBe('oklab(62.8% 0.22486 0.12585)')
    expect(f.lab).toBe('lab(54.29% 80.8 69.89)')
    expect(f.lch).toMatch(/^lch\(54\.29% 106\.8[34] 40\.8[56]\)$/)
  })

  it('handles alpha, uppercase and legacy syntax', () => {
    const f = info('rgb(0 113 227 / 50%)', { uppercase: true, legacy: true }).formats
    expect(f.hex).toBe('#0071E3')
    expect(f.hex8).toBe('#0071E380')
    expect(f.rgb).toBe('rgba(0, 113, 227, 0.5)')
    expect(f.hsl.startsWith('hsla(')).toBe(true)
    const m = info('rgb(0 113 227 / 50%)').formats
    expect(m.rgb).toBe('rgb(0 113 227 / 50%)')
    expect(info('#0071e380').formats.rgb).toBe('rgb(0 113 227 / 50.2%)')
  })

  it('converts grays and white without hue noise', () => {
    const w = info('white').formats
    expect(w.hsl).toBe('hsl(0 0% 100%)')
    expect(w.oklch).toBe('oklch(100% 0 0)')
    expect(w.cmyk).toBe('cmyk(0%, 0%, 0%, 0%)')
    expect(info('black').formats.cmyk).toBe('cmyk(0%, 0%, 0%, 100%)')
    expect(info('#808080').formats.hsv).toBe('hsv(0, 0%, 50.2%)')
  })

  it('computes CIE Lab of white as L=100', () => {
    const lab = rgbToLab(WHITE)
    expect(lab.l).toBeCloseTo(100, 3)
    expect(lab.a).toBeCloseTo(0, 3)
    expect(lab.b).toBeCloseTo(0, 3)
  })

  it('round-trips sRGB colors through every text format', () => {
    // 固定种子，避免随机用例偶发失败；以前 OKLCH/OKLab 只保留 4 位小数，约 0.3% 的颜色会差 1
    let seed = 42
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
    const keys = ['rgb', 'hsl', 'hwb', 'oklch', 'oklab', 'lab', 'lch'] as const
    for (let i = 0; i < 3000; i++) {
      const c = { r: rand(), g: rand(), b: rand(), alpha: 1 }
      const f = info(toHex(c)).formats
      for (const k of keys) expect(toHex(rgb(f[k])), `${toHex(c)} ${f[k]}`).toBe(toHex(c))
    }
    // 之前失败过的具体颜色
    for (const h of ['#0af26f', '#03c29e', '#00c384', '#09f7a9']) {
      expect(toHex(rgb(info(h).formats.oklch))).toBe(h)
      expect(toHex(rgb(info(h).formats.oklab))).toBe(h)
    }
  })

  it('names exact and nearest named colors', () => {
    expect(info('#663399').name).toBe('rebeccapurple')
    expect(info('#663398').name).toBeUndefined()
    expect(nearestNamed(rgb('#fe0101')).name).toBe('red')
  })
})

describe('gamut mapping', () => {
  it('flags and maps out-of-gamut colors', () => {
    const wide = rgb('oklch(0.7 0.4 150)')
    expect(inGamut(wide)).toBe(false)
    const mapped = gamutMap(wide)
    expect(inGamut(mapped)).toBe(true)
    // 色相基本保持
    expect(Math.abs(rgbToOklch(mapped).h - 150)).toBeLessThan(6)
    const d = info('oklch(0.7 0.4 150)')
    expect(d.inGamut).toBe(false)
    expect(d.formats.oklch).toBe('oklch(70% 0.4 150)')
    expect(info('color(display-p3 0 1 0)').inGamut).toBe(false)
    const p3red = gamutMap(rgb('color(display-p3 1 0 0)'))
    expect(p3red.r).toBeCloseTo(1, 3)
    expect(p3red.g).toBeLessThan(0.08)
  })

  it('maps extreme lightness to white / black', () => {
    expect(toHex(gamutMap(rgb('oklch(1.2 0.3 20)')))).toBe('#ffffff')
    expect(toHex(gamutMap(rgb('lab(0 50 50)')))).toBe('#000000')
  })
})

describe('contrast', () => {
  it('matches known WCAG ratios', () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 5)
    expect(contrastRatio(BLACK, BLACK)).toBeCloseTo(1, 5)
    expect(fmt(contrastRatio(rgb('#777'), WHITE), 2)).toBe('4.48')
    expect(fmt(contrastRatio(rgb('#767676'), WHITE), 2)).toBe('4.54')
    expect(fmt(contrastRatio(rgb('#0071e3'), WHITE), 2)).toBe('4.7')
  })

  it('evaluates AA / AAA levels', () => {
    const r = wcag(rgb('#777'), WHITE)
    expect(r).toMatchObject({
      aaNormal: false,
      aaLarge: true,
      aaaNormal: false,
      aaaLarge: false,
      ui: true,
    })
    const b = wcag(BLACK, WHITE)
    expect(b).toMatchObject({ aaNormal: true, aaLarge: true, aaaNormal: true, aaaLarge: true })
    expect(wcag(rgb('#aaa'), WHITE).aaLarge).toBe(false)
  })

  it('composites translucent foregrounds over the background', () => {
    // 50% 黑叠在白上 ≈ #808080
    const ratio = contrastRatio(rgb('rgb(0 0 0 / 50%)'), WHITE)
    expect(ratio).toBeCloseTo(contrastRatio(rgb('#808080'), WHITE), 1)
    expect(contrastRatio(rgb('transparent'), WHITE)).toBeCloseTo(1, 5)
  })

  it('picks readable text color', () => {
    expect(readableOn(rgb('#ffcc00'))).toBe('black')
    expect(readableOn(rgb('#1d1d1f'))).toBe('white')
  })
})

describe('generateScale', () => {
  it('produces 11 steps with the base color anchored', () => {
    const scale = generateScale(rgb('#3b82f6'))
    expect(scale.map((s) => s.step)).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])
    const base = scale.filter((s) => s.isBase)
    expect(base).toHaveLength(1)
    expect(base[0].hex).toBe('#3b82f6')
    // 亮度单调递减
    const ls = scale.map((s) => rgbToOklch(s.rgb).l)
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeLessThan(ls[i - 1])
    for (const s of scale) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('keeps grays neutral and handles extremes', () => {
    for (const s of generateScale(rgb('#808080'))) {
      expect(rgbToOklch(s.rgb).c).toBeLessThan(0.01)
    }
    const white = generateScale(WHITE)
    expect(white[0].isBase).toBe(true)
    const black = generateScale(BLACK)
    expect(black[10].isBase).toBe(true)
    expect(black[0].hex).not.toBe('#000000')
  })

  it('ignores alpha when building the scale', () => {
    const s = generateScale(rgb('#ff000080'))
    expect(s.find((x) => x.isBase)?.hex).toBe('#ff0000')
  })
})

describe('randomColor', () => {
  it('returns valid hex colors', () => {
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    for (let i = 0; i < 50; i++) expect(randomColor(rand)).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('regressions', () => {
  it('gray from lab()/lch() has no phantom hue or saturation', () => {
    const gray = describeColor({ rgb: rgb('lab(50% 0 0)'), format: 'lab' }).formats
    expect(gray.hsl).toBe('hsl(0 0% 46.6%)')
    expect(gray.hsv).toBe('hsv(0, 0%, 46.6%)')
    expect(gray.hwb).toBe('hwb(0 46.6% 53.4%)')
    const white = describeColor({ rgb: rgb('lab(100 0 0)'), format: 'lab' }).formats
    // 以前会输出 hsl(69.5 100% 100%)
    expect(white.hsl).toBe('hsl(0 0% 100%)')
    expect(white.hsv).toBe('hsv(0, 0%, 100%)')
    const lchGray = describeColor({ rgb: rgb('lch(50% 0 0)'), format: 'lch' }).formats
    expect(lchGray.hsl).toBe('hsl(0 0% 46.6%)')
  })

  it('never prints a hue of 360', () => {
    const f = describeColor({ rgb: { r: 1, g: 0, b: 0.0001, alpha: 1 }, format: 'rgb' }).formats
    expect(f.hsl.startsWith('hsl(0 ')).toBe(true)
  })

  it('accepts hex without # in every length', () => {
    expect(hex('fff')).toBe('#ffffff')
    expect(hex('F00A')).toBe('#ff0000aa')
    expect(rgb('f00a').alpha).toBeCloseTo(0xaa / 255, 5)
    expect(hex('0071e3')).toBe('#0071e3')
  })

  it('explains malformed function syntax precisely', () => {
    expect(err('rgb(1 2 3')).toBe('缺少右括号「)」')
    // 以前这两种都报「缺少右括号」
    expect(err('rgb(1 2 3) foo')).toBe('右括号「)」后面有多余的内容「foo」')
    expect(err('rgb(1 2 3))')).toBe('右括号「)」后面有多余的内容「)」')
    expect(err('rgb(calc(255) 0 0)')).toContain('不支持嵌套函数')
    expect(err('rgb(var(--r) 0 0)')).toContain('不支持嵌套函数')
  })

  it('accepts a pasted CSS declaration', () => {
    expect(hex('color: red;')).toBe('#ff0000')
    expect(hex('color: rgb(255 0 0) !important;')).toBe('#ff0000')
    expect(hex('background-color:#0071e3')).toBe('#0071e3')
    expect(hex('--brand: oklch(62.8% 0.2577 29.23)')).toBe('#ff0000')
    // color() 函数不能被当成声明
    expect(hex('color(srgb 1 0 0)')).toBe('#ff0000')
  })
})
