import { useState } from 'react'
import { motion } from 'motion/react'
import { ArrowDownToLine, Pause, Play } from 'lucide-react'
import { Button, CopyButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { WEEKDAY_ZH, formatDateTime, formatOffset, zonedParts } from '@/lib/timestamp'
import { AnimatedDigits } from './AnimatedDigits'
import { useNow } from './useNow'

/** 顶部大卡片：实时跳动的 Unix 时间戳 */
export function LiveClock({ tz, onUse }: { tz: string; onUse: (epochMs: number) => void }) {
  const [paused, setPaused] = useState(false)
  const now = useNow(47, paused)
  const seconds = String(Math.floor(now / 1000))
  const millis = String(now)
  const p = zonedParts(now, tz)

  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 -right-20 size-80 rounded-full bg-accent/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 left-1/4 size-72 rounded-full bg-sys-purple/10 blur-3xl"
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-2">
            <span className="relative flex size-2">
              {!paused && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-sys-green opacity-60" />
              )}
              <span
                className={cn(
                  'relative inline-flex size-2 rounded-full transition-colors',
                  paused ? 'bg-fg-3' : 'bg-sys-green',
                )}
              />
            </span>
            {paused ? '已暂停' : '当前 Unix 时间戳'}
          </div>
          <motion.div
            animate={{ opacity: paused ? 0.55 : 1 }}
            transition={{ duration: 0.3 }}
            className="mt-2 text-[44px] leading-none font-semibold tracking-tight text-fg sm:text-[64px] lg:text-[76px]"
            aria-live="off"
          >
            <AnimatedDigits value={seconds} />
          </motion.div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-fg-2">
            <span className="inline-flex items-baseline gap-1.5">
              <span className="text-xs font-semibold text-fg-3">毫秒</span>
              <span className="font-mono tabular-nums">
                {millis.slice(0, -3)}
                <span className="text-fg-3">{millis.slice(-3)}</span>
              </span>
            </span>
            <span className="font-mono tabular-nums">
              {formatDateTime(p, 0, false)} {WEEKDAY_ZH[p.weekday]} · UTC
              {formatOffset(p.offsetSeconds)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={paused ? 'primary' : 'secondary'}
            icon={paused ? <Play /> : <Pause />}
            onClick={() => setPaused((v) => !v)}
          >
            {paused ? '继续' : '暂停'}
          </Button>
          <CopyButton text={seconds} label="复制秒" size="md" />
          <CopyButton text={millis} label="复制毫秒" size="md" />
          <Button
            variant="ghost"
            icon={<ArrowDownToLine />}
            onClick={() => onUse(now)}
            title="填入下方的「时间戳 → 日期」"
          >
            转换
          </Button>
        </div>
      </div>
    </section>
  )
}
