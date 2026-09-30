import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTime,
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

/** 远山两层（viewBox 1440×300，山脚齐地平线）：极淡，只是天地之间的一道影子 */
const HILLS: { d: string; opacity: number; depth: number }[] = [
  {
    d: 'M0 236 L120 214 Q200 176 290 204 L400 226 L520 200 Q610 150 700 186 L820 222 L940 198 Q1030 160 1120 190 L1240 218 L1340 204 L1440 224 L1440 300 L0 300 Z',
    opacity: 0.11,
    depth: 0.4,
  },
  {
    d: 'M0 268 L140 252 Q230 226 330 248 L470 266 L600 250 Q690 224 780 246 L900 264 L1010 250 Q1110 226 1200 244 L1320 262 L1440 254 L1440 300 L0 300 Z',
    opacity: 0.19,
    depth: 0.75,
  },
]

/** 风：五道长线从左到右掠过整幅画（viewBox 1440×900，横向拉伸铺满舞台） */
const GUSTS: { d: string; width: number; duration: number; delay: number }[] = [
  {
    d: 'M-80 170 C 220 118, 440 204, 720 150 S 1120 106, 1520 160',
    width: 1.3,
    duration: 5.4,
    delay: 0,
  },
  {
    d: 'M-80 330 C 260 288, 480 356, 760 300 S 1180 256, 1520 322',
    width: 1.9,
    duration: 6,
    delay: 1.6,
  },
  {
    d: 'M-80 486 C 220 444, 460 520, 740 466 S 1160 430, 1520 484',
    width: 1.4,
    duration: 4.8,
    delay: 3.1,
  },
  {
    d: 'M-80 596 C 240 556, 500 646, 820 590 S 1200 540, 1520 604',
    width: 2.1,
    duration: 5.6,
    delay: 0.9,
  },
  {
    d: 'M-80 772 C 300 734, 560 806, 860 760 S 1240 722, 1520 774',
    width: 1.2,
    duration: 6.4,
    delay: 2.4,
  },
]
/** 风线都从 x=-80 画到 1520：笔画走到哪，渐变就跟到哪 */
const GUST_X0 = -80
const GUST_W = 1600
/** 一笔风占整条路径的比例 */
const GUST_SPAN = 0.3

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** 地平线：一笔长横，手抖出 ±3 的起伏。细线不走位移滤镜——会碎成一格一格的台阶 */
const HORIZON =
  'M-40 44 C-15 43.3,61.7 40.2,110 40 C158.3 39.8,201.7 44,250 43 C298.3 42,348.3 34.8,400 34 C451.7 33.2,506.7 38.2,560 38 C613.3 37.8,666.7 33.2,720 33 C773.3 32.8,828.3 35.5,880 37 C931.7 38.5,980 41.7,1030 42 C1080 42.3,1131.7 38.5,1180 39 C1228.3 39.5,1270 44.8,1320 45 C1370 45.2,1453.3 40.8,1480 40'
/** 枯笔：断断续续的飞白 */
const DRY_DASH = '64 3 38 5 92 2 26 6 118 4'

/** 草丛：几笔短弧，都顺着风向右倾 */
const GRASS: { className: string; opacity: number; duration: number; delay: number }[] = [
  { className: 'left-[7%] bottom-[30%] h-[4.6%]', opacity: 0.55, duration: 2.3, delay: -0.4 },
  { className: 'left-[37%] bottom-[30%] h-[3.4%]', opacity: 0.5, duration: 1.9, delay: -1.1 },
  { className: 'left-[59%] bottom-[22.5%] h-[6.6%]', opacity: 0.7, duration: 2.6, delay: -0.7 },
  {
    className: 'left-[87%] bottom-[30%] hidden h-[4%] sm:block',
    opacity: 0.5,
    duration: 2.1,
    delay: -1.6,
  },
]
const BLADES = [
  'M6 40 C7 31 10 24 18 18',
  'M12 40 C13 29 18 21 30 14',
  'M18 40 C19 30 25 24 36 21',
  'M24 40 C24 33 27 28 32 27',
  'M9 40 C8 35 6 32 3 31',
]

