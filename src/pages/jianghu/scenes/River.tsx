import { motion, useReducedMotion, useTransform, type MotionValue } from 'motion/react'
import { cn } from '@/lib/cn'
import { seededSequence } from '@/lib/seeded-random'
import type { SceneDef } from '../poem'
import {
  ChapterMark,
  EASE,
  Narration,
  Scene,
  VerticalVerse,
  type StorySceneProps,
} from '../primitives'

/** 水平线在舞台的高度（%）：上面是暮色的天，下面整段都是江 */
const HORIZON = 46

/* ───────────── 水纹 ───────────── */

/**
 * 水纹画布：宽 2880 = 两个视口宽，前后两半完全相同，
 * 容器用 jh-flow 平移一半（reverse：向右，顺流）就能无缝循环。
 */
const FLOW_W = 2880
const FLOW_H = 120

interface Wave {
  /** 在江面里的高度（%） */
  top: number
  /** 振幅（画布单位） */
  amp: number
  /** 波长，必须整除 1440，两半才接得上 */
  period: number
  /** 起笔相位，避免六道线同起同落 */
  phase: number
  width: number
  opacity: number
  /** 一个循环的秒数：远处慢、近处快，就有了层次 */
  duration: number
  /** 虚线节奏：pathLength 归一化后每个波长 = 100，总和须整除半幅长度，循环时才无缝 */
  dash: string
}

/** 六道水纹：由远到近，振幅渐大、墨色渐浓、流得渐快 */
const WAVES: Wave[] = [
  { top: 8, amp: 5, period: 240, phase: 40, width: 1.3, opacity: 0.3, duration: 46, dash: '64 36' },
  {
    top: 19,
    amp: 9,
    period: 360,
    phase: 150,
    width: 1.6,
    opacity: 0.38,
    duration: 39,
    dash: '78 22 56 44',
  },
  {
    top: 32,
    amp: 14,
    period: 360,
    phase: 260,
    width: 1.95,
    opacity: 0.46,
    duration: 33,
    dash: '110 30 40 20',
  },
  {
    top: 47,
    amp: 20,
    period: 480,
    phase: 90,
    width: 2.3,
    opacity: 0.54,
    duration: 27,
    dash: '70 30',
  },
  {
    top: 64,
    amp: 27,
    period: 720,
    phase: 300,
    width: 2.75,
    opacity: 0.62,
    duration: 22,
    dash: '130 40 20 10',
  },
  {
    top: 83,
    amp: 34,
    period: 720,
    phase: 120,
    width: 3.2,
    opacity: 0.7,
    duration: 18,
    dash: '150 50',
  },
]

/** 用 Q + T 画一条正弦水纹：提前一个波长起笔、超出画布一个波长收笔，画布里任何一段都是完整周期 */
function wavePath(w: Wave) {
  const mid = FLOW_H / 2
  const half = w.period / 2
  const x0 = w.phase - w.period
  const cycles = FLOW_W / w.period + 2
  let d = `M${x0} ${mid} Q${x0 + w.period / 4} ${mid - w.amp} ${x0 + half} ${mid}`
  for (let k = 2; k <= cycles * 2; k++) d += ` T${x0 + half * k} ${mid}`
  return { d, length: cycles * 100 }
}

/* ───────────── 芦苇 ───────────── */

const REED_W = 420
const REED_H = 460

interface Reed {
  x: number
  /** 茎高 */
  h: number
  /** 顶端顺风向右偏出的距离 */
  lean: number
  /** 芦花长度 */
  plume: number
  width: number
  opacity: number
  duration: number
  delay: number
}

const REEDS: Reed[] = [
  { x: 54, h: 286, lean: 20, plume: 34, width: 1.4, opacity: 0.55, duration: 3.6, delay: -1.2 },
  { x: 92, h: 372, lean: 32, plume: 46, width: 1.7, opacity: 0.72, duration: 4.2, delay: -0.6 },
  { x: 126, h: 236, lean: 14, plume: 30, width: 1.3, opacity: 0.5, duration: 3.1, delay: -2.2 },
  { x: 164, h: 414, lean: 40, plume: 52, width: 1.9, opacity: 0.85, duration: 4.6, delay: -1.8 },
  { x: 212, h: 318, lean: 24, plume: 38, width: 1.5, opacity: 0.62, duration: 3.9, delay: -0.3 },
  { x: 256, h: 262, lean: 18, plume: 32, width: 1.4, opacity: 0.5, duration: 3.3, delay: -2.6 },
  { x: 298, h: 346, lean: 30, plume: 44, width: 1.7, opacity: 0.68, duration: 4, delay: -1.5 },
]

