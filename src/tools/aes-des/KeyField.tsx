import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Dices, Eye, EyeOff } from 'lucide-react'
import { Input, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { ByteEncoding } from '@/lib/hash-bytes'

export interface LengthStatus {
  tone: 'ok' | 'bad' | 'idle'
  text: string
  /** 悬停时显示的完整说明 */
  title?: string
}

interface Props {
  label: ReactNode
  value: string
  onChange: (v: string) => void
  encoding?: ByteEncoding
  onEncoding?: (e: ByteEncoding) => void
  onRandom?: () => void
  randomLabel?: string
  status?: LengthStatus
  invalid?: boolean
  placeholder?: string
  /** 口令类输入：默认遮挡，可切换显示 */
  secret?: boolean
  /** 标签右侧额外控件（放在编码切换之前） */
  extra?: ReactNode
  hint?: ReactNode
  className?: string
}

const ENCODINGS = [
  { value: 'utf8', label: 'UTF-8' },
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
] as const

/** 密钥 / IV / 口令输入：编码切换、随机生成、长度徽标 */
export function KeyField({
  label,
  value,
  onChange,
  encoding,
  onEncoding,
  onRandom,
  randomLabel = '随机生成',
  status,
  invalid,
  placeholder,
  secret,
  extra,
  hint,
  className,
}: Props) {
  const [reveal, setReveal] = useState(false)
  const inputLabel = typeof label === 'string' ? label : undefined
  // 输入框右侧叠放的徽标与按钮宽度随文字变化（如「32 字节 · AES-256」），
  // 按实测宽度留出右内边距，文字不会钻到半透明徽标底下
  const overlayRef = useRef<HTMLDivElement>(null)
  const [overlayWidth, setOverlayWidth] = useState(0)
  useLayoutEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const measure = () => setOverlayWidth(el.offsetWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {/* 标签行：控件放不下时整体换到下一行靠右，而不是把标签挤成竖排 */}
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <span className="text-xs font-semibold tracking-wide whitespace-nowrap text-fg-2">
          {label}
        </span>
        {(extra || (encoding && onEncoding)) && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            {extra}
            {encoding && onEncoding && (
              <SegmentedControl
                size="sm"
                aria-label={`${inputLabel ?? ''}编码`}
                value={encoding}
                onChange={onEncoding}
                options={ENCODINGS}
              />
            )}
          </div>
        )}
      </div>
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          mono
          type={secret && !reveal ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-label={inputLabel}
          aria-invalid={invalid}
          // 叠层距右边 6px，再留 6px 间隙
          style={overlayWidth ? { paddingRight: overlayWidth + 12 } : undefined}
          className={cn(invalid && 'border-danger/60! focus:border-danger! focus:ring-danger/15!')}
        />
        <div ref={overlayRef} className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
          <AnimatePresence mode="popLayout" initial={false}>
            {status && status.text && (
              <motion.span
                key={`${status.tone}:${status.text}`}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ type: 'spring', stiffness: 520, damping: 30 }}
                title={status.title}
                className={cn(
                  'mr-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums',
                  status.tone === 'ok' && 'bg-success/12 text-success',
                  status.tone === 'bad' && 'bg-danger/10 text-danger',
                  status.tone === 'idle' && 'bg-fill text-fg-2',
                )}
              >
                {status.text}
              </motion.span>
            )}
          </AnimatePresence>
          {secret && (
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? '隐藏口令' : '显示口令'}
              title={reveal ? '隐藏' : '显示'}
              className="inline-flex size-7 items-center justify-center rounded-full text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg"
            >
              {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          )}
          {onRandom && (
            <motion.button
              type="button"
              onClick={onRandom}
              title={randomLabel}
              aria-label={randomLabel}
              whileTap={{ rotate: 90, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
              className="inline-flex size-7 items-center justify-center rounded-full text-fg-2 transition-colors hover:bg-fill-2 hover:text-accent"
            >
              <Dices className="size-4" />
            </motion.button>
          )}
        </div>
      </div>
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
    </div>
  )
}
