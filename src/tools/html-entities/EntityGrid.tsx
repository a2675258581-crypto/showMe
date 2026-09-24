import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Copy, Search, X } from 'lucide-react'
import { Input, Panel, PanelHeader, Tabs, useToast } from '@/components/ui'
import { copyText } from '@/lib/clipboard'
import {
  ENTITY_CATEGORIES,
  searchEntities,
  type EntityCategory,
  type EntityRef,
} from '@/lib/html-entities-reference'

type Cat = EntityCategory | 'all'

const TABS = [
  { value: 'all' as Cat, label: '全部' },
  ...ENTITY_CATEGORIES.map((c) => ({ value: c.id as Cat, label: c.label })),
]

const spring = { type: 'spring', stiffness: 520, damping: 36 } as const

/** 常用实体速查：搜索 + 分类 + 点击复制 */
export function EntityGrid() {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<Cat>('common')
  const toast = useToast()
  const list = useMemo(() => searchEntities(query, query.trim() ? 'all' : cat), [query, cat])

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text)
    toast(ok ? `已复制 ${what}` : '复制失败', ok ? 'success' : 'error')
  }

  return (
    <Panel>
      <PanelHeader title="常用实体速查">
        <span className="text-xs text-fg-3">点击卡片复制实体，右上角复制字符本身</span>
      </PanelHeader>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索名称、字符、说明或码点，如 arrow、→、箭头、U+2192"
          aria-label="搜索实体"
          className="pr-10 pl-10"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="清除搜索"
            className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-fg-3 hover:bg-fill-2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {!query.trim() && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Tabs items={TABS} value={cat} onChange={setCat} className="mt-3" />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        layout
        className="mt-4 grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {list.map((e) => (
            <EntityCard key={e.name} entity={e} onCopy={copy} />
          ))}
        </AnimatePresence>
      </motion.div>
      {list.length === 0 && (
        <p className="py-10 text-center text-sm text-fg-2">
          没有匹配“{query.trim()}”的常用实体。上方的解码功能支持全部 2125 个 HTML5 命名实体。
        </p>
      )}
    </Panel>
  )
}

function EntityCard({
  entity: e,
  onCopy,
}: {
  entity: EntityRef
  onCopy: (text: string, what: string) => void
}) {
  const invisible = /^[\p{Z}\p{C}]+$/u.test(e.char)
  const hex = e.codePoint.toString(16).toUpperCase().padStart(4, '0')
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={spring}
      className="group relative"
    >
      <button
        type="button"
        onClick={() => onCopy(`&${e.name};`, `&${e.name};`)}
        title={`${e.desc} · U+${hex}`}
        aria-label={`复制 &${e.name};（${e.desc}）`}
        className="flex w-full flex-col items-center gap-1 rounded-2xl border border-line bg-surface-2 px-2 pt-4 pb-3 text-center transition-[background-color,border-color,transform] duration-200 hover:border-accent/40 hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:scale-[0.97]"
      >
        <span className="flex h-10 items-center justify-center text-[26px] leading-none text-fg">
          {invisible ? (
            <span className="rounded-md border border-dashed border-line-strong px-1.5 py-0.5 text-[11px] text-fg-3">
              不可见
            </span>
          ) : (
            e.char
          )}
        </span>
        <span className="max-w-full truncate font-mono text-xs text-accent">&amp;{e.name};</span>
        <span className="font-mono text-[10px] text-fg-3 tabular-nums">
          &amp;#{e.codePoint}; · U+{hex}
        </span>
        <span className="w-full truncate text-[11px] text-fg-2">{e.desc}</span>
      </button>
      <button
        type="button"
        onClick={() => onCopy(e.char, `字符 ${invisible ? `U+${hex}` : e.char}`)}
        aria-label={`复制字符本身（${e.desc}）`}
        title="复制字符本身"
        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full text-fg-3 opacity-60 transition-[opacity,background-color] hover:bg-fill-2 hover:text-fg hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
      >
        <Copy className="size-3" />
      </button>
    </motion.div>
  )
}
