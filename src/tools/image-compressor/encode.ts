/** 浏览器端解码 / 缩放 / 编码（依赖 Canvas） */

import {
  CANVAS_MAX_PIXELS,
  ENCODE_MIMES,
  downscaleSteps,
  formatLabel,
  normalizeMime,
  qualityApplies,
  resolveOutputFormat,
  rewriteFilename,
  shouldKeepOriginal,
  targetSize,
  type OutputChoice,
} from '@/lib/image-compressor'
import { formatBytes } from '@/lib/file'

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const hasOffscreen = typeof OffscreenCanvas !== 'undefined'

function makeCanvas(w: number, h: number): { canvas: AnyCanvas; ctx: Ctx2D } {
  if (hasOffscreen) {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (ctx) return { canvas, ctx }
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布：图片尺寸可能超出了浏览器上限，请设置最大宽高后重试。')
  return { canvas, ctx }
}

function encode(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality }).catch(() => null)
  }
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

let supportPromise: Promise<string[]> | null = null

/** 探测浏览器能编码的格式（编码 1×1 画布，看返回的类型是否一致） */
export function detectEncodeSupport(): Promise<string[]> {
  supportPromise ??= (async () => {
    const out: string[] = []
    for (const mime of ENCODE_MIMES) {
      try {
        const { canvas, ctx } = makeCanvas(2, 2)
        ctx.fillRect(0, 0, 1, 1)
        const blob = await encode(canvas, mime, 0.8)
        if (blob && blob.type === mime) out.push(mime)
      } catch {
        // 不支持
      }
    }
    if (!out.includes('image/png')) out.push('image/png')
    return out
  })()
  return supportPromise
}

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

/** 解码并按 EXIF 方向摆正；SVG 等 createImageBitmap 不支持的格式退回 <img> */
export async function decodeImage(file: Blob): Promise<Decoded> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      await img.decode()
      const width = img.naturalWidth || 1024
      const height = img.naturalHeight || 1024
      return { source: img, width, height, close: () => {} }
    } catch {
      throw new Error(
        '无法解码这张图片：格式可能不受当前浏览器支持（如 HEIC、TIFF），或文件已损坏。',
      )
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

export interface CompressOptions {
  format: OutputChoice
  /** 1–100 */
  quality: number
  maxWidth?: number
  maxHeight?: number
  keepAspect: boolean
}

export interface CompressResult {
  blob: Blob
  mime: string
  name: string
  width: number
  height: number
  srcWidth: number
  srcHeight: number
  /** 结果更大，保留了原图 */
  kept: boolean
  notes: string[]
}

export async function compressImage(
  file: File,
  opts: CompressOptions,
  supported: readonly string[],
): Promise<CompressResult> {
  const inputMime = normalizeMime(file.type, file.name)
  const img = await decodeImage(file)
  try {
    const target = targetSize(img.width, img.height, opts.maxWidth, opts.maxHeight, opts.keepAspect)
    if (target.width * target.height > CANVAS_MAX_PIXELS * 4) {
      throw new Error(
        `图片过大（${target.width}×${target.height}），超出浏览器画布上限，请设置最大宽高后重试。`,
      )
    }
    const fmt = resolveOutputFormat(inputMime, opts.format, supported)
    const notes: string[] = fmt.note ? [fmt.note] : []

    // 逐级缩小，保证缩放质量
    let source: CanvasImageSource = img.source
    let last: { canvas: AnyCanvas; ctx: Ctx2D } | null = null
    for (const step of downscaleSteps(img.width, img.height, target.width, target.height)) {
      const cur = makeCanvas(step.width, step.height)
      cur.ctx.imageSmoothingEnabled = true
      cur.ctx.imageSmoothingQuality = 'high'
      if (fmt.mime === 'image/jpeg') {
        // JPEG 没有透明度，透明区域垫白
        cur.ctx.fillStyle = '#ffffff'
        cur.ctx.fillRect(0, 0, step.width, step.height)
      }
      cur.ctx.drawImage(source, 0, 0, step.width, step.height)
      source = cur.canvas
      last = cur
    }
    if (!last) throw new Error('绘制失败')

    const quality = qualityApplies(fmt.mime)
      ? Math.min(1, Math.max(0.01, opts.quality / 100))
      : undefined
    const blob = await encode(last.canvas, fmt.mime, quality)
    if (!blob) {
      throw new Error('编码失败：图片可能超出了浏览器画布上限，请设置最大宽高后重试。')
    }
    let mime = blob.type || fmt.mime
    if (mime !== fmt.mime)
      notes.push(`浏览器未能输出 ${formatLabel(fmt.mime)}，实际为 ${formatLabel(mime)}`)

    if (
      shouldKeepOriginal({
        originalSize: file.size,
        resultSize: blob.size,
        explicitFormat: fmt.explicit,
        resized: target.resized,
      })
    ) {
      mime = inputMime || file.type
      return {
        blob: file,
        mime,
        name: file.name,
        width: img.width,
        height: img.height,
        srcWidth: img.width,
        srcHeight: img.height,
        kept: true,
        notes: [`压缩结果（${formatBytes(blob.size)}）没有比原图小，已保留原图`],
      }
    }
    if (blob.size >= file.size) {
      notes.push(
        target.resized && !fmt.explicit
          ? '缩小尺寸后体积反而没有变小（原图压缩率已很高），已按要求的尺寸输出'
          : `转换为 ${formatLabel(mime)} 后体积变大，已按所选格式输出`,
      )
    }
    return {
      blob,
      mime,
      name: rewriteFilename(file.name, mime),
      width: target.width,
      height: target.height,
      srcWidth: img.width,
      srcHeight: img.height,
      kept: false,
      notes,
    }
  } finally {
    img.close()
  }
}
