import { motion, useTransform, type MotionValue } from 'motion/react'
import type { SceneDef } from '../poem'
import { ChapterMark, Narration, Scene, VerticalVerse, type StorySceneProps } from '../primitives'

/* ───────── 案上的几何（viewBox 1000×320）：桌沿在 y=240，灯焰在 (330, ~100) ─────────
 * 所有剪影都是单条路径、子路径同向（顺时针），叠在一起也不会挖出空洞。 */

/** 桌沿：一笔由粗到细（约 6 → 3），起笔略顿，收笔提起 */
const TABLE_STROKE =
  'M6 240 C6 237.6 9 236.8 14 237 C340 236.6 640 237.4 900 238.2 C940 238.5 975 239 996 239.4 L996 240.2 C975 240.7 940 241.2 900 241.4 C640 242.2 340 243 14 243 C9 243.2 6 242.4 6 240 Z'
/** 桌沿下的阴影：桌面挡住灯光，以灯座为中心的半个椭圆，往四周都洇到没有 */
const TABLE_WASH = 'M-190 241 A520 96 0 0 0 850 241 Z'

/** 豆形油灯：浅盘、细柄（中间一节）、阔足，三段接成一个剪影 */
const LAMP_BODY = [
  'M292 108 L368 108 C366 115 357 122 347 125 C339 127 321 127 313 125 C303 122 294 115 292 108 Z',
  'M325 122 L335 122 C335 138 335 150 336 156 C340 157 340 167 336 168 C335 180 335 192 335 206 L325 206 C325 192 325 180 324 168 C320 167 320 157 324 156 C325 150 325 138 325 122 Z',
  'M325 200 L335 200 C336 218 352 230 370 238 C372 239 371 240 369 240 L291 240 C289 240 288 239 290 238 C308 230 324 218 325 200 Z',
].join(' ')
/** 灯焰：一滴水倒过来；焰心更亮 */
const FLAME =
  'M330 64 C320 80 314 92 315 102 C316 112 323 117 330 117 C337 117 344 112 345 102 C346 92 340 80 330 64 Z'
const FLAME_CORE =
  'M330 88 C325 97 323 103 324 108 C325 113 328 115 330 115 C332 115 335 113 336 108 C337 103 335 97 330 88 Z'

/** 酒盏：阔口浅腹，小圈足 */
const CUP =
  'M440 214 L500 214 C498 224 489 230 479 231.5 L481 240 L459 240 L461 231.5 C451 230 442 224 440 214 Z'

/** 剑：剑首（扁圆一片）、缠柄、剑格、微微弯起的鞘，横搁在桌上 */
const SWORD = [
  'M551 222 L559 222 L559 238 L551 238 C548 236 548 224 551 222 Z',
  'M559 230 L603 229 L603 238 L559 238 Z',
  'M601 220 L613 219.5 L614 246 L602 246.5 Z',
  'M613 228 C690 227.5 770 227.5 833 227 C836 227.7 836 231.5 833 232 C770 234.5 690 236.5 613 238 Z',
].join(' ')
/** 剑穗：从剑首垂下，搭过桌沿 */
const TASSEL_CORD = 'M550 236 C545 241 540 250 538 261'
const TASSEL =
  'M538 263 C535 271 532 283 531 296 C534 299 537 295 539 298 C541 295 544 299 546 296 C545 283 541 271 538 263 Z'

/** 窗棂（viewBox 300×260）：冰裂纹，几道裂线以不同角度交错，每个节点都是三岔 */
const LATTICE =
  'M110 18 L92 84 L18 128 M92 84 L160 104 L200 86 L230 70 L282 52 M230 70 L245 18 M160 104 L150 142 L140 180 L60 200 L18 210 M140 180 L200 215 L282 190 M200 215 L190 242 M60 200 L70 242 M200 86 L212 150 L282 158 M212 150 L150 142'

