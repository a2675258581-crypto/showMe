import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react'
import { cn } from '@/lib/cn'
import { seededSequence } from '@/lib/seeded-random'
import {
  ChapterMark,
  EASE,
  Narration,
  Scene,
  VerticalVerse,
  type StorySceneProps,
} from '../primitives'

/**
 * 主画面坐标系（viewBox 1440×560）：桥、水、骑者共用一套坐标，
 * 骑者才能贴着桥面走、影子才能落到水里去。
 */
const W = 1440
const H = 560
/** 石拱桥：两端桥脚、岸线高度、拱起高度、水面、券洞半径 */
const BR = { x0: 420, x1: 1380, bank: 300, rise: 140, water: 336, r: 150 } as const
const MID = (BR.x0 + BR.x1) / 2
/** 骑者剪影约 190 单位宽，缩到画面里差不多九分之一的宽度 */
const RIDER_SCALE = 0.7
/** 前后蹄的距离（画面单位）：用两蹄之间的弦决定马身的高度与倾角，上下桥时不会突然一歪 */
const HOOF = 40
/** 一步的长度（画面单位）：腿摆与身体起伏都按它循环 */
const STRIDE = 150

/** 桥面高度：桥外是岸，桥上按正弦拱起 */
function deckY(x: number) {
  const t = (x - BR.x0) / (BR.x1 - BR.x0)
  if (t <= 0 || t >= 1) return BR.bank
  return BR.bank - BR.rise * Math.sin(Math.PI * t)
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}

const SEG = 56
const deckPts = Array.from({ length: SEG + 1 }, (_, i) => {
  const x = BR.x0 + ((BR.x1 - BR.x0) * i) / SEG
  return `${x.toFixed(1)} ${deckY(x).toFixed(1)}`
})
/** 桥身：桥面弧线 + 两侧桥墩斜入水，中间挖去半圆券洞（evenodd） */
const BODY_D = [
  `M ${BR.x0} ${BR.bank} L ${deckPts.join(' L ')}`,
  `L ${BR.x1 + 26} ${BR.water} L ${BR.x0 - 26} ${BR.water} Z`,
  `M ${MID - BR.r} ${BR.water} A ${BR.r} ${BR.r} 0 0 1 ${MID + BR.r} ${BR.water} Z`,
].join(' ')
/** 券洞外圈一道淡线，像石头砌出来的拱券 */
const ARCH_RING_D = `M ${MID - BR.r - 13} ${BR.water} A ${BR.r + 13} ${BR.r + 13} 0 0 1 ${MID + BR.r + 13} ${BR.water}`
const RAIL_H = 20
const RAIL_PAD = 28
const railPts = Array.from({ length: SEG + 1 }, (_, i) => {
  const x = BR.x0 + RAIL_PAD + ((BR.x1 - BR.x0 - RAIL_PAD * 2) * i) / SEG
  return `${x.toFixed(1)} ${(deckY(x) - RAIL_H).toFixed(1)}`
})
const RAIL_D = `M ${railPts.join(' L ')}`
/** 望柱：十二根，等距立在桥面上 */
const POSTS = Array.from({ length: 12 }, (_, i) => {
  const x = BR.x0 + RAIL_PAD + ((BR.x1 - BR.x0 - RAIL_PAD * 2) * i) / 11
  return { x, y: deckY(x) }
})

/** 一片叶子（viewBox -7 -8 14 16） */
const LEAF_D = 'M0 -7 C4.5 -4.5 6 0.5 0 7 C-6 0.5 -4.5 -4.5 0 -7 Z'

/** 落在桥面上的叶子：马蹄到了就被惊起来，翻个身落在前面一点 */
const DECK_LEAVES = [
  { x: 480, rot: 62 },
  { x: 610, rot: -20 },
  { x: 770, rot: 100 },
  { x: 960, rot: -70 },
  { x: 1120, rot: 30 },
  { x: 1290, rot: -110 },
]

