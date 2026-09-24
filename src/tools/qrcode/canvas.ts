/** 浏览器端绘制与读图辅助（依赖 DOM / Canvas） */

import type { QrGeometry } from '@/lib/qrcode'
import type { Rgba } from '@/lib/qrcode-decode'

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

/** 解码任意图片 Blob（包括 SVG）为可绘制对象 */
async function decodeBlob(
  blob: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  try {
    const bmp = await createImageBitmap(blob)
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
  } catch {
    const url = URL.createObjectURL(blob)
    try {
      const img = await loadImage(url)
      return { source: img, width: img.naturalWidth || 512, height: img.naturalHeight || 512 }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/** 把图片读成 RGBA 像素（长边不超过 maxSide），透明处垫白 */
export async function blobToRgba(blob: Blob, maxSide = 2000): Promise<Rgba> {
  const img = await decodeBlob(blob)
  try {
    const k = Math.min(1, maxSide / Math.max(img.width, img.height))
    const width = Math.max(1, Math.round(img.width * k))
    const height = Math.max(1, Math.round(img.height * k))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('浏览器不支持 Canvas')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img.source, 0, 0, width, height)
    const data = ctx.getImageData(0, 0, width, height).data
    return { data, width, height }
  } finally {
    img.close?.()
  }
}

/** Logo 统一缩成 ≤ 256px 的 PNG data URL，SVG / PNG 导出都不会太大 */
export async function prepareLogo(file: Blob): Promise<string> {
  const img = await decodeBlob(file)
  try {
    const k = Math.min(1, 256 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * k))
    canvas.height = Math.max(1, Math.round(img.height * k))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器不支持 Canvas')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    img.close?.()
  }
}

/** 按像素尺寸把二维码画到新 canvas 上，导出 PNG */
export async function geometryToPng(
  g: QrGeometry,
  o: { fg: string; bg: string; px: number; logo?: string | null },
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = o.px
  canvas.height = o.px
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 Canvas')
  const k = o.px / g.dim
  ctx.fillStyle = o.bg
  ctx.fillRect(0, 0, o.px, o.px)
  ctx.save()
  ctx.scale(k, k)
  ctx.fillStyle = o.fg
  if (g.modules) ctx.fill(new Path2D(g.modules))
  ctx.fill(new Path2D(g.eyeOuter), 'evenodd')
  ctx.fill(new Path2D(g.eyeInner))
  ctx.restore()

  if (g.logo && o.logo) {
    const { x, y, size, radius, inset } = g.logo
    ctx.fillStyle = o.bg
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function')
      ctx.roundRect(x * k, y * k, size * k, size * k, radius * k)
    else ctx.rect(x * k, y * k, size * k, size * k)
    ctx.fill()
    const img = await loadImage(o.logo)
    const box = (size - inset * 2) * k
    const fit = Math.min(box / img.naturalWidth, box / img.naturalHeight)
    const w = img.naturalWidth * fit
    const h = img.naturalHeight * fit
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (x + inset) * k + (box - w) / 2, (y + inset) * k + (box - h) / 2, w, h)
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出 PNG 失败'))), 'image/png'),
  )
}

export const canCopyImage =
  typeof window !== 'undefined' &&
  typeof ClipboardItem !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !!navigator.clipboard?.write

/** 复制 PNG 到剪贴板（传入 Promise 以兼容 Safari 的用户手势限制） */
export async function copyPng(blob: Promise<Blob>): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

/** 从系统剪贴板读取第一张图片（需要浏览器授权） */
export async function readClipboardImage(): Promise<Blob | null> {
  if (!navigator.clipboard?.read) return null
  const items = await navigator.clipboard.read()
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'))
    if (type) return item.getType(type)
  }
  return null
}
