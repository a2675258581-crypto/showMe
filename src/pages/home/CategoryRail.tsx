import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Reveal } from '@/components/motion/Reveal'
import { cn } from '@/lib/cn'
import { CATEGORIES } from '@/tools/categories'
import { toolsByCategory } from '@/tools/registry'

/** 分类大卡片横向轨道（scroll-snap），右下角圆形箭头翻页 */
export function CategoryRail() {
  const scroller = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: false })

  const update = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 })
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [update])

  const page = (dir: 1 | -1) => {
    const el = scroller.current
    if (!el) return
    const card = el.querySelector<HTMLElement>('[data-card]')
    const step = card ? card.offsetWidth + 20 : el.clientWidth * 0.8
    el.scrollBy({ left: dir * step, behavior: 'smooth' })
  }

  return (
    <section className="pt-10 pb-24">
      <Reveal className="mx-auto mb-10 max-w-[1080px] px-6">
        <h2 className="headline text-[40px] text-fg sm:text-[56px]">按类别浏览。</h2>
      </Reveal>
      <div
        ref={scroller}
        onScroll={update}
        className="no-scrollbar flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-6"
        style={{
          paddingInline: 'max(24px, calc((100vw - 1080px) / 2 + 24px))',
          scrollPaddingInline: 'max(24px, calc((100vw - 1080px) / 2 + 24px))',
        }}
      >
        {CATEGORIES.map((c, i) => {
          const tools = toolsByCategory(c.id)
          const Icon = c.icon
          return (
            <motion.div
              key={c.id}
              data-card
              initial={{ opacity: 0, x: 60 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.8, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="shrink-0 snap-start"
            >
              <Link
                to={`/tools?c=${c.id}`}
                className="group relative flex h-[440px] w-[280px] flex-col overflow-hidden rounded-[28px] p-7 text-white shadow-card sm:w-[340px]"
                style={{
                  background: `linear-gradient(160deg, ${c.gradient[0]}, ${c.gradient[1]})`,
                }}
              >
                {/* 光斑 */}
                <div className="absolute -top-24 -right-24 size-64 rounded-full bg-white/25 blur-3xl transition-transform duration-700 group-hover:scale-125" />
                <div className="absolute -bottom-24 -left-16 size-56 rounded-full bg-black/10 blur-3xl" />
                <div className="relative text-xs font-semibold tracking-wider text-white/80">
                  {tools.length} 款工具
                </div>
                <h3 className="relative mt-2 text-[30px] font-bold tracking-tight">{c.name}</h3>
                <p className="relative mt-2 text-[17px] leading-snug text-white/90">{c.tagline}</p>
                <Icon
                  className="absolute right-6 bottom-24 size-28 text-white/25 transition-transform duration-700 ease-apple group-hover:scale-110 group-hover:-rotate-6"
                  strokeWidth={1.4}
                />
                <ul className="relative mt-auto flex flex-wrap gap-1.5">
                  {tools.slice(0, 4).map((t) => (
                    <li
                      key={t.id}
                      className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium backdrop-blur"
                    >
                      {t.name}
                    </li>
                  ))}
                  {tools.length > 4 && (
                    <li className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium backdrop-blur">
                      +{tools.length - 4}
                    </li>
                  )}
                </ul>
              </Link>
            </motion.div>
          )
        })}
      </div>
      <div className="mx-auto flex max-w-[1080px] justify-end gap-3 px-6">
        <RailButton disabled={edges.start} onClick={() => page(-1)} label="上一页">
          <ChevronLeft />
        </RailButton>
        <RailButton disabled={edges.end} onClick={() => page(1)} label="下一页">
          <ChevronRight />
        </RailButton>
      </div>
    </section>
  )
}

function RailButton({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'flex size-9 items-center justify-center rounded-full bg-fill text-fg transition-all duration-300 hover:bg-fill-3 active:scale-90 [&_svg]:size-5',
        disabled && 'pointer-events-none opacity-35',
      )}
    >
      {children}
    </button>
  )
}
