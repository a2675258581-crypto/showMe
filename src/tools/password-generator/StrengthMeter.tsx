import { AnimatePresence, motion } from 'motion/react'
import { ShieldAlert, ShieldCheck, ShieldHalf } from 'lucide-react'
import {
  GUESSES_PER_SECOND,
  STRENGTH_THRESHOLDS,
  formatCrackTime,
  strengthOf,
} from '@/lib/password-generator'

const NOTE = `按离线攻击每秒 ${GUESSES_PER_SECOND / 1e8} 亿次猜测、平均需遍历一半密码空间估算；熵 ≥ ${STRENGTH_THRESHOLDS[2]} 位为极强。`

const COLORS = ['var(--sys-red)', 'var(--sys-orange)', 'var(--sys-green)', 'var(--sys-teal)']
const ICONS = [ShieldAlert, ShieldHalf, ShieldCheck, ShieldCheck]

/** 熵 → 彩色强度条 + 等级 + 估算破解时间 */
export function StrengthMeter({ bits }: { bits: number }) {
  const s = strengthOf(bits)
  const color = COLORS[s.level]
  const Icon = ICONS[s.level]
  const crack = formatCrackTime(bits)
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={s.level}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold"
              style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
            >
              <Icon className="size-4" />
              {s.label}
            </motion.span>
          </AnimatePresence>
          <span className="text-[13px] text-fg-2 tabular-nums">{bits.toFixed(1)} 位熵</span>
        </div>
        <span className="text-[13px] text-fg-2">
          暴力破解平均约需 <span className="font-semibold text-fg">{crack}</span>
        </span>
      </div>
      <div
        className="relative h-2 overflow-hidden rounded-full bg-fill"
        role="meter"
        aria-label="密码强度"
        aria-valuemin={0}
        aria-valuemax={128}
        aria-valuenow={Math.round(Math.min(bits, 128))}
        aria-valuetext={`${s.label}，${bits.toFixed(0)} 位熵`}
      >
        <motion.div
          className="h-full rounded-full transition-[background-color] duration-500"
          style={{ backgroundColor: color }}
          initial={false}
          animate={{ width: `${s.ratio * 100}%` }}
          transition={{ type: 'spring', stiffness: 160, damping: 24 }}
        />
        {STRENGTH_THRESHOLDS.map((t) => (
          <span
            key={t}
            aria-hidden
            className="absolute top-0 h-full w-0.5 bg-surface"
            style={{ left: `${(t / 128) * 100}%` }}
          />
        ))}
      </div>
      <p className="text-[11px] text-fg-3">{NOTE}</p>
    </div>
  )
}
