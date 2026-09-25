import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { motion, useInView, useScroll, type MotionValue, type Variants } from 'motion/react'
import { cn } from '@/lib/cn'
import type { SceneDef, SceneTone } from './poem'

export const EASE = [0.16, 1, 0.3, 1] as const

/** 每一幕组件的 props：文案 + 进入视口时上报，供章节轨道与顶栏换色 */
export interface StorySceneProps {
  scene: SceneDef
  onActive: (id: string) => void
}

/** 页面级 SVG 滤镜：给文字与山形加毛边，像墨在纸上洇开。`filter: url(#jh-ink)` / `url(#jh-ink-rough)` */
export function InkDefs() {
  return (
    <svg aria-hidden focusable="false" className="absolute size-0 overflow-hidden">
      <defs>
        <filter id="jh-ink" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.045"
            numOctaves="3"
            seed="7"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="3"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter id="jh-ink-rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012"
            numOctaves="4"
            seed="3"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="10"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  )
}

/** 固定在最上层的宣纸颗粒 + 四角轻微压暗 */
export function PaperGrain() {
  return (
    <>
      <div
        aria-hidden
        className="jh-grain pointer-events-none fixed inset-0 z-30 opacity-[0.07] mix-blend-multiply dark:opacity-[0.06] dark:mix-blend-screen"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-30 opacity-60"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 50%, transparent 60%, rgb(20 16 10 / 0.12) 100%)',
        }}
      />
    </>
  )
}

interface SceneProps {
  id: string
  tone: SceneTone
  /** 本幕底色与上一幕底色（CSS 变量名，如 '--jh-paper'）：顶部用一段渐变把两幕接起来 */
  bg: string
  prevBg?: string
  /** 滚动跑道倍数：1.6 表示本幕占 1.6 个视口高，舞台 sticky 停在视口里，多出来的滚动距离用来驱动动画 */
  runway?: number
  /** false：不用 sticky 舞台，内容自然铺开（终章） */
  sticky?: boolean
  onActive?: (id: string) => void
  /** 无障碍名称，如「第一幕 · 风满袂」 */
  label?: string
  className?: string
  /** 传函数可拿到本幕滚动进度 0 → 1（舞台停住的这段） */
  children: ReactNode | ((progress: MotionValue<number>) => ReactNode)
}

/** 一幕：外层撑出滚动跑道，内层 sticky 舞台停在视口里 */
export function Scene({
  id,
  tone,
  bg,
  prevBg = bg,
  runway = 1.5,
  sticky = true,
  onActive,
  label,
  className,
  children,
}: SceneProps) {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  // 幕的中线越过视口中线时视为当前幕
  const inView = useInView(ref, { margin: '-50% 0px -50% 0px' })
  useEffect(() => {
    if (inView) onActive?.(id)
  }, [inView, id, onActive])

  const style: CSSProperties = {
    background: `linear-gradient(to bottom, var(${prevBg}) 0, var(${bg}) 22svh)`,
    ...(sticky ? { height: `${runway * 100}svh` } : {}),
  }
  const content = typeof children === 'function' ? children(scrollYProgress) : children
  return (
    <section
      ref={ref}
      id={id}
      style={style}
      className={cn('relative', `jh-tone-${tone}`, className)}
      aria-label={label}
    >
      {sticky ? <div className="sticky top-0 h-[100svh] overflow-hidden">{content}</div> : content}
    </section>
  )
}

const VERSE_SIZE = {
  md: 'text-[22px] sm:text-[28px]',
  lg: 'text-[30px] sm:text-[40px] lg:text-[46px]',
  xl: 'text-[40px] sm:text-[56px] lg:text-[72px]',
} as const

const charVariants: Variants = {
  hidden: { opacity: 0, y: 10, filter: 'blur(6px)' },
  show: ({ i, delay }: { i: number; delay: number }) => ({
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.8, delay: delay + i * 0.075, ease: EASE },
  }),
}

interface VerseProps {
  /** 每个元素一列，从右往左排 */
  lines: string[]
  size?: keyof typeof VERSE_SIZE
  /** 首字延迟（秒） */
  delay?: number
  className?: string
}

/** 竖排词句：进入视口后逐字浮现，像毛笔一笔一笔写出来 */
export function VerticalVerse({ lines, size = 'lg', delay = 0, className }: VerseProps) {
  let i = 0
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.4 }}
      className={cn('jh-kai jh-vertical jh-verse', VERSE_SIZE[size], className)}
    >
      {lines.map((line) => (
        <p key={line}>
          <span className="sr-only">{line}</span>
          {Array.from(line).map((ch, j) => {
            const k = i++
            return (
              <motion.span
                aria-hidden
                key={j}
                custom={{ i: k, delay }}
                variants={charVariants}
                className="inline-block"
              >
                {ch}
              </motion.span>
            )
          })}
        </p>
      ))}
    </motion.div>
  )
}

/** 旁白：一句白话，前面一小段朱砂色短线 */
export function Narration({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <motion.p
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.8 }}
      transition={{ duration: 0.9, delay, ease: EASE }}
      className={cn(
        'jh-song max-w-[30em] text-[15px] leading-[1.9] tracking-[0.04em] text-(--jh-fg-2) sm:text-[17px]',
        className,
      )}
    >
      <span
        aria-hidden
        className="mr-3 inline-block h-px w-6 -translate-y-[0.3em] bg-(--jh-seal) align-middle"
      />
      {children}
    </motion.p>
  )
}

/** 幕次标记：「第一幕 —— 风满袂」 */
export function ChapterMark({
  chapter,
  name,
  className,
}: {
  chapter: string
  name: string
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, amount: 1 }}
      transition={{ duration: 0.8 }}
      className={cn(
        'jh-song flex items-center gap-3 text-[12px] tracking-[0.35em] text-(--jh-fg-3) sm:text-[13px]',
        className,
      )}
    >
      <span>{chapter}</span>
      <motion.span
        aria-hidden
        className="h-px w-8 origin-left bg-current"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1, delay: 0.2, ease: EASE }}
      />
      <span>{name}</span>
    </motion.div>
  )
}

/** 朱砂印章：进入视口时「盖」下去 */
export function Seal({
  text,
  size = 64,
  delay = 0,
  className,
}: {
  text: string
  size?: number
  delay?: number
  className?: string
}) {
  const chars = Array.from(text)
  return (
    <motion.div
      role="img"
      aria-label={`印章：${text}`}
      initial={{ opacity: 0, scale: 1.7, rotate: -14 }}
      whileInView={{ opacity: 1, scale: 1, rotate: -4 }}
      viewport={{ once: true, amount: 0.8 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24, delay }}
      className={cn(
        'jh-kai grid select-none place-items-center rounded-[4px] bg-(--jh-seal) text-(--jh-mist) mix-blend-multiply dark:mix-blend-normal',
        className,
      )}
      style={{
        width: size,
        height: size,
        boxShadow: 'inset 0 0 0 2px var(--jh-mist), inset 0 0 0 3.5px var(--jh-seal)',
        filter: 'url(#jh-ink)',
      }}
    >
      <div
        aria-hidden
        className="grid grid-flow-col grid-rows-2 gap-x-[0.08em]"
        style={{
          direction: 'rtl',
          fontSize: size * (chars.length > 2 ? 0.34 : 0.4),
          lineHeight: 1.05,
        }}
      >
        {chars.map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </div>
    </motion.div>
  )
}