/** 随风飘的碎叶与尘点：位置、大小、速度用固定种子生成，每次渲染一致 */
const SPECK_COUNT = 8
const SPECK_RAND = seededSequence(1024, SPECK_COUNT * 3)
const SPECKS = Array.from({ length: SPECK_COUNT }, (_, i) => ({
  top: 16 + SPECK_RAND[i * 3] * 58,
  size: 3 + SPECK_RAND[i * 3 + 1] * 4,
  duration: 8 + SPECK_RAND[i * 3 + 2] * 8,
  delay: -SPECK_RAND[i * 3 + 1] * 12,
  leaf: i % 3 !== 1,
}))

/** 第一幕 · 风满袂：空旷的平野，一道地平线，一个背剑的小小身影站在风里 */
export function Wind({ scene, onActive }: StorySceneProps) {
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
      prevBg="--jh-paper"
      runway={1.4}
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
          <div aria-hidden className="absolute inset-x-0 top-[48%] h-[22%] text-(--jh-ink)">
            {HILLS.map((h, i) => (
              <Hill key={i} hill={h} index={i} mx={smx} my={smy} progress={progress} />
            ))}
          </div>

          {/* 山脚的雾 */}
          <div
            aria-hidden
            className="absolute top-[63%] left-[-6%] h-[9%] w-[72%] rounded-[50%] bg-(--jh-mist) opacity-90 blur-[28px]"
            style={{ animation: 'jh-mist 36s ease-in-out -9s infinite alternate' }}
          />
          <div
            aria-hidden
            className="absolute top-[65%] right-[-14%] h-[7%] w-[56%] rounded-[50%] bg-(--jh-mist) opacity-80 blur-[26px]"
            style={{ animation: 'jh-mist 42s ease-in-out -25s infinite alternate' }}
          />

          <Ground />

          {/* 草：三丛立在地平线上，一丛靠前 */}
          {GRASS.map((g, i) => (
            <motion.div
              key={i}
              aria-hidden
              initial={{ opacity: 0 }}
              whileInView={{ opacity: g.opacity }}
              viewport={{ once: true }}
              transition={{ duration: 1.2, delay: 0.5 + i * 0.15, ease: EASE }}
              className={cn('absolute text-(--jh-ink-2)', g.className)}
            >
              <svg
                viewBox="0 0 60 40"
                className="h-full w-auto overflow-visible"
                style={{
                  transformOrigin: 'bottom center',
                  animation: `jh-sway ${g.duration}s ease-in-out ${g.delay}s infinite alternate`,
                }}
              >
                {BLADES.map((d, j) => (
                  <path
                    key={j}
                    d={d}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={j === 1 ? 1.9 : 1.5}
                    strokeLinecap="round"
                  />
                ))}
              </svg>
            </motion.div>
          ))}

          <Gusts progress={progress} mx={smx} reduce={!!reduce} />
          <Figure progress={progress} />

          {/* 碎叶与尘点 */}
          <div aria-hidden className="absolute inset-0 overflow-hidden opacity-55">
            {SPECKS.map((s, i) => (
              <div
                key={i}
                className="absolute left-0"
                style={{
                  top: `${s.top}%`,
                  animation: `jh-birds ${s.duration}s linear ${s.delay}s infinite`,
                }}
              >
                <div
                  className={s.leaf ? 'text-(--jh-leaf)' : 'text-(--jh-ink-2)'}
                  style={{
                    animation: `jh-leaf-sway ${1.6 + (i % 4) * 0.35}s ease-in-out ${-i * 0.37}s infinite alternate`,
                  }}
                >
                  {s.leaf ? (
                    <svg width={s.size * 2} height={s.size} viewBox="0 0 10 5">
                      <path d="M0 2.5 Q5 -1.5 10 2.5 Q5 6.5 0 2.5 Z" fill="currentColor" />
                    </svg>
                  ) : (
                    <span
                      className="block rounded-full bg-current"
                      style={{ width: s.size * 0.6, height: s.size * 0.6 }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 文字 */}
          <ChapterMark
            chapter={scene.chapter}
            name={scene.name}
            className="absolute top-16 left-4 z-10 sm:left-8"
          />
          <Verse progress={progress} lines={scene.verses} />
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
  // 鼠标视差 + 滚动视差：人往前走，远山向后退
  const mouseX = useTransform(mx, (v) => v * hill.depth * -22)
  const scrollX = useTransform(progress, [0, 1], [0, -16 * hill.depth])
  const x = useTransform(() => mouseX.get() + scrollX.get())
  const mouseY = useTransform(my, (v) => v * hill.depth * -8)
  const scrollY = useTransform(progress, [0, 1], [0, 10 * hill.depth])
  const y = useTransform(() => mouseY.get() + scrollY.get())
  const id = `jh-wind-hill-${index}`
  return (
    <motion.div
      className="absolute inset-0"
      style={{ x, y }}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: hill.opacity }}
      viewport={{ once: true }}
      transition={{ duration: 1.6, delay: 0.2 + index * 0.2, ease: EASE }}
    >
      <svg
        viewBox="0 0 1440 300"
        preserveAspectRatio="xMidYMax slice"
        className="h-full w-full"
        style={{ filter: 'url(#jh-ink-rough)' }}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.5" stopColor="currentColor" stopOpacity="1" />
            <stop offset="0.8" stopColor="currentColor" stopOpacity="0.45" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={hill.d} fill={`url(#${id})`} />
      </svg>
    </motion.div>
  )
}

/** 地平线：一笔长横，起笔重、收笔轻；线下一抹淡墨，平野上再补两笔枯笔（手机上只留近的一笔） */
function Ground() {
  return (
    <div aria-hidden className="absolute inset-x-0 top-[66%] h-[34%] text-(--jh-ink)">
      <div
        className="absolute inset-x-0 top-[12%] h-[34%]"
        style={{
          background:
            'linear-gradient(to bottom, color-mix(in srgb, currentColor 7%, transparent), transparent)',
        }}
      />
      <svg
        viewBox="0 0 1440 340"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id="jh-wind-horizon" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset="0.06" stopColor="currentColor" stopOpacity="0.7" />
            <stop offset="0.34" stopColor="currentColor" stopOpacity="0.92" />
            <stop offset="0.7" stopColor="currentColor" stopOpacity="0.62" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="jh-wind-dry" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset="0.25" stopColor="currentColor" stopOpacity="1" />
            <stop offset="0.7" stopColor="currentColor" stopOpacity="0.8" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d={HORIZON}
          fill="none"
          stroke="url(#jh-wind-horizon)"
          strokeWidth="2.6"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.8, delay: 0.1, ease: EASE }}
        />
        <path
          d="M110 120 C 240 108, 330 126, 430 116 S 560 108, 600 114"
          fill="none"
          stroke="url(#jh-wind-dry)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeDasharray={DRY_DASH}
          opacity="0.2"
        />
        <path
          className="hidden sm:block"
          d="M740 206 C 860 194, 960 212, 1060 202 S 1180 196, 1220 202"
          fill="none"
          stroke="url(#jh-wind-dry)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={DRY_DASH}
          opacity="0.15"
        />
      </svg>
    </div>
  )
}

/** 风的笔触：每道线循环「起笔 — 拉长 — 收尽」，像一阵阵掠过去的风 */
function Gusts({
  progress,
  mx,
  reduce,
}: {
  progress: MotionValue<number>
  mx: MotionValue<number>
  reduce: boolean
}) {
  const time = useTime()
  const mouseX = useTransform(mx, (v) => v * -14)
  const scrollX = useTransform(progress, [0, 1], [0, 44])
  const x = useTransform(() => mouseX.get() + scrollX.get())
  // 越往下翻，风越紧
  const opacity = useTransform(progress, [0, 1], [0.38, 0.6])
  return (
    <motion.div aria-hidden style={{ x, opacity }} className="absolute inset-0 text-(--jh-ink-2)">
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
      >
        {GUSTS.map((g, i) => (
          <Gust key={i} gust={g} index={i} time={time} reduce={reduce} />
        ))}
      </svg>
    </motion.div>
  )
}

/**
 * 一笔风：笔头从画外左侧起，掠过整幅，收在画外右侧。
 * 渐变用 userSpaceOnUse 跟着笔画两端走，所以这一截线永远是两头淡、中间实——像提按过的一笔，而不是一根截断的铁丝。
 */
function Gust({
  gust,
  index,
  time,
  reduce,
}: {
  gust: (typeof GUSTS)[number]
  index: number
  time: MotionValue<number>
  reduce: boolean
}) {
  // 0 → 1 的一个周期：慢起慢收，中段快；减少动态时各停在不同位置
  const phase = useTransform(time, (t) => {
    if (reduce) return 0.36 + index * 0.1
    const s = t / 1000 - gust.delay
    return s < 0 ? 0 : easeInOut((s / gust.duration) % 1)
  })
  const tail = useTransform(phase, (p) => clamp01(p * (1 + GUST_SPAN) - GUST_SPAN))
  const head = useTransform(phase, (p) => clamp01(p * (1 + GUST_SPAN)))
  const length = useTransform(() => head.get() - tail.get())
  const x1 = useTransform(tail, (f) => GUST_X0 + GUST_W * f)
  const x2 = useTransform(head, (f) => GUST_X0 + GUST_W * f)
  const id = `jh-wind-gust-${index}`
  return (
    <>
      <defs>
        <motion.linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x1} y1="0" x2={x2} y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.3" stopColor="currentColor" stopOpacity="1" />
          <stop offset="0.62" stopColor="currentColor" stopOpacity="1" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </motion.linearGradient>
      </defs>
      <motion.path
        d={gust.d}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth={gust.width}
        style={{ pathLength: length, pathOffset: tail }}
      />
    </>
  )
}

