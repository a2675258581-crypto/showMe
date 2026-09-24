import { AnimatePresence, motion } from 'motion/react'
import { CircleCheck } from 'lucide-react'
import { CopyButton } from '@/components/ui'
import { cn } from '@/lib/cn'

export interface DigestItem {
  id: string
  label: string
  bits: number
  note?: string
  /** 仅作校验、不适合安全用途 */
  weak?: boolean
  value: string | null
}

interface Props {
  items: readonly DigestItem[]
  /** 与校验值一致的项 */
  matched?: ReadonlySet<string>
  /** 计算中：显示骨架 */
  pending?: boolean
  /** 输入已变、新结果还没算出：旧值变淡 */
  stale?: boolean
  placeholder?: string
  className?: string
}

/** 摘要结果列表：每行「算法 · 值 · 复制」，与校验值匹配的行高亮 */
export function DigestList({
  items,
  matched,
  pending,
  stale,
  placeholder = '—',
  className,
}: Props) {
  const hasMatch = !!matched && matched.size > 0
  return (
    <ul
      className={cn(
        'overflow-hidden rounded-3xl border border-line bg-surface shadow-card',
        className,
      )}
    >
      {items.map((it, i) => {
        const hit = !!matched?.has(it.id)
        return (
          <motion.li
            key={it.id}
            layout="position"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: hasMatch && !hit ? 0.45 : 1, y: 0 }}
            transition={{ duration: 0.35, delay: Math.min(i, 12) * 0.02 }}
            className={cn(
              'relative flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:flex-nowrap sm:px-5',
              i > 0 && 'border-t border-line',
            )}
          >
            <AnimatePresence>
              {hit && (
                <motion.span
                  aria-hidden
                  initial={{ opacity: 0, scaleX: 0.92 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  className="pointer-events-none absolute inset-0 origin-left bg-success/10"
                />
              )}
            </AnimatePresence>

            <div className="relative flex min-w-0 flex-1 items-center gap-2 sm:w-44 sm:flex-none">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn('text-[13px] font-semibold', hit ? 'text-success' : 'text-fg')}
                  >
                    {it.label}
                  </span>
                  <span className="text-[11px] text-fg-3 tabular-nums">{it.bits} 位</span>
                  <AnimatePresence>
                    {hit && (
                      <motion.span
                        initial={{ scale: 0, rotate: -45 }}
                        animate={{ scale: 1, rotate: 0 }}
                        exit={{ scale: 0 }}
                        transition={{ type: 'spring', stiffness: 600, damping: 20 }}
                        className="inline-flex text-success"
                      >
                        <CircleCheck className="size-4" aria-label="匹配" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                {it.note && (
                  <div className="truncate text-[11px] text-fg-3" title={it.note}>
                    {it.note}
                  </div>
                )}
              </div>
            </div>

            <CopyButton
              text={it.value ?? ''}
              iconOnly
              variant="ghost"
              disabled={!it.value}
              label={`复制 ${it.label}`}
              className="relative sm:order-last"
            />

            <div className="relative w-full min-w-0 font-mono text-[13px] leading-relaxed break-all text-fg sm:w-auto sm:flex-1">
              {pending ? (
                <span className="block h-4 w-full max-w-md animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--fill)_25%,var(--fill-3)_50%,var(--fill)_75%)] bg-[length:200%_100%]" />
              ) : it.value ? (
                <span
                  className={cn(
                    'select-all transition-opacity duration-200',
                    hit && 'text-success',
                    stale && 'opacity-50',
                  )}
                >
                  {it.value}
                </span>
              ) : (
                <span className="text-fg-3">{placeholder}</span>
              )}
            </div>
          </motion.li>
        )
      })}
    </ul>
  )
}
