import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import { METHOD_COLORS, isHttpMethod } from '@/lib/api-client'

export function methodColor(method: string): string {
  return isHttpMethod(method) ? METHOD_COLORS[method] : 'var(--fg-2)'
}

/**
 * 系统色做文字时的写法：浅色模式下往前景色里混一些（白底上 #34c759 这类亮色对比度不够），
 * 深色模式直接用系统色。配合 toneStyle(color) 设置 --tone 使用。
 */
export const TONE_TEXT =
  'text-[color-mix(in_srgb,var(--tone)_68%,var(--fg))] dark:text-[var(--tone)]'

export function toneStyle(color: string, background?: number): CSSProperties {
  return {
    '--tone': color,
    ...(background
      ? { background: `color-mix(in srgb, ${color} ${background}%, transparent)` }
      : {}),
  } as CSSProperties
}

/** Postman 风格的方法标签：GET 绿、POST 橙、PUT 蓝、PATCH 紫、DELETE 红… */
export function MethodBadge({
  method,
  className,
  variant = 'text',
}: {
  method: string
  className?: string
  /** text：只有彩色文字；pill：带浅色底的胶囊 */
  variant?: 'text' | 'pill'
}) {
  const color = methodColor(method)
  const short = method === 'DELETE' ? 'DEL' : method === 'OPTIONS' ? 'OPT' : method
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-mono text-[11px] font-bold tracking-tight',
        TONE_TEXT,
        variant === 'pill' && 'rounded-full px-2 py-0.5',
        className,
      )}
      style={toneStyle(color, variant === 'pill' ? 14 : undefined)}
      title={method}
    >
      {variant === 'pill' ? method : short}
    </span>
  )
}
