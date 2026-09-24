import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useInView } from 'motion/react'
import { usePalette } from '@/components/CommandPalette'
import { Reveal } from '@/components/motion/Reveal'
import { isMac } from '@/hooks/useHotkey'
import { cn } from '@/lib/cn'

/** 快捷键板块：两颗 3D 键帽依次按下，点击即可打开搜索 */
export function Keyboard() {
  const palette = usePalette()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.6 })
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!inView) return
    const seq = [1, 2, 0, 0]
    let k = 0
    const t = setInterval(() => {
      setStep(seq[k % seq.length])
      k++
    }, 650)
    return () => clearInterval(t)
  }, [inView])

  return (
    <section className="mx-auto max-w-[1080px] px-6 py-28 text-center">
      <Reveal>
        <h2 className="headline text-[40px] text-fg sm:text-[64px]">键盘党，也照顾到了。</h2>
        <p className="mx-auto mt-4 max-w-xl text-[19px] text-fg-2 sm:text-[21px]">
          随时按下 {isMac ? '⌘' : 'Ctrl'} K 或 /，像 Spotlight 一样秒开任何工具。
        </p>
      </Reveal>
      <div ref={ref} className="mt-14 flex items-center justify-center gap-5">
        <Key
          label={isMac ? '⌘' : 'Ctrl'}
          sub={isMac ? 'command' : ''}
          pressed={step >= 1}
          wide={!isMac}
          onClick={palette.open}
        />
        <span className="text-3xl font-light text-fg-3">+</span>
        <Key label="K" pressed={step >= 2} onClick={palette.open} />
      </div>
      <Reveal delay={0.2}>
        <div className="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-3 text-[15px] text-fg-2">
          <span>
            <KeyHint>{isMac ? '⌘' : 'Ctrl'} Enter</KeyHint> 发送请求
          </span>
          <span>
            <KeyHint>/</KeyHint> 聚焦搜索
          </span>
          <span>
            <KeyHint>esc</KeyHint> 关闭面板
          </span>
          <Link to="/tools" className="text-link hover:underline">
            浏览全部工具 ›
          </Link>
        </div>
      </Reveal>
    </section>
  )
}

function KeyHint({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mr-1.5 rounded-md border border-line bg-surface px-1.5 py-0.5 font-sans text-xs text-fg shadow-[0_1px_0_var(--line-strong)]">
      {children}
    </kbd>
  )
}

function Key({
  label,
  sub,
  pressed,
  wide,
  onClick,
}: {
  label: string
  sub?: string
  pressed: boolean
  wide?: boolean
  onClick: () => void
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label="打开搜索"
      animate={{ y: pressed ? 6 : 0 }}
      whileHover={{ y: 2 }}
      transition={{ type: 'spring', stiffness: 700, damping: 30 }}
      className={cn(
        'relative flex h-28 flex-col items-center justify-center rounded-[22px] border border-line bg-surface text-fg sm:h-32',
        wide ? 'w-40 sm:w-44' : 'w-28 sm:w-32',
      )}
      style={{
        boxShadow: pressed
          ? '0 2px 0 var(--line-strong), 0 4px 12px rgb(0 0 0 / 0.08)'
          : '0 8px 0 var(--line-strong), 0 18px 40px rgb(0 0 0 / 0.12)',
        transition: 'box-shadow .15s ease',
      }}
    >
      <span className="text-[44px] leading-none font-medium sm:text-[52px]">{label}</span>
      {sub && <span className="absolute bottom-3 text-xs text-fg-3">{sub}</span>}
    </motion.button>
  )
}
