/**
 * 颜色解析与转换（纯函数，无 DOM 依赖）。
 * 支持 CSS Color 4 的主要写法；超出 sRGB 色域的颜色按 CSS Color 4 的算法在 OKLCH 中压缩色度映射回来。
 */

/** sRGB 分量 0–1（解析 lab/oklch 等时可能超出范围），alpha 0–1 */
export interface RGBA {
  r: number
  g: number
  b: number
  alpha: number
}

export interface OKLab {
  l: number
  a: number
  b: number
}
export interface OKLCH {
  l: number
  c: number
  h: number
}

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
]

// ─────────────────────────── 命名颜色（CSS Color 4 全表） ───────────────────────────

export const NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkgrey: '#a9a9a9',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  grey: '#808080',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  rebeccapurple: '#663399',
  red: '#ff0000',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
}

// ─────────────────────────── 色彩空间换算 ───────────────────────────

const toLinear = (c: number) => {
  const a = Math.abs(c)
  return a <= 0.04045 ? c / 12.92 : Math.sign(c) * ((a + 0.055) / 1.055) ** 2.4
}
const toGamma = (c: number) => {
  const a = Math.abs(c)
  return a > 0.0031308 ? Math.sign(c) * (1.055 * a ** (1 / 2.4) - 0.055) : 12.92 * c
}

const LIN_SRGB_TO_XYZ_D65: Mat3 = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
]
const XYZ_D65_TO_LIN_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
]
const LIN_P3_TO_XYZ_D65: Mat3 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
]
const D65_TO_D50: Mat3 = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
]
const D50_TO_D65: Mat3 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
]
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585]
const LAB_E = 216 / 24389
const LAB_K = 24389 / 27

const linToRgb = (v: Vec3, alpha: number): RGBA => ({
  r: toGamma(v[0]),
  g: toGamma(v[1]),
  b: toGamma(v[2]),
  alpha,
})
const rgbToLin = (c: RGBA): Vec3 => [toLinear(c.r), toLinear(c.g), toLinear(c.b)]

