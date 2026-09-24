import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

interface Props<T extends string> {
  algos: readonly { id: T; label: string }[]
  selected: readonly T[]
  onChange: (next: T[]) => void
  presets?: readonly { label: string; ids: readonly T[] }[]
}

/** 算法多选胶囊，至少保留一个 */
export function AlgoPicker<T extends string>({ algos, selected, onChange, presets }: Props<T>) {
  const set = new Set(selected)
  const toggle = (id: T) => {
    if (set.has(id)) {
      if (set.size > 1) onChange(algos.filter((a) => a.id !== id && set.has(a.id)).map((a) => a.id))
    } else onChange(algos.filter((a) => a.id === id || set.has(a.id)).map((a) => a.id))
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {algos.map((a) => {
          const on = set.has(a.id)
          return (
            <motion.button
              key={a.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(a.id)}
              whileTap={{ scale: 0.94 }}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors duration-200',
                on
                  ? 'border-accent/40 bg-accent-soft text-accent'
                  : 'border-line bg-surface text-fg-2 hover:bg-fill-2 hover:text-fg',
              )}
            >
              <motion.span
                initial={false}
                animate={{ width: on ? 14 : 0, opacity: on ? 1 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                className="inline-flex overflow-hidden"
              >
                <Check className="size-3.5 shrink-0" />
              </motion.span>
              {a.label}
            </motion.button>
          )
        })}
      </div>
      {presets && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-3">
          <span>快速选择：</span>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(algos.filter((a) => p.ids.includes(a.id)).map((a) => a.id))}
              className="rounded-full px-2 py-1 font-medium text-accent transition-colors hover:bg-accent-soft"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
