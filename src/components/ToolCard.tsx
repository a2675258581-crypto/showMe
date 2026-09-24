import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowUpRight, Star } from 'lucide-react'
import { useFavorites } from '@/hooks/useFavorites'
import { CATEGORY_MAP } from '@/tools/categories'
import type { ToolMeta } from '@/tools/types'
import { cn } from '@/lib/cn'
import { SpotlightCard } from './motion/SpotlightCard'
import { ToolIcon } from './ToolIcon'

/** 工具卡片：图标 + 名称 + 描述，悬停聚光与倾斜，可收藏 */
export function ToolCard({ tool, className }: { tool: ToolMeta; className?: string }) {
  const fav = useFavorites()
  const starred = fav.has(tool.id)
  const cat = CATEGORY_MAP[tool.category]
  return (
    <SpotlightCard
      glow={`color-mix(in srgb, ${cat.gradient[0]} 22%, transparent)`}
      tilt={4}
      className={cn('h-full rounded-3xl border border-line bg-surface shadow-card', className)}
    >
      <Link to={`/t/${tool.id}`} className="flex h-full flex-col gap-4 p-5 outline-none">
        <div className="flex items-start justify-between">
          <ToolIcon tool={tool} />
          <ArrowUpRight className="size-4 -translate-x-1 translate-y-1 text-fg-3 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[17px] font-semibold tracking-tight text-fg">{tool.name}</h3>
          <p className="line-clamp-2 text-[13px] leading-relaxed text-fg-2">{tool.description}</p>
        </div>
      </Link>
      <motion.button
        type="button"
        aria-label={starred ? '取消收藏' : '收藏'}
        title={starred ? '取消收藏' : '收藏'}
        onClick={() => fav.toggle(tool.id)}
        whileTap={{ scale: 0.7 }}
        animate={starred ? { scale: [1, 1.35, 1] } : { scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 15 }}
        className={cn(
          'absolute right-12 top-5 z-[2] flex size-7 items-center justify-center rounded-full transition-opacity',
          starred ? 'text-sys-yellow opacity-100' : 'text-fg-3 opacity-0 group-hover:opacity-100 hover:text-fg-2',
        )}
      >
        <Star className="size-4" fill={starred ? 'currentColor' : 'none'} />
      </motion.button>
    </SpotlightCard>
  )
}