/** 空中的落叶：位置、大小、快慢用固定种子生成，每次渲染一致 */
const LEAF_N = 14
const LEAF_RAND = seededSequence(2026, LEAF_N * 5)
const LEAVES = Array.from({ length: LEAF_N }, (_, i) => {
  const r = (k: number) => LEAF_RAND[i * 5 + k]
  const duration = 9 + r(1) * 7
  return {
    // 大多数从右上的枯枝那边落下来，几片飘得远些
    left: i < 10 ? 54 + r(0) * 38 : 20 + r(0) * 34,
    size: 8 + r(2) * 10,
    duration,
    delay: -r(3) * duration,
    sway: 2.2 + r(4) * 1.6,
    opacity: 0.55 + r(2) * 0.4,
  }
})

/** 水面：四道长波，越深越淡，各自慢慢地横着荡 */
const WAVES = [
  {
    d: 'M 150 380 C 330 372, 470 388, 640 380 S 940 372, 1120 382 S 1330 388, 1400 378',
    width: 2.2,
    opacity: 0.5,
    duration: 24,
    delay: -6,
  },
  {
    d: 'M 40 416 C 200 408, 340 424, 520 416 S 800 406, 980 418 S 1180 424, 1260 414',
    width: 1.8,
    opacity: 0.42,
    duration: 30,
    delay: -17,
  },
  {
    d: 'M 300 458 C 480 450, 640 466, 820 458 S 1120 448, 1300 460 S 1420 464, 1480 456',
    width: 1.6,
    opacity: 0.34,
    duration: 36,
    delay: -11,
  },
  {
    d: 'M -40 512 C 140 504, 300 520, 480 512 S 780 502, 960 514 S 1160 520, 1240 510',
    width: 1.4,
    opacity: 0.26,
    duration: 42,
    delay: -29,
  },
]

/** 远山两层（viewBox 1440×160）：极淡，隔着水汽 */
const HILLS = [
  {
    d: 'M0 118 L110 104 Q190 76 280 96 L400 112 L520 98 Q610 58 700 84 L820 108 L930 92 Q1020 62 1110 86 L1230 104 L1330 92 L1440 106 L1440 160 L0 160 Z',
    opacity: 0.075,
    depth: 0.4,
  },
  {
    d: 'M0 138 L140 128 Q230 108 330 124 L470 136 L600 126 Q690 106 780 122 L900 134 L1010 124 Q1110 104 1200 118 L1320 132 L1440 126 L1440 160 L0 160 Z',
    opacity: 0.12,
    depth: 0.7,
  },
]

/** 枯枝（viewBox 600×420，从右上角画外伸进来）：主枝三段由粗到细，再分几根细枝 */
const BRANCH = [
  { d: 'M 640 6 C 550 36, 470 68, 400 120', width: 7.5 },
  { d: 'M 400 120 C 330 170, 290 210, 250 250', width: 5 },
  { d: 'M 250 250 C 210 280, 170 310, 120 330', width: 3.2 },
  { d: 'M 120 330 C 92 340, 62 352, 30 368', width: 1.8 },
  { d: 'M 506 58 C 512 90, 506 120, 490 150', width: 2.4 },
  { d: 'M 496 132 C 510 140, 520 152, 524 172', width: 1.4 },
  { d: 'M 314 189 C 292 176, 268 172, 240 178', width: 2.2 },
  { d: 'M 268 173 C 262 160, 258 150, 258 136', width: 1.3 },
  { d: 'M 250 250 C 250 280, 244 300, 232 320', width: 1.8 },
  { d: 'M 120 330 C 106 318, 92 312, 76 312', width: 1.5 },
]
/** 还挂在枝头的几片叶 */
const BRANCH_LEAVES = [
  { x: 490, y: 156, rot: 24, s: 1.05 },
  { x: 236, y: 182, rot: -58, s: 0.9 },
  { x: 230, y: 326, rot: 8, s: 0.95 },
  { x: 74, y: 312, rot: -30, s: 0.8 },
]

