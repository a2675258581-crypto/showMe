import { useMemo } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { Badge, ErrorNotice, Input, Notice, Panel, PanelHeader } from '@/components/ui'
import {
  WEEKDAY_ZH,
  formatDateTime,
  formatISOUtc,
  formatOffset,
  instantToUnit,
  parseDateInput,
  pad,
  zonedParts,
} from '@/lib/timestamp'
import { OutputRow, ValueTile } from './OutputRow'
import { useNow } from './useNow'

const QUICK: { label: string; value: string }[] = [
  { label: '现在', value: 'now' },
  { label: '今天 0 点', value: 'today' },
  { label: '明天 0 点', value: 'tomorrow' },
  { label: '1 小时后', value: '+1h' },
  { label: '1 天后', value: '+1d' },
  { label: '7 天前', value: '-7d' },
  { label: '1 个月后', value: '+1M' },
]

interface Props {
  input: string
  onInput: (v: string) => void
  tz: string
}

/** 日期 → 时间戳 */
export function DateToTs({ input, onInput, tz }: Props) {
  const now = useNow(1000)
  const parsed = useMemo(
    () => (input.trim() ? parseDateInput(input, tz, now) : null),
    [input, tz, now],
  )
  const ok = parsed?.ok ? parsed.value : null
  const zoned = ok ? zonedParts(ok.instant.epochMs, tz) : null
  const pickerValue = zoned
    ? zoned.year >= 1 && zoned.year <= 9999
      ? `${pad(zoned.year, 4)}-${pad(zoned.month)}-${pad(zoned.day)}T${pad(zoned.hour)}:${pad(zoned.minute)}:${pad(zoned.second)}`
      : ''
    : ''

  return (
    <Panel className="flex min-w-0 flex-col">
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <CalendarDays className="size-4 text-accent" />
            日期 → 时间戳
          </span>
        }
      />

      <div className="relative">
        <Input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          placeholder="2024-01-01 12:00:00、ISO、RFC 2822、now、+1d、3天前…"
          mono
          className="h-12 pr-10 text-base"
          aria-label="日期时间"
        />
        {input && (
          <button
            type="button"
            onClick={() => onInput('')}
            aria-label="清空日期"
            className="absolute top-1/2 right-3 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-fill text-fg-2 hover:bg-fill-3 hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 items-center gap-2 rounded-full bg-fill pr-1 pl-3 text-xs font-medium text-fg-2">
          选择
          <input
            type="datetime-local"
            step={1}
            value={pickerValue}
            onChange={(e) => e.target.value && onInput(e.target.value.replace('T', ' '))}
            aria-label="用日期选择器选择时间"
            className="h-7 min-w-0 rounded-full bg-surface px-2 font-mono text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        {QUICK.map((q) => (
          <button
            key={q.value}
            type="button"
            onClick={() => onInput(q.value)}
            className={
              input.trim() === q.value
                ? 'h-8 rounded-full bg-accent-soft px-3 text-xs font-medium text-accent'
                : 'h-8 rounded-full bg-fill px-3 text-xs font-medium text-fg-2 transition-colors hover:bg-fill-3 hover:text-fg'
            }
          >
            {q.label}
          </button>
        ))}
      </div>

      <ErrorNotice error={parsed && !parsed.ok ? parsed.error : null} className="mt-3" />

      {ok && zoned && (
        <>
          <div className="mt-4 rounded-2xl bg-fill-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-fg-3">
              解析为
              <Badge>{ok.format}</Badge>
              <Badge color={ok.zoneFromInput ? 'var(--sys-green)' : 'var(--sys-indigo)'}>
                {ok.zoneFromInput ? '使用输入中的时区' : `按 ${tz} 解析`}
              </Badge>
            </div>
            <div className="mt-1.5 font-mono text-[15px] text-fg tabular-nums">
              {formatDateTime(zoned, ok.instant.subMsNs)}
              <span className="ml-2 font-sans text-[13px] text-fg-2">
                {WEEKDAY_ZH[zoned.weekday]} · UTC{formatOffset(zoned.offsetSeconds)}
              </span>
            </div>
          </div>
          {ok.kind !== 'exact' && (
            <Notice tone="warning" className="mt-3">
              {ok.kind === 'gap'
                ? '该时刻因夏令时跳变在此时区不存在，已顺延到跳变之后的对应时刻。'
                : '该时刻因夏令时回拨在此时区出现两次，已取较早的一次。'}
            </Notice>
          )}
          <div className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <ValueTile label="秒" value={instantToUnit(ok.instant, 's')} />
            <ValueTile label="毫秒" value={instantToUnit(ok.instant, 'ms')} />
            <ValueTile label="微秒" value={instantToUnit(ok.instant, 'us')} />
            <ValueTile label="纳秒" value={instantToUnit(ok.instant, 'ns')} />
          </div>
          <div className="mt-3">
            <OutputRow label="ISO（UTC）" value={formatISOUtc(ok.instant.epochMs)} />
          </div>
        </>
      )}
      {!parsed && (
        <p className="mt-6 text-center text-[13px] text-fg-3">
          没有写时区的输入按所选时区解析；也可以写 +08:00、Z、GMT+8
        </p>
      )}
    </Panel>
  )
}
