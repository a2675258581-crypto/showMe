import { useId, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  title?: string
}

interface Props<T extends string> {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
  /** 撑满父容器宽度，选项等分 */
  block?: boolean
  disabled?: boolean
  'aria-label'?: string
}

/** iOS 风格分段控件，选中块以弹簧动画滑动 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
  block,
  disabled,
  ...aria
}: Props<T>) {
  const id = useId()
  return (
    <div
      role="radiogroup"
      aria-label={aria['aria-label']}
      aria-disabled={disabled || undefined}
      className={cn(
        // sm 总高 32px，与 Button size="sm" 对齐
        'relative inline-flex rounded-full bg-fill',
        size === 'sm' ? 'p-0.5' : 'p-[3px]',
        block && 'flex w-full',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative z-0 inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors duration-200',
              '[&_svg]:size-3.5',
              size === 'sm' ? 'h-7 px-3 text-xs' : 'h-8 px-4 text-[13px]',
              block && 'flex-1',
              active ? 'text-fg' : 'text-fg-2 hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-full bg-surface shadow-[0_1px_4px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)] dark:bg-fill-3"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
