import { AnimatePresence, motion } from 'motion/react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'

const LABEL = { system: '跟随系统', light: '浅色', dark: '深色' } as const

/** 点击在 跟随系统 → 浅色 → 深色 间循环，图标旋转切换 */
export function ThemeToggle() {
  const { pref, setPref } = useTheme()
  const next = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system'
  const Icon = pref === 'system' ? Monitor : pref === 'light' ? Sun : Moon
  return (
    <button
      type="button"
      onClick={() => setPref(next)}
      title={`外观：${LABEL[pref]}（点击切换为${LABEL[next]}）`}
      aria-label={`外观：${LABEL[pref]}`}
      className="relative flex size-8 items-center justify-center rounded-full text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={pref}
          initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28 }}
          className="flex"
        >
          <Icon className="size-[17px]" />
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
