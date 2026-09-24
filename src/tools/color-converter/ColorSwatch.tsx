import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import type { RGBA } from '@/lib/color-converter'

/** 透明度棋盘格底纹（用设计 token，深浅色都协调） */
export const CHECKER =
  'repeating-conic-gradient(var(--fill-3) 0% 25%, var(--surface) 0% 50%) 50% / 18px 18px'

export const EASE_APPLE = [0.28, 0.11, 0.32, 1] as const

export function rgbaCss(c: RGBA): string {
  const ch = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  return `rgba(${ch(c.r)}, ${ch(c.g)}, ${ch(c.b)}, ${Math.round(c.alpha * 1000) / 1000})`
}

/** 带棋盘格底的色块，颜色变化时平滑过渡 */
export function ColorSwatch({
  color,
  className,
  children,
  textColor,
}: {
  color: RGBA
  className?: string
  children?: ReactNode
  textColor?: string
}) {
  return (
    <div className={cn('relative overflow-hidden', className)} style={{ background: CHECKER }}>
      <motion.div
        aria-hidden
        className="absolute inset-0"
        initial={false}
        animate={{ backgroundColor: rgbaCss(color) }}
        transition={{ duration: 0.5, ease: EASE_APPLE }}
      />
      {children && (
        <motion.div
          className="relative h-full"
          initial={false}
          animate={{ color: textColor }}
          transition={{ duration: 0.5, ease: EASE_APPLE }}
        >
          {children}
        </motion.div>
      )}
      {/* 描边放在最上层：容器自身的内阴影会被上面的色块盖住，白色等浅色时就看不出边界 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-line ring-inset"
      />
    </div>
  )
}