type Pt = [number, number]

/** 三次贝塞尔上 t 处的点：叶子要长在茎上 */
function cubicAt([p0, p1, p2, p3]: Pt[], t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ]
}

/** 一片叶：两条弧线合成的细长梭形 */
function blade([sx, sy]: Pt, dx: number, dy: number) {
  return (
    `M${sx} ${sy} C${sx + dx * 0.3} ${sy - dy * 0.6}, ${sx + dx * 0.72} ${sy - dy * 0.98}, ${sx + dx} ${sy - dy}` +
    ` C${sx + dx * 0.58} ${sy - dy * 0.7}, ${sx + dx * 0.22} ${sy - dy * 0.3}, ${sx} ${sy} Z`
  )
}

/** 芦花：茎顶一簇，像一枚饱蘸了墨、顺风微斜的笔锋；旁边再带两根细毛，才像絮 */
function plume([tx, ty]: Pt, len: number) {
  const px = tx + len * 0.5
  const py = ty - len * 0.82
  const body =
    `M${tx} ${ty} C${tx + 2} ${ty - len * 0.36}, ${px - 7} ${py + len * 0.16}, ${px} ${py}` +
    ` C${px - 1} ${py + len * 0.4}, ${tx - 5} ${ty - len * 0.2}, ${tx} ${ty} Z`
  const hairs =
    `M${tx + 1} ${ty - len * 0.12} Q${tx + len * 0.12} ${ty - len * 0.6}, ${px + len * 0.16} ${py - len * 0.04}` +
    ` M${tx + 2} ${ty - len * 0.2} Q${tx - len * 0.06} ${ty - len * 0.62}, ${px - len * 0.22} ${py - len * 0.12}`
  return { body, hairs }
}

function reedShapes(r: Reed) {
  const ctrl: Pt[] = [
    [r.x, REED_H],
    [r.x + r.lean * 0.08, REED_H - r.h * 0.42],
    [r.x + r.lean * 0.48, REED_H - r.h * 0.78],
    [r.x + r.lean, REED_H - r.h],
  ]
  const stalk = `M${ctrl[0].join(' ')} C${ctrl[1].join(' ')}, ${ctrl[2].join(' ')}, ${ctrl[3].join(' ')}`
  return {
    stalk,
    plume: plume(ctrl[3], r.plume),
    blades: [
      blade(cubicAt(ctrl, 0.4), r.h * 0.13, r.h * 0.1),
      blade(cubicAt(ctrl, 0.62), -r.h * 0.055, r.h * 0.075),
    ],
  }
}

/* ───────────── 芦花飞絮 ───────────── */

const SEED_N = 6
const SEED_RAND = seededSequence(4413, SEED_N * 3)
const SEEDS = Array.from({ length: SEED_N }, (_, i) => ({
  left: 9 + SEED_RAND[i * 3] * 12,
  bottom: 22 + SEED_RAND[i * 3 + 1] * 16,
  size: 2.5 + SEED_RAND[i * 3 + 2] * 2.5,
  duration: 10 + SEED_RAND[i * 3 + 1] * 6,
  delay: -SEED_RAND[i * 3] * 10,
}))

/* ───────────── 水上的字 ───────────── */

/** 「恩」「仇」两个字顺流漂下、散开：位置错落，速度不同，各自循环 */
const WORDS = [
  { ch: '恩', top: '67%', duration: 24, delay: -1.9, restLeft: '26vw' },
  { ch: '仇', top: '74%', duration: 18, delay: -4.7, restLeft: '58vw' },
] as const

/** 雁阵：五只，飞向落日 */
const GEESE = [
  [0, 0],
  [-22, 11],
  [-44, 24],
  [22, 11],
  [44, 24],
]

