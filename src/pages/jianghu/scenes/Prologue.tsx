import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react'
import { cn } from '@/lib/cn'
import { POEM, PROLOGUE } from '../poem'
import { EASE, Scene, Seal } from '../primitives'

/** 远→近四层山：路径（viewBox 1440×600）、墨色浓淡、视差深度 */
const RIDGES: { d: string; opacity: number; depth: number; fade: number }[] = [
  {
    d: 'M0 330 L80 268 Q130 214 186 246 L256 196 Q298 162 342 204 L418 262 L498 232 Q556 142 616 184 L698 122 Q730 98 764 142 L842 224 L922 202 Q986 160 1046 194 L1122 154 Q1172 120 1214 172 L1292 236 L1372 214 L1440 246 L1440 600 L0 600 Z',
    opacity: 0.16,
    depth: 0.35,
    fade: 0.55,
  },
  {
    d: 'M0 398 L70 362 Q126 318 190 344 L262 312 Q316 286 372 326 L452 374 L540 350 Q604 296 672 322 L760 286 Q806 266 852 306 L936 366 L1016 344 Q1084 298 1150 328 L1236 302 Q1290 286 1336 320 L1440 372 L1440 600 L0 600 Z',
    opacity: 0.28,
    depth: 0.6,
    fade: 0.5,
  },
  {
    d: 'M0 470 L96 444 Q160 412 232 438 L318 460 L402 436 Q470 404 544 430 L636 452 L724 420 Q790 392 860 424 L950 458 L1040 438 Q1112 412 1186 440 L1276 464 L1360 444 L1440 460 L1440 600 L0 600 Z',
    opacity: 0.42,
    depth: 0.85,
    fade: 0.45,
  },
  {
    d: 'M0 528 Q120 506 240 516 Q360 526 480 512 Q600 498 720 514 Q840 530 960 512 Q1080 494 1200 508 Q1320 522 1440 506 L1440 600 L0 600 Z',
    opacity: 0.62,
    depth: 1.1,
    fade: 0.25,
  },
]

const MISTS = [
  { className: 'bottom-[26%] left-[-10%] h-[9%] w-[70%]', duration: '30s', delay: '0s' },
  { className: 'bottom-[36%] right-[-20%] h-[12%] w-[80%]', duration: '38s', delay: '-14s' },
  { className: 'bottom-[48%] left-[10%] h-[8%] w-[60%]', duration: '44s', delay: '-27s' },
]

/** 雁阵：7 只，人字形 */
const BIRDS = [
  [0, 0],
  [-26, 14],
  [-52, 30],
  [-78, 48],
  [26, 14],
  [52, 30],
  [78, 48],
]

