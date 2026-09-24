import { motion } from 'motion/react'
import { CircleCheck, CircleX, FileText, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { formatBytes } from '@/lib/file'
import { cn } from '@/lib/cn'

export interface FileJob {
  file: File
  status: 'hashing' | 'done' | 'error' | 'cancelled'
  done: number
  /** 字节 / 秒 */
  speed?: number
  elapsedMs?: number
  error?: string
}

interface Props {
  job: FileJob
  onCancel: () => void
  onRetry: () => void
  onClear: () => void
}

/** 正在计算 / 已计算的文件信息卡：进度条、速度、取消 */
export function FileCard({ job, onCancel, onRetry, onClear }: Props) {
  const { file, status } = job
  const pct = file.size ? Math.round((job.done / file.size) * 1000) / 10 : 100
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-2xl transition-colors duration-300',
            status === 'done'
              ? 'bg-success/12 text-success'
              : status === 'error'
                ? 'bg-danger/10 text-danger'
                : 'bg-accent-soft text-accent',
          )}
        >
          {status === 'done' ? (
            <CircleCheck className="size-5" />
          ) : status === 'error' ? (
            <CircleX className="size-5" />
          ) : (
            <FileText className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-fg" title={file.name}>
            {file.name}
          </div>
          <div className="text-xs text-fg-3 tabular-nums">
            {formatBytes(file.size)}
            {file.type && ` · ${file.type}`}
            {status === 'hashing' && job.speed ? ` · ${formatBytes(job.speed)}/s` : ''}
            {status === 'done' && job.elapsedMs !== undefined
              ? ` · 用时 ${job.elapsedMs < 1000 ? `${Math.max(1, Math.round(job.elapsedMs))} 毫秒` : `${(job.elapsedMs / 1000).toFixed(1)} 秒`}`
              : ''}
            {status === 'cancelled' && ' · 已取消'}
          </div>
        </div>
        {status === 'hashing' ? (
          <Button size="sm" variant="secondary" icon={<X />} onClick={onCancel}>
            取消
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            {(status === 'cancelled' || status === 'error') && (
              <Button size="sm" variant="secondary" icon={<RotateCw />} onClick={onRetry}>
                重新计算
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon={<X />}
              aria-label="移除文件"
              title="移除文件"
              onClick={onClear}
            />
          </div>
        )}
      </div>

      {(status === 'hashing' || status === 'cancelled') && (
        <div className="flex items-center gap-3">
          <div
            className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-fill"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="计算进度"
          >
            <motion.div
              className={cn(
                'absolute inset-y-0 left-0 rounded-full',
                status === 'cancelled' ? 'bg-fill-3' : 'bg-accent',
              )}
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 30 }}
            />
          </div>
          <span className="w-12 text-right text-xs font-medium text-fg-2 tabular-nums">
            {pct.toFixed(pct >= 100 ? 0 : 1)}%
          </span>
        </div>
      )}
      {status === 'error' && job.error && <div className="text-xs text-danger">{job.error}</div>}
    </div>
  )
}
