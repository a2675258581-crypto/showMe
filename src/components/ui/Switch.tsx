import { useId, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'

interface Props {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  disabled?: boolean
  className?: string
}

/** iOS 开关 */
export function Switch({ checked, onChange, label, disabled, className }: Props) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex cursor-pointer select-none items-center gap-2.5 text-sm text-fg',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full p-[2px] transition-colors duration-300',
          checked ? 'bg-sys-green justify-end' : 'bg-fill-3 justify-start',
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 700, damping: 35 }}
          className="block h-[22px] w-[22px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.2)]"
        />
      </button>
      {label}
    </label>
  )
}