/** 卷首：水墨远山、雾带与雁阵，竖排大字「江湖」像用毛笔一笔一笔写出来 */
export function Prologue({ onActive }: { onActive: (id: string) => void }) {
  const reduce = useReducedMotion()
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const smx = useSpring(mx, { stiffness: 40, damping: 18 })
  const smy = useSpring(my, { stiffness: 40, damping: 18 })

  return (
    <Scene id="prologue" tone="day" bg="--jh-paper" runway={1.35} label="卷首" onActive={onActive}>
      {(progress) => (
        <div
          className="relative h-full w-full"
          onPointerMove={(e) => {
            if (reduce || e.pointerType !== 'mouse') return
            const r = e.currentTarget.getBoundingClientRect()
            mx.set((e.clientX - r.left) / r.width - 0.5)
            my.set((e.clientY - r.top) / r.height - 0.5)
          }}
        >
          {/* 远山 */}
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-[64%] text-(--jh-ink)">
            {RIDGES.map((r, i) => (
              <Ridge key={i} ridge={r} index={i} mx={smx} my={smy} progress={progress} />
            ))}
            {MISTS.map((m, i) => (
              <div
                key={i}
                className={cn(
                  'absolute rounded-[50%] bg-(--jh-mist) opacity-90 blur-[34px]',
                  m.className,
                )}
                style={{
                  animation: `jh-mist ${m.duration} ease-in-out ${m.delay} infinite alternate`,
                }}
              />
            ))}
          </div>

          {/* 雁阵 */}
          <div
            aria-hidden
            className="absolute top-[16%] left-0 text-(--jh-ink-2) opacity-70"
            style={{ animation: 'jh-birds 80s linear -22s infinite' }}
          >
            <svg
              width="200"
              height="70"
              viewBox="-100 -6 200 70"
              className="w-[120px] sm:w-[200px]"
            >
              {BIRDS.map(([x, y], i) => (
                <path
                  key={i}
                  d={`M${x - 9} ${y + 5} C${x - 5} ${y}, ${x - 2} ${y}, ${x} ${y + 5} C${x + 2} ${y}, ${x + 5} ${y}, ${x + 9} ${y + 5}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              ))}
            </svg>
          </div>

          {/* 标题 */}
          <Title progress={progress} />

          {/* 展卷提示 */}
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2.4, duration: 1 }}
            className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3 text-(--jh-paper) opacity-90"
          >
            <span className="jh-song jh-vertical text-[11px] tracking-[0.4em]">
              {PROLOGUE.hint}
            </span>
            <span
              className="block h-10 w-px bg-current"
              style={{ animation: 'jh-hint 2.6s ease-in-out infinite' }}
            />
          </motion.div>
        </div>
      )}
    </Scene>
  )
}

function Ridge({
  ridge,
  index,
  mx,
  my,
  progress,
}: {
  ridge: (typeof RIDGES)[number]
  index: number
  mx: MotionValue<number>
  my: MotionValue<number>
  progress: MotionValue<number>
}) {
  const x = useTransform(mx, (v) => v * ridge.depth * -28)
  const mouseY = useTransform(my, (v) => v * ridge.depth * -10)
  const scrollY = useTransform(progress, [0, 1], [0, 90 * ridge.depth])
  const y = useTransform(() => mouseY.get() + scrollY.get())
  const id = `jh-ridge-${index}`
  return (
    <motion.div
      className="absolute inset-0"
      style={{ x, y, opacity: ridge.opacity }}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: ridge.opacity, y: 0 }}
      transition={{ duration: 1.6, delay: 0.2 + index * 0.18, ease: EASE }}
    >
      <svg
        viewBox="0 0 1440 600"
        preserveAspectRatio="xMidYMax slice"
        className="h-full w-full"
        style={{ filter: 'url(#jh-ink-rough)' }}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="1" />
            <stop offset={ridge.fade} stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={ridge.d} fill={`url(#${id})`} />
      </svg>
    </motion.div>
  )
}

function Title({ progress }: { progress: MotionValue<number> }) {
  const y = useTransform(progress, [0, 1], [0, -90])
  const opacity = useTransform(progress, [0, 0.75], [1, 0])
  return (
    <motion.div
      style={{ y, opacity }}
      className="absolute inset-y-0 right-[6%] flex items-center sm:right-[10%] lg:right-[14%]"
    >
      <div className="relative flex flex-row-reverse items-start gap-4 sm:gap-7">
        <h1
          className="jh-kai jh-vertical jh-upright text-[112px] leading-none tracking-[0.04em] text-(--jh-ink) sm:text-[150px] lg:text-[190px]"
          style={{ filter: 'url(#jh-ink)' }}
        >
          {Array.from(POEM.title).map((ch, i) => (
            <motion.span
              key={i}
              className="inline-block"
              initial={{ opacity: 0, clipPath: 'inset(0 0 100% 0)', filter: 'blur(10px)' }}
              animate={{ opacity: 1, clipPath: 'inset(0 0 0% 0)', filter: 'blur(0px)' }}
              transition={{ duration: 1.4, delay: 0.35 + i * 0.6, ease: EASE }}
            >
              {ch}
            </motion.span>
          ))}
        </h1>
        <div className="flex flex-row-reverse items-start gap-3 pt-2 sm:gap-4 sm:pt-4">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 1.5, ease: EASE }}
            className="jh-song jh-vertical text-[15px] tracking-[0.42em] text-(--jh-fg-2) sm:text-[18px]"
          >
            {POEM.tune}
          </motion.p>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 1.75, ease: EASE }}
            className="jh-song jh-vertical text-[12px] tracking-[0.32em] text-(--jh-fg-3) sm:text-[13px]"
          >
            {PROLOGUE.subtitle}
          </motion.p>
        </div>
        {/* 闲章盖在标题块左下角 */}
        <Seal
          text={PROLOGUE.seal}
          size={56}
          delay={2.1}
          className="absolute -bottom-4 left-0 translate-y-full sm:-bottom-6"
        />
      </div>
    </motion.div>
  )
}
