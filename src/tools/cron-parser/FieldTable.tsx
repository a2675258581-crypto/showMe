import { motion } from 'motion/react'
import { TableProperties } from 'lucide-react'
import { Panel, PanelHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { FIELD_SPECS, type FieldExplanation, type FieldKey } from '@/lib/cron-parser'
import { valueLabel } from './Builder'

const PREVIEW = 12

function valuesText(f: FieldExplanation): string {
  if (f.wildcard) {
    const spec = FIELD_SPECS[f.key]
    const total = f.key === 'dayOfWeek' ? 7 : spec.max - spec.min + 1
    return `全部 ${total} 个`
  }
  const shown = f.values.slice(0, PREVIEW).map((v) => {
    if (typeof v === 'string') return v
    return f.key === 'dayOfWeek' || f.key === 'month' ? valueLabel(f.key, v) : String(v)
  })
  return shown.join('、') + (f.values.length > PREVIEW ? ` … 共 ${f.values.length} 个` : '')
}

interface Props {
  fields: FieldExplanation[] | null
  hovered: FieldKey | null
  onHover: (k: FieldKey | null) => void
  /** 没有结果时的提示（空输入与出错时不同） */
  emptyText?: string
}

/** 字段拆解表 */
export function FieldTable({
  fields,
  hovered,
  onHover,
  emptyText = '表达式有误，暂无法拆解',
}: Props) {
  return (
    <Panel className="min-w-0">
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <TableProperties className="size-4 text-accent" />
            字段拆解
          </span>
        }
      />
      {!fields ? (
        <p className="py-10 text-center text-[13px] text-fg-3">{emptyText}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {fields.map((f, i) => {
            const spec = FIELD_SPECS[f.key]
            return (
              <motion.div
                key={f.key}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: f.implicit ? 0.55 : 1, x: 0 }}
                transition={{ delay: i * 0.03, type: 'spring', stiffness: 400, damping: 32 }}
                onMouseEnter={() => onHover(f.key)}
                onMouseLeave={() => onHover(null)}
                className={cn(
                  'grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-3 rounded-2xl px-3 py-2.5 transition-colors',
                  hovered === f.key ? 'bg-accent-soft' : 'bg-fill-2',
                )}
              >
                <div>
                  <div className="text-sm font-semibold text-fg">{spec.name}</div>
                  <div className="font-mono text-[10px] text-fg-3">
                    {spec.min}–{spec.max}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[12px] text-accent ring-1 ring-line">
                      {f.raw}
                    </code>
                    <span className="text-[13px] text-fg">
                      {f.implicit ? '5 段表达式没有秒字段，固定在第 0 秒' : f.text}
                    </span>
                  </div>
                  {!f.implicit && (
                    <div className="mt-1 text-[11px] leading-relaxed break-words text-fg-3">
                      取值：{valuesText(f)}
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