/** 第四幕 · 秋声：暮色里的江。恩仇两个字漂在水上，一会儿就散了；岸边的芦苇一直在响 */
export function River({ scene, onActive }: StorySceneProps) {
  return (
    <Scene
      id={scene.id}
      tone={scene.tone}
      bg="--jh-dusk"
      prevBg="--jh-paper"
      runway={1.5}
      label={`${scene.chapter} · ${scene.name}`}
      onActive={onActive}
    >
      {(progress) => <Stage progress={progress} scene={scene} />}
    </Scene>
  )
}

function Stage({ progress, scene }: { progress: MotionValue<number>; scene: SceneDef }) {
  const reduce = useReducedMotion()
  // 越往下滚：日头越沉、暮色越重、水上的字越淡
  const sunY = useTransform(progress, [0, 1], ['0svh', '9svh'])
  const sunFade = useTransform(progress, [0, 1], [1, 0.72])
  const glintFade = useTransform(progress, [0, 1], [1, 0.5])
  const dusk = useTransform(progress, [0, 1], [0, 0.19])
  const shoreY = useTransform(progress, [0, 1], [0, -8])
  const reedY = useTransform(progress, [0, 1], [0, 18])
  const wordFade = useTransform(progress, [0.55, 1], [1, 0.15])

  return (
    <div className="relative h-full w-full">
      {/* 天：顶上稍暗，贴着水平线有一抹余晖 */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0"
        style={{
          height: `${HORIZON}%`,
          background:
            'linear-gradient(to bottom, color-mix(in srgb, var(--jh-night) 12%, transparent), transparent 45%, color-mix(in srgb, var(--jh-lamp) 24%, transparent))',
        }}
      />

      {/* 落日：一轮朱砂，慢慢沉到远岸后面 */}
      <motion.div
        aria-hidden
        style={{ y: sunY, opacity: sunFade }}
        className="absolute top-[30%] left-[38%] sm:left-[64%]"
      >
        <div className="absolute size-[42vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,var(--jh-lamp)_0%,transparent_62%)] opacity-40" />
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          whileInView={{ opacity: 0.62, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.8, ease: EASE }}
          className="absolute size-[14vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--jh-seal) mix-blend-multiply sm:size-[10vmin] dark:mix-blend-normal"
          style={{ filter: 'url(#jh-ink)' }}
        />
      </motion.div>

      {/* 雁阵：很远，很小 */}
      <div
        aria-hidden
        className="absolute top-[19%] left-0 text-(--jh-fg-2) opacity-60"
        style={{ animation: 'jh-birds 96s linear -52s infinite' }}
      >
        <svg viewBox="-56 -4 112 34" className="w-[64px] sm:w-[96px]">
          {GEESE.map(([x, y], i) => (
            <path
              key={i}
              d={`M${x - 7} ${y + 4} C${x - 4} ${y}, ${x - 1.5} ${y}, ${x} ${y + 4} C${x + 1.5} ${y}, ${x + 4} ${y}, ${x + 7} ${y + 4}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          ))}
        </svg>
      </div>

      {/* 远岸：一线低矮的墨影，日头落到它后面 */}
      <motion.div
        aria-hidden
        // 岸线下缘贴住水平线
        style={{ y: shoreY, top: `${HORIZON - 7}%` }}
        className="absolute inset-x-0 h-[7%] text-(--jh-ink)"
      >
        <svg
          viewBox="0 0 1440 70"
          preserveAspectRatio="none"
          className="h-full w-full"
          style={{ filter: 'url(#jh-ink-rough)' }}
        >
          <defs>
            <linearGradient id="jh-river-shore" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.34" />
              <stop offset="0.7" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 48 L90 44 Q170 26 260 36 L380 46 Q470 32 560 40 L700 48 L820 44 Q930 22 1050 34 L1180 44 Q1290 36 1360 42 L1440 46 L1440 70 L0 70 Z"
            fill="url(#jh-river-shore)"
          />
        </svg>
        {/* 水平线上的一层薄雾 */}
        <div
          className="absolute bottom-[-36%] left-[16%] h-[76%] w-[64%] rounded-[50%] bg-(--jh-mist) opacity-40 blur-[30px]"
          style={{ animation: 'jh-mist 36s ease-in-out -9s infinite alternate' }}
        />
      </motion.div>

      {/* 江：一层淡淡的水色，六道水纹各自顺流而下 */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 text-(--jh-water) [--sw:2.4] sm:[--sw:1.5] lg:[--sw:1]"
        style={{ height: `${100 - HORIZON}%` }}
      >
        <div
          className="absolute inset-0 opacity-[0.16]"
          style={{ background: 'linear-gradient(to bottom, transparent, var(--jh-water) 70%)' }}
        />
        {/* 落日在水里的影子，被水纹切成一段一段 */}
        <motion.div
          style={{ opacity: glintFade }}
          className="absolute top-0 left-[38%] h-[52%] w-[9vmin] -translate-x-1/2 opacity-90 blur-[4px] sm:left-[64%] sm:w-[7vmin]"
        >
          <div
            className="h-full w-full"
            style={{
              background:
                'linear-gradient(to bottom, color-mix(in srgb, var(--jh-lamp) 55%, var(--jh-moon)), transparent)',
              maskImage:
                'repeating-linear-gradient(to bottom, black 0 5px, transparent 5px 13px), linear-gradient(to right, transparent, black 30%, black 70%, transparent)',
              maskComposite: 'intersect',
            }}
          />
        </motion.div>
        {WAVES.map((w, i) => (
          <WaveLine key={i} wave={w} index={i} />
        ))}
      </div>

      {/* 水上的字：漂过去，散掉 */}
      <motion.div aria-hidden style={{ opacity: wordFade }} className="absolute inset-0">
        {WORDS.map((w) => (
          <DriftWord key={w.ch} {...w} reduce={!!reduce} />
        ))}
      </motion.div>

      {/* 近岸的芦苇 */}
      <motion.div aria-hidden style={{ y: reedY }} className="absolute inset-0 text-(--jh-ink)">
        <div className="absolute bottom-0 left-0 h-[8%] w-[72%] sm:w-[48%]">
          <svg
            viewBox="0 0 1000 100"
            preserveAspectRatio="none"
            className="h-full w-full"
            style={{ filter: 'url(#jh-ink-rough)' }}
          >
            <defs>
              <linearGradient id="jh-river-bank" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.34" />
                <stop offset="0.55" stopColor="currentColor" stopOpacity="0.18" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0 30 C90 10, 180 4, 270 18 C330 28, 380 44, 460 50 C600 60, 780 88, 1000 100 L0 100 Z"
              fill="url(#jh-river-bank)"
            />
          </svg>
        </div>
        <motion.svg
          viewBox={`0 0 ${REED_W} ${REED_H}`}
          preserveAspectRatio="xMinYMax meet"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 1.6, delay: 0.2, ease: EASE }}
          className="absolute bottom-0 left-[1%] h-[27%] sm:h-[46%]"
          style={{ aspectRatio: `${REED_W} / ${REED_H}` }}
        >
          {REEDS.map((r, i) => {
            const s = reedShapes(r)
            return (
              <g
                key={i}
                fill="currentColor"
                opacity={r.opacity}
                style={{
                  transformBox: 'view-box',
                  transformOrigin: `${r.x}px ${REED_H}px`,
                  animation: `jh-sway ${r.duration}s ease-in-out ${r.delay}s infinite alternate`,
                }}
              >
                <path
                  d={s.stalk}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={r.width}
                  strokeLinecap="round"
                />
                {s.blades.map((d, j) => (
                  <path key={j} d={d} />
                ))}
                <path d={s.plume.body} />
                <path
                  d={s.plume.hairs}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={r.width * 0.55}
                  strokeLinecap="round"
                  opacity="0.75"
                />
              </g>
            )
          })}
        </motion.svg>
        {/* 芦花飞絮 */}
        {!reduce &&
          SEEDS.map((s, i) => (
            <motion.span
              key={i}
              className="absolute block rounded-full bg-(--jh-moon)"
              style={{ left: `${s.left}%`, bottom: `${s.bottom}%`, width: s.size, height: s.size }}
              animate={{
                x: [0, '12vw', '26vw', '40vw'],
                y: [0, '-5svh', '-9svh', '-15svh'],
                opacity: [0, 0.7, 0.6, 0],
              }}
              transition={{
                duration: s.duration,
                delay: s.delay,
                repeat: Infinity,
                ease: 'linear',
              }}
            />
          ))}
      </motion.div>

      {/* 暮色：随滚动一点点压下来，接住下一幕的夜 */}
      <motion.div
        aria-hidden
        style={{
          opacity: dusk,
          background: 'linear-gradient(to bottom, var(--jh-night), transparent 78%)',
        }}
        className="pointer-events-none absolute inset-0"
      />

      <ChapterMark
        chapter={scene.chapter}
        name={scene.name}
        // 暮色的纸比白天暗，幕次标记用深一档的墨才看得清
        className="absolute top-16 left-4 z-10 text-(--jh-fg-2) sm:left-8"
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

/** 一道水纹：容器两倍视口宽，整体向右平移一半后无缝接上 */
function WaveLine({ wave, index }: { wave: Wave; index: number }) {
  const { d, length } = wavePath(wave)
  const id = `jh-river-wave-${index}`
  // 画布随视口宽等比缩放，高度也按同一比例给
  const h = `${(200 * FLOW_H) / FLOW_W}vw`
  return (
    <div
      className="absolute left-0 w-[200vw]"
      style={{
        top: `${wave.top}%`,
        height: h,
        marginTop: `calc(${h} / -2)`,
        opacity: wave.opacity,
        animation: `jh-flow ${wave.duration}s linear infinite reverse`,
      }}
    >
      <svg viewBox={`0 0 ${FLOW_W} ${FLOW_H}`} preserveAspectRatio="none" className="h-full w-full">
        <defs>
          {/* 沿笔画方向的浓淡：像运笔时的提按，每半幅重复一次 */}
          <linearGradient
            id={id}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2={FLOW_W / 2}
            y2="0"
            spreadMethod="repeat"
          >
            <stop offset="0" stopColor="currentColor" stopOpacity="0.12" />
            <stop offset="0.26" stopColor="currentColor" stopOpacity="1" />
            <stop offset="0.5" stopColor="currentColor" stopOpacity="0.42" />
            <stop offset="0.76" stopColor="currentColor" stopOpacity="1" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <path
          d={d}
          pathLength={length}
          fill="none"
          stroke={`url(#${id})`}
          strokeLinecap="round"
          strokeDasharray={wave.dash}
          style={{ strokeWidth: `calc(${wave.width}px * var(--sw))` }}
        />
      </svg>
    </div>
  )
}

/** 水上的一个字：从左漂到右，中途起伏、微微转动，最后晕开散掉 */
function DriftWord({
  ch,
  top,
  duration,
  delay,
  restLeft,
  reduce,
}: (typeof WORDS)[number] & { reduce: boolean }) {
  const cls = 'jh-kai absolute leading-none text-[clamp(52px,10vw,150px)] text-(--jh-fg)'
  if (reduce) {
    return (
      <span className={cn(cls, 'opacity-45')} style={{ top, left: restLeft }}>
        {ch}
      </span>
    )
  }
  const loop = { duration, delay, repeat: Infinity }
  return (
    <motion.span
      className={cn(cls, 'left-0 will-change-transform')}
      style={{ top }}
      animate={{
        x: ['-10vw', '110vw'],
        y: [0, 6, -4, 0],
        rotate: [-4, 3, -2, -4],
        scale: [1, 1, 1, 1.12],
        opacity: [0, 0.6, 0.6, 0],
        filter: ['blur(0px)', 'blur(0px)', 'blur(0px)', 'blur(9px)'],
      }}
      transition={{
        x: { ...loop, ease: 'linear' },
        y: { ...loop, ease: 'easeInOut' },
        rotate: { ...loop, ease: 'easeInOut' },
        scale: { ...loop, ease: 'easeIn', times: [0, 0.12, 0.72, 1] },
        opacity: { ...loop, ease: 'linear', times: [0, 0.12, 0.72, 1] },
        filter: { ...loop, ease: 'easeIn', times: [0, 0.12, 0.72, 1] },
      }}
    >
      {ch}
    </motion.span>
  )
}
