import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'

type Tone = 'error' | 'warning' | 'info' | 'success'

const tones: Record<Tone, { cls: string; icon: ReactNode }> = {
  error: { cls: 'bg-danger/8 text-danger border-danger/20', icon: <CircleAlert /> },
  warning: { cls: 'bg-warning/8 text-warning border-warning/20', icon: <TriangleAlert /> },
  info: { cls: 'bg-accent-soft text-accent border-accent/20', icon: <Info /> },
  success: { cls: 'bg-success/8 text-success border-success/20', icon: <CircleCheck /> },
}

/** 提示条：出现时轻微抖动（错误）或淡入 */
export function Notice({
  tone = 'error',
  children,
  className,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  const t = tones[tone]
  return (
    <motion.div
      role={tone === 'error' ? 'alert' : 'status'}
      initial={{ opacity: 0, y: -6 }}
      animate={
        tone === 'error' ? { opacity: 1, y: 0, x: [0, -6, 6, -4, 4, 0] } : { opacity: 1, y: 0 }
      }
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.4 }}
      className={cn(
        'flex items-start gap-2 rounded-2xl border px-4 py-3 text-[13px] leading-relaxed [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
        t.cls,
        className,
      )}
    >
      {t.icon}
      <div className="min-w-0 flex-1 break-words whitespace-pre-wrap">{children}</div>
    </motion.div>
  )
}

/** 有内容时才显示的错误提示 */
export function ErrorNotice({ error, className }: { error?: string | null; className?: string }) {
  return (
    <AnimatePresence>
      {error ? (
        // 固定 key：错误文字变化时原地更新，避免新旧两条同时出现
        <Notice key="error" tone="error" className={className}>
          {error}
        </Notice>
      ) : null}
    </AnimatePresence>
  )
}
