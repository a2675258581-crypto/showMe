import { motion, useTransform, type MotionValue } from 'motion/react'
import { cn } from '@/lib/cn'
import type { SceneDef } from '../poem'
import {
  ChapterMark,
  EASE,
  Narration,
  Scene,
  VerticalVerse,
  type StorySceneProps,
} from '../primitives'

type Pt = readonly [number, number]
type Cubic = readonly [Pt, Pt, Pt, Pt]

/** 三次贝塞尔曲线上 t 处的点 */
function cubicAt([p0, p1, p2, p3]: Cubic, t: number): Pt {
  const s = 1 - t
  const a = s * s * s
  const b = 3 * s * s * t
  const c = 3 * s * t * t
  const d = t * t * t
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ]
}

/** 檐口由两段曲线接成：前 72% 平缓微垂，后 28% 翘起成飞檐；u ∈ [0, 1] 走完全程 */
const SPLIT = 0.72
function eaveAt(curve: readonly [Cubic, Cubic], u: number): Pt {
  return u < SPLIT ? cubicAt(curve[0], u / SPLIT) : cubicAt(curve[1], (u - SPLIT) / (1 - SPLIT))
}
const seg = (c: Cubic) => `C${c[1]} ${c[2]} ${c[3]}`
const rev = (c: Cubic): Cubic => [c[3], c[2], c[1], c[0]]
const r1 = (n: number) => Math.round(n * 10) / 10

/* ───────── 檐角几何（viewBox 800×600）：屋面下沿（檐口）与上沿（屋脊线） ───────── */
const EAVE: readonly [Cubic, Cubic] = [
  [
    [0, 262],
    [180, 286],
    [400, 280],
    [560, 240],
  ],
  [
    [560, 240],
    [660, 214],
    [722, 150],
    [768, 62],
  ],
]
const RIDGE: readonly [Cubic, Cubic] = [
  [
    [0, 150],
    [200, 182],
    [420, 196],
    [560, 166],
  ],
  [
    [560, 166],
    [640, 148],
    [704, 112],
    [768, 62],
  ],
]
const ROOF_PATH = `M${RIDGE[0][0]} ${seg(RIDGE[0])} ${seg(RIDGE[1])} ${seg(rev(EAVE[1]))} ${seg(rev(EAVE[0]))} Z`
const RIDGE_PATH = `M${RIDGE[0][0]} ${seg(RIDGE[0])} ${seg(RIDGE[1])}`
const EAVE_PATH = `M${EAVE[0][0]} ${seg(EAVE[0])} ${seg(EAVE[1])}`

/** 瓦垄：从屋脊到檐口的细线，越靠近檐角越短、越密 */
const TILE_ROWS = [0.05, 0.13, 0.21, 0.29, 0.37, 0.45, 0.53, 0.61, 0.69, 0.76, 0.83, 0.9].map(
  (u) => {
    const [x1, y1] = eaveAt(RIDGE, u)
    const [x2, y2] = eaveAt(EAVE, u)
    return { x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2) }
  },
)
/** 瓦当：沿檐口一排圆头 */
const WADANG = Array.from({ length: 19 }, (_, i) => {
  const [x, y] = eaveAt(EAVE, 0.015 + i * 0.052)
  return { cx: r1(x), cy: r1(y + 2) }
})
/** 檐角滴水：两处在檐口低处，一处在翘起的檐尖 */
const DRIPS = [
  { u: 0.3, duration: 1.6, delay: -0.3 },
  { u: 0.62, duration: 1.9, delay: -1.2 },
  { u: 1, duration: 1.7, delay: -0.7 },
].map((d) => {
  const [x, y] = eaveAt(EAVE, d.u)
  return { cx: r1(x), cy: r1(y + 9), duration: d.duration, delay: d.delay }
})

