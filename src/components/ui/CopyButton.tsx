import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy } from 'lucide-react'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { useToast } from './Toast'

interface Props {
  /** 要复制的文本，或返回文本的函数 */
  text: string | (() => string)
  label?: string
  size?: 'sm' | 'md'
  variant?: 'secondary' | 'ghost' | 'primary'
  className?: string
  iconOnly?: boolean
  disabled?: boolean
}

/** 复制按钮：图标切换成对勾 + HUD 提示 */
export function CopyButton({
  text,
  label = '复制',
  size = 'sm',
  variant = 'secondary',
  className,
  iconOnly,
  disabled,
}: Props) {
  const [done, setDone] = useState(false)
  const toast = useToast()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const onClick = async () => {
    const value = typeof text === 'function' ? text() : text
    if (!value) return
    const ok = await copyText(value)
    toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error')
    if (ok) {
      setDone(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setDone(false), 1500)
    }
  }

  const styles = {
    primary: 'bg-accent text-white hover:bg-accent-hover',
    secondary: 'bg-fill text-fg hover:bg-fill-3',
    ghost: 'text-fg-2 hover:text-fg hover:bg-fill-2',
  }[variant]

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium transition-[background-color,transform] duration-200 active:scale-95 disabled:opacity-40',
        size === 'sm' ? 'h-8 text-[13px]' : 'h-10 text-sm',
        iconOnly ? (size === 'sm' ? 'w-8' : 'w-10') : size === 'sm' ? 'px-3' : 'px-4',
        styles,
        className,
      )}
    >
      <span className="relative inline-flex size-4 items-center justify-center">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={done ? 'done' : 'copy'}
            initial={{ scale: 0.3, opacity: 0, rotate: -30 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.3, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 25 }}
            className="absolute inset-0 inline-flex items-center justify-center"
          >
            {done ? <Check className="size-4 text-sys-green" /> : <Copy className="size-4" />}
          </motion.span>
        </AnimatePresence>
      </span>
      {!iconOnly && (done ? '已复制' : label)}
    </button>
  )
}
