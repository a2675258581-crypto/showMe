import {
  LOGO_MAX_AREA,
  normalizeHex,
  type Ecl,
  type EyeStyle,
  type ModuleStyle,
  type QrTemplate,
} from '@/lib/qrcode'

export type QrMode = 'generate' | 'decode'

/** 持久化在 localStorage `qrcode.options.v1` 的小选项（不含内容与 Logo） */
export interface QrOptions {
  mode: QrMode
  template: QrTemplate
  ecl: Ecl
  size: number
  margin: number
  fg: string
  bg: string
  moduleStyle: ModuleStyle
  eyeStyle: EyeStyle
  pngScale: number
  logoArea: number
}

export const QR_DEFAULTS: QrOptions = {
  mode: 'generate',
  template: 'text',
  ecl: 'M',
  size: 512,
  margin: 2,
  fg: '#1d1d1f',
  bg: '#ffffff',
  moduleStyle: 'square',
  eyeStyle: 'square',
  pngScale: 2,
  logoArea: 0.08,
}

export const ECLS: Ecl[] = ['L', 'M', 'Q', 'H']

const TEMPLATES: QrTemplate[] = ['text', 'wifi', 'vcard', 'email', 'sms', 'tel']

export const PALETTES: { fg: string; bg: string; name: string }[] = [
  { fg: '#1d1d1f', bg: '#ffffff', name: '经典' },
  { fg: '#0a3d91', bg: '#ffffff', name: '深蓝' },
  { fg: '#0b5d3b', bg: '#f3faf5', name: '墨绿' },
  { fg: '#7a1c2e', bg: '#fff7f5', name: '酒红' },
  { fg: '#4b2a86', bg: '#f7f4ff', name: '葡萄紫' },
  { fg: '#1d1d1f', bg: '#ffd60a', name: '亮黄' },
]

function oneOf<T extends string>(v: unknown, list: readonly T[], d: T): T {
  return list.includes(v as T) ? (v as T) : d
}

function num(v: unknown, min: number, max: number, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d
}

export function sanitizeOptions(raw: Partial<QrOptions> | null): QrOptions {
  const r: Partial<QrOptions> = raw && typeof raw === 'object' ? raw : {}
  const d = QR_DEFAULTS
  return {
    mode: oneOf(r.mode, ['generate', 'decode'], d.mode),
    template: oneOf(r.template, TEMPLATES, d.template),
    ecl: oneOf(r.ecl, ECLS, d.ecl),
    size: num(r.size, 128, 2048, d.size),
    margin: num(r.margin, 0, 8, d.margin),
    fg: (typeof r.fg === 'string' && normalizeHex(r.fg)) || d.fg,
    bg: (typeof r.bg === 'string' && normalizeHex(r.bg)) || d.bg,
    moduleStyle: oneOf(r.moduleStyle, ['square', 'dots', 'rounded'], d.moduleStyle),
    eyeStyle: oneOf(r.eyeStyle, ['square', 'rounded', 'circle'], d.eyeStyle),
    pngScale: num(r.pngScale, 1, 4, d.pngScale),
    logoArea: num(r.logoArea, 0.04, LOGO_MAX_AREA, d.logoArea),
  }
}
