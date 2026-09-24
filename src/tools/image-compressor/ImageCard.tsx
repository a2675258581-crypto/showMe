import { useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Columns2, Download, ImageOff, Loader2, TriangleAlert, X } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/file'
import { formatLabel, formatSavings, savings } from '@/lib/image-compressor'
import type { CompressResult } from './encode'

export interface Item {
  id: string
  file: File
  name: string
  mime: string
  size: number
  /** 原图 object URL */
  url: string
  status: 'queued' | 'working' | 'done' | 'error'
  /** 该结果对应的选项指纹；与当前不一致时需要重新压缩 */
  key?: string
  out?: CompressResult & { url: string; size: number }
  error?: string
}

export function ImageCard({
  item,
  stale,
  onCompare,
  onDownload,
  onRemove,
}: {
  item: Item
  /** 选项已变、等待重新压缩 */
  stale: boolean
  onCompare: () => void
  onDownload: () => void
  onRemove: () => void
}) {
  const { out } = item
  const s = out ? savings(item.size, out.size) : null
  const busy = item.status === 'working' || item.status === 'queued' || stale
  const canCompare = !!out && !out.kept
  // 浏览器无法显示的格式（HEIC、损坏文件）不显示破图图标
  const [thumbFailed, setThumbFailed] = useState(false)

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="flex min-w-0 list-none gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card"
    >
      <button
        type="button"
        onClick={onCompare}
        disabled={!canCompare}
        aria-label={`对比 ${item.name} 压缩前后`}
        title={canCompare ? '点击对比压缩前后' : undefined}
        className="group relative size-[72px] shrink-0 overflow-hidden rounded-xl bg-fill-2 ring-1 ring-line enabled:cursor-zoom-in"
      >
        {thumbFailed ? (
          <span className="flex size-full items-center justify-center text-fg-3">
            <ImageOff className="size-6" />
          </span>
        ) : (
          <img
            src={item.url}
            alt=""
            loading="lazy"
            onError={() => setThumbFailed(true)}
            className="size-full object-cover transition-transform duration-300 group-enabled:group-hover:scale-105"
          />
        )}
        {busy && (
          <span className="glass absolute inset-0 flex items-center justify-center">
            <Loader2 className="size-5 animate-spin text-fg" />
          </span>
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 truncate text-[13px] font-medium text-fg" title={item.name}>
            {item.name}
          </div>
          <div className="-mt-1 -mr-1 flex shrink-0">
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon={<Columns2 />}
              aria-label="对比压缩前后"
              title="对比压缩前后"
              disabled={!canCompare}
              onClick={onCompare}
            />
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon={<Download />}
              aria-label={`下载 ${out?.name ?? item.name}`}
              title="下载"
              disabled={!out || busy}
              onClick={onDownload}
            />
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon={<X />}
              aria-label={`移除 ${item.name}`}
              title="移除"
              onClick={onRemove}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-2 tabular-nums">
          <Badge color="var(--fg-2)">{formatLabel(item.mime)}</Badge>
          {out && !out.kept && out.mime !== item.mime && (
            <>
              <ArrowRight className="size-3 text-fg-3" />
              <Badge>{formatLabel(out.mime)}</Badge>
            </>
          )}
          {out && (
            <span>
              {out.srcWidth}×{out.srcHeight}
              {(out.width !== out.srcWidth || out.height !== out.srcHeight) && (
                <>
                  {' → '}
                  <span className="text-fg">
                    {out.width}×{out.height}
                  </span>
                </>
              )}
            </span>
          )}
        </div>

        {item.status === 'error' ? (
          <p className="flex items-start gap-1 text-xs leading-relaxed text-danger">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {item.error}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
              <span className="text-fg-2">
                {formatBytes(item.size)}
                {out && (
                  <>
                    {' → '}
                    <span className="font-medium text-fg">{formatBytes(out.size)}</span>
                  </>
                )}
                {!out && (
                  <span className="ml-1.5 text-fg-3">
                    {item.status === 'working' ? '压缩中…' : '排队中…'}
                  </span>
                )}
              </span>
              {s && (
                <span
                  className={cn(
                    'font-semibold',
                    out?.kept ? 'text-fg-3' : s.percent > 0 ? 'text-success' : 'text-warning',
                  )}
                >
                  {out?.kept ? '保留原图' : formatSavings(s.percent)}
                </span>
              )}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-fill" aria-hidden>
              <motion.div
                className={cn(
                  'h-full rounded-full',
                  !s || out?.kept ? 'bg-fill-3' : s.percent > 0 ? 'bg-sys-green' : 'bg-warning',
                )}
                initial={{ width: '100%' }}
                animate={{ width: `${s ? Math.max(2, Math.min(100, s.ratio * 100)) : 100}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>
            {out && out.notes.length > 0 && (
              <p className="text-[11px] leading-relaxed text-fg-3">{out.notes.join(' · ')}</p>
            )}
          </>
        )}
      </div>
    </motion.li>
  )
}
