import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react'
import { cn } from '@/lib/cn'

interface Segment {
  text: string
  /** 高亮成渐变色的关键词 */
  accent?: boolean
}

const SEGMENTS: Segment[] = [
  { text: '那些每天都要用、却总要重新去搜的小工具，' },
  { text: '现在都放在了一起。', accent: true },
  { text: '格式化、转换、编码、加密、调试接口——' },
  { text: '打开即用', accent: true },
  { text: '，无需登录，也不上传任何数据。' },
]

/** 随滚动逐字点亮的大段文字（苹果产品页常见的叙事效果） */
export function ScrollText() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.45'] })

  const chars: { ch: string; accent?: boolean }[] = []
  for (const s of SEGMENTS)
    for (const ch of Array.from(s.text)) chars.push({ ch, accent: s.accent })
  const n = chars.length

  return (
    <section className="mx-auto max-w-[1000px] px-6 py-[18vh]">
      <div ref={ref}>
        <p className="headline text-[34px] leading-[1.3] sm:text-[52px] sm:leading-[1.25] lg:text-[60px]">
          {chars.map((c, i) => (
            <Char
              key={i}
              progress={scrollYProgress}
              range={[i / n, Math.min(1, (i + 3) / n)]}
              accent={c.accent}
              static={!!reduce}
            >
              {c.ch}
            </Char>
          ))}
        </p>
      </div>
    </section>
  )
}

function Char({
  children,
  progress,
  range,
  accent,
  static: isStatic,
}: {
  children: string
  progress: MotionValue<number>
  range: [number, number]
  accent?: boolean
  static: boolean
}) {
  const opacity = useTransform(progress, range, [0.14, 1])
  return (
    <motion.span
      style={{ opacity: isStatic ? 1 : opacity }}
      className={cn(
        accent
          ? 'bg-gradient-to-r from-sys-blue via-sys-purple to-sys-pink bg-clip-text text-transparent'
          : 'text-fg',
      )}
    >
      {children}
    </motion.span>
  )
}
