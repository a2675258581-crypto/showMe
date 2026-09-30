import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { FINALE, POEM } from '../poem'
import { ChapterMark, EASE, Narration, Scene, Seal } from '../primitives'

/** 终章：天亮了。一幅手卷从右往左徐徐展开，全词竖排其上；下面是词牌说明、旁白与去处 */
export function Finale({
  onActive,
  onAgain,
}: {
  onActive: (id: string) => void
  /** 「再读一遍」：滚回卷首 */
  onAgain: () => void
}) {
  return (
    <Scene
      id="finale"
      tone="dawn"
      bg="--jh-dawn"
      prevBg="--jh-dawn"
      sticky={false}
      label={`${FINALE.chapter} · ${FINALE.name}`}
      onActive={onActive}
    >
      <DawnSky />
      <ChapterMark
        chapter={FINALE.chapter}
        name={FINALE.name}
        className="absolute top-16 left-4 z-10 sm:left-8"
      />
      <div className="relative mx-auto flex min-h-[100svh] w-full max-w-[1080px] flex-col items-center px-4 pt-36 pb-24 sm:px-8 sm:pt-44 sm:pb-32">
        <HandScroll />

        <div className="relative mt-14 flex max-w-[34em] flex-col items-center gap-2 text-center">
          {POEM.notes.map((n, i) => (
            <motion.p
              key={n}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, delay: 0.1 + i * 0.15, ease: EASE }}
              className="jh-song text-[12px] leading-relaxed tracking-[0.06em] text-pretty text-(--jh-fg-3) sm:text-[13px]"
            >
              {n}
            </motion.p>
          ))}
        </div>

        <Narration className="relative mt-14 text-center">{FINALE.narration}</Narration>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, delay: 0.3, ease: EASE }}
          className="relative mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4"
        >
          <button
            type="button"
            onClick={onAgain}
            className="jh-song inline-flex h-11 items-center rounded-full bg-(--jh-ink) px-8 text-[14px] tracking-[0.25em] text-(--jh-paper) transition-transform duration-300 hover:scale-[1.03] active:scale-95"
          >
            {FINALE.again}
          </button>
          <Link
            to="/"
            className="jh-song inline-flex h-11 items-center rounded-full border border-(--jh-ink-3) px-8 text-[14px] tracking-[0.25em] text-(--jh-fg) transition-colors duration-300 hover:bg-(--jh-paper-2)"
          >
            {FINALE.back}
          </Link>
        </motion.div>

        <p className="jh-song relative mt-20 max-w-[36em] text-center text-[11px] leading-relaxed text-pretty text-(--jh-fg-3) sm:text-[12px]">
          {FINALE.credits}
        </p>
      </div>
    </Scene>
  )
}

/** 破晓：一轮淡日偏在右上，脚下一道远山的轮廓线和一带薄雾，天亮得像一张新纸 */
function DawnSky() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[52svh] overflow-hidden"
    >
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 2.4, ease: EASE }}
        className="absolute top-[5%] left-[62%] size-[16vmin] max-sm:left-[58%]"
      >
        <div className="absolute -inset-[70%] rounded-full bg-[radial-gradient(circle,var(--jh-lamp),transparent_62%)] opacity-25 blur-[40px]" />
        <div className="absolute inset-0 rounded-full bg-(--jh-moon) opacity-60 blur-[1.5px]" />
      </motion.div>
      {/* 远山：只有一道很淡的轮廓线 */}
      <svg
        viewBox="0 0 1440 160"
        preserveAspectRatio="none"
        className="absolute inset-x-0 top-[22%] h-[18%] w-full text-(--jh-ink-3)"
      >
        <path
          d="M0 118 L120 104 Q180 92 240 106 L360 84 Q410 70 470 92 L580 70 Q630 56 690 78 L800 62 Q840 54 890 74 L1010 92 L1120 70 Q1170 60 1220 82 L1330 100 L1440 88"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
          opacity="0.32"
          style={{ filter: 'url(#jh-ink)' }}
        />
      </svg>
      <div
        className="absolute top-[30%] left-[-10%] h-[10%] w-[120%] rounded-[50%] bg-(--jh-mist) opacity-70 blur-[30px]"
        style={{ animation: 'jh-mist 36s ease-in-out infinite alternate' }}
      />
    </div>
  )
}

const UNROLL = { duration: 2.4, ease: EASE }

/**
 * 手卷：右端是固定的天杆，左端的轴随着画心从右往左展开一路推过去。
 * 画心用 clip-path 从右边露出来，词句竖排、自右而左，正好顺着展卷的方向读。
 */
function HandScroll() {
  return (
    <motion.figure
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.25 }}
      className="relative w-[min(92vw,760px)] px-2"
    >
      <motion.div
        variants={{
          hidden: { clipPath: 'inset(0 0 0 100%)' },
          show: { clipPath: 'inset(0 0 0 0%)', transition: UNROLL },
        }}
        className="relative border-y border-(--jh-ink-3)/40 bg-(--jh-paper-2) px-4 pt-9 pb-20 sm:px-10 sm:pt-12 sm:pb-12"
      >
        {/* 绫边：画心四周淡淡一圈 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-3 border border-(--jh-ink-3)/30 sm:inset-5"
        />
        {/* 列宽 = 行高：手机 12 列约 300px、小平板约 500px、桌面约 640px，都要装进画心 */}
        <div className="jh-kai jh-vertical mx-auto h-[10.4em] text-[16px] leading-[1.4] tracking-[0.14em] text-(--jh-fg) sm:text-[21px] sm:leading-[1.55] md:text-[26px] md:leading-[1.6] lg:text-[30px] lg:leading-[1.7]">
          <p className="text-[1.12em] tracking-[0.22em]">
            {POEM.tune}
            {/* 间隔号楷书子集里没有，用宋体的 */}
            <span className="jh-song"> · </span>
            {POEM.title}
          </p>
          {POEM.stanzas.map((lines, si) => (
            <div key={si} style={{ marginBlockStart: si === 0 ? '0.45em' : '0.9em' }}>
              {lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ))}
          {/* 最后一列落款：印章压在词尾的下方；手机上列宽不够，印章改盖在画心左下角 */}
          <div
            className="hidden h-full flex-col justify-end pb-1 sm:flex"
            style={{ writingMode: 'horizontal-tb', marginBlockStart: '0.7em' }}
          >
            <Seal text={FINALE.seal} size={54} delay={2.2} />
          </div>
        </div>
        <Seal
          text={FINALE.seal}
          size={48}
          delay={2.2}
          className="absolute bottom-6 left-6 sm:hidden"
        />
      </motion.div>
      {/* 天杆：固定在右端 */}
      <Roller className="right-0 translate-x-1/2" />
      {/* 轴：跟着画心展开的边缘从右推到左 */}
      <motion.div
        variants={{
          hidden: { left: '100%' },
          show: { left: '0%', transition: UNROLL },
        }}
        className="absolute inset-y-0 left-0"
      >
        <Roller className="left-0 -translate-x-1/2" />
      </motion.div>
    </motion.figure>
  )
}

function Roller({ className }: { className: string }) {
  return (
    <div
      aria-hidden
      className={`absolute -inset-y-3 w-3 rounded-full bg-(--jh-ink) shadow-[0_6px_18px_rgb(0_0_0/0.18)] ${className}`}
    >
      <span className="absolute -top-2 left-1/2 size-5 -translate-x-1/2 rounded-full bg-(--jh-ink-2)" />
      <span className="absolute -bottom-2 left-1/2 size-5 -translate-x-1/2 rounded-full bg-(--jh-ink-2)" />
    </div>
  )
}
