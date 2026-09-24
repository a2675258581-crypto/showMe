import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Badge, CopyButton } from '@/components/ui'
import type { AddrTag } from '@/lib/cidr-calculator'
import { cn } from '@/lib/cn'

/** 结果小卡片：标签 + 等宽值 + 复制 */
export function StatCard({
  label,
  value,
  sub,
  copy,
  emphasis,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  /** 复制内容，缺省为 value 的文本 */
  copy?: string
  emphasis?: boolean
  className?: string
}) {
  const text = copy ?? (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
  return (
    <motion.div
      layout="position"
      className={cn(
        'group flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-surface p-4 shadow-card',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg-2">{label}</span>
        {text && (
          <CopyButton
            text={text}
            iconOnly
            variant="ghost"
            label={`复制${label}`}
            className="-my-1.5 -mr-1.5"
          />
        )}
      </div>
      <div
        className={cn(
          'font-mono break-all text-fg tabular-nums',
          emphasis ? 'text-lg font-semibold sm:text-xl' : 'text-[15px]',
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-fg-3">{sub}</div>}
    </motion.div>
  )
}

export function TagBadges({ tags }: { tags: AddrTag[] }) {
  return (
    <>
      {tags.map((t) => (
        <span key={t.id + t.label} title={t.desc}>
          <Badge color={t.color} className="text-xs">
            {t.label}
          </Badge>
        </span>
      ))}
    </>
  )
}

/** 网络位 / 主机位图例 */
export function BitLegend({ extra }: { extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-3">
      <span className="inline-flex items-center gap-1.5">
        <i className="size-2 rounded-full bg-accent" />
        网络位
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i className="size-2 rounded-full bg-sys-orange" />
        主机位
      </span>
      {extra}
    </div>
  )
}
