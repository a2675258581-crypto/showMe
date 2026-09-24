import { useId, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  /** 右上角小徽标（如数量） */
  badge?: ReactNode
}

/** 下划线式标签页，指示条弹簧滑动 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: readonly TabItem<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  const id = useId()
  return (
    <div
      role="tablist"
      className={cn('no-scrollbar flex gap-1 overflow-x-auto border-b border-line', className)}
    >
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              'relative inline-flex h-10 items-center gap-1.5 px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
              active ? 'text-fg' : 'text-fg-2 hover:text-fg',
            )}
          >
            {it.label}
            {it.badge !== undefined && it.badge !== null && it.badge !== 0 && (
              <span className="rounded-full bg-fill px-1.5 text-[11px] leading-4 text-fg-2">
                {it.badge}
              </span>
            )}
            {active && (
              <motion.span
                layoutId={`tab-${id}`}
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
