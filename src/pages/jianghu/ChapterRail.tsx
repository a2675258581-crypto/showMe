import { motion } from 'motion/react'
import { cn } from '@/lib/cn'

export interface RailItem {
  id: string
  /** 轨道上显示的一个字 */
  label: string
  /** 悬停提示的全名 */
  title: string
}

/** 右侧章节轨道（桌面端）：当前幕套一个朱砂圈，点击平滑滚到那一幕 */
export function ChapterRail({
  items,
  activeId,
  onSelect,
}: {
  items: RailItem[]
  activeId: string
  onSelect: (id: string) => void
}) {
  return (
    <nav
      aria-label="章节"
      className="fixed top-1/2 right-4 z-40 hidden -translate-y-1/2 flex-col items-center gap-0.5 lg:flex"
    >
      {items.map((it) => {
        const active = it.id === activeId
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onSelect(it.id)}
            title={it.title}
            aria-label={it.title}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'jh-song relative flex size-8 items-center justify-center rounded-full text-[12px] transition-colors duration-500',
              active ? 'text-(--jh-fg)' : 'text-(--jh-fg-3) hover:text-(--jh-fg-2)',
            )}
          >
            {active && (
              <motion.span
                layoutId="jh-rail-ring"
                aria-hidden
                className="absolute inset-0 rounded-full border border-(--jh-seal)"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative">{it.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
