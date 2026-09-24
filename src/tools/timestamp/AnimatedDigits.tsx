import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/cn'

/** 数字滚动：只有发生变化的那一位会从下方滑入 */
export function AnimatedDigits({ value, className }: { value: string; className?: string }) {
  const chars = value.split('')
  return (
    <span className={cn('inline-flex tabular-nums', className)}>
      <span className="sr-only">{value}</span>
      {chars.map((ch, i) => (
        // 从右往左编号，位数变化时低位保持稳定
        <Digit key={chars.length - i} ch={ch} />
      ))}
    </span>
  )
}

function Digit({ ch }: { ch: string }) {
  return (
    <span aria-hidden className="relative inline-flex overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={ch}
          initial={{ y: '70%', opacity: 0, filter: 'blur(4px)' }}
          animate={{ y: '0%', opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: '-70%', opacity: 0, filter: 'blur(4px)' }}
          transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
          className="inline-block"
        >
          {ch}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