/* ───────── 雨：斜向的重复渐变做雨丝，再用一层细缝遮罩把长线切成短划，随 jh-rain 往下落 ─────────
 * 雨丝方向与 jh-rain 的位移 (-48px, 360px) 平行（187.6°），周期整除位移长度 363.19px，循环时无缝。 */
const RAIN_LAYERS = [
  {
    streak:
      'repeating-linear-gradient(187.6deg, transparent 0 74px, var(--jh-water) 78px 117px, transparent 121.06px)',
    mask: 'repeating-linear-gradient(97.6deg, black 0 1.8px, transparent 1.8px 34px)',
    duration: '0.8s',
    opacity: 1,
  },
  {
    streak:
      'repeating-linear-gradient(187.6deg, transparent 0 62px, var(--jh-water) 65px 86px, transparent 90.8px)',
    mask: 'repeating-linear-gradient(97.6deg, transparent 0 11px, black 11px 12.2px, transparent 12.2px 23px)',
    duration: '1.15s',
    opacity: 0.6,
  },
]

/** 阴云：三团大墨晕压在天顶，雨停后慢慢散开 */
const CLOUDS = [
  {
    className: '-top-[30%] -left-[10%] h-[70%] w-[70%]',
    opacity: 0.14,
    duration: '46s',
    delay: '0s',
  },
  {
    className: '-top-[22%] -right-[15%] h-[66%] w-[76%]',
    opacity: 0.12,
    duration: '58s',
    delay: '-20s',
  },
  {
    className: 'top-[8%] left-[24%] h-[46%] w-[60%]',
    opacity: 0.09,
    duration: '52s',
    delay: '-35s',
  },
]

/** 云缝里漏下来的两道光 */
const SHAFTS = [
  '-top-[10%] right-[24%] h-[120%] w-[9vw] rotate-[24deg]',
  '-top-[10%] right-[8%] h-[110%] w-[5vw] rotate-[24deg]',
]

/** 水洼：三个横躺的椭圆 */
const PUDDLES = [
  { className: 'bottom-[20%] left-[8%] h-[1.3vh] w-[24vw] sm:left-[12%]', opacity: 0.28 },
  { className: 'bottom-[24%] left-[42%] h-[0.9vh] w-[12vw]', opacity: 0.2 },
  { className: 'bottom-[15%] left-[56%] h-[1.7vh] w-[28vw]', opacity: 0.32 },
]
/** 雨点落在水洼上的涟漪 */
const RIPPLES = [
  {
    className: 'bottom-[20.4%] left-[14%] h-[1.2vh] w-[3.2vw] sm:left-[17%]',
    duration: 1.8,
    delay: 0,
  },
  { className: 'bottom-[20.2%] left-[24%] h-[1vh] w-[2.6vw]', duration: 2.1, delay: 0.9 },
  { className: 'bottom-[24.2%] left-[46%] h-[0.8vh] w-[2.2vw]', duration: 1.6, delay: 0.4 },
  { className: 'bottom-[15.6%] left-[66%] h-[1.5vh] w-[4vw]', duration: 2.3, delay: 1.3 },
  { className: 'bottom-[15.3%] left-[76%] h-[1.2vh] w-[3vw]', duration: 1.9, delay: 0.6 },
]

/** 第二幕 · 雨初晴：檐角下斜挂着酒旗，雨丝随滚动渐渐停住，云散开，一点金光从右上角漏下来，水洼跟着亮起 */
export function Rain({ scene, onActive }: StorySceneProps) {
  return (
    <Scene
      id={scene.id}
      tone={scene.tone}
      bg="--jh-paper-2"
      prevBg="--jh-paper"
      runway={1.6}
      label={`${scene.chapter} · ${scene.name}`}
      onActive={onActive}
    >
      {(progress) => <Stage progress={progress} scene={scene} />}
    </Scene>
  )
}