export function rgbToOklab(c: RGBA): OKLab {
  const [r, g, b] = rgbToLin(c)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

export function oklabToRgb(lab: OKLab, alpha = 1): RGBA {
  const l = (lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3
  const m = (lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3
  const s = (lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3
  return linToRgb(
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ],
    alpha,
  )
}

const normHue = (h: number) => ((h % 360) + 360) % 360

export function oklabToOklch(lab: OKLab): OKLCH {
  const c = Math.hypot(lab.a, lab.b)
  const h = c < 1e-6 ? 0 : normHue((Math.atan2(lab.b, lab.a) * 180) / Math.PI)
  return { l: lab.l, c, h }
}

export function oklchToOklab(lch: OKLCH): OKLab {
  const rad = (lch.h * Math.PI) / 180
  return { l: lch.l, a: lch.c * Math.cos(rad), b: lch.c * Math.sin(rad) }
}

export const rgbToOklch = (c: RGBA) => oklabToOklch(rgbToOklab(c))
export const oklchToRgb = (lch: OKLCH, alpha = 1) => oklabToRgb(oklchToOklab(lch), alpha)

export interface Lab {
  l: number
  a: number
  b: number
}

export function rgbToLab(c: RGBA): Lab {
  const xyz = mul(D65_TO_D50, mul(LIN_SRGB_TO_XYZ_D65, rgbToLin(c)))
  const f = xyz.map((v, i) => {
    const t = v / D50_WHITE[i]
    return t > LAB_E ? Math.cbrt(t) : (LAB_K * t + 16) / 116
  })
  return { l: 116 * f[1] - 16, a: 500 * (f[0] - f[1]), b: 200 * (f[1] - f[2]) }
}

export function labToRgb(lab: Lab, alpha = 1): RGBA {
  const fy = (lab.l + 16) / 116
  const fx = lab.a / 500 + fy
  const fz = fy - lab.b / 200
  const xyz: Vec3 = [
    (fx ** 3 > LAB_E ? fx ** 3 : (116 * fx - 16) / LAB_K) * D50_WHITE[0],
    (lab.l > LAB_K * LAB_E ? fy ** 3 : lab.l / LAB_K) * D50_WHITE[1],
    (fz ** 3 > LAB_E ? fz ** 3 : (116 * fz - 16) / LAB_K) * D50_WHITE[2],
  ]
  return linToRgb(mul(XYZ_D65_TO_LIN_SRGB, mul(D50_TO_D65, xyz)), alpha)
}

export function labToLch(lab: Lab): { l: number; c: number; h: number } {
  const c = Math.hypot(lab.a, lab.b)
  return { l: lab.l, c, h: c < 1e-4 ? 0 : normHue((Math.atan2(lab.b, lab.a) * 180) / Math.PI) }
}

export function hslToRgb(h: number, s: number, l: number, alpha = 1): RGBA {
  // s、l 为 0–1
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return { r: f(0), g: f(8), b: f(4), alpha }
}

/**
 * 小于它的色差视为浮点噪声：lab()/oklch() 等换算回来的灰色三个分量可能相差 1e-8 左右，
 * 不能因此算出随机色相或 100% 饱和度。1e-5 远小于 8 位通道的一级（≈0.0039）。
 */
const ACHROMATIC_EPS = 1e-5

export function rgbToHsl(c: RGBA): { h: number; s: number; l: number } {
  const max = Math.max(c.r, c.g, c.b)
  const min = Math.min(c.r, c.g, c.b)
  const d = max - min
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (d > ACHROMATIC_EPS) {
    const denom = Math.min(l, 1 - l)
    s = denom <= ACHROMATIC_EPS ? 0 : Math.min(1, (max - l) / denom)
    if (max === c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6 : 0)
    else if (max === c.g) h = (c.b - c.r) / d + 2
    else h = (c.r - c.g) / d + 4
    h *= 60
  }
  return { h: normHue(h), s, l }
}

export function rgbToHsv(c: RGBA): { h: number; s: number; v: number } {
  const max = Math.max(c.r, c.g, c.b)
  const min = Math.min(c.r, c.g, c.b)
  const { h } = rgbToHsl(c)
  return {
    h,
    s: max <= ACHROMATIC_EPS || max - min <= ACHROMATIC_EPS ? 0 : (max - min) / max,
    v: max,
  }
}

export function hwbToRgb(h: number, w: number, bl: number, alpha = 1): RGBA {
  if (w + bl >= 1) {
    const gray = w / (w + bl)
    return { r: gray, g: gray, b: gray, alpha }
  }
  const base = hslToRgb(h, 1, 0.5)
  const f = (v: number) => v * (1 - w - bl) + w
  return { r: f(base.r), g: f(base.g), b: f(base.b), alpha }
}

export function rgbToHwb(c: RGBA): { h: number; w: number; b: number } {
  const { h } = rgbToHsl(c)
  return { h, w: Math.min(c.r, c.g, c.b), b: 1 - Math.max(c.r, c.g, c.b) }
}

export function rgbToCmyk(c: RGBA): { c: number; m: number; y: number; k: number } {
  const k = 1 - Math.max(c.r, c.g, c.b)
  if (k >= 1 - 1e-9) return { c: 0, m: 0, y: 0, k: 1 }
  return {
    c: (1 - c.r - k) / (1 - k),
    m: (1 - c.g - k) / (1 - k),
    y: (1 - c.b - k) / (1 - k),
    k,
  }
}

// ─────────────────────────── 色域 ───────────────────────────

const GAMUT_EPS = 1e-5

export function inGamut(c: RGBA): boolean {
  return [c.r, c.g, c.b].every((v) => v >= -GAMUT_EPS && v <= 1 + GAMUT_EPS)
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function clip(c: RGBA): RGBA {
  return { r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b), alpha: clamp01(c.alpha) }
}

export function deltaEOK(a: OKLab, b: OKLab): number {
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b)
}

/** CSS Color 4 色域映射：在 OKLCH 中二分降低色度，直到裁剪误差低于 JND */
export function gamutMap(c: RGBA): RGBA {
  if (inGamut(c)) return clip(c)
  const origin = rgbToOklch(c)
  if (origin.l >= 1 - 1e-6) return { r: 1, g: 1, b: 1, alpha: clamp01(c.alpha) }
  if (origin.l <= 1e-6) return { r: 0, g: 0, b: 0, alpha: clamp01(c.alpha) }
  const JND = 0.02
  const EPS = 0.0001
  let min = 0
  let max = origin.c
  let minInGamut = true
  const current = { ...origin }
  let clipped = clip(oklchToRgb(current, c.alpha))
  if (deltaEOK(rgbToOklab(clipped), oklchToOklab(current)) < JND) return clipped
  while (max - min > EPS) {
    current.c = (min + max) / 2
    const rgb = oklchToRgb(current, c.alpha)
    if (minInGamut && inGamut(rgb)) {
      min = current.c
      continue
    }
    clipped = clip(rgb)
    const e = deltaEOK(rgbToOklab(clipped), oklchToOklab(current))
    if (e < JND) {
      if (JND - e < EPS) return clipped
      minInGamut = false
      min = current.c
    } else {
      max = current.c
    }
  }
  return clipped
}

// ─────────────────────────── 解析 ───────────────────────────

export type ColorFormat =
  | 'hex'
  | 'named'
  | 'rgb'
  | 'hsl'
  | 'hwb'
  | 'lab'
  | 'lch'
  | 'oklab'
  | 'oklch'
  | 'color'
  | 'transparent'

export interface ParsedColor {
  /** 未裁剪的 sRGB（可能超出 0–1） */
  rgb: RGBA
  format: ColorFormat
}

export type ParseResult = { ok: true; value: ParsedColor } | { ok: false; error: string }

const fail = (error: string): ParseResult => ({ ok: false, error })

function parseHex(hex: string): RGBA | string {
  const bad = /[^0-9a-f]/i.exec(hex)
  if (bad) return `「${bad[0]}」不是十六进制数字（第 ${bad.index + 2} 个字符）`
  if (![3, 4, 6, 8].includes(hex.length)) {
    return `HEX 颜色应为 3、4、6 或 8 位，实际是 ${hex.length} 位`
  }
  const full =
    hex.length <= 4
      ? hex
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : hex
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255
  return { r: n(0), g: n(2), b: n(4), alpha: full.length === 8 ? n(6) : 1 }
}

interface Token {
  raw: string
  value: number
  unit: '' | '%' | 'deg' | 'rad' | 'grad' | 'turn'
  none: boolean
}

function parseToken(raw: string): Token | null {
  if (/^none$/i.test(raw)) return { raw, value: 0, unit: '', none: true }
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/i.exec(raw)
  if (!m) return null
  return {
    raw,
    value: Number(m[1]),
    unit: (m[2]?.toLowerCase() ?? '') as Token['unit'],
    none: false,
  }
}

function hueDeg(t: Token): number | string {
  switch (t.unit) {
    case '':
    case 'deg':
      return t.value
    case 'rad':
      return (t.value * 180) / Math.PI
    case 'grad':
      return t.value * 0.9
    case 'turn':
      return t.value * 360
    default:
      return `色相「${t.raw}」不能使用百分比，请用角度（如 120、120deg、0.5turn）`
  }
}

const FN_ARITY: Record<string, string[]> = {
  rgb: ['红', '绿', '蓝'],
  hsl: ['色相', '饱和度', '亮度'],
  hwb: ['色相', '白度', '黑度'],
  lab: ['亮度 L', 'a', 'b'],
  lch: ['亮度 L', '色度 C', '色相 H'],
  oklab: ['亮度 L', 'a', 'b'],
  oklch: ['亮度 L', '色度 C', '色相 H'],
}

const COLOR_SPACES = ['srgb', 'srgb-linear', 'display-p3', 'xyz', 'xyz-d65', 'xyz-d50'] as const

function parseFunction(name: string, body: string): ParseResult {
  let fn = name.toLowerCase()
  if (fn === 'rgba') fn = 'rgb'
  if (fn === 'hsla') fn = 'hsl'
  const legacy = body.includes(',')
  let parts: string[]
  let alphaRaw: string | undefined
  let space: string | undefined
  if (fn === 'color') {
    const [left, alpha, extra] = body.split('/')
    if (extra !== undefined) return fail(`color() 中只能有一个「/」`)
    const words = left.trim().split(/\s+/)
    space = words.shift()?.toLowerCase()
    if (!space || !(COLOR_SPACES as readonly string[]).includes(space)) {
      return fail(`不支持的色彩空间「${space ?? ''}」，可用：${COLOR_SPACES.join('、')}`)
    }
    parts = words
    alphaRaw = alpha?.trim()
    if (parts.length !== 3)
      return fail(`color(${space} …) 需要 3 个分量，实际得到 ${parts.length} 个`)
  } else if (legacy) {
    if (!['rgb', 'hsl'].includes(fn)) return fail(`${fn}() 不支持逗号分隔，请用空格分隔分量`)
    if (body.includes('/')) return fail(`${name}() 不能混用逗号和「/」`)
    parts = body.split(',').map((p) => p.trim())
    if (parts.length === 4) alphaRaw = parts.pop()
  } else {
    const [left, alpha, extra] = body.split('/')
    if (extra !== undefined) return fail(`${name}() 中只能有一个「/」`)
    parts = left.trim().split(/\s+/).filter(Boolean)
    alphaRaw = alpha?.trim()
    if (alpha !== undefined && !alphaRaw) return fail(`「/」后面缺少透明度`)
  }
  const labels = FN_ARITY[fn] ?? ['分量 1', '分量 2', '分量 3']
  if (parts.length !== 3) {
    return fail(
      `${name}() 需要 3 个分量（${labels.join('、')}）${alphaRaw === undefined ? '，可选透明度' : ''}，实际得到 ${parts.length} 个`,
    )
  }
  const tokens: Token[] = []
  for (let i = 0; i < 3; i++) {
    const t = parseToken(parts[i])
    if (!t) return fail(`${name}() 的${labels[i]}「${parts[i]}」不是有效的数值`)
    tokens.push(t)
  }
  let alpha = 1
  if (alphaRaw !== undefined) {
    const t = parseToken(alphaRaw)
    if (!t || !['', '%'].includes(t.unit))
      return fail(`透明度「${alphaRaw}」无效，应为 0–1 或百分比`)
    alpha = clamp01(t.unit === '%' ? t.value / 100 : t.value)
  }
  const [t0, t1, t2] = tokens
  const pct = (t: Token, scale: number) => (t.unit === '%' ? (t.value / 100) * scale : t.value)
  const noAngle = (t: Token, label: string) =>
    t.unit !== '' && t.unit !== '%' ? `${label}「${t.raw}」不能带角度单位` : null

  switch (fn) {
    case 'rgb': {
      for (const [i, t] of tokens.entries()) {
        const e = noAngle(t, labels[i])
        if (e) return fail(e)
      }
      if (legacy && new Set(tokens.map((t) => t.unit === '%')).size > 1) {
        return fail('逗号写法的 rgb() 不能混用数字和百分比')
      }
      const ch = (t: Token) => clamp01(pct(t, 255) / 255)
      return { ok: true, value: { rgb: { r: ch(t0), g: ch(t1), b: ch(t2), alpha }, format: 'rgb' } }
    }
    case 'hsl':
    case 'hwb': {
      const h = hueDeg(t0)
      if (typeof h === 'string') return fail(h)
      for (const [i, t] of [t1, t2].entries()) {
        const e = noAngle(t, labels[i + 1])
        if (e) return fail(e)
        if (legacy && t.unit !== '%') return fail(`逗号写法的 hsl() 中${labels[i + 1]}需要带 %`)
      }
      const a = clamp01(pct(t1, 100) / 100)
      const b = clamp01(pct(t2, 100) / 100)
      const rgb =
        fn === 'hsl' ? hslToRgb(normHue(h), a, b, alpha) : hwbToRgb(normHue(h), a, b, alpha)
      return { ok: true, value: { rgb, format: fn } }
    }
    case 'lab':
    case 'oklab': {
      const ok = fn === 'oklab'
      for (const [i, t] of tokens.entries()) {
        const e = noAngle(t, labels[i])
        if (e) return fail(e)
      }
      const l = Math.max(0, pct(t0, ok ? 1 : 100))
      const a = pct(t1, ok ? 0.4 : 125)
      const b = pct(t2, ok ? 0.4 : 125)
      const rgb = ok
        ? oklabToRgb({ l: Math.min(l, 1), a, b }, alpha)
        : labToRgb({ l: Math.min(l, 100), a, b }, alpha)
      return { ok: true, value: { rgb, format: fn } }
    }
    case 'lch':
    case 'oklch': {
      const ok = fn === 'oklch'
      for (const [i, t] of [t0, t1].entries()) {
        const e = noAngle(t, labels[i])
        if (e) return fail(e)
      }
      const h = hueDeg(t2)
      if (typeof h === 'string') return fail(h)
      const l = Math.max(0, pct(t0, ok ? 1 : 100))
      const c = Math.max(0, pct(t1, ok ? 0.4 : 150))
      const rad = (normHue(h) * Math.PI) / 180
      const lab = { l: Math.min(l, ok ? 1 : 100), a: c * Math.cos(rad), b: c * Math.sin(rad) }
      const rgb = ok ? oklabToRgb(lab, alpha) : labToRgb(lab, alpha)
      return { ok: true, value: { rgb, format: fn } }
    }
    case 'color': {
      const v = tokens.map((t) => pct(t, 1)) as Vec3
      let rgb: RGBA
      if (space === 'srgb') rgb = { r: v[0], g: v[1], b: v[2], alpha }
      else if (space === 'srgb-linear') rgb = linToRgb(v, alpha)
      else if (space === 'display-p3') {
        const lin = v.map(toLinear) as Vec3
        rgb = linToRgb(mul(XYZ_D65_TO_LIN_SRGB, mul(LIN_P3_TO_XYZ_D65, lin)), alpha)
      } else if (space === 'xyz-d50')
        rgb = linToRgb(mul(XYZ_D65_TO_LIN_SRGB, mul(D50_TO_D65, v)), alpha)
      else rgb = linToRgb(mul(XYZ_D65_TO_LIN_SRGB, v), alpha)
      return { ok: true, value: { rgb, format: 'color' } }
    }
    default:
      return fail(
        `不支持的颜色函数「${name}()」。支持 rgb、rgba、hsl、hsla、hwb、lab、lch、oklab、oklch、color`,
      )
  }
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

/** 拼写相近的颜色名（编辑距离 ≤ 2，或前缀匹配） */
export function suggestName(word: string): string | undefined {
  const w = word.toLowerCase()
  let best: { name: string; d: number } | undefined
  for (const name of Object.keys(NAMED_COLORS)) {
    const d = editDistance(w, name)
    if (!best || d < best.d) best = { name, d }
  }
  if (best && best.d <= 2) return best.name
  return w.length >= 3 ? Object.keys(NAMED_COLORS).find((n) => n.startsWith(w)) : undefined
}

/**
 * 解析任意 CSS 颜色：
 * #rgb/#rgba/#rrggbb/#rrggbbaa、rgb()/rgba()（逗号与空格写法）、hsl()/hsla()、hwb()、
 * lab()、lch()、oklab()、oklch()、color(srgb|display-p3|…)、命名颜色、transparent，
 * 也接受不带 # 的 6/8 位十六进制与「255, 0, 0」这样的裸 RGB。
 */
export function parseColor(input: string): ParseResult {
  const s = input
    .trim()
    .replace(/;$/, '')
    .replace(/\s*!important$/i, '')
    // 直接粘贴 CSS 声明：color: red、background-color: #fff、--brand: oklch(…)
    .replace(/^(?:--[\w-]+|[a-z][a-z-]*)\s*:\s*(?=\S)/i, '')
    .trim()
  if (!s) return fail('请输入颜色')
  const lower = s.toLowerCase()
  if (lower === 'transparent') {
    return { ok: true, value: { rgb: { r: 0, g: 0, b: 0, alpha: 0 }, format: 'transparent' } }
  }
  if (lower in NAMED_COLORS) {
    const rgb = parseHex(NAMED_COLORS[lower].slice(1)) as RGBA
    return { ok: true, value: { rgb, format: 'named' } }
  }
  if (s.startsWith('#')) {
    const r = parseHex(s.slice(1))
    return typeof r === 'string' ? fail(r) : { ok: true, value: { rgb: r, format: 'hex' } }
  }
  // 省略 # 的 HEX（没有任何 CSS 颜色名只由 0-9a-f 组成，不会与颜色名冲突）
  if (/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) {
    return { ok: true, value: { rgb: parseHex(s) as RGBA, format: 'hex' } }
  }
  const fn = /^([a-z-]+)\(\s*([^()]*?)\s*\)$/i.exec(s)
  if (fn) return parseFunction(fn[1], fn[2])
  if (/^[a-z-]+\(/i.test(s)) {
    const opens = s.split('(').length - 1
    const close = s.indexOf(')')
    if (opens > 1) return fail('不支持嵌套函数（如 calc()、var()），请直接填写数值')
    if (close < 0) return fail('缺少右括号「)」')
    return fail(`右括号「)」后面有多余的内容「${s.slice(close + 1).trim()}」`)
  }
  const bare =
    /^(\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(\d{1,3}(?:\.\d+)?)$/.exec(s)
  if (bare) return parseFunction('rgb', `${bare[1]} ${bare[2]} ${bare[3]}`)
  if (/^[a-z]+$/i.test(s)) {
    const near = suggestName(lower)
    return fail(`未知的颜色名「${s}」${near ? `，是不是想输入「${near}」？` : ''}`)
  }
  return fail(
    `无法识别「${s}」。支持 HEX、rgb()、hsl()、hwb()、lab()、lch()、oklab()、oklch() 和 CSS 颜色名`,
  )
}

// ─────────────────────────── 格式化 ───────────────────────────

/** 四舍五入并去掉多余的 0：12.50 → "12.5"，-0 → "0" */
export function fmt(n: number, digits = 2): string {
  const f = 10 ** digits
  const v = Math.round(n * f) / f
  return String(Object.is(v, -0) ? 0 : v)
}

const hex2 = (v: number) =>
  Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, '0')

export function toHex(c: RGBA, withAlpha = false): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${withAlpha ? hex2(c.alpha) : ''}`
}

/** 色相四舍五入后可能变成 360，统一写成 0 */
function fmtHue(h: number, digits: number): string {
  const v = fmt(h, digits)
  return v === '360' ? '0' : v
}

const alphaPart = (alpha: number, sep = ' / ') => (alpha < 1 ? `${sep}${fmt(alpha * 100, 1)}%` : '')

export interface FormatOptions {
  uppercase?: boolean
  /** rgba(255, 0, 0, 0.5) 这样的逗号写法 */
  legacy?: boolean
}

export interface ColorFormats {
  hex: string
  hex8: string
  rgb: string
  hsl: string
  hsv: string
  hwb: string
  oklch: string
  oklab: string
  lab: string
  lch: string
  cmyk: string
}

export interface ColorInfo {
  /** 映射到 sRGB 色域并裁剪后的颜色（用于显示与 HEX/RGB 等输出） */
  rgb: RGBA
  /** 原始颜色的 OKLab / OKLCH（未映射） */
  oklab: OKLab
  oklch: OKLCH
  /** 原始颜色是否在 sRGB 色域内 */
  inGamut: boolean
  formats: ColorFormats
  /** 与之完全相同的 CSS 颜色名 */
  name?: string
  /** 最接近的 CSS 颜色名（OKLab 距离） */
  nearest: { name: string; distance: number }
}

let namedLabs: [string, OKLab][] | undefined

export function nearestNamed(c: RGBA): { name: string; distance: number } {
  namedLabs ??= Object.entries(NAMED_COLORS).map(([name, hex]) => [
    name,
    rgbToOklab(parseHex(hex.slice(1)) as RGBA),
  ])
  const lab = rgbToOklab(c)
  let best = { name: 'black', distance: Infinity }
  for (const [name, ref] of namedLabs) {
    const d = deltaEOK(lab, ref)
    if (d < best.distance) best = { name, distance: d }
  }
  return best
}

export function describeColor(parsed: ParsedColor, opts: FormatOptions = {}): ColorInfo {
  const original = parsed.rgb
  const inG = inGamut(original)
  const rgb = gamutMap(original)
  const oklab = rgbToOklab(original)
  const oklch = oklabToOklch(oklab)
  const up = (s: string) => (opts.uppercase ? s.toUpperCase() : s)
  const R = Math.round(rgb.r * 255)
  const G = Math.round(rgb.g * 255)
  const B = Math.round(rgb.b * 255)
  const hsl = rgbToHsl(rgb)
  const hsv = rgbToHsv(rgb)
  const hwb = rgbToHwb(rgb)
  const lab = rgbToLab(original)
  const lch = labToLch(lab)
  const cmyk = rgbToCmyk(rgb)
  const a = rgb.alpha
  const pctS = (v: number) => `${fmt(v * 100, 1)}%`
  const legacyAlpha = a < 1 ? `, ${fmt(a, 3)}` : ''
  const hex = up(toHex(rgb))
  const formats: ColorFormats = {
    hex,
    hex8: up(toHex(rgb, true)),
    rgb: opts.legacy
      ? `${a < 1 ? 'rgba' : 'rgb'}(${R}, ${G}, ${B}${legacyAlpha})`
      : `rgb(${R} ${G} ${B}${alphaPart(a)})`,
    hsl: opts.legacy
      ? `${a < 1 ? 'hsla' : 'hsl'}(${fmtHue(hsl.h, 1)}, ${pctS(hsl.s)}, ${pctS(hsl.l)}${legacyAlpha})`
      : `hsl(${fmtHue(hsl.h, 1)} ${pctS(hsl.s)} ${pctS(hsl.l)}${alphaPart(a)})`,
    hsv: `hsv(${fmtHue(hsv.h, 1)}, ${pctS(hsv.s)}, ${pctS(hsv.v)})`,
    hwb: `hwb(${fmtHue(hwb.h, 1)} ${pctS(hwb.w)} ${pctS(hwb.b)}${alphaPart(a)})`,
    // 色度 / a / b 保留 5 位小数：4 位时约 0.3% 的 8 位 HEX 颜色解析回来会差 1
    oklch: `oklch(${fmt(oklch.l * 100, 2)}% ${fmt(oklch.c, 5)} ${fmtHue(oklch.h, 2)}${alphaPart(a)})`,
    oklab: `oklab(${fmt(oklab.l * 100, 2)}% ${fmt(oklab.a, 5)} ${fmt(oklab.b, 5)}${alphaPart(a)})`,
    lab: `lab(${fmt(lab.l, 2)}% ${fmt(lab.a, 2)} ${fmt(lab.b, 2)}${alphaPart(a)})`,
    lch: `lch(${fmt(lch.l, 2)}% ${fmt(lch.c, 2)} ${fmtHue(lch.h, 2)}${alphaPart(a)})`,
    cmyk: `cmyk(${pctS(cmyk.c)}, ${pctS(cmyk.m)}, ${pctS(cmyk.y)}, ${pctS(cmyk.k)})`,
  }
  const lowerHex = toHex(rgb)
  const name =
    a === 1 ? Object.keys(NAMED_COLORS).find((n) => NAMED_COLORS[n] === lowerHex) : undefined
  return { rgb, oklab, oklch, inGamut: inG, formats, name, nearest: nearestNamed(rgb) }
}

// ─────────────────────────── 对比度（WCAG 2.1） ───────────────────────────

/** 把带透明度的前景色合成到不透明背景上 */
export function composite(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.alpha
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    alpha: 1,
  }
}

export const WHITE: RGBA = { r: 1, g: 1, b: 1, alpha: 1 }
export const BLACK: RGBA = { r: 0, g: 0, b: 0, alpha: 1 }

/** WCAG 2.1 相对亮度 */
export function relativeLuminance(c: RGBA): number {
  const ch = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * ch(clamp01(c.r)) + 0.7152 * ch(clamp01(c.g)) + 0.0722 * ch(clamp01(c.b))
}

/** 对比度 1–21；前景有透明度时先合成到背景上，背景有透明度时先合成到白色上 */
export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const solidBg = bg.alpha < 1 ? composite(bg, WHITE) : bg
  const solidFg = fg.alpha < 1 ? composite(fg, solidBg) : fg
  const l1 = relativeLuminance(solidFg)
  const l2 = relativeLuminance(solidBg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

export interface WcagResult {
  ratio: number
  aaNormal: boolean
  aaLarge: boolean
  aaaNormal: boolean
  aaaLarge: boolean
  /** 1.4.11 非文本对比度（图标、边框等） */
  ui: boolean
}

export function wcag(fg: RGBA, bg: RGBA): WcagResult {
  // 按 WCAG 的做法，判定前先截断到两位小数，避免 4.499 被显示成 4.5 却不达标
  const ratio = contrastRatio(fg, bg)
  const r = Math.floor(ratio * 100) / 100
  return {
    ratio,
    aaNormal: r >= 4.5,
    aaLarge: r >= 3,
    aaaNormal: r >= 7,
    aaaLarge: r >= 4.5,
    ui: r >= 3,
  }
}

/** 选择在该颜色上更易读的文字颜色 */
export function readableOn(bg: RGBA): 'white' | 'black' {
  const solid = bg.alpha < 1 ? composite(bg, WHITE) : bg
  return contrastRatio(WHITE, solid) >= contrastRatio(BLACK, solid) ? 'white' : 'black'
}

// ─────────────────────────── 色阶 ───────────────────────────

export const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

/** 参考 Tailwind v4 调色板的 OKLCH 亮度与相对色度曲线 */
const TARGET_L = [0.971, 0.936, 0.885, 0.808, 0.704, 0.637, 0.577, 0.505, 0.444, 0.396, 0.27]
const CHROMA_PROFILE = [0.1, 0.22, 0.42, 0.68, 0.9, 1, 0.97, 0.86, 0.72, 0.6, 0.44]

export interface ScaleStep {
  step: (typeof SCALE_STEPS)[number]
  rgb: RGBA
  hex: string
  oklch: string
  /** 是否就是输入颜色本身 */
  isBase: boolean
}

/**
 * 以输入颜色为锚点生成 50–950 的色阶：
 * 按亮度找到最接近的档位放入原色，其余档位在 OKLCH 中插值亮度、按曲线缩放色度，再映射回 sRGB。
 */
export function generateScale(color: RGBA): ScaleStep[] {
  const solid = { ...clip(color), alpha: 1 }
  const base = rgbToOklch(solid)
  let anchor = 0
  for (let i = 1; i < TARGET_L.length; i++) {
    if (Math.abs(TARGET_L[i] - base.l) < Math.abs(TARGET_L[anchor] - base.l)) anchor = i
  }
  const first = Math.max(TARGET_L[0], base.l)
  const last = Math.min(TARGET_L[TARGET_L.length - 1], base.l)
  const maxC = Math.max(base.c, 0.3)
  return SCALE_STEPS.map((step, i) => {
    if (i === anchor) {
      return { step, rgb: solid, hex: toHex(solid), oklch: formatOklch(base), isBase: true }
    }
    let l: number
    if (i < anchor) {
      const t = (TARGET_L[0] - TARGET_L[i]) / (TARGET_L[0] - TARGET_L[anchor])
      l = first + (base.l - first) * t
    } else {
      const t =
        (TARGET_L[i] - TARGET_L[anchor]) / (TARGET_L[TARGET_L.length - 1] - TARGET_L[anchor])
      l = base.l + (last - base.l) * t
    }
    const c = Math.min((base.c * CHROMA_PROFILE[i]) / CHROMA_PROFILE[anchor], maxC)
    const lch = { l, c, h: base.h }
    const rgb = gamutMap(oklchToRgb(lch))
    return { step, rgb, hex: toHex(rgb), oklch: formatOklch(rgbToOklch(rgb)), isBase: false }
  })
}

function formatOklch(c: OKLCH): string {
  return `oklch(${fmt(c.l * 100, 1)}% ${fmt(c.c, 3)} ${fmtHue(c.h, 1)})`
}

/** 随机生成一个好看的颜色（OKLCH 中取中等亮度与色度） */
export function randomColor(rand: () => number = Math.random): string {
  const rgb = gamutMap(
    oklchToRgb({ l: 0.55 + rand() * 0.25, c: 0.1 + rand() * 0.12, h: rand() * 360 }),
  )
  return toHex(rgb)
}
