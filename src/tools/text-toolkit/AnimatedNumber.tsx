import { useEffect, useRef } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { cn } from '@/lib/cn'

const defaultFormat = (n: number) => Math.round(n).toLocaleString()

/** 数值变化时从旧值平滑滚动到新值（不触发 React 重渲染） */
export function AnimatedNumber({
  value,
  format = defaultFormat,
  className,
}: {
  value: number
  format?: (n: number) => string
  className?: string
}) {
  const mv = useMotionValue(value)
  const fmt = useRef(format)
  useEffect(() => {
    fmt.current = format
  })
  const text = useTransform(mv, (v) => fmt.current(v))
  const reduce = useReducedMotion()

  useEffect(() => {
    if (reduce) {
      mv.set(value)
      return
    }
    const controls = animate(mv, value, { duration: 0.6, ease: [0.16, 1, 0.3, 1] })
    return () => controls.stop()
  }, [mv, value, reduce])

  return (
    <span className={cn('tabular-nums', className)}>
      <span className="sr-only">{format(value)}</span>
      <motion.span aria-hidden>{text}</motion.span>
    </span>
  )
}
