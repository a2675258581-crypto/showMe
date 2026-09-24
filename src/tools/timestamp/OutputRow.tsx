import type { ReactNode } from 'react'
import { CopyButton } from '@/components/ui'
import { cn } from '@/lib/cn'

/** 结果行：左侧标签，右侧可复制的值 */
export function OutputRow({
  label,
  value,
  hint,
  mono = true,
  copy = true,
}: {
  label: ReactNode
  value: string
  hint?: ReactNode
  mono?: boolean
  copy?: boolean
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
        <div className="mb-0.5 shrink-0 text-xs font-semibold text-fg-2 sm:mb-0 sm:w-28">
          {label}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'text-[13px] leading-snug break-all text-fg',
              mono && 'font-mono tabular-nums',
            )}
          >
            {value}
          </div>
          {hint && <div className="mt-0.5 text-[11px] text-fg-3">{hint}</div>}
        </div>
      </div>
      {copy && (
        <CopyButton
          text={value}
          iconOnly
          variant="ghost"
          label={`复制${typeof label === 'string' ? label : ''}`}
          disabled={!value}
        />
      )}
    </div>
  )
}

/** 大号可复制数值块（秒 / 毫秒等） */
export function ValueTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-2xl bg-fill-2 py-2.5 pr-2 pl-3.5">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-fg-3">{label}</div>
        <div className="truncate font-mono text-[15px] text-fg tabular-nums" title={value}>
          {value}
        </div>
      </div>
      <CopyButton text={value} iconOnly variant="ghost" label={`复制${label}`} />
    </div>
  )
}
