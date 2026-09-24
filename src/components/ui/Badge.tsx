import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Badge({
  children,
  color,
  className,
}: {
  children: ReactNode
  /** CSS 颜色，缺省为强调色 */
  color?: string
  className?: string
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', className)}
      style={{
        color: color ?? 'var(--accent)',
        background: `color-mix(in srgb, ${color ?? 'var(--accent)'} 14%, transparent)`,
      }}
    >
      {children}
    </span>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-surface px-1 font-sans text-[11px] font-medium text-fg-2 shadow-[0_1px_0_var(--line)]',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
