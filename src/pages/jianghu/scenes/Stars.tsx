import { motion, useTransform, type MotionValue } from 'motion/react'
import { cn } from '@/lib/cn'
import { seededSequence } from '@/lib/seeded-random'
import type { SceneDef } from '../poem'
import { ChapterMark, Narration, Scene, VerticalVerse, type StorySceneProps } from '../primitives'

const STAR_COUNT = 72
const rnd = seededSequence(2024, STAR_COUNT * 5)
/** 星：位置、大小、闪烁节奏、以及它在曲子的第几分熄灭 */
const STARS = Array.from({ length: STAR_COUNT }, (_, i) => ({
  x: rnd[i * 5] * 100,
  y: rnd[i * 5 + 1] * 72,
  size: 1 + rnd[i * 5 + 2] * 2.2,
  duration: 2.2 + rnd[i * 5 + 3] * 3.4,
  delay: -rnd[i * 5 + 4] * 5,
  // 范围必须落在 [0, 1] 内（motion 会把它交给原生 ScrollTimeline）
  out: 0.22 + (((i * 37) % STAR_COUNT) / STAR_COUNT) * 0.64,
}))

/** 低空两道薄云，慢慢横移 */
const CLOUDS = [
  { className: 'bottom-[31%] left-[-12%] h-[5%] w-[72%]', duration: '46s', delay: '-9s' },
  { className: 'bottom-[39%] right-[-18%] h-[4%] w-[64%]', duration: '58s', delay: '-31s' },
]

/** 笛声：从笛口升起的几点墨，错开的延迟（秒） */
const NOTES = [0, 0.7, 1.4, 2.1, 2.8]

/** 屋脊与人影所在的画布（viewBox 1440×400）：人坐在这里，笛口就在它左边 */
const SEAT = { x: 1230, y: 233 }
const FLUTE_TIP = { x: SEAT.x - 92, y: SEAT.y - 83 }

/** 第六幕 · 残星：醉里横笛，一曲吹完，星星一颗颗熄灭，天边泛白 */
export function Stars({ scene, onActive }: StorySceneProps) {
  return (
    <Scene
      id={scene.id}
      tone={scene.tone}
      bg="--jh-night-2"
      prevBg="--jh-night"
      runway={2.2}
      label={`${scene.chapter} · ${scene.name}`}
      onActive={onActive}
    >
      {(progress) => <Stage progress={progress} scene={scene} />}
    </Scene>
  )
}

