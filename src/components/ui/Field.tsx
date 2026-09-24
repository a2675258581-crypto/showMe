import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** 表单项：小号灰色标签 + 控件 + 可选提示 */
export function Field({
  label,
  hint,
  children,
  className,
  action,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
  /** 标签右侧的小操作（如复制按钮） */
  action?: ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-fg-2">{label}</span>
        {action}
      </div>
      {children}
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
    </div>
  )
}