/** 第三幕 · 过桥：一座石拱桥，一骑人影随着滚动从左走到右，秋叶从右上的枯枝上落下来 */
export function Bridge({ scene, onActive }: StorySceneProps) {
  const reduce = useReducedMotion()
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const smx = useSpring(mx, { stiffness: 40, damping: 18 })
  const smy = useSpring(my, { stiffness: 40, damping: 18 })

  return (
    <Scene
      id={scene.id}
      tone={scene.tone}
      bg="--jh-paper"
      prevBg="--jh-paper-2"
      runway={1.9}
      label={`${scene.chapter} · ${scene.name}`}
      onActive={onActive}
    >
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
          <div aria-hidden className="absolute inset-x-[-4%] top-[36%] h-[18%] text-(--jh-ink)">
            {HILLS.map((h, i) => (
              <Hill key={i} hill={h} index={i} mx={smx} my={smy} progress={progress} />
            ))}
          </div>

          {/* 山脚与岸边的水汽 */}
          <div
            aria-hidden
            className="absolute top-[50%] left-[-8%] h-[10%] w-[70%] rounded-[50%] bg-(--jh-mist) opacity-80 blur-[30px] dark:opacity-30"
            style={{ animation: 'jh-mist 34s ease-in-out -7s infinite alternate' }}
          />
          <div
            aria-hidden
            className="absolute top-[55%] right-[-16%] h-[9%] w-[62%] rounded-[50%] bg-(--jh-mist) opacity-70 blur-[28px] dark:opacity-25"
            style={{ animation: 'jh-mist 40s ease-in-out -23s infinite alternate' }}
          />

          <Branch mx={smx} progress={progress} />
          <Ground progress={progress} />
          <FallingLeaves />

          {/* 文字 */}
          <ChapterMark
            chapter={scene.chapter}
            name={scene.name}
            className="absolute top-16 left-4 z-10 sm:left-8"
          />
          <div className="absolute inset-y-0 left-[8%] z-10 flex items-center sm:left-[12%] lg:left-[16%]">
            <VerticalVerse lines={scene.verses} delay={0.4} />
          </div>
          <Narration className="absolute right-4 bottom-10 left-4 z-10 sm:right-auto sm:bottom-14 sm:left-8">
            {scene.narration}
          </Narration>
        </div>
      )}
    </Scene>
  )
}

function Hill({
  hill,
  index,
  mx,
  my,
  progress,
}: {
  hill: (typeof HILLS)[number]
  index: number
  mx: MotionValue<number>
  my: MotionValue<number>
  progress: MotionValue<number>
}) {
  // 鼠标视差 + 滚动视差：人往前走，远山慢慢往后退
  const mouseX = useTransform(mx, (v) => v * hill.depth * -20)
  const scrollX = useTransform(progress, [0, 1], [0, -14 * hill.depth])
  const x = useTransform(() => mouseX.get() + scrollX.get())
  const mouseY = useTransform(my, (v) => v * hill.depth * -8)
  const scrollY = useTransform(progress, [0, 1], [0, 12 * hill.depth])
  const y = useTransform(() => mouseY.get() + scrollY.get())
  const id = `jh-bridge-hill-${index}`
  return (
    <motion.div
      className="absolute inset-0"
      style={{ x, y }}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: hill.opacity }}
      viewport={{ once: true }}
      transition={{ duration: 1.8, delay: 0.3 + index * 0.2, ease: EASE }}
    >
      <svg
        viewBox="0 0 1440 160"
        preserveAspectRatio="xMidYMax slice"
        className="h-full w-full"
        style={{ filter: 'url(#jh-ink-rough)' }}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.45" stopColor="currentColor" stopOpacity="1" />
            <stop offset="0.8" stopColor="currentColor" stopOpacity="0.4" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={hill.d} fill={`url(#${id})`} />
      </svg>
    </motion.div>
  )
}