function Stage({ progress, scene }: { progress: MotionValue<number>; scene: SceneDef }) {
  // 输入范围都钉在 [0, 1] 两端：原生 ScrollTimeline 只在给定的关键帧之间插值，
  // 不钉住的话，走过最后一帧后浏览器会把值插回内联初始值
  const moon = useTransform(progress, [0, 0.6, 1], [0.9, 0.9, 0])
  const dawn = useTransform(progress, [0, 0.55, 1], [0, 0, 0.9])
  const skyGlow = useTransform(progress, [0, 1], [0.14, 0.04])

  return (
    <div className="relative h-full w-full">
      {/* 地平线附近的一点天光，好让屋脊与人影显出来 */}
      <motion.div
        aria-hidden
        style={{ opacity: skyGlow }}
        className="absolute inset-x-0 bottom-0 h-[55%] bg-[radial-gradient(ellipse_80%_70%_at_62%_100%,var(--jh-ink-night-3),transparent_70%)]"
      />

      {/* 低空薄云 */}
      {CLOUDS.map((c, i) => (
        <div
          key={i}
          aria-hidden
          className={cn(
            'absolute rounded-[50%] bg-(--jh-ink-night-3) opacity-[0.07] blur-[30px]',
            c.className,
          )}
          style={{ animation: `jh-mist ${c.duration} ease-in-out ${c.delay} infinite alternate` }}
        />
      ))}

      {/* 星 */}
      <div aria-hidden className="absolute inset-0 text-(--jh-moon)">
        {STARS.map((s, i) => (
          <Star key={i} star={s} progress={progress} />
        ))}
      </div>

      {/* 月牙：细细一弯，外面一圈很淡的月晕 */}
      <motion.div
        aria-hidden
        style={{ opacity: moon }}
        className="absolute top-[12%] right-[12%] w-[64px] text-(--jh-moon) sm:top-[14%] sm:right-[16%] sm:w-[92px]"
      >
        <div className="absolute -inset-[70%] rounded-full bg-current opacity-[0.08] blur-[60px]" />
        <svg viewBox="0 0 120 120" className="relative w-full">
          <defs>
            <mask id="jh-moon-mask">
              <rect width="120" height="120" fill="white" />
              <circle cx="72" cy="56" r="41" fill="black" />
            </mask>
          </defs>
          <circle cx="60" cy="60" r="42" fill="currentColor" mask="url(#jh-moon-mask)" />
        </svg>
      </motion.div>

      {/* 破晓：天边泛白（压在屋脊底下，地面仍是墨色，旁白就落在墨色上） */}
      <motion.div
        aria-hidden
        style={{ opacity: dawn }}
        className="absolute inset-x-0 bottom-0 h-[52%] bg-[linear-gradient(to_top,var(--jh-dawn)_0%,var(--jh-dawn)_18%,transparent_100%)]"
      />

      {/* 河岸、屋脊与吹笛的人：一整块横贯舞台的剪影，右边翘起飞檐，人坐在正脊上，笛子朝左 */}
      {/* 高度：桌面按宽度等比（人影随 vw 缩放），窄屏按高度铺满，左边多出的部分裁掉 */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[34svh] text-(--jh-night) sm:h-[max(27.8vw,45svh)]"
      >
        <svg viewBox="0 0 1440 400" preserveAspectRatio="xMaxYMax slice" className="h-full w-full">
          <defs>
            <linearGradient id="jh-stars-land" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.94" />
              <stop offset="0.5" stopColor="currentColor" stopOpacity="1" />
            </linearGradient>
            <linearGradient
              id="jh-stars-figure"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="-116"
              x2="0"
              y2="4"
            >
              <stop offset="0" stopColor="var(--jh-ink-night-3)" stopOpacity="1" />
              <stop offset="0.7" stopColor="var(--jh-ink-night-3)" stopOpacity="0.96" />
              <stop offset="1" stopColor="var(--jh-ink-night-3)" stopOpacity="0.72" />
            </linearGradient>
          </defs>
          {/* 岸与屋顶：左边是缓缓的河岸，右边墙上一道飞檐，翘角之后是正脊 */}
          <path
            d="M-80 292C160 290 400 286 620 282c120-2 230-6 342-8V260c-6-2-14-6-22-12 10 6 28 12 56 13 54 1 114-11 170-25 84-4 184-6 274-4V400H-80z"
            fill="url(#jh-stars-land)"
            style={{ filter: 'url(#jh-ink)' }}
          />
          {/* 月光擦亮的几道线：瓦面、正脊、岸线 */}
          <path
            d="M992 265c58 1 116-11 166-25M1306 236c44-2 88-3 130-3M380 291c110-3 220-6 320-9"
            fill="none"
            stroke="var(--jh-ink-night-3)"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.42"
          />
          {/* 人：盘坐在正脊上，一膝支起，身子微微前倾，横笛 */}
          <g transform={`translate(${SEAT.x} ${SEAT.y})`} fill="url(#jh-stars-figure)">
            <path d="M-8-78c-8 12-14 22-16 34-8-2-18-4-26 0-6 4-8 16-8 28 0 8 1 13 3 16L46 3c0-25-10-59-38-83z" />
            {/* 远臂 */}
            <path
              d="M-2-70L-42-60L-60-82"
              fill="none"
              stroke="var(--jh-ink-night-3)"
              strokeWidth="9"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.9"
            />
            {/* 铁笛 */}
            <path
              d="M-10-90L-92-83"
              fill="none"
              stroke="var(--jh-ink-night-2)"
              strokeWidth="4.5"
              strokeLinecap="round"
            />
            {/* 近臂 */}
            <path
              d="M4-68L-18-54L-28-84"
              fill="none"
              stroke="var(--jh-ink-night-3)"
              strokeWidth="9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* 头：微微低向笛子；发髻 */}
            <ellipse cx="-5" cy="-92" rx="13" ry="14.5" transform="rotate(-12 -5 -92)" />
            <circle cx="6" cy="-108" r="5.5" />
            {/* 两只手按在笛上 */}
            <circle cx="-28" cy="-86" r="4.6" fill="var(--jh-ink-night-3)" />
            <circle cx="-60" cy="-83" r="4.6" fill="var(--jh-ink-night-3)" />
          </g>
          {/* 笛声：几点墨从笛口升起 */}
          {NOTES.map((d, i) => (
            <circle
              key={i}
              cx={FLUTE_TIP.x - 4 - i * 6}
              cy={FLUTE_TIP.y - 4 - (i % 2) * 4}
              r={2.2 + (i % 3) * 0.9}
              fill="var(--jh-moon)"
              opacity="0"
              style={{
                animation: `jh-rise 3.8s ease-out ${d}s infinite`,
                transformBox: 'fill-box',
                transformOrigin: 'center',
              }}
            />
          ))}
        </svg>
      </div>

      {/* 文案 */}
      <ChapterMark
        chapter={scene.chapter}
        name={scene.name}
        className="absolute top-16 left-4 z-10 sm:left-8"
      />
      <div className="absolute inset-y-0 left-[8%] z-10 flex items-center sm:left-[12%] lg:left-[16%]">
        <VerticalVerse lines={scene.verses} />
      </div>
      <Narration className="absolute right-4 bottom-10 left-4 z-10 sm:right-auto sm:bottom-14 sm:left-8">
        {scene.narration}
      </Narration>
    </div>
  )
}

function Star({ star, progress }: { star: (typeof STARS)[number]; progress: MotionValue<number> }) {
  // 到了这颗星的时候，它就熄了；两端钉在 0 与 1，熄了就不再亮回来
  const opacity = useTransform(progress, [0, star.out, star.out + 0.12, 1], [1, 1, 0, 0])
  return (
    <motion.span style={{ left: `${star.x}%`, top: `${star.y}%`, opacity }} className="absolute">
      <span
        className="block rounded-full bg-current"
        style={{
          width: star.size,
          height: star.size,
          boxShadow: star.size > 2.4 ? '0 0 6px currentColor' : undefined,
          animation: `jh-twinkle ${star.duration}s ease-in-out ${star.delay}s infinite`,
        }}
      />
    </motion.span>
  )
}
