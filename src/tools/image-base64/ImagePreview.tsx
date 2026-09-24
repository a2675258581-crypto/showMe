import { useEffect, useRef, type CSSProperties, type ImgHTMLAttributes } from 'react'

/** 透明图片下面的棋盘格（用设计 token，深色模式同样适用） */
export const CHECKER: CSSProperties = {
  backgroundImage:
    'conic-gradient(var(--fill) 25%, transparent 0 50%, var(--fill) 0 75%, transparent 0)',
  backgroundSize: '16px 16px',
}

/**
 * 用对象 URL 显示图片字节：URL 在 effect 里创建并直接写到 <img> 上，
 * 数据变化或卸载时立即 revoke（StrictMode 的二次执行也安全）。
 */
export function BlobImage({
  bytes,
  mime,
  ...rest
}: { bytes: Uint8Array; mime: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
    el.src = url
    return () => URL.revokeObjectURL(url)
  }, [bytes, mime])
  return <img ref={ref} alt="" {...rest} />
}

/** 小图标放大显示：最长边不超过 64px 时按整数倍放大到约 128px */
export function previewZoom(size: { width: number; height: number } | null): number {
  if (!size) return 1
  const m = Math.max(size.width, size.height)
  if (!(m > 0) || m > 64) return 1
  return Math.min(8, Math.floor(128 / m))
}

/** 放大后的 <img> 样式；位图用最近邻缩放保持像素清晰 */
export function zoomStyle(
  size: { width: number; height: number } | null,
  zoom: number,
  vector: boolean,
): CSSProperties | undefined {
  if (!size || zoom <= 1) return undefined
  return {
    width: size.width * zoom,
    height: size.height * zoom,
    imageRendering: vector ? 'auto' : 'pixelated',
  }
}