/** 右上角伸进来的枯枝，叶子快落尽了；整枝在风里轻轻晃 */
function Branch({ mx, progress }: { mx: MotionValue<number>; progress: MotionValue<number> }) {
  const mouseX = useTransform(mx, (v) => v * -12)
  const scrollY = useTransform(progress, [0, 1], [0, -26])
  return (
    <motion.div
      aria-hidden
      style={{ x: mouseX, y: scrollY }}
      className="absolute top-[8%] right-0 w-[54vw] text-(--jh-ink) sm:w-[36vw] lg:w-[30vw]"
    >
      <motion.div
        initial={{ opacity: 0, x: 30 }}
        whileInView={{ opacity: 0.9, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 1.6, delay: 0.3, ease: EASE }}
      >
        <motion.div
          style={{ transformOrigin: '100% 0%' }}
          animate={{ rotate: [-0.7, 0.7] }}
          transition={{ duration: 5.5, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
        >
          <svg
            viewBox="0 0 600 420"
            className="w-full overflow-visible"
            style={{ filter: 'url(#jh-ink)' }}
          >
            {BRANCH.map((b, i) => (
              <path
                key={i}
                d={b.d}
                fill="none"
                stroke="currentColor"
                strokeWidth={b.width}
                strokeLinecap="round"
              />
            ))}
            <g className="fill-(--jh-leaf)" opacity="0.85">
              {BRANCH_LEAVES.map((l, i) => (
                <path
                  key={i}
                  d={LEAF_D}
                  transform={`translate(${l.x} ${l.y}) rotate(${l.rot}) scale(${l.s * 1.3})`}
                />
              ))}
            </g>
          </svg>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

/** 量出主画面在视口里露出来的横向区间（viewBox 单位）：骑者从画外走到画外都按它算，手机上也一样 */
function useVisibleRange(ref: RefObject<HTMLDivElement | null>) {
  const [range, setRange] = useState<[number, number]>([0, W])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (!r.width) return
      setRange([(-r.left / r.width) * W, ((window.innerWidth - r.left) / r.width) * W])
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref])
  return range
}

/** 骑者的横坐标：画外一成处起步，走完整个露出的区间，再走出画外 */
function riderX(p: number, [v0, v1]: [number, number]) {
  const span = v1 - v0
  return v0 - 0.1 * span + clamp01(p / 0.95) * 1.2 * span
}

/** 骑者的位置与姿态：身高与倾角取前后蹄之间的弦，腿摆与起伏按步子循环 */
function riderPose(p: number, range: [number, number]) {
  const x = riderX(p, range)
  const back = deckY(x - HOOF)
  const front = deckY(x + HOOF)
  const stride = (x / STRIDE) * Math.PI * 2
  return {
    x,
    y: (back + front) / 2 - 1.3 * (1 - Math.cos(stride * 2)),
    angle: (Math.atan2(front - back, HOOF * 2) * 180) / Math.PI,
    swing: 16 * Math.sin(stride),
  }
}

/** 岸、桥、水中的倒影、骑者与桥面上的落叶：一张画 */
function Ground({ progress }: { progress: MotionValue<number> }) {
  const box = useRef<HTMLDivElement>(null)
  const range = useVisibleRange(box)
  return (
    <motion.div
      aria-hidden
      ref={box}
      // 进入视口在外层判断：里层一开始被 clip-path 整个裁掉，浏览器会当它不在视口里
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      className="absolute bottom-[10%] left-1/2 aspect-[1440/560] h-[34%] -translate-x-1/2 text-(--jh-ink) sm:bottom-0 sm:h-[62%]"
    >
      {/* 桥：像一笔从左往右扫出来 */}
      <motion.div
        className="absolute inset-0"
        variants={{
          hidden: { opacity: 0, clipPath: 'inset(-40% 100% -40% -40%)' },
          show: {
            opacity: 1,
            clipPath: 'inset(-40% -40% -40% -40%)',
            transition: { duration: 2.2, delay: 0.2, ease: EASE },
          },
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full overflow-visible">
          <defs>
            {/* 桥身墨色：桥面浓，近水淡 */}
            <linearGradient
              id="jh-bridge-wash"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1={BR.bank - BR.rise}
              x2="0"
              y2={BR.water}
            >
              <stop offset="0" stopColor="currentColor" stopOpacity="0.94" />
              <stop offset="0.55" stopColor="currentColor" stopOpacity="0.8" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0.58" />
            </linearGradient>
            {/* 岸线：靠桥处实，远处虚 */}
            {/* 岸线是一条水平直线，包围盒没有高度，渐变必须用用户坐标 */}
            <linearGradient
              id="jh-bridge-bank-l"
              gradientUnits="userSpaceOnUse"
              x1={-W * 0.08}
              y1="0"
              x2={BR.x0}
              y2="0"
            >
              <stop offset="0" stopColor="currentColor" stopOpacity="0" />
              <stop offset="0.6" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0.6" />
            </linearGradient>
            <linearGradient
              id="jh-bridge-bank-r"
              gradientUnits="userSpaceOnUse"
              x1={BR.x1}
              y1="0"
              x2={W * 1.08}
              y2="0"
            >
              <stop offset="0" stopColor="currentColor" stopOpacity="0.6" />
              <stop offset="0.4" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            {/* 倒影：一圈圈水纹把影子切碎，越深越淡 */}
            <linearGradient
              id="jh-bridge-ripple-g"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1={BR.water}
              x2="0"
              y2={BR.water + 300}
            >
              {Array.from({ length: 22 }, (_, i) => {
                const t = i / 21
                const band = i % 2 === 0 ? 1 : 0.3
                return (
                  <stop
                    key={i}
                    offset={t}
                    stopColor="white"
                    stopOpacity={(band * (1 - t * 0.92)).toFixed(3)}
                  />
                )
              })}
            </linearGradient>
            <mask
              id="jh-bridge-ripple"
              maskUnits="userSpaceOnUse"
              x="-400"
              y={BR.water}
              width={W + 800}
              height="300"
            >
              <rect
                x="-400"
                y={BR.water}
                width={W + 800}
                height="300"
                fill="url(#jh-bridge-ripple-g)"
              />
            </mask>
            <Rider progress={progress} range={range} />
          </defs>

          {/* 岸线：桥两头各一笔，伸到画外，微微起伏（滤镜会把零高度的直线整个滤没，所以不加） */}
          <g strokeWidth="1.8" strokeLinecap="round" fill="none">
            <path
              d={`M ${-W * 0.5} ${BR.bank + 3} C ${-W * 0.1} ${BR.bank - 1}, ${BR.x0 * 0.5} ${BR.bank + 4}, ${BR.x0 - 10} ${BR.bank + 1}`}
              stroke="url(#jh-bridge-bank-l)"
            />
            <path
              d={`M ${BR.x1 + 10} ${BR.bank + 1} C ${BR.x1 + 200} ${BR.bank + 4}, ${W * 1.1} ${BR.bank - 1}, ${W * 1.5} ${BR.bank + 3}`}
              stroke="url(#jh-bridge-bank-r)"
            />
          </g>

          {/* 水里的桥影：mask 挂在外层，里层再翻转，水纹的坐标才是正的 */}
          <g mask="url(#jh-bridge-ripple)" opacity="0.2">
            <g
              transform={`translate(0 ${BR.water * 2}) scale(1 -1)`}
              style={{ filter: 'url(#jh-ink-rough)' }}
            >
              <path d={BODY_D} fill="currentColor" fillRule="evenodd" />
              <path d={RAIL_D} fill="none" stroke="currentColor" strokeWidth="2.4" />
              {POSTS.map((p, i) => (
                <path
                  key={i}
                  d={`M ${p.x} ${p.y} L ${p.x} ${p.y - RAIL_H}`}
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              ))}
            </g>
          </g>
          {/* 水里的人影 */}
          <g mask="url(#jh-bridge-ripple)" opacity="0.15">
            <use id="jh-bridge-rider-shadow" href="#jh-bridge-rider" />
          </g>

          {/* 桥身 */}
          <g style={{ filter: 'url(#jh-ink-rough)' }}>
            <path d={BODY_D} fill="url(#jh-bridge-wash)" fillRule="evenodd" />
          </g>
          <path
            d={ARCH_RING_D}
            fill="none"
            stroke="var(--jh-paper)"
            strokeWidth="2"
            opacity="0.32"
          />
          {/* 栏杆与望柱 */}
          <g opacity="0.82">
            <path
              d={RAIL_D}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />
            {POSTS.map((p, i) => (
              <g key={i}>
                <path
                  d={`M ${p.x} ${p.y} L ${p.x} ${p.y - RAIL_H}`}
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <circle cx={p.x} cy={p.y - RAIL_H - 2} r="3.4" fill="currentColor" />
              </g>
            ))}
          </g>

          {/* 桥上的骑者 */}
          <use id="jh-bridge-rider-body" href="#jh-bridge-rider" opacity="0.95" />

          {/* 桥面上的落叶 */}
          <g className="fill-(--jh-leaf)" opacity="0.9">
            {DECK_LEAVES.map((l, i) => (
              <DeckLeaf key={i} leaf={l} progress={progress} range={range} />
            ))}
          </g>
        </svg>
      </motion.div>

      {/* 水波：每道各自慢慢横着荡 */}
      {WAVES.map((w, i) => (
        <motion.div
          key={i}
          className="absolute inset-0 text-(--jh-water)"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: w.opacity }}
          viewport={{ once: true }}
          transition={{ duration: 1.6, delay: 1.2 + i * 0.2, ease: EASE }}
          style={{ animation: `jh-mist ${w.duration}s ease-in-out ${w.delay}s infinite alternate` }}
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full overflow-visible">
            <path
              d={w.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={w.width}
              strokeLinecap="round"
              style={{ filter: 'url(#jh-ink)' }}
            />
          </svg>
        </motion.div>
      ))}
    </motion.div>
  )
}

/**
 * 骑者剪影（定义在 defs 里，桥上一份、水里一份）：斗笠、披风、背上一柄剑、马低头前行。
 * 位置与姿态由滚动进度决定，直接改 transform 属性，不经过 React 重渲染。
 */
function Rider({ progress, range }: { progress: MotionValue<number>; range: [number, number] }) {
  const fl = useRef<SVGGElement>(null)
  const fr = useRef<SVGGElement>(null)
  const hl = useRef<SVGGElement>(null)
  const hr = useRef<SVGGElement>(null)
  const pose = useTransform(progress, (p) => riderPose(p, range))
  const apply = (s: ReturnType<typeof riderPose>) => {
    const t = `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)}) rotate(${s.angle.toFixed(2)}) scale(${RIDER_SCALE})`
    document.getElementById('jh-bridge-rider-body')?.setAttribute('transform', t)
    document
      .getElementById('jh-bridge-rider-shadow')
      ?.setAttribute('transform', `translate(0 ${BR.water * 2}) scale(1 -1) ${t}`)
    const a = s.swing.toFixed(2)
    const b = (-s.swing).toFixed(2)
    fl.current?.setAttribute('transform', `rotate(${a} 30 -52)`)
    hr.current?.setAttribute('transform', `rotate(${a} -38 -52)`)
    fr.current?.setAttribute('transform', `rotate(${b} 30 -52)`)
    hl.current?.setAttribute('transform', `rotate(${b} -38 -52)`)
  }
  useMotionValueEvent(pose, 'change', apply)
  useLayoutEffect(() => apply(pose.get()))
  return (
    <g
      id="jh-bridge-rider"
      fill="currentColor"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* 马身：一笔剪影，从胸口起，绕过头颈、背、尾，回到腹下 */}
      <path
        stroke="none"
        d="M 42 -46 C 46 -52 48 -58 48 -60 C 54 -74 62 -88 70 -102 C 76 -102 86 -98 94 -94 C 99 -93 102 -97 100 -101 C 98 -105 92 -106 86 -108 C 80 -112 72 -117 64 -121 L 67 -133 L 60 -122 C 48 -112 36 -92 22 -72 C 10 -68 -12 -68 -32 -70 C -44 -71 -52 -66 -54 -60 C -68 -56 -82 -44 -90 -20 C -84 -34 -74 -44 -56 -46 C -50 -44 -46 -42 -42 -40 C -20 -36 14 -36 36 -42 C 39 -43 41 -45 42 -46 Z"
      />
      {/* 四条腿：前后各一对，走路时交替摆 */}
      <g ref={fl}>
        <path fill="none" strokeWidth="6" d="M 30 -52 L 40 -26 L 48 -2" />
      </g>
      <g ref={fr}>
        <path fill="none" strokeWidth="6" d="M 30 -52 L 24 -26 L 18 -2" />
      </g>
      <g ref={hl}>
        <path fill="none" strokeWidth="6" d="M -38 -52 L -50 -26 L -44 -2" />
      </g>
      <g ref={hr}>
        <path fill="none" strokeWidth="6" d="M -38 -52 L -58 -26 L -62 -2" />
      </g>
      {/* 背上的剑 */}
      <path fill="none" strokeWidth="3" d="M -1 -73 L -20 -115" />
      <path fill="none" strokeWidth="2" d="M -21 -107 L -13 -111" />
      {/* 骑者：腿、身躯与向后飘的披风、头、斗笠 */}
      <path fill="none" strokeWidth="5.5" d="M 8 -68 L 22 -52 L 21 -34" />
      <path
        stroke="none"
        d="M 14 -70 C 17 -80 17 -92 16 -100 C 15 -105 10 -108 4 -107 C -6 -106 -16 -96 -28 -82 C -33 -75 -33 -66 -28 -60 C -22 -64 -12 -69 -4 -70 Z"
      />
      <circle cx="9" cy="-113" r="5.5" stroke="none" />
      <path stroke="none" d="M -8 -121 Q 9 -136 26 -121 Q 9 -117 -8 -121 Z" />
      {/* 缰绳 */}
      <path fill="none" strokeWidth="1.3" opacity="0.85" d="M 16 -92 Q 58 -86 92 -100" />
      {/* 剑穗：整幅画里唯一的一点朱砂 */}
      <path
        className="fill-(--jh-seal)"
        stroke="none"
        d="M -20 -115 C -23 -111 -24 -105 -21 -102 C -18 -105 -17 -111 -20 -115 Z"
      />
    </g>
  )
}

/** 桥面上的一片叶：马蹄快到时跳起来翻个身，落在前面一点 */
function DeckLeaf({
  leaf,
  progress,
  range,
}: {
  leaf: (typeof DECK_LEAVES)[number]
  progress: MotionValue<number>
  range: [number, number]
}) {
  const ref = useRef<SVGPathElement>(null)
  const y = deckY(leaf.x)
  const transform = useTransform(progress, (p) => {
    const hoof = riderX(p, range) + HOOF * 0.85
    const s = clamp01((hoof - leaf.x + 8) / 110)
    const x = leaf.x + 30 * s
    const lift = -26 * Math.sin(Math.PI * s)
    return `translate(${x.toFixed(1)} ${(y + lift - 2).toFixed(1)}) rotate(${(leaf.rot + 200 * s).toFixed(1)}) scale(1.15)`
  })
  const apply = (t: string) => ref.current?.setAttribute('transform', t)
  useMotionValueEvent(transform, 'change', apply)
  useLayoutEffect(() => apply(transform.get()))
  return <path ref={ref} d={LEAF_D} />
}

/** 空中的落叶：外层一路飘落，内层左右摇 */
function FallingLeaves() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden text-(--jh-leaf)">
      {LEAVES.map((l, i) => (
        <div
          key={i}
          className={cn('absolute top-0', l.size > 14 && 'will-change-transform')}
          style={{
            left: `${l.left}%`,
            opacity: l.opacity,
            animation: `jh-leaf-fall ${l.duration}s linear ${l.delay}s infinite`,
          }}
        >
          <div
            style={{
              animation: `jh-leaf-sway ${l.sway}s ease-in-out ${-i * 0.53}s infinite alternate`,
            }}
          >
            <svg width={l.size * 0.875} height={l.size} viewBox="-7 -8 14 16">
              <path d={LEAF_D} fill="currentColor" />
            </svg>
          </div>
        </div>
      ))}
    </div>
  )
}
