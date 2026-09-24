import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, Globe, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  COMMON_TIME_ZONES,
  allTimeZones,
  formatOffset,
  localTimeZone,
  offsetSecondsAt,
  searchTimeZones,
  zoneLabel,
} from '@/lib/timestamp'

interface Props {
  value: string
  onChange: (tz: string) => void
  /** 弹层对齐方向 */
  align?: 'left' | 'right'
  className?: string
  'aria-label'?: string
}

interface Item {
  tz: string
  group: string
}

const displayName = (tz: string) => tz.replace(/_/g, ' ')

/** 可搜索的时区选择器：常用时区置顶，支持按城市、IANA 名称或偏移（+8）搜索，键盘可操作 */
export function TimezonePicker({ value, onChange, align = 'left', className, ...aria }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [openedAt, setOpenedAt] = useState(() => Date.now())
  const [panelWidth, setPanelWidth] = useState(352)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listId = useId()

  const zones = useMemo(() => allTimeZones(), [])
  const local = useMemo(() => localTimeZone(), [])

  const offsets = useMemo(() => {
    const map = new Map<string, string>()
    if (!open) return map
    for (const tz of zones) map.set(tz, formatOffset(offsetSecondsAt(openedAt, tz)))
    return map
  }, [open, openedAt, zones])

  const items = useMemo((): Item[] => {
    if (!open) return []
    const q = query.trim()
    if (q) return searchTimeZones(q, zones, openedAt).map((tz) => ({ tz, group: '搜索结果' }))
    const common = [...new Set([local, ...COMMON_TIME_ZONES.map((z) => z.tz)])]
    return [
      ...common.map((tz) => ({ tz, group: '常用' })),
      ...zones.filter((z) => !common.includes(z)).map((tz) => ({ tz, group: '全部时区' })),
    ]
  }, [open, query, zones, local, openedAt])

  const currentOffset = useMemo(
    () => formatOffset(offsetSecondsAt(openedAt, value)),
    [openedAt, value],
  )

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const toggle = () => {
    if (!open) {
      // 弹层宽度不超出视口（手机上触发按钮可能靠右）
      const rect = rootRef.current?.getBoundingClientRect()
      if (rect) {
        const room = align === 'left' ? window.innerWidth - rect.left : rect.right
        setPanelWidth(Math.max(240, Math.min(352, room - 12)))
      }
      setOpenedAt(Date.now())
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    setOpen(!open)
  }

  /** 关闭弹层并把焦点还给触发按钮（键盘用户不会丢失位置） */
  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const choose = (tz: string) => {
    onChange(tz)
    close()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(items.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = items[active]
      if (it) choose(it.tz)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const label = zoneLabel(value)

  return (
    <div
      ref={rootRef}
      className={cn('relative inline-flex min-w-0', className)}
      onBlur={(e) => {
        // Tab 把焦点移到选择器之外时收起弹层；relatedTarget 为空（点击空白、Safari 点按钮）交给 pointerdown 处理
        const next = e.relatedTarget as Node | null
        if (open && next && !rootRef.current?.contains(next)) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={aria['aria-label'] ?? `时区：${value}`}
        className="inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-full bg-fill pr-3 pl-3.5 text-[13px] font-medium text-fg transition-colors hover:bg-fill-3"
      >
        <Globe className="size-4 shrink-0 text-accent" />
        <span className="truncate">
          {label ? `${label} · ${displayName(value)}` : displayName(value)}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-fg-3 tabular-nums">
          UTC{currentOffset}
        </span>
        <ChevronDown
          className={cn('size-3.5 shrink-0 text-fg-2 transition-transform', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 520, damping: 36 }}
            style={{
              transformOrigin: align === 'left' ? 'top left' : 'top right',
              width: panelWidth,
            }}
            className={cn(
              'absolute top-full z-50 mt-2 overflow-hidden rounded-2xl border border-line bg-surface shadow-float',
              align === 'left' ? 'left-0' : 'right-0',
            )}
          >
            <div className="relative border-b border-line p-2">
              <Search className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-fg-3" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKeyDown}
                placeholder="搜索城市、时区或偏移，如 tokyo、纽约、+8"
                aria-label="搜索时区"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
                className="h-9 w-full rounded-xl bg-fill-2 pr-3 pl-9 text-[13px] text-fg outline-none placeholder:text-fg-3 focus:bg-fill"
              />
            </div>
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="时区列表"
              className="thin-scrollbar max-h-80 overflow-y-auto overscroll-contain p-1.5"
              data-lenis-prevent
            >
              {items.length === 0 && (
                <div className="px-3 py-8 text-center text-[13px] text-fg-3">没有匹配的时区</div>
              )}
              {items.map((it, i) => {
                const selected = it.tz === value
                const zh = it.tz === local && !zoneLabel(it.tz) ? '本机时区' : zoneLabel(it.tz)
                return (
                  <div key={it.tz}>
                    {(i === 0 || items[i - 1].group !== it.group) && (
                      <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold text-fg-3">
                        {it.group}
                      </div>
                    )}
                    <button
                      type="button"
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={selected}
                      data-index={i}
                      onClick={() => choose(it.tz)}
                      onMouseMove={() => active !== i && setActive(i)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors',
                        i === active ? 'bg-fill' : 'hover:bg-fill-2',
                      )}
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        {selected && <Check className="size-4 text-accent" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-fg">{displayName(it.tz)}</span>
                        {(zh || it.tz === local) && (
                          <span className="block truncate text-[11px] text-fg-3">
                            {zh}
                            {it.tz === local && zh !== '本机时区' ? ' · 本机' : ''}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-fg-2 tabular-nums">
                        {offsets.get(it.tz)}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
