/** 图片 ⇄ Base64 / Data URL（纯函数，无 DOM 依赖） */

import { base64ToBytes, bytesToBase64, utf8Encode } from './base64'
import { detectFileType, extFromMime, type FileTypeInfo } from './base64-filetype'

export interface ImageSize {
  width: number
  height: number
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1]
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
const u32be = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const i32le = (b: Uint8Array, o: number) =>
  b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)

/** 解析 SVG 根元素的 width / height / viewBox（只认绝对长度与 px） */
export function svgSize(svg: string): ImageSize | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0]
  if (!tag) return null
  const attr = (name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2]?.trim()
  const len = (v: string | undefined) => {
    if (!v) return null
    const m = /^([\d.]+)\s*(px)?$/i.exec(v)
    return m ? parseFloat(m[1]) : null
  }
  let w = len(attr('width'))
  let h = len(attr('height'))
  const vb = attr('viewBox')
    ?.split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n))
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (w === null && h === null) {
      w = vb[2]
      h = vb[3]
    } else if (w === null && h !== null) w = (h * vb[2]) / vb[3]
    else if (h === null && w !== null) h = (w * vb[3]) / vb[2]
  }
  if (w === null || h === null || !(w > 0) || !(h > 0)) return null
  return { width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100 }
}

/** 从图片文件头读出像素尺寸（PNG / GIF / JPEG / WebP / BMP / ICO / SVG），读不出返回 null */
export function imageSize(b: Uint8Array): ImageSize | null {
  const type = detectFileType(b)
  if (!type) return null
  try {
    switch (type.mime) {
      case 'image/png':
        if (b.length >= 24) return { width: u32be(b, 16), height: u32be(b, 20) }
        return null
      case 'image/gif':
        if (b.length >= 10) return { width: u16le(b, 6), height: u16le(b, 8) }
        return null
      case 'image/bmp':
        if (b.length >= 26) {
          if (b[14] === 12) return { width: u16le(b, 18), height: u16le(b, 20) }
          return { width: Math.abs(i32le(b, 18)), height: Math.abs(i32le(b, 22)) }
        }
        return null
      case 'image/x-icon':
        if (b.length >= 8) return { width: b[6] || 256, height: b[7] || 256 }
        return null
      case 'image/webp':
        return webpSize(b)
      case 'image/jpeg':
        return jpegSize(b)
      case 'image/svg+xml':
        return svgSize(new TextDecoder().decode(b))
      default:
        return null
    }
  } catch {
    return null
  }
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15])
  if (chunk === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  if (chunk === 'VP8L') {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  return null
}

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++
      continue
    }
    const marker = b[i + 1]
    if (marker === 0xff) {
      i++
      continue
    }
    // SOF0–SOF15（排除 DHT C4、JPG C8、DAC CC）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { width: u16be(b, i + 7), height: u16be(b, i + 5) }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    if (marker === 0xd9) return null
    i += 2 + u16be(b, i + 2)
  }
  return null
}

const SVG_MIME = 'image/svg+xml'

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`
}

/**
 * SVG 专用：URL 编码而不是 Base64 的 Data URL，通常更短且可读。
 * 只转义在 CSS url("…") / HTML 属性里有问题的字符，双引号换成单引号。
 */
export function svgToDataUrl(svg: string): string {
  const cleaned = svg
    .replace(/^\ufeff/, '')
    .trim()
    .replace(/\s+/g, ' ')
  const escaped = cleaned.replace(
    /[%#()<>?[\\\]^`{|}]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
  // 没有单引号时把双引号换成单引号（更短、可读）；SVG 里已有单引号（如 font-family="'A'"、
  // 文本里的 it's）时直接替换会破坏引号嵌套，改为把双引号编码成 %22
  const quoted = escaped.includes("'") ? escaped.replace(/"/g, '%22') : escaped.replace(/"/g, "'")
  const encoded = quoted.replace(/[^\x20-\x7e]/gu, (c) => {
    try {
      return encodeURIComponent(c)
    } catch {
      return '%EF%BF%BD'
    }
  })
  return `data:${SVG_MIME},${encoded}`
}

