import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarClock, Clock, X } from 'lucide-react'
import {
  Badge,
  Button,
  ErrorNotice,
  Input,
  Panel,
  PanelHeader,
  SegmentedControl,
} from '@/components/ui'
import {
  UNIT_LABEL,
  describeInstant,
  instantToUnit,
  parseTimestamp,
  type TsUnit,
} from '@/lib/timestamp'
import { OutputRow, ValueTile } from './OutputRow'
import { useNow } from './useNow'

export type UnitChoice = TsUnit | 'auto'

const UNIT_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 's', label: '秒' },
  { value: 'ms', label: '毫秒' },
  { value: 'us', label: '微秒' },
  { value: 'ns', label: '纳秒' },
] as const

interface Props {
  input: string
  onInput: (v: string) => void
  unit: UnitChoice
  onUnit: (u: UnitChoice) => void
  tz: string
}

/** 时间戳 → 日期 */
export function TsToDate({ input, onInput, unit, onUnit, tz }: Props) {
  const now = useNow(1000)
  const parsed = useMemo(() => (input.trim() ? parseTimestamp(input, unit) : null), [input, unit])
  const ok = parsed?.ok ? parsed.value : null
  const d = ok ? describeInstant(ok.instant, tz, now) : null

  const fillNow = () => {
    const t = Date.now()
    const u: TsUnit = unit === 'auto' ? 's' : unit
    onInput(instantToUnit({ epochMs: t, subMsNs: 0 }, u))
  }

  return (
    <Panel className="flex min-w-0 flex-col">
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Clock className="size-4 text-accent" />
            时间戳 → 日期
          </span>
        }
      >
        <Button size="sm" variant="ghost" icon={<CalendarClock />} onClick={fillNow}>
          现在
        </Button>
      </PanelHeader>

      <div className="relative">
        <Input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          placeholder="输入时间戳，如 1704067200 或 1704067200000"
          mono
          inputMode="decimal"
          className="h-12 pr-10 text-base"
          aria-label="时间戳"
        />
        {input && (
          <button
            type="button"
            onClick={() => onInput('')}
            aria-label="清空时间戳"
            className="absolute top-1/2 right-3 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-fill text-fg-2 hover:bg-fill-3 hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          options={UNIT_OPTIONS}
          value={unit}
          onChange={onUnit}
          size="sm"
          aria-label="时间戳单位"
        />
        <AnimatePresence mode="popLayout" initial={false}>
          {ok && (
            <motion.span
              key={`${ok.unit}-${ok.detected}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              <Badge color={ok.detected ? 'var(--sys-green)' : undefined}>
                {ok.detected ? '识别为' : '按'}
                {UNIT_LABEL[ok.unit]}
              </Badge>
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <ErrorNotice error={parsed && !parsed.ok ? parsed.error : null} className="mt-3" />

      {d ? (
        <>
          <div className="mt-4">
            <OutputRow label="日期时间" value={d.local} />
            <OutputRow label="ISO 8601" value={d.iso} />
            <OutputRow label="ISO（UTC）" value={d.isoUtc} hint="与 Date#toISOString() 相同" />
            <OutputRow label="RFC 2822" value={d.rfc2822} />
            <OutputRow label="HTTP 日期" value={d.httpDate} hint="UTC，用于 HTTP 头" />
            <OutputRow label="中文" value={d.chinese} mono={false} />
            <OutputRow
              label="相对时间"
              value={d.relative}
              hint={`相差 ${d.distance}`}
              mono={false}
            />
            <OutputRow
              label="星期 / 周"
              value={`${d.weekday} · 第 ${d.dayOfYear} 天（共 ${d.daysInYear} 天）· ISO 第 ${d.isoWeek.week} 周`}
              hint={`ISO 周：${d.isoWeek.year}-W${String(d.isoWeek.week).padStart(2, '0')}`}
              mono={false}
            />
            <OutputRow label="时区偏移" value={`${d.offset}（${tz}）`} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <ValueTile label="秒" value={d.seconds} />
            <ValueTile label="毫秒" value={d.millis} />
            <ValueTile label="微秒" value={d.micros} />
            <ValueTile label="纳秒" value={d.nanos} />
          </div>
        </>
      ) : (
        !parsed && (
          <p className="mt-6 text-center text-[13px] text-fg-3">
            支持秒、毫秒、微秒、纳秒，自动按位数识别；可带负号与小数
          </p>
        )
      )}
    </Panel>
  )
}
