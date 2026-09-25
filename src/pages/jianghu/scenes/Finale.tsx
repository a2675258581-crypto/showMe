import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { FINALE, POEM } from '../poem'
import { ChapterMark, EASE, Narration, Scene, Seal } from '../primitives'

/** 终章：天亮了，一幅立轴徐徐展开，全词竖排其上；下面是词牌说明、旁白与去处 */
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
      prevBg="--jh-night-2"
      sticky={false}
      label={`${FINALE.chapter} · ${FINALE.name}`}
      onActive={onActive}
    >
      <div className="relative mx-auto flex min-h-[100svh] w-full max-w-[1080px] flex-col items-center px-4 pt-32 pb-24 sm:px-8 sm:pt-40 sm:pb-32">
        <DawnSky />
        <ChapterMark
          chapter={FINALE.chapter}
          name={FINALE.name}
          className="absolute top-[25svh] left-4 sm:left-8"
        />

        <HangingScroll />

        <div className="relative mt-14 flex max-w-[34em] flex-col items-center gap-2 text-center">
          {POEM.notes.map((n, i) => (
            <motion.p
              key={n}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, delay: 0.1 + i * 0.15, ease: EASE }}
              className="jh-song text-[12px] leading-relaxed tracking-[0.06em] text-(--jh-fg-3) sm:text-[13px]"
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

        <p className="jh-song relative mt-20 max-w-[36em] text-center text-[11px] leading-relaxed text-(--jh-fg-3) sm:text-[12px]">
          {FINALE.credits}
        </p>
      </div>
    </Scene>
  )
}

/** 破晓：一轮淡日从夜色里浮出来，脚下一带薄雾 */
function DawnSky() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[60svh] overflow-hidden"
    >
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 0.55, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 2.4, ease: EASE }}
        className="absolute top-[6%] left-1/2 size-[20vmin] -translate-x-1/2 rounded-full bg-(--jh-moon) blur-[3px]"
      />
      <div
        className="absolute top-[22%] left-[-10%] h-[10%] w-[120%] rounded-[50%] bg-(--jh-dawn) opacity-80 blur-[30px]"
        style={{ animation: 'jh-mist 36s ease-in-out infinite alternate' }}
      />
    </div>
  )
}

/** 立轴：天杆、画心、地杆；画心的高度从 0 展开，地杆跟着往下走，像真的把卷轴放下来 */
function HangingScroll() {
  return (
    <motion.figure
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
      className="relative flex w-[min(92vw,760px)] flex-col items-center"
    >
      {/* 天杆与挂绳 */}
      <div className="h-6 w-px bg-(--jh-ink-3)" />
      <div className="h-2.5 w-[calc(100%+24px)] rounded-full bg-(--jh-ink)" />
      <motion.div
        variants={{
          hidden: { height: 0 },
          show: { height: 'auto', transition: { duration: 2.4, ease: EASE } },
        }}
        className="w-full overflow-hidden"
      >
        <div className="relative border-x border-(--jh-ink-3)/40 bg-(--jh-paper-2) px-4 pt-10 pb-24 sm:px-10 sm:pt-14 sm:pb-28">
          {/* 绫边：画心四周淡淡一圈 */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-3 border border-(--jh-ink-3)/30 sm:inset-5"
          />
          <div
            className="jh-kai jh-vertical mx-auto h-[10.4em] text-[18px] leading-[1.5] tracking-[0.14em] text-(--jh-fg) sm:text-[26px] sm:leading-[1.6] lg:text-[30px] lg:leading-[1.7]"
            style={{ direction: 'ltr' }}
          >
            <p className="text-[1.12em] tracking-[0.22em]">
              {POEM.tune} · {POEM.title}
            </p>
            {POEM.stanzas.map((lines, si) => (
              <div key={si} style={{ marginBlockStart: si === 0 ? '0.6em' : '1.2em' }}>
                {lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ))}
          </div>
          <Seal
            text={FINALE.seal}
            size={60}
            delay={2.3}
            className="absolute bottom-8 left-8 sm:left-12"
          />
        </div>
      </motion.div>
      {/* 地杆：两头轴头略粗 */}
      <div className="relative h-3.5 w-[calc(100%+24px)] rounded-full bg-(--jh-ink) shadow-[0_6px_18px_rgb(0_0_0/0.18)]">
        <span className="absolute top-1/2 -left-2 size-5 -translate-y-1/2 rounded-full bg-(--jh-ink-2)" />
        <span className="absolute top-1/2 -right-2 size-5 -translate-y-1/2 rounded-full bg-(--jh-ink-2)" />
      </div>
    </motion.figure>
  )
}
