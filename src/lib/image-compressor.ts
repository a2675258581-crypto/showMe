/**
 * 图片压缩的纯逻辑：输出格式决策、目标尺寸、逐级缩小步骤、文件名改写、体积对比。
 * 真正的解码 / 编码在浏览器里用 Canvas 完成（见 tools/image-compressor）。
 */

export type EncodeMime = 'image/jpeg' | 'image/webp' | 'image/png' | 'image/avif'
export type OutputChoice = 'keep' | EncodeMime

/** 浏览器 canvas 可能支持编码的格式（按常见程度排列） */
export const ENCODE_MIMES: EncodeMime[] = ['image/jpeg', 'image/webp', 'image/png', 'image/avif']

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  pjpeg: 'image/jpeg',
  png: 'image/png',
  apng: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

export const FORMAT_LABEL: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/avif': 'AVIF',
  'image/gif': 'GIF',
  'image/bmp': 'BMP',
  'image/svg+xml': 'SVG',
  'image/x-icon': 'ICO',
  'image/tiff': 'TIFF',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',
}

export function formatLabel(mime: string): string {
  return FORMAT_LABEL[mime] ?? (mime.replace(/^image\//, '').toUpperCase() || '未知')
}

/** 按扩展名推断 MIME */
export function mimeFromName(name: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim())
  return m ? (EXT_TO_MIME[m[1].toLowerCase()] ?? null) : null
}

/** 规范化文件的 MIME：修正 image/jpg 之类的写法，类型为空时按扩展名推断 */
export function normalizeMime(type: string, name = ''): string {
  const t = type.toLowerCase().trim()
  if (t === 'image/jpg' || t === 'image/pjpeg') return 'image/jpeg'
  if (t === 'image/x-png') return 'image/png'
  if (t) return t
  return mimeFromName(name) ?? ''
}

export function extForMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? (mime.split('/')[1]?.replace(/\W.*$/, '') || 'img')
}

/** photo.PNG + image/webp → photo.webp；保留中间的点；无扩展名时追加 */
export function rewriteFilename(name: string, mime: string): string {
  const ext = extForMime(mime)
  const trimmed = name.trim() || 'image'
  const base = /\.[a-z0-9]{1,5}$/i.test(trimmed)
    ? trimmed.replace(/\.[a-z0-9]{1,5}$/i, '')
    : trimmed
  return `${base || 'image'}.${ext}`
}

/** 该格式是否有「质量」参数 */
export function qualityApplies(mime: string): boolean {
  return mime === 'image/jpeg' || mime === 'image/webp' || mime === 'image/avif'
}

export interface ResolvedFormat {
  mime: EncodeMime
  /** 实际输出与用户期望不同时的说明 */
  note?: string
  /** 用户明确选择了与原图不同的格式（此时即使变大也按用户意愿输出） */
  explicit: boolean
}

function firstSupported(candidates: EncodeMime[], supported: readonly string[]): EncodeMime {
  return candidates.find((m) => supported.includes(m)) ?? 'image/png'
}

/**
 * 决定输出格式。supported 为浏览器实际可编码的格式（PNG 总是可用）。
 */
export function resolveOutputFormat(
  inputMime: string,
  choice: OutputChoice,
  supported: readonly string[],
): ResolvedFormat {
  const sup = supported.includes('image/png') ? supported : [...supported, 'image/png']
  const input = normalizeMime(inputMime)
  const label = formatLabel(input)

  if (choice !== 'keep') {
    const explicit = choice !== input
    if (sup.includes(choice)) return { mime: choice, explicit }
    const fallback = firstSupported(
      choice === 'image/avif' ? ['image/webp', 'image/jpeg'] : ['image/jpeg'],
      sup,
    )
    return {
      mime: fallback,
      explicit,
      note: `当前浏览器无法编码 ${formatLabel(choice)}，已改用 ${formatLabel(fallback)}`,
    }
  }

  // 保持原格式
  if ((ENCODE_MIMES as string[]).includes(input)) {
    const mime = input as EncodeMime
    if (sup.includes(mime)) return { mime, explicit: false }
    const fallback = firstSupported(
      mime === 'image/avif' ? ['image/webp', 'image/jpeg'] : ['image/jpeg'],
      sup,
    )
    return {
      mime: fallback,
      explicit: false,
      note: `当前浏览器无法编码 ${label}，已改用 ${formatLabel(fallback)}`,
    }
  }
  if (input === 'image/gif') {
    return { mime: 'image/png', explicit: false, note: 'GIF 会转为静态 PNG（动图只保留第一帧）' }
  }
  if (input === 'image/heic' || input === 'image/heif') {
    const mime = firstSupported(['image/jpeg'], sup)
    return { mime, explicit: false, note: `${label} 无法原样输出，已转为 ${formatLabel(mime)}` }
  }
  return {
    mime: 'image/png',
    explicit: false,
    note: `${label || '该格式'} 无法原样输出，已转为 PNG`,
  }
}