/**
 * 行者：斗笠、溜肩、被风压住的背（囊鼓在腰后）、鼓风的袖，背风一侧衣摆扬起；一柄剑斜负于背。
 * 剪影，不描细节。人先画正，再整个往风里倾 4°。
 */
function Figure({ progress }: { progress: MotionValue<number> }) {
  const x = useTransform(progress, [0, 1], [0, 26])
  const y = useTransform(progress, [0, 1], [0, -3])
  return (
    <motion.div
      aria-hidden
      style={{ x, y }}
      className="absolute bottom-[30%] left-[28%] h-[max(13%,88px)] -translate-x-1/2 text-(--jh-ink) dark:opacity-70"
    >
      <motion.div
        className="h-full"
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: 1.6, delay: 0.5, ease: EASE }}
      >
        <svg viewBox="0 0 130 200" className="h-full w-auto overflow-visible">
          {/* 脚下一抹淡墨 */}
          <ellipse cx="68" cy="193" rx="33" ry="2.6" fill="currentColor" opacity="0.14" />
          <g transform="rotate(-4 65 190)">
            {/* 不动的部分走一次毛边滤镜；衣摆一直在翻，放在滤镜外，免得每帧重新光栅化 */}
            <g style={{ filter: 'url(#jh-ink)' }}>
              {/* 剑：斜负于背，剑格藏在身后，只露右肩上的柄与腰后探出的鞘尾 */}
              <path
                d="M88 87 L47.2 178"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
              <path
                d="M89.5 84 L98 65"
                stroke="currentColor"
                strokeWidth="3.4"
                strokeLinecap="round"
              />
              <circle cx="98.3" cy="64.3" r="2.6" fill="currentColor" />
              {/* 身：颈、溜肩，右边袖子鼓着风、腰略收；迎风一侧被风压平，囊斜挎在背上、肩下鼓出一块 */}
              <path
                d="M60 54 L69 54 L70 64 C76 65 85 69 89 78 C94 95 86 114 90 130 C90 152 83 178 70 190 L62 191 L56 189 C54 170 53 150 54 124 C44 120 40 90 50 80 C50 72 55 65 60 64 Z"
                fill="currentColor"
              />
              {/* 斗笠：浅浅一个锥，檐比肩宽两三成 */}
              <path d="M65 33 Q54 42 39 55.5 Q66 62 91 52.5 Q77 40 65 33 Z" fill="currentColor" />
            </g>
            {/* 衣摆：背风一侧被吹起，下缘撕出几个口子，随风翻动 */}
            <g
              style={{
                transformBox: 'fill-box',
                transformOrigin: '50% 0%',
                animation: 'jh-flutter 1.3s ease-in-out infinite alternate',
              }}
            >
              <path
                d="M66 130 L90 130 C93 143 99 157 104 170 L99 169 L97 178 L91 175 L86 184 L79 181 L74 189 L68 190 L66 190 Z"
                fill="currentColor"
              />
            </g>
          </g>
        </svg>
      </motion.div>
    </motion.div>
  )
}

/** 词句在右侧，随滚动略往上浮 */
function Verse({ progress, lines }: { progress: MotionValue<number>; lines: string[] }) {
  const y = useTransform(progress, [0, 1], [0, -36])
  return (
    <motion.div
      style={{ y }}
      className="absolute inset-y-0 right-[8%] z-10 flex items-center sm:right-[12%] lg:right-[16%]"
    >
      <VerticalVerse lines={lines} delay={0.3} />
    </motion.div>
  )
}