function Stage({ progress, scene }: { progress: MotionValue<number>; scene: SceneDef }) {
  // 雨在前半段停下；雨停之后云开、光漏下来、水洼亮起
  // 输入区间都显式铺满 [0, 1]：motion 会把这些值交给原生 ScrollTimeline，
  // 关键帧没盖住的区段会插回元素的初始值（雨会在末尾重新下起来），所以两端都要钉死
  const rain = useTransform(progress, [0, 0.06, 0.58, 1], [0.35, 0.35, 0, 0])
  const wet = useTransform(progress, [0, 0.06, 0.58, 1], [1, 1, 0, 0])
  const overcast = useTransform(progress, [0, 0.1, 0.8, 1], [1, 1, 0.2, 0.2])
  const bloom = useTransform(progress, [0, 0.45, 0.9, 1], [0, 0, 0.55, 0.55])
  const shaft = useTransform(progress, [0, 0.5, 0.95, 1], [0, 0, 0.42, 0.42])
  const sheen = useTransform(progress, [0, 0.45, 0.9, 1], [0, 0, 0.6, 0.6])
  const roofY = useTransform(progress, [0, 1], [0, -28])
  const groundY = useTransform(progress, [0, 1], [0, 12])

  return (
    <div className="relative h-full w-full">
      {/* 阴云 */}
      <motion.div
        aria-hidden
        style={{ opacity: overcast }}
        className="pointer-events-none absolute inset-x-0 top-0 h-[55%]"
      >
        {CLOUDS.map((c, i) => (
          <div
            key={i}
            className={cn('absolute rounded-[50%] bg-(--jh-ink) blur-[64px]', c.className)}
            style={{
              opacity: c.opacity,
              animation: `jh-mist ${c.duration} ease-in-out ${c.delay} infinite alternate`,
            }}
          />
        ))}
      </motion.div>

      {/* 云缝里的光：一团暖晕 + 两道斜射的光 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 dark:opacity-60">
        <motion.div
          style={{ opacity: bloom }}
          className="absolute -top-[18%] -right-[14%] size-[88vmin] rounded-full bg-[radial-gradient(circle,var(--jh-lamp)_0%,transparent_62%)] blur-[40px]"
        />
        {SHAFTS.map((s, i) => (
          <motion.div
            key={i}
            style={{ opacity: shaft }}
            className={cn(
              'absolute origin-top bg-[linear-gradient(to_bottom,var(--jh-lamp),transparent_75%)] blur-[22px]',
              s,
            )}
          />
        ))}
      </div>

      {/* 镇口的路、远坡与水洼 */}
      <motion.div aria-hidden style={{ y: groundY }} className="absolute inset-0">
        <svg
          viewBox="0 0 1440 160"
          preserveAspectRatio="none"
          className="absolute inset-x-0 top-[68%] h-[11%] w-full text-(--jh-ink)"
          style={{ filter: 'url(#jh-ink-rough)' }}
        >
          <defs>
            <linearGradient id="jh-rain-hill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.11" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M600 126 C800 76 1000 60 1170 82 C1290 98 1380 104 1460 96 L1460 160 L600 160 Z"
            fill="url(#jh-rain-hill)"
          />
          <g
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          >
            <path
              d="M-10 108 C220 96 440 118 660 106 C880 94 1120 114 1460 100"
              strokeWidth="2"
              opacity="0.5"
              vectorEffect="non-scaling-stroke"
            />
            {/* 路边两丛短草 */}
            <path
              d="M328 130 c-2 -6 -7 -11 -13 -14 M337 131 c-2 -7 -2 -13 0 -20 M345 130 c2 -5 4 -9 9 -12"
              strokeWidth="1.5"
              opacity="0.4"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M1012 126 c-3 -5 -8 -10 -14 -12 M1021 127 c-2 -6 -3 -12 -1 -19 M1030 126 c2 -4 5 -8 11 -10"
              strokeWidth="1.5"
              opacity="0.4"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </svg>
        {PUDDLES.map((p, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 1.4, delay: 0.6 + i * 0.2, ease: EASE }}
            className={cn('absolute', p.className)}
          >
            <span
              className="absolute inset-0 rounded-[50%] bg-(--jh-water) blur-[1.5px]"
              style={{ opacity: p.opacity }}
            />
            <motion.span
              style={{ opacity: sheen }}
              className="absolute inset-x-[16%] inset-y-[14%] rounded-[50%] bg-(--jh-lamp) blur-[2px]"
            />
          </motion.div>
        ))}
        <motion.div style={{ opacity: wet }} className="absolute inset-0">
          {RIPPLES.map((r, i) => (
            <motion.span
              key={i}
              className={cn('absolute rounded-[50%] border border-(--jh-water)', r.className)}
              animate={{ scale: [0.2, 1.4], opacity: [0.7, 0] }}
              transition={{
                duration: r.duration,
                delay: r.delay,
                repeat: Infinity,
                ease: 'easeOut',
              }}
            />
          ))}
        </motion.div>
      </motion.div>

      {/* 酒家的檐角与斜挂的酒旗 */}
      <motion.div
        aria-hidden
        style={{ y: roofY }}
        className="absolute top-[6%] left-0 aspect-[4/3] w-[92vw] sm:w-[56vw] lg:w-[44vw]"
      >
        <motion.div
          initial={{ opacity: 0, x: -28 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 1.5, ease: EASE }}
          className="absolute inset-0"
        >
          <Eave wet={wet} />
        </motion.div>
        <Banner wet={wet} />
      </motion.div>

      {/* 雨：两层雨丝，近的快而粗，远的慢而细 */}
      <motion.div
        aria-hidden
        style={{ opacity: rain }}
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {RAIN_LAYERS.map((l, i) => (
          <div
            key={i}
            className="absolute -inset-x-16 -top-[400px] bottom-0"
            style={{
              backgroundImage: l.streak,
              maskImage: l.mask,
              WebkitMaskImage: l.mask,
              opacity: l.opacity,
              animation: `jh-rain ${l.duration} linear infinite`,
            }}
          />
        ))}
      </motion.div>

      {/* 文案 */}
      <ChapterMark
        chapter={scene.chapter}
        name={scene.name}
        className="absolute top-16 left-4 z-10 sm:left-8"
      />
      <div className="absolute inset-y-0 right-[8%] z-10 flex items-center sm:right-[12%] lg:right-[16%]">
        <VerticalVerse lines={scene.verses} />
      </div>
      <Narration className="absolute right-4 bottom-10 left-4 z-10 sm:right-auto sm:bottom-14 sm:left-8">
        {scene.narration}
      </Narration>
    </div>
  )
}