export interface TargetSize {
  width: number
  height: number
  resized: boolean
}

/** 最大宽 / 高限制下的输出尺寸：不放大；保持比例时等比缩放 */
export function targetSize(
  width: number,
  height: number,
  maxWidth?: number | null,
  maxHeight?: number | null,
  keepAspect = true,
): TargetSize {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const mw = maxWidth && maxWidth > 0 ? maxWidth : Infinity
  const mh = maxHeight && maxHeight > 0 ? maxHeight : Infinity
  if (w <= mw && h <= mh) return { width: w, height: h, resized: false }
  if (!keepAspect) {
    return {
      width: Math.max(1, Math.round(Math.min(w, mw))),
      height: Math.max(1, Math.round(Math.min(h, mh))),
      resized: true,
    }
  }
  const k = Math.min(mw / w, mh / h)
  return {
    width: Math.max(1, Math.round(w * k)),
    height: Math.max(1, Math.round(h * k)),
    resized: true,
  }
}

/**
 * 大幅缩小时逐级减半再缩到目标尺寸，避免一次缩放带来的锯齿与摩尔纹。
 * 返回依次要绘制的尺寸（最后一项即目标尺寸）。
 */
export function downscaleSteps(
  fromW: number,
  fromH: number,
  toW: number,
  toH: number,
): { width: number; height: number }[] {
  const steps: { width: number; height: number }[] = []
  let w = fromW
  let h = fromH
  while (w / 2 >= toW && h / 2 >= toH && w / 2 >= 1 && h / 2 >= 1 && steps.length < 12) {
    w = Math.round(w / 2)
    h = Math.round(h / 2)
    if (w === toW && h === toH) break
    steps.push({ width: w, height: h })
  }
  steps.push({ width: toW, height: toH })
  return steps
}

export interface Savings {
  /** 节省的字节数（负数表示变大） */
  saved: number
  /** 输出 / 原始 */
  ratio: number
  /** 节省百分比（0–100，变大时为负） */
  percent: number
}

export function savings(original: number, output: number): Savings {
  if (!(original > 0)) return { saved: 0, ratio: 1, percent: 0 }
  const ratio = output / original
  return { saved: original - output, ratio, percent: (1 - ratio) * 100 }
}

/** "-85%" / "+12%" / "0%"；小于 10% 保留一位小数 */
export function formatSavings(percent: number): string {
  const abs = Math.abs(percent)
  const s = abs >= 10 ? Math.round(abs).toString() : abs.toFixed(1).replace(/\.0$/, '')
  if (s === '0') return '0%'
  return `${percent > 0 ? '-' : '+'}${s}%`
}

/**
 * 结果不比原图小、且用户没有明确要求换格式或缩小尺寸时，保留原图。
 * （要求了最大宽高时原图不满足尺寸要求，即使体积更大也要输出缩小后的结果。）
 */
export function shouldKeepOriginal(opts: {
  originalSize: number
  resultSize: number
  explicitFormat: boolean
  resized?: boolean
}): boolean {
  return opts.resultSize >= opts.originalSize && !opts.explicitFormat && !opts.resized
}

/** 最大宽高输入框：空或非法 → undefined；否则取 1–16384 的整数 */
export function parseDimension(text: string): number | undefined {
  const s = text.trim()
  if (!s) return undefined
  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.min(16384, Math.max(1, Math.round(n)))
}

/** 浏览器画布的保守像素上限（iOS Safari 约 1677 万像素） */
export const CANVAS_MAX_PIXELS = 16_777_216

/** 相同基础名的文件在「全部下载」时加序号避免覆盖 */
export function dedupeNames(names: string[]): string[] {
  // 文件系统通常不区分大小写，按小写比较；序号跳过已被占用的名字（如本来就叫 a (2).jpg）
  const used = new Set<string>()
  const counters = new Map<string, number>()
  return names.map((n) => {
    const key = n.toLowerCase()
    let name = n
    if (used.has(key)) {
      const m = /^(.*?)(\.[^.]*)?$/.exec(n)!
      let k = counters.get(key) ?? 1
      do {
        k++
        name = `${m[1]} (${k})${m[2] ?? ''}`
      } while (used.has(name.toLowerCase()))
      counters.set(key, k)
    }
    used.add(name.toLowerCase())
    return name
  })
}
