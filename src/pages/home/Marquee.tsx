import { Link } from 'react-router-dom'
import { Reveal } from '@/components/motion/Reveal'
import { ToolIcon } from '@/components/ToolIcon'
import { cn } from '@/lib/cn'
import { TOOLS } from '@/tools/registry'
import type { ToolDef } from '@/tools/types'

/** 两行反向无限滚动的工具胶囊，悬停暂停 */
export function Marquee() {
  const half = Math.ceil(TOOLS.length / 2)
  const rows = [TOOLS.slice(0, half), TOOLS.slice(half)]
  return (
    <section className="overflow-hidden pt-24 pb-10">
      <Reveal className="mx-auto mb-12 max-w-[980px] px-6 text-center">
        <h2 className="headline text-[40px] text-fg sm:text-[64px]">
          一个网址，
          <br className="sm:hidden" />
          <span className="text-gradient-rainbow animate-gradient-pan">全部搞定。</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[19px] text-fg-2">
          不用再在十几个网站之间来回切换。
        </p>
      </Reveal>
      <div className="flex flex-col gap-4 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
        {rows.map((row, i) => (
          <Row key={i} tools={row} reverse={i === 1} />
        ))}
      </div>
    </section>
  )
}

function Row({ tools, reverse }: { tools: ToolDef[]; reverse?: boolean }) {
  // 复制一份，translate -50% 后无缝衔接
  const items = [...tools, ...tools]
  return (
    <div className="group flex">
      <div
        className={cn(
          'flex shrink-0 gap-4 pr-4 group-hover:[animation-play-state:paused]',
          reverse ? 'animate-marquee-reverse' : 'animate-marquee',
        )}
      >
        {items.map((t, i) => (
          <Link
            key={`${t.id}-${i}`}
            to={`/t/${t.id}`}
            tabIndex={i < tools.length ? 0 : -1}
            aria-hidden={i >= tools.length}
            className="flex shrink-0 items-center gap-3 rounded-full border border-line bg-surface py-2 pr-5 pl-2 shadow-card transition-transform duration-300 hover:-translate-y-0.5"
          >
            <ToolIcon tool={t} size="sm" className="rounded-full" />
            <span className="text-[15px] font-medium whitespace-nowrap text-fg">{t.name}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
