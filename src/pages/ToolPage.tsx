import { Suspense, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { ChevronRight, Star } from 'lucide-react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ToolCard } from '@/components/ToolCard'
import { ToolIcon } from '@/components/ToolIcon'
import { useFavorites, useRecent } from '@/hooks/useFavorites'
import { cn } from '@/lib/cn'
import { CATEGORY_MAP } from '@/tools/categories'
import { TOOL_MAP, toolsByCategory } from '@/tools/registry'
import NotFound from './NotFound'

export default function ToolPage() {
  const { id = '' } = useParams()
  const tool = TOOL_MAP[id]
  const recent = useRecent()
  const fav = useFavorites()
  const { push } = recent

  useEffect(() => {
    if (!tool) return
    push(tool.id)
    document.title = `${tool.name} · showMe`
  }, [tool, push])

  if (!tool) return <NotFound />
  const cat = CATEGORY_MAP[tool.category]
  const Comp = tool.component
  const starred = fav.has(tool.id)
  const related = toolsByCategory(tool.category).filter((t) => t.id !== tool.id)

  return (
    <div className="relative">
      {/* 顶部淡淡的分类色光晕 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-60 dark:opacity-40"
        style={{
          background: `radial-gradient(60% 100% at 20% 0%, color-mix(in srgb, ${cat.gradient[0]} 18%, transparent), transparent 70%), radial-gradient(50% 90% at 85% 0%, color-mix(in srgb, ${cat.gradient[1]} 14%, transparent), transparent 70%)`,
        }}
      />
      <div className="relative mx-auto max-w-[1280px] px-4 pt-8 pb-10 sm:px-6 sm:pt-12">
        <nav className="mb-6 flex items-center gap-1 text-xs text-fg-2" aria-label="面包屑">
          <Link to="/tools" className="hover:text-fg">
            全部工具
          </Link>
          <ChevronRight className="size-3" />
          <Link to={`/tools?c=${cat.id}`} className="hover:text-fg">
            {cat.name}
          </Link>
        </nav>

        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 sm:gap-5">
            <motion.div
              initial={{ scale: 0.6, rotate: -12, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.05 }}
            >
              <ToolIcon tool={tool} size="lg" className="sm:size-16 sm:rounded-[18px] sm:[&_svg]:size-8" />
            </motion.div>
            <div className="min-w-0">
              <h1 className="headline text-[28px] text-fg sm:text-[40px]">{tool.name}</h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-fg-2 sm:text-[15px]">{tool.description}</p>
            </div>
          </div>
          <motion.button
            type="button"
            onClick={() => fav.toggle(tool.id)}
            whileTap={{ scale: 0.92 }}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-full px-4 text-[13px] font-medium transition-colors sm:self-center',
              starred ? 'bg-sys-yellow/15 text-[color:var(--warning)]' : 'bg-fill text-fg hover:bg-fill-3',
            )}
          >
            <motion.span animate={starred ? { rotate: [0, -20, 20, 0], scale: [1, 1.3, 1] } : {}} transition={{ duration: 0.45 }} className="flex">
              <Star className="size-4" fill={starred ? 'currentColor' : 'none'} />
            </motion.span>
            {starred ? '已收藏' : '收藏'}
          </motion.button>
        </header>

        <ErrorBoundary resetKey={tool.id}>
          <Suspense fallback={<ToolSkeleton />}>
            <Comp />
          </Suspense>
        </ErrorBoundary>

        {related.length > 0 && (
          <section className="mt-20">
            <h2 className="mb-5 text-xl font-semibold tracking-tight text-fg">更多{cat.name}工具</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {related.slice(0, 4).map((t) => (
                <ToolCard key={t.id} tool={t} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function ToolSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2" aria-busy="true" aria-label="加载中">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-[420px] animate-shimmer rounded-3xl border border-line bg-[linear-gradient(90deg,var(--surface)_0%,var(--surface-3)_50%,var(--surface)_100%)] bg-[length:200%_100%]"
        />
      ))}
    </div>
  )
}
