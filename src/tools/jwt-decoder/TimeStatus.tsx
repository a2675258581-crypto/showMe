import { motion } from 'motion/react'
import { CalendarClock, CircleCheck, CircleX, Clock3, Infinity as InfinityIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  formatCountdown,
  formatDateTime,
  formatDuration,
  timeState,
  type JwtTimeStateKind,
} from '@/lib/jwt-decoder'
import { useNow } from './useNow'

const STYLE: Record<JwtTimeStateKind, { label: string; badge: string; icon: typeof CircleCheck }> =
  {
    valid: { label: '有效', badge: 'bg-success/12 text-success', icon: CircleCheck },
    expired: { label: '已过期', badge: 'bg-danger/10 text-danger', icon: CircleX },
    notYet: { label: '未生效', badge: 'bg-warning/12 text-warning', icon: Clock3 },
    noExp: { label: '永不过期', badge: 'bg-fill text-fg-2', icon: InfinityIcon },
  }

/** 有效期状态：徽标、实时倒计时、有效期进度条 */
export function TimeStatus({ payload }: { payload: Record<string, unknown> }) {
  const now = useNow(1000)
  const st = timeState(payload, now)
  const s = STYLE[st.state]
  const Icon = s.icon

  let headline: string
  let detail: string
  switch (st.state) {
    case 'valid':
      headline =
        st.remainingMs! >= 86_400_000
          ? `剩余 ${formatDuration(st.remainingMs!, 3)}`
          : `剩余 ${formatCountdown(st.remainingMs!)}`
      detail = `将于 ${formatDateTime(st.exp!)} 过期`
      break
    case 'expired':
      headline = `已过期 ${formatDuration(-st.remainingMs!, 2)}`
      detail = `过期时间 ${formatDateTime(st.exp!)}`
      break
    case 'notYet':
      headline =
        st.untilValidMs! >= 86_400_000
          ? `${formatDuration(st.untilValidMs!, 3)}后生效`
          : `${formatCountdown(st.untilValidMs!)} 后生效`
      detail = `生效时间 ${formatDateTime(st.nbf!)}`
      break
    default:
      headline = '没有 exp 声明'
      detail = '令牌不会自动过期，服务端需要其它方式吊销'
  }

  const pct = st.progress !== undefined ? st.progress * 100 : undefined
  const barColor =
    pct === undefined ? '' : pct > 95 ? 'bg-danger' : pct > 80 ? 'bg-warning' : 'bg-success'

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-3">
        <motion.span
          key={st.state}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 24 }}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
            s.badge,
          )}
        >
          <Icon className="size-3.5" />
          {s.label}
        </motion.span>
        <span
          className={cn(
            'min-w-0 font-mono text-base font-semibold tabular-nums tracking-tight sm:text-lg',
            st.state === 'valid' ? 'text-fg' : 'text-fg-2',
          )}
          aria-live="off"
        >
          {headline}
        </span>
        {st.state === 'valid' && (
          <span className="relative ml-auto flex size-2.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-success" />
          </span>
        )}
      </div>
      {pct !== undefined && st.state === 'valid' && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-fill"
          role="progressbar"
          aria-label="有效期已过去的比例"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <motion.div
            className={cn('h-full rounded-full', barColor)}
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 24 }}
          />
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs text-fg-3">
        <CalendarClock className="size-3.5 shrink-0" />
        <span>{detail}</span>
      </div>
    </div>
  )
}
