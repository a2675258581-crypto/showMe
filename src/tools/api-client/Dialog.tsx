import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** 面板宽度 */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const widths = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

/** 居中弹窗：背景虚化，弹簧缩放进入，Esc / 点击背景关闭 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: DialogProps) {
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center p-3 sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-fill-3 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className={cn(
              'relative flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-float sm:max-h-[calc(100dvh-3rem)]',
              widths[size],
              className,
            )}
            data-lenis-prevent
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-[15px] font-semibold tracking-tight text-fg">
                  {title}
                </h2>
                {description && <p className="mt-0.5 text-xs text-fg-2">{description}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="-mt-1 -mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
            {footer && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
