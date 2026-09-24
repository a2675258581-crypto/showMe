import { AnimatePresence, motion } from 'motion/react'
import { CalendarClock, ChevronDown } from 'lucide-react'
import { Button, CopyButton, Panel, PanelHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  WEEKDAY_SHORT_ZH,
  formatDateTime,
  formatDuration,
  formatOffset,
  formatRelative,
  zonedParts,
} from '@/lib/timestamp'
import { TimezonePicker } from '@/tools/timestamp/TimezonePicker'

interface Props {
  runs: Date[] | null
  tz: string
  onTz: (tz: string) => void
  now: number
  canMore: boolean
  onMore: () => void
  /** 没有结果时的提示（空输入与出错时不同） */
  emptyText?: string
}

/** 接下来的执行时间 */
export function RunsList({
  runs,
  tz,
  onTz,
  now,
  canMore,
  onMore,
  emptyText = '修正表达式后在这里显示执行时间',
}: Props) {
  const rows = (runs ?? []).map((d) => {
    const p = zonedParts(d.getTime(), tz)
    return {
      t: d.getTime(),
      text: formatDateTime(p, 0, false),
      weekday: WEEKDAY_SHORT_ZH[p.weekday],
      offset: formatOffset(p.offsetSeconds),
    }
  })
  const copyAll = () => rows.map((r) => `${r.text} ${r.weekday} (UTC${r.offset})`).join('\n')

  return (
    <Panel className="flex min-w-0 flex-col">
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <CalendarClock className="size-4 text-accent" />
            接下来的执行时间
          </span>
        }
      >
        <CopyButton text={copyAll} label="复制" disabled={!rows.length} />
      </PanelHeader>
      <TimezonePicker value={tz} onChange={onTz} className="mb-4 max-w-full self-start" />

      {rows.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-fg-3">{emptyText}</p>
      ) : (
        <ol className="flex flex-col">
          <AnimatePresence initial={false}>
            {rows.map((r, i) => (
              <motion.li
                key={r.t}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className={cn(
                  'flex items-center gap-3 rounded-2xl px-3 py-2.5',
                  i === 0 ? 'bg-accent-soft' : i % 2 === 1 && 'bg-fill-2',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                    i === 0 ? 'bg-accent text-white' : 'bg-fill text-fg-2',
                  )}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[13px] text-fg tabular-nums">
                    {r.text}
                    <span className="ml-2 font-sans text-xs text-fg-2">{r.weekday}</span>
                  </div>
                  {i > 0 && (
                    <div className="text-[11px] text-fg-3">
                      距上次 {formatDuration(r.t - rows[i - 1].t, 2)}
                    </div>
                  )}
                </div>
                <span
                  className={cn(
                    'shrink-0 text-xs tabular-nums',
                    i === 0 ? 'font-semibold text-accent' : 'text-fg-2',
                  )}
                >
                  {formatRelative(r.t, now)}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
      {canMore && rows.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronDown />}
          onClick={onMore}
          className="mt-3 self-center"
        >
          再显示 10 次
        </Button>
      )}
    </Panel>
  )
}
