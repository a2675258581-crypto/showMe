import { motion, useTransform, type MotionValue } from 'motion/react'
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

const NOTES = [0, 0.7, 1.4, 2.1, 2.8]

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
  const moon = useTransform(progress, [0.6, 1], [0.9, 0])
  const dawn = useTransform(progress, [0.55, 1], [0, 0.9])
  const skyGlow = useTransform(progress, [0, 1], [0.14, 0.04])

  return (
    <div className="relative h-full w-full">
      {/* 地平线附近的一点天光，好让屋脊与人影显出来 */}
      <motion.div
        aria-hidden
        style={{ opacity: skyGlow }}
        className="absolute inset-x-0 bottom-0 h-[55%] bg-[radial-gradient(ellipse_80%_70%_at_50%_100%,var(--jh-ink-night-3),transparent_70%)]"
      />

      {/* 星 */}
      <div aria-hidden className="absolute inset-0 text-(--jh-moon)">
        {STARS.map((s, i) => (
          <Star key={i} star={s} progress={progress} />
        ))}
      </div>

      {/* 月牙 */}
      <motion.svg
        aria-hidden
        viewBox="0 0 120 120"
        style={{ opacity: moon }}
        className="absolute top-[12%] right-[12%] w-[64px] text-(--jh-moon) sm:top-[14%] sm:right-[16%] sm:w-[92px]"
      >
        <defs>
          <mask id="jh-moon-mask">
            <rect width="120" height="120" fill="white" />
            <circle cx="74" cy="52" r="40" fill="black" />
          </mask>
        </defs>
        <circle cx="60" cy="60" r="42" fill="currentColor" mask="url(#jh-moon-mask)" />
      </motion.svg>

      {/* 屋脊与吹笛的人：坐在右下角，笛子朝左 */}
      {/* 手机上人影抬高一点，底下补一道地面，免得压住旁白 */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[9%] bg-(--jh-night) sm:hidden" />
      <div
        aria-hidden
        className="absolute right-0 bottom-[9%] w-[64vw] max-w-[640px] sm:bottom-0 sm:w-[46vw]"
      >
        <svg
          viewBox="0 0 640 300"
          className="w-full text-(--jh-night)"
          preserveAspectRatio="xMaxYMax meet"
        >
          {/* 屋脊：一道起翘的屋檐线 */}
          <path
            d="M0 300V236c60-14 120-22 190-26 90-6 170-2 250-10 70-8 130-24 200-52V300z"
            fill="currentColor"
          />
          <path
            d="M120 214c-30-2-60 2-92 10M420 202c60-6 118-22 170-48"
            fill="none"
            stroke="var(--jh-ink-night-3)"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.6"
          />
          {/* 人：盘坐，横笛 */}
          <g transform="translate(300 74)" fill="var(--jh-ink-night-3)" opacity="0.92">
            <circle cx="112" cy="26" r="15" />
            <circle cx="118" cy="10" r="6" />
            <path d="M96 44c-18 12-30 40-32 84 40 6 90 6 128 0-4-38-14-62-32-80-14-12-44-14-64-4z" />
            <path
              d="M92 64C70 54 48 50 22 50"
              stroke="var(--jh-ink-night-3)"
              strokeWidth="11"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M104 40L4 34"
              stroke="var(--jh-ink-night-2)"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <path d="M40 128c-14 6-26 8-40 8h180c-14 0-28-2-44-8z" />
          </g>
        </svg>
        {/* 笛声：几点墨从笛口升起 */}
        {NOTES.map((d, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-(--jh-moon) opacity-0"
            style={{
              left: `${4 + i * 3}%`,
              bottom: '58%',
              width: 4 + (i % 3) * 2,
              height: 4 + (i % 3) * 2,
              animation: `jh-rise 3.8s ease-out ${d}s infinite`,
            }}
          />
        ))}
      </div>

      {/* 破晓：天边泛白 */}
      <motion.div
        aria-hidden
        style={{ opacity: dawn }}
        className="absolute inset-x-0 bottom-0 h-[48%] bg-[linear-gradient(to_top,var(--jh-dawn),transparent)]"
      />

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
  // 到了这颗星的时候，它就熄了
  const opacity = useTransform(progress, [star.out, star.out + 0.12], [1, 0])
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