/**
 * 第五幕 · 灯前：夜。滚动时油灯渐渐亮起，灯光照出案上的酒盏与剑，
 * 墙上那个褪了色的「盟」字最后才浮出来。
 */
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
  // 灯先亮，案上的东西跟着显出来，墙上的字最后才浮出
  // 输入区间都显式铺满 [0, 1]：motion 会把这些值交给原生 ScrollTimeline，
  // 关键帧没盖住的区段会插回元素的初始值（灯会在末尾重新熄掉），所以两端都要钉死
  const glow = useTransform(progress, [0, 0.35, 1], [0, 0.85, 0.85])
  const lit = useTransform(progress, [0, 0.05, 0.4, 1], [0, 0, 0.9, 0.9])
  const memory = useTransform(progress, [0, 0.4, 0.8, 1], [0, 0, 0.34, 0.34])

  return (
    <div className="relative h-full w-full">
      {/* 案：灯光、桌沿与案上三物共用一个坐标系，桌沿（y=240/320）对齐在舞台 66% 处 */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[70%] left-[-8vw] aspect-[1000/320] w-[112vw] -translate-y-3/4 sm:top-[66%] sm:left-[20%] sm:w-[56%]"
      >
        {/* 灯光：外层负责闪烁，内层负责随滚动亮起；锚点就是灯焰 */}
        <div
          className="absolute top-[31%] left-[33%] origin-top-left"
          style={{ animation: 'jh-flicker 3.4s ease-in-out infinite' }}
        >
          <motion.div
            style={{ opacity: glow }}
            className="size-[110vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,var(--jh-lamp)_0%,transparent_58%)] opacity-0 blur-[28px]"
          />
        </div>

        <motion.svg
          viewBox="0 0 1000 320"
          style={{ opacity: lit }}
          className="absolute inset-0 h-full w-full overflow-visible text-(--jh-ink-night-3)"
        >
          <defs>
            {/* 灯光给物件上的色：灯身背光是剪影，盏与剑首朝灯的一面亮一些，剑尖没入暗处 */}
            <radialGradient
              id="jh-lamp-lit"
              gradientUnits="userSpaceOnUse"
              cx="330"
              cy="104"
              r="520"
            >
              <stop offset="0" stopColor="var(--jh-ink-night-3)" />
              <stop offset="0.16" stopColor="var(--jh-ink-night-3)" />
              <stop offset="0.28" stopColor="var(--jh-ink-night-2)" />
              <stop offset="0.5" stopColor="var(--jh-ink-night-3)" />
              <stop offset="1" stopColor="var(--jh-ink-night-3)" stopOpacity="0.75" />
            </radialGradient>
            <radialGradient id="jh-lamp-halo">
              <stop offset="0" stopColor="var(--jh-lamp)" stopOpacity="0.6" />
              <stop offset="0.45" stopColor="var(--jh-lamp)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--jh-lamp)" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="jh-lamp-table" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--jh-ink-night-2)" stopOpacity="0.3" />
              <stop offset="0.33" stopColor="var(--jh-ink-night-2)" stopOpacity="0.9" />
              <stop offset="0.7" stopColor="var(--jh-ink-night-2)" stopOpacity="0.55" />
              <stop offset="1" stopColor="var(--jh-ink-night-2)" stopOpacity="0.3" />
            </linearGradient>
            {/* 阴影按包围盒取椭圆：圆心在桌沿上、灯座正下，横向 520、纵向 48 之外就没有了 */}
            <radialGradient id="jh-lamp-wash" cx="0.5" cy="0" r="0.5">
              <stop offset="0" stopColor="var(--jh-night)" stopOpacity="0.65" />
              <stop offset="0.5" stopColor="var(--jh-night)" stopOpacity="0.3" />
              <stop offset="1" stopColor="var(--jh-night)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* 焰光与灯焰：画在灯身后面，盘沿正好挡住焰根；这一组会动，不挂滤镜 */}
          <g
            style={{
              animation: 'jh-flicker 2.1s ease-in-out -0.8s infinite',
              transformOrigin: '330px 116px',
            }}
          >
            <circle cx="330" cy="98" r="52" fill="url(#jh-lamp-halo)" />
            <path d={FLAME} fill="var(--jh-lamp)" opacity="0.95" />
            <path d={FLAME_CORE} fill="var(--jh-moon)" opacity="0.9" />
          </g>

          {/* 案上三物：灯、盏、剑 */}
          <g style={{ filter: 'url(#jh-ink)' }} fill="url(#jh-lamp-lit)">
            <path d={LAMP_BODY} />
            <path d={CUP} />
            <path d={SWORD} />
          </g>

          {/* 桌沿一笔 + 桌沿下的阴影；空矩形只为撑大滤镜区域，免得毛边被裁掉 */}
          <g style={{ filter: 'url(#jh-ink-rough)' }}>
            <rect x="0" y="180" width="1000" height="140" fill="none" />
            <path d={TABLE_WASH} fill="url(#jh-lamp-wash)" />
            <path d={TABLE_STROKE} fill="url(#jh-lamp-table)" />
          </g>

          {/* 剑穗：这一幕唯一的一点朱砂 */}
          <g style={{ filter: 'url(#jh-ink)' }} className="text-(--jh-seal)">
            <rect x="500" y="200" width="80" height="120" fill="none" />
            <path
              d={TASSEL_CORD}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <circle cx="538" cy="261" r="3.4" fill="currentColor" />
            <path d={TASSEL} fill="currentColor" />
          </g>
        </motion.svg>
      </div>

      {/* 窗棂：冰裂纹，窗纸被屋里的灯光映得有一点点暖 */}
      <motion.svg
        aria-hidden
        viewBox="0 0 300 260"
        style={{ opacity: lit }}
        className="absolute top-[10%] right-[10%] w-[26vw] max-w-[220px] text-(--jh-ink-night-3) sm:top-[9%] sm:right-[22%] sm:w-[15vw]"
      >
        <rect x="18" y="18" width="264" height="224" fill="var(--jh-lamp)" opacity="0.06" />
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: 'url(#jh-ink)' }}
        >
          <rect x="4" y="4" width="292" height="252" strokeWidth="3" opacity="0.7" />
          <rect x="18" y="18" width="264" height="224" strokeWidth="1.6" opacity="0.55" />
          <path d={LATTICE} strokeWidth="1.5" opacity="0.5" />
        </g>
      </motion.svg>

      {/* 墙上的旧盟：一个「盟」字，褪色到只剩痕迹（0.34 × 0.45 ≈ 0.15） */}
      <motion.div
        aria-hidden
        style={{ opacity: memory }}
        className="pointer-events-none absolute top-[17%] left-[8%] sm:top-[13%] sm:left-[19%]"
      >
        <span
          className="jh-kai block leading-none text-(--jh-lamp) opacity-45 select-none"
          style={{ fontSize: 'clamp(120px, 22vw, 300px)', filter: 'url(#jh-ink) blur(0.6px)' }}
        >
          盟
        </span>
      </motion.div>

      {/* 文案 */}
      <ChapterMark
        chapter={scene.chapter}
        name={scene.name}
        className="absolute top-16 left-4 z-10 text-(--jh-fg-2) sm:left-8"
      />
      <div className="absolute inset-y-0 right-[8%] z-10 flex items-center sm:right-[12%] lg:right-[16%]">
        <VerticalVerse
          lines={scene.verses}
          className="text-(--jh-fg)"
          style={{ textShadow: '0 0 26px color-mix(in srgb, var(--jh-lamp) 45%, transparent)' }}
        />
      </div>
      <Narration className="absolute right-4 bottom-10 left-4 z-10 sm:right-auto sm:bottom-14 sm:left-8">
        {scene.narration}
      </Narration>
    </div>
  )
}
