import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** 白色大圆角卡片容器 */
export function Panel({
  className,
  children,
  padded = true,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { padded?: boolean; children?: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-3xl border border-line bg-surface shadow-card',
        padded && 'p-5 sm:p-6',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

/** 卡片内的小标题行 */
export function PanelHeader({
  title,
  children,
  className,
}: {
  title: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-center justify-between gap-3', className)}>
      <h3 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h3>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}
