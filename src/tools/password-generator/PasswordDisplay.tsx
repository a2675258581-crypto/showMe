import { motion } from 'motion/react'
import { classifyChar, graphemes } from '@/lib/password-generator'
import { cn } from '@/lib/cn'

/** 数字蓝、符号粉，字母保持正文色 */
export function charColor(ch: string): string {
  const k = classifyChar(ch)
  if (k === 'digit') return 'text-sys-blue'
  if (k === 'symbol') return 'text-sys-pink'
  return 'text-fg'
}

function sizeFor(len: number): string {
  if (len <= 20) return 'text-[26px] sm:text-4xl'
  if (len <= 36) return 'text-2xl sm:text-3xl'
  if (len <= 64) return 'text-xl sm:text-2xl'
  return 'text-base sm:text-lg'
}

/**
 * 大号等宽密码展示，按字符类着色。
 * 字符按下标作 key：「重新生成」时整体换 key 让每个字符依次模糊淡入；
 * 仅调整长度时已有字符原地替换，新增的字符单独淡入，拖动滑块不会闪。
 */
export function PasswordDisplay({
  value,
  generation,
  className,
}: {
  value: string
  generation: number
  className?: string
}) {
  const chars = graphemes(value)
  return (
    <div
      className={cn(
        'font-mono leading-snug font-medium tracking-wide break-all select-all',
        sizeFor(chars.length),
        className,
      )}
      aria-label="生成的密码"
      aria-live="polite"
    >
      {chars.map((c, i) => (
        <motion.span
          key={`${generation}-${i}`}
          initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{
            duration: 0.28,
            delay: Math.min(i, 48) * 0.008,
            ease: [0.28, 0.11, 0.32, 1],
          }}
          className={cn('inline-block whitespace-pre', charColor(c))}
        >
          {c}
        </motion.span>
      ))}
    </div>
  )
}

/** 列表里的小号着色密码（无动画） */
export function ColoredText({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn('font-mono break-all', className)}>
      {graphemes(value).map((c, i) => (
        <span key={i} className={charColor(c)}>
          {c}
        </span>
      ))}
    </span>
  )
}
