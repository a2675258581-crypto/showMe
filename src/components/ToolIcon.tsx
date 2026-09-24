import { CATEGORY_MAP } from '@/tools/categories'
import type { ToolMeta } from '@/tools/types'
import { cn } from '@/lib/cn'

const SIZES = {
  sm: 'size-8 rounded-[9px] [&_svg]:size-4',
  md: 'size-11 rounded-[12px] [&_svg]:size-5',
  lg: 'size-14 rounded-[16px] [&_svg]:size-7',
  xl: 'size-20 rounded-[22px] [&_svg]:size-10',
}

/** 仿 App 图标的渐变圆角方块 */
export function ToolIcon({ tool, size = 'md', className }: { tool: ToolMeta; size?: keyof typeof SIZES; className?: string }) {
  const cat = CATEGORY_MAP[tool.category]
  const Icon = tool.icon
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_6px_16px_-6px_var(--glow)]',
        SIZES[size],
        className,
      )}
      style={
        {
          background: `linear-gradient(145deg, ${cat.gradient[0]}, ${cat.gradient[1]})`,
          '--glow': cat.gradient[0],
        } as React.CSSProperties
      }
    >
      <Icon strokeWidth={2.2} />
    </span>
  )
}