/** 檐角：屋面一片墨、檐口一笔、瓦当一排，檐下枋与柱，柱上挑出一根斜杆 */
function Eave({ wet }: { wet: MotionValue<number> }) {
  return (
    <svg viewBox="0 0 800 600" className="h-full w-full overflow-visible text-(--jh-ink)">
      <defs>
        <linearGradient id="jh-rain-roof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.42" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.74" />
        </linearGradient>
        <linearGradient id="jh-rain-roof-x" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="0.55" stopColor="currentColor" stopOpacity="0.04" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="jh-rain-post" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.85" />
          <stop offset="0.7" stopColor="currentColor" stopOpacity="0.6" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="jh-rain-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.09" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g style={{ filter: 'url(#jh-ink-rough)' }}>
        {/* 墙面淡淡一层 */}
        <path d="M0 302 H140 V600 H0 Z" fill="url(#jh-rain-wall)" />
        {/* 屋面：竖向一层浓淡，再横向压一层，靠檐角处留得更淡 */}
        <path d={ROOF_PATH} fill="url(#jh-rain-roof)" />
        <path d={ROOF_PATH} fill="url(#jh-rain-roof-x)" />
        {/* 瓦垄 */}
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.5">
          {TILE_ROWS.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
          ))}
        </g>
        {/* 屋脊、檐口两笔 */}
        <path
          d={RIDGE_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.7"
        />
        <path
          d={EAVE_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          opacity="0.9"
        />
        {/* 瓦当 */}
        <g fill="currentColor" opacity="0.85">
          {WADANG.map((w, i) => (
            <circle key={i} cx={w.cx} cy={w.cy} r="4.6" />
          ))}
        </g>
        {/* 檐下的斗拱与柱：两层短块托住檐口，柱子往下渐渐淡出 */}
        <g fill="currentColor" opacity="0.82">
          <rect x="116" y="286" width="72" height="11" rx="2" />
          <rect x="134" y="297" width="36" height="11" rx="2" />
        </g>
        <rect x="145" y="306" width="14" height="294" fill="url(#jh-rain-post)" />
        {/* 挑出的旗杆：斜斜地挂 */}
        <path
          d="M156 360 L448 308"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.9"
        />
      </g>
      {/* 檐角滴水：随雨停一起消失 */}
      <motion.g style={{ opacity: wet }} fill="var(--jh-water)">
        {DRIPS.map((d, i) => (
          <ellipse
            key={i}
            cx={d.cx}
            cy={d.cy}
            rx="2.8"
            ry="4.4"
            style={{ animation: `jh-drip ${d.duration}s ease-in ${d.delay}s infinite` }}
          />
        ))}
      </motion.g>
    </svg>
  )
}

