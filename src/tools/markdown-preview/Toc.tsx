import { motion } from 'motion/react'
import { ListTree } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { TocItem } from '@/lib/markdown-preview'

/** 目录大纲：缩进按标题级别，当前阅读位置高亮 */
export function Toc({
  items,
  active,
  onPick,
}: {
  items: TocItem[]
  active: number
  onPick: (index: number) => void
}) {
  const min = items.length ? Math.min(...items.map((t) => t.level)) : 1
  return (
    <nav aria-label="目录" className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13px] font-semibold text-fg">
        <ListTree className="size-4 text-accent" />
        目录
        <span className="ml-auto text-[11px] font-normal text-fg-3">{items.length} 个标题</span>
      </div>
      {items.length ? (
        <ol className="thin-scrollbar min-h-0 flex-1 overflow-auto p-2" data-lenis-prevent>
          {items.map((t, i) => (
            <li key={`${t.id}-${i}`} className="relative">
              {active === i && (
                <motion.span
                  layoutId="md-toc-active"
                  className="absolute inset-0 rounded-lg bg-accent-soft"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
              <button
                type="button"
                onClick={() => onPick(i)}
                className={cn(
                  'relative block w-full truncate rounded-lg py-1.5 pr-2 text-left text-[13px] transition-colors',
                  active === i ? 'font-medium text-accent' : 'text-fg-2 hover:text-fg',
                  t.level === min && 'font-medium',
                )}
                style={{ paddingLeft: 10 + (t.level - min) * 14 }}
                title={t.text}
              >
                {t.text || '（空标题）'}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-4 py-8 text-center text-xs leading-relaxed text-fg-3">
          还没有标题
          <br />用 # 开头的行会出现在这里
        </p>
      )}
    </nav>
  )
}
