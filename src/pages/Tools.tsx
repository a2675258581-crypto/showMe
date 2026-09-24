import { useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { Search, X } from 'lucide-react'
import { ToolCard } from '@/components/ToolCard'
import { Kbd } from '@/components/ui'
import { useFavorites, useRecent } from '@/hooks/useFavorites'
import { useHotkey } from '@/hooks/useHotkey'
import { cn } from '@/lib/cn'
import { CATEGORIES, CATEGORY_MAP } from '@/tools/categories'
import { searchTools, TOOL_MAP, TOOLS } from '@/tools/registry'
import type { CategoryId, ToolDef } from '@/tools/types'

export default function ToolsIndex() {
  const [params, setParams] = useSearchParams()
  const cat = (params.get('c') as CategoryId | null) ?? null
  const q = params.get('q') ?? ''
  const fav = useFavorites()
  const recent = useRecent()
  const inputRef = useRef<HTMLInputElement>(null)

  useHotkey(
    '/',
    (e) => {
      if (document.activeElement === inputRef.current) return
      e.preventDefault()
      inputRef.current?.focus()
    },
    { allowInInput: false },
  )

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const results = useMemo(() => {
    const list = q ? searchTools(q) : TOOLS
    return cat && CATEGORY_MAP[cat] ? list.filter((t) => t.category === cat) : list
  }, [q, cat])

  const favTools = fav.ids.map((id) => TOOL_MAP[id]).filter(Boolean)
  const recentTools = recent.ids.map((id) => TOOL_MAP[id]).filter(Boolean)
  const showPersonal = !q && !cat
  const activeCat = cat && CATEGORY_MAP[cat]

  return (
    <div className="relative mx-auto max-w-[1180px] px-4 pt-14 pb-10 sm:px-6 sm:pt-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="text-center"
      >
        <h1 className="headline text-[40px] text-fg sm:text-[64px]">
          {activeCat ? activeCat.name : '全部工具。'}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[17px] text-fg-2 sm:text-xl">
          {activeCat ? activeCat.tagline : `${TOOLS.length} 款小工具，全部在浏览器本地运行。`}
        </p>
      </motion.div>

      {/* 搜索框 */}
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto mt-10 max-w-2xl"
      >
        <label className="group flex h-14 items-center gap-3 rounded-full border border-line bg-surface px-5 shadow-card transition-[box-shadow,border-color] focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
          <Search className="size-5 text-fg-3" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setParam('q', e.target.value || null)}
            placeholder="搜索：json、md5、base64、时间戳、postman…"
            className="h-full flex-1 bg-transparent text-[17px] text-fg outline-none placeholder:text-fg-3"
            aria-label="搜索工具"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setParam('q', null)}
              aria-label="清除搜索"
              className="rounded-full p-1 text-fg-3 hover:bg-fill-2 hover:text-fg"
            >
              <X className="size-4" />
            </button>
          ) : (
            <Kbd>/</Kbd>
          )}
        </label>
      </motion.div>

      {/* 分类筛选 */}
      <div className="no-scrollbar -mx-4 mt-6 flex justify-start gap-2 overflow-x-auto px-4 sm:justify-center">
        <Chip active={!cat} onClick={() => setParam('c', null)}>
          全部
        </Chip>
        {CATEGORIES.map((c) => (
          <Chip
            key={c.id}
            active={cat === c.id}
            onClick={() => setParam('c', cat === c.id ? null : c.id)}
            color={c.color}
          >
            <c.icon className="size-3.5" />
            {c.name}
          </Chip>
        ))}
      </div>

      {showPersonal && favTools.length > 0 && <Section title="我的收藏" tools={favTools} />}
      {showPersonal && recentTools.length > 0 && (
        <Section
          title="最近使用"
          tools={recentTools.slice(0, 4)}
          action={
            <button
              type="button"
              onClick={recent.clear}
              className="text-xs text-link hover:underline"
            >
              清除
            </button>
          }
        />
      )}

      {showPersonal ? (
        CATEGORIES.map((c) => (
          <Section
            key={c.id}
            title={c.name}
            subtitle={c.tagline}
            tools={TOOLS.filter((t) => t.category === c.id)}
          />
        ))
      ) : (
        <div className="mt-12">
          <LayoutGroup>
            <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <AnimatePresence mode="popLayout">
                {results.map((t) => (
                  <motion.div
                    key={t.id}
                    layout
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  >
                    <ToolCard tool={t} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          </LayoutGroup>
          {results.length === 0 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-20 text-center text-fg-2"
            >
              没有找到与「{q}」相关的工具。
            </motion.p>
          )}
        </div>
      )}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  color?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors',
        active ? 'text-white' : 'bg-fill-2 text-fg-2 hover:bg-fill hover:text-fg',
      )}
    >
      {active && (
        <motion.span
          layoutId="tools-chip"
          className="absolute inset-0 -z-0 rounded-full"
          style={{ background: color ?? 'var(--fg)' }}
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
        />
      )}
      <span
        className={cn(
          'relative z-[1] inline-flex items-center gap-1.5',
          active && !color && 'text-bg',
        )}
      >
        {children}
      </span>
    </button>
  )
}

function Section({
  title,
  subtitle,
  tools,
  action,
}: {
  title: string
  subtitle?: string
  tools: ToolDef[]
  action?: React.ReactNode
}) {
  return (
    <section className="mt-16">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-fg">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-fg-2">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tools.map((t, i) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, delay: (i % 4) * 0.06, ease: [0.16, 1, 0.3, 1] }}
          >
            <ToolCard tool={t} />
          </motion.div>
        ))}
      </div>
    </section>
  )
}
