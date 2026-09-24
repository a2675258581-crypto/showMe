import { useEffect, useRef, type CSSProperties, type ImgHTMLAttributes } from 'react'
import {
  Cpu,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileText,
  FileType,
  FileVideo,
  Image as ImageIcon,
} from 'lucide-react'
import type { FileKind } from '@/lib/base64-filetype'
import { cn } from '@/lib/cn'

/** 透明图片下面的棋盘格（用设计 token，深色模式同样适用） */
export const CHECKER: CSSProperties = {
  backgroundImage:
    'conic-gradient(var(--fill) 25%, transparent 0 50%, var(--fill) 0 75%, transparent 0)',
  backgroundSize: '16px 16px',
}

export const KIND_META: Record<FileKind, { icon: typeof FileIcon; color: string }> = {
  image: { icon: ImageIcon, color: 'var(--sys-blue)' },
  audio: { icon: FileAudio, color: 'var(--sys-pink)' },
  video: { icon: FileVideo, color: 'var(--sys-purple)' },
  document: { icon: FileText, color: 'var(--sys-red)' },
  archive: { icon: FileArchive, color: 'var(--sys-orange)' },
  font: { icon: FileType, color: 'var(--sys-indigo)' },
  text: { icon: FileCode, color: 'var(--sys-green)' },
  executable: { icon: Cpu, color: 'var(--sys-teal)' },
  binary: { icon: FileIcon, color: 'var(--fg-2)' },
}

/** 文件类型图标块 */
export function KindIcon({ kind, className }: { kind: FileKind | undefined; className?: string }) {
  const meta = KIND_META[kind ?? 'binary']
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-2xl',
        className ?? 'size-11',
      )}
      style={{
        color: meta.color,
        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
      }}
    >
      <Icon className="size-5" />
    </span>
  )
}

/**
 * 用对象 URL 显示二进制图片：URL 在 effect 里创建并直接写到元素上，
 * 卸载或数据变化时立即 revoke，StrictMode 下也不会泄漏或失效。
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

/** 音频 / 视频预览，同样自动 revoke 对象 URL */
export function BlobMedia({
  bytes,
  mime,
  kind,
  className,
}: {
  bytes: Uint8Array
  mime: string
  kind: 'audio' | 'video'
  className?: string
}) {
  const ref = useRef<HTMLMediaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
    el.src = url
    return () => {
      el.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [bytes, mime])
  return kind === 'audio' ? (
    <audio ref={(el) => void (ref.current = el)} controls className={className} />
  ) : (
    <video ref={(el) => void (ref.current = el)} controls className={className} />
  )
}

/** 小图标放大显示：最长边不超过 64px 时按整数倍放大到约 128px */
export function previewZoom(size: { width: number; height: number } | null): number {
  if (!size) return 1
  const m = Math.max(size.width, size.height)
  if (!(m > 0) || m > 64) return 1
  return Math.min(8, Math.floor(128 / m))
}