/**
 * 酒旗：吊环套在旗杆离末端不远处（檐角坐标 426,312 → 53.25%, 52%，再往下挪一个吊环的高度），
 * 宽度用 --bw 定义，高是宽的 3.4 倍；外层负责入场，内层用 jh-flag 从顶端轻轻摆动。
 * 布面下半截被雨打湿，雨停后慢慢干。
 */
function Banner({ wet }: { wet: MotionValue<number> }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ type: 'spring', stiffness: 60, damping: 14, delay: 0.5 }}
      className="absolute top-[calc(52%+var(--bw)*0.12)] left-[53.25%] [--bw:18vw] sm:[--bw:7vw] lg:[--bw:min(6.6vw,104px)]"
    >
      <div
        className="origin-top -translate-x-1/2 rotate-[-2deg]"
        style={{ animation: 'jh-flag 3.6s ease-in-out infinite alternate' }}
      >
        <div className="relative h-[calc(var(--bw)*3.4)] w-(--bw)">
          <svg
            viewBox="0 0 100 340"
            className="absolute inset-0 h-full w-full overflow-visible text-(--jh-ink)"
          >
            <defs>
              <linearGradient id="jh-rain-wet" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--jh-water)" stopOpacity="0" />
                <stop offset="1" stopColor="var(--jh-water)" stopOpacity="0.5" />
              </linearGradient>
            </defs>
            {/* 吊环套在杆上，一根短绳系住横杆 */}
            <circle cx="50" cy="-12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M50 -8 V-3" stroke="currentColor" strokeWidth="1.6" />
            <rect x="-8" y="-3" width="116" height="4" rx="2" fill="currentColor" />
            {/* 布面：边缘略歪，像手描的 */}
            <path
              d="M3 4 C30 2 70 6 97 3 C99 80 96 200 98 337 C70 339 30 336 2 338 C4 250 1 120 3 4 Z"
              fill="var(--jh-mist)"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M84 12 C86 120 82 220 85 328"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.25"
            />
            <motion.rect
              x="4"
              y="190"
              width="92"
              height="146"
              fill="url(#jh-rain-wet)"
              style={{ opacity: wet }}
            />
          </svg>
          {/* 旗上一个「酒」字，取自本幕词句首字 */}
          <span
            className="jh-kai absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 leading-none text-(--jh-ink)"
            style={{ fontSize: 'calc(var(--bw) * 0.68)', filter: 'url(#jh-ink)' }}
          >
            酒
          </span>
        </div>
      </div>
    </motion.div>
  )
}
