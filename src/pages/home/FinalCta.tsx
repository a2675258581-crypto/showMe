import { Link } from 'react-router-dom'
import { usePalette } from '@/components/CommandPalette'
import { Reveal } from '@/components/motion/Reveal'

export function FinalCta() {
  const palette = usePalette()
  return (
    <section className="relative px-6 py-32 text-center">
      <div className="pointer-events-none absolute top-1/2 left-1/2 h-[260px] w-[560px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 animate-pulse-glow rounded-full bg-[conic-gradient(from_90deg,#0a84ff,#bf5af2,#ff375f,#ff9f0a,#0a84ff)] opacity-20 blur-[110px] dark:opacity-30" />
      <Reveal className="relative">
        <h2 className="headline text-[48px] text-fg sm:text-[80px]">现在，就开始吧。</h2>
        <p className="mx-auto mt-5 max-w-lg text-[19px] text-fg-2 sm:text-[21px]">
          免费、无广告、无需登录。收藏起来，下次直接用。
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            to="/tools"
            className="inline-flex h-14 items-center rounded-full bg-fg px-10 text-[17px] font-medium text-bg transition-transform duration-300 hover:scale-[1.03] active:scale-95"
          >
            浏览全部工具
          </Link>
          <button
            type="button"
            onClick={palette.open}
            className="inline-flex h-14 items-center rounded-full border border-line-strong px-10 text-[17px] font-medium text-fg transition-colors hover:bg-fill-2"
          >
            搜索一个工具
          </button>
        </div>
      </Reveal>
    </section>
  )
}
