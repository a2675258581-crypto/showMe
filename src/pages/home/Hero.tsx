import { useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { usePalette } from '@/components/CommandPalette'
import { MeshBackground } from '@/components/motion/MeshBackground'
import { ToolIcon } from '@/components/ToolIcon'
import { modKey } from '@/hooks/useHotkey'
import { cn } from '@/lib/cn'
import { TOOL_MAP, TOOLS } from '@/tools/registry'

/** 漂浮在标题四周的「App 图标」：位置、景深、旋转 */
const FLOATERS: {
  id: string
  pos: string
  depth: number
  rotate: number
  size: 'md' | 'lg' | 'xl'
  delay: string
  mobile?: boolean
}[] = [
  {
    id: 'json-formatter',
    pos: 'left-[5%] top-[3%] md:left-[7%] md:top-[16%]',
    depth: 1.4,
    rotate: -10,
    size: 'xl',
    delay: '0s',
    mobile: true,
  },
  {
    id: 'api-client',
    pos: 'right-[5%] top-[4%] md:right-[8%] md:top-[14%]',
    depth: 1.1,
    rotate: 8,
    size: 'xl',
    delay: '-2s',
    mobile: true,
  },
  { id: 'hash', pos: 'left-[15%] top-[62%]', depth: 0.8, rotate: 6, size: 'lg', delay: '-4s' },
  {
    id: 'regex-tester',
    pos: 'right-[14%] top-[64%]',
    depth: 1.2,
    rotate: -6,
    size: 'lg',
    delay: '-1s',
  },
  {
    id: 'color-converter',
    pos: 'left-[3%] top-[40%]',
    depth: 0.6,
    rotate: 12,
    size: 'md',
    delay: '-3s',
  },
  { id: 'qrcode', pos: 'right-[3%] top-[40%]', depth: 0.7, rotate: -12, size: 'md', delay: '-5s' },
  {
    id: 'timestamp',
    pos: 'left-[27%] top-[8%]',
    depth: 0.5,
    rotate: 4,
    size: 'md',
    delay: '-2.5s',
  },
  {
    id: 'jwt-decoder',
    pos: 'right-[26%] top-[84%]',
    depth: 0.9,
    rotate: -4,
    size: 'md',
    delay: '-1.5s',
    mobile: true,
  },
  {
    id: 'text-diff',
    pos: 'left-[24%] top-[84%]',
    depth: 0.6,
    rotate: 8,
    size: 'md',
    delay: '-3.5s',
    mobile: true,
  },
]

const EASE = [0.16, 1, 0.3, 1] as const

export function Hero() {
  const ref = useRef<HTMLElement>(null)
  const palette = usePalette()
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const contentY = useTransform(scrollYProgress, [0, 1], [0, 180])
  const contentOpacity = useTransform(scrollYProgress, [0, 0.65], [1, 0])
  const contentScale = useTransform(scrollYProgress, [0, 1], [1, 0.9])

  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const smx = useSpring(mx, { stiffness: 50, damping: 18 })
  const smy = useSpring(my, { stiffness: 50, damping: 18 })

  return (
    <section
      ref={ref}
      className="relative flex min-h-[calc(100svh-48px)] items-center justify-center overflow-hidden"
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== 'mouse') return
        const r = e.currentTarget.getBoundingClientRect()
        mx.set((e.clientX - r.left) / r.width - 0.5)
        my.set((e.clientY - r.top) / r.height - 0.5)
      }}
    >
      <MeshBackground />
      {/* 底部渐隐到页面背景 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-bg" />

      {FLOATERS.map((f, i) => (
        <FloatingIcon key={f.id} {...f} index={i} mx={smx} my={smy} progress={scrollYProgress} />
      ))}

      <motion.div
        style={{ y: contentY, opacity: contentOpacity, scale: contentScale }}
        className="relative z-10 flex max-w-4xl flex-col items-center px-6 pt-10 pb-24 text-center"
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, ease: EASE }}
          className="glass mb-8 inline-flex items-center gap-2 rounded-full border border-line px-4 py-1.5 text-[13px] font-medium text-fg-2 shadow-card"
        >
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-sys-green opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-sys-green" />
          </span>
          {TOOLS.length} 款开发者工具 · 全部在本地运行
        </motion.div>

        <h1 className="headline text-[56px] text-fg sm:text-[96px] lg:text-[120px]">
          <span className="block">
            {Array.from('开发者的').map((ch, i) => (
              <motion.span
                key={i}
                className="inline-block"
                initial={{ opacity: 0, y: 60, filter: 'blur(16px)', rotateX: -60 }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)', rotateX: 0 }}
                transition={{ duration: 1, delay: 0.15 + i * 0.07, ease: EASE }}
              >
                {ch}
              </motion.span>
            ))}
          </span>
          <motion.span
            className="block animate-gradient-pan text-gradient-rainbow pb-2"
            initial={{ opacity: 0, y: 60, filter: 'blur(20px)', scale: 0.92 }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)', scale: 1 }}
            transition={{ duration: 1.2, delay: 0.5, ease: EASE }}
          >
            百宝箱。
          </motion.span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.85, ease: EASE }}
          className="mt-6 max-w-2xl text-[19px] leading-relaxed text-fg-2 sm:text-[24px]"
        >
          JSON、XML、代码格式化，接口调试，哈希加密……
          <br className="hidden sm:block" />
          每天都要用的小工具，一处搞定。快，美，而且只在你的浏览器里运行。
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 1.05, ease: EASE }}
          className="mt-10 flex flex-col items-center gap-5 sm:flex-row sm:gap-8"
        >
          <Link
            to="/tools"
            className="group relative inline-flex h-12 items-center rounded-full bg-accent px-8 text-[17px] font-medium text-white shadow-lg shadow-accent/30 transition-[background-color,transform] duration-300 hover:bg-accent-hover active:scale-95"
          >
            开始使用
          </Link>
          <button
            type="button"
            onClick={palette.open}
            className="group inline-flex items-center gap-1 text-[17px] text-link"
          >
            <span className="group-hover:underline sm:hidden">搜索工具</span>
            <span className="hidden group-hover:underline sm:inline">按 {modKey} K 搜索工具</span>
            <ChevronRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
          </button>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8, duration: 1 }}
        style={{ opacity: contentOpacity }}
        className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-fg-3"
        aria-hidden
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ChevronDown className="size-6" />
        </motion.div>
      </motion.div>
    </section>
  )
}

function FloatingIcon({
  id,
  pos,
  depth,
  rotate,
  size,
  delay,
  mobile,
  index,
  mx,
  my,
  progress,
}: (typeof FLOATERS)[number] & {
  index: number
  mx: MotionValue<number>
  my: MotionValue<number>
  progress: MotionValue<number>
}) {
  const tool = TOOL_MAP[id]
  const x = useTransform(mx, (v) => v * depth * -60)
  const mouseY = useTransform(my, (v) => v * depth * -60)
  const scrollY = useTransform(progress, [0, 1], [0, -260 * depth])
  const y = useTransform(() => mouseY.get() + scrollY.get())
  const opacity = useTransform(progress, [0, 0.6], [1, 0])
  if (!tool) return null
  return (
    <motion.div
      aria-hidden
      className={cn('absolute z-0', pos, !mobile && 'hidden md:block')}
      style={{ x, y, opacity }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.3, rotate: rotate * 3 }}
        animate={{ opacity: 1, scale: 1, rotate }}
        transition={{ type: 'spring', stiffness: 120, damping: 14, delay: 0.6 + index * 0.08 }}
      >
        <div className="animate-float" style={{ animationDelay: delay }}>
          <ToolIcon
            tool={tool}
            size={size}
            className={cn(
              'shadow-2xl',
              size === 'md' && 'max-sm:size-10 max-sm:rounded-xl',
              size === 'xl' && 'max-sm:size-14 max-sm:rounded-2xl max-sm:[&_svg]:size-7',
            )}
          />
        </div>
      </motion.div>
    </motion.div>
  )
}
