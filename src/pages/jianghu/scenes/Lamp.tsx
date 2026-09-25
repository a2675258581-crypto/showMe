import { motion, useTransform, type MotionValue } from 'motion/react'
import type { SceneDef } from '../poem'
import { ChapterMark, Narration, Scene, VerticalVerse, type StorySceneProps } from '../primitives'

/** 第五幕 · 灯前：夜。滚动时油灯渐渐亮起，灯光照出桌上的酒盏与剑，也照出墙上那幅两人举杯的旧画 */
export function Lamp({ scene, onActive }: StorySceneProps) {
  return (
    <Scene
      id={scene.id}
      tone={scene.tone}
      bg="--jh-night"
      prevBg="--jh-dusk"
      runway={1.6}
      label={`${scene.chapter} · ${scene.name}`}
      onActive={onActive}
    >
      {(progress) => <Stage progress={progress} scene={scene} />}
    </Scene>
  )
}

function Stage({ progress, scene }: { progress: MotionValue<number>; scene: SceneDef }) {
  // 灯先亮，桌上的东西跟着显出来，旧画最后才从墙上浮出
  const glow = useTransform(progress, [0, 0.35], [0, 0.85])
  const lit = useTransform(progress, [0.05, 0.4], [0, 0.9])
  const memory = useTransform(progress, [0.4, 0.8], [0, 0.34])
  const verseShadow = 'var(--jh-lamp)'

  return (
    <div className="relative h-full w-full">
      {/* 灯光：外层负责闪烁，内层负责随滚动亮起 */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[58%] left-[36%] sm:left-[38%]"
        style={{ animation: 'jh-flicker 3.4s ease-in-out infinite' }}
      >
        <motion.div
          style={{ opacity: glow }}
          className="size-[110vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,var(--jh-lamp)_0%,transparent_58%)] opacity-0 blur-[28px]"
        />
      </div>

      {/* 窗棂：右上角，只被灯光擦亮一点 */}
      <motion.svg
        aria-hidden
        viewBox="0 0 300 260"
        style={{ opacity: lit }}
        className="absolute top-[11%] right-[6%] w-[30vw] max-w-[220px] text-(--jh-ink-night-3) sm:top-[9%] sm:right-[5%] sm:w-[15vw]"
      >
        <g fill="none" stroke="currentColor" strokeWidth="2" opacity="0.38">
          <rect x="4" y="4" width="292" height="252" />
          <path d="M100 4V256M200 4V256M4 68H296M4 132H296M4 196H296" />
        </g>
      </motion.svg>

      {/* 墙上的旧画：两人举杯 */}
      <motion.svg
        aria-hidden
        viewBox="0 0 320 200"
        style={{ opacity: memory, filter: 'url(#jh-ink)' }}
        className="absolute top-[16%] left-[10%] w-[52vw] max-w-[360px] text-(--jh-lamp) sm:top-[20%] sm:left-[14%] sm:w-[26vw]"
      >
        <g fill="currentColor">
          {/* 左边的人 */}
          <circle cx="92" cy="58" r="15" />
          <path d="M78 76c-16 10-24 34-26 70l72 0c-2-30-8-50-22-64-8-6-16-8-24-6z" />
          <path
            d="M112 96c14-8 26-18 36-30"
            stroke="currentColor"
            strokeWidth="9"
            strokeLinecap="round"
            fill="none"
          />
          <path d="M142 54l16 4-6 18-14-3z" />
          {/* 右边的人 */}
          <circle cx="228" cy="60" r="15" />
          <path d="M242 78c16 10 24 34 26 70l-72 0c2-30 8-50 22-64 8-6 16-8 24-6z" />
          <path
            d="M208 98c-14-8-26-18-36-30"
            stroke="currentColor"
            strokeWidth="9"
            strokeLinecap="round"
            fill="none"
          />
          <path d="M178 56l-16 4 6 18 14-3z" />
          {/* 案几 */}
          <rect x="40" y="150" width="240" height="5" rx="2" />
        </g>
      </motion.svg>

      {/* 桌面：一盏灯、一只酒盏、一把剑 */}
      <motion.div
        aria-hidden
        style={{ opacity: lit }}
        className="absolute top-[66%] left-[14%] h-px w-[68%] bg-(--jh-ink-night-3) sm:left-[20%] sm:w-[56%]"
      />
      <motion.svg
        aria-hidden
        viewBox="0 0 120 160"
        style={{ opacity: lit }}
        className="absolute top-[66%] left-[36%] w-[64px] -translate-x-1/2 -translate-y-full text-(--jh-ink-night-3) sm:left-[38%] sm:w-[84px]"
      >
        {/* 灯座、灯柱、灯碗 */}
        <g fill="currentColor">
          <rect x="34" y="150" width="52" height="8" rx="3" />
          <rect x="56" y="104" width="8" height="48" />
          <path d="M28 96c0 10 14 16 32 16s32-6 32-16H28z" />
        </g>
        {/* 灯焰：核心更亮 */}
        <g
          style={{
            animation: 'jh-flicker 2.1s ease-in-out -0.8s infinite',
            transformOrigin: '60px 96px',
          }}
        >
          <path
            d="M60 46c-12 18-18 30-16 42 2 10 10 14 16 14s14-4 16-14c2-12-4-24-16-42z"
            fill="var(--jh-lamp)"
            opacity="0.95"
          />
          <path
            d="M60 68c-5 8-7 14-6 20 1 5 4 8 6 8s5-3 6-8c1-6-1-12-6-20z"
            fill="var(--jh-moon)"
          />
        </g>
      </motion.svg>
      <motion.svg
        aria-hidden
        viewBox="0 0 60 40"
        style={{ opacity: lit }}
        className="absolute top-[66%] left-[50%] w-[26px] -translate-y-full text-(--jh-ink-night-3) sm:left-[49%] sm:w-[34px]"
      >
        <path d="M6 8h48l-8 30H14z" fill="currentColor" />
        <rect x="4" y="4" width="52" height="5" rx="2" fill="currentColor" />
      </motion.svg>
      <motion.svg
        aria-hidden
        viewBox="0 0 320 30"
        style={{ opacity: lit }}
        className="absolute top-[66%] left-[52%] w-[30vw] max-w-[300px] -translate-y-full text-(--jh-ink-night-3) sm:left-[54%] sm:w-[20vw]"
      >
        {/* 带鞘的剑，斜搁在桌上 */}
        <g fill="currentColor" transform="rotate(-4 160 15)">
          <rect x="60" y="11" width="250" height="8" rx="4" />
          <rect x="52" y="4" width="10" height="22" rx="3" />
          <rect x="18" y="12" width="36" height="6" rx="3" />
          <circle cx="12" cy="15" r="5" />
        </g>
      </motion.svg>

      {/* 文案 */}
      <ChapterMark
        chapter={scene.chapter}
        name={scene.name}
        className="absolute top-16 left-4 z-10 sm:left-8"
      />
      <div className="absolute inset-y-0 right-[8%] z-10 flex items-center sm:right-[12%] lg:right-[16%]">
        <VerticalVerse
          lines={scene.verses}
          className="text-(--jh-fg)"
          style={{ textShadow: `0 0 26px color-mix(in srgb, ${verseShadow} 45%, transparent)` }}
        />
      </div>
      <Narration className="absolute right-4 bottom-10 left-4 z-10 sm:right-auto sm:bottom-14 sm:left-8">
        {scene.narration}
      </Narration>
    </div>
  )
}