export interface ImageSnippets {
  dataUrl: string
  base64: string
  css: string
  html: string
  markdown: string
}

/** 生成各种可直接粘贴的写法 */
export function buildSnippets(
  dataUrl: string,
  opts: { alt?: string; width?: number; height?: number } = {},
): ImageSnippets {
  const comma = dataUrl.indexOf(',')
  const isBase64 = /;base64$/i.test(dataUrl.slice(0, comma))
  const base64 = isBase64 ? dataUrl.slice(comma + 1) : bytesToBase64(dataUrlPayload(dataUrl))
  const alt = (opts.alt ?? '图片').replace(/"/g, '&quot;')
  const size =
    opts.width && opts.height
      ? ` width="${Math.round(opts.width)}" height="${Math.round(opts.height)}"`
      : ''
  // URL 编码的 SVG 里只有单引号，CSS 用双引号包裹；HTML 属性同理
  return {
    dataUrl,
    base64,
    css: `background-image: url("${dataUrl}");`,
    html: `<img src="${dataUrl}" alt="${alt}"${size} />`,
    // 含空格的地址在 Markdown 里要用尖括号包起来
    markdown: `![${(opts.alt ?? '图片').replace(/[[\]]/g, '')}](${/\s/.test(dataUrl) ? `<${dataUrl}>` : dataUrl})`,
  }
}

/** 解出非 base64 data URL 的负载字节（百分号编码） */
function dataUrlPayload(dataUrl: string): Uint8Array {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const out: number[] = []
  for (let i = 0; i < payload.length; i++) {
    const c = payload[i]
    if (c === '%' && /^[0-9a-f]{2}$/i.test(payload.slice(i + 1, i + 3))) {
      out.push(parseInt(payload.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      const cp = payload.codePointAt(i)!
      if (cp > 0xffff) i++
      out.push(...utf8Encode(String.fromCodePoint(cp)))
    }
  }
  return Uint8Array.from(out)
}

export interface ParsedImage {
  bytes: Uint8Array
  /** 最终用于预览的 MIME（以文件头识别结果为准） */
  mime: string
  /** 输入里声明的 MIME（data: URL），没有则 undefined */
  declaredMime?: string
  /** 文件头识别结果 */
  detected: FileTypeInfo | null
  isImage: boolean
  source: 'data-url' | 'base64' | 'svg'
  /** 建议下载的扩展名 */
  ext: string
  /** 提示信息（例如声明类型与实际内容不符） */
  warnings: string[]
}

export type ParseImageResult = { ok: true; image: ParsedImage } | { ok: false; error: string }

/**
 * 从各种包装里取出 data: URL：
 * url("data:…")、<img src="data:…">、![](data:…)，或直接就是 data:…
 */
export function extractDataUrl(input: string): string | null {
  const text = input.trim()
  if (/^data:/i.test(text)) return text
  const i = text.search(/data:/i)
  if (i < 0) return null
  const opener = text[i - 1]
  const closer = opener === '"' ? '"' : opener === "'" ? "'" : opener === '(' ? ')' : null
  const rest = text.slice(i)
  if (closer) {
    const end = rest.indexOf(closer)
    return end >= 0 ? rest.slice(0, end) : rest
  }
  return rest.split(/[\s"'<>]/)[0]
}

/**
 * 文本是否以 SVG 根元素开头（前面可以有 BOM、XML 声明、注释与 DOCTYPE）。
 * 用下标线性扫描而不是嵌套量词的正则：大量注释时正则回溯是指数级的，会卡死页面。
 */
export function looksLikeSvg(text: string): boolean {
  const n = text.length
  let i = 0
  const skipSpace = () => {
    while (i < n && /\s/.test(text[i])) i++
  }
  if (text.charCodeAt(0) === 0xfeff) i = 1
  skipSpace()
  if (text.startsWith('<?xml', i)) {
    const end = text.indexOf('?>', i + 5)
    if (end < 0) return false
    i = end + 2
    skipSpace()
  }
  while (text.startsWith('<!--', i)) {
    const end = text.indexOf('-->', i + 4)
    if (end < 0) return false
    i = end + 3
    skipSpace()
  }
  if (/^<!doctype\s+svg/i.test(text.slice(i, i + 14))) {
    const end = text.indexOf('>', i)
    if (end < 0) return false
    i = end + 1
    skipSpace()
  }
  return /^<svg[\s>/]/i.test(text.slice(i, i + 5))
}

/** 解析 Data URL / 原始 Base64 / SVG 源码，得到图片字节与类型 */
export function parseImageInput(input: string): ParseImageResult {
  const text = input.trim()
  if (!text) return { ok: false, error: '请输入内容' }

  // 1) 直接粘贴的 SVG 源码
  if (looksLikeSvg(text)) {
    const bytes = utf8Encode(text)
    return {
      ok: true,
      image: {
        bytes,
        mime: SVG_MIME,
        detected: detectFileType(bytes),
        isImage: true,
        source: 'svg',
        ext: 'svg',
        warnings: [],
      },
    }
  }

  const dataUrl = extractDataUrl(text)
  if (dataUrl) return parseDataUrl(dataUrl)

  // 2) 原始 Base64
  const r = base64ToBytes(text)
  if (!r.ok) return { ok: false, error: `不是有效的 Data URL 或 Base64：${r.error}` }
  if (r.bytes.length === 0) return { ok: false, error: '解码结果为空' }
  return { ok: true, image: finish(r.bytes, 'base64', undefined) }
}

function parseDataUrl(url: string): ParseImageResult {
  const comma = url.indexOf(',')
  if (comma < 0)
    return { ok: false, error: 'Data URL 缺少逗号：格式应为 data:[<MIME>][;base64],<数据>' }
  const meta = url.slice(5, comma)
  const parts = meta.split(';').map((s) => s.trim())
  const isBase64 = parts.some((p) => p.toLowerCase() === 'base64')
  const declared = parts[0]?.toLowerCase() || undefined
  if (declared && !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(declared)) {
    return { ok: false, error: `Data URL 中的 MIME 类型“${parts[0]}”格式不正确，应形如 image/png` }
  }
  let bytes: Uint8Array
  if (isBase64) {
    const payload = url.slice(comma + 1)
    // 百分号编码过的 base64（如 %2B、%3D）先还原
    const unescaped = /%[0-9a-f]{2}/i.test(payload)
      ? payload.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
      : payload
    const r = base64ToBytes(unescaped)
    if (!r.ok) {
      return { ok: false, error: `Data URL 的 Base64 数据有误（位置相对逗号之后）：${r.error}` }
    }
    bytes = r.bytes
  } else {
    bytes = dataUrlPayload(url)
  }
  if (bytes.length === 0) return { ok: false, error: 'Data URL 中没有数据' }
  return { ok: true, image: finish(bytes, 'data-url', declared) }
}

function finish(
  bytes: Uint8Array,
  source: ParsedImage['source'],
  declaredMime: string | undefined,
): ParsedImage {
  const detected = detectFileType(bytes)
  const warnings: string[] = []
  let mime = detected?.mime ?? declaredMime ?? 'application/octet-stream'
  const detectedIsImage = detected?.kind === 'image'
  if (declaredMime && detected && declaredMime !== detected.mime) {
    const same =
      (declaredMime === 'image/jpg' && detected.mime === 'image/jpeg') ||
      (declaredMime === 'image/vnd.microsoft.icon' && detected.mime === 'image/x-icon')
    if (!same) {
      warnings.push(
        `声明的类型 ${declaredMime} 与实际内容（${detected.label}，${detected.mime}）不一致，已按实际内容处理`,
      )
    }
  }
  if (!detected && declaredMime?.startsWith('image/')) mime = declaredMime
  const isImage = detectedIsImage || (!detected && !!declaredMime?.startsWith('image/'))
  const ext = detected?.ext ?? (declaredMime ? extFromMime(declaredMime) : null) ?? 'bin'
  return { bytes, mime, declaredMime, detected, isImage, source, ext, warnings }
}

/** 百分比形式的膨胀率（Base64 字符数相对原始字节） */
export function growth(originalBytes: number, encodedChars: number): string {
  if (!originalBytes) return '0%'
  const p = ((encodedChars - originalBytes) / originalBytes) * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`
}
