import { useMemo } from 'react'
import { motion } from 'motion/react'
import { TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { claimRows, formatDateTime, formatRelative } from '@/lib/jwt-decoder'
import { useNow } from './useNow'

/** 声明表：注册声明的中文解释、时间换算与相对时间 */
export function ClaimsTable({ payload }: { payload: Record<string, unknown> }) {
  const rows = useMemo(() => claimRows(payload), [payload])
  const now = useNow(1000)

  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border border-line bg-surface p-6 text-center text-sm text-fg-3 shadow-card">
        Payload 中没有任何声明
      </div>
    )
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <h3 className="text-[15px] font-semibold tracking-tight text-fg">声明（Claims）</h3>
        <span className="text-xs text-fg-3">
          共 {rows.length} 项 · 注册声明 {rows.filter((r) => r.registered).length} 项
        </span>
      </div>
      <ul>
        {rows.map((r, i) => (
          <motion.li
            key={r.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 10) * 0.025, duration: 0.3 }}
            className={cn(
              'grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:px-5',
              i > 0 && 'border-t border-line',
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <code
                  className={cn(
                    'rounded-md px-1.5 py-0.5 font-mono text-[12px] font-semibold',
                    r.registered ? 'bg-sys-purple/12 text-sys-purple' : 'bg-fill text-fg-2',
                  )}
                >
                  {r.key}
                </code>
                <span className="text-[13px] font-medium text-fg">{r.name}</span>
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-fg-3">{r.desc}</div>
            </div>
            <div className="min-w-0 self-center">
              <div className="font-mono text-[13px] break-all text-fg">{r.text}</div>
              {r.seconds !== undefined && (
                <div className="mt-0.5 text-xs text-fg-2 tabular-nums">
                  {formatDateTime(r.seconds)}
                  <span className="text-fg-3"> · {formatRelative(r.seconds * 1000 - now)}</span>
                </div>
              )}
              {r.issue && (
                <div className="mt-1 flex items-center gap-1 text-xs text-warning">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  {r.issue}
                </div>
              )}
            </div>
          </motion.li>
        ))}
      </ul>
    </section>
  )
}
