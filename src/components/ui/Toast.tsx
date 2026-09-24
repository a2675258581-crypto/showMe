import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, Info } from 'lucide-react'

type Tone = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  message: string
  tone: Tone
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {})

/** 「已复制」这类 iOS 风格的底部 HUD 提示 */
export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const show = useCallback((message: string, tone: Tone = 'success') => {
    const id = ++seq.current
    setItems((prev) => [...prev.slice(-2), { id, message, tone }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 1800)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-8 z-[100] flex flex-col items-center gap-2 px-4"
      >
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.9, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: 8, scale: 0.95, filter: 'blur(4px)' }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="glass flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm font-medium text-fg shadow-float"
            >
              {t.tone === 'success' && <CircleCheck className="size-4 text-sys-green" />}
              {t.tone === 'error' && <CircleAlert className="size-4 text-danger" />}
              {t.tone === 'info' && <Info className="size-4 text-accent" />}
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
